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

- **Tasks Pass 1 Codex catch #1 (2026-04-20, cross-OS)**: Codex stop-review flagged that the Pass 1 `tasks.md` draft contained two non-cross-OS shell idioms: (a) T003 used `mkdir -p .tmp/060-verify` which fails on Windows `cmd.exe` and PowerShell; (b) T050 proposed `rsync` for the stage-then-promote copy which is not present on Windows by default. Both fixed in-place by substituting OS-neutral alternatives (`pathlib.Path.mkdir(parents=True, exist_ok=True)` and, initially, `shutil.copytree(dirs_exist_ok=True)` as an option alongside the existing `atomic_replace_docs_data` helper). Added a new "Cross-OS discipline (QG-39)" section near the top of `tasks.md` enumerating banned shell idioms.

- **Tasks Pass 1 Codex catch #2 (2026-04-20, FR-023 atomicity)**: immediately after catch #1, Codex re-reviewed and flagged that the cross-OS fix to T050 introduced a new violation — `shutil.copytree(dirs_exist_ok=True)` is **not atomic**; a mid-copy crash leaves `docs/data/` partially written, violating FR-023's atomic-failure invariant ("on ANY failure, `docs/data/` byte-identical to pre-run state") and Constitution Principle VII ("No Publish on Failure"). Rewrote T050 to:
  1. Mandate stage → strip → atomic-promote as the only accepted flow.
  2. Require the promotion step use a rename-based atomic helper (`atomic_replace_docs_data` or a documented equivalent with the same contract), which MAY require extracting the existing helper from `scripts/build-demo-dataset.py` into a shared module for reuse.
  3. Explicitly enumerate forbidden alternatives by name: `shutil.copytree(..., dirs_exist_ok=True)`, any per-file copy loop, `rsync`, `cp -r`, `robocopy`, direct-to-`docs/data/` writes with post-hoc verify. Each is named as a silent FR-023 violator.
  4. Reference Constitution Principle VII explicitly as the governing invariant.

- **Tasks Pass 1 Codex catch #3 (2026-04-20, source-verified correction)**: after catch #2 Codex re-reviewed and flagged that the newly-named `atomic_replace_docs_data` helper does not exist in the repo. Source read confirmed: the actual helper is `promote_data` at `scripts/build-demo-dataset.py:1044`, and its implementation is `shutil.copytree(dirs_exist_ok=True)` + stale-file cleanup + content-match validation — NOT rename-based atomic. My catch-#2 fix invented a helper and misstated repo design. Reframed in source-verified form:
  1. Corrected all 11 `atomic_replace_docs_data` references across 6 spec files (`tasks.md`, `contracts/demo-strip-gate.md`, `code-surface-map.md`, `data-model.md`, `plan.md`, `quickstart.md`) to the real helper name `promote_data`. Historical log entries for catches #1 and #2 retain the original phrasing as a record of what was written at that time.
  2. Narrowed FR-023's atomicity claim: the spec now says on *gate* failure (not any failure) `docs/data/` is byte-identical, enforced by gate-before-promote ordering. A new "Known non-atomic promotion step (acknowledged pre-existing behavior)" clause explicitly acknowledges `promote_data`'s `shutil.copytree` implementation, explains why the privacy invariant still holds (gate has already stripped staging source — partial promotion contains no PR residue), and scopes rename-based-atomic upgrade OUT of feature 060.
  3. Rewrote T050 to describe the real flow honestly: stage → strip → call `promote_data` on success; forbid reimplementing a parallel helper; acknowledge `promote_data`'s non-atomicity with the privacy argument.
  4. The synthetic leak-test contract in FR-023 re-stated as 4 assertions: residue injected → gate fails → `promote_data` not invoked → `docs/data/` byte-identical. This is verifiable against real infrastructure.

