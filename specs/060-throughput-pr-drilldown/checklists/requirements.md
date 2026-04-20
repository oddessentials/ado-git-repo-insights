# Specification Quality Checklist: Throughput chart PR-level drill-down

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-04-19
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Six rounds of scoping discussion preceded this draft; every functional requirement is traceable to a user-value decision captured in the in-session transcript.
- Assumptions section records the M1–M5 measurement results that justify the 500-PR truncation cap and the inline delivery envelope — these are not speculation but measured values.
- The filter-identity contract (FR-008, SC-002) is stricter than the current Phase 1 breakdown behavior; FR-019 and the Out of Scope section explicitly declare the Phase 1 unfiltered-aggregate inconsistency untouched in this slice.
- Privacy posture (FR-014) is the project's first written data-privacy contract entry; spec requires it to be written general enough to extend to future tenant-sensitive fields.
- **Pass 1 revision (Codex stop-hook catch, 2026-04-19)**: original Pass 1 draft had FR-007 disabling the entire panel under team / reviewer filter, which (a) regressed Phase 1 behavior (Phase 1 opens the panel under those filters today) and (b) internally contradicted FR-015's "Phase 1 unchanged" promise. Revised to Option B: panel opens as Phase 1 does; only the new PR-level detail section is gated; inline message replaces it. FR-007 split into FR-007 (team/reviewer, inline message) and FR-007a (comparison mode, Phase 1 toast preserved). FR-010 rewritten to describe the new inline pattern and explicitly distinguish it from the Phase 1 comparison toast. FR-019 added to lock the Phase 1 unfiltered-aggregate behavior in place. Story 3, edge cases, SC-003, Key Entities, Assumptions, Out of Scope all adjusted in lockstep.
- **Pass 4 planning-readiness (user-directed, 2026-04-20)**: eight architectural decisions locked so the planner inherits zero behavioral choices:
  1. **FR-026 added** — comparison > team > reviewer > supported precedence; single discriminated classifier (FR-024); call-site reconstruction of precedence forbidden.
  2. **FR-021 tightened** — same-invocation production of filtered PR array AND filtered `pr_count`; no parallel filter function; subset vs element-wise-equal semantics under `_prs_truncated` explicitly locked.
  3. **FR-005a tightened** — "non-demo load paths" defined explicitly; mapping emission required on every non-demo aggregate-generation run; parity test covers availability, completeness, and cross-entry-point equality.
  4. **FR-003 rewritten** as a four-field contract surface: `_prs_truncated`, `_prs_cap`, `rendered_count` (derived), `actual_filtered_count` (derived). Consumers read from payload, never recompute. FR-008 and SC-002 aligned to match — rendered count is `filtered_prs.length`, truncation indicator surfaces both counts when they differ.
  5. **FR-020 tightened** — SINGLE new `PanelSection` variant with internal `contentState` discriminant (`"pr-list"|"supported-empty"|"team-inline"|"reviewer-inline"`); sibling variants and conditional-section inclusion FORBIDDEN.
  6. **FR-023 tightened** — three enumerated write-paths (`build-demo-dataset.py`, `generate-demo-data.py`, three CI workflows) plus "future new paths MUST use same gate or fail." Single authoritative helper, strip-and-re-verify semantics.
  7. **Helper extraction declared non-contract** — added to Out-of-scope; any `_build_pr_records(group)` hint in `code-surface-map.md` is a non-contractual planning suggestion.
  8. **FR-014 tightened** — exact privacy posture content locked (private-may / public-must-not / future-extensibility); ordering constraint: posture in same commit as or before first PR-array-producing code.

  **Pass 4 caught and resolved**: a subtle tension between the aggregator's top-500 truncation (locked earlier) and FR-008's filter-identity (locked Pass 2). Under `_prs_truncated=true` + active filter, rendered count can legitimately be less than the aggregate filtered `pr_count` because filter-matching PRs outside the top-500 by cycle_time are omitted by construction. Resolution: FR-003/FR-008 now define `rendered_count` as `filtered_prs.length` and `actual_filtered_count` as the aggregate-side filtered `pr_count`; truncation indicator surfaces both; FR-021 explicitly documents the subset vs equal semantics based on `_prs_truncated`. No aggregator architecture change; no relaxation of determinism or filter-identity; the two-count display is the user-visible contract.

