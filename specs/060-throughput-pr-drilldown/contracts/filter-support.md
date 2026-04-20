# Contract: Filter Support Predicate

**Scope**: new module `extension/ui/modules/drilldown/filter-support.ts`. Exports a single authoritative predicate consumed by the throughput drill-down render path and by every test that asserts gating behavior.

**Authoritative spec refs**: FR-018, FR-024, FR-026. Data-model: `data-model.md` §3.

## Module contract

### File location

`extension/ui/modules/drilldown/filter-support.ts` — same directory as the existing `comparison-advisory.ts` (which exports `isDrilldownDisabledByComparison`). Naming convention matches the sibling pattern.

### Single authoritative predicate

```typescript
import type { FilterState } from "../filters";

export type FilterClassification =
  | { readonly classification: "comparison" }
  | { readonly classification: "team" }
  | { readonly classification: "reviewer" }
  | { readonly classification: "supported" };

/**
 * Classify the current drill-down filter state under the precedence locked by FR-026:
 *   comparison > team > reviewer > supported.
 *
 * This is the ONE authoritative function. UI render paths, tests, and any future
 * consumer of the same classification MUST import and call this exact function.
 * Reconstructing the precedence from independent boolean checks at a call site is
 * FORBIDDEN by FR-024.
 */
export function classifyFilterState(
  filters: FilterState,
  comparisonActive: boolean,
): FilterClassification;
```

### Behavior

Given a `FilterState` and a `comparisonActive` boolean (sourced from `isDrilldownDisabledByComparison()` at the call site):

1. If `comparisonActive === true` → return `{ classification: "comparison" }`.
2. Else if `filters.teams.length > 0` → return `{ classification: "team" }`.
3. Else if `filters.reviewers.length > 0` → return `{ classification: "reviewer" }`.
4. Else → return `{ classification: "supported" }`.

### Purity

- No side effects.
- No DOM reads.
- No module-level state.
- Testable as a pure function.

### Exhaustiveness

- The four classification values form a sealed union. Any future addition (e.g., a new unsupported dimension) is a breaking change requiring spec revision.
- TypeScript's `never` assertion in the `buildPanelContent` consumer switch will fail to compile if a new classification is added without handling.

## Consumer contract

### `throughput-drilldown.ts:activate`

```typescript
import { classifyFilterState } from "./filter-support";
import { isDrilldownDisabledByComparison } from "./comparison-advisory";

function activate(trigger: HTMLElement): void {
  // ...
  const comparisonActive = isDrilldownDisabledByComparison();
  if (comparisonActive) {
    showComparisonAdvisoryToast(trigger);
    return;   // Phase 1 toast-denial preserved (FR-007a).
  }

  const classification = classifyFilterState(currentFilters, comparisonActive);
  // classification is now one of "team" | "reviewer" | "supported"
  // (comparison is already handled above).

  const context: DrillDownContext = {
    // ...
    content: buildPanelContent(rollup, classification),
  };
  openDetailPanel(context);
}
```

Note: the `comparisonActive` argument is passed to `classifyFilterState` for completeness / test isolation; the active-check branch in `activate` above short-circuits before calling it, but tests exercise the classifier with `comparisonActive=true` to validate precedence.

### `buildPanelContent` consumer

Consumes the `FilterClassification` in the switch statement documented in `contracts/pr-list-section.md`. Does NOT inspect the raw filter state.

## Test contract

### `extension/tests/modules/drilldown/filter-support.test.ts` (new)

Coverage matrix (all 8 non-trivial combinations of comparison × team × reviewer):

| comparisonActive | teams | reviewers | Expected classification |
|---|---|---|---|
| false | [] | [] | `supported` |
| false | [t1] | [] | `team` |
| false | [] | [r1] | `reviewer` |
| false | [t1] | [r1] | `team` (team precedence over reviewer) |
| true  | [] | [] | `comparison` |
| true  | [t1] | [] | `comparison` (precedence over team) |
| true  | [] | [r1] | `comparison` (precedence over reviewer) |
| true  | [t1] | [r1] | `comparison` (precedence over both) |

Plus:
- Author + repo filters active → `supported` (those are supported filters; classifier sees no unsupported dimension).
- Multiple teams `[t1, t2]` → `team` (any team is unsupported).
- Multiple reviewers `[r1, r2]` → `reviewer`.

### Static check — no forked classification (FR-024 / SC-015)

A test under `extension/tests/invariants/` (or equivalent meta-test location) MUST assert that only `filter-support.ts` contains the substring pattern that would indicate filter-classification logic in the throughput-drilldown render path. Suggested implementation:
- Grep `extension/ui/modules/drilldown/throughput-drilldown.ts` for `filters.teams.length` and `filters.reviewers.length` — should return ZERO matches (all such checks live in filter-support.ts only).
- Grep for the literal text `classifyFilterState` — should return at least 2 matches (import + call site).

Rationale: the repo already has an invariant-test precedent (`tests/unit/test_hook_triggers.py`, `test_hook_guards.py`) that uses AST/grep enforcement for single-authority rules. This new test follows the same pattern.

## Non-functional

- Cross-OS: module uses pure TypeScript / ECMAScript; no Node / browser APIs. Cross-OS neutral.
- No `any` types. Sealed union discriminated by `classification`.
- No suppressions required.
- No runtime perf concern — classifier is O(1) on filter lengths.
