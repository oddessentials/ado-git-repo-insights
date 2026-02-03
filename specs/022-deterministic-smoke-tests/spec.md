# Feature Specification: Deterministic Smoke Tests

**Feature Branch**: `022-deterministic-smoke-tests`
**Created**: 2026-02-02
**Status**: Draft
**Input**: “Remove all `waitForTimeout` usage from smoke tests and replace with condition-based waits on stable `data-testid` selectors. Replace `networkidle` waits with explicit DOM-state assertions. Make Playwright test artifact paths collision-proof. Document and enforce pinned Playwright upgrade cadence. Eliminate ad-hoc deep cloning utilities and use `structuredClone`. Add compile-time-only comments to type-test files. Re-run full gate chain with artifacts as evidence.”

---

## 1. Scope

### 1.1 In-Scope

This feature applies to the **TypeScript extension** test surface only:

- `extension/tests/smoke/**` (Playwright smoke tests)
- `extension/playwright.config.ts`
- `extension/package.json` (pinned deps + scripts)
- `extension/TOOLING.md` (policy + reproducibility)
- `extension/tests/types/**` (type tests: comment + enforcement gate)
- `extension/tests/**` (replace any ad-hoc deep clone utilities with `structuredClone`)

### 1.2 Out-of-Scope

- Python/SQLite/CSV backend tooling
- Product features of the dashboard beyond what is required to support deterministic selectors and deterministic waits
- Performance SLAs / timing-based pass/fail requirements

---

## 2. Non-Negotiable Determinism Invariants

These are **hard constraints** for this feature:

1. **No time-based sleeps**: `page.waitForTimeout()` is forbidden.
2. **No `networkidle` waits**: `page.waitForLoadState("networkidle")` is forbidden.
3. **Selectors are a contract**: smoke tests must use **`data-testid` selectors exclusively** (no `.class`, no `#id`).
4. **All wait timeouts are centralized**: a single exported constant `SMOKE_TIMEOUT_MS` must be used; literals are forbidden.
5. **Artifacts cannot collide**: screenshots must use `testInfo.outputPath()` exclusively.
6. **No runtime downloads in gate paths**: `npx` is forbidden in any gate path; only pinned deps or repo scripts are allowed.
7. **No ad-hoc deep clone utilities**: use `structuredClone()` only.
8. **Type tests are compile-time-only**: must be labeled clearly and must never be imported by runtime code paths; CI must enforce.

---

## 3. Definitions

- **Smoke Test**: Playwright test (`*.smoke.ts`) verifying end-to-end UI behavior in the demo dashboard.
- **Condition-Based Wait**: Waits that depend on DOM conditions (visible/attached/text pattern), not elapsed time.
- **Stable Selector**: `data-testid="..."` attribute used exclusively for test targeting.
- **Artifact**: Screenshots or other debug evidence produced by smoke tests and uploaded in CI.
- **Gate Chain**: `pnpm test:ci` sequence: `build:check → test:types → unit tests → test:smoke`.

---

## 4. Required Selectors (Locked Contract)

Smoke tests must rely on these exact `data-testid` values:

- `total-prs`
- `filter-repository`
- `filter-team`
- `error-generic`
- `error-setup-required`

If the UI cannot provide these selectors, the UI must be updated to do so. Smoke tests must not “work around” missing selectors.

---

## 5. User Scenarios & Testing (Mandatory)

### User Story 1 — Flaky Wait Elimination (P1)

As a CI maintainer, I need all smoke tests to use condition-based waits instead of hardcoded timeouts so tests are deterministic and do not randomly fail due to timing variance.

**Independent Test**: Run `pnpm test:ci` **3 times consecutively**; results are identical. `grep` confirms zero `waitForTimeout` in smoke tests.

**Acceptance Scenarios**

1. Given a smoke test file uses `waitForTimeout(1000)`, when refactored, then it uses condition-based waits on `data-testid` selectors.
2. Given an error state is expected, when malformed data is processed, then the test waits for `[data-testid="error-generic"]` or `[data-testid="error-setup-required"]` to be visible.
3. Given the smoke test suite, when `grep -r "waitForTimeout" extension/tests/smoke/` runs, then zero matches are returned.

---

### User Story 2 — Explicit DOM-State Waits (P1)

As a test author, I need filter action tests to wait for explicit DOM state changes instead of `networkidle` so tests don’t hang or pass early.

**Independent Test**: Run smoke tests under throttling (slow 3G). Tests pass based on DOM readiness, not network silence.

**Acceptance Scenarios**

