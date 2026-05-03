# Research: Reviewer-Activity Chart PR-Level Detail

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)
**Phase**: 0 (research) — verifying every assumption that informs the plan and the spec, against live code at HEAD.

## Approach

Unlike #361 which reduces to "is the existing throughput drill-down's machinery reusable as-is", this slice carries a producer-side change locked at `/speckit.clarify` Q1 (Option A) and Q2 (cap = 500). Phase 0 verifies the producer-side hooks where the new emission lands AND the consumer-side primitives that flow unchanged from #361.

No `[NEEDS CLARIFICATION]` markers remain in the spec; nothing here is a deferred decision.

## R1 — Throughput + cycle-time drill-down's PR list flow is the reusable model

**Decision**: Mirror throughput's classification → state-mapping → render pipeline on the reviewer surface, with one structural divergence: the `classifyFilterState` predicate is invoked against a reviewer-stripped copy of the filter state (`{...filters, reviewers: []}`) per FR-008. Three reachable content states (`pr-list`, `supported-empty`, `team-inline`) — the `reviewer-inline` content state is unreachable on this surface by construction.

**Evidence**:

- `extension/ui/modules/drilldown/throughput-drilldown.ts:119-184` — `buildPrListSection(rollup, options)` calls `classifyFilterState(filters, false)` then switches on `classification`. Verified directly during plan drafting.
- `extension/ui/modules/drilldown/cycle-time-drilldown.ts:107-156` — paint-by-numbers reuse of throughput's flow on the cycle-time surface (just shipped via PR #365).
- `extension/ui/modules/shared/detail-panel.ts:144-282` — `PrListSection` is a discriminated union (`PrListSectionWithRows` | `PrListSectionMessage`); `makePrListSection` is the single factory for both branches.
- `extension/ui/modules/drilldown/filter-support.ts:51-73` — `classifyFilterState` with the narrowed-return overload at `:51-54` (`comparisonActive: false` → `NonComparisonFilterClassification`).

**Rationale**: the 3-of-4-state union is regression-locked across multiple consumer surfaces (throughput, cycle-time, comments-trend) and is exhaustively tested by the existing `pr-list-*.test.ts` suite. Reusing it means reviewer drill-down inherits all of that behavior without duplicating the union, the factory, or the renderer. The reviewer-stripping wrapper is a single call-site adaptation, not a new classifier.

**Alternatives considered**:

- _Reviewer-specific PR list union with an "any-reviewer" content state_: rejected — duplicates a regression-locked contract; the user-visible behavior is identical to the existing `pr-list` state once the reviewer is locked into the scope.
- _New `classifyReviewerOverlay` predicate_: rejected — introduces a parallel classifier that violates the static-authority invariant ("each gate defined exactly once and invoked by name") at QG-49. The reviewer-stripping wrapper at the call site is the minimum-surface-area adaptation.

## R2 — Reviewer aggregator's existing emission shape and source data

**Decision**: Extend `_generate_reviewer_slice` (`src/ado_git_repo_insights/transform/aggregators.py:2139-2201`) with a per-(reviewer, week) `prs[]` emission. The data needed is already present in the existing `reviewer_prs` merged frame; no new SQL query, no new database read.

**Evidence**:

- `aggregators.py:2157-2163` — existing `reviewer_prs = week_reviewers.merge(week_group[...])` joins the per-PR reviewer rows (with `vote`) against the per-PR identifier rows.
- `aggregators.py:2170` — existing `reviewer_prs.groupby("reviewer_id")` already iterates the per-(reviewer) slice that the new emission needs.
- `aggregators.py:2177-2179` — existing `outcome_group = reviewer_group[reviewer_group["vote"].notna() & (reviewer_group["vote"] != 0)]` already filters to the cast-vote subset; this is the FR-016 "scope" semantic ("PRs where the reviewer cast a non-zero vote").
- `aggregators.py:2181-2189` — existing `outcome_group["pull_request_uid"]` collects the PR identifiers; the new emission needs the same `pull_request_uid` list, joined back to the per-PR fields (id, title, author_id, repository_id, cycle_time, +3 capability-310 fields).
- `aggregators.py:84` — existing `_PR_DETAIL_CAP = 500` constant (the production cap for the per-week `prs[]` array). The new alias `_PR_DETAIL_CAP_PER_REVIEWER_WEEK = _PR_DETAIL_CAP` lives next to this declaration.
- `aggregators.py:850-872` — existing per-week `prs[]` sort + truncate logic (sort by `(-cycle_time_minutes, pull_request_id)`, head to `_PR_DETAIL_CAP`). The new per-(reviewer, week) emission applies the same sort + truncate pattern to the reviewer's filtered-by-vote subset.

