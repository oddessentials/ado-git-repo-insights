# Data Model: Discovery Refactor & Feature Flag Prefixes

**Feature**: 026-discovery-refactor-ff-prefix
**Date**: 2026-02-07

## Entities

### Extension Feature Flag (manifest-declared)

Declared in `vss-extension.json` as a `ms.vss-web.feature` contribution. Not stored in a database — evaluated by Azure DevOps at navigation render time.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Internal identifier. Pattern: `gri.<kebab-case-name>` |
| `type` | string | Always `ms.vss-web.feature` |
| `properties.name` | string | Display name. Pattern: `[GRI] <Human Readable Name>` |
| `properties.defaultState` | boolean | Initial state. `false` = disabled by default |
| `properties.userConfigurable` | boolean | Whether individual users can toggle. `false` for admin-only flags |
| `properties.hostConfigurable` | boolean | Whether org/project admins can toggle. `true` |
| `properties.hostScopes` | array | Scoping levels. `["project", null]` for project + org |

### Hub Constraint (manifest-declared)

Applied to a hub contribution to conditionally show/hide based on feature flag state.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Always `"Feature"` |
| `properties.featureId` | string | Fully qualified: `{publisher}.{extension}.{feature-id}` |

### Discovery Result (runtime, in-memory)

Returned by `discoverPipelines()`. No persistence — computed on each page load.

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Pipeline definition ID |
| `name` | string | Pipeline definition name |
| `buildId` | number | Latest successful build ID with "aggregates" artifact |

### Discovery Error (runtime, in-memory)

Tracked during discovery to support partial-failure reporting (FR-007).

| Field | Type | Description |
|-------|------|-------------|
| `skippedCount` | number | Number of pipelines that could not be checked |
| `error` | string or null | Error message if client initialization failed entirely |

## State Transitions

### Feature Flag Lifecycle

```
Disabled (default) → Admin enables in Preview Features → Enabled → Hub visible
Enabled → Admin disables → Disabled → Hub hidden (next page load)
```

No extension-side state management. Azure DevOps handles all evaluation and persistence.

### Discovery Flow

```
Page Load → ArtifactClient.initialize() → getDefinitions() → [for each: getBuilds() → getArtifacts()]
  ↓ success                                                    ↓ partial failure (skippedCount > 0)
  lastValidation = { valid: true, buildId: N }                 Show warning count + results found
  ↓ complete failure (init error or all pipelines errored)
  Show error + retry affordance
```

## Relationships

- **Feature Flag** → constrains → **Hub Contribution** (1:N — one flag can gate multiple hubs)
- **Discovery Result** → populates → **lastValidation** (1:1 — first match used)
- **Dataset Feature Flags** — independent scope — **Extension Feature Flags** (no relationship)
