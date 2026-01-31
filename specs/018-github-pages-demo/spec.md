# Feature Specification: GitHub Pages Demo Dashboard

**Feature Branch**: `018-github-pages-demo`
**Created**: 2026-01-30
**Status**: Draft
**Input**: User description: "Carefully review this code repository including the ./docs and ./agents directories to become more familiar with the codebase. Propose a safe, deterministic plan that generates 5 years of synthetic data. Then we store a copy of it along with built copy of our html dashboard all into the ./demo directory. Then we need an index.html in the root of demo so that we can point GitHub Pages at our demo folder to render an actual example of our dashboard."

## Clarifications

### Session 2026-01-30

- Q: How should AI Insights be generated for the demo (LLM call vs deterministic)? → A: Rule-based templated outputs derived solely from synthetic aggregates; no LLM calls during generation
- Q: How should byte-identical output be enforced? → A: Canonicalize all JSON (sorted keys, stable list ordering, fixed float rounding to 3 decimals, UTC timestamps only, LF newlines); add CI check that regenerates docs/ and fails if git diff is non-empty
- Q: What data artifacts should be generated (include raw PR-level data)? → A: Only UI-consumed data: weekly rollups, distributions, predictions, manifests, insights; no raw PR-level data; hard size cap of 50 MB on docs/
- Q: What is the exact time span for synthetic data? → A: 5 years (2021-W01 through 2025-W52, exactly 260 ISO weeks)
- Q: How should dashboard assets handle non-root base paths? → A: Dashboard build must support configurable base path; all asset references must resolve correctly when served from /docs/ on GitHub Pages
- Q: Should demo data schema changes be backward-compatible? → A: Yes; treat ./docs/data/ as a versioned public artifact; any schema/metric/field change MUST be backward-compatible or explicitly versioned to avoid breaking bookmarked demo URLs
- Q: Can the CI regeneration check be bypassed? → A: No; CI step MUST run on every PR touching data generation, dashboard build, or demo assets; MUST hard-fail with no override flags
- Q: Should tooling versions be pinned for reproducibility? → A: Yes; pin Python version, Node version, and all build tooling (including dashboard bundler) explicitly to prevent cross-platform nondeterminism
- Q: Should users be informed the demo uses synthetic data? → A: Yes; add a visible banner or footer note in the demo UI stating data is fully synthetic, deterministic, and illustrative only
- Q: How should base-path correctness be validated? → A: Add CI step that serves ./docs from a subpath and verifies zero 404s for assets and data files

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Live Demo Dashboard (Priority: P1)

A prospective user or evaluator visits the GitHub Pages URL to see a working example of the PR Insights Dashboard without needing to install anything or connect to Azure DevOps.

**Why this priority**: This is the core value proposition - allowing users to evaluate the dashboard's capabilities before committing to installation. A live demo significantly reduces friction for adoption.

**Independent Test**: Can be fully tested by visiting the GitHub Pages URL and verifying the dashboard renders with charts, metrics, and interactive filters populated with realistic data.

**Acceptance Scenarios**:

1. **Given** the GitHub Pages site is deployed, **When** a user navigates to the repository's GitHub Pages URL, **Then** they see a fully rendered PR Insights Dashboard with summary cards, charts, and filters
2. **Given** the demo dashboard is loaded, **When** a user interacts with date range filters, **Then** the charts and metrics update to reflect the filtered data
3. **Given** the demo dashboard is loaded, **When** a user clicks on different repositories in the filter, **Then** the metrics recalculate for the selected repository
4. **Given** the demo dashboard is loaded, **When** a user views the page, **Then** they see a visible banner or footer indicating the data is synthetic and illustrative only

---

### User Story 2 - Explore Realistic Historical Data (Priority: P2)

A user explores the demo dashboard to understand what kind of insights are available from 5 years of PR activity data, including trends, distributions, and reviewer activity patterns.

**Why this priority**: Realistic data spanning 5 years demonstrates the dashboard's ability to show long-term trends and seasonal patterns, which is a key selling point for engineering managers.

**Independent Test**: Can be tested by verifying the date range spans 5 years (2021-W01 through 2025-W52), weekly rollups exist for all 260 weeks, and distributions show realistic cycle time patterns.

**Acceptance Scenarios**:

