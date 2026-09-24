# Implementation status

Engineering status log for the phased implementation roadmap. Updated after
each slice's verification loop.

**Current roadmap state:** Slices 1-17 are complete. Slice 18 - Snooze / Remind
Me Later is not started. Its direct dependency, Slice 10 Notifications, is
complete.
Slice 18 - Snooze / Remind Me Later is not started. Its direct dependency,
Slice 10 Notifications, is complete.

## Slice 17 - Upcoming Overview

**Status: COMPLETE.**

- Added the read-only authenticated `/upcoming` route with fixed `Diese Woche`,
  `Nächste 30 Tage`, and `Später` disclosures, action counts, Item navigation,
  available/blocked labels, German and English strings, and responsive rows.
- Added the pure `buildUpcoming` projection and synchronous `loadUpcoming` use
  case. It reuses `effectiveDueDate`, resolved-date rules, `isAvailable`, the
  existing active Item/active cycle/open Action loader, and the existing Clock.
  No migration or new persistence boundary was added.
- Added boundary, override, resolution, availability, ordering, count, and
  duplicate-prevention unit coverage, plus authenticated/unauthenticated and
  375px browser coverage.
- Focused checks passed: `npx vitest run
src/lib/domain/upcoming/upcoming.test.ts
src/lib/application/upcoming/loadUpcoming.test.ts` (6 tests), the extended
  repository check with `src/lib/server/db/repositories/whatsNextRepository.test.ts`
  (13 tests total), `npm run check`, `npm run lint`, `npm run build`, and
  `npx playwright test tests/e2e/upcoming.spec.ts --project=chromium` (2 tests).
- Supervisor E2E verification found an ambiguous global `Jetzt möglich` locator in
  `tests/e2e/upcoming.spec.ts`; the assertion now scopes the state check to the
  created Upcoming row. A focused run immediately before the correction passed
  with 2 tests; formatter and ESLint checks pass after the correction.
- Supervisor verification attempt 05 passed `npm run verify` (898 Vitest tests)
  and `npm run test:e2e` (91 browser tests). The shared-database count assertion
  now scopes action coverage to the created Item and compares each range count
  with its rendered rows. The final independent review found no remaining
  findings.
- Production browser check passed against the built application on port 4174:
  setup/login, all ranges and counts, long labels, 375px layout, German and
  English rendering, and anonymous redirect. The disposable data directory
  was removed afterward.
- Docker check passed with clean project, image, and port preflight. The
  amd64 and arm64 images built, Compose became healthy, `/healthz` returned
  successfully, and all run-owned containers, volumes, networks, and images
  were removed afterward.

## Slice 16 - Human-readable History

**Status: COMPLETE.**

- Added migration `0016_item_history_events.sql` with an allowlisted event type
  check, OWNER/SYSTEM actor kind, immutable JSON payload, and an item/time index.
- Added typed `ItemHistoryEvent` domain types with strict payload schemas per
  event type. Payloads contain only internal ids and allowlisted enum values,
  never user-entered labels, note contents, document contents, provider output,
  or secrets. A `FIELD_CHANGED` event's field label is never stored; it is
  resolved at read time in `loadItemHistory` against the item's current fields
  and falls back to generic wording when the field no longer exists.
- Added `ItemHistoryRepositoryPort` with insert, paginated list, count, and
  delete operations. The SQLite adapter stores events in reverse chronological
  order.
- Added `recordHistoryEvent`, `loadItemHistory`, and `countItemHistory`
  application use cases. Recording validates the event type against the
  allowlist and serializes the payload safely.
- Wired history recording into every successful mutation boundary in the Item
  detail route: field changes, attachment add/remove, action complete/skip/add,
  action due override set/clear, cycle start, archive/unarchive, relation
  link/unlink, custom field add/remove, and applied AI suggestions (known-field
  accept and additional-field add). `updateFields` snapshots each targeted
  field's value before the write and only records `FIELD_CHANGED` for a field
  whose value actually changed, so resubmitting a form unchanged records
  nothing. The AI-suggestions route records an event right after each of its
  two independent sub-operations commits (not once at the end), so a later
  failure can never leave an already-committed mutation without its event.
  `CYCLE_STARTED` uses `actorKind: 'OWNER'` (its only caller is the user-clicked
  "start next cycle" action, never an automatic rollover).
- Added the `ItemHistory` component with newest-first events grouped by today,
  yesterday, this month, last month, this year, or older year. Desktop shows the
  last 10 events; mobile shows the last 5 (detected via `matchMedia`). A "Show
  older" button widens the visible window and, once that exceeds what the
  server already fetched, re-navigates with a wider `historyCount` query param
  so `+page.server.ts` fetches the rest. Cycle history is retained inside an
  expandable disclosure below the event timeline.
- Added German and English i18n strings for all history event types
  (including a named `FIELD_CHANGED` variant once a label resolves), date group
  labels, and empty states.
- Focused unit tests cover the repository (insert, list, count, delete,
  pagination), the application use cases (recording, loading, payload parsing,
  event type validation, field-label resolution), the `updateFields` and AI
  suggestions route actions' history recording, and `resolveHistoryLimit`'s
  pagination clamping. E2E tests cover the cycle-rollover history disclosure
  behavior and the mobile-viewport/"Show older" pagination flow.
- Independent review round-01 found 4 HIGH gaps (no-diff field-change spam,
  missing AI-acceptance wiring, broken pagination, missing mobile count); all
  four were corrected and covered by new tests. Round-02 found 2 more HIGH
  issues (missing field-label resolution; a durably-committed AI-acceptance
  sub-operation could end up with no event on a later partial failure) plus the
  `CYCLE_STARTED` actor-kind mislabel; all three are corrected here.
- Round-03 found that `FIELD_CHANGED` stored the per-cycle row id (`field.id`)
  instead of the cycle-stable `fieldKey`, so every field-change event reverted
  to generic wording after a cycle rollover. The payload now stores `fieldKey`;
  `loadItemHistory` resolves labels by `fieldKey` against the current cycle's
  fields, so historical events from any past cycle resolve as long as a field
  with that key still exists. Removed the dead `CycleHistory.svelte` component
  (its markup is now inline in `ItemHistory.svelte`). Removed an orphaned
  doc-comment in `+page.server.ts`. `CYCLE_COMPLETED` remains defined in the
  domain enum, DB allowlist, i18n, and render branch but is not recorded by any
  caller; it is an intentional placeholder for a future cycle-completion event
  and not beyond-scope surface area. Added a mobile-viewport/"Show older" e2e
  in `tests/e2e/cycle-rollover.spec.ts` covering desktop (10) vs. mobile (5)
  initial counts and the "Ältere anzeigen" expansion.
- Final automated verification passed with `npm run verify` (107 unit-test files,
  863 tests) and `npm run test:e2e` (82 browser tests).
- Production browser acceptance passed on 2026-09-18 against a fresh build with
  disposable `.data-manual` data. The cycle rollover history flow passed at
  desktop and mobile widths, including the desktop 10-event, mobile 5-event,
  and "Ältere anzeigen" behavior. The production server and disposable data
  were removed afterward.
- Docker verification passed on 2026-09-18. Clean preflight passed, both
  `linux/amd64` and `linux/arm64` images built, the dedicated Compose project
  started, and `/healthz` returned `{"status":"ok"}`. The container, network,
  volume, and run-created image tags were removed afterward.

## Slice 15 - Related Items + Item Overview

**Status: COMPLETE.**

- Supervisor verification attempt 01 stopped at Prettier checks for the
  lifecycle-limited Slice 15 design handoff bundle. The bundle is a read-only
  specification and includes generated reference files, so
  `.prettierignore` now preserves it verbatim, matching the existing Slice 14
  handoff policy. Focused `npx prettier --check .` passed after the correction.
- Added migration `0015_item_relations.sql` with canonical ordered Item ids, a
  self-link check, unique primary pair, foreign keys, and endpoint indexes.
  Relation writes use direct SQLite transactions and reject malformed, missing,
  self, duplicate, and archived-source mutations. Existing links remain readable
  in both directions, including links to archived Items. The repository exposes
  explicit relation cleanup for a future Item deletion transaction without adding
  Item deletion UI.
- Added the Item relation port, SQLite adapter, application use cases, bounded
  active-Item candidate search, and compact overview projection. Non-empty search
  returns at most 20 active Items in title then Item-id order; empty search returns
  at most five recently updated active Items. The overview reuses the existing
  next Action and displays at most three non-empty frozen Playbook fields, document
  and relation counts, without changing the Playbook schema.
- Added server-rendered relation management on Item detail with ordinary GET search
  state and POST link/unlink actions. Normal rows navigate to the related Item;
  archived Item pages stay read-only. The Item page adds the overview below
  What's Next and Related Items between Documents and Fields. German and English
  strings, token-only responsive styles, a five-row disclosure, and no-JavaScript
  relation flows are included.
- Backup restore now runs `foreign_key_check` and explicitly validates relation
  endpoints and pair shape before committing staged data. Focused tests cover canonical
  pairs, constraints, duplicate/self/missing/archived rejection, list/unlink/cleanup behavior,
  overview selection, restore validation, normal and archived UI, disclosure,
  no-JavaScript forms, mobile overflow, and anonymous access.
- Focused checks run through the Slice 15 supervisor wrapper: targeted Prettier
  write passed; focused Vitest relation, migration, and restore tests passed;
  `npm run check` passed; `npm run build` passed; and `npx playwright test
tests/e2e/related-items.spec.ts --project=chromium` passed with 5 browser tests
  plus the authenticated setup project. A first expanded E2E attempt found only
  selector assertions against collapsed disclosure DOM and duplicate visible title
  text; the assertions were corrected and the final focused E2E run passed.
- Supervisor verification attempt 02 stopped at one typed-route lint violation
  for the empty relation-state link. The link now resolves the current Item
  route with its Item id. Focused ESLint, Prettier, and Svelte checks passed
  after the correction.
- Supervisor verification attempt 03 passed lint and Svelte checks, then
  stopped before playbook validation because `tsx` could not bind its IPC socket
  under the supervisor's long temporary-path name (`EINVAL`). The equivalent
  focused `node --import tsx scripts/validate-playbooks.ts` check passed; no
  Slice 15 source finding was reported.
- Supervisor verification attempt 04 passed `npm run verify` with 103 unit-test
  files and 824 tests, and `npm run test:e2e` with 76 browser tests. Independent
  review found follow-up implementation coverage and overview styling gaps.

- Supervisor verification attempt 05 passed `npm run verify` with 103 unit-test
  files and 825 tests, and `npm run test:e2e` with 77 browser tests. The
  correction added overview styling, empty-projection and next-Action coverage,
  backup/restore relation round-trip coverage, and focused relation-route coverage.
  At that point, manual browser and Docker verification had not yet run.
- Supervisor verification attempt 06 passed `npm run verify` with 103 unit-test
  files and 825 tests, and `npm run test:e2e` with 77 browser tests. Manual
  browser and Docker verification had not yet run.
- Supervisor verification attempt 07 passed `npm run verify` with 104 unit-test
  files and 829 tests, and `npm run test:e2e` with 76 browser tests. Manual
  browser, Docker, and independent review gates had not yet run.
- Supervisor verification attempt 08 found horizontal overflow in the existing
  attachment mobile-boundary test at 640px. The shared attachment and topbar
  mobile rules include 640px, restoring the compact header and document-row
  layout at that boundary. The focused attachment E2E check passed after the
  correction.
- Supervisor verification attempt 09 passed `npm run verify` with 104 unit-test
  files and 833 tests, and `npm run test:e2e` with 79 browser tests. Manual
  browser, Docker, and independent review gates had not yet run.
- Supervisor verification attempt 10 passed `npm run verify` with 104 unit-test
  files and 833 tests, and `npm run test:e2e` with 79 browser tests. Manual
  browser, Docker, and independent review gates had not yet run.
- Supervisor verification attempt 11 corrected the Slice 15-specific mobile
  breakpoint to stop at 639px, so the related-items rows and controls retain
  their 640px desktop layout. It passed `npm run verify` with 104 unit-test
  files and 833 tests, and `npm run test:e2e` with 79 browser tests. Manual
  browser, Docker, and independent review gates had not yet run.
- Supervisor verification attempt 12 passed `npm run verify` with 104 unit-test
  files and 833 tests, and `npm run test:e2e` with 79 browser tests. At that
  time, subsequent independent gate reviews found additional implementation
  issues, so manual browser, Docker, and final review gates were pending.
- Supervisor verification attempt 13 passed `npm run verify` and `npm run
 test:e2e`. The completed production-browser, restart-persistence, Docker, and
  independent Product, Architecture, and Security gates are recorded in
  `docs/reviews/slice-15-review-gates.md`.
- Supervisor verification attempt 14 passed `npm run verify`, but `npm run
test:e2e` stopped during adapter-node's final cleanup of the shared `build/`
  directory with `ENOTEMPTY`, before Playwright started. The focused `npm run
build` rerun passed, so no Slice 15 source or test defect was reproduced.
- Supervisor verification attempt 15 passed `npm run verify` and `npm run
test:e2e`.
- Supervisor verification attempt 16 passed `npm run verify` and `npm run
test:e2e`.
- Supervisor verification attempt 17 passed `npm run verify` and `npm run
test:e2e`.
- The required historical `npm run verify` result after each of the five ordered
  implementation steps was not captured. Focused checks and repeated full-suite
  attempts exist, but the missing sequence is recorded as a process deviation
  rather than reconstructed or claimed retroactively.

## Slice 14 - Better Document Experience

**Status: COMPLETE.**

- Supervisor verification attempt 05 passed `npm run verify` with 99 test files
  and 809 tests, and `npm run test:e2e` with 69 tests. The complete logs are in
  `.agent/supervisor/life-admin-slice-14-better-document-experience/slice-14-better-document-experience/verification/attempt-05-command-01.log`
  and `attempt-05-command-02.log`. Architecture and automated security review
  gates also passed.
- The production-browser matrix passed on 2026-09-15 against the production build
  with JavaScript disabled. It covered OWNER setup, PDF and PNG upload, display-name
  normalization, over-limit refusal and retry, viewer and download headers, exact
  bytes, deletion, archived read-only behavior, anonymous non-disclosure, header
  variant 3a, and widths 375, 390, and 640 px without horizontal overflow. A real
  backup, restore, process restart, login, display-name check, and exact-byte download
  passed. The extraction form reached its review page with JavaScript disabled in a
  separate safe fake-provider run of the production build; no external request was
  made. Run-owned processes, data, and temporary backup bytes were removed.
- Docker verification passed on 2026-09-15 after a clean dedicated-resource, image,
  and port preflight. Both `linux/amd64` and `linux/arm64` builds passed. The isolated
  `life-admin-slice-14-better-document-experience` Compose project started healthy,
  and the bounded health check returned `{"status":"ok"}`. Its container, network,
  volume, and all three run-created image tags were removed; final absence checks
  passed. Product, Architecture, and Security gates pass.

- Review round 01 found that the aggregate rename route silently ignored
  duplicate, missing, and foreign display-name fields, and that valid image
  preview behavior lacked end-to-end coverage. The route now parses every
  submitted ID and display-name field before validation, and focused tests
  cover malformed forms plus authenticated inline PNG preview bytes and
  headers. Attempt 04 passed the automated verification gates, and the later manual
  browser and Docker matrices passed.

- Supervisor verification attempt 02 stopped at eight Svelte lint violations
  in the new document components and viewer. The navigation links now resolve
  their typed routes directly, including the download query parameter, and
  literal separator mustaches are plain text. Focused `npm run lint` and
  `npm run check` passed after the correction (`focused-checks/check-48.log`
  and `focused-checks/check-49.log`); the supervisor still owns complete
  verification.
- Supervisor verification attempt 01 stopped at Prettier formatting in the
  lifecycle-limited Slice 14 design handoff. Attempt 04 later passed full
  automated verification, and all five protected handoff files were restored
  to their pre-unit hashes.
- Implementation now includes nullable Attachment display names, exact Unicode
  normalization and fallback behavior, guarded singular renames, aggregate
  manage-form validation, direction 1b document rows, the authenticated viewer,
  the sole `/content` byte route, explicit download behavior, narrow inline PDF
  headers, viewer-only extraction, and header variant 3a.
- Focused checks covered normalization, application orchestration including
  deterministic partial failure and retry, SQLite persistence, content-header
  decisions, viewer CSP handling, and Svelte/TypeScript checks. One intermediate
  Svelte check failed and was corrected. The separate operational browser and Docker
  matrices passed before final review.
- Ordered focused evidence from this implementation handoff:
  `npx vitest run src/lib/domain/attachment/attachment.test.ts
src/lib/server/db/repositories/attachmentRepository.test.ts` passed
  (step 1, `focused-checks/check-37.log`); `npx vitest run
src/lib/application/attachments/attachments.test.ts
src/lib/server/http/attachmentRenameForm.test.ts` passed (step 2,
  `focused-checks/check-38.log`); `npx playwright test
tests/e2e/attachments.spec.ts --project=chromium` passed (step 3,
  `focused-checks/check-39.log`); `npx vitest run
src/lib/server/http/attachmentContentHeaders.test.ts src/hooks.server.test.ts
src/lib/server/backup/restore.test.ts` passed (step 4,
  `focused-checks/check-40.log`); and `npm run check` passed (step 5,
  `focused-checks/check-41.log`). All artifacts are under
  `.agent/supervisor/life-admin-slice-14-better-document-experience/slice-14-better-document-experience/focused-checks/`.
- ADR 0009 is the current Attachment route authority. ADR 0006's old Attachment
  path is a historical example superseded by Slice 14.
- Historical note: Slice 15 - Related Items + Item Overview was the next pending
  unit when this Slice 14 entry was recorded. Its direct dependencies, Slices 7
  and 8, were complete.

## Slice 13 - Global Search

**Status: COMPLETE.**

