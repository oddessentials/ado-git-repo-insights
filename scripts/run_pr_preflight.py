#!/usr/bin/env python3
"""Run the local PR preflight with stable paths.

This command is the authoritative local gate before pushing:
- mypy on src/ tests/ scripts/
- demo dashboard validation tests
- full Python test suite with coverage
- extension build/type/lint/test checks
- repo-owned generated-artifact parity checks
- suppression policy gate against the main-branch baseline

It uses machine-neutral temp/cache/coverage paths under the OS temp directory
to avoid Windows-specific lock and cleanup failures in the repo root.
"""

from __future__ import annotations

import argparse
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
    show_output_on_success: bool = False


@dataclass(frozen=True)
class CommandResult:
    command: tuple[str, ...]
    returncode: int
    stdout: str
    stderr: str


def safe_print(text: str = "") -> None:
    try:
        print(text)
    except UnicodeEncodeError:
        encoding = sys.stdout.encoding or "utf-8"
        sanitized = text.encode(encoding, errors="replace").decode(encoding)
        print(sanitized)


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


def main_branch_suppression_baseline() -> Path | None:
    baseline_path = PREFLIGHT_ROOT / "baseline" / "main-suppression-baseline.json"
    baseline_path.parent.mkdir(parents=True, exist_ok=True)
    # Fetch origin/main so the baseline is fresh, not stale
    fetch_result = run_subprocess(
        ["git", "fetch", "origin", "main", "--quiet"],
        cwd=REPO_ROOT,
    )
    if fetch_result.returncode != 0:
        safe_print(
            "[WARNING] Could not fetch origin/main for suppression baseline. "
            "Suppression diff may use a stale baseline or be skipped."
        )
    result = run_subprocess(
        ["git", "show", "origin/main:.suppression-baseline.json"],
        cwd=REPO_ROOT,
    )
    if result.returncode != 0 or not result.stdout.strip():
        safe_print(
            "[WARNING] Suppression baseline not available from origin/main. "
            "Suppression diff will run without a baseline comparison."
        )
        return None
    baseline_path.write_text(result.stdout, encoding="utf-8", newline="\n")
    return baseline_path


