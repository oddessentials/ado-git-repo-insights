# Feature Specification: Dashboard per-author comment density breakdown

**Feature Branch**: `feat/334-comments-author-density`
**Created**: 2026-04-27
**Status**: Draft (all 8 CL-axes locked 2026-04-27 by user directive — Path B; planning-readiness verified)
**Issue**: #334 (split from #322 — Capability 2, author dimension; first of three sibling Cap-2 dimension PRs alongside #335 repo + #336 reviewer; sibling #321 team is on-hold pending team-at-time-of-PR history)
**Input**: User description: per-author comment-density breakdown for issue #334, downstream of `specs/310-comments-visualization/` (C1 contract authority) and `specs/333-comments-trend-chart/` (foundation PR for the #322 dashboard block)

## Overview

This feature adds a per-author comment-density breakdown to the dashboard's Metrics tab. It is the FIRST of three sibling Cap-2 dimension PRs (this PR for author, #335 for repo, #336 for reviewer); the visual + interaction pattern locked here is the inheritance reference for #335 and #336. Sibling #321 (per-team) is deferred (#321 is on-hold pending team-at-time-of-PR history modeling).

**Why now**: The drill-down (310) shows per-PR thread / comment / active-thread counts; the trend chart (333) shows weekly volume. Neither answers "are any authors outliers in discussion volume — either producing or attracting it?" Today the existing `by_author` per-week emission carries throughput-only metrics; nothing renders author-level comments-density on a dashboard surface.

The feature is additive and gated on `capabilities.comments_metrics`. The dashboard MUST render byte-identical to its current rendering for users without comment extraction enabled (analog of 333 SC-1-04 for this feature's namespace).

## Background — locked decisions inherited from prior clarifications

These decisions are inherited and MUST NOT be re-litigated in this spec. Authoritative sites are referenced inline by file + anchor text.

- **C1 inclusion-rule contract is authoritative at `specs/310-comments-visualization/spec.md` "Shared inclusion-rule contract (C1)"** — including the rule that authors absent from the `users` table MUST be bucketed under a SINGLE sentinel identity rendered as "Former / unavailable author". This feature MUST reference that subsection as the authority and MUST NOT re-declare any inclusion rule. Re-declaration is itself an INV-07 violation.
- **C3 density unit = per-PR range total** — one row per author across the user-selected date range. Weekly cadence is owned by 333's trend chart; redundant to duplicate here. (Inherited from 310 Clarifications C3, applied to this feature's surface.)
- **C4 team-slice deferral** — sibling #321 is on-hold. No team-dimension surfaces in this feature. (Inherited from 310 INV-03.)
- **333 sub-object pattern** — 333 established `rollup[W].comments` as an aggregate sub-object on the rollup root with INV-1-08 atomicity, FR-3-03 capability-off byte-identity gate, FR-1-07 filter-not-supported posture, INV-1-06 ordering, and the SC-05 reconciliation contract (independent re-computation + AST-based import-block isolation forbidding shared code with EITHER the comments aggregator OR the throughput aggregator). This feature INHERITS those invariants; the namespace this feature emits is `rollup[W].by_author_comments` (per CL-01 = B locked below).
- **310 INV-02 top-500-per-week-by-cycle-time drill-down cap is preserved** — per-author aggregate totals span the FULL extracted-subset (per 333 Decision 3 and FR-2-03 — chart-side aggregation is over W's full extracted-subset, not the drill-down's slice). Lifting the cap is out of scope.

## Clarifications

### Resolved decisions

All 8 CL-axes are locked. /speckit.clarify may re-open them if needed; in the absence of re-opening, all FRs / USs / SCs / edge cases below assume these resolutions.

