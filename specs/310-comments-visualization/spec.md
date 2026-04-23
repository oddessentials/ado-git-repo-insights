# Feature Specification: Comment visualization and utilization — Drill-down extension (Capabilities 3 + 4)

**Feature Branch**: `310-comments-visualization`
**Created**: 2026-04-21
**Status**: Draft (Pass 2 complete — all clarifications resolved; planning-readiness requires Pass 3 code-validation)
**Issue**: #182
**Input**: Issue #182 body, rewritten 2026-04-21 to articulate four capabilities. After Pass 2 clarifications, this feature ships **only Capabilities 3 and 4** (the drill-down extension). Capabilities 1 and 2 (dashboard trend chart + density breakdowns) are deferred to a follow-on feature per C5's resolution; see Overview.

## Overview

Comment data (threads, replies, status, authors, timestamps) is extracted today via Feature 058, but the only surface that shows anything about it is a small "Comments coverage" banner. Issue #182 articulated four capabilities to close that visibility gap. After Pass 2 clarifications, the work is split across two features:

- **This feature (310)** — ships the drill-down extension: per-PR discussion-depth indicators (thread count, comment count) and a per-PR unresolved-thread indicator, layered onto the already-released Feature 060 drill-down panel (PR #317, extension release 101.13.0). Small, self-contained, reuses the existing panel contract.
- **Follow-on feature (separate spec, to be created)** — ships the dashboard additions: Capability 1 (weekly discussion-volume trend chart with `comment_count` / `thread_count` / `active_thread_count` series) and Capability 2 (per-author / per-repo / per-reviewer density breakdowns). New aggregator routes and new chart / breakdown UI surfaces.

**Why the split (C5 resolved to (b) on 2026-04-21)**: The drill-down extension is a small patch to an already-released panel; the dashboard work is new aggregator + new UI. Shipping the drill-down first delivers immediate user-visible value (answering "which PRs got hot this week?" and "what's our per-PR unresolved backlog?") without blocking on aggregator design, chart layout, or breakdown-dimension decisions. Cross-feature coherence of inclusion rules is enforced by the **Shared inclusion-rule contract (C1)** in the Requirements section — the follow-on feature MUST reference this contract rather than re-declaring inclusion rules. This avoids the biggest risk of a unified feature: partial delivery with drifting invariants (INV-07).

This feature is additive and gated on `capabilities.comments_metrics`. The drill-down panel MUST render byte-identical to its pre-feature baseline for users without comment extraction enabled.

## Clarifications

### Session 2026-04-21

- Q: C1 — metric inclusion rules for `thread_count`, `active_thread_count`, and `comment_count` across the five schema axes? → A: **Standard review-activity preset** (Option C with wording tweak on the sentinel). Resolved toggles: `pr_threads.is_deleted = 1` → **exclude**; `pr_threads.status = 'unknown'` → **include** (counts as an ordinary thread, which naturally excludes it from `active_thread_count`); `pr_comments.comment_type = 'system'` → **include** (system events count toward `comment_count`); `pr_comments.is_deleted = 1` → **exclude**; authors missing from the `users` table → **bucket under a single sentinel identity "Former / unavailable author"** (neither drop nor merge with real users). Authoritative site: the "Shared inclusion-rule contract (C1)" subsection in Requirements.
- Q: C2 — reviewer semantics in Capability 2? → A: **Commenting-author heuristic** (Option B). Reviewer is defined as any distinct `pr_comments.author_id` who commented on a PR where that commenter ≠ the PR's author. Source read is `pr_comments` alone (no reviewer-relation table dependency — preserves INV-06 / extractor-frozen). Silent assigned reviewers are **not counted**; drive-by commenters **are counted**. Applies only to Capability 2 (follow-on feature); preserved here as a session record for the follow-on spec to pick up.
- Q: C3 — density unit for Capability 2 breakdowns? → A: **Per PR — range total** (Option A). Each breakdown row is a sum over the user-selected date range — one row per (dimension_value) across author / repo / reviewer. No iso_week axis in Capability 2; weekly cadence is covered by Capability 1 and duplicating it here would be redundant. Aggregator output is one row per dimension value; chart renders as a bar chart ordered by count with no time dimension. Applies only to Capability 2 (follow-on feature); preserved here as a session record for the follow-on spec to pick up.
- Q: C4 — team-at-time-of-PR limitation? → A: **Defer the team slice** (Option B). No per-team breakdown, no team-level unresolved-thread indicator — in either this feature or the follow-on. The per-PR unresolved-thread indicator remains in scope for this feature. Rationale: retroactive-current-state attribution is a known-misleading dimension; shipping it (even with a caveat) creates trust and explanation churn disproportionate to the signal. INV-03 is the authoritative site; Out of Scope reaffirms it.
- Q: C5 — scope unification? → A: **Split into two features** (Option B). This feature (310) narrows to Capabilities 3 + 4 (drill-down extension); a follow-on feature delivers Capabilities 1 + 2 (dashboard trend chart + density breakdowns). Cross-feature coherence (INV-07) MUST be enforced by having the follow-on feature reference this spec's "Shared inclusion-rule contract (C1)" rather than re-declaring inclusion rules. This avoids partial-delivery drift and ships user-visible value fastest; drill-down changes stay within the existing 060 panel contract while dashboard work can evolve independently.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Discussion-depth indicators on the PR drill-down (Capability 3, Priority: P1)

A team lead opens the Feature 060 drill-down panel on a week that shipped a cluster of long-cycle PRs and sees, for each PR in the list, how many threads and comments the PR accumulated. They sort the list by thread count to find the heavily-discussed PRs among the shipped set, and scan whether discussion depth tracks cycle time for this week.

**Why this priority**: Capability 3 extends the already-shipped Feature 060 `PrRecord` contract with two numeric fields plus list sort/filter. It is the smallest visible surface (no new charts; no new aggregator routes) and delivers "which PRs got hot this week" directly to a surface users already visit. It also subsumes any standalone "hot PR" ranking.

**Independent Test**: Load a demo dataset that includes comments data, open the throughput or cycle-time chart drill-down for a week known to contain both heavily-discussed and lightly-discussed PRs, and confirm the drill-down list (a) shows per-PR thread and comment counts, (b) can be sorted by each of those counts, and (c) can be filtered to PRs above a chosen threshold. Capability 4 (per-PR unresolved-thread count) is not required to be present.

**Acceptance Scenarios**:

1. **Given** a dataset where `capabilities.comments_metrics` is enabled and the week contains PRs with varying discussion depth, **When** the user opens the drill-down panel for that week, **Then** each PR row shows thread count and comment count, and the list is sortable by those columns.
2. **Given** the same drill-down open, **When** the user applies a filter "threads ≥ 5", **Then** the list narrows to PRs meeting that threshold while preserving the panel's existing sort/filter behavior on other columns.
3. **Given** a dataset where `capabilities.comments_metrics` is NOT enabled, **When** the user opens the same drill-down panel, **Then** no thread or comment columns appear and the panel renders exactly as it did pre-feature.
4. **Given** the drill-down panel's existing top-500-per-week cap (locked by Feature 060), **When** a week has more than 500 qualifying PRs, **Then** thread and comment counts cover only the top-500-by-cycle-time-descending slice; PRs outside that slice are not surfaced per-PR in the drill-down.

---

### User Story 2 - Per-PR unresolved-thread indicator on the PR drill-down (Capability 4, Priority: P2)

A team lead scanning the same drill-down list wants to know which shipped PRs still carry unresolved review discussion. They see, for each PR row, the count of threads still in `active` status — making per-PR unresolved load visible without opening each PR individually.

**Why this priority**: Capability 4's per-PR indicator is one additional numeric field on the same `PrRecord` contract extended by Capability 3. It reuses the inclusion rules and `pr_threads` read path from Capability 3. Sequencing it just after P1 lets both capabilities ship as a single drill-down patch. Per C4's resolution, there is no team-level aggregate for unresolved threads; this per-PR indicator is the entire Capability-4 surface in this feature.

**Independent Test**: Load a demo dataset with threads distributed across `active`, `fixed`, `wontFix`, `closed`, `byDesign`, `pending`, and `unknown` states. Open the per-PR drill-down panel and confirm each PR row shows an unresolved-thread count that reflects only threads with `pr_threads.status = 'active'` (after applying the Shared inclusion-rule contract). Capability 3 numbers from User Story 1 may or may not be present; Capability 4's test is independent.

**Acceptance Scenarios**:

1. **Given** `capabilities.comments_metrics` is enabled and a dataset with mixed thread states, **When** the user opens the drill-down panel for a week, **Then** each PR row shows an unresolved-thread (`active`) count in addition to total threads and total comments.
2. **Given** a PR with all threads resolved, **When** the drill-down renders that PR's row, **Then** the unresolved count is explicit `0` (not blank, not `—`), distinguishable from a true "no comment data yet" state.
3. **Given** `capabilities.comments_metrics` is NOT enabled, **When** the user opens the dashboard or drill-down, **Then** no unresolved-thread indicator is rendered.

---

### Edge Cases

- **Zero-comment PRs in the drill-down**: A week may contain PRs with zero comments and zero threads. These should render explicit zeros (not blank / not "—") so the absence is distinguishable from "comment data missing for this PR."
- **PR with comments but no threads**: The extraction schema permits `pr_comments` rows without an associated `pr_threads` row (system messages, direct PR-level comments). Per the Shared inclusion-rule contract (C1), these comments contribute to `comment_count` even when they don't contribute to `thread_count`.
- **Week inside top-500 cap but some PRs have no comment data yet**: If Feature 058 backfill has not reached some PRs in the top-500 slice, their per-PR thread/comment/active-thread counts should render distinctly from a true zero (i.e., "coverage partial for this PR" vs "zero comments"). FR-3-05 governs presentation.
- **PR author or commenter is a deprovisioned user**: Per the Shared inclusion-rule contract (C1), such rows are counted toward `comment_count` / `thread_count` / `active_thread_count` — the "Former / unavailable author" sentinel label is a rendering rule for the follow-on feature's per-author / per-reviewer breakdowns and has no visible effect in this feature's per-PR counts.
- **`comments_metrics` toggle flip mid-session**: If a dataset reload changes the capability flag state, the drill-down panel must correctly add or remove its new columns without stale geometry persisting (the Feature 060 panel lifecycle governs this).

## Requirements *(mandatory)*

### Shared inclusion-rule contract (C1)

This subsection is the authoritative site for C1's inclusion rules. **Cross-feature authority**: the follow-on feature (Capabilities 1 + 2) MUST reference this subsection rather than re-declaring inclusion rules. Drift between this spec's drill-down totals and the follow-on feature's aggregator output is the primary INV-07 risk.

The following toggle set governs `comment_count`, `thread_count`, and `active_thread_count` wherever any of those values is computed (this feature's per-PR counts; the follow-on feature's weekly trend series and per-dimension breakdowns):

- Rows where `pr_threads.is_deleted = 1` MUST be excluded from every thread count.
- Threads where `pr_threads.status = 'unknown'` MUST be included in `thread_count`. They do NOT contribute to `active_thread_count` (the `active_thread_count` filter is `status = 'active'`).
- Comments where `pr_comments.comment_type = 'system'` MUST be included in `comment_count`.
- Rows where `pr_comments.is_deleted = 1` MUST be excluded from `comment_count`.
- Comments or threads whose author (`pr_comments.author_id` or the equivalent thread author) is missing from the `users` table MUST be bucketed under a single sentinel identity rendered as **"Former / unavailable author"** — not dropped, and not merged with any real user. (The sentinel label is only visible when a per-author or per-reviewer dimension is rendered — i.e., in the follow-on feature. In this feature's per-PR counts, the rows are counted; the sentinel label has no visible rendering site.)

These rules are cross-feature authoritative (INV-07 coherence).

### Functional Requirements — Capability 3: Discussion-depth indicators on the PR drill-down

- **FR-3-01**: When `capabilities.comments_metrics` is enabled, the Feature 060 drill-down panel MUST show, for each PR in its list, per-PR thread count and per-PR comment count, computed using the Shared inclusion-rule contract (C1).
- **FR-3-02**: The drill-down list MUST be sortable by thread count and by comment count.
- **FR-3-03**: The drill-down list MUST be filterable by thread count and by comment count (threshold filter; exact filter UI pattern is an implementation detail).
- **FR-3-04**: Capability 3 MUST operate on the Feature 060 top-500-per-week slice only; this spec MUST NOT propose lifting that cap.
- **FR-3-05**: When a PR in the top-500 slice has partial/missing comment coverage, its row MUST render all three numeric fields (`thread_count`, `comment_count`, and the `active_thread_count` from FR-4-01) together in a consistent "coverage partial" state distinguishable from a true-zero state (exact presentation is an implementation detail; the all-or-nothing consistency contract is governed by INV-10).
- **FR-3-06**: When `capabilities.comments_metrics` is NOT enabled, the drill-down panel MUST render byte-identical to its pre-feature baseline (no new columns, no shifted layout).

### Functional Requirements — Capability 4: Per-PR unresolved-thread indicator

- **FR-4-01**: When `capabilities.comments_metrics` is enabled, the drill-down panel MUST show, for each PR in its list, a per-PR unresolved-thread count (threads where `pr_threads.status = 'active'` after applying the Shared inclusion-rule contract). This count is in addition to FR-3-01's total thread and total comment counts.
- **FR-4-02**: The unresolved-thread count MUST be sortable and filterable using the same panel mechanisms as FR-3-02 / FR-3-03.
- **FR-4-03**: "Unresolved" MUST be defined as threads whose `pr_threads.status = 'active'`. Deleted threads are excluded per C1; unknown-status threads are counted in `thread_count` but NOT in the unresolved count (they are not `status = 'active'`).
- **FR-4-04**: Per INV-03 (C4 resolved to defer team slice), no team-level unresolved-thread indicator ships with this feature; Capability 4's entire visible surface is this per-PR indicator.
- **FR-4-05**: When `capabilities.comments_metrics` is NOT enabled, no unresolved-thread indicator MUST appear on the drill-down panel.

### Cross-capability and Cross-feature Invariants

These are asserted by the issue body and the clarifications resolved on 2026-04-21. They are NOT deferred decisions.

- **INV-01 (capability gating)**: Both capabilities MUST be gated on `capabilities.comments_metrics`. When the capability is not enabled, no surface added by this feature MUST render, and the drill-down panel MUST remain byte-identical to its pre-feature rendering.
- **INV-02 (drill-down slice inheritance)**: Capability 3 and Capability 4 MUST operate on the top-500-per-week-by-cycle-time-descending slice that is locked by Feature 060. Lifting that cap is explicitly out of scope.
- **INV-03 (no team dimension)**: This feature MUST NOT introduce a per-team breakdown or a team-level unresolved-thread indicator. Per C4's resolution, team-at-time-of-PR history is not modeled here and remains a future-feature concern.
- **INV-05 (PowerBI CSV contract is frozen)**: This feature MUST NOT change the core PowerBI CSV contract. Out of scope.
- **INV-06 (extractor is frozen)**: This feature MUST NOT change the extractor. Raw comment data is complete as of Feature 058 (PR #292). Out of scope.
- **INV-07 (inclusion-rule coherence — cross-feature)**: The Shared inclusion-rule contract (C1) MUST apply identically in this feature's per-PR counts AND in the follow-on feature's aggregator output. Specifically: for any PR visible in this feature's drill-down, its thread/comment/active-thread count MUST equal the same PR's contribution to the follow-on feature's weekly trend series and per-dimension breakdown totals (when both features are deployed). The follow-on feature's spec MUST reference this spec's Shared inclusion-rule contract as the authority; it MUST NOT re-declare C1 rules.
- **INV-08 (drill-down field atomicity)**: When `capabilities.comments_metrics` is enabled and the drill-down panel renders a PR row, all three numeric fields (`thread_count`, `comment_count`, `active_thread_count`) MUST be present together. No partial-field state is permitted — e.g., a row that carries `thread_count` and `comment_count` but omits `active_thread_count` is a schema-shape violation. This prevents mixed-schema UI states where some PRs in the same list show two fields while others show three, and it forces both capabilities to land together in any release (Capability 3's two fields and Capability 4's one field are an indivisible unit in the rendered contract).
- **INV-09 (active-thread-count ordering)**: For any PR row rendered by this feature, `active_thread_count ≤ thread_count` MUST hold. `active` threads (per `pr_threads.status = 'active'`) are a subset (possibly equal) of all included threads after applying C1's inclusion rules. Any render / aggregator path that produces `active_thread_count > thread_count` for a PR is a correctness bug, not a coverage-partial state.
- **INV-10 (coverage-partial state consistency)**: When a PR in the top-500 slice has partial/missing comment coverage, all three numeric fields (`thread_count`, `comment_count`, `active_thread_count`) MUST enter the "coverage partial" state together. Per-field divergence is forbidden — e.g., `thread_count` rendering as a number while `comment_count` renders as "partial" is a contract violation. The "coverage partial" state MUST be visibly distinguishable from a true-zero state on all three fields at once. FR-3-05 is the presentation site; this invariant is the all-or-nothing consistency contract underneath it.

### Deferred Decisions

All five decisions surfaced at /speckit.specify were resolved during /speckit.clarify on 2026-04-21. Authoritative-site pointers are below; full decision records are in the Clarifications section.

- **C1 — metric inclusion rules** — **RESOLVED**. Authoritative site: Shared inclusion-rule contract (above). Applies cross-feature.
- **C2 — reviewer semantics in Capability 2** — **RESOLVED**. Applies only to the follow-on feature's Capability 2 (per-reviewer breakdown); preserved in Clarifications as a session record for the follow-on spec.
- **C3 — density unit for Capability 2** — **RESOLVED**. Applies only to the follow-on feature's Capability 2 (breakdown density); preserved in Clarifications as a session record for the follow-on spec.
- **C4 — team-at-time-of-PR limitation** — **RESOLVED**. Authoritative site: INV-03. Applies cross-feature (no per-team dimension in either this feature or the follow-on).
- **C5 — scope unification** — **RESOLVED**. Authoritative site: Overview's "Why the split" paragraph + INV-07. This feature narrowed to Capabilities 3 + 4; follow-on feature (separate spec) will deliver Capabilities 1 + 2.

### Key Entities

- **Comment thread** (existing, from Feature 058 — `pr_threads`): A review thread attached to a PR, with a status lifecycle (`active`, `fixed`, `wontFix`, `closed`, `byDesign`, `pending`, `unknown`) and a deletion flag. Used here to compute per-PR `thread_count` and per-PR `active_thread_count`.
- **Comment** (existing, from Feature 058 — `pr_comments`): An individual reply within a thread (or a direct PR-level message / system event), with an author, timestamp, comment type (including a `system` type), and deletion flag. Used here to compute per-PR `comment_count`.
- **User** (existing — `users`): Referenced by `pr_comments.author_id` and thread authors. May be missing for deprovisioned authors; per C1 such rows are counted in per-PR totals and bucket under the sentinel label in the follow-on feature.
- **PR record contract** (existing, from Feature 060 — `PrRecord`): The per-PR payload rendered in the drill-down panel. This feature extends it with three numeric fields: `thread_count`, `comment_count`, `active_thread_count`.
- **Capability flag** (existing — `capabilities.comments_metrics`): Boolean gate controlling whether any surface added by this feature renders. Assumed to exist; verification is Pass 3 work.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-01**: A team lead opening a demo dataset with `capabilities.comments_metrics` enabled can, from the drill-down panel alone, identify the most-discussed PR of a given week (by thread count or by comment count) in two or fewer interactions (sort + read).
- **SC-02**: A team lead can, from the drill-down panel, identify all PRs in the week's top-500 slice that still have any unresolved (`active`) threads by sorting or filtering on the unresolved-thread column.
- **SC-03**: With `capabilities.comments_metrics` disabled, the drill-down panel renders byte-identical to its pre-feature (pre-310) baseline — no new columns, no shifted layout. Verifiable by a baseline-comparison check against the release preceding this feature.
- **SC-04**: For any PR row visible in the drill-down panel with `capabilities.comments_metrics` enabled, its per-PR `thread_count`, `comment_count`, and `active_thread_count` values are reproducible by a caller that reads `pr_threads` and `pr_comments` directly and applies the Shared inclusion-rule contract (C1). This is the INV-07 in-feature closure check.
- **SC-05 (deferred — cross-feature coherence; not a runtime requirement of this feature)**: This is a deferred cross-feature validation, not a runtime contract of feature 310. **This feature does NOT ship or execute SC-05's check**; feature 310's acceptance is complete at SC-01..SC-04. When the follow-on feature (Capabilities 1+2) ships, for any PR visible in this feature's drill-down, its `thread_count` MUST equal the follow-on feature's aggregator's per-PR contribution to that week's trend-series `thread_count` bucket. The verification artifact (reconciliation test) is created by the follow-on feature's `/speckit.plan` and runs as part of the follow-on feature's CI — not this feature's. SC-05 is declared here only to make the INV-07 obligation visible; its satisfaction is the follow-on feature's responsibility.

## Assumptions

- **A-01**: The `capabilities.comments_metrics` flag exists in the aggregator / dashboard schema. **Pass 3 code-validation** MUST verify this against the current aggregator manifest and capability-gate implementation before this spec is considered planning-ready.
- **A-02**: Feature 060's `PrRecord` contract is the extension point for this feature. Adding three numeric fields to that contract is the intended path and does not require a new drill-down panel.
- **A-03**: Raw comment data (threads, comments, users) is complete as of Feature 058 (PR #292); this feature is aggregator + drill-down contract extension only.
- **A-04**: The existing drill-down panel (Feature 060) uses a consistent capability-gate pattern for optional columns; this feature follows the same pattern rather than introducing a new one.
- **A-05**: A follow-on feature covering Capabilities 1 + 2 will be created as a separate spec and will reference this spec's Shared inclusion-rule contract (C1) as the authority. The follow-on spec is a prerequisite for SC-05's cross-feature closure check to become executable.
- **A-06**: Demo datasets used for acceptance testing carry both `capabilities.comments_metrics = true` payloads and a `capabilities.comments_metrics = false` baseline, so SC-03's zero-change contract can be verified.

## Out of Scope

- Changes to the core PowerBI CSV contract.
- Changes to the comment extractor (raw comment data is complete as of Feature 058).
- Lifting the Feature 060 top-500-per-week drill-down cap.
- **Capability 1 (weekly discussion-volume trend chart)** and **Capability 2 (per-author / per-repo / per-reviewer density breakdowns)** — deferred to a follow-on feature per C5's resolution. The follow-on's spec, plan, and tasks.md are separate from this feature's.
- Per-team breakdowns and team-level unresolved-thread indicators. Per C4's resolution, the team slice is deferred across both this feature and the follow-on; per-team visibility remains contingent on team-at-time-of-PR history being modeled in a future feature.
- AI summarization of review discussions.
- Privacy-posture framing around comment content (comment body text is out of scope; only counts and thread metadata).
- New freshness / coverage signals beyond those already in place.
