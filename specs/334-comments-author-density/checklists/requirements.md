# Specification Quality Checklist: Dashboard per-author comment density breakdown

**Purpose**: Validate specification completeness and quality before proceeding to `/speckit.clarify` (Pass-1 → Pass-2 hardening) and onward to `/speckit.plan`.
**Created**: 2026-04-27
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
  - **Status**: PASS with documented project-convention exception. The spec references concrete file paths, table names, and field names (e.g., `aggregators.py`, `pr_threads`, `comments_extracted_at`, `rollup[W].comments`, `MAX_COMMENTS_AUTHOR_DENSITY_ROWS`). This mirrors the established convention of `specs/310-comments-visualization/spec.md` and `specs/333-comments-trend-chart/spec.md`, both of which embed implementation anchors so the spec is Pass-3 code-validatable per the project's 4-pass speckit cadence (memory: `feedback_speckit_rigor.md`). Anchors use **anchor text** (file + section heading), not line numbers (memory: `feedback_spec_cross_refs_anchor_text.md`). The user-facing User Stories + Success Criteria + Out of Scope sections are written for non-technical stakeholders; the FR / INV / Key Entities sections carry the engineering-load that the project's 4-pass discipline requires.
- [x] Focused on user value and business needs
  - User Stories US1–US5 each carry a "Why this priority" subsection grounding the user value. The Overview frames the user problem ("are any authors outliers?") explicitly.
- [x] Written for non-technical stakeholders
  - PASS for User Stories, Success Criteria, Out of Scope. Engineering FR / INV sections require domain knowledge (CL-NN axes, INV-NN codes, namespace details) — same as the inheriting 310 / 333 specs. A non-technical stakeholder can read the User Stories + Success Criteria + Out of Scope and understand what's shipping.
- [x] All mandatory sections completed
  - User Scenarios & Testing ✓, Requirements ✓, Success Criteria ✓, Assumptions ✓.
  - Optional sections included: Overview, Background, Clarifications, Edge Cases, Cross-feature Invariants, Key Entities, Out of Scope (matching the 310 / 333 convention).

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
  - **Status**: PASS. All 8 CL-axes are locked by user directive 2026-04-27 (Path B): CL-01 = B (parallel `by_author_comments` namespace), CL-02 = a (full 333 FR-1-07 parity), CL-07 = yes (propagate per-row coverage_partial), and CL-03 / CL-04 / CL-05 / CL-06 / CL-08 by informed default. The spec is normalized to the locked path: zero `[NEEDS CLARIFICATION]` markers, zero branch-aware alternatives in executable requirements (FRs / USs / SCs / edges / invariants). Verified by grep: `NEEDS CLARIFICATION|branch-aware|\(CL-01 =|\(CL-02 =|\(CL-07 =` matches 0 occurrences. /speckit.clarify may still re-open any axis if needed.
- [x] Requirements are testable and unambiguous
  - Each FR is testable. Branch-aware FRs include the resolution axis (e.g., "(CL-01 = A) ... (CL-01 = B) ...") so the test matrix is parameterized on the resolution.
- [x] Success criteria are measurable
  - SC-1-01: "no interaction beyond visual scan of the breakdown's top row" (binary: yes/no).
  - SC-1-02: "≤2 interactions" (countable).
  - SC-1-03: "byte-identical" (verifiable via fixture comparison).
  - SC-1-04: "exactly ONE row labeled ..." (verifiable via DOM count).
  - SC-1-05: "communicates the chosen CL-02 posture within the rendered dashboard" (verifiable per branch).
  - SC-1-06: "values match an independent re-computation per FR-2-02" + "share no code with EITHER aggregator" (verifiable via the FR-2-04 reconciliation test extension).
- [x] Success criteria are technology-agnostic
  - All SCs describe outcomes from the user's POV; FR-NN cross-references appear only as "verifiable by" pointers, not as technology constraints in the SC body.
