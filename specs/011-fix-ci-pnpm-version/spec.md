# Feature Specification: Fix CI pnpm Version Specification

**Feature Branch**: `011-fix-ci-pnpm-version`
**Created**: 2026-01-29
**Status**: Draft
**Input**: User description: "Several build errors must be resolved professionally, without reducing quality checks. pnpm/action-setup@v4 failing with 'No pnpm version is specified' error across multiple workflow steps. Jest test results XML not found as a downstream consequence."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - CI Pipeline Executes Successfully (Priority: P1)

As a developer pushing code to the repository, I need the CI pipeline to execute without infrastructure errors so that my code changes can be validated and merged.

**Why this priority**: Without a functioning CI pipeline, no code can be merged, blocking all development work across the team.

**Independent Test**: Can be fully tested by pushing a commit to any branch and observing that all GitHub Actions workflow jobs complete without pnpm setup errors.

**Acceptance Scenarios**:

1. **Given** a commit is pushed to any branch, **When** GitHub Actions workflows trigger, **Then** the pnpm/action-setup@v4 step completes successfully without "No pnpm version is specified" error
2. **Given** the pnpm setup completes successfully, **When** the test job runs, **Then** Jest executes and produces test-results.xml output file
3. **Given** multiple workflow jobs use pnpm/action-setup@v4, **When** any workflow runs, **Then** all instances of pnpm setup succeed consistently

---

### User Story 2 - Test Results Are Captured and Reported (Priority: P2)

As a developer reviewing a pull request, I need Jest test results to be captured and available in the CI output so that I can verify test coverage and identify failing tests.

**Why this priority**: Test result visibility is essential for code review quality, but is a downstream concern after the CI infrastructure works.

**Independent Test**: Can be tested by running the test workflow and verifying that test-results.xml is generated and the test summary appears in GitHub Actions.

**Acceptance Scenarios**:

1. **Given** pnpm is installed correctly, **When** Jest tests run, **Then** extension/test-results.xml is generated in JUnit format
2. **Given** tests complete (pass or fail), **When** the workflow finishes, **Then** test results are available in the GitHub Actions summary
3. **Given** a test syntax error exists, **When** Jest fails to start, **Then** the diagnostic message correctly identifies the failure cause

---

### Edge Cases

- What happens when package.json already has a packageManager field with a different version?
- How does the system handle workflow runs on forks that may have different package.json contents?
- What happens if a future pnpm major version introduces breaking changes?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: All GitHub Actions workflows using pnpm/action-setup@v4 MUST have an explicit pnpm version specified
- **FR-002**: The pnpm version MUST be specified using the package.json "packageManager" field (corepack standard)
- **FR-003**: The packageManager field MUST follow the format "pnpm@X.Y.Z" where X.Y.Z is a specific semver version
- **FR-004**: The specified pnpm version MUST be compatible with the project's existing pnpm-lock.yaml lockfile version
- **FR-005**: All workflow files MUST continue to use pnpm/action-setup@v4 without the deprecated "version" input parameter
- **FR-006**: Jest configuration MUST produce JUnit XML output at extension/test-results.xml when tests execute
- **FR-007**: Quality checks (linting, type checking, tests) MUST NOT be reduced or bypassed to resolve the build errors

### Key Entities

- **package.json**: Root package manifest that will contain the packageManager field specifying pnpm version
- **GitHub Actions Workflows**: YAML files in .github/workflows/ that invoke pnpm/action-setup@v4
- **pnpm-lock.yaml**: Lockfile that must remain compatible with the specified pnpm version

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of CI workflow runs complete the pnpm setup step without "No pnpm version is specified" error
- **SC-002**: Jest test job produces extension/test-results.xml on every successful test execution
- **SC-003**: All existing quality checks (ESLint, TypeScript, Jest tests) continue to run with same pass/fail behavior as before
- **SC-004**: Zero workflow file changes required to the "version" input parameter of pnpm/action-setup
- **SC-005**: CI pipeline returns to green status on the main branch within one PR merge
