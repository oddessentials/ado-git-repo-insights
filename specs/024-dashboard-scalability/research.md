# Research: Dashboard Scalability

**Feature**: 024-dashboard-scalability
**Date**: 2026-02-05

## Overview

This document captures research findings for implementing enterprise-scale dashboard support.

---

## Research Area 1: Synthetic Data Generator Constraints

### Current State Analysis

**File**: `scripts/generate-synthetic-dataset.py`

| Parameter | Current Limit | Required | Gap |
|-----------|---------------|----------|-----|
| Users | `min(30, max(10, pr_count // 10))` (line 50) | 200+ | Remove 30-user cap |
| Weeks | `min(52, max(4, pr_count // 20))` (line 82) | 156+ | Remove 52-week cap |
| Comments | Not implemented | Enabled | Add full implementation |

### Decision: CLI Argument Design

**Users (`--users`)**:
- Accept integer 1-500
- Default: `None` (auto-calculate)
- Auto-calculation: `min(200, max(10, pr_count // 10))`
- Validation: Fail fast if `--users 0`

**Weeks (`--weeks`)**:
- Accept integer 1-520 (up to 10 years)
- Default: `None` (use existing auto-calculation with raised cap)
- Auto-calculation: `min(156, max(4, pr_count // 20))`

**Comments (`--include-comments`)**:
- Boolean flag, default False
- When enabled:
  - Generate 2-5 threads per PR (random distribution)
  - Generate 1-4 comments per thread (random distribution)
  - Set `features.comments: true` in manifest
  - Add comment statistics to coverage section

**Rationale**: CLI arguments allow flexible test profiles while maintaining backward compatibility with existing usage.

**Alternatives Considered**:
- Separate test profile configs (YAML) - Rejected: over-engineering for this use case
- Environment variables - Rejected: CLI args more explicit and self-documenting

---

## Research Area 2: Chart Rendering Patterns

### Current Implementation Analysis

| Chart | File | Current Limit | Data Cap Pattern |
|-------|------|---------------|------------------|
| Reviewer Activity | `reviewer-activity.ts:34` | 8 weeks | `.slice(-8)` |
| Summary Sparklines | `charts.ts:73-74` | 8 values | `.slice(-8)` |
| Forecast Charts | `predictions.ts:44` | 200 points | `MAX_CHART_POINTS` |
| ML Sparklines | `ml.ts:70` | 200 points | `MAX_SPARKLINE_POINTS` |
| **Throughput** | `throughput.ts` | **NONE** | No cap |
| **Cycle Time Trend** | `cycle-time.ts` | **NONE** | No cap |

### Decision: Consistent Cap Pattern

Apply the same pattern used in `predictions.ts`:

```typescript
const MAX_THROUGHPUT_POINTS = 104; // 2 years of weekly data

// At render entry point
const truncated = rollups.length > MAX_THROUGHPUT_POINTS;
const limitedRollups = truncated
  ? rollups.slice(-MAX_THROUGHPUT_POINTS)
  : rollups;
```

**Cap Value**: 104 weeks (2 years)
- Balances historical visibility with performance
- Matches typical date range filter options
- Keeps DOM elements well under 1000 limit

**Rationale**: Consistent with existing patterns in the codebase. The `.slice(-N)` strategy keeps recent data, which users prefer.

**Alternatives Considered**:
- Dynamic cap based on viewport - Rejected: complex, inconsistent behavior
- User-configurable cap - Rejected: adds UI complexity without clear benefit
- Pagination - Rejected: charts don't benefit from pagination UX

---

## Research Area 3: Truncation Indicator UX

### Decision: Visual Indicator Design

When data is truncated, display a subtle indicator below the chart:

```
📊 Throughput Over Time
[chart visualization]
ℹ️ Showing last 2 years (104 weeks)
```

**Implementation**:
```typescript
if (truncated) {
  const indicator = document.createElement('div');
  indicator.className = 'truncation-indicator';
  indicator.textContent = `Showing last 2 years (${MAX_THROUGHPUT_POINTS} weeks)`;
  chartContainer.appendChild(indicator);
}
```

**Styling**: Light gray text, smaller font, left-aligned below chart

**Rationale**: Users need to understand they're viewing a subset. The indicator is informative without being intrusive.

**Alternatives Considered**:
- Toast notification - Rejected: too intrusive, interrupts workflow
- Tooltip on hover - Rejected: not discoverable
- No indicator - Rejected: users would be confused about missing data

---

## Research Area 4: Comment Data Generation

### Data Model Analysis

From `src/ado_git_repo_insights/persistence/models.py`:

