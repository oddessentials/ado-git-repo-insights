# Contract: Empty State Classifier

**Feature**: 041-metrics-dashboard-ux
**Date**: 2026-03-27

## Overview

A centralized classifier that determines why a chart has no data to display, replacing per-chart ad-hoc empty state logic with a strict evaluation hierarchy.

## Classifier Interface

### classifyEmptyState(context: EmptyStateContext): EmptyStateClassification

**EmptyStateContext**:
| Field | Type | Description |
|-------|------|-------------|
| chartType | "throughput" \| "cycle_time_trend" \| "cycle_time_distribution" \| "reviewer_activity" | Which chart is being evaluated |
| filters | FilterState | Current resolved filter state (post-constraint resolution) |
| unfilteredRollups | Rollup[] | Rollups before filter application |
| filteredRollups | Rollup[] | Rollups after filter application |
| availability | DataAvailabilitySignal | Upstream data availability flags |
| minimumDataPoints | number | Chart-specific minimum (e.g., 2 for trends, 0 for throughput) |

**EmptyStateClassification**:
| Field | Type | Description |
|-------|------|-------------|
| reason | "not_extracted" \| "filter_caused" \| "minimum_data" \| "date_range_empty" | Classification |
| message | string | Primary message for display |
| hint | string | Actionable suggestion |

## Evaluation Hierarchy (Strict Short-Circuit)

Each condition is an explicit boolean check. The **first** matching condition terminates evaluation. Later conditions are NOT evaluated even if they would also be true.

### Step 1: Data Not Extracted (`not_extracted`)

**Condition**: The data required by this chart was never captured by the extraction pipeline.

| Chart Type | Check |
|-----------|-------|
| reviewer_activity | `availability.reviewerDataPresent === false` |
| cycle_time_trend | `availability.cycleTimePresent === false` |
| cycle_time_distribution | `availability.cycleTimePresent === false` |
| throughput | Always passes (pr_count is always available) |

**Message**: "This data is not yet available."
**Hint**: Per chart type:
- reviewer_activity: "Ensure the data pipeline is configured to capture reviewer information."
- cycle_time_*: "Cycle time data requires PR completion timestamps in the extraction pipeline."

**If matched**: STOP. Return classification. Do not evaluate steps 2-4.

### Step 2: Filters Caused Empty (`filter_caused`)

**Condition**: All of:
- At least one filter dimension is non-empty (`filters.repos.length > 0 || filters.teams.length > 0 || filters.reviewers.length > 0 || filters.authors.length > 0`)
- Unfiltered rollups exist (`unfilteredRollups.length > 0`)
- Filtered rollups are empty OR filtered data value is zero for this chart

**Message**: "No data matches your current filters."
**Hint**: "Try removing some filters or widening the date range."

**If matched**: STOP.

### Step 3: Minimum Data Requirement (`minimum_data`)

**Condition**: All of:
- `filteredRollups.length < minimumDataPoints`
- `filteredRollups.length > 0` (some data exists, just not enough)

**Message**: Chart-specific:
- cycle_time_trend: "Not enough data for trend analysis."
- Others: "Insufficient data for this view."

**Hint**: Chart-specific:
- cycle_time_trend: "At least 2 weeks of data are needed to show trends."
- Others: "Try widening the date range."

**If matched**: STOP.

### Step 4: Date Range Empty (`date_range_empty`)

**Condition**: `unfilteredRollups.length === 0` (no data at all, regardless of filters)

**Message**: "No data in this period."
**Hint**: "Try widening the date range or selecting a different period."

**If matched**: STOP.

### Step 5: No Empty State

If no condition matched, the chart has data and should render normally. The classifier returns `null` (or is not called — the chart module checks rollup length first).

## Data Availability Signal Contract

### Type Guard at Loading Boundary

When normalizing rollups from raw JSON (`normalizeRollup()`), the following rules apply:

| Raw Field State | Normalized Value | Meaning |
|----------------|-----------------|---------|
| Field is `null` | `null` | Not extracted |
| Field is `undefined` | `null` (with warning log) | Not extracted (upstream omission) |
| Field is missing entirely | `null` (via ROLLUP_FIELD_DEFAULTS) | Not extracted |
| Field is `{}` (empty object) | `{}` | Extracted but no data |
| Field is populated object | As-is | Data available |

The type guard MUST run before any downstream consumer accesses the field. If an unexpected type is encountered (e.g., string, number, array), it MUST be normalized to `null` with a warning log.

### Manifest Capability Flags

| Flag | Source | Usage |
|------|--------|-------|
| `reviewer_repository_mode` | `manifest.capabilities` | Determines if reviewer+repo filtering is available |
| `reviewer_team_mode` | `manifest.capabilities` | Determines if reviewer+team filtering is available |
| `comments.status` | `manifest.comments` | Determines if comment metrics are available |

## Message Constants

All messages and hints MUST be defined as constants (not inline strings) for consistency and testability.

```
EMPTY_STATE_MESSAGES = {
  NOT_EXTRACTED: "This data is not yet available.",
  FILTER_CAUSED: "No data matches your current filters.",
  MINIMUM_DATA: "Not enough data for trend analysis.",
  DATE_RANGE_EMPTY: "No data in this period.",
}

EMPTY_STATE_HINTS = {
  NOT_EXTRACTED_REVIEWER: "Ensure the data pipeline is configured to capture reviewer information.",
  NOT_EXTRACTED_CYCLE_TIME: "Cycle time data requires PR completion timestamps in the extraction pipeline.",
  FILTER_CAUSED: "Try removing some filters or widening the date range.",
  MINIMUM_TREND: "At least 2 weeks of data are needed to show trends.",
  DATE_RANGE: "Try widening the date range or selecting a different period.",
}
```

## Parity Requirement

Given identical inputs (chartType, filters, rollups, availability, minimumDataPoints), the classifier MUST produce identical output. This is verified by parity tests using the same input fixtures across both dashboard entry points.
