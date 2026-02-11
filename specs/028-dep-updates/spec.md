# Feature Specification: Dependency Updates

**Feature Branch**: `028-dep-updates`
**Created**: 2026-02-10
**Status**: Draft
**Input**: User description: "NEXT_STEPS.md — Update 3rd party dependencies based on audit findings"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Apply Safe Patch-Level Updates (Priority: P1)

A maintainer wants to apply the low-risk, patch-level dependency updates that have no breaking changes, bringing the project's dependencies up to date without risk of regression.

**Why this priority**: These are zero-risk updates that reduce security exposure and keep the dependency surface current. They unblock further work by establishing a clean baseline.

**Independent Test**: Can be fully tested by applying each update locally, running the full CI pipeline, and confirming all checks pass.

**Acceptance Scenarios**:

1. **Given** dependency-cruiser is at 17.3.7, **When** the maintainer updates it to 17.3.8, **Then** CI passes with no test failures or behavior changes.
2. **Given** serve is exactly pinned at 14.2.0, **When** the maintainer updates the pin to 14.2.5 and the version guard test, **Then** CI passes including smoke tests.
3. **Given** @types/node is at 25.1.0, **When** the maintainer updates it to 25.2.2, **Then** CI passes with no type errors.

---

### User Story 2 - Refresh Lockfiles for In-Range Updates (Priority: P1)

A maintainer wants to refresh lockfiles in both the extension and root directories to pick up minor/patch versions that are already within the declared semver ranges, without changing any package declarations.

**Why this priority**: Low effort, no declaration changes, purely lockfile updates. Picks up bug fixes and security patches already permitted by the existing version constraints.

**Independent Test**: Can be tested by refreshing lockfiles in both directories, then executing the full test suite and confirming all pass.

**Acceptance Scenarios**:

1. **Given** the extension lockfile has stale resolved versions within allowed ranges, **When** the maintainer refreshes the lockfile, **Then** versions update and all tests pass.
2. **Given** the root lockfile has stale resolved versions, **When** the maintainer refreshes the lockfile, **Then** versions update and the release toolchain works correctly.

---

### User Story 3 - Upgrade CI Caching Action (Priority: P2)

A maintainer wants to upgrade the CI caching action from v4 to v5 to benefit from improved caching performance and stay on a supported major version.

**Why this priority**: Important for CI health and performance, but requires verification that hosted runners meet the minimum version requirement.

**Independent Test**: Can be tested by updating the workflow file, pushing to a feature branch, and confirming all CI jobs that use caching pass successfully.

**Acceptance Scenarios**:

1. **Given** CI workflows reference the caching action at v4, **When** the maintainer updates to v5, **Then** all CI jobs that use caching pass without errors.
2. **Given** the scalability-tests job uses caching, **When** upgraded to v5, **Then** the cache restore and save steps function identically.

---

### User Story 4 - Migrate Linter/Formatter to Latest Version (Priority: P3)

A maintainer wants to upgrade the Python linter/formatter to the latest version, adopting the new formatting style and benefiting from newly stabilized lint rules.

**Why this priority**: Breaking formatting change that will touch many files. Requires a focused session to reformat the codebase, update the pre-commit configuration in lockstep, verify no new lint violations from stabilized rules, and update the suppression baseline.

**Independent Test**: Can be tested by bumping the linter version in both the project config and the pre-commit config, running the formatter and checker, then verifying type checks and tests pass.

**Acceptance Scenarios**:

1. **Given** the linter is at the current version, **When** the maintainer upgrades and runs the formatter, **Then** all source files are reformatted to the new style and CI passes.
2. **Given** the pre-commit config pins the linter to the old version, **When** upgraded, **Then** the CI version parity check passes.
3. **Given** newly stabilized rules become active, **When** the linter runs on the codebase, **Then** any new violations are either fixed or explicitly suppressed with justification.

---

### User Story 5 - Upgrade Browser Test Framework (Priority: P3)

A maintainer wants to upgrade the browser test framework from 1.50.0 to 1.58.2 to benefit from browser engine updates, bug fixes, and new testing capabilities.

**Why this priority**: 8 minor versions of changes spanning browser binary updates. Requires updating the exact-pinned version, re-downloading browser binaries, and running the full smoke test suite. Moderate risk of selector or timing changes.

**Independent Test**: Can be tested by updating the pinned version, running install (triggers browser download), then executing the smoke test suite and the full test suite.

**Acceptance Scenarios**:

1. **Given** the browser test framework is pinned at 1.50.0, **When** updated to 1.58.2, **Then** the version guard test passes with the new exact version.
2. **Given** smoke tests rely on browser rendering behavior, **When** the framework is upgraded, **Then** all smoke tests pass with the new browser version.

---

### User Story 6 - Upgrade File Globbing Library (Priority: P3)

