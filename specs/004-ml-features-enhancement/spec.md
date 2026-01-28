# Feature Specification: ML Features Enhancement

**Feature Branch**: `004-ml-features-enhancement`
**Created**: 2026-01-26
**Status**: Draft
**Input**: User description: "Implement Flight ML-A — ML Features Enhancement. This feature enhancement replaces the current placeholders with useful predictions and insights using enterprise-grade best practices. The default solution must not require user setup. The more advanced solution must have user setup requirement well-documented. Parity between the extension dashboard, local prod dashboard, and dev dashboard are essential. This feature must be useful and impressive at the enterprise level, but we must be deterministic, professional, secure, and trustworthy. This solution must be able to handle large amounts of pull request data."

## Clarifications

### Session 2026-01-26

- Q: What defines "stable (non-seasonal) trends" for NFR-002 accuracy comparison? → A: CV < 0.3 AND no significant autocorrelation at lag 4/12 weeks (p > 0.05) AND linear R² ≥ 0.7
- Q: Where does the OpenAI insights cache persist? → A: Pipeline artifact as `insights/cache.json` alongside `summary.json`
- Q: What is the deterministic ordering for the 3 insights? → A: Sort by severity desc (critical > warning > info), then category alphabetically, then by stable insight ID

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Zero-Config Predictions (Priority: P1)

As a DevOps engineer, I want to see pull request throughput forecasts immediately after enabling predictions, without installing additional dependencies, so that I can plan sprints with confidence.

**Why this priority**: Predictions are the primary value proposition. Zero-config ensures adoption isn't blocked by Prophet's C++ compiler requirement. This delivers immediate value with minimal friction.

**Independent Test**: Can be fully tested by enabling `enablePredictions: true` in pipeline YAML without Prophet installed. Delivers forecast charts with confidence bands using fallback linear regression.

**Acceptance Scenarios**:

1. **Given** predictions are enabled and Prophet is NOT installed, **When** the pipeline runs, **Then** the Predictions tab displays forecast charts using fallback linear regression with "Linear Forecast" indicator.
2. **Given** predictions are enabled and Prophet IS installed, **When** the pipeline runs, **Then** the Predictions tab displays forecast charts using Prophet with "Prophet Forecast" indicator showing enhanced accuracy.
3. **Given** less than 4 weeks of historical data exists, **When** forecasts are generated, **Then** the system displays a "Low Confidence" warning with degraded horizon (shorter forecast) and wider confidence bands.
4. **Given** the forecast chart is displayed, **When** a user views it, **Then** historical data (solid line), predicted values (dashed line), and confidence bands (shaded area) are visually distinct.

---

### User Story 2 - Actionable AI Insights (Priority: P2)

As a team lead, I want AI-generated insights that identify bottlenecks and trends with specific recommendations, so that I can take immediate action to improve team velocity.

**Why this priority**: AI Insights differentiate this tool from basic metrics dashboards. Rich, actionable insights justify the enterprise positioning.

**Independent Test**: Can be fully tested by enabling `enableInsights: true` with an OpenAI API key. Delivers insight cards with metrics, sparklines, and recommendations.

**Acceptance Scenarios**:

1. **Given** insights are enabled with a valid OpenAI API key, **When** the pipeline runs, **Then** the AI Insights tab displays exactly 3 insight cards with severity indicators (critical/warning/info).
2. **Given** an insight card is displayed, **When** a user views it, **Then** the card shows: title, description with specific numbers, inline sparkline visualization, affected entities (teams/repos), and a concrete recommendation with effort level.
3. **Given** OpenAI API call fails or times out, **When** insights are requested, **Then** the system displays cached insights if available, or a clear error message with retry option.
4. **Given** multiple pipeline runs occur, **When** insights are regenerated within 12 hours, **Then** cached insights are returned to minimize API costs.

---

### User Story 3 - Dev Mode Preview (Priority: P3)

As a developer evaluating this tool, I want to see a preview of ML features with synthetic data in dev mode, so that I can understand the value before enabling in production.

**Why this priority**: Preview mode reduces evaluation friction and showcases capabilities without requiring pipeline configuration.

**Independent Test**: Can be fully tested by opening dashboard on localhost or with `?devMode` parameter. Displays synthetic data with clear "PREVIEW - Demo Data" watermark.

**Acceptance Scenarios**:

1. **Given** the dashboard is opened on localhost or with `?devMode=true`, **When** predictions data is unavailable, **Then** synthetic forecast charts are displayed with a prominent "PREVIEW - Demo Data" banner.
2. **Given** the dashboard is running in production (Azure DevOps extension), **When** `?devMode` is present in the URL, **Then** the devMode parameter is IGNORED and synthetic data is NEVER displayed (production lock).
3. **Given** synthetic preview is displayed, **When** a user interacts with charts, **Then** the experience is identical to real data (hover states, legends work).
4. **Given** the user is viewing the preview, **When** they look for setup instructions, **Then** a "Try in Your Pipeline" call-to-action links to embedded setup documentation.

---

### User Story 4 - In-Dashboard Setup Guidance (Priority: P4)

As a new user, I want clear setup instructions embedded in the dashboard, so that I can enable advanced features without searching external documentation.

**Why this priority**: Reduces support burden and accelerates adoption. Users discover capabilities at the point of need.

**Independent Test**: Can be fully tested by viewing Predictions/Insights tabs when features are not enabled. Displays YAML snippets, step-by-step instructions, and copy buttons.

