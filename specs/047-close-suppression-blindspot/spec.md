# Feature Specification: Close Suppression Audit Blind Spot

**Feature Branch**: `047-close-suppression-blindspot`
**Created**: 2026-04-01
**Status**: Draft
**Input**: User description: "Close the suppression audit blind spot (#232) — expand audit to scripts/, tests/, .github/scripts/ and resolve all ~112 suppressions to reach baseline 0"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Audit Scanner Produces Trusted Counts (Priority: P1)

As a project maintainer, before any suppression cleanup work begins, I need the audit scanner to produce accurate counts — distinguishing real suppression comments from suppression-like patterns inside string literals and docstrings — so that the suppression census driving all planning decisions is trustworthy.

**Why this priority**: The audit scanner currently uses line-level regex matching. Test fixture files (notably `test_audit_suppressions.py`) embed `# noqa` patterns inside string literals as test data. If the scanner scope is expanded before it can distinguish real from phantom suppressions, every count, baseline, and gate decision will be built on untrusted data. This must be fixed first.

The scanner MUST be hardened using one of two approaches:
- **Option A (AST-based)**: Replace regex line scanning with Python's `ast` or `tokenize` module to parse each file. Only match suppression patterns that appear in `COMMENT` tokens, never in `STRING` tokens or other non-comment contexts.
- **Option B (Explicit cases + failing tests)**: Keep regex scanning but explicitly define which string-literal patterns are supported and add failing regression tests for each unsupported case. Document the known limitations and ensure every known false-positive source in the codebase has a corresponding test.

Either approach must produce identical counts for files with no string-literal edge cases. The choice affects correctness guarantees: Option A is structurally correct; Option B is pragmatically bounded.

**Independent Test**: Create a Python file containing both a real `# noqa` on a code line and a `# noqa` inside a string literal. Run the audit scanner. Confirm only the real suppression is counted.

**Acceptance Scenarios**:

1. **Given** a Python file contains `write_text("x = 1  # noqa: E501\n")`, **When** the audit scanner processes the file, **Then** the pattern inside the string literal is not counted as a suppression.
2. **Given** a Python file contains a docstring mentioning `# type: ignore`, **When** the audit scanner processes the file, **Then** the pattern inside the docstring is not counted as a suppression.
3. **Given** a Python file contains both a real `# noqa` on a code line and a test string containing `# noqa`, **When** the audit scanner processes the file, **Then** only the real suppression is counted.
4. **Given** the scanner has been hardened against false positives, **When** the full audit is run against the expanded scope, **Then** the resulting count becomes the verified census — and only this verified count is used for planning cleanup work.
5. **Given** Option B is chosen, **When** a new string-literal edge case is discovered that the scanner misclassifies, **Then** a failing regression test MUST be added before the fix, proving the gap existed and is now closed.

---

### User Story 2 - Every Python File Is Audited (Priority: P1)

As a developer, I need every `.py` file in the repository to be covered by exactly one audit scope — no file can fall through the cracks by being placed in an unscoped directory. When I add a suppression comment to any Python file, the audit catches it.

**Why this priority**: The blind spot in `scripts/`, `tests/`, and `.github/scripts/` exists because the scope list was manually maintained and incomplete. A coverage check that enumerates all `.py` files and asserts each belongs to exactly one scope closes this class of gap permanently — including for directories that don't exist yet.

**Independent Test**: Add a new `.py` file in a directory not covered by any scope. Run the coverage check. Confirm it fails, naming the uncovered file.

**Acceptance Scenarios**:

1. **Given** the audit tool includes a file-coverage check, **When** the check enumerates all `.py` files in the repository (excluding configured exclusion directories like `node_modules`, `dist`, `.venv`), **Then** every file is mapped to exactly one scope. Files belonging to zero scopes cause a hard failure listing the uncovered paths.
2. **Given** a developer creates a new directory `tools/` with a `.py` file, **When** the file-coverage check runs, **Then** it fails because `tools/*.py` is not in any scope — forcing the developer to add the scope before proceeding.
3. **Given** all `.py` files are covered, **When** a developer adds `# noqa: S603` to a file in `scripts/`, **Then** the audit diff reports a suppression increase and the pre-commit hook fails.
4. **Given** all `.py` files are covered, **When** a developer adds `# type: ignore` to a file in `tests/`, **Then** the audit diff reports a suppression increase and the CI gate fails.
5. **Given** the audit baseline includes all scopes, **When** no suppressions exist in any scoped directory, **Then** the audit reports baseline 0 and all gates pass.

