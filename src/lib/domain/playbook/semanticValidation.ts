import { findDependencyCycle } from '../action/dependencies';

/**
 * Cross-reference and graph checks that the structural Zod schema cannot
 * express: do references resolve, are keys unique within their
 * collection, is the dependency graph acyclic. Runs only after
 * parsePlaybookStructure() has already succeeded.
 */
export interface SemanticIssue {
	path: string;
	message: string;
}

/**
 * The minimal structural shape this function actually reads. Both
 * `RawPlaybook` (a freshly parsed YAML file) and `NormalizedPlaybook` (a
 * snapshot read back out of the database, see playbook/snapshot.ts)
 * satisfy this shape, so the same cross-reference/acyclicity checks run
 * for both without duplicating this logic.
 */
export interface SemanticCheckablePlaybook {
	fields: readonly { key: string; type: string }[];
	events: readonly { key: string; sourceField: string }[];
	actions: readonly {
		key: string;
		due?: { event: string } | null;
		dependsOn?: readonly string[];
	}[];
}

export function validatePlaybookSemantics(playbook: SemanticCheckablePlaybook): SemanticIssue[] {
	const issues: SemanticIssue[] = [];

	const fieldKeys = new Set<string>();
	for (const field of playbook.fields) {
		if (fieldKeys.has(field.key)) {
			issues.push({ path: `fields[key=${field.key}]`, message: 'duplicate field key' });
		}
		fieldKeys.add(field.key);
	}

	const dateFieldKeys = new Set(playbook.fields.filter((f) => f.type === 'date').map((f) => f.key));

	const eventKeys = new Set<string>();
	for (const event of playbook.events) {
		if (eventKeys.has(event.key)) {
			issues.push({ path: `events[key=${event.key}]`, message: 'duplicate event key' });
		}
		eventKeys.add(event.key);

		if (!fieldKeys.has(event.sourceField)) {
			issues.push({
				path: `events[key=${event.key}].sourceField`,
				message: `references unknown field "${event.sourceField}"`
			});
		} else if (!dateFieldKeys.has(event.sourceField)) {
			issues.push({
				path: `events[key=${event.key}].sourceField`,
				message: `field "${event.sourceField}" is not a date field`
			});
		}
	}

	const actionKeys = new Set<string>();
	for (const action of playbook.actions) {
		if (actionKeys.has(action.key)) {
			issues.push({ path: `actions[key=${action.key}]`, message: 'duplicate action key' });
		}
		actionKeys.add(action.key);
	}

	for (const action of playbook.actions) {
		if (action.due && !eventKeys.has(action.due.event)) {
			issues.push({
				path: `actions[key=${action.key}].due.event`,
				message: `references unknown event "${action.due.event}"`
			});
		}

		const dependsOn = action.dependsOn ?? [];
		const seenDeps = new Set<string>();
		for (const dep of dependsOn) {
			if (dep === action.key) {
				issues.push({
					path: `actions[key=${action.key}].dependsOn`,
					message: 'action cannot depend on itself'
				});
				continue;
			}
			if (seenDeps.has(dep)) {
				issues.push({
					path: `actions[key=${action.key}].dependsOn`,
					message: `duplicate dependency "${dep}"`
				});
				continue;
			}
			seenDeps.add(dep);
			if (!actionKeys.has(dep)) {
				issues.push({
					path: `actions[key=${action.key}].dependsOn`,
					message: `references unknown action "${dep}"`
				});
			}
		}
	}

	if (issues.length === 0) {
		const edges = new Map<string, string[]>(
			playbook.actions.map((a) => [
				a.key,
				(a.dependsOn ?? []).filter((dep) => dep !== a.key && actionKeys.has(dep))
			])
		);
		const cycle = findDependencyCycle(edges);
		if (cycle) {
			issues.push({
				path: 'actions',
				message: `dependency cycle involving: ${cycle.join(', ')}`
			});
		}
	}

	return issues;
}
