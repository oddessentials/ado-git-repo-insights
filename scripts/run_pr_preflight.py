#!/usr/bin/env python3
"""Run the local PR preflight with stable paths.

This command is the authoritative local gate before pushing:
- mypy on src/
- demo dashboard validation tests
- full Python test suite with coverage
- extension build/type/lint/test checks

It uses machine-neutral temp/cache/coverage paths under the OS temp directory
to avoid Windows-specific lock and cleanup failures in the repo root.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EXTENSION_ROOT = REPO_ROOT / "extension"
PREFLIGHT_ROOT = Path(tempfile.gettempdir()) / "ado-git-repo-insights" / "pr-preflight"
BASELINE_PYTHON = "3.10"
PNPM_SENTINEL = "__PNPM__"


@dataclass(frozen=True)
class CommandSpec:
    name: str
    command: tuple[str, ...]
    cwd: Path = REPO_ROOT
    extra_env: dict[str, str] | None = None


def cache_dir(name: str) -> Path:
    return PREFLIGHT_ROOT / "cache" / name


def base_temp(name: str) -> Path:
    return PREFLIGHT_ROOT / "tmp" / name


def coverage_file(name: str) -> Path:
    return PREFLIGHT_ROOT / "coverage" / f".coverage.{name}"


def smoke_output_dir() -> Path:
    return PREFLIGHT_ROOT / "playwright" / "artifacts"


def smoke_report_dir() -> Path:
    return PREFLIGHT_ROOT / "playwright" / "report"


COMMANDS: tuple[CommandSpec, ...] = (
    CommandSpec("Python type check", ("__PYTHON__", "-m", "mypy", "src/")),
    CommandSpec(
        "Demo dashboard validation",
        (
            "__PYTHON__",
            "-m",
            "pytest",
            "tests/demo/",
            "-v",
            "--no-cov",
            "-o",
            f"cache_dir={cache_dir('demo')}",
            "--basetemp",
            str(base_temp("demo")),
        ),
    ),
    CommandSpec(
        "Full Python test suite with coverage",
        (
            "__PYTHON__",
            "-m",
            "pytest",
            "tests/",
            "-q",
            "-ra",
            "-o",
            f"cache_dir={cache_dir('python')}",
            "--basetemp",
            str(base_temp("python")),
        ),
        extra_env={"COVERAGE_FILE": str(coverage_file("python"))},
    ),
    CommandSpec(
        "Extension build check",
        (PNPM_SENTINEL, "run", "build:check"),
        cwd=EXTENSION_ROOT,
    ),
    CommandSpec("Extension lint", (PNPM_SENTINEL, "run", "lint"), cwd=EXTENSION_ROOT),
    CommandSpec(
        "Extension UI bundle", (PNPM_SENTINEL, "run", "build:ui"), cwd=EXTENSION_ROOT
    ),
    CommandSpec(
        "Extension type tests",
        (PNPM_SENTINEL, "run", "test:types"),
        cwd=EXTENSION_ROOT,
    ),
    CommandSpec(
        "Extension Jest CI",
        (
            PNPM_SENTINEL,
            "exec",
            "jest",
            "--ci",
            "--runInBand",
            "--coverage",
            "--reporters=default",
            "--reporters=jest-junit",
            "--testPathIgnorePatterns=vsix-artifact-inspection",
        ),
        cwd=EXTENSION_ROOT,
    ),
    CommandSpec(
        "Local patch coverage parity",
        (
            "__PYTHON__",
            "scripts/check_patch_coverage.py",
            "--base-ref",
            "origin/main",
            "--python-coverage",
            "coverage.xml",
            "--ts-coverage",
            "extension/coverage/lcov.info",
        ),
    ),
    CommandSpec(
        "Extension smoke tests",
        (PNPM_SENTINEL, "run", "test:smoke"),
        cwd=EXTENSION_ROOT,
        extra_env={
            "PLAYWRIGHT_OUTPUT_DIR": str(smoke_output_dir()),
            "PLAYWRIGHT_REPORT_DIR": str(smoke_report_dir()),
        },
    ),
)


def probe_python_version(executable: str) -> str | None:
    probe = subprocess.run(  # noqa: S603 - interpreter path is verified before use
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


def resolve_baseline_python() -> str:
    current_version = f"{sys.version_info.major}.{sys.version_info.minor}"
    if current_version == BASELINE_PYTHON:
        return sys.executable

    env_override = os.environ.get("PR_PREFLIGHT_PYTHON")
    if env_override:
        resolved = shutil.which(env_override) or env_override
        if probe_python_version(resolved) == BASELINE_PYTHON:
            return resolved
        raise SystemExit(
            "PR_PREFLIGHT_PYTHON is set, but it does not resolve to "
            f"Python {BASELINE_PYTHON}: {env_override}"
        )

    if sys.platform == "win32":
        launcher = shutil.which("py")
        if launcher:
            probe = subprocess.run(  # noqa: S603 - trusted local Python launcher
                [
                    launcher,
                    f"-{BASELINE_PYTHON}",
                    "-c",
                    "import sys; print(sys.executable)",
                ],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
            )
            if probe.returncode == 0:
                candidate = probe.stdout.strip()
                if probe_python_version(candidate) == BASELINE_PYTHON:
                    return candidate

    for candidate in (f"python{BASELINE_PYTHON}", "python3", "python"):
        resolved = shutil.which(candidate)
        if resolved and probe_python_version(resolved) == BASELINE_PYTHON:
            return resolved

    raise SystemExit(
        "Could not find a supported baseline interpreter for PR preflight. "
        f"Install Python {BASELINE_PYTHON} or set PR_PREFLIGHT_PYTHON."
    )


def resolve_pnpm() -> str:
    for candidate in ("pnpm.cmd", "pnpm"):
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise SystemExit("pnpm is required for PR preflight but was not found on PATH.")


def ensure_node_child_processes_work() -> None:
    node = shutil.which("node")
    if node is None:
        raise SystemExit(
            "Node.js is required for PR preflight but was not found on PATH."
        )

    probe = subprocess.run(  # noqa: S603 - local toolchain probe
        [
            node,
            "-e",
            "require('child_process').execFileSync(process.execPath,['-e','process.exit(0)']); console.log('node-child-ok')",
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    if probe.returncode == 0:
        return

    detail = probe.stderr.strip() or probe.stdout.strip() or "unknown failure"
    raise SystemExit(
        "Local PR preflight cannot run worker-based Node tooling on this machine. "
        "Node child-process creation failed before Playwright/Jest worker startup. "
        f"Diagnostic: {detail}"
    )


def run_command(
    spec: CommandSpec, python_executable: str, pnpm_executable: str
) -> None:
    env = os.environ.copy()
    if spec.extra_env:
        env.update(spec.extra_env)
    command = [
        python_executable
        if part == "__PYTHON__"
        else pnpm_executable
        if part == PNPM_SENTINEL
        else part
        for part in spec.command
    ]

    print(f"\n==> {spec.name}")
    print(f"$ {' '.join(command)}")
    subprocess.run(  # noqa: S603 - commands are repo-controlled
        command,
        cwd=spec.cwd,
        env=env,
        check=True,
    )


def ensure_tooling() -> None:
    resolve_pnpm()
    ensure_node_child_processes_work()


def ensure_paths() -> None:
    for path in (
        cache_dir("demo"),
        cache_dir("python"),
        base_temp("demo"),
        base_temp("python"),
        coverage_file("python").parent,
        smoke_output_dir(),
        smoke_report_dir(),
    ):
        path.mkdir(parents=True, exist_ok=True)


def main() -> int:
    python_executable = resolve_baseline_python()

    print("Running local PR preflight")
    print(f"Repository: {REPO_ROOT}")
    print(f"Baseline Python: {python_executable}")
    print(f"Stable temp root: {PREFLIGHT_ROOT}")

    ensure_tooling()
    ensure_paths()
    pnpm_executable = resolve_pnpm()

    for spec in COMMANDS:
        run_command(spec, python_executable, pnpm_executable)

    print("\n[OK] Local PR preflight passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