---

### User Story 3 - All Existing Suppressions Resolved Via Two-Phase Gating (Priority: P1)

As a project maintainer, I need all existing suppression comments in the previously unscanned directories to be eliminated through proper code refactoring — not by adding per-file-ignores, not by relaxing linting rules indiscriminately, and not by removing useful lint rules. Each suppression class must be resolved by addressing its root cause, and the resolution must prevent the anti-pattern from recurring.

A two-phase gating strategy allows the expanded scope to be deployed immediately without breaking all gates:
- **Phase 1 (non-blocking)**: The expanded audit runs in all entry points but reports the new scopes as warnings, not failures. The existing 3 scopes remain blocking. This lets the team see the real count and track progress without halting development.
- **Phase 2 (blocking)**: Once the verified census reaches zero for all new scopes, the audit switches to blocking enforcement for all 6 scopes. The switch is a single configuration change (baseline update), not a code change.

**Why this priority**: Expanding the audit scope without resolving existing suppressions would break all gates immediately if enforcement is blocking from day one. Two-phase gating decouples "visibility" from "enforcement" so cleanup can proceed incrementally while the gate protects against new regressions in already-clean scopes. The exact suppression count will be established by the verified census from User Story 1.

**Independent Test**: Run the linter and type checker across `scripts/`, `tests/`, and `.github/scripts/` with no inline suppression comments and confirm zero violations.

**Acceptance Scenarios**:

1. **Given** S603 suppressions exist because `subprocess.run()` with `shell=False` and hardcoded args is a false positive, **When** a full-tree verification confirms every `subprocess.run()` call in the repository uses `shell=False` with hardcoded list arguments (not user-supplied input), **Then** the S603 `# noqa` comments are removed. The rule disable MUST be accompanied by a compensating guardrail (see FR-014). **Reintroduction prevention**: the guardrail script detects any new `subprocess.run` call with `shell=True` or non-literal args — this is the enforcement mechanism, not S603 itself.
2. **Given** S105 suppressions exist because test variables named `*token*` are pagination continuation values (not passwords), **When** the variables are renamed to non-triggering names, **Then** all S105 `# noqa` comments are removed with no functional change. **Reintroduction prevention**: S105 remains enabled — any future variable named `*token*` with a string literal will be caught by the linter directly. No additional mechanism needed.
3. **Given** `type:ignore[attr-defined]` suppressions exist because tests create dynamic module objects with attributes the type checker cannot verify, **When** typed fake module classes are introduced as shared test fixtures, **Then** all `type:ignore[attr-defined]` comments are removed and strict type checking passes. **Reintroduction prevention**: `mypy --strict` is the enforcement mechanism — `ModuleType` does not declare custom attributes, so any future `fake_module.Foo = ...` without a typed subclass fails type checking. A regression test MUST be added that creates an untyped `ModuleType`, assigns an attribute, and asserts mypy rejects it.
4. **Given** S311 suppressions exist because `random.Random(seed)` is used for deterministic synthetic data (not cryptography), **When** a full-tree verification confirms zero cryptographic usage of the `random` module across the repository, **Then** the S311 `# noqa` comments are removed. The rule disable MUST be accompanied by a compensating guardrail (see FR-014). **Reintroduction prevention**: the guardrail script detects `import secrets`, `os.urandom`, or unseeded `random.Random()` — this is the enforcement mechanism, not S311 itself.
5. **Given** E402/I001 suppressions exist because scripts manipulate the module search path before importing project modules, **When** the scripts are refactored to use dynamic import resolution or rely on the installed package, **Then** all E402/I001 `# noqa` comments and associated `type:ignore[import-*]` comments are removed, AND no `sys.path.insert` calls remain in any script. **Reintroduction prevention**: a lint rule or grep-based CI check MUST be added that fails if `sys.path.insert` or `sys.path.append` appears in any `.py` file outside `conftest.py`. A regression test MUST assert this check catches a simulated violation.
6. **Given** N817 suppressions exist because `defusedxml.ElementTree` is aliased as `ET`, **When** the files are refactored to import specific functions directly, **Then** all N817 `# noqa` comments are removed. **Reintroduction prevention**: N817 remains enabled — any future CamelCase alias is caught by the linter directly. No additional mechanism needed.
7. **Given** `type:ignore[assignment]` suppressions exist because a stdlib I/O class lacks `fileno()`, **When** a typed subclass is introduced as a shared test fixture, **Then** all `type:ignore[assignment]` comments are removed and strict type checking passes. **Reintroduction prevention**: `mypy --strict` is the enforcement mechanism — assigning `fileno = lambda: 0` to a `StringIO` instance fails type checking without the typed subclass. A regression test MUST be added that attempts the untyped pattern and asserts mypy rejects it.
8. **Given** remaining minor suppression classes (F841, F401, ANN, S310, S607, S110, `type:ignore[arg-type]`), **When** each is resolved through targeted refactoring, **Then** all inline suppression comments are removed with no regressions. **Reintroduction prevention**: for each class, the existing linter rule or type checker is the enforcement mechanism (the rules remain enabled). No additional mechanism needed for classes where the original rule stays active.

