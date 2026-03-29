# Feature Specification: Dashboard Data Transparency, Visual Polish & Component Extraction

**Feature Branch**: `044-dashboard-transparency-polish`
**Created**: 2026-03-29
**Status**: Draft
**Input**: User description: "Issue #204 remaining 8 acceptance criteria — data transparency (review time, approval rate, sample size, sparkline labels), visual polish (color-coded distribution, legend opacity, truncation indicators), and shared component extraction"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Understanding Review Cycle Performance (Priority: P1)

As an engineering manager viewing the dashboard, I want to see how long the review process takes (review time P50/P90) so I can identify bottlenecks in my team's code review workflow distinct from overall cycle time.

**Why this priority**: Review time is the highest-value unsurfaced metric. The data already exists but users cannot see it, making it invisible to decision-makers who need it most. This directly increases the dashboard's analytical utility.

**Independent Test**: Can be fully tested by loading a dataset with review_time values and verifying the metric appears with correct values, info icon, and trend data.

**Acceptance Scenarios**:

1. **Given** a dataset with review_time_p50 and review_time_p90 values across multiple weeks, **When** the dashboard loads, **Then** review time P50 and P90 are displayed as metrics with formatted durations (e.g., "4h 12m"), each with an info icon explaining "Time from first review request to review completion."
2. **Given** a dataset where some weeks have null review_time values, **When** the dashboard loads, **Then** the metric gracefully handles missing data by calculating from available weeks only, and sparklines skip null points.
3. **Given** a dataset where ALL weeks have null review_time values, **When** the dashboard loads, **Then** the review time metrics display a "No data" state consistent with existing no-data patterns.

---

### User Story 2 - Assessing Reviewer Approval Behavior (Priority: P1)

As an engineering manager filtering by a specific reviewer, I want to see that reviewer's approval rate so I can understand review thoroughness and whether reviewers are rubber-stamping or providing meaningful feedback.

**Why this priority**: Approval rate is a critical drill-down metric that only makes sense in reviewer-filtered context. Showing it conditionally prevents information overload while surfacing the right data at the right time.

**Independent Test**: Can be fully tested by activating a reviewer filter and verifying the approval rate appears; deactivating the filter and verifying it disappears.

**Acceptance Scenarios**:

1. **Given** the reviewer filter is active for "Alice", **When** the dashboard renders, **Then** an approval rate metric is displayed (e.g., "Approval Rate: 78%") near the reviewer activity chart.
2. **Given** the reviewer filter is NOT active, **When** the dashboard renders, **Then** no approval rate metric is displayed.
3. **Given** the reviewer filter is active but the selected reviewer has null approval_rate data, **When** the dashboard renders, **Then** the approval rate metric displays a "No data" state rather than "0%".
4. **Given** a reviewer with 100% or 0% approval rate, **When** the dashboard renders, **Then** the rate displays correctly as "100%" or "0%" without visual anomalies.

---

### User Story 3 - Trusting Data Through Sample Size Transparency (Priority: P1)

As a user viewing summary metrics, I want to see how many PRs underlie each metric so I can gauge confidence in the numbers and avoid making decisions based on statistically insignificant sample sizes.

**Why this priority**: Without sample size, users may treat metrics from 3 PRs with the same confidence as metrics from 300 PRs. This is the simplest, highest-impact data transparency improvement.

**Independent Test**: Can be fully tested by rendering summary cards with known PR counts and verifying the sample size label appears with the correct value.

**Acceptance Scenarios**:

1. **Given** a dataset spanning 12 weeks with 127 total PRs, **When** the summary cards render, **Then** each card displays "Based on 127 PRs" as a subtitle.
2. **Given** a filtered view reducing the dataset to 8 PRs, **When** the summary cards render, **Then** the subtitle updates to "Based on 8 PRs" and the text appears visually de-emphasized (e.g., lighter color or italic) to signal low confidence.
3. **Given** a dataset with 1 PR, **When** the summary cards render, **Then** the subtitle reads "Based on 1 PR" (singular).
4. **Given** a dataset with 0 PRs, **When** the dashboard renders, **Then** the existing no-data handling takes over and the sample size label is not shown.

