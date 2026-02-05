# Dashboard Scalability & Data Overflow

> Last reviewed: 2026-02-05

## Problem Statement

The dashboard uses **truncation** (e.g., `.slice(-8)`) to limit data points on some charts, but **Throughput** and **Cycle Time Trend** charts render ALL data points with no cap. A user selecting a 3-year date range will render 156+ SVG elements, potentially causing performance degradation.

**Goal:** Ensure all dashboard panels render smoothly with 3+ years of data, 200+ reviewers, and full comment extraction enabled.

---

## BLOCKING PREREQUISITE: Synthetic Data Generator Enhancement

**Status: NOT STARTED - MUST COMPLETE FIRST**

The existing synthetic data generators cannot produce the required test data:

| Requirement | Current Capability | Gap |
|-------------|-------------------|-----|
| 3 years (156 weeks) | `generate-synthetic-dataset.py` caps at 52 weeks | Must remove cap |
| 200+ reviewers | Capped at 30 users (line 50) | Must increase to 200+ |
| Comment data | `features.comments: False`, no generation | Must implement |

### Required Generator Changes

**File:** `scripts/generate-synthetic-dataset.py`

1. **Remove user cap (line 50)**
   ```python
   # BEFORE
   num_users = min(30, max(10, pr_count // 10))

   # AFTER - Add --users CLI argument
   num_users = args.users if args.users else min(200, max(10, pr_count // 10))
   ```

2. **Remove weeks cap (line 82)**
   ```python
   # BEFORE
   weeks = min(52, max(4, pr_count // 20))

   # AFTER - Add --weeks CLI argument with higher default
   weeks = args.weeks if args.weeks else min(156, max(4, pr_count // 20))
   ```

3. **Add --users CLI argument**
   ```python
   parser.add_argument(
       "--users",
       type=int,
       default=None,
       help="Number of users/reviewers to generate (default: auto, max 200)",
   )
   ```

4. **Add comment data generation**
   - Generate `pr_threads` entries (2-5 threads per PR)
   - Generate `pr_comments` entries (1-4 comments per thread)
   - Set `features.comments: True` in manifest
   - Include comment statistics in coverage

### New Scalability Test Profile

After generator enhancement, create this standard test profile:

```bash
python scripts/generate-synthetic-dataset.py \
  --pr-count 10000 \
  --weeks 156 \
  --users 200 \
  --include-comments \
  --seed 42 \
  --output test-data/scalability
```

**Expected output:**
- 156 weekly rollup files (3 years)
- 200 users in dimensions.json
- ~20,000-50,000 comment records
- `features.comments: true` in manifest

---

## Current Data Point Limits

| Component | Limit | Code | Status |
|-----------|-------|------|--------|
| Reviewer Activity | 8 weeks | `rollups.slice(-8)` | `extension/ui/modules/charts/reviewer-activity.ts:34` |
| Summary Sparklines | 8 values | `values.slice(-8)` | `extension/ui/modules/charts.ts:73-74` |
| Forecast Charts | 200 points | `MAX_CHART_POINTS = 200` | `extension/ui/modules/charts/predictions.ts:44` |
| ML Sparklines | 200 points | `MAX_SPARKLINE_POINTS = 200` | `extension/ui/modules/ml.ts:70` |
| **Throughput Chart** | **NONE** | Renders all rollups | `extension/ui/modules/charts/throughput.ts` |
| **Cycle Time Trend** | **NONE** | Renders all rollups | `extension/ui/modules/charts/cycle-time.ts` |

---

## Test Scenarios

All scenarios require the generator enhancement to be completed first.

### Scenario 1: Baseline (Current Demo)
```bash
python scripts/generate-demo-data.py  # 260 weeks, 50 users, no comments
```
- **Purpose:** Verify existing functionality
- **Expected:** All charts render in < 500ms

### Scenario 2: Target Scalability Profile (PRIMARY)
```bash
python scripts/generate-synthetic-dataset.py \
  --pr-count 10000 \
  --weeks 156 \
  --users 200 \
  --include-comments \
  --output test-data/scalability
```
- **Purpose:** Full system load test
- **Requirements:**
  - 156 weeks (3 years) of weekly rollups
  - 200 distinct reviewers in dimensions
  - Comment data with `features.comments: true`
- **Expected:** All charts render in < 1000ms, no browser freeze

### Scenario 3: Stress Test (Upper Bound)
```bash
python scripts/generate-synthetic-dataset.py \
  --pr-count 20000 \
  --weeks 260 \
  --users 300 \
  --include-comments \
  --output test-data/stress
```
- **Purpose:** Find breaking points
- **Expected:** Dashboard remains usable (may show truncation indicators)

### Scenario 4: Comment-Heavy Load
```bash
python scripts/generate-synthetic-dataset.py \
  --pr-count 5000 \
  --weeks 104 \
  --users 100 \
  --include-comments \
  --comments-per-pr 10 \
  --output test-data/comments-heavy
```
- **Purpose:** Test comment feature under load
- **Expected:** Comment-related UI (if implemented) handles 50K+ comments

---

## Acceptance Criteria

### Performance Thresholds

