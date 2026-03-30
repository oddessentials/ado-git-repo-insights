# Research: Migrate from vss-web-extension-sdk to azure-devops-extension-sdk

**Branch**: `046-migrate-ado-sdk` | **Date**: 2026-03-30

## R-01: API Function Mapping (Old → New)

**Decision**: Map all 7 VSS functions to their exact new-SDK equivalents.

**Rationale**: The new SDK provides 1:1 equivalents for every function we use, but with different signatures. The abstraction layer (`sdk.ts`) must absorb these differences.

| Old SDK (global `VSS.*`) | New SDK (imports from `azure-devops-extension-sdk`) | Signature Change |
|---|---|---|
| `VSS.init(options)` → `void` | `SDK.init(options?)` → `Promise<void>` | Now async; returns Promise |
| `VSS.ready(callback)` → `void` | `SDK.ready()` → `Promise<void>` | No callback param; returns Promise |
| `VSS.notifyLoadSucceeded()` → `void` | `SDK.notifyLoadSucceeded()` → `Promise<void>` | Now async; returns Promise |
| `VSS.getWebContext()` → `WebContext` | `SDK.getWebContext()` → `IWebContext` | Interface name change; verify shape |
| `VSS.getAccessToken()` → `Promise<{ token: string }>` | `SDK.getAccessToken()` → `Promise<string>` | **BREAKING**: Returns string, not `{ token }` |
| `VSS.getService<T>(id)` → `Promise<T>` | `SDK.getService<T>(id)` → `Promise<T>` | Same signature; different service ID enum |
| `VSS.require(modules, cb)` → `void` | N/A — replaced by ESM imports | See R-03 |

**Alternatives considered**: None — the new SDK is Microsoft's official replacement.

---

## R-02: Data Service Indirection Change

**Decision**: Absorb the two-step data service access pattern inside `sdk.ts`.

**Rationale**: The old SDK returned `IExtensionDataService` with direct `getValue()`/`setValue()` methods. The new SDK introduces an indirection layer:

```typescript
// Old pattern (direct)
const dataService = await VSS.getService<IExtensionDataService>(VSS.ServiceIds.ExtensionData);
await dataService.getValue("key");

// New pattern (two-step: service → manager)
import * as SDK from "azure-devops-extension-sdk";
import { CommonServiceIds, IExtensionDataService } from "azure-devops-extension-api";

const dataService = await SDK.getService<IExtensionDataService>(CommonServiceIds.ExtensionDataService);
const dataManager = await dataService.getExtensionDataManager(
  SDK.getExtensionContext().id,
  await SDK.getAccessToken()
);
await dataManager.getValue<string>("key");
```

The `IExtensionDataManager` interface provides the same methods our code uses: `getValue<T>()`, `setValue<T>()`, `getDocument()`, `setDocument()`, `createDocument()`, `deleteDocument()`, `getDocuments()`, `queryCollections()`.

**Key change**: The `getExtensionDataService()` function in `sdk.ts` must now return an `IExtensionDataManager` (not `IExtensionDataService`) to preserve the direct `getValue`/`setValue` consumer API. This is an internal change — callers still call `getExtensionDataService()` and get something with `getValue`/`setValue`.

**Storage compatibility**: Both SDKs use the same underlying REST API (`_apis/ExtensionManagement/InstalledExtensions/.../Data/...`). Settings are stored as documents in the `$settings` collection. The storage format is identical — no data migration needed.

**Alternatives considered**: Exposing the two-step pattern to consumers. Rejected because it would require changes to every call site (dashboard.ts, settings.ts) and violate FR-007 (preserve public interface).

---

## R-03: AMD Module Loading Replacement

**Decision**: Replace `VSS.require(["TFS/Core/RestClient"])` with a direct authenticated REST call to `_apis/projects`.

**Rationale**: The old SDK used AMD (RequireJS) module loading for ADO REST clients. The initial plan was to replace the AMD call with an ESM import of `CoreRestClient` from `azure-devops-extension-api`:

```typescript
// Old pattern (AMD)
VSS.require(["TFS/Core/RestClient"], (CoreRestClient) => {
  const client = CoreRestClient.getClient();
  const projects = await client.getProjects();
});

// Initially planned pattern (ESM import + getClient)
import { CoreRestClient } from "azure-devops-extension-api/Core";
import { getClient } from "azure-devops-extension-api";

const client = getClient(CoreRestClient);
const projects = await client.getProjects();
```

