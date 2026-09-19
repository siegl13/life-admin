import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../database';
import { emptyMaterializationPlan } from '$lib/domain/playbook/materialize';
import { createItem, setItemStatus } from './itemRepository';
import {
	ActionNotMutableError,
	addManualAction,
	getAction,
	listActions,
	listDependencies,
	setActionDueOverride,
	setActionState
} from './actionRepository';
import { ItemNotWritableError } from './writeGuards';

/** A generic item has no playbook, so its only actions are MANUAL. A
 *  DERIVED action for the due-override tests is inserted directly,
 *  mirroring the raw-INSERT pattern fieldRepository.test.ts already uses
 *  for a PLAYBOOK-origin row. */
function insertDerivedAction(
	db: Database.Database,
	cycleId: string,
	overrides: { dueDate?: string | null; dueOverrideDate?: string | null } = {}
): string {
	const id = crypto.randomUUID();
	db.prepare(
		`INSERT INTO actions (id, cycle_id, action_key, label, description, state, due_kind, due_event_key, due_offset, due_date, due_override_date, position, created_at, completed_at)
		 VALUES (?, ?, 'derived_action', 'Derived action', NULL, 'OPEN', 'DERIVED', 'some_event', '{}', ?, ?, 0, ?, NULL)`
	).run(
		id,
		cycleId,
		overrides.dueDate ?? null,
		overrides.dueOverrideDate ?? null,
		new Date().toISOString()
	);
	return id;
}

let tmpDir: string;
let db: Database.Database;
let itemId: string;
let cycleId: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeadmin-action-repo-'));
	db = openDatabase(path.join(tmpDir, 'test.sqlite'));
	const item = createItem(db, {
		title: 'Generic item',
		note: null,
		playbook: null,
		materialization: emptyMaterializationPlan()
	});
	itemId = item.id;
	cycleId = (
		db.prepare(`SELECT id FROM cycles WHERE item_id = ? AND status = 'ACTIVE'`).get(item.id) as {
			id: string;
		}
	).id;
});