---

### User Story 4 - Gate Parity Across All Entry Points (Priority: P2)

As a CI/CD operator, I need the expanded suppression audit to be enforced identically across all entry points — pre-commit hooks, local preflight, and CI workflows — with an explicit, testable guarantee that local and CI run the exact same scope list, so that no path allows a suppression to slip through by file placement.

**Why this priority**: The project enforces local/CI parity as a constitutional guarantee. If `scripts/`, `tests/`, and `.github/scripts/` are not audited, a developer can bypass any suppression gate simply by placing code in an unscanned directory. The scope list must be the single source of truth, and parity must be mechanically verified — not assumed from "same script" reasoning.

**Independent Test**: Extract the scope list from the audit tool and from CI configuration. Assert they are identical. Then add a suppression to a file in each new scope, run both local pre-commit and the CI gate command, and confirm both detect it.

**Acceptance Scenarios**:

1. **Given** the audit tool defines the scope list as a single authoritative constant, **When** new scopes are added, **Then** pre-commit hooks, local preflight, and CI all inherit the expanded scope without separate configuration changes.
2. **Given** the baseline file includes all scopes, **When** a developer runs the local preflight script, **Then** the suppression audit step validates all scopes including the newly added ones.
3. **Given** a suppression is added to a file in `scripts/`, **When** the pre-commit hook runs locally AND the CI suppression-audit job runs, **Then** both detect the increase and fail — proving no path-placement bypass exists.
4. **Given** the audit scope list is defined once in the audit tool, **When** a parity test compares the local and CI scope lists, **Then** they are identical — no scope is configured in one entry point but not another.

---

### User Story 5 - Rule Disabling With Deterministic Proof and Specified Guardrails (Priority: P2)

As a security-conscious reviewer, I need any lint rule disabled globally to be justified with a machine-readable, committed full-tree audit artifact — not a one-time manual review. CI must verify this artifact before allowing the rule disable. Once disabled, fully specified compensating guardrails must run in both local and CI using the same entry point.

**Why this priority**: Disabling S603 based solely on "`src/` has zero `subprocess.run()` calls" is insufficient — the very directories being audited for the first time (`scripts/`, `tests/`, `.github/scripts/`) are the ones with subprocess calls. A manual review is not repeatable. A committed artifact + CI verification makes the proof deterministic and auditable.

**Independent Test**: After disabling a rule, verify the proof artifact exists and is current. Then add a `subprocess.run(user_input, shell=True)` call to `src/`. Confirm both the guardrail and S602 catch it. Run the guardrail locally and in CI — confirm identical results.

**Acceptance Scenarios**:

1. **Given** S603 is proposed for global disable, **When** the full-tree audit generates a machine-readable artifact listing every `subprocess.run()` call site with its arguments, shell mode, and safety classification, **Then** the artifact is committed to the repository and CI verifies it is current and all call sites are classified as safe before the rule disable is accepted.
2. **Given** S311 is proposed for global disable, **When** the full-tree audit generates a machine-readable artifact listing every `random` module usage with its purpose classification, **Then** the artifact is committed and CI-verified under the same process.
3. **Given** S603 is disabled with a compensating guardrail, the guardrail MUST specify:
   - **Directories scanned**: all directories containing `.py` files (full tree, not just `src/`)
   - **Pattern detected**: `subprocess.run(` with `shell=True`, or with a non-literal first argument (variable, function call, f-string)
   - **Failure condition**: any match causes a hard failure with file path, line number, and the offending pattern
   - **Entry point**: a single script callable by both local pre-commit/preflight and CI — not separate implementations
4. **Given** S311 is disabled with a compensating guardrail, the guardrail MUST specify:
   - **Directories scanned**: all directories containing `.py` files (full tree)
   - **Pattern detected**: `import secrets`, `os.urandom`, or `random.SystemRandom` in any file that also imports `random`; or `random.Random()` without a seed argument
   - **Failure condition**: any match causes a hard failure with file path, line number, and the offending pattern
   - **Entry point**: same single script as above
5. **Given** a globally disabled rule has a compensating guardrail, **When** a developer adds code that violates the safety invariant, **Then** the guardrail fails identically in both local pre-commit and CI — no path allows the violation to pass one but not the other.

---

### Edge Cases

