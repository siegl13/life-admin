import { describe, expect, it } from 'vitest';
import type { Field } from './field';
import { groupFields, orderFieldGroups, type FieldGroup } from './fieldGroup';

function group(id: string, position: number, overrides: Partial<FieldGroup> = {}): FieldGroup {
	return {
		id,
		itemId: 'item-1',
		label: id,
		isDefault: false,
		featured: false,
		position,
		...overrides
	};
}

function field(fieldKey: string, position: number, value: string | null = null): Field {
	return {
		id: `f-${fieldKey}`,
		cycleId: 'c1',
		fieldKey,
		label: fieldKey,
		type: 'text',
		origin: 'PLAYBOOK',
		recommended: false,
		position,
		value
	};
}

const general = group('general', 2, { label: null, isDefault: true });

describe('orderFieldGroups', () => {
	it('puts featured groups first and keeps position order inside each partition', () => {
		const ordered = orderFieldGroups([
			group('a', 0),
			group('b', 1, { featured: true }),
			general,
			group('d', 3, { featured: true })
		]);
		expect(ordered.map((g) => g.id)).toEqual(['b', 'd', 'a', 'general']);
	});

	it('restores the original order once a group is unfeatured', () => {
		const groups = [group('a', 0), group('b', 1, { featured: true }), general];
		const unfeatured = groups.map((g) => ({ ...g, featured: false }));
		expect(orderFieldGroups(unfeatured).map((g) => g.id)).toEqual(['a', 'b', 'general']);
	});
});

describe('groupFields', () => {
	it('assigns unassigned fields to the default group', () => {
		const views = groupFields([group('a', 0), general], [], [field('x', 0), field('y', 1)]);
		expect(views.find((v) => v.group.isDefault)!.fields.map((f) => f.fieldKey)).toEqual(['x', 'y']);
		expect(views.find((v) => v.group.id === 'a')!.fields).toEqual([]);
	});

	it('honours assignments and keeps field position order inside a group', () => {
		const views = groupFields(
			[group('a', 0), general],
			[
				{ fieldKey: 'y', groupId: 'a' },
				{ fieldKey: 'x', groupId: 'a' }
			],
			[field('x', 0), field('y', 1), field('z', 2)]
		);
		expect(views[0].fields.map((f) => f.fieldKey)).toEqual(['x', 'y']);
		expect(views[1].fields.map((f) => f.fieldKey)).toEqual(['z']);
	});

	it('falls back to the default group for an assignment to an unknown group', () => {
		const views = groupFields([general], [{ fieldKey: 'x', groupId: 'deleted' }], [field('x', 0)]);
		expect(views[0].fields).toHaveLength(1);
	});

	it('splits filled and empty fields without losing any', () => {
		const views = groupFields(
			[general],
			[],
			[field('x', 0, 'v'), field('y', 1, null), field('z', 2, '')]
		);
		expect(views[0].filledFields.map((f) => f.fieldKey)).toEqual(['x']);
		expect(views[0].emptyFields.map((f) => f.fieldKey)).toEqual(['y', 'z']);
		expect(views[0].fields).toHaveLength(3);
	});

	it('returns featured groups first', () => {
		const views = groupFields([group('a', 0), group('b', 1, { featured: true }), general], [], []);
		expect(views.map((v) => v.group.id)).toEqual(['b', 'a', 'general']);
	});
});
