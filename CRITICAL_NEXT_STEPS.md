## 🔴 Critical — Fix Immediately

0. root tsconfig.json has syntax errors.

1. **Fix missing `project_name` in PR thread extraction**
    - Update the SQL query in `cli.py` (lines 443–449) to include `project_name` in the SELECT clause.
    - Replace the `config.projects[0]` fallback at line 468 with `pr_row["project_name"]` so multi-project runs behave correctly.
    - Remove the related TODO comment once fixed.

2. **Stop silently swallowing database exceptions**
    - Replace all bare `except Exception:` blocks in `aggregators.py` (lines ~773–854) with handlers that log the exception at DEBUG level.
    - Preserve existing fallback behavior, but ensure real DB issues (corruption, locks, permissions) are observable in logs.

---

## 🟠 High Priority — Housekeeping That Affects Correctness or Clarity

3. **Remove or ignore stale VSIX artifact**
    - Delete `extension/OddEssentials.ado-git-repo-insights-5.9.0.vsix` or add it to `.gitignore`.
    - Ensure only artifacts matching the current release version (5.20.1+) remain in-repo.

4. **Resolve duplicate spec numbering**
    - Renumber one of the `specs/009-*` directories to eliminate the numeric collision.
    - Update any internal references so spec ordering is deterministic and unambiguous.

5. **Resolve real TODOs that indicate known gaps**
    - `cli.py:468`: Remove the TODO after fixing the `project_name` bug.
    - `performance.test.ts:7`: Either implement the mocked DatasetLoader fetch tests or remove the TODO if the test is intentionally deferred.

---

## 🟡 Medium Priority — Noise Reduction and Signal Quality

6. **Clean up actual unused variables flagged by ESLint**
    - Remove or intentionally underscore unused parameters in:
        - `dashboard.ts` (lines 139, 158, 232, 1476)
        - `dataset-loader.ts` (lines 36, 623)

    - Do not change interface method parameter names; those are intentional and should remain.

7. **Re-evaluate `--stub-mode` and remove if obsolete**
    - If no production or CI path depends on `--stub-mode`, remove the flag and its wiring from `cli.py` and `aggregators.py`.
    - If it must exist for tests, restrict it to test-only code paths and remove user-facing warnings.

---

## 🟢 Low Priority — Structural Improvements (Non-Blocking)

8. **Reduce `dashboard.ts` orchestration density**
    - Split orchestration logic into smaller modules only if doing so does not change runtime behavior or test coverage.
    - This is a refactor-only task; no new features or behavior changes.

---

### Final Note

No security regressions were found. The primary risks are **one real correctness bug** and **exception masking**. Everything else is cleanup that improves maintainability and signal quality without expanding scope.
