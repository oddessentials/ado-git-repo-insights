# Feature Specification: Zero Suppressions

**Feature Branch**: `043-zero-suppressions`
**Created**: 2026-03-28
**Status**: Draft
**Input**: User description: "Eliminate all 50 pre-existing suppression comments (issue #211)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Eliminate All Suppressions (Priority: P1)

As a maintainer, I want every suppression comment eliminated from the codebase, so linters and type checkers operate at full strength with zero exceptions.

**Why this priority**: All 50 suppressions must be removed. Every one represents either fixable code or a workaround that must be replaced with a proper solution. This is the entire scope of the feature.

**Independent Test**: Run `python scripts/audit-suppressions.py` and confirm the total count is exactly 0. All existing tests pass, and no new lint or type errors appear.

**Acceptance Scenarios**:

1. **Given** a file with a `security/detect-object-injection` suppression on a provably safe bracket access, **When** the code is refactored to eliminate the lint violation (e.g., lint configuration allowlisting, typed accessor helpers, or Map usage), **Then** the suppression comment is removed and linting passes cleanly.
2. **Given** `types.ts` with 9 `no-explicit-any` suppressions for Window globals, **When** the declarations are replaced with proper type-safe alternatives, **Then** all 9 suppression comments are removed and the bundle system continues to function.
3. **Given** Python files with `F401` unused-import suppressions for dependency detection, **When** the dependency check is restructured to avoid importing the symbol, **Then** the suppression comments are removed and dependency detection still works.

---

### User Story 2 - Resolve Difficult Suppressions Without Exceptions (Priority: P2)

As a maintainer, I want every suppression that appears difficult to remove to be resolved through code changes, lint configuration, or rule restructuring — not retained as a permanent exception. Temporary blockers MUST be eliminated or tracked as defects, not permanent suppressions.

**Why this priority**: Allowing any "justified" suppressions creates a slippery slope. Every suppression has a fix; some just require more creative solutions (e.g., replacing `random.Random` with a project-sanctioned wrapper, restructuring imports, adjusting lint rule scope).

**Independent Test**: Confirm zero suppression comments remain in the codebase. No justification tags exist because no suppressions exist.

**Acceptance Scenarios**:

1. **Given** code that uses `random.Random` for deterministic synthetic data, **When** the code is refactored so the linter no longer flags it (e.g., per-file rule configuration, wrapper function, or scope adjustment), **Then** the suppression comment is removed entirely.
2. **Given** a compile-time type assertion in a test file, **When** the test approach is restructured so no suppression is needed, **Then** the suppression comment is removed entirely.

---

### User Story 3 - Update Baseline and Enforcement Artifacts (Priority: P3)

As a CI system, I need the suppression baseline set to zero and all enforcement gates hardened to reject any suppression count above zero, so the zero-suppression policy is permanently enforced.

**Why this priority**: Without updating enforcement to require exactly zero, the gates would allow regressions up to the old baseline of 50.

**Independent Test**: Run the full pre-commit hook chain and CI suppression audit. Confirm the baseline is zero and any introduction of a suppression comment is blocked.

**Acceptance Scenarios**:

1. **Given** all suppressions have been removed, **When** the suppression audit runs, **Then** it reports exactly 0 total suppressions.
2. **Given** the baseline is set to zero, **When** a contributor adds any new suppression comment, **Then** pre-commit, pre-push, and CI all fail immediately.
3. **Given** test-file suppressions have been eliminated, **When** the ratchet test runs, **Then** the allowlist reflects zero suppressions per file.

---

### Edge Cases