- **CL-01 emission shape — LOCKED to (B) parallel namespace `rollup[W].by_author_comments`** (per-week sub-object on rollup root, mirroring 333's `rollup[W].comments` pattern). Capability-off omits the entire key. Schema validator atomicity mirrors 333's `validateCommentsAggregate` posture (ADR T004 — STRICT ERROR in both modes per INV-2-08). Resolved 2026-04-27 by user directive.
- **CL-02 filter-not-supported posture — LOCKED to (a) full 333 FR-1-07 parity**. When ANY of the dashboard's `repos` / `teams` / `authors` / `reviewers` filters is active, the breakdown renders a self-explanatory filter-not-supported empty state. Per-dimension comments slices that would let the breakdown honor filters are deferred to a future feature. Resolved 2026-04-27 by user directive.
- **CL-07 per-author coverage_partial signal — LOCKED to yes**. Each per-(week, author) emission carries a `coverage_partial: boolean` field defined as "any of author A's PRs in W's canonical throughput PR set has `comments_extracted_at IS NULL`". Range-total reduction (chart-side) is `true` if any constituent week's per-(week, author) `coverage_partial` is `true`. Renderer applies a partial-coverage qualifier per row when the reduced value is `true` (analog of 333 INV-1-07 propagated to per-author granularity). Resolved 2026-04-27 by user directive.
- **CL-03 sentinel mechanics — LOCKED**. Aggregator-side single-bucket key uses the reserved literal `__former_or_unavailable_author__` (leading-double-underscore namespace cannot collide with author_id UUID strings). Renderer-side label is the fixed string "Former / unavailable author" (English-only for v1, propagated verbatim from 310 C1). Reconciliation requirement: per-PR sum of all PRs whose `author_id` is absent from `users` equals the sentinel bucket's value for the (week, sentinel) emission.
- **CL-04 reconciliation extension target — LOCKED**. Extend `tests/integration/test_comments_trend_reconciliation.py` in-place with per-author parity assertions. The 333 isolation test (`tests/integration/test_comments_trend_reconciliation_isolation.py`) covers the extension automatically since aggregator imports are forbidden by file, not by dimension.
- **CL-05 display cap / default sort / pagination — LOCKED**. Top-50 authors by chosen metric; default sort metric `comment_count` descending; sort selector toggles among `comment_count` / `thread_count` / `active_thread_count`; truncation indicator follows 333's chart-truncation pattern. Constant name: `MAX_COMMENTS_AUTHOR_DENSITY_ROWS = 50`. Tunable in plan/tasks without spec changes.
- **CL-06 row click-through — LOCKED**. NO click-through in foundation PR. The breakdown is informational. A future per-author drill-down panel is deferred to a separate feature.
- **CL-08 schema-parity gate scope — LOCKED**. Follow 333 Decision 5 non-extension posture; the per-PR `PrRecord` schema-parity gate (`scripts/check_pr_record_schema_parity.py`, Row 38, QG-49) is intentionally NOT extended to cover this feature's namespace. The CL-04 reconciliation extension is the parity authority — value-equality is strictly stronger than schema-shape parity.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Identify highest-load authors at a glance (Priority: P1)

A team lead opens the dashboard's Metrics tab on a Monday morning and wants to see which authors are producing or attracting the most review-conversation load over the last quarter. They look at the new per-author comment-density breakdown and immediately see the top-N authors ranked by their chosen count metric (default `comment_count`). Without sorting beyond the default, they identify outliers and notice if any author's contribution differs sharply from the median. The "Former / unavailable author" sentinel row, when visible, qualifies how much of the load comes from authors no longer in the user directory.

**Why this priority**: This is the entire user-visible reason the feature exists. #322's Capability-2 author-dimension ask was articulated as "are any authors outliers in discussion volume?" Without P1 the feature has no value; the chart's first-glance readability is the success criterion.

**Independent Test**: Open a demo dashboard with `capabilities.comments_metrics` enabled and ≥10 distinct authors with mixed comment-load. Confirm a chart titled with author / density vocabulary renders below the 333 comments-trend chart on the Metrics tab. Confirm rows are ordered by `comment_count` descending. Confirm the date-range filter narrows the visible set when changed. Sort toggle (US2), capability-off (US3), sentinel (US4), and filter-not-supported posture (US5) are not required to be present for this test.

**Acceptance Scenarios**:

1. **Given** a dataset where `capabilities.comments_metrics` is enabled and the visible date range contains ≥10 authors with non-zero comment activity, **When** the user opens the Metrics tab, **Then** the per-author breakdown renders the top-50 authors by `comment_count` descending, with each row showing author display name + `thread_count` + `comment_count` + `active_thread_count` + a per-row partial-coverage qualifier when the row's range-total `coverage_partial` reduces to `true` (per FR-4-03).
2. **Given** the breakdown is rendered, **When** the user changes the dashboard's date range to a narrower window, **Then** the breakdown re-renders with rows summing per-(week, author) contributions over only the weeks within the new range; row ordering remains valid for the new sums.
3. **Given** the dataset has more than 50 authors with non-zero activity in the visible range, **When** the breakdown renders, **Then** it shows the top-50 by chosen metric and surfaces a truncation indicator carrying the count of hidden authors (analog of 333's truncation pattern).

---

### User Story 2 — Toggle the chosen sort metric (Priority: P2)

The team lead notices a high `comment_count` for one author but suspects the load might actually concentrate on threads (more discussions even if individually shorter), or on unresolved threads. They switch the sort metric to `thread_count` (or `active_thread_count`) and the rows re-order, surfacing different outliers.

**Why this priority**: A sort-metric toggle is a low-cost addition that closes the loop from "spot the dominant comment-count author" to "see if thread-count or unresolved-count tells a different story." Sequencing it after P1 lets the foundation chart ship as the minimum viable unit.

**Independent Test**: With User Story 1 visible, activate each of the three sort-metric options. Confirm the rows re-order each time and the active sort metric is visually indicated. Tie-break ordering MUST be deterministic (secondary sort by author display name ascending, then author key ascending as final tie-breaker to handle duplicate display names and sentinel/real-name collisions) so the rendered order is reproducible across reloads.

**Acceptance Scenarios**:

1. **Given** the breakdown is rendered with the default `comment_count` sort, **When** the user activates `thread_count` from the sort selector, **Then** the rows re-order by `thread_count` descending and the active-selector indicator updates.
2. **Given** the breakdown is rendered, **When** the user activates `active_thread_count`, **Then** the rows re-order by unresolved-thread count descending.
3. **Given** the user activates a sort metric that produces ties (multiple authors with identical metric value, including duplicate display names or a sentinel/real-name collision), **When** the rows re-order, **Then** ties break deterministically — first by author display name ascending, then by author key ascending as the final tie-breaker; the rendered order is reproducible across page reloads under the same dataset.

---

### User Story 3 — Capability-off renders byte-identical to the prior baseline (Priority: P3)

A team using a dataset that does NOT have comment extraction enabled (`capabilities.comments_metrics: false`) opens the dashboard. They see exactly the surfaces they saw in the previous release — no new per-author breakdown container, no shifted layout, no empty placeholder, no banner.

**Why this priority**: P3 is a critical safety property dressed as a user story. Datasets without comment extraction MUST see the dashboard render identically to the pre-feature baseline (analog of 333 FR-3-01 / SC-1-04 propagated to this feature's namespace). Verifiable as a regression test against the prior release; not a daily user activity.

**Independent Test**: Load a dataset variant where `capabilities.comments_metrics: false`. Confirm the Metrics tab renders identically to the pre-feature baseline — no new per-author breakdown surface, no DOM nodes for the breakdown container, existing surfaces (333 chart, throughput, cycle-time, reviewer-activity, summary-cards) at their pre-feature positions.

**Acceptance Scenarios**:

1. **Given** a dataset with `capabilities.comments_metrics` disabled, **When** the user opens the Metrics tab, **Then** the per-author breakdown container does not render and the existing chart surfaces occupy the same layout positions and sizes as before this feature shipped.
2. **Given** a dataset where the capability flag toggles from disabled to enabled mid-session via dataset reload, **When** the dashboard re-renders, **Then** the breakdown surface appears in its proper position without breaking the existing chart layouts; transitioning back to disabled cleans up without leaving stale geometry (333 T021/T025 lifecycle parity).

---

### User Story 4 — Sentinel rendering for "Former / unavailable author" (Priority: P3)

The team has had author turnover; some PRs in the visible date range were authored by users no longer in the `users` table (deprovisioned, deleted, or otherwise missing). The team lead sees a single row labeled "Former / unavailable author" that aggregates ALL such PRs' comment metrics, distinguishable from real-author rows.

**Why this priority**: C1 sentinel rendering is an explicit obligation from 310 inherited via INV-07. Per 310 C1, the sentinel surfaces ONLY in per-author / per-reviewer dimensions; this feature is the FIRST surface where the sentinel is user-visible. Without it the feature would either silently drop unknown-author rows (data loss) or fragment them across raw author IDs (renders as opaque UUIDs) — both violate C1.

**Independent Test**: Load a demo dataset that includes ≥1 PR whose `author_id` is NOT present in the `users` table. Open the breakdown. Confirm exactly ONE row labeled "Former / unavailable author" appears, with metrics equal to the sum of contributions from all such PRs in the date range. The sentinel row's sort position depends on its metric value vs. real-author values (it is NOT pinned to top or bottom).

**Acceptance Scenarios**:

1. **Given** the dataset contains 3 PRs by 3 distinct unknown-to-`users` authors with comment activity in the visible range, **When** the breakdown renders, **Then** exactly ONE row labeled "Former / unavailable author" appears with metrics equal to the sum of all 3 PRs' contributions; no per-unknown-author rows appear.
2. **Given** the sentinel row is visible, **When** the user activates a different sort metric, **Then** the sentinel row participates in the new sort order using its summed metric value (it is NOT pinned to top or bottom).
3. **Given** the dataset contains zero unknown-to-`users` PRs in the visible date range, **When** the breakdown renders, **Then** no sentinel row appears.

---

### User Story 5 — Filter-not-supported posture (Priority: P3)

The user has applied a dashboard dimension filter (`repos` / `teams` / `authors` / `reviewers`). They see the per-author breakdown surface in a self-explanatory empty state explaining that per-dimension comments slices are not yet supported.

**Why this priority**: Inherited from 333's FR-1-07 resolution. The dashboard's `applyFiltersToRollups` / `buildFilteredRollup` carry comments namespaces through unchanged via `...rollup` spread; rendering filtered-rollup-driven rows would silently show unfiltered totals while the rest of the dashboard reflects filtered scope — an honesty regression. Hiding the chart entirely was rejected as a worse UX than a visible empty-state shell.

**Independent Test**: With the breakdown rendered (US1 complete), apply a dashboard dimension filter (any of the four). Confirm the breakdown surface remains rendered but its body is replaced by a self-explanatory filter-not-supported empty state, visibly distinct from a no-data-in-range empty state, and disappears cleanly when filters are cleared.

**Acceptance Scenarios**:

1. **Given** the breakdown is rendered and the user activates ANY dashboard dimension filter (`repos` / `teams` / `authors` / `reviewers`), **When** the dashboard re-renders, **Then** the breakdown body shows a filter-not-supported empty state distinct from no-data-in-range; the empty state disappears cleanly when all filters are cleared.

---

### Edge Cases

- **Zero-author week within visible range**: A range may include weeks with no PRs in W's canonical throughput PR set. These weeks contribute zero to all per-author values; if the entire range is zero-PRs (capability-on but empty), the breakdown's body is the no-data-in-range empty state (distinct from filter-not-supported per US5).
- **Single-PR author**: An author with one PR (one comment, one thread) renders as a single row participating in sort / filter exactly like any high-load author row. No special treatment.
- **All-unknown-author week**: Every PR in W is by an author absent from `users`. The sentinel bucket aggregates all contributions; no real-author rows for W. If the entire visible range is sentinel-only, the breakdown shows a single sentinel row.
- **Author appears in multiple weeks with mixed extraction**: If author A has both extracted-comment weeks and unextracted-comment weeks in the visible range, A's row contributes the extracted-subset sums (CL-07 propagation of 333's extracted-subset rule per FR-1-05) AND the row's range-total `coverage_partial` reduces to `true` if any constituent week's per-(week, author) emission has `coverage_partial = true`. The renderer applies the partial-coverage qualifier per FR-4-03.
- **Truncation past top-50**: Authors past the top-50 by chosen metric do not render; truncation indicator surfaces the count of hidden authors. Switching the sort metric may re-rank such that a previously-hidden author appears in the visible top-50 (and a previously-visible author falls below the cap).
- **Capability flips OFF during a session via dataset reload**: The breakdown container removes cleanly without leaving stale geometry on the dashboard layout (333 T021/T025 lifecycle parity).
- **Sort metric switch while range filter changes simultaneously**: The breakdown re-renders once with both the new sort and the new range; no intermediate "stale sort + new range" frame is visible (333 idempotency pattern).
- **`active_thread_count > thread_count` for any per-(week, author) emission** (data integrity violation per INV-2-07): MUST NEVER occur if aggregator and inclusion rules are correct. Treat as a backend bug; the renderer MUST NOT silently coerce. Surfaced via the CL-04 reconciliation extension (FR-2-04) which extends 333's import-block-isolated reconciliation test.
- **Sentinel row collides with real author display name**: Per CL-03, the sentinel uses a reserved aggregator-side key (`__former_or_unavailable_author__`) that cannot collide with author UUIDs, but the renderer-side label "Former / unavailable author" could in principle collide with a real user's display name. If this happens, the renderer MUST disambiguate (e.g., by sentinel-only styling) so users can distinguish the sentinel row from a real-author row of identical name. Plan-level decision.

## Requirements *(mandatory)*

### Functional Requirements — Aggregator emission

- **FR-1-01**: When `capabilities.comments_metrics` is enabled, the aggregator's weekly rollup MUST emit per-author comments-density data covering all authors with at least one PR in W's canonical throughput PR set whose `comments_extracted_at IS NOT NULL`. Emission unit is per-(week, author) tuple.
- **FR-1-02 (emission shape)**: A new optional sub-object `rollup[W].by_author_comments[<author_id>]` MUST be emitted on the rollup root, containing exactly the comments fields (`thread_count`, `comment_count`, `active_thread_count`, `coverage_partial`). Capability-off path: the entire `by_author_comments` key MUST be omitted (FR-3-03 analog from 333). The existing `rollup[W].by_author` namespace remains unchanged in either capability state.
- **FR-1-03 (sentinel bucketing per C1, CL-03)**: The author identifier used as the sub-dict key MUST be:
  - The PR's author identifier (per existing throughput `by_author` keying, which uses `pull_requests.created_by_user_id` or its equivalent; pinned in plan/tasks against the actual current code) when that ID is present in the `users` table.
  - The reserved sentinel literal `__former_or_unavailable_author__` when the ID is absent from `users`. ALL such PRs collapse into this single bucket per 310 C1's "single sentinel identity" rule.
- **FR-1-04 (C1 reference, not re-declaration)**: Per-(week, author) counts MUST apply the C1 inclusion rules from `specs/310-comments-visualization/spec.md` "Shared inclusion-rule contract (C1)". This feature MUST reference that section as the authority and MUST NOT re-declare any inclusion rule. Re-declaration is itself an INV-07 / INV-2-02 violation.
- **FR-1-05 (extracted-subset rule, propagated from 333 FR-2-03)**: Per-(week, author) sums range over the EXTRACTED-SUBSET of W's canonical throughput PR set (PRs with `pull_requests.comments_extracted_at IS NOT NULL`). PRs with `comments_extracted_at IS NULL` contribute zero (equivalent to omission). The numeric values are therefore "known extracted-subset totals," not full-week truth.
- **FR-1-06 (per-author coverage_partial)**: Each per-(week, author) emission MUST carry a `coverage_partial: boolean` field that is `true` if AND ONLY IF at least one of that author's PRs in W's canonical throughput PR set has `comments_extracted_at IS NULL` — even one such PR flips the (week, author) to `true`. The reduction over the visible date range (chart-side) is `true` if any constituent week's per-(week, author) `coverage_partial` is `true`.
- **FR-1-07 (atomicity, propagated from 333 INV-1-08)**: When the `by_author_comments` key is present on a rollup root under capability-on, EVERY entry in the sub-dict (including the sentinel-bucket entry) MUST contain ALL four count fields (`thread_count`, `comment_count`, `active_thread_count`, `coverage_partial`) together. Partial-fielded entries within the sub-dict are forbidden.
- **FR-1-08 (ordering, propagated from 333 INV-1-06)**: For every per-(week, author) emission under capability-on, `active_thread_count <= thread_count` MUST hold. Sentinel-bucket emissions MUST satisfy the same constraint (its summed values derive from constituent PRs each satisfying the constraint). Any aggregator path producing `active_thread_count > thread_count` is a correctness bug, surfaced via FR-2-04.

### Functional Requirements — Cross-feature reconciliation (CL-04)

- **FR-2-01 (per-author parity — pairwise on extracted-subset of drill-down ∩ aggregator intersection)**: For every PR P in the drill-down's top-500-by-cycle-time slice for week W AND in W's extracted-subset (`comments_extracted_at IS NOT NULL` for P), the per-PR `thread_count` / `comment_count` / `active_thread_count` values rendered in the drill-down (310 PrRecord fields) MUST equal P's per-PR contribution to the corresponding numeric fields of the per-(week, author = P's author OR sentinel) aggregate emission. PRs in the drill-down's slice NOT in the extracted-subset are excluded from pairwise numeric comparison; they reconcile via 310 INV-10's per-PR partial sentinel (drill-down null/undefined) AND aggregator's exclude-from-sum (FR-1-05).
- **FR-2-02 (end-to-end aggregator correctness via independent re-computation)**: For each week W and each per-(week, author) emission, the test MUST verify the values match an independent re-computation that:
  1. Determines W's canonical throughput PR set via DIRECT SQL against `pull_requests` — re-implementing the same week-attribution rule throughput uses (per 333 Decision 7 / FR-2-03's parity guard); the test does NOT call into either aggregator's helpers (333 round-9 import-block isolation extends to per-author scope).
  2. Joins each PR with its author identifier per FR-1-03 (sentinel-bucketing applied for unknown-to-`users` authors).
  3. Filters to W's extracted-subset (`comments_extracted_at IS NOT NULL`).
  4. For each (W, author) pair: applies C1 inclusion rules directly against `pr_threads` / `pr_comments`, sums per-PR contributions to produce expected `thread_count` / `comment_count` / `active_thread_count`.
  5. Re-derives expected `coverage_partial = (∃ PR by author A in W's canonical set with comments_extracted_at IS NULL)`; asserts equality with the aggregator's emitted value.
  6. Asserts the aggregator's emitted per-(week, author) value matches field-by-field.
