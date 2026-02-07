# Tasks: Discovery Refactor & Feature Flag Prefixes

**Input**: Design documents from `/specs/026-discovery-refactor-ff-prefix/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Test tasks are included — the spec defines contract tests for feature flags and the plan calls for ArtifactClient method tests and updated discovery contract tests.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: No new project setup required — existing extension structure is used. This phase verifies the environment and creates the branch.

- [ ] T001 Verify build and test baseline: run `cd extension && pnpm run build:ui && pnpm test` and confirm all pass on current main

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add `getDefinitions()` and `getBuilds()` methods to `ArtifactClient` — these are required by both US1 (settings refactor) and for the dashboard migration. Must complete before any user story work.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Types

- [ ] T002 [P] Add `BuildDefinitionReference` type (fields: `id: number`, `name: string`) to `extension/ui/types.ts` — used by `getDefinitions()` return type
- [ ] T003 [P] Add `Build` type (fields: `id: number`, `definition: { id: number; name: string }`, `status: number`, `result: number`) to `extension/ui/types.ts` — used by `getBuilds()` return type

### ArtifactClient Methods

- [ ] T004 Add `getDefinitions(top?: number, queryOrder?: number)` method to `extension/ui/artifact-client.ts` — direct REST call to `GET {collectionUri}{projectId}/_apis/build/definitions?api-version=7.1&$top={top}&queryOrder={queryOrder}`, following the same `_authenticatedFetch()` pattern as `getArtifacts()`. Return `BuildDefinitionReference[]`. Handle 401/403 with `createPermissionDeniedError()`
- [ ] T005 Add `getBuilds(definitionId: number, top?: number)` method to `extension/ui/artifact-client.ts` — direct REST call to `GET {collectionUri}{projectId}/_apis/build/builds?api-version=7.1&definitions={definitionId}&statusFilter=2&resultFilter=6&$top={top}`, following the same pattern. Return `Build[]`. Handle 401/403 with `createPermissionDeniedError()`
- [ ] T005a Add `getDefinitions()` and `getBuilds()` methods to `MockArtifactClient` in `extension/ui/artifact-client.ts` — follow the same mock pattern as `getArtifacts()`, using keyed mock data lookup. This ensures test consumers can mock the new discovery methods

### ArtifactClient Tests

- [ ] T006 [P] Add tests for `getDefinitions()` in `extension/tests/artifact-client.test.ts` — mock `_authenticatedFetch()` to verify correct URL construction (including query params), response parsing (`data.value`), and 401/403 error handling
- [ ] T007 [P] Add tests for `getBuilds()` in `extension/tests/artifact-client.test.ts` — mock `_authenticatedFetch()` to verify correct URL construction (definitionId, statusFilter=2, resultFilter=6), response parsing, and error handling

### Verification

- [ ] T008 Run `cd extension && pnpm run build:ui && pnpm test` to confirm all types compile and new tests pass

**Checkpoint**: ArtifactClient now has `getDefinitions()`, `getBuilds()`, and `getArtifacts()` — a complete direct REST client for all Build API operations.

---

## Phase 3: User Story 1 — Settings pipeline discovery works reliably (Priority: P1) 🎯 MVP

**Goal**: Replace the inline `VSS.require(["TFS/Build/RestClient"])` discovery in settings.ts with `ArtifactClient` direct REST calls. Add visible error handling with retry. Ensure settings discovery returns identical results to the dashboard.

**Independent Test**: Clear saved pipeline settings, open settings page, verify "Re-discover Pipelines" finds the same pipelines the dashboard finds. Verify error/retry UI on failure.

### Implementation

- [ ] T009 [US1] Rewrite `discoverPipelines()` in `extension/ui/settings.ts` — remove the entire inline `VSS.require(["TFS/Build/RestClient"])` block (~80 lines). Replace with: create a new `ArtifactClient(targetProjectId)` instance (since the constructor binds projectId, a separate instance is needed for cross-project discovery), call `initialize()`, then `getDefinitions()` → loop → `getBuilds()` → `getArtifacts()` → find "aggregates" artifact. Return `Array<{ id: number; name: string; buildId: number }>`. Track `skippedCount` for partial failures (FR-007). On complete failure (client init error), return `{ error: string }` or throw with actionable message (FR-005)
- [ ] T010 [US1] Update `discoverPipelines()` return type in `extension/ui/settings.ts` to include error/partial-failure information — add `DiscoveryResult` type with `{ pipelines: Array<{ id: number; name: string; buildId: number }>; skippedCount: number; error?: string }` per data-model.md
- [ ] T011 [US1] Add discovery error UI in `updateStatus()` in `extension/ui/settings.ts` — when `discoverPipelines()` returns an error, render visible error message in the status area using `renderTrustedHtml()`. Add a "Retry" link that re-invokes `updateStatus()` (FR-005, FR-006). When `skippedCount > 0`, show warning like "Found N pipelines; M could not be checked" (FR-007)
- [ ] T012 [US1] Add discovery error UI in `runDiscovery()` in `extension/ui/settings.ts` — same error/retry pattern as `updateStatus()` for the "Re-discover Pipelines" button path

### Tests

- [ ] T013 [P] [US1] Update discovery contract tests in `extension/tests/dashboard/settings-download.test.ts` — update `updateStatusAutoDiscoveryContract()` to model the new ArtifactClient-based discovery pattern instead of the legacy `getBuildClient()` pattern. Verify error result produces disabled download button
- [ ] T014 [P] [US1] Add partial-failure contract test in `extension/tests/dashboard/settings-download.test.ts` — model scenario where `skippedCount > 0` and verify warning message is included in status output

### Verification

- [ ] T015 [US1] Run `cd extension && pnpm run build:ui && npx eslint ui/settings.ts && pnpm test` and confirm all pass. Verify no `VSS.require.*TFS/Build/RestClient` remains in `extension/ui/settings.ts`

**Checkpoint**: Settings page discovery now uses ArtifactClient direct REST — same mechanism as the dashboard. Error handling with retry is in place.

---

## Phase 4: User Story 1 continued — Dashboard migration & legacy cleanup (Priority: P1)

**Goal**: Migrate dashboard.ts from `getBuildClient()` to `ArtifactClient` methods, then remove all legacy SDK code. This completes the full elimination of `TFS/Build/RestClient`.

**Independent Test**: Dashboard discovers and loads pipelines normally. No `getBuildClient()` or `VSS.require.*TFS/Build/RestClient` calls remain anywhere in `extension/ui/`.

### Implementation

- [ ] T016 [US1] Replace `getBuildClient()` usage in `discoverInsightsPipelines()` in `extension/ui/dashboard.ts` — use the existing `artifactClient` instance. Replace `buildClient.getDefinitions()` → `artifactClient.getDefinitions()` and `buildClient.getBuilds()` → `artifactClient.getBuilds()`. Remove `getBuildClient` import
- [ ] T017 [US1] Replace `getBuildClient()` usage in `resolveFromPipelineId()` in `extension/ui/dashboard.ts` — use `artifactClient.getBuilds()` instead of `buildClient.getBuilds()`

### Legacy Removal

- [ ] T018 [US1] Remove `getBuildClient()` export from `extension/ui/modules/sdk.ts` — function is no longer called by any module
- [ ] T019 [P] [US1] Remove `VSSBuildClient` interface from `extension/ui/types.ts` — replaced by typed `ArtifactClient` methods with `BuildDefinitionReference` and `Build` types
- [ ] T020 [P] [US1] Remove `IBuildRestClient` type from `extension/types/vss.d.ts` — no longer referenced after `getBuildClient()` removal

### Verification

- [ ] T021 [US1] Run `cd extension && pnpm run build:ui && pnpm test`. Grep for `getBuildClient` and `VSS.require.*TFS/Build/RestClient` across `extension/ui/` — expect zero matches (SC-006)

**Checkpoint**: Legacy `TFS/Build/RestClient` SDK is fully eliminated. All Build API access goes through ArtifactClient direct REST.

---

## Phase 5: User Story 2 & 3 — Feature flags with [GRI] prefix and dashboard toggle (Priority: P2)

**Goal**: Add the `gri.dashboard-hub` feature flag to the extension manifest with `[GRI]` prefix naming. Gate the dashboard hub behind this flag (defaults to disabled). Settings page and pipeline task remain unaffected.

**Independent Test**: Install extension, open "Preview Features" — see `[GRI] PR Insights Dashboard` flag. When disabled (default), dashboard hub is hidden. When enabled, dashboard hub appears. Settings page always visible.

### Implementation

- [ ] T022 [US2] [US3] Add `gri.dashboard-hub` feature flag contribution to `extension/vss-extension.json` — type `ms.vss-web.feature`, properties: `name: "[GRI] PR Insights Dashboard"`, `defaultState: false`, `userConfigurable: false`, `hostConfigurable: true`, `hostScopes: ["project", null]`. Match contract in `contracts/vss-extension-feature-flags.json`
- [ ] T023 [US3] Add `constraints` array to the `pr-insights-hub` contribution in `extension/vss-extension.json` — add `{ "name": "Feature", "properties": { "featureId": "OddEssentials.ado-git-repo-insights.gri.dashboard-hub" } }`. Do NOT add constraints to `pr-insights-settings` or the pipeline task contribution (FR-013)

### Tests

- [ ] T024 [P] [US2] [US3] Create manifest contract tests in `extension/tests/manifest/feature-flags.test.ts` — read `vss-extension.json`, validate: (1) all `ms.vss-web.feature` contributions have `[GRI] ` display name prefix (FR-008, FR-009), (2) all feature flag IDs start with `gri.` (FR-010), (3) `pr-insights-hub` has a constraint referencing the feature flag with correct fully-qualified featureId, (4) `pr-insights-settings` has NO feature flag constraint (FR-013), (5) pipeline task contribution has NO feature flag constraint (FR-013), (6) `gri.dashboard-hub` has `defaultState: false` (FR-012), (7) `hostScopes` includes both `"project"` and `null` (FR-014)
- [ ] T025 [P] [US2] Add naming rule validation test in `extension/tests/manifest/feature-flags.test.ts` — verify no feature flag display name uses prohibited prefixes from contract (`"PR Insights:"`, `"GRI:"`, `"GRI -"`, `"Git Repo Insights:"`)

### Verification

- [ ] T026 [US2] [US3] Run `cd extension && pnpm run build:ui && pnpm test` and confirm all pass including new manifest contract tests

**Checkpoint**: Feature flag is declared in manifest with correct naming, scoping, and constraint. Dashboard is gated; settings and pipeline task are unaffected.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and cleanup across all stories.

- [ ] T027 Run full verification suite: `cd extension && pnpm run build:ui && npx eslint ui/settings.ts ui/artifact-client.ts ui/dashboard.ts && pnpm test`
- [ ] T028 Verify legacy SDK elimination: grep `extension/ui/` for `VSS.require.*TFS/Build/RestClient` and `getBuildClient` — confirm zero matches
- [ ] T029 Verify dataset-level feature flags unchanged: confirm `extension/ui/dataset-loader.ts` has no modifications (FR-017)
- [ ] T030 Run quickstart.md verification steps from `specs/026-discovery-refactor-ff-prefix/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **US1 Settings (Phase 3)**: Depends on Phase 2 (needs `getDefinitions()` and `getBuilds()`)
- **US1 Dashboard + Cleanup (Phase 4)**: Depends on Phase 2. Can run in parallel with Phase 3 (different files). However, legacy removal (T018-T020) must wait until both Phase 3 and T016-T017 are complete
- **US2/US3 Feature Flags (Phase 5)**: Depends on Phase 1 only (manifest-only changes). Can run in parallel with Phases 3-4
- **Polish (Phase 6)**: Depends on all previous phases