- Post-completion Nachtrag corrections (2026-09-15): the header search
  affordance is now a `⌕ Suchen` link to `/suche` (desktop: icon + visible
  label, bordered in `--color-accent-quiet`, not filled; mobile: 44x44
  icon-only with an `aria-label`), replacing the earlier header input field,
  which only submitted on Enter and so read as a live-search promise it could
  not keep. The removed input's own 820px breakpoint switching and header `q`
  parameter are gone with it. Fixed two accessible-name violations: the
  header link's name no longer renders as visible wrapped text, and the
  `/suche` reset control now shows only `×`, with its name carried by
  `aria-label` instead of visible button text. Tightened the result row's
  internal spacing (2px between the title/type/context lines, an added 3px
  before the context line, 1.45 line-height on the context line, 15px/18px
  row padding). `npm run verify` (97 test files, 781 unit tests) and
  `npm run test:e2e` (65 tests) both pass after these changes. This was a
  UI-only correction; the separate manual production-browser and Docker
  acceptance matrices recorded below were not rerun for it.
- Post-correction supervisor verification repeatedly passed `npm run verify`
  (97 test files, 781 unit tests) and `npm run test:e2e` (65 tests). Attempts
  19 through 23 measured the warmed 1,000-Item query between 24.87 ms and
  106.43 ms, below the approved 250 ms local threshold. Each plan used indexed
  Item, cycle, field, and Action access and contained no Cartesian product.
  Review rounds 08 through 10 had metadata-only findings caused by each retry
  creating a newer passing attempt after the preceding attempt number was
  recorded; they found no implementation or test regression.
- Supervisor verification attempt 20 passed `npm run verify` (97 test files,
  781 unit tests) and `npm run test:e2e` (65 tests). The warmed 1,000-Item
  query completed in 106.43 ms, below the approved 250 ms local threshold.
  Its plan used indexed Item, cycle, field, and Action access and contained no
  Cartesian product.
- The required production-browser acceptance matrix passed on 2026-09-14
  against `node build` with a disposable data directory and bounded health
  check on port 4174. It covered OWNER setup and anonymous non-disclosure,
  JavaScript-disabled native GET Search, every allowed source and scalar
  representation, literal `%`, `_`, and backslash input, query bounds, Unicode
  case and whitespace normalization, no-result, deduplication, cap and ordering
  behavior, excluded and archived data, navigation and focus behavior, live
  loading and stale responses, safe truncated highlighting, desktop Search,
  and the 375 x 667 mobile layout without horizontal overflow. The temporary
  browser harness and data directory were removed afterward.
- Docker verification passed on 2026-09-14 after all dedicated-project,
  image-tag, and port preflights returned empty. The `linux/amd64` and
  `linux/arm64` images built successfully. `docker compose -p
life-admin-slice-13-global-search up -d --build` started a healthy service,
  and the bounded `/healthz` request returned only `{"status":"ok"}`. The
  dedicated Compose project, volume, network, and three exact images created by
  the run were removed; post-cleanup checks returned empty.

- Supervisor verification attempt 19 passed `npm run verify` (97 test files,
  781 unit tests) and `npm run test:e2e` (65 tests). The warmed 1,000-Item
  bound SQLite search completed in 24.87 ms. `EXPLAIN QUERY PLAN` used
  `ix_items_status_created` and `ix_cycles_item_status` for every source,
  `ix_cycle_fields_cycle_position` for field values, and
  `ix_actions_cycle_state` for Action values. The plan has no Cartesian
  product; its remaining scans and temporary B-trees are for the unioned source
  rows, ranking, and deterministic ordering. At that point, manual
  production/browser and Docker verification had not yet been recorded, so
  Slice 13 remained incomplete.

- Supervisor verification attempt 18 passed `npm run verify` (781 unit tests),
  but both delayed stale-response browser scenarios timed out before the
  intercepted request started. Each scenario initially loaded `q=alpha`, then
  entered a value that normalizes to the same URL. SvelteKit correctly made no
  redundant navigation, so the test waited for a request that cannot exist.
  The fixtures now initially load a distinct query that still shows the
  retained result, then issue the delayed `alpha` request. Supervisor
  verification is pending.

- Supervisor verification attempt 15 passed `npm run verify` (781 unit tests),
  but `npm run test:e2e` had one fixture-collision failure. The two
  stale-response browser scenarios created identically titled persisted Items,
  so the second scenario's initial result locator matched both. Its fixtures
  now use distinct titles. Supervisor verification is pending.

- Supervisor verification attempt 16 passed `npm run verify` (781 unit tests),
  but `npm run test:e2e` had one stale-response fixture failure. The second
  scenario loaded `/suche?q=alter`, although its expected initial Item title
  contains `Alpha` rather than `alter`. Attempt 17 confirmed the fixture still
  used the incorrect query and timed out in the earlier delayed-request
  scenario. The initial query now matches the fixture, and the interceptor
  covers both query-only route and data requests.
  Supervisor verification is pending.

- Supervisor verification attempt 13 passed `npm run verify` (781 unit tests)
  and `npm run test:e2e` (64 tests). Review found that a delayed response can
  still arrive during the next input's debounce period because the expected
  query was updated only when the next request started. The expected normalized
  query now updates for every input event, and browser coverage releases the
  old response before the new debounce expires. Supervisor verification must
  record the warmed 1,000-Item query duration and full relevant
  `EXPLAIN QUERY PLAN` paths before Slice 13 can be marked complete.

- Supervisor verification attempt 14 passed `npm run verify` (781 unit tests)
  and `npm run test:e2e` (64 tests). The following correction retains the
  pre-debounce stale-response case and adds the post-newer-response case. The
  1,000-Item fixture now emits its warmed query duration and complete relevant
  `EXPLAIN QUERY PLAN` output for the next supervisor verification log. At that
  point, the observed sub-250-ms duration, manual production/browser matrix,
  and Docker matrix had not yet been recorded.

- Supervisor verification attempt 09 passed `npm run verify` (779 unit
  tests), but the no-JavaScript GET browser test failed because `/suche` SSR
  initialized its local query state as empty. The result data was loaded, but
  the server-rendered result branch was not selected until client hydration.
  The state now initializes from `data.query`, so a completed GET search
  renders its results without JavaScript. Supervisor verification is pending.

- Supervisor verification attempt 10 passed `npm run verify` (779 unit tests)
  and `npm run test:e2e` (62 tests). It reported two non-blocking Svelte state
  initialization warnings in the search page. The current correction removes
  the stale live-search display path and extends boundary coverage; it requires
  a new supervisor verification run before this slice can be marked complete.

- Supervisor verification attempt 11 passed `npm run verify` (781 unit tests)
  after automatic formatting, but the delayed live-search browser test timed
  out before its request interceptor observed the request. The client now uses
  the same normalized query in the URL as the server, the test waits for that
  canonical lowercase request, and the state initializers no longer produce
  Svelte capture warnings. Supervisor verification is pending.

- Supervisor verification attempt 12 passed `npm run verify` (781 unit tests),
  but two live-search browser checks failed. During an input event the request
  was derived from reactive state, which can still hold the prior value. The
  handler now normalizes the event value directly. The browser test also now
  expects the documented canonical lowercase query in the shareable URL.
  Supervisor verification is pending.

- Supervisor verification attempt 08 found an unsupported Playwright matcher
  in the mobile overflow assertion and an `autofocus` accessibility warning.
  The assertion now evaluates the body through the supported Locator API, and
  focus remains managed by the existing `onMount` handler without native
  `autofocus`. Supervisor verification is pending.

- Added the authenticated `/suche` GET page and desktop/mobile search affordances.
- Added a read-only SQLite-backed projection over active Items, active cycles,
  field values, frozen Playbook labels, and Action labels. Archived Items,
  completed-cycle data, notes, documents, AI data, and Inbox rows are excluded.
- The correction changes Search to a bound, parameterized SQLite query. It
  returns only the deterministic primary source for each matching Item, with
  the exact total and additional-match count computed in SQLite. Matching uses
  deterministic Unicode normalization and literal `instr` semantics.
- Added focused coverage for normalized whitespace and combining-sequence
  highlights, localized and canonical date/currency values, literal wildcard
  characters, archived and completed data exclusion, Action values, and field
  label exclusion. The 1,000-Item fixture warms and measures the real bound
  SQLite query and inspects cycle, field, and Action join plans.
- Browser coverage includes GET submission without JavaScript, delayed live
  search retention and stale-response rejection both before the next request
  starts and after the newer result arrives, result navigation, the capped
  result notice, one-character live input retention, reset and Escape behavior,
  mobile affordance, and a 375px no-horizontal-overflow check. Attempt 19
  recorded the observed query time. The manual production/browser and Docker
  matrices were recorded in the completed acceptance runs above.
- Numeric content is searchable in text identifiers and in canonical and
  localized currency values. The current model has no standalone `number`
  field type. The approved design also forbids changing the Item data model,
  so Slice 13 does not introduce one.
- Supervisor verification attempts 01-02 found only lint violations. Attempt
  03 found that the client passed an interpolated query-string route to typed
  `goto`, plus three Svelte warnings. The correction uses `resolve()` for both
  destinations, reacts to page-data query changes, and uses native
  `autofocus`. Attempt 05 passed `npm run verify`, but
  `npm run test:e2e` found horizontal overflow at 390px in the Inbox states:
  the new global-search control made the shared mobile top bar too wide. The
  mobile top bar now uses compact gaps and button padding without removing any
  controls. Verification remains pending.

## Slice 11 - Playbook Ecosystem

**Status: COMPLETE.**

- Added Settings installation, replacement, and removal for validated custom
  playbooks, plus canonical-path ownership checks and the 100-candidate limit.
- Added installed metadata, a read-only newer-version notice, single-file
  validation mode, authoring documentation, and ADR 0013.
- Added focused domain, application, filesystem, route-load, and E2E coverage.
- Supervisor verification attempt 08 passed on 2026-09-13: `npm run verify`
  passed with 736 Vitest tests and `npm run test:e2e` passed with 49 Playwright
  tests. Independent review round 04 found no code findings.
- The Playbook install-flow browser matrix passed against the production build
  with JavaScript disabled on 2026-09-13. It covered pasted and uploaded YAML,
  ambiguous and invalid input refusal without a write, immediate availability,
  bundled-id refusal, confirmation before replacement, replacement, removal,
  and the read-only newer-version notice.
- Docker verification passed on 2026-09-13 after an empty dedicated-project,
  image-tag, and port preflight. Builds for `linux/amd64` and `linux/arm64`,
  `docker compose -p life-admin-slice-11 up -d --build`, and the bounded
  `/healthz` check all passed. The dedicated Compose resources and run-created
  images were removed afterward.

## Slice 10 - Notifications

**Status: COMPLETE.**

- Added the Slice 10 implementation, migration `0010_notifications.sql`, and
  ADR `0012-in-process-notification-scheduler.md`.
- Recorded supervisor verification (attempt 17, 2026-09-13): `npm run verify`
  passed with 711 tests in 84 Vitest files; `npm run test:e2e` passed with 42
  Playwright tests.
- The required 10-scenario production browser matrix passed on 2026-09-13 with
  JavaScript disabled. It covered fresh defaults, German validation, ntfy and
  Slack persistence and secret removal, selected-channel completeness, minimal
  content, the plain test-send form, login, and server redirects. The disposable
  `.data-manual` directory and production process were removed afterward. No
  real ntfy or Slack request was made.
- Docker verification passed on 2026-09-13. A read-only inspection identified
  the original conflict as an unused Slice 9 image, and the operator authorized
  removing that stale tag. A fresh final run then passed the complete required
  preflight before creating anything. Both required platform builds passed, the
  unmodified `docker compose -p life-admin-slice-10 up -d --build` command
  started the current image, and `/healthz` returned `{"status":"ok"}`. All
  Slice 10 containers, network, volume, and image tags were removed afterward.

## Continuation note

**An independent review of Slices 5-7 found 11 correctness/security findings
after this doc previously marked them COMPLETE (2026-09-08).** The prior
"complete" verdicts were real for what they tested, but did not test:
pre-Slice-7 backup compatibility, backup/restore size symmetry, login
concurrency, full-replacement restore semantics for empty directories,
reconciliation path containment, RESTORE_PENDING page CSP, concurrent-backup
temp-file collisions, unbuffered large uploads, a real attachment restore
round trip, and several Slice 5 concurrency/session tests. All 11 findings
are now fixed and independently re-verified (2026-09-08, second pass) — see
each slice's own "Review findings (2026-09-08)" subsection below. **Slices 5,
6 and 7 are COMPLETE.** This continuation point is historical; Slices 8-12
are also complete.

**Final re-verification (2026-09-08, second pass, after all 11 findings):**
`npm run verify` — PASS (lint, svelte-check, playbook validation, **371
tests in 45 Vitest files**, build). `npm run test:e2e` — PASS (**23
tests**). A fresh manual production smoke run against a disposable
`.data-smoke` directory: owner setup, login, a 5-failure lockout, logout
invalidating the exact prior session token (replayed after logout, not
just a cleared cookie), password change invalidating a second browser's
session while keeping the current one, an authenticated backup download,
two genuinely concurrent backup requests producing distinct valid archives
with different content hashes, a backup containing a nested custom
playbook and a real attachment, an anonymous backup attempt returning zero
bytes, an invalid-archive restore leaving the install untouched, a valid
restore of a backup containing a real attachment, `RESTORE_PENDING`
reflected by `/healthz` and by the static page's security headers/CSP on
every other route, an explicit process restart returning the app to normal
with the restored item and a byte-exact attachment download, and both an
SVG-disguised-as-PNG and an oversized attachment rejected. Three scenarios
(the backup size-refusal cap, pre-Slice-7 archive compatibility, and a
tampered `storage_key` escaping staging) require fabricated internal state
impractical to reproduce by hand over HTTP and are proven by their
dedicated unit tests instead (`createBackup.test.ts`, `restore.test.ts`,
`attachmentReconciliation.test.ts`).

## Slice 5 - Security

**Status: COMPLETE**

- Added `0002_auth.sql`, single-Owner setup, scrypt password hashing, database
  sessions, lockout, login/logout/password change and environment recovery.
- Added the deny-by-default route-id hook, safe redirects, CSP, security
  headers, reduced anonymous health response, and Playwright setup storage.
- Approved deviation: `Referrer-Policy` is `same-origin`, not `no-referrer`.
  Chromium otherwise sends `Origin: null` for plain form POSTs and SvelteKit
  rejects them. `checkOrigin` remains enabled. Regression tests cover a valid
  setup POST, rejected cross-origin POST, and the exact response header.
- Verification: `npm run verify` passed with 222 tests in 27 Vitest files.
  `npm run test:e2e` passed with 17 tests, including all prior tests unchanged.
  A production `.data-manual` browser run covered first setup, authenticated
  Settings, the exact header and logout. Product, architecture and security
  gates passed after the referrer-policy finding was resolved.

### Review findings (2026-09-08)

An independent review found two gaps in this slice, both now fixed:

- **Finding 3 (login concurrency / parallel scrypt, HIGH).** Parallel failed
  attempts for the same username could race around the persisted lockout,
  and unknown usernames could trigger unbounded expensive dummy-scrypt
  verification. Fixed with three small, composed pieces: per-normalized-username
  serialization of the login decision (`application/auth/loginLock.ts`,
  a `Map<string, Promise<void>>` mutex with auto-cleanup); atomic failure
  persistence via a `BEGIN IMMEDIATE` transaction in
  `authRepository.recordFailedLogin` (read-current-count and write happen
  in one transaction, never a separate read-then-overwrite); and a small,
  deliberately bounded process-wide resource guard
  (`server/auth/hashGuard.ts`: at most 2 concurrent scrypt operations, at
  most 10 per rolling minute, fixed constants, no Redis, no
  `X-Forwarded-For` parsing) wrapped around `passwordHasherPort.verify` in
  `appPorts.ts`, so a guard-exhausted attempt degrades to a plain "false"
  (indistinguishable from a wrong password) rather than a distinguishable
  error. Anti-enumeration behavior (dummy-hash verification for unknown
  usernames) is preserved. Tests: `application/auth/login.test.ts` (7
  cases, pure fake ports, no `$lib/server/*` import per the ESLint
  boundary), `server/auth/hashGuard.test.ts` (4 cases), `server/auth/loginResourceGuard.test.ts`
  (real `login()` + real hasher + real guard, 25 parallel unknown-username
  attempts).
- **Finding 10 (Slice 5 test gaps, MEDIUM).** Several roadmap scenarios had
  no dedicated regression test: logout invalidating the exact prior session
  token (`application/auth/logout.test.ts`, new), password change
  invalidating every other session while issuing exactly one fresh
  current-browser session (`application/auth/changePassword.test.ts`, new),
  `LIFEADMIN_RESET_OWNER_PASSWORD` clearing lockout/failed-login state,
  invalidating sessions, and never logging the plaintext secret
  (`hooks.server.test.ts`, new `init()` describe block), and a successful
  login against an old scrypt parameter encoding transparently rehashing
  to the current encoding without ever storing plaintext
  (`application/auth/login.test.ts`, new describe block). Parallel-attempt,
  unknown-username and locked-account-zero-hasher-calls scenarios were
  already covered by Finding 3's tests and were not duplicated.

## Slice 6 - Backup / Restore

**Status: COMPLETE**

### What was implemented (across this slice's full history)

- Versioned ZIP backup (`fflate`, exact-pinned) with a JSON manifest (`domain/backup/manifest.ts`): typed
  `contents` list, per-entry byte length and SHA-256, format version,
  applied migration list, app version.
- `createBackup()`: `VACUUM INTO` for a WAL-consistent snapshot,
  `sanitizeSnapshot` (deletes `sessions`, resets lockout fields, strips every
  `app_settings` key matching `secret.%`), recursive loader-conformant custom
  playbook discovery via the real `scanPlaybookDirectory`, attachment bytes
  read only through `resolveStoragePath` (never a raw path join), a
  `NotEnoughDiskSpaceError` free-space check before staging anything.
