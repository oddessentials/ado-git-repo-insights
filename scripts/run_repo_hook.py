#!/usr/bin/env python3
"""Cross-platform orchestrator for repo-owned Git hooks.

Responsibility split:
  - Pre-commit guards check STAGED files only (what's entering the repo).
  - Pre-push preflight checks the full worktree (last gate before CI).
  - CI checks the clean checkout (authoritative, full-tree policy enforcement).
"""

from __future__ import annotations

import argparse
import fnmatch
import importlib.util as _importlib_util
import json
import os
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, cast

REPO_ROOT = Path(__file__).resolve().parent.parent
EXTENSION_ROOT = REPO_ROOT / "extension"
HOOK_PREFIX = "[hook]"
PNG_MAGIC = b"\x89PNG"

# Exit code contract (AD-5):
#   GATE  = 1: Code quality regression (always fatal)
#   SETUP = 2: Machine not ready / missing tool (always fatal)
#   INFRA = 3: Network or environment issue (skippable in degraded mode)
EXIT_GATE = 1
EXIT_SETUP = 2
EXIT_INFRA = 3


def _ensure_husky_installed() -> None:
    """Fail fast if .husky/ directory is missing — hooks won't work."""
    husky_dir = REPO_ROOT / ".husky"
    if not husky_dir.is_dir():
        safe_print(f"[SETUP] .husky/ directory not found at {husky_dir}.")
        safe_print("  Install: pnpm install (at repo root)")
        safe_print("  Required for: Git hook execution")
        raise SystemExit(EXIT_SETUP)


_ensure_husky_installed()

# Load SCOPES from audit-suppressions.py for staged-subset scope check (FR-028)
_audit_spec = _importlib_util.spec_from_file_location(
    "audit_suppressions", REPO_ROOT / "scripts" / "audit-suppressions.py"
)
assert _audit_spec is not None, "audit-suppressions.py not found"
assert _audit_spec.loader is not None
_audit_mod = _importlib_util.module_from_spec(_audit_spec)
_audit_spec.loader.exec_module(_audit_mod)
AUDIT_SCOPES: dict[str, dict[str, str]] = _audit_mod.SCOPES
scan_content = _audit_mod.scan_content
validate_baseline = _audit_mod.validate_baseline
find_unjustified_suppressions = _audit_mod.find_unjustified_suppressions
compute_diff = _audit_mod.compute_diff

# Load guardrail check functions for staged-content scanning (FR-014, FR-021)
_guard_spec = _importlib_util.spec_from_file_location(
    "check_rule_disable_invariants",
    REPO_ROOT / "scripts" / "check_rule_disable_invariants.py",
)
assert _guard_spec is not None, "check_rule_disable_invariants.py not found"
assert _guard_spec.loader is not None
_guard_mod = _importlib_util.module_from_spec(_guard_spec)
_guard_spec.loader.exec_module(_guard_mod)
_check_subprocess_safety = _guard_mod.check_subprocess_safety
_check_random_safety = _guard_mod.check_random_safety
_check_syspath_safety = _guard_mod.check_syspath_safety
_auto_fix_subprocess_allowlist_line_shifts = (
    _guard_mod.auto_fix_subprocess_allowlist_line_shifts
)

if TYPE_CHECKING:
    from invariant_contracts import InvariantArtifactContract

_contracts_spec = _importlib_util.spec_from_file_location(
    "invariant_contracts",
    REPO_ROOT / "scripts" / "invariant_contracts.py",
)
assert _contracts_spec is not None, "invariant_contracts.py not found"
assert _contracts_spec.loader is not None
_contracts_mod = _importlib_util.module_from_spec(_contracts_spec)
sys.modules["invariant_contracts"] = _contracts_mod
_contracts_spec.loader.exec_module(_contracts_mod)
INVARIANT_ARTIFACT_CONTRACTS = cast(
    tuple["InvariantArtifactContract", ...],
    _contracts_mod.INVARIANT_ARTIFACT_CONTRACTS,
)


def safe_print(text: str = "") -> None:
    try:
        print(text)
    except UnicodeEncodeError:
        encoding = sys.stdout.encoding or "utf-8"
        sanitized = text.encode(encoding, errors="replace").decode(encoding)
        print(sanitized)


def render_command(command: list[str]) -> str:
    return " ".join(command)


def run_command(
    command: list[str],
    *,
    cwd: Path = REPO_ROOT,
    env: dict[str, str] | None = None,
    capture_output: bool = False,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        [*command],
        cwd=cwd,
        env=env,
        check=False,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=capture_output,
    )
    if result.returncode == 0:
        return result

    safe_print(f"{HOOK_PREFIX} command failed: {render_command(command)}")
    if result.stdout:
        safe_print(result.stdout.rstrip())
    if result.stderr:
        safe_print(result.stderr.rstrip())
    raise SystemExit(result.returncode)


def resolve_pre_commit() -> str:
    candidates = (
        shutil.which("pre-commit"),
        REPO_ROOT / ".venv" / "Scripts" / "pre-commit.exe",
        REPO_ROOT / ".venv" / "bin" / "pre-commit",
    )
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate) if not isinstance(candidate, Path) else candidate
        if path.exists():
            return str(path)
    safe_print("[SETUP] pre-commit not found.")
    safe_print("  Install: pip install pre-commit (or activate the repo virtualenv)")
    safe_print("  Required for: Formatting and linting hooks")
    raise SystemExit(EXIT_SETUP)


def _acl_write_probe(directory: Path) -> str | None:
    """Probe write access to *directory* by creating and removing a temp file.

    Returns None on success, or the error message on failure.
    Mirrors the logic of the former check-git-acl-health.ps1 script.
    """
    if not directory.is_dir():
        return None
    probe = directory / ".acl-probe.tmp"
    try:
        probe.write_text("probe", encoding="ascii")
        probe.unlink()
        return None
    except OSError as exc:
        # Clean up partial probe if write succeeded but unlink failed
        try:
            probe.unlink(missing_ok=True)
        except OSError:
            pass
        return str(exc)


