import { hasResolvedDue, type Action } from './action';

/**
 * Validates that a dependency graph (action key -> depends-on action keys)
 * is acyclic using Kahn's algorithm. Returns the members of a cycle if one
 * exists, so callers can report a useful error.
 *
 * Self-dependencies and dangling references are expected to already be
 * rejected by playbook semantic validation; this function only checks
 * acyclicity of whatever graph it is given.
 */
export function findDependencyCycle(
	edges: ReadonlyMap<string, readonly string[]>
): string[] | null {
	const inDegree = new Map<string, number>();
	for (const key of edges.keys()) inDegree.set(key, inDegree.get(key) ?? 0);
	for (const deps of edges.values()) {
		for (const dep of deps) {
			inDegree.set(dep, inDegree.get(dep) ?? 0);
		}
	}
	// action -> depends-on means "action" has an incoming edge from "dep"
	// in the sense that dep must complete before action. Build in-degree
	// per node counting how many dependencies each node has.
	const remainingDeps = new Map<string, Set<string>>();
	for (const [key, deps] of edges) {
		remainingDeps.set(key, new Set(deps));
	}
	for (const key of inDegree.keys()) {
		if (!remainingDeps.has(key)) remainingDeps.set(key, new Set());
	}

	const queue: string[] = [];
	for (const [key, deps] of remainingDeps) {
		if (deps.size === 0) queue.push(key);
	}

	const resolved = new Set<string>();
	while (queue.length > 0) {
		const key = queue.shift()!;
		resolved.add(key);
		for (const [otherKey, deps] of remainingDeps) {
			if (deps.has(key)) {
				deps.delete(key);
				if (deps.size === 0 && !resolved.has(otherKey) && !queue.includes(otherKey)) {
					queue.push(otherKey);
				}
			}
		}
	}

	const unresolved = [...remainingDeps.keys()].filter((key) => !resolved.has(key));
	return unresolved.length > 0 ? unresolved.sort() : null;
}

/**
 * An action is available for the user to work on when:
 * - it is still OPEN (not already DONE/SKIPPED), AND
 * - every action it depends on is DONE or SKIPPED, AND
 * - its due date is resolved (see {@link hasResolvedDue}) — an unresolved
 *   DERIVED action must never appear as available.
 */
export function isAvailable(
	action: Pick<Action, 'state' | 'dueKind' | 'dueDate'>,
	dependencyStates: readonly ActionState[]
): boolean {
	if (action.state !== 'OPEN') return false;
	if (!hasResolvedDue(action)) return false;
	return dependencyStates.every((state) => state === 'DONE' || state === 'SKIPPED');
}

type ActionState = Action['state'];
