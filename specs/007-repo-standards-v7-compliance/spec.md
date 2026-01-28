# Feature Specification: Repository Standards v7.1.1 Compliance

**Feature Branch**: `007-repo-standards-v7-compliance`
**Created**: 2026-01-28
**Status**: Draft
**Input**: User description: "Upgrade to @oddessentials/repo-standards v7.1.1 compliance including TypeScript strictness flags, ESLint security plugin, coverage thresholds, pre-push CI parity, and environment variable protection"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Standards Package Upgrade (Priority: P0)

As a project maintainer, I want the repository standards package upgraded to v7.1.1 so that we receive the latest compliance requirements and can validate our conformance.

**Why this priority**: This is a prerequisite for all other changes. The package upgrade defines what compliance means and provides tooling to verify it.

**Independent Test**: Can be fully tested by running the standards verification commands and confirming they execute against the v7.1.1 schema.

**Acceptance Scenarios**:

1. **Given** the package.json references @oddessentials/repo-standards v7.1.1, **When** running `npm run standards:ts`, **Then** the command outputs the v7 schema requirements for TypeScript
2. **Given** the package.json references @oddessentials/repo-standards v7.1.1, **When** running `npm run standards:py`, **Then** the command outputs the v7 schema requirements for Python

---

### User Story 2 - Developer Code Quality Assurance (Priority: P1)

As a developer contributing to the repository, I want the build system to automatically catch unused code and security vulnerabilities so that code quality issues are identified before code review.

**Why this priority**: This is the foundation of v7.1.1 compliance. Without TypeScript strictness and ESLint security rules, developers may introduce dead code or security vulnerabilities that go undetected until production.

**Independent Test**: Can be fully tested by introducing an unused variable or a security anti-pattern (e.g., eval usage) and verifying the build fails with appropriate error messages.

**Acceptance Scenarios**:

1. **Given** a TypeScript file with an unused local variable, **When** the developer runs the type check, **Then** the build fails with an error identifying the unused variable and its location
2. **Given** a TypeScript file with an unused function parameter, **When** the developer runs the type check, **Then** the build fails unless the parameter is prefixed with underscore (`_`)
3. **Given** a TypeScript file using `eval()` with a variable expression, **When** the developer runs ESLint, **Then** ESLint reports an error for the security violation
4. **Given** a TypeScript file with a potential regex denial-of-service pattern, **When** the developer runs ESLint, **Then** ESLint reports a warning for the unsafe regex

---

### User Story 3 - Test Coverage Enforcement (Priority: P1)

As a project maintainer, I want test coverage thresholds enforced for TypeScript code so that coverage cannot regress below acceptable levels without explicit acknowledgment.

**Why this priority**: Coverage enforcement prevents regression of test quality. Without it, coverage can silently degrade over time, leading to untested code paths and production bugs.

**Independent Test**: Can be fully tested by temporarily reducing test coverage below threshold and verifying the test command fails with a coverage violation message.

**Acceptance Scenarios**:

1. **Given** TypeScript code coverage below 70% for lines, **When** the test suite runs with coverage enabled, **Then** the test command fails with a coverage threshold violation
2. **Given** TypeScript code coverage below 70% for branches, **When** the test suite runs with coverage enabled, **Then** the test command fails with a coverage threshold violation
3. **Given** TypeScript code coverage at or above 70% for all metrics, **When** the test suite runs with coverage enabled, **Then** the test command succeeds

---

### User Story 4 - Pre-push Verification Parity (Priority: P2)

As a developer, I want the pre-push hook to run the same checks as CI so that I can catch failures locally before pushing and waiting for CI results.

**Why this priority**: Pre-push CI parity reduces wasted CI minutes and developer wait time. However, it builds on P1 (the checks must exist before they can be mirrored).

**Independent Test**: Can be fully tested by introducing an ESLint violation, attempting to push, and verifying the push is blocked with an appropriate error message.

**Acceptance Scenarios**:

