import { describe, expect, it } from 'vitest';
import type { Field } from '../field/field';
import type { FieldPlan, MaterializationPlan } from '../playbook/materialize';
import { planNextCycleFields } from './rollover';

function plan(fields: Partial<FieldPlan>[]): MaterializationPlan {
	return {
		fields: fields.map((f, i) => ({
			fieldKey: f.fieldKey ?? `field-${i}`,
			label: f.label ?? `Field ${i}`,
			labelI18n: {},
			type: f.type ?? 'text',
			origin: 'PLAYBOOK',
			recommended: f.recommended ?? false,
			position: f.position ?? i,
			carryForward: f.carryForward
		})),
		events: [],
		actions: []
	};
}

function field(overrides: Partial<Field>): Field {
	return {
		id: 'id',
		cycleId: 'cycle-1',
		fieldKey: 'field-0',
		label: 'Field 0',
		type: 'text',
		origin: 'PLAYBOOK',
		recommended: false,
		position: 0,
		value: null,
		...overrides
	};
}

describe('planNextCycleFields', () => {
	it('carries a text value forward by default (no explicit carryForward)', () => {
		const seeds = planNextCycleFields(plan([{ fieldKey: 'meter', type: 'text' }]), [
			field({ fieldKey: 'meter', type: 'text', value: '12345' })
		]);
		expect(seeds[0].value).toBe('12345');
	});

	it('resets a date value by default (no explicit carryForward)', () => {
		const seeds = planNextCycleFields(plan([{ fieldKey: 'expiry', type: 'date' }]), [
			field({ fieldKey: 'expiry', type: 'date', value: '2026-01-01' })
		]);
		expect(seeds[0].value).toBeNull();
	});

	it('an empty text value stays empty, not the string "null"', () => {
		const seeds = planNextCycleFields(plan([{ fieldKey: 'note', type: 'text' }]), [
			field({ fieldKey: 'note', type: 'text', value: null })
		]);
		expect(seeds[0].value).toBeNull();
	});

	it('carryForward: false on a text field resets it', () => {
		const seeds = planNextCycleFields(
			plan([{ fieldKey: 'reading', type: 'text', carryForward: false }]),
			[field({ fieldKey: 'reading', type: 'text', value: 'stale-reading' })]
		);
		expect(seeds[0].value).toBeNull();
	});

	it('carryForward: true on a date field carries it', () => {
		const seeds = planNextCycleFields(
			plan([{ fieldKey: 'anniversary', type: 'date', carryForward: true }]),
			[field({ fieldKey: 'anniversary', type: 'date', value: '2020-05-05' })]
		);
		expect(seeds[0].value).toBe('2020-05-05');
	});

	it('a value is not carried when the field type changed', () => {
		const seeds = planNextCycleFields(plan([{ fieldKey: 'x', type: 'date' }]), [
			field({ fieldKey: 'x', type: 'text', value: 'was-text' })
		]);
		expect(seeds[0].value).toBeNull();
	});

	it('a previous PLAYBOOK field absent from the new plan is dropped', () => {
		const seeds = planNextCycleFields(plan([{ fieldKey: 'kept', type: 'text' }]), [
			field({ fieldKey: 'kept', type: 'text', value: 'a' }),
			field({ fieldKey: 'removed', type: 'text', value: 'b' })
		]);
		expect(seeds.map((s) => s.fieldKey)).toEqual(['kept']);
	});

	it('recreates custom fields with the same key, label and type, appended after playbook fields', () => {
		const seeds = planNextCycleFields(plan([{ fieldKey: 'playbook-field' }]), [
			field({ fieldKey: 'playbook-field', value: 'x' }),
			field({
				fieldKey: 'custom-1',
				label: 'My custom field',
				type: 'text',
				origin: 'CUSTOM',
				value: 'custom-value',
				position: 5
			})
		]);
		expect(seeds).toHaveLength(2);
		expect(seeds[1]).toMatchObject({
			fieldKey: 'custom-1',
			label: 'My custom field',
			type: 'text',
			origin: 'CUSTOM',
			value: 'custom-value',
			position: 1
		});
	});

	it('a custom field follows the type-driven fallback like any unannotated field', () => {
		const seeds = planNextCycleFields(plan([]), [
			field({ fieldKey: 'c', origin: 'CUSTOM', type: 'date', value: '2026-01-01' })
		]);
		expect(seeds[0].value).toBeNull();
	});

	it('does not add a duplicate seed when a custom field key collides with a playbook field key', () => {
		const seeds = planNextCycleFields(plan([{ fieldKey: 'shared', type: 'text' }]), [
			field({ fieldKey: 'shared', origin: 'CUSTOM', type: 'text', value: 'x' })
		]);
		expect(seeds.filter((s) => s.fieldKey === 'shared')).toHaveLength(1);
	});

	it('keeps playbook field positions and appends custom fields after them', () => {
		const seeds = planNextCycleFields(
			plan([
				{ fieldKey: 'a', position: 0 },
				{ fieldKey: 'b', position: 1 }
			]),
			[field({ fieldKey: 'c', origin: 'CUSTOM', position: 9 })]
		);
		expect(seeds.map((s) => s.position)).toEqual([0, 1, 2]);
	});
});
