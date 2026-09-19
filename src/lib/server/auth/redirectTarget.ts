export function safeRedirectTarget(raw: string | null | undefined): string {
	if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
	if (
		[...raw].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
	) {
		return '/';
	}
	return raw;
}
