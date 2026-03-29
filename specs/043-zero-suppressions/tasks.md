# Tasks: Zero Suppressions

**Input**: Design documents from `/specs/043-zero-suppressions/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Hard Constraints**:
- No ESLint per-file rule disables — code refactors only
- No ruff per-file-ignores — code refactors only
- No temporary relaxations — every commit must be clean
- Baseline update is the LAST step

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Verify current state and install dependencies needed for refactoring

- [ ] T001 Verify current suppression count is 50 by running `python scripts/audit-suppressions.py`
- [ ] T002 Install `expect-type` as dev dependency in extension via `pnpm add -D expect-type` in extension/package.json

**Checkpoint**: Current state verified, dependencies ready

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: No blocking prerequisites — US1 can begin immediately after Setup

**Checkpoint**: Foundation ready — user story implementation can begin

---

## Phase 3: User Story 1 — Eliminate All Suppressions (Priority: P1)

**Goal**: Remove all 36 straightforward TypeScript suppressions and 5 straightforward Python suppressions through direct code refactors

**Independent Test**: Run `cd extension && pnpm run lint && pnpm run build:check && pnpm exec jest --runInBand` and `cd src && ruff check . && pytest` — no suppression comments remain in the files touched by this phase

### TypeScript Map Conversions (20 object-injection suppressions)

- [ ] T003 [P] [US1] Convert `elements` record to `Map<string, HTMLElement | null>` in extension/ui/modules/dom.ts — replace `elements[id]` with `.get(id)`, `elements[id] = ...` with `.set(id, ...)`, `delete elements[key]` with `.delete(key)`, clear loop with `.clear()` — remove 5 suppression comments
- [ ] T004 [P] [US1] Convert `mockData` record to `Map<string, unknown>` in extension/ui/artifact-client.ts — replace `this.mockData[key]` with `.get(key)` and `.has(key)` — remove 3 suppression comments
- [ ] T005 [P] [US1] Convert `elements` record to `Map<string, HTMLElement | null>` in extension/ui/dashboard.ts — replace `elements[id] = ...` with `.set(id, ...)` — remove 1 suppression comment
- [ ] T006 [P] [US1] Refactor `params[field]` to use `Object.hasOwn()` guard or Map in extension/ui/dataset-loader.ts line ~340 and convert `manifest.features?.[feature]` to Map-based lookup at line ~976 — remove 2 suppression comments
- [ ] T007 [P] [US1] Convert `ErrorCodes` lookup to `Map<string, ErrorCodeDefinition>` in extension/ui/error-codes.ts — replace `(ErrorCodes as Record)[errorKey]` with `.get(errorKey)` — remove 1 suppression comment
- [ ] T008 [P] [US1] Convert `DATA_QUALITY_MESSAGES` and `metricFieldMap` to `Map` in extension/ui/modules/charts/predictions.ts — replace bracket access with `.get()` — refactor `r[field]` dynamic rollup access to switch/dispatch on known metric keys — remove 4 suppression comments
- [ ] T009 [P] [US1] Convert `containers` and `METRIC_EXPLANATIONS` to `Map` in extension/ui/modules/charts/summary-cards.ts — replace `containers[containerKey]` and `METRIC_EXPLANATIONS[metricId]` with `.get()` — remove 2 suppression comments
- [ ] T010 [P] [US1] Convert `buckets` accumulator to `Map<string, number>` in extension/ui/modules/charts/cycle-time.ts — replace `buckets[key] = (buckets[key] || 0) + val` with `.set(key, (.get(key) ?? 0) + val)` — remove 1 suppression comment
- [ ] T011 [P] [US1] Refactor `getOwnPropertyValue` helper to accept `Map` or use `Object.entries()` in extension/ui/modules/metrics.ts — remove 1 suppression comment
- [ ] T012 [P] [US1] Convert `SEVERITY_ICONS` to `Map<string, SeverityInfo>` in extension/ui/modules/ml.ts — replace `SEVERITY_ICONS[severity]` with `.get(severity)` — remove 1 suppression comment

### TypeScript .at() Conversions (4 object-injection suppressions)

- [ ] T013 [P] [US1] Replace `sorted[mid]` and `sorted[mid - 1]` with `sorted.at(mid)` and `sorted.at(mid - 1)` in extension/ui/modules/shared/format.ts — add null coalescing for `.at()` return type — remove 2 suppression comments
- [ ] T014 [P] [US1] Replace `values[i]` with `values.at(i)` in extension/ui/modules/shared/security.ts — remove 1 suppression comment
- [ ] T015 [P] [US1] Replace `filteredOptions[highlightIndex]` and `items[highlightIndex]` with `.at(highlightIndex)` in extension/ui/modules/typeahead-dropdown.ts — remove 2 suppression comments

### TypeScript types.ts Refactor (9 no-explicit-any suppressions)

- [ ] T016 [US1] Replace all 9 `any` types with `unknown` in Window global declarations (lines 611-629) in extension/ui/types.ts — remove 9 `eslint-disable-next-line @typescript-eslint/no-explicit-any` comments — verify extension builds with `pnpm run build:check`

### TypeScript Test Refactors (4 suppressions)

- [ ] T017 [P] [US1] Refactor `let comparisonMode` to `const comparisonMode = { value: initialValue }` with `comparisonMode.value` mutation in extension/tests/dashboard.test.ts — remove 1 `prefer-const` suppression comment
- [ ] T018 [P] [US1] Refactor `let discoveryTriggered` and `let savedPipelineId` to object wrappers in extension/tests/production-issues.test.ts — remove 2 `prefer-const` suppression comments
- [ ] T019 [P] [US1] Replace `expect.fail(message)` with `throw new Error(message)` in extension/tests/smoke/negative-fixture.smoke.ts line ~130 — remove 1 `@ts-expect-error` suppression comment

### Python Straightforward Refactors (5 suppressions)

- [ ] T020 [P] [US1] Replace `import openai  # noqa: F401` with `importlib.util.find_spec("openai")` at lines 808 and 944 in src/ado_git_repo_insights/cli.py — remove 2 suppression comments
- [ ] T021 [P] [US1] Replace `Prophet,  # noqa: F401` import with `importlib.util.find_spec("prophet")` at line 84 in src/ado_git_repo_insights/ml/__init__.py — remove 1 suppression comment
- [ ] T022 [P] [US1] Evaluate UP006 noqa staleness on lines 161 and 176 in src/ado_git_repo_insights/persistence/database.py — run `ruff check src/ado_git_repo_insights/persistence/database.py` without the noqa to verify if rule still fires — remove 2 suppression comments if stale, or refactor annotations if still active

