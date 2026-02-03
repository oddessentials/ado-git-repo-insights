# Feature Specification: Spec-Task Coverage Gap Resolution

**Feature Branch**: `021-spec-task-coverage-gaps`
**Created**: 2026-02-01
**Status**: Draft
**Input**: User description: "Design a comprehensive implementation plan that addresses the root causes of spec analysis consistency gaps including missing type enforcement, smoke tests, edge case tests, and other coverage issues in an enterprise-grade, well-tested, deterministic way."

## Clarifications

### Session 2026-02-01

- Q: What is the primary target surface area for this spec? → A: TypeScript/extension only - gates apply to `extension/` directory per existing 001 spec. Python/SQLite backend is out of scope.
- Q: Which type test harness mechanism should be used? → A: Use `tsc` with `// @ts-expect-error` annotations in dedicated `.type-test.ts` files. No additional dependencies required.
- Q: Which browser automation tool for smoke tests? → A: Playwright - pinned version, built-in static server to avoid CORS/file:// issues, deterministic headless execution, screenshot artifacts.
- Q: What naming convention for edge case test IDs? → A: `EC-001` through `EC-005` pattern (matches FR/SC convention) for spec-to-test traceability.
- Q: Where should pinned tool versions be documented? → A: `extension/package.json` (pinned deps including Playwright) + `extension/TOOLING.md` (human reference doc with versions + commands). CI enforces via `packageManager` field and lockfile.
- Q: Does this project run CI on Azure DevOps in addition to GitHub Actions? → A: GitHub Actions only - no ADO CI pipeline exists or is planned. Artifact upload uses `actions/upload-artifact` exclusively.
- Q: Should coverage be a gate for this feature's new tests? → A: Rely on existing project-wide thresholds in jest.config.ts - no additional coverage gate. Coverage ratcheting already enforced by `pnpm test:ci`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Type Safety Enforcement with Fail-on-Regression Tests (Priority: P1)

A developer working on the `001-fix-filter-prcount-sum` feature needs ironclad assurance that TypeScript types enforce the `BreakdownEntry` structure. Rather than relying on human review, the system must include both positive and negative compile-time tests that automatically fail if types regress.

**Why this priority**: Type enforcement is foundational to preventing the original bug from recurring. Human review is fallible; automated compile-time tests that MUST fail on misuse provide deterministic regression protection.

**Independent Test**: Can be fully tested by running `pnpm run test:types` which compiles dedicated `.type-test.ts` files:
- A positive test confirming `Rollup.by_repository` and `Rollup.by_team` are typed as `Record<string, BreakdownEntry>`
- A negative test using `// @ts-expect-error` that asserts type misuse is caught (compilation exits 0 when expected errors occur)

**Acceptance Scenarios** (note: with `@ts-expect-error`, exit code 0 = all expected errors were produced):

1. **Given** a positive type test that accesses `pr_count` from a `BreakdownEntry`, **When** `pnpm run test:types` runs, **Then** compilation succeeds with exit code 0
2. **Given** a negative type test with `// @ts-expect-error` before assigning `BreakdownEntry` to a `number`, **When** `pnpm run test:types` runs, **Then** exit code 0 (the expected error was produced, annotation satisfied)
3. **Given** the type regression occurs (e.g., `by_repository` changed to `Record<string, number>`), **When** `pnpm run test:types` runs, **Then** exit code non-zero because `@ts-expect-error` annotation is now unused (expected error did not occur)
4. **Given** a positive test has a type error, **When** `pnpm run test:types` runs, **Then** exit code non-zero because compilation failed

---

### User Story 2 - Deterministic Smoke Test with Pass/Fail Artifact (Priority: P1)

A QA engineer or developer needs to verify filter functionality in the demo environment using a repeatable, scriptable procedure that produces a reviewable pass/fail artifact (screenshot or log file). Manual "eyeball verification" is not acceptable for enterprise-grade quality.

**Why this priority**: The original bug (`[object Object]` display) was a runtime integration failure. A deterministic smoke test with documented procedure, required fixture, and artifact output ensures non-ambiguous, reviewable results.

