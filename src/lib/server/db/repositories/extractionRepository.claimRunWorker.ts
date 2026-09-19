import Database from 'better-sqlite3';
import { parentPort, workerData } from 'node:worker_threads';
import { DailyExtractionLimitReachedError } from '$lib/application/ai/ports';
import { claimRun } from './extractionRepository';

interface ClaimWorkerInput {
	dbPath: string;
	id: string;
	itemId: string;
	cycleId: string;
	attachmentId: string;
	sourceFilename: string;
	providerId: string;
	modelId: string;
	createdAt: string;
	windowStartIso: string;
	dailyLimit: number;
}

const input = workerData as ClaimWorkerInput;
const db = new Database(input.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

try {
	claimRun(db, input);
	parentPort?.postMessage('claimed');
} catch (error) {
	parentPort?.postMessage(
		error instanceof DailyExtractionLimitReachedError ? 'DAILY_LIMIT' : 'ERROR'
	);
} finally {
	db.close();
}