1. Given a repository filter selection, when applied, then the test captures prior `[data-testid="total-prs"]` text and waits until it **changes** and matches `/^\d+$/`.
2. Given a team filter selection, when applied, then the test waits for the `<select>` element to reflect the chosen value and waits for `[data-testid="total-prs"]` to update accordingly.
3. Given the smoke suite, when `grep -r "networkidle" extension/tests/smoke/` runs, then zero matches are returned.

---

### User Story 3 — Collision-Proof Artifact Paths (P2)

As a CI operator, I need screenshot artifacts written to unique paths so parallel execution or reruns do not overwrite evidence.

**Independent Test**: Run smoke tests with `--workers=2`. Artifacts remain unique and non-overwriting.

**Acceptance Scenarios**

1. Given a screenshot is captured, when `page.screenshot()` is called, then the path is `testInfo.outputPath(filename)` (no hardcoded paths).
2. Given multiple Playwright projects run, when executed, then artifacts are stored in per-project bases and per-test unique subpaths.
3. Given CI artifact upload runs, then it captures the entire directory tree under `extension/test-artifacts/smoke/`.

---

### User Story 4 — Playwright Version Policy (P2)

As a maintainer, I need a documented and enforced policy for Playwright upgrades so pinning doesn’t become silent tech debt.

**Independent Test**: `TOOLING.md` documents policy; CI rejects caret/range Playwright versions.

**Acceptance Scenarios**

1. Given `extension/TOOLING.md`, when opened, then it includes a “Playwright Version Policy” with quarterly cadence and a PR checklist.
2. Given `extension/package.json`, when checked, then `@playwright/test` uses an **exact** pinned version (e.g., `"1.40.0"`) and not `^` or `~`.
3. Given a PR introduces caret/range for Playwright, when CI runs, then a validation step fails with a clear error.

---

### User Story 5 — Standardized Deep Cloning (P3)

As a test author, I need a single standardized deep cloning method so tests are maintainable and correct for special numeric values.

**Independent Test**: No custom deep clone functions exist; `structuredClone` is used.

**Acceptance Scenarios**

1. Given `metrics.edge-cases.test.ts`, when refactored, then all cloning uses `structuredClone()` and custom deep clone helpers are removed.
2. Given data includes `NaN`, `Infinity`, `-Infinity`, when cloned, then those values are preserved correctly.
3. Given `extension/tests/`, when `grep -r "deepClone" extension/tests/` runs, then zero custom function implementations remain.

---

### User Story 6 — Type Test Compile-Time Contract (P3)

As a developer, I need type-test files clearly marked compile-time-only and enforced so they’re never imported by runtime.

**Independent Test**: Type-test files include the header comment; CI enforces no runtime imports.

**Acceptance Scenarios**

1. Given `extension/tests/types/*.type-test.ts`, when opened, then the header contains:
   “COMPILE-TIME ONLY: This file must never be imported by runtime code paths.”
2. Given files under `extension/ui/`, when scanned, then no imports reference `extension/tests/types/`.
3. Given CI runs, when the meta-test executes, then it fails with a clear error if any forbidden import exists.

---

### User Story 7 — Gate Chain Validation (P1)

As a release manager, I need proof the full gate chain passes deterministically with artifacts as evidence.

**Independent Test**: Run `pnpm test:ci` (3 consecutive runs) and confirm artifacts exist and upload succeeds.

**Acceptance Scenarios**

1. Given a clean checkout, when `pnpm test:ci` runs, then `build:check → test:types → unit tests → test:smoke` all pass.
2. Given smoke tests complete, when artifacts are uploaded, then screenshots for positive and negative projects exist.
3. Given the suite is repeated 3 times, then results are identical across runs.

---

## 6. Requirements (Mandatory)

### 6.1 Smoke Test Determinism Requirements

- **FR-001**: Smoke tests MUST use condition-based waits (`expect().toBeVisible()`, `waitForSelector`, `waitForFunction`) and MUST NOT use `waitForTimeout`.
- **FR-002**: Smoke tests MUST NOT use `networkidle`.
- **FR-003**: Smoke tests MUST use `data-testid` selectors exclusively; CSS class selectors and ID selectors are forbidden.
- **FR-004**: For filter interactions, smoke tests MUST detect **state change**:
    - Capture prior `[data-testid="total-prs"]` text
    - Wait until text differs AND matches `/^\d+$/`

- **FR-005**: `[data-testid="total-prs"]` MUST match `/^\d+$/` after settled states (digits only, including `"0"`).
- **FR-006**: Error-state smoke tests MUST wait for one of:
    - `[data-testid="error-generic"]` visible OR
    - `[data-testid="error-setup-required"]` visible

### 6.2 Timeout Requirements

