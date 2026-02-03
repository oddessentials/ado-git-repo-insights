# Feature Specification: Dashboard Critical Test Coverage

**Feature Branch**: `023-dashboard-coverage`
**Created**: 2026-02-03
**Updated**: 2026-02-03
**Status**: In Progress (Phase 3-4 complete, Phase 5-6 pending)
**Input**: User description: "There are several typescript files that have very little test coverage related to their size and complexity. Dashboard is one of them, yet is one of our most critical features. Investigate how we can safely improve this coverage and prevent future regression of the enterprise critical features without blowing up scope."

## Clarifications

### Session 2026-02-03

- Q: What coverage threshold strategy should be used—fixed percentages, critical path set, ratchet-only, or hybrid? → A: Hybrid: Critical Path Set files with elevated per-file thresholds (70%/40%/95%) plus global ratchet that locks in gains (no decrease allowed)
- Q: How should error isolation be handled given only ML tabs have it currently? → A: Narrow scope: test error isolation only where it exists (ML tabs); core chart isolation is a future enhancement
- Q: How should "all supported data states" be defined to avoid scope explosion? → A: Explicit 5-state matrix matching ML state machine: `ready`, `no-data`, `invalid-artifact`, `unsupported-schema`, `setup-required`—one fixture per state per artifact type
- Q: How should "zero runtime errors" (SC-005) be mechanically enforced? → A: Triple assertion: (1) spy on console.error and assert zero calls, (2) wrap in try-catch and assert no throws, (3) assert fallback DOM renders for error-state fixtures
- Q: Should settings.ts remain fully excluded given its bidirectional dependency with dashboard? → A: Add minimal contract tests for `getSourceConfig()`/`resolveConfiguration()` with mocked ExtensionDataService; verify safe defaults or actionable error state for valid/invalid/missing settings

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Dashboard Rendering Stability (Priority: P1)

As a development team member, I need confidence that the dashboard renders correctly and handles all data states properly, so that enterprise users never see broken or incorrect visualizations.

**Why this priority**: The dashboard is the primary interface for enterprise users. Rendering failures or incorrect data display directly impacts business decisions and user trust. This is the highest-risk area with the most user impact.

**Independent Test**: Can be fully tested by running dashboard rendering tests with various data fixtures (complete data, partial data, empty data, malformed data) and verifying correct DOM output and error handling.

**Acceptance Scenarios**:

1. **Given** valid rollup data is available, **When** the dashboard initializes, **Then** all chart components render without errors and display accurate data
2. **Given** the data source returns empty results, **When** the dashboard loads, **Then** appropriate empty state messaging is displayed without runtime errors
3. **Given** data contains unexpected null or undefined values, **When** the dashboard processes the data, **Then** it gracefully handles missing values without crashing
4. **Given** an ML tab rendering function encounters an error state, **When** the dashboard processes the state, **Then** it displays the appropriate fallback UI (empty state, error banner, or unsupported schema message) without crashing

---

### User Story 2 - API Client Resilience (Priority: P2)

As a development team member, I need confidence that the artifact client handles all API response scenarios correctly, so that network issues and server errors don't cause silent failures or data corruption.

**Why this priority**: The artifact client (currently at 15% coverage) is the gateway for all data. Failures here cascade to the entire dashboard. Testing API interactions prevents data integrity issues.

**Independent Test**: Can be fully tested by mocking fetch responses (success, 401, 403, 404, 500, network error, timeout) and verifying the client returns appropriate typed results or error states.

**Acceptance Scenarios**:

1. **Given** the API returns valid JSON data, **When** the client processes the response, **Then** it returns properly typed and validated data
2. **Given** the API returns a 401 unauthorized response, **When** the client handles the error, **Then** it returns a typed authentication error without throwing
3. **Given** the API request hangs indefinitely, **When** the test documents current behavior, **Then** it confirms no timeout handling exists (documenting gap for future enhancement)
4. **Given** the API returns malformed JSON, **When** the client parses the response, **Then** it returns a typed parsing error without crashing

---

### User Story 3 - Coverage Regression Prevention (Priority: P3)

As a development team member, I need coverage thresholds that prevent critical feature regression, so that future code changes cannot reduce test coverage below acceptable levels.

**Why this priority**: Without enforced thresholds, coverage naturally degrades over time. This story ensures long-term sustainability of the testing investment by codifying minimum standards.

**Independent Test**: Can be fully tested by attempting CI builds with coverage below thresholds and verifying builds fail, then fixing coverage and verifying builds pass.

**Acceptance Scenarios**:

1. **Given** existing coverage thresholds are defined, **When** new code is added without tests, **Then** CI fails if coverage drops below thresholds
2. **Given** the dashboard module has specific coverage requirements, **When** tests are removed or disabled, **Then** CI prevents merging
3. **Given** coverage improves above the threshold, **When** the improvement is committed, **Then** thresholds can be ratcheted up to lock in gains

---

### Edge Cases (Documented Risks)

The following edge cases are acknowledged but not explicitly tested. Mitigation strategies:

