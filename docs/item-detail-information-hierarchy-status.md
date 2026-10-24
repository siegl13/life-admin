# Item Detail Information Hierarchy Status

Goal: Item detail follows this order: action first, structured information, documents and context, history and secondary operations. Domain behavior stays unchanged. Target widths are 375, 390 and 430px plus a coherent desktop layout.

Five units run in order. Each depends on the one before it.

## Unit state

| Unit                           | State                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `group-model-migration`        | Complete. Automated gates passed (retry attempt 2). Independent review accepted.                                      |
| `group-management-playbooks`   | Complete. Automated gates passed (attempt 4). Independent review accepted (round 3, after round 1 and 2 corrections). |
| `page-action-hierarchy`        | Complete. Automated gates passed (attempt 7). Independent review accepted (round 3, after round 1 and 2 corrections). |
| `documents-contextual-history` | Complete. Automated gates passed in attempt 2. Independent implementation review accepted in round 2.                 |
| `acceptance-review`            | Complete. Responsive browser acceptance, attempt-10 verification and final independent review passed.                 |

Last completed unit: `acceptance-review`. Final independent review was accepted in round 8. All five units are complete in the existing supervisor run; changes remain uncommitted.

Current unit: none. All five units and final acceptance are complete. Optional isolated Docker verification was not performed.

## Remaining units

1. `acceptance-review`: complete. Optional isolated Docker verification was not performed.

## Acceptance gates (whole feature)

- Final whole-feature review in unit 5. Implementation reviews for units 1 to 4 are accepted.
- Unit-5 attempt 10 passed all three commands (127 test files, 1,102 tests, 212 E2E tests), including the final mobile navigation clearance correction. It supersedes attempt 8 for the final candidate. Earlier attempts remain historical evidence.
- Responsive browser acceptance completed with fictional travel, leasing, simple and
  custom Items at 375, 390, 430 and 1280px, with German/English and light/dark
  combinations. See the Unit 5 evidence below. Keyboard Group creation and no-JavaScript
  Group creation were also exercised.
- Optional Docker check in a dedicated Compose project. Not done.

## Unit 5: acceptance-review (current handoff)

State: complete. Responsive browser acceptance, full automated verification and
final independent review are recorded below.

### Changes and focused results

- Added a SQLite regression asserting that create, rename, move, feature, reorder and unfeature leave cycle state, all fields, events, actions and the frozen snapshot unchanged. It includes filled and empty fields.
- Strengthened rollover coverage with a renamed and reordered group, and verified that the prior cycle's field rows stay unchanged. Added the archived reorder guard to the repository test.
- README now explains action ownership, collapsed completed steps, group management, cycle persistence, documents and secondary operations. CONTRIBUTING now correctly describes General as initially last, rather than always last.
- `TMPDIR="$PWD/.agent/supervisor/item-detail-information-hierarchy-retry/tmp" npx prettier --write src/lib/server/db/repositories/fieldGroupRepository.test.ts README.md CONTRIBUTING.md`: passed.
- `TMPDIR="$PWD/.agent/supervisor/item-detail-information-hierarchy-retry/tmp" npx vitest run src/lib/server/db/repositories/fieldGroupRepository.test.ts`: passed, 1 file, 17 tests.
- `TMPDIR="$PWD/.agent/supervisor/item-detail-information-hierarchy-retry/tmp" npx eslint src/lib/server/db/repositories/fieldGroupRepository.test.ts`: passed, no findings.
- No UI or runtime types changed in the initial implementation turn. Its checks above predate the supervisor attempt and dependency correction below. Operational browser checks, Docker and web research were not run in that initial turn. Later browser smoke is recorded below. The supervisor owns the remaining gates.

### Verification attempt 1 and dependency correction (superseded by attempt 2)

- Supervisor attempt 1: `npm run verify` exit 0; `npm run test:e2e` exit 1 (139 passed, 17 failed, 54 not run). The first reported failure was `language-selection.spec.ts:21`, unable to import `@playwright/test`. Later workers could not load `playwright/lib/worker/workerProcessEntry.js`. The raw log points to dependencies in the parent checkout, rather than this worktree. No product assertion failure is reported in the failure section. Evidence: `.agent/supervisor/item-detail-information-hierarchy-retry/acceptance-review/verification/attempt-01.log` and `attempt-01-command-02.log:525-613`.
- Inspection confirmed this worktree had no `node_modules/@playwright/test` or `node_modules/playwright`. The precise cause of the parent dependency disappearance is unknown. Repeating the suite against that shared dependency location would not repair it. Installed the existing lockfile locally instead; no dependency versions, manifests, tests or security controls changed.
- Commands below used `TMPDIR="$PWD/.agent/supervisor/item-detail-information-hierarchy-retry/tmp"`. Browser installation and the focused test also used `PLAYWRIGHT_BROWSERS_PATH="$PWD/.agent/supervisor/item-detail-information-hierarchy-retry/tmp/browsers"`.
- `npm ci --cache .agent/supervisor/item-detail-information-hierarchy-retry/tmp/npm-cache --no-audit --no-fund --fetch-retries=0 --fetch-timeout=30000`: passed, 221 packages installed. npm reported install-script approval warnings; no approval policy was changed. A direct in-memory SQLite open/close succeeded, and `import.meta.resolve('@playwright/test')` resolved inside this worktree.
- `npm run build`: passed. `npx playwright install chromium`: passed, browser artifacts stored under the run-owned temporary directory.
- Port 4173 had no listener. Inspected the dedicated `.data-e2e` directory and its existing global setup before the focused run; used the standard disposable E2E data and fake providers.
- `npx playwright test tests/e2e/language-selection.spec.ts --retries=0 --output=.agent/supervisor/item-detail-information-hierarchy-retry/tmp/acceptance-language-results`: passed, 4 tests including setup, 6.7 seconds. This is the single focused E2E correction run, not a full-suite result or manual responsive acceptance.
- That dependency correction changed only status documentation and local ignored dependencies/artifacts. Its pending full E2E gate subsequently passed in attempt 2. Keep the worktree-local dependency installation stable during verification.

