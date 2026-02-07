# Implementation Plan: Discovery Refactor & Feature Flag Prefixes

**Branch**: `026-discovery-refactor-ff-prefix` | **Date**: 2026-02-07 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/026-discovery-refactor-ff-prefix/spec.md`

## Summary

Eliminate the legacy `TFS/Build/RestClient` SDK from pipeline discovery entirely. Replace it with direct REST calls using the same `_authenticatedFetch()` pattern that `ArtifactClient` already uses successfully for artifact operations. Add discovery methods (`discoverPipelines`) to `ArtifactClient` so that both the dashboard and settings page use a single, proven REST client for all Build API interactions. Add visible error handling with retry for discovery failures. Introduce Azure DevOps extension-level feature flags with `[GRI]` prefix naming — including a dashboard visibility toggle that defaults to disabled.

### Why direct REST instead of getBuildClient()

Two previous fix branches (`fix/settings-download`, `fix/settings-discovery-null-params`) attempted to fix settings page discovery by patching the legacy `TFS/Build/RestClient` usage — first fixing the project scope, then fixing `null` vs `undefined` parameter passing. Both were merged and released (v5.22.1, v5.22.2) but the button remains broken in production.

The root cause is the legacy `VSS.require(["TFS/Build/RestClient"])` module system, which has opaque parameter serialization behavior that differs between contexts. Rather than attempting a third patch, this plan eliminates the dependency entirely by using direct `fetch()` calls with the ADO REST API — the same pattern that `ArtifactClient.getArtifacts()` already uses successfully.

## Technical Context

**Language/Version**: TypeScript 5.7.3 (extension)
**Primary Dependencies**: vss-web-extension-sdk 5.141.0 (for `VSS.getAccessToken()` and `VSS.getWebContext()` only), esbuild 0.27.0 (IIFE bundling)
**Storage**: N/A (extension data service for settings, ADO Build API for discovery)
**Testing**: Jest 30.0.0, ts-jest 29.2.5, jsdom (test environment)
**Target Platform**: Azure DevOps extension (browser iframe)
**Project Type**: Extension UI (two independent IIFE bundles: dashboard.js, settings.js)
**Performance Goals**: Discovery completes within existing page load time; no additional latency
**Constraints**: IIFE bundle format (no ESM); shared modules are tree-shaken into each bundle at build time
**Scale/Scope**: 3 TypeScript files modified (settings.ts, artifact-client.ts, dashboard.ts), 1 JSON manifest updated, types updated, tests added. `getBuildClient()` in sdk.ts deprecated/removed after migration.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| XII. No Silent Data Loss | PASS | FR-005/FR-006/FR-007 require visible errors with retry — directly addresses this principle |
| XVIII. Actionable Failure Logs | PASS | Discovery errors must surface actionable messages (FR-005) |
| XIX. PAT Secrecy | PASS | Reuses existing `ArtifactClient` auth pattern; no new token handling. Bearer token from `VSS.getAccessToken()` |
| XX. Least Privilege Default | PASS | No new scopes required; `vso.build` already in manifest covers Build REST API |
| QG-17 through QG-22 | PASS | Lint, type-check, tests, coverage, VSIX build — all enforced by existing CI |
| VR-14 | PASS | VSIX packaging unchanged; only manifest JSON additions |

No constitution violations. No complexity tracking needed.

**Post-design re-check**: PASS. Direct REST calls use the same `vso.build` scope. Auth uses `VSS.getAccessToken()` (already in use by ArtifactClient). No new security surface.

## Technical Approach

### Direct REST API Endpoints

Discovery requires three ADO Build REST API calls, all already available under the `vso.build` scope:

| Operation | REST Endpoint | Current Impl |
|-----------|--------------|--------------|
| List definitions | `GET {collectionUri}{projectId}/_apis/build/definitions?api-version=7.1&$top=50&queryOrder=2` | `buildClient.getDefinitions()` via legacy SDK |
| List builds | `GET {collectionUri}{projectId}/_apis/build/builds?api-version=7.1&definitions={id}&statusFilter=2&resultFilter=6&$top=1` | `buildClient.getBuilds()` via legacy SDK |
| List artifacts | `GET {collectionUri}{projectId}/_apis/build/builds/{buildId}/artifacts?api-version=7.1` | `artifactClient.getArtifacts()` via direct REST (already works) |

### Migration Path

Add `getDefinitions()` and `getBuilds()` to `ArtifactClient`, following the exact same pattern as the existing `getArtifacts()`:

```
ArtifactClient.initialize() → VSS.getWebContext() + VSS.getAccessToken()
ArtifactClient._authenticatedFetch(url) → fetch() with Bearer token
ArtifactClient.getArtifacts(buildId) → already works (direct REST)
ArtifactClient.getDefinitions(top, queryOrder) → NEW (direct REST, same pattern)
ArtifactClient.getBuilds(definitionId, top) → NEW (direct REST, same pattern)
```

Then replace both `discoverPipelines()` in settings.ts and `discoverInsightsPipelines()` in dashboard.ts to use `ArtifactClient` methods instead of `getBuildClient()`.

### What gets removed

- `settings.ts`: Entire `discoverPipelines()` function (80 lines of inline `VSS.require` code)
- `dashboard.ts`: `getBuildClient()` import and usage in `discoverInsightsPipelines()` and `resolveFromPipelineId()`
- `sdk.ts`: `getBuildClient()` export (deprecated, then removed once no callers remain)
- `types.ts`: `VSSBuildClient` interface (replaced by `ArtifactClient` methods with proper types)

## Project Structure

### Documentation (this feature)

```text
specs/026-discovery-refactor-ff-prefix/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── vss-extension-feature-flags.json
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
extension/
├── vss-extension.json                    # MODIFY: Add feature flag contributions + hub constraint
├── ui/
│   ├── settings.ts                       # MODIFY: Replace discoverPipelines() with ArtifactClient calls, add error UI
│   ├── artifact-client.ts                # MODIFY: Add getDefinitions(), getBuilds() methods
│   ├── dashboard.ts                      # MODIFY: Replace getBuildClient() usage with ArtifactClient methods
│   ├── modules/
│   │   └── sdk.ts                        # MODIFY: Remove getBuildClient() export
│   └── types.ts                          # MODIFY: Remove VSSBuildClient interface (no longer needed)
├── tests/
│   ├── dashboard/
│   │   └── settings-download.test.ts     # MODIFY: Update discovery contract tests for new pattern
│   ├── artifact-client.test.ts           # MODIFY: Add tests for getDefinitions(), getBuilds()
│   └── manifest/
│       └── feature-flags.test.ts         # NEW: Manifest feature flag contract tests
└── types/
    └── vss.d.ts                          # MODIFY: Remove IBuildRestClient (no longer needed)
```

**Structure Decision**: Existing extension structure. No new directories except `tests/manifest/` for manifest validation tests. Net reduction in code — the inline discovery function is replaced by thin REST methods on an existing class.

## Complexity Tracking

No constitution violations — section intentionally empty.