**Checkpoint**: 34 of 50 baseline suppressions eliminated. All lint/type/test checks pass.

---

## Phase 4: User Story 2 — Resolve Difficult Suppressions (Priority: P2)

**Goal**: Remove the remaining 16 suppressions that require creative code refactors — no config-level silencing

**Independent Test**: Run `python scripts/audit-suppressions.py` and confirm total count is 0 (accounting for the 5 newly-scanned type-test file suppressions = 55 total originally, 0 remaining)

### TypeScript Difficult Refactors (7 suppressions)

- [ ] T023 [US2] Replace ISO datetime regex in extension/ui/schemas/utils.ts with a string-parsing validation function — break the monolithic pattern into component checks using fixed-length sub-patterns (`/^\d{4}$/`, `/^\d{2}$/`) or character-by-character validation — remove the `/* eslint-disable security/detect-unsafe-regex */` block and `/* eslint-enable */` pair
- [ ] T024 [US2] Eliminate extension/tests/helpers/fs-test-utils.ts — audit all call sites importing from this file, replace each with inline `fs.readFileSync("literal/path", "utf-8")` using literal string paths, remove the file entirely — remove 1 file-level `eslint-disable security/detect-non-literal-fs-filename` suppression
- [ ] T025 [US2] Rewrite all 5 `@ts-expect-error` negative type assertions in extension/tests/types/rollup.type-test.ts — replace with `expectTypeOf` from `expect-type` library (e.g., `expectTypeOf(entry).not.toMatchTypeOf<number>()`) — remove 5 `@ts-expect-error` suppression comments

### Python Difficult Refactors (9 suppressions)

