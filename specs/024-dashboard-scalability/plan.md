# Implementation Plan: Dashboard Scalability

**Branch**: `024-dashboard-scalability` | **Date**: 2026-02-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/024-dashboard-scalability/spec.md`

## Summary

Enable the dashboard to handle enterprise-scale data (156+ weeks, 200+ reviewers, comments enabled) through:
1. Enhancing the synthetic data generator to support larger datasets with comment generation
2. Adding data point caps to charts that currently render unlimited data
3. Implementing truncation indicators for user transparency
4. Creating automated scalability regression tests in CI

## Technical Context

**Language/Version**: Python 3.11 (generator), TypeScript 5.7.3 (dashboard/tests)
**Primary Dependencies**: Python stdlib (generator), Jest 30.0.0 (tests), esbuild 0.27.0 (bundling)
**Storage**: JSON files (weekly rollups, dimensions, manifest)
**Testing**: pytest (Python), Jest (TypeScript), scalability-invariants.test.ts
**Target Platform**: Browser (dashboard), Node.js (tests), CLI (generator)
**Project Type**: Existing monorepo with Python backend + TypeScript extension
**Performance Goals**: All charts < 1000ms render for 156 weeks, dashboard interactive < 5 seconds
**Constraints**: DOM elements < 1000 per chart, memory delta < 100MB for stress tests
**Scale/Scope**: 156 weeks (3 years), 200 users, 20,000-50,000 comments

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Applicable Quality Gates

| Gate | Requirement | Status | Evidence |
|------|-------------|--------|----------|
| QG-25 | Synthetic data supports 156+ weeks | **PASS** | `tests/unit/test_synthetic_dataset.py::test_156_weeks` (775/775 pass) |
| QG-26 | Synthetic data supports 200+ reviewers | **PASS** | `tests/unit/test_synthetic_dataset.py::test_200_users` (775/775 pass) |
| QG-27 | Synthetic data includes comment generation | **PASS** | `tests/unit/test_synthetic_dataset.py::test_include_comments` (775/775 pass) |
| QG-28 | Dashboard renders 156 weeks in < 1000ms | **PASS** | `chart-scalability.test.ts` T027, T028 (31/31 scalability pass) |
| QG-29 | Chart data caps enforced (MAX_*_POINTS) | **PASS** | `scalability-invariants.test.ts` (11/11 pass, all strict assertions) |

### Applicable Verification Requirements

| Checkpoint | Scenario | Status |
|------------|----------|--------|
| VR-20 | Scalability dataset generation | **PASS** — Generator tests verify 156 weeks, 200 users, comments |
| VR-21 | Dashboard load test (156 weeks) | **PASS** — T027, T028 render < 1000ms; T029, T030 cap DOM elements |
| VR-22 | Dashboard load test (200 reviewers) | **PASS** — T043, T044, T045 verify 200-user rendering |
| VR-23 | Dashboard load test (comments enabled) | **PASS** — T048-T051 verify charts + feature flag with comments |

### Non-Applicable Principles

This feature does not modify:
- CSV schema or output (Principles I-IV)
- SQLite persistence (Principles V-IX)
- API extraction logic (Principles X-XII)
- Authentication or secrets (Principles XIX-XX)

**Gate Status**: ✅ PASS - No violations. This feature directly implements QG-25 through QG-29.

## Project Structure

### Documentation (this feature)

```text
specs/024-dashboard-scalability/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (N/A - no API contracts)
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
# Python Generator (Phase 0 - BLOCKING)
scripts/
└── generate-synthetic-dataset.py    # Enhance: --users, --weeks, --include-comments

# Generator Tests
tests/unit/
└── test_synthetic_dataset.py        # Add tests for new parameters

# TypeScript Charts (Phase 1)
extension/ui/modules/charts/
├── throughput.ts                    # Add MAX_THROUGHPUT_POINTS
└── cycle-time.ts                    # Add MAX_CYCLE_TIME_POINTS

# TypeScript Tests (Phase 2)
extension/tests/
├── scalability-invariants.test.ts   # Already created - enable strict assertions
└── unit/
    └── chart-scalability.test.ts    # NEW: Performance/DOM assertions

