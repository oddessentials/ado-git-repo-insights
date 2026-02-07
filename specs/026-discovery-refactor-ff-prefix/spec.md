# Feature Specification: Discovery Refactor & Feature Flag Prefixes

**Feature Branch**: `026-discovery-refactor-ff-prefix`
**Created**: 2026-02-07
**Status**: Draft
**Input**: User description: "1. Refactor discoverPipelines() to use the same shared build client the dashboard uses, eliminating the legacy SDK dependency. 2. Add a prefix indicator to Feature Flag names and a new FF toggle that disables the dashboard navigation item by default."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Settings pipeline discovery works reliably (Priority: P1)

As an extension user with no saved pipeline ID, when I open the settings page, the system discovers available pipelines and enables the "Download Raw Data" button — using the same reliable discovery mechanism that the dashboard already uses.

**Why this priority**: This fixes a live production issue where pipeline discovery on the settings page fails silently due to the legacy client passing parameters differently from the dashboard's client. Using the shared build client eliminates this entire class of bugs.

**Independent Test**: Can be fully tested by clearing saved pipeline settings and verifying that both the settings page and "Re-discover Pipelines" button find the same pipelines the dashboard finds.

**Acceptance Scenarios**:

1. **Given** no saved pipeline ID, **When** the settings page loads, **Then** the system discovers pipelines using the same mechanism as the dashboard and enables the download button if a match is found.
2. **Given** a user clicks "Re-discover Pipelines", **When** discovery runs, **Then** results match what the dashboard would find for the same project.
3. **Given** no pipelines exist with an "aggregates" artifact, **When** discovery runs, **Then** the user sees a clear message and the download button remains disabled.

---

### User Story 2 - Feature flags are identifiable in Azure DevOps (Priority: P2)

As an Azure DevOps organization admin, when I open "Preview Features" in Azure DevOps, I can immediately identify which feature flags belong to the Git Repo Insights extension because they all share a recognizable prefix.

**Why this priority**: Without a prefix, extension feature flags are mixed in with Microsoft's own preview features and other extensions, making it difficult for admins to find and manage them.

**Independent Test**: Can be tested by opening Azure DevOps "Preview Features" and confirming all Git Repo Insights flags are visually grouped together with a consistent prefix.

**Acceptance Scenarios**:

1. **Given** the extension is installed, **When** an admin opens "Preview Features", **Then** all Git Repo Insights feature flags display with a consistent prefix that distinguishes them from other flags.
2. **Given** existing dataset-level feature flags (predictions, ai_insights), **When** viewing extension-level flags, **Then** there is no naming conflict or confusion between the two flag scopes.

---

### User Story 3 - Dashboard can be disabled via feature flag (Priority: P2)

As an Azure DevOps project admin, I want to control whether the "PR Insights" dashboard navigation item appears in the Repos hub, so I can roll out the extension gradually or disable the dashboard while keeping the settings page and pipeline task active.

**Why this priority**: This gives admins control over extension visibility. The dashboard may not be ready for all teams, but the pipeline task and settings page should remain accessible.

**Independent Test**: Can be tested by toggling the feature flag off and verifying the "PR Insights" hub disappears from the Repos navigation, while the settings page and pipeline task remain fully functional.

**Acceptance Scenarios**:

1. **Given** the dashboard feature flag is disabled, **When** a user navigates to the Repos hub group, **Then** the "PR Insights" navigation item is not visible.
2. **Given** the dashboard feature flag is disabled, **When** an admin navigates to Project Settings, **Then** the "PR Insights Settings" page is still accessible.
3. **Given** the dashboard feature flag is disabled, **When** a pipeline runs the extract-prs task, **Then** the task executes normally and produces artifacts.
4. **Given** the dashboard feature flag is enabled (toggled on), **When** a user navigates to the Repos hub group, **Then** the "PR Insights" navigation item appears and functions normally.

---

### Edge Cases

