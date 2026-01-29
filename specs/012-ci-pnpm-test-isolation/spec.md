# Feature Specification: CI/pnpm Hardening with Test Isolation

**Feature Branch**: `012-ci-pnpm-test-isolation`
**Created**: 2026-01-29
**Status**: Draft
**Input**: User description: "CI/pnpm hardening with deterministic setup, test isolation, and regression guards - Final, no-deferral resolution checklist for pnpm version drift, test runtime coupling, and CI structural failures"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - CI Maintainer Prevents pnpm Setup Drift (Priority: P1)

As a CI maintainer, I need all workflows to use a deterministic pnpm version so that builds don't fail due to inconsistent tooling versions across jobs.

**Why this priority**: pnpm version drift is the root cause of CI failures. Without deterministic version locking, every workflow can potentially resolve a different pnpm version, causing unpredictable build failures.

**Independent Test**: Can be fully tested by running any CI workflow and verifying the pnpm version in logs matches the locked version. Delivers immediate stability for all CI jobs.

**Acceptance Scenarios**:

1. **Given** the root package.json contains `"packageManager": "pnpm@9.15.0"`, **When** any workflow runs, **Then** the pnpm version printed in logs is exactly `9.15.0`
2. **Given** a workflow uses the shared pnpm setup action, **When** the workflow executes, **Then** pnpm is available without specifying `with: version` in workflow YAML
3. **Given** a developer clones the repository, **When** they run corepack-enabled commands, **Then** the correct pnpm version is automatically installed

---

### User Story 2 - Developer Runs Unit Tests Without Python (Priority: P1)

As a developer without Python installed, I need to run unit tests locally so that I can verify JavaScript/TypeScript code changes without setting up the full toolchain.

**Why this priority**: Developers should not be blocked by cross-language dependencies when working on frontend code. Test isolation enables faster feedback loops and reduces setup friction.

**Independent Test**: Can be fully tested by running `pnpm test:unit` on a machine without Python and verifying all tests pass. Delivers immediate value for frontend developers.

**Acceptance Scenarios**:

1. **Given** Python is not installed on the machine, **When** a developer runs `pnpm test:unit`, **Then** all unit tests execute successfully
2. **Given** a test attempts to spawn a Python process, **When** that test is in the unit test suite, **Then** the test is either excluded or fails with a clear error explaining it belongs in integration tests
3. **Given** the default `pnpm test` command, **When** a developer runs it, **Then** only unit tests (no Python dependencies) are executed

---

### User Story 3 - CI Operator Runs Full Integration Tests (Priority: P2)

As a CI operator, I need a dedicated test command that runs both unit and Python integration tests so that the complete test suite validates all functionality.

**Why this priority**: Full test coverage is required for release validation, but should be clearly separated from quick feedback unit tests.

**Independent Test**: Can be fully tested by running `pnpm test:all` in an environment with Python and verifying both unit and integration tests execute.

**Acceptance Scenarios**:

1. **Given** Python is installed with required dependencies, **When** CI runs `pnpm test:all`, **Then** both unit tests and Python integration tests execute
2. **Given** a Python integration test exists, **When** `pnpm test:unit` is run, **Then** that test is not executed
3. **Given** the `extension-tests` CI job, **When** it runs, **Then** it installs Python and executes `pnpm test:all`

---

### User Story 4 - New Developer Understands Test Architecture (Priority: P2)

As a new developer joining the project, I need clear documentation explaining which tests require Python so that I can set up my environment correctly and run the appropriate test suite.

**Why this priority**: Reducing onboarding friction improves developer productivity and prevents confusion about test failures due to missing dependencies.

**Independent Test**: Can be fully tested by having a new developer follow the documentation to set up and run tests. Delivers immediate clarity on test organization.

**Acceptance Scenarios**:

1. **Given** the tests README exists, **When** a developer reads it, **Then** they can identify which tests require Python
2. **Given** the tests README, **When** a developer looks for Python dependencies, **Then** the exact dependencies (e.g., pandas) are listed
3. **Given** the tests README, **When** a developer wants to run integration tests, **Then** the correct npm script is documented

---

### User Story 5 - CI Maintainer Detects Configuration Regression (Priority: P2)

As a CI maintainer, I need automated guards that fail the build when critical configuration is removed or bypassed so that infrastructure changes don't silently break the setup.

**Why this priority**: Without regression guards, well-intentioned changes can reintroduce the same problems. Automated detection prevents drift over time.

**Independent Test**: Can be fully tested by intentionally removing `packageManager` from package.json or adding inline pnpm setup, and verifying CI fails.

**Acceptance Scenarios**:

1. **Given** `packageManager` is removed from root package.json, **When** CI runs, **Then** the build fails with a clear error message
2. **Given** a workflow adds inline pnpm setup instead of using the composite action, **When** CI runs, **Then** the build fails with a clear error message
3. **Given** all guards pass, **When** CI runs, **Then** the build proceeds normally

---

### User Story 6 - CI Jobs Have Distinct Responsibilities (Priority: P3)