**Independent Test**: Can be fully tested by running a single canonical smoke test script that:
1. Uses a specified test fixture dataset
2. Opens the demo in a browser (headless or headed)
3. Executes filter selections
4. Captures a screenshot or DOM snapshot as artifact
5. Exits with pass (0) or fail (non-zero) based on Total PRs value validation

**Acceptance Scenarios**:

1. **Given** the smoke test script and required fixture dataset exist, **When** the script executes, **Then** it produces a pass/fail exit code and a screenshot artifact in a designated output directory
2. **Given** the demo displays `[object Object]` in Total PRs, **When** the smoke test runs, **Then** it exits with failure code and the screenshot shows the invalid display
3. **Given** the demo displays a valid numeric value in Total PRs, **When** the smoke test runs, **Then** it exits with success code and the screenshot confirms the valid display
4. **Given** the smoke test produces artifacts, **When** a reviewer examines them, **Then** they can unambiguously determine pass/fail without re-running the test

---

### User Story 3 - Exhaustive Edge Case Test Coverage (Priority: P1)

A developer needs guaranteed coverage of ALL documented edge cases with explicit unit tests. "Explicit coverage preferred" is replaced with "explicit coverage REQUIRED" - each edge case must have a dedicated test that asserts both numeric correctness and absence of runtime errors.

**Why this priority**: Edge case coverage prevents subtle bugs. Implicit coverage is unacceptable; each edge case must be traceable to a specific test case that verifies behavior.

**Independent Test**: Can be fully tested by running the edge case test suite and verifying:
- One test exists per documented edge case
- Each test asserts the expected numeric result
- Each test asserts no runtime errors (no exceptions thrown)

**Acceptance Scenarios** (each maps to named test ID):

1. **[EC-001]** **Given** edge case `pr_count: NaN`, **When** the dedicated test runs, **Then** it asserts result equals 0 AND asserts no exception was thrown
2. **[EC-002]** **Given** edge case `pr_count: "50"` (string), **When** the dedicated test runs, **Then** it asserts result equals 0 (filtered by type guard) AND asserts no string coercion occurred (defense-in-depth: type guard rejects non-conformant types before toFiniteNumber processes values)
3. **[EC-003]** **Given** edge case `pr_count: Infinity`, **When** the dedicated test runs, **Then** it asserts result equals 0 AND asserts no exception was thrown
4. **[EC-004]** **Given** edge case `pr_count: -Infinity`, **When** the dedicated test runs, **Then** it asserts result equals 0 AND asserts no exception was thrown
5. **[EC-005]** **Given** edge case with mixed valid/invalid dataset `[{pr_count: 10}, {pr_count: NaN}, {pr_count: "20"}, {pr_count: Infinity}]`, **When** the dedicated test runs, **Then** it asserts result equals 10 (only valid finite number contributes; strings filtered by type guard, non-finite → 0) AND asserts each entry was processed independently

---

### User Story 4 - Quality Gates as Phase Blockers (Priority: P1)

A project lead needs assurance that no phase can proceed unless all quality gates pass. Tests are the gate, not an afterthought - each phase checkpoint must explicitly require passing TypeScript compilation, unit tests, and smoke tests before advancement.

**Why this priority**: Enterprise-grade quality requires gates that block progression on failure. Without explicit phase blockers, quality checks become optional "nice-to-haves" that get skipped under time pressure.

**Independent Test**: Can be fully tested by reviewing tasks.md and confirming each phase checkpoint includes explicit "gate must pass" criteria with documented commands.

**Acceptance Scenarios**:

1. **Given** Phase 2 (Type Verification) completes, **When** the checkpoint is evaluated, **Then** it requires TypeScript compilation to pass before Phase 3 can begin
2. **Given** Phase 5 (Edge Case Tests) completes, **When** the checkpoint is evaluated, **Then** it requires all edge case tests to pass before Phase 6 can begin
3. **Given** Phase 6 (Integration) completes, **When** the checkpoint is evaluated, **Then** it requires smoke test to pass and produce artifact before Phase 7 can begin
4. **Given** any quality gate fails, **When** attempting to proceed to next phase, **Then** the failure is documented and advancement is blocked until gate passes

