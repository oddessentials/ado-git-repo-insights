# Phase 4 Extension Hardening - Session Context

**Branch**: `feat/phase4-performance-hardening`
**Last Updated**: 2026-01-14

## Status Summary

| Step | Description | Status |
|------|-------------|--------|
| 1 | Synthetic Dataset Generator | ✅ Complete |
| 2 | Baseline Performance Tests | ✅ Complete |
| 3 | Date-Range Warning UX | ✅ Complete |
| 4 | Chunked Loading with Progress + Caching | 🔲 Not Started |
| 5 | Automated Scaling Gates | 🔲 Not Started |
| 6 | Progressive Rendering Metrics | 🔲 Not Started |

---

## Step 4: Chunked Loading with Progress + Caching

### Goal
Add `getWeeklyRollupsWithProgress()` to enable concurrent fetching with progress callbacks and internal caching.

### Files to Modify

#### [MODIFY] `extension/ui/dataset-loader.js`
```javascript
// New: getWeeklyRollupsWithProgress(start, end, onProgress)
// - onProgress({ loaded, total, currentWeek })
// - Concurrency cap: maxConcurrentFetches = 4
// - Internal cache: Map keyed by week string
// - Deterministic ordering: results in week order regardless of fetch order

// Error mapping (existing error-codes.js):
// - 401/403 → AUTH_ERROR
// - 404 → NOT_FOUND
// - 5xx → TRANSIENT_ERROR
```

#### [MODIFY] `extension/tests/dataset-loader.test.js`
```javascript
// Tests:
// - Concurrency cap: max 4 simultaneous fetches
// - Ordering: results returned in week order
// - Cache hit: second call skips fetch
// - Progress: onProgress called with correct counts
// - Error mapping: 401→AUTH, 403→AUTH, 404→NOT_FOUND, 500→TRANSIENT
```

### Commit Message
```
feat(phase4): add chunked loading with progress and caching
```

---

## Step 5: Automated Scaling Gates (CI Matrix)

### Goal
Add parameterized performance tests at 1k/5k/10k PRs with regression detection.

### Files to Modify

#### [MODIFY] `extension/tests/performance.test.js`
```javascript
// Parameterized tests:
describe.each([1000, 5000, 10000])('Performance at %d PRs', (prCount) => {
  // Generate fixture on-demand or load from cache
  // Assert budgets scale linearly (or sub-linearly)
  // Fail CI on regression > 20% vs baseline
});
```

> **Note**: Fixtures generated on-demand via Python `scripts/generate-synthetic-dataset.py` during test setup, cached in `tmp/perf-fixtures/`.

### Commit Message
```
feat(phase4): add CI scaling gates at 1k/5k/10k PRs
```

---

## Step 6: Progressive Rendering Metrics (Structured + Asserted)

### Goal
Instrument dashboard with performance marks/measures and test assertions.

### Files to Modify

#### [MODIFY] `extension/ui/dashboard.js`
```javascript
// Metrics collector (test-visible):
window.__perfMetrics = { marks: [], measures: [] };

// Instrumentation:
performance.mark('dashboard-init');
// ... after first table render ...
performance.mark('first-meaningful-paint');
performance.measure('init-to-fmp', 'dashboard-init', 'first-meaningful-paint');

// Collector capture for tests:
window.__perfMetrics.measures.push(performance.getEntriesByType('measure'));
```

#### [MODIFY] `extension/tests/dashboard.test.js`
```javascript
// Tests:
// - 'dashboard-init' mark exists after init
// - 'first-meaningful-paint' mark exists after render
// - 'init-to-fmp' measure computed and > 0
```

### Commit Message
```
feat(phase4): add structured rendering metrics
```

---

## Verification Plan

| Test Suite | Command | CI Gate |
|------------|---------|---------|
| Python unit tests | `pytest tests/` | ✓ Must pass |
| Schema validation | `pytest tests/unit/test_synthetic_dataset.py` | ✓ Must pass |
| Extension Jest | `cd extension && npm test` | ✓ Must pass |
| Perf gates (1k/5k/10k) | `npm test -- performance.test.js` | ✓ Fail on regression |
| Consumer validation | `npm test -- synthetic-fixtures.test.js` | ✓ Must pass |

---

## Quick Start for Next Session

1. Check out the branch:
   ```bash
   git checkout feat/phase4-performance-hardening
   git pull origin feat/phase4-performance-hardening
   ```

2. Run existing tests to verify stability:
   ```bash
   pytest tests/
   cd extension && npm test
   ```

3. Continue with **Step 4** (Chunked Loading with Progress + Caching).