As a CI architect, I need each CI job to have a clearly defined responsibility so that failures are easily diagnosed and job duplication is eliminated.

**Why this priority**: Overlapping job responsibilities make debugging difficult and waste compute resources. Clear separation enables targeted fixes.

**Independent Test**: Can be fully tested by examining CI job definitions and verifying each job has unique dependencies and test commands.

**Acceptance Scenarios**:

1. **Given** the `extension-tests` job, **When** it runs, **Then** it installs Python and runs `pnpm test:all`
2. **Given** the `fresh-clone-verify` job, **When** it runs, **Then** it does NOT install Python and runs `pnpm test:unit` plus build verification
3. **Given** both jobs, **When** their dependencies are compared, **Then** they do not share identical dependency surfaces

---

### Edge Cases

- What happens when corepack is disabled on a developer machine?
  - The shared setup action enables corepack explicitly; developers should run `corepack enable` manually if not using the CI environment
- What happens when a new workflow is added without using the shared pnpm action?
  - Regression tripwire CI job fails, blocking the PR
- What happens when Python integration tests are added to the wrong directory?
  - The `test:unit` script excludes the integration directory; if tests still fail on Python-less machines, the CI guard job catches this
- How does the system handle a partially configured environment (e.g., Python installed but missing pandas)?
  - Integration tests fail with clear dependency errors; this is expected behavior for incomplete setups

## Requirements *(mandatory)*

### Functional Requirements

**pnpm Determinism**
- **FR-001**: Repository root package.json MUST contain `"packageManager": "pnpm@9.15.0"` field
- **FR-002**: All workflows MUST resolve pnpm version from the packageManager field without explicit version specification
- **FR-003**: A shared composite action `.github/actions/setup-pnpm/action.yml` MUST be created containing pnpm/action-setup, actions/setup-node, and corepack enable
- **FR-004**: All workflows (ui-bundle-sync, build-extension, extension-tests, fresh-clone-verify) MUST use the shared pnpm setup action instead of inline setup

**Test Isolation**
- **FR-005**: Test scripts MUST be split into `test:unit` (JavaScript/TypeScript only, no Python) and `test:all` (unit + Python integration)
- **FR-006**: The default `test` script MUST map to `test:unit` only
- **FR-007**: Python-calling tests MUST be isolated in a dedicated directory or gated behind an environment flag (`RUN_PY_INTEGRATION=1`)
- **FR-008**: Running `test:unit` MUST NOT execute any code that spawns Python processes under any condition

**CI Job Separation**
- **FR-009**: The `extension-tests` job MUST install Python and run `test:all`
- **FR-010**: The `fresh-clone-verify` job MUST NOT install Python and MUST run `test:unit` plus minimal build verification
- **FR-011**: A CI job MUST exist that runs `test:unit` in an environment without Python installed to enforce test isolation

**Documentation**
- **FR-012**: A README file MUST be created at `extension/tests/README.md` documenting which tests require Python, exact Python dependencies, and which npm script runs them

**Regression Guards**
- **FR-013**: CI MUST fail if `packageManager` is removed from root package.json
- **FR-014**: CI MUST fail if any workflow uses inline pnpm setup instead of the composite action

### Key Entities

- **Composite Action**: Reusable GitHub Actions workflow component that encapsulates pnpm setup (pnpm/action-setup, setup-node, corepack enable)
- **Unit Tests**: Tests that execute only JavaScript/TypeScript code with no external runtime dependencies
- **Integration Tests**: Tests that may spawn Python processes or require the full development environment
- **Regression Guard**: Automated check that fails the build when critical configuration is missing or bypassed

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All CI workflow logs print `pnpm@9.15.0` as the installed version
- **SC-002**: `git grep pnpm/action-setup .github/workflows` returns zero direct usages (only composite action references)
- **SC-003**: `pnpm test:unit` passes on a machine with Node.js but no Python installed
- **SC-004**: New CI jobs cannot break due to pnpm setup drift (verified by shared action usage)
- **SC-005**: Developers can run tests locally without Python by executing a single command (`pnpm test:unit`)
- **SC-006**: New developers can determine test requirements within 2 minutes of reading the tests README
- **SC-007**: Intentionally removing `packageManager` from package.json causes CI to fail within 1 build cycle
- **SC-008**: The `extension-tests` and `fresh-clone-verify` jobs have distinct dependency surfaces with no overlap in Python requirements

## Assumptions

- The repository uses GitHub Actions for CI/CD
- pnpm 9.15.0 is the target version (as specified in the existing extension/package.json)
- Node.js 22 is the target runtime (as referenced in the checklist)
- Python 3.11 is required for integration tests (matching CI configuration)
- The pandas library is the primary Python dependency for integration tests
- Corepack is available in the GitHub Actions Node.js environment

## Constraints

- Changes must not break existing CI workflows during the transition
- The shared composite action must be backwards-compatible with all existing workflow patterns
- Test isolation must be achieved without duplicating test infrastructure
- Documentation must be co-located with the tests it describes
