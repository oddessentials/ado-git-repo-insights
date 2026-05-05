#!/usr/bin/env python3
"""Cross-platform demo dashboard builder.

Replaces the former Bash-only scripts/build-demo.sh with a Python
implementation that works identically on Windows, macOS, and Linux.

Steps:
  1. Resolve Python 3.12 (baseline interpreter for deterministic output).
  2. Sync extension dependencies with the lockfile.
  3. Run the canonical committed-demo builder (build-demo-dataset.py).
  4. Verify the published demo surface (required files, counts, size).

Usage:
    python scripts/build_demo.py

Exit codes:
    0  — success
    1  — verification failure (missing files, size exceeded)
    2  — setup failure (Python 3.12 not found, pnpm not found)
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EXTENSION_DIR = REPO_ROOT / "extension"
DOCS_DIR = REPO_ROOT / "docs"
SCRIPTS_DIR = REPO_ROOT / "scripts"
BASELINE_PYTHON_VERSION = "3.12"
SIZE_LIMIT_MB = 50


def safe_print(text: str = "") -> None:
    """Print with encoding fallback for non-UTF-8 terminals."""
    try:
        print(text)
    except UnicodeEncodeError:
        encoding = sys.stdout.encoding or "utf-8"
        sanitized = text.encode(encoding, errors="replace").decode(encoding)
        print(sanitized)


def _probe_python_version(executable: str) -> str | None:
    """Return 'major.minor' version string for *executable*, or None on failure."""
    try:
        result = subprocess.run(
            [
                executable,
                "-c",
                "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except OSError:
        pass
    return None


def _version_at_least(version_str: str | None, minimum: str) -> bool:
    """Return True if *version_str* (e.g. '3.14') is >= *minimum* (e.g. '3.12')."""
    if version_str is None:
        return False
    try:
        actual = tuple(int(p) for p in version_str.split("."))
        required = tuple(int(p) for p in minimum.split("."))
        return actual >= required
    except (ValueError, TypeError):
        return False


def _is_exact_version(version_str: str | None, target: str) -> bool:
    """Return True if *version_str* (e.g. '3.12') matches *target* exactly."""
    return version_str == target


def resolve_baseline_python() -> str:
    """Find exactly Python 3.12 for deterministic demo generation.

    The committed-demo generator (demo_generation_common.require_demo_generation_baseline)
    requires exactly Python 3.12.x — not 3.13+. This mirrors the old build-demo.sh
    behavior of resolving specifically to 3.12.
    """
    # Current interpreter — only if exact match
    current = f"{sys.version_info.major}.{sys.version_info.minor}"
    if _is_exact_version(current, BASELINE_PYTHON_VERSION):
        return sys.executable

    # Windows: py launcher with exact version (most reliable on fresh Windows installs)
    if sys.platform == "win32":
        launcher = shutil.which("py")
        if launcher:
            try:
                probe = subprocess.run(
                    [
                        launcher,
                        f"-{BASELINE_PYTHON_VERSION}",
                        "-c",
                        "import sys; print(sys.executable)",
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if probe.returncode == 0:
                    candidate = probe.stdout.strip()
                    if _is_exact_version(
                        _probe_python_version(candidate), BASELINE_PYTHON_VERSION
                    ):
                        return candidate
            except OSError:
                pass

    # Cross-platform fallback cascade — exact match only
    for candidate_name in (f"python{BASELINE_PYTHON_VERSION}", "python3", "python"):
        found = shutil.which(candidate_name)
        if found and _is_exact_version(
            _probe_python_version(found), BASELINE_PYTHON_VERSION
        ):
            return found

    safe_print(
        f"[SETUP] Python {BASELINE_PYTHON_VERSION} (exactly) is required for "
        "canonical committed-demo generation."
    )
    safe_print(
        f"  Install Python {BASELINE_PYTHON_VERSION}, then rerun: "
        "python scripts/build_demo.py"
    )
    raise SystemExit(2)


def resolve_pnpm() -> str:
    """Find pnpm on PATH."""
    for candidate in ("pnpm.cmd", "pnpm"):
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    safe_print("[SETUP] pnpm not found on PATH.")
    safe_print("  Install: https://pnpm.io/installation")
    safe_print("  Required for: Extension dependency installation")
    raise SystemExit(2)


def run_step(
    command: list[str],
    *,
    cwd: Path = REPO_ROOT,
    step_name: str,
) -> None:
    """Run a subprocess and fail with a clear message on error."""
    result = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        safe_print(f"[GATE] {step_name} failed (exit code {result.returncode})")
        safe_print(f"  Command: {' '.join(command)}")
        raise SystemExit(result.returncode)


def get_static_asset_list(python: str) -> list[str]:
    """Get the canonical static asset filenames from publish-demo-surface.py."""
    result = subprocess.run(
        [python, str(SCRIPTS_DIR / "publish-demo-surface.py"), "--list-assets"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        safe_print("[GATE] Failed to list static assets from publish-demo-surface.py")
        raise SystemExit(result.returncode)
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def count_json_files(directory: Path) -> int:
    """Count .json files in a directory (non-recursive)."""
    if not directory.is_dir():
        return 0
    return sum(1 for f in directory.iterdir() if f.suffix == ".json" and f.is_file())


def directory_size_bytes(directory: Path) -> int:
    """Total size of all files under *directory* in bytes."""
    total = 0
    for path in directory.rglob("*"):
        if path.is_file():
            total += path.stat().st_size
    return total


def format_size(size_bytes: int) -> str:
    """Format bytes as a human-readable string."""
    if size_bytes >= 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024 * 1024):.1f}G"
    if size_bytes >= 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f}M"
    if size_bytes >= 1024:
        return f"{size_bytes / 1024:.1f}K"
    return f"{size_bytes}B"


def verify_output(python: str) -> int:
    """Verify the demo surface output. Returns count of missing files."""
    safe_print("[3/3] Verifying output...")

    static_assets = get_static_asset_list(python)
    required_files = [
        "index.html",
        "data/dataset-manifest.json",
        "data/aggregates/dimensions.json",
        *static_assets,
    ]

    missing = 0
    for relative_path in required_files:
        full_path = DOCS_DIR / relative_path
        if full_path.is_file():
            safe_print(f"  + {relative_path}")
        else:
            safe_print(f"  x {relative_path} MISSING")
            missing += 1

    rollup_dir = DOCS_DIR / "data" / "aggregates" / "weekly_rollups"
    rollup_count = count_json_files(rollup_dir)
    safe_print(f"  + Weekly rollups: {rollup_count} files")

    dist_dir = DOCS_DIR / "data" / "aggregates" / "distributions"
    dist_count = count_json_files(dist_dir)
    safe_print(f"  + Distributions: {dist_count} files")

    docs_size = directory_size_bytes(DOCS_DIR)
    safe_print(f"  + Total size: {format_size(docs_size)}")

    if docs_size > SIZE_LIMIT_MB * 1024 * 1024:
        safe_print(
            f"\n[GATE] docs/ size ({format_size(docs_size)}) exceeds "
            f"{SIZE_LIMIT_MB} MB limit"
        )
        missing += 1

    return missing


def main() -> int:
    """Build the demo dashboard for GitHub Pages deployment."""
    safe_print("=== Building Demo Dashboard ===")
    safe_print(f"Repository root: {REPO_ROOT}")
    safe_print("")

    python = resolve_baseline_python()
    python_version = _probe_python_version(python) or BASELINE_PYTHON_VERSION
    safe_print(f"Baseline Python: {python_version} ({python})")
    safe_print("")

    pnpm = resolve_pnpm()

    # Step 1: Prepare extension dependencies
    safe_print("[1/3] Preparing extension dependencies...")
    safe_print("  Syncing extension dependencies to pnpm-lock.yaml...")
    run_step(
        [pnpm, "install", "--frozen-lockfile"],
        cwd=EXTENSION_DIR,
        step_name="Extension dependency sync",
    )

    # Step 2: Build canonical enterprise demo data and docs surface
    safe_print("[2/3] Building canonical enterprise demo dataset and surface...")
    run_step(
        [python, str(SCRIPTS_DIR / "build-demo-dataset.py"), "--commit-canonical"],
        step_name="Demo dataset generation",
    )
    safe_print("")

    # Step 3: Verify output
    missing = verify_output(python)

    safe_print("")
    if missing > 0:
        safe_print(f"[GATE] {missing} required file(s) are missing!")
        return 1

    safe_print("[3/3] Demo surface published successfully.")
    safe_print("=== Build Complete ===")
    safe_print("")
    safe_print("To preview locally:")
    safe_print("  cd docs && python -m http.server 8080")
    safe_print("  Open: http://localhost:8080")
    safe_print("")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