```sql
-- pr_threads table (lines 129-140)
CREATE TABLE IF NOT EXISTS pr_threads (
    thread_id TEXT PRIMARY KEY,
    pull_request_uid TEXT NOT NULL,
    status TEXT,  -- active, fixed, closed, etc.
    thread_context TEXT,  -- JSON: file path, line range, etc.
    last_updated TEXT NOT NULL,
    created_at TEXT NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    FOREIGN KEY (pull_request_uid) REFERENCES pull_requests(pull_request_uid)
);

-- pr_comments table (lines 142-155)
CREATE TABLE IF NOT EXISTS pr_comments (
    comment_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    pull_request_uid TEXT NOT NULL,
    author_id TEXT NOT NULL,
    content TEXT,
    comment_type TEXT,  -- text, codeChange, system
    created_at TEXT NOT NULL,
    last_updated TEXT,
    is_deleted INTEGER DEFAULT 0,
    ...
);
```

### Decision: Comment Generation Strategy

For synthetic data, generate:

1. **Threads per PR**: Random 2-5 (realistic engagement)
2. **Comments per thread**: Random 1-4 (thread conversations)
3. **Thread status**: Weighted random - 60% active, 25% fixed, 15% closed
4. **Comment type**: Weighted random - 85% text, 10% codeChange, 5% system
5. **Content**: Placeholder text (e.g., "Synthetic comment #{n}")

**Volume Estimates** (for 10,000 PRs):
- Threads: 10,000 × 3.5 avg = ~35,000 threads
- Comments: 35,000 × 2.5 avg = ~87,500 comments

**Rationale**: Realistic distributions without external dependencies. Volume is sufficient to stress-test the system.

---

## Research Area 5: Performance Testing Approach

### Decision: Jest Performance Tests

Use `performance.now()` for timing measurements in Jest:

```typescript
it('renders throughput chart with 156 weeks in < 1000ms', () => {
  const start = performance.now();
  renderThroughputChart(rollups);
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(1000);
});
```

**Thresholds**:
| Scenario | Chart Render | Time to Interactive |
|----------|--------------|---------------------|
| Baseline (52 weeks) | < 100ms | < 2s |
| Target (156 weeks) | < 500ms | < 5s |
| Stress (260 weeks) | < 1000ms | < 10s |

**DOM Assertions**:
```typescript
it('caps DOM elements at MAX_THROUGHPUT_POINTS', () => {
  renderThroughputChart(rollups);
  const elements = document.querySelectorAll('.throughput-bar');
  expect(elements.length).toBeLessThanOrEqual(104);
});
```

**Rationale**: Jest with jsdom provides deterministic test environment. Thresholds based on user-perceptible delays.

**Alternatives Considered**:
- Playwright for real browser testing - Rejected for unit tests: too slow, flaky
- Custom performance monitoring - Rejected: reinventing the wheel
- No performance tests - Rejected: regressions would go undetected

---

## Research Area 6: CI Integration

### Decision: Scalability Test Pipeline

Add to `.github/workflows/test.yml`:

```yaml
scalability-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - name: Set up Python
      uses: actions/setup-python@v5
      with:
        python-version: '3.11'

    - name: Generate scalability test data
      run: |
        python scripts/generate-synthetic-dataset.py \
          --pr-count 10000 --weeks 156 --users 200 \
          --include-comments --seed 42 --output test-data/scalability

    - name: Set up Node
      uses: actions/setup-node@v4
      with:
        node-version: '22'

    - name: Install dependencies
      run: pnpm install

    - name: Run scalability tests
      run: pnpm test:scalability
```

**Caching**: Consider caching generated test data for faster CI runs:
```yaml
- name: Cache scalability test data
  uses: actions/cache@v4
  with:
    path: test-data/scalability
    key: scalability-data-${{ hashFiles('scripts/generate-synthetic-dataset.py') }}
```

**Rationale**: Separate job allows parallel execution. Caching reduces CI time when generator hasn't changed.

---

## Summary of Decisions

| Area | Decision | Rationale |
|------|----------|-----------|
| CLI arguments | `--users`, `--weeks`, `--include-comments` | Flexibility without complexity |
| Data cap | 104 weeks (2 years) | Balance visibility/performance |
| Cap pattern | `MAX_*_POINTS` constant + `.slice(-N)` | Consistency with existing code |
| Truncation UX | Subtle indicator below chart | Informative, non-intrusive |
| Comment generation | 2-5 threads/PR, 1-4 comments/thread | Realistic distributions |
| Performance tests | Jest with `performance.now()` | Deterministic, fast |
| CI integration | Separate job with caching | Parallel execution, speed |

All decisions maintain backward compatibility and follow existing codebase patterns.