---

### Edge Cases

- What happens when the type test suite infrastructure does not exist? The first task must create the test harness before running type tests.
- What happens when the smoke test browser automation encounters CORS or file:// protocol issues? The smoke test must document environment prerequisites and distinguish setup errors from test failures.
- What happens when a breakdown entry has both valid and invalid `pr_count` values in the same dataset? The mixed dataset test must verify each entry is processed independently and only valid values contribute to the sum.
- What happens when edge case tests pass individually but fail when run together? The test suite must run edge cases both in isolation and as a batch to catch state leakage.

## Requirements *(mandatory)*

### Functional Requirements

#### Type Safety Requirements
- **FR-001**: Tasks.md MUST include a task to create a type test file that verifies `Rollup.by_repository` and `Rollup.by_team` are typed as `Record<string, BreakdownEntry>`
- **FR-002**: Tasks.md MUST include a task to create a negative type test using `// @ts-expect-error` that asserts misusing `BreakdownEntry` as a number triggers a type error
- **FR-003**: The type test suite MUST have a dedicated `pnpm run test:types` command (NOT piggybacked on `build:check`) that runs `tsc --noEmit` on `.type-test.ts` files only
- **FR-004**: Type tests MUST exit non-zero if `@ts-expect-error` annotations become unused (regression detection via TS2578)
- **FR-030**: Tasks.md MUST include a task to create `tsconfig.type-tests.json` that includes only `tests/**/*.type-test.ts` files
- **FR-031**: Tasks.md MUST include a task to add `"test:types": "tsc --noEmit --project tsconfig.type-tests.json"` to `extension/package.json` scripts
- **FR-032**: Tasks.md MUST include a task to create a "type test harness validation" test that intentionally breaks a type and verifies the gate fails

#### Smoke Test Requirements
- **FR-005**: Tasks.md MUST include a task to create a Playwright-based smoke test script with documented single canonical procedure
- **FR-006**: The smoke test MUST use fixture dataset at `docs/data/rollup.json` with minimum required schema: `{ weekly_rollups: [{ by_repository: Record<string, {pr_count: number}>, by_team: Record<string, {pr_count: number}> }] }`
- **FR-007**: The smoke test MUST produce a screenshot artifact in `extension/test-artifacts/smoke/` on BOTH pass and fail (always emitted)
- **FR-008**: The smoke test MUST exit with code 0 on pass, non-zero on fail
- **FR-009**: The smoke test MUST validate Total PRs displays a finite numeric value (not `[object Object]`, `NaN`, `Infinity`, or empty)
- **FR-021**: The smoke test MUST use Playwright's `webServer` config to start a local static server on port 3000 for `docs/` directory; no manual server startup allowed
- **FR-022**: The smoke test MUST use ONLY `data-testid` selectors; CSS class/text selectors are forbidden
- **FR-023**: Smoke test artifacts MUST be uploaded in CI via `actions/upload-artifact` for post-run review
- **FR-033**: Tasks.md MUST include a task to add `data-testid="total-prs"` to the Total PRs DOM element in the demo UI
- **FR-034**: Tasks.md MUST include a task to add `data-testid="filter-repository"` and `data-testid="filter-team"` to filter controls
- **FR-035**: The smoke test MUST validate fixture file exists and matches minimum schema BEFORE browser launch, failing fast with clear error if missing/malformed
- **FR-036**: The static server MUST bind to port 3000 deterministically and shut down cleanly after test completion (Playwright webServer handles this)

