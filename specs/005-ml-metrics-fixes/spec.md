# Feature Specification: ML Metrics Accuracy Fixes

**Feature Branch**: `005-ml-metrics-fixes`
**Created**: 2026-01-27
**Status**: Draft
**Input**: User description: "Fix ML metrics accuracy issues identified in code review: P90 calculation, review time proxy, database connection cleanup, and synthetic data determinism"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Accurate P90 Cycle Time Display (Priority: P1)

As a team lead viewing PR analytics, I want to see accurate P90 cycle time metrics so that I can make informed decisions about process improvements based on reliable data.

Currently, P90 is approximated as `max * 0.9` which significantly underestimates the actual 90th percentile value. This misleads users and any AI insights generated from this data.

**Why this priority**: P90 is a key metric for understanding tail latency in PR workflows. Inaccurate P90 values undermine trust in the entire analytics dashboard and can lead to incorrect process decisions.

**Independent Test**: Can be tested by comparing calculated P90 values against known datasets with verified percentile values.

**Acceptance Scenarios**:

1. **Given** a dataset of 100 PRs with cycle times [10, 20, 30, ..., 1000] minutes, **When** the system calculates P90, **Then** it returns 900 (the 90th percentile value), not 900 (90% of max 1000).
2. **Given** a dataset with outliers (e.g., one PR at 10000 minutes), **When** the system calculates P90, **Then** it returns the actual 90th percentile, not a value inflated by the outlier.
3. **Given** a dataset with fewer than 10 data points, **When** the system calculates P90, **Then** it either returns a clearly marked approximation or indicates insufficient data.

---

### User Story 2 - Distinct Review Time Forecasting (Priority: P2)

As a developer viewing trend forecasts, I want review time predictions to be based on actual review duration data so that I can understand real code review bottlenecks rather than seeing cycle time data mislabeled as review time.

Currently, review time forecasts use cycle time as a proxy, which conflates two distinct metrics and can mislead users about their review process efficiency.

**Why this priority**: Review time and cycle time measure different aspects of the PR workflow. Using one as a proxy for the other creates confusion and reduces the value of the forecasting feature.

**Independent Test**: Can be tested by verifying that review time forecasts use review-specific data fields when available.

**Acceptance Scenarios**:

1. **Given** PR data includes distinct review time measurements, **When** the system generates review time forecasts, **Then** it uses actual review time data, not cycle time.
2. **Given** PR data does not include review time measurements, **When** the system attempts to generate review time forecasts, **Then** it either omits the review time forecast or clearly indicates "Review time data unavailable" rather than showing mislabeled cycle time data.
3. **Given** a user views the forecasts, **When** review time data is unavailable, **Then** the dashboard clearly communicates which forecasts are available vs unavailable.

---

### User Story 3 - Deterministic Preview Data (Priority: P3)

As a developer testing the dashboard in dev mode, I want synthetic preview data to be consistent across page reloads so that I can reliably test UI rendering and not be confused by changing values.

Currently, synthetic data uses random values that change on each page load, making it difficult to test and potentially confusing to developers.

**Why this priority**: While this is a dev-mode-only issue, consistent preview data improves developer experience and makes testing more reliable.

**Independent Test**: Can be tested by loading the dashboard in dev mode multiple times and verifying values remain consistent.

**Acceptance Scenarios**:

1. **Given** the dashboard is loaded in dev mode with synthetic data, **When** the page is reloaded, **Then** the same synthetic values appear.
2. **Given** synthetic data is generated, **When** comparing two separate loads, **Then** forecast values, insight content, and sparklines are identical.
3. **Given** a developer needs different synthetic data for testing edge cases, **When** a seed parameter is provided, **Then** different but still deterministic data is generated.

---

### User Story 4 - Clean Resource Management in Tests (Priority: P3)

As a developer running the test suite, I want all database connections to be properly closed after tests so that I can trust the test output and avoid resource leak warnings.

Currently, tests produce `ResourceWarning: unclosed database` messages, indicating connection cleanup issues.

**Why this priority**: While tests pass, these warnings indicate potential patterns that could leak connections in production. Clean test output also improves developer confidence.

**Independent Test**: Can be tested by running the full test suite and verifying no ResourceWarning messages appear.

**Acceptance Scenarios**:

1. **Given** the full test suite is executed, **When** tests complete, **Then** no `ResourceWarning: unclosed database` messages appear.
2. **Given** a test creates a database connection, **When** the test completes (pass or fail), **Then** the connection is automatically closed.
3. **Given** a test fixture provides a database connection, **When** the fixture scope ends, **Then** cleanup hooks properly close all connections.

---

### Edge Cases

- What happens when there is only 1 data point for P90 calculation? (Return the single value or indicate insufficient data)
- How does the system handle NULL review time values in the database? (Skip NULLs in calculations, don't treat as zero)
- What happens if synthetic data seeding is not supported by the runtime environment? (Fall back to current random behavior with console warning)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST calculate P90 using proper percentile calculation (90th percentile of sorted values), not approximation
- **FR-002**: System MUST handle datasets of any size for percentile calculations, including edge cases with fewer than 10 data points
- **FR-003**: System MUST use actual review time data for review time forecasts when available
- **FR-004**: System MUST clearly indicate when review time forecasts are unavailable rather than substituting cycle time data
- **FR-005**: System MUST generate deterministic synthetic data using a fixed seed for dev mode previews
- **FR-006**: System MUST properly close all database connections in test fixtures
- **FR-007**: System MUST not produce ResourceWarning messages during normal test execution
- **FR-008**: System MUST preserve existing forecaster output format and schema version compatibility

### Key Entities

- **Percentile Calculation**: Represents the statistical operation to find the value below which a given percentage of observations fall
- **Review Time**: The duration from when a PR is ready for review until the review is completed (distinct from cycle time)
- **Cycle Time**: The total duration from PR creation to merge
- **Synthetic Data Seed**: A fixed value used to initialize random number generation for reproducible preview data

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: P90 calculations match industry-standard percentile implementations (verified against reference implementations)
- **SC-002**: Zero ResourceWarning messages in test suite output across 3 consecutive full test runs
- **SC-003**: Synthetic preview data produces identical values across 10 consecutive page reloads in dev mode
- **SC-004**: Dashboard clearly distinguishes between available and unavailable forecasts with appropriate messaging
- **SC-005**: All existing tests continue to pass after changes (zero regression)
- **SC-006**: Forecast output schema remains backward compatible with existing dashboard consumers

## Assumptions

- The database schema already contains fields that could store review time data separately from cycle time, even if not currently populated
- Synthetic data determinism is only required for dev mode; production never shows synthetic data
- Test fixtures use context managers or cleanup hooks that can be enhanced for proper connection closure
- The percentile calculation change will not significantly impact performance since datasets are typically small (hundreds to low thousands of PRs)

## Out of Scope

- Adding new data collection for review time (only fixing how existing data is used/displayed)
- Changing the dashboard UI layout or adding new chart types
- Performance optimization of percentile calculations for very large datasets (>100k records)
- Adding user-configurable synthetic data seeds (fixed seed is sufficient)
