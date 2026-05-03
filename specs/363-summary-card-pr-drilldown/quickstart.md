# Quickstart: Verify the Summary-Card Sparkline PR-Level Detail Feature (Issue #363)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Contract**: [contracts/sparkline-pr-list.md](./contracts/sparkline-pr-list.md)

This walkthrough verifies every spec acceptance scenario and every Success Criterion, using only documented commands and the published demo dataset (which currently includes per-PR detail — see Pass 3 R4 evidence in `research.md`). No live ADO connection required for the local-developer verification path.

## Pre-flight setup

```bash
# From repo root, on the 363-summary-card-pr-drilldown branch:
pnpm install
cd extension && pnpm install --frozen-lockfile
cd ..
```

## 1. Build the extension and serve the demo

```bash
cd extension
pnpm run build:ui          # bundles ui/ into dist/ui/ (esbuild, IIFE)
pnpm run serve:docs        # serves ../docs/ at http://localhost:3000
```

Open `http://localhost:3000` in a Chromium-based browser. The dashboard loads against the published demo dataset under `docs/data/`. Confirm the date range covers a multi-week window (the default range typically spans 8+ weeks).

## 2. P1 — See the period's PRs from the throughput card

**Spec ref**: User Story 1, FR-001 / FR-006 / FR-010 / FR-011, SC-001 / SC-002.

