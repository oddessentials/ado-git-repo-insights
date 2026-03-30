# Tasks: Migrate from vss-web-extension-sdk to azure-devops-extension-sdk

**Input**: Design documents from `specs/046-migrate-ado-sdk/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/sdk-abstraction.md, quickstart.md

**Tests**: Included — spec requires tests for init/ready sequence (FR-014), storage compatibility (FR-013/SC-008), token format (FR-003), and bundle verification (FR-015).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)

## Path Conventions

- **Extension**: `extension/ui/`, `extension/tests/`, `extension/scripts/`
- **Types**: `types/` at repository root
- **Config**: `extension/package.json`, `extension/tsconfig.json`

---

## Phase 1: Setup (Package Swap & Cleanup)

**Purpose**: Replace the deprecated package, delete obsolete files, prepare for implementation.

- [x] T001 Update extension/package.json — replace `vss-web-extension-sdk` dependency with `azure-devops-extension-sdk` + `azure-devops-extension-api`, remove the `postinstall` script that runs copy-vss-sdk.mjs, then run `pnpm install` to regenerate extension/pnpm-lock.yaml
- [x] T002 [P] Delete types/vss.d.ts — remove custom VSS type declarations. Check if types/ directory contains other .d.ts files; if vss.d.ts was the only file, remove the `../types` entry from `typeRoots` in extension/tsconfig.json, extension/tsconfig.test.json, extension/tsconfig.type-tests.json, and scripts/tsconfig.json. Also remove the `@types/*` path mapping referencing `../types/*` from root tsconfig.json and extension/tsconfig.json.
- [x] T003 [P] Delete extension/scripts/copy-vss-sdk.mjs and extension/ui/VSS.SDK.min.js — the old SDK file and its copy script are no longer needed

**Checkpoint**: `pnpm install` succeeds, old SDK package is gone from node_modules, new packages installed. Build will NOT pass yet (import errors expected until Phase 2).

---

## Phase 2: Foundational (Core Abstraction + Build Pipeline + Mock Harness)

**Purpose**: Rewrite the SDK abstraction layer, build pipeline, and test mock. BLOCKS all user stories.

**CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 Rewrite extension/ui/modules/sdk.ts — Replace all `VSS.*` calls with imports from `azure-devops-extension-sdk`. Implement: (1) `import * as SDK from "azure-devops-extension-sdk"` and `import { CommonServiceIds, IExtensionDataService } from "azure-devops-extension-api"`, (2) Promise-based init/ready/notifyLoadSucceeded sequence with `{ loaded: false }` option (R-05), (3) two-step data service: `getService → getExtensionDataManager(extensionContext.id, accessToken) → IExtensionDataManager` returned from `getExtensionDataService()` (R-02), (4) `CommonServiceIds.ExtensionDataService` replacing `VSS.ServiceIds.ExtensionData` (R-07), (5) `getWebContext()` mapping — use `SDK.getWebContext()` and verify shape, compose from `getHost()`/`getUser()` if needed (R-08). Preserve: `SdkInitOptions` interface, idempotency, configurable timeout via `Promise.race`, `onReady` callback between ready and notifyLoadSucceeded, `isLocalMode()`, `getLocalDatasetPath()`, `isSdkInitialized()`, `resetSdkState()`.
- [x] T005 [P] Update extension/scripts/bundle-ui.mjs — Remove VSS.SDK.min.js from the static files list (line ~94 and ~153). The new SDK is imported in source and bundled by esbuild automatically (externals is already `[]`). No format/target/globalName changes needed.
- [x] T006 [P] Update extension/ui/index.html — Remove the `<script src="VSS.SDK.min.js"></script>` tag from the head. Keep all other script tags unchanged (error-types.js, artifact-client.js, dataset-loader.js, dashboard.js).
- [x] T007 [P] Update extension/ui/settings.html — Remove the `<script src="VSS.SDK.min.js"></script>` tag from the head. Keep the settings.js script tag.
- [x] T008 Rewrite extension/tests/harness/vss-sdk-mock.ts — Replace `global.VSS` mock attachment with `jest.mock("azure-devops-extension-sdk")` and `jest.mock("azure-devops-extension-api")`. Mock functions: `init()` → resolves immediately, `ready()` → resolves immediately, `notifyLoadSucceeded()` → resolves immediately, `getWebContext()` → returns mock context, `getAccessToken()` → returns mock token string (NOT `{ token }`), `getService()` → returns mock `IExtensionDataService` whose `getExtensionDataManager()` returns mock `IExtensionDataManager` with `getValue`/`setValue`, `getExtensionContext()` → returns `{ id: "publisher.extension" }`, `getHost()`/`getUser()` → mock accessors. Mock `azure-devops-extension-api`: `CommonServiceIds.ExtensionDataService` → string, `getClient(CoreRestClient)` → mock with `getProjects()`. Preserve all existing preset scenarios (`mockValidDashboardSettings`, `mockMissingDashboardSettings`, `mockInvalidDashboardSettings`, `mockDashboardSettingsError`), configuration helpers (`setMockWebContext`, `setMockSettingValue`, `setMockBuilds`, etc.), and deep-frozen default context.
- [x] T009 Update extension/tests/harness/vss-sdk-mock.test.ts — Rewrite all assertions to verify new mock API: init/ready/notifyLoadSucceeded resolve as Promises, getAccessToken returns string, getService returns data service → manager chain, getClient returns mock REST client, preset scenarios work correctly, configuration helpers update state as expected.
- [x] T010 Update extension/tests/modules/sdk.test.ts — Add/update tests: (1) init → ready → notifyLoadSucceeded sequence verified in order (FR-014), (2) idempotency — second init call is no-op, (3) timeout rejection with correct error message, (4) onReady callback fires between ready and notifyLoadSucceeded, (5) getExtensionDataService returns object with getValue/setValue methods, (6) getWebContext returns undefined before init and context after, (7) isLocalMode/getLocalDatasetPath still work (US4 verification).

**Checkpoint**: `pnpm run build` passes (tsc + esbuild). `pnpm test -- --testPathPattern="sdk|harness"` passes. Foundation ready for consumer updates.

---

## Phase 3: User Story 1 — Dashboard Loads and Displays Data (Priority: P1) MVP

**Goal**: Dashboard widget initializes, authenticates, loads settings, fetches artifacts, and renders charts using the new SDK.

**Independent Test**: Load the extension widget in Azure DevOps. Charts, summary cards, and filter controls render with real pipeline data.

### Implementation for User Story 1

- [x] T011 [US1] Update extension/ui/dashboard.ts — Replace all direct `VSS.getService(VSS.ServiceIds.ExtensionData)` calls (~lines 313-314, 353-354) with `getExtensionDataService()` import from sdk.ts. Replace all `VSS.getWebContext()` calls (~lines 387, 564) with `getWebContext()` import from sdk.ts. Remove any direct `VSS` references. Ensure no `import` of the old SDK or `azure-devops-extension-sdk` directly — dashboard.ts must only use sdk.ts exports.
- [x] T012 [US1] Verify extension/tests/dashboard/ test files pass — Run `pnpm test -- --testPathPattern="dashboard"`. Fix any broken mock API calls (e.g., mock setup functions now return Promises, token format changed). All existing dashboard tests must pass with zero changes to test assertions beyond mock API updates.

**Checkpoint**: Dashboard tests pass. Dashboard renders correctly in a hosted environment.

---

## Phase 4: User Story 2 — Settings Page Manages Configuration (Priority: P1)

**Goal**: Settings page reads/writes configuration, lists projects via CoreRestClient, and reads pre-existing settings saved by the old SDK.

**Independent Test**: Open settings page, change pipeline configuration, select project from dropdown, save, reload — settings persist.

### Implementation for User Story 2

- [x] T013 [US2] Update extension/ui/settings.ts — (1) Replace `VSS.getService(VSS.ServiceIds.ExtensionData)` (~line 92) with `getExtensionDataService()` from sdk.ts. (2) Replace all `VSS.getWebContext()` calls (~lines 95, 360, 518, 668) with `getWebContext()` from sdk.ts. (3) Replace `VSS.require(["TFS/Core/RestClient"])` AMD pattern (~line 179) with ESM imports: `import { CoreRestClient } from "azure-devops-extension-api/Core"` and `import { getClient } from "azure-devops-extension-api"`, then `const client = getClient(CoreRestClient); const projects = await client.getProjects();` (R-03). Map `TeamProjectReference` result to existing `VSSProject` type (compatible superset: has `name`, `id`). Remove any direct `VSS` references.
- [x] T014 [US2] Add storage compatibility test in extension/tests/ — Create test that configures mock data manager with values in the format previously saved by the old SDK (key/value pairs in `$settings` collection), then calls `getExtensionDataService()` → `getValue()` and verifies all values return correctly without migration or reformatting (FR-013, SC-008). Test both string and object settings values.
- [x] T015 [US2] Verify settings tests pass — Run `pnpm test -- --testPathPattern="settings"`. Fix any broken mock API calls in extension/tests/dashboard/settings-contract.test.ts and settings-download.test.ts. Ensure project listing tests use the new `getClient(CoreRestClient)` mock path.

**Checkpoint**: Settings tests pass. Project dropdown populates. Settings save/load works.

---

## Phase 5: User Story 3 — Authenticated API Calls Succeed (Priority: P1)

**Goal**: Artifact client obtains user-delegated Bearer tokens via `getAccessToken()` (not `getAppToken()`) and all REST API calls succeed.

**Independent Test**: Trigger data refresh on dashboard — pipeline artifacts are fetched and rendered.

### Implementation for User Story 3

- [x] T016 [US3] Update extension/ui/artifact-client.ts — (1) Replace `VSS.getWebContext()` (~line 56) with import from sdk.ts or direct `SDK.getWebContext()` for `collection.uri`. (2) Replace `VSS.getAccessToken()` (~line 60) with `SDK.getAccessToken()` from `azure-devops-extension-sdk` — new return type is `string` directly, remove the `typeof result === "string" ? result : result.token` guard (R-04). Ensure Bearer token header construction uses the plain string.
- [x] T017 [US3] Update extension/tests/auth-pattern.test.ts — (1) Update token format assertions: `getAccessToken()` must return `string`, not `{ token: string }`. (2) Add assertion that `getAppToken()` is never called for artifact or data-service operations (FR-003). (3) Verify Bearer token header is `Authorization: Bearer ${tokenString}` with the direct string value.

**Checkpoint**: Auth tests pass. Artifact client fetches data successfully in hosted environment.

---

## Phase 6: User Story 4 — Local Development Mode Continues Working (Priority: P2)

**Goal**: Local dataset mode bypasses SDK initialization and loads data from local JSON files.

**Independent Test**: Run extension locally with `LOCAL_DASHBOARD_MODE=true`, verify dashboard renders using local JSON data without SDK init attempt.

### Implementation for User Story 4

- [x] T018 [US4] Verify local mode preserved in sdk.ts rewrite — Confirm `isLocalMode()` reads `window.LOCAL_DASHBOARD_MODE` and `getLocalDatasetPath()` reads `window.DATASET_PATH` with `'./dataset'` default. Run `pnpm test -- --testPathPattern="sdk.test"` and confirm local mode tests pass (already covered in T010, but verify explicitly). No code changes expected — this is a verification task.

**Checkpoint**: Local mode tests pass. Dashboard renders locally without SDK initialization.

---

## Phase 7: User Story 5 — Extension Passes All Automated Quality Gates (Priority: P2)

**Goal**: All existing tests, lint, type checks, and CI gates pass with zero new suppressions.

**Independent Test**: Run full CI pipeline — zero failures, zero new suppressions, zero relaxed coverage thresholds.

### Implementation for User Story 5

- [x] T019 [US5] Rewrite extension/tests/sdk-bundling.test.ts — Replace all assertions to verify: (1) no `VSS.SDK.min.js` file in extension/ui/ folder, (2) no `vss-web-extension-sdk` in extension/package.json dependencies, (3) `azure-devops-extension-sdk` present in dependencies, (4) `azure-devops-extension-api` present in dependencies, (5) neither index.html nor settings.html contain `VSS.SDK.min.js` script tag, (6) HTML files still load app bundle scripts in correct order (FR-015). Add runtime smoke assertion that `import("azure-devops-extension-sdk")` resolves without error.
- [x] T020 [US5] Run full type check — Execute `pnpm run build:check` (tsc --noEmit) and `pnpm run build:check-tests` (tsc --noEmit --project tsconfig.test.json). Verify zero type errors. All types from SDK-provided declarations must resolve without custom type files (SC-007).
- [x] T021 [US5] Run ESLint — Execute `pnpm run lint` (ESLint --max-warnings=0). Verify zero warnings, zero new suppressions. All new imports must comply with `consistent-type-imports` rule, `no-explicit-any`, and security rules (FR-012).
- [x] T022 [US5] Run full Jest suite — Execute `pnpm test`. Verify: all tests pass, zero new test skips, coverage thresholds maintained per jest.config.ts tiers. Compare coverage report to pre-migration baseline — no regression in statement/branch/function/line coverage (SC-001).

**Checkpoint**: All quality gates pass. CI would be green.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and cleanup across all surfaces.

- [x] T023 [P] Run residual reference scan — `grep -r "vss-web-extension-sdk" extension/` and `grep -r "VSS\." extension/ui/ --include="*.ts"` and `grep -r "VSS.SDK.min.js" extension/` — fix any stragglers. Only allowed references: test assertions that explicitly verify absence (SC-004).
- [x] T024 [P] Verify esbuild bundle output — Run `pnpm run build:ui`, confirm dist/ contains bundled JS files, no separate VSS.SDK.min.js, bundle size is reasonable (new SDK adds ~15KB). Verify IIFE format and globalName exports are unchanged.
- [x] T025 Run quickstart.md verification checklist end-to-end — Execute every item in specs/046-migrate-ado-sdk/quickstart.md verification checklist. All items must pass.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (T001 must complete for imports to resolve)
- **User Stories (Phase 3-6)**: All depend on Phase 2 completion (sdk.ts + mock harness must be ready)
  - US1, US2, US3 can proceed in parallel (different files)
  - US4 is a verification task, depends on T004 (sdk.ts rewrite)
- **Quality Gates (Phase 7)**: Depends on all user stories (Phases 3-6)
- **Polish (Phase 8)**: Depends on Phase 7

### User Story Dependencies

- **US1 (Dashboard)**: Depends on Phase 2 only. No cross-story dependencies.
- **US2 (Settings)**: Depends on Phase 2 only. No cross-story dependencies.
- **US3 (Auth)**: Depends on Phase 2 only. No cross-story dependencies.
- **US4 (Local Mode)**: Depends on T004 (sdk.ts rewrite). Verification only.
- **US5 (Quality Gates)**: Depends on US1 + US2 + US3 + US4 completion.

### Within Each User Story

- Implementation before test verification
- Core file update before dependent test fixes

### Parallel Opportunities

**Phase 1**: T002 and T003 can run in parallel after T001
**Phase 2**: T005, T006, T007 can run in parallel with each other and with T004 (different files). T008 depends on T004. T009 depends on T008. T010 depends on T004 + T008.
**Phase 3-5**: T011, T013, T016 can all run in parallel (dashboard.ts, settings.ts, artifact-client.ts are different files). Test verification tasks (T012, T015, T017) follow their respective implementation tasks.
**Phase 8**: T023 and T024 can run in parallel.

---

## Parallel Example: User Stories 1-3 (After Phase 2)

```
# All three consumer files can be updated in parallel:
T011 [US1]: Update dashboard.ts (replace 5 VSS call sites)
T013 [US2]: Update settings.ts (replace 10 VSS call sites + AMD→ESM)
T016 [US3]: Update artifact-client.ts (token format change)

# Then verify tests for each story in parallel:
T012 [US1]: Verify dashboard tests
T015 [US2]: Verify settings tests
T017 [US3]: Verify auth tests
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (package swap, file cleanup)
2. Complete Phase 2: Foundational (sdk.ts rewrite, mock harness, build pipeline)
3. Complete Phase 3: User Story 1 (dashboard.ts updates)
4. **STOP and VALIDATE**: Build passes, dashboard tests pass, dashboard renders in hosted environment
5. Continue to remaining stories

### Incremental Delivery

1. Phase 1 + Phase 2 → Foundation ready
2. Add US1 (Dashboard) → Test → Validate (MVP)
3. Add US2 (Settings) → Test → Validate
4. Add US3 (Auth) → Test → Validate
5. Add US4 (Local Mode) → Verify
6. Add US5 (Quality Gates) → Full CI validation
7. Phase 8: Polish → Ship

### Single-Developer Recommended Order

T001 → T002+T003 → T004 → T005+T006+T007 → T008 → T009+T010 → T011+T013+T016 → T012+T015+T017 → T018 → T019 → T020+T021+T022 → T023+T024 → T025

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to specific user story for traceability
- US1, US2, US3 are all P1 priority but can be implemented in any order after Phase 2
- Commit after each task or logical group. Let pre-commit hooks run (never --no-verify).
- The critical path is: T001 → T004 → T008 → T010 (setup → sdk.ts → mock → sdk tests)
- Total estimated scope: ~13 files changed (5 production, 8 test/infrastructure)
