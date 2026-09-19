import type { Action } from '../action/action';
export function isCycleComplete(actions: readonly Pick<Action, 'state'>[]): boolean {
	return actions.length > 0 && actions.every((action) => action.state !== 'OPEN');
}
