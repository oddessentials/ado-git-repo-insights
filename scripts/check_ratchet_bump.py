#!/usr/bin/env python3
"""Enforce per-commit ``--min-collected`` ratchet-bump discipline (issue #280).

Strict-equality gate. At HEAD, the actual collected test count for both
the Python and Extension suites MUST equal the declared ``--min-collected``
floor, AND the two authoritative sites — ``scripts/run_pr_preflight.py``
and ``.github/workflows/ci.yml`` — MUST agree with each other. Any drift
in either dimension fails the gate.

Bypass markers (any commit message in ``{base-ref}..HEAD``):
    [ratchet-realignment]    Floor jumped by more than the test-add delta
                             (catching up on historical drift).
    [ratchet-test-removal]   Floor decreased intentionally for test removal.

Design notes (plan v4 fixes):
    Fix 1 — CI YAML parsed with :mod:`scripts._ci_yaml_parser` which folds
            backslash-continuation lines before regex. Naive regex on the
            raw multiline ``run:`` block would miss flags.
    Fix 2 — Python count comes from a subprocess-isolated ``pytest
            --collect-only`` run with ``PYTEST_DISABLE_PLUGIN_AUTOLOAD=1``
            and ``scripts._pytest_count_collector`` as the only loaded
            plugin. Zero stdout parsing; the plugin writes the count to
            a tempfile. Extension count comes from the canonical JUnit
            XML via defusedxml.
    Fix 3 — Shallow-clone handling uses ``git fetch --unshallow`` (not
            ``--depth=N``), fetches the exact base ref with full history,
            and fails with an explicit setup error if the ref is still
            unreachable after one deterministic attempt.
    Fix 4 — The CI job deliberately does NOT download or assert the Python
            JUnit artifact — Python is measured in-job via the same
            subprocess collector used locally. Only the artifact the gate
            actually consumes (Extension JUnit) is asserted present.

Exit codes:
    0  Aligned or marker-exempted.
    1  Drift detected (strict-equality or inter-file parity).
    2  Setup error (missing file, shallow clone, malformed YAML, etc.).
"""

from __future__ import annotations

import argparse
import ast
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from _ci_yaml_parser import (
    CiYamlParseError,
    extract_flag_value,
    extract_shell_commands,
    load_ci_run_block,
)
from defusedxml.ElementTree import ParseError as XMLParseError
from defusedxml.ElementTree import parse as parse_xml

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PREFLIGHT_SCRIPT = REPO_ROOT / "scripts" / "run_pr_preflight.py"
DEFAULT_CI_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"
DEFAULT_EXTENSION_JUNIT = REPO_ROOT / "extension" / "test-results.xml"

EXIT_OK = 0
EXIT_DRIFT = 1
EXIT_SETUP = 2

REALIGNMENT_MARKER = "[ratchet-realignment]"
TEST_REMOVAL_MARKER = "[ratchet-test-removal]"
_BYPASS_MARKERS: tuple[str, ...] = (REALIGNMENT_MARKER, TEST_REMOVAL_MARKER)

_PYTHON_SPEC_NAME = "Python test count validation"
_EXTENSION_SPEC_NAME = "Extension test count validation"
_CI_PY_JOB = "test"
_CI_PY_STEP = "Validate Test Results (Python)"
_CI_EXT_JOB = "extension-tests"
_CI_EXT_STEP = "Validate Test Results (Extension)"

_MIN_COLLECTED_FLAG = "--min-collected"
_MIN_COLLECTED_RE = re.compile(re.escape(_MIN_COLLECTED_FLAG) + r"=(\d+)")


class RatchetSetupError(RuntimeError):
    """Raised when the gate cannot produce a verdict (maps to exit 2).

    Distinct from drift: a setup error means the measurement or parsing
    failed, so no aligned/drift conclusion can be drawn. Callers MUST
    exit 2 (not 1) so reviewers can distinguish "the gate broke" from
    "you need to bump the floor".
    """


@dataclass(frozen=True)
class FloorReadings:
    python: int
    extension: int