**Rationale**: every primitive the new producer emission requires is already loaded into pandas memory by `_generate_reviewer_slice`. The work is ~20 lines of slice + sort + truncate + emit, not a new query path.

**Alternatives considered**:

- _Compute `prs[]` in a separate aggregator pass_: rejected — re-runs the same `reviewer_prs.groupby` in a duplicate context; wastes pandas memory and breaks the "one merge, one groupby" pattern.
- _Reuse the per-week `prs[]` from the rollup root by filtering at consume-time_: rejected — that's Option B, which `/speckit.clarify` explicitly excluded. The per-(reviewer, week) emission is the locked contract.

## R3 — Strip helper's current scope is rollup-root-only

**Decision**: Extend `scripts/strip_pr_arrays.py` `_strip_one` (currently at `:85-96`) and `_verify_clean` (currently at `:99-102`) to walk into `payload["by_reviewer"][*]` and pop the same `PR_LEVEL_FIELDS` from each reviewer entry. This is the "smallest possible extension" the user's CL-01 guardrail #4 anticipated.

**Evidence**:

- Direct read of `scripts/strip_pr_arrays.py:85-96` confirms `_strip_one` only walks the rollup ROOT — it pops `prs` / `_prs_truncated` / `_prs_cap` only at depth 0:
    ```python
    for key in PR_LEVEL_FIELDS:
        if key in payload:  # ← payload is the rollup root dict
            payload.pop(key, None)
    ```
- Direct read of `scripts/strip_pr_arrays.py:99-102` confirms `_verify_clean` is symmetric: it only checks rollup-root keys.
- The new per-(reviewer, week) sub-array lives at `payload["by_reviewer"][reviewer_id]["prs"]` — depth 2 nesting. The existing helper would NOT remove it. Without FR-028's extension, demo/public artifacts would leak per-(reviewer, week) PR detail.

**Rationale**: the strip helper IS the FR-023 enforcement mechanism. Failing to extend it would silently break the privacy posture for the new emission. The user's CL-01 guardrail #4 ("verify demo/public stripping walks this nested `prs` shape; if not, add the smallest strip-helper extension") was prescient — the verification confirms the extension is needed, and FR-028 makes the extension + its test mandatory.

**Smallest-possible extension** (sketch — exact code lands in implementation):

```python
def _strip_one(path: Path, fields_removed: dict[str, int]) -> bool:
    payload = _load_rollup(path)
    modified = False
    for key in PR_LEVEL_FIELDS:
        if key in payload:
            payload.pop(key, None)
            fields_removed[key] += 1
            modified = True
    # NEW: walk into by_reviewer[*]
    by_reviewer = payload.get("by_reviewer")
    if isinstance(by_reviewer, dict):
        for entry in by_reviewer.values():
            if not isinstance(entry, dict):
                continue
            for key in PR_LEVEL_FIELDS:
                if key in entry:
                    entry.pop(key, None)
                    fields_removed[key] += 1
                    modified = True
    if modified:
        _write_rollup(path, payload)
    return modified
```

Plus the symmetric extension in `_verify_clean`. The `PR_LEVEL_FIELDS` constant at `:26-27` is reused unchanged — the same three field names cover both depth-0 and depth-2 emission sites because the contract is name-based, not depth-based.

**Alternatives considered**:

- _Generic recursive walker_: rejected as over-engineering. The producer emits `prs` at exactly two well-known sites (rollup root from feature 060; per-(reviewer, week) under `by_reviewer[*]` from this feature). A targeted two-site visitor is more auditable than a recursive walker.
- _New top-level field at the rollup root mirroring `by_reviewer._.prs` for stripping convenience\*: rejected — the producer would have to maintain both, and the consumer would have to choose one source of truth. Single-emission-site is the cleaner contract.

## R4 — 310 spread-guard's current ALLOWED_MODULES is a 2-entry allowlist

