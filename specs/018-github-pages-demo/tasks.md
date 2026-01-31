# Tasks: GitHub Pages Demo Dashboard

**Input**: Design documents from `/specs/018-github-pages-demo/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are included per plan.md Phase 4 requirements (schema validation, regeneration tests, base-path tests).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Hybrid project**: Python scripts in `scripts/`, TypeScript in `extension/`, output in `docs/`
- **Tests**: Python tests in `tests/demo/`
- **CI**: GitHub Actions in `.github/workflows/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, directory structure, tooling configuration

- [x] T001 Create docs/ directory structure: docs/, docs/data/, docs/data/aggregates/, docs/data/aggregates/weekly_rollups/, docs/data/aggregates/distributions/, docs/data/predictions/, docs/data/insights/
- [x] T002 Create tests/demo/ directory for demo-specific tests
- [x] T003 [P] Pin Python version to 3.11 in .github/workflows/demo.yml
- [x] T004 [P] Verify Node 22 and pnpm 9.15.0 are pinned in extension/package.json

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core data generation infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Create scripts/generate-demo-data.py with canonical JSON utility functions (sorted keys, 3-decimal floats, UTC timestamps, LF newlines)
- [x] T006 [P] Implement deterministic random initialization with seed=42 in scripts/generate-demo-data.py
- [x] T007 [P] Implement UUID v5 generation helper with DNS namespace in scripts/generate-demo-data.py
- [x] T008 Implement SyntheticOrganization generator (3 orgs) in scripts/generate-demo-data.py
- [x] T009 Implement SyntheticProject generator (8 projects across orgs) in scripts/generate-demo-data.py
- [x] T010 Implement SyntheticRepository generator (20 repos with UUID v5 IDs) in scripts/generate-demo-data.py
- [x] T011 Implement SyntheticUser generator (50 users with realistic names) in scripts/generate-demo-data.py
- [x] T012 Generate docs/data/aggregates/dimensions.json with all entities (orgs, projects, repos, users)

**Checkpoint**: Foundation ready - entities and utilities in place for user story implementation

---

## Phase 3: User Story 1 - View Live Demo Dashboard (Priority: P1) 🎯 MVP

**Goal**: A working dashboard served from GitHub Pages that renders with synthetic data, summary cards, charts, and filters

**Independent Test**: Visit the local server at http://localhost:8080 and verify the dashboard renders with charts, metrics, and interactive filters

### Implementation for User Story 1

