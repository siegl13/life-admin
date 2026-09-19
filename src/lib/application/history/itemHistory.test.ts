import { describe, expect, it, vi } from 'vitest';
import { recordHistoryEvent, loadItemHistory, countItemHistory } from './itemHistory';
import type { ItemHistoryRepositoryPort, Clock, IdGeneratorPort } from '../ports';

describe('itemHistory application', () => {
	const mockClock: Clock = {
		nowIso: () => '2026-01-15T12:00:00.000Z',
		todayIso: () => '2026-01-15',
		localHour: () => 12
	};
	const mockIds: IdGeneratorPort = {
		newId: () => 'test-uuid'
	};

	describe('recordHistoryEvent', () => {
		it('inserts an event with the correct shape', () => {
			const insert = vi.fn();
			const history: ItemHistoryRepositoryPort = {
				insert,
				listByItem: vi.fn(),
				countByItem: vi.fn(),
				deleteForItem: vi.fn()
			};

			recordHistoryEvent(
				{ history, ids: mockIds, clock: mockClock },
				{
					itemId: 'item-1',
					actorKind: 'OWNER',
					eventType: 'FIELD_CHANGED',
					payload: { fieldKey: 'notes' }
				}
			);

			expect(insert).toHaveBeenCalledWith({
				id: 'test-uuid',
				itemId: 'item-1',
				actorKind: 'OWNER',
				eventType: 'FIELD_CHANGED',
				payload: '{"fieldKey":"notes"}',
				createdAt: '2026-01-15T12:00:00.000Z'
			});
		});

		it('rejects unknown event types', () => {
			const history: ItemHistoryRepositoryPort = {
				insert: vi.fn(),
				listByItem: vi.fn(),
				countByItem: vi.fn(),
				deleteForItem: vi.fn()
			};

			expect(() =>
				recordHistoryEvent(
					{ history, ids: mockIds, clock: mockClock },
					{
						itemId: 'item-1',
						actorKind: 'OWNER',
						eventType: 'UNKNOWN_TYPE' as never
					}
				)
			).toThrow('Unknown history event type');
		});

		it('uses empty object payload when none provided', () => {
			const insert = vi.fn();
			const history: ItemHistoryRepositoryPort = {
				insert,
				listByItem: vi.fn(),
				countByItem: vi.fn(),
				deleteForItem: vi.fn()
			};

			recordHistoryEvent(
				{ history, ids: mockIds, clock: mockClock },
				{
					itemId: 'item-1',
					actorKind: 'SYSTEM',
					eventType: 'ITEM_ARCHIVED'
				}
			);

			expect(insert).toHaveBeenCalledWith(
				expect.objectContaining({
					payload: '{}'
				})
			);
		});
	});

	describe('loadItemHistory', () => {
		it('parses JSON payloads safely', () => {
			const history: ItemHistoryRepositoryPort = {
				insert: vi.fn(),
				listByItem: vi.fn().mockReturnValue([
					{
						id: 'e1',
						itemId: 'item-1',
						actorKind: 'OWNER',
						eventType: 'FIELD_CHANGED',
						payload: '{"fieldKey":"notes"}',
						createdAt: '2026-01-15T12:00:00.000Z'
					},
					{
						id: 'e2',
						itemId: 'item-1',
						actorKind: 'OWNER',
						eventType: 'ITEM_ARCHIVED',
						payload: 'invalid json',
						createdAt: '2026-01-14T12:00:00.000Z'
					}
				]),
				countByItem: vi.fn(),
				deleteForItem: vi.fn()
			};

			const events = loadItemHistory({ history }, { itemId: 'item-1', limit: 10, offset: 0 });

			expect(events).toHaveLength(2);
			expect(events[0].payload).toEqual({ fieldKey: 'notes' });
			expect(events[1].payload).toEqual({});
		});

		it("resolves a FIELD_CHANGED event to its field's current label", () => {
			const history: ItemHistoryRepositoryPort = {
				insert: vi.fn(),
				listByItem: vi.fn().mockReturnValue([
					{
						id: 'e1',
						itemId: 'item-1',
						actorKind: 'OWNER',
						eventType: 'FIELD_CHANGED',
						payload: '{"fieldKey":"contract_end"}',
						createdAt: '2026-01-15T12:00:00.000Z'
					}
				]),
				countByItem: vi.fn(),
				deleteForItem: vi.fn()
			};

			const events = loadItemHistory(
				{ history },
				{
					itemId: 'item-1',
					limit: 10,
					offset: 0,
					fields: [{ fieldKey: 'contract_end', label: 'Contract end' }]
				}
			);

			expect(events[0].fieldLabel).toBe('Contract end');
		});

		it('falls back to a null field label when the field no longer exists', () => {
			const history: ItemHistoryRepositoryPort = {
				insert: vi.fn(),
				listByItem: vi.fn().mockReturnValue([
					{
						id: 'e1',
						itemId: 'item-1',
						actorKind: 'OWNER',
						eventType: 'FIELD_CHANGED',
						payload: '{"fieldKey":"removed_field"}',
						createdAt: '2026-01-15T12:00:00.000Z'
					}
				]),
				countByItem: vi.fn(),
				deleteForItem: vi.fn()
			};

			const events = loadItemHistory(
				{ history },
				{
					itemId: 'item-1',
					limit: 10,
					offset: 0,
					fields: [{ fieldKey: 'contract_end', label: 'Contract end' }]
				}
			);

			expect(events[0].fieldLabel).toBeNull();
		});

		it('resolves a FIELD_CHANGED event from a prior cycle by fieldKey', () => {
			const history: ItemHistoryRepositoryPort = {
				insert: vi.fn(),
				listByItem: vi.fn().mockReturnValue([
					{
						id: 'e1',
						itemId: 'item-1',
						actorKind: 'OWNER',
						eventType: 'FIELD_CHANGED',
						payload: '{"fieldKey":"contract_end"}',
						createdAt: '2026-01-15T12:00:00.000Z'
					}
				]),
				countByItem: vi.fn(),
				deleteForItem: vi.fn()
			};

			const events = loadItemHistory(
				{ history },
				{
					itemId: 'item-1',
					limit: 10,
					offset: 0,
					fields: [{ fieldKey: 'contract_end', label: 'Vertragsende' }]
				}
			);

			expect(events[0].fieldLabel).toBe('Vertragsende');
		});

		it('leaves fieldLabel null for non-field event types', () => {
			const history: ItemHistoryRepositoryPort = {
				insert: vi.fn(),
				listByItem: vi.fn().mockReturnValue([
					{
						id: 'e1',
						itemId: 'item-1',
						actorKind: 'OWNER',
						eventType: 'ITEM_ARCHIVED',
						payload: '{}',
						createdAt: '2026-01-15T12:00:00.000Z'
					}
				]),
				countByItem: vi.fn(),
				deleteForItem: vi.fn()
			};

			const events = loadItemHistory({ history }, { itemId: 'item-1', limit: 10, offset: 0 });

			expect(events[0].fieldLabel).toBeNull();
		});
	});

	describe('countItemHistory', () => {
		it('returns the count from the repository', () => {
			const history: ItemHistoryRepositoryPort = {
				insert: vi.fn(),
				listByItem: vi.fn(),
				countByItem: vi.fn().mockReturnValue(5),
				deleteForItem: vi.fn()
			};

			expect(countItemHistory({ history }, 'item-1')).toBe(5);
		});
	});
});
