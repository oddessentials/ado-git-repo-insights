# Plan: Fix Schema Validator Contract Mismatch for Nullable Cycle-Time Fields

## Problem

The backend aggregator (`aggregators.py`) emits `null` for `cycle_time_p50`/`cycle_time_p90` when
sample sizes are below thresholds (2 for rollups/breakdowns, 5 for cross-dim). The frontend schema
validator (`rollup.schema.ts`) rejects these nulls because:

1. The optional-field guard checks `fieldValue !== undefined` but not `fieldValue !== null`
2. `validateNumber(null)` fails since `typeof null === "object"`
3. This throws `SchemaValidationError`, breaking `getWeeklyRollups()` entirely

The normalization layer and all chart/metric consumers already handle null correctly — the validator
is the single point of failure.

## Changes

### 1. Fix validator null guard — `extension/ui/schemas/rollup.schema.ts`

**In `validateRollup()`** (line 289): Change `fieldValue !== undefined` to `fieldValue != null`
(loose equality catches both null and undefined):

```typescript
// BEFORE
if (fieldValue !== undefined) {

// AFTER — null is valid for nullable metric fields (cycle_time, review_time)
if (fieldValue != null) {
```

**In `validateBreakdownEntry()`** (line 136): Same fix for breakdown entry cycle-time validation.

### 2. Fix `BreakdownEntry` type — `extension/ui/schemas/rollup.schema.ts`

Update the interface so cycle-time and review-time fields accept `null` (matching backend contract):

```typescript
// BEFORE
cycle_time_p50?: number;
cycle_time_p90?: number;
review_time_p50?: number;
review_time_p90?: number;

// AFTER
cycle_time_p50?: number | null;
cycle_time_p90?: number | null;
review_time_p50?: number | null;
review_time_p90?: number | null;
```

### 3. Update type test — `extension/tests/types/rollup.type-test.ts`

Lines 74-77 currently assert `number | undefined`. Must update to `number | null | undefined`:

```typescript
// BEFORE
const _cycleP50: number | undefined = entry.cycle_time_p50;

// AFTER
const _cycleP50: number | null | undefined = entry.cycle_time_p50;
```

Same for `_cycleP90`, `_reviewP50`, `_reviewP90`.

### 4. Add validation tests — `extension/tests/schema/rollup.test.ts`

| Test | What it verifies |
|------|-----------------|
| null cycle-time at root level passes validation | `{cycle_time_p50: null, cycle_time_p90: null}` passes `validateRollup()` |
| null cycle-time in breakdown entry passes validation | breakdown with `{cycle_time_p50: null}` passes `validateBreakdownEntry()` |
| mixed null/numeric in same rollup passes validation | `{cycle_time_p50: null, cycle_time_p90: 720.0}` passes validation |

### 5. `dashboard.js` — No manual changes needed

`dashboard.js` is a build artifact regenerated from TypeScript sources by the pre-commit hook
(`scripts/bundle-ui.mjs`). Fixing `rollup.schema.ts` is sufficient; the bundle will be rebuilt
automatically on commit.

## Files Modified

| File | Action |
|------|--------|
| `extension/ui/schemas/rollup.schema.ts` | Fix null guard in 2 validators + update BreakdownEntry type |
| `extension/tests/types/rollup.type-test.ts` | Update 4 type assertions for nullable fields |
| `extension/tests/schema/rollup.test.ts` | Add 3 validation tests |

## Out of Scope

- `metrics.ts:452` `|| 0` vs `?? 0` — Low impact, cosmetic. Separate PR if desired.
- Backend changes — Backend behavior is correct (null for insufficient samples).
- JSON fixture files — Inline test data is sufficient for coverage.
- `_fetchWeekWithRetry` skipping validation — Pre-existing inconsistency, not introduced by this fix.
- Dual `normalizeRollup` functions — Pre-existing duplication, out of scope.

## Verification

1. `cd extension && npx tsc --noEmit` — clean
2. `cd extension && npx jest` — all pass including new tests
3. `cd src && python -m pytest tests/ -q` — no Python regressions
4. Targeted: `{cycle_time_p50: null}` passes both `validateRollup()` and `validateBreakdownEntry()`
