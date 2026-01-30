# Tasks: Dynamic CI Badges

**Input**: Design documents from `/specs/015-dynamic-badges/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: No separate test files required - determinism and verification checks are built into the CI job.

**Organization**: Tasks grouped by user story. US1-US3 are all P1 priority and work together for MVP. US4 is P2 (error handling hardening).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- CI workflow: `.github/workflows/ci.yml`
- Scripts: `.github/scripts/`
- README: `README.md`
- Published: `badges` branch: `status.json` (raw GitHub URL)

---

## Phase 1: Setup

**Purpose**: Create the badge generation script and JSON schema

- [x] T001 [P] Create badge JSON generation script at `.github/scripts/generate-badge-json.py`
- [x] T002 [P] Create JSON schema file at `.github/scripts/badge-schema.json` for validation

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core parsing functions that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Implement `parse_coverage_xml()` function in `.github/scripts/generate-badge-json.py` to extract line-rate from coverage.xml
- [x] T004 Implement `parse_lcov()` function in `.github/scripts/generate-badge-json.py` to extract LF/LH from lcov.info
- [x] T005 Implement `parse_junit_xml()` function in `.github/scripts/generate-badge-json.py` to extract tests/failures/errors/skipped
- [x] T006 Implement `generate_status_json()` function in `.github/scripts/generate-badge-json.py` with deterministic output (sort_keys=True, round to 1 decimal)
- [x] T007 Add CLI entry point to `.github/scripts/generate-badge-json.py` that accepts coverage.xml, lcov.info, test-results.xml paths

**Checkpoint**: Script can parse all report types and output valid JSON

---

## Phase 3: User Story 1 - View Accurate Coverage Metrics (Priority: P1) 🎯 MVP

**Goal**: Display Python and TypeScript coverage percentages as distinct badges in README

**Independent Test**: Run script with sample coverage files, verify JSON contains correct coverage values

### Implementation for User Story 1

- [x] T008 [US1] Add `badge-publish` job to `.github/workflows/ci.yml` with `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`
- [x] T009 [US1] Add `needs: [test, extension-tests]` to badge-publish job in `.github/workflows/ci.yml`
- [x] T010 [US1] Add step to download `coverage.xml` artifact from test job in `.github/workflows/ci.yml`
- [x] T011 [US1] Add step to download `extension/coverage/lcov.info` artifact from extension-tests job in `.github/workflows/ci.yml`
- [x] T012 [US1] Add step to run generate-badge-json.py with coverage files in `.github/workflows/ci.yml`
- [x] T013 [US1] Replace Codecov coverage badges with Shields.io dynamic JSON badges using raw GitHub URL in `README.md`

**Checkpoint**: Coverage badges display accurate percentages from CI-generated JSON

---

## Phase 4: User Story 2 - View Test Counts (Priority: P1)

**Goal**: Display Python and TypeScript test counts (passed/skipped) as distinct badges in README

**Independent Test**: Run script with sample JUnit XML files, verify JSON contains correct test counts

### Implementation for User Story 2

- [x] T014 [US2] Add step to download `test-results.xml` artifact from test job in `.github/workflows/ci.yml`
- [x] T015 [US2] Add step to download `extension/test-results.xml` artifact from extension-tests job in `.github/workflows/ci.yml`
- [x] T016 [US2] Update generate-badge-json.py call to include test result paths in `.github/workflows/ci.yml`
- [x] T017 [US2] Replace static test badges with Shields.io dynamic JSON badges using raw GitHub URL in `README.md`

**Checkpoint**: Test count badges display accurate passed/skipped counts

---

## Phase 5: User Story 3 - Automated Badge Updates (Priority: P1)

**Goal**: Publish badge JSON to dedicated `badges` branch automatically on every main branch push

**Independent Test**: Push to main, verify `status.json` is updated on `badges` branch

### Implementation for User Story 3

- [x] T018 [US3] Add step to publish status.json to `badges` branch using git push in `.github/workflows/ci.yml`
- [x] T019 [US3] Configure git user as github-actions[bot] and handle orphan branch creation if `badges` branch doesn't exist
- [x] T020 [US3] Add determinism check: generate JSON twice, diff, fail if different in `.github/workflows/ci.yml`
- [x] T021 [US3] Add JSON schema validation step using badge-schema.json in `.github/workflows/ci.yml`

**Checkpoint**: Badge JSON publishes to `badges` branch automatically, determinism verified

---

## Phase 6: User Story 4 - CI Failure on Badge Errors (Priority: P2)

**Goal**: CI fails explicitly if badge generation or publishing fails

**Independent Test**: Remove a required file, verify CI fails with clear error message

### Implementation for User Story 4

- [x] T022 [US4] Add error handling to generate-badge-json.py for missing input files (exit 1 with clear message)
- [x] T023 [US4] Add error handling for malformed XML/LCOV in generate-badge-json.py
- [x] T024 [US4] Add post-publish curl verification step in `.github/workflows/ci.yml` to check raw GitHub URL accessibility
- [x] T025 [US4] Add retry loop (12 attempts, 5s each) for raw content propagation in curl verification step

**Checkpoint**: CI fails with actionable errors on any badge-related failure

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation and cleanup

- [x] T026 Update quickstart.md in `specs/015-dynamic-badges/quickstart.md` with actual raw GitHub URL
- [ ] T027 Remove old Codecov configuration from `codecov.yml` (optional - can keep for PR comments)
- [x] T028 Commit and push to trigger first badge publish

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on T001 (script file exists)
- **User Story 1 (Phase 3)**: Depends on T003-T007 (parsing functions)
- **User Story 2 (Phase 4)**: Depends on T003-T007 (parsing functions)
- **User Story 3 (Phase 5)**: Depends on US1 or US2 (need JSON to publish)
- **User Story 4 (Phase 6)**: Can run in parallel with US1-US3
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (Coverage)**: Needs Foundational + coverage parsing - independent
- **US2 (Test Counts)**: Needs Foundational + JUnit parsing - independent
- **US3 (Auto Publish)**: Needs US1 or US2 complete (something to publish)
- **US4 (Error Handling)**: Can run in parallel with implementation

### Parallel Opportunities

Setup tasks (T001-T002) can run in parallel.

After Foundational phase:
- T008-T012 (US1 CI steps) can run in parallel with T014-T016 (US2 CI steps)
- T013 and T017 (README updates) can be combined into one commit
- T022-T023 (error handling) can run in parallel with T018-T021 (publishing)

---

## Parallel Example: Foundational Phase

```bash
# These parsing functions can be implemented in any order:
Task: "Implement parse_coverage_xml() in .github/scripts/generate-badge-json.py"
Task: "Implement parse_lcov() in .github/scripts/generate-badge-json.py"
Task: "Implement parse_junit_xml() in .github/scripts/generate-badge-json.py"
```

---

## Implementation Strategy

### MVP First (US1 + US2 + US3)

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 2: Foundational (T003-T007)
3. Complete Phase 3-5: US1 + US2 + US3 together (they're all P1)
4. **STOP and VALIDATE**: Merge to main, verify badges display correctly
5. Complete Phase 6: US4 (error hardening)
6. Complete Phase 7: Polish

### Single-Developer Flow

1. T001 → T002 (setup)
2. T003 → T004 → T005 → T006 → T007 (foundational)
3. T008 → T009 → T010 → T011 → T012 → T013 (US1)
4. T014 → T015 → T016 → T017 (US2)
5. T018 → T019 → T020 → T021 (US3)
6. T022 → T023 → T024 → T025 (US4)
7. T026 → T027 → T028 (polish)

---

## Notes

- All parsing logic in single Python script for simplicity
- CI job runs only on main branch push (not PRs)
- Uses `badges` branch (NOT `gh-pages`) - keeps Pages free for `/docs`
- Raw GitHub URL: `https://raw.githubusercontent.com/oddessentials/ado-git-repo-insights/badges/status.json`
- Shields.io caches badges for ~5 minutes - be patient when testing
- Determinism check prevents future regressions from timestamps/ordering changes
- MUST NOT touch `/docs`, `gh-pages`, or `main` branch content