1. **Given** the demo is loaded, **When** a user examines the date range picker, **Then** they can select any date range within 5 years (2021-W01 through 2025-W52)
2. **Given** the demo is loaded, **When** a user views the throughput chart, **Then** they see weekly PR counts with realistic variation (not flat or obviously fake)
3. **Given** the demo is loaded, **When** a user views cycle time distributions, **Then** they see a realistic distribution with appropriate tail for outliers

---

### User Story 3 - View ML Predictions Tab (Priority: P3)

A user explores the Predictions tab to see example forecast data showing projected PR throughput and cycle time trends.

**Why this priority**: ML features are Phase 3.5 and optional, but demonstrating them in the demo showcases the platform's advanced capabilities.

**Independent Test**: Can be tested by clicking the Predictions tab and verifying forecast charts render with confidence intervals.

**Acceptance Scenarios**:

1. **Given** the demo is loaded, **When** a user clicks the "Predictions" tab, **Then** they see forecast charts with predicted values and confidence bands
2. **Given** the Predictions tab is active, **When** a user hovers over forecast points, **Then** they see predicted value with upper/lower bounds

---

### User Story 4 - View AI Insights Tab (Priority: P3)

A user explores the AI Insights tab to see deterministic, rule-based observations about PR patterns derived from aggregate data analysis.

**Why this priority**: AI insights demonstrate advanced analytics capabilities but are optional Phase 3.5 features.

**Independent Test**: Can be tested by clicking the AI Insights tab and verifying insight cards render with categories and severity levels.

**Acceptance Scenarios**:

1. **Given** the demo is loaded, **When** a user clicks the "AI Insights" tab, **Then** they see insight cards with titles, descriptions, and severity indicators

---

### Edge Cases

- What happens when the browser has JavaScript disabled? Dashboard should show a graceful message indicating JavaScript is required.
- What happens on mobile devices? Dashboard should be usable (though optimized for desktop).
- What happens if a user bookmarks a filtered view? URL state should preserve filter selections for shareability.
- What happens if docs/ exceeds 50 MB? Build must fail with clear error message indicating size cap violation.
- What happens if a demo data schema changes? Changes MUST be backward-compatible or versioned to preserve bookmarked URLs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST generate deterministic synthetic data using a fixed random seed (seed=42) so that regenerating the data produces byte-identical results
- **FR-002**: System MUST generate synthetic data covering exactly 5 years (2021-W01 through 2025-W52, exactly 260 ISO weeks)
- **FR-003**: Synthetic data MUST include at least 3 organizations, 8 projects, and 20 repositories to demonstrate multi-dimensional filtering
- **FR-004**: Synthetic data MUST include at least 50 unique synthetic users with realistic display names
- **FR-005**: Weekly rollup data MUST show realistic variation in PR counts (not constant values) with seasonal patterns (lower activity in December, higher in Q1/Q3)
- **FR-006**: Cycle time distributions MUST follow a realistic log-normal distribution with P50 typically 4-24 hours and P90 typically 1-7 days
- **FR-007**: Synthetic predictions MUST include 12-week forecasts for pr_throughput, cycle_time_minutes, and review_time_minutes metrics (deterministically generated, no ML model execution)
- **FR-008**: Synthetic AI insights MUST be rule-based templated outputs derived solely from synthetic aggregates; no LLM calls during generation; MUST include at least 5 diverse insights covering bottleneck, trend, and anomaly categories
- **FR-009**: The built dashboard files MUST be copied to `./docs/` directory with demo data in `./docs/data/` subdirectory and all required assets (HTML, CSS, JS bundles)
- **FR-010**: An index.html MUST exist at `./docs/index.html` that serves the demo dashboard directly
- **FR-011**: The demo MUST work when served from GitHub Pages configured to use the `/docs` folder with all asset paths resolving correctly
- **FR-012**: All synthetic GUIDs MUST be deterministically generated using UUID v5 with a fixed namespace to ensure reproducibility
- **FR-013**: The synthetic data generator MUST be a standalone script that can be re-run to regenerate data with byte-identical output
- **FR-014**: Generated data MUST validate against existing JSON schemas (dataset-manifest.schema.json, predictions.schema.json, insights.schema.json)
- **FR-015**: Generated data MUST only include UI-consumed artifacts: weekly rollups, distributions, predictions, manifests, dimensions, and insights; NO raw PR-level data
- **FR-016**: The `./docs/` directory MUST NOT exceed 50 MB total size; build MUST fail if size cap is violated
- **FR-017**: All JSON output MUST be canonicalized: sorted keys, stable list ordering, float values rounded to 3 decimal places, UTC timestamps only (ISO 8601 with Z suffix), LF newlines only
- **FR-018**: Dashboard build MUST support configurable base path for asset references to work correctly when served from `/docs/` subdirectory
- **FR-019**: The contents of `./docs/data/` MUST be treated as a versioned public artifact; any schema, metric, or field change MUST be backward-compatible or explicitly versioned to avoid breaking bookmarked demo URLs
- **FR-020**: The demo dashboard MUST display a visible banner or footer note stating the data is fully synthetic, deterministic, and illustrative only (not anonymized real data)
- **FR-021**: Python version, Node version, and all build tooling versions (including dashboard bundler) MUST be explicitly pinned in configuration files to ensure cross-platform reproducibility