# CI Integration (Phase 3)
.github/workflows/
└── test.yml                         # Add scalability test step
```

**Structure Decision**: Existing monorepo structure. Changes span Python scripts, TypeScript UI modules, and CI workflows. No new directories needed except `extension/tests/unit/`.

## Complexity Tracking

> No Constitution violations to justify. This feature implements required scalability gates.

## Implementation Phases

### Phase 0: Generator Enhancement (BLOCKING)

**Goal**: Enable synthetic data generation at enterprise scale.

**Changes to `scripts/generate-synthetic-dataset.py`**:

1. **Add `--users` CLI argument** (FR-002)
   - Accept 1-500 users
   - Remove existing cap at line 50: `min(30, ...)`
   - Default: auto-calculate based on PR count, max 200

2. **Add `--weeks` argument** (FR-001)
   - Accept 1-520 weeks
   - Remove existing cap at line 82: `min(52, ...)`
   - Default: auto-calculate based on PR count, max 156

3. **Add `--include-comments` flag** (FR-003, FR-004, FR-005)
   - Generate pr_threads (2-5 per PR)
   - Generate pr_comments (1-4 per thread)
   - Set `features.comments: true` in manifest
   - Include comment statistics in coverage

**Tests**: `tests/unit/test_synthetic_dataset.py`
- Test --users 200 produces 200 users in dimensions
- Test --weeks 156 produces 156 rollup files
- Test --include-comments sets feature flag
- Test validation errors for --users 0

**Acceptance**: Running the Target Scalability Profile succeeds:
```bash
python scripts/generate-synthetic-dataset.py \
  --pr-count 10000 --weeks 156 --users 200 --include-comments \
  --seed 42 --output test-data/scalability
```

### Phase 1: Chart Data Caps

**Goal**: Prevent unbounded DOM growth in charts.

**Changes to `extension/ui/modules/charts/throughput.ts`** (FR-006):
```typescript
const MAX_THROUGHPUT_POINTS = 104; // 2 years of weekly data

export function renderThroughputChart(rollups: WeeklyRollup[]): void {
  const truncated = rollups.length > MAX_THROUGHPUT_POINTS;
  const limitedRollups = truncated
    ? rollups.slice(-MAX_THROUGHPUT_POINTS)
    : rollups;

  // Show truncation indicator (FR-008, FR-009)
  if (truncated) {
    // Render "(showing last 2 years)" indicator
  }

  // ... existing render logic using limitedRollups
}
```

**Changes to `extension/ui/modules/charts/cycle-time.ts`** (FR-007):
- Same pattern with `MAX_CYCLE_TIME_POINTS = 104`

**Tests**: Existing chart tests + scalability-invariants.test.ts
- Verify MAX_*_POINTS constants exist
- Verify truncation indicator appears when data exceeds cap

### Phase 2: Scalability Tests

**Goal**: Automated regression testing for performance.

**New file: `extension/tests/unit/chart-scalability.test.ts`** (FR-014, FR-015):
```typescript
describe('Chart Scalability', () => {
  it('renders throughput chart with 156 weeks in < 1000ms', () => {
    const rollups = loadScalabilityDataset();
    const start = performance.now();
    renderThroughputChart(rollups);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('caps DOM elements at MAX_THROUGHPUT_POINTS', () => {
    const rollups = loadScalabilityDataset(); // 156 weeks
    renderThroughputChart(rollups);
    const bars = document.querySelectorAll('.throughput-bar');
    expect(bars.length).toBeLessThanOrEqual(104);
  });

  it('shows truncation indicator when data exceeds cap', () => {
    const rollups = loadScalabilityDataset();
    renderThroughputChart(rollups);
    expect(document.querySelector('.truncation-indicator')).toBeTruthy();
  });
});
```

**Update: `extension/tests/scalability-invariants.test.ts`**:
- Change `console.warn` to `expect().toBe()` assertions
- Enable strict enforcement of caps

### Phase 3: CI Integration

**Goal**: Run scalability tests automatically on every PR.

**Changes to `.github/workflows/test.yml`** (FR-013):
```yaml
- name: Generate scalability test data
  run: |
    python scripts/generate-synthetic-dataset.py \
      --pr-count 10000 --weeks 156 --users 200 \
      --include-comments --seed 42 --output test-data/scalability

- name: Run scalability tests
  run: pnpm test:scalability
```

**Changes to `extension/package.json`**:
```json
{
  "scripts": {
    "test:scalability": "jest --testPathPattern=scalability"
  }
}
```

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Generator changes break existing tests | Medium | High | Run full test suite after each change |
| Performance thresholds too strict | Low | Medium | Start with 1000ms, adjust based on CI data |
| Comment generation too slow | Low | Low | Use simple random distribution, no external deps |
| Chart truncation confuses users | Low | Medium | Clear "(showing last 2 years)" indicator |

## Dependencies

- **Phase 0 → Phase 1**: Generator must produce test data before charts can be tested
- **Phase 1 → Phase 2**: Charts must have caps before scalability tests can verify them
- **Phase 2 → Phase 3**: Tests must exist before CI can run them

## Success Verification

| Criterion | How to Verify |
|-----------|---------------|
| SC-001: Interactive < 5s | Load scalability dataset in browser, measure TTI |
| SC-002: Render < 1s | Jest performance tests with performance.now() |
| SC-003: Memory < 100MB | Chrome DevTools Memory tab during stress test |
| SC-004: Generator < 60s | Time the generator command execution |
| SC-005: 100% tests pass | CI must be green before merge |
| SC-006: Truncation visible | Manual verification + DOM assertion |