- [x] All acceptance scenarios are defined
  - US1 (3 scenarios), US2 (3 scenarios), US3 (2 scenarios), US4 (3 scenarios), US5 (3 scenarios — one per CL-02 branch).
- [x] Edge cases are identified
  - 9 edge cases enumerated: zero-author week, single-PR author, all-unknown-author week, author-with-mixed-extraction (branch-aware on CL-07), truncation past top-50, capability flip lifecycle, sort + range filter simultaneous switch, INV-2-07 violation, sentinel-display-name collision.
- [x] Scope is clearly bounded
  - Out of Scope itemizes 16 deferral / non-extension targets with ownership pointers (#335, #336, #321, 322/182, etc.).
- [x] Dependencies and assumptions identified
  - Assumptions A-01 through A-09 enumerate the inheriting infrastructure (capability flag, demo dataset, frozen extractor, 333 reconciliation infrastructure, sentinel namespace safety, sibling pattern-inheritance).

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
  - FR-1-* (8 FRs) → covered by US1 + US3 acceptance scenarios + Edge cases.
  - FR-2-* (5 FRs) → covered by SC-1-06 + FR-2-04 test extension.
  - FR-3-* (3 FRs) → covered by US3 acceptance scenarios + Edge cases (capability flip lifecycle).
  - FR-4-* (10 FRs) → covered by US1 / US2 / US4 / US5 acceptance scenarios + Edge cases.
- [x] User scenarios cover primary flows
  - 5 user stories: P1 first-glance comprehension (US1) → P2 sort interaction (US2) → P3 capability-off byte-identity (US3) + sentinel rendering (US4) + filter-not-supported posture (US5).
- [x] Feature meets measurable outcomes defined in Success Criteria
  - Each SC maps to a US: SC-1-01 ↔ US1, SC-1-02 ↔ US2, SC-1-03 ↔ US3, SC-1-04 ↔ US4, SC-1-05 ↔ US5; SC-1-06 closes the cross-feature INV-2-02 obligation via FR-2-04.
- [x] No implementation details leak into specification
  - Same project-convention-exception note as in Content Quality. The spec's implementation anchors are by design (Pass-3 code-validation requires them per memory: `feedback_speckit_rigor.md`).

## Notes

- **All 8 CL-axes locked 2026-04-27 by user directive (Path B)**: CL-01 = B parallel namespace, CL-02 = a full 333 parity, CL-07 = yes propagate per-row qualifier, CL-03 / CL-04 / CL-05 / CL-06 / CL-08 by informed default. Spec normalized to the locked path; zero branch-aware alternatives remain in executable requirements.
- **Cross-feature anchors** use anchor text + file references, not line numbers (per memory: `feedback_spec_cross_refs_anchor_text.md`).
- **C1 inclusion-rule contract**: REFERENCED by file + section anchor; NOT re-declared (INV-07 / INV-2-02 / INV-2-03 protection).
- **Inherited invariants from 333**: INV-1-06 ordering (→ INV-2-07), INV-1-07 partial qualifier (→ FR-4-03 per-row qualifier when reduced `coverage_partial` is `true`), INV-1-08 atomicity (→ INV-2-08 sub-object atomicity for `by_author_comments`), FR-3-03 capability-off byte-identity (→ FR-3-03 four omission failure modes for `by_author_comments` key).
- **Speckit cadence note**: Per project memory `feedback_speckit_rigor.md`, the canonical cadence is Pass 1 → Pass 2 → Pass 3 → Pass 4 → /speckit.analyze. The user directed Path B (lock defaults + advance to /speckit.plan) explicitly, accepting that the formal `/speckit.clarify` step is bypassed. The user retains the right to re-open any CL-axis via /speckit.clarify if scope creep or new evidence surfaces.
- **Plan-stage churn guard**: User directive 2026-04-27 — "If the plan surfaces new scope beyond those locked decisions, stop and reject it as churn." Applied during /speckit.plan execution.