### Full verification attempt 2 and review round 1 corrections

- Supervisor acceptance attempt 2 passed `npm run verify`, `npm run test:e2e` and `git diff --check`, each exit 0. Raw results: **127 test files, 1,102 tests and 210 E2E tests passed**; Svelte check reported 0 errors and 0 warnings. This supersedes attempt 1's missing-dependency failure. Evidence checked: `.agent/supervisor/item-detail-information-hierarchy-retry/acceptance-review/verification/attempt-02.log`, `attempt-02-command-01.log:18,66-67` and `attempt-02-command-02.log:383`.
- Review round 1 F-01: the shared `.facts-group__label` now has `min-width: 0`, `max-width: 100%` and `overflow-wrap: anywhere`. Both viewing headings in `ItemFacts.svelte` and edit-form legends already use this class, so no markup change was needed. The earlier coverage used short group names and missed this valid 80-character boundary.
- Added a real group create/move/fill regression in `tests/e2e/field-groups.spec.ts`. It saves 80 unbroken `W` characters, moves and fills a Playbook field, and checks the complete label, multiple text lines, text/parent containment, retained field value and page width in viewing and editing modes at 375, 390 and 430px.
- F-01 focused commands, using `TMPDIR="$PWD/.agent/supervisor/item-detail-information-hierarchy-retry/tmp"`: `npx prettier --write src/app.css tests/e2e/field-groups.spec.ts` passed; `npx eslint tests/e2e/field-groups.spec.ts` passed; `npm run build` passed.
- After a free-port 4173 preflight and inspection of the disposable E2E directory, `npx playwright test tests/e2e/field-groups.spec.ts --retries=0 --output=.agent/supervisor/item-detail-information-hierarchy-retry/tmp/acceptance-groups-results` passed **4 tests including setup in 5.4 seconds**, with `PLAYWRIGHT_BROWSERS_PATH="$PWD/.agent/supervisor/item-detail-information-hierarchy-retry/tmp/browsers"`. No retry was needed.
- The first F-02 correction preserved attempt 2 and marked attempt 1 superseded. It predated the supplied attempt-3 result; the current result is recorded below. Manual responsive acceptance and independent review acceptance are still pending. No later unit was started.

### Full verification attempt 3 and review round 2 metadata correction

- Supervisor acceptance attempt 3 passed `npm run verify`, `npm run test:e2e` and `git diff --check`, **all exit 0**, after the round-1 corrections. Results: **127 test files, 1,102 tests and 211 E2E tests passed**. The maximum-length group-name regression passed in the full E2E run.
- Evidence compared: `.agent/supervisor/item-detail-information-hierarchy-retry/acceptance-review/verification/attempt-03.log:1-10`, `attempt-03-command-01.log:66-67` and `attempt-03-command-02.log:253,384`. This completes correction re-verification; it is no longer a pending automated gate.
- Review round 2 resolved F-01 and requested recording this newer result for F-02. Both tracked status documents now reflect attempt 3, rather than leaving its evidence only in local artifacts. This correction changes documentation only; no tests were rerun to record supplied results. Manual acceptance and independent review acceptance remain pending, and the unit remains in progress.

### Full verification attempt 5 and review round 4 metadata correction

- Supervisor acceptance attempt 5 passed `npm run verify`, `npm run test:e2e` and `git diff --check`, **all exit 0**, after the mobile navigation correction. Results: **127 test files, 1,102 tests and 212 E2E tests passed**. Both the phone-navigation clearance and maximum-length group-name regressions passed in the full E2E run.
- Evidence compared: `.agent/supervisor/item-detail-information-hierarchy-retry/acceptance-review/verification/attempt-05.log:1-10`, `attempt-05-command-01.log:66-67` and `attempt-05-command-02.log:253-254,385`. Attempt 4 passed before the navigation correction; attempt 5 completed its full re-verification. The later attempt 6 is recorded below.
- F-03: both status documents now record the supplied post-correction result. Earlier metadata updates recorded the evidence available before this newer gate. The stale automated-gate statements have been replaced throughout the current handoff. This correction changes documentation only; no tests were rerun to record supplied results. Outstanding manual checks below and independent review acceptance remain pending. The unit is not complete and no later unit was started.

### Verification attempt 6: Inbox cleanup navigation race

