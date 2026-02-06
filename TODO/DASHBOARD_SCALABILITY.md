# Dashboard Scalability & Data Overflow

> Last reviewed: 2026-02-05
> **Status: COMPLETED** (branch `024-dashboard-scalability`)

## Problem Statement

The dashboard uses **truncation** (e.g., `.slice(-8)`) to limit data points on some charts, but **Throughput** and **Cycle Time Trend** charts previously rendered ALL data points with no cap. A user selecting a 3-year date range would render 156+ SVG elements, potentially causing performance degradation.

**Goal:** Ensure all dashboard panels render smoothly with 3+ years of data, 200+ reviewers, and full comment extraction enabled.

---

## Synthetic Data Generator Enhancement

**Status: COMPLETED** (commits 181e31f, 6bfa240)

The generator now supports enterprise-scale data generation:

| Requirement | Implementation | Commit |
|-------------|---------------|--------|
| 3 years (156 weeks) | `--weeks` CLI argument, cap removed | 181e31f |
| 200+ reviewers | `--users` CLI argument, cap removed | 181e31f |
| Comment data | `--include-comments` flag, thread/comment generation | 6bfa240 |

### Scalability Test Profile

```bash
python scripts/generate-synthetic-dataset.py \
  --pr-count 10000 \
  --weeks 156 \
  --users 200 \
  --include-comments \
  --seed 42 \
  --output test-data/scalability
```

---

## Current Data Point Limits

| Component | Limit | Code | Status |
|-----------|-------|------|--------|
| Reviewer Activity | 8 weeks | `MAX_REVIEWER_WEEKS = 8` | `extension/ui/modules/charts/reviewer-activity.ts` |
| Summary Sparklines | 8 values | `values.slice(-8)` | `extension/ui/modules/charts.ts:73-74` |
| Forecast Charts | 200 points | `MAX_CHART_POINTS = 200` | `extension/ui/modules/charts/predictions.ts:44` |
| ML Sparklines | 200 points | `MAX_SPARKLINE_POINTS = 200` | `extension/ui/modules/ml.ts:70` |
| Throughput Chart | 104 weeks | `MAX_THROUGHPUT_POINTS = 104` | `extension/ui/modules/charts/throughput.ts` |
| Cycle Time Trend | 104 weeks | `MAX_CYCLE_TIME_POINTS = 104` | `extension/ui/modules/charts/cycle-time.ts` |

---

## Verification Results

### Performance (Jest, jsdom)

| Chart | 156 weeks | Assertion | Result |
|-------|-----------|-----------|--------|
| Throughput | < 1000ms | T027 | PASS |
| Cycle Time | < 1000ms | T028 | PASS |
| Reviewer (50 users) | < 1000ms | T044 | PASS |
| Reviewer (200 users) | < 1000ms | T044 | PASS |

### DOM Element Caps

| Chart | Cap | Assertion | Result |
|-------|-----|-----------|--------|
| Throughput bars | 104 | T029 | PASS |
| Cycle Time dots (P50) | 104 | T030 | PASS |
| Cycle Time dots (P90) | 104 | T030 | PASS |
| Reviewer rows | 8 | T045 | PASS |

### Truncation Indicators

| Scenario | Indicator shown | Assertion | Result |
|----------|----------------|-----------|--------|
| 156 weeks throughput | Yes, "Showing last 104 weeks" | T031 | PASS |
| 156 weeks cycle time | Yes, "Showing last 104 weeks" | T032 | PASS |
| 104 weeks (at cap, throughput) | No indicator | T033a | PASS |
| 104 weeks (at cap, cycle-time) | No indicator | T033b | PASS |
| 52 weeks (under cap) | No indicator | (inline) | PASS |

### Comments Feature Compatibility

| Scenario | Assertion | Result |
|----------|-----------|--------|
| All charts render with comments | T048 | PASS |
| isFeatureEnabled reads flag | T049 | PASS |
| Missing features returns false | T050 | PASS |
| Charts identical regardless of flag | T051 | PASS |

---

## Implementation Summary

### Phase 0: Generator Enhancement - COMPLETED

| Task | Status | Commit |
|------|--------|--------|
| Add `--users` CLI argument | Done | 181e31f |
| Remove 52-week cap, add `--weeks` argument | Done | 181e31f |
| Implement comment data generation | Done | 6bfa240 |
| Add `--include-comments` flag | Done | 6bfa240 |
| Add generator tests | Done | 9f18cc0 |

### Phase 1: Chart Data Caps - COMPLETED

| Task | Status | Commit |
|------|--------|--------|
| `MAX_THROUGHPUT_POINTS = 104` in throughput.ts | Done | 0c1a396 |
| `MAX_CYCLE_TIME_POINTS = 104` in cycle-time.ts | Done | 5fcb031 |
| `MAX_REVIEWER_WEEKS = 8` in reviewer-activity.ts | Done | 2667228 |
| Truncation indicators in throughput + cycle-time | Done | 0c1a396, 5fcb031 |
| `.truncation-indicator` CSS | Done | 3f16efc |

### Phase 2: Scalability Tests - COMPLETED

| Task | Status | Commit |
|------|--------|--------|
| `chart-scalability.test.ts` (20 tests) | Done | 0c1a396 - ef16a8a |
| `scalability-invariants.test.ts` hardened | Done | b2ec479 |
| `test:scalability` npm script | Done | b2ec479 |

### Phase 3: CI Integration - COMPLETED

| Task | Status | Commit |
|------|--------|--------|
| `scalability-tests` job in ci.yml | Done | b2ec479 |
| Cached synthetic data generation | Done | b2ec479 |

---

## Files Modified

| File | Change |
|------|--------|
| `scripts/generate-synthetic-dataset.py` | Added --users, --weeks, --include-comments |
| `tests/unit/test_synthetic_dataset.py` | Generator scalability tests |
| `extension/ui/modules/charts/throughput.ts` | MAX_THROUGHPUT_POINTS, truncation |
| `extension/ui/modules/charts/cycle-time.ts` | MAX_CYCLE_TIME_POINTS, truncation |
| `extension/ui/modules/charts/reviewer-activity.ts` | MAX_REVIEWER_WEEKS, JSDoc |
| `extension/ui/styles.css` | .truncation-indicator CSS, .h-bar-value min-width |
| `extension/tests/unit/chart-scalability.test.ts` | 20 scalability tests |
| `extension/tests/scalability-invariants.test.ts` | Hardened assertions |
| `extension/package.json` | test:scalability script |
| `.github/workflows/ci.yml` | scalability-tests job |

---

## Out of Scope (Future Work)

- Granularity toggle (weekly/monthly) - adds UI complexity
- Virtual scrolling - only needed for list views
- Server-side pagination - only if client memory becomes bottleneck
- Adaptive sampling for very large datasets