- **Pass 4 follow-up (Codex stop-hook catch, 2026-04-20)**: even after Pass 4 locked the four-field truncation contract, SC-007, Story 1 acceptance scenario 2, the "exactly at truncation boundary" edge case, and FR-017 all still described the unfiltered aggregator-state behavior in language that COULD be read as applying under active filters — which would contradict FR-008's filter-aware display-state rule. Fixes (in-place, no behavioral change):
  - FR-017 now ties indicator visibility explicitly to FR-008's criterion (`rendered_count < actual_filtered_count`), NOT to `_prs_truncated` alone.
  - SC-007 scoped to "unfiltered test set" with a defensive warning against using it under filters; SC-002 remains the filter-aware assertion.
  - Edge case rewritten from the single "exactly at truncation boundary" to three explicit cases: unfiltered boundary, filter × aggregator-omitted matches (indicator visible), filter × no aggregator-omitted matches (indicator hidden even though `_prs_truncated=true`).
  - Story 1 acceptance scenario 2 scoped to "no filter is active" with a trailing reference to FR-008's criterion.
  No FR removed, no new FR added, no success criterion weakened. The contradiction was in the scoping of existing assertions, not in the contract itself.

- **Pass 3 code-validation (2026-04-20)**: every FR mapped to an existing or new code surface in `code-surface-map.md` (new artifact in this feature directory). No gaps blocking the planner — every FR has a concrete module + function anchor. Five planner-phase refinements identified (documented in the Gaps section of the map); all five resolved in Pass 4.
- **Pass 2 hardening (user-identified gaps, 2026-04-20)**: eight determinism / parity / enforcement gaps encoded in the spec:
  1. FR-008 now locks rendered PR count to `min(filtered_pr_count, truncation_cap)` with a truncation-indicator visibility invariant; SC-002 mirrors.
  2. FR-005a locks the `repository_id → repository_name` mapping: availability, cross-entry-point parity, missing-entry fallback behavior, and a required failing test for drift; SC-009 makes the assertion measurable.
  3. FR-020 declares a stable PR-detail container — single DOM element, always present when the panel is open, content switches among four deterministic states (list, supported-empty, team-inline, reviewer-inline). SC-010 locks snapshot stability. Edge case added for the missing-PR-array rollup (container still renders).
  4. FR-021 requires combined-filter PR list to use the same single-pass code path as the aggregate filtered `pr_count`; SC-011 enforces element-wise identity between the two sets.
  5. FR-022 mandates an integration test for snapshot cadence (title edit → re-aggregate → new rollup shows new title); SC-012 makes it a pass/fail success criterion.
  6. FR-023 turns demo stripping into an enforcement gate (not assumption) invoked from pre-commit / pre-push / test:ci / CI identically; SC-013 measures that leaking is impossible to complete through any of those paths.
  7. FR-025 locks the byte-identical tie-break determinism via a test with cycle-time-tied PRs in the fixture; SC-014 mirrors. Assumptions section tightened to note that the ONLY sort is the server-side deterministic one; client does not re-sort.
  8. FR-024 forces a single authoritative unsupported-filter predicate consumed by both UI render path and tests; SC-015 mandates a static check proving no forked classification logic exists.
- No [NEEDS CLARIFICATION] markers were required because the six-round scoping discussion resolved each candidate ambiguity (record fields, truncation rule, URL derivation, demo redaction, snapshot semantics, supported/unsupported filter matrix, combined filter behavior, empty-state behavior, disable UX).
- Items marked incomplete would require spec updates before `/speckit.clarify` or `/speckit.plan`.
