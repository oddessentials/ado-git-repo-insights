#!/usr/bin/env python3
"""
Run a local CI parity check for CI-critical Python paths.

This script has two layers:
- compatibility: run CI-critical Python entrypoints directly under each
  supported interpreter to catch version-specific import/runtime issues
- isolated: create per-version virtual environments and run deeper smoke checks

Use compatibility mode as the minimum cross-version gate before pushing.
Use full mode when you need stronger confidence and the local interpreters are
healthy enough to create isolated environments.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import NoReturn

REPO_ROOT = Path(__file__).resolve().parent.parent
PARITY_ROOT = REPO_ROOT / ".ci-parity"
SUPPORTED_PYTHONS = ("3.10", "3.11", "3.12")


@dataclass(frozen=True)
class Check:
    name: str
    command: tuple[str, ...]


COMPATIBILITY_CHECKS: tuple[Check, ...] = (
    Check("Tool version parity", ("scripts/check_tool_versions.py",)),
    Check(
        "Suppression justification audit",
        ("scripts/audit-suppressions.py", "--check-justifications"),
    ),
    Check(
        "JUnit validator CLI smoke",
        (".github/scripts/validate-test-results.py", "--help"),
    ),
    Check(
        "Badge generator CLI smoke",
        (".github/scripts/generate-badge-json.py", "--help"),
    ),
)

ISOLATED_CHECKS: tuple[Check, ...] = (
    Check(
        "Base-compatible schema tests",
        (
            "-m",
            "pytest",
            "-o",
            "addopts=-ra -q",
            "tests/unit/test_ml_cli_flags.py",
            "tests/unit/test_insights_schema.py",
            "tests/unit/test_predictions_schema.py",
        ),
    ),
    Check(
        "Standalone demo manifest refresh smoke",
        (
            "-m",
            "pytest",
            "-o",
            "addopts=",
            "-q",
            "tests/demo/test_regeneration.py::TestDeterministicRegeneration::test_generate_demo_predictions_is_deterministic",
            "tests/demo/test_regeneration.py::TestDeterministicRegeneration::test_generate_demo_insights_is_deterministic",
        ),
    ),
)


def run_command(
    command: list[str],
    *,
    cwd: Path = REPO_ROOT,
    env: dict[str, str] | None = None,
) -> None:
    print(f"$ {' '.join(command)}")
    subprocess.run(
        command,
        cwd=cwd,
        env=env,
        check=True,
    )


def fail(message: str) -> NoReturn:
    raise SystemExit(message)


def probe_python_version(executable: str) -> str | None:
    probe = subprocess.run(
        [
            executable,
            "-c",
            "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    if probe.returncode != 0:
        return None
    return probe.stdout.strip()


def run_syntax_check(interpreter: str, version: str) -> None:
    print(f"\n[{version}] Syntax check for CI-invoked Python code")
    script = """
from pathlib import Path

targets = [Path("scripts"), Path(".github/scripts"), Path("src"), Path("tests")]
for root in targets:
    for path in sorted(root.rglob("*.py")):
        source = path.read_text(encoding="utf-8")
        compile(source, str(path), "exec")