afterEach(() => {
	db.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('setActionState', () => {
	it('transitions OPEN -> DONE and stamps completed_at', () => {
		const action = addManualAction(db, cycleId, { label: 'Call the bank', dueDate: null });
		const updated = setActionState(db, itemId, action.id, 'DONE');
		expect(updated.state).toBe('DONE');
		expect(updated.completedAt).not.toBeNull();
	});

	it('transitions OPEN -> SKIPPED and stamps completed_at', () => {
		const action = addManualAction(db, cycleId, { label: 'Call the bank', dueDate: null });
		const updated = setActionState(db, itemId, action.id, 'SKIPPED');
		expect(updated.state).toBe('SKIPPED');
		expect(updated.completedAt).not.toBeNull();
	});

	it('persists the transition across a fresh read', () => {
		const action = addManualAction(db, cycleId, { label: 'Call the bank', dueDate: null });
		setActionState(db, itemId, action.id, 'DONE');
		const reloaded = getAction(db, action.id)!;
		expect(reloaded.state).toBe('DONE');
		expect(reloaded.completedAt).not.toBeNull();
	});

	it('allows DONE -> OPEN (reopening) and clears completedAt', () => {
		const action = addManualAction(db, cycleId, { label: 'Call the bank', dueDate: null });
		setActionState(db, itemId, action.id, 'DONE');
		const reopened = setActionState(db, itemId, action.id, 'OPEN');
		expect(reopened.state).toBe('OPEN');
		expect(reopened.completedAt).toBeNull();
	});

	it('allows SKIPPED -> OPEN (reopening)', () => {
		const action = addManualAction(db, cycleId, { label: 'Call the bank', dueDate: null });
		setActionState(db, itemId, action.id, 'SKIPPED');
		const reopened = setActionState(db, itemId, action.id, 'OPEN');
		expect(reopened.state).toBe('OPEN');
		expect(reopened.completedAt).toBeNull();
	});

	it('rejects reopening an already-OPEN action (OPEN -> OPEN)', () => {
		const action = addManualAction(db, cycleId, { label: 'Call the bank', dueDate: null });
		expect(() => setActionState(db, itemId, action.id, 'OPEN')).toThrow(ActionNotMutableError);
	});

	it('rejects re-completing an already DONE action (DONE -> DONE)', () => {
		const action = addManualAction(db, cycleId, { label: 'Call the bank', dueDate: null });
		setActionState(db, itemId, action.id, 'DONE');
		expect(() => setActionState(db, itemId, action.id, 'DONE')).toThrow(ActionNotMutableError);
	});

	it('rejects DONE -> SKIPPED', () => {
		const action = addManualAction(db, cycleId, { label: 'Call the bank', dueDate: null });
		setActionState(db, itemId, action.id, 'DONE');
		expect(() => setActionState(db, itemId, action.id, 'SKIPPED')).toThrow(ActionNotMutableError);
	});

	it('rejects SKIPPED -> DONE', () => {
		const action = addManualAction(db, cycleId, { label: 'Call the bank', dueDate: null });
		setActionState(db, itemId, action.id, 'SKIPPED');
		expect(() => setActionState(db, itemId, action.id, 'DONE')).toThrow(ActionNotMutableError);
	});

	it('throws ActionNotMutableError for an unknown action id', () => {
		expect(() => setActionState(db, itemId, 'does-not-exist', 'DONE')).toThrow(
			ActionNotMutableError
		);
	});

	it('throws ActionNotMutableError when the action belongs to a different item (Slice 8 review, finding 1)', () => {
		const otherItem = createItem(db, {
			title: 'Other item',
			note: null,
			playbook: null,
			materialization: emptyMaterializationPlan()
		});
		const action = addManualAction(db, cycleId, { label: 'Call the bank', dueDate: null });
		expect(() => setActionState(db, otherItem.id, action.id, 'DONE')).toThrow(
			ActionNotMutableError
		);
		expect(getAction(db, action.id)!.state).toBe('OPEN');
	});

	it('throws ActionNotMutableError when the item is archived, for DONE', () => {
		const action = addManualAction(db, cycleId, { label: 'Call the bank', dueDate: null });
		setItemStatus(db, itemId, 'ARCHIVED');
		expect(() => setActionState(db, itemId, action.id, 'DONE')).toThrow(ActionNotMutableError);
		expect(getAction(db, action.id)!.state).toBe('OPEN');
	});

	it('throws ActionNotMutableError when the item is archived, for SKIPPED (Slice 8 review, finding 1)', () => {
		const action = addManualAction(db, cycleId, { label: 'Call the bank', dueDate: null });
		setItemStatus(db, itemId, 'ARCHIVED');
		expect(() => setActionState(db, itemId, action.id, 'SKIPPED')).toThrow(ActionNotMutableError);
		expect(getAction(db, action.id)!.state).toBe('OPEN');
	});

	it('throws ActionNotMutableError for an OPEN action in a cycle that is no longer ACTIVE', () => {
		const action = addManualAction(db, cycleId, { label: 'Call the bank', dueDate: null });
		// Force the cycle itself to look completed without touching the
		// action row — this is what a real rollover does to the cycle it
		// completes (see cycleRepository.startNextCycle).
		db.prepare(`UPDATE cycles SET status = 'COMPLETED', completed_at = ? WHERE id = ?`).run(
			new Date().toISOString(),
			cycleId
		);
		expect(() => setActionState(db, itemId, action.id, 'DONE')).toThrow(ActionNotMutableError);
		expect(getAction(db, action.id)!.state).toBe('OPEN');
	});
});

describe('addManualAction', () => {
	it('creates an OPEN, MANUAL-due action with no dependencies', () => {
		const action = addManualAction(db, cycleId, {
			label: 'Remaining payment',
			dueDate: '2026-05-01'
		});
		expect(action.state).toBe('OPEN');
		expect(action.dueKind).toBe('MANUAL');
		expect(action.dueDate).toBe('2026-05-01');
		expect(listDependencies(db, cycleId)).toEqual([]);
	});

	it('allows an undated manual action', () => {
		const action = addManualAction(db, cycleId, { label: 'Remaining payment', dueDate: null });
		expect(action.dueDate).toBeNull();
	});

	it('assigns a monotonically increasing position after existing actions', () => {
		const first = addManualAction(db, cycleId, { label: 'First', dueDate: null });
		const second = addManualAction(db, cycleId, { label: 'Second', dueDate: null });
		expect(second.position).toBeGreaterThan(first.position);
	});

	it('gives every manual action a key prefixed m_ so it can never collide with a playbook action key', () => {
		const action = addManualAction(db, cycleId, { label: 'Remaining payment', dueDate: null });
		expect(action.actionKey.startsWith('m_')).toBe(true);
	});

	it('trims the label', () => {
		const action = addManualAction(db, cycleId, { label: '  Remaining payment  ', dueDate: null });
		expect(action.label).toBe('Remaining payment');
	});

	it('persists across a fresh read via listActions', () => {
		addManualAction(db, cycleId, { label: 'Remaining payment', dueDate: null });
		expect(listActions(db, cycleId)).toHaveLength(1);
	});

	it('refuses to add a manual action once the item is archived, and adds no row (Slice 8 review, finding 2)', () => {
		setItemStatus(db, itemId, 'ARCHIVED');
		expect(() =>
			addManualAction(db, cycleId, { label: 'Remaining payment', dueDate: null })
		).toThrow(ItemNotWritableError);
		expect(listActions(db, cycleId)).toEqual([]);
	});
});

describe('history is immutable (Slice 8, docs/adr cycles-and-rollover)', () => {
	it("a completed cycle's DONE action cannot be transitioned again", () => {
		const action = addManualAction(db, cycleId, { label: 'One-off task', dueDate: null });
		setActionState(db, itemId, action.id, 'DONE');

		// Simulate the cycle having since been completed and rolled over:
		// the row itself doesn't need a real rollover to prove the point,
		// since the guarded UPDATE's `state IN (...)` condition forbids
		// leaving DONE/SKIPPED regardless of which cycle the action
		// belongs to.
		expect(() => setActionState(db, itemId, action.id, 'SKIPPED')).toThrow(ActionNotMutableError);
		expect(getAction(db, action.id)!.state).toBe('DONE');
	});
});

describe('setActionDueOverride (user override of a DERIVED action due date)', () => {
	it('sets an override and returns it on the updated action', () => {
		const actionId = insertDerivedAction(db, cycleId, { dueDate: '2026-09-30' });
		const updated = setActionDueOverride(db, itemId, actionId, '2026-10-05');
		expect(updated.dueOverrideDate).toBe('2026-10-05');
		expect(updated.dueDate).toBe('2026-09-30'); // calculated date is untouched
	});

	it('persists the override across a fresh read', () => {
		const actionId = insertDerivedAction(db, cycleId, { dueDate: '2026-09-30' });
		setActionDueOverride(db, itemId, actionId, '2026-10-05');
		expect(getAction(db, actionId)!.dueOverrideDate).toBe('2026-10-05');
	});

	it('clears the override back to null ("Auf Vorschlag zurücksetzen")', () => {
		const actionId = insertDerivedAction(db, cycleId, {
			dueDate: '2026-10-02',
			dueOverrideDate: '2026-10-05'
		});
		const updated = setActionDueOverride(db, itemId, actionId, null);
		expect(updated.dueOverrideDate).toBeNull();
		expect(updated.dueDate).toBe('2026-10-02'); // the latest calculated date is what remains
	});

	it('refuses on a MANUAL action: there is no playbook suggestion to override', () => {
		const action = addManualAction(db, cycleId, { label: 'Call the bank', dueDate: '2026-05-01' });
		expect(() => setActionDueOverride(db, itemId, action.id, '2026-06-01')).toThrow(
			ActionNotMutableError
		);
		expect(getAction(db, action.id)!.dueOverrideDate).toBeNull();
	});

	it('refuses when the action belongs to a different item', () => {
		const otherItem = createItem(db, {
			title: 'Other item',
			note: null,
			playbook: null,
			materialization: emptyMaterializationPlan()
		});
		const actionId = insertDerivedAction(db, cycleId, { dueDate: '2026-09-30' });
		expect(() => setActionDueOverride(db, otherItem.id, actionId, '2026-10-05')).toThrow(
			ActionNotMutableError
		);
		expect(getAction(db, actionId)!.dueOverrideDate).toBeNull();
	});

	it('refuses once the item is archived', () => {
		const actionId = insertDerivedAction(db, cycleId, { dueDate: '2026-09-30' });
		setItemStatus(db, itemId, 'ARCHIVED');
		expect(() => setActionDueOverride(db, itemId, actionId, '2026-10-05')).toThrow(
			ActionNotMutableError
		);
		expect(getAction(db, actionId)!.dueOverrideDate).toBeNull();
	});

	it('refuses for an action in a cycle that is no longer ACTIVE (completed/historical cycle)', () => {
		const actionId = insertDerivedAction(db, cycleId, { dueDate: '2026-09-30' });
		db.prepare(`UPDATE cycles SET status = 'COMPLETED', completed_at = ? WHERE id = ?`).run(
			new Date().toISOString(),
			cycleId
		);
		expect(() => setActionDueOverride(db, itemId, actionId, '2026-10-05')).toThrow(
			ActionNotMutableError
		);
		expect(getAction(db, actionId)!.dueOverrideDate).toBeNull();
	});
});