### Key Entities

- **Synthetic Organization**: Represents a fictional Azure DevOps organization (e.g., "acme-corp", "contoso-dev", "fabrikam-eng")
- **Synthetic Project**: Represents a project within an organization with realistic names (e.g., "platform-services", "mobile-apps", "data-pipeline")
- **Synthetic Repository**: Represents a code repository with realistic names following common patterns (e.g., "api-gateway", "user-service", "web-frontend")
- **Synthetic User**: Represents a developer with a display name and deterministic GUID
- **Weekly Rollup**: Aggregated PR metrics for one ISO week including counts, cycle time percentiles, and breakdowns by repository
- **Distribution**: Yearly cycle time bucket distribution showing PR count by time-to-merge categories
- **Rule-Based Insight**: Deterministic insight generated from aggregate data analysis using predefined templates and thresholds

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can view the live demo dashboard within 3 seconds of page load on a standard broadband connection
- **SC-002**: The demo dashboard displays data spanning exactly 260 ISO weeks (5 years: 2021-W01 through 2025-W52)
- **SC-003**: All interactive filters (date range, repository, team) function correctly with synthetic data
- **SC-004**: 100% of synthetic data files pass JSON schema validation
- **SC-005**: The demo is accessible via GitHub Pages URL without any 404 errors or broken assets
- **SC-006**: Regenerating synthetic data with the same seed produces byte-identical output files (verified by CI check)
- **SC-007**: The demo showcases all dashboard features: summary cards, throughput chart, cycle time trends, reviewer activity, distributions, predictions tab, and AI insights tab
- **SC-008**: Total size of `./docs/` directory remains under 50 MB
- **SC-009**: CI pipeline includes a non-bypassable regeneration check that runs on every PR touching data generation, dashboard build, or demo assets; fails if `git diff` on `docs/` is non-empty after regeneration; no override flags permitted
- **SC-010**: CI pipeline includes a base-path validation step that serves `./docs` from a subpath and verifies zero 404s for all assets and data files
- **SC-011**: Demo dashboard displays a visible synthetic data disclaimer banner/footer
- **SC-012**: All tooling versions (Python, Node, bundler) are pinned and reproducible across CI and local environments

## Assumptions

- GitHub Pages will be configured to serve from the `/docs` folder on the main branch
- The dashboard UI bundles can operate in "local mode" without requiring Azure DevOps SDK authentication
- Synthetic data will use fictional organization/project/repository names to avoid any resemblance to real entities
- The Python environment has access to standard library modules (random, uuid, json, datetime) for data generation
- No external API calls are needed for synthetic data generation (fully offline/deterministic)
- All floating-point calculations use consistent rounding (3 decimal places) to ensure cross-platform reproducibility
- Pinned tooling versions will be maintained in lockfiles (package-lock.json, requirements.txt or pyproject.toml) and CI workflow files

## Out of Scope

- Automated deployment pipeline for GitHub Pages (manual configuration is acceptable)
- Real data anonymization (only synthetic data is generated)
- Custom domain configuration for GitHub Pages
- Analytics or tracking on the demo page
- Server-side rendering or dynamic data loading (static files only)
- Raw PR-level data generation (only aggregated data for UI consumption)
- LLM-based insight generation (rule-based templates only)
- CI override flags for regeneration or base-path checks (checks are mandatory and non-bypassable)
- JavaScript-disabled fallback UI (dashboard inherits existing noscript behavior from extension; not explicitly tested)
- Mobile-specific responsive testing (dashboard is optimized for desktop; mobile usability inherits existing extension behavior without explicit testing)