---

### User Story 4 - Understanding Sparkline Time Context (Priority: P2)

As a user glancing at sparklines on summary cards, I want to see what time period they represent so I know whether I'm looking at recent data or a longer historical trend.

**Why this priority**: Sparklines without time labels are ambiguous. This is a low-effort, high-clarity improvement that sets context for every metric card.

**Independent Test**: Can be fully tested by rendering summary cards and verifying each sparkline has a descriptive time label.

**Acceptance Scenarios**:

1. **Given** a dataset with 20 weeks of data, **When** the summary cards render, **Then** each sparkline displays a label reading "Last 8 weeks" (the standard lookback window).
2. **Given** a dataset with only 4 weeks of data, **When** the summary cards render, **Then** the sparkline label reads "Last 4 weeks" reflecting the actual available data.
3. **Given** a dataset with only 1 week of data, **When** the summary cards render, **Then** the sparkline label reads "Last 1 week" (singular form).

---

### User Story 5 - Scanning Distribution Speed at a Glance (Priority: P2)

As a user viewing the cycle time distribution chart, I want the bars color-coded by speed category (fast, moderate, slow) so I can instantly see whether my team's PRs skew toward quick turnaround or prolonged cycles.

**Why this priority**: Color semantics transform the distribution from a neutral histogram into an actionable diagnostic tool. Users can spot problems without reading individual labels.

**Independent Test**: Can be fully tested by rendering the distribution chart and verifying each bucket has the correct color class applied.

**Acceptance Scenarios**:

1. **Given** a distribution with PRs across all time buckets, **When** the chart renders, **Then** "0-1h" and "1-4h" buckets use a green color, "4-24h" and "1-3d" buckets use a yellow/amber color, and "3-7d" and "7d+" buckets use a red color.
2. **Given** a distribution viewed at narrow width (under 480px), **When** the chart renders, **Then** each distribution row stacks vertically (label, bar, value) instead of horizontal layout, and colors remain visible.
3. **Given** the dashboard is viewed by a colorblind user, **When** the chart renders, **Then** the color categories are distinguishable through sufficient contrast differences between the three groups (green, amber, red map to clearly distinct lightness values).

---

### User Story 6 - Reading Dimmed Legend Items (Priority: P3)

As a user viewing chart legends, I want insufficient-data legend items to be readable (not nearly invisible) so I can understand which data series are present but lack enough points.

**Why this priority**: Current 0.3 opacity makes these items nearly invisible. Raising to 0.55 is a minimal CSS change that significantly improves readability.

**Independent Test**: Can be fully tested by rendering a chart with insufficient data points and verifying the dimmed legend item is visually readable but clearly de-emphasized.

**Acceptance Scenarios**:

1. **Given** a cycle time chart where P90 has fewer than 2 data points, **When** the chart renders, **Then** the P90 legend item appears at reduced but readable opacity (approximately 0.55) with "(insufficient data)" label.
2. **Given** the same scenario, **When** compared to non-dimmed legend items, **Then** dimmed items are clearly distinguishable as secondary but remain legible.

---

### User Story 7 - Noticing Data Truncation (Priority: P3)

As a user viewing charts with more data than the display maximum, I want truncation indicators to be visually prominent so I understand I'm seeing a subset of available data, not the full picture.

**Why this priority**: Current truncation indicators are too subtle (plain gray text). Restyling them as alert badges ensures users don't miss this important data context.

**Independent Test**: Can be fully tested by loading a dataset exceeding the display maximum and verifying the truncation indicator renders with the new prominent styling.

**Acceptance Scenarios**:

1. **Given** a throughput chart with 120 weeks of data (exceeding the 104-week maximum), **When** the chart renders, **Then** a truncation indicator appears styled as a visible badge (background color, border, bold text) reading "Showing last 104 weeks."
2. **Given** the same chart viewed at narrow width (under 480px), **When** the chart renders, **Then** the truncation indicator displays as a full-width banner with an accent left border for maximum visibility.
3. **Given** a chart with fewer weeks than the display maximum, **When** the chart renders, **Then** no truncation indicator appears.