#### Edge Case Test Requirements
- **FR-010**: Tasks.md MUST include one explicit test task per documented edge case, mapped by ID: EC-001 (NaN), EC-002 (string), EC-003 (Infinity), EC-004 (-Infinity), EC-005 (mixed dataset)
- **FR-011**: Each edge case test MUST assert the expected numeric result as specified in the EC-### acceptance scenario
- **FR-012**: Each edge case test MUST assert absence of runtime errors (no exceptions thrown)
- **FR-013**: Edge case tests MUST be runnable via `pnpm test:unit -- --testPathPattern=metrics.edge-cases.test.ts` (pinned file path)
- **FR-024**: Each test case MUST include a comment `// Covers EC-###: <description>` in the test body
- **FR-025**: Edge case tests MUST run both individually AND as a batch to detect state leakage; batch execution order MUST be deterministic
- **FR-037**: Tasks.md MUST include a task to create a meta-test or lint rule that scans `metrics.edge-cases.test.ts` and fails if any EC-001..EC-005 is missing or duplicated
- **FR-038**: The EC-### traceability check MUST run as part of `pnpm test:ci` and block merges if coverage gaps exist

#### Quality Gate Requirements
- **FR-014**: Tasks.md MUST include a "Quality Gates / Definition of Done" section defining phase advancement criteria
- **FR-015**: Each phase checkpoint MUST list the specific commands to run and expected outputs
- **FR-016**: Phase advancement MUST be blocked if any gate fails (documented as explicit dependency)
- **FR-017**: Quality gate failures MUST produce clear error messages identifying which gate failed and why