- Supervisor attempt 6: `npm run verify` exit 0; `npm run test:e2e` exit 1, **203 passed and 9 failed**. The first failure was the removal assertion in `inbox-redesign.spec.ts` after the 375px suggested-badge check. The next scenario could not enable AI because the previous cleanup stopped before disabling it. Later failures reported a leftover Inbox document. Evidence: `acceptance-review/verification/attempt-06-command-02.log:386-438,684-694` under the run directory.
- Inspected the failing trace's action and network records. Cleanup activated the document link, then immediately pressed Delete while navigation was still settling. Its heading assertion could already pass on the old view. No delete POST appears in the trace. This explains the intermittent failure and why an unchanged full rerun could pass without fixing the race.
- Updated only the `deleteIfPending` test helper to wait for the selected document's link destination before pressing Delete. It retains keyboard activation and the existing zero-row assertion. No application behavior, security control or test assertion was weakened. Earlier shared-state guesses did not address this navigation synchronization gap.
- Focused commands used `TMPDIR="$PWD/.agent/supervisor/item-detail-information-hierarchy-retry/tmp"`: `npx prettier --write tests/e2e/inbox-redesign.spec.ts` passed; `npx eslint tests/e2e/inbox-redesign.spec.ts` passed; `npm run build` passed (log: `.agent/supervisor/item-detail-information-hierarchy-retry/tmp/acceptance-inbox-build.log`).
- Port 4173 was free and the disposable `.data-e2e` directory was inspected before the run. With `PLAYWRIGHT_BROWSERS_PATH="$PWD/.agent/supervisor/item-detail-information-hierarchy-retry/tmp/browsers"`, `npx playwright test tests/e2e/inbox-redesign.spec.ts --grep 'suggested badge fits|768px|English status pill|singular and plural German' --retries=0 --output=.agent/supervisor/item-detail-information-hierarchy-retry/tmp/acceptance-inbox-results` passed **5 tests including setup in 7.0 seconds**. No retry was needed. This covers the first failure and the affected subsequent viewport/locale scenarios, not the full suite.
- Full re-verification of this correction subsequently passed in attempt 7, recorded below. Outstanding manual acceptance and independent review acceptance remain pending. No later unit was started.

### Full verification attempt 7 and review round 5 metadata correction

- Supervisor acceptance attempt 7 passed `npm run verify`, `npm run test:e2e` and `git diff --check`, **all exit 0**. Results: **127 test files, 1,102 tests and 212 E2E tests passed**. The previously failing Inbox cleanup scenario and subsequent viewport/locale scenarios passed.
- Evidence compared: `.agent/supervisor/item-detail-information-hierarchy-retry/acceptance-review/verification/attempt-07.log:1-10`, `attempt-07-command-01.log:66-67` and `attempt-07-command-02.log:271-275,385`. Attempt 6's full re-verification is complete; no automated gate remains pending for that correction.
- Review round 5 verified the cleanup wait against the actual document-link contract. F-04 records the newer passing gate in both tracked status documents and replaces stale pending statements. Earlier handoff metadata predated this supplied result. This correction changes documentation only; no tests were rerun to transcribe evidence. The next step is the outstanding manual acceptance below, followed by independent review acceptance. The feature remains in progress.

### Acceptance coverage and browser matrix

Coverage inspected during the initial handoff is listed below. The group-management spec was subsequently extended and rerun for F-01 as recorded above:

| Area                | Coverage                                                                                                                                                    | Remaining acceptance                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Group model         | Domain/application/repository tests: defaults, empty fields, migration, old snapshots, partition order, guards and rollover                                 | Automated gate passed in attempt 10 |
| Bundled definitions | `bundledPlaybookGroups.test.ts`: all six Playbooks, validation and materialization                                                                          | Automated gate passed in attempt 10 |
| Group UI            | `field-groups.spec.ts`: create, move, fill, feature, rename, unfeature, ordering, reload; manual keyboard and no-JS group edits                             | Automated gate passed in attempt 10 |
| Actions             | `item-detail-redesign`, `action-detail-ux`, `action-reopen`: hero ownership, open-first workflow, dates, reopen, due/snooze dialogs and ordinary POSTs      | Automated gate passed in attempt 10 |
| Documents/history   | `attachments`, `ai-extraction`, history application and locale tests: thumbnails/icons, opening/management, long names, semantic source and legacy fallback | Automated gate passed in attempt 10 |

Browser smoke used an isolated fake-provider server and disposable data. It created
fictional travel, leasing, simple Playbook and custom Items and captured 16 views:
each at 375, 390, 430 and 1280px. The width combinations covered DE/light, DE/dark,
EN/light and EN/dark. Travel had populated fields, three documents and an Action
completion/reopen pass; leasing had populated vehicle fields and an image; simple
Playbook fields were populated; the custom Item created a Group, moved a Field and
featured it. Screenshots and measurements are in
`.agent/supervisor/item-detail-information-hierarchy-retry/tmp/manual-responsive-screenshots/`
and `manual-responsive-results.json`.

All 16 views reported no horizontal overflow, page errors or console errors. The
custom Item's upload picker intersected the fixed tab bar in its initial 375px
position. The duplicate header “Weitere Möglichkeiten” jump link is now hidden on
phones, while the lower operations remain. A targeted E2E regression confirms the
375px upload picker is clear of the tab bar; it passed (2 tests including setup).
The final 16-view probe reports no picker/tab-bar overlap. A targeted E2E regression
also asserts clearance. Keyboard group creation worked using Tab and Enter with a
visible focus outline. A no-JavaScript browser context created another group using
the ordinary form and native details disclosure. Existing E2E coverage exercises
JavaScript-disabled document, action and archive flows, and action-dialog Escape/
error recovery.

