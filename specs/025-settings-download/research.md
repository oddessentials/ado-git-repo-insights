# Research: Settings Page — Download Raw Data

**Feature**: 025-settings-download
**Date**: 2026-02-06

## Research Questions & Findings

### RQ-1: How does the settings page currently resolve pipeline/build info?

**Decision**: Reuse existing `validatePipeline()` from `settings.ts` which already returns `buildId`.

**Rationale**: `validatePipeline(pipelineId, projectId)` at settings.ts:398-507 already:
1. Fetches the pipeline definition via `TFS/Build/RestClient`
2. Fetches the most recent successful build (statusFilter=2, resultFilter=6, top=1)
3. Returns `{ valid: true, name, buildId }` on success

The `updateStatus()` function at settings.ts:307-384 calls `validatePipeline()` and displays the result. The `buildId` is already available in the validation result — we just need to store it for use by the download function.

**Alternatives considered**:
- Importing `resolveFromPipelineId()` from dashboard.ts — rejected because dashboard.ts is a separate IIFE bundle; settings.ts cannot import from it at runtime
- Duplicating the full `resolveConfiguration()` flow — rejected as over-engineering; settings already has the simpler validation path

### RQ-2: How should the settings page access ArtifactClient?

**Decision**: Import `ArtifactClient` directly into settings.ts from `./artifact-client`.

**Rationale**: esbuild bundles settings.ts as a standalone IIFE (bundle-ui.mjs:44). Since `bundle: true` is set, esbuild resolves all imports at build time. Importing `ArtifactClient` from `./artifact-client` works the same way dashboard.ts does it — the class gets bundled into settings.js.

**Alternatives considered**:
- Loading artifact-client.js via a script tag and accessing `window.PRInsightsArtifactClient` — rejected as fragile and would require HTML changes + load ordering
- Creating a shared download module — rejected as premature abstraction for a single reuse

### RQ-3: What artifact does the download button fetch?

**Decision**: Fetch the `csv-output` artifact (not `aggregates`).

**Rationale**: The dashboard's `downloadRawDataZip()` at dashboard.ts:1498-1561 fetches `artifactClient.getArtifactMetadata(currentBuildId, "csv-output")`. The `aggregates` artifact is used for dashboard data loading, not raw data export. The spec requires byte-identical output to the dashboard download.

**Alternatives considered**: None — the artifact name is a hard requirement from the spec.

### RQ-4: How should the download button relate to unsaved form state?

**Decision**: Read saved settings from `IExtensionDataService`, not from DOM form inputs.

**Rationale**: FR-008 requires using persisted configuration. The `updateStatus()` function already reads from `dataService.getValue()` with `scopeType: "User"`. The download function should follow the same pattern, reading `SETTINGS_KEY_PROJECT` and `SETTINGS_KEY_PIPELINE` from the data service.

The `validatePipeline()` result (including `buildId`) from the most recent `updateStatus()` call can be cached in a module-level variable, avoiding a redundant API call when the user clicks download.

**Alternatives considered**:
- Re-reading form inputs — rejected per FR-008
- Re-calling validatePipeline on every download click — acceptable fallback but wasteful; caching the last validation result is sufficient since `updateStatus()` is called on load and after save

### RQ-5: What UI pattern should the download button follow?

**Decision**: Add a "Data Export" section below Current Status, with a single button styled consistently with existing buttons.

**Rationale**: The settings page has a clear section-based layout:
1. Pipeline Source (configuration inputs)
2. Current Status (read-only status display)
3. Action Buttons (Save, Clear, Discover)
4. Footer (scope note, documentation link)

A new "Data Export" section between Action Buttons and Footer keeps configuration and export clearly separated (per FR-001). The button uses the same `btn btn-small btn-secondary` classes as existing buttons.

**Alternatives considered**:
- Adding to the existing action buttons row — rejected per FR-001 (must be visually distinct)
- A dropdown like the dashboard — rejected as over-engineering for a single action

### RQ-6: How to handle the loading state?

**Decision**: Disable the button and change its text to "Downloading..." during the fetch. Show status via `showToast()` from the export module.

**Rationale**: The dashboard uses `showToast()` for all download feedback. Reusing it maintains UX consistency. Button text change provides immediate visual feedback per FR-006.

**Alternatives considered**:
- CSS spinner animation — adds complexity for marginal benefit
- Inline status text below button — viable but toast is already the established pattern