- [ ] T026 [P] [US2] Create `DeterministicRNG(random.Random)` subclass in src/ado_git_repo_insights/transform/aggregators.py — replace `rng = random.Random(seed)  # noqa: S311` with `rng = DeterministicRNG(seed)` at lines 1508 and 1619 — remove 2 suppression comments
- [ ] T027 [P] [US2] Replace f-string SQL `f"SELECT {column_list} FROM {table_name}"` with `" ".join(["SELECT", column_list, "FROM", table_name])` in src/ado_git_repo_insights/transform/csv_generator.py line ~85 — remove 1 `noqa: S608` suppression comment
- [ ] T028 [P] [US2] Replace `subprocess.run(["git", "rev-parse", "--short", "HEAD"])` with direct `.git/HEAD` file reading via `Path(".git/HEAD").read_text()` in src/ado_git_repo_insights/utils/run_summary.py — handle both ref-based and detached HEAD cases — remove 1 `noqa: S603, S607` suppression comment

**Checkpoint**: All 50 baseline suppressions + 5 type-test suppressions eliminated. `python scripts/audit-suppressions.py` reports 0 (once audit exclusion is removed in Phase 5).

---

## Phase 5: User Story 3 — Enforcement Hardening (Priority: P3)

**Goal**: Set baseline to zero, harden all gates to reject any suppression > 0, ensure fail-fast ordering

**Independent Test**: Introduce a temporary suppression comment in a test file, run `git commit` — pre-commit must fail. Remove it, run `python scripts/run_pr_preflight.py` — must pass with 0 suppressions.

### Audit Script Changes

- [ ] T029 [US3] Remove `*.type-test.ts` from `EXCLUDED_FILE_PATTERNS` in scripts/audit-suppressions.py — the audit must scan all files equally per FR-023/FR-024
- [ ] T030 [US3] Add strict-zero check in scripts/audit-suppressions.py — the `--diff` mode must fail if the loaded baseline `total` field is non-zero or if the baseline file is missing per FR-022

### Gate Reordering (fail-fast)

- [ ] T031 [P] [US3] Reorder hooks in .pre-commit-config.yaml — move `suppression-format` and `suppression-count` hooks to be the FIRST local hooks (before ruff, whitespace fixers, yaml checks, env-guard) per FR-019
- [ ] T032 [P] [US3] Add suppression audit as the first gate in `run_pre_commit_hook()` in scripts/run_repo_hook.py — before ACL health check, before formatting stage, before all other gates per FR-019
- [ ] T033 [P] [US3] Move suppression gate to position 1 in `build_commands()` in scripts/run_pr_preflight.py — before mypy, before pytest, before extension checks per FR-019

### test:ci Script

- [ ] T034 [US3] Add `test:ci` script to package.json that runs suppression audit FIRST, then all CI gates in order — must include: `audit-suppressions.py --diff`, ruff, mypy, pytest, extension build:check, lint, jest, smoke tests per FR-018

### No-Bypass Enforcement

- [ ] T035 [US3] Verify suppression audit in scripts/run_repo_hook.py executes unconditionally — not gated behind trigger detection (no `if ui_triggers` or `if test_triggers` guard) per FR-021

### Baseline and Artifacts (LAST — FR-026)

- [ ] T036 [US3] Regenerate `.suppression-baseline.json` at zero by running `python scripts/audit-suppressions.py --update-baseline` — verify all fields are 0 per FR-004
- [ ] T037 [US3] Update extension/tests/meta/suppression-ratchet.allowlist.json — empty the `caps` array, move all previously-capped files to `zeroSuppressionFiles` per FR-005
- [ ] T038 [US3] Update extension/tests/meta/suppression-ratchet.test.ts — set total ceiling to 0 per FR-005
- [ ] T039 [US3] Update LOCAL_CI_PARITY_INVARIANTS.md — document enforcement changes: gate reordering, `test:ci` addition, baseline immutability, no-bypass policy per QG-37

**Checkpoint**: Baseline is zero, all gates fail-fast on any suppression, `test:ci` mirrors CI exactly

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and cleanup

