# Feature Specification: ML Forecaster Edge Case Hardening

**Feature Branch**: `006-forecaster-edge-hardening`
**Created**: 2026-01-27
**Status**: Draft
**Input**: Code review feedback remediation from NEXT_STEPS.md - hardening ML forecaster against edge cases including division by zero, numeric overflow, and improving test coverage for boundary conditions.

## Clarifications

### Session 2026-01-27

- Q: What is the exact output contract for constant series forecasts? → A: Strict zero bands - predicted = baseline, lower_bound = predicted, upper_bound = predicted (all identical), confidence_width = 0.0 exactly
- Q: How should forecast result status be structured? → A: Four-status enum with reason codes: `status: ok | insufficient_data | invalid_data | degraded` plus `reason_code` string (e.g., "too_few_weeks", "all_nan", "negative_values_filtered")
- Q: How should outlier clipping handle edge cases (zero variance, NaN-heavy, overflow)? → A: Safe stats with fallback - compute mean/stddev on finite values only, require N≥4 for stats, fall back to "no clipping" with status `degraded` + reason_code `stats_undefined` when insufficient finite values
- Q: Should floor-to-zero be observable in output? → A: Yes, add `constraints_applied: string[]` field to each forecast value (e.g., `["floor_zero"]`), empty array when no constraints triggered
- Q: What output format determinism is required? → A: Full determinism - metrics ordered alphabetically by name, fields in fixed order (metric, unit, values, status), all floats rounded to 2 decimal places, JSON keys sorted

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reliable Forecasts with Constant Data (Priority: P1)

As a team lead reviewing PR metrics, I want the forecasting system to handle datasets where all values are identical (e.g., same cycle time every week) without producing errors or invalid results, so that I receive meaningful output regardless of data variance.

**Why this priority**: Division by zero errors cause complete forecast failures, breaking the user experience entirely. This is a blocking issue that must be resolved first.

**Independent Test**: Can be verified by running the forecaster with a dataset where all cycle times are identical (e.g., 100 minutes for 8 consecutive weeks) and confirming it produces a valid constant forecast.

**Acceptance Scenarios**:

1. **Given** a dataset with 8 weeks of identical cycle times (all 100 minutes), **When** the forecaster generates predictions, **Then** the forecast shows constant predicted values matching the historical data with zero confidence band width.

2. **Given** a dataset with 8 weeks of identical PR throughput (all 25 PRs/week), **When** the forecaster generates predictions, **Then** the output file is valid and contains forecasts without NaN or infinity values.

3. **Given** a dataset where one metric is constant and another varies, **When** the forecaster runs, **Then** both metrics produce valid forecasts (constant for the flat data, trending for the varying data).

---

### User Story 2 - Robust Handling of Extreme Values (Priority: P2)

As a data analyst, I want the forecasting system to handle extremely large cycle time values without numeric errors, so that outlier data points don't cause system failures.

**Why this priority**: While less common than constant data, extremely large values could cause overflow issues that corrupt forecast results. This is a defensive hardening measure.

**Independent Test**: Can be verified by running the forecaster with a dataset containing very large cycle time values (e.g., 1,000,000 minutes) and confirming it produces valid output.

**Acceptance Scenarios**:

1. **Given** a dataset with cycle times ranging from 10 to 1,000,000 minutes, **When** the forecaster processes this data, **Then** outliers are clipped appropriately and forecasts are generated without numeric overflow.

2. **Given** a dataset with PR counts in the thousands per week, **When** the forecaster runs, **Then** predictions are generated without integer overflow errors.

---

### User Story 3 - Comprehensive Test Coverage (Priority: P2)

As a developer maintaining the ML forecasting module, I want comprehensive test coverage for edge cases, so that future changes don't accidentally reintroduce bugs in boundary conditions.

**Why this priority**: Test coverage ensures long-term reliability and catches regressions early. Equal priority to P2 as it validates the fixes in P1 and P2.

**Independent Test**: Can be verified by running the test suite and confirming all edge case tests pass with appropriate assertions.

**Acceptance Scenarios**:

1. **Given** the forecaster test suite, **When** tests are run with constant input data, **Then** tests verify the forecaster handles this case gracefully.

2. **Given** the forecaster test suite, **When** tests are run with negative cycle times, **Then** tests verify the system filters or handles these invalid values.