**AMD Incompatibility Finding**: During implementation, `azure-devops-extension-api`'s runtime JavaScript (`CoreClient.js`, `RestClientBase.js`, etc.) was found to ship as AMD modules only. When esbuild bundles these into an IIFE, the `define()` calls fail at runtime because no AMD loader is present in the IIFE context. This makes the package's REST client classes unusable at runtime in this project's bundling architecture. The package's TypeScript type declarations (`.d.ts` files) are unaffected and remain usable via `import type`.

**Actual implementation**: `settings.ts` calls the Azure DevOps Projects REST API directly using `fetch()` with a Bearer token obtained from `SDK.getAccessToken()`:

```typescript
const url = `${collectionUri}_apis/projects?api-version=7.1&$top=500`;
const response = await fetch(url, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
});
const data = await response.json();
// Runtime guard validates only the fields actually consumed (id, name)
```

This approach is consistent with `ArtifactClient`, which already uses direct REST calls for build and artifact endpoints. The `azure-devops-extension-api` package is retained as a devDependency for its type declarations (e.g., `TeamProjectReference`, `CommonServiceIds`, `IExtensionDataService`) but its runtime JavaScript is never imported.

**Impact**: `settings.ts` `getOrganizationProjects()` is the only call site. The response shape (`{ value: TeamProjectReference[] }`) is validated at runtime with a narrow type guard that checks only `id` and `name`.

**Alternatives considered**:
1. Using `CoreRestClient` via ESM import + `getClient()`. Rejected because the package ships AMD-only JS incompatible with esbuild + IIFE bundling.
2. Using `IProjectPageService` from `CommonServiceIds.ProjectPageService`. Rejected because it provides current-project info only, not a list of all projects.
3. Shimming an AMD `define()` function into the IIFE bundle. Rejected as fragile and complex for a single REST call that is trivial to make directly.

---

## R-04: Token Format Breaking Change

**Decision**: Update `artifact-client.ts` to handle the new string return type.

**Rationale**: The old SDK returned `{ token: string }` from `getAccessToken()`. The new SDK returns `string` directly.

```typescript
// Old pattern
const result = await VSS.getAccessToken();
const token = typeof result === "string" ? result : result.token;

// New pattern
const token: string = await SDK.getAccessToken();
```

The abstraction layer should normalize this so consumers always get a plain string. This aligns with FR-003 (use `getAccessToken()`, not `getAppToken()`).

**Alternatives considered**: Adding a compatibility shim that wraps the result in `{ token }`. Rejected — simpler to update the 1 consumer (artifact-client.ts line 60) directly.

---

## R-05: Initialization Sequence (Promise-based)

**Decision**: Rewrite `initializeAdoSdk()` to use the Promise-based init/ready pattern while preserving idempotency and timeout.

**Rationale**: The old pattern was callback-based:
```typescript
VSS.init({ explicitNotifyLoaded: true, ... });
VSS.ready(() => {
  // ready callback
  VSS.notifyLoadSucceeded();
});
```

The new pattern is Promise-based:
```typescript
await SDK.init({ loaded: false });  // loaded: false = explicit notify
await SDK.ready();
await SDK.notifyLoadSucceeded();
```

Note the option name change: `explicitNotifyLoaded: true` → `loaded: false` (inverted semantics). The `usePlatformScripts`/`usePlatformStyles` options do not exist in the new SDK — they were AMD loader hints no longer needed with ESM bundling.

The `onReady` callback from `SdkInitOptions` maps to the point between `ready()` resolving and `notifyLoadSucceeded()` being called. Timeout protection wraps the entire init→ready sequence with `Promise.race`.

**Alternatives considered**: Removing timeout protection since init() is now Promise-based with its own rejection. Rejected — the host may hang without rejecting, so our timeout is a safety net.

---

## R-06: Bundling Strategy

**Decision**: Bundle the new SDK into each IIFE entry point via esbuild. Remove the separate script tag.

**Rationale**: The old SDK was loaded as a separate `<script src="VSS.SDK.min.js">` tag because it was an AMD/UMD library that established the global `VSS` namespace. The new SDK is an ESM package designed for bundler consumption.

Changes required:
1. **HTML files**: Remove `<script src="VSS.SDK.min.js">` from `index.html` and `settings.html`.
2. **bundle-ui.mjs**: Remove `VSS.SDK.min.js` from static file list. The SDK is now imported in source and bundled by esbuild automatically (externals is already `[]`).
3. **copy-vss-sdk.mjs**: Delete entirely — no SDK file to copy.
4. **package.json**: Remove `postinstall` hook that ran copy-vss-sdk.mjs.

esbuild will tree-shake the SDK imports, including only the functions actually used. Format remains IIFE with `globalName` exports — no change to the HTML loading pattern for app bundles.

