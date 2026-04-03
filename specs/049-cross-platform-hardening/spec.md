# 049: Cross-Platform Developer Workflow Hardening

**Issue:** #242
**Status:** Architecture locked, implementation-ready
**Date:** 2026-04-03

---

## Goal

Make Windows, macOS, and Linux local developer workflows equally smooth
without weakening any existing quality gates or CI parity guarantees.

---

## Architectural Decisions

### AD-1: Hook entry point — keep thin sh wrappers

The `.husky/pre-commit` and `.husky/pre-push` sh wrappers stay as-is.

**Rationale:**
- Husky v9.1.7 requires sh files
- Git for Windows provides `/bin/sh` via Git Bash (see INV-1 below)
- The wrappers are 13-16 lines doing one thing: resolve Python, `exec` into
  `run_repo_hook.py`
- All platform friction lives *below* these wrappers, in the Python layer
- Husky v10 migration (which supports non-sh hooks) is a separate concern

**Consequence:** The hook architecture is `sh -> Python`. That boundary is
frozen for this issue. All cross-platform work happens inside Python scripts.

### AD-2: ACL health check — port from PowerShell to Python

Replace `scripts/check-git-acl-health.ps1` with pure Python in
`run_repo_hook.py`.

**Contract:**
- Write-probe to `.git/` and any `.pytest-tmp*` directories
- Runs only on `os.name == "nt"` (unchanged platform guard)
- On failure: prints `[acl-health]` prefixed messages with path and error
- On success: prints `[acl-health] Filesystem probe passed`
- `resolve_powershell()` function and all PowerShell invocation code removed
- The `.ps1` file is deleted, not left as dead code

**Rollback:** One git revert restores the PS1 path. The probe logic is 61
lines of simple filesystem ops — Python equivalent is straightforward.

### AD-3: build-demo.sh — replace with Python entry point

Create `scripts/build_demo.py` as a cross-platform replacement for
`scripts/build-demo.sh`.

**Determinism invariant:** The Python replacement MUST produce an identical
artifact set (file names + file contents) as the sh version. Verification:
run both, diff the `docs/` tree. This is a blocking acceptance criterion
before the `.sh` file is deleted.

**Contract:**
- Resolves Python 3.12 using the same cascade as `run_pr_preflight.py`
- Steps: install extension deps -> run `build-demo-dataset.py` -> verify output
- Replaces `find` / `wc` / `du` / `cut` with `pathlib` / `os.walk`
- Replaces Bash arrays and here-strings with Python lists
- Exit code 0 on success, non-zero on failure
- Prints the same human-readable progress output

### AD-4: Python resolution — per-script contracts, not consolidation

The three Python resolution implementations have intentionally different
semantics. They are NOT consolidated.

| Context | Requirement | Cascade |
|---------|-------------|---------|
| Shell wrappers (`.husky/`) | Any Python 3 | `py -3` -> `python3` -> `python` |
| PR preflight | Python >= 3.12 | `sys.executable` -> `PR_PREFLIGHT_PYTHON` env -> `py -3.12` -> `python3.12` -> `python3` -> `python` |
| CI parity | Exact version | `sys.executable` -> `CI_PARITY_PYTHON_X_Y` env -> `py -X.Y` -> `pythonX.Y` -> `python3` -> `python` |
| build_demo.py (new) | Python 3.12 | Same as PR preflight |

**Windows-specific fix:** The `py -3` launcher is FIRST in all cascades.
This is critical because bare `python` is often not on PATH on Windows even
with Python installed. The Windows Python Launcher (`py.exe`) is installed
by default with Python for Windows and is the reliable entry point.

### AD-5: Error categorization — SETUP / INFRA / GATE

Introduce structured error categories in `run_pr_preflight.py` and
`run_repo_hook.py`.

| Category | Prefix | Exit code | Degraded-mode | Meaning |
|----------|--------|-----------|---------------|---------|
| SETUP | `[SETUP]` | 2 | Always fatal | Machine not ready |
| INFRA | `[INFRA]` | 3 | Skippable | Network / environment |
| GATE | `[GATE]` | 1 | Always fatal | Code quality regression |

**SETUP failures** (missing tool / capability):
- Python not found or wrong version
- pnpm not found
- Node.js not found
- `.husky/` directory missing
- `pre-commit` not found
- Git for Windows not installed (no sh available)

**INFRA failures** (environment / network):
- `git fetch origin/main` failed
- Suppression baseline unavailable from remote
- Node child-process check failed
- gitleaks not found

**GATE failures** (code quality regression):
- All quality checks (mypy, pytest, ESLint, suppressions, coverage, etc.)
- Propagated subprocess exit codes from quality tools

**Message format:**
```
[SETUP] pnpm not found on PATH.
  Install: https://pnpm.io/installation
  Required for: Extension type checking, linting, and testing
```