@dataclass(frozen=True)
class ActualCounts:
    python: int
    extension: int


# ---------------------------------------------------------------------------
# Preflight floor parsing (AST — no module execution, no side effects)
# ---------------------------------------------------------------------------


def read_preflight_floors(preflight_path: Path) -> FloorReadings:
    """Parse ``--min-collected`` floors from ``run_pr_preflight.py``.

    Uses :mod:`ast` rather than importing the module so the gate never
    triggers side effects in the preflight script's top-level code. The
    AST walk finds every ``CommandSpec(...)`` call, filters by the known
    spec names, and extracts the ``--min-collected=N`` token from the
    second-argument tuple literal.
    """
    try:
        source = preflight_path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise RatchetSetupError(
            f"Preflight script not found: {preflight_path}"
        ) from exc
    except OSError as exc:
        raise RatchetSetupError(f"{preflight_path}: could not read: {exc}") from exc

    try:
        tree = ast.parse(source, filename=str(preflight_path))
    except SyntaxError as exc:
        raise RatchetSetupError(f"{preflight_path}: syntax error: {exc}") from exc

    py_floor: int | None = None
    ext_floor: int | None = None

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Name) and func.id == "CommandSpec"):
            continue
        if not node.args:
            continue
        name_arg = node.args[0]
        if not (isinstance(name_arg, ast.Constant) and isinstance(name_arg.value, str)):
            continue
        spec_name = name_arg.value
        if spec_name not in (_PYTHON_SPEC_NAME, _EXTENSION_SPEC_NAME):
            continue
        if len(node.args) < 2:
            raise RatchetSetupError(
                f"{preflight_path}: CommandSpec {spec_name!r} missing command tuple"
            )
        command_node = node.args[1]
        if not isinstance(command_node, ast.Tuple):
            raise RatchetSetupError(
                f"{preflight_path}: CommandSpec {spec_name!r} command is not a "
                f"tuple literal (got: {type(command_node).__name__})"
            )
        command_text = _join_tuple_literal(command_node)
        value = _extract_min_collected(
            command_text, source=preflight_path, context=f"CommandSpec {spec_name!r}"
        )
        if spec_name == _PYTHON_SPEC_NAME:
            py_floor = value
        else:
            ext_floor = value

    if py_floor is None:
        raise RatchetSetupError(
            f"{preflight_path}: CommandSpec {_PYTHON_SPEC_NAME!r} not found"
        )
    if ext_floor is None:
        raise RatchetSetupError(
            f"{preflight_path}: CommandSpec {_EXTENSION_SPEC_NAME!r} not found"
        )
    return FloorReadings(python=py_floor, extension=ext_floor)


def _join_tuple_literal(command_node: ast.Tuple) -> str:
    parts: list[str] = []
    for elt in command_node.elts:
        if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
            parts.append(elt.value)
        else:
            parts.append("<non-literal>")
    return " ".join(parts)


def _extract_min_collected(text: str, *, source: Path, context: str) -> int:
    match = _MIN_COLLECTED_RE.search(text)
    if match is None:
        raise RatchetSetupError(
            f"{source}: {context} has no {_MIN_COLLECTED_FLAG}=N token "
            f"in command text: {text!r}"
        )
    return int(match.group(1))


# ---------------------------------------------------------------------------
# CI floor parsing (defensive YAML nav + backslash-continuation folding)
# ---------------------------------------------------------------------------


def read_ci_floors(ci_yaml_path: Path) -> FloorReadings:
    """Parse ``--min-collected`` floors from the two validate-test-results steps.

    Navigates the YAML defensively via :func:`load_ci_run_block` — every
    missing key / wrong type raises :class:`CiYamlParseError` with context
    rather than AttributeError. The shell ``run`` block is then folded
    via :func:`extract_shell_commands` so backslash-continuation flags
    are not silently lost before the regex search.
    """
    try:
        py_run = load_ci_run_block(ci_yaml_path, _CI_PY_JOB, _CI_PY_STEP)
        ext_run = load_ci_run_block(ci_yaml_path, _CI_EXT_JOB, _CI_EXT_STEP)
    except CiYamlParseError as exc:
        raise RatchetSetupError(str(exc)) from exc

    try:
        py_floor = _extract_ci_flag(py_run, ci_yaml_path, _CI_PY_JOB, _CI_PY_STEP)
        ext_floor = _extract_ci_flag(ext_run, ci_yaml_path, _CI_EXT_JOB, _CI_EXT_STEP)
    except CiYamlParseError as exc:
        raise RatchetSetupError(str(exc)) from exc

    return FloorReadings(python=py_floor, extension=ext_floor)