- What happens when a new Python directory is added to the repo (e.g., `tools/`)? The scope list must be manually updated — document this as a maintenance requirement. The parity test (FR-015) will catch if a new directory contains Python files not covered by any scope.
- What happens when a `# noqa` comment disables multiple rules on one line (e.g., `# noqa: E402, I001`)? The scanner already handles this — it counts as one noqa suppression with multiple rules extracted.
- What happens when the linter adds new rules that flag existing code? The zero-baseline policy means any new violation must be fixed immediately, not suppressed.
- What happens when a script import refactor changes the module resolution order? Tests must validate that the refactored scripts produce identical output to the originals.
- What happens when a variable rename for S105 conflicts with another variable name in scope? Each rename must be checked for uniqueness within its function/method scope.
- What happens when someone adds a `subprocess.run()` call to `src/` after S603 is globally disabled? The compensating guardrail (FR-014) catches it — the CI check verifies that no unsafe subprocess patterns exist in production code.
- What happens when someone introduces `import secrets` alongside `import random` after S311 is globally disabled? The compensating guardrail (FR-014) catches it — the CI check verifies that no cryptographic usage of random exists.
- What happens when the verified census (FR-013) reveals a different count than the preliminary ~112? The cleanup plan adjusts to the verified count. All planning artifacts reference the verified census, not the preliminary estimate.
- What happens when a developer creates a new fake module in tests without using the typed pattern? The type checker catches it — `ModuleType` does not declare custom attributes, so `mypy --strict` fails without the typed subclass (root cause contract — FR-016). A regression test proves this.
- What happens during Phase 1 if a developer adds a NEW suppression to a new-scope file? The non-blocking audit warns but does not fail. This is acceptable because Phase 1 is a visibility phase — the team can see the increase. Phase 2 enforcement blocks it.
- What happens if the full-tree audit artifact becomes stale (e.g., a new subprocess call is added but the artifact is not regenerated)? CI compares the artifact against the actual codebase and fails if they diverge — the artifact must be regenerated and recommitted.
- What happens if the scanner is hardened via Option B (explicit cases) and a new string-literal edge case is found later? A failing regression test is added first, then the scanner is extended. The test proves the gap existed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The suppression audit tool MUST scan all Python files in `scripts/`, `tests/`, and `.github/scripts/` in addition to the existing `src/`, `extension/ui/`, and `extension/tests/` scopes.
- **FR-002**: The suppression baseline MUST be zero for every scope, including the three newly added scopes.
- **FR-003**: All existing `# noqa` and `# type: ignore` comments in the newly scoped directories MUST be eliminated through code refactoring before the scope expansion is gated.
- **FR-004**: The linter configuration MAY disable rules globally (added to the `ignore` list) only when the rule is provably a false positive across the entire codebase. Each global disable MUST be accompanied by documented evidence.
- **FR-005**: Per-file-ignores MUST NOT be used as a resolution strategy. All fixes MUST be code-level refactors or justified global rule configuration changes.
- **FR-006**: The audit scanner MUST NOT count suppression-like patterns inside Python string literals or docstrings as real suppressions.
- **FR-007**: Every intermediate commit during the migration MUST pass all existing gates (linter, type checker, test suite, suppression audit) — no temporary relaxations.
- **FR-008**: The expanded audit MUST be enforced in all existing entry points (pre-commit hooks, local preflight, CI workflows) through the single authoritative audit script — no separate configuration per entry point.
- **FR-009**: The linter configuration MUST retain the rule detecting `subprocess` calls with `shell=True` (S602) even when the `shell=False` subprocess rule (S603) is disabled, ensuring actual injection risks remain caught.
- **FR-010**: All `type:ignore` removals MUST pass strict type checking with zero regressions.
- **FR-011**: Variable renames to resolve S105 false positives MUST preserve the semantic meaning of the test (pagination continuation tokens) while avoiding the pattern that triggers the rule.
- **FR-012**: The suppression baseline file MUST be regenerated to include the new scopes and their zero counts after all suppressions are resolved.
- **FR-013**: The scanner MUST be hardened against string-literal and docstring false positives BEFORE the suppression census is used for planning. The preliminary count (~112) is untrusted until the hardened scanner produces a verified census. All cleanup planning MUST use the verified count.
- **FR-014**: Every globally disabled lint rule MUST have a compensating guardrail — a CI check that re-verifies the safety invariant on every push. If the invariant breaks (e.g., a `subprocess.run()` call with user-supplied input appears in production code, or cryptographic usage of `random` is introduced), the guardrail MUST fail the build. The guardrail check MUST be a separate, explicit verification — not dependent on the disabled rule itself.
- **FR-015**: The audit scope list MUST be defined once in the audit tool and mechanically verified to be identical across local pre-commit, local preflight, and CI. A parity test MUST assert that no scope exists in one entry point but not another.
- **FR-016**: Each architectural root-cause fix (sys.path elimination, typed test doubles, typed I/O subclass) MUST include a contract-level acceptance criterion proving the root cause is eliminated repo-wide — not just that the current suppressions are removed. The contract MUST define what "done" means: (a) zero instances of the anti-pattern remain, AND (b) re-introducing the anti-pattern is caught by an existing gate (linter, type checker, or dedicated check).
- **FR-017**: Full-tree execution-surface verification MUST be completed before any rule is disabled globally. The verification MUST include every directory in the repository — including the blind-spot directories that motivated this feature. The claim "src/ has zero calls" is necessary but not sufficient; every call site in `scripts/`, `tests/`, and `.github/scripts/` MUST also be verified safe (hardcoded args, `shell=False`).
- **FR-018**: The audit tool MUST include a file-coverage check that enumerates all `.py` files in the repository (excluding configured exclusion directories), asserts each belongs to exactly one scope, and fails with a list of uncovered paths if any file is unscoped. This check MUST run in both local pre-commit/preflight and CI.
- **FR-019**: The expanded audit MUST support two-phase gating: Phase 1 runs the new scopes in non-blocking (warning) mode while existing scopes remain blocking; Phase 2 switches all scopes to blocking once the verified census reaches zero for the new scopes. The phase transition MUST be a baseline update (configuration change), not a code change.
- **FR-020**: Full-tree execution-surface verification MUST produce a machine-readable audit artifact (committed to the repository) that lists every call site for the rule being disabled, with its arguments, safety classification, and file location. CI MUST verify this artifact is current (matches the actual codebase) before allowing the rule disable to take effect.
- **FR-021**: Compensating guardrails for disabled rules MUST be fully specified: exact directories scanned, exact patterns detected, exact failure conditions, and exact output format. Guardrails MUST run from a single entry-point script callable by both local pre-commit/preflight and CI — no separate implementations.
- **FR-022**: The audit scanner MUST be hardened using either AST/tokenize-based parsing (Option A) or explicit-case regex with failing regression tests for every known false-positive source (Option B). If Option B is chosen, every unsupported edge case MUST have a documented limitation and a failing test that proves the gap existed before the fix.
- **FR-023**: For each architectural root-cause fix, the spec MUST name the exact enforcement mechanism (specific lint rule, type checker mode, or dedicated test) that prevents the anti-pattern from recurring. A regression test MUST be added that simulates reintroduction of the anti-pattern and asserts the enforcement mechanism catches it.
- **FR-024**: The type checker MUST be extended to cover `tests/` and `scripts/` as a permanent steady-state scope (not a temporary un-exclusion) BEFORE any `type:ignore` comments are removed from those directories. Without this, removals are cosmetic — no gate catches reintroduction. `.github/scripts/` is excluded from the type checker (covered by the suppression audit only). This is a prerequisite for all typed-double work.
- **FR-025**: The suppression baseline file MUST be the exact output of the audit tool's `--update-baseline` command — never hand-edited, never manually merge-conflict-resolved. CI MUST verify the committed baseline byte-matches a fresh regeneration (ignoring timestamp). If they diverge, CI MUST fail with an actionable message. This is the single source of truth that prevents silent corruption.
- **FR-026**: The file-coverage check MUST enumerate only tracked files (e.g., via `git ls-files`) to avoid false positives from generated files in gitignored directories. The full-tree coverage check MUST run in preflight and CI only. Pre-commit MUST run a staged-subset check: verify each staged `.py`/`.ts` file belongs to a known scope. The pre-commit check proves "no staged file escapes audit"; the preflight/CI check proves "every repo file is covered."
- **FR-027**: The audit scanner MUST treat tokenization failures as hard errors (exit code 1 with file path and error message), not silent skips. The error behavior MUST be identical across pre-commit, preflight, and CI — same exit code, same message format, same semantics. A silently skipped file produces a false negative — zero suppressions reported for a file that may contain them.
- **FR-028**: All scope-dependent behavior (pattern dispatch in scanning, scope routing in baseline building, file-to-scope mapping in coverage checks) MUST derive from a single canonical scope map structure. No function may define scope behavior independently or fall back to an `"unknown"` scope for tracked files. A tracked file matching zero scopes is a hard error.
- **FR-029**: The v1→v2 baseline transition fallback (missing scopes treated as advisory) MUST have an explicit exit condition: once the v2 baseline with all scopes is committed in Phase E, the fallback code path MUST be removed. After removal, a scope present in a scan but absent from the baseline is a hard error.

