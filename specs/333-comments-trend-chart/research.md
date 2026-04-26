# Research: Dashboard weekly discussion-volume trend chart

**Feature**: 333-comments-trend-chart
**Phase**: 0 (research consolidation)
**Created**: 2026-04-26

This file consolidates the design decisions, their rationales, and the alternatives considered — most resolved across 8 rounds of Codex stop-time review during spec drafting. Each decision below is anchored to the spec section it governs.

---

## Decision 1: Reconciliation contract shape

**Decision**: SC-05 cross-feature reconciliation is enforced by a two-assertion test (FR-2-04) — (a) per-PR pairwise C1 coherence on the extracted-subset of the drill-down ∩ aggregator intersection; (b) end-to-end aggregator correctness via independent re-computation that grounds outside the comments aggregator.

**Rationale**: The original draft asserted bucket-sum-equals-drill-down-sum; this is mathematically impossible against 310's INV-02 top-500-per-week drill-down cap on weeks with >500 PRs (round 1 finding). The next-round attempt at producer-side self-consistency was internally tautological — the aggregator could satisfy its own checks while emitting wrong values (rounds 2 + 3). End-to-end independent re-computation is the only shape that simultaneously verifies set membership, per-PR C1 correctness across all PRs in W's extracted-subset (not just the drill-down intersection), bucket-summing math, and inclusion-rule drift.

**Alternatives considered & rejected**:
- *Bucket-sum equality* (round 1): impossible against the top-500 cap.
- *Cardinality grounding via throughput's `pr_count`* (round 2): same-size sets can differ in members.
- *Producer-side self-consistency only* (round 3): tautological because the aggregator defines its own per-PR set.

**Spec anchors**: FR-2-01, FR-2-04 (a)/(b), SC-1-05.

---

## Decision 2: Field namespace — sub-object vs. flat keys

**Decision**: All four weekly comment-metric outputs live in a single `rollup[W].comments` sub-object — `thread_count`, `comment_count`, `active_thread_count`, `coverage_partial`. NOT placed flat at the rollup root.

