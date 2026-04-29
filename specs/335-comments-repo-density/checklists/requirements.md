# Specification Quality Checklist: Dashboard per-repo comment density breakdown

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-04-28
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)

  Validated: spec references aggregator helper / chart module / schema validator concepts but does not name specific languages or frameworks beyond what 333 / 334 already established. SQL-shaped phrasing in FR-2-02 step 1 ("DIRECT SQL") is intentional inheritance from 333 FR-2-04 (b) and is the same level of implementation neutrality 333 / 334 carry.

- [x] Focused on user value and business needs

  Validated: Overview and US1 articulate the user-visible reason ("are any repositories outliers in discussion volume?") with no implementation noise.

- [x] Written for non-technical stakeholders

  Validated: User stories use plain-language motivation; technical inheritance from 333 / 334 is recorded in Background / FRs / INVs which are reviewer-facing — non-technical stakeholders read US1–US4 + SC and can validate the feature's value.

- [x] All mandatory sections completed

  Validated: User Scenarios & Testing (4 USs + 10 edge cases), Requirements (FR-1-01..1-10, FR-2-01..2-05, FR-3-01..3-04, FR-4-01..4-11, INV-3-01..3-12, Key Entities), Success Criteria (SC-1-01..1-06), Assumptions (A-01..11), Out of Scope.

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain

  Validated: zero occurrences of `[NEEDS CLARIFICATION]` in spec body. All 10 CL-axes (CL-01..CL-10) are LOCKED with explicit resolutions and resolution dates.

- [x] Requirements are testable and unambiguous

  Validated: each FR is testable — FR-1-01..1-10 cover aggregator emission shape / atomicity / ordering / scope, FR-2-01..2-05 cover reconciliation including the new sum-coherence assertion, FR-3-01..3-04 cover capability gating + live-loader regression, FR-4-01..4-11 cover render including the display label fallback unit test mandate. INV-3-01..3-12 are propagated/derived invariants, each backed by a corresponding FR or upstream spec authority.

- [x] Success criteria are measurable

  Validated: SC-1-01 ≤1-interaction visual scan; SC-1-02 ≤2 interactions; SC-1-03 byte-identity baseline check; SC-1-04 active-filter empty-state visible; SC-1-05 reconciliation + sum-coherence on truncated W26; SC-1-06 raw-ID fallback render.

- [x] Success criteria are technology-agnostic (no implementation details)

  Validated: SCs describe user-visible outcomes (visual scan, interaction counts, baseline rendering, empty-state communication, reconciliation pass/fail). The reconciliation success criterion (SC-1-05) references file paths only because they are inherited test sites locked by 333 / 334; the criterion itself is value equality, not implementation shape.

- [x] All acceptance scenarios are defined

  Validated: each US carries 1–3 acceptance scenarios; edge cases (10) cover boundary conditions including the cross-aggregate sum-coherence on truncation and the FK-violation FAIL-LOUD posture.

- [x] Edge cases are identified

  Validated: Edge Cases section enumerates 10 cases — zero-repo week, single-PR repo, all-unextracted week, repository rename, FK-violation production data, mixed extraction, top-50 truncation, capability flip mid-session, sort+range simultaneous switch, INV-3-07 violation, truncated-week sum coherence. None invent clarification axes (per memory `feedback_edge_cases_no_invented_clarification_axes.md`); all describe deterministic behavior or point at existing CL/FR markers.

- [x] Scope is clearly bounded

  Validated: Out of Scope enumerates 17 explicit exclusions including sibling-feature deferrals (#321, #336), filter-integration deferrals, drill-down deferrals, sentinel non-introduction, and the deliberate pattern-reuse abstraction deferral to #336.

- [x] Dependencies and assumptions identified

  Validated: Assumptions A-01..A-11 cover capability flag presence (A-01), dimension-loader reuse (A-02), demo-dataset regeneration via `build-demo-dataset.py` (A-03), aggregator read-path (A-04), reconciliation test infrastructure (A-05), display cap tunability (A-06), dimension snapshot semantics (A-07), pattern-reuse deferral to #336 (A-08), demo generator parallel-path mandate (A-09), partial-branches ratchet zero-growth (A-10), W26 fixture week-agnostic resilience (A-11).

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria

  Validated: FR-1-01..1-10 are gated by FR-2-04 (reconciliation test extension) which exercises every aggregator-side claim; FR-2-01..2-05 are self-validating tests; FR-3-01..3-04 are gated by `tests/integration/test_demo_variants_byte_identity.py` extension + `extension/tests/artifact-client.test.ts` regression; FR-4-01..4-11 are gated by chart module Jest tests + dashboard lifecycle test.

- [x] User scenarios cover primary flows

  Validated: P1 first-glance comprehension (US1), P2 sort toggle (US2), P3 capability-off byte-identity (US3), P3 filter-not-supported posture (US4). No US5 sentinel rendering needed — per CL-03 the sentinel is dropped for the per-repo dimension. US3 + US4 mirror 334 US3 + US5 (US4 in 334 was sentinel rendering, intentionally absent here).

- [x] Feature meets measurable outcomes defined in Success Criteria

  Validated: each US maps to exactly one SC (US1 → SC-1-01, US2 → SC-1-02, US3 → SC-1-03, US4 → SC-1-04). SC-1-05 closes the cross-feature coherence + sum-coherence contract. SC-1-06 closes the raw-ID fallback contract from CL-04 / FR-4-11.

- [x] No implementation details leak into specification

  Validated: file path citations (e.g., `extension/ui/dashboard.ts:1687`, `tests/integration/test_comments_trend_reconciliation.py`) are inherited test/render-site markers from 333 / 334 — they are spec-level anchors, not implementation prescriptions. Function names cited (`_compute_weekly_by_author_comments`, `validateAuthorCommentsDensity`) are pattern-source references for the spec's "mirror this" instructions, not implementation prescriptions for 335 (the parallel function names like `_compute_weekly_by_repository_comments` are intentionally NOT named in the spec — plan-level decisions).

## Notes

- Items marked incomplete require spec updates before `/speckit.clarify` or `/speckit.plan`.
- All 10 CL-axes (CL-01..CL-10) locked 2026-04-28 by user directive — Path B; planning-readiness verified against `main` after PR #349 merge.
- The 4-pass speckit hardening (Pass 1 draft → Pass 2 hardening → Pass 3 code-validation → Pass 4 planning-readiness) was applied INLINE during /speckit.specify execution per user directive; this checklist validates the post-Pass-4 state. /speckit.analyze is the next checkpoint before /speckit.plan.
- Pattern-reuse posture: A-08 explicitly defers shared-abstraction extraction to #336 (per-reviewer) so the abstraction is informed by THREE concrete instances (per-author + per-repo + per-reviewer) rather than two — guards against the trap warned about by memory `feedback_no_invented_abstractions.md`.
- Cross-aggregate sum-coherence test (FR-2-03 + SC-1-05) on the truncated W26 demo fixture is the NEW reconciliation contract introduced by this feature; it closes a deferred 333 / 334 cross-aggregate parity obligation on truncated weeks.
- All 5 plan-time lessons from #334 surfaced in spec body: demo generator parallel path (A-09), full-week PR-set scope (INV-3-10), `docs/data/` ownership by `build-demo-dataset.py` (A-03), partial-branches ratchet zero-growth (A-10), F3 live-loader regression (FR-3-04).
