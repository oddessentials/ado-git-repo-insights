# Quickstart: ML Metrics Accuracy Fixes

**Feature**: 005-ml-metrics-fixes
**Date**: 2026-01-27

## Overview

This guide covers implementing the four ML metrics accuracy fixes identified in code review.

## Prerequisites

- Python 3.10+
- Node.js 18+ (for TypeScript compilation)
- pytest installed (`pip install -e .[dev]`)

## Implementation Order

1. **P90 Calculation** (US1 - P1) - Backend Python
2. **Review Time Removal** (US2 - P2) - Backend Python + Frontend TS
3. **Synthetic Determinism** (US3 - P3) - Frontend TypeScript
4. **Test Warnings** (US4 - P3) - Test configuration

---

## 1. P90 Calculation Fix

**File**: `src/ado_git_repo_insights/ml/insights.py`

**Current Code** (lines 280-293):
```python
cursor = self.db.execute(
    """
    SELECT
        AVG(cycle_time_minutes) as avg_cycle,
        MAX(cycle_time_minutes) as max_cycle
    FROM pull_requests
    WHERE cycle_time_minutes IS NOT NULL
    """
)
row = cursor.fetchone()
avg_cycle_time = round(row["avg_cycle"], 1) if row["avg_cycle"] else 0
p90_cycle_time = round(row["max_cycle"] * 0.9, 1) if row["max_cycle"] else 0
```

**Fixed Code**:
```python
# Average cycle time
cursor = self.db.execute(
    """
    SELECT AVG(cycle_time_minutes) as avg_cycle
    FROM pull_requests
    WHERE cycle_time_minutes IS NOT NULL AND status = 'completed'
    """
)
row = cursor.fetchone()
avg_cycle_time = round(row["avg_cycle"], 1) if row["avg_cycle"] else 0

# P90 cycle time (true 90th percentile)
cursor = self.db.execute(
    """
    SELECT cycle_time_minutes
    FROM (
        SELECT cycle_time_minutes,
               ROW_NUMBER() OVER (ORDER BY cycle_time_minutes) as rn,
               COUNT(*) OVER () as total
        FROM pull_requests
        WHERE cycle_time_minutes IS NOT NULL AND status = 'completed'
    )
    WHERE rn = CAST(total * 0.9 AS INTEGER) + 1
    """
)
row = cursor.fetchone()
p90_cycle_time = round(row["cycle_time_minutes"], 1) if row else 0
```

**Test**: `tests/unit/test_insights_enhanced.py`

---

## 2. Review Time Removal

### Backend Changes

**Files**:
- `src/ado_git_repo_insights/ml/forecaster.py` (lines 26-30)
- `src/ado_git_repo_insights/ml/fallback_forecaster.py` (lines 49-53)

**Change**: Remove review_time_minutes from METRICS list

```python
# Before
METRICS = [
    ("pr_throughput", "count"),
    ("cycle_time_minutes", "minutes"),
    ("review_time_minutes", "minutes"),
]

# After
METRICS = [
    ("pr_throughput", "count"),
    ("cycle_time_minutes", "minutes"),
]
```

### Frontend Changes

**File**: `extension/ui/modules/charts/predictions.ts`

Add handling for missing review time metric in dashboard:

```typescript
// In renderPredictionsWithCharts or similar
if (predictions.forecasts.length < 3) {
  // Show informational message about review time
  appendTrustedHtml(content, `
    <div class="metric-unavailable">
      <span class="info-icon">ℹ️</span>
      <span>Review time forecasts require dedicated review duration data collection.</span>
    </div>
  `);
}
```

---

## 3. Synthetic Data Determinism

**File**: `extension/ui/modules/ml/synthetic.ts`

**Add seeded PRNG**:
```typescript
// Fixed seed for deterministic preview data
const SYNTHETIC_SEED = 0x5EEDF00D;

// mulberry32 PRNG
function mulberry32(seed: number): () => number {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Create seeded random instance
function createSeededRandom(): () => number {
  return mulberry32(SYNTHETIC_SEED);
}
```

**Update generateForecastValues**:
```typescript
function generateForecastValues(
  baseValue: number,
  trend: "up" | "down" | "stable",
  variability: number,
  random: () => number,  // Add parameter
): ForecastValue[] {
  // ...
  const noise = (random() - 0.5) * variability;  // Use seeded random
  // ...
}
```

**Update generateSyntheticPredictions**:
```typescript
export function generateSyntheticPredictions(): PredictionsRenderData {
  const random = createSeededRandom();  // Create once per call

  const forecasts: Forecast[] = [
    {
      metric: "pr_throughput",
      unit: "PRs/week",
      values: generateForecastValues(25, "up", 5, random),
    },
    // ...
  ];
  // ...
}
```

---

## 4. Test Warning Suppression

**File**: `pyproject.toml` or `pytest.ini`

**Add filterwarnings**:
```ini
[tool.pytest.ini_options]
filterwarnings = [
    "ignore::ResourceWarning",
]
```

Or more targeted:
```ini
filterwarnings = [
    "ignore:unclosed database:ResourceWarning",
]
```

---

## Verification Commands

```bash
# Run all tests
cd src && pytest

# Run specific test files
pytest tests/unit/test_insights_enhanced.py -v
pytest tests/unit/test_fallback_forecaster.py -v

# Build and test TypeScript
cd extension && npm run build:ui && npm test

# Check for ResourceWarnings (should be suppressed)
pytest tests/ -W error::ResourceWarning 2>&1 | grep -c ResourceWarning
# Expected: 0
```

## Success Criteria Verification

| Criteria | Command | Expected |
|----------|---------|----------|
| SC-001 P90 accuracy | `pytest tests/unit/test_insights_enhanced.py::test_p90_calculation` | PASS |
| SC-002 No warnings | `pytest tests/ 2>&1 \| grep ResourceWarning` | No output |
| SC-003 Deterministic | Load dashboard twice in dev mode | Identical values |
| SC-004 Review time msg | View forecasts in dashboard | Info message shown |
| SC-005 No regression | `pytest tests/` | All pass |
| SC-006 Schema compat | `pytest tests/unit/test_predictions_schema.py` | PASS |
