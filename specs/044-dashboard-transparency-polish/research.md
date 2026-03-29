# Research: 044 Dashboard Transparency Polish

**Date**: 2026-03-29
**Spec**: [spec.md](spec.md)

## R1: Review Time Data Flow

**Question**: How do review_time_p50/p90 flow from schema to rendering?

**Finding**: The schema (`rollup.schema.ts:41-42, 68-69`) defines `review_time_p50` and `review_time_p90` on both `BreakdownEntry` and `WeeklyRollup`. `normalizeRollup()` (`rollup.schema.ts:547-550`) normalizes these to null if absent. However, `calculateMetrics()` (`metrics.ts:84-122`) does NOT extract review_time — only cycle_time. `extractSparklineData()` (`metrics.ts:743-757`) likewise only maps cycle_time_p50/p90. The `CalculatedMetrics` interface (`metrics.ts:54-60`) has no review_time fields.

**Decision**: Extend `CalculatedMetrics` with `reviewTimeP50: number | null` and `reviewTimeP90: number | null`. Add extraction logic inside the existing `calculateMetrics()` pass (same pattern as cycleP50/P90 — median of non-null values). Extend `extractSparklineData()` return type with `reviewTimeP50s` and `reviewTimeP90s` arrays. This is a same-pass extension, not a new O(n) function (satisfies FR-027).

**Alternatives rejected**: Separate `calculateReviewMetrics()` function — violates FR-027 (new full-data pass).

---

## R2: Approval Rate Propagation Through Filter Path

**Question**: How does approval_rate survive dimension filtering?

**Finding**: `aggregateReviewerEntries()` (`metrics.ts:282-327`) computes a PR-weighted average `approval_rate`. However, `applyFiltersToRollups()` (`metrics.ts:460-474`) calls `buildFilteredRollup()` which only passes `pr_count`, `cycle_time_p50: null`, `cycle_time_p90: null`, `authors_count`, and `reviewers_count` — **dropping approval_rate entirely**.

**Decision**: The filtered rollup does not carry approval_rate because the Rollup type doesn't have it at the top level (it's only in `by_reviewer` breakdowns). Instead of polluting the Rollup type, compute approval_rate separately in `renderReviewerActivity()` by accessing the raw `by_reviewer` breakdown from unfiltered rollups when `reviewerFilterActive` is true. This parallels how reviewer-activity already receives `unfilteredRollups` as an option.

**Alternatives rejected**: Adding approval_rate to the Rollup type — would pollute the schema contract for a rendering-only concern.

---

## R3: Sparkline Lookback Window

**Question**: Where is the sparkline lookback defined and how to centralize?

**Finding**: `renderSparkline()` (`charts.ts:81`) hardcodes `nonNull.slice(-8)`. The value `8` is a magic number with no constant. `MAX_REVIEWER_WEEKS = 8` exists in `reviewer-activity.ts:22` but is conceptually different (chart display cap vs sparkline lookback).

**Decision**: Create a new exported constant `SPARKLINE_LOOKBACK_WEEKS = 8` in `charts.ts` and a companion function `getLookbackWeekCount(rollups: Rollup[]): number` that returns `Math.min(rollups.length, SPARKLINE_LOOKBACK_WEEKS)`. Use the constant in `renderSparkline()` and the function in `summary-cards.ts` for label generation. This satisfies FR-010's "single exported function" requirement.

**Alternatives rejected**: Reusing `MAX_REVIEWER_WEEKS` — semantically different cap; would create confusing coupling.

---

## R4: Mobile Breakpoint Coordination

**Question**: How to coordinate a JS constant with CSS media queries?

**Finding**: `styles.css` uses `@media (max-width: 480px)` at line 2462. CSS media queries cannot reference JS variables. The existing CSS also has `@media (max-width: 768px)` at line 2423.

**Decision**: Define `MOBILE_BREAKPOINT = 480` as a JS constant in a new `shared/constants.ts` file. Keep the CSS `@media` rule as-is. Add an automated test that greps `styles.css` for `max-width: 480px` and asserts it matches the JS constant value. This satisfies FR-014's "coordinated JS constant + CSS value" requirement.