| Metric | Baseline (52 weeks) | Target (156 weeks) | Stress (260 weeks) |
|--------|---------------------|--------------------|--------------------|
| Chart render time | < 100ms | < 500ms | < 1000ms |
| DOM elements per chart | < 200 | < 500 | < 1000 |
| Memory delta | < 20MB | < 50MB | < 100MB |
| Time to interactive | < 2s | < 5s | < 10s |

### Functional Requirements

1. **Throughput chart** with 156+ weeks:
   - Either renders all data OR shows truncation indicator
   - X-axis labels auto-thin to remain readable
   - Hover tooltips functional on visible bars

2. **Cycle Time Trend** with 156+ weeks:
   - SVG path renders without clipping
   - Performance does not degrade linearly with data points

3. **With 200+ reviewers:**
   - Reviewer Activity panel displays correctly
   - No dropdown overflow issues in filters (if reviewer filter implemented)

4. **With comments enabled:**
   - Dashboard loads without errors
   - Comment feature flag reflected correctly in UI

---

## Implementation Tasks

### Phase 0: Generator Enhancement (BLOCKING)

| Task | File | Description |
|------|------|-------------|
| 0.1 | `scripts/generate-synthetic-dataset.py` | Add `--users` CLI argument |
| 0.2 | `scripts/generate-synthetic-dataset.py` | Remove 52-week cap, add `--weeks` argument |
| 0.3 | `scripts/generate-synthetic-dataset.py` | Implement comment data generation |
| 0.4 | `scripts/generate-synthetic-dataset.py` | Add `--include-comments` flag |
| 0.5 | `tests/unit/test_synthetic_dataset.py` | Add tests for new parameters |

**Acceptance:** Running the Target Scalability Profile command produces valid output.

### Phase 1: Chart Data Caps

| Task | File | Description |
|------|------|-------------|
| 1.1 | `extension/ui/modules/charts/throughput.ts` | Add `MAX_THROUGHPUT_POINTS = 104` |
| 1.2 | `extension/ui/modules/charts/cycle-time.ts` | Add `MAX_CYCLE_TIME_POINTS = 104` |
| 1.3 | Both files | Add truncation indicator when data exceeds cap |

**Code pattern:**
```typescript
const MAX_THROUGHPUT_POINTS = 104; // 2 years of weekly data

export function renderThroughputChart(rollups: WeeklyRollup[]): void {
  const truncated = rollups.length > MAX_THROUGHPUT_POINTS;
  const limitedRollups = truncated
    ? rollups.slice(-MAX_THROUGHPUT_POINTS)
    : rollups;

  if (truncated) {
    // Show "(showing last 2 years)" indicator
  }
  // ... existing render logic using limitedRollups
}
```

### Phase 2: Scalability Tests

| Task | File | Description |
|------|------|-------------|
| 2.1 | `extension/tests/unit/chart-scalability.test.ts` | New test file |
| 2.2 | Test file | Render timing assertions with 156-week data |
| 2.3 | Test file | DOM element count assertions |
| 2.4 | Test file | Empty data handling |

**Test structure:**
```typescript
describe('Chart Scalability', () => {
  const SCALABILITY_DATASET = 'test-data/scalability';

  beforeAll(async () => {
    // Load 156-week, 200-user, comments-enabled dataset
  });

  it('renders throughput chart with 156 weeks in < 500ms', () => {
    const start = performance.now();
    renderThroughputChart(rollups);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('caps DOM elements at MAX_THROUGHPUT_POINTS', () => {
    renderThroughputChart(rollups);
    const bars = document.querySelectorAll('.throughput-bar');
    expect(bars.length).toBeLessThanOrEqual(104);
  });

  it('shows truncation indicator when data exceeds cap', () => {
    renderThroughputChart(rollups); // 156 weeks > 104 cap
    expect(document.querySelector('.truncation-indicator')).toBeTruthy();
  });
});
```

### Phase 3: CI Integration

| Task | File | Description |
|------|------|-------------|
| 3.1 | `.github/workflows/test.yml` | Add synthetic data generation step |
| 3.2 | Workflow | Cache generated test data |
| 3.3 | Workflow | Run scalability tests |

**Workflow addition:**
```yaml
- name: Generate scalability test data
  run: |
    python scripts/generate-synthetic-dataset.py \
      --pr-count 10000 \
      --weeks 156 \
      --users 200 \
      --include-comments \
      --output test-data/scalability

- name: Run scalability tests
  run: pnpm test:scalability
```

---

## Files to Modify

| Phase | File | Change |
|-------|------|--------|
| 0 | `scripts/generate-synthetic-dataset.py` | Add --users, --weeks, --include-comments |
| 0 | `tests/unit/test_synthetic_dataset.py` | Tests for new generator features |
| 1 | `extension/ui/modules/charts/throughput.ts` | Add MAX_THROUGHPUT_POINTS, truncation |
| 1 | `extension/ui/modules/charts/cycle-time.ts` | Add MAX_CYCLE_TIME_POINTS, truncation |
| 2 | `extension/tests/unit/chart-scalability.test.ts` | New test file |
| 3 | `.github/workflows/test.yml` | CI integration |

---

## Out of Scope (Future Work)

- Granularity toggle (weekly/monthly) - adds UI complexity
- Virtual scrolling - only needed for list views
- Server-side pagination - only if client memory becomes bottleneck
- Adaptive sampling for very large datasets