- **FR-2-03 (sentinel parity — propagated from FR-1-03)**: For each week W in the demo dataset, the sentinel bucket's per-(week, sentinel) metrics MUST equal the SUM of contributions from ALL PRs in W's extracted-subset whose `author_id` is absent from `users` — verified by the same independent re-computation (FR-2-02 step 2 + 4). If zero such PRs exist for W, the sentinel bucket MUST NOT be emitted for W.
- **FR-2-04 (test extension target — CL-04)**: The reconciliation test extension lives in `tests/integration/test_comments_trend_reconciliation.py` (extending 333's existing reconciliation test) for FR-2-01 / FR-2-02 / FR-2-03. The 333 import-block isolation test (`tests/integration/test_comments_trend_reconciliation_isolation.py`) covers the extension automatically — aggregator imports from `src/ado_git_repo_insights/transform/aggregators.py` remain forbidden regardless of dimension scope.
- **FR-2-05 (failure-mode meta-test extension)**: The 333 meta-test (`tests/integration/test_comments_trend_meta_failure.py`) MUST be extended (or paralleled — file decision pinned at task time) to inject a per-author INV-2-07 violation (e.g., a sentinel bucket emission with `active_thread_count > thread_count`) AND assert that the FR-2-04 reconciliation test FAILS on the mutated dataset. This catches silent-degrade-to-no-op for the per-author dimension scope (mirrors 333 FR-2-05 for the new dimension).

### Functional Requirements — Capability gating

- **FR-3-01**: When `capabilities.comments_metrics` is NOT enabled, the per-author breakdown surface MUST NOT render in the Metrics tab DOM. The existing surfaces (333 comments-trend chart container omitted as well per 333 FR-3-01; throughput / cycle-time / reviewer-activity / summary-cards) MUST occupy the same layout positions and sizes they did before this feature shipped.
- **FR-3-02 (capability flip lifecycle, propagated from 333 FR-3-02)**: When the capability flag toggles from disabled to enabled or vice versa via dataset reload, the breakdown container MUST appear or disappear cleanly without leaving stale geometry on the dashboard layout. The dashboard call site MUST follow 333 T021/T025 idempotency-and-cleanup parity (insertion uses an `ensure*Container()` helper that returns existing if present, otherwise constructs once; removal uses a `remove*Container()` helper that finds the row by data attribute and removes, no-op if absent).
- **FR-3-03 (capability-off serialization-layer gating, propagated from 333 FR-3-03)**: When `capabilities.comments_metrics` is NOT enabled, the `by_author_comments` key MUST be absent entirely from every week's rollup — explicitly: NOT present, NOT `null`-valued, NOT `{}`-valued (empty object), NOT present-with-partial-fields. The byte-identity test gates ALL FOUR omission failure modes individually. The capability-off byte-identity baseline (per FR-3-01 and SC-1-03) extends to the SERIALIZATION layer: a capability-off-variant manifest MUST be byte-identical to the pre-feature manifest with respect to the `by_author_comments` namespace. The existing `tests/integration/test_demo_variants_byte_identity.py` MUST be tightened to gate this key explicitly.

### Functional Requirements — Render

- **FR-4-01**: When `capabilities.comments_metrics` is enabled, the dashboard MUST render a per-author comment-density breakdown surface on the Metrics tab, positioned BELOW the 333 comments-trend chart and the existing throughput / cycle-time / reviewer-activity surfaces. Each row MUST show the author's display name (or "Former / unavailable author" sentinel label per CL-03) plus three numeric metrics (`thread_count`, `comment_count`, `active_thread_count`).
- **FR-4-02 (range-total reduction)**: The breakdown MUST honor the dashboard's existing date-range filter; changing the range MUST re-render the breakdown summing per-(week, author) contributions across only the weeks falling inside the new range. The reduction unit is range-total per row (one row per author across the visible weeks). Authors with zero contributions in the range MUST NOT render (no zero-rows; zero contributions = absent).
- **FR-4-03 (per-row partial-coverage qualifier)**: When a row's range-total `coverage_partial` reduces to `true` (any constituent week's per-(week, author) `coverage_partial = true`), that row MUST render a partial-coverage qualifier consistent with 333's qualifier convention (the visual style — hatched fill / dimmed color / tooltip — inherits from 333 ADR T005). The qualifier MUST apply only to rows marked partial; non-partial rows render in the normal (non-partial) convention.
- **FR-4-04 (number formatting)**: Each row's three numeric metrics MUST use locale-aware integer formatting with no decimals (counts are whole numbers per FR-1-08), consistent with how throughput / 333's chart present numeric counts.
- **FR-4-05 (sort, CL-05)**: The breakdown MUST be sortable among the three metrics (`comment_count` / `thread_count` / `active_thread_count`); default sort is `comment_count` descending; ties break deterministically — first by author display name ascending, then by author key ascending as the final tie-breaker (handles duplicate display names and sentinel/real-name collisions). The active sort metric MUST be visually indicated. Switching the sort metric MUST re-render rows in the new order.
- **FR-4-06 (display cap, CL-05)**: The breakdown MUST render at most 50 rows (constant `MAX_COMMENTS_AUTHOR_DENSITY_ROWS = 50`) by chosen metric. If more authors have non-zero values than the cap, a truncation indicator MUST surface the count of hidden authors (analog of 333's `MAX_COMMENTS_TREND_POINTS = 104` truncation pattern).
- **FR-4-07 (filter-not-supported posture)**: When ANY of the dashboard's per-PR dimension filters (`repos` / `teams` / `authors` / `reviewers`) is active, the breakdown MUST render a self-explanatory filter-not-supported empty state instead of rows. The empty state MUST be visibly distinct from the no-data-in-range empty state (FR-4-08) AND MUST disappear cleanly when filters are cleared. Per-dimension comments slices that would let the breakdown honor filters are deferred to a future feature (out of foundation-PR scope).
- **FR-4-08 (no-data empty state)**: When the visible date range yields zero authors with non-zero contributions (capability-on path; e.g., zero PRs in range, or all PRs in range have `comments_extracted_at IS NULL`), the breakdown MUST render a self-explanatory no-data-in-range empty state distinct from filter-not-supported (FR-4-07).
- **FR-4-09 (no click-through, CL-06)**: Rows MUST NOT activate any drill-down or per-author detail surface. The breakdown is informational. Plan-level: rows are not styled as clickable. A future per-author drill-down panel is deferred outside this feature.
- **FR-4-10 (a11y)**: The sort selector MUST be keyboard-activatable; the breakdown table (or table-equivalent semantic structure) MUST expose per-row metric values via screen-reader-readable text. Pattern reference: 333 chart's `aria-expanded` / `tabindex` / `role` convention adapted for table rows.

### Cross-feature Invariants

These are inherited or propagated from features 310 / 333 and MUST be honored.

- **INV-2-01 (capability gating — both surfaces)**: Both the new aggregator emission and the new breakdown render MUST be gated on `capabilities.comments_metrics`. Off → no aggregator emission AND no chart container.
- **INV-2-02 (cross-feature inclusion-rule coherence)**: C1 applies identically to drill-down (310), weekly aggregate (333), and this feature's per-(week, author) aggregate, on every PR all surfaces touch. Reconciliation test (FR-2-04) is the executable closure.
- **INV-2-03 (C1 reference, not re-declaration)**: This spec MUST NOT contain inclusion-rule statements that re-declare 310's C1. Where C1 rules need to be invoked, this spec references the authoritative subsection by file + section anchor text.
- **INV-2-04 (PowerBI CSV contract is frozen)**: Inherits 310 INV-05 / 333 INV-1-04. No producer CSV changes.
- **INV-2-05 (extractor is frozen)**: Inherits 310 INV-06 / 333 INV-1-05. Source reads stay within `pr_threads` / `pr_comments` / `users` (read-only join for sentinel detection).
- **INV-2-06 (no team-dimension surfaces)**: Inherits 310 INV-03. Per-team breakdown is sibling #321's scope (on-hold pending team-at-time-of-PR history).
- **INV-2-07 (active-thread-count ordering, propagated to per-author)**: For any per-(week, author) emission (including sentinel), `active_thread_count <= thread_count`.
- **INV-2-08 (atomicity, propagated to per-author scope)**: When the `by_author_comments` sub-object is present, atomicity holds per FR-1-07: every entry in the sub-dict carries all four fields together. INV-1-08 from 333 propagates as sub-object atomicity for this feature's parallel namespace.
- **INV-2-09 (capability-off byte-identity, propagated from 333 FR-3-03 / SC-1-04)**: Per FR-3-03; capability-off variant manifest MUST be byte-identical to the pre-feature manifest with respect to the `by_author_comments` namespace.
- **INV-2-10 (top-500 cap preserved — chart aggregates over full extracted-subset)**: Inherits 310 INV-02. Per-author totals span W's full extracted-subset (chart-side, not the drill-down's slice) — propagating 333 Decision 3 / FR-2-03.
- **INV-2-11 (filter spread risk acknowledged)**: The dashboard's `applyFiltersToRollups` / `buildFilteredRollup` carry the `by_author_comments` namespace through unchanged via `...rollup` spread. Honest rendering under active filters requires the filter-not-supported posture per FR-4-07; silent under-filtering is forbidden. Per-dimension comments slices that would let the breakdown honor filters are deferred to a future feature.

