# Feature Specification: Dynamic CI Badges

**Feature Branch**: `015-dynamic-badges`
**Created**: 2026-01-29
**Status**: Draft
**Input**: User description: "Publish deterministic JSON badge source of truth from CI and render 4 distinct Shields dynamic badges for Python/TypeScript coverage and test counts"

## Clarifications

### Session 2026-01-29

- Q: When should badge publish run? → A: Only on `push` to `main` after all test/coverage jobs succeed; MUST NOT run on PRs
- Q: What is the canonical URL for badge JSON? → A: Raw GitHub URL from dedicated `badges` branch (NOT GitHub Pages)
- Q: How is determinism enforced? → A: CI generates JSON twice, diff must be empty; validates JSON schema + key order
- Q: What are the exact extraction rules? → A: Line coverage (coverage.xml `line-rate`, lcov `LF/LH`); JUnit totals (tests/failures/errors/skipped); failed tests fail CI before badge generation
- Q: Where to publish badge data? → A: Dedicated `badges` branch only; MUST NOT touch `/docs`, `gh-pages`, or `main` branch content

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

1. **Given** a PR is merged to main, **When** CI completes, **Then** badge JSON is published automatically to `badges` branch
2. **Given** badge JSON is published, **When** user refreshes README, **Then** Shields.io fetches latest values from raw GitHub URL
3. **Given** no secrets or manual tokens are required, **When** CI runs, **Then** publishing succeeds using only GITHUB_TOKEN

---

### User Story 4 - CI Failure on Badge Errors (Priority: P2)

If badge data cannot be generated or published, CI fails explicitly rather than silently producing stale badges.

**Why this priority**: Silent failures lead to stale badges that mislead users - better to fail loud.

**Independent Test**: Simulate a badge generation failure and verify CI fails with a clear error message.

**Acceptance Scenarios**:

1. **Given** test result XML is missing, **When** badge generation runs, **Then** CI fails with clear error
2. **Given** badge JSON is published, **When** verification check runs, **Then** it confirms the raw GitHub URL is accessible
3. **Given** JSON publish fails, **When** CI checks, **Then** CI fails rather than continuing silently

---

### Edge Cases

- What happens when coverage reports are missing? CI fails with clear error message
- What happens when test counts are zero? Badges display "0 passed" (not an error)
- How does the system handle concurrent CI runs? Last successful run wins (eventual consistency)
- What happens if Shields.io is temporarily unavailable? Badges show "unavailable" but CI still succeeds (badge fetch is client-side)
- What happens on PR builds? Badge publish is skipped entirely (no writes to `badges` branch from PRs)

## Requirements *(mandatory)*

### Functional Requirements

#### Badge Generation & Content

- **FR-001**: CI MUST generate a deterministic JSON file (`status.json`) containing coverage and test metrics after each successful run on main
- **FR-002**: JSON file MUST contain `python.coverage`, `python.tests.passed`, `python.tests.skipped`, `python.tests.total` fields
- **FR-003**: JSON file MUST contain `typescript.coverage`, `typescript.tests.passed`, `typescript.tests.skipped`, `typescript.tests.total` fields
- **FR-004**: JSON output MUST be deterministic: fixed rounding (1 decimal), stable key ordering, no timestamps

#### Trigger Constraints

- **FR-013**: Badge publish job MUST run only on `push` to `main` after all required test/coverage jobs succeed
- **FR-014**: Badge publish job MUST NOT run on pull requests (prevents branch churn and race conditions)
- **FR-015**: Failed tests MUST fail CI before badge generation runs (badges never reflect failing builds)

#### URL Contract

- **FR-016**: Published JSON URL MUST be `https://raw.githubusercontent.com/<org>/<repo>/badges/status.json`
- **FR-017**: README badge URLs MUST reference this exact canonical raw GitHub URL (no GitHub Pages URLs)
- **FR-005**: CI MUST publish `status.json` to a dedicated `badges` branch using only GITHUB_TOKEN (no additional secrets)

#### Branch Isolation

- **FR-024**: Badge publish MUST NOT modify the `main` branch
- **FR-025**: Badge publish MUST NOT modify the `gh-pages` branch
- **FR-026**: Badge publish MUST NOT modify `/docs` directory in any branch
- **FR-027**: Badge data MUST be stored in a dedicated `badges` branch only

#### Determinism Verification

- **FR-018**: CI MUST run a determinism check: generate `status.json` twice in the same run and `diff` MUST be empty
- **FR-019**: CI MUST validate JSON schema and key order after generation

#### Extraction Rules

- **FR-020**: Coverage source of truth is line coverage for both languages
- **FR-021**: Python coverage MUST be extracted from `coverage.xml` using the `line-rate` attribute
- **FR-022**: TypeScript coverage MUST be extracted from `lcov.info` using LF (lines found) and LH (lines hit) values
- **FR-011**: Coverage values MUST be extracted from existing coverage reports (`coverage.xml` for Python, `lcov.info` for TypeScript)
- **FR-023**: Test counts MUST be extracted from JUnit XML totals: `tests`, `failures`, `errors`, `skipped` attributes
- **FR-012**: Test counts MUST be extracted from existing JUnit XML files (`test-results.xml` for Python, `extension/test-results.xml` for TypeScript)

#### Badge Display

- **FR-006**: README MUST display 4 Shields.io dynamic JSON badges: Python Coverage, TypeScript Coverage, Python Tests, TypeScript Tests
- **FR-007**: Each badge MUST have a distinct, explicit label (e.g., "Python Coverage", not generic "codecov")

#### Error Handling

- **FR-008**: CI MUST fail if badge JSON cannot be generated (missing test results, parse errors)
- **FR-009**: CI MUST fail if badge JSON cannot be published to `badges` branch
- **FR-010**: CI MUST verify the published JSON URL is accessible after publish (curl check with printed URL, fail loud on error)

### Key Entities

- **Badge JSON**: Single source of truth containing all metrics, published to raw GitHub URL on `badges` branch
- **Coverage Metrics**: Line coverage percentage values extracted from coverage reports (1 decimal precision)
- **Test Metrics**: Integer counts (passed, skipped, total) extracted from JUnit XML totals

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 4 badges display distinct, correct values within 5 minutes of CI completion
- **SC-002**: Badge values match CI-generated test/coverage reports exactly (coverage within 0.1% rounding)
- **SC-003**: Zero manual steps required after initial setup - badges update automatically on every main branch CI run
- **SC-004**: CI fails explicitly (non-zero exit) if badge generation or publishing fails
- **SC-005**: Badge JSON URL returns HTTP 200 and valid JSON after every successful publish
- **SC-006**: Determinism check passes on every CI run (two generations produce identical output)
- **SC-007**: No badge updates occur from PR builds (`badges` branch remains unchanged during PR CI)
- **SC-008**: GitHub Pages (`gh-pages` and `/docs`) remain untouched by badge workflow

## Assumptions

- The `badges` branch can be created and used for badge data (orphan branch)
- Raw GitHub URLs are publicly accessible for public repositories
- JUnit XML format is stable and matches current CI output
- Coverage report formats (coverage.xml, lcov.info) are stable
- Shields.io dynamic JSON badge endpoint is reliable and publicly accessible