| Edge Case | Mitigation |
|-----------|------------|
| DOM harness cannot find container elements | Harness throws explicit error with element ID; test fails fast |
| Tests pass locally but fail in CI | Canonical environment (ubuntu-latest + Node 22) is authoritative; COVERAGE_RATCHET.md documents this |
| Test fixtures become stale | Schema version validation in fixture loading; invalid schema triggers test failure |
| Async timing issues in DOM rendering | Jest fake timers available; `waitForDom()` helper in dom-harness.ts |

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Test suite MUST validate dashboard rendering for the 5-state fixture matrix: `ready`, `no-data`, `invalid-artifact`, `unsupported-schema`, `setup-required`—one fixture per state per artifact type (predictions, insights)
- **FR-002**: Test suite MUST verify null-safety for dashboard data processing functions via the 5-state fixture matrix (state fixtures include null/undefined fields; triple assertion pattern catches null-reference errors)
- **FR-003**: Test suite MUST include contract tests for `getSourceConfig()` and `resolveConfiguration()` with mocked ExtensionDataService, covering valid, invalid, and missing settings—verifying safe defaults or actionable error states
- **FR-004**: Test suite MUST validate artifact client behavior for all HTTP response codes (2xx, 4xx, 5xx)
- **FR-005**: Test suite MUST verify artifact client handles missing timeout/retry gracefully (documents current behavior; does not add new resilience logic)
- **FR-006**: Test suite MUST utilize existing DOM harness infrastructure to ensure consistent test patterns
- **FR-007**: Coverage thresholds MUST enforce elevated line coverage on Critical Path Set files: 75% for `ml.ts`, 40% for `artifact-client.ts`, 95% for `security.ts`. IIFE bundles (`dashboard.ts`, `settings.ts`) are excluded from per-file thresholds since Jest cannot measure their coverage; these are validated via Critical Path Contract Tests instead.
- **FR-008**: Global coverage thresholds MUST use ratchet mechanism: threshold = floor(current_coverage - 2.0), never decreasing from baseline
- **FR-009**: CI pipeline MUST fail builds when coverage drops below configured thresholds
- **FR-010**: Test suite MUST validate XSS prevention via the centralized `escapeHtml()` and `safeHtml` functions in `security.ts`
- **FR-011**: Test documentation MUST identify which tests cover which critical business scenarios

### Key Entities

- **Test Fixture**: Predefined JSON files following 5-state matrix naming: `{artifact}-ready.json`, `{artifact}-no-data.json`, `{artifact}-invalid.json`, `{artifact}-unsupported-v.json`, and missing file = `setup-required` state; artifact types: predictions, insights
- **DOM Harness**: Shared test infrastructure providing consistent browser environment mocking and fixture loading
- **Coverage Threshold**: Per-module minimum coverage percentages enforced by CI pipeline
- **Critical Path Set**: High-risk modules with elevated coverage thresholds—ml.ts (75%), artifact-client.ts (40%), security.ts (95%)—plus Critical Path Contract Tests for IIFE bundles. Critical functions: `renderPredictionsForState`, `renderInsightsForState` (in ml.ts), `getSourceConfig`, `resolveConfiguration` (in dashboard.ts, tested via contract simulation), `loadDataset` (in dataset-loader.ts), `_authenticatedFetch` (in artifact-client.ts)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Critical Path Set files achieve target coverage: ml.ts ≥75%, artifact-client.ts ≥40%, security.ts ≥95%. IIFE bundles (dashboard.ts, settings.ts) validated via named contract test suites (ml-state-rendering.test.ts, settings-contract.test.ts) rather than per-file coverage.
- **SC-002**: Global coverage ratchet prevents any decrease from baseline; gains are locked in via threshold updates
- **SC-003**: All critical rendering paths have explicit test scenarios covering success and failure states
- **SC-004**: CI pipeline blocks merges when coverage thresholds are violated
- **SC-005**: Zero runtime errors enforced via triple assertion: (1) `console.error` spy asserts zero calls, (2) rendering wrapped in try-catch asserts no throws, (3) error-state fixtures assert fallback DOM renders correctly
- **SC-006**: Test execution completes within existing CI time budget (observational: runtime increase <20% from baseline, not a blocking gate)
- **SC-007**: Developers can identify which tests cover specific business scenarios via test naming and documentation

## Assumptions

- The existing DOM harness infrastructure (`tests/harness/dom-harness.ts`) is sufficient for dashboard testing needs
- The existing VSS SDK mock (`tests/harness/vss-sdk-mock.ts`) provides adequate Azure DevOps integration mocking
- Test fixtures can be derived from existing schema definitions and follow the 5-state naming convention
- The current Jest + ts-jest configuration is adequate without major infrastructure changes
- Coverage thresholds will be enforced in CI using the existing coverage ratchet mechanism documented in `COVERAGE_RATCHET.md`
- Artifact client has no timeout/retry logic; tests document current behavior without adding resilience features
- XSS sanitization is centralized in `modules/shared/security.ts` (`escapeHtml`, `safeHtml`, `sanitizeUrl`)
- Settings integration is tested via mocked `ExtensionDataService` at the `getSourceConfig()`/`resolveConfiguration()` boundary

## Out of Scope

- **Settings page UI testing**: Full coverage of `settings.ts` UI interactions excluded; only contract tests at the `getSourceConfig()`/`resolveConfiguration()` boundary are in scope
- **E2E/Playwright expansion**: Existing smoke tests are sufficient; no new E2E tests required
- **Coverage for barrel files**: Index/re-export files intentionally have low coverage
- **Performance testing**: Load and stress testing are separate concerns
- **Visual regression testing**: Screenshot-based testing is not included in this scope
- **Core chart error isolation**: Refactoring core metrics/charts to match ML tab error boundary pattern is a future enhancement; tests validate existing isolation only
