# Feature Specification: Enable ML Features & Migrate to pnpm

**Feature Branch**: `010-pnpm-ml-enablement`
**Created**: 2026-01-28
**Status**: Draft
**Input**: User description: "NEXT_STEPS.md + full migration to pnpm"

## Overview

This feature addresses two related goals:
1. **Enable Predictions & AI Insights features** - Make the currently hidden ML-powered dashboard tabs accessible to users with proper documentation and UX improvements
2. **Migrate to pnpm** - Replace npm with pnpm as the package manager for faster installs, better disk efficiency, and stricter dependency management

## Clarifications

### Session 2026-01-28

- Q: ML artifact gating contract → A: Define strict state machine with 5 states: `setup-required`, `no-data`, `invalid-artifact`, `unsupported-schema`, `ready`
- Q: Deterministic ordering → A: AI Insights: severity DESC → category ASC → id ASC; Predictions: chronological by period_start
- Q: Graceful degradation behavior → A: Tab-level banners for errors; distinguish 5 error types; render last-known-good with warning if available
- Q: OpenAI key handling → A: ADO secret variable, injected via `OPENAI_API_KEY` env var, never file-based; redact from logs/artifacts/UI
- Q: Schema version enforcement → A: Validate schema_version; show "Unsupported schema version" on mismatch with guidance
- Q: pnpm enforcement → A: CI fails on package-lock.json or npm usage; require pinned packageManager; enable Corepack
- Q: Fresh-clone determinism → A: CI job with fresh clone, `pnpm install --frozen-lockfile`, build, and test
- Q: Mechanically verifiable success criteria → A: Zero console errors in setup-required state; fixture-based error state tests; green CI with frozen lockfile
- Q: Backend verification gate → A: Integration test proving pipeline emits artifacts and dashboard consumes exact paths (case-sensitive)
- Q: State machine precedence → A: Absolute—once a state resolves, no further checks run; exactly one state renders; no mixed UI or fallthrough
- Q: no-data semantics → A: Locked to `data_quality = insufficient` OR empty data array; no additional pseudo-states permitted
- Q: OpenAI logging boundaries → A: Sealed—API keys and request/response bodies MUST NEVER appear in logs, artifacts, UI, or console (success and error paths)
- Q: pnpm enforcement authority → A: CI is the authority (policy, not convention); `pnpm install --frozen-lockfile` mandatory; Corepack required

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer Enables Predictions Tab (Priority: P1)

A developer wants to use the Predictions feature to see ML-powered forecasts of PR cycle times and throughput trends. Currently, the tab is hidden and shows "Coming Soon" even though the UI is fully implemented.

**Why this priority**: The Predictions feature UI is complete but inaccessible. This is the highest-value unblocking work since users cannot access a finished feature.

**Independent Test**: Can be fully tested by configuring `run-predictions: true` in pipeline and verifying the Predictions tab appears with real forecast data.

**Acceptance Scenarios**:

1. **Given** a fresh installation with default configuration, **When** a user views the dashboard, **Then** the Predictions tab is visible (not hidden) displaying the `setup-required` state with configuration instructions.

2. **Given** a pipeline configured with `run-predictions: true`, **When** the pipeline generates valid `predictions/trends.json`, **Then** the Predictions tab displays the `ready` state with forecast charts and confidence bands.

3. **Given** a user viewing the Predictions tab in `setup-required` state, **When** they view the setup guidance, **Then** they see copyable YAML configuration snippets.

4. **Given** a malformed predictions artifact, **When** the dashboard loads, **Then** the Predictions tab displays the `invalid-artifact` state with a tab-level error banner.

5. **Given** a predictions artifact with unsupported schema_version, **When** the dashboard loads, **Then** the Predictions tab displays the `unsupported-schema` state with upgrade guidance.

---

### User Story 2 - Developer Enables AI Insights Tab (Priority: P1)

A developer wants to use the AI Insights feature to get automated analysis of team performance patterns. The tab is hidden despite the UI being complete.

**Why this priority**: Same as Predictions - complete UI is inaccessible to users.

**Independent Test**: Can be fully tested by configuring `run-insights: true` with OpenAI API key and verifying insights cards appear.