**Rationale**: The three numeric names already exist on the per-PR PrRecord interface declared at `extension/ui/schemas/rollup.schema.ts:96–98` (locked by 310's schema-parity gate). Putting same-named fields at the rollup root would create flat-key namespace shadowing — engineers reading `rollup.thread_count` vs `rollup.prs[0].thread_count` would eventually conflate them, and the schema validator's `KNOWN_ROOT_FIELDS` set would mix per-PR-conceptual names with rollup-level data (round 6 finding).

**Alternatives considered & rejected**:
- *Flat keys at rollup root* (round 5 design): name shadowing with PrRecord fields.
- *Renamed to `weekly_*` prefix* (round 6 option A): valid but verbose; sub-object cleaner.
- *Document the collision and keep flat names* (round 6 option C): doesn't actually resolve the conflict; user previously rejected silent-skip patterns.

**Spec anchors**: Background "Weekly comments aggregate object locked", FR-2-06, INV-1-08.

---

## Decision 3: Partial-coverage semantics — extracted-subset rule

**Decision**: Numeric fields of `rollup[W].comments` are sums over W's **extracted-subset** — PRs in W's canonical throughput PR set whose `pull_requests.comments_extracted_at IS NOT NULL`. Unextracted PRs contribute zero. Numeric fields stay non-null. `coverage_partial: boolean` flags when the subset is incomplete (totals undercount full-week truth).

**Rationale**: The contract that "numeric fields are sums over all PRs in W's set" cannot coexist with INV-1-08 atomicity (numeric fields present) when the week contains unextracted PRs (no per-PR data to sum). Round-7 finding; user chose Option A (extracted-subset rule) over Option B (nullable numeric values when partial).

**Why Option A wins on user value**: Partial weeks where most PRs are extracted carry real signal (e.g., 95% extracted = nearly-complete picture). Option A surfaces that signal with a visual caveat. Option B blanks it out (nullable → no bar) — losing user-facing value. Option A is also simpler at the schema level (no `number | null` types) and at the renderer level (always a number to plot).

**Reconciliation interaction**: FR-2-01 pairwise check restricted to extracted-subset of the drill-down intersection. Unextracted PRs in the drill-down agree as "no data / pending" via different sentinels (drill-down's null + aggregator's exclude-from-sum) — not pairwise-numeric-compared. The independent re-computation (FR-2-04 b) applies the same extracted-subset rule.

**Alternatives considered & rejected**:
- *Nullable numeric fields when partial* (Option B): loses user value; schema complexity.
- *Omit `comments` object entirely when partial* (Option C in round 5): chart can't distinguish "missing because partial" from "missing because capability-off"; bad for FR-1-04.

**Spec anchors**: Background "Weekly comments aggregate object locked" (extracted-subset framing), FR-2-03, FR-2-06 (test cases i/ii/iii), Edge Cases (zero-comment week, all-PRs-unextracted, mixed-extracted).

---

## Decision 4: Chart shape — stacked bars + overlaid line, no toggles

**Decision**: Single chart, stacked bars (resolved + unresolved) + overlaid line (`comment_count`). No metric toggles, no per-series interaction beyond bar-click drill-down.

**Rationale**: The user-value question this chart answers is "is conversation volume trending up or down?" plus "is unresolved load building?" The stacked-bar shape uses INV-09's natural subset relation (`active ⊆ all`) to answer both questions in one glance with no interaction. The overlaid line carries the `comment_count` series so all three measures are co-located. Closest visual parallel to the existing throughput chart's `bars + 4-week-avg line` pattern, so users transfer their existing mental model.

**Alternatives considered & rejected**:
- *Three separate small bar charts*: visual noise, harder to compare.
- *Single bar + metric toggle* (Option C in initial design): hides relationships behind interaction.
- *Three overlaid lines*: easier trend comparison, harder absolute-value reading; loses the resolved-vs-unresolved framing.

**Spec anchors**: US1, FR-1-01, FR-1-02, Background "Chart shape locked".

---

## Decision 5: Schema-parity gate scope — NOT extended to rollup-level fields

**Decision**: The existing per-PR PrRecord schema-parity gate (`scripts/check_pr_record_schema_parity.py`, Row 38, QG-49) is intentionally NOT extended to cover the new `rollup[W].comments` aggregate object. The SC-05 reconciliation test (FR-2-04) is the sole authority for weekly-comments-aggregate parity.

**Rationale**: User locked this in round-3 review with explicit "Parity scope: keep minimal." The reconciliation test's end-to-end independent re-computation is stronger than schema-parity drift detection — it verifies values match, not just that field names align. Extending QG-49 would add maintenance burden without strengthening the actual correctness guarantee.

**Spec anchors**: FR-2-04, FR-3-03, Out of Scope.

---

## Decision 6: Independent re-computation — no shared code with EITHER aggregator (round-9 extension)

**Decision**: The FR-2-04 (b) independent re-computation MUST share no code, helpers, or shared utilities with EITHER (1) the comments aggregator's bucket-computation path OR (2) the throughput aggregator's PR-set-determination code path. Both live in `src/ado_git_repo_insights/transform/aggregators.py`. Enforced structurally via an import-block test (AST-based assertion) OR a module-boundary mechanism — code-organization convention is insufficient.

**Rationale**: Round-4 user-locked the original "no shared code with comments aggregator" rule. Round-9 user explicitly extended it to throughput because the FR-2-04 (b) test must determine W's canonical PR set somehow — if it reads throughput's emission or calls throughput's helpers, the test becomes coupled to throughput's correctness. A bug in throughput's PR-set assembly would silently propagate into the test's "expected" values; both surfaces would agree by virtue of sharing the same upstream bug. Direct SQL against the source `pull_requests` table is the only true independence.

This also REMOVES one of the two implementation options previously documented: "cross-reference against the throughput rollup's per-week PR list" is now FORBIDDEN. The only acceptable grounding source for the test's per-week PR set is direct SQL against `pull_requests`.

**Implementation options (plan-level)**:
- AST-based import-block test that walks the test module's transitive imports and asserts NEITHER `aggregators.py` NOR any of its non-trivial helpers appear in the set.
- The reconciliation test lives in a sub-package (`tests/integration/sc05_reconciliation/`) configured to refuse imports from `src/ado_git_repo_insights/transform/aggregators.py`.

Either works; pinning the exact mechanism is a tasks-level decision.

**Spec anchors**: FR-2-04 (b) (round-9 wording), Background guards (i), `contracts/sc05-reconciliation-test.md` §2.

---

## Decision 7: Week-attribution rule — single canonical source OR per-PR parity test

**Decision**: The comments aggregator's week-attribution MUST be enforced by either (a) reusing throughput's canonical week-attribution function (no duplicate logic), OR (b) implementing its own + a per-PR parity test asserting equality against throughput. Duplicated logic without one of these guards is forbidden.

**Rationale**: Round-4 user-locked hardening. Without the guard, the comments aggregator could silently drift on week boundaries — a PR could be attributed to week W in the comments aggregate but week W+1 in throughput, causing chart-vs-drill-down mismatches that no other contract catches.

**Lean**: Option (a) is simpler if a canonical function already exists in `aggregators.py`. Plan-level investigation will confirm.

**Spec anchors**: FR-2-03, Background guards (ii).

---

## Decision 8: Failure-mode meta-test — proves reconciliation isn't passive

**Decision**: A meta-test (FR-2-05) MUST inject a synthetic dataset with `rollup[W].comments.active_thread_count > rollup[W].comments.thread_count` (INV-1-06 violation) and assert the FR-2-04 reconciliation test FAILS on it.

**Rationale**: Round-4 user-locked hardening. Without the meta-test, FR-2-04 could silently degrade to a no-op (a refactor short-circuits the assertion, the fixture loader stops finding the dataset, the comparison loop skips weeks under some condition) and pass on a wrong codebase forever.

**Spec anchors**: FR-2-05, Background guards (iii).

---

## Decision 9: Capability-off serialization — entire `comments` object omitted

**Decision**: When `capabilities.comments_metrics` is NOT enabled, the entire `comments` object is absent from the emitted rollup. Not present-with-empty-object, not present-with-null. Atomic per INV-1-08.

**Rationale**: Round-4 user-locked. Single-key gating is easier to test, easier to reason about, and aligns with the per-PR PrRecord pattern (310 INV-08) where the three optional fields are absent together when capability-off. The byte-identity test for capability-off variants gates the single `comments` key.

**Spec anchors**: FR-3-03, INV-1-08, FR-2-06 test case (iv).

---

## Decision 10: Chart placement — third `.charts-row` below cycle-distribution, built via pure `document.createElement`

**Decision**: New full-width `.charts-row` below `cycle-distribution` on the Metrics tab. **The chart container DOM nodes (the `.charts-row` + `.chart-container` + `<div id="comments-trend" class="chart"></div>`) are built from scratch via `document.createElement` by `extension/ui/dashboard.ts`, only when `capabilities.comments_metrics === true`. `extension/ui/index.html` is NOT modified by this feature — no `<div>`, no `<template>`, no comment-anchor marker, nothing.** Pairs with throughput conceptually — reading top-to-bottom tells the "volume + conversation" story.

**Rationale**: Existing Metrics tab has a 2x2 grid: throughput / cycle-time-trend (row 1), reviewer-activity / cycle-distribution (row 2). Adding a third full-width row preserves the existing 2x2 layout for the four pre-existing charts (FR-3-01) and gives the new chart its own visual prominence — appropriate since this is a foundation chart for the #322 dashboard block. The dynamic-insertion requirement is forced by FR-3-01 + SC-1-04 capability-off byte-identity: ANY static markup in `index.html` (whether a rendered `<div>` OR a `<template>` whose content doesn't render) leaves new DOM nodes in the document tree under capability-off, breaking the baseline-comparison check that SC-1-04 verifies.

**Alternatives considered**:
- *Static `<div id="comments-trend">` in `index.html`*: REJECTED (round-10 finding). Container is in the DOM regardless of capability-off; violates FR-3-01 + SC-1-04 + fails T025. The original tasks.md round-9 design proposed this with capability-gate-only-at-mount-time; Codex correctly flagged the empty container as still in the DOM.
- *`<template id="comments-trend-template">` element in `index.html` that `dashboard.ts` clones-on-demand*: REJECTED (round-11 finding). The `<template>` element itself IS in the DOM tree even though its content (which lives in `template.content` as a `DocumentFragment`) doesn't render; a baseline-comparison check on the DOM tree under capability-off would diff against pre-feature and find the new `<template>` node. Round-10 incorrectly proposed this; Codex correctly flagged that "round-10 still permits a capability-off DOM change via `<template>` in index.html."
- *Static container with CSS `hidden` class under capability-off*: REJECTED. DOM nodes still present; baseline-comparison check fails on DOM-tree diff even though visually hidden.
- *Comment-anchor marker in `index.html` (e.g., `<!-- comments-trend-anchor -->`)*: REJECTED. Comment nodes are still nodes in the DOM tree (`Node.COMMENT_NODE`); strict baseline-comparison would catch the addition.
- *Replacing one of the existing 2x2 charts*: REJECTED. Violates FR-3-01 capability-off byte-identity (different layout when capability-off).
- *New "Comments" tab*: REJECTED. Loses the visual proximity to throughput; adds tab-navigation cost.

**Implementation note**: `dashboard.ts` exposes two helpers. (1) `ensureCommentsTrendContainer()`: checks `document.getElementById('comments-trend')` first — if present, returns it (REUSE — no duplicate insertion); if absent, creates a new `.charts-row > .chart-container > <div id="comments-trend" class="chart">` via `document.createElement` chain, tags the row with `data-comments-trend-row="true"`, appends after the existing `cycle-distribution` row's parent `.charts-row`, returns the new container. (2) `removeCommentsTrendContainer()`: finds `[data-comments-trend-row="true"]` and removes it from its parent (no-op if absent). Render path: capability-on → ensure + chart-render; capability-off → remove (no-op on initial capability-off; cleanup on on→off mid-session flip per FR-3-02).

**Round-12 idempotency requirement**: dashboard re-renders fire on dataset reload, filter change, tab switch back. Naive `createElement + appendChild` per render would stack duplicate rows (Codex round-12 finding). The `ensureCommentsTrendContainer` helper makes insertion idempotent by check-first; the chart's internal content is idempotent via the throughput-style `renderTrustedHtml` pattern (replaces innerHTML on each call). Together these ensure: at any moment when capability is on, exactly ONE chart row in the DOM; at any moment when capability is off, ZERO chart rows in the DOM.

**Spec anchors**: FR-1-05, FR-3-01, FR-3-02 (idempotency + cleanup forced by mid-session flip), SC-1-04 ("at any moment in time" — round-12 strict reading), T015 case (h) chart-layer content-idempotency test, T021 helper functions, T025 (a)/(b)/(c) initial-off / on→off / off→on transitions, T025 (d) round-13 on→on dashboard-layer re-render idempotency (the load-bearing test for round-12's `ensureCommentsTrendContainer` check-first design), all in tasks.md.

---

## Decision 11: Demo data refresh mechanism

**Decision**: `python scripts/manage_generated_artifacts.py sync --scope all --stage` rebuilds `/docs/data/dataset-manifest.json` and the rollup JSONs to carry the new `comments` object on capability-on weeks. The capability-off variant (per-existing demo-variants test infrastructure) MUST continue to omit the `comments` key entirely.

**Rationale**: Per `reference_managed_artifacts_sync.md` — `--stage` is REQUIRED for git staging; without it, the verify gate fails. This is the canonical command for refreshing managed UI artifacts in this repo. No alternative.

**Spec anchors**: FR-3-03, Background, A-06.

---

## Open implementation questions deferred to tasks.md

These are NOT spec-level decisions; the plan acknowledges them and `/speckit.tasks` will pin them:

- **Exact file path for the byte-identity test extension** (FR-3-03): two candidates exist per Explore findings — `tests/integration/test_demo_variants_byte_identity.py` (referenced in issue body) and `tests/demo/test_demo_parity_pipeline.py` (Explore-flagged as the existing locked-shape gate). Tasks-level investigation pins the right file. The gating MUST cover all four omission failure modes (key absent, `null`, `{}`, partial fields).
- **Exact import-block isolation mechanism** (FR-2-04 b, round 9): AST-based test (covering BOTH the comments aggregator's path AND throughput aggregator's path) vs. module-boundary configuration. Tasks-level decision. Per round 9, the option of "cross-reference against throughput rollup's per-week PR list" is REMOVED — the test MUST use direct SQL against `pull_requests`.
- **Exact week-attribution helper reuse path** (FR-2-03 a vs. b): plan-level investigation will confirm whether throughput exposes a callable helper or whether a per-PR parity test is the cleaner path. Note round-9 implication: even if throughput exposes a callable helper that the comments aggregator could reuse (FR-2-03 (a) shared canonical), the FR-2-04 (b) RECONCILIATION TEST still cannot call that helper — the test's week-attribution is a third re-implementation that asserts parity with throughput's via a per-PR check. So round-9 effectively forces FR-2-03 (b) shape on the reconciliation test side regardless of which option (a)/(b) the production code adopts.
- **Schema validator atomicity enforcement** (INV-1-08): the validator either accepts the `comments` object (if all 4 fields present) or warns/errors (if partial). Pin the exact error vs. warning posture at tasks time.
- **Partial-coverage visual qualifier exact rendering** (FR-1-04): hatched bar fill, dimmed color, or both. Tuning decision per A-05 (`Example:` values are iteration starting points per `feedback_visual_example_iteration.md`). Round-9 added FR-2-06 case (vi) requiring the qualifier to apply to all-unextracted weeks (zero-height bars MUST still render with the qualifier, not be silently omitted).