- What happens if removing a suppression reveals a real lint error that was previously masked? The underlying error must be fixed, not re-suppressed.
- What happens if a lint configuration change removes suppressions in one file but causes new violations in another? New violations must be fixed; the total must reach zero.
- What happens if a `@ts-expect-error` is removed but the underlying type error it suppressed has already been fixed? The removal is correct (the suppression was stale).
- What happens if the baseline update is committed but a parallel PR on `main` also changed the baseline? The later-merging branch must rebase and regenerate its baseline.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each of the 50 suppression comments MUST be individually reviewed and eliminated
- **FR-002**: For each suppression, the underlying code MUST be refactored so the lint rule no longer fires — no ESLint per-file rule disables, no ruff per-file-ignores, and no configuration-level silencing of any kind
- **FR-003**: Permanent suppressions are NOT allowed. If a suppression cannot be removed immediately, it MUST be tracked as a defect with a time-bound resolution plan — not retained as a justified exception
- **FR-004**: The suppression baseline MUST be updated to exactly zero total suppressions
- **FR-005**: The test-file ratchet allowlist MUST be updated to reflect zero suppressions per file
- **FR-006**: All existing test suites MUST continue to pass after changes
- **FR-007**: Pre-commit hooks, pre-push preflight, and CI suppression audit MUST all fail if the suppression count is greater than zero
- **FR-008**: No new suppressions MUST be introduced as a side effect of refactoring existing ones away
- **FR-009**: The 26 object-injection suppressions MUST be addressed by code refactors only: `Map` conversions, `.at()` for array access, or destructuring — no lint configuration overrides
- **FR-010**: The 9 explicit-any suppressions for Window globals MUST be addressed by providing proper type declarations
- **FR-011**: The 3 unused-import suppressions MUST be addressed by restructuring dependency detection to avoid importing the symbol
- **FR-012**: The 2 type-syntax suppressions MUST be evaluated against the project's minimum supported version to determine if modern syntax is usable
- **FR-013**: Runtime behavior of all affected code paths MUST remain unchanged after suppression removal
- **FR-014**: No justification tags (`-- REASON:`, `-- SECURITY:`) MUST remain in the final state, because no suppression comments exist to justify
- **FR-015**: The suppression audit script MUST report exactly 0 total suppressions in the final state
- **FR-016**: Pre-commit MUST run `audit-suppressions.py --diff` against the zero baseline on every commit
- **FR-017**: Pre-push MUST run the same suppression check at the same strictness level — no weaker mode allowed
- **FR-018**: The `test:ci` script MUST include the suppression audit — no CI-only step allowed; local `test:ci` and CI must run identical checks
- **FR-019**: The suppression audit MUST execute before all other gates in the hook chain (fail fast — do not waste time on lint, type-check, or tests if suppressions exist)
- **FR-020**: The baseline file MUST be committed at zero and treated as immutable — changes to the baseline are only permitted via this feature branch
- **FR-021**: No bypass paths — the suppression audit MUST execute regardless of trigger scope, changed-file set, or branch name
- **FR-022**: The audit script MUST fail if the baseline file is missing or records a non-zero total
- **FR-023**: No file exclusions in the audit scan — the audit MUST scan the entire repository scope, except explicitly defined generated artifacts (e.g., `node_modules`, `dist`, `build`)
- **FR-024**: The audit script MUST treat all suppression forms equally — no semantic exceptions for type-test files, security rules, or any other category
- **FR-025**: No temporary relaxations allowed during migration — every intermediate commit MUST satisfy the same invariants as the final state (no intermediate per-file ignores, no temporary baselines)
- **FR-026**: The baseline update MUST be the last step after all code changes are complete — not performed early or incrementally

### Key Entities

- **Suppression Comment**: A lint or type-checker suppression inline in source code, tracked by file, scope, type, and rule
- **Suppression Baseline**: The authoritative file that records the suppression count, broken down by scope, type, file, and rule
- **Ratchet Allowlist**: The per-file cap configuration that prevents test-file suppression regression

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The suppression audit script reports exactly 0 total suppressions
- **SC-002**: The suppression baseline file records 0 total, 0 in every scope, 0 in every type, 0 in every file, and 0 in every rule
- **SC-003**: All enforcement gates (pre-commit, pre-push, CI, `test:ci`) fail if any suppression comment is introduced
- **SC-004**: Zero new lint or type errors are introduced by the refactoring
- **SC-005**: All existing tests pass without modification to test assertions (test infrastructure changes like ratchet updates are acceptable)
- **SC-006**: No suppression comments or justification tags remain anywhere in tracked source files
- **SC-007**: The suppression audit runs first in the hook chain — a suppression failure aborts before any other gate executes
- **SC-008**: Deleting or corrupting the baseline file causes the audit to fail, not silently pass
- **SC-009**: The audit scans the full repository scope with no file exclusions beyond generated artifacts

## Assumptions

- Every suppressed pattern has a code-level fix that satisfies the lint rule without configuration-level silencing
- `unknown` type can replace `any` for Window globals without breaking cross-bundle communication
- If `*.type-test.ts` files currently contain suppression comments that are excluded from the baseline scan, they must either be brought into scope or confirmed suppression-free
- The suppression audit script and its baseline-update flag are the authoritative mechanism for regenerating the baseline
- The hook orchestrator supports reordering gates so the suppression audit runs first
- Parallel PRs that touch the baseline will be rebased after this branch merges
