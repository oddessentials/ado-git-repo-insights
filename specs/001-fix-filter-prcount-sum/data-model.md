# Data Model: Fix Dashboard Filter PR Count Summation Bug

**Branch**: `001-fix-filter-prcount-sum`
**Date**: 2026-01-31

## Overview

This bug fix does not introduce new data models. It corrects the usage of existing types.

## Existing Types (Reference Only - No Changes)

### BreakdownEntry

**Location**: `extension/ui/schemas/rollup.schema.ts` (lines 37-45)

```typescript
export interface BreakdownEntry {
  pr_count: number;           // Required - the field being extracted
  cycle_time_p50?: number;    // Optional
  cycle_time_p90?: number;    // Optional
  review_time_p50?: number;   // Optional
  review_time_p90?: number;   // Optional
  authors_count?: number;     // Optional
  reviewers_count?: number;   // Optional
}
```

### WeeklyRollup (Relevant Fields)

**Location**: `extension/ui/schemas/rollup.schema.ts` (lines 50-63)

```typescript
export interface WeeklyRollup {
  // ... other fields ...
  by_repository?: Record<string, BreakdownEntry>;  // Map of repo name → BreakdownEntry
  by_team?: Record<string, BreakdownEntry>;        // Map of team name → BreakdownEntry
}
```

## Type Corrections in metrics.ts

### Current (Buggy) Type Usage

```typescript
// Line 150: Type guard incorrectly expects number
.filter((r): r is number => r !== undefined);

// Line 188: Type guard incorrectly expects number
.filter((t): t is number => t !== undefined);
```

### Corrected Type Usage

```typescript
// Line 150: Type guard correctly expects BreakdownEntry
.filter((entry): entry is BreakdownEntry =>
  entry !== undefined && typeof entry?.pr_count === 'number');

// Line 188: Type guard correctly expects BreakdownEntry
.filter((entry): entry is BreakdownEntry =>
  entry !== undefined && typeof entry?.pr_count === 'number');
```

## New Helper Function

### toFiniteNumber

**Location**: `extension/ui/modules/metrics.ts` (new function, before `applyFiltersToRollups`)

```typescript
/**
 * Safely convert any value to a finite number.
 * Returns 0 for undefined, null, NaN, Infinity, or non-numeric values.
 *
 * @param value - Any value to convert
 * @returns A finite number, or 0 if conversion fails
 */
function toFiniteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
```

**Usage in reduce operations**:
```typescript
// Repository filtering
const totalPrCount = selectedRepos.reduce(
  (sum, entry) => sum + toFiniteNumber(entry.pr_count),
  0
);

// Team filtering
const totalPrCount = selectedTeams.reduce(
  (sum, entry) => sum + toFiniteNumber(entry.pr_count),
  0
);
```

## Test Fixture Shape

### Minimum BreakdownEntry for Tests

Per spec (Test Fixture Constraint):

```typescript
// Minimum required shape
{ pr_count: number }

// Example valid fixtures:
{ pr_count: 30 }                              // Minimum
{ pr_count: 30, cycle_time_p50: 60 }          // With optional field
{ pr_count: 0 }                               // Zero count (edge case)
```

### Invalid Shapes (Should Be Handled Gracefully)

```typescript
// These should all result in pr_count being treated as 0:
{}                                            // Missing pr_count
{ pr_count: null }                            // Null value
{ pr_count: undefined }                       // Undefined value
{ pr_count: "50" }                            // String (coerced to 50)
{ pr_count: NaN }                             // NaN (treated as 0)
{ pr_count: Infinity }                        // Infinity (treated as 0)
```

## Type Flow Diagram

```
Rollup.by_repository[repoId]
         │
         ▼
  BreakdownEntry | undefined
         │
         ▼
  .filter(entry is BreakdownEntry)
         │
         ▼
  BreakdownEntry[]
         │
         ▼
  .reduce((sum, entry) => sum + toFiniteNumber(entry.pr_count), 0)
         │
         ▼
      number (finite, safe)
```
