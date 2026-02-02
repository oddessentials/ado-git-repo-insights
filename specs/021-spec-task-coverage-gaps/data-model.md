# Data Model: Spec-Task Coverage Gap Resolution

**Feature**: 021-spec-task-coverage-gaps
**Date**: 2026-02-01

## Overview

This feature adds testing infrastructure, not new data entities. The data model documents:
1. Existing entities used as test targets
2. Test fixture schemas
3. Test artifact output formats

## Existing Entities (Test Targets)

### BreakdownEntry

**Source**: `extension/ui/schemas/rollup.schema.ts`
**Role**: Primary type test target

```typescript
interface BreakdownEntry {
  pr_count: number;
  avg_cycle_time?: number;
  // Additional optional fields
}
```

**Type Test Coverage**:
- Positive: Accessing `pr_count` from `BreakdownEntry` compiles
- Negative: Treating `BreakdownEntry` as `number` fails

### Rollup

**Source**: `extension/ui/schemas/rollup.schema.ts`
**Role**: Container type test target

```typescript
interface Rollup {
  by_repository: Record<string, BreakdownEntry>;
  by_team: Record<string, BreakdownEntry>;
  totals: {
    pr_count: number;
    // ...
  };
  // ...
}
```

**Type Test Coverage**:
- Positive: `rollup.by_repository['key'].pr_count` compiles
- Negative: `rollup.by_repository['key']` directly as `number` fails

## Test Fixture Schemas

### Smoke Test Fixture

**Path**: `docs/data/rollup.json`
**Minimum Required Schema** (FR-006):

```typescript
interface SmokeFixture {
  weekly_rollups: Array<{
    by_repository: Record<string, { pr_count: number }>;
    by_team: Record<string, { pr_count: number }>;
  }>;
}
```

**Example**:
```json
{
  "weekly_rollups": [
    {
      "by_repository": {
        "repo-a": { "pr_count": 30 },
        "repo-b": { "pr_count": 70 }
      },
      "by_team": {
        "team-x": { "pr_count": 40 },
        "team-y": { "pr_count": 60 }
      }
    }
  ]
}
```

### Edge Case Test Fixtures

**Location**: Inline in `metrics.edge-cases.test.ts`
**Schema**: Minimal `BreakdownEntry`-like objects

| EC ID | Fixture | Expected Result |
|-------|---------|-----------------|
| EC-001 | `{ pr_count: NaN }` | 0 |
| EC-002 | `{ pr_count: "50" }` | 50 |
| EC-003 | `{ pr_count: Infinity }` | 0 |
| EC-004 | `{ pr_count: -Infinity }` | 0 |
| EC-005 | Mixed array | 30 (sum of valid) |

**EC-005 Fixture Detail**:
```typescript
const mixed = {
  'a': { pr_count: 10 },      // Valid: 10
  'b': { pr_count: NaN },     // Invalid: 0
  'c': { pr_count: "20" },    // Coerced: 20
  'd': { pr_count: Infinity } // Invalid: 0
};
// Expected sum: 30
```

## Test Artifact Outputs

### Screenshot Artifacts

**Directory**: `extension/test-artifacts/smoke/`
**Naming**: `<test-name>-<timestamp>.png`
**Retention**: Git-ignored locally, uploaded as CI artifacts

**Content**:
- Full page screenshot of demo dashboard
- Captured on BOTH pass and fail
- Shows Total PRs value after filter applied

### Type Test Output

**Command**: `pnpm run test:types`
**Output**: tsc stderr/stdout

**Pass**:
```
(no output, exit code 0)
```

**Fail (regression)**:
```
tests/types/rollup.type-test.ts:15:3 - error TS2578: Unused '@ts-expect-error' directive.
```

**Fail (positive test broken)**:
```
tests/types/rollup.type-test.ts:8:23 - error TS2339: Property 'pr_count' does not exist on type 'number'.
```

## Entity Relationships

```
┌─────────────────────────────────────────────────────────────┐
│                    Test Infrastructure                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐     targets     ┌───────────────────┐     │
│  │ Type Tests   │ ───────────────▶│ BreakdownEntry    │     │
│  │ (.type-test) │                 │ Rollup            │     │
│  └──────────────┘                 └───────────────────┘     │
│                                            ▲                 │
│  ┌──────────────┐     validates           │                 │
│  │ Edge Case    │ ────────────────────────┘                 │
│  │ Tests (EC-*) │     (toFiniteNumber behavior)             │
│  └──────────────┘                                           │
│                                                              │
│  ┌──────────────┐     reads       ┌───────────────────┐     │
│  │ Smoke Test   │ ───────────────▶│ Fixture JSON      │     │
│  │ (Playwright) │                 │ (docs/data/)      │     │
│  └──────────────┘                 └───────────────────┘     │
│         │                                                    │
│         │ produces                                           │
│         ▼                                                    │
│  ┌──────────────┐                                           │
│  │ Screenshots  │                                           │
│  │ (artifacts)  │                                           │
│  └──────────────┘                                           │
│                                                              │
│  ┌──────────────┐     scans       ┌───────────────────┐     │
│  │ Meta Test    │ ───────────────▶│ Edge Case Tests   │     │
│  │ (traceability)                 │ (EC-### comments) │     │
│  └──────────────┘                 └───────────────────┘     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Validation Rules

### Type Test Validation
- Exit code 0 = all tests pass
- Exit code non-zero = regression or error
- TS2578 = `@ts-expect-error` unused (type regression)

### Fixture Validation
- Must exist before test runs
- Must have `weekly_rollups` array
- First rollup must have `by_repository` and `by_team`
- Each entry must have `pr_count` field

### EC Traceability Validation
- Each EC-001..EC-005 must appear exactly once
- Missing ID = test gap = merge blocked
- Duplicate ID = test overlap = merge blocked

## State Transitions

Not applicable. This feature adds stateless test infrastructure.
