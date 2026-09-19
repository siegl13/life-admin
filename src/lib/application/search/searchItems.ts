import { parsePlaybookSnapshot } from '$lib/domain/playbook/snapshot';
import { resolveLabel } from '$lib/i18n';
import { formatCurrencyDisplay, formatDate } from '$lib/ui/format';
import type { SearchRepositoryPort, SearchSourceRow } from '../ports';

export interface SearchResult {
	itemId: string;
	title: string;
	typeLabel: string;
	contextLabel: string | null;
	contextValue: string | null;
	moreMatches: number;
	highlight: { target: 'title' | 'type' | 'context'; start: number; end: number } | null;
}

export interface SearchPage {
	query: string;
	total: number;
	results: SearchResult[];
}

const MAX_QUERY_CODE_POINTS = 120;
const MAX_DISPLAY_CODE_POINTS = 160;

export function normalizeSearchQuery(value: string): string {
	return Array.from(normalizeSearchValue(value)).slice(0, MAX_QUERY_CODE_POINTS).join('');
}

function normalizeSearchValue(value: string): string {
	return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function bounded(
	value: string,
	matchStart: number,
	matchLength: number
): { value: string; start: number; end: number } {
	const chars = Array.from(value);
	if (chars.length <= MAX_DISPLAY_CODE_POINTS)
		return { value, start: matchStart, end: matchStart + matchLength };
	const ellipsisBudget = 2;
	const contentLength = Math.max(0, MAX_DISPLAY_CODE_POINTS - ellipsisBudget);
	let from = Math.max(0, matchStart - Math.floor((contentLength - matchLength) / 2));
	let to = Math.min(chars.length, from + contentLength);
	from = Math.max(0, to - contentLength);
	if (from === 0)
		to = Math.min(chars.length, MAX_DISPLAY_CODE_POINTS - (to < chars.length ? 1 : 0));
	if (to === chars.length)
		from = Math.max(0, chars.length - (MAX_DISPLAY_CODE_POINTS - (from > 0 ? 1 : 0)));
	const leading = from > 0;
	const trailing = to < chars.length;
	const snippet = `${leading ? '…' : ''}${chars.slice(from, to).join('')}${trailing ? '…' : ''}`;
	return {
		value: snippet,
		start: matchStart - from + (leading ? 1 : 0),
		end: matchStart - from + matchLength + (leading ? 1 : 0)
	};
}

function firstMatch(value: string, query: string): { start: number; length: number } | null {
	const original = Array.from(value);
	let normalized: string[] = [];
	let offsets: { start: number; end: number }[] = [];
	for (const [originalIndex] of original.entries()) {
		const next = Array.from(
			original
				.slice(0, originalIndex + 1)
				.join('')
				.normalize('NFKC')
				.toLowerCase()
				.replace(/\s+/gu, ' ')
		);
		let shared = 0;
		while (
			shared < normalized.length &&
			shared < next.length &&
			normalized[shared] === next[shared]
		) {
			shared++;
		}
		const replaced = offsets.splice(shared);
		const replacementStart = replaced[0]?.start ?? originalIndex;
		if (next.length === normalized.length && shared === next.length && offsets.length > 0)
			offsets[offsets.length - 1].end = originalIndex + 1;
		else {
			for (let index = shared; index < next.length; index++)
				offsets.push({ start: replacementStart, end: originalIndex + 1 });
		}
		normalized = next;
	}
	const normalizedValue = normalized.join('');
	const leadingWhitespace = normalizedValue.length - normalizedValue.trimStart().length;
	const trailingWhitespace = normalizedValue.length - normalizedValue.trimEnd().length;
	normalized = normalized.slice(
		leadingWhitespace,
		trailingWhitespace ? -trailingWhitespace : undefined
	);
	offsets = offsets.slice(leadingWhitespace, trailingWhitespace ? -trailingWhitespace : undefined);
	const needle = Array.from(query);
	for (let index = 0; index <= normalized.length - needle.length; index++) {
		if (needle.every((character, offset) => normalized[index + offset] === character)) {
			const start = offsets[index].start;
			const end = offsets[index + needle.length - 1].end;
			return { start, length: end - start };
		}
	}
	return null;
}

function typeLabel(row: SearchSourceRow): string {
	if (!row.playbookSnapshot) return 'Ohne Vorlage';
	try {
		const parsed = parsePlaybookSnapshot(JSON.parse(row.playbookSnapshot));
		return parsed.ok
			? resolveLabel(parsed.playbook.name, parsed.playbook.labelI18n)
			: (row.playbookName ?? 'Ohne Vorlage');
	} catch {
		return row.playbookName ?? 'Ohne Vorlage';
	}
}

function displayedFieldValue(row: SearchSourceRow): string {
	if (row.fieldType === 'date') return formatDate(row.value!);
	if (row.fieldType === 'currency') return formatCurrencyDisplay(row.value!);
	return row.value!;
}

export function searchItems(ports: { search: SearchRepositoryPort }, rawQuery: string): SearchPage {
	const query = normalizeSearchQuery(rawQuery);
	if (Array.from(query).length < 2) return { query, total: 0, results: [] };

	const results: SearchResult[] = [];
	const rows = ports.search.listActiveSources(query, 20);
	for (const row of rows) {
		const sources: {
			target: 'title' | 'type' | 'context';
			label: string | null;
			value: string;
			searchable: boolean;
		}[] =
			row.sourceKind === 'TITLE'
				? [{ target: 'title', label: null, value: row.title, searchable: true }]
				: row.sourceKind === 'TYPE'
					? [{ target: 'type', label: null, value: typeLabel(row), searchable: true }]
					: row.sourceKind === 'FIELD' && row.value !== null
						? [
								{
									target: 'context',
									label: row.fieldLabel,
									value: row.value,
									searchable: true
								}
							]
						: row.actionLabel !== null
							? [
									{
										target: 'context',
										label: 'Aufgabe',
										value: row.actionLabel,
										searchable: true
									}
								]
							: [];
		for (const source of sources) {
			if (!source.searchable) continue;
			const displayValue =
				source.target === 'context' && row.sourceKind === 'FIELD'
					? displayedFieldValue(row)
					: source.value;
			if (!firstMatch(source.value, query) && !firstMatch(displayValue, query)) continue;
			const displayMatch = firstMatch(displayValue, query);
			const shown = displayMatch
				? bounded(displayValue, displayMatch.start, displayMatch.length)
				: bounded(displayValue, 0, 0);
			results.push({
				itemId: row.itemId,
				title: source.target === 'title' ? shown.value : bounded(row.title, 0, 0).value,
				typeLabel: source.target === 'type' ? shown.value : bounded(typeLabel(row), 0, 0).value,
				contextLabel:
					source.target === 'context' && source.label ? bounded(source.label, 0, 0).value : null,
				contextValue: source.target === 'context' ? shown.value : null,
				moreMatches: row.moreMatches,
				highlight:
					displayMatch || source.target !== 'context'
						? { target: source.target, start: shown.start, end: shown.end }
						: null
			});
		}
	}
	return {
		query,
		total: rows[0]?.total ?? 0,
		results
	};
}
