import path from 'node:path';
import type { loadPlaybookCatalog } from './catalog';

export function catalogErrorsForPage(errors: ReturnType<typeof loadPlaybookCatalog>['errors']) {
	return errors.map((error) => ({
		source: error.source,
		filePath: path.basename(error.filePath),
		reason: error.reason.replaceAll(error.filePath, '<path>')
	}));
}