**Acceptance Scenarios**:

1. **Given** a fresh installation with default configuration, **When** a user views the dashboard, **Then** the AI Insights tab is visible displaying the `setup-required` state.

2. **Given** a pipeline configured with `run-insights: true` and valid OpenAI API key, **When** the pipeline generates valid `ai_insights/summary.json`, **Then** the AI Insights tab displays the `ready` state with severity-grouped insight cards ordered deterministically (severity DESC → category ASC → id ASC).

3. **Given** an OpenAI API failure during pipeline execution, **When** the dashboard loads, **Then** if previous valid artifacts exist, the dashboard renders last-known-good data with a visible "stale data" warning banner.

4. **Given** an OpenAI API rate limit error, **When** the pipeline runs, **Then** the system logs the error (without exposing API keys) and the dashboard shows appropriate degradation state.

---

### User Story 3 - Developer Uses pnpm for Package Management (Priority: P2)

A developer clones the repository and uses pnpm to install dependencies. They benefit from faster installs and stricter dependency resolution.

**Why this priority**: Package manager migration is foundational infrastructure that improves developer experience but doesn't directly enable user-facing features.

**Independent Test**: Can be fully tested by running `pnpm install` and verifying all scripts work correctly.

**Acceptance Scenarios**:

1. **Given** a fresh clone of the repository, **When** a developer runs `pnpm install --frozen-lockfile`, **Then** all dependencies install successfully without errors.

2. **Given** a developer with existing npm node_modules, **When** they switch to pnpm, **Then** they can migrate by deleting node_modules and running `pnpm install`.

3. **Given** CI/CD pipelines, **When** migrated to pnpm, **Then** all pipeline jobs use `pnpm install --frozen-lockfile` and complete successfully.

4. **Given** a CI run, **When** `package-lock.json` exists in the repository, **Then** the CI job MUST fail with a clear error message.

5. **Given** a CI run, **When** any script attempts to use `npm install`, **Then** the CI job MUST fail.

---

### User Story 4 - User Reads Documentation for ML Features (Priority: P2)

A user wants to understand how to configure Predictions and AI Insights features. They need clear documentation that explains prerequisites, configuration, and troubleshooting.

**Why this priority**: Documentation enables self-service and reduces support burden, but is secondary to making features accessible.

**Independent Test**: Can be tested by following documentation end-to-end to enable ML features.

**Acceptance Scenarios**:

1. **Given** a user reading the README, **When** they look for ML feature documentation, **Then** they find a clear section explaining prerequisites and configuration.

2. **Given** a user following the documentation, **When** they configure their pipeline, **Then** they can enable Predictions without external help.

3. **Given** a user encountering an error, **When** they check the troubleshooting section, **Then** they find guidance for common issues (missing data, API failures, insufficient history, unsupported schema versions).

---

### Edge Cases

- What happens when predictions data has insufficient historical data? System shows `no-data` state with "Insufficient Data" quality indicator.
- What happens when OpenAI API rate limits are hit? System uses cached/last-known-good insights with visible "stale data" warning, or shows graceful degradation state if no cache exists.
- What happens when `pnpm-lock.yaml` conflicts with existing `package-lock.json`? Migration removes `package-lock.json` entirely; CI enforces absence.
- What happens when a user runs `npm install` after pnpm migration? CI fails; documentation warns about this.
- What happens when artifact file exists but is empty or malformed JSON? Dashboard shows `invalid-artifact` state with tab-level error banner.
- What happens when schema_version is missing or unrecognized? Dashboard shows `unsupported-schema` state with upgrade guidance.
- What happens when predictions series have unsorted data? Dashboard sorts deterministically by `period_start` before rendering.

## Requirements *(mandatory)*

### Functional Requirements

**ML Artifact Gating Contract:**

- **FR-001**: Dashboard MUST implement a strict state machine for each ML tab with exactly 5 mutually exclusive states:
  - `setup-required`: Artifact file does not exist (feature not configured)
  - `no-data`: Artifact exists but `data_quality = "insufficient"` OR data array is empty (forecasts/insights)
  - `invalid-artifact`: Artifact exists but fails JSON parsing or required field validation
  - `unsupported-schema`: Artifact parses but `schema_version` is not in supported range
  - `ready`: Artifact is valid and contains renderable data
