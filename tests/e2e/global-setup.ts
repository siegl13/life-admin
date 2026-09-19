import fs from 'node:fs';

/**
 * Ensures every E2E run starts from a clean database: a leftover
 * .data-e2e directory from a previous run (or a crashed run) would make
 * "create item" tests non-deterministic (duplicate titles, leftover
 * actions from a previous test run).
 */
export default function globalSetup() {
	fs.rmSync('.data-e2e', { recursive: true, force: true });
}