**Alternatives considered**: Loading the new SDK via a separate `<script type="module">` tag. Rejected — bundling is simpler, reduces network requests (FR-006/SC-006), and the new SDK is designed for this pattern.

---

## R-07: Service ID Enum Migration

**Decision**: Replace `VSS.ServiceIds.ExtensionData` with `CommonServiceIds.ExtensionDataService` from `azure-devops-extension-api`.

**Rationale**: The old SDK used `VSS.ServiceIds.ExtensionData` (string value: `"ms.vss-web.data-service"`). The new SDK exports `CommonServiceIds` enum from `azure-devops-extension-api`:

```typescript
import { CommonServiceIds, IExtensionDataService } from "azure-devops-extension-api";
const svc = await SDK.getService<IExtensionDataService>(CommonServiceIds.ExtensionDataService);
```

Available `CommonServiceIds` values:
- `ExtensionDataService` — extension data storage
- `GlobalMessagesService` — message banners
- `HostNavigationService` — URL/navigation
- `HostPageLayoutService` — dialogs/panels
- `LocationService` — URL resolution
- `ProjectPageService` — current project info

Only `ExtensionDataService` is used in this project.

**Alternatives considered**: Hard-coding the string ID. Rejected — the enum is type-safe and the canonical import path.

---

## R-08: WebContext Interface Compatibility

**Decision**: Verify `getWebContext()` return shape at implementation time; map through a compatibility type if needed.

**Rationale**: The old `VSS.WebContext` had: `account`, `collection`, `project`, `team`, `user`, `host`. The new SDK's `getWebContext()` returns `IWebContext` (type not fully documented). However, the SDK also provides dedicated accessors:
- `SDK.getHost()` → `IHostContext` (org info)
- `SDK.getUser()` → `IUserContext` (user info)
- `SDK.getTeamContext()` → `ITeamContext` (team info)

Current usage in our code: `getWebContext().project.id`, `getWebContext().project.name`, `getWebContext().collection.uri`, `getWebContext().user`. If `IWebContext` matches the old shape, no mapping needed. If not, `sdk.ts` can compose from the dedicated accessors.

**Alternatives considered**: Switching all call sites to use `getHost()`, `getUser()` etc. Rejected — too many call sites; the abstraction should handle this.

---

## R-09: Type Declaration Strategy

**Decision**: Delete `types/vss.d.ts` and use types exported by both new packages.

**Rationale**: `azure-devops-extension-sdk` ships its own TypeScript declarations for `init()`, `ready()`, `getAccessToken()`, `getWebContext()`, etc. `azure-devops-extension-api` ships declarations for `CommonServiceIds`, `IExtensionDataService`, `IExtensionDataManager`, `CoreRestClient`, `TeamProjectReference`, etc.

The custom `types/vss.d.ts` declaring the global `VSS` namespace becomes unnecessary. Removing it satisfies FR-009 and SC-007.

The `tsconfig.json` `typeRoots` entry pointing to `../types` can be cleaned up if `vss.d.ts` was the only file there. Check for other `.d.ts` files before removing the path.

**Alternatives considered**: Keeping a thin compatibility type file. Rejected — the SDK provides complete types.

---

## R-10: Mock Harness Rewrite Strategy

**Decision**: Rewrite `vss-sdk-mock.ts` to mock the new SDK's module exports instead of the global `VSS` namespace.

**Rationale**: The old mock attached functions to `global.VSS`. The new SDK uses ESM imports (`import * as SDK from "azure-devops-extension-sdk"`). Jest can mock ESM modules via `jest.mock("azure-devops-extension-sdk")`.

The mock must provide:
1. `init()` → resolves immediately
2. `ready()` → resolves immediately
3. `notifyLoadSucceeded()` → resolves immediately
4. `getWebContext()` → returns mock context
5. `getAccessToken()` → returns mock token string (not `{ token }`)
6. `getService()` → returns mock data service (which returns mock data manager)
7. `getExtensionContext()` → returns `{ id: "publisher.extension" }`
8. `getHost()`, `getUser()`, `getTeamContext()` → mock context accessors

Additionally, mock `azure-devops-extension-api`:
1. `CommonServiceIds.ExtensionDataService` → mock string
2. `getClient(CoreRestClient)` → mock client with `getProjects()`
3. `IExtensionDataService.getExtensionDataManager()` → returns mock manager
4. Mock `IExtensionDataManager` with `getValue`/`setValue`/document methods

The existing preset scenarios (`mockValidDashboardSettings`, etc.) and configuration helpers must be preserved with updated internals.

**Alternatives considered**: Minimal mock that only covers current test paths. Rejected — the comprehensive mock harness prevents regression in future features.