def build_commands(
    suppression_baseline: Path | None, *, strict: bool = False
) -> tuple[CommandSpec, ...]:
    # Suppression audit runs in strict mode for ALL branches (no --allow-pending-approval).
    # Prior parity gap: non-strict branches used warning-only mode locally but CI
    # enforced strictly, causing repeated churn (PR #207 incident).
    # CI-hard-gate checks must never exist in a weaker local mode.
    local_suppression_gate = ["__PYTHON__", "scripts/audit-suppressions.py", "--diff"]
    if suppression_baseline is not None:
        local_suppression_gate.extend(("--baseline", str(suppression_baseline)))

    suppression_env = {
        # Local preflight must not inherit ambient CI metadata and accidentally
        # drift between shell sessions or hosted runners.
        "GITHUB_EVENT_NAME": "",
        "GITHUB_REF": "",
        "GITHUB_EVENT_PATH": "",
    }

    commands = [
        CommandSpec(
            "Suppression baseline sync gate",
            tuple(local_suppression_gate),
            extra_env=suppression_env,
        ),
        CommandSpec(
            "Suppression scope coverage (FR-026)",
            ("__PYTHON__", "scripts/audit-suppressions.py", "--check-coverage"),
        ),
        CommandSpec(
            "Baseline staleness (FR-025)",
            ("__PYTHON__", "scripts/audit-suppressions.py", "--check-staleness"),
        ),
        CommandSpec(
            "Rule-disable invariants (FR-014)",
            (
                "__PYTHON__",
                "scripts/check_rule_disable_invariants.py",
                "--check-subprocess",
                "--check-random",
                "--check-syspath",
                "--verify-artifacts",
            ),
        ),
        CommandSpec(
            "Python type check",
            ("__PYTHON__", "-m", "mypy", "src/", "tests/", "scripts/"),
        ),
        CommandSpec(
            "No typing.Any in src/ (QG-40)",
            ("__PYTHON__", "scripts/check_no_any_types.py"),
        ),
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
                "--junit-xml=test-results.xml",
                "--cov-report=xml",
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
        CommandSpec(
            "Extension test type check",
            (PNPM_SENTINEL, "run", "build:check-tests"),
            cwd=EXTENSION_ROOT,
        ),
        CommandSpec(
            "Extension test config parity",
            (PNPM_SENTINEL, "run", "test:config-parity"),
            cwd=EXTENSION_ROOT,
        ),
        CommandSpec(
            "Extension lint",
            (PNPM_SENTINEL, "run", "lint"),
            cwd=EXTENSION_ROOT,
        ),
        CommandSpec(
            "Extension test lint",
            (PNPM_SENTINEL, "run", "lint:tests"),
            cwd=EXTENSION_ROOT,
        ),
        CommandSpec(
            "Extension UI bundle",
            (PNPM_SENTINEL, "run", "build:ui"),
            cwd=EXTENSION_ROOT,
        ),
        CommandSpec(
            "Generated artifact parity",
            (
                "__PYTHON__",
                "scripts/manage_generated_artifacts.py",
                "verify",
                "--scope",
                "all",
            ),
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
            "Coverage delta parity (Codecov project status)",
            (
                "__PYTHON__",
                "scripts/check_coverage_delta.py",
                "--python-coverage",
                "coverage.xml",
                "--ts-coverage",
                "extension/coverage/lcov.info",
                "--ts-summary",
                "extension/coverage/coverage-summary.json",
            ),
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
            "Extension VSIX artifact inspection",
            (PNPM_SENTINEL, "run", "test:vsix"),
            cwd=EXTENSION_ROOT,
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
        # --- CI parity gates (close audit gaps) ---
        CommandSpec(
            "Python test count validation",
            (
                "__PYTHON__",
                ".github/scripts/validate-test-results.py",
                "test-results.xml",
                "--min-collected=1236",
                "--max-skips=0",
            ),
        ),
        CommandSpec(
            "Extension test count validation",
            (
                "__PYTHON__",
                ".github/scripts/validate-test-results.py",
                "extension/test-results.xml",
                "--min-collected=2304",
                "--max-skips=0",
            ),
        ),
        CommandSpec(
            "Python package build check",
            (
                "__PYTHON__",
                "-m",
                "build",
                "--sdist",
                "--outdir",
                str(base_temp("build")),
            ),
        ),
        CommandSpec(
            "Extension task unit tests",
            ("node", "extension/tasks/extract-prs/index.test.js"),
        ),
        CommandSpec(
            "Task input validation",
            (
                PNPM_SENTINEL,
                "exec",
                "ts-node",
                "../scripts/validate-task-inputs.ts",
            ),
            cwd=EXTENSION_ROOT,
        ),
        CommandSpec(
            "Pandas version policy",
            (
                "__PYTHON__",
                "-c",
                "import sys, pandas as pd; "
                "major = int(pd.__version__.split('.')[0]); "
                "py_minor = sys.version_info.minor; "
                "expected = 2 if py_minor == 10 else 3; "
                "sys.exit(0) if major == expected else "
                "(print(f'Pandas major {major} != expected {expected} for Python 3.{py_minor}'), sys.exit(1))",
            ),
        ),
        CommandSpec(
            "Demo generation contract",
            ("__PYTHON__", "scripts/validate_demo_generation_contract.py"),
        ),
        CommandSpec(
            "Demo directory size check",
            (
                "__PYTHON__",
                "-c",
                "from pathlib import Path; "
                "size = sum(f.stat().st_size for f in Path('docs').rglob('*') if f.is_file()); "
                "limit = 50 * 1024 * 1024; "
                "print(f'docs/ size: {size / 1024 / 1024:.1f} MB (limit: 50 MB)'); "
                "exit(1) if size > limit else None",
            ),
        ),
        CommandSpec(
            "Threshold change guard",
            (
                "__PYTHON__",
                "scripts/check_threshold_changes.py",
                "--base-ref",
                "origin/main",
            ),
        ),
    ]

    # Secret scanning: gitleaks parity with CI (QG-35)
    gitleaks = resolve_gitleaks()
    if gitleaks is not None:
        commands.append(
            CommandSpec(
                "Secret scan (gitleaks)",
                (gitleaks, "detect", "--config=.gitleaks.toml", "--verbose"),
            ),
        )
    else:
        safe_print(
            "[WARNING] gitleaks not found on PATH — secret scanning skipped locally. "
            "CI will still block. Install: https://github.com/gitleaks/gitleaks#installing"
        )

    if suppression_baseline is not None:
        # When main-branch baseline is available, also run a comparison against it.
        # Uses the same strict mode as the committed-baseline gate (no preview/warning mode).
        main_suppression_command = [
            "__PYTHON__",
            "scripts/audit-suppressions.py",
            "--diff",
            "--baseline",
            str(suppression_baseline),
        ]
        commands.insert(
            1,
            CommandSpec(
                "Suppression main-baseline gate",
                tuple(main_suppression_command),
                extra_env=suppression_env,
                show_output_on_success=True,
            ),
        )

    return tuple(commands)


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


def run_subprocess(
    command: list[str],
    *,
    cwd: Path,
    env: dict[str, str] | None = None,
) -> CommandResult:
    # SECURITY: command lists are composed only from repo-owned CommandSpec entries
    # plus locally resolved tool paths; shell=False is preserved throughout.
    completed = subprocess.run(
        command,
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdin=subprocess.DEVNULL,
        check=False,
    )
    return CommandResult(
        command=tuple(command),
        returncode=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
    )


def render_command(command: tuple[str, ...] | list[str]) -> str:
    return " ".join(command)


def emit_output(prefix: str, text: str) -> None:
    if not text.strip():
        return
    safe_print(f"{prefix}:")
    safe_print(text.rstrip())


def require_success(result: CommandResult, *, step_name: str) -> None:
    if result.returncode == 0:
        return
    safe_print(f"\n[ERROR] {step_name} failed")
    safe_print(f"Command: {render_command(result.command)}")
    safe_print(f"Exit code: {result.returncode}")
    emit_output("stdout", result.stdout)
    emit_output("stderr", result.stderr)
    raise SystemExit(result.returncode)


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
            probe = subprocess.run(
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
        found = shutil.which(candidate)
        if found and probe_python_version(found) == BASELINE_PYTHON:
            return found

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


def resolve_gitleaks() -> str | None:
    resolved = shutil.which("gitleaks")
    if resolved:
        return resolved
    return None


def ensure_node_child_processes_work() -> bool:
    """Check Node.js child-process health.  Returns True if OK, False on failure.

    On failure, logs a warning instead of raising SystemExit so that
    Python-only gates (lint, mypy, suppression audit) still execute.
    """
    node = shutil.which("node")
    if node is None:
        safe_print(
            "[WARNING] Node.js not found on PATH — "
            "extension gates will be skipped, but lint/mypy/audit will still run."
        )
        return False

    try:
        probe = subprocess.run(
            [
                node,
                "-e",
                "require('child_process').execFileSync(process.execPath,['-e','process.exit(0)']); console.log('node-child-ok')",
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if probe.returncode == 0:
            return True
        detail = probe.stderr.strip() or probe.stdout.strip() or "unknown failure"
    except (subprocess.TimeoutExpired, OSError) as exc:
        detail = str(exc)

    safe_print(
        "[WARNING] Node child-process check failed — "
        "extension gates will be skipped, but lint/mypy/audit will still run. "
        f"Diagnostic: {detail}"
    )
    return False


def check_runner_self(
    python_executable: str,
    pnpm_executable: str,
    *,
    verbose: bool,
) -> None:
    checks = (
        (
            "Baseline Python subprocess",
            [python_executable, "-c", "print('python-ok')"],
        ),
        (
            "pnpm availability",
            [pnpm_executable, "--version"],
        ),
    )

    for name, command in checks:
        result = run_subprocess(command, cwd=REPO_ROOT)
        require_success(result, step_name=name)
        if verbose:
            emit_output("stdout", result.stdout)


def run_command(
    spec: CommandSpec,
    python_executable: str,
    pnpm_executable: str,
    *,
    verbose: bool,
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

    safe_print(f"\n==> {spec.name}")
    if verbose:
        safe_print(f"$ {render_command(command)}")
        safe_print(f"cwd: {spec.cwd}")
    result = run_subprocess(command, cwd=spec.cwd, env=env)
    require_success(result, step_name=spec.name)
    if verbose or spec.show_output_on_success:
        emit_output("stdout", result.stdout)
        emit_output("stderr", result.stderr)


def ensure_tooling() -> bool:
    """Check required tools. Returns True if Node is healthy."""
    resolve_pnpm()
    return ensure_node_child_processes_work()


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
    # Clean build artifacts from previous runs to avoid accumulation
    build_dir = base_temp("build")
    if build_dir.exists():
        shutil.rmtree(build_dir, ignore_errors=True)
    build_dir.mkdir(parents=True, exist_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the authoritative local PR preflight.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print command lines and successful subprocess output.",
    )
    parser.add_argument(
        "--self-check",
        action="store_true",
        help="Only validate runner prerequisites and subprocess plumbing.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Run in strict CI-parity mode: suppression increases block the push "
        "(no --allow-pending-approval). Automatically enabled for refactor/* branches.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    python_executable = resolve_baseline_python()
    python_version = probe_python_version(python_executable) or BASELINE_PYTHON

    safe_print("Running local PR preflight")
    safe_print(f"Baseline Python: {python_version}")
    safe_print("Stable temp/cache paths: enabled")
    if args.verbose:
        safe_print(f"Repository root: {REPO_ROOT}")
        safe_print(f"Resolved Python: {python_executable}")
        safe_print(f"Stable temp root: {PREFLIGHT_ROOT}")

    node_ok = ensure_tooling()
    ensure_paths()
    pnpm_executable = resolve_pnpm()
    check_runner_self(
        python_executable,
        pnpm_executable,
        verbose=args.verbose,
    )

    if args.self_check:
        safe_print("\n[OK] PR preflight self-check passed")
        return 0

    if args.strict:
        safe_print("[strict] CI-parity mode: suppression increases will block")
    commands = build_commands(main_branch_suppression_baseline(), strict=args.strict)
    skipped: list[str] = []
    for spec in commands:
        # Skip Node-dependent commands when Node is broken
        if not node_ok and PNPM_SENTINEL in spec.command:
            skipped.append(spec.name)
            continue
        run_command(
            spec,
            python_executable,
            pnpm_executable,
            verbose=args.verbose,
        )

    if skipped:
        safe_print(
            f"\n[WARNING] {len(skipped)} extension gate(s) skipped (Node unavailable):"
        )
        for name in skipped:
            safe_print(f"  - {name}")
        safe_print("CI will still enforce these gates.")

    safe_print("\n[OK] Local PR preflight passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