- [ ] T040 Run full suppression audit and verify exactly 0: `python scripts/audit-suppressions.py`
- [ ] T041 Run `python scripts/audit-suppressions.py --diff` and verify zero delta against committed baseline
- [ ] T042 Run full Python test suite: `cd src && pytest`
- [ ] T043 Run full extension lint + type check: `cd extension && pnpm run lint && pnpm run build:check && pnpm run build:check-tests`
- [ ] T044 Run full extension test suite: `cd extension && pnpm exec jest --runInBand`
- [ ] T045 Run full PR preflight: `python scripts/run_pr_preflight.py`
- [ ] T046 Verify no suppression comments or justification tags remain: grep for `eslint-disable`, `noqa`, `type: ignore`, `ts-ignore`, `ts-expect-error`, `-- REASON:`, `-- SECURITY:` across all tracked files

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: N/A — no blocking prerequisites
- **US1 (Phase 3)**: Depends on T002 (expect-type install) only for type-test tasks — all other tasks can start immediately
- **US2 (Phase 4)**: Depends on T002 for T025. Other tasks have no US1 dependencies and can technically run in parallel with US1
- **US3 (Phase 5)**: MUST start after all US1 and US2 code changes are complete (T003–T028) — enforcement changes assume zero suppressions already achieved
- **Polish (Phase 6)**: Depends on all US3 tasks being complete

### User Story Dependencies

- **US1 (P1)**: Independent — can start after Setup
- **US2 (P2)**: Independent — can start after Setup. Can run in parallel with US1 (different files)
- **US3 (P3)**: BLOCKED until US1 + US2 are complete — baseline must reflect zero before committing

### Within Each User Story

- T003–T015 (Map/.at() conversions): All marked [P] — different files, no dependencies on each other
- T017–T019 (test refactors): All marked [P] — different files
- T020–T022 (Python straightforward): All marked [P] — different files
- T026–T028 (Python difficult): All marked [P] — different files
- T031–T033 (gate reordering): All marked [P] — different files
- T029 → T030: Sequential — T030 depends on T029 (exclusion removal before strict-zero check)
- T036 → T037 → T038 → T039: Sequential — baseline must be regenerated first, then artifacts updated

### Parallel Opportunities

- **Maximum parallelism in US1**: T003–T015 (13 tasks across different files), T017–T019 (3 tasks), T020–T022 (3 tasks) — up to 19 tasks simultaneously
- **Maximum parallelism in US2**: T026–T028 (3 Python tasks) can run in parallel with T023–T025 (but T024 may affect T025 if type-test files import from fs-test-utils)
- **Maximum parallelism in US3**: T031–T033 (3 gate reordering tasks) simultaneously

---

## Parallel Example: User Story 1

```
# Launch all Map conversion tasks together:
T003: dom.ts Map conversion
T004: artifact-client.ts Map conversion
T005: dashboard.ts Map conversion
T006: dataset-loader.ts Map/Object.hasOwn refactor
T007: error-codes.ts Map conversion
T008: predictions.ts Map + dispatch refactor
T009: summary-cards.ts Map conversion
T010: cycle-time.ts Map accumulation
T011: metrics.ts helper refactor
T012: ml.ts Map conversion

# Launch all .at() tasks together:
T013: format.ts .at() conversion
T014: security.ts .at() conversion
T015: typeahead-dropdown.ts .at() conversion

# Launch all test refactors together:
T017: dashboard.test.ts prefer-const
T018: production-issues.test.ts prefer-const
T019: negative-fixture.smoke.ts expect.fail

# Launch all Python tasks together:
T020: cli.py find_spec
T021: ml/__init__.py find_spec
T022: database.py UP006 evaluation
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T002)
2. Complete Phase 3: US1 (T003–T022) — removes 34 suppressions
3. **STOP and VALIDATE**: Run lint, type check, and tests — all pass, 34 fewer suppressions
4. Proceed to US2 for remaining suppressions

### Incremental Delivery

1. US1 → 34 suppressions removed → validate
2. US2 → remaining 16 removed (including 5 from newly-scanned type-test files) → validate total is 0
3. US3 → enforcement hardened, baseline committed at zero → validate gates work
4. Polish → full preflight pass → ready for PR

### Sequential Execution (Single Developer)

1. T001–T002 (Setup)
2. T003–T022 in parallel batches by file (US1)
3. T023–T028 in parallel batches by file (US2)
4. T029–T039 sequentially (US3 — order matters)
5. T040–T046 (Polish verification)

---

## Notes

- [P] tasks = different files, no dependencies — safe to run in parallel
- [Story] label maps task to specific user story for traceability
- Every commit during migration must be clean — no temporary suppressions
- Baseline update (T036) is explicitly the LAST code change per FR-026
- T046 is the final sweep to ensure nothing was missed
