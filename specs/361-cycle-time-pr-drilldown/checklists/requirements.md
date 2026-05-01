# Specification Quality Checklist: Cycle-Time Chart PR-Level Detail

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-05-01
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

## Validation Notes

**Iteration 1 — initial draft validation (passed all 16 items)**

- Content Quality: spec uses domain-level terms; FR-016's "no new database queries / aggregator pass / schema / migrations" kept as scope guards (categories of producer work excluded, not implementation prescriptions).
- Manager comprehensibility: US1 leads with the investigation scenario; SC-001 / SC-002 quantify user time and clicks; SC-009 makes manager comprehensibility itself a success criterion.
- Testable & unambiguous: each FR names an observable behavior or a scope guard.
- Measurable SCs: all SCs use numeric thresholds, 100% / zero clauses, or stakeholder-observable definitions.
- Acceptance scenarios: US1 had 4, US2 had 4, US3 had 3.
- Edge cases: 7 concrete cases, none inventing clarification axes.
- Scope bounding: 8 deferrals enumerated under "Out of Scope" with reasons.
- Dependencies & assumptions: 8 documented.

**Iteration 2 — review-driven hardening (passed all 16 items, content tightened)**

The reviewer surfaced five points before planning. Each was verified against the live codebase before editing.

1. **State-mapping disambiguation (FR-011 / SC-004)**. The throughput drill-down's `PrListSection` exposes four content states: `pr-list`, `supported-empty`, `team-inline`, `reviewer-inline`. The previous draft conflated `supported-empty` with the team / reviewer messages by lumping all three under one "data does not permit" SC. **Fix**:
   - FR-006 / FR-007 now name the `team-inline` and `reviewer-inline` states explicitly and call out that they are distinct from the empty-state.
   - FR-011 was rewritten to specify the `supported-empty` content state, name its three triggers (zero qualified PRs, missing web context, missing cap marker), and explicitly state that it is NOT a "clear the filter" message.
   - SC-004 was split into SC-004a (team), SC-004b (reviewer), SC-004c (supported-empty), and SC-004d (comparison) — each mapping to a distinct user-visible message.

2. **Demo verification (was an unverified assumption)**. The previous draft assumed the public demo strips per-PR fields. **Direct verification at HEAD**: every weekly rollup under `docs/data/aggregates/weekly_rollups/*.json` carries `prs`, `_prs_truncated`, and `_prs_cap`; spot check on `2025-W28.json` shows 151 PRs, `_prs_cap=500`, `_prs_truncated=false`. The strip helper at `scripts/strip_pr_arrays.py` exists but is not currently being applied to the published demo. **Fix**:
   - Edge Cases now describes the actual demo state (includes `prs`, will render the PR list normally).
   - User Story 3's demo acceptance scenario was removed; in its place, US3 acceptance scenario 4 explicitly states demo behavior is "renders the PR list, identical to throughput" and references #315 as the tracking concern for the broader strip-or-not question.
   - Assumptions section names the verification ("verified at HEAD … 2025-W28.json …") and clarifies that this feature is data-state-driven (FR-011) and behaves correctly whether or not #315 changes the demo's stripping posture.

3. **Sort verification (was implicit producer-trust)**. Throughput's consumer applies `rawPrs.map(...)` (preserves order, no re-sort), which means it inherits the producer's sort. The previous draft's FR-003 said "ordered slowest first" but did not require the consumer to assert that order independently. **Fix**:
   - New FR-019 mandates a consumer-side automated test on the cycle-time drill-down that asserts the rendered DOM order is `cycle_time desc, id asc`, regardless of how the order is achieved (producer trust or consumer sort).
   - A new edge case explicitly covers the regression scenario where producer order ever drifts.
   - Assumptions section explains the verification: throughput's consumer is `rawPrs.map(...)` so the section accepts any consumer-provided order; the contract becomes the rendered output, not the provenance of the order.

4. **Accessibility / keyboard test coverage (was vague)**. FR-012 / FR-013 carried user-facing obligations but did not specify whether existing throughput tests count as coverage. Throughput's chart-side keyboard tests cover throughput's bars — not cycle-time's dots. **Fix**:
   - FR-012 now explicitly forbids citing the throughput equivalent as coverage and mandates a cycle-time-specific test for section accessible-name stability across all four content states.
   - FR-013 now mandates at least one cycle-time-specific test for keyboard activation of a dot opening the panel with a PR list, and at least one for Tab reachability of PR rows inside the cycle-time panel.
   - SC-005 names the cycle-time-specific verification path.

5. **Preflight, not pre-push, as final-readiness arbiter**. The previous draft's Assumption referenced "the full local pre-push gate suite". **Fix**:
   - SC-007 now names `python scripts/run_pr_preflight.py` returning exit code 0 with no `--allow-local-degraded` flag as the regression-zero verification path.
   - The Assumption that previously said "pre-push gate suite must pass" was rewritten to clarify that the pre-push hook invokes the preflight as one of its steps but the preflight is the authoritative arbiter.
   - New SC-010 makes the test-floor bump itself an explicit success criterion (extension floor up by exactly the new test count, no marker waiver).
   - New SC-011 makes the cross-surface PR-record schema-parity gate's green status an explicit success criterion.

**Net delta**: FRs 1–18 → FRs 1–20 (added FR-019 sort verification, FR-020 floor-bump contract). SCs 1–9 → SCs 1, 2, 3, 4a/b/c/d, 5, 6, 7, 8, 9, 10, 11 (split SC-004 four ways, added SC-010 / SC-011). Edge Cases 7 → 8 (added producer order drift). Assumptions: demo-strips assumption removed, demo-state assumption replaced with verified state + #315 cross-reference, sort-assumption added, preflight-as-arbiter assumption refined.

No [NEEDS CLARIFICATION] markers added in either iteration.

## Notes

- This checklist captures the validation pass against the spec at iterations 1 and 2; it does not replace `/speckit.clarify` (which probes for non-obvious clarifications) or `/speckit.analyze` (which checks cross-artifact consistency once plan and tasks exist).
- All 16 items pass at iteration 2. The spec is ready for `/speckit.plan`.