**Alternatives rejected**: CSS custom properties — `@media` rules cannot use `var()`.

---

## R5: Distribution Bucket Color Implementation

**Question**: How to implement color-coded buckets given the current rendering pattern?

**Finding**: `renderCycleDistribution()` (`cycle-time.ts:69-106`) builds a Map of 6 hardcoded bucket labels, accumulates counts from distribution data, then generates HTML with `dist-row`, `dist-label`, `dist-bar`, `dist-value` classes. No color differentiation exists.

**Decision**: Create a `BUCKET_COLOR_MAP` constant (Map<string, "fast" | "moderate" | "slow">) in `cycle-time.ts`. During HTML generation, look up each bucket label and add the corresponding `bucket-fast`, `bucket-moderate`, or `bucket-slow` CSS class to the `dist-row` element. Add CSS rules for each class using existing design system variables (--success, --warning, --error). Unknown labels fall back to default --primary color.

---

## R6: Truncation Indicator Restyling

**Question**: What's the current truncation indicator implementation?

**Finding**: `.truncation-indicator` at `styles.css:979-984` is plain text: `font-size: 12px; font-weight: 500; color: var(--text-secondary); margin-bottom: 8px`. Used in `throughput.ts:107`, `reviewer-activity.ts:132`, and `cycle-time.ts` (similar pattern). The HTML is `<div class="truncation-indicator">Showing last N weeks</div>`.

**Decision**: Add `.truncation-badge` as an additional class on the same element (`.truncation-indicator.truncation-badge`). Style with `background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: var(--radius); padding: 6px 12px; font-weight: 600; display: inline-block`. At `@media (max-width: 480px)`, switch to `display: block; width: 100%; background: var(--warning-bg); border-left: 3px solid var(--warning)`. This gives both backward compat and testable new class.

---

## R7: Dimmed Legend Opacity

**Question**: What's the current state?

**Finding**: `.dimmed` at `styles.css:1006-1008` has `opacity: 0.3`. `.legend-insufficient` at `styles.css:1001-1004` has `opacity: 0.5; font-style: italic`. These are separate classes — `.dimmed` is the one referenced in the spec.

**Decision**: Change `.dimmed { opacity: 0.3 }` to `.dimmed { opacity: 0.55 }`. Single line change.

---

## R8: Sample Size Source

**Question**: How is totalPrs computed and can it be reused?

**Finding**: `calculateMetrics()` (`metrics.ts:95`) already computes `totalPrs = rollups.reduce((sum, r) => sum + (r.pr_count || 0), 0)`. This is the exact value needed for sample size.

**Decision**: Reuse `calculateMetrics().totalPrs` as the sample size. It's already computed once from filtered rollups. Pass it to `renderSummaryCards()` which already calls `calculateMetrics()` at line 113. No new computation needed.

---

## R9: Component Extraction Candidates (LOC Analysis)

**Question**: What specific code sections are extractable?

**Finding** (current LOC baseline):
- `charts.ts`: 257 lines (renderDelta, renderSparkline, tooltip utilities)
- `throughput.ts`: 191 lines (bar chart + truncation + label decimation)
- `cycle-time.ts`: 311 lines (distribution bars + P50/P90 trend line)
- `reviewer-activity.ts`: 140 lines (horizontal bars + truncation)
- `summary-cards.ts`: 347 lines (metrics + sparklines + info icons)
- **Total**: 1,246 lines

**Extractable patterns**:
1. Horizontal bar HTML generation: `reviewer-activity.ts:111-128` (~18 lines) + `cycle-time.ts:89-101` (~13 lines) = ~31 lines deduplicable
2. SVG sparkline path: `charts.ts:81-111` (~30 lines) — can be split into reusable point-scaling + path-building
3. Label decimation: `throughput.ts` label step logic (~10 lines) + `cycle-time.ts` same pattern
4. Truncation indicator HTML: 3 modules × ~3 lines each = ~9 lines

**Decision**: Target at least 80 lines net reduction measured after Phase 1-2 additions. Focus extraction on horizontal bar (biggest win) and truncation indicator (cleanest extraction). SVG path and label decimation are secondary.