3. **Given** the forecaster test suite, **When** tests are run with NaN-heavy datasets, **Then** tests verify the system filters nulls and continues processing.

4. **Given** the forecaster test suite, **When** tests are run with 1000+ week datasets, **Then** tests verify no overflow occurs.

---

### User Story 4 - Performance Safeguards for Large Datasets (Priority: P3)

As a user viewing the dashboard with historical data, I want the chart rendering to remain responsive even with unusually large datasets, so that my browser doesn't freeze or crash.

**Why this priority**: Lower priority because real-world data is bounded by forecast horizons (4-12 weeks). This is a defensive measure against pathological inputs.

**Independent Test**: Can be verified by testing chart rendering with 200+ data points and confirming memory usage stays within acceptable limits.

**Acceptance Scenarios**:

1. **Given** a chart component receiving more than 200 data points, **When** rendering, **Then** the system limits processed data to prevent memory pressure.

---

### Edge Cases

- What happens when all metric values are zero? System returns zero forecast with zero confidence band, status: `ok`, reason_code: `constant_series`.
- What happens when dataset contains negative cycle times? System filters invalid values, status: `degraded`, reason_code: `negative_values_filtered`.
- What happens when 99% of values are NaN/null? System returns status: `insufficient_data`, reason_code: `all_nan`.
- What happens with single-week datasets? System returns status: `insufficient_data`, reason_code: `too_few_weeks`.
- What happens when predicted values would be negative? System floors predictions at zero (see FR-004).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Forecaster MUST produce valid output when all input values are identical (zero variance). For constant series: predicted = baseline value, lower_bound = predicted, upper_bound = predicted (all three identical), with no NaN/inf values.
- **FR-002**: Forecaster MUST not produce NaN, infinity, or undefined values in any output field.
- **FR-003**: Forecaster MUST use explicit numeric precision to prevent overflow with large values.
- **FR-004**: Forecaster MUST floor all predicted values at zero (no negative forecasts). Each forecast value MUST include `constraints_applied: string[]` field listing applied constraints (e.g., `["floor_zero"]`); empty array when none triggered.
- **FR-005**: Forecaster MUST handle datasets with mixed valid and NaN values by filtering nulls.
- **FR-005a**: Forecaster output MUST include structured status: `status: ok | insufficient_data | invalid_data | degraded` with machine-readable `reason_code` (e.g., "too_few_weeks", "all_nan", "negative_values_filtered", "constant_series", "outliers_clipped").
- **FR-006**: Chart rendering MUST limit processed data points to prevent memory pressure.
- **FR-007**: Test suite MUST cover all identified edge cases with explicit assertions.
- **FR-008**: Forecast JSON output MUST be fully deterministic: metrics ordered alphabetically by name, fields in fixed order (metric, unit, values, status), all floats rounded to 2 decimal places, JSON keys sorted. This enables byte-stable golden-file tests.

### Assumptions

- Cycle time values are measured in minutes and typically range from 1 to 10,000 for normal use cases.
- PR throughput values typically range from 0 to 500 per week for normal use cases.
- The minimum viable dataset is 4 weeks of data (existing requirement).
- Outlier clipping uses 3 standard deviations computed on finite values only, requiring N≥4 valid samples. When stats are undefined (zero variance, insufficient finite values), clipping is skipped and status becomes `degraded` with reason_code `stats_undefined`.
- Chart data point limit of 200 is sufficient for all real-world scenarios.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Forecaster produces valid output for 100% of datasets with constant values (zero variance).
- **SC-002**: Zero occurrences of NaN, infinity, or undefined in forecast output across all test scenarios.
- **SC-003**: Test suite includes explicit tests for each guard/branch (zero variance, NaN filtering, overflow guards, floor-zero) asserting observable effects (status code, reason_code, constraints_applied). Coverage percentage is secondary to edge-path coverage.
- **SC-004**: All 4 new edge case test categories (constant data, negative values, large datasets, NaN-heavy data) have passing tests.
- **SC-005**: Chart rendering completes within 100ms for datasets up to 200 points.
- **SC-006**: No runtime errors or exceptions when processing datasets with extreme values (up to 10^9).
- **SC-007**: Golden-file test for constant-series input produces byte-identical JSON output across runs (validates deterministic formatting).