### User Story Dependencies

- **User Story 1 (P1)**: Requires Phase 2 foundational ArtifactClient methods. Spans Phases 3-4
- **User Story 2 (P2)**: Independent of US1. Manifest-only changes
- **User Story 3 (P2)**: Depends on US2 (flag must exist before constraint references it). Combined in Phase 5

### Within Each User Story

- Types before methods (T002-T003 before T004-T005)
- Methods before tests (T004-T005 before T006-T007)
- Implementation before legacy removal (T009-T012 and T016-T017 before T018-T020)
- Tests can run in parallel with implementation when on different files

### Parallel Opportunities

- T002, T003: Both type additions — parallel (same file but independent sections)
- T006, T007: Both test additions — parallel (same file but independent describe blocks)
- T009-T012 (settings) and T016-T017 (dashboard): Different files — parallel after Phase 2
- T013, T014: Test additions — parallel (same file but independent tests)
- T019, T020: Legacy type removal — parallel (different files)
- T022-T025 (Phase 5) and T009-T021 (Phases 3-4): Independent workstreams — parallel
- T024, T025: Both manifest test additions — parallel (same file but independent tests)

---

## Parallel Example: Phase 2 Foundational

```bash
# Types can be added in parallel:
Task T002: "Add BuildDefinitionReference type to extension/ui/types.ts"
Task T003: "Add Build type to extension/ui/types.ts"

# Then methods (sequential, same file):
Task T004: "Add getDefinitions() to extension/ui/artifact-client.ts"
Task T005: "Add getBuilds() to extension/ui/artifact-client.ts"

# Then tests in parallel:
Task T006: "Add getDefinitions() tests to extension/tests/artifact-client.test.ts"
Task T007: "Add getBuilds() tests to extension/tests/artifact-client.test.ts"
```