#### Task Structure Requirements
- **FR-018**: All new tasks MUST follow existing task numbering conventions (T###, [P] for parallel, [US#] for user story reference)
- **FR-019**: Task additions MUST preserve existing task dependencies and checkpoint structure
- **FR-020**: Each task MUST include clear completion criterion with command to run and expected output

#### Tooling & Reproducibility Requirements
- **FR-026**: Playwright MUST be added as a pinned devDependency in `extension/package.json` (exact version, not range)
- **FR-027**: Tasks.md MUST include a task to create `extension/TOOLING.md` documenting: Node version, pnpm version, Playwright version, and canonical CI commands
- **FR-028**: CI MUST enforce reproducible installs via `pnpm install --frozen-lockfile` (already present in CI workflow)
- **FR-029**: All test assertions MUST be deterministic; timing-based waits and flaky selectors are forbidden

### Key Entities

- **Task**: A discrete unit of work with subject, description, completion criteria, dependencies, and user story association
- **BreakdownEntry**: A data structure containing `pr_count` (numeric), `avg_cycle_time` (numeric), and other metrics for a filtered grouping
- **Rollup**: The top-level data structure containing `totals`, `by_repository`, `by_team`, and other aggregated metrics
- **Type Test**: A compile-time test that verifies type correctness; includes both positive (should compile) and negative (should fail compilation) cases
- **Smoke Test**: A deterministic end-to-end verification with scriptable procedure, required fixture, and pass/fail artifact output
- **Edge Case Test**: A unit test that verifies system behavior at boundary conditions, asserting both numeric correctness and absence of runtime errors
- **Quality Gate**: A phase checkpoint that must pass before advancement; includes documented command, expected output, and blocking behavior on failure
- **Test Artifact**: A reviewable output from test execution (screenshot, log, DOM snapshot) that provides non-ambiguous evidence of pass/fail

## Quality Gates / Definition of Done *(mandatory)*

### Gate 1: Type Compilation Gate
- **Trigger**: Before advancing from Phase 2 (Type Verification) to Phase 3
- **Requirement**: TypeScript compilation MUST pass with zero errors
- **Command**: `pnpm run build:check` in `extension/` directory
- **Expected Output**: Exit code 0, no error messages
- **Failure Action**: Document errors, fix type issues, re-run until pass

### Gate 2: Type Test Gate
- **Trigger**: Before advancing from Phase 2 to Phase 3
- **Requirement**: All type tests (positive and negative) MUST produce expected results
- **Command**: `pnpm run test:types` in `extension/` directory (dedicated command, NOT piggybacked on `build:check`)
- **Script**: `tsc --noEmit --project tsconfig.type-tests.json` targeting only `tests/**/*.type-test.ts` files
- **Mechanism**: Exit code 0 means: (1) positive tests compiled without error, (2) all `@ts-expect-error` annotations were satisfied (expected errors occurred)
- **Exit code non-zero means**: (1) positive test has type error, OR (2) `@ts-expect-error` annotation is unused (type regression - expected error did not occur)
- **Failure Action**: Check tsc output for "error TS2578: Unused '@ts-expect-error'" (regression) or other type errors (broken test)

### Gate 3: Unit Test Gate
- **Trigger**: Before advancing from Phase 5 (Edge Case Tests) to Phase 6
- **Requirement**: All unit tests including edge cases MUST pass
- **Command**: `pnpm test:unit` in `extension/` directory (runs all unit tests including `metrics.edge-cases.test.ts`)
- **Pinned Test Files**: `extension/tests/modules/metrics.test.ts`, `extension/tests/modules/metrics.edge-cases.test.ts`
- **Expected Output**: Exit code 0, all tests pass (coverage enforcement is handled by existing jest.config.ts thresholds, not this gate)
- **Failure Action**: Document failing tests, fix implementation or test, re-run

### Gate 4: Smoke Test Gate
- **Trigger**: Before advancing from Phase 6 (Integration) to Phase 7
- **Requirement**: Smoke test MUST pass and produce artifact
- **Command**: `pnpm run test:smoke` in `extension/` directory
- **Harness**: Playwright (pinned version) starts local static server for `docs/`, navigates to demo, applies filters, captures screenshot
- **Expected Output**: Exit code 0, screenshot artifact in `extension/test-artifacts/smoke/` (uploaded in CI), Total PRs DOM text is finite number
- **Failure Action**: Screenshot captured on both pass AND fail; review artifact to diagnose; fix and re-run

### Gate 5: Full Suite Gate
- **Trigger**: Before marking feature complete
- **Requirement**: All gates (1-4) MUST pass in sequence
- **Command**: `pnpm test:ci` in `extension/` directory
- **Expected Output**: Exit code 0, all tests pass, all artifacts generated
- **Failure Action**: Identify failing gate, remediate, re-run full suite

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Tasks.md grows from 23 tasks to 30+ tasks with explicit coverage for all identified gaps including type tests, smoke tests, and edge case tests
- **SC-002**: 100% of functional requirements (FR-001 through FR-038) have at least one corresponding task in tasks.md
- **SC-003**: Type test suite includes at least 2 positive and 2 negative compile-time tests
- **SC-004**: Smoke test produces screenshot artifact on every run (pass or fail)
- **SC-005**: 5 explicit edge case tests exist (NaN, Infinity, -Infinity, string coercion, mixed dataset) each asserting numeric result AND absence of runtime errors
- **SC-006**: All 5 quality gates are documented with commands and expected outputs
- **SC-007**: Cross-artifact consistency analysis (spec.md, plan.md, tasks.md) returns zero critical (C) or medium (M) issues after remediation
- **SC-008**: Zero manual verification steps without accompanying deterministic validation alternative

## Assumptions

- The existing `001-fix-filter-prcount-sum` feature branch and spec files are the target for these task additions
- The `toFiniteNumber()` utility already handles NaN, Infinity, and string coercion correctly; tests document and verify this behavior
- Browser automation for smoke tests uses Playwright (pinned version in package.json) in headless mode; smoke test script starts a local static server to serve `docs/` and avoids `file://` protocol entirely
- The test fixture dataset for smoke tests will be a static JSON file committed to the repository
- Task numbering follows the pattern established in the existing tasks.md (sequential, with sub-tasks like T006b)
- Type testing will use `tsc` with `// @ts-expect-error` annotations in dedicated `.type-test.ts` files; negative tests MUST use `@ts-expect-error` which fails compilation if the expected error disappears (regression detection)
- Screenshot artifacts will be stored in `extension/test-artifacts/` directory (git-ignored locally, uploaded as CI artifacts for review)
- Node 22 and pnpm 9.15.0 are the canonical CI environment (already enforced via `packageManager` field and CI workflow)
- Coverage thresholds are enforced by existing `jest.config.ts` ratchet policy; this spec does not add feature-specific coverage gates
