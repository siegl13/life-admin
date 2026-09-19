import { describe, expect, it } from 'vitest';
import { effectiveDueDate } from './action';

/**
 * "The playbook calculates the default, the user has the final say" —
 * effectiveDueDate is the one place this precedence rule lives. See the
 * due-date-override feature (docs/roadmap-v1.md is silent on it by
 * design: this is a materialized-action override, not playbook syntax).
 */
describe('effectiveDueDate', () => {
	it('uses the calculated due date when there is no override', () => {
		expect(effectiveDueDate({ dueDate: '2026-09-30', dueOverrideDate: null })).toBe('2026-09-30');
	});

	it('uses the user override when one is set, even though the calculated date differs', () => {
		expect(effectiveDueDate({ dueDate: '2026-09-30', dueOverrideDate: '2026-10-05' })).toBe(
			'2026-10-05'
		);
	});

	it('keeps using the override after the calculated date is recalculated to something else', () => {
		// Same override as above, but the calculated date has since moved
		// (e.g. the source field changed) — the override must still win.
		expect(effectiveDueDate({ dueDate: '2026-10-02', dueOverrideDate: '2026-10-05' })).toBe(
			'2026-10-05'
		);
	});

	it('falls back to the calculated date once the override is cleared', () => {
		expect(effectiveDueDate({ dueDate: '2026-10-02', dueOverrideDate: null })).toBe('2026-10-02');
	});

	it('is null when neither the calculated date nor an override is known', () => {
		expect(effectiveDueDate({ dueDate: null, dueOverrideDate: null })).toBeNull();
	});
});
