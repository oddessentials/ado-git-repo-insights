#!/usr/bin/env python3
"""Deterministically sync and verify generated repository artifacts."""

from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EXTENSION_ROOT = REPO_ROOT / "extension"

UI_BUNDLE_DIR = REPO_ROOT / "src" / "ado_git_repo_insights" / "ui_bundle"
DOCS_DIR = REPO_ROOT / "docs"
BROKEN_DOCS_DIR = EXTENSION_ROOT / "tests" / "fixtures" / "broken-docs"

SDK_SOURCE = (
    EXTENSION_ROOT / "node_modules" / "vss-web-extension-sdk" / "lib" / "VSS.SDK.min.js"
)
SDK_DEST = EXTENSION_ROOT / "ui" / "VSS.SDK.min.js"

DOCS_OUTPUTS = [
    DOCS_DIR / "index.html",
    DOCS_DIR / "dashboard.js",
    DOCS_DIR / "dataset-loader.js",
    DOCS_DIR / "artifact-client.js",
    DOCS_DIR / "error-types.js",
    DOCS_DIR / "error-codes.js",
    DOCS_DIR / "styles.css",
    DOCS_DIR / "VSS.SDK.min.js",
]

BROKEN_DOCS_OUTPUTS = [
    BROKEN_DOCS_DIR / "index.html",
    BROKEN_DOCS_DIR / "dashboard.js",
    BROKEN_DOCS_DIR / "dataset-loader.js",
    BROKEN_DOCS_DIR / "artifact-client.js",
    BROKEN_DOCS_DIR / "error-types.js",
    BROKEN_DOCS_DIR / "error-codes.js",
    BROKEN_DOCS_DIR / "styles.css",
    BROKEN_DOCS_DIR / "VSS.SDK.min.js",
]


@dataclass(frozen=True)
class ScopeConfig:
    name: str
    stage_paths: tuple[Path, ...]
    verify_paths: tuple[Path, ...]
    sync_vss_sdk: bool
    build_ui: bool
    sync_ui_bundle: bool
    publish_demo_surface: bool


SCOPE_CONFIG = {
    "sdk": ScopeConfig(
        name="sdk",
        stage_paths=(SDK_DEST,),
        verify_paths=(SDK_DEST,),
        sync_vss_sdk=True,
        build_ui=False,
        sync_ui_bundle=False,
        publish_demo_surface=False,
    ),
    "ui": ScopeConfig(
        name="ui",
        stage_paths=(SDK_DEST, UI_BUNDLE_DIR),
        verify_paths=(SDK_DEST, UI_BUNDLE_DIR),
        sync_vss_sdk=True,
        build_ui=True,
        sync_ui_bundle=True,
        publish_demo_surface=False,
    ),
    "all": ScopeConfig(
        name="all",
        stage_paths=(SDK_DEST, UI_BUNDLE_DIR, *DOCS_OUTPUTS, *BROKEN_DOCS_OUTPUTS),
        verify_paths=(SDK_DEST, UI_BUNDLE_DIR, *DOCS_OUTPUTS, *BROKEN_DOCS_OUTPUTS),
        sync_vss_sdk=True,
        build_ui=True,
        sync_ui_bundle=True,
        publish_demo_surface=True,
    ),
}


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
    capture_output: bool = False,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(  # noqa: S603 - repo-owned commands only
        command,
        cwd=cwd,
        check=False,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=capture_output,
    )
    if result.returncode != 0:
        safe_print(f"[artifacts] command failed: {render_command(command)}")
        if result.stdout:
            safe_print(result.stdout.rstrip())
        if result.stderr:
            safe_print(result.stderr.rstrip())
        raise SystemExit(result.returncode)
    return result


def resolve_python() -> str:
    return sys.executable


def resolve_pnpm() -> str:
    for candidate in ("pnpm.cmd", "pnpm"):
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise SystemExit("[artifacts] pnpm is required but was not found on PATH.")


def normalize_sha256(path: Path) -> str:
    data = path.read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def ensure_node_modules() -> None:
    if (EXTENSION_ROOT / "node_modules").is_dir():
        return
    raise SystemExit(
        "[artifacts] extension/node_modules not found. Run `cd extension && pnpm install`."
    )


def sync_vss_sdk() -> bool:
    if not SDK_SOURCE.exists() or not SDK_DEST.exists():
        return False
    if normalize_sha256(SDK_SOURCE) == normalize_sha256(SDK_DEST):
        return False

    safe_print("[artifacts] syncing VSS SDK from npm package")
    run_command(["node", "scripts/copy-vss-sdk.mjs"], cwd=EXTENSION_ROOT)
    return True


def build_ui() -> None:
    ensure_node_modules()
    pnpm = resolve_pnpm()
    safe_print("[artifacts] building UI bundles")
    run_command([pnpm, "run", "build:ui"], cwd=EXTENSION_ROOT)


def sync_ui_bundle() -> None:
    safe_print("[artifacts] syncing ui_bundle from extension/dist/ui")
    run_command([resolve_python(), "scripts/sync_ui_bundle.py"])


def publish_demo_surface() -> None:
    safe_print("[artifacts] publishing docs and broken-docs demo surfaces")
    run_command(
        [
            resolve_python(),
            "scripts/publish-demo-surface.py",
            "--sync-broken-fixture",
        ]
    )


def git_status(paths: tuple[Path, ...]) -> str:
    if not paths:
        return ""
    command = ["git", "status", "--short", "--untracked-files=all", "--"]
    command.extend(str(path) for path in paths)
    result = run_command(command, capture_output=True)
    return result.stdout.strip()


def git_worktree_diff(paths: tuple[Path, ...]) -> str:
    if not paths:
        return ""
    command = ["git", "diff", "--name-only", "--"]
    command.extend(str(path) for path in paths)
    result = run_command(command, capture_output=True)
    return result.stdout.strip()


def stage_paths(paths: tuple[Path, ...]) -> None:
    status = git_status(paths)
    if not status:
        return
    safe_print("[artifacts] staging managed generated outputs")
    run_command(["git", "add", "--", *(str(path) for path in paths)])


def require_clean_worktree(paths: tuple[Path, ...], *, context: str) -> None:
    drift = git_worktree_diff(paths)
    if not drift:
        return
    safe_print(f"[artifacts] {context} left unstaged drift in managed paths:")
    for line in drift.splitlines():
        safe_print(f"  - {line}")
    raise SystemExit(1)


def execute_scope(config: ScopeConfig) -> None:
    if config.sync_vss_sdk:
        sync_vss_sdk()
    if config.build_ui:
        build_ui()
    if config.sync_ui_bundle:
        sync_ui_bundle()
    if config.publish_demo_surface:
        publish_demo_surface()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Synchronize or verify managed generated repository artifacts."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    for command_name in ("sync", "verify"):
        subparser = subparsers.add_parser(command_name)
        subparser.add_argument(
            "--scope",
            choices=tuple(SCOPE_CONFIG.keys()),
            default="all",
        )

    sync_parser = subparsers.choices["sync"]
    sync_parser.add_argument("--stage", action="store_true")
    sync_parser.add_argument("--require-clean", action="store_true")

    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = SCOPE_CONFIG[args.scope]

    execute_scope(config)

    if args.command == "sync":
        if args.stage:
            stage_paths(config.stage_paths)
        if args.require_clean:
            require_clean_worktree(config.verify_paths, context="sync")
        safe_print(f"[artifacts] sync complete for scope={config.name}")
        return 0

    require_clean_worktree(config.verify_paths, context="verification")
    safe_print(f"[artifacts] verification passed for scope={config.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
