#!/usr/bin/env python3
"""Cross-platform orchestrator for repo-owned Git hooks.

Responsibility split:
  - Pre-commit guards check STAGED files only (what's entering the repo).
  - Pre-push preflight checks the full worktree (last gate before CI).
  - CI checks the clean checkout (authoritative, full-tree policy enforcement).
"""

from __future__ import annotations

import argparse
import importlib.util as _importlib_util
import json
import os
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EXTENSION_ROOT = REPO_ROOT / "extension"
HOOK_PREFIX = "[hook]"
PNG_MAGIC = b"\x89PNG"

# Load SCOPES from audit-suppressions.py for staged-subset scope check (FR-028)
_audit_spec = _importlib_util.spec_from_file_location(
    "audit_suppressions", REPO_ROOT / "scripts" / "audit-suppressions.py"
)
assert _audit_spec is not None, "audit-suppressions.py not found"
assert _audit_spec.loader is not None
_audit_mod = _importlib_util.module_from_spec(_audit_spec)
_audit_spec.loader.exec_module(_audit_mod)
AUDIT_SCOPES: dict[str, dict[str, str]] = _audit_mod.SCOPES

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
        command,
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
    raise SystemExit(
        f"{HOOK_PREFIX} pre-commit not found. Install it or activate the repo virtualenv."
    )


def resolve_powershell() -> str | None:
    for candidate in ("pwsh", "powershell"):
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    return None


def git_output(*args: str) -> str:
    result = run_command(["git", *args], capture_output=True)
    return result.stdout


def staged_paths() -> list[str]:
    output = git_output("diff", "--cached", "--name-only", "--diff-filter=d")
    return [line.strip() for line in output.splitlines() if line.strip()]


def staged_file_content(path: str) -> str | None:
    """Return the staged content of a file, or None if it cannot be read.

    Uses ``git show :path`` which accepts forward-slash paths on all platforms.
    Binary files are decoded with replacement characters — callers searching for
    text patterns will safely get no match on binary content.
    """
    command = ["git", "show", f":{path}"]
    result = subprocess.run(
        command,
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


def stage_changed_worktree_files() -> bool:
    output = git_output("diff", "--name-only")
    files = [line.strip() for line in output.splitlines() if line.strip()]
    if not files:
        return False
    safe_print("")
    safe_print("[pre-commit] auto-fixes applied, staging modified files")
    for file_name in files:
        safe_print(f"  - {file_name}")
    run_command(["git", "add", "--", *files])
    return True


def run_acl_health_check() -> None:
    if os.name != "nt":
        return
    powershell = resolve_powershell()
    if not powershell:
        raise SystemExit(
            "[pre-commit] PowerShell is required on Windows for ACL health checks."
        )
    safe_print("[pre-commit] checking ACL health on repo metadata")
    run_command(
        [
            powershell,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            "scripts/check-git-acl-health.ps1",
        ]
    )


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

    if stage_changed_worktree_files():
        rerun = subprocess.run(
            [pre_commit, "run", "--hook-stage", "pre-commit"],
            cwd=REPO_ROOT,
            check=False,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if rerun.returncode == 0:
            safe_print("[pre-commit] formatting checks passed after restaging")
            return
    raise SystemExit("[pre-commit] formatting checks failed")


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
            "specs/**",
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


def run_extension_lint() -> None:
    """Run ESLint on extension UI sources (FR-005 gate)."""
    pnpm = shutil.which("pnpm.cmd") or shutil.which("pnpm")
    if not pnpm:
        raise SystemExit(
            "[pre-commit] pnpm is required to lint extension UI sources "
            "but was not found on PATH."
        )
    safe_print("[pre-commit] running extension lint (ESLint)")
    run_command([pnpm, "run", "lint"], cwd=EXTENSION_ROOT)


def run_extension_test_lint() -> None:
    """Run ESLint on extension test sources (--max-warnings=0)."""
    pnpm = shutil.which("pnpm.cmd") or shutil.which("pnpm")
    if not pnpm:
        raise SystemExit(
            "[pre-commit] pnpm is required to lint extension test sources "
            "but was not found on PATH."
        )
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
    pnpm = shutil.which("pnpm.cmd") or shutil.which("pnpm")
    if not pnpm:
        raise SystemExit(
            "[pre-commit] pnpm is required to type-check extension sources "
            "but was not found on PATH."
        )
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
    pnpm = shutil.which("pnpm.cmd") or shutil.which("pnpm")
    if not pnpm:
        raise SystemExit(
            "[pre-commit] pnpm is required to type-check test files "
            "but was not found on PATH."
        )
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
    pnpm = shutil.which("pnpm.cmd") or shutil.which("pnpm")
    if not pnpm:
        raise SystemExit(
            "[pre-commit] pnpm is required to check config parity "
            "but was not found on PATH."
        )
    safe_print("[pre-commit] running test config parity check")
    run_command([pnpm, "run", "test:config-parity"], cwd=EXTENSION_ROOT)


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
    """Check staged Python files for unsafe subprocess/random patterns (FR-014).

    Compensating guardrail for globally disabled S603/S607/S311.
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
        safe_print("[pre-commit] unsafe patterns detected (S603/S311 guardrail):")
        for line in violations:
            safe_print(line)
        raise SystemExit(1)
    safe_print("[pre-commit] rule-disable invariants guard passed")


def run_pre_commit_hook() -> None:
    safe_print("[pre-commit] running suppression audit (zero-tolerance)")
    run_command([sys.executable, "scripts/audit-suppressions.py", "--diff"])
    run_acl_health_check()
    run_pre_commit_stage()
    ensure_no_compiled_js()
    run_pnpm_lockfile_guard()
    run_npm_command_guard()
    run_pagination_token_guard()
    run_scope_coverage_guard()
    run_rule_disable_invariants_guard()
    run_ui_bundle_guards()

    staged = staged_paths()
    ui_triggers = [path for path in staged if is_ui_trigger(path)]
    test_triggers = [path for path in staged if is_test_trigger(path)]
    tsconfig_triggers = [
        path
        for path in staged
        if path.startswith("extension/tsconfig") and path.endswith(".json")
    ]

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


def _current_branch() -> str:
    """Return the current git branch name, or empty string on detached HEAD."""
    git = shutil.which("git")
    if git is None:
        return ""
    try:
        result = subprocess.run(
            [git, "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError:
        return ""


def run_version_guard() -> None:
    """Block manual version bumps before push — fail fast."""
    safe_print("[pre-push] running version guard")
    run_command([sys.executable, "scripts/check-version-unchanged.py", "origin/main"])


def run_pre_push_hook() -> None:
    run_version_guard()
    safe_print("[pre-push] running baseline integrity check")
    run_command(["node", ".github/scripts/check-baseline-integrity.js"])
    run_pre_push_pre_commit_checks()
    run_crlf_guard()
    run_asset_validation()

    branch = _current_branch()
    preflight_cmd = [sys.executable, "scripts/run_pr_preflight.py"]
    if branch.startswith("refactor/"):
        safe_print(
            f"[pre-push] refactor branch '{branch}' detected "
            "— running strict CI-parity preflight"
        )
        preflight_cmd.append("--strict")
    else:
        safe_print("[pre-push] running PR preflight")

    run_command(preflight_cmd)
    safe_print("[pre-push] all pre-push checks passed")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run repo-owned Git hook logic.")
    parser.add_argument("hook", choices=("pre-commit", "pre-push"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.hook == "pre-commit":
        run_pre_commit_hook()
        return 0
    run_pre_push_hook()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
