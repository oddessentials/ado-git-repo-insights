# Semantic Error Triage: 042-test-strict-alignment

**Date**: 2026-03-28
**Total semantic errors (TS2345, TS2322, TS2769, TS2488)**: 60
**Verdict**: All 60 are mechanical fixes — no genuine contract violations found.

## Triage by Pattern

### Pattern 1: Mock fetch signature narrower than production (12 errors)

**Error**: `(url: string) => Promise<Response>` not assignable to `(input: string | URL | Request, init?: RequestInit) => Promise<Response>`

**Files**:
- `tests/version-adapter-integration.test.ts` lines 50, 181, 227, 323
- `tests/local-mode-integration.test.ts` line 59
- `tests/harness/dom-harness.ts` line 212
- `tests/harness/vss-sdk-mock.ts` lines 363, 510
- `tests/harness/vss-sdk-mock.test.ts` lines 230, 245

**Root cause**: Mock fetch accepts `(url: string)` but the real `fetch` accepts `(input: string | URL | Request, init?)`. Under `strict: false`, TypeScript allows this covariant mismatch. Under `strict: true`, `strictFunctionTypes` rejects it.

**Resolution**: Widen mock parameter to `(input: string | URL | Request, init?: RequestInit)` or use the full `typeof fetch` signature. **Mechanical** — no contract violation. The mocks only use the string URL in practice.

### Pattern 2: Jest 30 Mock<specific> → Mock<UnknownFunction> (6 errors)

**Error**: `Mock<(key: string) => Promise<...>>` not assignable to `Mock<UnknownFunction>`

**Files**:
- `tests/harness/vss-sdk-mock.ts` lines 128, 131, 135, 138, 142, 146

**Root cause**: The mock factory assigns specifically-typed mocks to properties typed as `Mock<UnknownFunction>`. Under strict mode, the narrower function signature is not assignable to the broader one.

**Resolution**: Type the mock properties with their specific signatures instead of `Mock<UnknownFunction>`, or use `as Mock<UnknownFunction>` at the assignment site. **Mechanical** — the mock interface just needs correct generic parameters.

### Pattern 3: `string[]` assigned to `never[]` (9 errors)

**Error**: `Type 'string[]' is not assignable to type 'never[]'`

**Files**:
- `tests/dashboard.test.ts` lines 2540, 2574, 2595, 2598, 2613, 2649, 2652, 2672, 2675

**Root cause**: Variables declared as empty arrays `[]` infer as `never[]` under strict mode (instead of `any[]`). Later assignment of `string[]` fails.

**Resolution**: Add explicit type annotation: `const arr: string[] = []`. **Mechanical** — no contract violation. The test logic is correct.

### Pattern 4: `HTMLElement | null/undefined` → `HTMLElement` (13 errors)

**Error**: Argument of type `HTMLElement | null` or `HTMLElement | undefined` not assignable to parameter of type `HTMLElement`

**Files**:
- `tests/dashboard.test.ts` lines 1320, 1338, 1357
- `tests/e2e/dashboard-render.test.ts` lines 116-119, 149-152, 176-177

**Root cause**: DOM queries return `HTMLElement | null` (getElementById) or `HTMLElement | undefined` (Map.get). Functions receiving these expect non-nullable.

**Resolution**: Add non-null assertion (`!`) where the test setup guarantees the element exists, or add a guard. **Mechanical** — test setup creates these elements.

### Pattern 5: `string | undefined` → `string` (7 errors)

**Error**: Argument of type `string | undefined` not assignable to parameter of type `string`

**Files**:
- `tests/meta/data-testid-validation.test.ts` line 96
- `tests/meta/ec-traceability.test.ts` lines 64, 65, 67
- `tests/version-adapter-integration.test.ts` line 68
- `tests/vsix-artifact-inspection.test.ts` line 34
- `tests/vsix-packaging.test.ts` line 100

**Root cause**: Array access, object property access, or Map.get returns `T | undefined`. Under strict mode, this can't be passed directly to a `string` parameter.

**Resolution**: Add non-null assertion or guard. **Mechanical** — test logic guarantees the value exists.

### Pattern 6: Null/undefined in test data (3 errors)

**Files**:
- `tests/dashboard.test.ts` lines 822 (`null` → `any[]`), 823 (`undefined` → `any[]`), 3236 (`null` → `number`)

**Root cause**: Tests intentionally pass null/undefined to test error handling. Under strict, these are type errors.

**Resolution**: Add type assertion `as unknown as any[]` for intentional-error tests, or type the variable explicitly. **Mechanical** — tests are deliberately testing boundary behavior.

### Pattern 7: Union type narrowing for test fixtures (4 errors)

**Files**:
- `tests/modules/metrics.edge-cases.test.ts` lines 277, 287
- `tests/python-integration/synthetic-fixtures.test.ts` lines 350, 419, 426

**Root cause**: Test data unions include optional properties that create `undefined` members. `FixtureRollup | null` not assignable to `Rollup`.

**Resolution**: Add type assertions or narrow with guards. **Mechanical** — fixture data is valid at runtime.

### Pattern 8: No overload matches (4 errors)

**Files**:
- `tests/python-integration/synthetic-fixtures.test.ts` lines 329, 335
- `tests/schema/parity.test.ts` lines 251, 254

**Root cause**: Function overloads don't match the argument types when strictness is enabled (typically because an argument is `T | undefined` where the overload expects `T`).

**Resolution**: Narrow argument type before the call. **Mechanical**.

### Pattern 9: Iterator on possibly undefined (2 errors)

**Files**:
- `tests/python-integration/synthetic-fixtures.test.ts` lines 339, 343

**Root cause**: Destructuring a value that might be `undefined` (`[key, value] = arr.find(...)` where find can return undefined).

**Resolution**: Add guard or non-null assertion. **Mechanical**.

### Pattern 10: Isolated type assignments (1 error)

**Files**:
- `tests/dataset-loader.test.ts` line 22 (`unknown` → `ManifestSchema | null`)

**Root cause**: Variable typed as `unknown` assigned to a specific type.

**Resolution**: Add type assertion. **Mechanical**.

## Summary

| Pattern | Count | Verdict | Fix |
|---------|------:|---------|-----|
| Mock fetch signature | 12 | Mechanical | Widen mock parameter type |
| Jest Mock generic | 6 | Mechanical | Use specific mock type |
| `never[]` inference | 9 | Mechanical | Add explicit array type |
| Nullable DOM element | 13 | Mechanical | Non-null assertion |
| `string \| undefined` | 7 | Mechanical | Non-null assertion or guard |
| Intentional null test data | 3 | Mechanical | Type assertion |
| Union type narrowing | 4 | Mechanical | Type assertion or guard |
| No overload matches | 4 | Mechanical | Narrow before call |
| Iterator on undefined | 2 | Mechanical | Guard or assertion |
| Isolated assignment | 1 | Mechanical | Type assertion |
| **Total** | **60** | **All mechanical** | |

**No genuine contract violations found.** All 60 errors are caused by TypeScript's stricter type checking catching covariant/nullable mismatches that were silently allowed under `strict: false`. None indicate the test is exercising the wrong interface or the production code has a wrong contract. All fixes are type annotations, assertions, or signature widening — no test logic changes needed.