def _extract_ci_flag(
    run_block: str, ci_yaml_path: Path, job_name: str, step_name: str
) -> int:
    commands = extract_shell_commands(run_block)
    if not commands:
        raise CiYamlParseError(
            f"{ci_yaml_path}: job {job_name!r} step {step_name!r} has no "
            f"python/pnpm/mypy command after folding"
        )
    folded = " ".join(commands)
    return extract_flag_value(folded, _MIN_COLLECTED_FLAG)


# ---------------------------------------------------------------------------
# Python count via subprocess-isolated pytest collector
# ---------------------------------------------------------------------------


def measure_python_count() -> int:
    """Invoke ``pytest --collect-only`` via a hermetic subprocess.

    The subprocess runs with ``PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`` and
    ``-o addopts=`` so third-party plugins installed on the dev machine
    (pytest-randomly, pytest-xdist, pytest-sugar, etc.) cannot skew the
    collected count relative to CI's clean environment. Common plugin
    names are additionally disabled via ``-p no:<name>`` as defense in
    depth for cases where autoload already primed a plugin before the
    env variable took effect. The count is written to a tempfile by the
    committed :mod:`scripts._pytest_count_collector` plugin, so no
    stdout parsing is involved anywhere in the happy path.
    """
    with tempfile.TemporaryDirectory(prefix="ratchet-collect-") as tmp:
        count_file = Path(tmp) / "count.txt"
        scrubbed_env = {
            key: value
            for key, value in os.environ.items()
            if key not in {"PYTEST_ADDOPTS", "PYTEST_PLUGINS"}
        }
        scrubbed_env.update(
            {
                "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
                "RATCHET_COUNT_OUTPUT": str(count_file),
                "PYTHONDONTWRITEBYTECODE": "1",
                "COVERAGE_PROCESS_START": "",
                "COVERAGE_RCFILE": os.devnull,
            }
        )
        try:
            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "pytest",
                    "--collect-only",
                    "--no-header",
                    "-q",
                    "-o",
                    "addopts=",
                    "-p",
                    "no:cacheprovider",
                    "-p",
                    "no:randomly",
                    "-p",
                    "no:xdist",
                    "-p",
                    "no:sugar",
                    "-p",
                    "no:forked",
                    "-p",
                    "scripts._pytest_count_collector",
                    "--import-mode=importlib",
                    "--ignore-glob=**/test_*_windows.py",
                    "tests/",
                ],
                env=scrubbed_env,
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
        except OSError as exc:
            raise RatchetSetupError(
                f"Failed to spawn pytest for ratchet count: {exc}"
            ) from exc

        if result.returncode != 0:
            raise RatchetSetupError(
                "pytest collect-only failed.\n"
                f"  rc: {result.returncode}\n"
                f"  stdout: {result.stdout.strip()}\n"
                f"  stderr: {result.stderr.strip()}"
            )
        if not count_file.exists():
            raise RatchetSetupError(
                "pytest collect-only exited cleanly but the collector plugin "
                "did not write a count file. Check that "
                "'scripts._pytest_count_collector' loaded successfully."
            )
        try:
            raw = count_file.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise RatchetSetupError(
                f"Could not read ratchet count output {count_file}: {exc}"
            ) from exc
        try:
            return int(raw)
        except ValueError as exc:
            raise RatchetSetupError(
                f"Ratchet count output is not an integer: {raw!r}"
            ) from exc