---

### User Story 8 - Maintainable Chart Codebase (Priority: P3)

As a developer maintaining the dashboard, I want shared rendering patterns extracted into reusable components so that adding new charts or modifying existing ones requires changes in fewer places and carries less regression risk.

**Why this priority**: This is an engineering quality improvement, not user-facing. It must happen last (after all feature work stabilizes) to avoid extraction-then-modification churn. The ~100-150 line reduction and cleaner module boundaries improve long-term velocity.

**Independent Test**: Can be fully tested by verifying all existing chart tests continue to pass after extraction, and that extracted components have their own unit tests confirming identical output.

**Acceptance Scenarios**:

1. **Given** the horizontal bar rendering pattern used in multiple charts, **When** refactored into a shared component, **Then** all charts using horizontal bars produce identical output to pre-extraction behavior (verified by parity tests).
2. **Given** the SVG path generation logic used in sparklines and trend lines, **When** extracted into a shared utility, **Then** all sparkline and trend line renderings produce identical SVG path output.
3. **Given** the label decimation logic used in throughput and cycle time charts, **When** extracted into a shared utility, **Then** label visibility at all data counts matches pre-extraction behavior.
4. **Given** all component extractions are complete, **When** the full test suite runs, **Then** all existing tests pass with no regressions and overall lines of code in chart modules is reduced by 80-150 lines.

---

### Edge Cases

- What happens when review_time_p50 exists but review_time_p90 is null for a given week? The system must render P50 independently and show "No data" for P90.
- What happens when approval_rate is exactly 0.0 vs null? 0.0 means "no approvals given" and must display as "0%"; null means "no data available" and must display as no-data state.
- What happens when the sparkline lookback window spans weeks with all-null values? The sparkline must still render with available points and the label must reflect the actual number of weeks with data.
- What happens when a user applies dimension filters that reduce the dataset to 0 PRs? The sample size label must not display; the existing renderNoData() behavior handles this.
- What happens when distribution buckets have 0 PRs in certain time ranges? Those buckets must still render with the correct color class but show a zero-width bar and "0 (0%)" value.
- What happens when all dashboard data paths render the same data? The output must be visually and structurally identical across all 3 data paths (extension hub, CLI local mode, /docs demo) after normalization (parity enforcement).
- What happens when ALL metrics are null simultaneously (review_time, cycle_time null; approval_rate null; pr_count = 0)? Every card and chart must invoke `renderNoData()` identically — no card may show "0" or blank where another shows the no-data state. Automated test required.
- What happens when a filter is applied then removed? All metrics must return to unfiltered values with no stale state from the prior filter. Automated test required.
- What happens at viewport widths below the mobile breakpoint? Distribution rows must stack, truncation indicators must become banners, and card grids must switch to single-column — consistently across all charts. Automated test required.

## Requirements *(mandatory)*

### Functional Requirements

**Theme A: Data Transparency**

