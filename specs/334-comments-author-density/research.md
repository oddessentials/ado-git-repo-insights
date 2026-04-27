# Research: Dashboard per-author comment density breakdown

**Feature**: 334-comments-author-density
**Phase**: 0 (research consolidation)
**Created**: 2026-04-27
**Spec**: [spec.md](./spec.md) — all 8 CL-axes locked (Path B by user directive 2026-04-27)

This file consolidates the locked CL-axis resolutions (rephrased as Decision / Rationale / Alternatives) plus six ADRs (T001 – T006) pinning the remaining implementation choices that surfaced during planning.

---

## Decision 1: Emission shape (CL-01) — parallel `rollup[W].by_author_comments` namespace

**Decision**: Aggregator emits a new optional sub-object `rollup[W].by_author_comments[<author_id>]` on the rollup root (per-week sub-object, atomic per INV-2-08). Mirrors 333's `rollup[W].comments` design exactly. Capability-off: entire key omitted (4 omission failure modes gated by FR-3-03).

**Rationale**: The 333 review locked "sub-object on rollup root" (333 Decision 2) for namespace cleanliness. Reusing that pattern here:
- Matches 333's locked design — siblings #335 / #336 inherit cleanly when they ship `by_repository_comments` / `by_reviewer_comments`.
- Capability-off byte-identity is simpler — one key to gate (4 omission failure modes), not interleaved fields inside throughput's existing `by_author` `SliceMetrics`.
- Type-clean: `Record<string, AuthorCommentsDensityEntry>` with an atomicity validator separate from the existing `BreakdownEntry` validator.
- Avoids type-shape blast radius on `SliceMetrics` (which is shared with `by_repository`, `by_team`, `by_author_and_repo`, `by_team_and_repo`).

**Alternatives considered & rejected**:
- (A) Inline new comments fields into existing `rollup[W].by_author` `SliceMetrics`: wider blast radius (`SliceMetrics` is reused across 5 breakdown namespaces), capability-off byte-identity harder, type union for the inline-fields case is ugly. Rejected.
- (C) Some other shape (e.g., dataset-level range-total breakdown): would not honor user-selected date-range filter without recomputation. Rejected.

**Spec anchors**: FR-1-02, FR-3-03, INV-2-08, INV-2-09, Key Entities.

---

## Decision 2: Filter-not-supported posture (CL-02) — full 333 FR-1-07 parity

**Decision**: When ANY of the dashboard's per-PR dimension filters (`repos` / `teams` / `authors` / `reviewers`) is active, the breakdown renders a self-explanatory filter-not-supported empty state instead of rows.

**Rationale**: 333 chose this posture for the comments-trend chart because `applyFiltersToRollups` / `buildFilteredRollup` carries the rollup-root namespaces through unchanged via `...rollup` spread, so filtered-rollup-driven rows would silently show unfiltered totals while the rest of the dashboard reflects filtered scope (an honesty regression). The same code path applies to this feature's `by_author_comments` namespace; the same risk applies. Inheriting the 333 posture is the consistent, low-risk choice.

**Alternatives considered & rejected**:
- (b) Honor the AUTHOR-dimension filter only: would require deeper aggregation — the spec leaves this to future per-dimension comments slices.
- (c) Honor all dimensions: deeper aggregation in producer — out of foundation-PR scope; would re-open spec.

**Spec anchors**: FR-4-07, INV-2-11, US5, SC-1-05.

---

## Decision 3: Per-author `coverage_partial` signal (CL-07) — yes (propagate 333 INV-1-07)

**Decision**: Each per-(week, author) emission carries a `coverage_partial: boolean` field defined as "any of author A's PRs in W's canonical throughput PR set has `comments_extracted_at IS NULL`". Range-total reduction (chart-side) is `true` if any constituent week's per-(week, author) `coverage_partial` is `true`. Renderer applies a partial-coverage qualifier per row when reduced value is `true`.