# ---------------------------------------------------------------------------
# Extension count via JUnit XML parse
# ---------------------------------------------------------------------------


def measure_extension_count(junit_path: Path) -> int:
    """Parse the Extension JUnit XML for the total collected test count.

    Mirrors the layout handling in ``.github/scripts/validate-test-results.py``:
    the root may be ``<testsuites tests="N">`` (jest-junit) or ``<testsuite
    tests="N">`` (single-suite), and nested ``<testsuite>`` children are
    summed when the root does not carry a total attribute.
    """
    if not junit_path.exists():
        raise RatchetSetupError(
            f"Extension JUnit XML not found: {junit_path}. "
            f"Run 'pnpm --dir extension run test:coverage' first."
        )
    try:
        tree = parse_xml(str(junit_path))
    except XMLParseError as exc:
        raise RatchetSetupError(f"{junit_path}: XML parse error: {exc}") from exc
    except OSError as exc:
        raise RatchetSetupError(f"{junit_path}: could not read file: {exc}") from exc

    root = tree.getroot()
    if root.tag == "testsuites":
        total_attr = root.get("tests")
        if total_attr is not None:
            return _parse_int_attr(total_attr, junit_path, "testsuites@tests")
        total = 0
        for suite in root.findall("testsuite"):
            suite_attr = suite.get("tests")
            if suite_attr is None:
                raise RatchetSetupError(
                    f"{junit_path}: nested <testsuite> missing 'tests' attribute"
                )
            total += _parse_int_attr(suite_attr, junit_path, "testsuite@tests")
        return total
    if root.tag == "testsuite":
        suite_attr = root.get("tests")
        if suite_attr is None:
            raise RatchetSetupError(
                f"{junit_path}: <testsuite> missing 'tests' attribute"
            )
        return _parse_int_attr(suite_attr, junit_path, "testsuite@tests")
    raise RatchetSetupError(f"{junit_path}: unexpected XML root element: {root.tag!r}")


def _parse_int_attr(raw: str, junit_path: Path, context: str) -> int:
    try:
        return int(raw)
    except ValueError as exc:
        raise RatchetSetupError(
            f"{junit_path}: {context} is not an integer: {raw!r}"
        ) from exc


# ---------------------------------------------------------------------------
# Shallow-clone guard (deterministic --unshallow, never --depth=N)
# ---------------------------------------------------------------------------