- **FR-002**: Each tab MUST render exactly one of these 5 states—never a blank or partial UI, no mixed states, no fallthrough
- **FR-003**: State resolution MUST be absolute: once a tab resolves to a state, no further checks run and no additional pseudo-states may be introduced
- **FR-004**: State gating MUST check in order: file existence → JSON validity → required fields → schema_version → data quality/length (first match wins)
- **FR-005**: Dashboard MUST show Predictions and AI Insights tabs as visible (not hidden) by default

**Deterministic Ordering:**

- **FR-006**: AI Insights cards MUST be ordered deterministically: `severity DESC` (critical > warning > info) → `category ASC` → `id ASC` (or `title ASC` if id absent)
- **FR-007**: Predictions forecast series MUST be ordered chronologically by `period_start`
- **FR-008**: Tests and fixtures MUST assert ordering explicitly

**Graceful Degradation:**

- **FR-009**: All error states MUST surface as tab-level banners (not inline within content areas)
- **FR-010**: Dashboard MUST distinguish between error types with specific messaging:
  - Feature not configured → "Setup Required" with configuration guidance
  - Pipeline failure → "Data Unavailable" with troubleshooting link
  - Malformed artifact → "Invalid Data Format" with file path reference
  - Unsupported schema → "Unsupported Schema Version X (supported: Y-Z)" with upgrade guidance
  - OpenAI API failure → "AI Service Unavailable" (for insights only)
- **FR-011**: If valid artifacts existed previously and current load fails, dashboard SHOULD render last-known-good data with a visible "stale data" warning banner

**Schema Version Enforcement:**

- **FR-012**: Dashboard MUST validate `schema_version` field for both `predictions/trends.json` and `ai_insights/summary.json`
- **FR-013**: On schema version mismatch, UI MUST show "Unsupported Schema Version" state with guidance—never silently fail or show blank content
- **FR-014**: Test fixtures MUST include cases for: valid schema, unsupported schema version (too high), unsupported schema version (too low), missing schema_version field

**Setup Guidance:**

- **FR-015**: Setup guidance MUST include copyable YAML configuration snippets
- **FR-016**: README MUST document how to enable Predictions feature
- **FR-017**: README MUST document how to enable AI Insights feature
- **FR-018**: Documentation MUST include troubleshooting section for all 5 error states

**OpenAI Security & Data Boundaries (SEALED):**

- **FR-019**: OpenAI API key MUST be stored as ADO secret variable (pipeline variable library or inline secret)
- **FR-020**: API key MUST be injected via environment variable `OPENAI_API_KEY`—never stored in files
- **FR-021**: API keys MUST NEVER appear in: pipeline logs, build artifacts, dashboard UI, error messages, or browser console—this applies to both success paths and error paths
- **FR-022**: OpenAI request bodies (prompts) and response bodies MUST NEVER be logged, stored in artifacts, or displayed in UI
- **FR-023**: Documentation MUST specify exactly what data is sent to OpenAI (aggregated metrics only) and what is never sent (individual PR content, user identities, source code)

**pnpm Migration (POLICY, NOT CONVENTION):**

- **FR-024**: Project MUST use pnpm as the sole package manager—this is enforced as policy by CI
- **FR-025**: Project MUST include `pnpm-lock.yaml` lockfile
- **FR-026**: Project MUST remove `package-lock.json` and all npm-specific scripts
- **FR-027**: `package.json` MUST include `"packageManager"` field with pinned pnpm version (e.g., `"packageManager": "pnpm@9.x.x"`)
- **FR-028**: All npm script invocations MUST use pnpm explicitly (no implicit npm calls)

**pnpm CI Enforcement (CI IS THE AUTHORITY):**

- **FR-029**: CI MUST fail if `package-lock.json` exists in repository
- **FR-030**: CI MUST fail if any step uses `npm install` instead of `pnpm install`
- **FR-031**: CI MUST use `pnpm install --frozen-lockfile` (mandatory, no exceptions)
- **FR-032**: CI MUST enable Corepack before pnpm operations (required, not optional)
- **FR-033**: Documentation MUST explain Corepack enablement for local development

