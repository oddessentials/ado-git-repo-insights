# Specification Quality Checklist: Summary-card sparkline PR-level drill-down (#363)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-05-02
**Feature**: [spec.md](../spec.md)

## Iteration 1 — Pass 1 draft validation (this run)

### Content Quality

- [x] No implementation details (languages, frameworks, APIs)
  - Spec references TypeScript concepts (`PrListSection` discriminated union, `classifyFilterState`, `_prs_cap`) only as **contract names** of existing primitives the slice consumes — these are necessary contract anchors, not new implementation specs. The "Open research questions" section explicitly defers signature-level decisions to plan/contracts, so no NEW implementation choices are baked in here.
- [x] Focused on user value and business needs
  - User Stories US1/US2 lead with the user goal ("see the actual list of PRs that drove that headline number"). US3 is value-framed as preserving the existing handoff. US4 is value-framed as DOM-shape-honesty under the capability gate.
- [x] Written for non-technical stakeholders
  - Locked Decisions are accessible (algorithmic prose for LD-1, table for LD-2, plain rationale for LD-5). Some FR-level material is necessarily contract-anchored, but every contract anchor is justified by reference to a settled prior slice (#365 / #362 / #310 / #060 / #059).
- [x] All mandatory sections completed
  - User Scenarios & Testing (US1-US4 + Edge Cases): present.
  - Requirements (Functional Requirements + Key Entities): present (FR-001..FR-023, 5 entities).
  - Success Criteria: present (SC-001..SC-008).
  - Assumptions: present (8 assumptions, each with grounding).

### Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
  - Pass 1 input arrived with LD-1..LD-5 already locked. Open research questions are tagged **Q-R1..Q-R4** and routed to research/data-model/plan (the right surface), not left as `[NEEDS CLARIFICATION]` markers in the spec body. This matches the speckit pattern observed in 361 / 362.
- [x] Requirements are testable and unambiguous
  - Every FR specifies a precondition (when…), an action, and a measurable outcome. Branch-aware FRs (FR-001 + FR-002 + FR-003 + FR-004) cover the LD-2 asymmetry without "unless" clauses, per memory `feedback_speckit_branch_aware_from_draft`.
- [x] Success criteria are measurable
  - SC-001..SC-008 each cite an observable user-visible outcome (one click, single transition, byte-identical DOM, no DetailPanel, etc.). None require implementation insight to verify.
- [x] Success criteria are technology-agnostic (no implementation details)
  - SC text is framed in user-visible terms (panel content, transition behavior, click count, regression-lock on existing behavior). The few contract anchors (LD-1 envelope formula, capability-off baseline fixture) are NECESSARY for verifiability and refer to existing settled contracts, not new tech.
- [x] All acceptance scenarios are defined
  - US1 has 5 scenarios; US2 has 5 scenarios; US3 has 4 scenarios; US4 has 3 scenarios. Edge Cases section enumerates 11 boundary conditions covering empty period, missing fields, retarget, comparison-mid-panel, sparkline-trigger-missing, reduced-motion, touch.
- [x] Edge cases are identified
  - 11 edge cases listed under "Edge Cases" — covers empty rollups, missing `_prs_cap`, missing `webContext`, pure-overlay reductions, keyboard on reviewers card, retarget-in-place, active-trigger lifecycle, comparison-toggled-while-open, missing-trigger DOM, reduced-motion on panel branch, touch synthesis.
- [x] Scope is clearly bounded
  - "Non-goals" section enumerates 8 explicit exclusions (other charts' drilldowns, comparison-mode drilldown, schema changes, replacing scroll-highlight, demo data, Option B, Option C, byAuthor/byRepository breakdowns).
- [x] Dependencies and assumptions identified
  - "Dependencies" lists 5 prior slices with their contributions. "Assumptions" lists 8 grounded assumptions. "Constitution / repo-pattern reminders" surfaces 4 cross-cutting invariants the planning passes must honor.

### Feature Readiness

- [x] All functional requirements have clear acceptance criteria
  - Each FR is paired with at least one SC and at least one US acceptance scenario. The mapping:
    - FR-001 / FR-002 → US1 (1, 4, 5), US2 (1, 4, 5), US3 (1, 4); SC-001, SC-005, SC-008
    - FR-003 → US1 (5), US2 (5), US3 (3); SC-008
    - FR-004 → US1 (4), US2 (4), US3 (4); SC-006
    - FR-005 → US2 (1, 2); SC-002
    - FR-006..FR-011 → US1 (1), US2 (1, 2, 3); SC-001, SC-003
    - FR-012..FR-014 → US4 (1, 2, 3); SC-004
    - FR-015..FR-016 → US2 (2); SC-002 (retarget-in-place)
    - FR-017..FR-019 → US3 (2, 4); SC-006
    - FR-020 → no direct user-facing AC (it's a code-comment requirement); covered by SC-005 implicitly
    - FR-021..FR-023 → SC-007 (LD-4 invariant); no user-facing AC by design (helper-extraction is internal)
- [x] User scenarios cover primary flows
  - US1 covers the primary "open period PR list from throughput card" flow with no-filter / team-filter / reviewer-filter / comparison / missing-chart variants. US2 covers the same for cycle-time cards plus the cross-card retarget. US3 covers the asymmetry preservation. US4 covers the capability gate.
- [x] Feature meets measurable outcomes defined in Success Criteria
  - SC-001 (one-click) ⇔ FR-001 + FR-005. SC-002 (retarget) ⇔ FR-015/16 + FR-005. SC-003 (cap/truncation) ⇔ FR-006..FR-009 + LD-1. SC-004 (capability shapes) ⇔ FR-012..FR-014. SC-005 (asymmetry regression-lock) ⇔ FR-002 + FR-020. SC-006 (comparison + reduced-motion) ⇔ FR-004 + FR-017..FR-019. SC-007 (LD-4 invariant) ⇔ FR-021..FR-023. SC-008 (missing-target) ⇔ FR-003.
- [x] No implementation details leak into specification
  - Where contract anchors appear (e.g. `classifyFilterState`, `_prs_cap`), they are pre-existing primitives this slice consumes — naming them is the only way to express the contract precisely. The spec does NOT prescribe a function signature, file path beyond the candidate "e.g." mention in LD-4, or test count.

## Notes (Iteration 1)

- **No items failed validation** in Iteration 1. Spec is ready for user review at the Pass 1 boundary.
- The user explicitly directed: do NOT advance to Pass 2 hardening or to /speckit.clarify or /speckit.plan until they have reviewed this draft. Honor that boundary.
- Open research questions Q-R1..Q-R4 are intentionally **not** [NEEDS CLARIFICATION] markers — they are downstream-passing items routed to research / data-model / plan, matching the 361/362 pattern.
- Per memory `feedback_drop_plan_ceremony_on_locked_tasks`, when 4-pass + analyze is fully done, execute tasks directly. This run is at Pass 1, so the plan ceremony is fully in scope going forward.

---

## Iteration 2 — Pass 2 hardened spec validation

User directed Pass 2 hardening with five concrete directives (see conversation @ Pass 1 approval). Pass 2 edits applied to spec.md only; no /speckit.clarify, no /speckit.plan, no source code touched. Re-running the same checklist against the hardened spec.

### Content Quality

- [x] No implementation details (languages, frameworks, APIs)
  - Pass 2 added the `data-drilldown-cycle-metric` attribute name to FR-005 as contract — this is a public DOM-attribute contract (visible to assistive tech, query-selectable from tests), not a private implementation detail. The spec is correct to lock the attribute name.
  - Hard abort criteria in LD-4 / FR-022 reference reviewer-drilldown source/test/fixture file paths as **contract anchors for the abort rule**, not as new implementation prescriptions. Naming is necessary for the abort criterion to be testable.
- [x] Focused on user value and business needs
  - User stories are unchanged from Pass 1. Pass 2 hardening operates on internal contract precision (LD-4 abort, Q-R outcomes) without altering user-facing scope.
- [x] Written for non-technical stakeholders
  - LD-1 algorithmic recipe and Q-R outcome routing are accessible. Hard-abort enumeration in LD-4 is necessarily detailed but each bullet is a single concrete observable trigger ("a reviewer-drilldown test goes red") rather than implementation-internal phrasing.
- [x] All mandatory sections completed
  - Pass 2 added "Pass 2 hardening notes" subsection at the bottom for traceability. Header status updated to `Draft (Pass 2 — hardened)`. No mandatory section is omitted or weakened.

### Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
  - Q-R1..Q-R5 are research items with explicit two-branch outcomes (R1-A/B, R5-A/B) and concrete decision rules. None is a `[NEEDS CLARIFICATION]` placeholder. Q-R3's default decision is now LOCKED (omit) with cheap-reuse exception conditions enumerated.
- [x] Requirements are testable and unambiguous
  - Pass 2 specifically tightened FR-005 (no "e.g."), FR-015 (no "atomically"), FR-016 (4-step explicit ordering), FR-022 (broad-movement abort criteria as 5 enumerated conditions). Every "MUST" now has a concrete observable trigger.
- [x] Success criteria are measurable
  - SC-001..SC-008 unchanged in Pass 2; all already passed measurability in Iteration 1.
- [x] Success criteria are technology-agnostic (no implementation details)
  - SC-007 ("reviewer-drilldown's existing test suite and DOM-golden fixtures remain unchanged in observable output") is a regression-lock invariant directly verifiable from test output and fixture diffs; technology-agnostic in user-visible terms.
- [x] All acceptance scenarios are defined
  - Pass 2 did not add new user stories or remove any. US1-US4 acceptance scenarios unchanged. Edge cases unchanged.
- [x] Edge cases are identified
  - 11 edge cases as before. Pass 2's tightened LD-4 abort rules are reflected in FR-022, not in edge cases (the abort is an implementation contract, not a runtime user-visible state).
- [x] Scope is clearly bounded
  - Non-goals unchanged. LD-5 wording softened from "out of scope" to "default out-of-scope" but the bounded scope is now precisely tied to Q-R5's binary outcome (R5-A keeps default, R5-B grows scope by exactly one `chore(demo)` commit). No "maybe more" slot.
- [x] Dependencies and assumptions identified
  - Assumptions section pruned in Pass 2: Q-R1-dependent claims moved to research; inherited-contract claims kept and explicitly labeled. Dependencies section unchanged (5 prior slices).

### Feature Readiness

- [x] All functional requirements have clear acceptance criteria
  - FR mapping unchanged from Iteration 1. FR-005 (cycle metric attribute) and FR-015/16 (lifecycle ordering) now have tighter test-anchor language.
- [x] User scenarios cover primary flows
  - Unchanged.
- [x] Feature meets measurable outcomes defined in Success Criteria
  - SC-007 (LD-4 invariant) now has stricter contract anchor in Pass 2's FR-022 (touch-radius ≤ 2 files; zero test/fixture changes); SC-007 is more precisely verifiable than in Pass 1.
- [x] No implementation details leak into specification
  - DOM-attribute contracts (`data-drilldown-cycle-metric`, `is-drilldown-active`, `aria-expanded`) are public-API anchors necessary for testability, not implementation leakage.

## Iteration 2 outcome

- **No items failed validation** in Iteration 2. All 16 checklist items pass.
- Five user-directed Pass 2 hardenings landed: Q-R1 lock-as-research, Q-R3 omit-default, reviewers-card out-of-scope preserved (verified intact, no edit), LD-4 strict abort, demo-data Q-R5 lock.
- Spec is ready for user review at the Pass 2 boundary. Per the user's direction in the Pass 2 approval, do NOT advance to Pass 3 code-validation, Pass 4 planning-readiness, /speckit.clarify, or /speckit.plan until they have reviewed this hardened draft.

## Iteration history

- Iteration 1 (Pass 1 draft) — all items pass.
- Iteration 2 (Pass 2 hardened) — all items pass; five user-directed hardenings landed; reviewers-card asymmetry verified intact.

---

## Iteration 3 — Pass 3 code-validation

User directed: re-verify every "Verified Input at HEAD" claim against current code, resolve Q-R items that can be answered by source inspection, surface drift before any planning. Spec hardening only; no /speckit.plan, no tasks, no source edits.

### Verification results

**All ten "Verified Input at HEAD" claims confirmed at HEAD** with no drift:

| File / claim | Verified |
|---|---|
| `sparkline-navigator.ts` — container-only signature, scroll-and-highlight, target id map, 1500ms highlight | ✓ |
| `throughput-drilldown.ts` — per-week PR list from `rollup.prs`, classifier branches, capability-on stat row | ✓ |
| `cycle-time-drilldown.ts` — panel title `Week of … — P50/P90` | ✓ |
| `reviewer-drilldown.ts:257-411` — cross-week union, accumulator, max-cap, truncation envelope | ✓ |
| `summary-cards.ts:158-161, 449-472` — four sparkline triggers wrapped | ✓ |
| `dashboard.ts:1320-1345` — cycle-time options bag; sparkline gets container only | ✓ |
| `detail-panel.ts` — `PrListSection` union, `makePrListSection`, content states, capability field | ✓ |
| `filter-support.ts` — `classifyFilterState` with narrowed-return overload | ✓ |
| `comparison-advisory.ts` — `isDrilldownDisabledByComparison`, summary-cards in disabled set | ✓ |
| `.test-floor-contract.json` — extension `min_collected: 3158` | ✓ |

**Q-R resolutions** (3 locked, 1 reaffirmed, 1 still deferred):

| Q | Outcome | Evidence anchor |
|---|---|---|
| Q-R1 | ✓ R1-A locked | `dashboard.ts:1045` + `metrics.ts:441-933` (esp. L906-924 PR-level filter) |
| Q-R2 | DEFERRED to plan | Design judgment; not source-inspectable |
| Q-R3 | ✓ OMIT reaffirmed | No cheap-reuse signal; `throughput-drilldown.ts:93-110` `breakdownSection` is per-rollup; cross-week aggregate would fail all three cheap-reuse conditions |
| Q-R4 | ✓ Branch B locked | `reviewer-drilldown.ts:282-322` per-(reviewer, week) walk requires callback-based restructure; exceeds "single mechanical call-site swap" criterion |
| Q-R5 | ✓ R5-A locked | `docs/data/aggregates/weekly_rollups/2025-W40.json` sample: pr_count=106, prs.length=106, _prs_cap=500, _prs_truncated=false, full PR record keys |

**Out-of-scope flag** (recorded in Non-goals, NOT in #363's PR scope): `applyFiltersToRollups` at `metrics.ts:921` — possible namespace mismatch between `filters.repos` (repository_name) and `pr.repository_id` (GUID). Pre-existing; affects all read paths; separate triage.

### Content Quality (Iteration 3)

- [x] No implementation details (languages, frameworks, APIs)
  - Pass 3 added line-number citations (`metrics.ts:1045`, `metrics.ts:906-924`, `reviewer-drilldown.ts:282-322`) as evidence anchors. These are necessary for the lock to be verifiable; not implementation prescriptions.
- [x] Focused on user value and business needs — unchanged.
- [x] Written for non-technical stakeholders — Pass 3 evidence sections add technical references but the locked outcomes (R1-A, R5-A, Branch B, OMIT) are summarized in plain language at the top of each.
- [x] All mandatory sections completed — header advanced; Pass 3 code-validation notes added.

### Requirement Completeness (Iteration 3)

- [x] No [NEEDS CLARIFICATION] markers remain
  - Q-R1 / Q-R3 / Q-R4 / Q-R5 are RESOLVED. Q-R2 is DEFERRED to plan-time (design judgment, not a clarification gap).
- [x] Requirements are testable and unambiguous
  - FR-021..FR-023 now name specific paths (`reviewer-drilldown.ts` source + 4 test files + 1 fixture). FR-022 specifies the `git diff` regression-lock criterion concretely. FR-008's "(if any)" hedge dropped.
- [x] Success criteria are measurable — unchanged.
- [x] Success criteria are technology-agnostic — unchanged.
- [x] All acceptance scenarios are defined — unchanged.
- [x] Edge cases are identified — unchanged. Pass 3 note: edge case "Pure-overlay reduction" is now unreachable per Q-R1=R1-A but remains documented for completeness.
- [x] Scope is clearly bounded
  - Non-goals expanded to enumerate the `applyFiltersToRollups` triage flag explicitly so it cannot expand the PR. Cross-week breakdowns and shared helper extraction now both locked OUT.
- [x] Dependencies and assumptions identified
  - Assumptions section pruned: bullets that depended on un-resolved Q-R outcomes are removed (now locked); reviewer-card asymmetry assumption preserved.

### Feature Readiness (Iteration 3)

- [x] All functional requirements have clear acceptance criteria — unchanged + tighter on FR-022.
- [x] User scenarios cover primary flows — unchanged.
- [x] Feature meets measurable outcomes defined in Success Criteria — unchanged.
- [x] No implementation details leak into specification — Pass 3 added evidence anchors, not prescriptions.

## Iteration 3 outcome

- **No items failed validation** in Iteration 3. All 16 checklist items pass.
- Three Q-R items locked from code: Q-R1 (R1-A), Q-R4 (Branch B), Q-R5 (R5-A).
- One Q-R item reaffirmed: Q-R3 (OMIT).
- One Q-R item still deferred to plan-time: Q-R2 (panel title shape — design judgment).
- One pre-existing out-of-scope flag recorded: `applyFiltersToRollups` at `metrics.ts:921` (NOT in #363 scope).
- Reviewers-card preservation re-confirmed (no edits to FR-002/US3/SC-005/LD-2).
- Spec is ready for user review at the Pass 3 boundary. Per the user's direction in the Pass 3 approval, do NOT advance to Pass 4 planning-readiness, /speckit.clarify, /speckit.plan, or any source code work.

## Iteration history (updated)

- Iteration 1 (Pass 1 draft) — all items pass.
- Iteration 2 (Pass 2 hardened) — all items pass; five user-directed hardenings landed; reviewers-card asymmetry verified intact.
- Iteration 3 (Pass 3 code-validated) — all items pass; 10/10 inputs re-verified at HEAD with no drift; three Q-R items locked from code (R1-A, Branch B, R5-A); Q-R3 reaffirmed; one out-of-scope triage flag recorded; reviewers-card preservation re-confirmed.
- Iteration 4 (Pass 4 planning-ready) — all items pass; residual-drift sweep landed five user-directed verifications + five other cleanups (status header, intro stale instructions, LD-2 column heading, requirements intro, constitution reminder); SC-007 was the sole Branch-A-leftover and is now Branch-B-locked; reviewers-card preservation re-confirmed (third pass-over); Q-R2 is the sole remaining plan-time decision.

---

## Iteration 4 — Pass 4 planning-readiness sweep

User directed: residual-drift sweep with five focuses. Spec hardening only; no /speckit.plan, no tasks, no source edits.

### Five user-directed verifications

| Directive | Outcome | Evidence in spec |
|---|---|---|
| #1 — Pure-overlay edge case: remove or label as forward-compat only | ✓ Relabeled `forward-compatibility note only, unreachable in #363's scope`; stale "(LD-1 step 5 deferred)" / "Final answer locked in research / data-model" markers dropped | Line 181-area edge-case bullet |
| #2 — No FR/SC implies Branch A | ✓ SC-007 was the sole leftover and is rewritten to Branch-B-locked + FR-022 cross-ref. FR-021..FR-023 already lock Branch B (Pass 3). Non-goals locks shared helper OUT (Pass 3) | SC-007, FR-021..FR-023, Non-goals |
| #3 — No task/commit anticipates demo regen | ✓ Confirmed: LD-5, Assumptions ("1 planning + 1 implementation commit"), Non-goals ("Demo-data work [out]; Q-R5=R5-A confirmed") all consistent. Pass-2 hardening notes preserves historical R5-B mention as accurate Pass-2-time log | LD-5, Assumptions, Non-goals |
| #4 — Reviewer card scroll-and-highlight only | ✓ Confirmed unchanged across LD-2, US3 (4 scenarios), FR-002, FR-017, FR-020, SC-005, SC-006, edge case "Keyboard on reviewers card" | LD-2, US3, FR-002/FR-017/FR-020, SC-005/006, edge cases |
| #5 — Q-R2 sole remaining plan-time decision | ✓ Confirmed: Q-R1 R1-A, Q-R3 OMIT, Q-R4 Branch B, Q-R5 R5-A all locked; Q-R2 stays DEFERRED | Research items section, status header, Pass 4 notes |

### Other Pass 4 cleanups

- Status header: `Pass 3` → `Pass 4 — planning-ready`
- Verified Inputs at HEAD intro: removed stale "Re-verify at HEAD before Pass 4 closes" instruction; replaced with Pass-3-completed assertion
- LD-2 table column heading: "subject to Pass 4 review" → "Q-R2 — pending plan-time lock"
- Requirements section intro: "Branch-aware from Pass 1" → "Branch-aware from Pass 1, hardened through Pass 3 code-validation"
- Constitution reminder: dropped "(this)" Pass-1 placeholder; states current pass and Q-R2-only-remaining
- Final marker: "End of Pass 3" → "End of Pass 4"
- Pass 4 planning-readiness notes section added at bottom (10 enumerated changes from Pass 3)

### Content Quality (Iteration 4)

- [x] No implementation details — Pass 4 added no new contract anchors; only refreshed stale labels.
- [x] Focused on user value and business needs — unchanged.
- [x] Written for non-technical stakeholders — Pass 4 stale-label cleanup improves readability for first-time readers (who would otherwise see contradictory "deferred" / "locked" markers).
- [x] All mandatory sections completed — header advanced; Pass 4 planning-readiness notes added.

### Requirement Completeness (Iteration 4)

- [x] No [NEEDS CLARIFICATION] markers remain — same as Pass 3.
- [x] Requirements are testable and unambiguous — SC-007 now has tighter Branch-B + FR-022 anchor.
- [x] Success criteria are measurable — unchanged.
- [x] Success criteria are technology-agnostic — unchanged.
- [x] All acceptance scenarios are defined — unchanged.
- [x] Edge cases are identified — Pure-overlay edge case relabeled; count unchanged at 11.
- [x] Scope is clearly bounded — unchanged.
- [x] Dependencies and assumptions identified — unchanged.

### Feature Readiness (Iteration 4)

- [x] All functional requirements have clear acceptance criteria — SC-007 / FR-022 cross-reference now explicit.
- [x] User scenarios cover primary flows — unchanged.
- [x] Feature meets measurable outcomes defined in Success Criteria — SC-007 lock made stronger; SC-005/006 reviewer-card preservation re-confirmed.
- [x] No implementation details leak into specification — Pass 4 cleanup added no new prescriptions.

## Iteration 4 outcome

- **No items failed validation** in Iteration 4. All 16 checklist items pass.
- All five user-directed Pass 4 verifications confirmed.
- One leftover (SC-007) corrected.
- Spec is **planning-ready**: ready for `/speckit.plan` with Q-R2 as the sole plan-time decision. Per the user's direction in the Pass 4 approval, do NOT advance to `/speckit.plan`, `/speckit.clarify`, or any source code work until reviewed.
