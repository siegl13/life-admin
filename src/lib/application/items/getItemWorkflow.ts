import { isAvailable } from '../../domain/action/dependencies';
import { hasResolvedDue, type Action, type ActionState } from '../../domain/action/action';
import type {
	ActionRepositoryPort,
	CycleRepositoryPort,
	EventRepositoryPort,
	FieldRepositoryPort
} from '../ports';

/**
 * Why an OPEN, unavailable action is not showable yet. Built generically
 * from the materialized field/event/action labels already on the item —
 * never from a playbook id or key — so no playbook-specific wording lives
 * here. `fieldLabel` names the still-empty date field a DERIVED action's
 * event is sourced from (e.g. "Vertragsende"), not the event's own label
 * (e.g. "Vertrag endet"), which reads more like an instruction to the user.
 */
export type BlockedReason =
	{ kind: 'unresolvedDate'; fieldLabel: string } | { kind: 'dependency'; blockingLabels: string[] };

export interface WorkflowAction {
	action: Action;
	/** True once every dependency is DONE/SKIPPED and (for DERIVED actions) the due date is resolved. */
	available: boolean;
	/** Set only while OPEN and not available — explains which of the two blocking causes applies. */
	blockedReason: BlockedReason | null;
}

/**
 * Loads an item's actions for its detail page, together with whether
 * each is currently available. This is what lets the UI show a blocked
 * step as understandable ("not yet available") rather than either
 * hiding it or wrongly offering a Done/Skip button for it.
 */
export function getItemWorkflow(
	ports: {
		cycles: CycleRepositoryPort;
		actions: ActionRepositoryPort;
		events: EventRepositoryPort;
		fields: FieldRepositoryPort;
	},
	itemId: string
): WorkflowAction[] | null {
	const cycle = ports.cycles.getActiveCycle(itemId);
	if (!cycle) return null;

	const actions = ports.actions.listActions(cycle.id);
	const dependencies = ports.actions.listDependencies(cycle.id);
	const events = ports.events.listEvents(cycle.id);
	const fields = ports.fields.listFields(cycle.id);
	const eventByKey = new Map(events.map((e) => [e.eventKey, e]));
	const fieldByKey = new Map(fields.map((f) => [f.fieldKey, f]));
	const actionById = new Map(actions.map((a) => [a.id, a]));
	const stateById = new Map<string, ActionState>(actions.map((a) => [a.id, a.state]));

	return actions.map((action) => {
		const dependencyStates = dependencies
			.filter((d) => d.actionId === action.id)
			.map((d) => stateById.get(d.dependsOnActionId))
			.filter((s): s is ActionState => s !== undefined);

		const available = isAvailable(action, dependencyStates);
		let blockedReason: BlockedReason | null = null;

		if (!available && action.state === 'OPEN') {
			if (!hasResolvedDue(action)) {
				const event = action.dueKind === 'DERIVED' ? eventByKey.get(action.dueEventKey) : undefined;
				const field = event ? fieldByKey.get(event.sourceFieldKey) : undefined;
				blockedReason = {
					kind: 'unresolvedDate',
					fieldLabel: field?.label ?? event?.label ?? action.label
				};
			} else {
				const blockingLabels = dependencies
					.filter((d) => d.actionId === action.id)
					.map((d) => actionById.get(d.dependsOnActionId))
					.filter((dep): dep is Action => dep !== undefined && dep.state === 'OPEN')
					.map((dep) => dep.label);
				if (blockingLabels.length > 0) blockedReason = { kind: 'dependency', blockingLabels };
			}
		}

		return { action, available, blockedReason };
	});
}