## Parallel Example: US1 + US2/US3 (after Phase 2)

```bash
# These two workstreams can proceed in parallel:
# Workstream A (US1): T009-T021 — settings + dashboard refactor
# Workstream B (US2/US3): T022-T026 — feature flags in manifest
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup verification
2. Complete Phase 2: ArtifactClient foundational methods + tests
3. Complete Phase 3: Settings discovery refactor with error UI
4. **STOP and VALIDATE**: Settings page discovers pipelines reliably, error/retry works
5. Complete Phase 4: Dashboard migration + legacy cleanup
6. **VALIDATE**: Zero legacy SDK usage remains

### Incremental Delivery

1. Phase 1 + 2 → ArtifactClient has full Build API coverage via direct REST
2. Phase 3 → Settings discovery works reliably (MVP — fixes live production issue)
3. Phase 4 → Legacy SDK fully eliminated (completes US1)
4. Phase 5 → Feature flags with naming + dashboard toggle (US2 + US3)
5. Phase 6 → Final verification

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- ArtifactClient already has `getArtifacts()` working via direct REST — new methods follow the identical pattern
- The inline `discoverPipelines()` in settings.ts (~80 lines of `VSS.require` code) is replaced entirely — not patched
- Feature flag changes are manifest-only (JSON) — no TypeScript code needed for flag evaluation
- `MockArtifactClient` update is covered by T005a