- **FR-001**: Dashboard MUST display review time P50 (median time from review request to review completion) as a formatted duration metric with an info icon explaining its meaning.
- **FR-002**: Dashboard MUST display review time P90 as a formatted duration metric alongside P50, with its own info icon explanation.
- **FR-003**: Review time metrics MUST include sparkline trend visualization using the same lookback window as other summary sparklines.
- **FR-004**: Dashboard MUST display approval rate as a percentage when the reviewer filter is active, showing the proportion of reviews resulting in approval for the selected reviewer(s).
- **FR-005**: Approval rate MUST be hidden when no reviewer filter is active, to avoid presenting aggregate approval rates without reviewer context.
- **FR-006**: Each summary card MUST display a sample size subtitle indicating the total filtered PR count (the sum of `pr_count` across all rollups currently in scope after applying all active filters). This value MUST be computed once and shared across all cards — not computed independently per card.
- **FR-007**: Sample size display MUST update when filters change, reflecting the recomputed filtered PR count. All cards MUST show the same number; inconsistent counts across cards is a bug.
- **FR-008**: Sample size MUST use correct singular/plural form ("1 PR" vs "N PRs").
- **FR-009**: When the sample size is below the low-sample threshold (defined as a single named constant `LOW_SAMPLE_THRESHOLD = 10`, used everywhere), the subtitle MUST be visually de-emphasized to signal low statistical confidence.
- **FR-010**: Each sparkline MUST display a time period label (e.g., "Last 8 weeks") indicating the temporal scope of the trend data shown. The lookback window MUST be derived from a single new exported function (e.g., `getLookbackWindow(rollups)`) that returns the week count. This function does not exist today — the current hardcoded `slice(-8)` in `renderSparkline` must be replaced by a call to this function. ALL sparklines MUST call this same function — no inline computation or per-card derivation.
- **FR-011**: Sparkline time labels MUST reflect the actual number of weeks of data available (capped at the shared lookback constant), not a hardcoded string. All cards MUST use the same lookback value from the same source. An automated test MUST assert that all sparkline labels within a single render display the identical N value.

**Theme B: Visual Polish**

- **FR-012**: Cycle time distribution chart buckets MUST be color-coded by speed category. The bucket-to-color mapping MUST be defined as a deterministic, exhaustive lookup keyed by bucket label string. The exact mapping (with numeric hour thresholds for clarity):

  | Bucket label | Hours range          | Category   | Color variable |
  |------------- |----------------------|------------|----------------|
  | `"0-1h"`     | [0, 1)               | fast       | success        |
  | `"1-4h"`     | [1, 4)               | fast       | success        |
  | `"4-24h"`    | [4, 24)              | moderate   | warning        |
  | `"1-3d"`     | [24, 72)             | moderate   | warning        |
  | `"3-7d"`     | [72, 168)            | slow       | error          |
  | `"7d+"`      | [168, +infinity)     | slow       | error          |

  All boundaries are lower-inclusive, upper-exclusive. No gaps, no overlaps. An unknown bucket label MUST fall back to the default chart color (no crash, no uncolored bar). Each bucket's DOM element MUST include a CSS class encoding its category (`bucket-fast`, `bucket-moderate`, `bucket-slow`) for testability.
- **FR-013**: Distribution bucket colors MUST use the existing design system color variables (success, warning, error) for consistency with the rest of the dashboard.
- **FR-014**: Distribution chart layout MUST adapt to narrow widths by stacking label, bar, and value vertically. The mobile breakpoint value (480px) MUST be coordinated between CSS media queries and a named JS constant (`MOBILE_BREAKPOINT = 480`). Since CSS `@media` rules cannot reference JS variables, both locations will contain the literal value — but an automated test MUST assert the JS constant and the CSS media query breakpoint agree (grep CSS for the value, compare to the constant). No other magic `480` values may appear in the codebase outside these two authoritative locations.
- **FR-015**: Dimmed/insufficient-data legend items MUST render at exactly `opacity: 0.55` (raised from current 0.3). This is a precise value, not a minimum — no drift permitted.
- **FR-016**: Truncation indicators MUST be restyled as visually prominent badges with background color, border, and increased font weight. The restyled indicator MUST include a deterministic CSS class (`.truncation-badge`) to enable automated test assertions on styling and visibility.
- **FR-017**: Truncation indicators at narrow widths (under 480px) MUST display as full-width banners with a colored accent border for maximum visibility.

**Theme C: Component Extraction**

