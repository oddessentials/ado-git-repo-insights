# Data Model: 044 Dashboard Transparency Polish

**Date**: 2026-03-29
**Spec**: [spec.md](spec.md)

## Entities

### Extended: CalculatedMetrics

Current fields (unchanged):
- `totalPrs: number` — Sum of pr_count across all filtered rollups
- `cycleP50: number | null` — Median of non-null cycle_time_p50 values
- `cycleP90: number | null` — Median of non-null cycle_time_p90 values
- `avgAuthors: number` — Average authors_count per week
- `avgReviewers: number` — Average reviewers_count per week

New fields:
- `reviewTimeP50: number | null` — Median of non-null review_time_p50 values across filtered rollups
- `reviewTimeP90: number | null` — Median of non-null review_time_p90 values across filtered rollups

**Derivation**: Extracted in the existing `calculateMetrics()` pass using the same median-of-weekly-values pattern as cycleP50/P90.

### Extended: SparklineData

Current fields (unchanged):
- `prCounts: number[]` — Weekly PR counts
- `p50s: (number | null)[]` — Weekly cycle_time_p50 values
- `p90s: (number | null)[]` — Weekly cycle_time_p90 values
- `authors: number[]` — Weekly authors_count values
- `reviewers: number[]` — Weekly reviewers_count values

New fields:
- `reviewTimeP50s: (number | null)[]` — Weekly review_time_p50 values
- `reviewTimeP90s: (number | null)[]` — Weekly review_time_p90 values

**Derivation**: Extracted in the existing `extractSparklineData()` pass by adding two more `rollups.map()` calls in the same return object.

### New: BucketColorCategory

Enum-like constant:
- `"fast"` — Green (--success). Bucket labels: "0-1h", "1-4h"
- `"moderate"` — Yellow (--warning). Bucket labels: "4-24h", "1-3d"
- `"slow"` — Red (--error). Bucket labels: "3-7d", "7d+"

Defined as `BUCKET_COLOR_MAP: Map<string, "fast" | "moderate" | "slow">`.

### Existing (no changes): WeeklyRollup

All fields including `review_time_p50`, `review_time_p90` already present in schema. No schema changes needed.

### Existing (no changes): ReviewerBreakdownEntry

`approval_rate` (0-1 scale) already present. Already aggregated by `aggregateReviewerEntries()`.

## New Constants

| Constant | Value | Module | Purpose |
|----------|-------|--------|---------|
| `SPARKLINE_LOOKBACK_WEEKS` | 8 | charts.ts | Replaces hardcoded `slice(-8)` |
| `LOW_SAMPLE_THRESHOLD` | 10 | summary-cards.ts | FR-009 low-confidence visual threshold |
| `MOBILE_BREAKPOINT` | 480 | shared/constants.ts | Coordinated with CSS `@media (max-width: 480px)` |
| `BUCKET_COLOR_MAP` | Map (6 entries) | cycle-time.ts | FR-012 bucket-to-color lookup |

## New Functions

| Function | Module | Signature | Purpose |
|----------|--------|-----------|---------|
| `getLookbackWeekCount` | charts.ts | `(rollups: Rollup[]) => number` | Returns `Math.min(rollups.length, SPARKLINE_LOOKBACK_WEEKS)` |

## State Flow

```
Rollups (filtered)
  → calculateMetrics() → CalculatedMetrics (now includes reviewTimeP50/P90)
  → extractSparklineData() → SparklineData (now includes reviewTimeP50s/P90s)
  → renderSummaryCards()
      → Uses totalPrs as sample size
      → Uses getLookbackWeekCount() for sparkline labels
      → Uses renderNoData() for null metrics

Rollups (filtered) + reviewerFilterActive + by_reviewer breakdown
  → renderReviewerActivity()
      → If reviewerFilterActive: compute approval_rate from raw by_reviewer data
      → Display "Approval Rate: N%"

Distribution data (unfiltered)
  → renderCycleDistribution()
      → BUCKET_COLOR_MAP lookup per bucket label
      → Add bucket-fast/moderate/slow CSS classes
```
