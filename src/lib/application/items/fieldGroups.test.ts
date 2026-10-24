import { describe, expect, it, vi } from 'vitest';
import type { FieldGroup } from '../../domain/field/fieldGroup';
import type { FieldGroupRepositoryPort } from '../ports';
import {
	FieldGroupLabelError,
	FieldGroupTargetNotFoundError,
	createFieldGroup,
	moveFieldGroup,
	renameFieldGroup,
	setFieldGroupFeatured
} from './fieldGroups';

const GROUP: FieldGroup = {
	id: 'g1',
	itemId: 'item-1',
	label: 'Trip',
	isDefault: false,
	featured: false,
	position: 0
};

function ports(): { fieldGroups: FieldGroupRepositoryPort } {
	return {
		fieldGroups: {
			listGroups: vi.fn(() => []),
			listAssignments: vi.fn(() => []),
			createGroup: vi.fn(() => GROUP),
			renameGroup: vi.fn(() => GROUP),
			setFeatured: vi.fn(() => GROUP),
			reorder: vi.fn(),
			moveField: vi.fn()
		}
	};
}

describe('field group use cases', () => {
	it('trims the label before creating a group', () => {
		const p = ports();
		createFieldGroup(p, { itemId: 'item-1', label: '  Trip ' });
		expect(p.fieldGroups.createGroup).toHaveBeenCalledWith('item-1', 'Trip');
	});

	it('rejects blank and over-long labels without touching the repository', () => {
		const p = ports();
		expect(() => createFieldGroup(p, { itemId: 'item-1', label: '   ' })).toThrow(
			FieldGroupLabelError
		);
		expect(() =>
			renameFieldGroup(p, { itemId: 'item-1', groupId: 'g1', label: 'x'.repeat(81) })
		).toThrow(FieldGroupLabelError);
		expect(p.fieldGroups.createGroup).not.toHaveBeenCalled();
		expect(p.fieldGroups.renameGroup).not.toHaveBeenCalled();
	});

	describe('moveFieldGroup', () => {
		function withGroups(groups: { id: string; featured?: boolean }[]): ReturnType<typeof ports> {
			const p = ports();
			p.fieldGroups.listGroups = vi.fn(() =>
				groups.map((g, position) => ({
					...GROUP,
					id: g.id,
					featured: g.featured ?? false,
					position
				}))
			);
			return p;
		}

		it('swaps a group with its neighbour and rewrites the complete order', () => {
			const p = withGroups([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
			moveFieldGroup(p, { itemId: 'item-1', groupId: 'b', direction: 'down' });
			expect(p.fieldGroups.reorder).toHaveBeenCalledWith('item-1', ['a', 'c', 'b']);
		});

		it('skips groups of the other featured partition and keeps their positions', () => {
			// Display: featured [c], then [a, b]. Moving b up swaps with a, never with c.
			const p = withGroups([{ id: 'a' }, { id: 'b' }, { id: 'c', featured: true }]);
			moveFieldGroup(p, { itemId: 'item-1', groupId: 'b', direction: 'up' });
			expect(p.fieldGroups.reorder).toHaveBeenCalledWith('item-1', ['b', 'a', 'c']);
		});

		it('moves across an interleaved group of the other partition', () => {
			const p = withGroups([{ id: 'a' }, { id: 'f', featured: true }, { id: 'b' }]);
			moveFieldGroup(p, { itemId: 'item-1', groupId: 'a', direction: 'down' });
			expect(p.fieldGroups.reorder).toHaveBeenCalledWith('item-1', ['b', 'f', 'a']);
		});

		it('does nothing at the edge of its partition', () => {
			const p = withGroups([{ id: 'a' }, { id: 'f', featured: true }]);
			moveFieldGroup(p, { itemId: 'item-1', groupId: 'a', direction: 'down' });
			moveFieldGroup(p, { itemId: 'item-1', groupId: 'a', direction: 'up' });
			expect(p.fieldGroups.reorder).not.toHaveBeenCalled();
		});

		it('rejects a group that is not part of the item', () => {
			const p = withGroups([{ id: 'a' }]);
			expect(() =>
				moveFieldGroup(p, { itemId: 'item-1', groupId: 'zzz', direction: 'up' })
			).toThrow(FieldGroupTargetNotFoundError);
		});
	});

	it('passes the explicit feature flag through unchanged', () => {
		const p = ports();
		setFieldGroupFeatured(p, { itemId: 'item-1', groupId: 'g1', featured: true });
		expect(p.fieldGroups.setFeatured).toHaveBeenCalledWith('item-1', 'g1', true);
	});
});