def git_output(*args: str) -> str:
    result = run_command(["git", *args], capture_output=True)
    return result.stdout


def staged_paths() -> list[str]:
    output = git_output("diff", "--cached", "--name-only", "--diff-filter=d")
    return [line.strip() for line in output.splitlines() if line.strip()]


def suppression_staged_name_status() -> list[tuple[str, str, str | None]]:
    output = git_output("diff", "--cached", "--name-status", "--find-renames")
    entries: list[tuple[str, str, str | None]] = []
    for line in output.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        parts = stripped.split("\t")
        status = parts[0]
        if status.startswith("R") and len(parts) >= 3:
            entries.append((status, parts[1], parts[2]))
            continue
        if len(parts) >= 2:
            entries.append((status, parts[1], None))
    return entries


def staged_file_content(path: str) -> str | None:
    """Return the staged content of a file, or None if it cannot be read.

    Uses ``git show :path`` which accepts forward-slash paths on all platforms.
    Binary files are decoded with replacement characters — callers searching for
    text patterns will safely get no match on binary content.
    """
    result = subprocess.run(
        ["git", "show", f":{path}"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        return None
    return result.stdout


def worktree_paths(pathspec: str) -> list[str]:
    output = git_output("diff", "--name-only", "--", pathspec)
    return [line.strip() for line in output.splitlines() if line.strip()]


def modified_worktree_files() -> list[str]:
    output = git_output("diff", "--name-only")
    return [line.strip() for line in output.splitlines() if line.strip()]


def _path_matches_pathspec(path: str, pathspec: str) -> bool:
    normalized = path.replace("\\", "/")
    if pathspec.endswith("/"):
        return normalized.startswith(pathspec)
    if any(token in pathspec for token in "*?["):
        return fnmatch.fnmatch(normalized, pathspec)
    return normalized == pathspec


def _contract_matches_path(contract: InvariantArtifactContract, path: str) -> bool:
    if path == contract.artifact_path:
        return True
    return any(
        _path_matches_pathspec(path, pathspec) for pathspec in contract.input_pathspecs
    )


def _contract_staged_paths(contract: InvariantArtifactContract) -> list[str]:
    return [path for path in staged_paths() if _contract_matches_path(contract, path)]


def _contract_worktree_drift(contract: InvariantArtifactContract) -> list[str]:
    drifted: set[str] = set()
    for pathspec in (*contract.input_pathspecs, contract.artifact_path):
        drifted.update(worktree_paths(pathspec))
    return sorted(drifted)


def _verify_contract_artifact(contract: InvariantArtifactContract) -> None:
    if contract.verification_kind in {"rule-disable-s603", "rule-disable-s311"}:
        safe_print(
            f"[hook] verifying invariant artifact {contract.artifact_path} "
            f"({contract.contract_id})"
        )
        run_command(
            [
                sys.executable,
                "scripts/check_rule_disable_invariants.py",
                "--verify-artifacts",
            ]
        )
        return


def run_invariant_artifact_contract_guards(stage: str) -> None:
    for contract in INVARIANT_ARTIFACT_CONTRACTS:
        if stage not in contract.hook_stages:
            continue
        staged_relevant = _contract_staged_paths(contract)
        if not staged_relevant:
            continue
        drifted = _contract_worktree_drift(contract)
        if drifted:
            safe_print(
                f"[{stage}] invariant artifact contract {contract.contract_id} "
                "requires a clean worktree for declared inputs/artifact:"
            )
            for path in drifted:
                safe_print(f"  - {path}")
            raise SystemExit(EXIT_GATE)
        _verify_contract_artifact(contract)


def report_post_format_worktree_changes() -> None:
    files = modified_worktree_files()
    if not files:
        raise SystemExit("[pre-commit] formatting checks failed")
    safe_print("")
    safe_print("[pre-commit] formatting checks modified worktree files")
    safe_print("Stage the updated files explicitly, then re-run the commit.")
    for file_name in files:
        safe_print(f"  - {file_name}")
    raise SystemExit("[pre-commit] formatting checks changed files")


def run_acl_health_check() -> None:
    """Probe filesystem write access on Windows to detect ACL/permission issues.

    Checks .git/ and any .pytest-tmp* directories in the repo root.
    Replaces the former PowerShell script (check-git-acl-health.ps1) with a
    cross-platform Python implementation that requires no external shell.
    """
    if os.name != "nt":
        return
    safe_print("[pre-commit] checking ACL health on repo metadata")

    paths_to_check: list[Path] = [REPO_ROOT / ".git"]
    # Legacy .pytest-tmp* directories
    paths_to_check.extend(
        p
        for p in REPO_ROOT.iterdir()
        if p.is_dir() and p.name.startswith(".pytest-tmp")
    )
    # Repo-owned pytest runtime directories (.tmp/pytest/)
    # Probe parents first — launcher must mkdir under these.
    tmp_pytest = REPO_ROOT / ".tmp" / "pytest"
    runs_dir = tmp_pytest / "runs"
    for parent in (tmp_pytest, runs_dir):
        if parent.is_dir():
            paths_to_check.append(parent)
    for subdir in ("cache", "coverage"):
        candidate = tmp_pytest / subdir
        if candidate.is_dir():
            paths_to_check.append(candidate)
    failures: list[tuple[Path, str]] = []
    if runs_dir.is_dir():
        try:
            run_entries = list(runs_dir.iterdir())
        except OSError as exc:
            failures.append((runs_dir, str(exc)))
            run_entries = []
        for run_entry in run_entries:
            tmp_subdir = run_entry / "tmp"
            if tmp_subdir.is_dir():
                paths_to_check.append(tmp_subdir)
    for path in paths_to_check:
        error = _acl_write_probe(path)
        if error is not None:
            failures.append((path, error))

    if failures:
        safe_print("")
        safe_print("[acl-health] Filesystem probe failed")
        for path, issue in failures:
            safe_print(f"  - {path}: {issue}")
        safe_print("")
        safe_print(
            "[acl-health] Repair permissions on the failing path before retrying."
        )
        raise SystemExit(1)

    safe_print("[acl-health] Filesystem probe passed")


def run_pre_commit_stage() -> None:
    pre_commit = resolve_pre_commit()
    safe_print("[pre-commit] running formatting checks on staged files")
    result = subprocess.run(
        [pre_commit, "run", "--hook-stage", "pre-commit"],
        cwd=REPO_ROOT,
        check=False,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode == 0:
        safe_print("[pre-commit] formatting checks passed")
        return

    report_post_format_worktree_changes()


def _allow_local_degraded() -> bool:
    return os.environ.get("ADO_HOOK_ALLOW_LOCAL_DEGRADED", "").lower() in {
        "1",
        "true",
        "yes",
    }


def _load_authoritative_suppression_baseline() -> dict[str, object] | None:
    fetch = subprocess.run(
        ["git", "fetch", "origin", "main", "--quiet"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if fetch.returncode != 0:
        message = (
            "Could not fetch origin/main for suppression baseline. "
            "Set ADO_HOOK_ALLOW_LOCAL_DEGRADED=1 to continue in degraded mode."
        )
        if _allow_local_degraded():
            safe_print(f"[WARNING] {message} Running in degraded mode.")
            return None
        safe_print(f"[INFRA] {message}")
        raise SystemExit(EXIT_INFRA)

    result = subprocess.run(
        ["git", "show", "origin/main:.suppression-baseline.json"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0 or not result.stdout.strip():
        message = (
            "origin/main:.suppression-baseline.json is unavailable. "
            "Set ADO_HOOK_ALLOW_LOCAL_DEGRADED=1 to continue in degraded mode."
        )
        if _allow_local_degraded():
            safe_print(f"[WARNING] {message} Running in degraded mode.")
            return None
        safe_print(f"[INFRA] {message}")
        raise SystemExit(EXIT_INFRA)

    baseline = json.loads(result.stdout)
    errors = validate_baseline(baseline)
    if errors:
        safe_print("[pre-commit] authoritative suppression baseline is invalid:")
        for error in errors:
            safe_print(f"  - {error}")
        raise SystemExit(1)
    return baseline


def _resolve_staged_scope(path: str) -> str | None:
    best_scope: str | None = None
    best_len = -1
    for scope_name, scope_cfg in AUDIT_SCOPES.items():
        if not path.startswith(scope_cfg["dir"]):
            continue
        ext_match = (scope_cfg["pattern"] == "*.py" and path.endswith(".py")) or (
            scope_cfg["pattern"] == "*.ts" and path.endswith(".ts")
        )
        if not ext_match:
            continue
        if len(scope_cfg["dir"]) > best_len:
            best_scope = scope_name
            best_len = len(scope_cfg["dir"])
    return best_scope


def _scan_staged_suppressions() -> dict[str, list[dict[str, object]]]:
    results: dict[str, list[dict[str, object]]] = {}
    for path in staged_paths():
        if not (path.endswith(".py") or path.endswith(".ts")):
            continue
        scope = _resolve_staged_scope(path)
        if scope is None:
            continue
        content = staged_file_content(path)
        if content is None:
            continue
        suppressions = scan_content(content, scope, file_path=Path(path))
        if suppressions:
            results[path] = suppressions
    return results


def _staged_suppression_delta_inputs(
    baseline_by_file: dict[str, object],
) -> tuple[dict[str, int], dict[str, int], list[str]]:
    baseline_counts: dict[str, int] = {}
    current_counts: dict[str, int] = {}
    tokenize_errors: list[str] = []

    for status, old_path, new_path in suppression_staged_name_status():
        if status.startswith("D"):
            if old_path.endswith((".py", ".ts")):
                baseline_count = baseline_by_file.get(old_path, 0)
                baseline_counts[old_path] = (
                    baseline_count if isinstance(baseline_count, int) else 0
                )
                current_counts[old_path] = 0
            continue

        target_path = new_path or old_path
        if not target_path.endswith((".py", ".ts")):
            continue

        scope = _resolve_staged_scope(target_path)
        if scope is None:
            continue
        content = staged_file_content(target_path)
        if content is None:
            continue
        suppressions = scan_content(content, scope, file_path=Path(target_path))
        if any(s["type"] == "__tokenize_error__" for s in suppressions):
            tokenize_errors.append(target_path)
            continue

        current_counts[target_path] = len(suppressions)
        baseline_key = old_path if status.startswith("R") else target_path
        baseline_count = baseline_by_file.get(baseline_key, 0)
        baseline_counts[target_path] = (
            baseline_count if isinstance(baseline_count, int) else 0
        )
    return baseline_counts, current_counts, tokenize_errors


def run_commitlint_dispatcher_health_check() -> None:
    """Verify the husky commit-msg dispatcher is intact.

    External tools (e.g. ``entire``) can overwrite ``.husky/_/commit-msg``
    which is the internal hook git actually calls.  When overwritten, the
    dispatch chain to ``.husky/commit-msg`` (the user-facing hook with
    commitlint) breaks silently — bad commit messages pass through.

    This check warns but does not block — the CI commitlint job is the
    authoritative gate.  Blocking locally creates an unwinnable loop when
    external tools re-inject on every commit.
    """
    dispatcher = REPO_ROOT / ".husky" / "_" / "commit-msg"
    if not dispatcher.exists():
        # .husky/_/ not generated yet — pnpm install hasn't run
        return
    content = dispatcher.read_text(encoding="utf-8", errors="replace")
    # The standard husky dispatcher sources the `h` script.
    # Any content that does NOT include this pattern was overwritten.
    if ')/h"' in content or ")/h'" in content:
        return
    safe_print("[pre-commit] WARNING: .husky/_/commit-msg dispatcher is corrupted")
    safe_print("  Local commitlint will not run on commit messages.")
    safe_print("  CI will still enforce conventional commits on PR.")
    safe_print("  To restore local enforcement: pnpm exec husky")


def run_staged_suppression_diff_guard() -> None:
    baseline = _load_authoritative_suppression_baseline()
    if baseline is None:
        safe_print(
            "[pre-commit] authoritative suppression baseline unavailable in degraded mode; "
            "skipping staged suppression delta guard"
        )
        return
    baseline_by_file = baseline.get("by_file", {})
    assert isinstance(baseline_by_file, dict)

    baseline_counts, current_counts, tokenize_errors = _staged_suppression_delta_inputs(
        baseline_by_file
    )
    staged_baseline = dict(baseline)
    staged_baseline["by_file"] = baseline_counts
    staged_baseline["total"] = sum(baseline_counts.values())
    staged_current = dict(baseline)
    staged_current["by_file"] = current_counts
    staged_current["total"] = sum(current_counts.values())

    if tokenize_errors:
        safe_print("[pre-commit] staged suppression scan hit tokenize errors:")
        for file_path in tokenize_errors:
            safe_print(f"  - {file_path}")
        raise SystemExit(1)

    diff = compute_diff(staged_baseline, staged_current)
    if diff["delta"] > 0:
        safe_print("[pre-commit] staged suppression increase detected:")
        safe_print(
            f"  baseline: {diff['baseline_total']} current: {diff['current_total']} delta: +{diff['delta']}"
        )
        raise SystemExit(1)
    safe_print("[pre-commit] staged suppression guard passed")


def run_staged_suppression_justification_guard() -> None:
    staged_results = _scan_staged_suppressions()
    if any(
        supp["type"] == "__tokenize_error__"
        for suppressions in staged_results.values()
        for supp in suppressions
    ):
        raise SystemExit(1)
    unjustified = find_unjustified_suppressions(staged_results)
    if unjustified:
        safe_print("[pre-commit] staged suppressions missing justification:")
        for file_path, line_num, supp_type in unjustified:
            safe_print(f"  {file_path}:{line_num}: {supp_type}")
        safe_print(
            "Required format: -- REASON: <explanation> or -- SECURITY: <explanation>"
        )
        raise SystemExit(1)
    safe_print("[pre-commit] staged suppression justifications passed")


def ensure_no_compiled_js() -> None:
    offending = []
    for path in staged_paths():
        if path.startswith("extension/ui/") and path.endswith(".js"):
            offending.append(path)
    if not offending:
        safe_print("[pre-commit] no compiled artifacts found")
        return

    safe_print("")
    safe_print("[pre-commit] compiled JS file(s) detected in extension/ui/:")
    for path in offending:
        safe_print(path)
    safe_print("")
    safe_print("Compiled output belongs in extension/dist/ui/, not extension/ui/.")
    safe_print(
        "If this is a legitimate hand-written JS file, add it to the allowlist in scripts/run_repo_hook.py."
    )
    raise SystemExit(1)


def is_ui_trigger(path: str) -> bool:
    if path.startswith("extension/ui/") and path.endswith((".ts", ".html", ".css")):
        return True
    if path.startswith("extension/scripts/") and path.endswith(".ts"):
        return True
    if path.startswith("extension/tasks/") and path.endswith(".ts"):
        return True
    if path in {
        "extension/scripts/bundle-ui.mjs",
        "extension/package.json",
        "extension/pnpm-lock.yaml",
        "extension/eslint.config.mjs",
    }:
        return True
    if path.startswith("extension/tsconfig") and path.endswith(".json"):
        return True
    return False


# Feature 310 — PrRecord schema parity gate triggers (DIRECTIVE 2 / QG-47).
# The gate parses exactly two files; staging either of them MUST fire the
# gate before commit.  Kept separate from ``is_ui_trigger`` / ``is_test_trigger``
# because a commit that stages only ``types.py`` matches neither of those
# predicates and would otherwise hit the early-return in
# ``run_pre_commit_hook`` and silently skip the parity gate.
_PR_RECORD_PARITY_PATHS: frozenset[str] = frozenset(
    {
        "src/ado_git_repo_insights/types.py",
        "extension/ui/schemas/rollup.schema.ts",
    }
)


def is_pr_record_parity_trigger(path: str) -> bool:
    """Return True iff ``path`` is one of the two files the parity gate reads.

    CONTRACT: every file parsed by ``scripts/check_pr_record_schema_parity.py``
    MUST be covered here (QG-47 trigger-scope alignment).  The gate today
    parses exactly two files — see ``_PR_RECORD_PARITY_PATHS``.  If the
    gate ever grows another read path, add it to the frozenset and extend
    the regression test in ``tests/unit/test_hook_triggers.py``.
    """
    return path in _PR_RECORD_PARITY_PATHS


def require_clean_ui_sources() -> None:
    unstaged = worktree_paths("extension/ui/")
    unstaged.extend(worktree_paths("extension/eslint.config.mjs"))
    if not unstaged:
        return
    safe_print("[pre-commit] unstaged changes in extension/ui/ detected")
    safe_print("")
    safe_print(
        "Stage or stash these files before committing so generated artifacts match the commit:"
    )
    for path in unstaged:
        safe_print(f"  - {path}")
    raise SystemExit(1)


def require_clean_test_compilation_scope() -> None:
    """Block commit if any file in the test compilation scope has unstaged changes.

    tsconfig.test.json compiles: tests/**/*.ts, ui/**/*.ts.
    The tsconfig files themselves are also inputs — an unstaged config edit
    changes what tsc resolves.  tsc reads the worktree, not the staged index.
    If unstaged changes exist in these paths, the type-check result does not
    match the staged snapshot.
    """
    unstaged: list[str] = []
    unstaged.extend(worktree_paths("extension/tests/"))
    unstaged.extend(worktree_paths("extension/ui/"))
    unstaged.extend(worktree_paths("extension/tsconfig*.json"))
    unstaged.extend(worktree_paths("extension/eslint.config.mjs"))
    if not unstaged:
        return
    safe_print("[pre-commit] unstaged changes in test compilation scope detected")
    safe_print("")
    safe_print(
        "Stage or stash these files before committing so the test type-check"
        " matches the staged snapshot:"
    )
    for path in unstaged:
        safe_print(f"  - {path}")
    raise SystemExit(1)


def require_clean_tsconfigs() -> None:
    """Block commit if any extension tsconfig has unstaged changes.

    The config parity check reads tsconfig files from the worktree via the
    TypeScript API.  If any have unstaged changes, the parity result does
    not match the staged snapshot.
    """
    unstaged = worktree_paths("extension/tsconfig*.json")
    if not unstaged:
        return
    safe_print("[pre-commit] unstaged changes in tsconfig files detected")
    safe_print("")
    safe_print(
        "Stage or stash these files before committing so the config parity"
        " check matches the staged snapshot:"
    )
    for path in unstaged:
        safe_print(f"  - {path}")
    raise SystemExit(1)


def require_clean_pr_record_parity_scope() -> None:
    """Block commit if any PR-record parity gate read-path has unstaged changes.

    The parity gate (``scripts/check_pr_record_schema_parity.py``) parses
    three files from the worktree.  If any of them have unstaged changes,
    the parity result does not match the staged snapshot — QG-48 worktree-clean
    guard requirement.

    Scope MUST match ``_PR_RECORD_PARITY_PATHS`` exactly — no broader glob,
    no ancestor directory scan (user constraint).  Each path is queried
    individually because ``worktree_paths`` with a specific path returns
    only that path when unstaged.
    """
    unstaged: list[str] = []
    for path in sorted(_PR_RECORD_PARITY_PATHS):
        unstaged.extend(worktree_paths(path))
    if not unstaged:
        return
    safe_print("[pre-commit] unstaged changes in PR-record parity-gate scope detected")
    safe_print("")
    safe_print(
        "Stage or stash these files before committing so the parity gate"
        " validates the staged snapshot:"
    )
    for path in unstaged:
        safe_print(f"  - {path}")
    raise SystemExit(1)


def run_pnpm_lockfile_guard() -> None:
    """Block package-lock.json from being committed (pnpm-only policy).

    Staged-only: CI enforces the full-tree policy on every PR.
    """
    offending = [path for path in staged_paths() if path.endswith("package-lock.json")]
    if offending:
        safe_print("[pre-commit] package-lock.json detected (pnpm-only policy):")
        for path in offending:
            safe_print(f"  - {path}")
        raise SystemExit(1)
    safe_print("[pre-commit] pnpm lockfile guard passed")


def run_npm_command_guard() -> None:
    """Block npm ci/install commands in staged workflow/script files.

    Staged-only: CI enforces the full-tree policy on every PR.
    """
    import re

    staged_prefixes = (".github/workflows/", "scripts/")
    staged_exact = (
        "package.json",
        "extension/package.json",
        "extension/tasks/extract-prs/package.json",
    )
    staged_suffixes = (".yml", ".yaml", ".json", ".sh")
    pattern = re.compile(r"npm\s+(ci|install)\b")
    allowlist = re.compile(r"npm install -g tfx-cli")
    skip_patterns = re.compile(r"(^\s*#|pnpm|echo.*npm|name:.*npm)")
    offending: list[str] = []

    for path in staged_paths():
        in_scope = (
            any(path.startswith(p) for p in staged_prefixes) or path in staged_exact
        )
        if not in_scope:
            continue
        if path not in staged_exact and not path.endswith(staged_suffixes):
            continue
        text = staged_file_content(path)
        if text is None:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            if (
                pattern.search(line)
                and not allowlist.search(line)
                and not skip_patterns.search(line)
            ):
                offending.append(f"{path}:{i}")

    if offending:
        safe_print("[pre-commit] npm ci/install commands found (pnpm-only policy):")
        for loc in offending:
            safe_print(f"  - {loc}")
        raise SystemExit(1)
    safe_print("[pre-commit] npm command guard passed")


def run_pagination_token_guard() -> None:
    """Block direct continuationToken usage in staged src/tests files.

    Staged-only: CI enforces the full-tree policy on every PR.
    """
    import fnmatch

    allowlist_path = REPO_ROOT / ".pagination-allowlist"
    allowed_patterns: list[str] = []
    if allowlist_path.exists():
        for line in allowlist_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                allowed_patterns.append(stripped)
    else:
        allowed_patterns = [
            "**/pagination.py",
            "**/test_pagination*.py",
            "**/*.md",
        ]

    offending: list[str] = []
    for path in staged_paths():
        if not (path.startswith("src/") or path.startswith("tests/")):
            continue
        if any(fnmatch.fnmatch(path, pat) for pat in allowed_patterns):
            continue
        text = staged_file_content(path)
        if text is None:
            continue
        if "continuationToken" in text:
            offending.append(path)

    if offending:
        safe_print("[pre-commit] direct continuationToken usage found:")
        for loc in offending:
            safe_print(f"  - {loc}")
        safe_print("Use the pagination helper instead.")
        raise SystemExit(1)
    safe_print("[pre-commit] pagination token guard passed")


def run_ui_bundle_guards() -> None:
    """Block TypeScript files and ESM syntax in staged ui_bundle files.

    Staged-only: CI enforces the full-tree policy on every PR.
    """
    import re

    esm_pattern = re.compile(r"^\s*(import|export)\s", re.MULTILINE)
    ui_bundle_prefix = "src/ado_git_repo_insights/ui_bundle/"
    ts_files: list[str] = []
    esm_files: list[str] = []

    for path in staged_paths():
        if not path.startswith(ui_bundle_prefix):
            continue
        if path.endswith(".ts"):
            ts_files.append(path)
        elif path.endswith(".js"):
            text = staged_file_content(path)
            if text is not None and esm_pattern.search(text):
                esm_files.append(path)

    errors: list[str] = []
    if ts_files:
        errors.append("[pre-commit] TypeScript files found in ui_bundle:")
        for f in ts_files:
            errors.append(f"  - {f}")
    if esm_files:
        errors.append("[pre-commit] ESM import/export syntax found in ui_bundle:")
        for f in esm_files:
            errors.append(f"  - {f}")

    if errors:
        for line in errors:
            safe_print(line)
        raise SystemExit(1)
    safe_print("[pre-commit] ui_bundle guards passed (no .ts, no ESM)")


def run_managed_artifacts(*args: str) -> None:
    run_command([sys.executable, "scripts/manage_generated_artifacts.py", *args])


def _require_pnpm(operation: str) -> str:
    """Resolve pnpm or fail with a SETUP error."""
    pnpm = shutil.which("pnpm.cmd") or shutil.which("pnpm")
    if pnpm:
        return pnpm
    safe_print("[SETUP] pnpm not found on PATH.")
    safe_print("  Install: https://pnpm.io/installation")
    safe_print(f"  Required for: {operation}")
    raise SystemExit(EXIT_SETUP)


def run_extension_lint() -> None:
    """Run ESLint on extension UI sources (FR-005 gate)."""
    pnpm = _require_pnpm("Extension UI linting")
    safe_print("[pre-commit] running extension lint (ESLint)")
    run_command([pnpm, "run", "lint"], cwd=EXTENSION_ROOT)


def run_extension_test_lint() -> None:
    """Run ESLint on extension test sources (--max-warnings=0)."""
    pnpm = _require_pnpm("Extension test linting")
    safe_print("[pre-commit] running extension test lint (ESLint)")
    run_command([pnpm, "run", "lint:tests"], cwd=EXTENSION_ROOT)


def run_extension_typecheck() -> None:
    """Run TypeScript type check on extension sources (tsc --noEmit).

    Closes the local/CI parity gap: CI runs ``pnpm run build:check``
    (tsc --noEmit) as a hard gate, but esbuild and ts-jest both skip
    type checking.  Without this gate, unused-variable (TS6133) and
    type-narrowing (TS2769) errors pass locally and fail only in CI.

    Prior incidents: commits 88ed3b7, 7264576, 3247874, PR #207.
    """
    pnpm = _require_pnpm("Extension type checking")
    safe_print("[pre-commit] running TypeScript type check (tsc --noEmit)")
    run_command([pnpm, "run", "build:check"], cwd=EXTENSION_ROOT)


def is_test_trigger(path: str) -> bool:
    """Return True if the staged path should trigger test type-checking.

    CONTRACT: any file included in tsconfig.test.json MUST be covered
    here.  The trigger scope must match or exceed the effective
    compilation scope of the test tsconfig.

    Current tsconfig.test.json includes:
      - tests/**/*.ts       → extension/tests/**/*.ts
      - ui/**/*.ts          → extension/ui/**/*.ts
      - ../types/vss.d.ts   → types/vss.d.ts
      - tsconfig*.json      → config changes can alter compilation

    If tsconfig.test.json gains a new include path, add a
    corresponding trigger here and a regression test in
    tests/unit/test_hook_triggers.py.
    """
    if path.startswith("extension/tests/") and path.endswith(".ts"):
        return True
    if path.startswith("extension/ui/") and path.endswith(".ts"):
        return True
    if path.startswith("extension/tsconfig") and path.endswith(".json"):
        return True
    # types/vss.d.ts is referenced by tsconfig.test.json as ../types/vss.d.ts
    if path.startswith("types/") and path.endswith(".d.ts"):
        return True
    # ESLint config changes affect test lint results
    if path == "extension/eslint.config.mjs":
        return True
    return False


def run_extension_test_typecheck() -> None:
    """Run TypeScript type check on test files (tsc --noEmit -p tsconfig.test.json).

    Closes the local/CI parity gap for test strictness: CI runs
    ``pnpm run build:check-tests`` as a hard gate.  Without this gate,
    strict-mode errors in test files pass locally and fail only in CI.

    Added as part of 042-test-strict-alignment (QG-35 compliance).
    """
    pnpm = _require_pnpm("Extension test type checking")
    safe_print(
        "[pre-commit] running test TypeScript type check (tsc --noEmit -p tsconfig.test.json)"
    )
    run_command([pnpm, "run", "build:check-tests"], cwd=EXTENSION_ROOT)


def run_extension_config_parity() -> None:
    """Verify tsconfig.test.json stays in parity with tsconfig.json.

    Uses tsc --showConfig to compare resolved compilerOptions and fails
    if any non-allowlisted key differs.  Forward-looking: new TypeScript
    flags are automatically covered.

    Added as part of 042-test-strict-alignment (QG-35 compliance).
    """
    pnpm = _require_pnpm("Extension config parity checking")
    safe_print("[pre-commit] running test config parity check")
    run_command([pnpm, "run", "test:config-parity"], cwd=EXTENSION_ROOT)


def run_pr_record_schema_parity_check() -> None:
    """Run the PrRecord cross-surface schema parity gate (Feature 310).

    Invokes the single canonical command ``python scripts/check_pr_record_schema_parity.py``
    — the same string invoked from pre-push preflight, CI, and
    ``pnpm test:ci`` per QG-49 (one command, many callers).  Python-only
    implementation so the gate stays green under ``pre-commit run --all-files``
    in the Python test matrix where ``extension/node_modules`` is absent
    (feedback_hook_env_parity_across_all_ci_jobs).
    """
    safe_print("[pre-commit] running PR-record schema parity gate")
    run_command([sys.executable, "scripts/check_pr_record_schema_parity.py"])


def run_scope_coverage_guard() -> None:
    """Verify every staged .py/.ts file belongs to a known audit scope (FR-026).

    Pre-commit contract: proves "no staged file escapes audit."
    Full-tree coverage is preflight/CI only (--check-coverage).
    """
    staged = staged_paths()
    unscoped: list[str] = []
    for path in staged:
        if not (path.endswith(".py") or path.endswith(".ts")):
            continue
        # Check if any scope claims this file (longest-prefix + extension match)
        matched = False
        for scope_cfg in AUDIT_SCOPES.values():
            if not path.startswith(scope_cfg["dir"]):
                continue
            ext_match = (scope_cfg["pattern"] == "*.py" and path.endswith(".py")) or (
                scope_cfg["pattern"] == "*.ts" and path.endswith(".ts")
            )
            if ext_match:
                matched = True
                break
        if not matched:
            unscoped.append(path)

    if unscoped:
        safe_print("[pre-commit] staged file(s) not in any audit scope:")
        for p in unscoped:
            safe_print(f"  - {p}")
        raise SystemExit(1)
    safe_print("[pre-commit] scope coverage guard passed")


def run_rule_disable_invariants_guard() -> None:
    """Check staged Python files for unsafe subprocess/random/syspath patterns (FR-014).

    Compensating guardrail for globally disabled S603/S607/S311 and importlib enforcement.
    Uses staged_file_content() for pre-commit compatibility (R4).
    """
    # Load exclusions and allowlist from the guardrail module
    guardrail_exclusions: frozenset[str] = getattr(
        _guard_mod, "GUARDRAIL_EXCLUSIONS", frozenset()
    )
    load_allowlist: Callable[[], set[tuple[str, int, str]]] = getattr(
        _guard_mod, "_load_subprocess_allowlist", lambda: set()
    )
    match_allowlist = getattr(_guard_mod, "_match_allowlist", lambda v, a: False)
    subprocess_allowlist = load_allowlist()
    staged = staged_paths()
    raw_violations: list[dict[str, str | int]] = []
    for path in staged:
        if not path.endswith(".py"):
            continue
        normalized = path.replace("\\", "/")
        if normalized in guardrail_exclusions:
            continue
        content = staged_file_content(path)
        if content is None:
            continue
        raw_violations.extend(_check_subprocess_safety(path, content))
        raw_violations.extend(_check_random_safety(path, content))
        raw_violations.extend(_check_syspath_safety(path, content))

    # Filter using the same _match_allowlist function as the CLI path
    # Only subprocess-related violations are filtered, not random ones
    subprocess_patterns = {
        "subprocess with non-literal command",
        "shell=True",
        "os.system/popen",
    }
    violations: list[str] = []
    for v in raw_violations:
        if v["pattern"] in subprocess_patterns and match_allowlist(
            v, subprocess_allowlist
        ):
            continue
        violations.append(f"  {v['file']}:{v['line']}: {v['pattern']}")

    if violations:
        # Best-effort line-shift auto-fix BEFORE failing.  Updates only the
        # ``line`` field of existing allowlist entries when every bucket is
        # an unambiguous uniform shift; preserves ``code`` / ``reason`` /
        # entry count.  See
        # ``scripts/check_rule_disable_invariants.auto_fix_subprocess_allowlist_line_shifts``
        # for the safety contract.
        applied = _auto_fix_subprocess_allowlist_line_shifts(REPO_ROOT)
        if applied:
            safe_print("[pre-commit] subprocess allowlist line-shifts auto-applied:")
            for file_path, old_line, new_line in applied:
                safe_print(f"  {file_path}:{old_line} -> {new_line}")
            safe_print(
                "[pre-commit] re-stage `.subprocess-allowlist.json` "
                "and re-run the commit."
            )
            raise SystemExit(1)
        safe_print("[pre-commit] unsafe patterns detected (S603/S311 guardrail):")
        for line in violations:
            safe_print(line)
        raise SystemExit(1)
    safe_print("[pre-commit] rule-disable invariants guard passed")


def run_pre_commit_hook() -> None:
    safe_print("[pre-commit] running staged suppression guard")
    run_staged_suppression_diff_guard()
    safe_print("[pre-commit] running staged suppression justification guard")
    run_staged_suppression_justification_guard()
    safe_print("[pre-commit] running Any-type ratchet (QG-40)")
    run_command([sys.executable, "scripts/check_no_any_types.py", "--diff"])
    run_acl_health_check()
    run_commitlint_dispatcher_health_check()
    run_pre_commit_stage()
    ensure_no_compiled_js()
    run_pnpm_lockfile_guard()
    run_npm_command_guard()
    run_pagination_token_guard()
    run_scope_coverage_guard()
    run_rule_disable_invariants_guard()
    run_invariant_artifact_contract_guards("pre-commit")
    run_ui_bundle_guards()

    staged = staged_paths()
    ui_triggers = [path for path in staged if is_ui_trigger(path)]
    test_triggers = [path for path in staged if is_test_trigger(path)]
    parity_triggers = [path for path in staged if is_pr_record_parity_trigger(path)]
    tsconfig_triggers = [
        path
        for path in staged
        if path.startswith("extension/tsconfig") and path.endswith(".json")
    ]

    # Feature 310 — PR-record schema parity dispatch MUST precede the
    # early-return below.  A commit that stages only ``types.py`` matches
    # neither ``is_ui_trigger`` nor ``is_test_trigger`` and would otherwise
    # skip the gate silently.
    if parity_triggers:
        safe_print("")
        safe_print("[pre-commit] PR-record schema parity triggers detected")
        for path in parity_triggers:
            safe_print(f"  - {path}")
        require_clean_pr_record_parity_scope()
        run_pr_record_schema_parity_check()

    if not ui_triggers and not test_triggers:
        return

    if ui_triggers:
        safe_print("")
        safe_print("[pre-commit] UI build triggers detected")
        for path in ui_triggers:
            safe_print(f"  - {path}")
        require_clean_ui_sources()
        run_extension_typecheck()
        run_extension_lint()
        run_managed_artifacts("sync", "--scope", "all", "--stage", "--require-clean")
        safe_print("[pre-commit] managed UI artifacts synced successfully")

    if test_triggers:
        safe_print("")
        safe_print("[pre-commit] test file triggers detected")
        for path in test_triggers:
            safe_print(f"  - {path}")
        require_clean_test_compilation_scope()
        run_extension_test_typecheck()
        run_extension_test_lint()

    if tsconfig_triggers:
        require_clean_tsconfigs()
        run_extension_config_parity()


def run_pre_push_pre_commit_checks() -> None:
    pre_commit = resolve_pre_commit()
    safe_print("[pre-push] running pre-commit checks on all files")
    run_command([pre_commit, "run", "--all-files", "--hook-stage", "pre-push"])


def check_crlf(path: Path) -> bool:
    try:
        data = path.read_bytes()
    except OSError:
        return False
    return b"\r" in data


def iter_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if "__pycache__" in path.parts:
            continue
        if any(part in {"node_modules", ".venv"} for part in path.parts):
            continue
        files.append(path)
    return files


def run_crlf_guard() -> None:
    safe_print("[pre-push] running CRLF line ending guard")
    targets = {
        ".husky": REPO_ROOT / ".husky",
        "*.sh": REPO_ROOT,
        ".github/scripts": REPO_ROOT / ".github" / "scripts",
        "scripts": REPO_ROOT / "scripts",
        "extension/scripts": EXTENSION_ROOT / "scripts",
        "extension/ui": EXTENSION_ROOT / "ui",
    }
    failures: dict[str, list[str]] = {label: [] for label in targets}

    for label, root in targets.items():
        if not root.exists():
            continue
        for path in iter_files(root):
            if label == "*.sh" and path.suffix != ".sh":
                continue
            if check_crlf(path):
                failures[label].append(path.relative_to(REPO_ROOT).as_posix())

    found = False
    for label, matches in failures.items():
        if not matches:
            continue
        found = True
        safe_print(f"[pre-push] CRLF detected in {label}:")
        for match in matches:
            safe_print(f"  - {match}")

    if found:
        safe_print("")
        safe_print("[pre-push] push blocked: CRLF line endings found")
        safe_print(
            "[pre-push] Fix: run `git add --renormalize .` after checking .gitattributes"
        )
        raise SystemExit(1)


def validate_png(path: Path) -> bool:
    return path.is_file() and path.read_bytes()[:4] == PNG_MAGIC


def run_asset_validation() -> None:
    safe_print("[pre-push] running marketplace asset validation")
    manifest = json.loads(
        (EXTENSION_ROOT / "vss-extension.json").read_text(encoding="utf-8")
    )
    errors: list[str] = []

    icon_path = EXTENSION_ROOT / "images" / "icon.png"
    if not validate_png(icon_path):
        errors.append(f"{icon_path.relative_to(REPO_ROOT)} is not a valid PNG")

    for screenshot in manifest.get("screenshots", []):
        screenshot_path = EXTENSION_ROOT / screenshot["path"]
        if not validate_png(screenshot_path):
            errors.append(
                f"{screenshot_path.relative_to(REPO_ROOT)} is not a valid PNG"
            )

    if not errors:
        return

    for error in errors:
        safe_print(f"[pre-push] {error}")
    raise SystemExit("[pre-push] push blocked: marketplace assets invalid")


def run_version_guard() -> None:
    """Block manual version bumps before push — fail fast."""
    safe_print("[pre-push] running version guard")
    run_command([sys.executable, "scripts/check-version-unchanged.py", "origin/main"])


def run_sentinel_absence_check(docs_data_dir: Path | None = None) -> None:
    """Verify no synthetic-authorization sentinel leaked into the public demo tree.

    Feature 309 binary gate.
    The gate is defense in depth — ``promote_data`` already unlinks the sentinel
    before ``shutil.copytree`` — but if that ordering regresses or a developer
    writes the sentinel manually, this check fails the push before publish.

    Exposed as a named subcommand so CI (``.github/workflows/demo.yml``
    first-step) and local pre-push invoke the SAME entrypoint — satisfies
    the entrypoint-command parity contract (QG-49). The ``docs_data_dir``
    override exists only for entrypoint-parity tests (tmp_path scratch);
    production callers omit it and scan the real ``docs/data/`` tree.
    """
    sentinel_spec = _importlib_util.spec_from_file_location(
        "strip_pr_arrays", REPO_ROOT / "scripts" / "strip_pr_arrays.py"
    )
    if sentinel_spec is None or sentinel_spec.loader is None:
        raise SystemExit("[sentinel-absence] cannot load scripts/strip_pr_arrays.py")
    strip_module = _importlib_util.module_from_spec(sentinel_spec)
    sys.modules["strip_pr_arrays"] = strip_module
    sentinel_spec.loader.exec_module(strip_module)
    sentinel_name = strip_module.SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME

    scan_root = (
        docs_data_dir if docs_data_dir is not None else REPO_ROOT / "docs" / "data"
    )
    matches = sorted(scan_root.rglob(sentinel_name))
    if matches:
        display = [p.as_posix() for p in matches]
        raise SystemExit(f"[sentinel-absence] sentinel leaked to docs/data/: {display}")
    safe_print("[sentinel-absence] ok")


def run_pre_push_hook() -> None:
    run_version_guard()
    safe_print("[pre-push] running baseline integrity check")
    run_command(["node", ".github/scripts/check-baseline-integrity.js"])
    run_pre_push_pre_commit_checks()
    run_crlf_guard()
    run_asset_validation()
    run_invariant_artifact_contract_guards("pre-push")

    safe_print("[pre-push] running PR preflight")
    run_command([sys.executable, "scripts/run_pr_preflight.py"])
    run_sentinel_absence_check()
    safe_print("[pre-push] all pre-push checks passed")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run repo-owned Git hook logic.")
    parser.add_argument("hook", choices=("pre-commit", "pre-push", "sentinel-absence"))
    parser.add_argument(
        "--docs-data-dir",
        type=Path,
        default=None,
        help=(
            "Override the docs/data scan root for the sentinel-absence "
            "subcommand (testing only; production omits this flag)."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.hook == "pre-commit":
        run_pre_commit_hook()
        return 0
    if args.hook == "sentinel-absence":
        run_sentinel_absence_check(docs_data_dir=args.docs_data_dir)
        return 0
    run_pre_push_hook()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