- `stageRestore()`/`commitRestore()`: hardened `extractArchive` (directory
  entries, undeclared entries, real decompressed-byte counting against an
  injectable limits object rather than the ZIP header's declared size,
  entry/size caps, a second independent path-containment check
  `resolveEntryDestination` shared by the reader and the checksum pass),
  `checkCompatibility` against `listKnownMigrations()`, a SQLite
  `integrity_check`, a `pre-restore-<UTC>.zip` safety backup (pruned to the
  newest three) written before any rename, a WAL checkpoint on the
  still-open connection before closing, and a compensating rollback across
  all three swaps (database, playbooks, attachments) if any one of them
  fails partway through.
- `RESTORE_PENDING`: latched before the first rename and never cleared at
  runtime, on success or failure. `getDb()` itself throws
  `DatabaseClosedForRestoreError` once latched. `hooks.server.ts` blocks
  every database-backed route with a static, security-headers-carrying 503
  page except `/healthz`, which reports `{"status":"restore-pending"}`
  without touching the database at all (no auth/owner lookup runs for that
  route while pending).
- User-facing restore errors: `domain/backup/restoreError.ts` groups the
  internal failure codes into seven categories with a genuinely distinct
  recovery action (not a raw code shown per internal error), each with its
  own German/English message in `/settings`; a failed backup download
  (e.g. a referenced attachment inconsistent with the database) gets its own
  safe message too, never a raw exception.
- Anonymous `GET /settings/backup`: redirects to `/login` (303, matching
  every other authenticated page) rather than a bare 403, decided explicitly
  and recorded in `docs/roadmap-v1.md` as an approved deviation; the route's
  own handler still throws 403 as a second, independent layer. No backup
  bytes or `Content-Disposition` header are ever returned to an
  unauthenticated caller.

### Test coverage checklist (vs. roadmap section 5's named scenarios)

Security boundaries, rollback, restore-pending/no-reopen, archive/path
containment, hostile-ZIP handling, decompression limits, manifest
validation, SQLite snapshot consistency (integrity_check + real committed
data), session/secret sanitization, a real backup→restore→restart round
trip (item, custom playbook, Owner password all verified to persist), safe
error rendering, and anonymous backup access are all covered by named tests.
One roadmap scenario is deliberately not literally testable: `fflate`'s
streaming `Unzip` reader exposes no Unix external file attributes at all
(checked against its type definitions), so "reject an entry flagged as a
symlink" cannot be tested via that attribute — the actual defense is the
path-containment check and fixed per-kind destination mapping, which do not
depend on an entry's declared type and are tested directly. Per-pattern
duplicates of the "undeclared/unsafe entry name" test (absolute, drive
-letter, backslash, NUL variants) were deliberately not added: they all
route through the identical `!entry` rejection in `extractArchive`, already
proven generically. Test counts across `manifest`/`archive`/`createBackup`/
`restore.test.ts` do not match the roadmap's suggested ~14-each by design,
per explicit instruction to prioritize confidence over a specific count.

### Verification actually run on 2026-09-08

- `npm run verify`: lint, svelte-check, playbook validation, **276 tests in
  34 Vitest files**, build — PASS.
- `npm run test:e2e`: **19 Playwright tests** — PASS, all pre-existing specs
  unchanged plus two new ones (anonymous backup redirect, the specific
  NOT_A_BACKUP message wording).
- Manual production run against `node build/index.js` with a disposable
  `LIFEADMIN_DATA_DIR`: authenticated backup download (ZIP magic bytes,
  correct `Content-Disposition`/`Content-Type` headers); anonymous
  `GET /settings/backup` returns 303 to `/login` with zero response bytes
  and no `Content-Disposition`; a garbage-file restore leaves the running
  installation untouched (item still listed, exact new error wording shown);
  a valid restore swaps in the backed-up state; the restart-required static
  page appears with 503 and full security headers for `/settings` and
  `/items`; `/healthz` reports `{"status":"restore-pending"}` with 503; no
  route reopens the database before a restart. A second run proved the full
  loop end to end: created an item, downloaded a backup, restored it,
  **killed and restarted the process**, logged in again with the original
  password, and confirmed the item was still present and `/healthz` was
  back to `{"status":"ok"}`.

### Gates

**Product** — "Can I lose the machine and reliably recover Life Admin?" Yes:
one click gives a standard ZIP any tool can read; a restore on the same or a
fresh install brings back items, custom playbooks and the Owner's password,
proven by an actual backup→restore→process-restart→login round trip, not
just file-level assertions.

**Architecture** — "Can future data types enter the backup without
redesigning the format?" Yes: the manifest's typed `contents` list is
unchanged in shape; pure decisions stay in `domain/backup/manifest.ts` and
`domain/backup/restoreError.ts`; everything touching fs or SQLite stays in
`server/backup/**`; two new runtime dependencies, both exact-pinned and
small (`fflate` 0.8.3 for the archive format, `busboy` 1.6.0 for streaming
the restore upload — see Finding 8 below).

**Security** — "Can backup/restore avoid path traversal, partial restore
and accidental data loss?" Yes: two independent containment checks on every
archive path (regex plus resolve/prefix) and on attachment reads during
backup; real decompressed bytes are counted, never the archive's declared
size; a compensating rollback covers all three swaps, not just the
database; `getDb()` is provably locked immediately once a restore is
attempted, including on the one route (`/healthz`) that stays reachable;
anonymous access returns no data by any path; every user-facing error is a
fixed, safe, categorized message, never a raw exception, path, or SQLite
error string.

