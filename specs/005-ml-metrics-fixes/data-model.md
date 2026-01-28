# Data Model: ML Metrics Accuracy Fixes

**Feature**: 005-ml-metrics-fixes
**Date**: 2026-01-27

## Overview

This feature modifies calculation logic and display behavior without changing the underlying data schema. No new entities or schema migrations are required.

## Affected Entities

### 1. PR Statistics (Read-Only Calculation)

**Source Table**: `pull_requests`

**Relevant Columns**:
| Column | Type | Usage |
|--------|------|-------|
| `cycle_time_minutes` | REAL | Used for P90 percentile calculation |
| `closed_date` | TEXT | Used for weekly aggregation |
| `status` | TEXT | Filter: only 'completed' PRs |

**P90 Calculation Query** (NEW):
```sql
SELECT cycle_time_minutes AS p90_cycle_time
FROM (
    SELECT cycle_time_minutes,
           ROW_NUMBER() OVER (ORDER BY cycle_time_minutes) as rn,
           COUNT(*) OVER () as total
    FROM pull_requests
    WHERE cycle_time_minutes IS NOT NULL
      AND status = 'completed'
)
WHERE rn = CAST(total * 0.9 AS INTEGER) + 1
```

**Previous Calculation** (REMOVED):
```python
# WRONG: This is 90% of max, not 90th percentile
p90_cycle_time = round(row["max_cycle"] * 0.9, 1)
```

---

### 2. Forecast Metrics Configuration

**Current METRICS List** (forecaster.py, fallback_forecaster.py):
```python
METRICS = [
    ("pr_throughput", "count"),
    ("cycle_time_minutes", "minutes"),
    ("review_time_minutes", "minutes"),  # REMOVE - uses cycle time as proxy
]
```

**Updated METRICS List**:
```python
METRICS = [
    ("pr_throughput", "count"),
    ("cycle_time_minutes", "minutes"),
    # review_time_minutes removed - requires dedicated data collection
]
```

**Impact**: Forecasts will contain 2 metrics instead of 3. Dashboard must handle missing metric gracefully.

---

### 3. Synthetic Data Structure

**No Schema Change** - Only generation algorithm changes

**Current Generation** (synthetic.ts):
```typescript
const noise = (Math.random() - 0.5) * variability;
```

**Updated Generation**:
```typescript
// Seeded PRNG for deterministic preview data
const random = createSeededRandom(SYNTHETIC_SEED);
const noise = (random() - 0.5) * variability;
```

**Synthetic Data Markers** (unchanged):
```typescript
{
  is_stub: true,
  generated_by: "synthetic-preview",
  // ... rest of data
}
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        SQLite Database                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ pull_requests                                            │   │
│  │  - cycle_time_minutes (REAL)                            │   │
│  │  - closed_date (TEXT)                                   │   │
│  │  - status (TEXT)                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    insights.py::_get_pr_stats()                 │
│                                                                 │
│  P90 Calculation:                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ OLD: max_cycle * 0.9 (WRONG)                            │   │
│  │ NEW: SQL window function percentile (CORRECT)           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Output: { p90_cycle_time_minutes: <accurate value> }          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    forecaster.py / fallback_forecaster.py       │
│                                                                 │
│  METRICS (reduced):                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ - pr_throughput (count)                                 │   │
│  │ - cycle_time_minutes (minutes)                          │   │
│  │ - review_time_minutes (REMOVED)                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Output: predictions/trends.json (2 metrics, not 3)            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Dashboard (TypeScript)                       │
│                                                                 │
│  Synthetic Data:                                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ OLD: Math.random() (non-deterministic)                  │   │
│  │ NEW: mulberry32(SEED) (deterministic)                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Review Time Display:                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ If metric missing: Show "Review time data unavailable"  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Validation Rules

### P90 Calculation
- Input: Array of cycle_time_minutes values (non-NULL, completed PRs)
- Output: Single numeric value representing 90th percentile
- Edge case (n < 10): Return highest available percentile with warning
- Edge case (n = 0): Return NULL/undefined

### Synthetic Data Seed
- Seed value: Fixed constant `0x5EEDF00D`
- Must produce identical output across page reloads
- Must produce identical output across different browsers

### Review Time Availability
- Check: `forecasts.find(f => f.metric === 'review_time_minutes')`
- If missing: Display informational message, not error
- Dashboard must not crash on missing metrics

## Backward Compatibility

| Change | Compatibility Impact |
|--------|---------------------|
| P90 calculation | ✅ None - same field name, more accurate value |
| Remove review_time metric | ✅ Additive removal - consumers ignore missing |
| Synthetic seed | ✅ None - dev mode only, no production impact |
| pytest warnings | ✅ None - test infrastructure only |

**Schema Version**: No change required (no new fields or tables)