### Key Entities

- **Suppression**: An inline comment (`# noqa`, `# type: ignore`, etc.) that silences a linter or type checker warning. Tracked by type, rule, file, and scope.
- **Scope**: A directory-to-file-pattern mapping that defines what the audit tool scans. Currently 3 scopes; expanding to 6.
- **Baseline**: A deterministic JSON snapshot of suppression counts per scope, type, file, and rule. Used by the diff command to detect increases.
- **Suppression Class**: A grouping of suppressions by their root cause and resolution strategy. 15 classes identified in the inventory, spanning ~112 total occurrences.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The suppression audit reports zero total suppressions across all 6 scopes (3 existing + 3 new).
- **SC-002**: Every Python file in the repository is covered by exactly one audit scope — no blind spots remain.
- **SC-003**: The suppression baseline file shows zero in every `by_scope` entry, including the three new scopes.
- **SC-004**: All existing inline suppression comments (`# noqa`, `# type: ignore`) in `scripts/`, `tests/`, and `.github/scripts/` are removed from the codebase. The exact count is determined by the verified census (FR-013), not the preliminary estimate.
- **SC-005**: The linter, strict type checker, and the full test suite pass with zero errors after all suppressions are resolved.
- **SC-006**: No per-file-ignores exist in the linter configuration — all suppressions are resolved through code refactoring or justified global rule configuration.
- **SC-007**: The audit scanner correctly distinguishes real suppression comments from patterns inside string literals, producing zero false positives on the test suite.
- **SC-008**: Adding a new `# noqa` or `# type: ignore` to any Python file in any scoped directory causes the pre-commit hook and CI gate to fail immediately.
- **SC-009**: Every globally disabled lint rule has a passing compensating guardrail CI check that will fail if the safety invariant is violated by future code changes.
- **SC-010**: A scope-parity test proves that the local pre-commit, local preflight, and CI suppression audit all use the identical scope list — verified mechanically, not by inspection.
- **SC-011**: For each architectural root-cause fix, re-introducing the anti-pattern (e.g., `sys.path.insert` in a script, untyped `ModuleType` attribute assignment in a test) is caught by an existing gate without any new suppression being needed.
- **SC-012**: The verified census produced by the hardened scanner is used as the sole planning input for suppression cleanup. No cleanup work references the preliminary ~112 count as a committed target.
- **SC-013**: A file-coverage check enumerates all `.py` files and asserts each belongs to exactly one scope. Adding a `.py` file in an unscoped directory fails this check.
- **SC-014**: Two-phase gating is operational: new scopes report warnings (non-blocking) in Phase 1 and switch to blocking in Phase 2 via a baseline update — no code change required for the transition.
- **SC-015**: A machine-readable full-tree audit artifact is committed for each globally disabled rule. CI verifies the artifact matches the current codebase on every push.
- **SC-016**: Compensating guardrails for disabled rules run identically in local pre-commit/preflight and CI, from the same entry-point script. A simulated violation fails both local and CI.
- **SC-017**: For each architectural root-cause fix, a regression test exists that simulates reintroduction of the anti-pattern and asserts the named enforcement mechanism catches it.
- **SC-018**: The type checker runs on `src/`, `tests/`, and `scripts/` as the permanent steady-state scope in CI and preflight. `type:ignore` removals are verified by actual mypy invocation, not cosmetic.
- **SC-019**: CI verifies the committed baseline byte-matches a fresh regeneration (ignoring timestamp) on every push. Stale or hand-edited baselines are caught automatically. The baseline is exclusively tool-generated.
- **SC-020**: The full-tree file-coverage check uses `git ls-files` and produces zero false positives. Pre-commit runs a staged-subset check with a precisely defined contract (staged files in known scopes). Both contracts are documented.
- **SC-021**: Tokenization failures produce identical hard errors (exit code 1, same message format) across pre-commit, preflight, and CI. No file's suppressions can be invisible due to a parse failure.
- **SC-022**: All scope-dependent behavior derives from a single canonical scope map. No `"unknown"` scope fallback exists for tracked Python files.
- **SC-023**: The v1→v2 transition fallback (missing scopes as advisory) is removed after Phase E. A scope present in a scan but absent from the baseline is a hard error in steady state.

