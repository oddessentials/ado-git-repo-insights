# Research: Fix Dashboard Filter PR Count Summation Bug

**Branch**: `001-fix-filter-prcount-sum`
**Date**: 2026-01-31

## Summary

This bug fix has no significant unknowns requiring research. All technical decisions are dictated by the spec constraints and existing codebase patterns.

## Findings

### 1. BreakdownEntry Interface Location

**Decision**: Use existing `BreakdownEntry` from `extension/ui/schemas/rollup.schema.ts`

**Rationale**: The interface is already defined and properly typed:
```typescript
export interface BreakdownEntry {
  pr_count: number;
  cycle_time_p50?: number;
  cycle_time_p90?: number;
  review_time_p50?: number;
  review_time_p90?: number;
  authors_count?: number;
  reviewers_count?: number;
}
```

**Alternatives Considered**: None - using the existing canonical definition.

### 2. toFiniteNumber() Implementation

**Decision**: Implement per spec FR-005 in `metrics.ts`

**Rationale**: The spec explicitly defines the implementation:
- Rule: `const n = Number(value); return Number.isFinite(n) ? n : 0`
- Location: Same file as `applyFiltersToRollups()` per Helper Location Constraint

**Alternatives Considered**:
- Separate utility file - rejected per spec constraint
- Inline lambda - rejected for reusability and clarity

### 3. Type Guard Approach

**Decision**: Replace `r is number` guards with `entry is BreakdownEntry` guards

**Rationale**: Spec requires type-level enforcement (FR-006, Type Safety Constraint). The compiler must fail if number assumptions are reintroduced.

**Alternatives Considered**:
- Runtime-only checks - rejected per spec (must be type-level)
- Generic type parameter - unnecessary complexity

### 4. Test Structure

**Decision**: Update fixtures in existing test file, add regression test as separate `describe` block

**Rationale**:
- Spec allows changes in `extension/tests/**` (Surface Area Constraint)
- Spec requires regression test to be separate from "correct sum" tests (Test Isolation Constraint)

**Alternatives Considered**:
- New test file - unnecessary, keeps related tests together
- Inline within existing describe - violates Test Isolation Constraint

### 5. Demo Bundle Verification

**Decision**: Use `git diff docs/dashboard.js` for verification

**Rationale**: Spec explicitly requires this approach (SC-006) - no hash checks, deterministic content diff.

**Alternatives Considered**:
- Hash comparison - rejected per spec (brittle across toolchains)
- Manual inspection - not automatable

## No Further Research Required

All technical decisions are fully specified. Proceed to implementation.