**Rationale**: 333 INV-1-07 propagation. The user-facing signal — "we don't know yet about some of this author's PRs" — is per-row meaningful in a per-author breakdown: the team lead can distinguish "this author has high comment count" from "this author has high known-extracted-subset comment count, with some PRs still pending extraction". Without the per-row signal, the breakdown would silently misrepresent partial weeks for individual authors.

**Alternatives considered & rejected**:
- "no" (range-total smooths over weeks; per-week qualifier only): loses the per-author signal; team lead can't distinguish partial-author rows from full-author rows. Rejected.

**Spec anchors**: FR-1-06, FR-4-03, edge case "Author appears in multiple weeks with mixed extraction", INV-2-08.

---

## Decision 4: Sentinel mechanics (CL-03)

**Decision**: Aggregator-side single-bucket key uses the reserved literal `__former_or_unavailable_author__` (leading-double-underscore namespace cannot collide with author_id UUID strings). Renderer-side label is the fixed string "Former / unavailable author" (English-only for v1; localization deferred). Reconciliation requirement: per-PR sum of all PRs whose `author_id` is absent from `users` equals the sentinel bucket's value for the (week, sentinel) emission.

**Rationale**: 310 C1 says the bucket is a "single sentinel identity rendered as 'Former / unavailable author'". The sentinel surfaces ONLY in per-author / per-reviewer dimensions; this feature is the FIRST surface where it's user-visible. Aggregator-side bucketing (vs renderer-side aggregation of raw author IDs) is the correct seat: the aggregator KNOWS at emission time whether the author is in `users` (already a join target for the existing `authorsDimension` lookup); the renderer should render whatever the aggregator emits, not re-bucket.

**Reserved-namespace safety**: production `author_id` values are UUID-format strings (32 hex chars + 4 hyphens) per the existing extractor. A leading-double-underscore literal `__former_or_unavailable_author__` cannot collide. Plan-level: a grep over historical `pr_comments.author_id` test fixtures verifies non-collision.

**Alternatives considered & rejected**:
- Renderer-side aggregation of raw author IDs (no aggregator-side bucketing): renderer would need access to the `users` table to detect missing-from-users. Rejected — pushes lookup logic into UI.
- Localized sentinel label (i18n): deferred to v2 (Out of Scope).

**Spec anchors**: FR-1-03, FR-2-03, A-07, edge case "Sentinel row collides with real author display name".

---

## Decision 5: Reconciliation extension target (CL-04) — extend 333 in-place

**Decision**: Extend `tests/integration/test_comments_trend_reconciliation.py` in-place with per-author parity assertions for FR-2-01 / FR-2-02 / FR-2-03. The 333 isolation test (`tests/integration/test_comments_trend_reconciliation_isolation.py`) covers the extension automatically since aggregator imports are forbidden by file (`src/ado_git_repo_insights/transform/aggregators.py`), not by dimension scope.

**Rationale**: Same contract scope (cross-feature C1 coherence), same import-block isolation guarantee, same test infrastructure. A parallel test file would duplicate the demo-dataset loader + per-week iteration scaffold for no contract-distinct reason. The 333 round-9 import-block isolation extends automatically (no shared code with EITHER aggregator), so adding per-author assertions to the same test file does not weaken the isolation invariant.

**Alternatives considered & rejected**:
- Parallel test file `tests/integration/test_comments_author_breakdown_reconciliation.py`: duplicate scaffolding, duplicate import-block guard, no contract distinction. Rejected.

**Spec anchors**: FR-2-04, INV-2-02 closure (SC-1-06).

---

## Decision 6: Display cap / sort default / pagination (CL-05)

**Decision**: Top-50 authors by chosen metric (constant: `MAX_COMMENTS_AUTHOR_DENSITY_ROWS = 50`); default sort metric `comment_count` descending; sort selector toggles among `comment_count` / `thread_count` / `active_thread_count`; ties break deterministically — first by author display name ascending, then by author key ascending as the final tie-breaker (handles duplicate display names + sentinel/real-name collisions, since author key is the stable identity guaranteed unique by the producer). Truncation indicator follows 333's chart-truncation pattern (analog of `MAX_COMMENTS_TREND_POINTS = 104`).

