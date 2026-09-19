import { describe, expect, it } from 'vitest';
import { parsePlaybookStructure } from './schema';
import { normalizePlaybook, type NormalizedPlaybook } from './normalize';
import { parsePlaybookSnapshot } from './snapshot';

function parse(doc: unknown) {
	const result = parsePlaybookStructure(doc);
	if (!result.success)
		throw new Error('fixture failed structural validation: ' + result.error.message);
	return result.data;
}

function base(overrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: 1,
		id: 'de.finance.nv-certificate',
		version: '1.0.0',
		name: 'NV certificate',
		fields: [{ key: 'valid_until', type: 'date', label: 'Valid until' }],
		events: [{ key: 'expiry', label: 'Expiry', sourceField: 'valid_until' }],
		actions: [
			{ key: 'request_new', label: 'Request new', due: { event: 'expiry', offset: { months: -2 } } }
		],
		...overrides
	};
}

function normalized(overrides: Record<string, unknown> = {}): NormalizedPlaybook {
	return normalizePlaybook(parse(base(overrides)));
}

describe('parsePlaybookSnapshot', () => {
	it('round-trips a real normalizePlaybook() output', () => {
		const snapshot = normalized();
		const result = parsePlaybookSnapshot(snapshot);
		expect(result.ok).toBe(true);
	});

	it('rejects an unknown top-level key', () => {
		const snapshot = { ...normalized(), unexpectedKey: 'x' };
		const result = parsePlaybookSnapshot(snapshot);
		expect(result.ok).toBe(false);
	});

	it('rejects an event referencing an unknown field', () => {
		const snapshot = normalized();
		snapshot.events[0].sourceField = 'does-not-exist';
		const result = parsePlaybookSnapshot(snapshot);
		expect(result.ok).toBe(false);
	});

	it('rejects an action referencing an unknown event', () => {
		const snapshot = normalized();
		snapshot.actions[0].due = { event: 'does-not-exist', offset: { months: 1 } };
		const result = parsePlaybookSnapshot(snapshot);
		expect(result.ok).toBe(false);
	});

	it('rejects a dependency cycle', () => {
		const snapshot = normalized({
			actions: [
				{ key: 'a', label: 'A', dependsOn: ['b'] },
				{ key: 'b', label: 'B', dependsOn: ['a'] }
			]
		});
		const result = parsePlaybookSnapshot(snapshot);
		expect(result.ok).toBe(false);
	});

	it('rejects an out-of-range offset', () => {
		const snapshot = normalized();
		snapshot.actions[0].due = { event: 'expiry', offset: { months: 999999999 } };
		const result = parsePlaybookSnapshot(snapshot);
		expect(result.ok).toBe(false);
	});

	it('rejects a non-object value', () => {
		expect(parsePlaybookSnapshot('just a string').ok).toBe(false);
		expect(parsePlaybookSnapshot(null).ok).toBe(false);
		expect(parsePlaybookSnapshot(42).ok).toBe(false);
	});

	// The whole reason `carryForward` is optional (Finding-free, Slice 8):
	// a snapshot written before the property existed must still validate.
	it('a snapshot with no carryForward on any field validates', () => {
		const snapshot = normalized();
		expect(snapshot.fields[0].carryForward).toBeUndefined();
		expect(parsePlaybookSnapshot(snapshot).ok).toBe(true);
	});

	it('a snapshot with carryForward on some fields and not others validates', () => {
		const snapshot = normalized({
			fields: [
				{ key: 'a', type: 'text', label: 'A', carryForward: true },
				{ key: 'b', type: 'date', label: 'B' }
			],
			events: [],
			actions: []
		});
		expect(parsePlaybookSnapshot(snapshot).ok).toBe(true);
	});

	it('a snapshot with a non-boolean carryForward is rejected', () => {
		const snapshot = normalized();
		// @ts-expect-error deliberately malformed for the test
		snapshot.fields[0].carryForward = 'yes';
		expect(parsePlaybookSnapshot(snapshot).ok).toBe(false);
	});
});

// Slice 8 review, finding 4: the snapshot schema must reject everything the
// normal playbook pipeline would never produce, using the exact same rules
// as schema.ts (validators.ts) rather than a separately drifted copy.
describe('parsePlaybookSnapshot rejects what the raw playbook schema would also reject (finding 4)', () => {
	it('rejects a field key using a reserved prefix', () => {
		const snapshot = normalized();
		snapshot.fields[0].key = 'c_smuggled';
		expect(parsePlaybookSnapshot(snapshot).ok).toBe(false);
	});

	it('rejects a field key with an invalid character', () => {
		const snapshot = normalized();
		snapshot.fields[0].key = 'Not Valid!';
		expect(parsePlaybookSnapshot(snapshot).ok).toBe(false);
	});

	it('rejects a playbook id that does not look like de.category.name', () => {
		const snapshot = normalized();
		snapshot.id = 'not-a-valid-id';
		expect(parsePlaybookSnapshot(snapshot).ok).toBe(false);
	});

	it('rejects a version that is not strict semver', () => {
		const snapshot = normalized();
		snapshot.version = '1.0';
		expect(parsePlaybookSnapshot(snapshot).ok).toBe(false);
	});

	it('rejects an oversized labelI18n locale key', () => {
		const snapshot = normalized();
		snapshot.labelI18n = { 'way-too-long-a-locale-code': 'x' };
		expect(parsePlaybookSnapshot(snapshot).ok).toBe(false);
	});

	it('rejects an oversized labelI18n label value', () => {
		const snapshot = normalized();
		snapshot.labelI18n = { de: 'x'.repeat(500) };
		expect(parsePlaybookSnapshot(snapshot).ok).toBe(false);
	});

	it('accepts an empty-object offset: this is the frozen "zero offset" a normalized playbook without an explicit offset always has (see normalize.ts / dueSchema.default({}))', () => {
		const snapshot = normalized();
		snapshot.actions[0].due = { event: 'expiry', offset: {} };
		expect(parsePlaybookSnapshot(snapshot).ok).toBe(true);
	});

	it('still rejects an out-of-range offset value inside an otherwise-empty offset object', () => {
		const snapshot = normalized();
		snapshot.actions[0].due = { event: 'expiry', offset: { months: 999999999 } };
		expect(parsePlaybookSnapshot(snapshot).ok).toBe(false);
	});
});

// Slice 8 review, finding 5: a rejected snapshot's issues must be safe to
// log unconditionally — no message text, no unbounded attacker-controlled
// path segment.
describe('parsePlaybookSnapshot issues are safe to log (finding 5)', () => {
	it('carries only bounded paths, never the rejected value or a message', () => {
		const snapshot = normalized();
		// An enum mismatch is exactly the case where Zod's default message
		// embeds the received value ("...received 'MALICIOUS...'").
		// @ts-expect-error deliberately invalid type for the test
		snapshot.fields[0].type = 'MALICIOUS_SECRET_VALUE_MARKER';
		const result = parsePlaybookSnapshot(snapshot);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('unreachable');
		const serialized = JSON.stringify(result.issues);
		expect(serialized).not.toContain('MALICIOUS_SECRET_VALUE_MARKER');
		for (const issue of result.issues) {
			expect(Object.keys(issue)).toEqual(['path']);
		}
	});

	it('truncates an oversized attacker-controlled record key rather than logging it whole', () => {
		const snapshot = normalized();
		const longKey = 'x'.repeat(500);
		snapshot.labelI18n = { [longKey]: 'value' };
		const result = parsePlaybookSnapshot(snapshot);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('unreachable');
		const serialized = JSON.stringify(result.issues);
		expect(serialized).not.toContain(longKey);
	});
});
