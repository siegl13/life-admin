import { describe, expect, it, vi } from 'vitest';
import { dismissExtractionRun, ExtractionRunNotFoundError } from './dismissExtractionRun';

function fakePorts(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		runs: {
			getById: vi.fn(() => ({ id: 'run-1', itemId: 'item-1', cycleId: 'cycle-1', status: 'NEW' })),
			dismissRun: vi.fn()
		},
		clock: {
			nowIso: vi.fn(() => '2026-01-01T00:00:00.000Z'),
			todayIso: vi.fn(() => '2026-01-01'),
			localHour: vi.fn(() => 12)
		},
		...overrides
	};
}

describe('dismissExtractionRun', () => {
	it('throws when the run does not exist or belongs to a different item', () => {
		const p = fakePorts({ runs: { getById: vi.fn(() => null), dismissRun: vi.fn() } });
		const attempt = () => dismissExtractionRun(p as never, { itemId: 'item-1', runId: 'missing' });
		expect(attempt).toThrow(ExtractionRunNotFoundError);
	});

	it('dismisses without touching any field-write port', () => {
		const p = fakePorts();
		dismissExtractionRun(p as never, { itemId: 'item-1', runId: 'run-1' });
		expect(p.runs.dismissRun).toHaveBeenCalledWith({
			runId: 'run-1',
			itemId: 'item-1',
			cycleId: 'cycle-1',
			reviewedAt: '2026-01-01T00:00:00.000Z'
		});
	});
});
