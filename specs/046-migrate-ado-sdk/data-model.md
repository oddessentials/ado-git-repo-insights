# Data Model: Migrate from vss-web-extension-sdk to azure-devops-extension-sdk

**Branch**: `046-migrate-ado-sdk` | **Date**: 2026-03-30

## Overview

This migration does not introduce new data entities. It changes the **access layer** for existing entities. The data stored in Azure DevOps Extension Data Service remains unchanged — both SDKs use the same underlying REST API.

## Entity: SDK Abstraction Layer (sdk.ts)

The abstraction layer's **public interface** is unchanged. The **internal implementation** changes.

### Public Interface (preserved)

```
SdkInitOptions
├── timeout?: number         (default 10000ms)
└── onReady?: () => void     (called between ready and notifyLoadSucceeded)

Functions:
├── initializeAdoSdk(options?: SdkInitOptions) → Promise<void>
├── getExtensionDataService() → Promise<IExtensionDataManager>  [return type change: was IExtensionDataService]
├── getWebContext() → WebContext | undefined
├── isSdkInitialized() → boolean
├── resetSdkState() → void
├── isLocalMode() → boolean
└── getLocalDatasetPath() → string
```

### Internal Mapping (old ��� new)

```
VSS.init(options)                        → SDK.init({ loaded: false })
VSS.ready(callback)                      → await SDK.ready(); callback()
VSS.notifyLoadSucceeded()                → await SDK.notifyLoadSucceeded()
VSS.getWebContext()                       → SDK.getWebContext()
VSS.getAccessToken() → { token: string } → SDK.getAccessToken() → string
VSS.getService(VSS.ServiceIds.ExtensionData) → SDK.getService(CommonServiceIds.ExtensionDataService)
  └── direct getValue/setValue           → .getExtensionDataManager(id, token) → manager.getValue/setValue
```

## Entity: Extension Data Manager

Replaces the old direct `IExtensionDataService` with `IExtensionDataManager` (from `azure-devops-extension-api`).

### Method Surface (IExtensionDataManager)

| Method | Parameters | Returns | Used in Project |
|--------|-----------|---------|----------------|
| `getValue<T>` | `key: string, documentOptions?: IDocumentOptions` | `Promise<T>` | Yes — settings read |
| `setValue<T>` | `key: string, value: T, documentOptions?: IDocumentOptions` | `Promise<T>` | Yes — settings write |
| `getDocument` | `collection: string, id: string, options?` | `Promise<any>` | No (available in mock) |
| `setDocument` | `collection: string, doc: any, options?` | `Promise<any>` | No (available in mock) |
| `createDocument` | `collection: string, doc: any, options?` | `Promise<any>` | No (available in mock) |
| `deleteDocument` | `collection: string, id: string, options?` | `Promise<void>` | No (available in mock) |
| `getDocuments` | `collection: string, options?` | `Promise<any[]>` | No (available in mock) |
| `queryCollections` | `collections: ExtensionDataCollection[]` | `Promise<ExtensionDataCollection[]>` | No |

**Scope options**: `IDocumentOptions` replaces the old `{ scopeType, scopeValue }` pattern. Default scope is account-wide.

## Entity: Authentication Token

| Property | Old SDK | New SDK |
|----------|---------|---------|
| Function | `VSS.getAccessToken()` | `SDK.getAccessToken()` |
| Return type | `Promise<{ token: string }>` | `Promise<string>` |
| Usage | `result.token` or `typeof` guard | Direct string value |
| Scope | User-delegated (Bearer token) | User-delegated (Bearer token) |

`getAppToken()` exists in both SDKs but is **not used** and must remain unused per FR-003.

## Entity: WebContext

| Field | Old SDK (VSS.WebContext) | New SDK (IWebContext) | Used |
|-------|------------------------|----------------------|------|
| `project.id` | Yes | Verify at implementation | Yes |
| `project.name` | Yes | Verify at implementation | Yes |
| `collection.uri` | Yes | Verify at implementation | Yes (artifact-client) |
| `account.*` | Yes | May map to `getHost()` | No |
| `user.*` | Yes | May map to `getUser()` | No |
| `team.*` | Yes | May map to `getTeamContext()` | No |
| `host.*` | Yes | May map to `getHost()` | No |

Fallback plan: if `IWebContext` shape differs, compose from `getHost()`, `getUser()`, `getTeamContext()` inside `sdk.ts`.

## Entity: CoreRestClient (Project Listing)

| Aspect | Old Pattern | New Pattern |
|--------|------------|-------------|
| Loading | `VSS.require(["TFS/Core/RestClient"], cb)` | `import { CoreRestClient } from "azure-devops-extension-api/Core"` |
| Instantiation | `CoreRestClient.getClient()` | `getClient(CoreRestClient)` from `azure-devops-extension-api` |
| Method | `client.getProjects()` | `client.getProjects()` → `Promise<PagedList<TeamProjectReference>>` |
| Result shape | `{ name, id }` | `TeamProjectReference { name, id, state, description, url }` — compatible superset |

## Storage Format Compatibility

Both SDKs use the same REST endpoint under the hood:
```
_apis/ExtensionManagement/InstalledExtensions/{publisher}/{extension}/Data/Scopes/.../Collections/$settings/Documents
```

Settings documents have the shape `{ id: key, __etag: -1, value: <stored_value> }`. This format is SDK-independent. Settings saved by the old SDK are readable by the new SDK without migration.