```
[GATE] Extension lint failed (exit code 1)
  Command: pnpm run lint
  Fix: Run 'cd extension && pnpm run lint' to see details
```

### AD-6: CI-only shell deps — explicitly out of scope

If a developer never runs it locally, it does not need porting.

| Script | Scope | Action |
|--------|-------|--------|
| `.github/scripts/validate-ci-guards.sh` | CI-only | Stays as-is |
| `.github/scripts/check-npm-commands.sh` | CI-only | Stays as-is |
| `.husky/_/husky.sh` | Husky infrastructure | Stays as-is |
| `scripts/build-demo.sh` | Local developer | Replaced by Python |
| `scripts/check-ui-bundle-sync.sh` | Dead code | Deleted |

---

## Setup Invariants

### INV-1: Git for Windows (with Git Bash) is REQUIRED

On Windows, Git for Windows must be installed with the Git Bash component.
This provides the `/bin/sh` that Husky hooks require.

This is a **SETUP invariant**, not an assumption. If `sh` is not available,
the hook entry point fails immediately with:

```
[SETUP] Git Bash (sh) not found. Install Git for Windows with Git Bash.
  Required for: Git hook execution (Husky)
  Install: https://git-scm.com/download/win
```

**Enterprise note:** In locked-down environments where Git Bash cannot be
installed, developers must use `python scripts/run_repo_hook.py pre-commit`
and `python scripts/run_repo_hook.py pre-push` directly. This is documented
as the manual fallback, not the default path.

### INV-2: Python 3.12+ with `py` launcher on Windows

The Windows Python Launcher (`py.exe`) is the primary resolution mechanism
on Windows. It is installed by default with Python for Windows. If neither
`py -3` nor `python` resolves, the error must say:

```
[SETUP] Python 3 not found.
  Windows: Install from https://python.org (ensures py launcher)
  macOS/Linux: Install python3 via package manager
  Required for: All local quality gates
```

### INV-3: Required toolchain (documented, enforced)

| Tool | Version | Required for | SETUP-fatal if missing |
|------|---------|--------------|----------------------|
| Git (with Git Bash on Windows) | any | Hooks, version control | Yes |
| Python | >= 3.12 | All Python gates | Yes |
| Node.js | 22 | Extension gates | Yes (authoritative) / No (degraded) |
| pnpm | 9.15.0 | Extension deps, hooks | Yes |
| pre-commit | any | Formatting/linting hooks | Yes |
| gitleaks | any | Secret scanning | No (degraded-skippable) |
| Playwright chromium | auto-installed | Smoke tests | Auto-installed via postinstall |

---

## Degraded Mode Contract

### What degraded mode IS

A diagnostic-only run when CI-hard infrastructure is temporarily unavailable
(offline, broken Node, missing gitleaks). Activated via
`--allow-local-degraded` (preflight) or `ADO_HOOK_ALLOW_LOCAL_DEGRADED=1`
(hooks).

### What degraded mode is NOT

- Permission to skip quality gates
- A weaker local enforcement mode
- Acceptable for pre-push validation

### Loud end-of-run summary (MANDATORY)

Degraded mode MUST print a consolidated summary block at the end of the run,
not just inline warnings. This prevents silent masking of skipped gates.

```
============================================================
  DEGRADED MODE: 3 CI-hard gate(s) were SKIPPED
============================================================
  - Suppression main-baseline gate (INFRA: git fetch failed)
  - Extension Jest CI (INFRA: Node child-process broken)
  - Secret scan (INFRA: gitleaks not found)

  These gates WILL be enforced by CI. This run is
  non-authoritative and must not be treated as local/CI parity.
============================================================
```

**Exit code in degraded mode:** 0 (to allow diagnostic completion), but the
summary block is impossible to miss.

### Classification of suppression baseline

Missing suppression baseline is classified as **INFRA** (skippable in
degraded mode) because it requires network access to `git fetch origin/main`.
However, the loud summary ensures this is never silently masked.

---

## Acceptance Criteria — Per-OS Parity Checklist

A developer on a fresh clone must pass every row on all three platforms:

| # | Action | Windows | macOS | Linux | Gate |
|---|--------|---------|-------|-------|------|
| 1 | `pnpm install` | Git Bash sh available | native sh | native sh | Husky hooks installed |
| 2 | `python -m venv .venv` + activate + `pip install -e .[dev]` | `.venv\Scripts\activate` | `source .venv/bin/activate` | `source .venv/bin/activate` | Python env ready |
| 3 | `cd extension && pnpm install` | Playwright auto-installs | Playwright auto-installs | Playwright auto-installs | Extension deps ready |
| 4 | `git commit` (staged changes) | No PowerShell needed | Same hooks | Same hooks | Pre-commit passes |
| 5 | `pytest` | Platform-conditional collection | All tests | All tests | Tests pass |
| 6 | `python scripts/run_pr_preflight.py` | No Bash needed, no PS needed | Same command | Same command | Full preflight passes |
| 7 | `python scripts/build_demo.py` | No Bash needed | Same command | Same command | Demo artifacts identical |
| 8 | `git push` | Preflight runs inside hook | Same | Same | Pre-push passes |
| 9 | Missing tool | `[SETUP]` with install URL | Same format | Same format | Actionable error, not noise |

