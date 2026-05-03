# Feature Specification: Summary-card sparkline PR-level drill-down (Issue #363)

**Feature Branch**: `363-summary-card-pr-drilldown`
**Created**: 2026-05-02
**Status**: Draft (Pass 4 — planning-ready)
**Input**: GitHub Issue #363 — final slice of #318. Locked decisions LD-1..LD-5 baked in by the planning conversation; see "Locked Decisions" below. Pass 3 code-validation re-verified all "Verified Inputs at HEAD" claims against current source and resolved Q-R1 / Q-R4 / Q-R5 from inspection (see "Research items" + "Pass 3 code-validation notes" sections). Pass 4 planning-readiness swept for residual drift after Pass 3 locks; spec is ready for `/speckit.plan` with Q-R2 (panel-title formatter) as the sole remaining plan-time decision.

## Overview

The dashboard renders a strip of summary cards above the full charts. Each card has a small sparkline that today acts as a navigator: activating it scrolls the corresponding full chart into view and applies a 1500ms `is-sparkline-highlight` CSS class (`extension/ui/modules/drilldown/sparkline-navigator.ts:97-141`). To reach PR-level detail, the user must then click again on the full chart.

This slice closes that two-step gap for the three cards whose metric maps cleanly to a PR set (`totalPrs`, `cycleP50`, `cycleP90`): activating their sparkline opens the shared `DetailPanel` directly with a period-scoped PR list (the union of the active rollup window's PR slices). The fourth card's sparkline (`reviewers`) keeps the existing scroll-and-highlight behavior because its metric ("average unique reviewers per week") does not map to a single PR set without first picking a reviewer; the existing handoff to `#reviewer-activity` stays the right destination.

This is the last of three #318 slices; #365 (cycle-time chart drilldown) and #362/#366 (reviewer chart drilldown) shipped first so this slice can adopt their settled patterns.

## Verified Inputs at HEAD

These files were read end-to-end during planning AND re-verified at HEAD during Pass 3 code-validation. No drift detected; every cited file path, line range, function name, type definition, and constant matches the source at HEAD as of Pass 3 close. (See "Pass 3 code-validation notes" for details.)

- `extension/ui/modules/drilldown/sparkline-navigator.ts` — current scroll-and-highlight implementation; no DetailPanel; container-only signature `installSparklineNavigator(container)`; per-chart target id mapping `throughput → #throughput-chart`, `cycle-time → #cycle-time-trend`, `reviewer → #reviewer-activity`.
- `extension/ui/modules/drilldown/throughput-drilldown.ts` — per-week PR list from `rollup.prs`, sort `cycle_time desc, id asc`, cap from `rollup._prs_cap`, classifier-driven `team-inline` / `reviewer-inline` / `supported` / `supported-empty` branches; capability-on adds the comments stat row.
- `extension/ui/modules/drilldown/cycle-time-drilldown.ts` — same per-week PR list shape, panel title `Week of … — P50` / `… — P90`.
- `extension/ui/modules/drilldown/reviewer-drilldown.ts:257-411` — cross-week union of per-(reviewer, week) `prs` slices with accumulator `collected: PrRecord[]`, `capValue = max(per-week _prs_cap)`, truncation envelope `anyTruncated || collected.length < totalReviewedPrs`, re-sort `cycle_time desc, id asc`, reviewer-stripped classifier (reviewer classification unreachable on that surface).
- `extension/ui/modules/charts/summary-cards.ts:158-161, 449-472` — four sparkline triggers wrapped: `totalPrs` → `throughput`, `cycleP50` → `cycle-time`, `cycleP90` → `cycle-time`, `reviewers` → `reviewer`. Other sparklines (review-time P50/P90, authors) emit plain SVGs with no trigger.
- `extension/ui/dashboard.ts:1320-1345` — cycle-time install builds the canonical options bag (filters, repositoriesDimension, webContext, authorsDimension, commentsMetricsAvailable). Sparkline-navigator install currently passes only the container.
- `extension/ui/modules/shared/detail-panel.ts` — `PrListSection` discriminated union, `makePrListSection`, capability-on field `commentsMetricsAvailable`, content states `pr-list` / `team-inline` / `reviewer-inline` / `supported-empty`.
- `extension/ui/modules/drilldown/filter-support.ts` — `classifyFilterState`.
- `extension/ui/modules/drilldown/comparison-advisory.ts` — `isDrilldownDisabledByComparison`, `showComparisonAdvisoryToast` (used identically across all three drilldowns).
- `.test-floor-contract.json` — extension `min_collected: 3158` at HEAD.

## Locked Decisions (Pass 1)

These are resolved before draft; downstream passes treat them as architectural fact, not as open questions.

### LD-1 — Period-scoped PR list shape: top-N union (Option A)

The DetailPanel renders a single `PrListSection` sourced from a period-scoped union of the active rollup window's `prs[]` arrays:

1. Walk every rollup in the period; concatenate `rollup.prs ?? []` into `collected: PrRecord[]`.
2. `capValue = max(rollup._prs_cap)` across rollups that contributed PRs (mirrors reviewer-drilldown's max-of-per-week-caps lock).
3. `anyTruncated = any(rollup._prs_truncated === true)`; `totalPeriodPrCount = sum(rollup.pr_count)`.
4. `classifyFilterState(filters, false)` — `team` / `reviewer` classifications produce inline-message content states; `supported` flows to PR list build.
5. **No supplementary client-side overlay at this layer** (Pass 3 locked, Q-R1=R1-A): source rollups are already PR-level filter-applied by the dashboard via `applyFiltersToRollups(rawRollups, currentFilters)` at `dashboard.ts:1045`, which runs BEFORE the drilldown installs at `dashboard.ts:1320-1345`. The function (in `metrics.ts:441-933`) handles all four filter axes (repos, teams, reviewers, authors), including PR-level filtering at `metrics.ts:906-924` that emits `filteredPrs` along with `_prs_truncated` and `_prs_cap` passthrough. The new sparkline-driven panel consumes these already-filtered `rollup.prs` arrays directly — same as throughput-drilldown's existing read path.
6. Re-sort the union by `cycle_time desc, id asc` (#365's invariant).
7. Truncation cue gate (mirrors reviewer-drilldown contract § 6): cue fires when `anyTruncated || collected.length < totalPeriodPrCount`. Per Q-R1=R1-A lock there is no supplementary overlay at this layer, so the "pure-overlay reduction" branch is unreachable in #363's scope.
8. `actualFilteredCount = truncationDetected ? totalPeriodPrCount : rows.length`.

Rejected: Option B (per-week sections — breaks DetailPanel UX rhythm and would require a new `PrListSection` content state). Rejected: Option C (View-all-PRs deferral link — defers the user value the issue is built around).

### LD-2 — Card scope: 3-in / 1-out, asymmetry documented

| Card | Activation | Panel title shape (Q-R2 — pending plan-time lock) |
|------|------------|------|
| `totalPrs` (throughput) | Opens DetailPanel with period-scoped PR list (LD-1) | Mirrors throughput-drilldown title shape, period-scoped |
| `cycleP50` (cycle-time) | Opens DetailPanel with period-scoped PR list | Period-scoped, includes `— P50` marker |
| `cycleP90` (cycle-time) | Opens DetailPanel with period-scoped PR list | Period-scoped, includes `— P90` marker |
| `reviewers` (reviewer-activity) | **Preserves existing scroll-to-`#reviewer-activity` + highlight** | n/a |

**Reviewer-card asymmetry rationale (deliberate, not a planning gap):** the reviewer card metric is "average unique reviewers per week," not a PR set. A single-PR-list drilldown would force an arbitrary reviewer pick or surface "all PRs that had any reviews" — a degenerate throughput list. The existing scroll handoff lands on the reviewer-activity chart, where the per-reviewer drilldown shipped in #366 is the right surface for "see PRs by a specific reviewer."

### LD-3 — Consumer-only slice; reuse existing primitives

No producer-side changes. No new `PrRecord` fields. No new schema. Implementation reuses:

- `PrListSection` discriminated union (`makePrListSection`).
- `classifyFilterState` (team/reviewer/supported branches; reviewer is reachable here because period-scoped rollups can carry an active reviewer filter, unlike on the reviewer-drilldown surface which strips it).
- `resolvePrUrl` for ADO link composition.
- `commentsMetricsAvailable` capability gate (Feature 310 — same on/off DOM-shape contract).
- Comments stat row builder (only when capability on AND `pr-list` content state).
- Reduced-motion / comparison-toast / keyboard-activation behavior already locked in `sparkline-navigator.ts`.

### LD-4 — Helper extraction posture: locked to **Branch B (local duplication)** by Pass 3 code-validation

**Pass 3 verdict (Q-R4)**: Branch A (shared helper extraction) is **disqualified** by structural-fit pre-flight against `reviewer-drilldown.ts:282-322`. Implementation **WILL** use Branch B (local duplication of the union/cap/truncation walk inside the sparkline-driven path).

**Pre-flight evidence**:

Reviewer-drilldown's walk at `reviewer-drilldown.ts:282-322` reads from per-(reviewer, week) entries (`entry = reviewerEntry(rollup, reviewerId)`, then trio extraction from `entry.{prs, _prs_truncated, _prs_cap, reviewed_prs}`). The new sparkline-driven walk reads from rollup-level fields directly (`rollup.{prs, _prs_cap, _prs_truncated, pr_count}`). A unifying helper would require a callback-based loop body restructure in reviewer-drilldown — replacing ~20 lines of inline loop with a callback definition + result destructuring.

This restructure exceeds the Pass 2 hard abort criterion "Reviewer-drilldown's source file requires NO modification beyond a single mechanical change at the helper's call site." Branch A is therefore disqualified at Q-R4 pre-flight, before any code is written.

**Branch B contract**:

- The cross-week union/cap/truncation walk is implemented as a **private helper inside the sparkline-driven path** (likely a non-exported function in `sparkline-navigator.ts` or a new sibling module scoped to that file's import).
- `reviewer-drilldown.ts` is **NOT** touched in this slice. Its existing accumulator walk at L282-322 stays exactly as is.
- The two walks (sparkline-driven, reviewer-driven) intentionally **duplicate** the accumulator pattern. This duplication is documented and accepted; future cross-surface refactor would need its own slice.

**Reviewer-drilldown regression-lock criteria** (these were Branch A's gating conditions in Pass 2; in Pass 3 they become the regression-lock contract for Branch B):

- Reviewer-drilldown's source file (`extension/ui/modules/drilldown/reviewer-drilldown.ts`) MUST NOT be modified by any commit in #363's scope.
- Reviewer-drilldown's test files (`extension/tests/modules/drilldown/reviewer-drilldown.test.ts`, `reviewer-pr-list-capability-off-baseline.test.ts`, `reviewer-pr-list-count-parity.test.ts`, `reviewer-pr-list-order.test.ts`) MUST NOT be modified.
- Reviewer-drilldown's DOM golden fixture (`extension/tests/fixtures/reviewer-drilldown-capability-off-baseline.html`) MUST NOT change in bytes.
- Any commit in #363's scope that touches any of those six paths is out of scope and MUST be reverted before merge. The `git diff` of the implementation commit MUST show zero hunks under those paths.

**Why this lock matters for downstream artifacts**: plan / data-model / contracts / tasks encode Branch B as the **chosen** implementation. Branch A is mentioned in "Pass 3 code-validation notes" as "considered and rejected" with citation to the Q-R4 pre-flight, so future readers can see why duplication was chosen instead of extraction.

### LD-5 — Demo-data parity: confirmed out-of-scope by Pass 3 code-validation (Q-R5=R5-A)

Per LD-3 (consumer-only) AND **Pass 3 empirical evidence**, demo data is unaffected by this slice. No demo-data regen, no `chore(demo)` commit, no `scripts/build-demo-dataset.py` / `scripts/generate-demo-data.py` edits.

**Pass 3 evidence (Q-R5=R5-A)**: sample of `docs/data/aggregates/weekly_rollups/2025-W40.json` confirms `pr_count: 106`, `prs.length: 106` (matches pr_count exactly — full list), `_prs_cap: 500`, `_prs_truncated: false`, with PR records carrying every field the period-scoped panel reads (`id`, `title`, `cycle_time`, `repository_id`, `author_id`, `thread_count`, `comment_count`, `active_thread_count`). The existing demo set already exercises the period PR-list path's `pr-list` content state with capability-on data; truncation-cue branches remain testable via Jest fixtures (same as throughput / cycle-time / reviewer slices test them).

Any unrelated CRLF-only diff that appears during canonical bundle regen is reverted via `git restore --worktree -- docs/data/` (memory: `feedback_python_write_text_line_endings_windows`), never committed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Throughput card sparkline opens period-scoped PR list (Priority: P1)

A user is looking at the dashboard summary cards for a multi-week period. The "Total PRs merged" card displays a numeric headline and a sparkline. The user wants to see the actual list of PRs that drove that headline number, without scrolling to the full throughput chart and clicking a specific week.

**Why this priority**: The card metric is itself a PR count — the most direct mapping in the strip. A single click should land the user on the underlying PR list. This is the largest user-value win in the slice and the cleanest reuse of the existing throughput PR-list shape.

**Independent Test**: With the dashboard rendered for a multi-week period, click the throughput sparkline. The DetailPanel opens with a single PR list ordered by `cycle_time desc, id asc`. The period row bound is `sum(per-rollup _prs_cap)` across contributing rollups (the `capValue` field reported to the renderer is `max(per-rollup _prs_cap)` — field-level semantics inherited from the throughput / cycle-time / reviewer drilldowns, NOT the rendered-count bound). Truncation cue and capability-on/off shape match the throughput chart's per-week panel.

**Acceptance Scenarios**:

1. **Given** the user is viewing a multi-week dashboard with no filters, **When** they click the `totalPrs` sparkline, **Then** the DetailPanel opens with a period-scoped PR list (LD-1 union), each row shows the title and cycle time, and each row's "Open in Azure DevOps" affordance navigates to the correct PR.
2. **Given** an active **team** filter, **When** the user clicks the `totalPrs` sparkline, **Then** the DetailPanel opens with the `team-inline` content state — message asking the user to clear the team filter to see PR detail (mirrors throughput-drilldown's classifier branch).
3. **Given** an active **reviewer** filter, **When** the user clicks the `totalPrs` sparkline, **Then** the DetailPanel opens with the `reviewer-inline` content state.
4. **Given** the dashboard is in **comparison mode**, **When** the user clicks the `totalPrs` sparkline, **Then** the comparison-advisory toast fires (existing behavior) and the DetailPanel does NOT open.
5. **Given** the underlying full throughput chart `#throughput-chart` is missing on the page, **When** the user clicks the `totalPrs` sparkline, **Then** the existing inline advisory message renders adjacent to the sparkline (FR-052 from #059) and the DetailPanel does NOT open.

---

### User Story 2 — Cycle-time card sparklines open period-scoped PR list with metric marker (Priority: P1)

A user looking at cycle-time P50 or P90 cards wants the underlying PR list, sorted naturally for cycle-time analysis. Activating either sparkline opens the same period-scoped PR list as the throughput card with a panel title that distinguishes which percentile card was the source.

**Why this priority**: P1 alongside US1 because the cycle-time cards are the second and third primary entry points and the panel title metric marker is what disambiguates the user's mental model from "I clicked the P50 card" vs "I clicked the P90 card." Without the title marker, the panel content is identical between the two and the user loses provenance.

**Independent Test**: Click the cycleP50 sparkline; verify panel opens with period-scoped PR list and panel title contains a `P50` marker. Click cycleP90 sparkline; verify retarget-in-place (single CSS transition) and panel title contains a `P90` marker. Both panels share the same row content (LD-1 union ordered by `cycle_time desc, id asc`).

**Acceptance Scenarios**:

1. **Given** the user is on a multi-week dashboard, **When** they click the `cycleP50` sparkline, **Then** the DetailPanel opens with the period-scoped PR list and the panel title includes a `P50` marker.
2. **Given** the panel from scenario 1 is open, **When** the user then clicks the `cycleP90` sparkline, **Then** the panel retargets in place (no close/reopen flicker) and the title swaps to include a `P90` marker.
3. **Given** an active team filter, **When** the user clicks either cycle-time sparkline, **Then** the DetailPanel opens with `team-inline` content state — same classifier-driven behavior as US1 scenario 2.
4. **Given** the dashboard is in comparison mode, **When** the user clicks either cycle-time sparkline, **Then** the comparison-advisory toast fires and the panel does NOT open.
5. **Given** the underlying full cycle-time chart `#cycle-time-trend` is missing on the page, **When** the user clicks either cycle-time sparkline, **Then** the inline advisory message renders adjacent to the sparkline and the panel does NOT open.

---

### User Story 3 — Reviewers card sparkline preserves scroll-and-highlight (Priority: P2)

A user clicking the reviewers card sparkline expects today's behavior unchanged: the page scrolls to the reviewer-activity chart, the chart container highlights briefly, and the user can pick a specific reviewer there to drill in via the per-reviewer drilldown shipped in #366.

**Why this priority**: This is a regression-lock invariant — the contract behavior is "no change" — so it lands as P2 to ensure it is independently verified after US1/US2 ship. It is critical to the LD-2 asymmetry rationale: the slice ships nothing for the reviewers card, but the existing fall-through path must remain intact.

**Independent Test**: Click the reviewers card sparkline; verify (a) the page scrolls so `#reviewer-activity` is in view, (b) the `is-sparkline-highlight` class is applied to that container for ~1500ms, and (c) NO DetailPanel opens.

**Acceptance Scenarios**:

1. **Given** the user is on a multi-week dashboard with `#reviewer-activity` rendered, **When** they click the `reviewers` sparkline, **Then** the page scrolls so `#reviewer-activity` is in view (smooth or instant per `prefers-reduced-motion`), the `is-sparkline-highlight` class is applied for ~1500ms, and NO DetailPanel opens.
2. **Given** `prefers-reduced-motion: reduce` is set, **When** the user clicks the reviewers sparkline, **Then** scroll behavior is `auto` (instant) and the highlight animation respects the reduced-motion CSS gate (existing behavior).
3. **Given** `#reviewer-activity` is missing on the page, **When** the user clicks the reviewers sparkline, **Then** the inline advisory message renders adjacent to the sparkline (existing `renderNoData` path); no scroll fires; no DetailPanel opens.
4. **Given** an active comparison mode, **When** the user clicks the reviewers sparkline, **Then** the comparison-advisory toast fires and neither scroll nor DetailPanel proceed.

---

### User Story 4 — Capability-aware DOM shape and stat row (Priority: P2)

When the dataset's comments-metrics capability is **on** (per the loader's `getCapabilityState().commentsMetricsAvailable`), the period-scoped PR list shows the comments columns and a period-level comments stat row. When the capability is **off**, the rendered DOM is byte-identical to the pre-310 shape (no comments columns, no stat row).

**Why this priority**: The capability gate is a 310-locked DOM-shape invariant — failing this is a Feature-310 regression. P2 because it is enforced by a baseline DOM golden fixture, which makes it independently testable and gives clean evidence at /speckit.analyze time.

**Independent Test**: Render the panel from each of the three eligible cards with `commentsMetricsAvailable: false`; the resulting DOM matches a new capability-off baseline fixture byte-for-byte (mirrors `cycle-time-drilldown-capability-off-baseline.html` and `reviewer-drilldown-capability-off-baseline.html` in #361 / #362).

**Acceptance Scenarios**:

1. **Given** `commentsMetricsAvailable: false`, **When** the user opens the panel from `totalPrs`, **Then** the rendered DOM is byte-identical to the new capability-off baseline fixture (no comments columns, no comments stat row).
2. **Given** `commentsMetricsAvailable: true` AND the panel resolves to `pr-list` content state, **When** the user opens the panel from any of the three eligible cards, **Then** the comments stat row appears prepended above the PR list, and each row carries thread / comment / unresolved-thread counts (or partial dashes per Feature-310 INV-10 if the producer marked the row partial).
3. **Given** `commentsMetricsAvailable: true` BUT the classifier resolves to `team-inline` / `reviewer-inline` / `supported-empty`, **When** the panel opens, **Then** the comments stat row is suppressed (gate fires only when content state is `pr-list`), matching throughput-drilldown's contract.

---

### Edge Cases

- **Empty period**: every rollup has `pr_count: 0` and `prs: []`. `collected.length === 0` ⇒ `supported-empty` content state — same fall-through as throughput-drilldown's empty-week case.
- **Missing `_prs_cap` on a contributing rollup**: the consumer cannot compute the `capValue` field (= `max(per-rollup _prs_cap)`) without every contributing rollup providing its `_prs_cap`. Per contract § 3 mirrored from reviewer-drilldown: any participating rollup missing `_prs_cap` triggers `supported-empty`.
- **Missing `webContext`**: links can't be composed; the panel falls through to `supported-empty`.
- **Pure-overlay reduction — *forward-compatibility note only, unreachable in #363's scope***: per Pass 3 Q-R1=R1-A lock, source rollups are already PR-level filter-applied by the dashboard before they reach the drilldown layer; #363 introduces NO supplementary client-side overlay. This edge case is preserved purely as a forward-compatibility marker — if a future scope re-introduces an overlay at this layer, applying it must NOT fire the truncation cue (cue is producer-driven; a pure-overlay reduction would not change `collected.length` and therefore would not change the cue gate). For #363, this branch is dead code that does not appear in the spec's contract surface.
- **Keyboard activation on the reviewers card**: Enter/Space trigger the same scroll-and-highlight path as click; no DetailPanel opens (US3 invariant).
- **Retarget-in-place across cards**: clicking `totalPrs` then `cycleP50` retargets the same panel (a single CSS transition, not close/reopen) — DetailPanel API already handles this; the only thing this slice owns is constructing the new content for the new source card.
- **`activeTrigger` lifecycle on retarget**: the active-class + `aria-expanded` MUST swap from the previous trigger to the new one without leaving stale state (mirrors throughput / cycle-time / reviewer drilldowns' MutationObserver dismiss-path coverage).
- **Comparison toggled WHILE panel open**: existing dismiss-path observer fires; the panel closes, the active class clears. No special case needed in this slice.
- **Sparkline trigger missing entirely** (sparkline rendered as plain SVG due to insufficient data): `summary-cards.ts:wrapSparklineTrigger` no-ops for null containers / no-SVG cases. There is no trigger to listen on, so no activation can fire. No new behavior needed.
- **Reduced-motion on the DetailPanel branch**: the panel-open path does not introduce new animation; existing panel transition is already reduced-motion-safe via CSS. No new discipline beyond what the panel enforces.
- **Touch activation**: relies on the synthesized `click` event (same contract every drilldown uses; chart-tooltip `pointerup` does not `preventDefault`). No new pointer handling.

## Requirements *(mandatory)*

Branch-aware from Pass 1, hardened through Pass 3 code-validation: every requirement that depends on the LD-2 asymmetry is written so the reviewer card's preserved behavior is part of the rule, not an "unless" appended afterwards. Pass 3 locks (Q-R1=R1-A, Q-R3=OMIT, Q-R4=Branch B, Q-R5=R5-A) are encoded directly into the FRs without leaving alternate branches as latent contracts.

### Functional Requirements

#### Activation routing

- **FR-001**: When the user activates a sparkline trigger (click or Enter/Space keypress) where `data-drilldown-target-chart` is `"throughput"` or `"cycle-time"`, the system MUST attempt to open the shared `DetailPanel` with a period-scoped PR list (LD-1) and MUST NOT scroll the target chart into view in that branch.
- **FR-002**: When the user activates a sparkline trigger where `data-drilldown-target-chart` is `"reviewer"`, the system MUST execute the existing scroll-and-highlight navigator path (scroll target into view + apply `is-sparkline-highlight` for `SPARKLINE_HIGHLIGHT_MS = 1500ms`) and MUST NOT open the DetailPanel.
- **FR-003**: For every sparkline trigger (all four cards), when the corresponding target chart container element is missing on the page, the system MUST render the inline advisory message via `renderNoData` (existing FR-052 path from #059) and MUST NOT execute either the scroll or the DetailPanel branch. The missing-target gate MUST run before either branch.
- **FR-004**: For every sparkline trigger (all four cards), when the dashboard is in comparison mode (`isDrilldownDisabledByComparison()` returns true), the system MUST fire the existing comparison-advisory toast (`showComparisonAdvisoryToast`) and MUST NOT execute either the scroll, the DetailPanel, or the inline-advisory branch. The comparison gate MUST run before any of those branches.
- **FR-005**: Cycle-time sparkline triggers (`cycleP50`, `cycleP90`) MUST carry the data attribute `data-drilldown-cycle-metric` with value `"p50"` (for `cycleP50`) or `"p90"` (for `cycleP90`) so the DetailPanel content builder can produce a panel title that includes the corresponding `P50` / `P90` marker. Throughput and reviewer triggers MUST NOT carry this attribute. The attribute name `data-drilldown-cycle-metric` is contract; alternative names are a contract change requiring re-spec.

#### Period-scoped PR list shape

- **FR-006**: When the DetailPanel opens from any of the three eligible cards, the PR list section MUST be derived from the union of the active rollup window's `prs[]` arrays per LD-1 step 1. The walk MUST cover every rollup in the active period, with no per-card filtering of which rollups participate (all three eligible cards consume the same rollup window).
- **FR-007**: The PR list cap value used for envelope reporting MUST be `max(rollup._prs_cap)` across rollups that contributed PRs (LD-1 step 2). When at least one contributing rollup is missing `_prs_cap`, the system MUST fall through to the `supported-empty` content state (no PR list rendered).
- **FR-008**: The truncation envelope MUST be reported per LD-1 step 7: cue fires when `anyTruncated || collected.length < totalPeriodPrCount`. Per Q-R1=R1-A there is no supplementary overlay at this layer, so the cue is producer-driven only; the "pure-overlay reduction does not fire the cue" branch is unreachable in #363's scope and is preserved here as a forward-compatibility note for future scope that might re-introduce an overlay.
- **FR-009**: `actualFilteredCount` reported to the renderer MUST equal `totalPeriodPrCount` when truncation is detected, otherwise `rows.length` (LD-1 step 8).
- **FR-010**: The unioned PR list MUST be re-sorted by `cycle_time desc, id asc` before render (LD-1 step 6 — #365's invariant).
- **FR-011**: When `classifyFilterState(filters, false)` returns `team`, the PR list section MUST be `team-inline` content state (no PR rows rendered, inline message shown). When it returns `reviewer`, the section MUST be `reviewer-inline`. When it returns `supported`, the system MUST proceed to the `pr-list` build (subject to the empty / missing-cap / missing-webContext fallthroughs).

#### Capability-state propagation

- **FR-012**: When `commentsMetricsAvailable: true` AND the resolved content state is `pr-list`, the panel MUST prepend a comments stat row (Feature-310 F6, mirrors throughput-drilldown's gate). When either condition is false, the comments stat row MUST be omitted.
- **FR-013**: When `commentsMetricsAvailable: false`, the rendered DOM MUST be byte-identical to a pre-310 shape (no comments columns, no comments stat row). This invariant MUST be locked by a new capability-off baseline DOM golden fixture mirroring 361 / 362.
- **FR-014**: When `commentsMetricsAvailable: true`, each row MUST carry the comments triplet (`threadCount`, `commentCount`, `activeThreadCount`) — including partial-row markers per Feature-310 INV-10 (`null` for null fields; the shared `isPartialPrRow` helper handles both `null` and `undefined`).

#### Active-trigger lifecycle

- **FR-015**: When the DetailPanel opens from a sparkline trigger, the system MUST add the `is-drilldown-active` class to the activated trigger AND set `aria-expanded="true"` on it. When the panel closes (via any dismiss path — Escape, outside-click, close button, filters-changed, tab-changed, comparison-toggled, retarget), the system MUST remove the class AND set `aria-expanded="false"` on the still-tracked trigger before any subsequent panel render. This MUST mirror throughput / cycle-time / reviewer drilldowns' single-MutationObserver-on-`aside.detail-panel` `class` attribute, single-dismiss-path coverage.
- **FR-016**: Retarget-in-place between two eligible cards (e.g. `totalPrs` → `cycleP50` while panel is open) MUST swap the active trigger in this exact ordering: (1) remove `is-drilldown-active` and set `aria-expanded="false"` on the previously-active trigger, (2) build new panel content for the new trigger, (3) call `openDetailPanel(...)` (which retargets the open panel without close-reopen flicker), (4) add `is-drilldown-active` and set `aria-expanded="true"` on the new trigger. No window in this sequence may have BOTH triggers showing `is-drilldown-active` simultaneously, and no window may have the new trigger displaying stale `aria-expanded="false"` after panel content has rendered.

#### Reduced-motion and comparison

- **FR-017**: The reviewer-card scroll-and-highlight branch MUST resolve `prefers-reduced-motion: reduce` to choose `scrollIntoView` behavior `auto` vs `smooth` (existing behavior — preserved unchanged in this slice).
- **FR-018**: The DetailPanel-open branch MUST NOT introduce new animation logic; it MUST rely on the panel's existing reduced-motion-aware CSS transition.
- **FR-019**: The comparison-toast denial path (FR-004) MUST be unchanged in observable behavior on all four sparkline triggers.

#### Reviewer-card asymmetry (LD-2 documentation)

- **FR-020**: The asymmetry between the three eligible cards (DetailPanel-opening) and the reviewers card (preserved scroll-and-highlight) MUST be documented inline in `summary-cards.ts:wrapSparklineTrigger` rationale (one short comment block citing this issue and LD-2). The intent: future readers see the asymmetry explained where the trigger is wired, not only in this spec.

#### Helper extraction (LD-4)

- **FR-021**: The cross-week union/cap/truncation walk MUST be implemented as **Branch B (local duplication)** per Pass 3's Q-R4 lock. The walk lives as a private helper inside the sparkline-driven path (e.g. a non-exported function in `sparkline-navigator.ts` or a sibling module scoped to that file's imports). No shared module is created. Reviewer-drilldown's existing accumulator walk at `reviewer-drilldown.ts:282-322` is left untouched.
- **FR-022**: Reviewer-drilldown regression-lock — the implementation commit's `git diff` MUST show zero hunks under each of the following paths:
  - `extension/ui/modules/drilldown/reviewer-drilldown.ts`
  - `extension/tests/modules/drilldown/reviewer-drilldown.test.ts`
  - `extension/tests/modules/drilldown/reviewer-pr-list-capability-off-baseline.test.ts`
  - `extension/tests/modules/drilldown/reviewer-pr-list-count-parity.test.ts`
  - `extension/tests/modules/drilldown/reviewer-pr-list-order.test.ts`
  - `extension/tests/fixtures/reviewer-drilldown-capability-off-baseline.html`

  Any modification to any of those six paths in a #363 commit is out of scope and MUST be reverted before merge. Pre-commit verification: `git diff --stat` against those paths SHOULD return zero changes; if any hunk appears, abort the commit, identify the cause, and revert.
- **FR-023**: Plan / data-model / contracts / tasks MUST encode Branch B as the chosen implementation. Branch A (shared helper extraction) MUST be cited as "considered and rejected during Pass 3 Q-R4 pre-flight" — preserved in the artifact set so future readers see why duplication was chosen. Plan MUST NOT include any task that imports from a hypothetical shared `period-pr-list.ts` module; data-model / contracts MUST NOT specify a shared helper signature; tasks MUST NOT include a "extract helper" step.

### Key Entities

- **Rollup window** — the array of weekly rollups currently selected by the dashboard's date-range picker and filter chip set. Already filter-applied by the dashboard before reaching the drilldown layer.
- **`PrRecord`** — a single PR's row in `rollup.prs`. Fields used by this slice: `id`, `title`, `cycle_time`, `repository_id`, `author_id`, capability-on-only `thread_count` / `comment_count` / `active_thread_count`. No new fields.
- **`PrListSection` discriminated union** — existing shared primitive (`extension/ui/modules/shared/detail-panel.ts`). This slice produces `pr-list` / `team-inline` / `reviewer-inline` / `supported-empty` instances.
- **Period-scoped union envelope** — derived per LD-1: `collected: PrRecord[]`, `capValue: number | undefined`, `anyTruncated: boolean`, `totalPeriodPrCount: number`. Local to the drilldown call; not persisted.
- **Sparkline trigger DOM** — the `<button class="sparkline-trigger">` produced by `summary-cards.ts:wrapSparklineTrigger`. Carries `data-drilldown-target-chart`. This slice ALSO adds `data-drilldown-cycle-metric` to the two cycle-time triggers (FR-005).

## Research items — Pass 3 status

Pass 3 code-validation resolved Q-R1, Q-R4, Q-R5 from source / artifact inspection. Q-R3 was reaffirmed (no cheap-reuse signal found). Q-R2 remains deferred to plan-time. The "Pass 3 code-validation notes" section at the bottom records the empirical evidence underlying each lock.

- **Q-R1 — overlay semantics at this layer**: ✓ **RESOLVED — R1-A (fully pre-filtered)**. `dashboard.ts:1045` calls `applyFiltersToRollups(rawRollups, currentFilters)` BEFORE the drilldown installs at `dashboard.ts:1320-1345`. The function (`metrics.ts:441-933`) covers all four filter axes (repos, teams, reviewers, authors) and emits `filteredPrs` along with `_prs_truncated` and `_prs_cap` passthrough at `metrics.ts:906-924`. **No supplementary client-side overlay is needed at the sparkline-navigator layer.** FR-006 / LD-1 step 5 are written as locked R1-A. R1-B branch (supplementary overlay) is removed from the contract.
- **Q-R2 — panel title shape**: **DEFERRED to plan-time**. Investigation must enumerate (a) whether `extension/ui/modules/drilldown/week-range.ts` already exposes a multi-week `formatPeriodTitle(rollups)` helper, (b) if not, where the appropriate factoring lives, and (c) the exact title strings for each card: throughput, cycle-time P50, cycle-time P90. The `P50` / `P90` marker affixation MUST mirror cycle-time-drilldown's `formatWeekTitle(rollup) + " — P50"` shape (string concatenation with em-dash separator). Lock in contract during plan / contracts.
- **Q-R3 — panel section ordering**: ✓ **CONFIRMED OMIT**. Pass 3 found no cheap-reuse signal in source. Existing `breakdownSection` helper in `throughput-drilldown.ts:93-110` is per-rollup; producing a cross-week aggregate would require a new accumulator walk, NEW tests for the new aggregate's ordering / emptiness / identity-resolution, and would alter the panel DOM in ways that require new (or updated) baseline fixture coverage. Pass 2's three cheap-reuse conditions (existing helper produces cross-week aggregate / zero new tests / zero baseline fixture byte changes) all fail. **Panel structure is locked to `[stats?, prList]` only.**
- **Q-R4 — helper-extraction touch-radius**: ✓ **RESOLVED — Branch B (local duplication)**. Pass 3 pre-flight against `reviewer-drilldown.ts:282-322` shows the per-(reviewer, week) `entry`-walk pattern is structurally distinct from the rollup-level walk, requiring a callback-based loop body restructure that exceeds the "single mechanical call-site swap" criterion. **Implementation duplicates the walk locally** in the sparkline-driven path; reviewer-drilldown source / tests / fixture stay byte-untouched. See LD-4 and FR-021..FR-023 for the locked contract.
- **Q-R5 — demo-data exercise of period PR-list path**: ✓ **RESOLVED — R5-A (demo exercises path)**. Sample of `docs/data/aggregates/weekly_rollups/2025-W40.json` confirms `pr_count: 106`, `prs.length: 106`, `_prs_cap: 500`, `_prs_truncated: false`, with PR records carrying every required field. **No demo regen needed; no `chore(demo)` commit.** LD-5 default holds.

## Success Criteria *(mandatory)*

Each criterion is verifiable without referencing implementation details.

- **SC-001**: A user reaching the dashboard from a fresh load can open a period-scoped PR list from either the throughput or cycle-time card sparklines in **one action** (single click or Enter/Space keypress on the sparkline trigger), with no intermediate scroll-and-second-click.
- **SC-002**: When the user activates `cycleP50` then `cycleP90` while the panel is open, the panel retargets in place (single visible transition, no close-then-reopen flicker), and the panel title indicates which percentile card was the most recent activator.
- **SC-003**: For a rollup window where every contributing rollup honors `_prs_cap`, the period-scoped PR list rendered count equals the union of per-rollup `prs[]` arrays — each per-rollup contribution bounded by its own `_prs_cap`, and the period union bounded by `sum(per-rollup _prs_cap)` across contributing rollups (NOT `max`). The truncation cue is rendered when at least one contributing rollup signals truncation OR the collected count is strictly less than the period-level `pr_count` sum (FR-008 / LD-1 step 7). The `capValue` field reported to the renderer is `max(per-rollup _prs_cap)` per the inherited reviewer-drilldown contract; this is the field semantics, NOT the rendered-count bound.
- **SC-004**: With `commentsMetricsAvailable: false`, the rendered panel DOM matches the new capability-off baseline fixture byte-for-byte across all three eligible cards. With `commentsMetricsAvailable: true` and `pr-list` content state, the comments stat row appears once, prepended above the PR list (per Feature-310 F6).
- **SC-005**: Activating the reviewers card sparkline produces no DetailPanel and no behavioral change relative to HEAD (regression-lock); the sparkline-navigator scroll-and-highlight tests existing today remain green throughout this slice.
- **SC-006**: Comparison-mode denial (toast fires, panel does not open) is preserved on every sparkline trigger, including the reviewers card. Reduced-motion behavior on the reviewers card scroll path is preserved.
- **SC-007**: The reviewer-drilldown's existing test suite and DOM-golden fixtures remain unchanged in observable output throughout the slice (LD-4 / Q-R4=Branch B locked). The implementation commit's `git diff` MUST show zero hunks under reviewer-drilldown's six regression-locked paths enumerated in FR-022 (one source file, four test files, one DOM-golden fixture).
- **SC-008**: When the underlying full chart (`#throughput-chart` for `totalPrs`, `#cycle-time-trend` for cycle-time cards) is missing on the rendered page, the inline advisory message renders adjacent to the sparkline (existing FR-052 behavior), and the DetailPanel does NOT open. The missing-target gate MUST run before the DetailPanel build attempt.

## Assumptions

Pass 2 assumptions are **only** items the spec genuinely needs without verification, and that are stable inherited contracts. Items previously phrased as assumptions in Pass 1 but actually depending on un-verified code state have been moved to the research items above (Q-R1, Q-R5).

- The `_prs_cap` field semantics on a per-rollup basis are stable across rollup windows. The `capValue` field reported to the renderer is `max(per-rollup _prs_cap)` (mirrors reviewer-drilldown's already-shipped contract at `reviewer-drilldown.ts:316`) — this is the field value, NOT the rendered-count bound. The rendered period-scoped row count is bounded by `sum(per-rollup _prs_cap)` across contributing rollups; see SC-003. The implementation contract `Math.max(capValue, cap)` in the walk produces the field value; the rendered count comes from `collected.length`, which is the unioned (sum-bounded) set. This is an inherited invariant pattern (mirrors reviewer-drilldown), not an assumption.
- The active rollup window is the same one the summary cards consume to compute the headline metric (so the period-scoped PR list is provably "the PRs behind this number"). This is enforced by the dashboard already passing `currentRollups` to every drilldown install in `dashboard.ts:1320-1345`.
- The `DetailPanel` API's retarget-in-place behavior already handles cross-source retargets (e.g. from a throughput week-bar to a cycle-time dot, and now from a sparkline trigger to a chart-element trigger). This slice does not extend the panel API. Inherited contract from `extension/ui/modules/shared/detail-panel.ts`.
- `prefers-reduced-motion: reduce` already disables the highlight animation via CSS gate in `styles.css`. No new CSS is required for the DetailPanel branch.
- Pass 3 locked Q-R1=R1-A, Q-R4=Branch B, Q-R5=R5-A from code/artifact inspection. The spec is no longer written for the rejected branches; FRs are direct rather than branch-aware on those axes. The reviewer-card asymmetry (LD-2) and the helper-extraction-disqualified state (Q-R4 → Branch B) ARE still encoded as rules, not "unless" appends, per memory `feedback_speckit_branch_aware_from_draft`.
- Per memory `feedback_speckit_commit_plan_default`, the implementation will land in **1 planning + 1 implementation commit**. Q-R5=R5-A locks no `chore(demo)` commit needed. (If a CRLF-only diff appears during canonical bundle regen it is reverted via `git restore --worktree`, never committed.)

## Non-goals

- PR-level detail on the cycle-time chart or reviewer chart (those are #365 and #362/#366 — already shipped, out of this issue's scope).
- Comparison-mode drill-down behavior changes.
- New `PrRecord` fields, schema changes, or any producer-side work.
- Replacing the scroll-and-highlight navigator entirely. The navigator behavior remains the fallback for the reviewers card and the missing-target advisory path on every card.
- Demo-data work (LD-5; Q-R5=R5-A confirmed).
- A "View all PRs" deferral link (LD-1's rejected Option C).
- Per-week sectioned panel layout (LD-1's rejected Option B).
- Cross-week aggregate breakdowns (`byAuthor` / `byRepository`) on the new panel — locked OMIT per Q-R3 Pass 3 reaffirmation.
- Shared helper extraction (`shared/period-pr-list.ts` or similar) — locked Branch B per Q-R4 Pass 3 pre-flight; reviewer-drilldown source / tests / fixture regression-locked.
- **Fixing pre-existing potential namespace mismatch in `applyFiltersToRollups` at `metrics.ts:921`** — Pass 3 noticed `filters.repos.includes(repoId)` may compare repository_name strings against repository_id GUIDs in the per-PR filter step. This affects the existing throughput-drilldown / cycle-time-drilldown / sparkline-driven read path identically; #363 inherits the same behavior. **Out of #363's scope; recorded as a separate triage item** so a future PR can investigate, decide, and fix in isolation. Do not let this expand #363's PR.

## Dependencies

- #365 (cycle-time PR drilldown) — shipped; supplies the `cycle_time desc, id asc` invariant and the cycle-time DetailPanel options-bag pattern.
- #362 / #366 (reviewer PR drilldown) — shipped; supplies the cross-week union / cap / truncation accumulator pattern and the capability-off baseline fixture pattern.
- #310 (comments visualization capability gate) — shipped; supplies the `commentsMetricsAvailable` gate and the comments stat row builder.
- #060 / #317 (throughput PR drilldown) — shipped; supplies the original `cycle_time desc, id asc` ordering and the `PrListSection` discriminated union.
- #059 (chart drill-down baseline) — shipped; supplies the inline advisory `renderNoData` path (FR-003) and the sparkline-trigger DOM contract.

## Constitution / repo-pattern reminders

- Cross-OS test discipline (Windows / macOS / Linux); no `Any` types in TS source; zero suppressions; comprehensive Jest coverage.
- Per-commit ratchet (memory `feedback_floor_bump_amend_into_test_commit` / `feedback_test_floor_contract_same_commit`): each commit that adds tests bumps `.test-floor-contract.json` extension floor with the measured count.
- Spread-guard `ALLOWED_MODULES` (`pr-list-comments-spread-guard.test.ts`) extended for `sparkline-navigator.ts` if and only if the navigator imports from `shared/detail-panel`. Plan must encode the if/else.
- 4-pass speckit cadence (memory `feedback_speckit_rigor` / `feedback_speckit_cadence_applies_to_tasks`): Pass 1 draft → Pass 2 hardening → Pass 3 code-validation → Pass 4 planning-readiness (current); `/speckit.analyze` runs AFTER Pass 4 once `/speckit.plan` and downstream artifacts are drafted. No architectural decisions deferred to implementation; the only remaining plan-time decision is Q-R2 (panel-title formatter shape).

## Deferred to plan / contracts (Pass 3 carries forward)

- All concrete TypeScript signatures (deferred to plan / data-model / contracts).
- The exact panel-title formatter (Q-R2; locked at plan / contracts time).
- Test count budget. The implementation slice will measure the floor delta exactly; preliminary projection is +25 to +35 extension tests but this is NOT a contract.

Items resolved during Pass 3 (no longer deferred):

- ~~Whether overlay re-application is needed at this layer (Q-R1)~~ — RESOLVED R1-A in Pass 3. Spec FRs are written for fully-pre-filtered rollups.
- ~~Panel section ordering (Q-R3)~~ — RESOLVED OMIT in Pass 3. Spec locks panel structure to `[stats?, prList]` only.
- ~~Helper-extraction touch-radius pre-flight (Q-R4)~~ — RESOLVED Branch B (local duplication) in Pass 3.
- ~~Demo-data exercise verification (Q-R5)~~ — RESOLVED R5-A in Pass 3.

## Pass 2 hardening notes (what changed from Pass 1)

For traceability — diff summary of Pass 1 → Pass 2:

1. **Status header** advanced to `Draft (Pass 2 — hardened)`.
2. **LD-4 abort criteria** tightened: was "any DOM/test regression triggers fall-back"; now adds explicit broad-movement rules (touch radius limited to two files, no signature rewrites in reviewer-drilldown, no test edits / fixture regenerations to keep tests passing). "Almost passing" Branch A is forbidden.
3. **LD-5 wording** changed from "out of scope" absolute to "default out-of-scope, locked as Q-R5 research item." Burden of proof to re-open scope is on research.
4. **Open research questions** section restructured as "Research items locked for verification" with explicit two-branch outcomes per question (R1-A/B, R5-A/B). No item is left as a "we'll figure it out later" slot.
5. **Q-R1** rewritten: from "working assumption that drives FR-006" to "explicitly NOT an assumption; spec is written correct under both R1-A and R1-B branches." If supplementary overlay is needed, contract grows to mirror `reviewer-drilldown.ts:335-348` patterns.
6. **Q-R3** tightened: default decision is now explicitly **OMIT** breakdowns; reuse permitted only under three concrete cheap-reuse conditions (existing helper, zero new tests, zero baseline fixture byte changes). Burden of proof to expand contract is on research.
7. **Q-R4** decision rule made explicit: Branch A permitted only if exactly-one source change with zero test/fixture changes. Pre-flight grep recorded in research.md.
8. **Q-R5 (NEW)**: demo-data exercise verification with explicit R5-A / R5-B outcomes. R5-B grows scope to include `chore(demo)` regen commit.
9. **FR-005** stripped "e.g.": `data-drilldown-cycle-metric` is now contract; alternative names require re-spec.
10. **FR-015** stripped "atomically": replaced with explicit per-dismiss-path lifecycle ordering and the dismiss-path enumeration.
11. **FR-016** retarget-in-place sequence written as a four-step explicit ordering with no-overlap invariants.
12. **FR-022** rewritten with the broad-movement abort criteria mirroring LD-4.
13. **FR-023** adds pre-flight grep mandate: implementation SHOULD pre-flight touch radius before first Edit; abort criteria MUST be re-checked after every reviewer-drilldown change.
14. **Assumptions** section pruned: items that were Q-R1-dependent are removed (now locked under research); inherited-contract items kept and explicitly labeled as inherited.
15. Every FR that depended silently on Q-R1 / Q-R5 outcomes is now correct under both branches of those research items.

Reviewers-card out-of-scope behavior (LD-2, FR-002, US3, SC-005) is **unchanged from Pass 1** — verified intact during Pass 2 hardening, and re-confirmed during Pass 3 code-validation.

## Pass 3 code-validation notes (what changed from Pass 2)

For traceability — diff summary of Pass 2 → Pass 3:

1. **Status header** advanced to `Draft (Pass 3 — code-validated)`.
2. **All ten "Verified Inputs at HEAD" claims re-verified at HEAD against current source**. No drift detected; every cited file path, line range, function name, type definition, and constant matches the spec.
3. **Q-R1 → R1-A locked** (spec LD-1 step 5 / FR-008): `dashboard.ts:1045` calls `applyFiltersToRollups(rawRollups, currentFilters)` BEFORE drilldown installs at L1320-1345. The function (`metrics.ts:441-933`) handles all four filter axes and emits filtered `prs[]` along with `_prs_truncated`/`_prs_cap` passthrough at L906-924. R1-B branch removed from contract. FR-008's "(if any)" hedge dropped.
4. **Q-R4 → Branch B locked** (LD-4 / FR-021..FR-023): pre-flight against `reviewer-drilldown.ts:282-322` shows the per-(reviewer, week) `entry`-walk pattern requires a callback-based loop body restructure to fit a unifying helper, exceeding the "single mechanical call-site swap" criterion. Branch A disqualified at pre-flight. Reviewer-drilldown's six paths (1 source + 4 tests + 1 fixture) are regression-locked: implementation commit's `git diff` MUST show zero hunks under those paths.
5. **Q-R5 → R5-A locked** (LD-5): sample of `docs/data/aggregates/weekly_rollups/2025-W40.json` shows `pr_count: 106 / prs.length: 106 / _prs_cap: 500 / _prs_truncated: false`, with PR records carrying every required field. No demo regen.
6. **Q-R3 → OMIT reaffirmed**: Pass 3 found no cheap-reuse signal in source. `breakdownSection` in throughput-drilldown.ts is per-rollup; producing a cross-week aggregate would require a new accumulator walk plus new tests. All three Pass-2 cheap-reuse conditions fail. Panel structure locked to `[stats?, prList]` only.
7. **Q-R2 stays deferred** to plan-time (panel title shape — design judgment, not source-inspectable).
8. **Reviewer-card scroll/highlight preserved**: confirmed via the activate() branching shape (`if target === throughput|cycle-time → openDetailPanel; else target === reviewer → existing scrollIntoView + is-sparkline-highlight`). Existing `sparkline-navigator.test.ts` reviewer-card tests stay green by construction.
9. **No producer / schema / `PrRecord` path implicated**: every field the slice reads exists at HEAD in `Rollup` / `PrRecord` types and demo data. Zero schema deltas, zero producer-side code, zero new fields.
10. **Out-of-scope flag recorded** (now in Non-goals): `applyFiltersToRollups` at `metrics.ts:921` uses `filters.repos.includes(repoId)` which may compare `repository_name` strings against `repository_id` GUIDs in the per-PR filter step. This is pre-existing behavior shared with throughput-drilldown's already-shipped read path; #363 inherits the same semantics. **NOT in #363 scope** — flagged for separate triage so future readers know this slice is not the place to fix it. Do not let this expand #363's PR.
11. **Branch A discussion preserved as "considered and rejected"** in LD-4 with citation to Q-R4 pre-flight evidence, per memory `feedback_no_speckit_doc_updates_on_late_pr_fixes` adjacent practice — future readers see why duplication was chosen instead of extraction.
12. **Assumptions section** updated: dropped the "spec correct under both Q-R1 / Q-R5 outcomes" bullet (now locked to single outcomes); commit-shape line locked to "1 planning + 1 implementation commit" (Q-R5=R5-A means no `chore(demo)`).

## Pass 4 planning-readiness notes (what changed from Pass 3)

For traceability — diff summary of Pass 3 → Pass 4. Pass 4 is a residual-drift sweep; no contract changes, no new decisions, no Q-R locks. Five user-directed verifications confirmed:

1. **Pure-overlay reduction edge case** (line 181) relabeled clearly as *forward-compatibility only, unreachable in #363's scope*. The "(LD-1 step 5 deferred)" / "Final answer locked in research / data-model" stale markers were dropped.
2. **No FR/SC implies Branch A**: SC-007 was the sole leftover (`whether implementation chose Branch A or Branch B`); rewritten to lock Branch B with FR-022 cross-reference. FR-021..FR-023 already locked Branch B at Pass 3. Non-goals already locks shared helper extraction OUT.
3. **No task/commit-shape language anticipates demo regen**: LD-5, Assumptions, and Non-goals all consistently say "no demo regen, 1 planning + 1 implementation commit." The Pass-2 hardening notes section preserves a historical log entry mentioning R5-B as a Pass-2-time outcome — historically accurate, not a current-state claim, retained.
4. **Reviewer card scroll-and-highlight only**: confirmed unchanged across LD-2, US3 (4 acceptance scenarios), FR-002, FR-017, FR-020, SC-005, SC-006, and the "Keyboard activation on the reviewers card" edge case.
5. **Q-R2 is the only remaining plan-time decision**: Q-R1=R1-A locked, Q-R3=OMIT confirmed, Q-R4=Branch B locked, Q-R5=R5-A locked. Q-R2 (panel-title formatter shape) is the sole DEFERRED item. Status header, Constitution reminder, and final marker now state this directly.

**Other Pass 4 cleanups**:

6. **Status header** advanced to `Draft (Pass 4 — planning-ready)`.
7. **Verified Inputs at HEAD** intro updated: removed the stale "Re-verify at HEAD before Pass 4 closes" instruction; replaced with a Pass-3-completed assertion.
8. **LD-2 table column heading** updated: "subject to Pass 4 review" → "Q-R2 — pending plan-time lock" (correct routing).
9. **Requirements section intro** updated: "Branch-aware from Pass 1" → "Branch-aware from Pass 1, hardened through Pass 3 code-validation."
10. **Constitution / repo-pattern reminders** updated: dropped the "(this)" Pass-1 placeholder; states current pass and what's deferred.

**What did NOT change (Pass 3 → Pass 4)**: LD-1..LD-5 (unchanged); LD-1's 8-step recipe (unchanged); FRs 001-023 (FR-022/023 unchanged from Pass 3 locks; SC-007 was the only Branch-A-leftover and is now corrected); US1-US4 acceptance scenarios; 11 edge cases (one relabeled, none added/removed); 8 non-goals; 5 dependencies; Q-R1/Q-R3/Q-R4/Q-R5 locks (Pass 3 verdicts unchanged); reviewers-card preservation (re-confirmed for the third time across passes).

—

End of Pass 4 (planning-ready). **Spec is now ready for `/speckit.plan`. Q-R2 (panel-title formatter shape) is the sole remaining plan-time decision; all other architectural decisions are locked in spec.** Do not advance to `/speckit.plan`, `/speckit.clarify`, or any source code work until the user has reviewed and approved this Pass 4 sweep.
