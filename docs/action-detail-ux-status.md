# Action detail UX

Status: **complete / READY**. Final full verification passed: 115 unit-test files, 936 unit tests and 100 E2E tests. The round-3 independent review found no open code findings. Responsive browser inspection is complete (375/390/430px and desktop, Chromium). All findings across rounds 1-4 are resolved; no known requirement gap remains.

## Baseline

Started from a clean `release/0.1.0-beta.2` worktree (no local changes) at commit `714c35bf` ("Prepare release v0.1.0-beta.2"). `WorkflowTimeline.svelte` originally rendered the due-date editor and snooze presets as always-expanded inline controls, with primary Mark done/Skip placed after them, and no focused-surface, failure-recovery, or mobile-hierarchy handling.

## Scope

Compact Action controls in the Item workflow (`WorkflowTimeline.svelte`), used inside the Item detail page's "Ablauf" section. No domain, persistence, route or endpoint changes beyond carrying failed-submission context back to the component. This is a standalone unit. No next unit or dependency handoff is planned.

## What changed, by round

**Round 1** — compact action-first redesign: primary Mark done/Skip moved ahead of secondary controls; snooze presets and the due-date editor collapsed behind disclosures; removed a readiness hint that duplicated the state badge; added focused E2E coverage.

**Round 2** (supervisor round-01 corrections):

- **F-01**: Replaced the inline `<details>` disclosures with one native `<dialog class="action-dialog">` per editor (due-date, snooze), opened via `showModal()` from a compact `.timeline__secondary-trigger` button. Native focus trap, Escape-to-close, `::backdrop`, and `aria-labelledby` titles. No-JS fallback: every dialog renders statically `open`; a `$effect` closes them once hydrated.
- **F-02**: `setSnooze`/`setActionDueOverride` (`src/routes/items/[id]/+page.server.ts`) now return `context`/`actionId`/the submitted raw value on `fail(400, …)`. `WorkflowTimeline` (now receiving `form` from `+page.svelte`) reopens the matching dialog with the error and the rejected value pre-filled.
- **F-03 (partial)**: due-date display decoupled from edit eligibility (shown for MANUAL actions too); body reordered to title → readiness/blocked hint → due date → override/suggestion/reset → primary actions → secondary triggers. Readiness placement on mobile was _not_ fixed yet at this point (flagged again as round-2 F-03).
- **F-04**: rewrote `action-detail-ux.spec.ts` with a real DERIVED-action due dialog, exact resulting dates for every snooze choice, and a rejected-submission regression.
- **F-05 (partial)**: added `!docs/action-detail-ux-status.md` gitignore exception; corrected gate-attribution wording.

**Round 3** (this round, supervisor round-02 corrections):

- **F-03 (completed)**: the mobile single-column grid previously put the aligned-right `.timeline__state` badge in a row _after_ the entire action body (title, due info, primary buttons, secondary triggers), because it is a grid sibling of `.timeline__body`, not a child of it. Added `.timeline__status-inline` — the same readiness text, rendered as a child of `.timeline__body` directly under the title — hidden by default and shown only at the `max-width: 639px` breakpoint (where `.timeline__state` is now hidden instead). Desktop keeps the original aligned badge; mobile now shows readiness immediately under the title, before due context and controls. Added a mobile test assertion (`action-detail-ux.spec.ts`) that the readiness element's bounding box sits above the Mark done button's.
- **F-06**: `closeOnBackdropClick` compared `event.target === event.currentTarget`, which is also true for a click on the dialog's own padding (a `<dialog>` has no separate content wrapper, so interior-padding clicks and true backdrop clicks share the same event target). Fixed by comparing the pointer's viewport coordinates against the dialog's `getBoundingClientRect()`: only a point outside that box now closes it. Added a regression test asserting an interior-padding tap keeps the dialog open and a true outside tap closes it.
- **F-05 (completed)**: this document now records the round-2 verification that already passed (`npm run verify`, full `npm run test:e2e`: 115 unit-test files / 936 unit tests / 99 E2E tests — see `.agent/supervisor/action-detail-ux/action-detail-ux/verification/attempt-02.log`), corrects the readiness-hierarchy claim to match the now-fixed code, and adds the Baseline/Files/Git sections below.

## Behavior preserved

Complete, skip, reopen, snooze (preset + custom + clear + replace), due overrides (set + reset), readiness/blocked-reason semantics, dependency eligibility, read-only/archived handling and every existing form endpoint are unchanged — only the `fail()` payload shape gained extra optional fields. No server, port, or domain file was touched beyond that payload.

## Focused commands run (round 3, all passed)

- `npx prettier --write` / `npx eslint` on every changed file — clean
- `npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json` — 0 errors, 0 warnings
- `npx vite build` — succeeds
- `npx playwright test tests/e2e/action-detail-ux.spec.ts tests/e2e/workflow-blocked-reasons.spec.ts` — 8/8 passed
- `npx playwright test tests/e2e/notifications.spec.ts tests/e2e/due-date-override.spec.ts tests/e2e/action-reopen.spec.ts` — 11/11 passed (regression check for the mobile-CSS and dialog-click changes)