**Rationale**: 50 rows is sufficient for visual scan-ability — outliers always cluster in the top ranks. `comment_count` is the most direct signal of "review-conversation load" per the spec's Why-this-priority. Three-metric toggle covers the natural questions ("most comments?" / "most threads?" / "most unresolved?"). Ties broken by name keeps re-render order stable across reloads.

**Alternatives considered & rejected**:
- No cap (render all authors): UI can degrade with 100+ rows; visual-scan benefit drops sharply past top-50. Rejected.
- Pagination (multiple pages): adds interaction cost for the foundation PR. Rejected (deferred to future tuning).

**Spec anchors**: FR-4-05, FR-4-06, US2.

---

## Decision 7: Row click-through (CL-06) — no click-through

**Decision**: Rows do NOT activate any drill-down or per-author detail surface. The breakdown is informational. Rows are not styled as clickable. A future per-author drill-down panel is deferred outside this feature.

**Rationale**: A per-author drill-down panel doesn't exist today (the existing 060 drill-down is week-scoped, not author-scoped). Building one would expand foundation-PR scope materially. Deferring to a future feature lets the foundation PR ship with the visible value (top-N per-author breakdown) without blocking on drill-down design.

**Alternatives considered & rejected**:
- Click filters the existing drill-down by author: drill-down is week-scoped; "filter by author" doesn't fit its semantics.
- Click opens a NEW per-author drill-down: out of foundation-PR scope.

**Spec anchors**: FR-4-09, Out of Scope.

---

## Decision 8: Schema-parity gate scope (CL-08) — follow 333 non-extension

**Decision**: The per-PR `PrRecord` schema-parity gate (`scripts/check_pr_record_schema_parity.py`, Row 38, QG-49) is intentionally NOT extended to cover the new `by_author_comments` namespace.

**Rationale**: Inherits 333 Decision 5. The reconciliation test extension (Decision 5 / FR-2-04) verifies value-equality across surfaces, which is strictly stronger than schema-shape parity. Extending QG-49 would add maintenance burden (per-(week, author) tuples are dynamic, not a small fixed schema) without strengthening the actual correctness guarantee.

**Alternatives considered & rejected**:
- Extend QG-49 to parse this feature's contract markdown table: would require parser changes for the dynamic nested-dict shape; reconciliation test catches the same drift via value-equality.

**Spec anchors**: Out of Scope, contracts/per-author-comments-density.md §4.

---

## ADR T001: Chart module file name + structural template

**Decision**: New module at `extension/ui/modules/charts/comments-author-density.ts`, modeled on 333's `extension/ui/modules/charts/comments-trend.ts` adapted for **table/row rendering** rather than bar+line rendering.

**Rationale**: 333's `comments-trend.ts` pattern provides the right scaffolding for this feature:
- Capability-aware container lifecycle (`hasComments` filter at chart boundary; chart-side defense even when dashboard gates the container).
- Filter-not-supported short-circuit at the top of the render function (FR-4-07).
- No-data short-circuit (`renderNoData` shared primitive).
- Truncation indicator (`renderTruncationIndicator` shared primitive).
- Tooltip / a11y conventions on rows.

What's different from 333:
- Output is a sortable table of rows, not a stacked-bar chart with overlaid line. No SVG; HTML `<table>` (or list-equivalent semantic structure) for the row-table.
- Reduction step: this feature's chart aggregates per-(week, author) emissions to range-total per row over the visible weeks; 333's chart per-week emissions are rendered as-is per bar.
- Sort selector UI control: ADR T002.

