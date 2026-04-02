# Feature Specification: Migrate from vss-web-extension-sdk to azure-devops-extension-sdk

**Feature Branch**: `046-migrate-ado-sdk`
**Created**: 2026-03-30
**Status**: Draft
**Input**: User description: "Resolve GitHub issue #222: Migrate from vss-web-extension-sdk to azure-devops-extension-sdk."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Dashboard Loads and Displays Data (Priority: P1)

An Azure DevOps user navigates to the PR Insights dashboard widget within their project. The extension initializes, authenticates against the Azure DevOps host, retrieves saved pipeline settings, fetches pipeline artifact data, and renders the metrics dashboard — all using the replacement SDK.

**Why this priority**: The dashboard is the primary user-facing surface of this extension. If initialization, authentication, and data retrieval break during migration, the entire extension is non-functional.

**Independent Test**: Can be fully tested by loading the extension widget in an Azure DevOps project and verifying that charts, summary cards, and filter controls render with real data from a configured pipeline.

**Acceptance Scenarios**:

1. **Given** the extension is installed in an Azure DevOps project with a configured pipeline, **When** a user opens the PR Insights dashboard, **Then** the SDK initializes, authenticates, loads saved settings, fetches artifacts, and renders the dashboard identically to the pre-migration behavior.
2. **Given** the extension is installed but no pipeline is configured, **When** a user opens the dashboard, **Then** the extension initializes and displays the appropriate empty-state or setup guidance without errors.
3. **Given** the Azure DevOps host is slow to respond, **When** initialization takes longer than expected, **Then** the user sees a loading indicator and the extension gracefully handles the timeout.

---

### User Story 2 - Settings Page Manages Configuration (Priority: P1)

An Azure DevOps user opens the PR Insights settings page to configure which pipeline to track, select a project, or download raw data. All settings operations — including reading, saving, and listing available projects — work correctly after the SDK migration.

**Why this priority**: The settings page is the only way users configure the extension. It uses the broadest surface of the SDK, including the most complex integration point (dynamically loading a REST client module to list projects). A broken settings page means users cannot set up or reconfigure the extension.

**Independent Test**: Can be fully tested by opening the settings page, changing the pipeline configuration, selecting a different project from the dropdown, saving, and verifying the new settings persist across page reloads.

**Acceptance Scenarios**:

1. **Given** a user is on the settings page, **When** they select a project from the dropdown, **Then** the project list is populated by querying the Azure DevOps REST API using the replacement SDK, and the selection persists after save.
2. **Given** a user saves a new pipeline configuration, **When** they reload the settings page, **Then** the previously saved configuration is correctly retrieved from the extension data service.
3. **Given** settings were saved using the old SDK before migration, **When** the settings page loads after migration, **Then** all previously saved configuration (pipeline selection, project, preferences) is correctly read and displayed without requiring any manual re-entry or data migration.
4. **Given** the project-listing API call fails, **When** the settings page loads, **Then** a user-friendly error is displayed and other settings functionality remains available.

---

### User Story 3 - Authenticated API Calls Succeed (Priority: P1)

The extension's artifact client makes authenticated REST API calls to Azure DevOps to fetch build artifacts. After migration, authentication tokens are obtained via the replacement SDK and all API calls succeed with correct authorization.

**Why this priority**: Every data fetch depends on authenticated API calls. If token retrieval or header construction breaks, no data can be loaded regardless of whether initialization succeeds.

**Independent Test**: Can be fully tested by triggering a data refresh on the dashboard and verifying that pipeline artifact data is successfully fetched and rendered.

**Acceptance Scenarios**:

1. **Given** the extension is initialized and authenticated, **When** the artifact client fetches build artifacts, **Then** the request includes a valid Bearer token obtained via `getAccessToken()` (user-delegated token, not `getAppToken()`) and returns data successfully.
2. **Given** the authentication token has expired or is invalid, **When** an API call fails with a 401 status, **Then** the extension surfaces a clear authentication error to the user.
3. **Given** a test exercises the authentication path, **When** it inspects which token function is called, **Then** it verifies `getAccessToken()` is used and `getAppToken()` is not invoked for artifact or data-service calls.

