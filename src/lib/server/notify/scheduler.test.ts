import { describe, expect, it, vi } from 'vitest';
import { latchRestorePending } from '$lib/server/restoreState';
import { createNotificationTick } from './scheduler';

describe('createNotificationTick', () => {
	it('skips overlapping dispatches and permits the next completed tick', async () => {
		let resolveFirst!: (value: { sent: number; failed: number }) => void;
		const first = new Promise<{ sent: number; failed: number }>((resolve) => {
			resolveFirst = resolve;
		});
		const dispatch = vi.fn().mockReturnValueOnce(first).mockResolvedValue({ sent: 0, failed: 0 });
		const tick = createNotificationTick(dispatch, () => {});

		tick();
		tick();
		expect(dispatch).toHaveBeenCalledTimes(1);

		resolveFirst!({ sent: 0, failed: 0 });
		await first;
		await Promise.resolve();
		tick();
		expect(dispatch).toHaveBeenCalledTimes(2);
	});

	it('does not dispatch or reopen the database while restore is pending', async () => {
		latchRestorePending({ safetyBackup: 'pre-restore-test.zip' });
		const dispatch = vi.fn().mockResolvedValue({ sent: 0, failed: 0 });
		const recordTick = vi.fn();
		const tick = createNotificationTick(dispatch, recordTick);

		tick();
		await Promise.resolve();

		expect(dispatch).not.toHaveBeenCalled();
		expect(recordTick).not.toHaveBeenCalled();
	});
});
