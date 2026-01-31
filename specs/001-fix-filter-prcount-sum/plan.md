# Implementation Plan: Fix Dashboard Filter PR Count Summation Bug

**Branch**: `001-fix-filter-prcount-sum` | **Date**: 2026-01-31 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-fix-filter-prcount-sum/spec.md`

## Summary

Fix a bug in `applyFiltersToRollups()` where `by_repository` and `by_team` breakdown values are incorrectly treated as primitive numbers instead of `BreakdownEntry` objects. This causes string concatenation (`0[object Object]...`) when summing PR counts. The fix extracts `.pr_count` via a canonical `toFiniteNumber()` helper, updates type guards, corrects test fixtures, adds a regression test, and rebuilds the demo bundle.

## Technical Context

**Language/Version**: TypeScript 5.7.3
**Primary Dependencies**: esbuild 0.27.0 (bundler), Jest 30.0.0 (testing), vss-web-extension-sdk 5.141.0
**Storage**: N/A (in-memory data processing)
**Testing**: Jest with ts-jest, jsdom environment
**Target Platform**: Azure DevOps extension (browser-based dashboard)
**Project Type**: Extension UI module (TypeScript → JS bundle)
**Performance Goals**: N/A (bug fix, no performance regression)
**Constraints**: Surface area limited to `extension/ui/modules/metrics.ts` + tests + demo bundle
**Scale/Scope**: Single function fix + 1 helper + test updates

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I-IV CSV Schema | N/A | This fix does not touch CSV generation |
| V SQLite Source | N/A | This fix is in the UI layer, not extraction |
| VI-IX Pipeline | N/A | No pipeline logic changes |
| X-XII Extraction | N/A | No extraction changes |
| XIII Rate Limiting | N/A | No API calls affected |
| XIV-XVI Identity | N/A | No identity/entity changes |
| XVII Cross-Agent | N/A | No agent runtime changes |
| XVIII Actionable Logs | N/A | No logging changes |
| XIX-XX PAT Security | N/A | No auth changes |
| XXI-XXII Storage | N/A | No storage changes |
| XXIII CSV Validation | N/A | No CSV changes |
| XXIV-XXV Testing | ✅ APPLIES | Must add regression test (FR-008) |

**Gate Status**: ✅ PASS - Only XXIV-XXV applies; regression test is required per spec.

## Project Structure

### Documentation (this feature)

```text
specs/001-fix-filter-prcount-sum/
├── spec.md              # Feature specification (complete)
├── plan.md              # This file
├── research.md          # Phase 0 output (minimal - no unknowns)
├── data-model.md        # Phase 1 output (type updates)
├── quickstart.md        # Phase 1 output (verification steps)
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
extension/
├── ui/
│   ├── modules/
│   │   └── metrics.ts        # FIX: applyFiltersToRollups() + toFiniteNumber()
│   └── schemas/
│       └── rollup.schema.ts  # REFERENCE ONLY: BreakdownEntry interface (no changes)
├── tests/
│   └── modules/
│       └── metrics.test.ts   # UPDATE: fixtures + regression test
└── dist/
    └── ui/
        └── dashboard.js      # REBUILD: bundle output

docs/
└── dashboard.js              # REBUILD: demo bundle (git diff verification)
```

**Structure Decision**: Existing extension structure. Changes confined to `metrics.ts`, `metrics.test.ts`, and bundle outputs.

## Complexity Tracking

No violations. This is a minimal, focused bug fix within existing architecture.

---

## Phase 0: Research

### Research Summary

No significant unknowns. The fix is well-defined by the spec:

1. **Data structure**: `BreakdownEntry` interface already defined in `rollup.schema.ts` (lines 37-45)
2. **Bug location**: `applyFiltersToRollups()` in `metrics.ts` (lines 140-202)
3. **Test location**: `metrics.test.ts` (lines 137-189)
4. **Build process**: `pnpm run build:ui` generates bundles

### Decisions

| Decision | Rationale | Alternatives Rejected |
|----------|-----------|----------------------|
| Add `toFiniteNumber()` in same file | Spec constraint (FR-005, Helper Location Constraint) | Separate utility file - rejected per spec |
| Update type guards inline | Minimal change, spec requires type-level enforcement | Runtime-only guards - rejected per spec |
| Regression test in same file | Spec allows `extension/tests/**`, keeps related tests together | Separate regression file - unnecessary complexity |

---

## Phase 1: Design

### Data Model Updates

**File**: `extension/ui/modules/metrics.ts`

The `Rollup` type imported from `dataset-loader.ts` should already reflect `BreakdownEntry` for `by_repository`/`by_team`. No schema file changes needed per spec constraint.

**Type Guard Fix** (lines 150, 188):
- Current: `.filter((r): r is number => r !== undefined)`
- Fixed: `.filter((entry): entry is BreakdownEntry => entry !== undefined && typeof entry?.pr_count === 'number')`

**Helper Addition**:
```typescript
/**
 * Safely convert any value to a finite number.
 * Returns 0 for undefined, null, NaN, Infinity, or non-numeric values.
 */
function toFiniteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
```

### Contract Changes

No API contract changes. This is an internal function fix.

### Test Fixture Updates

**File**: `extension/tests/modules/metrics.test.ts`

Current fixture (lines 145-152):
```typescript
by_repository: {
  "repo-a": 30,  // WRONG: primitive number
  "repo-b": 70,
},
by_team: {
  "team-x": 40,  // WRONG: primitive number
  "team-y": 60,
},
```

Fixed fixture:
```typescript
by_repository: {
  "repo-a": { pr_count: 30 },  // CORRECT: BreakdownEntry
  "repo-b": { pr_count: 70 },
},
by_team: {
  "team-x": { pr_count: 40 },  // CORRECT: BreakdownEntry
  "team-y": { pr_count: 60 },
},
```

### Regression Test

New test case (separate `describe` block per spec):
```typescript
describe("applyFiltersToRollups regression: object concatenation bug", () => {
  it("returns finite number, not [object Object] string, when filtering", () => {
    const rollup = {
      week: "2026-W01",
      pr_count: 100,
      by_repository: {
        "repo-a": { pr_count: 30 },
      },
    } as Rollup;

    const result = applyFiltersToRollups([rollup], { repos: ["repo-a"], teams: [] });

    expect(typeof result[0].pr_count).toBe("number");
    expect(Number.isFinite(result[0].pr_count)).toBe(true);
    expect(String(result[0].pr_count)).not.toContain("[object");
    expect(String(result[0].pr_count)).not.toContain("Object");
  });
});
```

---

## Quickstart: Verification Steps

### 1. Run existing tests (should fail before fix)
```bash
cd extension
pnpm test:unit -- --testPathPattern=metrics.test
```

### 2. Apply fix to metrics.ts

### 3. Update test fixtures

### 4. Run tests (should pass after fix)
```bash
pnpm test:unit -- --testPathPattern=metrics.test
```

### 5. Verify TypeScript compilation
```bash
pnpm run build:check
```

### 6. Rebuild demo bundle
```bash
pnpm run build:ui
```

### 7. Verify bundle changed
```bash
git diff docs/dashboard.js | head -20
```

### 8. Run full test suite
```bash
pnpm test:ci
```

---

## Post-Design Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| XXIV End-to-End Testability | ✅ | Regression test added per FR-008 |
| XXV Backfill Mode Testing | N/A | Not applicable to UI bug fix |

**Gate Status**: ✅ PASS - All applicable principles satisfied.