**Alternatives considered & rejected**:
- Reuse the 060 throughput-drilldown row-rendering primitives (`detail-panel.ts`): those primitives are PR-list-shaped (PrListRow, PrListSection). The author-density rows have a different shape (3 numeric metrics + sentinel handling + partial qualifier). Reusing would force-fit the wrong abstraction. Rejected.
- Build from scratch (no template reuse): wastes the 333 scaffolding investment. Rejected.

**Spec anchors**: FR-4-01..FR-4-10.

---

## ADR T002: Sort selector UI pattern

**Decision**: Button group (radio-style, three buttons), keyboard-accessible. Each button is a `<button>` with `role="radio"` and `aria-checked`; the active button is visually highlighted. Tab focus enters the group; arrow keys move within (or Tab to next button); Enter / Space activates.

**Rationale**: A button group is the simplest, most accessible pattern for a small fixed enum. Three options fit visually inline above the row-table without dropdown overhead. Pattern reference: similar to existing throughput chart's tab-selector pattern; mature accessibility convention.

**Alternatives considered & rejected**:
- `<select>` dropdown: hides options behind interaction; visual-scan benefit is reduced.
- Column-header click (sort by clicking the metric column header): less discoverable; doesn't accommodate "sort by metric not visible as a column" (e.g., if we later tune which metrics render as columns).

**Spec anchors**: FR-4-05, FR-4-10.

---

## ADR T003: Schema validator atomicity posture — STRICT ERROR in both modes

**Decision**: The new `validateAuthorCommentsDensity()` validator (in `extension/ui/schemas/rollup.schema.ts`) MUST push partial-shape violations to the `errors` array (not `warnings`) — STRICT in both `strict` and permissive modes. The `strict` parameter is irrelevant for this check.

**Rationale**: Mirrors 333 ADR T004. INV-2-08 atomicity is a NEW contract introduced by this feature with no existing emissions to be lenient toward. A partial-shape regression slipping through as a warning would force every renderer to add defensive null-checks per field, defeating the contract's purpose. The 333 `validateCommentsAggregate` validator established this strict-in-both-modes posture for the analogous INV-1-08; this feature's validator follows the same precedent.

