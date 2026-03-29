# Feature Specification: Align Test Type-Checking with Production Strictness

**Feature Branch**: `042-test-strict-alignment`
**Created**: 2026-03-28
**Status**: Draft
**Input**: [GitHub Issue #209](https://github.com/oddessentials/ado-git-repo-insights/issues/209) — Align tsconfig.test.json with production strict mode

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Catch Type Bugs in Tests Before They Reach Production (Priority: P1)

A contributor writes or modifies a test file and introduces a type error — for example, accessing a property on a possibly-null object without a guard, or passing an untyped parameter to a function. Today, that test compiles and passes because the test configuration relaxes type-checking rules that production enforces. The contributor only discovers the bug later (or never) when the same pattern appears in production code. After this change, the contributor receives an immediate type error in their editor and from the pre-commit hook, catching the issue at the point of authorship.

**Why this priority**: This is the core value of the feature. Every other story depends on tests being held to the same type-safety bar as production code.

**Independent Test**: Can be fully verified by running the type checker against the test configuration and confirming zero errors are reported.

**Acceptance Scenarios**:

1. **Given** the test type-checking configuration inherits production strictness, **When** a contributor introduces a type error in a test file (e.g., accessing a property on a possibly-undefined value), **Then** the type checker reports an error and the pre-commit hook blocks the commit.
2. **Given** all existing test files have been updated to satisfy strict type-checking, **When** the type checker runs against the full test suite, **Then** zero errors are reported.
3. **Given** all type annotations have been added or corrected, **When** the full test suite executes, **Then** all 2,024+ tests pass with verified behavioral equivalence (identical per-test pass/fail/skip status and coverage).

---

### User Story 2 - Unblock Future Test Authoring Under Strict Rules (Priority: P2)

A contributor begins work on issue #204 (data transparency, visual polish), which requires writing ~80 new tests. Because test strictness has already been aligned with production, every new test is written strict from the start. No retroactive migration is needed.

**Why this priority**: This is the strategic motivator for doing this work now, before #204. Writing tests against a loose config and re-strictifying later doubles the effort.

**Independent Test**: Can be verified by creating a new test file that uses strict patterns (explicit types, null guards) and confirming it compiles and passes under the aligned configuration.

**Acceptance Scenarios**:

1. **Given** the test configuration inherits production strictness, **When** a contributor adds a new test file with properly typed code, **Then** the file compiles without errors and tests pass.
2. **Given** the test configuration inherits production strictness, **When** a contributor adds a new test file with an implicit `any` parameter, **Then** the type checker rejects it before commit.

---

### User Story 3 - Maintain Parity Going Forward via Automated Enforcement (Priority: P3)

A contributor attempts to re-introduce a strictness override into the test configuration, or a new strictness flag is added in a future type-checker version. The enforcement layer detects the divergence — whether from an explicit override or a missing new flag — and blocks the change from merging.

**Why this priority**: Without enforcement, the configuration can silently drift back to a loose state. This story ensures the fix is durable and forward-looking, covering not just today's 4 flags but any future additions.

**Independent Test**: Can be verified by temporarily adding a strictness override to the test configuration and confirming the enforcement layer rejects it.

**Acceptance Scenarios**:

1. **Given** the test configuration has no strictness overrides, **When** a contributor adds `strict: false` to the test configuration, **Then** the enforcement layer fails because the resolved strictness settings diverge from production.
2. **Given** a CI gate compares resolved type-checking settings between production and test configurations, **When** a new strictness flag is added to the production configuration, **Then** the test configuration automatically inherits it via `extends` and the CI gate confirms parity.
3. **Given** the test configuration only contains allowlisted overrides (output emission, declaration generation, source maps), **When** any non-allowlisted override is added, **Then** the CI gate rejects the change.

---

### User Story 4 - Prove Behavioral Equivalence After Migration (Priority: P1)

A contributor completes the type-annotation migration across all 33 affected test files. Before the migration merges, a before/after comparison proves that test behavior is identical: same pass/fail results, same assertion counts, same coverage metrics. This guards against non-null assertions or type guards that silently change execution paths.

**Why this priority**: Without proof of equivalence, "zero behavior changes" is a claim, not a fact. Non-null assertions can mask real null-at-runtime bugs by changing the error thrown, and type guards can alter control flow.

**Independent Test**: Can be verified by capturing a baseline snapshot before any changes, then comparing against a post-migration snapshot.

**Acceptance Scenarios**:

1. **Given** a baseline snapshot of per-test pass/fail/skip status and coverage has been captured before migration, **When** all type-annotation fixes are applied, **Then** the post-migration snapshot matches the baseline exactly.
2. **Given** a type fix introduces a non-null assertion on a value that is actually null at runtime, **When** the test suite runs, **Then** the test fails (revealing the latent bug) and the snapshot comparison flags the behavioral difference.

---

### Edge Cases

- What happens when a test intentionally tests error conditions by passing invalid types (negative tests)? These should use properly typed assertions or test-framework error matchers rather than relying on loose typing.
- What happens when a mock object only partially implements an interface? The fix must provide correct partial types rather than silencing the type checker.
- What happens when test helper utilities are shared across files and currently rely on implicit `any` return types? Shared helpers and utilities MUST be typed first, before any leaf test files are fixed, to prevent fragile fixes that break when helpers are later typed.
- What happens when indexed access on arrays or objects returns a possibly-undefined value in test assertions? The test must add appropriate guards or non-null assertions where the test logic guarantees the value exists.
- What happens when a type error (e.g., a type mismatch) reveals a genuine contract violation in the test rather than a missing annotation? These semantic errors MUST NOT be fixed mechanically — they require review to determine whether the test or the production code has the wrong contract.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The test type-checking configuration MUST inherit all strictness rules from the production configuration without overrides. A CI gate MUST compare the resolved type-checking settings between production and test configurations and fail if any strictness-related flags differ (guarding against both explicit overrides and silent inheritance gaps).
- **FR-002**: The test type-checking configuration MUST only contain settings from an explicit allowlist of test-specific overrides (output emission, declaration generation, source maps). Any setting not on the allowlist MUST be rejected by CI. This is forward-looking: new flags added in future type-checker versions are automatically covered because only allowlisted deviations are permitted.
- **FR-003**: All existing test files (33 affected files out of 95 total) MUST compile without errors under the strict configuration
- **FR-004**: All 2,024+ existing tests MUST continue to pass with verified behavioral equivalence. A before/after comparison of per-test pass/fail/skip status and coverage MUST be performed and MUST show no differences. "No behavior changes" is proven by evidence, not asserted by convention.
- **FR-005**: Zero type-checker suppression comments MUST be introduced. No exceptions. Tests that verify error conditions MUST use properly typed assertions or test-framework error matchers, not suppression directives. The suppression count MUST be zero, enforced by CI audit.
- **FR-006**: Every fix MUST be limited to type annotations, null guards, and type assertions — no changes to test logic, assertions, or runtime behavior. Before fixes begin, the 574 errors MUST be categorized into mechanical (missing annotations, null guards) and semantic (genuine type mismatches revealing contract violations). Semantic errors MUST be reviewed individually and MUST NOT be resolved with mechanical casts or assertions.
- **FR-007**: The pre-commit hook and CI MUST run the identical type-check command against the test configuration, via a single shared script. This satisfies QG-35 through QG-38 (Local/CI Parity Gates). The command, arguments, and configuration MUST be the same in both environments — no partial or non-strict modes in either path.
- **FR-008**: Shared test helpers and utility modules MUST be typed to strict standards before any leaf test files are fixed. This prevents fragile fixes where leaf tests infer types from still-untyped helpers, only to break when those helpers are later annotated.
- **FR-009**: All currently-skipped tests (9 skipped tests, 1 skipped suite) MUST compile cleanly under the strict configuration AND MUST be explicitly reviewed before merge. Each skipped test MUST either be un-skipped and pass, or have a documented justification for remaining skipped. No silent carryover of skipped tests through the migration.

### Key Entities

- **Test Configuration**: The file that controls type-checking rules for test files; currently overrides 4 production strictness settings (`strict`, `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`)
- **Type Error**: A compile-time diagnostic reported by the type checker; 574 currently exist across 33 test files when strict mode is enabled
- **Strictness Override**: A configuration setting that relaxes a production rule for test files; all 4 current overrides must be removed, and no future overrides are permitted outside the explicit allowlist
- **Mechanical Error**: A type error fixable by adding annotations, null guards, or non-null assertions without changing test logic (~514 of 574 — null/undefined safety and implicit `any`)
- **Semantic Error**: A type error revealing a genuine contract mismatch between the test and the interface it exercises (~60 of 574 — type mismatch errors TS2345, TS2322, TS2769, TS2488) requiring individual review
- **Behavioral Equivalence Snapshot**: A captured record of test results (pass/fail per test), assertion counts, and coverage metrics used to prove the migration introduced no runtime changes

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The type checker reports zero errors when run against the test configuration (down from 574 errors today)
- **SC-002**: 100% of existing tests (2,024+) pass after migration, with before/after snapshot comparison proving identical per-test pass/fail/skip status and coverage
- **SC-003**: Zero type-checker suppression comments exist in test files, enforced by CI audit with a hard count of zero
- **SC-004**: The test configuration contains only allowlisted overrides (output emission, declaration generation, source maps). A CI gate validates that no non-allowlisted settings are present, covering both current and future type-checker flags.
- **SC-005**: Any future commit that introduces a type error in test code is blocked by both the pre-commit hook and CI, running the same shared command (QG-35–QG-38 compliance)
- **SC-006**: 100% of the ~60 semantic type errors (TS2345, TS2322, TS2769, TS2488) have been individually reviewed and resolved with documented rationale, not mechanical casts
- **SC-007**: All currently-skipped tests have been reviewed: each is either un-skipped and passing, or carries a documented justification for remaining skipped

## Assumptions

- The error count (574) is approximate and based on current codebase state as of 2026-03-28; the actual count at implementation time may vary slightly due to concurrent changes on main
- The pre-commit hook already runs the type checker via `run_repo_hook.py` (added in commit 5d18b31) — the migration will ensure the test configuration is covered by this same path, not a separate invocation
- The ~514 null/undefined and implicit-any errors are expected to be mechanical fixes; the ~60 type-mismatch errors (TS2345, TS2322, TS2769, TS2488) may include genuine contract violations that require test or interface corrections beyond simple annotations
- The existing `run_pr_preflight.py` script provides the parity verification mechanism referenced in LOCAL_CI_PARITY_INVARIANTS.md and can be extended to cover the new resolved-config comparison gate
