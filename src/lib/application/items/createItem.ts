import { emptyMaterializationPlan, materializePlaybook } from '../../domain/playbook/materialize';
import type { Item } from '../../domain/item/item';
import { resolveLabel } from '../../i18n';
import { resolvePlanLocale } from '../playbooks/resolvePlanLocale';
import type { CreateItemInput, ItemRepositoryPort, PlaybookCatalogPort } from '../ports';

/**
 * Resolves every field/event/action label to the current UI locale
 * before handing the plan to the repository. Locale resolution is
 * deliberately done here (application layer), not in domain/materialize
 * (which has no notion of "current locale") nor in the repository
 * (which should only know how to persist, not how to pick a language).
 * The resolved label is what gets frozen onto the item, consistent with
 * the rest of the item being frozen at creation time (docs/adr/0004).
 */

export class TitleRequiredError extends Error {
	constructor() {
		super('Title is required');
		this.name = 'TitleRequiredError';
	}
}

export class UnknownPlaybookError extends Error {
	constructor(playbookId: string) {
		super(`Unknown playbook: ${playbookId}`);
		this.name = 'UnknownPlaybookError';
	}
}

export interface CreateItemUseCaseInput {
	title: string;
	note?: string | null;
	/** null (or omitted) creates a generic item with no playbook. */
	playbookId?: string | null;
}

/**
 * Creates an item. Only the title is required — everything else
 * (playbook selection, note) is optional, matching the progressive data
 * entry rule. When a playbookId is given, the playbook is materialized
 * into concrete fields/events/actions and frozen onto the item
 * (see docs/adr/0004); an unknown playbook id is a hard error since the
 * caller (the "new item" form) always offers a valid, current list.
 */
export function prepareCreateItemInput(
	ports: { playbooks: PlaybookCatalogPort },
	input: CreateItemUseCaseInput
): CreateItemInput {
	const title = input.title.trim();
	if (!title) throw new TitleRequiredError();

	if (!input.playbookId) {
		return {
			title,
			note: input.note ?? null,
			playbook: null,
			materialization: emptyMaterializationPlan()
		};
	}

	const playbook = ports.playbooks.findById(input.playbookId);
	if (!playbook) throw new UnknownPlaybookError(input.playbookId);

	return {
		title,
		note: input.note ?? null,
		playbook: {
			id: playbook.id,
			version: playbook.version,
			// Resolved to the current locale, same as every field/event/action
			// label (see resolveLocaleForPlan above) — otherwise the item
			// detail page's "Created from playbook: ..." provenance line
			// would show the English base name even in the German UI.
			name: resolveLabel(playbook.name, playbook.labelI18n),
			snapshot: playbook
		},
		materialization: resolvePlanLocale(materializePlaybook(playbook))
	};
}

export function createItem(
	ports: { items: ItemRepositoryPort; playbooks: PlaybookCatalogPort },
	input: CreateItemUseCaseInput
): Item {
	return ports.items.createItem(prepareCreateItemInput(ports, input));
}