- **Tasks Pass 1 Codex catch #4 (2026-04-20, flow-contradiction in catch #3 fix)**: after catch #3, Codex re-reviewed and flagged that the fix still pointed implementers at the wrong publish flow. Source-verified the actual orchestration:
  - `scripts/build-demo-dataset.py:54-55` declares `GENERATOR_STEPS = ["generate-demo-data.py", ...]`.
  - `scripts/build-demo-dataset.py:1095` calls `run_generator(script_name, ARTIFACT_DATA_DIR)` — passing ARTIFACT_DATA_DIR explicitly as the output root.
  - So in the **production-orchestrated flow**, `generate-demo-data.py` writes into `ARTIFACT_DATA_DIR`, NOT into `docs/data/`. Its `DEFAULT_OUTPUT_DIR = docs/data/` (line 105) is only exercised by standalone developer invocation.
  - My catch #3 had required refactoring `generate-demo-data.py` to "stage-then-promote" — but that would **break the orchestrated contract** (`run_generator` expects the script to write into the explicit ARTIFACT_DATA_DIR, not stage elsewhere and promote independently).

  Reframed to the correct architecture:
  1. **FR-023 rewritten** to name `promote_data` as the single authoritative write boundary to `docs/data/`. Gate placement: inside `promote_data` as its FIRST step when destination is `DOCS_DATA_DIR`. Single authoritative gate site (QG-49).
  2. **T049 rewritten** to wire the gate inside `promote_data`, not at the call site in `build-demo-dataset.py`.
  3. **T050 rewritten** to close the `generate-demo-data.py` standalone-bypass via (a) changing `DEFAULT_OUTPUT_DIR` away from `docs/data/` and (b) adding an early-exit guard that rejects `--output-root == DOCS_DATA_DIR`. Explicitly does NOT refactor the script for stage-then-promote (that would break the orchestrator).
  4. **FR-023 + demo-strip-gate.md contract** acquired a new "Bypass-prevention for the standalone developer path" clause documenting (a)+(b) + a static invariant test requiring any write to `docs/data/` go through `promote_data`.
  5. **Integration-contract examples in `contracts/demo-strip-gate.md` rewritten** to show the gate inside `promote_data` (not at the call site) and the generate-demo-data.py bypass-closure (not a duplicate gate).

  No new FRs; FR-023 rewritten (flow corrected, contradictory "refactor generate-demo-data.py" language removed); T049 + T050 rewritten; contract's integration section rewritten. Key lesson compounds catch #3's: source-verifying the helper's NAME is not enough — you also have to trace its CALLERS to understand the real flow before prescribing implementer actions.

- **Plan Pass 2 hardening (user-directed, 2026-04-20)**: eight hardenings applied after plan Pass 1 generation:
  1. **FR-003 tightened** — `_prs_truncated` / `_prs_cap` are immutable after load; consumers MUST NOT mutate, re-derive, or infer from `prs.length` (prevents cross-version drift when cap changes).
  2. **FR-001 tightened** — absence of `prs` is a valid, permanent, backward-compat-preserving state. Consumers render the supported-empty content state deterministically. No load-warning, no error, no degradation of other surfaces.
  3. **FR-021 tightened** — explicit ONE-input-to-ONE-output transform; no parallel filter function, no cached intermediate, no second invocation, no conditional path, no post-processing pass. Filter × aggregator-truncation lossiness declared "intentional at the aggregator boundary"; consumers MUST NOT attempt recovery by any alternative data path.
  4. **FR-023 tightened** — atomic-failure semantics added. Gate runs on a staging location before `docs/data/` is touched; on failure, `docs/data/` is byte-identical to its pre-run state. `generate-demo-data.py` flagged as requiring stage-then-promote refactor (currently writes direct-to-`docs/data/`). Synthetic leak test verifies failure + block + intact prior state.
  5. **FR-014 tightened** — privacy-posture ordering becomes mechanized. A new single authoritative test (`tests/unit/test_privacy_posture_ordering.py`) fails CI + pre-push if producer code emits `prs` without the privacy-posture section present in `docs/reference/dataset-contract.md`.
  6. **SC-001 made measurable** — 250 ms wall-clock ceiling between activation and panel rendered (jsdom, 500-PR fixture) PLUS zero new outbound network activity during activation. Removes the unverifiable "≥99% inside animation" language.
  7. **SC-016 added** — mechanized test-floor Δ: existing `check_ratchet_bump.py` gate named as per-commit mechanism; plan-level protocol added for commit-time Δ calculation (junit → preview → exact bump).
  8. **Demo-strip-gate contract extended** — explicit atomic-failure caller responsibilities documented (stage-then-promote for `generate-demo-data.py`).

  No new FRs added; every gap addressed via tightening of existing FRs. One new SC (SC-016). FR count unchanged at 28 (FR-001 through FR-026 plus FR-005a and FR-007a); SC count: 15 → 16.

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