- **FR-018**: Shared horizontal bar rendering logic MUST be extracted from chart modules into a single reusable component, producing identical output to the pre-extraction implementation. Snapshot parity tests MUST be captured before extraction and verified after extraction to prove zero rendering delta.
- **FR-019**: SVG path generation logic for sparklines and trend lines MUST be extracted into a shared utility producing identical SVG output. Snapshot parity tests MUST be captured before extraction and verified after extraction.
- **FR-020**: Label decimation (thinning) logic MUST be extracted into a shared utility producing identical label visibility behavior. Snapshot parity tests MUST be captured before extraction and verified after extraction.
- **FR-021**: Chart tooltip lifecycle pattern (clear, render, attach) MUST be extracted into a shared contract, maintaining identical tooltip behavior. Snapshot parity tests MUST be captured before extraction and verified after extraction.

**Cross-Cutting**

- **FR-022**: All changes MUST render identically across all dashboard data paths (currently 3: extension hub, CLI local mode, /docs demo — all sharing chart functions via `normalizeRollup()` normalization). Parity MUST be verified by automated test — not assumed from shared code. The parity test MUST render the same dataset through each data path's normalization pipeline, then call the same chart functions, and compare DOM output after a normalization step (collapse whitespace, sort attribute order within each element) to avoid false failures from insignificant formatting differences. After normalization, outputs MUST be string-identical. A parity failure MUST block the build.
- **FR-023**: All existing tests (2,024+) MUST continue to pass with no regressions.
- **FR-024**: All new rendering functions MUST handle null container elements gracefully (return without error).
- **FR-025**: All HTML rendering MUST continue to use the existing safe rendering pipeline (renderTrustedHtml + escapeHtml) with no inline style injection.
- **FR-026**: All new metrics (review time, approval rate, sample size) MUST follow the existing `renderNoData()` contract exactly when data is unavailable. No custom no-data variants or fallback strings — the same function, same CSS class, same visual treatment.
- **FR-027**: No new standalone full-data passes MUST be introduced. New metric fields (review_time_p50/p90, review_time sparkline arrays) MUST be added by extending the existing `calculateMetrics()` and `extractSparklineData()` functions — not by creating new functions that independently iterate all rollups. The prohibition is against new O(n) functions, not against adding fields to existing O(n) functions. Enforcement: code review MUST verify no new top-level iteration functions over the full rollups array. A test MUST assert that the metrics module's exported function count does not increase beyond what is needed for the new lookback-window utility.
- **FR-028**: Applying any filter MUST update ALL dependent metrics consistently in a single render pass. No stale values may remain from a prior filter state. An automated test MUST apply a filter, then assert that sample size, sparkline labels, metric values, and approval rate (if applicable) all reflect the filtered dataset — not a mix of filtered and unfiltered values.
- **FR-029**: An automated test MUST verify `renderNoData()` structural parity: when ALL metrics in a dataset are null (review_time, cycle_time, approval_rate all null; pr_count = 0), every card and chart MUST invoke the same `renderNoData()` function and produce the same DOM element structure and CSS classes (`.no-data` paragraph + optional `.no-data-hint` paragraph). Text content within no-data elements MAY differ between charts (chart-appropriate messages are expected), but no card may show "0", a blank element, or a custom fallback where another shows the standard no-data structure.
- **FR-030**: An automated test MUST verify that at viewport widths below `MOBILE_BREAKPOINT`, the mobile layout switch (distribution row stacking, truncation banner, card grid single-column) applies consistently across ALL charts. The test MUST render every chart module at a narrow width and assert the expected layout classes or DOM structure are present.

### Key Entities

