# Document Action extraction V1

## Changes

The combined extraction prompt treats Fields, Additional Fields and Actions as
equally important. Its output example includes all three collections. It asks for
explicit instructions and obligations throughout the document, including late
sections, undated obligations and conditional obligations. Optional rights must
not become duties. Suggestions still require user selection in the existing
review flow.

There is still one provider call per extraction, with the existing 2,000-token
output limit. No PDF splitting, model change or review UI change is included.

## Diagnostics

Future successful runs emit one `ai extraction persisted` server log after the
write transaction commits. It includes the local run ID, provider Action count,
schema-valid count, mapped count, discard count by reason, persisted Action and
Field counts, output limit and input/output token usage when supplied by the
provider. Counts describe suggestions, not user-created Actions. Provider counts
and usage are null for providers that do not report them. The run row identifies
the configured provider and model.

Schema validation is all-or-nothing. A schema failure emits `schema_mismatch`,
with the raw Action array count when available, but no valid/persisted success
counts. Incomplete provider responses remain failures and emit only allow-listed
completion status and numeric usage. Partial output is never accepted.

These diagnostics do not store prompts, source contents, titles, conditions,
evidence, raw responses, credentials or filenames. They add no database columns.
The existing database keeps the aggregate `discarded_action_count` and filtered
suggestions. Detailed diagnostic counts are available only for future runs and
only while server logs are retained.

## Verification limits

The affected staging runs were not available through authorized read-only access
during this change. Their provider counts, discard counts and model IDs have not
been checked. Synthetic fixture tests verify prompt rules and downstream data
handling; they do not prove real-model recognition.

A controlled staging comparison is still required before claiming that long
document recognition is fixed. Compare the short and long synthetic documents
with the same model, Item fields, user instruction and existing Actions. Record
the new aggregate counters and completion/token usage. Check optional rights and
conditions as well as Action recall. Do not log source text or full responses.

## Separate potential improvement: unknown event anchors

The current date shape accepts an Item date field or an explicit, valid document
date as a relative anchor. It cannot preserve a named future event with no date
as a structured anchor. Such obligations stay undated; their condition and
relative deadline must remain in context (with supporting evidence). Adding
unresolved event anchors would need separate extraction, persistence and review design. This
iteration does not add anchors or invent deadline dates.
