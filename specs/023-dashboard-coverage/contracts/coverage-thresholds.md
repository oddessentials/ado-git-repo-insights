# Contract: Coverage Thresholds

**Feature**: 023-dashboard-coverage
**Date**: 2026-02-03

## Purpose

This contract defines the Jest coverage threshold configuration for the hybrid coverage strategy.

## Strategy: Hybrid (Critical Path Set + Global Ratchet)

1. **Critical Path Set**: Specific high-risk files require elevated thresholds
2. **Global Ratchet**: All other code uses `floor(actual - 2.0)` formula, never decreasing

## Critical Path Set Thresholds

These files contain the 6 critical functions and require explicit thresholds:

```typescript
// jest.config.ts additions
coverageThreshold: {
  // ... existing global thresholds ...

  // Critical Path: Dashboard rendering and configuration
  "ui/dashboard.ts": {
    statements: 70,
    branches: 65,
    functions: 70,
    lines: 70,
  },

  // Critical Path: API client
  "ui/artifact-client.ts": {
    statements: 40,
    branches: 35,
    functions: 40,
    lines: 40,
  },

  // Critical Path: XSS prevention (NEW)
  "ui/modules/shared/security.ts": {
    statements: 95,
    branches: 90,
    functions: 100,
    lines: 95,
  },
}
```

## Function-to-File Mapping

| Critical Path Function | File | Target |
|------------------------|------|--------|
| `renderPredictionsForState` | ui/dashboard.ts | 70% file coverage |
| `renderInsightsForState` | ui/dashboard.ts | 70% file coverage |
| `getSourceConfig` | ui/dashboard.ts | 70% file coverage |
| `resolveConfiguration` | ui/dashboard.ts | 70% file coverage |
| `loadDataset` | ui/dataset-loader.ts | 80% (existing) |
| `_authenticatedFetch` | ui/artifact-client.ts | 40% file coverage |

## Global Ratchet Rules

From `COVERAGE_RATCHET.md`:

1. **Formula**: `threshold = floor(actual_coverage - 2.0)`
2. **Direction**: Thresholds only increase, never decrease
3. **Canonical Source**: CI ubuntu-latest + Node 22 values are authoritative
4. **Increments**: Raise by 2-5% per sprint as tests are added

## Current Global Baselines

```typescript
global: {
  statements: 55,  // floor(57.25 - 2.0)
  branches: 49,    // floor(51.92 - 2.0)
  functions: 51,   // floor(53.63 - 2.0)
  lines: 56,       // floor(58.86 - 2.0)
}
```

## Post-Implementation Targets

After this feature is complete, expected coverage:

| File | Before | After | Threshold |
|------|--------|-------|-----------|
| ui/dashboard.ts | ~55% | ~70% | 68% |
| ui/artifact-client.ts | ~15% | ~40% | 38% |
| ui/modules/shared/security.ts | ~80% | ~95% | 93% |
| Global | ~55% | ~60% | 58% |

## Validation Commands

```bash
# Run coverage report
npm test -- --coverage

# Check specific file coverage
npm test -- --coverage --collectCoverageFrom="ui/dashboard.ts"

# Verify thresholds pass
npm test -- --coverage --coverageThreshold='{"global":{"lines":56}}'
```

## CI Enforcement

The GitHub Actions workflow enforces coverage thresholds:

```yaml
# .github/workflows/extension-tests.yml
- name: Run tests with coverage
  run: npm test -- --coverage
  working-directory: extension
```

Jest fails the build if any threshold is violated.

## Update Procedure

When raising thresholds:

1. Run CI to get canonical coverage values
2. Apply formula: `new_threshold = floor(actual - 2.0)`
3. Update `jest.config.ts`
4. Update this contract document
5. Update `COVERAGE_RATCHET.md` history table
