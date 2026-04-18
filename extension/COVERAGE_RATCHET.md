# Coverage Ratchet Plan (TypeScript per-file tier data)

> General ratchet workflow — formula, canonical env, markers, recovery — lives
> in [`docs/development/ratchets.md`](../docs/development/ratchets.md).
> This file holds the TypeScript-specific per-file tier table, phase schedule,
> and history.

## Current State (Phase 5.2 Complete)

**Global Coverage:**

- Statements: ~65% (threshold: 55%)
- Branches: ~60% (threshold: 49%)
- Functions: ~62% (threshold: 51%)
- Lines: ~67% (threshold: 56%)

**Target (Phase 6):** 70% global coverage

## Tiered Threshold Strategy

### Tier 1: Global Baseline

The global threshold applies to all code. It's intentionally lower to accommodate:

- DOM-heavy modules without full mock coverage (dashboard.ts, settings.ts)
- Barrel/index files with low function coverage (re-exports)
- Legacy code paths pending refactoring

### Tier 2: Critical Paths

Critical modules have higher thresholds enforced:

| Module                          | Current | Threshold | Target   |
| ------------------------------- | ------- | --------- | -------- |
| `ui/schemas/types.ts`           | 100%    | 98%       | Maintain |
| `ui/schemas/errors.ts`          | 100%    | 98%       | Maintain |
| `ui/schemas/rollup.schema.ts`   | 93%     | 90%       | 95%      |
| `ui/dataset-loader.ts`          | 83%     | 80%       | 90%      |
| `ui/error-codes.ts`             | 100%    | 98%       | Maintain |
| `ui/error-types.ts`             | 100%    | 98%       | Maintain |
| `ui/modules/ml.ts`              | 78%     | 75%       | 80%      |
| `ui/artifact-client.ts`         | 65%     | 40%       | 70%      |
| `ui/modules/shared/security.ts` | 100%    | 95%       | Maintain |

### Tier 3: Future Critical Paths (Not Yet Enforced)

These modules should be added to coverage thresholds as tests are added:

| Module                     | Current | Next Threshold        |
| -------------------------- | ------- | --------------------- |
| `ui/modules/errors.ts`     | 100%    | 98% (when stabilized) |
| `ui/modules/comparison.ts` | 100%    | 98% (when stabilized) |

## Ratchet Schedule

### Phase 5.1 (Complete)

- [x] Set global baseline thresholds
- [x] Enforce tier 2 thresholds for schemas and loaders
- [x] Create test harnesses (dom-harness, vss-sdk-mock)

### Phase 5.2 (Complete)

- [x] Increased global thresholds to 55/49/51/56
- [x] Added Critical Path thresholds (feature 023-dashboard-coverage):
    - `ui/modules/ml.ts`: 75% minimum
    - `ui/artifact-client.ts`: 40% minimum
    - `ui/modules/shared/security.ts`: 95% minimum

### Phase 5.3

Increase thresholds by 5%:

```javascript
global: {
  statements: 56,
  branches: 51,
  functions: 54,
  lines: 57,
}
```

### Phase 6 (Target)

Final target thresholds:

```javascript
global: {
  statements: 70,
  branches: 65,
  functions: 70,
  lines: 70,
}
```

## Coverage Exclusions

The following are intentionally excluded or have reduced requirements:

1. **Barrel files (index.ts)** - Re-export functions don't need direct testing
2. **Type declarations** - TypeScript types have no runtime code
3. **DOM-heavy entry points** - dashboard.ts, settings.ts require browser integration tests

## Verification Commands

```bash
# Run with coverage report
npm test -- --coverage

# Check specific file coverage
npm test -- --coverage --collectCoverageFrom="ui/dataset-loader.ts"

# Verbose coverage for a module
npm test -- --coverage --collectCoverageFrom="ui/schemas/**/*.ts"
```

## History

| Date       | Phase | Global Statements | Notes                                                                   |
| ---------- | ----- | ----------------- | ----------------------------------------------------------------------- |
| 2026-01-28 | 5.1   | 48%               | Initial tiered thresholds                                               |
| 2026-01-30 | 5.1   | 55%               | Updated global thresholds after test improvements                       |
| 2026-02-03 | 5.2   | 55%               | Added Critical Path thresholds (ml.ts, artifact-client.ts, security.ts) |

---

_This document should be updated with each TypeScript threshold increase._
