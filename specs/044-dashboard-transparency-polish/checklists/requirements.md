# Specification Quality Checklist: Dashboard Data Transparency, Visual Polish & Component Extraction

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-03-29
**Updated**: 2026-03-29 (v4 — adversarial audit pass)
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

## Tightening Pass v2 (applied)

- [x] FR-022 parity: automated test with DOM comparison, blocks build
- [x] FR-006/FR-007 sample size: exact source, computed once, shared
- [x] FR-009 threshold: `LOW_SAMPLE_THRESHOLD = 10`
- [x] FR-010/FR-011 lookback: single source of truth
- [x] FR-012 bucket mapping: deterministic label-to-color lookup
- [x] FR-014 breakpoint: `MOBILE_BREAKPOINT = 480`
- [x] FR-015 opacity: exact value `0.55`
- [x] FR-016 truncation: `.truncation-badge` CSS class
- [x] FR-018-021 extraction: snapshot parity before/after
- [x] SC-001-SC-007: DOM/state-based assertions
- [x] FR-026: null-handling via `renderNoData()` contract
- [x] FR-027: no new standalone full-data passes

## Tightening Pass v3 (applied)

- [x] FR-012: explicit boundaries table with hour thresholds
- [x] FR-010/FR-011: single exported function, test for identical N
- [x] FR-022: DOM normalization before comparison
- [x] SC-006: class presence + stylesheet rule, not computed CSS
- [x] SC-007: class AND text content assertion
- [x] SC-009: automated LOC delta check
- [x] FR-027: enforcement via code review + function count test
- [x] FR-028: filter interaction invariant
- [x] FR-029: all-null failure-mode test
- [x] FR-030: mobile parity test

## Adversarial Audit v4 (applied)

Invariant audit conducted against actual codebase. 6 fixes applied:

- [x] **"4 entry points" → "3 data paths"**: Codebase has 3 data paths (extension hub, CLI local mode, /docs demo), not 4. Fixed FR-022, SC-008, edge cases, and assumptions to reference "3 data paths" with explicit names.
- [x] **FR-029 renderNoData text parity**: `renderNoData()` takes chart-specific message+hint strings by design. Fixed to require identical DOM element structure and CSS classes (`.no-data`, `.no-data-hint`), while permitting chart-appropriate text content. No card may show "0" or blank where another shows no-data structure.
- [x] **FR-027 review_time extraction**: calculateMetrics and extractSparklineData both already iterate rollups. Adding review_time fields to these existing functions is NOT a new pass. Fixed to explicitly permit extending existing aggregation functions with new fields, prohibiting only new standalone iteration functions.
- [x] **FR-014 MOBILE_BREAKPOINT**: CSS `@media` rules cannot read JS variables. Fixed to require coordinated JS constant + CSS value with an automated parity test asserting they agree. No other `480` magic numbers allowed.
- [x] **FR-010 getLookbackWindow**: Function does not exist today — current sparkline lookback is hardcoded `slice(-8)`. Fixed to explicitly state this is new infrastructure to create, replacing the hardcoded value.
- [x] **SC-009 LOC range**: Widened from "80-150 lines" to "at least 80 lines" measured from post-Phase-2 baseline (after features added, before extraction). No upper bound — greater savings are welcome.

### Verified as correct (no fix needed)

- FR-012 bucket labels are code constants (cycle-time.ts:69-76), not from external data. Label-to-color lookup is safe.
- renderNoData() has consistent signature (container, message, hint?). FR-026 is enforceable.
- reviewerFilterActive flows from dashboard.ts:1081 → reviewer-activity.ts as option parameter. Clean data flow.
- approval_rate is computed by aggregateReviewerEntries (metrics.ts:282-327) but currently discarded during filter application. Implementation must propagate this value.
- Existing parity test infrastructure (render-equivalence.test.ts) has Layer A (idempotency) and Layer B (cross-path wiring). New tests extend this pattern naturally.

## Notes

- All items pass validation after v4 audit. Spec is ready for `/speckit.plan`.
- 30 functional requirements, 10 enforceable success criteria, 9 edge cases.
- Every invariant has been verified against the actual codebase or explicitly flagged as new infrastructure to build.