## Assumptions

- The existing suppression audit infrastructure (audit script, baseline file, CI workflow, pre-commit hooks) is stable and will be extended — not rewritten.
- The project package is installed in editable mode in the development environment, allowing dynamic import resolution to work without path manipulation.
- The `requests` library is already a project dependency and can be used to replace `urllib.request.urlopen()` calls.
- The preliminary ~112 suppression count is an estimate based on regex scanning. The true count will be established by the verified census (FR-013) after scanner hardening. Planning must not treat the estimate as committed truth.
- Disabling S603 globally is a candidate approach, not a foregone conclusion. It is only acceptable if full-tree verification (FR-017) confirms every call site is safe AND a compensating guardrail (FR-014) is in place. If verification fails for any call site, S603 must remain enabled and those call sites must be refactored individually.
- Disabling S311 globally is a candidate approach under the same conditions: full-tree verification of zero cryptographic usage AND a compensating guardrail.
- The scanner hardening approach (Option A: AST/tokenize vs Option B: explicit cases + tests) will be chosen during implementation planning. Either approach must produce zero false positives on the current test suite. Option A is structurally complete; Option B is pragmatically bounded and requires ongoing maintenance as new edge cases are discovered.
- Two-phase gating assumes that development on other features continues during the cleanup period. Phase 1 (non-blocking) prevents the expanded audit from halting unrelated work while cleanup proceeds.
- The full-tree audit artifact for rule disables is a machine-readable file (e.g., JSON) committed alongside the rule configuration change. It is not a one-time review — CI verifies it stays current.
- The 15 suppression classes identified in the pre-implementation audit represent the preliminary inventory. The verified census may reveal additional classes or different counts. All cleanup work adapts to the verified census.
