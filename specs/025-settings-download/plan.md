# Implementation Plan: Settings Page — Download Raw Data

**Branch**: `025-settings-download` | **Date**: 2026-02-06 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/025-settings-download/spec.md`

## Summary

Add a "Download Raw Data" button to the PR Insights Settings page that downloads the same `csv-output` artifact ZIP as the dashboard's Export > Download Raw Data (ZIP) menu item. The settings page already has the ADO SDK initialized and already validates pipelines/builds — we reuse that resolution logic and add `ArtifactClient` for authenticated artifact download.

## Technical Context

**Language/Version**: TypeScript 5.7.3
**Primary Dependencies**: vss-web-extension-sdk 5.141.0, esbuild 0.27.0 (IIFE bundling)
**Storage**: N/A (reads from ADO extension data service for saved settings, fetches from ADO Build API for artifacts)
**Testing**: Jest 30.0.0, ts-jest 29.2.5, jsdom (test environment)
**Target Platform**: Browser (Azure DevOps extension iframe, es2020 target)
**Project Type**: Extension UI (single-page settings hub within ADO)
**Performance Goals**: Download initiates within 2 seconds of click; no UI freeze during fetch
**Constraints**: Must work within ADO extension iframe security context; bearer token auth only
**Scale/Scope**: 1 HTML section, ~80 lines new TypeScript, 1 test file

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I–IV (CSV Schema) | N/A | Feature downloads existing artifact, does not modify CSV output |
| V (SQLite source of truth) | N/A | No data transformation involved |
| VI (Pipeline Artifacts) | PASS | Reads existing pipeline artifact (`csv-output`) |
| VII (No Publish on Failure) | N/A | Read-only operation |
| XVI (Names as Labels) | PASS | Uses pipeline definition IDs, not names, for resolution |
| XIX (PAT Secrecy) | PASS | Uses `VSS.getAccessToken()` bearer token; never logged |
| XX (Least Privilege) | PASS | Uses existing Code Read scope; no new permissions required |
| QG-17–22 (Release Gates) | PASS | Lint, type-check, test, build all validated in CI |

**Result**: All applicable gates pass. No violations.

## Project Structure

### Documentation (this feature)

```text
specs/025-settings-download/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
extension/
├── ui/
│   ├── settings.html              # MODIFY: Add "Data Export" section with download button
│   ├── settings.ts                # MODIFY: Add download logic (~80 lines)
│   ├── styles.css                 # MODIFY: Add styles for download button states (if needed)
│   ├── artifact-client.ts         # READ-ONLY: Import ArtifactClient for authenticated fetch
│   └── modules/
│       └── export.ts              # READ-ONLY: Import showToast for user feedback
├── scripts/
│   └── bundle-ui.mjs             # NO CHANGE: settings.ts already bundled as IIFE entry point
└── tests/
    └── dashboard/
        └── settings-download.test.ts  # NEW: Unit tests for download logic
```

**Structure Decision**: Minimal changes within existing extension UI structure. No new modules or packages — reuse `ArtifactClient` (already a bundled entry point) and `showToast` from export module. The settings page is already a standalone IIFE bundle that can import from the same source tree.