**"No PowerShell needed"** = ACL health check ported to Python,
`resolve_powershell()` eliminated from hook path.

**"No Bash needed"** = `build-demo.sh` replaced by `build_demo.py`;
`check-ui-bundle-sync.sh` deleted (dead code).

---

## Test Requirements

### T-1: ACL probe unit test

Add test in `tests/unit/test_hook_guards.py` that exercises the Python ACL
write-probe. On non-Windows: verifies the function is a no-op. On Windows:
verifies probe logic against a temp directory.

### T-2: build_demo.py determinism test

Add test that runs `build_demo.py` and verifies the output artifact set
matches the expected file names and structure. This can be a subset of the
existing `tests/demo/` suite, but must explicitly cover the new entry point.

### T-3: Hook entrypoint integration test (CI)

Add a CI job (or extend an existing one) that runs `.husky/pre-commit`
end-to-end with a staged no-op change. This catches regressions in the
sh -> Python invocation chain that unit tests cannot cover.

**Contract:**
- Runs on all 3 OS in the CI matrix
- Stages a trivial change (e.g., whitespace in a non-gate file)
- Invokes `.husky/pre-commit` via `sh .husky/pre-commit`
- Asserts exit code 0
- Verifies `[pre-commit]` output appeared (hook actually ran, not a no-op)

### T-4: Error category tests

Add tests that verify:
- Missing Python -> exit code 2, message contains `[SETUP]`
- Missing pnpm -> exit code 2, message contains `[SETUP]`
- Failed quality gate -> exit code 1, message contains `[GATE]`
- Degraded mode summary block appears when gates are skipped

---

## Implementation Phases

| Phase | Deliverable | Risk | Depends on | Tests |
|-------|-------------|------|------------|-------|
| P1 | `scripts/build_demo.py` — cross-platform Python replacement | Medium | -- | T-2 |
| P2 | ACL health check ported to Python in `run_repo_hook.py`; delete `.ps1` | Low | -- | T-1 |
| P3 | Delete dead `scripts/check-ui-bundle-sync.sh` | Trivial | -- | -- |
| P4 | Structured error categories (SETUP/INFRA/GATE) in `run_pr_preflight.py` | Medium | -- | T-4 |
| P5 | Structured error categories in `run_repo_hook.py` + degraded summary block | Medium | P4 | T-4 |
| P6 | Hook entrypoint integration test in CI | Low | P2 | T-3 |
| P7 | Documentation: setup invariants, toolchain contract, env vars | Low | P1-P6 | -- |

P1, P2, P3 are independent and can run in parallel.
P4 defines the error contract; P5 applies it to hooks.
P6 requires P2 (ACL port) to be complete so the test covers the new path.
P7 comes last and documents the final state.

---

## Out of Scope

- Husky v10 upgrade (separate issue)
- CI-only shell script porting (`.github/scripts/*.sh`)
- Replacing Husky with a different hook manager
- Making `--allow-local-degraded` the default
- Changing CI quality thresholds or gate logic
- Activation syntax differences (`source` vs `Scripts\activate`) — documented, not automated

---

## Files Changed (Expected)

| File | Action |
|------|--------|
| `scripts/build_demo.py` | **New** — cross-platform demo builder |
| `scripts/build-demo.sh` | **Deleted** after P1 determinism verification |
| `scripts/check-ui-bundle-sync.sh` | **Deleted** (dead code) |
| `scripts/check-git-acl-health.ps1` | **Deleted** after P2 port |
| `scripts/run_repo_hook.py` | **Modified** — Python ACL probe, remove PS dependency, error categories |
| `scripts/run_pr_preflight.py` | **Modified** — error categories, degraded summary block |
| `tests/unit/test_hook_guards.py` | **Modified** — ACL probe test |
| `tests/unit/test_build_demo.py` | **New** — determinism test for build_demo.py |
| `.github/workflows/ci.yml` | **Modified** — hook entrypoint integration test |
| `CONTRIBUTING.md` | **Modified** — toolchain contract, setup invariants |
| `docs/development/setup.md` | **Modified** — platform requirements |

---

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| Demo output diverges between .sh and .py | Diff-level comparison before deleting .sh; test T-2 |
| ACL probe misses a Windows edge case | PS1 in git history for revert; probe is simple tempfile write |
| Hook entrypoint breaks on one OS | T-3 integration test runs on all 3 OS in CI matrix |
| Error categories break existing automation | Exit code 1 (GATE) is unchanged for quality failures; only SETUP(2) and INFRA(3) are new |
| Python resolution fails on fresh Windows | `py -3` is first in cascade; INV-2 documents the contract |