- [x] T013 [US1] Implement WeeklyRollup generator with seasonal variation model (260 weeks, 2021-W01 to 2025-W52) in scripts/generate-demo-data.py
- [x] T014 [US1] Implement log-normal cycle time distribution (μ=6.0, σ=1.5) for weekly metrics in scripts/generate-demo-data.py
- [x] T015 [US1] Generate 260 weekly rollup files in docs/data/aggregates/weekly_rollups/YYYY-Www.json
- [x] T016 [US1] Implement YearlyDistribution generator (5 years with bucket counts) in scripts/generate-demo-data.py
- [x] T017 [US1] Generate 5 distribution files in docs/data/aggregates/distributions/YYYY.json
- [x] T018 [US1] Generate docs/data/dataset-manifest.json with all aggregate indexes
- [x] T019 [P] [US1] Create scripts/build-demo.sh to run pnpm build in extension/ and copy dist/ui/* to docs/
- [x] T020 [US1] Modify scripts/build-demo.sh to inject LOCAL_DASHBOARD_MODE and DATASET_PATH globals into docs/index.html
- [x] T021 [US1] Add <base href="./"> to docs/index.html for relative path resolution
- [x] T022 [US1] Add synthetic data disclaimer banner HTML/CSS to docs/index.html (visible, non-intrusive, states data is synthetic)
- [x] T023 [US1] Verify docs/index.html loads dashboard.js, dataset-loader.js, styles.css, VSS.SDK.min.js
- [x] T024 [US1] Run scripts/build-demo.sh and verify dashboard renders locally with python -m http.server 8080

**Checkpoint**: User Story 1 complete - dashboard renders with 5 years of data, filters work, banner visible

---

## Phase 4: User Story 2 - Explore Realistic Historical Data (Priority: P2)

**Goal**: Synthetic data shows realistic variation and seasonal patterns over 5 years

**Independent Test**: Verify date range spans 2021-W01 to 2025-W52, throughput chart shows variation, cycle time distributions have realistic shape

### Implementation for User Story 2

- [x] T025 [US2] Enhance seasonal variation in scripts/generate-demo-data.py: ±20% amplitude, December trough, Q1/Q3 peaks
- [x] T026 [US2] Add ±10% random weekly noise to PR counts (deterministic with seed=42)
- [x] T027 [US2] Verify pr_count ranges from ~28 to ~51 across weeks (not flat)
- [x] T028 [US2] Verify cycle_time_p50 and cycle_time_p90 show realistic percentile spread
- [x] T029 [US2] Regenerate all weekly rollups with enhanced seasonal model
- [x] T030 [US2] Verify distribution buckets show realistic proportions (15% 0-1h, 25% 1-4h, 30% 4-24h, 15% 1-3d, 10% 3-7d, 5% 7d+)

**Checkpoint**: User Story 2 complete - data appears realistic with seasonal patterns and variation

---

## Phase 5: User Story 3 - View ML Predictions Tab (Priority: P3)

**Goal**: Predictions tab shows 12-week forecasts with confidence intervals for 3 metrics

**Independent Test**: Click Predictions tab, verify forecast charts render with predicted values and upper/lower bounds

### Implementation for User Story 3

- [x] T031 [P] [US3] Create scripts/generate-demo-predictions.py for deterministic forecast generation
- [x] T032 [US3] Implement linear trend continuation from last 8 weeks of data in scripts/generate-demo-predictions.py
- [x] T033 [US3] Generate pr_throughput forecast (12 weeks, count unit) with ±15% confidence interval
- [x] T034 [US3] Generate cycle_time_minutes forecast (12 weeks, minutes unit) with ±15% confidence interval
- [x] T035 [US3] Generate review_time_minutes forecast (12 weeks, minutes unit) with ±15% confidence interval
- [x] T036 [US3] Widen confidence interval by 1% per week for forecast uncertainty
- [x] T037 [US3] Generate docs/data/predictions/trends.json with all 3 metric forecasts
- [x] T038 [US3] Update docs/data/dataset-manifest.json to set features.predictions=true
- [x] T039 [US3] Verify Predictions tab renders in dashboard with forecast charts

**Checkpoint**: User Story 3 complete - Predictions tab shows 12-week forecasts with confidence bands

---

## Phase 6: User Story 4 - View AI Insights Tab (Priority: P3)

**Goal**: AI Insights tab shows deterministic, rule-based observations derived from aggregates

**Independent Test**: Click AI Insights tab, verify insight cards render with categories and severity levels

### Implementation for User Story 4

- [x] T040 [P] [US4] Create scripts/generate-demo-insights.py for rule-based insight generation
- [x] T041 [US4] Implement bottleneck-001 template: P90 > 3x P50 in any repo (warning severity)
- [x] T042 [US4] Implement bottleneck-002 template: P90 > 5 days in any repo (critical severity)
- [x] T043 [US4] Implement trend-001 template: Throughput up 20%+ over 4 weeks (info severity)
- [x] T044 [US4] Implement trend-002 template: Cycle time down 15%+ over 4 weeks (info severity)
- [x] T045 [US4] Implement trend-003 template: Throughput down 20%+ over 4 weeks (warning severity)
- [x] T046 [US4] Implement anomaly-001 template: PR count 2σ above rolling avg (info severity)
- [x] T047 [US4] Implement anomaly-002 template: PR count 2σ below rolling avg (warning severity)
- [x] T048 [US4] Implement anomaly-003 template: No PRs in 2+ weeks (critical severity)
- [x] T049 [US4] Generate docs/data/insights/summary.json with 5+ diverse insights
- [x] T050 [US4] Update docs/data/dataset-manifest.json to set features.ai_insights=true
- [x] T051 [US4] Verify AI Insights tab renders in dashboard with insight cards

**Checkpoint**: User Story 4 complete - AI Insights tab shows rule-based insights with categories and severity

---

## Phase 7: CI Workflow & Validation

**Purpose**: Non-bypassable CI checks for regeneration, schema validation, and base-path testing

### Tests

- [x] T052 [P] Create tests/demo/test_synthetic_data.py with schema validation for all JSON files
- [x] T053 [P] Add date range coverage test: verify 260 weeks from 2021-W01 to 2025-W52 in tests/demo/test_synthetic_data.py
- [x] T054 [P] Add entity count verification: 3 orgs, 8 projects, 20 repos, 50 users in tests/demo/test_synthetic_data.py
- [x] T055 [P] Create tests/demo/test_regeneration.py to generate twice and assert byte-identical output
- [x] T056 [P] Create tests/demo/test_base_path.py to serve docs/ on local HTTP server and verify zero 404s

### CI Workflow

- [x] T057 Create .github/workflows/demo.yml with Python 3.11 and Node 22 setup
- [x] T058 Add job 1: regenerate - runs generate-demo-data.py, generate-demo-predictions.py, generate-demo-insights.py
- [x] T059 Add job 2: diff-check - runs git diff --exit-code docs/ and fails if any changes
- [x] T060 Add job 3: size-check - verifies docs/ directory size < 50 MB
- [x] T061 Add job 4: base-path-serve - serves docs/ from subpath and curls all assets
- [x] T062 Configure trigger: PRs touching scripts/generate-*, extension/ui/*, docs/**
- [x] T063 Verify CI workflow has no override/skip flags (non-bypassable per SC-009)

**Checkpoint**: CI workflow validates regeneration, size cap, and base-path correctness

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, documentation, and cleanup

- [x] T064 Run python scripts/generate-demo-data.py && git diff --exit-code docs/data/ to verify byte-identical regeneration
- [x] T065 Run pytest tests/demo/ to verify all tests pass
- [x] T066 Verify docs/ directory size < 50 MB with du -sh docs/ (current: ~1.6 MB)
- [x] T067 Test dashboard locally: python -m http.server 8080 --directory docs/ and verify all features
- [x] T068 [P] Update specs/018-github-pages-demo/quickstart.md with final commands and validation steps
- [x] T069 [P] Document demo data versioning policy in docs/DEMO-DATA-VERSIONING.md per FR-019 (backward-compatible changes only, explicit versioning for breaking changes)
- [x] T070 Measure page load time with curl timing: curl -w "%{time_total}" -o /dev/null -s http://localhost:8080/ and verify < 3 seconds per SC-001
- [x] T071 Verify synthetic data banner is visible and states data is illustrative only
- [x] T072 Final validation: all acceptance scenarios from spec.md pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - US1 and US2 must complete before US3 and US4 (US3/US4 depend on generated data)
  - US3 and US4 can proceed in parallel after US1/US2
- **CI Workflow (Phase 7)**: Depends on all user stories being complete
- **Polish (Phase 8)**: Depends on CI workflow being complete

### User Story Dependencies

- **User Story 1 (P1)**: Depends on Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Depends on US1 entities/utilities - Enhances data quality
- **User Story 3 (P3)**: Depends on US1/US2 weekly rollups - Generates forecasts
- **User Story 4 (P3)**: Depends on US1/US2 weekly rollups - Generates insights

### Within Each User Story

- Data generation before file output
- File output before manifest updates
- Build script before dashboard testing
- Core implementation before integration testing

### Parallel Opportunities

- T003, T004 can run in parallel (different files)
- T006, T007 can run in parallel (different functions)
- T019 can run in parallel with T013-T018 (different files)
- T031, T040 can run in parallel (different scripts)
- T052-T056 can all run in parallel (different test files)

---

## Parallel Example: Phase 2 Foundational

```bash
# Launch utility functions in parallel:
Task: "Implement deterministic random initialization with seed=42 in scripts/generate-demo-data.py"
Task: "Implement UUID v5 generation helper with DNS namespace in scripts/generate-demo-data.py"

# Then entity generators (must be sequential due to dependencies):
Task: "Implement SyntheticOrganization generator..."
Task: "Implement SyntheticProject generator..."  # depends on orgs
Task: "Implement SyntheticRepository generator..."  # depends on projects
Task: "Implement SyntheticUser generator..."
```

---

## Parallel Example: User Story 3 & 4

```bash
# After US1/US2 complete, US3 and US4 can start in parallel:

# Developer A: User Story 3 (Predictions)
Task: "Create scripts/generate-demo-predictions.py..."
Task: "Generate docs/data/predictions/trends.json..."

# Developer B: User Story 4 (Insights)
Task: "Create scripts/generate-demo-insights.py..."
Task: "Generate docs/data/insights/summary.json..."
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Dashboard renders with charts and data
5. Demo: Basic dashboard with 5 years of data, banner visible

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add User Story 1 → Test dashboard renders → MVP Demo!
3. Add User Story 2 → Test data variation → Enhanced realism
4. Add User Story 3 → Test Predictions tab → Forecasts visible
5. Add User Story 4 → Test AI Insights tab → Insights visible
6. Add Phase 7 CI → Automated validation
7. Polish → Production ready

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Developer A: User Story 1 (dashboard build)
3. Developer B: User Story 2 (data enhancement)
4. Once US1/US2 complete:
   - Developer A: User Story 3 (predictions)
   - Developer B: User Story 4 (insights)
5. Team completes CI workflow and polish together

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify byte-identical regeneration after any data generation change
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