**Acceptance Scenarios**:

1. **Given** predictions are NOT enabled, **When** a user views the Predictions tab, **Then** inline setup instructions show the exact YAML to add with a "Copy" button.
2. **Given** insights are NOT enabled, **When** a user views the AI Insights tab, **Then** step-by-step instructions show how to: (a) get an OpenAI key, (b) store as pipeline secret, (c) update YAML.
3. **Given** setup instructions are displayed, **When** a user clicks "Copy YAML", **Then** the complete YAML snippet is copied to clipboard with visual confirmation.
4. **Given** instructions mention costs, **When** displayed, **Then** estimated per-run cost is shown (e.g., "~$0.001-0.01 per run").

---

### Edge Cases

- What happens when PR data volume exceeds 10,000 PRs? System must aggregate to weekly granularity and limit forecast horizon to 12 weeks maximum.
- How does the system handle outliers in cycle time data? Fallback forecaster applies basic outlier clipping (values beyond 3 standard deviations capped) before regression.
- What happens when OpenAI returns malformed JSON? System logs warning, attempts JSON repair, falls back to cached response or error state.
- How does the system handle simultaneous extension/local dashboard access? Each dashboard independently fetches ML data from output artifacts; no coordination needed.
- What happens when forecast confidence is extremely low? Display "Insufficient Data" message with minimum data requirement (4+ weeks) instead of unreliable chart.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide predictions without requiring Prophet installation (fallback linear regression forecaster).
- **FR-002**: System MUST automatically detect Prophet availability and use enhanced forecasting when present.
- **FR-003**: System MUST display forecast charts with confidence bands using Chart.js (already in project).
- **FR-004**: System MUST indicate forecaster type in output manifest: `"forecaster": "linear"` or `"forecaster": "prophet"`.
- **FR-005**: System MUST generate exactly 3 AI insights per run with: title, severity, description, data (with sparkline), affected_entities, and recommendation; insights MUST be ordered deterministically by severity descending (critical > warning > info), then category alphabetically, then by stable insight ID.
- **FR-006**: System MUST cache OpenAI responses for 12 hours to minimize API costs; cache persists as `insights/cache.json` in pipeline artifacts alongside `summary.json`.
- **FR-007**: System MUST display synthetic preview data ONLY in dev mode (localhost OR `?devMode` parameter) AND outside production environment.
- **FR-008**: System MUST implement a production lock that prevents synthetic data from being displayed in the Azure DevOps extension, regardless of URL parameters.
- **FR-009**: System MUST provide embedded setup instructions with copyable YAML snippets when features are not enabled.
- **FR-010**: System MUST maintain parity between extension dashboard, local production dashboard (`--serve`), and local dev dashboard behavior.
- **FR-011**: Fallback forecaster MUST enforce minimum data requirements (4+ weeks) and degrade gracefully with wider bounds or "Low Confidence" flag when thresholds aren't met.
- **FR-012**: Fallback forecaster MUST apply basic outlier clipping (3 standard deviations) before regression.
- **FR-013**: System MUST handle large PR datasets (10,000+ PRs) by aggregating to weekly granularity and limiting forecast horizon to 12 weeks.

### Non-Functional Requirements

- **NFR-001**: Chart rendering MUST complete in under 100ms for 12 weeks of data (measured on mid-tier laptop, cold render).
- **NFR-002**: Fallback forecaster accuracy MUST be within 20% of Prophet predictions for stable (non-seasonal) trends, defined as: coefficient of variation (CV) < 0.3 on weekly aggregates, no significant autocorrelation at lag 4 or 12 weeks (p > 0.05), and linear regression R² ≥ 0.7.
- **NFR-003**: No new npm dependencies may be added (use existing Chart.js).
- **NFR-004**: All new components MUST be WCAG 2.1 AA accessible (color contrast, keyboard navigation, screen reader labels).
- **NFR-005**: New code MUST achieve 80%+ test coverage.
- **NFR-006**: Insight generation MUST complete within 30 seconds (including OpenAI API call with timeout).
- **NFR-007**: Synthetic preview data MUST be impossible to surface in production Azure DevOps extension (enforced by build-time flag check).

### Key Entities

- **Forecast**: Represents a time-series prediction with metric name, horizon_weeks, and array of ForecastValue (period_start, predicted, lower_bound, upper_bound).
- **InsightItem**: Represents an AI-generated observation with category (bottleneck/trend/anomaly/achievement), severity, data with sparkline, affected_entities, and recommendation.
- **MLMetadata**: Manifest extension indicating forecaster type, model version, cache status.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can view forecast charts with confidence bands within 2 clicks of enabling `enablePredictions: true` (zero additional setup).
- **SC-002**: 100% of AI insight cards include a specific, actionable recommendation with effort level.
- **SC-003**: Dev mode preview renders correctly on localhost without any pipeline configuration.
- **SC-004**: Production extension NEVER displays synthetic data, verified by automated test asserting rejection.
- **SC-005**: Forecast chart render time stays under 100ms for 12 weeks of data across 5 consecutive measurements.
- **SC-006**: OpenAI API costs remain under $0.02 per pipeline run at current gpt-4o-mini pricing.
- **SC-007**: 80%+ test coverage achieved for all new modules (fallback_forecaster.py, synthetic.ts, charts/predictions.ts).
- **SC-008**: All three dashboard modes (extension, local prod, local dev) render identically for the same input data.
