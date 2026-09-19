import type { MaterializationPlan } from '$lib/domain/playbook/materialize';
import { resolveLabel } from '$lib/i18n';
export function resolvePlanLocale(plan: MaterializationPlan): MaterializationPlan {
	return {
		fields: plan.fields.map((f) => ({ ...f, label: resolveLabel(f.label, f.labelI18n) })),
		events: plan.events.map((e) => ({ ...e, label: resolveLabel(e.label, e.labelI18n) })),
		actions: plan.actions.map((a) => ({ ...a, label: resolveLabel(a.label, a.labelI18n) }))
	};
}
