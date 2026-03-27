# Data Model: Metrics Dashboard UX Improvements

**Feature**: 041-metrics-dashboard-ux
**Date**: 2026-03-27

## Entities

### FilterDimension

Represents a filterable attribute of the dataset.

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier (e.g., "repos", "teams", "reviewers", "author") |
| label | string | Display label (e.g., "Repository", "Team") |
| mode | "single" \| "multi" | Selection mode |
| options | FilterOption[] | Available options from dataset dimensions |
| selected | string[] | Currently selected option IDs (empty = no filter) |
| visible | boolean | Whether this filter is shown (hidden when no options available) |

### FilterOption

A single selectable value within a filter dimension.

| Field | Type | Description |
|-------|------|-------------|
| id | string | Internal key used for filtering (e.g., repository_name, reviewer_id) |
| displayName | string | User-visible text |

### FilterState

The resolved state of all filters after normalization and constraint resolution.

| Field | Type | Description |
|-------|------|-------------|
| repos | string[] | Selected repository names (empty = all) |
| teams | string[] | Selected team names (empty = all) |
| reviewers | string[] | Selected reviewer IDs (max 1 element, Phase 1) |
| authors | string[] | Selected author IDs (max 1 element, Phase 1) |

**Invariants**:
- `reviewers.length <= 1` (single-select enforced)
- `authors.length <= 1` (single-select enforced)
- If all available options for a dimension are selected, the array MUST be empty (normalized to "no filter")
- State has been processed through the constraint resolver before use

### FilterConstraintResult

Output of the single-authority constraint resolver.

| Field | Type | Description |
|-------|------|-------------|
| effectiveState | FilterState | The resolved filter state after applying constraints |
| constraintsApplied | ConstraintNotice[] | Descriptions of any constraints that were applied |

### ConstraintNotice

A user-facing notice about a filter constraint that was applied.

| Field | Type | Description |
|-------|------|-------------|
| type | "author_team" \| "reviewer_repo" \| "reviewer_team" | Constraint category |
| message | string | User-facing explanation (e.g., "Author + team uses author-only metrics") |

### DataAvailabilitySignal

Explicit indicator of whether a data dimension was extracted.

| Field | Type | Description |
|-------|------|-------------|
| reviewerDataPresent | boolean | `by_reviewer` is non-null (extracted, possibly empty) |
| reviewerDataEmpty | boolean | `by_reviewer` is `{}` (extracted but no entries) |
| cycleTimePresent | boolean | `cycle_time_p50` is non-null in at least one rollup |
| reviewerRepoMode | "exact" \| "constrained" \| "disallowed" | From manifest capabilities |
| commentsStatus | "disabled" \| "full" \| "partial" | From manifest capabilities |

**Derivation rules**:
- `reviewerDataPresent = by_reviewer !== null` (after type guard normalization)
- `reviewerDataEmpty = by_reviewer !== null && Object.keys(by_reviewer).length === 0`
- `cycleTimePresent = rollups.some(r => r.cycle_time_p50 !== null)`
- `reviewerRepoMode` and `commentsStatus` from `DatasetCapabilityState`

### EmptyStateClassification

The result of evaluating why a chart has no data to display.

| Field | Type | Description |
|-------|------|-------------|
| reason | "not_extracted" \| "filter_caused" \| "minimum_data" \| "date_range_empty" | Classification |
| message | string | Primary user-facing message |
| hint | string | Actionable suggestion |

**Evaluation hierarchy** (strict short-circuit):
1. `not_extracted`: Data availability signal indicates dimension was never captured
2. `filter_caused`: Filters are non-empty AND unfiltered rollups exist but filtered rollups are empty
3. `minimum_data`: Filtered data exists but count is below chart's minimum threshold
4. `date_range_empty`: No rollups at all, regardless of filter state

### MetricExplanation

Static description of a summary card metric.

| Field | Type | Description |
|-------|------|-------------|
| metricId | string | Identifier (e.g., "total_prs", "cycle_time_p50") |
| title | string | Card title (e.g., "Cycle Time (P50)") |
| explanation | string | Plain-English description for info icon tooltip |

**Canonical explanations**:
- `total_prs`: "Total merged pull requests in the selected period and filters."
- `cycle_time_p50`: "Median time from PR creation to merge. Half of all PRs completed faster than this."
- `cycle_time_p90`: "90th percentile cycle time. 90% of PRs completed faster. High values may indicate bottlenecks."
- `contributors`: "Average number of unique PR authors per week in this period."
- `reviewers`: "Average number of unique reviewers per week in this period."

## State Transitions

### Filter State Flow

```
UI Input (click/type/URL)
    │
    ▼
Raw Selection (from DOM or URL params)
    │
    ▼
All-Selected Normalization (FR-011)
  - Compare selected set against available options
  - If equal, emit empty array
    │
    ▼
Constraint Resolution (FR-010)
  - Single resolver function
  - Apply Author+Team, Reviewer+Repo/Team rules
  - Emit ConstraintNotice[] for UI display
    │
    ▼
Canonical FilterState
    │
    ├──▶ URL Serialization (sorted, encoded)
    ├──▶ Data Query (applyFiltersToRollups)
    ├──▶ UI State Update (chips, dropdowns)
    └──▶ Empty State Classification (input to classifier)
```

### Tooltip Lifecycle

```
User Interaction (hover/tap)
    │
    ▼
Dismiss All Tooltips (chart + info)
  - Remove any .chart-tooltip from DOM
  - Remove any .info-tooltip from DOM
    │
    ▼
Create Tooltip Element
  - Set class (.chart-tooltip or .info-tooltip)
  - Populate content via contentFn or static text
    │
    ▼
Position Tooltip
  - getBoundingClientRect() for target element
  - Check viewport boundaries (window.innerWidth/Height)
  - Flip/shift if would overflow
  - Apply position: fixed with computed coords
    │
    ▼
Append to document.body
  - Exactly one tooltip in DOM (invariant)
```

### Empty State Evaluation

```
Chart Render Called
    │
    ▼
Check: Data extracted? (DataAvailabilitySignal)
  - by_reviewer === null? → "not_extracted" (STOP)
  - cycle_time_p50 all null? → "not_extracted" (STOP)
    │ (extracted)
    ▼
Check: Filters active AND unfiltered data exists AND filtered data empty?
  - Compare rollups before/after filter → "filter_caused" (STOP)
    │ (data exists after filter)
    ▼
Check: Filtered data below minimum threshold?
  - rollups.length < 2 for trends → "minimum_data" (STOP)
    │ (enough data)
    ▼
Check: No rollups at all?
  - rollups.length === 0 → "date_range_empty" (STOP)
    │ (data exists)
    ▼
Render Chart (normal path)
```

## Relationships

```
FilterDimension 1──* FilterOption     (dimension has many options)
FilterState     1──1 FilterConstraintResult  (state produces one resolved result)
FilterState     1──* EmptyStateClassification (state influences empty classification per chart)
Rollup          1──1 DataAvailabilitySignal   (rollup data produces availability signal)
SummaryCard     1──1 MetricExplanation        (each card has one explanation)
```