The browser smoke also captured archived read-only state at phone and desktop sizes,
created and moved a Group through ordinary forms with JavaScript disabled, tabbed
through all Group controls with visible focus, and checked the document viewer's
CSP header. Action-dialog focus/error behavior and the wider lifecycle matrix remain
covered by E2E tests. Supervisor attempt 10 passed `npm run verify`,
`npm run test:e2e` and `git diff --check` after the final mobile navigation
correction: 127 test files, 1,102 unit tests and 212 E2E tests passed. Optional
isolated Docker verification was not run. Final independent review was accepted
in round 8 with no open findings.

### Actual-diff self-review and integration state

- Inspected the complete tracked diff against current `origin/main` and all 11 untracked deliverables. The grouping model, migration, routes, components, CSS, bundled definitions, translations, docs and changed E2E assertions remain within feature scope. No tests were deleted or disabled. Assertions for superseded sticky/type-group layouts were replaced; lifecycle, reopen, overflow and management coverage remains.
- The original feature HEAD (`308f2594`) had no branch-only commits and was an ancestor of current `origin/main` (`fedf48b7`). Its two initial ahead commits (#51 and #52) are already in current main. The branch was aligned to origin/main with a backup branch and safety stash before restoring the uncommitted feature. PR #58 changes were retained during conflict resolution. Fresh verification after alignment is recorded in the final handoff.
- Units 1 to 4 are present as uncommitted prerequisites in this same worktree and have the supervisor results recorded above. No work was copied from another worktree. Review and verification must use the whole working tree, including untracked deliverables.
- No temporary handoff document exists under `docs/*handoff*`. This status and `docs/implementation-status.md` carry the current state. No later unit was started. Nothing was staged, committed, pushed, published or deployed.
- After alignment with `origin/main` at `fedf48b7`, current-main action-control assertions were updated to match the Item Detail hero card and collapsed completed-step disclosure. The upload-picker scenarios remain unchanged. Focused affected E2E specs passed 14/14; `npm run verify` passed with 132 test files and 1,216 tests; the full `npm run test:e2e` passed all 222 tests. `git diff --check` passed. PR #58 manual Action descriptions and document-history payload behavior were retained during conflict resolution.

## Unit 4: documents-contextual-history

State: complete. Full verification attempt 2 passed after the overflow correction (127 test files, 1,101 tests, 210 E2E tests and clean diff checks). Independent implementation review was accepted in round 2 with no open findings and approval to proceed to acceptance-review. Whole-feature manual acceptance remains pending in the current unit 5.

### Changed behavior and review

- Document previews use 48px thumbnails or a PDF file icon, reduced to 44px on phones. Preview, truncated filename and Open stay in one row on phones. Metadata, original filenames, viewer links, rename and removal forms remain available.
- New accepted-suggestion events store `acceptedCount`, `source: 'DOCUMENT'` and the source `attachmentId` when available. No filename, user label or localized text is stored in the event. Each durable sub-operation still records its own event, including when the following operation fails.
- Item detail resolves document display names from its own attachment list at read time. Renames appear in history. Deleted documents use unnamed document wording. Legacy events keep generic wording without invented provenance. Rendering chooses German or English singular/plural text.
- Inspected the actual unit diff, including CSS, both document components, history payload/loading/rendering, route wiring, translations and tests. Strengthened tests that swallowed exceptions to assert the successful redirect or foreign-item 404 and absence of writes. Added rename-at-read-time coverage with an unchanged semantic payload.
- Existing E2E coverage checks PDF icons, phone row size and touch targets, image previews, long filenames, opening, renaming, deletion and named singular/plural suggestion history. No separate manual browser inspection was performed in this unit.

### Latest full verification and review corrections

- Supervisor `verification/attempt-02.log` records exit 0 for `npm run verify`, `npm run test:e2e` and `git diff --check` after the review corrections. Results: 127 test files / 1,101 tests and 210 E2E tests passed. This supersedes attempt 1 and the earlier timeout and eight E2E failures below. Independent implementation review `reviews/round-02.md` reports no open findings and accepts proceeding to acceptance-review. Evidence directory: `.agent/supervisor/item-detail-information-hierarchy-retry/documents-contextual-history/`.
- F-01: `.history-event__text` now has `min-width: 0` and `overflow-wrap: anywhere`. The real suggestion-acceptance flow uses a 200-character unbroken filename and checks history-row containment, text overflow and page width at 375, 390, 430 and 1280px.
- F-01 focused verification: `npm run build` passed; `npx playwright test tests/e2e/ai-extraction.spec.ts` passed (3 tests including setup). The first focused run failed because an exact-text selector omitted the source paragraph's prefix, then the second test timed out because AI stayed enabled. The selector was corrected to match the full paragraph; the single retry passed.
- Round-1 F-02: both status documents record the passing supervisor gate and label the earlier failures historical. Attempt 2 verified the corrections and round 2 accepted the implementation review. Round-3 metadata corrections record completion and put concrete evidence and dependency readiness directly in the tracked implementation-status document. Whole-feature manual acceptance remains pending.

### Historical direct verification on 2026-10-24 (superseded by attempt 1)

Commands used `TMPDIR=.agent/supervisor/item-detail-information-hierarchy-retry/tmp`.

- `npx vitest run src/lib/application/history/itemHistory.test.ts src/lib/i18n/index.test.ts 'src/routes/items/[id]/suggestions/[runId]/page.server.test.ts'`: 3 files, 22 tests passed. Not repeated.
- `npm run verify`: passed. Formatting, ESLint, Svelte check (0 errors/warnings), all 6 bundled Playbooks, 127 test files / 1,101 tests and production build passed. Log: `.agent/supervisor/item-detail-information-hierarchy-retry/tmp/documents-verify.log`.
- First `npm run test:e2e`: interrupted by the tool's 120-second timeout after 189 passing tests. The leftover server was identified by PID, creation time and this worktree's working directory, then stopped. Port 4173 was confirmed free before retry.
- Historical full `npm run test:e2e` retry with a 600-second timeout: **202 passed, 8 failed**, superseded by the supervisor's 210-test pass. All attachments, AI extraction and item-detail specs passed. Log: `.agent/supervisor/item-detail-information-hierarchy-retry/tmp/documents-e2e-retry.log`.
- Failures: `inbox-redesign.spec.ts:435,534,559`, `inbox.spec.ts:67,132,179`, `whats-next-side-panel.spec.ts:285,299`. The first failure is a document still listed after removal (expected count 0, received 1). Later failures include unexpected pending Inbox counts (expected 1, received 2). Root cause is not established. No unrelated Inbox code or tests were changed and no further suite retries were made.

- Final `git diff --check`: passed before alignment. Re-run after current-main reconciliation. All specification SHA-256 hashes remain unchanged. No changes have been staged, committed or pushed.

No specification file was edited or formatted. No staging, commit, push, release or deployment was performed. This unit's independent implementation review is accepted. Whole-feature manual acceptance and final unit-5 review remain pending.

## Unit 1: group-model-migration

### Constraints found before implementation

- `Field` rows live in `cycle_fields`, owned by a cycle. They have a stable `field_key`, `origin` (`PLAYBOOK` or `CUSTOM`) and `position`. There was no group metadata.
- Playbook, custom and document-derived fields (`extractionRepository.addAdditionalFields` uses `insertCustomFieldRow`) share the one table.
- Cycle rollover (`planNextCycleFields`, `cycleRepository.startNextCycle`) rebuilds fields from the frozen `items.playbook_snapshot` and carries custom fields forward by `field_key`. It never reads bundled YAML.
- The Playbook schema is strict and has no group definitions. Item creation goes through `materializePlaybook` then `createItemInTransaction` (also used by the inbox route).
- Item detail presentation groups fields by type in `ItemFacts.svelte` (lines 10 to 24). `FieldInput` renders the edit form. Nothing about grouping is stored in the data model. This unit does not change that presentation.
- No existing materialized metadata says which field belongs to which group, so nothing can be migrated safely except to General.

### Selected approach

Groups are item-owned, not cycle-owned. Assignments are keyed by `(item_id, field_key)`. Because rollover keeps `field_key` stable, groups, assignments, order and featured state persist through new cycles with no copy step and no change to rollover or value reset rules.

Migration `0019_item_field_groups.sql`:

- `item_field_groups(id, item_id, label, is_default, featured, position)`. Exactly one default group per item (unique partial index). The default has `label NULL` and renders as localized General (Allgemein) in a later unit. Non-default groups require a label.
- `item_field_group_assignments(item_id, field_key, group_id)`. No row means the field is in the default group.
- Backfill: every existing item gets only a default group. No field moves, no snapshot changes, no bundled Playbook is applied to existing items.

Domain (`src/lib/domain/field/fieldGroup.ts`): `FieldGroup`, `orderFieldGroups` (featured first, stored position order kept inside each partition), `groupFields` (unassigned or orphan assignment falls back to General, keeps empty groups, splits filled and empty fields without dropping any).

Materialization: `MaterializationPlan.groups?` and `FieldPlan.groupKey?` are optional and used only by `insertInitialFieldGroups` at item creation. The Playbook schema does not produce them yet (that is unit 2). `resolvePlanLocale` resolves group labels.

Repository (`fieldGroupRepository.ts`): list, create, rename, set featured, reorder (must list every group once), move field. All writes are guarded by `assertItemIsWritable`, reject groups or fields of another item, and never touch field rows or values. Removing a custom field drops its assignment unless an earlier cycle still has that key. New custom and document-derived fields (`insertCustomFieldRow`) never reuse a field key that exists in any cycle of the Item or in a retained assignment, so a recreated same-label field gets a fresh key and starts in General.

Application: `FieldGroupRepositoryPort`, `application/items/fieldGroups.ts` (label trim and 1 to 80 chars, `loadFieldGroupViews`), wired as `fieldGroupsPort` in `appPorts.ts`. Feature state is only set through the explicit `setFieldGroupFeatured` use case.

Not in this unit: UI, form actions, Playbook schema, bundled Playbook groups, i18n strings.

### Focused checks run

- `npx vitest run src/lib/domain src/lib/server/db src/lib/application src/lib/server/appPorts`: 88 files, 709 tests passed.
- `npx svelte-check --threshold error`: 0 errors, 0 warnings.
- `npx eslint` on the changed source directories: no findings.
- `npx prettier --write` on changed files.

Tests added: `fieldGroup.test.ts` (ordering, default fallback, empty fields), `fieldGroupRepository.test.ts` (default group, playbook-seeded groups, custom fields in General, create/rename/move/feature/reorder, foreign targets, archived guard, assignment cleanup, new-cycle persistence with value reset, migration backfill, frozen snapshot unchanged), `application/items/fieldGroups.test.ts`.

Review round 1 correction: `npx vitest run src/lib/server/db/repositories/fieldGroupRepository.test.ts src/lib/server/db/repositories/fieldRepository.test.ts src/lib/server/db/repositories/extractionRepository.test.ts`: 3 files, 57 tests passed. Added a regression for rollover, removal and same-label recreation.

### Original session verification (before the round 1 correction)

- `npm run verify`: passed (126 test files, 1,057 unit and integration tests).
- `npm run test:e2e`: passed (205 Chromium tests).
- `git diff --check`: passed.

These results predate the field-key correction and are superseded by the retry session attempt 2 below. Browser and Docker checks were not run.

### Retry session re-inspection

Worktree re-inspected on `feature/item-detail-information-hierarchy` against `main`. Implementation was already present and unchanged by this session, except `.gitignore`: added `!docs/item-detail-information-hierarchy-status.md` so this status file is trackable like the other status docs (`docs/*` is otherwise ignored).

- `npx vitest run src/lib/domain/field src/lib/application/items src/lib/server/db/repositories/{fieldGroupRepository,fieldRepository,extractionRepository,itemRepository}.test.ts`: 15 files, 135 tests passed.
- `npx svelte-check --threshold error`: 0 errors, 0 warnings.

Full `npm run verify` and `npm run test:e2e` were not run in this session. The supervisor ran them after the field-key correction (next section).

### Retry session verification (attempt 2, after the field-key correction)

- `npm run verify`: passed (126 test files, 1,058 unit and integration tests).
- `npm run test:e2e`: passed (205 Chromium tests).
- `git diff --check`: passed.

Retry session attempt 1 failed at `prettier --check` on this status file only. It was formatted and retry attempt 2 passed. Browser and Docker checks were not run. Independent review of this unit was accepted after retry attempt 2. Whole-feature manual and responsive gates stay pending (unit 5).

### Remaining risks (unit 1)

- Renaming the default group replaces its localized General label with the typed name.
- An item row inserted by raw SQL without a default group (tests only) yields no group views. All app paths and the migration create one.
- Field keys of deleted custom fields are never reused within an Item, so repeated delete and recreate produces suffixed keys (`c_notes_2`).

## Unit 2: group-management-playbooks

State: complete. Automated gates passed in attempt 4 after the review round 1 correction (`npm run verify`, `npm run test:e2e`, `git diff --check`, all exit 0). Independent review accepted in round 3: round 1 finding F-01 (blank labels) and round 2 finding F-02 (verification record) were verified resolved, and round 3 raised only this completion record.

### Changed behavior

- Item detail shows fields by item-owned group (`ItemFacts.svelte` now takes `FieldGroupView[]`). The type-based grouping (Termine, Beträge, Weitere Angaben) and its `factsGroup*` strings are removed. Featured groups come first. Only filled rows show. One aggregate "n empty details" disclosure lists every empty field across groups, with the same add-value link as before.
- The Angaben edit panel renders every field (empty ones included) in a fieldset per group, so empty fields stay editable. Save semantics are unchanged.
- New "Manage groups" disclosure inside the edit panel (`FieldGroupManager.svelte`). It works without JavaScript: add group, rename, feature or unfeature, move up or down inside the featured or non-featured list, and move one field to a group. Actions in `items/[id]/+page.server.ts`: `addFieldGroup`, `renameFieldGroup`, `moveFieldToGroup`, `setFieldGroupFeatured`, `moveFieldGroup`. All check the archive guard first, map label and target errors to 400, and redirect to `?manage=groups#field-groups` (keeps the panel open). They write no history events.
- Use case `moveFieldGroup` (`application/items/fieldGroups.ts`) swaps a group with its neighbour in the same featured partition and rewrites the full order. Groups of the other partition keep their stored positions. Feature state is only set by `setFieldGroupFeatured` from an explicit form value of `true`.
- Playbook schema: optional `groups` (`key`, `label` up to 80 chars, `label_i18n`, max 20) and optional field `group`. Semantic validation rejects duplicate group keys and unknown group references. Normalization, snapshot schema and materialization carry them. `groups` and `group` are optional in the frozen snapshot schema, so snapshots frozen before this unit still validate and materialize with no groups. Groups are read at item creation only (`insertInitialFieldGroups`, unit 1). Existing Items are not changed.
- Bundled Playbook versions were bumped because their definitions changed: electricity 1.1.0 to 1.2.0, leasing 1.1.0 to 1.2.0, TÜV 1.1.0 to 1.2.0, travel 1.0.0 to 1.1.0, maintenance 1.0.0 to 1.1.0. Existing Items show the existing "newer Playbook version" hint and are not updated. No `package.json` version or CHANGELOG change.
- Docs: CONTRIBUTING.md (vocabulary, limits, example) and README.md (Group concept).

### Bundled Playbook audit

Group labels are the German `label_i18n`. General (Allgemein) is the default group, initially last. Users can reorder or feature it.

| Playbook                               | Groups (fields)                                                                                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `de.travel.booking` (travel)           | Reise (destination, trip_start, trip_end); Buchung (provider, booking_number, insurance_number); Zahlung und Storno (balance_due_date, balance_amount, free_cancellation_until, total_price)                                                     |
| `de.vehicle.leasing` (leasing/vehicle) | Fahrzeug (vehicle, license_plate); Vertrag (lessor, contract_number, lease_end, contract_term, dealer_return_location); Zahlungen (monthly_rate, special_payment); Kilometer (annual_mileage, mileage, excess_mileage_rate, unused_mileage_rate) |
| `de.contract.electricity` (contract)   | Vertrag (provider, customer_number, contract_end, notice_period); Zähler und Verbrauch (meter_number, market_location_id, annual_consumption); Tarif und Kosten (tariff_name, energy_price, base_price, monthly_payment)                         |
| `de.vehicle.tuv` (simple)              | Fahrzeug (license_plate, vehicle, vin); Prüfung (next_inspection, inspection_organization)                                                                                                                                                       |
| `de.home.maintenance`                  | Anlage / Gerät (equipment, manufacturer, model, serial_number, location); Dienstleister und Kosten (service_provider, customer_contract_number, cost); Wartungsplan (last_maintenance, next_maintenance, maintenance_interval)                   |
| `de.finance.nv-certificate`            | No groups. Two fields only, so General alone is the clearest layout. Unchanged, version 1.0.0.                                                                                                                                                   |

Playbook-seeded groups never start featured.

### Tests added or updated

- New: `src/lib/server/playbooks/bundledPlaybookGroups.test.ts` (audit of all six bundled Playbooks, seeded group and field assignment per Playbook, General last and empty), `tests/e2e/field-groups.spec.ts` (create, move field, fill, feature, reload persistence, rename, unfeature, custom field in Allgemein, empty count and editing).
- Extended: `schema.test.ts`, `semanticValidation.test.ts`, `materialize.test.ts`, `snapshot.test.ts` (groups, unknown group, duplicates, limits, pre-groups snapshot), `application/items/fieldGroups.test.ts` (`moveFieldGroup`), `items/[id]/page.server.test.ts` (group actions, archived guard, label error).
- Updated for the superseded type grouping: `tests/e2e/item-detail-redesign.spec.ts` (TÜV facts now Fahrzeug, Prüfung, Allgemein) and `tests/e2e/ai-extraction.spec.ts` (long value now in Fahrzeug).

### Focused checks run (this session)

- `npx svelte-kit sync`, then `npx svelte-check --threshold error`: 0 errors, 0 warnings.
- `npx tsx scripts/validate-playbooks.ts`: all 6 bundled Playbooks ok.
- `npx vitest run src`: 126 files, 1,093 tests passed.
- `npx eslint src tests scripts`: no findings.
- `npx prettier --check` on tests, `src`, `playbooks`, `CONTRIBUTING.md`, `README.md`: clean.

The implementation session could not run `npm run` or `lsof` (approval unavailable), so full verification came from the supervisor (next section).

### Supervisor verification

- Attempt 1: `npm run verify` passed. `npm run test:e2e` failed on three selector problems in `field-groups.spec.ts` and `item-detail-redesign.spec.ts` (group legends in the edit form matched `.facts-group__label`, and `getByLabel('Fahrzeug')` matched the new fieldset). Fixed in the specs.
- Attempt 2: `npm run verify` passed. `npm run test:e2e` did not start because port 4173 was in use (environment, no code change).
- Attempt 3: `npm run verify` exit 0, `npm run test:e2e` exit 0, `git diff --check` exit 0. This includes the new and updated Playwright specs.
- Review round 1 finding F-01 (blank group labels): group labels, including `label_i18n` entries, must now be non-blank after trimming, in the raw Playbook schema and the frozen snapshot schema (`groupLabelSchema` in `validators.ts`). Regression tests added in `schema.test.ts` and `snapshot.test.ts`. Focused re-check: `npx vitest run src/lib/domain/playbook src/lib/server/db/repositories/fieldGroupRepository.test.ts src/lib/server/playbooks`: 12 files, 143 tests passed. `npx svelte-check --threshold error`: 0 errors.
- Attempt 4 (after the F-01 correction): `npm run verify` exit 0 (127 test files, 1,095 tests), `npm run test:e2e` exit 0 (207 tests), `git diff --check` exit 0. This supersedes attempt 3.

Still pending: the whole-feature manual and responsive gates (unit 5). Browser and Docker checks were not run.

### Remaining risks (unit 2)

- Group management changes are not recorded in item history.
- The manage form moves one field per submit (no drag and drop).
- Playbooks cannot feature a group, by design.

## Unit 3: page-action-hierarchy

State: complete. Automated gates passed in attempt 7 (`npm run verify`, `npm run test:e2e`, `git diff --check`, all exit 0), after review round 1 corrections. Independent implementation review accepted in round 3. Whole-feature manual and responsive acceptance stays pending in `acceptance-review` (unit 5).

### Changed behavior

- Page order (phone and desktop): header, next action card, completion panel, workflow, grouped fields, notes, documents, related Items, history, then "More options" (add task, archive). "More options" moved out of the main column to a last, full-width block after the main/side layout. The header "More options" link still points to `#more-label`. Desktop keeps the main column with a side column for documents, related Items and history.
- Workflow (`WorkflowTimeline.svelte`): open steps (available and waiting) are listed first in workflow order. DONE and SKIPPED steps move into one native `<details class="timeline-closed">` ("Erledigt und übersprungen (n)" / "Done and skipped (n)"), collapsed by default, works without JavaScript. Dates, state words and the reopen form are unchanged inside it. The progress summary still counts both kinds. Step markup is one shared snippet, so rendering is not duplicated. Step order, dependency blocking, due override, snooze and dialogs are unchanged.
- Primary controls: the next action card shows complete and skip for the next available action at every width, with or without a due date. "Change due date" stays secondary and only appears when the existing eligibility rule allows it. Snooze stays secondary in the workflow step.
- Sticky resolution: the fixed phone bar (`.sticky-action-bar`, its markup, CSS and the extra bottom padding) is removed. Its controls sat detached from the action while unrelated content scrolled. The card that names the action now owns the controls at every width, so scope is clear and nothing is `position: fixed` on the page. The create button stays hidden on the detail route (unchanged rule, comment updated).
- Not changed: dependency eligibility, blocked reasons, action lifecycle, due-date rules, snooze, archive and read-only guards, error recovery dialogs, server actions, data model.
- i18n: `items.detail.workflowClosed` (DE and EN).

### Tests added or updated

- `tests/e2e/item-detail-redesign.spec.ts`: updated for the removed sticky bar (hero controls at 375, 390 and 641 to 768px, no fixed elements, no-JavaScript hero form, reopen through the expanded disclosure). New: page order test, closed-steps test (collapsed, count, date, expand, reopen), undated manual action has complete and skip in the card. The gap test now measures "More options" against `.item-detail-layout`.
- `tests/e2e/action-detail-ux.spec.ts`, `action-reopen.spec.ts`, `whats-next-redesign.spec.ts`: use the card controls and expand the closed-steps disclosure before reopening.
- No unit test changed. The behavior sits in Svelte components that this repository covers with Playwright.

### Focused checks run (this session)

- `npx svelte-kit sync`, then `npx svelte-check --threshold error`: 0 errors, 0 warnings.
- `npx eslint` on the changed components, layout and the four edited specs: no findings.
- `npx prettier --write` on the changed files.
- `npx vitest run src/routes/items src/lib/ui`: 5 files, 89 tests passed.

Historical: the implementation session could not run `npm run build`, Playwright or `lsof` (approval unavailable). The supervisor ran the gates, see below. Browser and Docker checks were not run.

### Remaining risks (unit 3)

- The E2E specs changed in this unit, including the round 1 F-01 skip-flow spec, passed in supervisor attempt 7.
- Phone users must scroll back up to the card to complete the action (no fixed bar). Intentional, to keep the control attached to its scope.
- Waiting (blocked) steps still show only a complete control, as before.
- Other specs that read a DONE step's controls may need the disclosure expanded. Found and updated by grep: `action-reopen`, `whats-next-redesign`, `item-detail-redesign`.

### Supervisor verification (unit 3)

Attempt 7 is the current result and supersedes attempts 1 to 6 below, which are kept as history only.

- Attempt 1: `npm run verify` exit 0. `npm run test:e2e` exit 1: one failure, `item-detail-redesign.spec.ts` "More options cards match the item detail facts-card width". "More options" now spans the full content width below the layout (expected right edge 910.5, got 1260). Correction: the test now asserts the cards start at the facts card, reach at least as far right and stay inside the viewport. No product code changed. Re-check by the supervisor pending. Focused: `npx eslint` and `npx prettier` on the spec clean.
- Attempt 2: `npm run verify` exit 0. `npm run test:e2e` did not start: `http://localhost:4173 is already used`. Environment blocker (port owner unknown, not terminated), no code change. The attempt 1 failure correction is therefore still unexecuted. E2E needs a free port 4173.
- Attempt 2 and its occupied-port blocker are historical. Attempt 3: `npm run verify` exit 0, `npm run test:e2e` exit 0, `git diff --check` exit 0. This includes the corrected "More options" spec.
- Review round 1 F-01 (medium): skipped steps now show their stored date like done steps (`WorkflowTimeline.svelte`), and the skip flow test asserts the date and reopens the skipped action. F-02 (low): this record. Focused re-check pending the supervisor: `npx playwright test tests/e2e/item-detail-redesign.spec.ts`, then the full gates. Independent review and manual acceptance stay pending.
- Attempt 4 (after the F-01 correction): `npm run verify` exit 0. `npm run test:e2e` did not start: `http://localhost:4173 is already used`. Environment blocker, no code change. The F-01 skip-flow spec is not yet executed. E2E needs a free port 4173.
- Attempt 5: `npm run verify` exit 0. `npm run test:e2e` did not start: `http://localhost:4173 is already used`. Same environment blocker as attempts 2 and 4, no code change. The F-01 skip-flow spec and the "More options" width fix remain unexecuted. E2E needs a free port 4173.
- Attempt 6: `npm run verify` exit 0. `npm run test:e2e`: 200 passed, 10 failed, all in Inbox specs (`inbox-redesign.spec.ts`, `inbox.spec.ts`, `whats-next-side-panel.spec.ts`). Cause looks like shared Inbox state, for example "1 document in the inbox" expected but "2 documents" shown. This unit changes no Inbox code, route or spec, and no item-detail spec failed, so the F-01 skip flow and the "More options" width fix passed. Likely cause: leftover pending Inbox documents in `.data-e2e` from earlier runs. Not verified, and no data was deleted. Needs `.data-e2e` inspected and cleaned by its owner, then an E2E re-run.
- Attempt 7 (current, after the F-01 correction): `npm run verify` exit 0 (127 test files, 1,095 tests passed), `npm run test:e2e` exit 0 (210 tests passed), `git diff --check` exit 0. This supersedes the occupied-port blockers (attempts 2, 4, 5) and the Inbox failures (attempt 6). Review round 1 F-01 and F-02 are corrected and the independent review was accepted in round 3. The whole-feature manual and responsive gates (unit 5) and the optional Docker check stay pending. Browser and Docker checks were not run.