def _run_git(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def _base_ref_present(base_ref: str) -> bool:
    result = _run_git("rev-parse", "--verify", f"{base_ref}^{{commit}}")
    return result.returncode == 0


def _range_history_consistent(base_ref: str) -> bool:
    """Check that ``git log base..HEAD`` agrees with ``git rev-list --count``.

    Detects silent history truncation where the tip is reachable but the
    rev-range is missing commits — a shallow-clone edge case that would
    otherwise cause the marker scan to miss bypass markers.
    """
    log_result = _run_git("log", "--oneline", f"{base_ref}..HEAD")
    if log_result.returncode != 0:
        return False
    log_commits = [line for line in log_result.stdout.splitlines() if line.strip()]
    count_result = _run_git("rev-list", "--count", f"{base_ref}..HEAD")
    if count_result.returncode != 0:
        return False
    try:
        expected = int(count_result.stdout.strip())
    except ValueError:
        return False
    return len(log_commits) == expected


def ensure_base_ref_reachable(base_ref: str) -> None:
    """Guarantee ``base_ref`` is reachable with full history, or fail.

    Never uses ``--depth=N``. Exactly one fetch attempt: ``--unshallow``
    if the clone is shallow, plain refspec fetch otherwise. After the
    single attempt, both the rev-parse check and the log/rev-list
    consistency check must pass; otherwise raise :class:`RatchetSetupError`
    so the gate exits 2 with an actionable diagnostic.
    """
    if _base_ref_present(base_ref) and _range_history_consistent(base_ref):
        return

    ref_name = base_ref.removeprefix("origin/")
    refspec = f"+refs/heads/{ref_name}:refs/remotes/origin/{ref_name}"
    is_shallow = (REPO_ROOT / ".git" / "shallow").exists()

    # Use _run_git (which passes a list literal as its first arg) so the
    # S603 guard stays satisfied and the fetch command stays auditable.
    # Two explicit branches rather than a mutated list makes the shell
    # command visible at a glance and keeps both paths list-literal.
    if is_shallow:
        fetch_result = _run_git("fetch", "--no-tags", "origin", refspec, "--unshallow")
        fetch_cmd_display = f"git fetch --no-tags origin {refspec} --unshallow"
    else:
        fetch_result = _run_git("fetch", "--no-tags", "origin", refspec)
        fetch_cmd_display = f"git fetch --no-tags origin {refspec}"

    if fetch_result.returncode != 0:
        raise RatchetSetupError(
            f"Failed to fetch full history for {base_ref}.\n"
            f"  command: {fetch_cmd_display}\n"
            f"  stderr: {fetch_result.stderr.strip()}\n"
            f"  CI fix: actions/checkout@v4 with fetch-depth: 0.\n"
            f"  Local fix: git fetch --unshallow origin {ref_name}."
        )

    if not _base_ref_present(base_ref) or not _range_history_consistent(base_ref):
        raise RatchetSetupError(
            f"After fetch, {base_ref} still unreachable or history "
            f"truncated. Ensure CI uses actions/checkout fetch-depth: 0 "
            f"or run 'git fetch --unshallow origin {ref_name}' locally. "
            f"No retries, no arbitrary --depth fallbacks."
        )


# ---------------------------------------------------------------------------
# Marker scanning (commit log in base..HEAD)
# ---------------------------------------------------------------------------


def scan_bypass_marker(base_ref: str) -> str | None:
    """Return the first bypass marker found in ``base_ref..HEAD``, or None."""
    result = _run_git("log", "--format=%s%n%b", f"{base_ref}..HEAD")
    if result.returncode != 0:
        raise RatchetSetupError(
            f"Could not read git log for {base_ref}..HEAD: {result.stderr.strip()}"
        )
    log_text = result.stdout
    for marker in _BYPASS_MARKERS:
        if marker in log_text:
            return marker
    return None


# ---------------------------------------------------------------------------
# Drift comparison
# ---------------------------------------------------------------------------


def drift_messages(
    *,
    preflight: FloorReadings,
    ci: FloorReadings,
    actual: ActualCounts,
    preflight_path: Path,
    ci_path: Path,
) -> list[str]:
    """Return zero or more drift messages. Empty list means the gate passes.

    Two drift categories are checked:

    1. Inter-file parity — the two authoritative sites must agree exactly.
       This is the self-contained parity assertion that makes the gate
       independent of the external ``TestTestCountRatchetParity`` test.
    2. Strict equality — ``actual == floor`` on both sides. A positive
       delta means tests were added without a floor bump; a negative
       delta means tests were removed without a floor decrease.
    """
    messages: list[str] = []

    if preflight.python != ci.python:
        messages.append(
            "Inter-file parity violation — Python floor mismatch:\n"
            f"  {preflight_path}: {_MIN_COLLECTED_FLAG}={preflight.python}\n"
            f"  {ci_path}: {_MIN_COLLECTED_FLAG}={ci.python}\n"
            "Both sites MUST match exactly; update them together in the "
            "same commit."
        )
    if preflight.extension != ci.extension:
        messages.append(
            "Inter-file parity violation — Extension floor mismatch:\n"
            f"  {preflight_path}: {_MIN_COLLECTED_FLAG}={preflight.extension}\n"
            f"  {ci_path}: {_MIN_COLLECTED_FLAG}={ci.extension}\n"
            "Both sites MUST match exactly; update them together in the "
            "same commit."
        )

    if actual.python != preflight.python:
        messages.append(
            f"Python ratchet drift: actual={actual.python}, "
            f"floor={preflight.python}.\n"
            f"  Delta: {actual.python - preflight.python:+d}\n"
            f"  Fix: update {_MIN_COLLECTED_FLAG}={actual.python} in BOTH:\n"
            f"    {preflight_path}\n"
            f"    {ci_path}"
        )
    if actual.extension != preflight.extension:
        messages.append(
            f"Extension ratchet drift: actual={actual.extension}, "
            f"floor={preflight.extension}.\n"
            f"  Delta: {actual.extension - preflight.extension:+d}\n"
            f"  Fix: update {_MIN_COLLECTED_FLAG}={actual.extension} in BOTH:\n"
            f"    {preflight_path}\n"
            f"    {ci_path}"
        )
    return messages


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def run_gate(
    *,
    preflight_path: Path,
    ci_workflow_path: Path,
    junit_extension_path: Path,
    base_ref: str,
) -> int:
    try:
        ensure_base_ref_reachable(base_ref)
    except RatchetSetupError as exc:
        print(f"[SETUP] {exc}", file=sys.stderr)
        return EXIT_SETUP

    try:
        marker = scan_bypass_marker(base_ref)
    except RatchetSetupError as exc:
        print(f"[SETUP] {exc}", file=sys.stderr)
        return EXIT_SETUP

    if marker is not None:
        print(
            f"[OK] Ratchet bump guard exempted via {marker} in commit log "
            f"range {base_ref}..HEAD."
        )
        return EXIT_OK

    try:
        preflight_floors = read_preflight_floors(preflight_path)
        ci_floors = read_ci_floors(ci_workflow_path)
        python_actual = measure_python_count()
        extension_actual = measure_extension_count(junit_extension_path)
    except RatchetSetupError as exc:
        print(f"[SETUP] {exc}", file=sys.stderr)
        return EXIT_SETUP

    actual = ActualCounts(python=python_actual, extension=extension_actual)

    messages = drift_messages(
        preflight=preflight_floors,
        ci=ci_floors,
        actual=actual,
        preflight_path=preflight_path,
        ci_path=ci_workflow_path,
    )

    if messages:
        for msg in messages:
            print(f"[DRIFT] {msg}", file=sys.stderr)
        print(
            f"[DRIFT] Bypass with {REALIGNMENT_MARKER} or "
            f"{TEST_REMOVAL_MARKER} in any commit message in "
            f"{base_ref}..HEAD.",
            file=sys.stderr,
        )
        return EXIT_DRIFT

    print(
        "[OK] Ratchet bump guard aligned:\n"
        f"  Python:    floor={preflight_floors.python}, actual={actual.python}\n"
        f"  Extension: floor={preflight_floors.extension}, "
        f"actual={actual.extension}\n"
        f"  Parity:    {preflight_path.name} == {ci_workflow_path.name} "
        "on both dimensions."
    )
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Enforce actual == --min-collected floor at HEAD for Python and "
            "Extension test suites, and inter-file parity between "
            "run_pr_preflight.py and ci.yml. See issue #280."
        )
    )
    parser.add_argument(
        "--base-ref",
        default="origin/main",
        help=(
            "Base git ref for marker scan and shallow-clone guard "
            "(default: origin/main)."
        ),
    )
    parser.add_argument(
        "--preflight-script",
        type=Path,
        default=DEFAULT_PREFLIGHT_SCRIPT,
        help=f"Path to run_pr_preflight.py (default: {DEFAULT_PREFLIGHT_SCRIPT}).",
    )
    parser.add_argument(
        "--ci-workflow",
        type=Path,
        default=DEFAULT_CI_WORKFLOW,
        help=f"Path to ci.yml (default: {DEFAULT_CI_WORKFLOW}).",
    )
    parser.add_argument(
        "--junit-extension",
        type=Path,
        default=DEFAULT_EXTENSION_JUNIT,
        help=(f"Path to extension JUnit XML (default: {DEFAULT_EXTENSION_JUNIT})."),
    )
    args = parser.parse_args(argv)

    return run_gate(
        preflight_path=args.preflight_script,
        ci_workflow_path=args.ci_workflow,
        junit_extension_path=args.junit_extension,
        base_ref=args.base_ref,
    )


if __name__ == "__main__":
    raise SystemExit(main())
