const STRICT_SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function compareComponent(left: string, right: string): number {
	const normalizedLeft = left.replace(/^0+(?=\d)/, '');
	const normalizedRight = right.replace(/^0+(?=\d)/, '');
	if (normalizedLeft.length !== normalizedRight.length)
		return normalizedLeft.length > normalizedRight.length ? 1 : -1;
	return normalizedLeft === normalizedRight ? 0 : normalizedLeft > normalizedRight ? 1 : -1;
}

/** Returns false for malformed versions rather than making display code fail. */
export function newerVersionAvailable(
	itemVersion: string | null,
	installedVersion: string
): boolean {
	if (!itemVersion) return false;
	const item = STRICT_SEMVER.exec(itemVersion);
	const installed = STRICT_SEMVER.exec(installedVersion);
	if (!item || !installed) return false;
	for (let index = 1; index <= 3; index++) {
		const comparison = compareComponent(installed[index], item[index]);
		if (comparison !== 0) return comparison > 0;
	}
	return false;
}