- **Weekly Rollup**: The core data unit. Contains per-week metrics including pr_count, cycle_time_p50/p90, review_time_p50/p90, authors_count, reviewers_count, and breakdowns by repository, author, team, and reviewer.
- **Reviewer Breakdown Entry**: Per-reviewer metrics within a weekly rollup including reviewed_prs, reviews_count, and approval_rate (0-1 scale representing percentage of reviews resulting in approval).
- **Summary Card**: A dashboard UI element displaying a single metric with its title, value, delta indicator (week-over-week change), sparkline trend, and info icon. Each card now also includes sample size subtitle and sparkline time label.
- **Distribution Bucket**: A grouping of PRs by cycle time range (0-1h, 1-4h, 4-24h, 1-3d, 3-7d, 7d+), each with a count, percentage, and now a speed-category color.
- **Truncation Indicator**: A UI element shown when chart data exceeds the display maximum, informing users they are seeing a subset of available data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When rollups contain non-null `review_time_p50` / `review_time_p90` values, the rendered DOM contains metric elements displaying formatted review time durations. Automated test asserts the elements exist and the displayed value matches the calculated metric.
- **SC-002**: When `reviewerFilterActive` is true, the rendered DOM contains an approval rate element displaying a percentage. When false, the element MUST NOT be present in the DOM. Automated test asserts presence/absence.
- **SC-003**: Every summary card's rendered DOM contains a sample-size subtitle element whose text matches the pattern "Based on N PR(s)" where N equals the total filtered `pr_count`. Automated test asserts all cards show the same N value.
- **SC-004**: Every sparkline container in the rendered DOM includes a time-period label element whose text matches the pattern "Last N week(s)". Automated test asserts the label exists for each sparkline and N is consistent across cards.
- **SC-005**: Each distribution bucket's rendered DOM element includes a color-category CSS class (`bucket-fast`, `bucket-moderate`, or `bucket-slow`). Automated test asserts the correct class for each known bucket label.
- **SC-006**: Dimmed legend elements in the rendered DOM include the `.dimmed` CSS class. Automated test asserts the class is present on insufficient-data legend items. The CSS rule for `.dimmed` is separately verified to declare `opacity: 0.55` (assert against the stylesheet rule or inline style attribute, NOT computed style from runtime).
- **SC-007**: Truncation indicator elements in the rendered DOM include the `.truncation-badge` CSS class AND correct text content matching the pattern "Showing last N weeks" (where N is the display maximum). Automated test asserts BOTH the class presence AND the text content when data exceeds the display maximum. When data does not exceed the maximum, the test asserts the element is absent.
- **SC-008**: A parity test renders the same dataset through all dashboard data paths (currently 3: extension hub, CLI local mode, /docs demo) and compares normalized DOM output. After whitespace collapse and attribute-order normalization, outputs MUST be string-identical. This test runs in CI and blocks merge on failure.
- **SC-009**: Component extraction reduces total lines of code in chart modules by at least 80 lines (measured from the post-Phase-2 baseline, after new features are added but before extraction). Pre- and post-extraction snapshot tests MUST produce identical rendering output. An automated script or test MUST compute the LOC delta between pre-extraction and post-extraction chart modules and assert a net reduction of at least 80 lines. No upper bound — greater savings are welcome. This check runs as part of the extraction PR validation, not as a manual diff.
- **SC-010**: All existing automated tests (2,024+) continue to pass after all changes. New tests cover every new rendering path. Total test count increases by at least 100.

## Assumptions

- Users are engineering managers and tech leads who understand PR workflow metrics (cycle time, review time, throughput) without needing extensive onboarding.
- All required data fields (review_time_p50/p90, approval_rate, pr_count) already exist in the weekly rollup schema and aggregate data pipeline. No backend or data generation changes are needed.
- The dashboard runs as an Azure DevOps managed hub extension with no Content Security Policy restrictions affecting inline SVG or CSS class-based styling.
- The 3 dashboard data paths (extension hub, CLI local mode, /docs demo) share the same chart rendering functions via `normalizeRollup()` normalization. Changes to chart modules propagate to all paths automatically (no duplicate implementations to update).
- Accessibility improvements beyond the specific opacity and contrast changes listed here (e.g., screen reader support, keyboard navigation) are deferred to a future issue.
- The existing renderTrustedHtml + escapeHtml safety pipeline is sufficient for all new rendering — no additional XSS mitigation patterns are needed.
- Component extraction (User Story 8) will be implemented last, after all feature and styling work stabilizes, to avoid extraction-then-modification churn.
- The color palette for distribution buckets (green/yellow/red mapped to existing CSS variables --success/--warning/--error) provides sufficient contrast differentiation for colorblind users given the distinct lightness values of these variables. Full WCAG AAA compliance is deferred.
