# Feature Specification: Settings Page — Download Raw Data

**Feature Branch**: `025-settings-download`
**Created**: 2026-02-06
**Status**: Draft
**Input**: User description: "Extend our azure devops extension settings pages with a download raw data button that downloads the exact same zip as the download raw data dropdown button in the upper-right of the dashboard view."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Download Raw Data from Settings (Priority: P1)

A project administrator navigates to the PR Insights Settings page (Project Admin > PR Insights Settings) and sees a "Download Raw Data" button. They click it and receive the same ZIP file containing pipeline CSV artifacts that they would get from the Export > Download Raw Data (ZIP) option on the dashboard.

**Why this priority**: This is the core and only feature requested. It provides an alternative access path to raw data for users who may be on the settings page configuring their pipeline source and want to verify or archive the underlying data without switching to the dashboard.

**Independent Test**: Can be fully tested by navigating to the settings page, clicking the button, and verifying the downloaded ZIP matches the dashboard's raw data download.

**Acceptance Scenarios**:

1. **Given** the settings page is loaded and a valid pipeline source is configured, **When** the user clicks "Download Raw Data", **Then** the browser downloads a ZIP file named `pr-insights-raw-data-YYYY-MM-DD.zip` containing the `csv-output` artifact from the most recent successful pipeline build.
2. **Given** the settings page is loaded and a valid pipeline source is configured, **When** the user clicks "Download Raw Data", **Then** the downloaded ZIP is byte-identical to what the dashboard's Export > Download Raw Data (ZIP) produces for the same build.
3. **Given** the settings page is loaded but no pipeline source is configured, **When** the user views the settings page, **Then** the "Download Raw Data" button is disabled with a tooltip or message explaining that a pipeline source must be configured first.

---

### User Story 2 — Feedback During Download (Priority: P2)

While the raw data ZIP is being fetched (which may take several seconds for large artifacts), the user sees clear progress indication so they know the download is in progress and not stalled.

**Why this priority**: Without feedback, users may click repeatedly or navigate away, leading to confusion or duplicate downloads. This is important for usability but secondary to the core download capability.

**Independent Test**: Can be tested by clicking the button on a configured settings page and observing that a loading/progress indicator appears during the fetch, then disappears once the download completes or fails.

**Acceptance Scenarios**:

1. **Given** the user clicks "Download Raw Data", **When** the artifact fetch is in progress, **Then** the button shows a loading state (e.g., spinner or "Downloading..." text) and is not clickable again until the operation completes.
2. **Given** the download completes successfully, **When** the file save dialog appears, **Then** the button returns to its normal state and a success message is displayed.
3. **Given** the download fails (network error, permission denied, artifact not found), **When** the error occurs, **Then** the button returns to its normal state and a clear error message is shown to the user.

---

### Edge Cases

- What happens when the configured pipeline has never had a successful build? The button should be disabled or show an appropriate message indicating no builds are available.
- What happens when the user's permissions do not allow downloading build artifacts? A "Permission denied" error message should be displayed.
- What happens when the pipeline's most recent successful build does not contain a `csv-output` artifact? An error message should indicate the artifact was not found.
- What happens when the user changes the pipeline configuration on the settings page but hasn't saved yet? The download should use the currently saved (persisted) configuration, not the unsaved form values.
- What happens when the user clicks the download button while another download is already in progress? The button should remain disabled until the current download completes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The settings page MUST display a "Download Raw Data" button in a clearly visible section, visually distinct from the existing Save/Clear/Discover configuration buttons.
- **FR-002**: The download button MUST use the same artifact resolution logic as the dashboard's Export > Download Raw Data (ZIP) — specifically, fetching the `csv-output` artifact from the most recent successful build of the configured pipeline and appending `?format=zip` to the download URL.
- **FR-003**: The download MUST use authenticated fetch (bearer token via the ADO SDK) to retrieve the artifact, consistent with the dashboard implementation.
- **FR-004**: The downloaded file MUST be named `pr-insights-raw-data-YYYY-MM-DD.zip` where the date is the current date, matching the dashboard's naming convention.
- **FR-005**: The button MUST be disabled when no pipeline source is configured (both project and pipeline ID are absent or invalid).
- **FR-006**: The button MUST show a loading state during the download and prevent duplicate clicks.
- **FR-007**: The button MUST display user-friendly error messages for failure scenarios: no artifact found, permission denied, no successful builds, and network errors.
- **FR-008**: The download MUST use the persisted (saved) pipeline configuration, not any unsaved form values currently in the settings form.

### Key Entities

- **Pipeline Source Configuration**: The saved project ID and pipeline definition ID that identify which ADO pipeline to fetch artifacts from.
- **Build Artifact**: The `csv-output` artifact attached to the most recent successful build of the configured pipeline, downloadable as a ZIP.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can download raw pipeline data from the settings page in 2 clicks or fewer (click button, confirm save if prompted by browser).
- **SC-002**: The downloaded ZIP from the settings page is identical to the ZIP from the dashboard's Export > Download Raw Data for the same pipeline run.
- **SC-003**: Users see clear feedback (loading indicator and success/error message) within 1 second of clicking the download button.
- **SC-004**: All error scenarios (no config, no artifact, permission denied, network failure) produce a user-understandable message without requiring the user to open browser developer tools.

## Assumptions

- The settings page already has access to the ADO SDK and can initialize an artifact client using the same pattern as the dashboard.
- The user visiting the settings page has the same ADO permissions as when they visit the dashboard (same auth context).
- The "most recent successful build" resolution logic can be shared or replicated from the dashboard's existing implementation.
- The download button will be placed in a new "Data Export" section on the settings page, below the existing Pipeline Source and Current Status sections, to maintain clear visual separation from configuration controls.