**Validator rules** (from contracts/per-author-comments-density.md §3):
- Atomicity (INV-2-08): all 4 fields present per entry (or entire `by_author_comments` key absent under capability-off).
- Ordering (INV-2-07): `active_thread_count <= thread_count` per entry (including sentinel).
- Non-negative: each numeric field `>= 0`.
- Integer: each numeric field satisfies `Number.isInteger(value)`.
- Boolean: `coverage_partial` is strict boolean (not null / undefined / string).
- Sentinel literal: the key `__former_or_unavailable_author__` is permitted (no special handling required at validator level — it's just another key string).

**Alternatives considered & rejected**:
- Warning + permissive accept (mirrors per-PR INV-08 validator's posture): rejected — would silently allow partial-shape regressions to ship to consumers.

**Spec anchors**: FR-1-07, INV-2-08.

---

## ADR T004: Partial-coverage qualifier visual

**Decision**: Hatched fill on the row's metric-bar / row-background via CSS `repeating-linear-gradient` + dimmed text color + tooltip-explained legend item. Apply ONLY when the row's range-total `coverage_partial` reduces to `true` (per FR-4-03). The qualifier MUST be visibly distinguishable from the normal (non-partial) row rendering.

**Rationale**: Mirrors 333 ADR T005's exact convention. Reusing 333's CSS conventions (the `.coverage-partial` class hook with `repeating-linear-gradient`) ensures the user-facing visual is consistent across the comments-trend chart and the per-author breakdown — both partial-coverage signals look the same. Plan-level: refine in implementation if visual review surfaces issues; spec is tunable per `feedback_visual_example_iteration.md`.

**Alternatives considered & rejected**:
- Different visual convention from 333 (e.g., pattern fill, opacity, stripe): inconsistent across surfaces; user must learn two conventions.

**Spec anchors**: FR-4-03, INV-2-07 propagation.

---

## ADR T005: Week-attribution rule reuse

**Decision**: The comments-author aggregator implements its own week-attribution (same `closed_date → pd.to_datetime → .dt.isocalendar() → f"{year}-W{week:02d}"` formula throughput / 333 use). A per-PR parity test guards drift against throughput's emission (mirrors 333 ADR T003 option (b)).

**Rationale**: 333 ADR T003 investigation showed throughput's week-attribution is INLINED in `aggregators.py:_generate_weekly_rollups()` (no standalone helper). 333 chose option (b) because extracting a shared helper would require refactoring three intermixed pandas DataFrame mutations on a hot path. This feature inherits the same constraint:
- Refactoring throughput's pipeline to expose a callable helper is out of foundation-PR scope.
- Re-using 333's per-PR parity test (`tests/integration/test_week_attribution_parity.py` — created during 333 if T003 chose option (b); pinned at task time) is sufficient.

If 333 added a callable helper after all, this feature SHOULD reuse it. Otherwise: re-implement using the same formula + add per-PR parity assertion to the existing parity test.

**Round-9 implication**: The FR-2-04 reconciliation test side cannot call the helper anyway (333 round-9 / Decision 5 forbids `aggregators.py` imports from the test). The test does its own third re-implementation regardless of production-code reuse.

**Alternatives considered & rejected**:
- Refactor throughput's inlined pipeline to expose a shared helper: out of foundation-PR scope (333 ADR T003 already rejected this for 333).

**Spec anchors**: FR-1-01, FR-2-02 step 1, A-04.

---

## ADR T006: Sentinel literal name + label

**Decision**: Aggregator-side single-bucket key: reserved literal `__former_or_unavailable_author__` (Python `Final[str]` constant). Renderer-side fixed-string label: `"Former / unavailable author"` (English-only for v1).

**Rationale**: Decision 4 above pinned the values. ADR T006 records the implementation specifics:
- Constant declaration site: `src/ado_git_repo_insights/transform/aggregators.py` near `_generate_weekly_rollups()` (or in a sibling constants module if one exists). Plan/tasks pin the exact location.
- Renderer-side label: hard-coded string in `comments-author-density.ts` (no i18n table). Plan/tasks pin the conditional that maps `if (key === "__former_or_unavailable_author__") label = "Former / unavailable author"; else label = authorsDimension.lookup(key)`.
- Sentinel safety test: a unit test in `tests/unit/test_aggregators_author_comments.py` (case (v)) asserts the sentinel literal does NOT appear in any production `pr_comments.author_id` value across the demo + golden fixtures.

**Alternatives considered & rejected**:
- Externalized i18n table with `"former.unavailable.author"` key: adds machinery for v1's English-only ship.
- Per-locale labels: deferred to v2 (Out of Scope).

**Spec anchors**: FR-1-03, A-07, A-09.

---

## Open Implementation Questions (none)

All ADRs above resolve the planning-stage questions surfaced during research. No items defer to /speckit.tasks. Plan is ready for /speckit.tasks (Phase 2) once the user reviews and approves.

## References

- `specs/310-comments-visualization/spec.md` — C1 inclusion-rule contract authority; INV-02 / INV-03 / INV-05 / INV-06 / INV-07.
- `specs/333-comments-trend-chart/spec.md` — `rollup[W].comments` foundation pattern; INV-1-04..INV-1-08; FR-2-04 reconciliation contract; FR-3-03 capability-off byte-identity gate.
- `specs/333-comments-trend-chart/research.md` Decisions 1–7 and ADRs T001–T005 — directly inherited or paralleled by this feature's ADRs T001–T006.
- `specs/333-comments-trend-chart/contracts/weekly-comments-aggregate.md` — schema contract pattern this feature mirrors at the per-author scope.
- `specs/333-comments-trend-chart/contracts/sc05-reconciliation-test.md` — reconciliation test contract this feature extends in-place.