1. With no filters applied and a multi-week date range visible, locate the **Total PRs merged** summary card.
2. Click anywhere on its sparkline (the small inline chart).
3. **Verify** the side panel opens and shows, in this order:
   - Title: `Period of {month-day-range}, {year}` (e.g., `Period of Mar 17 – Apr 13, 2025`) — NO P50/P90 marker on this card.
   - Subtitle: `{N} PRs` (matching the period's total `pr_count` sum).
   - Period-scoped PR list section, with rows showing PR titles and cycle times in `cycle_time desc, id asc` order (slowest first).
4. **Verify** the top row's cycle time is the highest in the list (slowest first; FR-010 / SC-001).
5. Click any PR row.
6. **Verify** the PR opens in Azure DevOps in a new browser tab; the dashboard panel state is intact.
7. Press Escape to dismiss the panel.
8. **Verify** the active class on the sparkline trigger clears; `aria-expanded` flips to `false`.

## 3. P1 — See the period's PRs from cycle-time cards with metric markers

**Spec ref**: User Story 2, FR-001 / FR-005 / FR-006 / FR-010, SC-001 / SC-002.

### 3a. Cycle-time P50

1. With the panel from § 2 closed (or any state), click the **Cycle time P50** summary card sparkline.
2. **Verify** the panel opens with title `Period of {month-day-range}, {year} — P50`.
3. **Verify** subtitle is `{N} PRs` matching § 2's count (same period, same rollup window).
4. **Verify** the PR list rows are byte-equivalent to § 2's content (same PR set, same order — both cards consume the same period union).

### 3b. Cycle-time P90 with retarget-in-place

1. With the P50 panel still open from § 3a, click the **Cycle time P90** summary card sparkline.
2. **Verify** the panel retargets in place — single CSS transition, no close-then-reopen flicker (FR-016 / SC-002).
3. **Verify** the panel title swaps to `... — P90` (preserving the period part; only the metric marker changes).
4. **Verify** PR list rows are unchanged (same period union; only the title metric differs).
5. **Verify** `is-drilldown-active` class moved from the P50 trigger to the P90 trigger; both never had it simultaneously (FR-016 no-overlap invariant).
6. **Verify** `aria-expanded` is `true` on P90 trigger and `false` on P50 trigger.

### 3c. Cross-source retarget (cycle-time card → throughput card)

1. With the P90 panel still open from § 3b, click the **Total PRs merged** summary card sparkline.
2. **Verify** the panel retargets — title swaps to no-marker form (`Period of ...`).
3. **Verify** active-class lifecycle moved cleanly (P90 trigger lost it; throughput trigger gained it).

## 4. P2 — Reviewer card preserves scroll-and-highlight (LD-2 asymmetry)

**Spec ref**: User Story 3, FR-002, SC-005.

1. Close any open panel (Escape).
2. Click the **Reviewers** summary card sparkline.
3. **Verify** the page scrolls so `#reviewer-activity` (the full reviewer-activity chart) is in view.
4. **Verify** the chart container briefly highlights (via the `is-sparkline-highlight` class for ~1500ms).
5. **Verify** NO DetailPanel opens. (This is the contract-locked asymmetry — reviewer card preserves existing behavior.)
6. **Verify** keyboard activation produces the same outcome: Tab to the reviewers sparkline, press Enter or Space, observe scroll + highlight, no panel.

## 5. P2 — Filter awareness across all three eligible cards

**Spec ref**: User Story 1 acceptance scenarios 2/3, FR-011, SC-006.

### 5a. Team filter

1. Apply a single team filter from the team filter UI.
2. Click the throughput card sparkline.
3. **Verify** the PR list section shows the `team-inline` "clear the team filter" message — verbally and visually identical to the throughput chart's per-week drilldown under the same filter shape.
4. Repeat with cycleP50 and cycleP90 sparklines; verify the same `team-inline` message appears (FR-011 parity across all three eligible cards).

### 5b. Reviewer filter

1. Clear the team filter; apply a single reviewer filter.
2. Click any of the three eligible sparklines.
3. **Verify** the `reviewer-inline` message appears — identical to throughput's reviewer message.
4. **Note**: per LD-3 / FR-011, the `reviewer` classification is REACHABLE on this surface (unlike the reviewer-drilldown surface, which strips the reviewer filter). If a user has both a reviewer filter and a sparkline drilldown, they see the inline-message gate.

### 5c. Author / repo filter

1. Clear team and reviewer filters; apply an author filter (or repo filter, or both).
2. Click any of the three eligible sparklines.
3. **Verify** the PR list renders normally — the dashboard pre-filters the rollups per Q-R1=R1-A; no supplementary overlay is applied at the sparkline-navigator layer (FR-006 / Pass 3 R1 evidence).

### 5d. Comparison mode

1. Toggle comparison mode on.
2. Click any of the four sparklines (including reviewers).
3. **Verify** no panel opens, no scroll happens; the existing comparison-mode toast fires (FR-004 / FR-019 / SC-006).
4. Toggle comparison mode off; verify normal behavior resumes.

## 6. P2 — Capability-off DOM byte-shape

**Spec ref**: User Story 4, FR-012 / FR-013 / FR-014, SC-004.

This step is exercised primarily via the automated test suite (§ 7 below) since toggling capability state requires a custom dataset. For a manual spot-check:

1. If you have access to a dataset built without comments capability (`commentsMetricsAvailable: false`), point the extension at it.
2. Click any eligible sparkline.
3. **Verify** the panel renders WITHOUT comments columns and WITHOUT a comments stat row above the PR list.
4. Inspect the rendered DOM (browser DevTools); compare against `extension/tests/fixtures/sparkline-drilldown-capability-off-baseline.html` — should be byte-identical structure (modulo dynamic content like PR ids and titles, which the byte-comparison test parameterizes).

If you don't have a capability-off dataset, skip the manual check; the automated test in § 7 is the canonical verification.

## 7. P3 — Truncation cue and supported-empty branches

**Spec ref**: FR-007 / FR-008 / FR-009, SC-003 / SC-008.

### 7a. Truncation cue (synthesized via test fixture)

The demo's rollups have `_prs_truncated: false` (Pass 3 evidence; `2025-W40.json` shows `prs.length === pr_count`). To verify the truncation cue:

- **Option A** (live ADO): point the extension at a tenant where any week in the period has `pr_count > 500` (the producer cap from feature 060) AND `_prs_truncated: true`.
- **Option B** (test fixture): the consumer test suite at `extension/tests/modules/drilldown/sparkline-pr-list-count-parity.test.ts` exercises the truncation case via synthetic rollups with `_prs_truncated: true` and `_prs_cap: 500`. This is the canonical local verification path.

In either case, **verify** the panel renders the same truncation cue text the throughput / cycle-time / reviewer drilldowns render for the same condition. The cue gate fires when `anyTruncated || collected.length < totalPeriodPrCount` (LD-1 step 7).

### 7b. Supported-empty (zero PRs in period)

1. Construct or simulate a rollup window where every week has `pr_count: 0` and `prs: []` (e.g., apply a filter that matches no PRs anywhere).
2. Click any eligible sparkline.
3. **Verify** the PR list section renders the `supported-empty` inline message — distinct from the team / reviewer messages.

### 7c. Missing target chart (inline advisory preserved)

1. If you can render the dashboard with one of the full charts hidden (e.g., via dev-tools DOM removal of `#throughput-chart`), do so.
2. Click the corresponding sparkline.
3. **Verify** the existing inline advisory message renders adjacent to the sparkline (FR-003 / SC-008 / existing FR-052 from #059 path).
4. **Verify** the DetailPanel does NOT open — missing-target gate runs before the DetailPanel build attempt.

## 8. Run the consumer test suite

**Spec ref**: FR-010 / FR-013 / FR-022, SC-005 / SC-007.

```bash
cd extension
pnpm test:coverage
```

**Verify**:
- All sparkline-related tests pass (look for `extension/tests/modules/drilldown/sparkline-navigator.test.ts` and the new sibling files).
- Reviewer-drilldown's existing tests stay green (`reviewer-drilldown.test.ts`, `reviewer-pr-list-*.test.ts`, capability-off baseline) — Branch B regression-lock.
- The `extension/test-results.xml` JUnit artifact is produced.

Then run the ratchet-bump preview:

```bash
python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml
```

**Verify**:
- Output reports `actual=N` for the Extension dimension equal to `extension.min_collected` in `.test-floor-contract.json`.
- No drift, no inter-file parity violation.

Verify the reviewer-drilldown regression-lock (FR-022) — the implementation commit's `git diff` against the six paths MUST show zero hunks:

```bash
git diff --stat HEAD~1 -- \
  extension/ui/modules/drilldown/reviewer-drilldown.ts \
  extension/tests/modules/drilldown/reviewer-drilldown.test.ts \
  extension/tests/modules/drilldown/reviewer-pr-list-capability-off-baseline.test.ts \
  extension/tests/modules/drilldown/reviewer-pr-list-count-parity.test.ts \
  extension/tests/modules/drilldown/reviewer-pr-list-order.test.ts \
  extension/tests/fixtures/reviewer-drilldown-capability-off-baseline.html
```

**Verify**: zero changed lines / zero changed files. If any hunk appears, abort the commit, identify the cause, and revert.

## 9. Run the authoritative local preflight

**Spec ref**: SC-007.

```bash
python scripts/run_pr_preflight.py
```

**Verify**:
- Exit code 0.
- No `--allow-local-degraded` flag used.
- Every CommandSpec passes, including:
  - mypy on `src/`, `tests/`, `scripts/`, `.github/scripts/`
  - ruff check + format
  - pytest with full coverage (Python floor unchanged at HEAD)
  - Extension Jest CI (with the new tests)
  - Extension type tests (including the new `formatPeriodTitle` typing)
  - Extension smoke tests (Playwright)
  - PR-record schema parity (`scripts/check_pr_record_schema_parity.py`) — no-op for this consumer-only feature
  - Generated artifact parity (UI bundle, docs shell, broken-docs)
  - Test floor contract validation (`scripts/check_test_floor_contract.py`)
  - Ratchet-bump guard (`scripts/check_ratchet_bump.py`)
  - Coverage delta gate
  - Gitleaks secret scan
  - Suppression baseline gates (zero across all scopes)
  - All other CommandSpecs in the preflight chain

## 10. Visual regression spot-check

Open the dashboard before and after the change in two side-by-side browser windows. Compare:

- **Throughput chart drill-down panel** — MUST be unchanged (per-week panel; #363 doesn't touch it). Click a per-week bar and verify the existing per-week panel renders identically.
- **Cycle-time chart drill-down panel** — MUST be unchanged (per-(week, metric) panel; #363 doesn't touch it). Click a P50 or P90 dot and verify identical output.
- **Reviewer activity chart drill-down panel** — MUST be unchanged (Branch B regression-lock). Click a reviewer h-bar and verify identical output.
- **Sparkline navigation for reviewer card** — MUST be unchanged (LD-2 asymmetry). Click reviewers sparkline and verify scroll + highlight.
- **Summary cards layout** — MUST be unchanged except for the new `data-drilldown-cycle-metric` attribute on the two cycle-time triggers (invisible to users).
- **Summary card sparkline drill-down (NEW)** — three eligible cards (totalPrs, cycleP50, cycleP90) now open the DetailPanel with period-scoped PR list.

Any visual change on a chart or panel surface OTHER THAN the new sparkline-driven panel is a regression and MUST block delivery.

## 11. `formatPeriodTitle` helper unit test (Q-R2 lock)

**Spec ref**: Q-R2 lock in `data-model.md` § "Period title contract".

Run the `formatPeriodTitle` unit tests in `extension/tests/modules/drilldown/week-range.test.ts` (created by T008; placement locked per Pass 2):

```bash
cd extension
pnpm test -- --testPathPattern=week-range
```

**Verify** the helper produces:
- `formatPeriodTitle([])` → `"No period selected"` (unreachable in production but stable fallback).
- `formatPeriodTitle([single-rollup])` → `"Week of Mar 17 – 23, 2025"` (delegates to `formatWeekTitle`).
- `formatPeriodTitle([multi-rollup, same year])` → `"Period of Mar 17 – Apr 13, 2025"`.
- `formatPeriodTitle([multi-rollup, cross-year])` → `"Period of Dec 30, 2024 – Jan 26, 2025"`.

## 12. Manager-readability check

Hand `spec.md` (specifically User Stories 1 and 2) to a non-technical stakeholder. Ask them to summarize, in their own words and in under one minute, what the user sees today and what the user sees after the change.

A successful summary references:
- The summary cards at the top of the dashboard (the strip of metric tiles with sparklines).
- The current behavior (clicking a sparkline scrolls to the corresponding chart).
- The new behavior (clicking the throughput / cycle-time card sparklines opens a panel showing the actual PR list for the visible period; the reviewers card sparkline keeps the existing scroll behavior).

If the stakeholder cannot describe it within one minute, the user-story framing needs adjustment — but the Pass 1-4 spec drafting was specifically tested against this criterion across multiple iterations.

## Done criteria

The feature is verified locally when:

- All P1 / P2 / P3 acceptance scenarios above pass by inspection.
- The reviewer-card preservation (§ 4) passes — no DetailPanel, only scroll-and-highlight.
- Filter awareness (§ 5) parity across all three eligible cards.
- The capability-off DOM byte-shape test (§ 7 and § 8) passes.
- The consumer test suite (`pnpm test:coverage`) passes.
- The reviewer-drilldown regression-lock (`git diff` over six paths in § 8) returns zero changes.
- The ratchet-bump command reports zero drift on extension and Python floors.
- `python scripts/run_pr_preflight.py` returns exit 0 with no degradation flag.
- Visual regression spot-check (§ 10) shows no change on existing chart drill-downs.
- The `formatPeriodTitle` helper unit tests (§ 11) all pass.
- A non-technical stakeholder reads User Stories 1 and 2 and summarizes the change in under one minute.

At that point the feature is ready for the standard review cycle (Codex stop-hook + CI on PR).
