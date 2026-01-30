# Feature Specification: Dynamic CI Badges

**Feature Branch**: `015-dynamic-badges`
**Created**: 2026-01-29
**Status**: Draft
**Input**: User description: "Publish deterministic JSON badge source of truth from CI and render 4 distinct Shields dynamic badges for Python/TypeScript coverage and test counts"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Accurate Coverage Metrics (Priority: P1)

A project maintainer visits the GitHub README and immediately sees the current test coverage for both Python and TypeScript codebases, displayed as distinct, clearly labeled badges that update automatically after each CI run.

**Why this priority**: This is the core value proposition - replacing broken/static badges with accurate, automated coverage visibility.

**Independent Test**: Can be tested by triggering a CI run, waiting for completion, and verifying the README badges display the correct coverage percentages that match the actual test reports.

**Acceptance Scenarios**:

1. **Given** CI completes successfully on main branch, **When** user views the README, **Then** they see "Python Coverage: X%" badge with the actual coverage percentage
2. **Given** CI completes successfully on main branch, **When** user views the README, **Then** they see "TypeScript Coverage: X%" badge with the actual coverage percentage
3. **Given** badges are displayed, **When** user compares badge values to CI logs, **Then** the values match exactly (within rounding tolerance)

---

### User Story 2 - View Test Counts (Priority: P1)

A project maintainer views the README and sees how many tests are passing and how many are skipped for both Python and TypeScript test suites.

**Why this priority**: Test counts provide confidence in test suite health and catch silent test skips.

**Independent Test**: Can be tested by running CI, then verifying the test count badges show values matching the JUnit XML test results.

**Acceptance Scenarios**:

1. **Given** CI completes with 312 Python tests passing and 0 skipped, **When** user views README, **Then** badge shows "Python Tests: 312 passed"
2. **Given** CI completes with 5 skipped TypeScript tests, **When** user views README, **Then** badge shows skipped count alongside passed count
3. **Given** a test is added to the suite, **When** CI runs, **Then** the badge count automatically increases

---

### User Story 3 - Automated Badge Updates (Priority: P1)

After any successful CI run on main branch, badges update automatically without any manual intervention.

**Why this priority**: Automation is a hard requirement - manual steps defeat the purpose.

**Independent Test**: Push a commit to main, wait for CI, refresh README, and verify badges reflect new values.

**Acceptance Scenarios**:

1. **Given** a PR is merged to main, **When** CI completes, **Then** badge JSON is published automatically
2. **Given** badge JSON is published, **When** user refreshes README, **Then** Shields.io fetches latest values
3. **Given** no secrets or manual tokens are required, **When** CI runs, **Then** publishing succeeds using only GITHUB_TOKEN

---

### User Story 4 - CI Failure on Badge Errors (Priority: P2)

If badge data cannot be generated or published, CI fails explicitly rather than silently producing stale badges.

**Why this priority**: Silent failures lead to stale badges that mislead users - better to fail loud.

**Independent Test**: Simulate a badge generation failure and verify CI fails with a clear error message.

**Acceptance Scenarios**:

1. **Given** test result XML is missing, **When** badge generation runs, **Then** CI fails with clear error
2. **Given** badge JSON is published, **When** verification check runs, **Then** it confirms the JSON URL is accessible
3. **Given** JSON publish fails, **When** CI checks, **Then** CI fails rather than continuing silently

---

### Edge Cases

- What happens when coverage reports are missing? CI fails with clear error message
- What happens when test counts are zero? Badges display "0 passed" (not an error)
- What happens when GitHub Pages is not enabled? CI fails with actionable error message
- How does the system handle concurrent CI runs? Last successful run wins (eventual consistency)
- What happens if Shields.io is temporarily unavailable? Badges show "unavailable" but CI still succeeds (badge fetch is client-side)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: CI MUST generate a deterministic JSON file (`badges/status.json`) containing coverage and test metrics after each successful run on main
- **FR-002**: JSON file MUST contain `python.coverage`, `python.tests.passed`, `python.tests.skipped`, `python.tests.total` fields
- **FR-003**: JSON file MUST contain `typescript.coverage`, `typescript.tests.passed`, `typescript.tests.skipped`, `typescript.tests.total` fields
- **FR-004**: JSON output MUST be deterministic: fixed rounding (1 decimal), stable key ordering, no timestamps
- **FR-005**: CI MUST publish `badges/status.json` to GitHub Pages (`gh-pages` branch) using only GITHUB_TOKEN (no additional secrets)
- **FR-006**: README MUST display 4 Shields.io dynamic JSON badges: Python Coverage, TypeScript Coverage, Python Tests, TypeScript Tests
- **FR-007**: Each badge MUST have a distinct, explicit label (e.g., "Python Coverage", not generic "codecov")
- **FR-008**: CI MUST fail if badge JSON cannot be generated (missing test results, parse errors)
- **FR-009**: CI MUST fail if badge JSON cannot be published to GitHub Pages
- **FR-010**: CI MUST verify the published JSON URL is accessible after publish (curl check)
- **FR-011**: Coverage values MUST be extracted from existing coverage reports (`coverage.xml` for Python, `lcov.info` for TypeScript)
- **FR-012**: Test counts MUST be extracted from existing JUnit XML files (`test-results.xml` for Python, `extension/test-results.xml` for TypeScript)

### Key Entities

- **Badge JSON**: Single source of truth containing all metrics, published to a stable public URL
- **Coverage Metrics**: Percentage values extracted from coverage reports (1 decimal precision)
- **Test Metrics**: Integer counts (passed, skipped, total) extracted from JUnit XML

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 4 badges display distinct, correct values within 5 minutes of CI completion
- **SC-002**: Badge values match CI-generated test/coverage reports exactly (coverage within 0.1% rounding)
- **SC-003**: Zero manual steps required after initial setup - badges update automatically on every main branch CI run
- **SC-004**: CI fails explicitly (non-zero exit) if badge generation or publishing fails
- **SC-005**: Badge JSON URL returns HTTP 200 and valid JSON after every successful publish

## Assumptions

- GitHub Pages is enabled for the repository (or will be enabled as part of implementation)
- The `gh-pages` branch can be used for badge data (does not conflict with existing Pages content)
- JUnit XML format is stable and matches current CI output
- Coverage report formats (coverage.xml, lcov.info) are stable
- Shields.io dynamic JSON badge endpoint is reliable and publicly accessible