---

### User Story 4 - Local Development Mode Continues Working (Priority: P2)

A developer working on the extension locally (outside Azure DevOps) uses local dataset mode to test the dashboard with synthetic data. The local mode detection and fallback behavior are preserved after migration.

**Why this priority**: Local dev mode is essential for contributors but does not affect end users in production. It must work but is lower priority than production functionality.

**Independent Test**: Can be fully tested by running the extension locally with the local dataset flag and verifying that the dashboard renders using local JSON data files without attempting SDK initialization.

**Acceptance Scenarios**:

1. **Given** the extension is running in local development mode, **When** the dashboard loads, **Then** it bypasses SDK initialization and loads data from local JSON files.
2. **Given** local mode is not active, **When** the extension loads, **Then** it proceeds with normal SDK initialization and does not fall back to local data.

---

### User Story 5 - Extension Passes All Automated Quality Gates (Priority: P2)

After the migration, all existing automated tests, lint checks, type checks, and CI gates pass without new suppressions or relaxed baselines. The test mock harness accurately simulates the replacement SDK's behavior.

**Why this priority**: The project enforces strict quality gates (zero lint warnings, strict TypeScript, comprehensive test coverage). The migration must not regress any of these gates.

**Independent Test**: Can be fully tested by running the full CI pipeline (pytest, Jest, ESLint, tsc, coverage thresholds) and verifying zero failures and zero new suppressions.

**Acceptance Scenarios**:

1. **Given** the SDK migration is complete, **When** the full test suite runs, **Then** all existing tests pass (updated to use the new mock harness) with no new test suppressions.
2. **Given** the migration replaces type declarations, **When** TypeScript type-checking runs, **Then** all files compile without errors using the SDK-provided types.
3. **Given** ESLint rules are unchanged, **When** linting runs, **Then** zero warnings are reported (no new suppressions added).

---

### Edge Cases

- **Azure DevOps Server (on-premises)**: This migration targets Azure DevOps Services (cloud) only. On-premises Azure DevOps Server versions are explicitly **out of scope** for this branch. If Server compatibility is needed later, it will be addressed as a separate follow-up with a defined support matrix and dedicated testing.
- How does the extension behave if the replacement SDK package fails to load (e.g., network error during bundling or a corrupted install)?
- How does the system handle the transition for users who have the extension cached with the old SDK script tag?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Extension MUST initialize using the replacement SDK and signal successful load to the Azure DevOps host.
- **FR-002**: Extension MUST retrieve the current organization, project, team, and user context from the replacement SDK.
- **FR-003**: Extension MUST obtain user-delegated authentication tokens via `getAccessToken()` from the replacement SDK for use as Bearer tokens in REST API calls. Extension-to-service identity tokens (`getAppToken()`) MUST NOT be used for artifact or data-service calls unless a future requirement explicitly demands service identity.
- **FR-004**: Extension MUST read and write extension settings (pipeline configuration, user preferences) through the replacement SDK's data service.
- **FR-005a**: Extension MUST use the host/init/auth SDK (`azure-devops-extension-sdk`) exclusively for host handshake, initialization, context retrieval, data service access, and token acquisition. REST client operations MUST NOT be routed through this package.
- **FR-005b**: Extension MUST list available projects via a direct authenticated REST call to the Azure DevOps Projects API, replacing the current `VSS.require(["TFS/Core/RestClient"])` dynamic module loading pattern. The API package (`azure-devops-extension-api`) is retained for type declarations only; its runtime REST clients are not used because the package ships AMD-only JavaScript incompatible with the project's esbuild + IIFE bundling architecture.
- **FR-006**: Extension MUST load the replacement SDK as a bundled dependency rather than via a standalone script tag in HTML files.
- **FR-007**: The SDK abstraction layer MUST preserve the same public interface so that consuming modules (dashboard, settings, artifact client) require minimal changes.
- **FR-008**: The test mock harness MUST be rewritten to simulate the replacement SDK's initialization, context, data service, and authentication APIs.
- **FR-009**: Custom type declarations for the old SDK MUST be removed and replaced by types provided by the replacement SDK packages.
- **FR-010**: The build pipeline MUST be updated to remove the old SDK copy step and bundle the replacement SDK through the existing bundler.
- **FR-011**: Extension MUST preserve user-visible parity across these exact surfaces: (a) dashboard load and chart/card rendering, (b) settings read/write and project-listing workflows, (c) authenticated artifact fetches, (d) local development mode, and (e) existing empty-state and error-state presentations. Behavior outside these surfaces (e.g., internal SDK log output, network request count) is not constrained.
- **FR-012**: Migration MUST NOT introduce any new lint suppressions, type assertion overrides, or relaxed test coverage thresholds.
- **FR-013**: Extension MUST read settings previously saved via the old SDK without migration, reformatting, or data loss. The data service access pattern may change, but the stored key/value format MUST remain compatible.
- **FR-014**: The SDK abstraction layer MUST preserve the init → ready → notifyLoadSucceeded host handshake sequence. Initialization MUST be idempotent, MUST support a configurable timeout, and MUST signal successful load to the host only after the SDK reports readiness. A test MUST verify this exact sequence.
- **FR-015**: The build pipeline and output artifacts MUST contain zero residual references to `vss-web-extension-sdk`, `VSS.SDK.min.js`, or the old SDK copy script. A build-time assertion MUST verify this. Additionally, a runtime smoke test MUST confirm that the bundled replacement SDK initializes correctly when loaded by the host.