Round-2 full-suite evidence (already recorded by the supervisor, not re-run by this agent in round 3): `npm run verify` passed; full `npm run test:e2e` passed — 115 unit test files, 936 unit tests, 99 E2E tests.

Final round-3 full-suite evidence: `npm run verify` and `npm run test:e2e` both passed in supervisor verification attempt 03. Results: 115 unit-test files, 936 unit tests and 100 E2E tests. The round-3 independent OpenAI review accepted all previous code findings and requested only the responsive evidence below.

## Files changed (cumulative, this unit vs. `HEAD`/release branch)

```
.gitignore                                 |   1 +
eslint.config.js                           |  11 +-
src/app.css                                |  96 +++++++-
src/lib/components/WorkflowTimeline.svelte | 364 +++++++++++++++++++----------
src/lib/i18n/de.ts                         |   3 +-
src/lib/i18n/en.ts                         |   3 +-
src/routes/items/[id]/+page.server.ts      |  28 ++-
src/routes/items/[id]/+page.svelte         |   1 +
tests/e2e/due-date-override.spec.ts        |  35 ++-
tests/e2e/notifications.spec.ts            |  11 +
10 files changed, 407 insertions(+), 146 deletions(-)
```

Untracked new files (part of this unit, not yet staged — git policy for this unit forbids commit/stage): `tests/e2e/action-detail-ux.spec.ts`, `docs/action-detail-ux-status.md` (this file).

No branch, version, or CHANGELOG change. No file outside the list above was touched.

## Git

Working tree only — nothing staged, committed, or pushed, per this unit's git policy (`commit`/`push`/`pullRequest`: forbidden). `git status --porcelain` before this round-3 edit showed exactly the files listed above as modified/untracked, no unrelated changes.

## Responsive/visual inspection

Performed with the built application in Chromium. Browser automation measured rendered layout and exercised controls. Screenshots were also visually inspected. This was not a physical-device test.

Command: `node .agent/supervisor/action-detail-ux/tmp/responsive-check.mjs`. It started and stopped its own local server and used an isolated test database in the same artifact directory. It did not change product files or the shared E2E database.

| Viewport   | Action height with override | Due dialog   | Snooze dialog | Secondary rows |
| ---------- | --------------------------- | ------------ | ------------- | -------------- |
| 375 x 667  | 297 px                      | 375 x 278 px | 375 x 365 px  | 44 px          |
| 390 x 844  | 297 px                      | 390 x 278 px | 390 x 365 px  | 44 px          |
| 430 x 932  | 297 px                      | 430 x 278 px | 430 x 365 px  | 44 px          |
| 1280 x 900 | 257 px                      | 384 x 278 px | 384 x 234 px  | 44 px          |

- No document or dialog horizontal overflow at any viewport. All dialogs fit inside the viewport.
- Mobile status is directly under the title. Due date and override/suggestion/reset remain readable above Mark done and Skip. A longer title wrapped into two lines at 375 px without clipping or overflow.
- Main Action controls show reset, Mark done, Skip and two secondary entry rows. Snooze presets and both date inputs stay hidden until requested.
- Both mobile surfaces align with the bottom edge. Desktop surfaces are centered and 384 px wide. They are native modal dialogs in the top layer, above the bottom navigation. Screenshots confirm the navigation does not cover dialog buttons or fields. Main-page rows remain reachable by scrolling.
- Both date inputs accepted edited dates at every viewport. The due input is 44 px high; the snooze input is about 38 px high. The custom snooze uses an explicit confirmation button. This keeps native date-field edits from submitting an intermediate value.
- Opening either dialog puts focus inside. Ten Tab presses did not focus background controls. Chromium briefly focuses the document body when cycling between native modal controls. Escape closes the dialog and restores focus to its trigger.
- Current and suggested dates differ in the fixture and are both visible. The English due editor was also rendered and inspected at 375 px.
- Safe-area padding uses `env(safe-area-inset-bottom)`. Chromium reported a zero hardware inset and 20 px bottom padding. A nonzero physical-device inset was not emulated.
- A reconstructed original-controls fixture using the original `HEAD` CSS measured about 503 px at 375 px, versus 297 px for the current Action (about 41% less height). This is a layout comparison fixture, not a separately built baseline application.

Local artifacts: `.agent/supervisor/action-detail-ux/tmp/responsive-results.json`, `action-{375,390,430,1280}.png`, `due-{375,390,430,1280}.png`, `snooze-{375,390,430,1280}.png`, `long-title-375.png`, `due-en-375.png` and `reconstructed-before-375.png`. The artifacts are ignored. This document records their results for the handoff.

## Remaining risks / limitations

- The dialog's no-JS fallback is "always visibly open" rather than "closed until tapped" — an intentional, documented trade-off (native `<dialog>` cannot be opened without script), not an oversight.
- Only Chromium is configured for repository E2E tests. No physical iOS/Android date-picker or hardware safe-area test was performed.

## Next unit

None. This is a standalone unit with no dependents.
