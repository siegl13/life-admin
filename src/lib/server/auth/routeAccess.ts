const ALWAYS_PUBLIC = new Set(['/healthz', '/login', '/logout']);

export function isPublicRoute(routeId: string, ownerExists: boolean): boolean {
	if (ALWAYS_PUBLIC.has(routeId)) return true;
	return routeId === '/setup' && !ownerExists;
}