### Key Entities

- **Per-author comments-density emission** (new): the per-(week, author) record this feature emits as `rollup[W].by_author_comments[<author_id>]` — a parallel sub-object on the rollup root, mirroring 333's `rollup[W].comments` pattern. Fields: `thread_count`, `comment_count`, `active_thread_count`, `coverage_partial`. Capability-off omits the entire key.
- **"Former / unavailable author" sentinel** (CL-03): single aggregator-side bucket key — reserved literal `__former_or_unavailable_author__` — for ALL PRs whose `author_id` is absent from `users`. Renderer-side label: fixed string "Former / unavailable author" (English-only for v1).
- **Per-author comment-density breakdown chart** (new): the dashboard surface that renders range-total per-author rows, sortable among three metrics, capped at 50 rows.
- **Comment thread / comment / user / PR record / capability flag / 333 weekly comments aggregate** (existing — see 310 spec and 333 spec Key Entities; this feature does NOT modify them).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-1-01**: A team lead opening the dashboard with `capabilities.comments_metrics` enabled identifies the highest-`comment_count` author in the visible date range with no interaction beyond visual scan of the breakdown's top row. (Tests US1 — first-glance comprehension; success means default sort + visual hierarchy yields the answer immediately.)
- **SC-1-02**: With three sort-metric options, a team lead identifies the highest-`thread_count` author in ≤2 interactions (one click to switch sort, one visual scan). (Tests US2.)
- **SC-1-03**: With `capabilities.comments_metrics` disabled, the dashboard's Metrics tab renders identically to its pre-feature (pre-334) baseline — no new breakdown container, no layout shift, no new banner. Verifiable by a baseline-comparison check against the release preceding this feature. (Tests US3 — analog of 333 SC-1-04 for this feature's namespace.)
- **SC-1-04**: Datasets containing ≥1 PR by an unknown-to-`users` author render exactly ONE sentinel row labeled "Former / unavailable author" aggregating ALL such PRs' contributions; no per-unknown-author rows appear; the sentinel row participates in sort exactly like real-author rows. (Tests US4.)
- **SC-1-05**: When ANY dimension filter is active, the breakdown communicates the filter-not-supported state within the rendered dashboard — the filter-not-supported empty state appears in place of rows; silent under-filtering is never visible. (Tests US5.)
- **SC-1-06 (cross-feature coherence — INV-2-02 closure)**: For every PR P in the drill-down panel for week W AND in W's extracted-subset, the per-PR `thread_count` / `comment_count` / `active_thread_count` values from the drill-down equal P's per-PR contribution to the corresponding numeric fields of the per-(week, author = P's author OR sentinel) aggregate emission. Additionally, for every (week W, author A) tuple, the aggregate emission equals the result of an independent re-computation per FR-2-02. The independent re-computation MUST share no code with EITHER aggregator. Verified by the FR-2-04 test extension running in CI on the demo dataset.

## Assumptions

- **A-01**: The `capabilities.comments_metrics` flag exists in the dataset capability schema and is correctly populated by the demo dataset for capability-on and capability-off variants. Inherits from 333 A-01; no new producer-side capability schema work in this feature.
- **A-02**: The dashboard's existing date-range filter and rendering primitives can be reused without modification by this feature's breakdown module. Pattern reference: 333 chart's range-filter consumption (`hasComments` filter at the chart boundary) and reviewer-activity's row-rendering style.
- **A-03**: The demo dataset can be regenerated to include ≥10 distinct authors with mixed comment-load (US1), ≥1 unknown-to-`users` author with non-zero PRs (US4), and at least one author with mixed extraction so the per-row `coverage_partial` qualifier edge case (FR-4-03) is exercised. Pinned at task time via `manage_generated_artifacts.py sync --scope all --stage`.
- **A-04**: The aggregator can read `pr_threads` / `pr_comments` / `users` (LEFT JOIN for sentinel detection) for any PR in W's canonical throughput PR set whose `comments_extracted_at IS NOT NULL`. INV-2-05 frozen-extractor preserved (no extractor changes; only producer-side reads).
- **A-05**: The 333 reconciliation test infrastructure (`test_comments_trend_reconciliation.py` + `_isolation.py` + `_meta_failure.py`) is the right test site to extend for FR-2-04 / FR-2-05. The import-block isolation guarantee from 333 round-9 is by-file (`src/ado_git_repo_insights/transform/aggregators.py`), not by-dimension; it propagates automatically when per-author emission is added to the same source file.
- **A-06**: The `MAX_COMMENTS_AUTHOR_DENSITY_ROWS = 50` cap (CL-05) is sufficient for visual scan-ability on the demo dataset. Exact value tunable in plan/tasks without spec changes.
- **A-07**: The reserved sentinel literal `__former_or_unavailable_author__` (CL-03) is namespace-safe — author_id values in production are UUID-format strings (32 hex chars + 4 hyphens) per the existing extractor, and cannot collide with the leading-double-underscore literal. Plan-level: a grep over historical `pr_comments.author_id` values in the test fixtures verifies non-collision.
- **A-08**: Sibling features #335 (per-repo) and #336 (per-reviewer) will inherit the visual + interaction pattern — chart shape (rows ranked by metric), sort selector (3 metrics), top-N cap, filter-not-supported posture, sentinel mechanics where applicable — locked by this feature. Pattern-reuse vs. code duplication is plan-level for those PRs; this spec does not constrain their implementation choices.
- **A-09**: Author display-name resolution (mapping author_id → human-readable label for FR-4-01) uses the existing `users` table data via the existing `authorsDimension` pattern. The sentinel label is a fixed string (CL-03) that bypasses `users` lookup.

## Out of Scope

- Per-repo dimension → **#335** (open, sequenced after this; pattern inherits from this PR).
- Per-reviewer dimension → **#336** (open, sequenced after #335; carries 310 C2 reviewer-semantics — `pr_comments.author_id` ≠ PR author).
- Per-team dimension → **#321** (open, on-hold; blocked on team-at-time-of-PR history modeling).
- Weekly-axis per-author breakdowns → 333 trend chart owns the weekly cadence; redundant here.
- Per-dimension filter integration (filtered-rollup-driven rows under active dimension filters) → future feature (FR-4-07 locks the filter-not-supported posture for this foundation PR).
- Per-author drill-down panel → future feature (CL-06 = no click-through ships without it).
- AI summarization, privacy-posture framing, comment body content → 322 / 182 noted out-of-scope.
- Lifting 310 INV-02 top-500 drill-down cap → 333 explicitly preserved; this feature inherits.
- Extending `scripts/check_pr_record_schema_parity.py` → 333 Decision 5 non-extension posture inherits (CL-08 = follow 333).
- Modifying C1 (310's authoritative inclusion-rule contract) → reference, do not redeclare.
- Modifying 310 INV-03 (no team-dimension surfaces in this feature).
- Modifying CSV contract or extractor (310 INV-05/06 / 333 INV-1-04/05) — frozen.
- Localizing the "Former / unavailable author" label (i18n posture: fixed English string for v1; localization deferred).
- Modifying the existing throughput `by_author` semantics (this feature ADDS a parallel `by_author_comments` namespace; throughput's existing emission shape is unchanged).
- Changing the existing 333 chart's filter-not-supported message text — that text is 333's locked decision; this feature's filter-not-supported message (per FR-4-07) is its own surface.