- **FR-007**: All smoke test waits MUST use `SMOKE_TIMEOUT_MS` imported from `extension/tests/smoke/constants.ts`.
- **FR-008**: Ad-hoc timeout literals (e.g., `{ timeout: 5000 }`) are forbidden in smoke tests.
- **FR-009**: `extension/tests/smoke/constants.ts` is the sole location for smoke timeout constants; no other timeout constants are allowed.

### 6.3 Artifact Requirements

- **FR-010**: All screenshots MUST be written using `testInfo.outputPath(filename)` exclusively.
- **FR-011**: Playwright config MUST define a per-project `outputDir` base; test code MUST rely on `testInfo.outputPath` for final uniqueness.
- **FR-012**: CI MUST upload the entire `extension/test-artifacts/smoke/` tree (all projects, all tests).

### 6.4 Reproducibility Requirements

- **FR-013**: `npx` is forbidden in any gate path (local or CI). web servers MUST be launched via pinned devDependencies or repo scripts.
- **FR-014**: The smoke test web server MUST be invoked via a repo script (e.g., `pnpm run serve:docs`) and MUST not download packages at runtime.
- **FR-015**: Playwright MUST remain pinned to an exact version in `extension/package.json`.

### 6.5 Playwright Upgrade Policy Requirements

- **FR-016**: `extension/TOOLING.md` MUST document a quarterly Playwright upgrade cadence and PR checklist.
- **FR-017**: CI MUST fail if `@playwright/test` uses caret/tilde/range syntax.

### 6.6 Deep Clone Requirements

- **FR-018**: Custom deep clone helpers in tests MUST be removed and replaced with `structuredClone()`.
- **FR-019**: Test data used with `structuredClone()` MUST not contain functions (tests must not depend on cloning functions).

### 6.7 Type-Test Safety Requirements

- **FR-020**: Type-test files MUST include a compile-time-only header comment.
- **FR-021**: CI MUST fail if any file under `extension/ui/` imports from `extension/tests/types/`.

---

## 7. Success Criteria (Mandatory)

- **SC-001**: `grep -r "waitForTimeout" extension/tests/smoke/` returns zero matches.
- **SC-002**: `grep -r "networkidle" extension/tests/smoke/` returns zero matches.
- **SC-003**: All smoke test screenshots use `testInfo.outputPath()`; no hardcoded paths remain.
- **SC-004**: All smoke tests import and use `SMOKE_TIMEOUT_MS`; no timeout literals exist in smoke tests.
- **SC-005**: All smoke test selectors are `data-testid`-based; no `.foo` or `#bar` selectors exist in smoke tests.
- **SC-006**: No custom deep clone helpers exist under `extension/tests/`; `structuredClone` is used.
- **SC-007**: All type-test files contain the “COMPILE-TIME ONLY” header comment.
- **SC-008**: CI meta-test passes: no imports from `extension/tests/types/` anywhere under `extension/ui/`.
- **SC-009**: `pnpm test:ci` passes **3 consecutive runs** with identical results.
- **SC-010**: Smoke artifacts exist after runs and are uploaded in CI for both positive and negative projects.
- **SC-011**: Playwright version remains exactly pinned; CI fails on caret/tilde/range.

---

## 8. Clarifications (Locked Decisions)

### Session 2026-02-02

- Timing SLA requirement removed entirely (no pass/fail on wall-clock time).
- `testInfo.outputPath()` is mandatory and exclusive for artifacts.
- `[data-testid="total-prs"]` must match `/^\d+$/`.
- Smoke tests use `data-testid` selectors exclusively; CSS/ID selectors forbidden.
- `SMOKE_TIMEOUT_MS` is centralized; literals forbidden.
- Filter waits require change detection (prior value → new value that matches pattern).
- `npx` forbidden in gate paths; use pinned deps or repo scripts.
- `SMOKE_TIMEOUT_MS` must live only in `extension/tests/smoke/constants.ts`.
- CI must enforce: `extension/ui/**` must not import from `extension/tests/types/**`.

---

## 9. Assumptions

- Node.js 22 is used (global `structuredClone` exists).
- The UI provides the required `data-testid` selectors as a stable contract.
- The docs demo updates `total-prs` deterministically after filter selection.
- Playwright remains pinned; upgrades occur by policy, not ad-hoc.

---

## 10. Notes on Enforceability (This Spec Must Be Testable)

This spec is intentionally designed so every “MUST” can be enforced via one of:

- a deterministic test (`jest` / Playwright),
- a CI meta-test,
- or a grep-based check that fails the build with a clear message.

No requirement depends on “developer discipline” alone.