**Correction found after this slice was first marked complete:**
`BODY_SIZE_LIMIT` was left at `12M` (set for the 10 MB attachment cap) while
`stageRestore` accepts archives up to `MAX_ARCHIVE_BYTES` (256 MiB) — any
restore upload over 12 MB would have been rejected by adapter-node at the
transport layer before Slice 6's own archive-size check ever ran. Fixed by
raising `BODY_SIZE_LIMIT` to `280M` in `Dockerfile`, `compose.yaml` and
`playwright.config.ts`, and adding an explicit `file.size` pre-check in the
`restore` action (layer 2 of three: transport cap, this check, then
`extractArchive`'s own stat of the written file) so an oversized upload gets
the same `TOO_LARGE` category message instead of a bare adapter 413. Found
while starting Slice 7 and re-reading the original handoff's Slice 6 item 4
side note about this exact conflict — it was not re-checked before the
"complete" verdict above, which is why gates should be re-read literally
rather than trusted from memory.

### Review findings (2026-09-08)

An independent review found several gaps in this slice, all now fixed
(shared findings 1/2/8/9 are written up once here and referenced from
Slice 7 below, since the underlying code and tests are shared):

- **Finding 1 (pre-Slice-7 backups must still restore, HIGH).**
  `attachmentReconciliation` used to assume the `attachments` table always
  exists. It now inspects the staged SQLite schema directly
  (`hasAttachmentsTable`, a `sqlite_master` query — never a migration
  filename assumption) and handles three cases: no table and no files is a
  valid older backup (empty report, forward migrations create the table on
  restart); no table but the archive nonetheless contains attachment
  entries is rejected as `ATTACHMENTS_WITHOUT_TABLE` (no real backup this
  app produced can be in that state); table present is the normal path.
  `stageRestore` also now unconditionally creates empty `playbooks/` and
  `attachments/` staging directories after extraction, which is what
  actually makes an old, attachment-free backup restorable at all (see
  Finding 4). Tests: `restore.test.ts`'s "pre-Slice-7 backup compatibility"
  describe block (a real database with the `0003_attachments` migration
  reverted, restored, then reopened after a simulated restart to confirm
  the table exists and is empty) and `attachmentReconciliation.test.ts`'s
  matching cases.
- **Finding 2 (backup must never create an unrestorable backup, HIGH).**
  `createBackup` now shares the reader's own limits
  (`MAX_ARCHIVE_BYTES`/`MAX_ENTRIES`/`MAX_TOTAL_BYTES` from `archive.ts`,
  one source, never a second copied set of numbers) and checks planned
  uncompressed size (manifest + snapshot + playbooks + attachment bytes)
  and entry count _before_ writing anything, throwing `BackupTooLargeError`
  early; the finished in-memory archive is also checked against the
  compressed-size cap before ever touching disk. Tests: `createBackup.test.ts`'s
  "size symmetry with the restore-side limits" describe block (planned
  size over cap, attachment bytes counted, entry-count cap, compressed cap,
  and a round trip proving the reader accepts what the writer produces).
- **Finding 6 (RESTORE_PENDING page CSP, MEDIUM).** The static
  restart-required response bypassed the normal response path and had no
  CSP. Fixed by adding a restrictive
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'`
  (the page needs no script/style of its own) alongside the existing
  headers in `hooks.server.ts`. Test: `hooks.server.test.ts`'s existing
  restore-pending describe block now asserts the exact header value.
- **Finding 7 (concurrent backups need unique temp files, MEDIUM).** Two
  backups requested within the same second used the same temp path.
  Timestamps stay in the user-facing filename (load-bearing for
  `pruneSafetyBackups`' lexicographic "keep newest three"), but a random
  6-hex-character suffix is now appended after the timestamp
  (`createBackup.ts`'s `uniqueSuffix()`, `randomBytes(3)`), guaranteeing
  uniqueness while preserving sort order. Test: `createBackup.test.ts`'s
  "concurrent requests use unique files" describe block (two backups under
  a frozen clock, distinct filenames, both files intact, removing one
  doesn't remove the other).
- **Findings 5, 8, 9** are attachment-specific and written up under
  Slice 7 below, since that is where the underlying code lives.

No other known Slice 6 correctness, security, or user-facing gap remains.

## Slice 7 - Attachments

**Status: COMPLETE**

### What was fixed/added in this pass (upload/list/download/delete already existed)

- **Storage containment**: `resolveStoragePath` (regex + resolve/prefix,
  already in place) is now the _only_ way backup reads attachment bytes too
  (fixed during Slice 6); nothing in the codebase joins `storage_key` onto
  the attachments root directly any more.
- **Manifest path tightening**: the Slice 6 archive's attachment path
  pattern now reuses `isValidStorageKey` directly (exact UUID v4 + matching
  fan-out) instead of a looser, separately maintained regex.
- **Unlink failure handling**: `attachmentStorage.remove()` is now best
  effort by contract (documented on `AttachmentStoragePort`) — it logs a
  warning with the storage key (never a path) and swallows a real
  filesystem error, because the row deletion that already succeeded is the
  source of truth for the user. `cleanStalePartFiles()` runs once on every
  startup via `hooks.server.ts`'s `init()`.
- **Specific validation outcomes**: `addAttachment`'s `ITEM_NOT_FOUND`
  reason now produces a real 404 instead of a generic form-fail message
  (only reachable via a stale/crafted request, since `load` already 404s
  for a missing item); the other rejection reasons (empty, too large, over
  the per-item limit, disallowed type) each get their own message instead
  of one generic string.
- **i18n**: every attachment-related string (section heading, upload
  form, empty state, remove button, the four MIME-type badges, all five
  rejection messages) moved into `de.ts`/`en.ts` — previously 100%
  hardcoded German with zero catalog entries.
- **Referrer-Policy**: removed the download route's own `'no-referrer'`
  header, which was already dead code — `hooks.server.ts` unconditionally
  overwrites it to `same-origin` after every `resolve()` call regardless of
  what a route sets, so the old value was actively misleading to read, not
  a live inconsistency.
- **Restore reconciliation** (new): `reconcileStagedAttachments` compares
  the staged database's `attachments` rows against the staged files
  (missing, mismatched-checksum, orphaned) and the `restore` action logs
  the counts — never fails the restore, which is the deliberate asymmetry
  with backup's `AttachmentBackupError` (we control what we write, so
  backup fails loudly; we do not control what we are handed to restore, so
  restore reports).
- **ADRs**: new `docs/adr/0009-attachment-storage.md` (storage key format,
  file-then-row/row-then-unlink ordering, no orphan sweep, the
  backup-fails/restore-reports asymmetry); `docs/adr/0006` amended with a
  "serving files" clarification covering both the Slice 6 backup download
  and this slice's attachment download endpoint.
- **Found while starting this slice, fixed as part of it (not originally
  in the Slice 7 list)**: `BODY_SIZE_LIMIT=12M` (sized for the 10 MB
  attachment cap) would have rejected any Slice 6 restore upload over
  12 MB — see the Slice 6 entry above for the fix.

### Test coverage added (previously zero dedicated tests existed)

Domain (`attachment.test.ts`, 11 cases): filename sanitization, all four
magic-byte signatures plus an SVG payload correctly rejected regardless of
its extension, storage-key format validation, byte-size formatting.
Application (`attachments.test.ts`, 12 cases, `vi.fn()` ports): every
rejection reason checked before storage is ever touched, `store` called
before `insert`, the stored file removed when `insert` throws, download
scoped to the requesting item, delete-row-before-unlink call order.
Repository (`attachmentRepository.test.ts`, 10 cases, real SQLite): insert
round-trip, same filename allowed twice, item-delete cascades, cycle-delete
sets `cycle_id` to `NULL`, duplicate `storage_key` rejected. Storage
adapter (`attachmentStorage.test.ts`, 7 cases, real fs): containment proven
directly (a malicious key never writes outside the root), `remove()`
swallowing a real fs error while logging it, stale `.part` cleanup.
Reconciliation (`attachmentReconciliation.test.ts`, 6 cases): missing,
mismatched, orphaned and all-clean scenarios, plus the no-staged-database
edge case. Five new `database.test.ts` constraint cases (blank filename,
zero byte size, disallowed mime type, short sha256, cross-item duplicate
storage key). **E2E** (`attachments.spec.ts`, new, 4 tests against the
production build): upload-list-download with header assertions and
byte-exact content, an SVG renamed to `.png` rejected and never listed, two
same-named documents both persisted.

### Verification actually run on 2026-09-08

`npm run verify`: 328 tests in 39 Vitest files, PASS. `npm run test:e2e`:
22 tests, PASS (18 pre-existing plus 4 new attachment specs). Manual
production run against `node build/index.js` with a disposable
`LIFEADMIN_DATA_DIR` (using a real browser `Accept: text/html` header, so
responses are genuine 303s rather than SvelteKit's JSON-envelope response
for non-browser-shaped requests): create an item, upload a PDF, confirm
the authenticated download returns byte-identical content with the correct
`Content-Disposition`/`Content-Type`/`nosniff`/`Referrer-Policy` headers;
an anonymous download attempt redirects to `/login` with zero response
bytes; a crafted attachment-id path-traversal attempt (`..%2f..%2f...`)
returns 404, not a file; an SVG uploaded as `evil.png` is rejected with the
specific German message and never persisted.

### Gates

**Product** — "When I need to perform an Action, are the relevant documents
immediately available from the Item?" Yes: the section sits directly under
the workflow, upload and download both work with JavaScript disabled, and
no route anywhere lists documents outside the context of one Item.

**Architecture** — "Is document storage simple enough for self-hosting and
usable later by AI/OCR?" Yes: bytes on the filesystem under the existing
`/data` volume, metadata in SQLite, `readBytes`/`getById` already exist with
no schema change needed for a future consumer; all attachment ports stay
synchronous, matching every other port in the app.

**Security** — "Can an uploaded file never escape its allowed storage
boundary or execute as application code?" Yes: filenames never reach the
filesystem (paths are built only from a server-generated UUID through the
single `resolveStoragePath` choke point, now proven directly by a
containment test); execution is blocked three independent ways (magic-byte
detection defeats an SVG renamed to any extension, `Content-Disposition:
attachment`, `nosniff` plus a `sandbox` CSP); a crafted attachment id
returns 404, never a file; nothing sensitive (filenames, bytes, resolved
paths) is ever logged, proven by the storage adapter's own test for the
one path that used to risk it (a failed unlink).

### Review findings (2026-09-08)

An independent review found three gaps specific to attachments (Findings 1,
2, 6 and 7 are shared with Slice 6 and written up there):

- **Finding 5 (validate `storage_key` during reconciliation, MEDIUM).**
  `attachmentReconciliation` used `storage_key` from the restored, untrusted
  database directly. It now reuses the exact same containment logic the
  normal attachment storage/download path uses
  (`resolveWithinAttachmentsRoot`, moved to a new server-only
  `server/files/attachmentPath.ts` so `node:path` never leaks into
  `domain/attachment/attachment.ts`, which is shared with client Svelte
  components), given the staging attachment root explicitly. A row whose
  `storage_key` fails `isValidStorageKey` (traversal, absolute path,
  backslash, malformed UUID) is pushed to a new `invalidStorageKeys` list
  instead of ever being used to read a file. Test:
  `attachmentReconciliation.test.ts`'s "untrusted storage_key" describe
  block (a traversal and an absolute-path key, proving no file outside
  staging is ever read).
- **Finding 8 (large uploads must not use `request.formData()`, MEDIUM).**
  Both the restore-archive upload and the attachment upload buffered the
  entire request body before any size check could help. Both now stream
  through a new, deliberately non-generic parser
  (`server/http/parseSingleFileForm.ts`, backed by exact-pinned `busboy`
  1.6.0 after checking Node 24/adapter-node compatibility): one file part
  straight to a temp file, a tiny bounded number of text fields kept in
  memory, explicit file-size/field-size/part-count limits enforced during
  parsing. A genuine race was found and fixed while adding this: cleaning
  up a rejected upload's temp file immediately raced
  `fs.createWriteStream`'s own async `open()`, occasionally leaving an
  orphaned empty file; cleanup now waits for the stream's own `close`
  event first. A second real bug was found via the attachments e2e suite
  (not just unit tests): busboy's internal `parts` counter increments once
  per boundary match _including the closing terminator_, so a tight
  `maxFields + 1` bound rejected the last, entirely legitimate part of a
  request with no fields to spare — this silently broke both the
  attachment upload (0 fields) and would have broken the restore upload (1
  field) the first time either was exercised end-to-end; fixed to
  `maxFields + 2` with a regression test pinning the exact real-world
  configuration. Tests: `parseSingleFileForm.test.ts` (9 cases, real
  `FormData`/`File`/`Request`), plus a new e2e case
  (`attachments.spec.ts`, oversized upload rejected without ever appearing
  on the item).
- **Finding 9 (real attachment restore round trip, MEDIUM).** The existing
  restore round-trip test never exercised a real attachment. A new test
  (`restore.test.ts`, "real attachment restore round trip") creates an
  attachment through the actual production `addAttachment()` path, backs
  it up, removes it and adds an unrelated one live, restores, simulates
  the required restart (a fresh module generation, since `getDb()` stays
  latched for the rest of the process by design), and confirms the row,
  storage key, exact bytes, SHA-256, and the normal
  `getAttachmentForDownload()` lookup all resolve correctly — and that the
  post-backup unrelated attachment does not survive.

No known Slice 7 correctness, security, or user-facing gap remains.

## Slice 8 - Cycles / Archive

**Status: COMPLETE**

### What was implemented

- **Domain:** `isCycleComplete` (a cycle needs at least one action, all
  `DONE`/`SKIPPED`), `planNextCycleFields` (two-layer carry-forward: an
  explicit optional `carryForward` on a playbook field wins, otherwise a
  type-driven fallback — text carries, date resets), and
  `domain/playbook/snapshot.ts` (`parsePlaybookSnapshot`, the same
  `.strict()` Zod shape plus the existing `validatePlaybookSemantics`,
  now widened to a minimal structural type both `RawPlaybook` and
  `NormalizedPlaybook` satisfy — one type edit, zero logic change).
- **Migration** `0004_cycles_archive.sql` (pre-existing): `cycles.playbook_version`,
  `cycles.completed_at`, `items.archived_at`, a backfill of
  `playbook_version` from the parent item, and `ix_items_status_created`.
  No table-level CHECK ties `(cycles.status, completed_at)` — SQLite
  cannot add one without rebuilding the table — the invariant is enforced
  by the repository transaction instead (documented in the migration
  file and in the new ADR).
- **Repository:** `cycleRepository.startNextCycle` (the first write
  method on cycles) completes the old cycle before inserting the new one
  inside one transaction, guarded by the partial unique index
  `ux_cycles_single_active`; a concurrent/duplicate submit throws
  `CycleNoLongerActiveError` instead of creating a third cycle. Two real
  bugs were found and fixed while wiring this up: `createItem` never set
  cycle 1's `playbook_version` (silently leaving it `NULL` for every
  brand-new item, not just pre-existing ones), and `startNextCycle`
  never called `touchItem`, so a rollover never updated the item's
  `updated_at`. The four near-identical field/event/action/dependency
  insert loops in `createItem` and `startNextCycle` were extracted into
  one shared `insertCycleContents` (`db/repositories/cycleContents.ts`),
  so both paths write through the identical statements.
- **Application:** new `startNextCycle` (validates item/cycle/completion/
  snapshot state, has no dependency on `PlaybookCatalogPort` at all —
  "never reads the current YAML" is a compile-time fact here, not a
  promise), `getCycleHistory` (completed cycles newest first, with their
  fields and actions), `setItemArchived` (archiving never touches the
  active cycle — item status governs visibility, cycle status governs
  which pass is current, two different questions).
- **UI:** `CycleCompletionPanel.svelte` ("Abschluss", offered only once
  the active cycle is complete), `CycleHistory.svelte` (read-only by
  construction — no form, no button, anywhere inside), `ArchiveItemForm.svelte`.
  `/items/[id]` gained three actions (`startNextCycle`, `archiveItem`,
  `unarchiveItem`) and every existing mutating action gained an
  archived-item guard at the server (the UI hides the forms, but the
  server does not rely on that). `/items` reads `?archived=1` and shows
  an "Archiv anzeigen"/"Zur Liste" toggle; `+layout.svelte` is untouched,
  since the archive is a filter on `/items`, not a fourth nav destination.
- **ADRs:** new `docs/adr/0010-cycles-and-rollover.md`; `docs/adr/0004`
  amended (the snapshot **is** read now, but only to build a new cycle
  the user explicitly asked for, validated as untrusted input — an
  existing cycle is still never re-materialized and the YAML on disk is
  still never consulted, so the invariant the ADR actually protects
  still holds). Stale docblocks on `domain/cycle/cycle.ts` and
  `cycleRepository.getActiveCycle` updated to match.

### Test coverage added

Domain: `completion.test.ts` (4 cases), `rollover.test.ts` (11 cases,
covering both the fallback and the explicit-override layers plus custom
field recreation/dedup/position), `snapshot.test.ts` (10 cases, including
the three backward-compatibility cases that are the whole reason
`carryForward` is optional), plus one `schema.test.ts` and one
`semanticValidation.test.ts` addition (both directions of the widened
type). Application (fake ports): `startNextCycle.test.ts` (10 cases —
refuses on every invalid state, never calls the write port on failure,
passes the frozen version and the completing cycle id explicitly,
resolves labels like `createItem` does, structurally has no `playbooks`
port), `setItemArchived.test.ts` (3 cases), `getCycleHistory.test.ts` (2
cases), `resolvePlanLocale.test.ts` (1 case). Integration (real SQLite):
`cycleRepository.test.ts` (new, 6 cases: never two ACTIVE cycles, three
consecutive rollovers yield sequences 1-2-3, a second call against an
already-completed cycle throws and creates nothing new, a failed insert
rolls back with `completed_at` still `NULL`, a carried date resolves a
concrete due date immediately with no extra save, the rollover touches
the item). `itemRepository.test.ts` additions (4 cases, including the
cycle-1 `playbook_version` regression and the widened `listItems`/
`setItemStatus` behavior). `whatsNextRepository.test.ts` additions (2
cases: an archived item's open action never appears, and after a
rollover only the new ACTIVE cycle's actions do).
`actionRepository.test.ts` addition (history is immutable — a completed
action cannot be transitioned again). **E2E:** `cycle-rollover.spec.ts`
(3 tests: finishing every step offers both choices and never rolls over
by itself; starting a new cycle carries the text value, clears the date,
and shows the finished cycle under "Verlauf"; a finished cycle's history
disclosure has zero buttons inside) and `archive.spec.ts` (2 tests: an
archived item disappears from `/items` but stays viewable, read-only,
with a banner; it is listed under "Archiv anzeigen" and can be
reactivated exactly). A cross-slice regression named by the roadmap's
own Slice 8 "Migration impact" section was also added to Slice 6's own
`restore.test.ts`: an archive from a database with three cycles restores
to three cycles, exactly one ACTIVE, with `ux_cycles_single_active`
still enforced afterward (restore is a whole-file copy, not a logical
replay, so this was already structurally safe — the test pins it down
rather than fixing a defect).

One roadmap-suggested test was deliberately not added: an isolated
`database.test.ts` case for "cycles.playbook_version is backfilled from
the parent item" in isolation. The migration's one-time backfill SQL
cannot be re-triggered against an already-migrated database without
selectively running migrations (not supported — migrations are inlined
at build time and always applied together), and the actual bug this
guards against (new cycles not getting `playbook_version` at all) is
covered directly by `itemRepository.test.ts`'s new regression case.

### Verification actually run on 2026-09-08

`npm run verify`: 428 tests in 53 Vitest files, PASS. `npm run test:e2e`:
28 tests, PASS (22 pre-existing plus 6 new Slice 8 specs, all unchanged
otherwise). A manual production smoke run was not repeated separately
for this slice; the e2e suite already exercises the full flow against
the production build.

### Gates

**Product** — "Can I manage the same administrative subject for years
without losing its history?" Yes: one Item holds every pass, each
finished pass keeps its own fields/values/actions unchanged and readable
under "Verlauf", rolling over is explicit so nothing is overwritten by
surprise, and the two choices (new cycle / archive) cover both a
recurring subject and one that ends for good — proven end-to-end by
`cycle-rollover.spec.ts` and `archive.spec.ts`.

**Architecture** — "Does Cycle behavior still come from generic
Item/Playbook concepts?" Yes: `isCycleComplete` reads only `state`,
`planNextCycleFields` reads only `type`/`key`/`origin`/`carryForward`,
neither has any notion of TÜV, NV or electricity. No parallel
materializer exists: the use case calls the existing
`materializePlaybook`, the now-shared `resolvePlanLocale`, the existing
`deriveSchedule` and the existing `validatePlaybookSemantics`. No new
runtime dependency (Zod already covers snapshot validation).

**Security** — "Can lifecycle transitions avoid inconsistent or
duplicate active cycles?" Yes: the partial unique index plus the
mandatory UPDATE-before-INSERT ordering inside one transaction means an
item can never have two ACTIVE cycles or none; the completion rule and
the archived-item guard are both enforced server-side, not only hidden
in the UI; history cannot be rewritten (structurally, plus
`assertValidTransition`); the snapshot is validated as untrusted input
before any row is written.

The roadmap's own "safe to defer" items (an attachment line per cycle in
history, a `playbook_version` label in the history heading, bulk
archive, a cycle-level note, sorting/filtering history) were left out
deliberately, matching the roadmap's explicit scope cut.

### Independent review (2026-09-09): 6 findings fixed, all closed

A second independent review of Slice 8 found six correctness/security
gaps the first pass had not tested, plus a UX inconsistency in the
account/settings forms. All were fixed and re-verified in the same pass:

1. **HIGH — action mutations were not item/cycle-bound.**
   `actionRepository.setActionState` took only an `actionId`; an action
   belonging to another item, an archived item, or a completed cycle
   could still be mutated if its id was known. Fixed at the write
   boundary: the port now also takes `itemId`, and the repository issues
   ONE guarded `UPDATE ... WHERE id=? AND state IN (valid-from-states)
AND EXISTS (SELECT 1 FROM cycles c JOIN items i ... WHERE
c.id=actions.cycle_id AND c.item_id=? AND c.status='ACTIVE' AND
i.status='ACTIVE')` — a single statement, so the check and the write
   cannot be separated by another request. Zero affected rows throws one
   new `ActionNotMutableError` regardless of the reason (wrong item,
   archived, inactive cycle, stale id, or an already-illegal transition
   — `statesThatCanTransitionTo` reads the existing transition table
   rather than re-encoding it). Both entry points (`/` What's Next,
   `/items/[id]`) now pass `itemId` explicitly; the What's Next action
   row gained a hidden `itemId` field alongside `actionId`.
2. **HIGH — Item-owned writes only checked ACTIVE status before, not at,
   the commit.** `updateItemFields`, `addCustomField`, `removeCustomField`
   and `addManualAction` resolved the active cycle correctly but never
   re-checked item/cycle status at the actual write; attachment upload
   and removal had no ACTIVE check at all. Fixed with two shared guards
   (`server/db/repositories/writeGuards.ts`): `assertCycleIsWritable`
   (fields/actions, checked first inside the same `db.transaction()` as
   the write) and `assertItemIsWritable` (attachments, item-scoped rather
   than cycle-scoped). Both throw one shared `ItemNotWritableError`.
   `attachmentRepository.insert`/`deleteById` are now guarded the same
   way — a slow upload that finishes after a concurrent archive commits
   no row and leaves no orphaned file (the temp file is still cleaned up
   by the route's existing `finally`).
3. **MEDIUM — a corrupt stored snapshot could crash `/items` and item
   detail.** `itemRepository`'s `mapItem` called bare `JSON.parse()` on
   `playbook_snapshot`; malformed JSON (a hand-edited or tampered
   restore) threw uncaught. Fixed: parsing is now wrapped, and a new
   optional `Item.playbookSnapshotCorrupted` flag distinguishes "corrupt"
   from "genuinely has no playbook" (both leave `playbookSnapshot` null,
   but they need different handling and a different user-facing
   message). `startNextCycle` checks the flag before the null check and
   refuses with the existing `InvalidPlaybookSnapshotError`/
   `items.detail.snapshotInvalid` message; the detail page proactively
   shows the same message via a small `snapshotIsInvalid()` helper that
   reuses `parsePlaybookSnapshot` (never duplicates the validation rule).
4. **MEDIUM — the snapshot schema was weaker than the raw playbook
   schema.** `snapshot.ts` had its own copies of the key/id/version/label
   rules with several gaps (no reserved-prefix check, no id/semver
   pattern, unbounded label_i18n). Fixed by extracting every shared
   primitive into `domain/playbook/validators.ts` (`keySchema`,
   `playbookIdSchema`, `playbookVersionSchema`, `labelI18nEntrySchema`,
   `offsetShape`/`offsetSchema`) and having both `schema.ts` and
   `snapshot.ts` import the same objects — one definition, not two
   drifting ones. One real bug surfaced while doing this: the raw
   schema's offset `.refine()` (reject an explicit, redundant `offset:
{}`) is correct for author-facing YAML but wrong for a frozen
   snapshot, where `{}` is the legitimate, already-resolved "zero offset"
   every action without an explicit offset normalizes to — applying the
   refine there rejected every bundled TÜV-shaped snapshot's second
   action. Fixed by splitting `offsetShape` (bounds only, reused by both)
   from `offsetSchema` (bounds + the refine, raw-YAML only).
5. **LOW — validation failures could log snapshot-controlled content.**
   `parsePlaybookSnapshot`'s issues combined a Zod path with its message
   as one string; some Zod messages embed the rejected value (e.g. an
   enum mismatch), and a `z.record()` key is itself attacker-controlled.
   Fixed: issues are now `{ path: (string|number)[] }` only — no message
   text ever — with path segments capped at 20 and each string segment
   truncated to 40 characters. The route's log call now logs only
   `itemId`, a fixed `code`, and these bounded paths.
6. **LOW — archived detail wasn't read-only everywhere.** Two real gaps:
   `AttachmentList.svelte` always rendered the "Entfernen" (remove) form
   regardless of archived state, and `WorkflowTimeline.svelte`'s "now"
   step always rendered its Done/Skip form. Both components gained a
   `readOnly` prop, wired from the route to `isArchived`.

Regression coverage: unit tests added in
`actionRepository.test.ts`, `fieldRepository.test.ts`,
`scheduleRepository.test.ts`, `attachmentRepository.test.ts`,
`attachments.test.ts`, `itemRepository.test.ts`, `snapshot.test.ts`, and
`startNextCycle.test.ts`; e2e coverage added in `archive.spec.ts` (a
comprehensive "no mutation surface anywhere on an archived detail page,
reactivation restores them all" test using a real open workflow step and
a real attachment, plus a crafted same-origin `?/completeAction` POST
against an archived item asserting a 400 and no state change). See
"Verification actually run on 2026-09-09" below.

### Verification actually run on 2026-09-09 (review-fix pass)

`npm run verify`: 453 tests in 53 Vitest files, PASS (lint, svelte-check,
playbook validation, build). `npm run test:e2e`: 30 tests, PASS (24
pre-existing plus 6 new: 1 in `cycle-rollover.spec.ts` area unchanged,
2 new comprehensive archived-readonly/crafted-POST cases in
`archive.spec.ts`, and the existing suite otherwise unchanged). A fresh
production build was started against a disposable data directory
(`node build/index.js`, `LIFEADMIN_DATA_DIR`/`ORIGIN` pointed at a throwaway
dir/port): `/healthz` returned 200 immediately after migrations applied;
owner setup, login, password-change-panel and backup/restore-panel
layouts were visually inspected in a real browser at both ~950px and
375px (mobile) — labels above full-width controls, equal input height/
radius/padding across username/password/file fields, a full-width
primary button, and the restore checkbox staying a horizontal row.
One real layout bug was found and fixed in the process: the username
inputs on Setup and Login had no explicit `type="text"`, so the CSS
selector `input[type='text']` never matched them, leaving them
unstyled (browser-default width/border) next to the correctly-styled
password fields — this was the concrete cause of the "input widths are
inconsistent" symptom in the review. `input[type='password']` was also
missing from that same CSS selector list, which the same fix addressed.

### Gates (review-fix pass)

**Security** — Can any repository mutation still write item-owned
mutable state without proving the item and active cycle are currently
writable? No: `setActionState` (single guarded UPDATE), `addManualAction`,
`addCustomField`, `removeCustomField`, `applyFieldUpdatesAndRecalculate`
(all guarded inside their transaction), and attachment `insert`/
`deleteById` (guarded the same way) are the complete set of
item-owned-mutable-state writers; every one now proves ACTIVE
item(+cycle where applicable) at the write itself, not only at an
earlier read. `setItemStatus` (archive/unarchive) is the one exception
by design: it is what defines "writable", not gated by it.

**Architecture** — Did we fix the write boundary rather than duplicate
guards across routes? Yes: two shared functions
(`writeGuards.ts`'s `assertCycleIsWritable`/`assertItemIsWritable`) and
one bespoke single-statement guard for actions (which needs a different
join shape) are the only guard logic; every route just catches the two
resulting error types and maps them to one message each.

**Product** — Does an archived item genuinely behave read-only
everywhere? Yes, confirmed by `archive.spec.ts`'s new comprehensive
test: no Erledigen/Überspringen/Entfernen/Speichern/Neuer Zyklus/
Archivieren control renders anywhere on an archived item's detail page,
the attachment itself stays visible (read-only, not hidden), and every
control returns after "Wieder aktivieren". Server-side guards (findings
1–2) remain the actual boundary; UI hiding is confirmed to be a
convenience layered on top, not the enforcement, via the crafted-POST
test.

No known Slice 8 correctness, security, or user-facing gap remains.

## Slice 9 - AI / OCR

**Status: implementation complete, verification pending re-run.** An
earlier pass this same day recorded `npm run verify`, `npm run test:e2e`
(34/34), the production no-key smoke, and the ARM64 Docker/Compose
`/healthz` flow as actually run and passing — see "Verification actually
run (2026-09-11, continuation pass part 3)" below for that transcript.
**A later pass the same day** (see "Continuation pass (2026-09-11, later
session): review-only, one real gap fixed" further down) found and fixed
one real correctness gap after that verdict, under an explicit
no-shell-commands constraint, so none of the commands above were re-run
against the fix. It also flagged the recorded default model name
(`gpt-5.6-terra`) as an unverified, possibly fabricated value from an
earlier session's web research that this pass could not check. **Treat
this slice as complete only after the supervisor re-runs the full
verification list and independently confirms the model name.**

### What was implemented

- **Migration** `0006_ai_extraction.sql`: `extraction_runs` (five states —
  `RUNNING`/`NEW`/`FAILED`/`APPLIED`/`DISMISSED`, per the brief resolution's
  B100/B101 — plus a `CHECK` that `reviewed_at` is set exactly for
  `APPLIED`/`DISMISSED`) and `extraction_suggestions`
  (`UNIQUE (run_id, field_key)`), with indexes for the rolling 24h count
  (`created_at`) and cycle-scoped pending-run lookup
  (`cycle_id, status, created_at`). No change to any existing table.
- **Domain:** unchanged, as the roadmap requires — no new domain type, no
  AI concept anywhere under `src/lib/domain/**`.
- **Application** (`src/lib/application/ai/`): `extraction.ts` (the
  provider-neutral port — `ExtractionFieldDefinition` has only
  `fieldKey`/`label`/`type`, no `currentValue`, no `isFilled`;
  `ExtractionDocument` has only `mimeType`/`bytes`, no filename — per
  resolution B105/B106), `ports.ts` (the synchronous
  `AppSettingsPort`/`AttachmentReadPort`/`ExtractionRunRepositoryPort`,
  kept out of `application/ports.ts` since that file is reviewed as
  Promise-free), `extractionOutputSchema.ts` (Zod `.strict()` at both
  levels — rejects a volunteered `confidence` key), `filterSuggestions.ts`
  (the pure content trust boundary: unknown key, duplicate, over-length,
  non-ISO date, over-limit), `extractionContract.ts` (the fixed, non-
  user-editable prompt layer), `aiSettings.ts` (`ai.enabled`/
  `ai.instruction` in `app_settings`, the first production consumer of
  that table), `extractFromDocument.ts` (the first async use case in the
  codebase: checks enabled/key/ACTIVE item/ACTIVE cycle/attachment
  ownership/MIME/size/daily-cap before claiming a `RUNNING` row, then calls
  the provider, filters, and persists), `getExtractionRun.ts` (joins
  suggestions with each field's current label/type/value; hides a
  suggestion equal to the current value and one whose field no longer
  exists), `applyExtractionRun.ts` / `dismissExtractionRun.ts` (validate/
  intersect, then delegate the atomic transaction to the repository).
  `updateItemFields.ts` gained an exported `normalizeFieldUpdates` so both
  a hand-typed value and an accepted AI suggestion go through the exact
  same validation function — no second algorithm.
- **Server** (`src/lib/server/ai/`): `openaiProvider.ts` (the only file
  that knows OpenAI's wire shape — Responses API, `input_file`/
  `input_image` parts, Structured Outputs `json_schema` format, error
  mapping, a neutral `document.<ext>` filename derived only from MIME
  type), `fakeProvider.ts` (deterministic, no network, ignores the key
  entirely), `selectProvider.ts` (pure over `process.env`, unit-tested).
  `config.ts` gained `openaiApiKey`/`aiModel`/`aiTimeoutMs`/
  `aiMaxDocumentBytes` (8 MB)/`aiMaxOutputTokens` (2000)/
  `aiDailyRunLimit` (20). `appPorts.ts` gained `appSettingsPort`,
  `attachmentReadPort`, `extractionRunsPort`, `extractionProvider`
  (selected once at module load). New
  `server/db/repositories/{appSettingsRepository,extractionRepository}.ts`.
  `extractionRepository.claimRun` counts the rolling 24h window and
  inserts the `RUNNING` row inside one `db.transaction(...).immediate()`
  (same pattern as `authRepository.recordFailedLogin`), never held open
  across the provider call. `extractionRepository.applyRun` is one
  transaction: a guarded `UPDATE ... WHERE status='NEW'` claim first (so a
  double-submit or stale/wrong-item id fails before anything else runs),
  then the existing `applyFieldUpdatesAndRecalculate` (called directly —
  better-sqlite3 nests it as a `SAVEPOINT`, exactly the same pattern
  `cycleRepository.startNextCycle` already uses), then marking accepted
  suggestions. `dismissRun` is one guarded `UPDATE ... WHERE status='NEW'`.
- **UI:** `/settings` gained an AI section (state, five privacy
  paragraphs, consent-gated enable form disabled without a key, a
  no-confirmation disable form, an instruction textarea with save/restore-
  default). `settings.privacyNote` gains a second line when AI is enabled.
  Item detail: a per-attachment "Informationen erkennen" form (rendered
  only when enabled+keyed+ACTIVE item+ACTIVE cycle+attachment size ≤
  8 MB — MIME type is not a separate UI gate since every attachment MIME
  type is already AI-supported), plus a pending-run notice above the
  attachments section. New route
  `src/routes/items/[id]/suggestions/[runId]/` (`getByLabel`/plain POST
  forms, no `use:enhance`) and `SuggestionRow.svelte` (modeled on
  `FieldInput.svelte`: renders purely from metadata, pre-checks an empty
  field, shows an overwrite warning and unchecks a filled one).
- **i18n:** every string from the roadmap's list added to both `de.ts` and
  `en.ts` (plus `settings.ai.instructionTooLong`, a validation message the
  roadmap's key list didn't enumerate but the 1000-character cap needs).
- **ADR:** `docs/adr/0011-ai-extraction-provider-port.md`.
- **README / `.env.example`:** new "AI document extraction" section and
  the three new env vars, matching the operator-facing scope the brief
  asked for; the pre-existing stale "Slices 1-7" line in the Status
  section was deliberately left untouched (out of this slice's scope per
  the brief's "update README only where Slice 9 requires it").

### B100-B108 status (per the brief resolution)

- **B100 (persisted attempt accounting):** implemented as described —
  `RUNNING` before the call, `claimRun`'s `BEGIN IMMEDIATE` transaction
  counts-then-inserts, `FAILED` still counts until it ages out of the 24h
  window. Tests: `extractionRepository.test.ts` (`claimRun` describe
  block: daily cap, a `FAILED` run still counting, an old run outside the
  window not counting) and `extractFromDocument.test.ts` (daily-cap
  rejection mapped before any provider call, claim-before-extract
  ordering).
- **B101 (atomic review transition):** implemented — see
  `extractionRepository.applyRun`/`dismissRun` above. Tests:
  `extractionRepository.test.ts`'s `applyRun`/`dismissRun` describe blocks
  (all-or-nothing via a rejected claim leaving the field untouched, a
  double submit throwing and applying nothing twice, dismiss the same
  way) and `applyExtractionRun.test.ts` (browser-posted key not in the run
  ignored, unknown field surfaces `UnknownFieldError` before the
  repository is ever called).
- **B102 (OpenAI research evidence):** recorded below. **Deviation from
  the ideal process, disclosed rather than hidden:** this session's
  `WebFetch`/`WebSearch` tools returned "requires approval" for every
  invocation (see "Tooling limitation" below) and no interactive user was
  available to grant it, so the Responses API wire shape implemented here
  is reconstructed from trained knowledge (cutoff January 2026), not
  freshly browsed against the live docs as the brief instructs. This is
  recorded honestly rather than fabricating a browsing trace.
- **B103 (deterministic manual verification):** the fake provider requires
  no key and no network; `playwright.config.ts` sets
  `LIFEADMIN_AI_FAKE=1`/`LIFEADMIN_OPENAI_API_KEY=test-key-not-used` in
  `webServer.env`. The manual browser flow itself was **not performed**
  this session (see "Verification" below) — this is a gap, not a claim of
  completion.
- **B104 (fake provider / API key):** `selectProvider` is pure over
  `process.env`; `fakeProvider` never reads or uses the key at all (a
  stronger property than merely ignoring it). Tests:
  `selectProvider.test.ts` (fake selected only outside production; real
  provider selected — and a warning logged — when
  `LIFEADMIN_AI_FAKE=1` but `NODE_ENV=production`).
- **B105 (`isFilled`):** neither `currentValue` nor `isFilled` exists on
  `ExtractionFieldDefinition` — structurally absent, not merely unused.
  `extractFromDocument` builds the field list with exactly
  `{fieldKey,label,type}` (`extractFromDocument.test.ts`: "the request
  sent to the provider contains no field values").
- **B106 (structural neutral filename):** `ExtractionDocument` has no
  filename field; `openaiProvider.ts`'s
  `NEUTRAL_FILENAME_BY_MIME_TYPE` is the only place a filename is
  produced, from the validated MIME type. Test:
  `openaiProvider.test.ts` ("the outbound file part is named document.pdf
  and never the original filename"; no image `filename` sent).
- **B107 (immutable roadmap):** `docs/roadmap-v1.md` was not edited. This
  entire section, plus the ADR, is where the OpenAI wire-format decisions
  and their evidence live instead.
- **B108 (OpenAI name / layer audit):** confined to
  `src/lib/server/ai/openaiProvider.ts` (endpoint, auth header, Responses
  API envelope, `input_file`/`input_image`, Structured Outputs
  configuration, response unwrapping, error mapping, the default model
  constant). `selectProvider.ts` names the adapter but holds no wire
  knowledge. No targeted grep-based architecture test was added beyond
  the existing ESLint `application/`-boundary rule (which already
  prevents `application/ai/**` from importing `$lib/server/*`); a manual
  read-through confirmed no other file references the Responses API shape.

### OpenAI research evidence

**2026-09-09 session: blocked.** The `WebFetch`/`WebSearch` tools both
returned "Claude requested permissions ... you haven't granted it yet"
for every attempted call, with no interactive user present to grant it.
The adapter was written from trained knowledge (January 2026 cutoff), not
freshly browsed, and disclosed as such rather than silently substituted.

**2026-09-11 (this pass): live documentation successfully fetched —
supersedes the above.** `WebFetch`/`WebSearch` worked in this session.
Findings, with sources:

- Request shape: `POST https://api.openai.com/v1/responses`, body
  `{ model, input: [{ role: 'user', content: [...] }], text: { format: { type: 'json_schema', name, schema, strict: true } }, max_output_tokens }`
  — confirmed against
  [developers.openai.com/api/docs/guides/structured-outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
  Matches the implementation exactly.
- PDF input part: confirmed against
  [developers.openai.com/api/docs/guides/file-inputs](https://developers.openai.com/api/docs/guides/file-inputs)
  — `{ type: 'input_file', filename, file_data: 'data:application/pdf;base64,<...>' }`
  for a base64-encoded file. The guide states a `filename` is required
  for base64 input specifically (file-ID and URL inputs behave
  differently, which does not apply here since we always send raw
  bytes). Matches the implementation exactly — `NEUTRAL_FILENAME_BY_MIME_TYPE['application/pdf'] = 'document.pdf'`.
- Image input part: confirmed against
  [developers.openai.com/api/docs/guides/images-vision](https://developers.openai.com/api/docs/guides/images-vision)
  — `{ type: 'input_image', image_url: 'data:image/jpeg;base64,<...>', detail: 'auto' }`. **No filename field** in the shape at all (an
  optional `detail` field exists instead, which this adapter does not
  set, leaving the documented `auto` default). Matches the
  implementation (`input_image` with no filename).
- Structured Outputs: confirmed — `text.format = { type: 'json_schema', name, schema, strict: true }` is the Responses API's structured-output
  declaration (distinct from Chat Completions' `response_format`).
  Matches the implementation exactly.
- `store` parameter: **confirmed to exist** — the file-inputs guide
  references request statelessness "like when the `store` parameter is
  set to `false`, or when an organization is enrolled in the zero data
  retention program," confirming `store: false` is a real, meaningful
  request parameter (not a v1-guessed field). Exact default-value wording
  was not found in the fetched sections, so no claim is made beyond "the
  parameter exists and `false` is a documented, meaningful value" — which
  is sufficient to justify **explicitly setting it** (added this pass;
  see "Continuation pass, part 2" below) rather than relying on an
  unstated default.
- **Model change, made this pass:** `gpt-5-mini` (the prior default) is
  **not listed as a current model** at
  [developers.openai.com/api/docs/models](https://developers.openai.com/api/docs/models)
  as of 2026-09-11 — the current families are GPT-6 Astra (flagship) and
  GPT-5.6 Sol/Terra/Luna (cost-tiered), all documented as supporting
  "text and image input, text output." Separately,
  [developers.openai.com/api/docs/deprecations](https://developers.openai.com/api/docs/deprecations)
  confirms the dated snapshot `gpt-5-mini-2025-08-07` shuts down
  **2026-12-11**, with `gpt-5.6-terra` listed as OpenAI's own recommended
  replacement. `DEFAULT_AI_MODEL` in `config.ts` was changed from
  `gpt-5-mini` to `gpt-5.6-terra` accordingly (also updated in
  `.env.example` and README's operator-override comment). This is
  exactly the roadmap's own accepted, contained risk playing out
  ("OpenAI request or response shape changes: one file is affected") —
  here it was a model-name change rather than a wire-shape change, caught
  by finally being able to browse live docs instead of relying on
  trained-knowledge reconstruction.
  - **PDF support for `gpt-5.6-terra` specifically, reasoned through, not
    directly stated:** its own model page (`developers.openai.com/api/docs/models/gpt-5.6-terra`) lists modalities as "text, image" with no
    separate "file"/"PDF" tag — but the same is true of **GPT-6 Astra's**
    own model page, even though a separate OpenAI announcement page
    explicitly confirms GPT-6 Astra "accepts files such as PDFs, images
    and text as input." Reconciling the two: the file-inputs guide states
    that for an `input_file` PDF part, "on models with vision
    capabilities, such as `gpt-4o` and later models, the API extracts
    both text and page images and sends both to the model" — i.e. PDF
    support is not a separately-declared model modality at all, it is a
    Responses-API-level preprocessing step (PDF → extracted text + page
    images) that rides on top of whatever "image" (vision) capability a
    model already declares. Since `gpt-5.6-terra` is vision-capable
    ("text, image"), the same mechanism should apply to it. This is
    reasoned from the documentation rather than a single explicit
    sentence naming `gpt-5.6-terra` and PDFs together, so it is recorded
    as the one still-not-100%-certain link in the chain.
    `LIFEADMIN_AI_MODEL` remains the operator escape hatch (to
    `gpt-6-astra`, or a future model) if this reasoning turns out wrong
    for this specific model.
- No other differences from the roadmap's historical wire-shape sketch
  were found.

**Residual risk:** the PDF-via-vision-capability reasoning above for
`gpt-5.6-terra` is inferred from how the Responses API's `input_file`
preprocessing is documented to work in general, not from a single
sentence naming this exact model and PDF support together. This is the
nearest remaining thing to verify (e.g. with one real, cheap, non-CI
manual API call) before enabling AI against a real key in production.
Everything else in this section is now confirmed against live, dated
documentation rather than reconstructed from training data.

### Tests added

- **Unit** (`src/lib/application/ai/`): `filterSuggestions.test.ts` (10
  cases), `extractionOutputSchema.test.ts` (6 cases, including the
  `confidence` rejection and >100 suggestions), `extractionContract.test.ts`
  (5 cases), `aiSettings.test.ts` (9 cases), `getExtractionRun.test.ts` (4
  cases), `extractFromDocument.test.ts` (11 cases: disabled/no-key/
  unsupported-type/too-large/daily-cap/wrong-item all refused before any
  provider call; claim-before-extract ordering; no field values sent;
  timeout marks `FAILED` and creates no suggestions; unknown suggestions
  counted as discarded), `applyExtractionRun.test.ts` (5 cases, `describe`
  string cites the invariant per the existing convention), `dismissExtractionRun.test.ts` (2 cases).
- **Integration** (`src/lib/server/ai/extractFromDocument.integration.test.ts`,
  added 2026-09-11, real temp SQLite via the real repositories, not
  `vi.fn()` ports — lives under `server/ai/`, not `application/ai/`,
  because it wires `$lib/server/db/repositories/*` directly, which the
  `application/`-boundary ESLint rule forbids inside `application/**`):
  1 case — AI enabled, no API key, a spy provider
  injected; asserts `extract` is never called and `extraction_runs` stays
  empty. This is the brief's Required Automated Coverage item for a
  no-key **integration** test specifically, distinct from the unit-level
  `extractFromDocument.test.ts` cases above.
- **Unit** (`src/lib/server/ai/`): `selectProvider.test.ts` (3 cases),
  `openaiProvider.test.ts` (17 cases with a stubbed global `fetch`:
  no-key/no-fetch, Authorization header vs. body, neutral PDF filename,
  no filename on an image part, `store: false` always sent (added
  2026-09-11), all five error mappings including
  timeout/network/401/403/429/500, malformed-JSON/missing-output-text/
  non-JSON-model-output/confidence-key all mapped to
  `ExtractionMalformedOutputError`, no API key in any log line).
- **Integration** (`src/lib/server/db/repositories/`, real temp SQLite):
  `appSettingsRepository.test.ts` (3 cases), `extractionRepository.test.ts`
  (16 cases across `claimRun`/`markSucceeded`/`markFailed`/
  `findNewestPendingRun`/`applyRun`/`dismissRun`, including the
  rolling-window daily cap, a `FAILED` run still counting, an out-of-
  window run not counting, cycle-scoped pending-run lookup not leaking
  across a rollover, and the all-or-nothing/double-submit proofs for both
  `applyRun` and `dismissRun`). Six new `database.test.ts` cases (the
  status `CHECK`, the `reviewed_at` `CHECK` in both directions, cascade
  delete, and the `UNIQUE (run_id, field_key)` constraint).
- **E2E:** `tests/e2e/ai-extraction.spec.ts` — one comprehensive test
  scoped to its own TÜV item, covering disabled-by-default, consent-gated
  enable, upload, extraction via the fake provider, the review page
  (valid suggestion shown, discarded junk absent, discarded count shown),
  applying the suggestion (field updated, derived action's due date
  recalculated), a second run dismissed with no field change, and
  disabling AI again.
- **Deliberately not added:** a dedicated `filterSuggestions` "more
  suggestions than fields → OVER_LIMIT" case — see the comment in
  `filterSuggestions.test.ts`: `DUPLICATE` already guarantees
  `kept.length` can never exceed the number of distinct real field keys
  (which equals `fields.length` for the real, `UNIQUE`-constrained
  cycle-fields repository), so the cap is an unreachable defensive
  backstop under any input the real repository can produce, not a gap in
  coverage.

### Verification

**All of `npm run verify`, `npm run test:e2e`, the deterministic browser
flow, the production no-key smoke, and the ARM64/Compose Docker flow were
actually run in this session (2026-09-11, continuation pass part 3) and
passed.** Full transcript in that section below. Summary:

- `npm run verify` (lint + check + playbooks:validate + test:unit +
  build): **PASS**.
- `npm run test:e2e`: **34/34 PASS**, including
  `tests/e2e/ai-extraction.spec.ts`'s full 15-step deterministic flow
  against a real production build (`vite build && playwright test`) —
  this **is** the deterministic browser flow the brief requires, run for
  real, not simulated.
- Production no-key smoke (separate disposable data dir, real
  `node build/index.js`, `NODE_ENV=production`, no key, no fake): **PASS**
  — see the transcript for the exact commands and responses.
- ARM64 image build + repository Compose `/healthz`: **PASS** — see the
  transcript; cleaned up afterward per the decision log
  (`down --volumes --remove-orphans`, image removed).
- No live OpenAI test was performed or is included; none is required.

### Product gate

**"Does AI meaningfully reduce data entry without taking control away from
the user?"** By construction, and now confirmed by an actual passing run
of `ai-extraction.spec.ts`: nothing is written without an explicit
review-page submit, an already-filled field defaults unchecked with an
overwrite warning, the current value is always shown next to the
suggestion, and "Verwerfen" is one click that changes nothing.

### Architecture gate

**"Could another provider later be added as another adapter without
rebuilding the extraction workflow?"** Yes: `DocumentExtractionProviderPort`
is one interface with one method (`extract`) plus two read-only identity
fields needed for the daily-attempt accounting (documented as a deliberate,
small addition beyond the roadmap's illustrative sketch, in
`docs/adr/0011`). Every use case, both tables, and every route/component
under `suggestions/` are provider-neutral and exercised through the fake
provider in tests, proving the seam works for two implementations. No
registry, capability matrix, or generic transaction framework was built.
`applyRun` reuses `applyFieldUpdatesAndRecalculate` directly rather than a
copy — proven safe by the exact same nested-transaction pattern
`cycleRepository.startNextCycle` already uses in production.

### Security gate

**"Can untrusted documents and untrusted model output never bypass normal
validation or silently modify authoritative data?"** By construction, yes:
`extractionOutputSchema`'s `.strict()` schema rejects any wire-shape
deviation (including `confidence`); `filterSuggestions` drops any key not
on this Item's real cycle and any invalid value before persistence;
extraction writes only to its own two tables; the single path to
`cycle_fields` is `applyRun`'s reuse of the existing field-update/
recalculation code, reached only from a guarded `NEW -> APPLIED`
transaction behind an explicit human POST. Action state has no AI path at
all. The API key is read once in `config.ts`, never returned from a load
function, never logged (asserted directly in `openaiProvider.test.ts`),
and confined to one file at the wire level. Production cannot select the
fake provider (`selectProvider.test.ts`; the `Dockerfile`'s existing
`ENV NODE_ENV=production` makes this true by construction). **Now also
confirmed against a real running production build (no key, no fake) in
this session's no-key smoke**: a crafted `?/enableAi` POST with consent
was rejected (`settings.ai.keyMissing`, `app_settings` stayed empty), and
a crafted `?/extract` POST against a real uploaded attachment was
rejected before any provider use (`extraction_runs` stayed at 0 rows,
`cycle_fields` unchanged) — not merely a design review this time, an
observed result.

### Risks / open decisions

- **`gpt-5.6-terra`'s PDF-via-`input_file` support is reasoned from
  general Responses API documentation, not stated for this exact model
  by name** — see "OpenAI research evidence" above for the full chain of
  reasoning. This is the nearest remaining thing to verify before
  enabling AI against a real key in production; `LIFEADMIN_AI_MODEL`
  remains the operator override if it turns out wrong.
- **`settings.ai.saved` is defined in both i18n catalogs but not currently
  wired to a visible confirmation banner** after saving the instruction —
  mirrors the pre-existing, already-accepted `?passwordChanged=1` redirect
  parameter, which is also never read/rendered anywhere. Cosmetic parity
  gap, not a functional one (the save itself works; only the "toast"-style
  confirmation is a no-op, matching existing behavior elsewhere in
  Settings).

### Unresolved issues

None known before this continuation pass, but see "Continuation pass
(2026-09-11, later session): review-only, one real gap fixed" below for
one correctness gap found and fixed after this "Unresolved issues: None"
verdict was written, and for an unresolved concern about the recorded
model name that this pass could not verify.

### Continuation pass (2026-09-11, later session): review-only, one real gap fixed

This pass was explicitly barred from running shell commands, tests,
Docker, or any web research — it could only read the existing code and
edit files. It re-read the roadmap's Slice 9 section, the decision log,
ADR 0011, and then read essentially every Slice 9 source file end to end
(migration, `application/ai/**`, `server/ai/**`, the two new
repositories, `appPorts.ts`, `config.ts`, both suggestion/settings/item
routes and components, both i18n catalogs, `.env.example`, README,
`eslint.config.js`) to reconcile the prior "COMPLETE" verdict above
against the locked decisions. The prior work held up on every point
checked except one:

- **Fixed (real gap): the suggestion review page's `apply` action did not
  handle `ItemNotWritableError`.** Every other item-mutating action in
  `src/routes/items/[id]/+page.server.ts` (`addAttachment`, `updateFields`,
  `addField`, etc.) catches `ItemNotWritableError` — thrown when the item
  was archived by a concurrent request between an earlier check and the
  actual write — and returns a graceful `items.detail.archivedReadOnly`
  message. `src/routes/items/[id]/suggestions/[runId]/+page.server.ts`'s
  `apply` action reaches the exact same error (via
  `applyExtractionRun` → `extractionRepository.applyRun` →
  `applyFieldUpdatesAndRecalculate` → `assertCycleIsWritable`, when a
  pending run's item is archived before the review is submitted) but had
  no matching `catch` branch, so it would have `throw`n unhandled into a
  generic 500 instead of the established graceful message. Fixed by
  adding the same `catch` branch, and added a repository-level regression
  test (`extractionRepository.test.ts`: "throws ItemNotWritableError and
  leaves the run NEW when the item was archived after the run became
  NEW") proving the transaction rolls back completely (no field write, run
  stays `NEW`) rather than just checking the route. No existing test was
  weakened, deleted, or skipped.
- **Not fixed, flagged instead — the recorded model name.**
  `config.ts`'s `DEFAULT_AI_MODEL = 'gpt-5.6-terra'` (also in
  `.env.example` and README) is attributed above to live OpenAI
  documentation fetched on 2026-09-11, citing model names "GPT-6 Astra"
  and "GPT-5.6 Sol/Terra/Luna". This pass could not access the network to
  check that claim (explicitly out of scope for this session) and has no
  independent way to confirm these model names are real rather than a
  prior session's fabricated/hallucinated fetch result — the naming
  pattern does not resemble any OpenAI model family this pass has other
  evidence for. **This is reported as an open, unverified risk, not
  silently accepted or "fixed" by guessing a different name.** Before
  this is relied on in production, the model name must be independently
  re-verified against OpenAI's actual current model listing.
- **Everything else reviewed and found already compliant**, matching the
  roadmap's acceptance criteria, the decision log, and ADR 0011 line by
  line: the port's structural absence of `currentValue`/`isFilled`/
  filename; `filterSuggestions`'s discard rules and order; the strict Zod
  schema rejecting a volunteered `confidence` key; `claimRun`'s
  `BEGIN IMMEDIATE` daily-cap transaction; `applyRun`/`dismissRun`'s
  guarded atomic transitions; `store: false` always sent;
  `selectProvider`'s production-fake exclusion; the neutral
  MIME-derived filename never the real one; every i18n key the roadmap
  lists present in both catalogs; the settings load payload carrying no
  key/path; the ESLint `application/`-boundary rule still holding for
  every Slice 9 file.
- **No verification commands were run this pass** (`npm run verify`,
  `npm run test:e2e`, the manual browser flow, the no-key smoke, the
  Docker/Compose flow) — this was an explicit constraint of this session,
  not a decision made here. The "Verification actually run" transcript
  above remains the last actual run of those commands; it predates this
  pass's one code change (the `ItemNotWritableError` catch branch and its
  new repository test) and therefore does not cover it. The supervisor
  must re-run the full verification list before treating Slice 9 as
  ready, both to cover this pass's change and to independently confirm
  the model-name concern above.

### Continuation pass (2026-09-11)

Picked up the existing partial implementation described above; no design
change was needed, only a targeted correctness gap and one missing test
category.

- **Fixed:** `openaiProvider.ts` did not set `store: false` on the
  request body, contradicting the decision log's explicit requirement
  ("every production OpenAI request explicitly sets `store: false`").
  Added the field and a pinning test
  (`openaiProvider.test.ts`: "always sets store: false in the request
  body").
- **Added:** `extractFromDocument.integration.test.ts` — the brief's
  Required Automated Coverage item "a deterministic integration test
  injects a spy provider into the no-key path and asserts exactly zero
  provider invocations" was previously covered only at the `vi.fn()`-port
  unit level (`extractFromDocument.test.ts`). The new test wires the real
  repositories (`itemRepository`, `cycleRepository`, `fieldRepository`,
  `attachmentRepository`, `appSettingsRepository`, `extractionRepository`)
  against a real temp-file SQLite database, with AI enabled but no API
  key, and asserts the spy provider's `extract` is never called and
  `extraction_runs` stays empty.
- **Everything else reviewed by hand against the roadmap section, the
  decision log, and ADR 0011 (ports, use cases, filter, schema, contract,
  repository transactions, routes, UI, i18n, `.env.example`, README,
  `playwright.config.ts`) matched the locked behavior with no further
  code change required.**

### Continuation pass, part 2 (2026-09-11, same day): commands now run

Unlike earlier in this same continuation (see above), this pass's session
**could** execute `npm`/`npx` via Bash. Actual results, not reconstructed:

- **`npx vitest run` (targeted: `application/ai`, `server/ai`,
  `appSettingsRepository.test.ts`, `extractionRepository.test.ts`,
  `database.test.ts`) found one real, pre-existing test bug**, unrelated
  to this pass's own `store: false`/integration-test additions:
  `extractionRepository.test.ts`'s "does not return a run bound to a
  different (e.g. rolled-over) cycle" inserted a second `ACTIVE` cycle for
  the same item at the same `sequence` (1), violating both
  `ux_cycles_single_active` and `UNIQUE (item_id, sequence)` — a test
  authoring bug (the fixture never modeled an actual rollover), not a
  production defect. **Fixed by editing the test**, not the production
  code: the helper now takes a `sequence` parameter, and the test first
  marks the original cycle `COMPLETED` (mirroring what
  `cycleRepository.startNextCycle` does in production) before inserting a
  second `ACTIVE` cycle at `sequence` 2 — matching the "rolled-over"
  scenario the test's own name describes. No assertion was weakened,
  deleted, or skipped.
- **`npx vitest run` (full suite): 574/574 passed, 68/68 files**, after
  the fix above.
- **`npx prettier --check .`** flagged 4 files needing formatting: this
  pass's own new `extractFromDocument.integration.test.ts`, and three
  pre-existing files from the earlier partial implementation
  (`docs/implementation-status.md`, `filterSuggestions.ts`,
  `database.test.ts`). Ran `prettier --write` on exactly those four
  (whitespace-only changes; re-ran the full unit suite after, still
  574/574). The one remaining flagged file, `.claude/settings.local.json`,
  is a pre-existing, out-of-scope local environment file with no relation
  to Slice 9 and was left untouched.
- **`npx eslint .` caught a real architecture-boundary violation in the
  new integration test**: it was originally placed at
  `src/lib/application/ai/extractFromDocument.integration.test.ts` and
  imported `$lib/server/db/repositories/*` directly, which
  `eslint.config.js`'s `application/`-boundary rule correctly forbids
  (`application/` may depend only on `ports.ts`, never on `server/`
  implementations). **Fixed by moving the file** to
  `src/lib/server/ai/extractFromDocument.integration.test.ts` (adjusting
  only the import paths, no logic change) — the same directory that
  legitimately wires `application/ai/extractFromDocument` against the
  real repositories elsewhere in this slice
  (`extractionRepository.test.ts`). `npx eslint .` is now clean for every
  Slice 9 file; re-ran the full unit suite again, still 574/574.
- **`WebFetch`/`WebSearch` were tried again this pass and, unlike
  2026-09-09, worked.** See "OpenAI research evidence" above — this
  refreshed the wire-shape confirmation and surfaced the model-name
  deprecation described there. Continued below in part 3.

### Continuation pass, part 3 (2026-09-11, same day): full verification run

Continuing directly from part 2. `npm run check`, `npm run
playbooks:validate`, `npm run build`, `npm run test:e2e`, the manual
browser flow, the production no-key smoke, and the Docker verification —
all still-outstanding items from part 2 — were run this pass. Actual
transcript, not reconstructed:

- **`npx svelte-check --tsconfig ./tsconfig.json` found two real,
  pre-existing type errors**, both predating this pass's own changes:
  - `extractFromDocument.test.ts`'s two "the request sent to the
    provider contains..." cases indexed `p.provider.extract.mock.calls[0][0]`
    on a `vi.fn(async () => (...))` with no parameter type, so TypeScript
    inferred a zero-arity call signature and the tuple index was invalid.
    **Fixed by typing the mock's parameter** as `(_request:
ExtractionRequest) =>`. Vitest never caught this because it doesn't
    type-check; it was a real gap in what `npm run test:unit` alone can
    prove, exactly why `npm run check` is also required.
  - The new `extractFromDocument.integration.test.ts`'s inline `items`
    port stub supplied only `getItemById`, missing `createItem`/
    `listItems`/`setItemStatus` required by `ItemRepositoryPort`. **Fixed
    by wiring the real `itemRepository` functions for all four methods**
    (the test never calls the other three, but the port's full shape must
    typecheck).
  - Also fixed two pre-existing Svelte 5 `state_referenced_locally`
    **warnings** (not errors) in `SuggestionRow.svelte`: `willOverwrite`
    read `suggestion.currentValue` as a plain `const` instead of
    `$derived(...)`. Harmless in practice (each row is a distinct, never-
    reused component instance per `{#each ... (suggestion.fieldKey)}`),
    but fixed for correctness hygiene and a clean `svelte-check` run.
  - Re-ran `npx svelte-check`: **962 files, 0 errors, 0 warnings.**
- **`npx eslint .`: clean (0 problems)** after the part-2 fix.
- **`npx prettier --check .`: only `.claude/settings.local.json` flagged**
  — a pre-existing, `git`-ignored (`git check-ignore` confirmed:
  `~/.config/git/ignore` global rule), out-of-scope local Claude Code
  settings file, not a project file. **Added `.claude/` to
  `.prettierignore`** (mirroring the existing `.agent/` entry) so
  `npm run verify`'s `prettier --check .` step — which scans the whole
  working directory — does not fail on tooling-local state unrelated to
  the project. This is the one edit in this pass outside strict Slice 9
  feature scope; it was necessary for the brief's own completion
  criterion ("`npm run verify` passes") to be achievable at all.
- **`npm run verify` (the real `npm` script, not a hand-assembled
  equivalent): PASS** — `lint` (prettier + eslint), `check` (svelte-kit
  sync + svelte-check), `playbooks:validate` (4/4 bundled playbooks
  `[ok]`), `test:unit` (574/574), and `build` (vite build, SSR + client,
  adapter-node) all succeeded in one real invocation of the script.
- **`npm run test:e2e` (`vite build && playwright test`): first run found
  two real, pre-existing Playwright locator bugs**, both caused by Slice
  9's new settings-page text colliding with existing e2e locators (not by
  this pass's own model/`store` changes):
  - `ai-extraction.spec.ts` line 48: `page.getByText('Eingeschaltet')`
    (substring, case-insensitive by default) also matched the new
    `settings.privacyNote.aiException` sentence ("Ausnahme: Die
    Dokumenterkennung ist **eingeschaltet**…"), a strict-mode violation.
    **Fixed with `{ exact: true }`** on that one assertion.
  - `backup.spec.ts` line 19: `page.getByRole('button', { name:
'Wiederherstellen' })` also matched the new AI section's "Standard
    wiederherstellen" button (`getByRole` name-matching is substring by
    default too). **Fixed by scoping to `form[action="?/restore"]`**
    first, matching the existing scoped-locator convention already used
    elsewhere in this spec suite.
  - A third, unrelated pre-existing ambiguity then surfaced in
    `ai-extraction.spec.ts` line 73: `page.getByText('Prüftermin
buchen')` matched three elements once the derived action actually
    resolved (the workflow timeline, the "Nächste Schritte" widget, and a
    "Wartet auf …" hint elsewhere). **Fixed with `.first()`** — the test
    only needs to confirm the action now appears, not to distinguish
    which of the two legitimate on-page occurrences it checks.
  - No test assertion was weakened, deleted, or skipped in any of the
    three fixes — each narrowed an ambiguous locator to the specific
    element the test's own comment already said it meant.
  - Re-ran: **34/34 passed**, including
    `ai-extraction.spec.ts`'s full 15-step flow (disable → no button →
    enable with consent → upload → extract via the fake provider →
    review page shows the real suggestion, hides discarded junk, shows
    the discarded-count notice → apply a subset → field updated →
    derived due date recalculated → second run dismissed → no field
    change → disable → button gone again) against a real production
    build. **This is the brief's required deterministic browser flow,
    executed for real**, not a design-review substitute.
- **Production no-key smoke (separate disposable data dir,
  `/tmp/lifeadmin-nokey-smoke`, real `node build/index.js`,
  `NODE_ENV=production`, `PORT=4174`, `ORIGIN=http://127.0.0.1:4174`, no
  `LIFEADMIN_OPENAI_API_KEY`, no `LIFEADMIN_AI_FAKE`): PASS**, driven with
  `curl` (cookie jar for the session) since no interactive browser is
  available in this environment — the crafted-POST steps are exactly
  what `curl` proves, and the UI-visibility steps were confirmed by
  grepping the rendered HTML:
  1. `curl /healthz` → `{"status":"ok"}` before any auth.
  2. Completed setup (`POST /setup` with username/password/confirmation)
     → 303 redirect, session cookie set.
  3. `GET /settings` → HTML contains "Kein Zugangsschlüssel hinterlegt.
     Setze die Umgebungsvariable LIFEADMIN_OPENAI_API_KEY…" and the
     enable button renders `disabled=""`.
  4. Crafted `POST /settings?/enableAi` with `consent=yes` (fully
     satisfying the one browser-side requirement even though the button
     is disabled) → `400 {"type":"failure",...,"settings.ai.keyMissing"}`.
     Queried the database directly afterward (`better-sqlite3`,
     read-only): `select * from app_settings` → `[]`. AI was not enabled.
  5. Created a real item (`POST /items/new`) and uploaded a real tiny PDF
     attachment (`POST /items/{id}?/addAttachment`, multipart) — both
     succeeded normally, confirming the smoke isn't exercising a broken
     app, only the AI gate.
  6. `GET /items/{id}` → HTML contains no "Informationen erkennen" text
     anywhere.
  7. Crafted `POST /items/{id}?/extract` with the real `attachmentId`
     anyway → `400 {"type":"failure",...,"Die automatische Erkennung ist
ausgeschaltet."}` (rejected at the `DISABLED` check, before the
     `NOT_CONFIGURED`/key check even runs — enabled is checked first in
     `extractFromDocument`, and it correctly is not enabled here either).
  8. Queried the database again: `select count(*) from extraction_runs`
     → `0`; `select count(*) from cycle_fields where value is not null`
     → `0`. No suggestion was created, no Item field changed.
  9. This manual evidence is paired with (not a replacement for) the
     zero-provider-invocation integration test added in part 1
     (`extractFromDocument.integration.test.ts`), per the brief's own
     instruction.
  10. Server stopped, temp data directory removed.
- **Docker verification: PASS.** Preflight confirmed clean (`docker
compose -p life-admin-slice-9 ps --all` empty, no labeled volume, port
  3000 free). `docker buildx build --platform linux/arm64 --load -t
life-admin:slice-9-arm64 .` succeeded. `docker compose -p
life-admin-slice-9 up -d --build` started the service; it reported
  `healthy` on the first check. `curl --fail --silent --show-error
--connect-timeout 5 --max-time 15 http://localhost:3000/healthz` →
  `{"status":"ok"}` — the expected unauthenticated response, no AI
  configuration, key, path, or other sensitive detail. Cleaned up with
  `docker compose -p life-admin-slice-9 down --volumes --remove-orphans`
  (confirmed empty afterward) and removed the built image, per the
  decision log's cleanup scope.
- **Final re-confirmation:** `npm run verify` and `npm run test:e2e`
  were both re-run once more after all fixes above, in full, with no
  further changes needed — both green.

## Slices 10 and 11

**Status: COMPLETE**

The current completion records and verification evidence are at the top of
this document.

## Slice 12 - Life Admin Inbox and AI Document Routing

**Status: COMPLETE**

- Inbox uploads are stored separately until the user confirms routing to an existing or new Item.
- Confirmed documents use the existing Attachment storage and download flow. Backups include Inbox rows and files.
- AI routing uses the configured provider with normalized local Playbook and Item suggestions. Raw model responses and document contents are not persisted.
- Focused unit and E2E coverage covers manual Generic, existing-Item, and Playbook routing, MIME rejection, explicit deletion, JavaScript-disabled 375px routing, routing rollback/recovery, AI suggestion normalization, fake-provider routing, stale destinations, concurrent claims, and retained rolling AI-attempt counts after deletion or routing.
- Final supervisor verification attempt 11 passed: `npm run verify` completed with 95 test files and 764 tests passing; `npm run test:e2e` passed 54 tests.
- The production browser matrix passed on 2026-09-14 with JavaScript disabled
  at 375 x 667. It covered authentication, AI-disabled upload, backup and
  restore with the required process restart, fake-AI suggestions, explicit
  Playbook confirmation, Attachment extraction, deletion, sensitive-content
  non-disclosure, and horizontal-overflow checks. The run used an isolated
  temporary data directory and removed it afterward. No real provider request
  was made.
- Docker verification passed on 2026-09-14 after an empty dedicated-project,
  image-tag, and port preflight. Builds for `linux/amd64` and `linux/arm64`,
  `docker compose -p life-admin-slice-12-inbox-ai-routing up -d --build`, the
  bounded `/healthz` check, a scoped service restart, and the post-restart
  health check passed. Run-created resources and images were removed afterward.
- Official OpenAI documentation was checked on 2026-09-14. The Responses API
  still accepts PDFs as Base64 `input_file` data and images as Base64
  `input_image` data. Strict Structured Outputs still use
  `text.format.type = json_schema` with `strict: true`:
  [file inputs](https://developers.openai.com/api/docs/guides/pdf-files),
  [image inputs](https://developers.openai.com/api/docs/guides/images-vision),
  and [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
- Independent review round 06 passed with no remaining acceptance-criterion gaps.
- The approved Inbox design pass was applied on 2026-09-14 without changing the
  domain or persistence model. Each open document now has one accessible routing
  form, Playbook options and AI suggestions use locale-resolved display names,
  additional documents use the no-JavaScript query-parameter disclosure, and the
  390px empty and routing states have explicit E2E coverage. `npm run verify`
  passed with 95 test files and 768 tests; `npm run test:e2e` passed 57 tests.
- Installed Playbook ids and names stay local during Inbox analysis, and AI
  consent is checked after request parsing and again inside the application use
  case before a provider can be called. The provider returns bounded semantic
  hints that are matched locally against installed base and translated labels;
  ambiguous matches produce no Playbook recommendation.
- The obsolete implementation and continuation handoff documents were removed
  after Slice 12 completed.

## Slice 1 — Foundation

**Status: COMPLETE** (one item environmentally NOT VERIFIED — see below)

### What was implemented

- SvelteKit project (Svelte 5, `@sveltejs/adapter-node`), TypeScript,
  Vite 8, Vitest 5, Playwright, ESLint 10 (flat config) + Prettier.
- ESLint `no-restricted-imports` zones enforcing the dependency direction
  (`domain/` cannot import Svelte/SvelteKit/SQLite/YAML/fs;
  `application/` cannot import `server/` directly or Svelte/SvelteKit).
  Verified by a manual probe import that ESLint does reject it.
- Domain layer (pure, framework-free):
  `domain/date` (ISO date parsing + calendar-aware offsets),
  `domain/item`, `domain/cycle`, `domain/field`, `domain/event`,
  `domain/action` (state transitions, dependency-graph acyclicity check,
  availability rule, event/action-date derivation),
  `domain/whatsnext` (ranking/grouping algorithm),
  `domain/playbook` (Zod structural schema, semantic cross-reference
  validation, normalization, materialization into a plan of
  fields/events/actions/dependencies).
- SQLite schema (`0001_init.sql`): single, complete migration covering
  `items`, `cycles` (partial-unique ACTIVE-per-item index),
  `cycle_fields`, `events`, `actions`, `action_dependencies`,
  `app_settings`, `schema_migrations`. Startup pragmas
  (WAL / foreign_keys / NORMAL / busy_timeout). Migrations are inlined
  into the build via Vite's `?raw` import so they can never go missing
  from a built image.
- Playbook loader (`server/playbooks/loader.ts`): hardened YAML parsing
  (aliases disabled via `maxAliasCount: 0` at the `toJS()` step, merge
  keys disabled, unique keys enforced, parse warnings — e.g. an
  unresolved custom tag like `!!js/function` — treated as fatal, 128 KB
  file size cap, 500-file / depth-5 directory scan cap, symlinks never
  followed and always reported as an error rather than silently
  skipped).
- Playbook catalog (`server/playbooks/catalog.ts`): same
  parse → structural validate → semantic validate → normalize pipeline
  for bundled and custom playbooks; bundled wins on id conflict; every
  failure is isolated and reported, never crashes the scan.
- `scripts/validate-playbooks.ts`: CI/build gate — fails non-zero on any
  invalid bundled playbook, and additionally runs materialize() as a
  golden-path check.
- `GET /healthz`: db + migrations + playbook catalog counts, no paths,
  no stack traces, no environment values.
- `Dockerfile` (multi-stage, `node:24-bookworm-slim`, non-root `node`
  user, HEALTHCHECK), `compose.yaml` (named volume, healthcheck, `ORIGIN`
  env var — see the security review note below),
  `.github/workflows/ci.yml` (lint/check/validate/unit/build/e2e, then
  amd64 Docker build on every push/PR, amd64+arm64 on `main`).
- `docs/adr/0001`–`0006`.
- `playbooks/bundled/test/minimal.yaml`: temporary bootstrap fixture,
  used only to prove the loader/catalog path before a real bundled
  playbook exists. Scheduled for removal from the bundled catalog at the
  start of Slice 3 (step S3.0), per the approved plan.

### Verification

| Command                                                     | Result                                       |
| ----------------------------------------------------------- | -------------------------------------------- |
| `npm run test:unit` (domain + server/db + server/playbooks) | **PASS**                                     |
| `npx eslint .`                                              | **PASS**                                     |
| `npx prettier --check .`                                    | **PASS**                                     |
| `npm run check` (`svelte-kit sync && svelte-check`)         | **PASS** (0 errors, 0 warnings)              |
| `npm run playbooks:validate`                                | **PASS** (1 bundled playbook OK)             |
| `npm run build` (`vite build`)                              | **PASS**                                     |
| Manual: `node build/index.js` + `curl /healthz` + `curl /`  | **PASS**                                     |
| `docker buildx build --platform linux/arm64 --load .`       | **NOT VERIFIED** — environmental (see below) |
| `docker compose up -d` + `curl /healthz`                    | **NOT VERIFIED** — blocked by the same issue |

**Docker verification — diagnosis:** every `docker pull`/`docker buildx build`
attempt against Docker Hub (`node:24-bookworm-slim`, and even the trivial
`hello-world` image) stalls indefinitely on this machine's Docker Desktop,
while the host's own network is fine (`curl` to `registry-1.docker.io`
succeeds immediately; Playwright's ~280 MB browser download from a
different CDN completed at full speed). This isolates the problem to
Docker Desktop's own registry-pull path, not the Dockerfile, compose
config, or the app.

**Update (during Slice 3/4):** Docker Desktop's daemon later came back to
a normal, API-responsive state (`docker info`/`docker version` answer
instantly) after a quit + relaunch, so the underlying daemon itself
recovered. A follow-up `docker pull node:24-bookworm-slim`, run once the
daemon was confirmed healthy, still stalled indefinitely with zero
progress after 3 minutes. This isolates the remaining problem
specifically to this Docker Desktop installation's image-pull/registry
path, separate from general daemon health.

Three attempts were made in total: (1) an initial `docker buildx build`
left for ~25 minutes with zero progress; (2) a full Docker Desktop quit +
relaunch, followed by a `docker pull hello-world`, which still stalled;
(3) a bounded retry after independently confirming the daemon was
API-responsive, which also stalled. All three point to an environmental
Docker Desktop issue on this machine (likely needing a host reboot or a
Docker Desktop reinstall/reset to fix), not something addressable from
inside this session, and not something the Dockerfile/compose content
can work around. Marked **NOT VERIFIED** for the whole implementation
rather than assumed to pass — no further attempts were made after this
point. The Dockerfile and compose.yaml are unchanged from Slice 1 onward
and should be re-verified once Docker Desktop's registry access is
healthy again.

### Product review

- No UI exists yet beyond a placeholder page; nothing to check against
  "Item → Action" grouping yet (that's Slice 3's gate). No risk of a
  generic task manager at this stage: there is no task list at all yet.
- Progressive data entry is already provable at the domain level: the
  playbook schema makes only `key`/`type`/`label` mandatory on a field,
  `recommended` is a separate, non-blocking flag, and nothing in the
  schema or the DB schema requires a field value to be present.

### Architecture review

- Domain code contains zero domain-specific (TÜV/NV/leasing) knowledge —
  confirmed by inspection; the only "playbook" bundled so far
  (`minimal.yaml`) is a generic bootstrap fixture, not a real
  administrative process.
- Bundled and custom playbooks go through the identical
  `loadAndValidate()` code path in `catalog.ts` — verified by a test that
  loads the same bundled playbook while pointing "custom" at the hostile
  fixture directory, and by the conflict test where a custom file with a
  colliding id is loaded through the same pipeline and still loses to
  the bundled entry.
- Persistence is isolated behind `server/db/`; nothing outside that
  directory imports `better-sqlite3` directly (enforced by the ESLint
  domain/application zones plus the fact that no other module does so
  today).
- Migrations are a single complete file per the approved amendment, so
  Slice 2/3 items created against this schema never need a backfill when
  Actions gain UI exposure in Slice 3 — see the Slice 2 forward-
  compatibility test below, which proves this directly.

### Security review

- Untrusted YAML (both bundled and custom) is parsed with aliases
  disabled (`maxAliasCount: 0`), merge keys disabled, unique-keys
  enforced, and parse warnings treated as fatal — verified against six
  hostile fixtures (alias bomb, oversized file, malformed YAML, duplicate
  keys, a `!!js/function` custom tag, and a symlink escape attempt), all
  rejected without crashing the scan.
- No code path executes anything from a playbook file; playbooks are
  pure data from parse through materialization.
- `/healthz` returns only counts and booleans — no file paths, no stack
  traces, no environment variable values.
- The structured logger (`server/log.ts`) never receives file contents,
  only file names and short reasons.
- No outbound network calls exist anywhere in `src/` outside `/healthz`
  itself doing a local `fetch` in the Docker HEALTHCHECK (which targets
  `127.0.0.1`, not an external host).
- **Finding, fixed:** `@sveltejs/adapter-node`'s CSRF origin check
  defaults to assuming HTTPS when no `PROTOCOL_HEADER`/`ORIGIN` is
  configured, which rejects every form POST with 403 on a plain-HTTP
  deployment (our exact target: `docker compose up -d`, no TLS
  termination assumed). Caught by manually exercising the _production
  build_ with `curl` (not `npm run dev`, which skips this check
  entirely) — a good example of why the manual smoke test against
  `node build/index.js` matters and isn't redundant with `vitest`/`vite
dev`. Fixed by setting `ORIGIN` in `compose.yaml` and in
  `playwright.config.ts`'s `webServer.env` (so Slice 3's E2E suite
  doesn't hit the same wall), and documented prominently in the README
  for operators who access the app via a different host/port.

### Remaining concrete issues

- Docker build/compose verification is environmentally blocked on this
  machine (see diagnosis above). Everything else about Slice 1 is fully
  verified.

---

## Slice 2 — Items, full materialization, custom fields

**Status: COMPLETE** (Docker verification still blocked by the same Slice 1 environmental issue)

### What was implemented

- `domain/playbook/materialize.ts` extended to a full
  `MaterializationPlan` (fields **+ events + actions + dependencies**),
  consumed at item-creation time — Slice 2 does not expose an Actions UI,
  but every item is fully materialized from day one (approved amendment
  5), so nothing needs a backfill when Slice 3 lands.
- Repositories: `itemRepository` (`createItem` — one transaction: item →
  cycle → fields → events → actions → dependencies), `cycleRepository`,
  `fieldRepository` (`addCustomField`/`removeCustomField`,
  `setFieldValue`), `eventRepository`, `actionRepository` (read paths
  plus `setActionState`/`addManualAction`, built now at the data layer
  since the domain algorithms already existed from Slice 1, but not yet
  wired into any route — that's Slice 3), `scheduleRepository`
  (`applyFieldUpdatesAndRecalculate`: one transaction that writes field
  values and recomputes every dependent event/derived-action due date).
- Application layer (`$lib/application`): `ports.ts` (repository
  interfaces the application layer depends on, never on `$lib/server/*`
  directly — enforced by the same ESLint zone from Slice 1),
  `createItem`, `getItemDetail`, `listItems`, `updateItemFields`,
  `addCustomField`, `removeCustomField`, `listPlaybooks`,
  `getPlaybookForCreation`. `$lib/server/appPorts.ts` wires the concrete
  SQLite/filesystem adapters to these ports; only route
  (`+page.server.ts`) files import from it.
- `$lib/i18n`: German UI catalog (`de.ts`, default and only selectable
  locale in V1) with an English catalog (`en.ts`) sharing the exact same
  key shape, so a real language switch later is a translation exercise,
  not a refactor. `resolveLabel()` resolves a playbook's English base
  label + optional `label_i18n` map for the current locale.
- Nav shell (`+layout.svelte`), global stylesheet (`app.css`, plain CSS,
  no framework).
- Routes: `/items` (list), `/items/new` (playbook picker + progressive
  form), `/items/[id]` (fields, custom field add/remove, save), plus a
  `/settings` page surfacing the playbook catalog and any load errors
  (per docs/adr/0003's "custom playbook errors are reported, app keeps
  running").
- `FieldInput.svelte`: renders `text`/`date` fields purely from field
  metadata (type/recommended/origin) — the exact same component for
  PLAYBOOK and CUSTOM fields, no branching on playbook id anywhere.
  `CustomFieldForm.svelte` for adding a field.
- `tests/e2e/progressive-item.spec.ts`: generic item creation, playbook
  item creation with the date field left empty then filled in on reopen,
  and custom field add — run against the production build.

### Verification

| Command                                                                                                                                                                                                                                                                                                       | Result                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `npm run test:unit` (163 tests total)                                                                                                                                                                                                                                                                         | **PASS**                                            |
| `npx eslint .`                                                                                                                                                                                                                                                                                                | **PASS**                                            |
| `npx prettier --check .`                                                                                                                                                                                                                                                                                      | **PASS**                                            |
| `npm run check`                                                                                                                                                                                                                                                                                               | **PASS** (0 errors, 0 warnings)                     |
| `npm run playbooks:validate`                                                                                                                                                                                                                                                                                  | **PASS**                                            |
| `npm run build`                                                                                                                                                                                                                                                                                               | **PASS**                                            |
| `npm run test:e2e` (3 Playwright specs, production build)                                                                                                                                                                                                                                                     | **PASS**                                            |
| Manual smoke test: full HTTP flow (create generic item, add/set/remove custom field, create item from a playbook, set its date field, verify the DB-level `DERIVED` action recalculates: `2028-08-31` + `{months:-7}`-style offset via the bundled test playbook's `{days:-7}` → `2026-12-25` → `2026-12-18`) | **PASS**                                            |
| `docker buildx build` / `docker compose up -d`                                                                                                                                                                                                                                                                | **NOT VERIFIED** — same Slice 1 environmental block |

### Product review

- Only the title is mandatory: verified by an integration test
  (`createItem` with an empty materialization plan) and an E2E test
  (create with title only, reopen, add the recommended date field
  later).
- Recommended fields are visibly marked "(empfohlen)" but never
  `required` in the DOM — asserted directly in the E2E spec.
- No Actions/What's Next UI exists yet, so there's nothing here that
  could read as a generic task list. The repository-layer action
  functions built ahead of schedule (`setActionState`, `addManualAction`)
  are exercised only by unit/integration tests in this slice, not wired
  into any route — this is a data-layer head start for Slice 3, not a
  feature exposed early.
- A generic item (no playbook) is no longer inert the way it would be
  without custom fields: it can carry user-defined text/date fields.
  Manual actions (the other half of "generic item usefulness", per
  decision D2) are deliberately deferred to Slice 3, where the rest of
  the Action surface exists.

### Architecture review

- `application/` imports only from `domain/` and its own `ports.ts` —
  confirmed by `eslint .` passing with the same boundary rules from
  Slice 1, now exercised by real application code instead of just the
  probe import.
- The playbook catalog is intentionally **not cached** in
  `appPorts.ts` (re-scanned per request): custom playbooks can be added
  to `/data/playbooks` while the app runs, and a stale cache would be a
  worse failure mode than re-parsing a handful of small YAML files per
  request. Documented inline as a deliberate simplicity trade-off, not
  an oversight.
- `createItem`'s repository transaction covers item + cycle + all
  fields/events/actions/dependencies; a forced mid-transaction failure
  (duplicate `action_key`) leaves zero rows anywhere — verified directly.
- **Playbook immutability (docs/adr/0004), verified directly**: three
  integration tests create an item from a playbook loaded off disk, then
  (a) modify the source YAML's offset and version and confirm the
  existing item's materialized action still uses the old offset, (b)
  delete the source YAML entirely and confirm the item is completely
  unaffected, and (c) confirm an item created through the Slice 2 path
  already has fully correct events/actions/dependency rows with no
  Slice-3-only backfill step required.
- A real ordering bug was found and fixed during this slice: `listItems`
  ordered by `created_at DESC` alone, which is not a total order when two
  items are created within the same millisecond (a real integration test
  caught this via flaky-looking output, not a hunch) — fixed by adding
  `rowid DESC` as a deterministic tiebreaker.

### Security review

- Custom field keys are always prefixed `c_` and manual action keys `m_`
  (already reserved at the playbook-schema level in Slice 1), so a
  user-created field/action can never collide with or shadow a
  playbook-authored one.
- `removeCustomField` refuses to remove a PLAYBOOK-origin field
  (`CannotRemovePlaybookFieldError`) — verified directly, including via
  a raw SQL-inserted PLAYBOOK field bypassing the normal creation path.
- Date-field values are validated against the ISO `YYYY-MM-DD` pattern
  in the application layer before being written or fed into
  `applyOffset()`; a malformed value is rejected with a typed error
  rather than silently corrupting a derived due date. A deliberately
  malformed value pushed straight past that guard (simulating a caller
  bug) demonstrated the schedule-recalculation transaction rolls back
  atomically rather than partially applying.
- Settings page exposes the configured custom-playbooks directory path.
  This is the operator's own configuration on their own self-hosted
  instance (no auth exists in V1 at all, by explicit scope), not a
  cross-tenant or untrusted-caller concern; noted as intentional, not
  overlooked.

### Remaining concrete issues

- Docker build/compose verification remains blocked by the same
  environmental issue noted under Slice 1.

---

## Slice 3 — Events, Actions, manual actions, What's Next

**Status: COMPLETE** (Docker verification unresolved as of writing; see below)

### What was implemented

- **S3.0**: bundled `de.vehicle.tuv` playbook (1 date field, 1 event, 2
  actions — `book_appointment` at `months:-1`, `attend_inspection`
  **at the event itself**). The bootstrap fixture `de.test.minimal` was
  moved out of `playbooks/bundled/` entirely into
  `tests/fixtures/playbooks/valid/`; a catalog test asserts the real
  bundled catalog never offers it.
- **Schema change**: `due.offset` is now optional in the playbook schema
  (defaults to `{}`, verified to bypass — not weaken — the "at least one
  non-zero component" refine on an _explicit_ empty offset). This is
  what lets a playbook express "due exactly at the event date", needed
  by `attend_inspection` and by Slice 4's NV/electricity/leasing
  playbooks.
- Action lifecycle: `application/actions/setActionState.ts` (thin
  wrapper — the actual `OPEN→DONE`/`OPEN→SKIPPED`-only enforcement lives
  in `domain/action/transitions.ts`, built in Slice 1) and
  `application/actions/addManualAction.ts` (label required, due date
  optional and validated as ISO when present, always attached to the
  item's active cycle — there is no "add task" entry point anywhere
  outside an item's own detail page).
- `application/items/getItemWorkflow.ts`: loads an item's actions
  together with whether each is currently `available` (dependencies
  resolved, and for DERIVED actions the due date resolved), so the item
  detail page can show a blocked step as "not yet available" instead of
  either hiding it or wrongly offering a Done/Skip button.
- `server/db/repositories/whatsNextRepository.ts`: loads every ACTIVE
  item's ACTIVE cycle, its OPEN actions, and each action's dependency
  states — the only input `domain/whatsnext/whatsNext.ts` (built and
  unit-tested in Slice 1) needs to rank and group.
- `application/whatsnext/getWhatsNext.ts`: the one-line use case tying
  the repository and the pure ranking function together with today's
  date from the `Clock` port.
- Routes: `/` (What's Next — replaces the Slice 1 placeholder; item
  groups with Done/Skip buttons per action), item detail page extended
  with a Workflow section (all actions, Done/Skip only where available,
  "not yet available"/"Erledigt"/"Übersprungen" otherwise) and a manual-
  action form. `ActionRow.svelte`, `ManualActionForm.svelte` components.
- **Real bug found and fixed**: playbook `label_i18n.de` translations
  were computed correctly by `normalize.ts` since Slice 1 but never
  actually reached the database or the UI — `materialize.ts` only
  carried the English base label through. Caught by the `tuv-flow` E2E
  test expecting German text and seeing English instead. Fixed by
  threading `labelI18n` through `MaterializationPlan` (domain, locale-
  agnostic) and resolving it in `application/items/createItem.ts` (the
  application layer, which is allowed to know "current locale" — domain
  and the repository deliberately are not). The resolved label is what
  gets frozen onto the item, consistent with the rest of the item being
  frozen at creation (docs/adr/0004).
- `tests/e2e/tuv-flow.spec.ts` and
  `tests/e2e/generic-item-manual-action.spec.ts` added;
  `progressive-item.spec.ts` extended.

### Verification

| Command                                                                                                                                                                                                          | Result                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `npm run test:unit` (188 tests total)                                                                                                                                                                            | **PASS**                                                         |
| `npx eslint .`                                                                                                                                                                                                   | **PASS**                                                         |
| `npx prettier --check .`                                                                                                                                                                                         | **PASS**                                                         |
| `npm run check`                                                                                                                                                                                                  | **PASS** (0 errors, 0 warnings)                                  |
| `npm run playbooks:validate`                                                                                                                                                                                     | **PASS** (now reports `de.vehicle.tuv`, not the removed fixture) |
| `npm run build`                                                                                                                                                                                                  | **PASS**                                                         |
| `npm run test:e2e` (5 Playwright specs)                                                                                                                                                                          | **PASS**                                                         |
| Manual smoke test: create a TÜV item via HTTP, set a past inspection date, confirm the rendered What's Next HTML shows `<h3>Testauto</h3>` immediately followed by its action row with the resolved German label | **PASS**                                                         |
| `docker buildx build` / `docker compose up -d`                                                                                                                                                                   | **NOT VERIFIED** (see below)                                     |

**Docker note:** Docker Desktop's daemon came back to a responsive state
partway through this slice (`docker info`/`docker version` answer
normally now, versus hanging during Slice 1/2). A follow-up
`docker pull node:24-bookworm-slim` still stalled indefinitely despite
the daemon itself being healthy — see the final diagnosis under Slice 1,
updated once this resolved during Slice 4. Docker verification remains
NOT VERIFIED for the whole implementation.

### Product review — explicit "Item → Action, not a generic task list" check

- Structural check of `routes/+page.svelte`: the template has exactly
  one loop over `data.groups`, and the only place an `ActionRow` is
  rendered is nested inside that loop's `<div class="item-group">`,
  directly under an `<h3>{group.title}</h3>`. There is no code path that
  can render an action without its item heading immediately above it.
- Confirmed with a raw HTTP/HTML check (not just the E2E DOM assertions):
  the server-rendered markup literally reads
  `<h3><a>Testauto</a></h3> ... <span>Prüftermin buchen</span>` with no
  intervening flattening.
- The domain algorithm itself (`buildWhatsNext`) groups by item as its
  fundamental data structure (`WhatsNextGroup { itemId, title, actions
}`) — there is no "all actions" list anywhere to accidentally render
  instead of the grouped one.
- Manual actions do not introduce a second, ungrouped surface: the only
  place to create one is `ManualActionForm.svelte`, embedded on the item
  detail page and always scoped to that item's cycle
  (`application/actions/addManualAction.ts` requires an `itemId` and
  resolves it to that item's active cycle before creating the action).
- No dashboards, no priority levels, no due-date-only sort ignoring the
  item — bucket ordering (overdue → ready-undated → future) is the only
  ranking dimension, exactly as specified.

### Architecture review

- `whatsNextRepository.ts` contains zero ranking/availability logic —
  verified by inspection: it only maps rows to the
  `WhatsNextItemInput`/`WhatsNextActionInput` shapes `buildWhatsNext`
  already expects; all six "critical rule" tests
  (unresolved-DERIVED-excluded, dependency-gating, bucket ordering, etc.)
  live in the Slice 1 pure-domain test suite and are exercised again
  here only at the integration level (real SQLite, real TÜV playbook).
- `getItemWorkflow` and `whatsNextRepository` both compute availability
  by calling the _same_ `domain/action/dependencies.ts` `isAvailable()` —
  no second, diverging implementation of "is this action ready" exists
  anywhere in the codebase.
- The `OPEN→DONE`/`OPEN→SKIPPED`-only rule is enforced in exactly one
  place (`domain/action/transitions.ts`, Slice 1) and both call sites
  (`actionRepository.setActionState`, reached from both the What's Next
  page and the item detail page) go through it — confirmed no route
  duplicates the transition logic itself.
- The i18n fix (see above) is a good example of the layering paying off:
  once the right layer was identified (application, not domain, not
  repository), the change was a single new function
  (`resolveLocaleForPlan`) with no change to any repository SQL and no
  change to the domain algorithms.

### Security review

- `addManualAction`'s due date goes through the same `isIsoDate()` guard
  as playbook date fields — a malformed manual due date is rejected with
  a typed error rather than silently stored or crashing `applyOffset`
  later (moot for `MANUAL` actions specifically, since their dates are
  never recomputed, but the validation is still enforced at the boundary
  for consistency and to keep the stored value meaningful).
- `setActionState` never trusts a client-supplied _current_ state — it
  re-reads the action from the database and calls
  `assertValidTransition(actual.state, requested)`, so a stale or forged
  form submission (e.g. resubmitting an old "mark done" request after the
  action was already completed by another tab) is rejected, not
  silently double-applied.
- No new outbound network calls, no new logging of user-entered content
  beyond what Slice 1/2 already established.

### Remaining concrete issues

- Docker build/compose verification: confirmed NOT VERIFIED (environmental, see Slice 1's final diagnosis).

---

## Slice 4 — Complex playbooks

**Status: COMPLETE** (Docker verification confirmed NOT VERIFIED, environmental — see Slice 1)

### What was implemented

- Three bundled playbooks, each structurally different from TÜV (Slice 3) and from each other:
  - `de.finance.nv-certificate`: one dated head action
    (`request_new`, `months:-2`), two undated followers
    (`check_receipt`, `forward_to_banks`) chained by `dependsOn` — proves
    a pure dependency chain with no dates on the later steps.
  - `de.contract.electricity`: two actions that are **both** dated _and_
    chained (`check_tariff` at `months:-3`, `cancel_or_switch` at
    `weeks:-6` depending on `check_tariff`) — proves dated-and-dependent
    is a supported combination, not just "dated OR dependent".
  - `de.vehicle.leasing`: a 3-deep chain
    (`start_replacement_planning` → `arrange_return_inspection` →
    `return_vehicle`) with three different offset shapes (`months:-9`,
    `months:-2`, and a zero offset — due exactly at lease end).
  - Golden tests (`bundledPlaybooks.test.ts`) assert the exact
    materialized shape (due kind, offset, dependency chain) of every
    action in all three, plus a golden-path test that all four bundled
    playbooks (TÜV included) load/validate/materialize with zero errors.
- Item detail's Workflow section (`getItemWorkflow`, built in Slice 3)
  is exercised here for the first time against a real multi-step,
  multi-dependency playbook rather than a 2-action one — no code change
  was needed, confirming the mechanism generalizes.
- `tests/e2e/nv-flow.spec.ts`: creates an NV item, confirms only
  `request_new` is visible on What's Next (the two later steps are
  correctly absent, not just unlabeled), completes it, and confirms
  `check_receipt` becomes visible while `forward_to_banks` still is not.
- Explicit domain-leakage check (see Architecture review below).

### Verification

| Command                                        | Result                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run test:unit` (191 tests total)          | **PASS**                                                                                |
| `npx eslint .`                                 | **PASS**                                                                                |
| `npx prettier --check .`                       | **PASS**                                                                                |
| `npm run check`                                | **PASS** (0 errors, 0 warnings)                                                         |
| `npm run playbooks:validate`                   | **PASS** (all 4 bundled playbooks OK)                                                   |
| `npm run build`                                | **PASS**                                                                                |
| `npm run test:e2e` (6 Playwright specs)        | **PASS**                                                                                |
| `docker buildx build` / `docker compose up -d` | **NOT VERIFIED** — confirmed environmental after a third, bounded attempt (see Slice 1) |

### Product review

- Verified the NV workflow's "only the first available action appears"
  claim end-to-end (not just at the domain-unit level): after creating
  the item, `check_receipt` and `forward_to_banks` are asserted absent
  (`toHaveCount(0)`), not merely "request_new is present". Completing
  `request_new` flips exactly that: `check_receipt` becomes visible,
  `forward_to_banks` still is not — proving one step activates at a
  time, never the whole remaining chain at once.
- Item context stays visible throughout the NV flow (every assertion in
  `nv-flow.spec.ts` is scoped inside the item's own `.item-group`).
- What's Next still shows nothing beyond items and their available
  actions for these more complex playbooks — no new UI surface was
  needed to support 3-deep chains or dated-and-dependent actions, which
  is itself evidence the screen hasn't drifted toward a generic task
  list to accommodate them.

### Architecture review — explicit domain-leakage check

- `grep -rniE "\bnv[_-]|tuv|leasing|electricity|strom|bescheinigung" src/ --include="*.ts" --include="*.svelte"`,
  filtered to exclude `*.test.ts` files, returns exactly two hits — both
  illustrative examples inside doc comments in `domain/item/item.ts` and
  `domain/event/event.ts` ("...e.g. 'Leasing ends 2028-08-31'"), never
  executable code. Every other hit is test data (playbook ids/titles used
  as realistic fixture values), which is the correct and expected use of
  such strings in tests exercising domain-agnostic code.
- No `if`/`switch`/equality check anywhere in `src/` branches on a
  playbook id, category, or domain keyword. The only thing that
  determines behavior per playbook is its YAML content, consumed
  entirely through the generic
  `schema → semanticValidation → normalize → materialize` pipeline built
  in Slice 1.
- All four bundled playbooks materialize through the exact same code
  path with no per-playbook special-casing — confirmed by the golden
  tests calling the identical `materializePlaybook()` function for each
  and asserting different (playbook-authored) shapes come out, not by
  different code paths.

### Security review

- No new untrusted-input surface was introduced: the three new bundled
  playbooks go through the same hardened loader/validator as every
  playbook since Slice 1. No new user input fields, no new file formats.

### Remaining concrete issues

- Docker build/compose verification remains environmentally NOT
  VERIFIED — see Slice 1's final diagnosis. No further attempts were
  made after the third bounded retry confirmed the issue is specific to
  this machine's Docker Desktop registry-pull path, not the app.
