# Implementation Plan: 044 Final Polish — Fixes, Transparency & Test Coverage

**Branch**: `044-dashboard-transparency-polish` | **Date**: 2026-03-29 | **Spec**: [spec.md](spec.md)
**Input**: Branch review findings + 3 new transparency issues + 2 open test tasks (T042, T050)

## Summary

Final phase of the 044 branch. Five discrete work items:

1. **Low-sample threshold cliff** — Replace the binary low-sample indicator (hard cutoff at 10) with a multi-tier visual treatment so confidence reads as a gradient, not a cliff.
2. **Median-of-medians disclosure** — Add aggregation-method context to metric tooltips so analytical users understand the derivation.
3. **Delta "vs prev" period clarification** — Replace the ambiguous "vs prev" label with an explicit comparison period derived from the actual data.
4. **T042** — Mobile responsive DOM test for distribution row stacking.
5. **T050** — Mobile responsive DOM test for truncation indicator banner.

## Technical Context

**Language/Version**: TypeScript 5.x (extension UI + tests)
**Primary Dependencies**: esbuild (IIFE bundler), vanilla DOM, renderTrustedHtml + escapeHtml
**Storage**: N/A (reads JSON aggregates)
**Testing**: Jest 30 (ts-jest transformer)
**Target Platform**: Azure DevOps extension hub + CLI local + /docs demo
**Project Type**: Extension UI dashboard
**Constraints**: All 3 entry points must stay in parity; no framework; no new O(n) data passes

## Constitution Check

*GATE: Checked against constitution v1.3.0.*

| Gate | Status | Notes |
|------|--------|-------|
| QG-17 | PASS | lint + format checked by pre-commit hooks |
| QG-18 | PASS | tsc checked by pre-commit hooks |
| QG-19 | PASS | Jest test:ci gate runs in pre-commit/pre-push/CI |
| QG-28 | N/A | No performance-critical changes (CSS + label text only) |
| QG-29 | N/A | No MAX_*_POINTS changes |
| QG-30 | PASS | Shared UI bundle; parity enforced by render-equivalence tests |
| QG-35-38 | PASS | All local/CI parity gates satisfied by existing hooks |

No violations. No complexity justification needed.

## Project Structure

```text
specs/044-dashboard-transparency-polish/
├── plan.md              # This file
├── research.md          # Phase 0 (already complete from prior work)
├── data-model.md        # Phase 1 (already complete from prior work)
├── quickstart.md        # Phase 1 (already complete from prior work)
└── tasks.md             # Phase 2 (to be updated with new tasks)
```

### Source Files Modified

```text
extension/ui/modules/charts.ts                     # Delta label change
extension/ui/modules/charts/summary-cards.ts        # Low-sample tiers + tooltip text
extension/ui/modules/shared/constants.ts            # Threshold tier boundaries
extension/ui/styles.css                             # Multi-tier CSS classes
docs/styles.css                                     # Parity copy
src/ado_git_repo_insights/ui_bundle/styles.css      # Parity copy

extension/tests/modules/charts/summary-cards.test.ts  # Low-sample tier tests + delta label tests
extension/tests/invariants/mobile-layout.test.ts       # T042 + T050
```

---

## Research (Phase 0)

### R1: Low-Sample Tier Design

**Question**: How to replace the binary cliff with a gradient without over-engineering?

**Finding**: The current implementation at `summary-cards.ts:209` applies a single binary class:
```typescript
const isLow = totalPrs < LOW_SAMPLE_THRESHOLD; // 10
subtitle.className = isLow ? "metric-sample-size low-sample" : "metric-sample-size";
```
CSS treatment (`styles.css:794`): `font-style: italic; opacity: 0.7`.

**Decision**: Introduce a 3-tier system using the existing `LOW_SAMPLE_THRESHOLD = 10` as the boundary between tiers 1 and 2, with a new `MODERATE_SAMPLE_THRESHOLD = 30` as the boundary between tiers 2 and 3:

| Tier | PR count | CSS class | Visual treatment |
|------|----------|-----------|------------------|
| Low | < 10 | `.low-sample` | italic, opacity 0.55, warning icon prefix "⚠ " |
| Moderate | 10–29 | `.moderate-sample` | opacity 0.8 (subtle de-emphasis, no italic) |
| Adequate | >= 30 | (none) | Normal rendering |

This preserves backward compatibility (`.low-sample` class still exists for tests that check it) while adding a middle tier that smooths the visual transition. The existing `LOW_SAMPLE_THRESHOLD` constant keeps its value; a new `MODERATE_SAMPLE_THRESHOLD` constant is added beside it.

**Alternatives rejected**:
- Continuous opacity formula (e.g., `opacity = min(1, prCount / 30)`) — harder to test, no clear semantic meaning, accessibility risk at very low opacities.
- 5-tier system — over-engineered for the information density of a subtitle.

### R2: Median-of-Medians Tooltip Wording

**Question**: How to disclose aggregation method without making tooltips overly technical?

**Finding**: Current METRIC_EXPLANATIONS (`summary-cards.ts:28-61`) describe what each metric measures but not how it's derived. Example:
```
"Median time from PR creation to merge. Half of all PRs completed faster than this."
```
The actual calculation is median-of-weekly-medians (`metrics.ts:84-138`), which can diverge from true median when weekly sample sizes vary.

**Decision**: Append a parenthetical to cycle time and review time tooltips: `"(Aggregated from weekly values.)"`. This is honest without being intimidating. Users who care will understand; users who don't will ignore the parenthetical. No change to totalPrs, authorsCount, or reviewersCount tooltips (those are sums/averages, not medians).

Updated tooltip text:
- cycleP50: `"Median time from PR creation to merge. Half of all PRs completed faster than this. (Aggregated from weekly values.)"`
- cycleP90: `"90th percentile cycle time. 90% of PRs completed faster. High values may indicate bottlenecks. (Aggregated from weekly values.)"`
- reviewTimeP50: `"Median time from first review request to review completion. Half of all reviews completed faster than this. (Aggregated from weekly values.)"`
- reviewTimeP90: `"90th percentile review time. 90% of reviews completed faster. High values may indicate review bottlenecks. (Aggregated from weekly values.)"`

**Alternatives rejected**:
- Separate "How is this calculated?" expandable section — too much UI complexity for a tooltip.
- "Median of weekly medians" literal text — too technical for the target audience (engineering managers).

### R3: Delta Period Label

**Question**: What does "vs prev" actually compare, and how to label it clearly?

**Finding**: `getPreviousPeriod()` (`metrics.ts:162-171`) computes a mirror-image window: if the current range is N days, the previous range is the N days immediately before it. The `renderDelta()` function (`charts.ts:67`) hardcodes the label `"vs prev"`.

The sparkline already shows "Last N weeks" via `getLookbackWeekCount()`. The delta comparison window is determined by the date range picker — it compares the current selected period against the immediately preceding period of equal length. For the default 8-week view, "vs prev" means "vs the 8 weeks before that."

**Decision**: Change the delta label from the static `"vs prev"` to a dynamic label computed from the previous-period rollup count. The `renderDelta` signature gains an optional `periodLabel` parameter defaulting to `"vs prev"` for backward compatibility. `renderDeltas()` in summary-cards.ts passes a computed label like `"vs prior 8 weeks"` derived from `prevRollups.length`.

Format: `"vs prior N week(s)"` where N = `prevRollups.length`. When prevRollups is empty, deltas are already cleared (no label needed).

**Alternatives rejected**:
- Showing exact date ranges (e.g., "vs Jan 5 – Mar 1") — too long for the delta label space, would require layout changes.
- Tooltip-only disclosure — users shouldn't have to hover to understand what's being compared.

---

## Design Decisions

### D1: Parity Enforcement