1. **Given** TypeScript code with an ESLint error, **When** the developer attempts to push, **Then** the pre-push hook blocks the push and displays the ESLint error
2. **Given** TypeScript code passing all checks, **When** the developer attempts to push, **Then** the pre-push hook completes successfully and the push proceeds

---

### User Story 5 - Secret Leak Prevention (Priority: P2)

As a project maintainer, I want environment variable values detected and blocked from commits so that secrets cannot accidentally be committed to the repository.

**Why this priority**: Secret exposure is a critical security risk. However, the repository already has gitleaks for secret scanning, so this is an additional layer of defense rather than a primary control.

**Independent Test**: Can be fully tested by setting an environment variable and attempting to commit a file containing that value, verifying the commit is blocked.

**Acceptance Scenarios**:

1. **Given** the developer has `ADO_PAT` set in their environment, **When** they stage a file containing the actual PAT value, **Then** the commit is blocked with a warning about potential secret exposure
2. **Given** the developer has `ADO_PAT` set in their environment, **When** they stage a file that does not contain the PAT value, **Then** the commit proceeds normally
3. **Given** no protected environment variables are set, **When** the developer commits any file, **Then** the env-guard check passes without errors

---

### Edge Cases

- What happens when a developer uses underscore-prefixed variables that are actually used (not intentionally unused)?
  - TypeScript allows this; underscore prefix is a convention, not a compiler-enforced pattern
- How does the system handle ESLint security rules on legitimate use cases (e.g., dynamic property access)?
  - Security rules are set to `warn` for common patterns that may have legitimate uses, and `error` only for clearly dangerous patterns
- What happens if env-guard check runs but no protected environment variables are set?
  - The check passes immediately with no errors
- How does coverage enforcement handle files that are excluded from coverage?
  - Excluded files (per existing exclusion patterns) do not count toward threshold calculations

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST upgrade @oddessentials/repo-standards package from v6.0.0 to v7.1.1
- **FR-002**: TypeScript compiler MUST enforce `noUnusedLocals` flag across all tsconfig files
- **FR-003**: TypeScript compiler MUST enforce `noUnusedParameters` flag across all tsconfig files
- **FR-004**: ESLint MUST include security plugin with rules for detecting common vulnerabilities
- **FR-005**: ESLint security rules MUST report errors for dangerous patterns (eval, buffer noassert, CSRF)
- **FR-006**: ESLint security rules MUST report warnings for potentially risky patterns (object injection, timing attacks)
- **FR-007**: Test coverage MUST enforce 70% threshold for lines, branches, functions, and statements
- **FR-008**: Pre-push hook MUST run ESLint checks before allowing push
- **FR-009**: System MUST provide environment variable protection to detect secret values in staged files
- **FR-010**: All existing tests MUST continue to pass after compliance changes

### Key Entities

- **Configuration Files**: TypeScript configs that control compiler strictness
- **Linting Configuration**: ESLint config that defines security rules
- **Test Configuration**: Test runner config that enforces coverage thresholds
- **Git Hooks**: Pre-push hook that mirrors CI checks
- **Standards Package**: @oddessentials/repo-standards that defines compliance requirements

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All TypeScript files compile successfully with `noUnusedLocals` and `noUnusedParameters` enabled
- **SC-002**: ESLint passes on all code with security plugin active
- **SC-003**: TypeScript test coverage meets or exceeds 70% for all threshold categories (lines, branches, functions, statements)
- **SC-004**: Pre-push hook successfully blocks pushes containing ESLint violations
- **SC-005**: Standards verification commands execute successfully against v7.1.1 schema
- **SC-006**: All existing CI checks continue to pass after compliance changes
- **SC-007**: Environment variable guard successfully detects and blocks commits containing secret values (when secrets are set in environment)

## Assumptions

- The existing test suite has sufficient coverage to meet the 70% threshold, or coverage gaps can be addressed as part of this feature
- Unused variables/parameters in existing code are either genuinely unused (can be removed) or can be prefixed with underscore to indicate intentional non-use
- The eslint-plugin-security package is compatible with the existing ESLint flat config format
- Developers have the required runtime version installed (as specified by the repo-standards package)
