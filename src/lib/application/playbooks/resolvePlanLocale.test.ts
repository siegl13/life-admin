import { describe, expect, it } from 'vitest';
import type { MaterializationPlan } from '$lib/domain/playbook/materialize';
import { resolvePlanLocale } from './resolvePlanLocale';

describe('resolvePlanLocale', () => {
	it('resolves every field/event/action label to the current locale, keeping everything else unchanged', () => {
		const plan: MaterializationPlan = {
			fields: [
				{
					fieldKey: 'a',
					label: 'A (base)',
					labelI18n: { de: 'A (deutsch)' },
					type: 'text',
					origin: 'PLAYBOOK',
					recommended: false,
					position: 0
				}
			],
			events: [
				{
					eventKey: 'e',
					label: 'E (base)',
					labelI18n: { de: 'E (deutsch)' },
					sourceFieldKey: 'a',
					position: 0
				}
			],
			actions: [
				{
					actionKey: 'x',
					label: 'X (base)',
					labelI18n: { de: 'X (deutsch)' },
					description: null,
					due: { dueKind: 'NONE' },
					dependsOnActionKeys: [],
					position: 0
				}
			]
		};

		const resolved = resolvePlanLocale(plan);

		expect(resolved.fields[0].label).toBe('A (deutsch)');
		expect(resolved.events[0].label).toBe('E (deutsch)');
		expect(resolved.actions[0].label).toBe('X (deutsch)');
		expect(resolved.fields[0].fieldKey).toBe('a');
		expect(resolved.actions[0].due).toEqual({ dueKind: 'NONE' });
	});
});
