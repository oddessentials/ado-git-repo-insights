# Data Model: Settings Page — Download Raw Data

**Feature**: 025-settings-download
**Date**: 2026-02-06

## Entities

This feature does not introduce new entities. It reuses existing entities from the settings and dashboard data model.

### Existing Entities (read-only)

#### Pipeline Source Configuration (persisted)
- **Storage**: ADO Extension Data Service (user-scoped)
- **Keys**:
  - `pr-insights-source-project` → `string | null` (project UUID)
  - `pr-insights-pipeline-id` → `number | null` (pipeline definition ID)
- **Read by**: `updateStatus()`, download function
- **Written by**: `saveSettings()`, `clearSettings()`

#### Pipeline Validation Result (transient, in-memory)
- **Source**: `validatePipeline(pipelineId, projectId)` return value
- **Fields**:
  - `valid: boolean`
  - `name?: string` (pipeline display name)
  - `buildId?: number` (most recent successful build ID)
  - `error?: string` (validation error message)
- **Lifecycle**: Refreshed on page load and after settings save

#### Build Artifact Metadata (transient, from API)
- **Source**: `ArtifactClient.getArtifactMetadata(buildId, "csv-output")`
- **Fields**:
  - `name: string` (artifact name, always `"csv-output"`)
  - `resource.downloadUrl: string` (ADO-provided download URL)
- **Lifecycle**: Fetched on-demand when download button is clicked

## State Management

### New Module-Level State in settings.ts

| Variable | Type | Initial | Updated By | Read By |
|----------|------|---------|------------|---------|
| `lastValidation` | `{ valid: boolean; buildId?: number } \| null` | `null` | `updateStatus()` | `downloadRawData()` |

This single variable caches the most recent `validatePipeline()` result so the download function knows the current `buildId` without an extra API call.

## Data Flow

```
User clicks "Download Raw Data"
  │
  ├─ Check lastValidation.valid && lastValidation.buildId
  │   └─ If not valid → show error, return
  │
  ├─ Read saved projectId from extension data service
  │
  ├─ Create ArtifactClient(projectId)
  │   └─ Initialize (get auth token via VSS.getAccessToken())
  │
  ├─ getArtifactMetadata(buildId, "csv-output")
  │   └─ If not found → show "artifact not found" error
  │
  ├─ Append ?format=zip to downloadUrl
  │
  ├─ authenticatedFetch(zipUrl)
  │   └─ If 401/403 → show "permission denied"
  │   └─ If other error → show generic error
  │
  └─ Create blob → trigger browser download
      └─ Filename: pr-insights-raw-data-YYYY-MM-DD.zip
```