**Fresh-Clone Determinism:**

- **FR-034**: CI MUST include a dedicated job that:
  1. Checks out a fresh clone (no cached node_modules or pnpm store)
  2. Runs `pnpm install --frozen-lockfile`
  3. Builds the project
  4. Runs all tests
- **FR-035**: This job MUST NOT rely on any cached dependencies for correctness verification

**Backend Verification Gate:**

- **FR-036**: At least one integration test MUST verify that the pipeline emits `predictions/trends.json` at the exact expected path (case-sensitive)
- **FR-037**: At least one integration test MUST verify that the pipeline emits `ai_insights/summary.json` at the exact expected path (case-sensitive)
- **FR-038**: Integration tests MUST verify the dashboard consumes artifacts from exactly these paths

### Key Entities

- **Predictions Artifact**: JSON file at `predictions/trends.json` containing:
  - `schema_version` (required, integer): Version number for schema compatibility
  - `generated_at` (required, ISO 8601 string): Timestamp of generation
  - `forecaster` (optional, "linear" | "prophet"): Algorithm used
  - `data_quality` (optional, "normal" | "low_confidence" | "insufficient"): Data quality indicator
  - `forecasts` (required, array): Forecast data with `metric`, `unit`, `horizon_weeks`, `values`

- **Insights Artifact**: JSON file at `ai_insights/summary.json` containing:
  - `schema_version` (required, integer): Version number for schema compatibility
  - `generated_at` (required, ISO 8601 string): Timestamp of generation
  - `insights` (required, array): Insight items with `id`, `category`, `severity`, `title`, `description`
  - Each insight MAY include: `data`, `affected_entities`, `recommendation`

- **Package Manager Config**:
  - `pnpm-lock.yaml`: Lockfile for deterministic installs
  - `package.json#packageManager`: Pinned pnpm version string

## Success Criteria *(mandatory)*

### Measurable Outcomes

**Mechanically Verifiable (Automated):**

- **SC-001**: Predictions and AI Insights tabs are visible on dashboard load (CSS `hidden` class removed)
- **SC-002**: Zero console errors when dashboard displays `setup-required` state (verified by automated test)
- **SC-003**: Dashboard displays correct error state for each fixture type: valid, malformed JSON, unsupported schema, empty data (fixture-based tests)
- **SC-004**: AI Insights cards render in deterministic order matching spec (severity DESC → category ASC → id ASC) (assertion in test)
- **SC-005**: Predictions series render in chronological order by `period_start` (assertion in test)
- **SC-006**: CI fresh-clone job passes with `pnpm install --frozen-lockfile` (no cache dependencies)
- **SC-007**: CI fails when `package-lock.json` is present (negative test)
- **SC-008**: CI fails when `npm install` is used (negative test)
- **SC-009**: No npm artifacts remain in repository after migration (`package-lock.json` absent)
- **SC-010**: Integration test confirms pipeline emits artifacts at exact paths consumed by dashboard

**Documentation Verifiable (Manual Review):**

- **SC-011**: README contains ML feature enablement section with YAML snippets
- **SC-012**: README contains pnpm installation instructions with Corepack enablement
- **SC-013**: Troubleshooting section covers all 5 error states

## Assumptions

- The backend pipeline code for generating predictions already exists (linear regression fallback per spec 004)
- The backend pipeline code for generating AI insights already exists with OpenAI integration
- Prophet auto-detection for enhanced forecasting is optional enhancement, not blocker
- Developers have pnpm installed or can install it via `corepack enable && corepack prepare`
- CI/CD environments support pnpm and Corepack (GitHub Actions, Azure DevOps have native support)
- Current supported schema_version range will be defined during implementation (initially version 1 only)

## Out of Scope

- Backend implementation of prediction algorithms (already exists)
- Backend implementation of OpenAI integration for insights (already exists)
- Changes to the prediction/insights data schemas (this feature consumes existing schemas)
- Workspace/monorepo restructuring (single-package migration only)
- OpenAI prompt engineering or response quality improvements
- Caching layer implementation for insights (handled by backend, not dashboard)
