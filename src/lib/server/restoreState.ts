let pending: { safetyBackup: string } | null = null;

export function latchRestorePending(result: { safetyBackup: string }): void {
	pending = result;
}

export function getRestorePending(): { safetyBackup: string } | null {
	return pending;
}

export function isRestorePending(): boolean {
	return pending !== null;
}