All CSS changes go to all 3 `styles.css` files (extension, docs, src). The dashboard.js bundle is built from TypeScript and copied to docs + src automatically by the build step — no manual sync needed for JS.

### D2: No New Data Passes

All changes are rendering-layer only:
- Tier classification is a simple numeric comparison on `totalPrs` (already computed)
- Delta label is derived from `prevRollups.length` (already available)
- Tooltip text is a static string change

### D3: Test Strategy

- **Low-sample tiers**: Extend existing summary-cards.test.ts with tests at each tier boundary (9, 10, 29, 30)
- **Tooltip text**: Extend summary-cards-info.test.ts to verify the aggregation parenthetical
- **Delta label**: Add tests in summary-cards.test.ts verifying dynamic period text
- **T042/T050**: Add DOM-based responsive tests in mobile-layout.test.ts

---

## Implementation Phases

### Work Item 1: Low-Sample Tier System

**Files**: `shared/constants.ts`, `summary-cards.ts`, `styles.css` (x3), `summary-cards.test.ts`

1. Add `MODERATE_SAMPLE_THRESHOLD = 30` to `shared/constants.ts`
2. Update `renderSampleSize()` in `summary-cards.ts` to apply 3-tier classification:
   - `totalPrs < LOW_SAMPLE_THRESHOLD` → class `low-sample`, prefix "⚠ "
   - `totalPrs < MODERATE_SAMPLE_THRESHOLD` → class `moderate-sample`
   - else → no extra class
3. Update `.low-sample` CSS rule: change opacity from 0.7 to 0.55 (consistent with dimmed legend)
4. Add `.moderate-sample` CSS rule: `opacity: 0.8` (no italic)
5. Sync CSS to all 3 entry points
6. Add boundary tests: 9 PRs → low-sample, 10 PRs → moderate-sample, 29 PRs → moderate-sample, 30 PRs → no class

### Work Item 2: Median-of-Medians Disclosure

**Files**: `summary-cards.ts`, `summary-cards-info.test.ts`

1. Append `" (Aggregated from weekly values.)"` to the 4 median/percentile entries in `METRIC_EXPLANATIONS`
2. Update info icon test assertions to verify the new text

### Work Item 3: Delta Period Label

**Files**: `charts.ts`, `summary-cards.ts`, `summary-cards.test.ts`

1. Add optional `periodLabel?: string` parameter to `renderDelta()` in `charts.ts`, defaulting to `"vs prev"`
2. Update `renderDeltas()` in `summary-cards.ts` to accept `prevRollups` length and compute `"vs prior N week(s)"`
3. Pass the computed label to each `renderDelta()` call
4. Add test: with 8 prev rollups, assert delta contains "vs prior 8 weeks"
5. Add test: with 1 prev rollup, assert delta contains "vs prior 1 week"

### Work Item 4: T042 — Mobile Distribution Row Test

**Files**: `mobile-layout.test.ts`

1. Add test that renders a cycle-time distribution at a viewport below MOBILE_BREAKPOINT
2. Assert `.dist-row` elements have the stacked-layout CSS class or computed flex-direction
3. Since JSDOM doesn't compute media queries, verify via CSS file grep that `@media (max-width: 480px)` contains `.dist-row` with `flex-direction: column`

### Work Item 5: T050 — Mobile Truncation Banner Test

**Files**: `mobile-layout.test.ts`

1. Add test that verifies the mobile CSS for `.truncation-badge` at narrow viewport
2. Assert via CSS file grep that `@media (max-width: 480px)` contains `.truncation-badge` with `display: block` and `width: 100%`

---

## Verification

After all work items:

1. `pnpm run test:ci` — all Jest tests pass (existing + new)
2. `git diff --stat` — CSS changes are identical across all 3 entry points
3. Pre-commit hooks pass (tsc, eslint, ruff, suppression audit)
4. Visual spot-check: dashboard renders correctly with sample dataset
