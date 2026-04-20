/**
 * Filter-support classification (feature 060, FR-024 / FR-026).
 *
 * Single authoritative predicate for drill-down filter gating. The throughput
 * drill-down render path and every gating test MUST import and call this
 * exact function; reconstructing the precedence from independent boolean
 * checks at a call site is FORBIDDEN and locked by the static-authority
 * invariant test under `extension/tests/invariants/`.
 *
 * Precedence (locked by FR-026): comparison > team > reviewer > supported.
 *
 * The `"comparison"` branch is redundantly modeled here — the upstream
 * `throughput-drilldown.ts:activate` call site short-circuits on
 * `isDrilldownDisabledByComparison()` before invoking the classifier — but
 * tests exercise the classifier with `comparisonActive=true` to prove the
 * precedence, and future non-activate consumers benefit from uniform gating.
 */

import type { FilterState } from "../filters";

export type FilterClassification =
  | { readonly classification: "comparison" }
  | { readonly classification: "team" }
  | { readonly classification: "reviewer" }
  | { readonly classification: "supported" };

/**
 * Non-comparison subset of `FilterClassification`. Call sites that have
 * already short-circuited comparison upstream use this narrowed type to
 * avoid handling the unreachable "comparison" branch.
 */
export type NonComparisonFilterClassification = {
  readonly classification: "team" | "reviewer" | "supported";
};

/**
 * Classify the current drill-down filter state under FR-026 precedence.
 *
 * Pure function: no side effects, no DOM reads, no module-level state.
 *
 * Overload: passing `false` for `comparisonActive` narrows the return type
 * so the caller does not need to handle the unreachable "comparison"
 * branch (which would otherwise register as a partial-branch on the
 * coverage ratchet).
 *
 * @param filters Current filter state snapshot (repos / teams / reviewers / authors).
 * @param comparisonActive Whether comparison mode is active — callers source
 *   this from `isDrilldownDisabledByComparison()`.
 * @returns A sealed-union `FilterClassification` value.
 */
export function classifyFilterState(
  filters: FilterState,
  comparisonActive: false,
): NonComparisonFilterClassification;
export function classifyFilterState(
  filters: FilterState,
  comparisonActive: boolean,
): FilterClassification;
export function classifyFilterState(
  filters: FilterState,
  comparisonActive: boolean,
): FilterClassification {
  if (comparisonActive) {
    return { classification: "comparison" };
  }
  if (filters.teams.length > 0) {
    return { classification: "team" };
  }
  if (filters.reviewers.length > 0) {
    return { classification: "reviewer" };
  }
  return { classification: "supported" };
}
