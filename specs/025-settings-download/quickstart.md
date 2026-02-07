# Quickstart: Settings Page — Download Raw Data

**Feature**: 025-settings-download
**Date**: 2026-02-06

## Overview

Add a "Download Raw Data" button to the settings page (`extension/ui/settings.html` + `settings.ts`) that downloads the same `csv-output` artifact ZIP as the dashboard export.

## Files to Modify

| File | Change | Lines |
|------|--------|-------|
| `extension/ui/settings.html` | Add "Data Export" section with download button | ~10 new lines |
| `extension/ui/settings.ts` | Import ArtifactClient, add download logic, cache validation result | ~80 new lines |
| `extension/ui/styles.css` | Add toast styles (if not already loaded by settings page) | ~5 new lines |

## Files to Create

| File | Purpose |
|------|---------|
| `extension/tests/dashboard/settings-download.test.ts` | Unit tests for download flow |

## Key Implementation Steps

### 1. HTML: Add Data Export Section

In `settings.html`, add a new section between the action buttons (line 66) and the footer (line 69):

```html
<div class="section" id="data-export-section">
    <h3>Data Export</h3>
    <p>Download the raw CSV data from your configured pipeline.</p>
    <button id="download-raw-btn" class="btn btn-small btn-secondary" disabled>
        Download Raw Data (ZIP)
    </button>
    <span id="download-status"></span>
</div>
```

### 2. TypeScript: Import ArtifactClient

Add to settings.ts imports:

```typescript
import { ArtifactClient } from "./artifact-client";
```

### 3. TypeScript: Cache Validation Result

Add module-level state:

```typescript
let lastValidation: { valid: boolean; buildId?: number } | null = null;
```

Update `updateStatus()` to store the validation result and enable/disable the download button accordingly.

### 4. TypeScript: Download Function

Add `downloadRawData()` async function following the exact same pattern as `downloadRawDataZip()` in dashboard.ts:1498-1561:

1. Check `lastValidation?.valid` and `lastValidation?.buildId`
2. Read saved project ID from extension data service
3. Create and initialize `ArtifactClient(projectId)`
4. Call `getArtifactMetadata(buildId, "csv-output")`
5. Append `?format=zip` to download URL
6. Call `authenticatedFetch(zipUrl)`
7. Create blob, trigger download with filename `pr-insights-raw-data-YYYY-MM-DD.zip`

### 5. Event Wiring

In `init()`, add click handler for `#download-raw-btn`.

## Verification

```bash
# Build
cd extension && pnpm run build:ui

# Test
cd extension && pnpm test

# Manual: Load settings page in ADO, configure a pipeline, click Download Raw Data
```