- What happens when the feature flag is toggled while a user has the dashboard open? The page should continue to work for the current session; the flag is evaluated at navigation render time (page load), not in real time. Changes take effect on the next full page navigation.
- What happens if discovery finds pipelines in auto-discovery mode but the user then saves a different source project? The discovery should re-run against the newly saved project on the next status update.
- What happens if the shared build client fails to initialize (e.g., auth token unavailable, SDK load failure)? The system MUST surface a visible error state with a retry affordance (e.g., "Discovery failed — Retry" button or inline error with manual retry). Silent failure is not acceptable.
- What happens if the build client initializes but an individual API call fails mid-discovery (e.g., one pipeline's builds call returns an error)? The system should skip that pipeline and continue, but surface a warning count (e.g., "Found 2 pipelines; 1 could not be checked") rather than silently swallowing errors.
- What happens if two UI entry points (e.g., updateStatus and runDiscovery) call the shared build client concurrently? The client must be safe for concurrent use — either by returning the same cached instance or by being stateless per call.

## Requirements *(mandatory)*

### Functional Requirements

#### Shared Build Client

- **FR-001**: The settings page pipeline discovery MUST use the same shared build client as the dashboard, eliminating the duplicate legacy client initialization.
- **FR-002**: The "Re-discover Pipelines" button MUST use the same shared build client, ensuring consistent results with the dashboard.
- **FR-003**: The shared build client MUST be instantiated via a single entry point that both the dashboard and settings page import. There MUST NOT be any inline or duplicate client initialization (e.g., raw `VSS.require(["TFS/Build/RestClient"])` calls) outside this shared entry point.
- **FR-004**: The shared build client MUST be safe for concurrent callers. If two UI paths invoke it simultaneously, both MUST receive a valid client without race conditions or double initialization.

#### Discovery Error Handling

- **FR-005**: If the shared build client fails to initialize (SDK load failure, auth error, timeout), the system MUST display a visible, user-facing error message in the status area — not fail silently.
- **FR-006**: Discovery errors MUST include a retry affordance so the user can re-attempt without reloading the page.
- **FR-007**: If individual pipeline checks fail during discovery (e.g., one pipeline's builds call errors), the system MUST continue checking remaining pipelines and surface a warning indicating how many pipelines could not be checked.

#### Feature Flags — Naming

- **FR-008**: All extension-level feature flags MUST use the prefix format `[GRI] ` (uppercase abbreviation in square brackets, followed by a space) before the human-readable flag name. Example: `[GRI] PR Insights Dashboard`.
- **FR-009**: The prefix format MUST be applied consistently to every current and future extension-level feature flag. Ad-hoc variations (e.g., "PR Insights:", "GRI -", "Git Repo Insights:") are prohibited.
- **FR-010**: Extension-level feature flag IDs (internal identifiers) MUST use the pattern `gri.<kebab-case-name>` (e.g., `gri.dashboard-hub`). Display names use the `[GRI]` prefix; IDs use the `gri.` prefix.

#### Feature Flags — Dashboard Toggle

- **FR-011**: The extension MUST provide a feature flag that controls visibility of the "PR Insights" dashboard navigation item.
- **FR-012**: The dashboard visibility feature flag MUST default to disabled (opt-in), so the dashboard does not appear until explicitly enabled.
- **FR-013**: Disabling the dashboard feature flag MUST NOT affect the settings page, the pipeline extraction task, or any other extension functionality.

#### Feature Flags — Scope and Evaluation

- **FR-014**: Extension-level feature flags MUST support both organization-level and project-level scoping, allowing org admins to set defaults and project admins to override per project.
- **FR-015**: Feature flags MUST be evaluated at navigation render time (when Azure DevOps decides which hubs to show). They are NOT evaluated in real time within an already-loaded page.
- **FR-016**: There is no client-side caching of feature flag state by the extension. Azure DevOps controls evaluation and caching. The extension declares flags in the manifest; Azure DevOps evaluates them.

#### Existing Feature Flags

- **FR-017**: Existing dataset-level feature flags (predictions, ai_insights) MUST continue to function independently of extension-level feature flags. These are separate scoping mechanisms and MUST NOT interfere with each other.

### Key Entities

- **Extension Feature Flag**: An Azure DevOps extension-level feature contribution that appears in the "Preview Features" panel and controls extension behavior at the organization or project level. Declared in the extension manifest, evaluated by Azure DevOps at navigation render time.
- **Shared Build Client (ArtifactClient)**: A single, reusable entry point for all Build API operations — `ArtifactClient` — which uses direct `fetch()` calls with `VSS.getAccessToken()` authentication. Instantiated once per page load, cached for the session, safe for concurrent callers. Used consistently by both dashboard and settings page for definitions, builds, and artifacts. Eliminates the legacy `TFS/Build/RestClient` SDK entirely.
- **Dataset Feature Flag**: A flag stored in the dataset manifest (`features` field) that controls data-loading behavior within the dashboard. Evaluated at runtime by the DatasetLoader. Completely independent of extension-level feature flags.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Settings page pipeline discovery returns identical results to dashboard discovery for the same project — zero discrepancies.
- **SC-002**: All extension feature flags are visually identifiable in the Azure DevOps "Preview Features" panel within 5 seconds of scanning, grouped by the `[GRI]` prefix.
- **SC-003**: Toggling the dashboard feature flag off removes the "PR Insights" navigation item without affecting settings page or pipeline task functionality.
- **SC-004**: The settings page "Re-discover Pipelines" button successfully finds pipelines that the dashboard can find — zero false negatives caused by client implementation differences.
- **SC-005**: When discovery fails (client initialization error, network failure), the user sees a visible error message with a retry option within 5 seconds — zero silent failures.
- **SC-006**: Zero instances of inline/duplicate build client initialization exist in the codebase after implementation. All build client access goes through the single shared entry point.

## Assumptions

- The Azure DevOps extension SDK supports the `ms.vss-web.feature` contribution type for defining feature flags that appear in "Preview Features".
- `ArtifactClient` already uses direct REST calls with `_authenticatedFetch()` successfully for artifact operations (`getArtifacts()`). The same pattern extends to definitions and builds without modification to the auth/fetch infrastructure.
- Feature flag default state (disabled) applies at the organization level; individual projects can override by enabling the flag.
- The prefix `[GRI]` is locked in as the canonical format for all extension-level feature flag display names. The ID prefix `gri.` is locked in for internal identifiers.
- Azure DevOps evaluates feature flag state at navigation render time and handles caching internally. The extension does not need to implement its own flag evaluation or caching logic.
- The shared build client is instantiated once per page load session. It does not need to survive cross-page navigation (each page load gets its own instance).