### Key Entities

- **SDK Abstraction Layer**: The wrapper module that isolates all direct SDK calls from consuming code. Currently exposes initialization, context access, data service access, and token retrieval.
- **Extension Data Service**: The Azure DevOps service for persisting and retrieving extension-scoped key/value settings. The interface (get/set values) must be preserved.
- **Web Context**: The host-provided context object containing organization, project, team, and user identifiers. Used throughout the extension for scoping API calls and settings.
- **Authentication Token**: A Bearer token obtained from the SDK for authorizing REST API calls to Azure DevOps endpoints.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All existing automated tests pass after migration with zero new test skips, zero new suppressions, and zero relaxed coverage thresholds.
- **SC-002**: The extension initializes and renders the dashboard within the same time budget as the pre-migration baseline (no measurable regression in load time).
- **SC-003**: All six SDK API functions currently used (init, ready, notifyLoadSucceeded, getWebContext, getService, getAccessToken) have verified equivalents exercised by the test suite. The init → ready → notifyLoadSucceeded handshake sequence is covered by a dedicated test.
- **SC-004**: The deprecated `vss-web-extension-sdk` package and its associated copy script, script tags, and custom type declarations are fully removed from the codebase with zero residual references. A build-time assertion enforces this, and a runtime smoke test confirms the bundled replacement SDK initializes.
- **SC-005**: The `VSS.require()` dynamic module loading pattern in the settings page is replaced with a direct import that provides equivalent project-listing functionality.
- **SC-006**: The replacement SDK is bundled through the existing build pipeline (not loaded via a separate script tag), reducing the number of network requests at runtime.
- **SC-007**: TypeScript strict-mode compilation succeeds using SDK-provided types with no custom type declarations for the SDK.
- **SC-008**: A test reads pre-existing settings (saved under the old SDK) through the migrated data service path and verifies all values are returned correctly without migration or reformatting.

## Assumptions

- The `azure-devops-extension-sdk` and `azure-devops-extension-api` packages are stable and available on npm for installation.
- This migration targets Azure DevOps Services (cloud) only. On-premises Azure DevOps Server compatibility is out of scope for this branch.
- The project's existing esbuild bundler can resolve and bundle the replacement SDK's ES module imports without configuration changes beyond removing the old SDK's external handling.
- This migration is isolated from the TypeScript 6.0 upgrade (issue #223) and will be completed on the current TypeScript 5.9 toolchain.
- The `sdk.ts` abstraction layer successfully isolates most production code, so the majority of changes are confined to the abstraction itself, the settings page (AMD pattern replacement), HTML files, build scripts, and the test harness.