A maintainer wants to upgrade the file globbing library from v10 to v13, closing a 3-major-version gap.

**Why this priority**: Largest breaking change in the set. The migration drops older runtime support, removes the CLI (split to a separate package), and removes an unsafe option. Requires auditing all usage sites in tests and scripts.

**Independent Test**: Can be tested by upgrading the package, running install, then executing the full test suite to identify any breakages.

**Acceptance Scenarios**:

1. **Given** the globbing library is at v10, **When** upgraded to v13, **Then** all test files that use it continue to function correctly.
2. **Given** v13 removed the CLI, **When** the upgrade is applied, **Then** no build scripts or CI steps depend on the CLI binary.

---

### Edge Cases

- What happens if a patch-level update introduces unexpected test failures?
- How does the system handle a lockfile refresh that changes transitive dependency versions, introducing unexpected type errors or test failures?
- What happens if the browser binary download fails or times out during install?
- What if the linter upgrade reformats code in a way that conflicts with pre-existing inline suppression comments?
- What if a "SAFE" lockfile update pulls in a transitive dependency with a security vulnerability?
- What if the version guard test assertions need structural changes beyond a simple version string update?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: All safe patch-level updates (dependency-cruiser, serve, @types/node) MUST be applied with CI passing on all matrix legs before proceeding to other updates.
- **FR-002**: Exactly-pinned dependencies MUST have their version guard tests updated when the pin value changes.
- **FR-003**: The linter/formatter upgrade MUST update both the project configuration and the pre-commit configuration in the same commit to maintain CI version parity enforcement.
- **FR-004**: After bulk reformatting, the suppression baseline MUST be regenerated to reflect the new line numbers and counts.
- **FR-005**: Lockfile refreshes MUST NOT modify any package declarations — only lockfile resolved versions may change.
- **FR-006**: The CI caching action upgrade MUST be verified against the minimum runner version requirement before merging.
- **FR-007**: The file globbing library upgrade MUST include an audit of all files that import or reference the library to identify breaking usage.
- **FR-008**: All dependency updates MUST pass the full CI pipeline including type checking, linting, and test suites.
- **FR-009**: Version coupling constraints MUST be respected: coupled packages must share the same major version; cross-major pairings must be documented and validated.
- **FR-010**: Each batch of updates MUST be merged sequentially (Batch 1, then Batch 2, then Batch 3) to isolate regression sources.

### Key Entities

- **Dependency**: A third-party package with a name, current version, target version, risk classification (SAFE / NEEDS REVIEW / SEPARATE SESSION), and zero or more coupling constraints.
- **Dependency Update**: A version bump identified by audit, with a current version, target version, and risk classification.
- **Version Guard Test**: A meta-test that enforces exact pinning of specific dependencies, requiring coordinated updates across the package declaration and the test file.
- **Suppression Baseline**: A tracked count of lint/type suppression comments that must be regenerated after bulk reformatting.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 3 safe patch-level updates (dependency-cruiser, serve, @types/node) are applied and CI is green on main.
- **SC-002**: Lockfile refresh picks up at least 4 in-range version bumps without any test failures.
- **SC-003**: The CI caching action upgrade results in all caching jobs passing on the first attempt.
- **SC-004**: After linter migration, the full test suite passes with zero new violations unaccounted for.
- **SC-005**: After browser test framework upgrade, all smoke tests pass with the updated engine on the first run.
- **SC-006**: After file globbing library upgrade, all test files that use globbing produce identical results to the previous version baseline.
- **SC-007**: All 7 audited dependency updates are applied and no open Dependabot PRs remain.
- **SC-008**: No security advisories remain for any direct dependency after all updates are applied.

## Assumptions

- Hosted CI runners already meet the minimum runner version required for the new caching action.
- The project does not use removed modules from optional ML dependencies (will be verified before upgrading).
- File globbing usage in the project is limited to test infrastructure and does not rely on the removed CLI feature.
- The linter's new formatting style changes are purely cosmetic (whitespace, line breaks) and do not alter code semantics.
- Transitive dependency major bumps will resolve automatically when direct dependencies are updated and do not require manual intervention.

## Scope Boundaries

**In scope**:
- All 7 audited dependency updates (applied manually, Dependabot PRs closed)
- Lockfile refreshes for in-range bumps
- Version guard test updates for pinned dependencies
- Linter reformatting and suppression baseline update
- File globbing library usage audit and migration

**Out of scope**:
- Major linter framework migration (deferred until ecosystem stabilizes)
- Cross-major test runner adapter adoption (not yet released)
- Pre-commit hooks major version migration (low priority, needs changelog review)
- Type definition major version jumps for test environment types (low priority, types-only)
- Package manager version bump (locked for deterministic builds)
- Runtime version changes (kept at current LTS)