**Decision**: Add `"reviewer-drilldown.ts"` to the `ALLOWED_MODULES` Set in `extension/tests/modules/drilldown/pr-list-comments-spread-guard.test.ts` (verified at HEAD `:32-47`). Single Set-entry edit + a paragraph comment matching the existing 361 entry's pattern.

**Evidence**:

- Direct read of `pr-list-comments-spread-guard.test.ts:32-47` confirms current allowlist:
    ```typescript
    const ALLOWED_MODULES: ReadonlySet<string> = new Set([
        "throughput-drilldown.ts", // 310 original surface
        "cycle-time-drilldown.ts", // 361 authorized scope expansion
    ]);
    ```
- The forbidden-identifiers list at `:61-71` (camelCase + snake_case for `threadCount`, `commentCount`, `activeThreadCount` + the `commentsMetricsAvailable` truthy-set pattern) MUST stay unchanged — the reviewer drill-down consumes the capability flag via the same `loader?.getCapabilityState?.()?.commentsMetricsAvailable ?? false` pattern, which IS a truthy assignment to `commentsMetricsAvailable`.

**Rationale**: per FR-027, the reviewer drill-down's PR list section consumes the comments-metrics capability through the existing `PrListRow` extension (capability-on rows include `threadCount` / `commentCount` / `activeThreadCount`). Without the allowlist entry, the spread-guard test fails on every commit that adds reviewer-drilldown.ts code referencing those identifiers. Adding the entry IS the authorized scope expansion.

**Alternatives considered**:

- _Refactor the comments-metrics consumption into a shared helper outside the drilldown directory_: rejected — would introduce an indirection layer that the spread-guard's directory-scoped scan cannot police. The shared `PrListSection` discriminator is already in `extension/ui/modules/shared/detail-panel.ts`, which is intentionally out of scope for the spread-guard (per the `:51-54` comment "shared modules are intentionally out of scope because they are the capability-aware consumers").
- _Suppress the spread-guard's check on reviewer-drilldown.ts via a per-file ignore_: rejected — that's a suppression, which violates QG-41 (zero suppressions).

## R5 — Reviewer chart click hooks are sufficient as-is

**Decision**: No change to `extension/ui/modules/charts/reviewer-activity.ts` required.

**Evidence**:

- `extension/ui/modules/charts/reviewer-activity.ts:206-208` — emits `data-drilldown-reviewer-id` + `tabindex="0"` + `role="button"` + `aria-expanded="false"` + accessible label on each row when `filterReviewerId !== null`.
- `extension/ui/modules/drilldown/reviewer-drilldown.ts:196-200` — `resolveTrigger` already reads `[data-drilldown-reviewer-id]`; `activate` (`:226-255`) already routes the click to the panel via `openDetailPanel`.
- The chart's row gating means the panel only opens when `filters.reviewers.length === 1`, which IS the precondition for the new PR list section. No chart-side gating change is needed for the feature to gate correctly.

**Rationale**: every primitive the new PR list requires is already on the wire from the chart. The work is consumer-side wiring inside `reviewer-drilldown.ts`, not chart-side rendering.

**Alternatives considered**:

- _Lift the reviewer-filter chart-side gating so the panel opens without a reviewer filter_: rejected — that's a separate #318 catalog item. This feature does not touch the chart-side gating.

## R6 — Existing reviewer-drilldown test coverage is preserved by adding an optional third argument

**Decision**: The existing `installReviewerDrilldown` signature at `extension/ui/modules/drilldown/reviewer-drilldown.ts:182-186` accepts a two-argument form (`container, rollups`) AND a three-argument form (`container, rollups, options`). The current default `options: ReviewerDrilldownOptions = {}` means existing two-argument tests continue working; new tests use the three-argument form to exercise the new options bag.

**Evidence**:

- `reviewer-drilldown.ts:182-186` declares `options: ReviewerDrilldownOptions = {}` already (the existing `ReviewerDrilldownOptions` has a single field `reviewersDimension` per #308). The new feature extends this interface with the option-bag fields the throughput + cycle-time installs already accept.
- `reviewer-drilldown.test.ts` is 859 lines covering panel-shape, name-resolution fallback, stat-row, approval-rate empty-state, weekly-table empty-row + null-rate cell, MutationObserver lifecycle, dispose, comparison advisory routing, keyboard activation (Enter / Space + preventDefault), a11y attribute surface, rerender sequence, early-return branches, empty-state-when-reviewer-not-found, and aria-expanded toggle. Most existing test invocations pass two arguments; some pass `{ reviewersDimension: REVIEWERS_DIM }`. Both forms continue to work after the interface extension.
- New tests exercising the PR list need to pass the full options bag (`filters`, `repositoriesDimension`, `webContext`, `commentsMetricsAvailable`, plus the existing `reviewersDimension`) to render the PR list. Existing tests are not modified — they continue to test the stat row + weekly table behavior they already assert.

**Rationale**: backward-compat at the install signature means the existing 859 lines of tests continue passing without modification per FR-018. Adding the new options bag fields is purely additive on the interface.

**Alternatives considered**:

- _New install function `installReviewerDrilldownWithPrList`_: rejected — duplicates the install lifecycle (event listeners, MutationObserver, dispose) for no behavior gain. The single-install pattern matches throughput + cycle-time.

## R7 — Demo generator's reviewer aggregation parallel-path needs explicit mirroring

**Decision**: Extend `scripts/generate-demo-data.py` `_generate_reviewer_breakdown` (verified at HEAD `:1764-...`) to populate the new per-(reviewer, week) `prs[]` field on each `ReviewerSliceMetrics` entry. Per repo memory `feedback_demo_generator_parallel_path.md`, this is mandatory — production-aggregator changes have a parallel demo helper that must be updated in lockstep, or byte-identity tests on the demo dataset pass vacuously.

**Evidence**:

- `scripts/generate-demo-data.py:1764-1772` — `_generate_reviewer_breakdown` signature returns `dict[str, ReviewerSliceMetrics]`; the demo's per-(reviewer, week) entries already have the same structural shape as production.
- `scripts/generate-demo-data.py:2380` — call site that invokes `_generate_reviewer_breakdown` and assigns to `by_reviewer`.
- `scripts/generate-demo-data.py:2404` — the result is passed into the rollup-builder `by_reviewer=by_reviewer` parameter.
- The function signature already accepts `pr_count`, `authors_count`, `repo_count` per week — the demo has enough state to construct deterministic per-(reviewer, week) `prs[]` entries that satisfy the FR-016 sort + cap invariants.

**Rationale**: without the parallel-path mirror, the demo emits `by_reviewer[*]` entries WITHOUT the new `prs[]` field. Demo coverage of the consumer's PR list rendering then becomes vacuous — the consumer's `supported-empty` branch fires on every demo reviewer, and the user-facing FR-001 demo verification can't be done. The demo-generator extension is in scope for this feature, NOT silently deferred.

**Alternatives considered**:

- _Defer demo parity to a follow-up_: rejected — repo memory `feedback_demo_generator_parallel_path.md` documents that prior features got hit by this; this feature's spec (FR-023) explicitly forbids the deferral.

## Cross-cutting findings

- **No new dependencies.** Backend reuses `pandas`, `pathlib`, `json`, `sqlite3` (existing). Extension reuses `PrListSection`, `makePrListSection`, `PrListRow`, `isPartialPrRow`, `classifyFilterState`, `resolvePrUrl`, `comparison-advisory`, `dismissAllTooltips`, `openDetailPanel` (existing). Verified via grep against the spec's Verified Inputs at HEAD section.
- **No `typing.Any` introduced.** New `ReviewerDrilldownOptions` extension uses precise types. New `ReviewerSliceMetrics` extension uses `list[PrRecord]` / `bool` / `int`. Strip-helper extension uses `dict[str, object]` matching `_load_rollup` return type.
- **No suppression delta.** `.suppression-baseline.json` stays at zero across `typescript-extension`, `typescript-tests`, and Python scopes.
- **No tsconfig change.** New tests fall under existing `tsconfig.test.json` compilation scope.
- **No CI workflow change.** Existing pre-commit + pre-push + CI gates fire on the new files because they live in already-triggered scopes (`tests/unit/`, `extension/tests/modules/drilldown/`, `src/`, `scripts/`).
- **Both test floors bump in same commit.** Per QG-43 + FR-020, the implementation commit raises both `extension.min_collected` and `python.min_collected` by exactly the new test count on each dimension. No marker waiver attempted by default; `[ratchet-realignment]` on Python floor is permitted ONLY with explicit user authorization per FR-021.

## Open items: none

No clarifications, no deferred decisions, no follow-ups for the planner. Phase 0 declared **COMPLETE**.
