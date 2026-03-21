# Feature Specification: Roadmap Blocker Resolution

**Feature Branch**: `032-roadmap-blocker-resolution`
**Created**: 2026-03-20
**Status**: Draft
**Input**: User request to resolve as much of roadmap blockers B-04, B-05, B-06, and B-11 as possible.

## Summary

Resolve the open product and architecture blockers that currently prevent clean implementation of reviewer filtering and comment analytics. This spec makes reviewer filters and comments implementation-ready now.

## Governing Decisions

These decisions are the purpose of this spec. If a later task conflicts with one of them, the decision must be revisited explicitly rather than drift by implementation.

### Decision 1: Reviewer Phase 1 Excludes Review Latency

Reviewer filtering Phase 1 does **not** include `avg_time_to_review`, `review_time_p50`, or any review-latency metric. The current `reviewers` table does not store a `reviewed_at` timestamp, and Phase 1 should not block on a schema migration plus re-extraction campaign.

Review latency is deferred to Reviewer Phase 2 and becomes available only after:
- a `reviewed_at` column exists in the persisted review event model,
- extractors populate it reliably,
- backfill/re-extraction guidance exists,
- and dashboard schema support is added deliberately.

### Decision 2: Approval Rate Uses Final Reviewer Outcome Per PR

Reviewer approval rate is defined as:

`approval_rate = approved_prs / reviewed_prs`

Where:
- `reviewed_prs` = count of distinct PRs in the period where the reviewer has a stored review outcome
- `approved_prs` = count of those PRs where the stored review vote is approval-equivalent

For Azure DevOps Phase 1, approval-equivalent means `vote == 10`.

Rationale:
- the current schema enforces one reviewer row per `(pull_request_uid, user_id)`,
- this makes PR-level final-outcome semantics stable and easy to explain,
- and it avoids inflated denominators from multi-event review histories that are not currently preserved.

### Decision 3: Reviewer Metrics Use a Dedicated Breakdown Type

Reviewer slices do **not** reuse the generic `BreakdownEntry` shape. Reviewer metrics have a different semantic contract and should use a dedicated `ReviewerBreakdownEntry`.

Phase 1 `ReviewerBreakdownEntry` fields:
- `reviewed_prs`
- `reviews_count`
- `approval_rate`
- `authors_count`
- `repositories_count`

Explicitly omitted in Phase 1:
- `cycle_time_p50`
- `cycle_time_p90`
- `review_time_p50`
- `review_time_p90`

Rationale:
- reviewer analytics are about review activity, not PR delivery latency,
- optional-field overloading would create ambiguous null-heavy schemas,
- and a dedicated type keeps dashboard logic and compatibility rules explicit.

### Decision 4: Comments Dashboard Ships as Metrics, Not Comment Browsing

Comments completion Phase 1 focuses on aggregate metrics and coverage transparency, not raw comment text browsing.

Minimum dashboard scope:
- summary cards for `threads`, `comments`, `comments_per_pr`, `resolved_threads_rate`
- weekly trend chart for comment volume
- repository breakdown for comment activity
- coverage/capped indicator when extraction limits may have truncated data

Explicitly out of scope for Phase 1:
- raw thread browser
- full comment text search
- sentiment analysis
- engagement scoring

## User Stories & Acceptance

### User Story 1 - Reviewer Filters Become Implementation-Ready

A developer can implement reviewer filters without needing unresolved product calls on approval rate, review latency, or schema shape.

**Independent Test**: A design review can answer reviewer slice shape, approval-rate semantics, and Phase 1/Phase 2 boundary from the spec alone.

**Acceptance Scenarios**:

1. **Given** reviewer filtering work starts, **when** the backend schema is designed, **then** it uses `ReviewerBreakdownEntry` instead of overloading `BreakdownEntry`.
2. **Given** approval-rate calculations are implemented, **when** a reviewer has 8 reviewed PRs and 5 approvals, **then** `approval_rate` is `0.625`.
3. **Given** the current `reviewers` table lacks `reviewed_at`, **when** reviewer Phase 1 ships, **then** no review-latency metric is exposed.
4. **Given** review-latency support is later added, **when** `reviewed_at` is persisted and backfilled, **then** it lands as Reviewer Phase 2 rather than a hidden Phase 1 dependency.

### User Story 2 - Comments Completion Has a Concrete Dashboard Contract

A developer can complete the comments pipeline without inventing the dashboard scope during implementation.

**Independent Test**: A design review can answer which comment metrics appear in JSON, which appear in the dashboard, and how capped coverage is communicated.

**Acceptance Scenarios**:

1. **Given** comment extraction is enabled, **when** aggregate outputs are generated, **then** they include comment metrics rather than only a feature flag.
2. **Given** comment extraction was limited by CLI caps, **when** the dashboard loads, **then** it shows a capped/partial-data indicator.
3. **Given** users want raw thread browsing or sentiment analysis, **when** comments Phase 1 ships, **then** those requests remain explicitly out of scope.

## Requirements

### Functional Requirements

- **FR-001**: Reviewer Phase 1 MUST exclude review-latency metrics until `reviewed_at` exists in persisted review data.
- **FR-002**: Reviewer approval rate MUST be defined as `approved_prs / reviewed_prs` using final stored reviewer outcome per PR.
- **FR-003**: Reviewer slices MUST use a dedicated `ReviewerBreakdownEntry` contract rather than generic `BreakdownEntry`.
- **FR-004**: Comment pipeline completion MUST define a minimum dashboard contract consisting of summary metrics, weekly trend, repository breakdown, and capped/coverage transparency.
- **FR-005**: Comment browsing, sentiment analysis, and engagement scoring MUST remain out of scope for Comments Phase 1.

### Key Entities

- **ReviewerBreakdownEntry**: Reviewer-specific rollup entry with activity metrics, approval rate, and no cycle-time fields in Phase 1.
- **Review Latency Phase 2**: Deferred reviewer capability unlocked only after schema/storage changes introduce `reviewed_at`.
- **Comment Metrics Aggregate**: JSON output describing weekly and breakdown-level comment activity and coverage state.
- **Coverage/Capped Indicator**: Manifest or aggregate metadata flag indicating comment extraction may be partial because CLI caps or rate limits were hit.

## Success Criteria

- **SC-001**: Reviewer Phase 1 scope is implementable without unresolved questions about approval rate, review latency, or breakdown type.
- **SC-002**: Comments Phase 1 has a concrete dashboard scope that can be implemented without additional metric-definition work.

## Out of Scope

- Implementing reviewer filters on this branch
- Performing schema migrations or re-extraction for `reviewed_at`
- Implementing comment aggregates or dashboard UI on this branch
