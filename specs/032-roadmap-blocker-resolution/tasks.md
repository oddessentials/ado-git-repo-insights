# Tasks: Roadmap Blocker Resolution

**Input**: Design documents from `/specs/032-roadmap-blocker-resolution/`
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`

## Phase 1: Reviewer Filters (ADO-first)

- [ ] T001 Add reviewer slice requirements to `docs/reference/dataset-contract.md`, including a new `ReviewerBreakdownEntry` contract and explicit exclusion of review-latency metrics from Phase 1.
- [ ] T002 Add `reviewed_at` design notes and migration requirements to `src/ado_git_repo_insights/persistence/models.py` planning comments or adjacent developer docs without changing runtime schema yet.
- [ ] T003 Implement reviewer dimensions and `by_reviewer` backend aggregation in `src/ado_git_repo_insights/transform/aggregators.py` using `ReviewerBreakdownEntry`.
- [ ] T004 Add reviewer aggregation coverage in `tests/unit/test_aggregators.py`, including approval-rate semantics and zero-denominator handling.
- [ ] T005 Extend frontend schema/types in `extension/ui/schemas/rollup.schema.ts` and consuming modules for `by_reviewer`.
- [ ] T006 Add reviewer filter state, dropdown wiring, and dashboard rendering in `extension/ui/modules/filters.ts`, `extension/ui/modules/metrics.ts`, and `extension/ui/dashboard.ts`.
- [ ] T007 Add reviewer UI/unit tests in `extension/tests/`.

## Phase 2: Comments Completion (ADO-first)

- [ ] T008 Add `pr_threads` and `pr_comments` CSV exports in `src/ado_git_repo_insights/persistence/models.py` and `src/ado_git_repo_insights/transform/csv_generator.py`.
- [ ] T009 Add comment aggregate generation and coverage/capped metadata in `src/ado_git_repo_insights/transform/aggregators.py`.
- [ ] T010 Extend dataset contract docs for comment aggregate output and coverage semantics.
- [ ] T011 Add dashboard comment metrics panel and trend/repository views in `extension/ui/`.
- [ ] T012 Add backend and frontend tests for comment aggregates, CSV output, and capped-coverage behavior.
- [ ] T013 Document `--include-comments`, `--comments-max-prs-per-run`, and `--comments-max-threads-per-pr` in CLI reference docs.

## Phase 3: Author Cross-Dim Follow-Through

- [ ] T014 Implement deferred author x repo cross-dimensional work once author filters are complete, reusing the `by_team_and_repo` pattern with exact intersection semantics.

## Phase 4: GitHub Platform Support (Last)

- [ ] T015 Create `GitPlatformClient` extraction abstraction and normalized transport objects.
- [ ] T016 Implement GitHub REST-first client with pagination, auth, and normalization.
- [ ] T017 Add GitHub config/CLI integration.
- [ ] T018 Add GitHub-specific tests for search cap handling, identity stability, auth, and comments collection.
- [ ] T019 Revisit GraphQL only if a concrete REST limitation remains after the REST-first implementation is working.

## Sequencing Rules

- Reviewer and comments phases may run in parallel if staffing allows.
- GitHub tasks MUST NOT start until reviewer and comments phases are complete or explicitly waived.
- GraphQL investigation MUST NOT happen before the REST-first GitHub client exists and has identified a concrete gap.
