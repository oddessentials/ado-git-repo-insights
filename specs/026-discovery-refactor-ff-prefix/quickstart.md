# Quickstart: Discovery Refactor & Feature Flag Prefixes

**Feature**: 026-discovery-refactor-ff-prefix

## Prerequisites

- Node.js 22+, pnpm 9.15+
- Extension development environment (`cd extension && pnpm install`)

## Implementation Order

### Step 1: Add getDefinitions() and getBuilds() to ArtifactClient

Add two new methods to `extension/ui/artifact-client.ts`, following the exact same pattern as `getArtifacts()`:

1. `getDefinitions(top?: number, queryOrder?: number)` — calls `GET {collectionUri}{projectId}/_apis/build/definitions?api-version=7.1&$top={top}&queryOrder={queryOrder}`
2. `getBuilds(definitionId: number, top?: number)` — calls `GET {collectionUri}{projectId}/_apis/build/builds?api-version=7.1&definitions={id}&statusFilter=2&resultFilter=6&$top={top}`

Both use `_authenticatedFetch()` and return typed arrays.

```bash
cd extension && pnpm run build:ui  # Verify type compatibility
```

### Step 2: Add ArtifactClient tests for new methods

Add tests to `extension/tests/artifact-client.test.ts` for `getDefinitions()` and `getBuilds()`, mocking `_authenticatedFetch()`.

```bash
cd extension && pnpm test -- --testPathPatterns artifact-client
```

### Step 3: Replace discoverPipelines() in settings.ts

Replace the inline `VSS.require(["TFS/Build/RestClient"])` block with calls to `ArtifactClient.getDefinitions()`, `ArtifactClient.getBuilds()`, and `ArtifactClient.getArtifacts()`:

1. Import `ArtifactClient` (already imported in settings.ts for download)
2. Use the existing `ArtifactClient` instance (or create one with `targetProjectId`)
3. Call `getDefinitions()` → loop through results → `getBuilds()` → `getArtifacts()` → find "aggregates"
4. Add error handling: catch client init failures and return an error state
5. Track `skippedCount` for partial failures during pipeline iteration

```bash
cd extension && pnpm run build:ui && pnpm test
```

### Step 4: Add discovery error UI in settings.ts

In `updateStatus()` and `runDiscovery()`:

1. Catch errors from `discoverPipelines()` and display them in the status area
2. Add a "Retry" link/button that re-invokes the discovery function
3. Show partial-failure warnings (e.g., "Found 2 pipelines; 1 could not be checked")

```bash
cd extension && npx eslint ui/settings.ts && pnpm test
```

### Step 5: Replace getBuildClient() usage in dashboard.ts

Replace `getBuildClient()` calls in `discoverInsightsPipelines()` and `resolveFromPipelineId()` with `ArtifactClient` methods:

1. Use the existing `artifactClient` instance already initialized in the dashboard
2. Replace `buildClient.getDefinitions()` → `artifactClient.getDefinitions()`
3. Replace `buildClient.getBuilds()` → `artifactClient.getBuilds()`
4. Remove `getBuildClient()` import

```bash
cd extension && pnpm run build:ui && pnpm test
```

### Step 6: Remove legacy SDK code

1. Remove `getBuildClient()` export from `extension/ui/modules/sdk.ts`
2. Remove `VSSBuildClient` interface from `extension/ui/types.ts`
3. Remove `IBuildRestClient` from `extension/types/vss.d.ts`

```bash
cd extension && pnpm run build:ui && pnpm test
```

### Step 7: Add feature flag to vss-extension.json

Add the `gri.dashboard-hub` feature flag contribution and the constraint on `pr-insights-hub`:

```bash
cd extension && pnpm run build:ui  # Verify VSIX builds
```

### Step 8: Add manifest contract tests

Create `extension/tests/manifest/feature-flags.test.ts` to validate:

1. All feature flags use `[GRI] ` display name prefix
2. All feature flag IDs use `gri.` prefix
3. Dashboard hub has correct constraint referencing the feature flag
4. Settings hub has no feature flag constraint (always visible)
5. Pipeline task has no feature flag constraint (always functional)

```bash
cd extension && pnpm test
```

## Verification

```bash
# Full verification
cd extension && pnpm run build:ui && npx eslint ui/settings.ts ui/artifact-client.ts ui/dashboard.ts && pnpm test

# Verify no legacy Build REST client usage remains
grep -r "VSS.require.*TFS/Build/RestClient" extension/ui/ --include="*.ts"
# Expected: NO matches (legacy SDK fully eliminated)

grep -r "getBuildClient" extension/ui/ --include="*.ts"
# Expected: NO matches (function removed)
```

## What NOT to change

- `extension/ui/dataset-loader.ts` — Dataset-level feature flags (`predictions`, `ai_insights`) are independent and must not be modified.
- `extension/ui/artifact-client.ts` existing methods — `getArtifacts()`, `getArtifactFile()`, etc. remain unchanged. Only new methods are added.