print("[OK] Python source compiled without syntax errors")
"""
    run_command([interpreter, "-c", script])


def resolve_python(version: str) -> str | None:
    current_version = f"{sys.version_info.major}.{sys.version_info.minor}"
    if current_version == version:
        return sys.executable

    env_override = os.environ.get(f"CI_PARITY_PYTHON_{version.replace('.', '_')}")
    if env_override:
        resolved_override = shutil.which(env_override) or env_override
        if probe_python_version(resolved_override) == version:
            return resolved_override

    if sys.platform == "win32":
        launcher = shutil.which("py")
        if launcher:
            probe = subprocess.run(
                [launcher, f"-{version}", "-c", "import sys; print(sys.executable)"],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
            )
            if probe.returncode == 0:
                candidate = probe.stdout.strip()
                if probe_python_version(candidate) == version:
                    return candidate

    candidates = [f"python{version}", "python3", "python"]
    for candidate in candidates:
        resolved = shutil.which(candidate)
        if resolved and probe_python_version(resolved) == version:
            return resolved

    return None


def venv_python(venv_dir: Path) -> Path:
    if sys.platform == "win32":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def ensure_venv(interpreter: str, version: str) -> Path:
    PARITY_ROOT.mkdir(exist_ok=True)
    venv_dir = PARITY_ROOT / f"py{version.replace('.', '')}"
    python_path = venv_python(venv_dir)

    if not python_path.exists():
        print(f"\n[setup] Creating parity venv for Python {version}")
        try:
            run_command([interpreter, "-m", "venv", str(venv_dir)])
        except subprocess.CalledProcessError as exc:
            fail(
                f"Python {version} is installed at {interpreter}, but local CI parity "
                f"could not create a virtual environment in {venv_dir}. "
                "Repair that Python installation or point CI_PARITY_PYTHON_"
                f"{version.replace('.', '_')} at a working interpreter. "
                f"Original error: {exc}"
            )

    print(f"\n[setup] Installing dev dependencies for Python {version}")
    try:
        run_command([str(python_path), "-m", "pip", "install", "--upgrade", "pip"])
        run_command([str(python_path), "-m", "pip", "install", "-e", ".[dev]"])
    except subprocess.CalledProcessError as exc:
        fail(
            f"Python {version} parity environment failed during dependency install. "
            "This machine cannot currently reproduce the CI interpreter cleanly. "
            f"Original error: {exc}"
        )
    return python_path


def run_compatibility_matrix(versions: list[str]) -> None:
    missing: list[str] = []

    for version in versions:
        interpreter = resolve_python(version)
        if interpreter is None:
            missing.append(version)
            continue

        print(f"\n=== Python {version} compatibility ===")
        run_syntax_check(interpreter, version)
        for check in COMPATIBILITY_CHECKS:
            print(f"\n[{version}] {check.name}")
            run_command([interpreter, *check.command])

    if missing:
        joined = ", ".join(missing)
        fail(
            "Missing required local Python interpreters for CI parity: "
            f"{joined}. Install them or run with Docker-backed parity enabled."
        )


def run_isolated_matrix(versions: list[str]) -> None:
    for version in versions:
        interpreter = resolve_python(version)
        if interpreter is None:
            fail(
                "Missing required local Python interpreters for isolated CI parity: "
                f"{version}."
            )

        print(f"\n=== Python {version} isolated parity ===")
        python_path = ensure_venv(interpreter, version)
        for check in ISOLATED_CHECKS:
            print(f"\n[{version}] {check.name}")
            run_command([str(python_path), *check.command])


def check_docker_available() -> bool:
    docker = shutil.which("docker")
    if docker is None:
        return False

    probe = subprocess.run(
        [docker, "version"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    return probe.returncode == 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run local CI parity checks for supported Python versions."
    )
    parser.add_argument(
        "--python-version",
        dest="python_versions",
        action="append",
        choices=SUPPORTED_PYTHONS,
        help="Python version to verify. Defaults to all supported versions.",
    )
    parser.add_argument(
        "--mode",
        choices=("compatibility", "full"),
        default="compatibility",
        help="compatibility runs direct cross-version smoke checks; full also runs isolated venv checks.",
    )
    parser.add_argument(
        "--require-docker-linux",
        action="store_true",
        help="Fail unless Docker-backed Linux parity is available.",
    )
    args = parser.parse_args()

    versions = args.python_versions or list(SUPPORTED_PYTHONS)

    print("Running local CI parity")
    print(f"Repository: {REPO_ROOT}")
    print(f"Mode: {args.mode}")
    print(f"Python matrix: {', '.join(versions)}")

    docker_available = check_docker_available()
    print(f"Docker Linux parity available: {'yes' if docker_available else 'no'}")
    if args.require_docker_linux and not docker_available:
        fail(
            "Docker Linux parity is required but Docker Desktop is not reachable. "
            "Start Docker Desktop or omit --require-docker-linux."
        )

    run_compatibility_matrix(versions)
    if args.mode == "full":
        run_isolated_matrix(versions)

    print("\n[OK] Local CI parity checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
