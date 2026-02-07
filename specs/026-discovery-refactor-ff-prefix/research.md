# Research: Discovery Refactor & Feature Flag Prefixes

**Feature**: 026-discovery-refactor-ff-prefix
**Date**: 2026-02-07

## R-001: ADO Extension Feature Flag Mechanism

**Decision**: Use `ms.vss-web.feature` contribution type in `vss-extension.json`.

**Rationale**: This is the only supported mechanism for declaring feature flags that appear in Azure DevOps "Preview Features" panel. The ADO SDK evaluates these at navigation render time — the extension only needs to declare them in the manifest.

**Alternatives considered**:
- Dataset-level feature flags (already used for `predictions`, `ai_insights`): Rejected — these are data-scoped, not UI-navigation-scoped. They don't appear in "Preview Features".
- Custom extension data service flags: Rejected — would require custom UI for toggling, wouldn't integrate with ADO's standard "Preview Features" panel.

**Key details**:
- Contribution format: `{ "id": "gri.dashboard-hub", "type": "ms.vss-web.feature", "properties": { "name": "[GRI] PR Insights Dashboard", "defaultState": false, "userConfigurable": false, "hostConfigurable": true, "hostScopes": ["project", null] } }`
- Hub constraint format: `"constraints": [{ "name": "Feature", "properties": { "featureId": "OddEssentials.ado-git-repo-insights.gri.dashboard-hub" } }]`
- Feature ID in constraints requires fully qualified format: `{publisher}.{extension}.{contribution-id}`
- `hostScopes: ["project", null]` enables both project-level and organization-level toggling
- `userConfigurable: false` prevents individual users from overriding admin decisions
- `hostConfigurable: true` allows org/project admins to toggle

## R-002: Shared Build Client — Contract and Lifecycle

> **Superseded**: Original decision was to use `getBuildClient()` from `modules/sdk.ts`. After two failed fix branches (v5.22.1, v5.22.2) that patched the legacy `TFS/Build/RestClient` usage, the approach was revised to eliminate the legacy SDK entirely.

**Decision**: Add `getDefinitions()` and `getBuilds()` methods to `ArtifactClient`, using the same direct `_authenticatedFetch()` pattern that `getArtifacts()` already uses successfully. Remove `getBuildClient()` from `sdk.ts` entirely.

**Rationale**: The legacy `VSS.require(["TFS/Build/RestClient"])` module system has opaque parameter serialization behavior — `null` values are serialized into query parameters (e.g., `?name=null`) while `undefined` is omitted. This caused settings page discovery to fail silently despite two patches. `ArtifactClient` already uses direct `fetch()` with explicit URL construction, avoiding this class of bugs entirely.

**Alternatives considered**:
- Patching `getBuildClient()` a third time: Rejected — two prior patches (project scope fix, null→undefined fix) both failed in production. The legacy SDK's behavior is opaque and unreliable.
- Using `getBuildClient()` from `modules/sdk.ts` directly: Rejected (original R-002 decision) — the underlying `VSS.require` module has serialization issues that differ between contexts.
- Creating a new `BuildDiscoveryService` class: Rejected — over-engineering. `ArtifactClient` already has the auth and fetch infrastructure.

**Concurrent safety**: `ArtifactClient` is safe for concurrent callers because:
1. `_authenticatedFetch()` is stateless — each call constructs a fresh `fetch()` request.
2. `initialize()` has an early-return guard (`if (this.initialized) return this`) preventing double initialization.
3. Multiple callers sharing the same `ArtifactClient` instance receive independent fetch responses.

## R-003: VSSBuildClient Type Alignment (null vs undefined)

**Decision**: Update `VSSBuildClient` interface in `types.ts` to use `T | undefined` instead of `T | null` for optional parameters, matching `IBuildRestClient` in `vss.d.ts`.

**Rationale**: The root cause of the discovery bug is that `VSSBuildClient` in `types.ts` declares optional params as `T | null`, while the actual VSS SDK REST client (typed as `IBuildRestClient` in `vss.d.ts`) uses `T | undefined`. When callers pass `null`, the SDK serializes it into query parameters (e.g., `?name=null`), causing API failures.

**Impact**:
- `settings.ts` lines 709, 714-727: Currently pass `null` — will be removed entirely (using `getBuildClient()` instead)
- `types.ts` `VSSBuildClient` interface: Update to `| undefined` for parity
- This is a breaking type change but only affects internal code — no public API

**Alternatives considered**:
- Keep `null` in types and convert at call sites: Rejected — defeats the purpose of type safety. The types should match reality.

## R-004: Discovery Error Handling Pattern

**Decision**: Surface discovery errors via inline HTML in the status display area, with a "Retry" link that re-invokes discovery.

**Rationale**: The settings page already uses `renderTrustedHtml()` for status messages. Adding error states with retry follows the established pattern. A dedicated "Retry" button (or link) within the status area is consistent with the existing "Re-discover Pipelines" button pattern.

**Error categories**:
1. **Client initialization failure** (SDK load, auth): Show error with retry in status area
2. **Partial discovery failure** (individual pipeline check fails): Continue with remaining, show warning count
3. **Complete discovery failure** (no results due to all-errors): Show error with retry

**Retry mechanism**: The retry affordance calls `discoverPipelines()` again (or `updateStatus()` for the auto-discovery path). No new infrastructure needed — it's a function re-invocation.

## R-005: Feature Flag Naming Convention

**Decision**: Display name prefix `[GRI] `, internal ID prefix `gri.`.

**Rationale**:
- `[GRI]` (Git Repo Insights) is short, distinctive, and sorts alphabetically near other `[G*]` extensions
- Square brackets are a common convention in ADO extension flags for visual grouping
- `gri.` prefix on IDs follows the `publisher.extension.id` scoping that ADO uses, adding an additional namespace layer for clarity

**Naming rules**:
- Display: `[GRI] <Human Readable Name>` (e.g., `[GRI] PR Insights Dashboard`)
- ID: `gri.<kebab-case>` (e.g., `gri.dashboard-hub`)
- No variations permitted (enforced by manifest contract test)

**Alternatives considered**:
- `[PR Insights]` prefix: Rejected — longer, and the extension name is "Git Repo Insights", not "PR Insights"
- `GRI:` prefix (colon instead of brackets): Rejected — brackets provide better visual distinction in the ADO settings list
