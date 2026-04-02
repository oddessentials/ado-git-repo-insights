# Contract: SDK Abstraction Layer (sdk.ts)

**Branch**: `046-migrate-ado-sdk` | **Date**: 2026-03-30

## Purpose

The SDK abstraction layer (`extension/ui/modules/sdk.ts`) is the **sole point of contact** between the extension code and the Azure DevOps host SDK. All production modules (dashboard.ts, settings.ts, artifact-client.ts) call this module — never the SDK directly.

This contract defines what sdk.ts exposes. The migration MUST preserve this interface per FR-007.

## Public Interface

### Types

```typescript
export interface SdkInitOptions {
  /** Initialization timeout in milliseconds. Default: 10000 */
  timeout?: number;
  /** Called after SDK reports ready, before notifyLoadSucceeded */
  onReady?: () => void;
}
```

### Functions

| Function | Signature | Pre-Migration | Post-Migration | Notes |
|----------|-----------|--------------|----------------|-------|
| `initializeAdoSdk` | `(options?: SdkInitOptions) => Promise<void>` | Same | Same | Idempotent. Timeout-protected. |
| `getExtensionDataService` | `() => Promise<DataService>` | Returns `IExtensionDataService` | Returns `IExtensionDataManager` | **Return type changes** but both expose `getValue<T>()`/`setValue<T>()` |
| `getWebContext` | `() => WebContext \| undefined` | Returns `VSS.WebContext` | Returns compatible shape | Undefined if SDK not initialized |
| `isSdkInitialized` | `() => boolean` | Same | Same | |
| `resetSdkState` | `() => void` | Same | Same | Test utility only |
| `isLocalMode` | `() => boolean` | Same | Same | Reads `window.LOCAL_DASHBOARD_MODE` |
| `getLocalDatasetPath` | `() => string` | Same | Same | Reads `window.DATASET_PATH`, defaults `'./dataset'` |

### Consumer Contract

Consumers depend on the following behaviors:

1. **Initialization**: `initializeAdoSdk()` can be called multiple times safely (idempotent). Only the first call performs actual SDK initialization.
2. **Sequence**: init → ready → onReady callback → notifyLoadSucceeded. This order is invariant (FR-014).
3. **Timeout**: If init/ready does not complete within `timeout` ms, the Promise rejects with `"Azure DevOps SDK initialization timed out"`.
4. **Data service**: `getExtensionDataService()` returns an object with at minimum `getValue<T>(key, options?)` and `setValue<T>(key, value, options?)`.
5. **Web context**: Returns `undefined` before initialization, a context object with `project.id`, `project.name`, `collection.uri` after.
6. **Auth tokens**: Consumers that need auth tokens call `SDK.getAccessToken()` directly (not through sdk.ts). Post-migration, this returns `string` (not `{ token: string }`). The artifact-client must be updated.

### Breaking Change for Consumers

The only consumer-visible breaking change is the **auth token format**:

| Consumer | Old | New | Action |
|----------|-----|-----|--------|
| `artifact-client.ts` | `result.token` or `typeof` guard | Direct `string` | Remove `.token` extraction |

All other changes are absorbed inside `sdk.ts`.

## Mock Contract

The test mock harness must provide:

1. All public functions listed above as Jest mocks
2. `init()`/`ready()`/`notifyLoadSucceeded()` resolve synchronously in tests
3. Configurable mock web context, settings values, builds
4. Preset scenarios: valid/invalid/missing settings, error handling
5. `getAccessToken()` returns `string` (not `{ token: string }`)
6. `getService()` returns mock data service → mock data manager chain
7. `getClient(CoreRestClient)` returns mock with `getProjects()`

## Verification

- Unit test in `sdk.test.ts` verifies init → ready → notifyLoadSucceeded sequence (FR-014)
- Unit test verifies `getAccessToken()` returns string, not object (FR-003)
- Build-time assertion verifies zero `vss-web-extension-sdk` references (FR-015)
- Runtime smoke test verifies bundled SDK initializes (FR-015)
