#!/usr/bin/env python3
"""Cross-platform orchestrator for repo-owned Git hooks."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EXTENSION_ROOT = REPO_ROOT / "extension"
HOOK_PREFIX = "[hook]"
PNG_MAGIC = b"\x89PNG"


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
    result = subprocess.run(  # noqa: S603 - repo-owned command execution only
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
    result = subprocess.run(  # noqa: S603 - repo-owned executable
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
        rerun = subprocess.run(  # noqa: S603 - repo-owned executable
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
        if (
            path.startswith("extension/ui/")
            and path.endswith(".js")
            and path != "extension/ui/VSS.SDK.min.js"
        ):
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
    if path == "extension/ui/VSS.SDK.min.js":
        return True
    if path in {
        "extension/scripts/bundle-ui.mjs",
        "extension/scripts/copy-vss-sdk.mjs",
        "extension/package.json",
        "extension/pnpm-lock.yaml",
    }:
        return True
    if path.startswith("extension/tsconfig") and path.endswith(".json"):
        return True
    return False


def require_clean_ui_sources() -> None:
    unstaged = worktree_paths("extension/ui/")
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


def run_pre_commit_hook() -> None:
    run_acl_health_check()
    run_pre_commit_stage()
    run_managed_artifacts("sync", "--scope", "sdk", "--stage", "--require-clean")
    ensure_no_compiled_js()

    staged = staged_paths()
    triggers = [path for path in staged if is_ui_trigger(path)]
    if not triggers:
        return

    safe_print("")
    safe_print("[pre-commit] UI build triggers detected")
    for path in triggers:
        safe_print(f"  - {path}")
    require_clean_ui_sources()
    run_extension_lint()
    run_managed_artifacts("sync", "--scope", "all", "--stage", "--require-clean")
    safe_print("[pre-commit] managed UI artifacts synced successfully")


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
        result = subprocess.run(  # noqa: S603 - git path resolved via shutil.which
            [git, "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError:
        return ""


def run_pre_push_hook() -> None:
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
