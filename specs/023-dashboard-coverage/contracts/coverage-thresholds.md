# Contract: Coverage Thresholds

**Feature**: 023-dashboard-coverage
**Date**: 2026-02-03
**Updated**: 2026-02-03 (revised strategy for IIFE bundles)

## Purpose

This contract defines the Jest coverage threshold configuration for the hybrid coverage strategy.

## Strategy: Hybrid (Global Ratchet + Critical Path Contract Tests)

1. **Global Ratchet**: All code uses `floor(actual - 2.0)` formula, never decreasing
2. **Critical Path Contract Tests**: Named test suites validate critical functionality; pass/fail is the acceptance signal
3. **IIFE Bundle Exclusion**: Files bundled as IIFE for browser execution (dashboard.ts, settings.ts) are excluded from per-file thresholds since Jest cannot measure their coverage

## Critical Path Contract Tests

These named test suites validate critical dashboard functionality:

| Test Suite | File | Validates |
|------------|------|-----------|
| ML State Rendering | `tests/dashboard/ml-state-rendering.test.ts` | 5-state × 2-artifact rendering matrix |
| Settings Contract | `tests/dashboard/settings-contract.test.ts` | getSourceConfig/resolveConfiguration boundary |

**Acceptance Signal**: All tests in these suites must pass. Test presence and pass/fail status is the sole gate—not coverage percentage.

## Per-File Thresholds (Importable Modules Only)

Only modules that can be imported in tests receive per-file thresholds:

```typescript
// jest.config.ts additions
coverageThreshold: {
  // ... existing global thresholds ...

  // Critical Path: API client (importable module)
  "ui/artifact-client.ts": {
    statements: 40,
    branches: 35,
    functions: 40,
    lines: 40,
  },

  // Critical Path: XSS prevention (importable module)
  "ui/modules/shared/security.ts": {
    statements: 95,
    branches: 90,
    functions: 100,
    lines: 95,
  },

  // Critical Path: ML rendering (importable module)
  "ui/modules/ml.ts": {
    statements: 75,
    branches: 55,
    functions: 55,
    lines: 75,
  },
}
```

## IIFE Bundle Exclusions

The following files are bundled as IIFE for browser execution and **excluded from per-file coverage thresholds**:

| File | Reason | Coverage Strategy |
|------|--------|-------------------|
| `ui/dashboard.ts` | IIFE bundle entry point | Critical Path Contract Tests |
| `ui/settings.ts` | IIFE bundle entry point | Out of scope (per spec) |

These files show 0% in Jest coverage reports because they are not imported as modules. Their critical paths are validated via contract tests that simulate their internal logic.

## Function-to-Coverage Mapping

| Critical Path Function | Actual Location | Coverage Strategy |
|------------------------|-----------------|-------------------|
| `renderPredictionsForState` | ui/modules/ml.ts | Per-file threshold (75%+) |
| `renderInsightsForState` | ui/modules/ml.ts | Per-file threshold (75%+) |
| `getSourceConfig` | ui/dashboard.ts (internal) | Contract test simulation |
| `resolveConfiguration` | ui/dashboard.ts (internal) | Contract test simulation |
| `loadDataset` | ui/dataset-loader.ts | Existing threshold (80%) |
| `_authenticatedFetch` | ui/artifact-client.ts | Per-file threshold (40%+) |

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

## Validation Commands

```bash
# Run all tests with coverage
pnpm test -- --coverage

# Verify Critical Path Contract Tests pass
pnpm test -- tests/dashboard/ml-state-rendering.test.ts tests/dashboard/settings-contract.test.ts

# Check specific importable module coverage
pnpm test -- --coverage --collectCoverageFrom="ui/modules/ml.ts"
pnpm test -- --coverage --collectCoverageFrom="ui/artifact-client.ts"
```

## CI Enforcement

The GitHub Actions workflow enforces:

1. **Global ratchet**: Jest fails if global coverage drops below thresholds
2. **Contract tests**: Test suite failure blocks merge
3. **Per-file thresholds**: Jest fails if importable modules drop below thresholds

```yaml
# .github/workflows/extension-tests.yml
- name: Run tests with coverage
  run: pnpm test -- --coverage
  working-directory: extension
```

## Update Procedure

When raising thresholds:

1. Run CI to get canonical coverage values
2. Apply formula: `new_threshold = floor(actual - 2.0)`
3. Update `jest.config.ts`
4. Update this contract document
5. Update `COVERAGE_RATCHET.md` history table
