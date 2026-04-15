#!/usr/bin/env python3
"""Enforce per-commit ``--min-collected`` ratchet-bump discipline (issue #280).

Strict-equality gate. At HEAD, the actual collected test count for both
the Python and Extension suites MUST equal the declared ``--min-collected``
floor, AND the two authoritative sites — ``scripts/run_pr_preflight.py``
and ``.github/workflows/ci.yml`` — MUST agree with each other. Any drift
in either dimension fails the gate.

Bypass markers (must appear in a commit SUBJECT line in the range
``{base-ref}..HEAD``; scanned via ``git log --oneline``, so markers
placed in commit bodies do NOT take effect):
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
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from defusedxml.ElementTree import ParseError as XMLParseError
from defusedxml.ElementTree import parse as parse_xml

if TYPE_CHECKING:
    # Static import for mypy. `mypy_path = ["scripts"]` in pyproject.toml
    # makes `_ci_yaml_parser` resolve as a top-level module here; the
    # runtime else-branch below is invocation-mode-aware loading that
    # mypy never executes, so the call sites stay precisely typed.
    import _ci_yaml_parser as _ci_parser
else:
    # Runtime: prefer a relative import. Under
    # `python -m scripts.check_ratchet_bump`, Python resolves `scripts`
    # as a PEP 420 namespace package (no `scripts/__init__.py` — its
    # absence is enforced by tests/unit/test_mypy_crossfile_enforcement.py
    # ::test_scripts_init_py_does_not_exist) and sets
    # `__package__ = "scripts"`, so `from . import _ci_yaml_parser`
    # resolves cleanly. The same path works when a test loads the gate
    # via `from scripts import check_ratchet_bump` /
    # `importlib.import_module("scripts.check_ratchet_bump")`.
    #
    # Fall back to a plain top-level import when the gate is invoked
    # as a script path (`python scripts/check_ratchet_bump.py`) — runpy
    # puts the script's directory at `sys.path[0]`, so the sibling
    # helper resolves as a top-level module without any package
    # context. No `sys.path` mutation (forbidden by the
    # `--check-syspath` compensating guardrail in
    # check_rule_disable_invariants.py) and no
    # `importlib.util.spec_from_file_location` — both branches honor
    # package semantics.
    try:
        from . import _ci_yaml_parser as _ci_parser
    except ImportError:
        import _ci_yaml_parser as _ci_parser

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

# Cleanup retry policy for the collector tempfile. Windows antivirus /
# deferred-close handles can briefly fail an unlink just after the child
# process writes the file; a small bounded retry absorbs the transient
# lock without masking real filesystem bugs. Module-level so tests can
# monkeypatch the sleep to 0 for speed without patching the loop body.
_CLEANUP_RETRY_ATTEMPTS = 3
_CLEANUP_RETRY_SLEEP_SECONDS = 0.05


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


@dataclass(frozen=True)
class DriftReport:
    """Structured drift analysis split into two independent buckets.

    ``parity`` — inter-file drift between the two authoritative sites
    (run_pr_preflight.py vs ci.yml). This bucket is **never** waived
    by a bypass marker: a realignment or test-removal commit that
    updates only one site is exactly the regression issue #280 exists
    to catch, and silently accepting it would reopen that hole.

    ``equality`` — ``actual != floor`` drift on either language. This
    bucket **is** waived by ``[ratchet-realignment]`` or
    ``[ratchet-test-removal]`` markers in a commit SUBJECT line in
    ``base..HEAD``. A realignment legitimately moves the floor past
    current actual; a test-removal legitimately drops it below.

    Each bucket is a tuple of human-readable messages; empty tuple
    means "clean on this dimension". The split is load-bearing — see
    ``run_gate`` for how the two buckets drive exit code selection.
    """

    parity: tuple[str, ...]
    equality: tuple[str, ...]


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

    Navigates the YAML defensively via
    :func:`_ci_parser.load_ci_run_block` — every missing key / wrong
    type raises :class:`_ci_parser.CiYamlParseError` with context
    rather than AttributeError. The shell ``run`` block is then
    folded via :func:`_ci_parser.extract_shell_commands` so
    backslash-continuation flags are not silently lost before the
    regex search.
    """
    try:
        py_run = _ci_parser.load_ci_run_block(ci_yaml_path, _CI_PY_JOB, _CI_PY_STEP)
        ext_run = _ci_parser.load_ci_run_block(ci_yaml_path, _CI_EXT_JOB, _CI_EXT_STEP)
    except _ci_parser.CiYamlParseError as exc:
        raise RatchetSetupError(str(exc)) from exc

    try:
        py_floor = _extract_ci_flag(py_run, ci_yaml_path, _CI_PY_JOB, _CI_PY_STEP)
        ext_floor = _extract_ci_flag(ext_run, ci_yaml_path, _CI_EXT_JOB, _CI_EXT_STEP)
    except _ci_parser.CiYamlParseError as exc:
        raise RatchetSetupError(str(exc)) from exc

    return FloorReadings(python=py_floor, extension=ext_floor)


def _extract_ci_flag(
    run_block: str, ci_yaml_path: Path, job_name: str, step_name: str
) -> int:
    commands = _ci_parser.extract_shell_commands(run_block)
    if not commands:
        raise _ci_parser.CiYamlParseError(
            f"{ci_yaml_path}: job {job_name!r} step {step_name!r} has no "
            f"python/pnpm/mypy command after folding"
        )
    folded = " ".join(commands)
    return _ci_parser.extract_flag_value(folded, _MIN_COLLECTED_FLAG)


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

    The collector IPC file is created via :func:`tempfile.mkstemp` with
    a PID-scoped prefix (not :class:`tempfile.TemporaryDirectory`): the
    #280 post-merge review established that ``TemporaryDirectory``
    cleanup is fragile on Windows when antivirus or deferred-close
    handles still hold the just-written file at ``__exit__`` time —
    empty ``ratchet-collect-*`` directories were observed leaking in
    ``/tmp`` and, on stricter Windows environments, the same failure
    escalates into a ``PermissionError`` traceback that escapes the
    preflight wrapper. Using a single-file mkstemp + explicit
    ``try/finally`` lets cleanup happen outside any context manager so
    it cannot mask the measurement verdict.
    """
    fd, count_path_str = tempfile.mkstemp(
        prefix=f"ratchet-count-{os.getpid()}-", suffix=".txt"
    )
    os.close(fd)
    count_file = Path(count_path_str)

    def _best_effort_unlink(path: Path) -> None:
        """Unlink ``path`` with bounded retries for transient Windows locks.

        Nested inside :func:`measure_python_count` so it cannot be
        imported or reused elsewhere — the retry policy and the narrow
        :class:`PermissionError`-only catch are tuned specifically for
        the short-lived collector tempfile IPC, not a general
        file-cleanup helper. Only :class:`PermissionError` is
        swallowed; other :class:`OSError` subclasses (``ENOSPC``,
        missing parent-dir permissions, I/O errors, etc.) propagate
        because they indicate real filesystem bugs that must not be
        hidden.
        """
        for attempt in range(_CLEANUP_RETRY_ATTEMPTS):
            try:
                path.unlink(missing_ok=True)
                # SUCCESS — break immediately. The loop must not run
                # the next iteration; counting "attempts" depends on
                # this early exit to stay accurate.
                break
            except PermissionError:
                if attempt + 1 < _CLEANUP_RETRY_ATTEMPTS:
                    time.sleep(_CLEANUP_RETRY_SLEEP_SECONDS)
        # Falls through on success (via break) or on retries exhausted
        # (loop ends naturally after the final failed attempt without
        # sleeping). Never raises: the OS reclaims %TEMP% on its own
        # schedule; cleanup failure must not mask the measurement
        # verdict or propagate into the preflight wrapper.

    try:
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
        if not raw:
            raise RatchetSetupError(
                f"Ratchet count output is empty at {count_file}. This "
                "indicates either a partial write from the collector "
                "plugin, a permission issue on the parent temp "
                "directory, or a plugin-load failure that pytest did "
                "not surface via its exit code."
            )
        try:
            return int(raw)
        except ValueError as exc:
            raise RatchetSetupError(
                f"Ratchet count output is not an integer: {raw!r}"
            ) from exc
    finally:
        _best_effort_unlink(count_file)


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
# Base-ref normalization (CLI hygiene — enforce origin/<name> form)
# ---------------------------------------------------------------------------


# A git short or full SHA is 7-40 hex characters. Branch names that happen
# to be entirely hex are rare and ambiguous; the normalizer rejects them
# at the CLI boundary so a user who meant a SHA gets a clearer error than
# "remote ref not found" (which is what the fetch step would otherwise
# report several layers deeper). A developer with a legitimately hex-named
# branch can still pass it via the explicit ``origin/<name>`` form, which
# bypasses the bare-name SHA check.
_SHA_RE = re.compile(r"^[0-9a-fA-F]{7,40}$")


def _normalize_base_ref(raw: str) -> str:
    """Normalize ``--base-ref`` input to an ``origin/<branch>`` remote ref.

    Accepts:
        * ``origin/<name>`` — passes through unchanged. Nested names
          like ``origin/release/v1.7`` are allowed because git
          supports slashes in branch names and release-branch
          layouts that use them are a legitimate pattern.
        * ``<name>`` (bare branch) — normalized to ``origin/<name>``.
          The bare form accepts **any** name that is not already
          ``origin/``-prefixed, including names containing slashes
          (``release/v1.7``) and names that happen to look like other
          remotes (``upstream/main``). The rule is simple: the
          ``origin/`` prefix is the *only* remote-qualifier the gate
          recognizes; everything else is a bare branch name, slashes
          and all. If the resulting ``origin/<name>`` does not exist
          on origin, the fetch step will surface that as a distinct
          SETUP error with actionable remediation.

    Rejects via :class:`RatchetSetupError` (exit 2):
        * Empty or whitespace-only input.
        * ``HEAD`` or ``@`` — not branch refs.
        * Full ref paths like ``refs/heads/main`` or
          ``refs/remotes/origin/main``.
        * ``origin/`` with no branch name after the slash.
        * Bare git SHAs (7-40 hex chars). See :data:`_SHA_RE`. A
          developer with a legitimately hex-named branch can still
          pass it via the explicit ``origin/<name>`` form, which
          skips the SHA check entirely.

    Rationale: :func:`ensure_base_ref_reachable` always fetches into
    ``refs/remotes/origin/<name>``, but without up-front normalization
    the subsequent ``git rev-parse --verify <raw>`` and
    ``git log <raw>..HEAD`` calls run against whatever string the
    caller passed. A caller that passes ``--base-ref main`` would
    fetch ``origin/main`` and then scan the **local** ``main``
    branch, which on a typical worktree that tracks a feature branch
    is either stale (behind remote) or nonexistent (never checked
    out locally). Normalizing up front pins every downstream call
    to the remote-tracking ref and closes that hole.

    Pure + deterministic: no subprocess, no filesystem, no network,
    no argparse coupling. Unit-testable in isolation (T39-T48).
    """
    text = raw.strip()
    if not text:
        raise RatchetSetupError(
            "--base-ref cannot be empty or whitespace-only; expected "
            "'origin/<branch>' or a bare '<branch>' name."
        )
    if text in ("HEAD", "@"):
        raise RatchetSetupError(
            f"--base-ref={raw!r} is not a branch ref. The ratchet-bump "
            "guard scans `base..HEAD` for bypass markers and compares "
            "actual vs floor; that only makes sense against a branch, "
            "not HEAD itself. Pass 'origin/<branch>' or a bare "
            "'<branch>' name (e.g., 'main' or 'release-101.7')."
        )
    if text.startswith("refs/"):
        raise RatchetSetupError(
            f"--base-ref={raw!r} must not be a full ref path. Pass the "
            "short form 'origin/<branch>' or a bare '<branch>' name; "
            "the gate expands it to 'refs/remotes/origin/<branch>' "
            "internally for the refspec fetch."
        )
    # The ``origin/`` prefix is the only remote-qualifier we recognize.
    # Anything else — including names that happen to contain slashes
    # like ``release/v1.7`` or that look like another remote's form
    # like ``upstream/main`` — is treated as a bare branch name. Git
    # allows slashes in branch names, so a "has a slash therefore it
    # must be remote-qualified" rule would incorrectly reject legitimate
    # release-branch names. If a caller passes ``upstream/main`` they
    # get ``origin/upstream/main``, which the fetch step will cleanly
    # fail with "remote ref not found" — a distinct, actionable setup
    # error rather than a normalization surprise.
    if text.startswith("origin/"):
        name = text[len("origin/") :]
        if not name:
            raise RatchetSetupError(
                f"--base-ref={raw!r} is missing a branch name after "
                "'origin/'. Expected something like 'origin/main' or "
                "'origin/release-101.7'."
            )
        return text

    # Bare branch name. SHA rejection runs only on bare inputs, and
    # only on purely-hex strings of 7-40 characters — the regex is
    # anchored on both ends so ``feat-abc123`` and ``abcdef`` (below
    # the SHA minimum) and ``release/v1.7`` (contains a slash) all
    # pass through cleanly. A legitimately hex-named branch can
    # still be passed explicitly via ``origin/<name>``, which skips
    # this check because it takes the ``startswith("origin/")``
    # branch above.
    if _SHA_RE.match(text):
        raise RatchetSetupError(
            f"--base-ref={raw!r} looks like a git SHA, not a branch "
            "name. The ratchet-bump guard only scans branch-relative "
            "ranges. If you meant a branch that happens to be named "
            "entirely in hex, pass it in the explicit form "
            f"'origin/{text}' to bypass this check."
        )
    return f"origin/{text}"


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
    """Refresh ``base_ref`` from origin and guarantee it is fully reachable.

    Always fetches. There is no short-circuit path that trusts an
    existing local ``origin/<name>`` ref, because a stale local ref is
    indistinguishable from a fresh one by existence or range
    consistency alone: both may be internally valid while the remote
    has moved on. That discrepancy is not theoretical — a
    ``[ratchet-realignment]`` or ``[ratchet-test-removal]`` commit that
    has already merged upstream will still live inside the local
    ``origin/main..HEAD`` range until the next fetch, and
    ``scan_bypass_marker`` would silently exempt an unrelated PR on
    that basis. Determinism beats the few hundred milliseconds of
    network latency an incremental fetch costs.

    Fetch discipline:

    * Exactly one fetch attempt per call. ``--unshallow`` is used iff
      ``.git/shallow`` exists, plain refspec fetch otherwise.
    * ``--no-tags`` so the refresh does not drag in release-tag refs
      the gate does not need.
    * Never ``--depth=N``. Determinism means either full history or
      a loud SETUP error; there is no silent fallback.

    After the fetch, both ``rev-parse --verify`` and the log/rev-list
    consistency check must still pass. A fetch that succeeds but leaves
    the ref unreachable (e.g., wrong remote name, ref deleted upstream)
    surfaces as a second SETUP error with a distinct remediation
    message so the user can tell the two failure modes apart.
    """
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
            f"Failed to refresh base ref {base_ref}.\n"
            f"  command: {fetch_cmd_display}\n"
            f"  stderr: {fetch_result.stderr.strip()}\n"
            f"  Local fix: run `git fetch origin {ref_name}` manually "
            "and retry (network outage or wrong remote name).\n"
            f"  CI fix: actions/checkout@v4 with fetch-depth: 0 "
            "(already set on main CI jobs).\n"
            "  The gate refuses to scan bypass markers on a stale "
            f"local {base_ref} because a {REALIGNMENT_MARKER} or "
            f"{TEST_REMOVAL_MARKER} subject from an already-merged "
            "commit could otherwise exempt an unrelated PR on a "
            "different branch."
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


def scan_bypass_marker(base_ref: str, *, marker_range: str | None = None) -> str | None:
    """Return the first bypass marker found in the configured commit range.

    Scans commit SUBJECT lines only via ``git log --oneline``, matching
    the established convention used by
    :file:`scripts/check_threshold_changes.py` (``[threshold-update]``)
    and :file:`scripts/check-version-unchanged.py`
    (``[version-override-acknowledged]``). Body paragraphs are
    deliberately NOT scanned: feature-documentation text that cites
    the marker string in prose — including this gate's own commit
    message explaining what the markers are — must never accidentally
    disarm the gate. Markers are only effective when placed in the
    commit subject line, which is an intentional, deliberate act.
    ``marker_range`` defaults to ``base_ref..HEAD``. CI push jobs on
    ``main`` can override it with the actual pushed range
    (for example ``<before>..<after>``) because after a merge
    ``origin/main..HEAD`` is empty and would miss a marker placed on
    the newly merged commit itself.
    """
    commit_range = marker_range or f"{base_ref}..HEAD"
    result = _run_git("log", "--oneline", commit_range)
    if result.returncode != 0:
        raise RatchetSetupError(
            f"Could not read git log for {commit_range}: {result.stderr.strip()}"
        )
    log_text = result.stdout
    for marker in _BYPASS_MARKERS:
        if marker in log_text:
            return marker
    return None


# ---------------------------------------------------------------------------
# Drift comparison
# ---------------------------------------------------------------------------


def compute_drift_report(
    *,
    preflight: FloorReadings,
    ci: FloorReadings,
    actual: ActualCounts,
    preflight_path: Path,
    ci_path: Path,
) -> DriftReport:
    """Categorize drift into the parity bucket and the equality bucket.

    Two drift categories are checked and returned as separate tuples so
    ``run_gate`` can apply the marker exemption selectively:

    1. **Parity** — inter-file drift between the two authoritative
       sites. Every marker-bearing PR must still keep
       ``run_pr_preflight.py`` and ``.github/workflows/ci.yml`` in
       lockstep, because a realignment commit that edits only one site
       is the exact regression this gate exists to catch.
    2. **Equality** — ``actual != floor`` drift on either language. A
       positive delta means tests were added without a floor bump; a
       negative delta means tests were removed without a floor
       decrease. Marker-bearing PRs are allowed to produce this kind
       of drift in a controlled way — see ``run_gate`` for the
       exemption logic.

    The caller is responsible for printing messages and selecting an
    exit code. This function is pure: same inputs, same
    :class:`DriftReport`, no I/O.
    """
    parity: list[str] = []
    equality: list[str] = []

    if preflight.python != ci.python:
        parity.append(
            "Inter-file parity violation — Python floor mismatch:\n"
            f"  {preflight_path}: {_MIN_COLLECTED_FLAG}={preflight.python}\n"
            f"  {ci_path}: {_MIN_COLLECTED_FLAG}={ci.python}\n"
            "Both sites MUST match exactly; update them together in the "
            "same commit."
        )
    if preflight.extension != ci.extension:
        parity.append(
            "Inter-file parity violation — Extension floor mismatch:\n"
            f"  {preflight_path}: {_MIN_COLLECTED_FLAG}={preflight.extension}\n"
            f"  {ci_path}: {_MIN_COLLECTED_FLAG}={ci.extension}\n"
            "Both sites MUST match exactly; update them together in the "
            "same commit."
        )

    if actual.python != preflight.python:
        equality.append(
            f"Python ratchet drift: actual={actual.python}, "
            f"floor={preflight.python}.\n"
            f"  Delta: {actual.python - preflight.python:+d}\n"
            f"  Fix: update {_MIN_COLLECTED_FLAG}={actual.python} in BOTH:\n"
            f"    {preflight_path}\n"
            f"    {ci_path}"
        )
    if actual.extension != preflight.extension:
        equality.append(
            f"Extension ratchet drift: actual={actual.extension}, "
            f"floor={preflight.extension}.\n"
            f"  Delta: {actual.extension - preflight.extension:+d}\n"
            f"  Fix: update {_MIN_COLLECTED_FLAG}={actual.extension} in BOTH:\n"
            f"    {preflight_path}\n"
            f"    {ci_path}"
        )
    return DriftReport(parity=tuple(parity), equality=tuple(equality))


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def run_gate(
    *,
    preflight_path: Path,
    ci_workflow_path: Path,
    junit_extension_path: Path,
    base_ref: str,
    marker_range: str | None = None,
) -> int:
    """Orchestrate the gate with marker-aware exemption discipline.

    Control-flow invariants enforced by this function:

    * Shallow-clone / base-ref reachability is validated first. Failure
      is a SETUP error regardless of any marker.
    * The bypass marker is scanned and captured, but **not** acted on
      immediately. The gate never short-circuits on marker alone: both
      ``run_pr_preflight.py`` and ``.github/workflows/ci.yml`` must
      still be parseable, and their floors must still agree with each
      other. A realignment PR that breaks the parser input or updates
      only one authoritative site is exactly the regression #280 exists
      to catch, and the original v1 control flow silently accepted
      both of those failure modes when any marker was present.
    * Parse / measurement failures exit SETUP regardless of marker.
    * Inter-file parity (``preflight vs ci``) failures exit DRIFT
      regardless of marker. A note is printed when a marker was present
      so users do not think the marker was silently lost.
    * Actual-vs-floor equality failures exit DRIFT **unless** a marker
      is present — that is the only dimension the marker waives.
    """
    try:
        ensure_base_ref_reachable(base_ref)
    except RatchetSetupError as exc:
        print(f"[SETUP] {exc}", file=sys.stderr)
        return EXIT_SETUP

    # Capture the marker now; actioning it happens only on the
    # equality-drift branch below. Do NOT return early on marker
    # presence — parse validation and inter-file parity must still run.
    try:
        marker = scan_bypass_marker(base_ref, marker_range=marker_range)
    except RatchetSetupError as exc:
        print(f"[SETUP] {exc}", file=sys.stderr)
        return EXIT_SETUP

    try:
        preflight_floors = read_preflight_floors(preflight_path)
        ci_floors = read_ci_floors(ci_workflow_path)
        python_actual = measure_python_count()
        extension_actual = measure_extension_count(junit_extension_path)
    except RatchetSetupError as exc:
        print(f"[SETUP] {exc}", file=sys.stderr)
        return EXIT_SETUP

    actual = ActualCounts(python=python_actual, extension=extension_actual)

    report = compute_drift_report(
        preflight=preflight_floors,
        ci=ci_floors,
        actual=actual,
        preflight_path=preflight_path,
        ci_path=ci_workflow_path,
    )

    display_range = marker_range or f"{base_ref}..HEAD"

    # Parity is unconditional. Bypass markers have no authority to
    # waive inter-file agreement — a realignment that only touches one
    # site is exactly the hole this gate is meant to close.
    if report.parity:
        for msg in report.parity:
            print(f"[DRIFT] {msg}", file=sys.stderr)
        if marker is not None:
            print(
                f"[DRIFT] {marker} is present in {display_range} but "
                "is ignored for inter-file parity checks — bypass "
                f"markers ({REALIGNMENT_MARKER} / "
                f"{TEST_REMOVAL_MARKER}) waive actual-vs-floor "
                "equality only. Update both authoritative sites to "
                "the same value in the same commit.",
                file=sys.stderr,
            )
        return EXIT_DRIFT

    # Equality drift is exempted when a marker is present. The
    # exemption runs only after parity has been verified clean above,
    # so the success path can positively report that parity was
    # evaluated — "parity checked, equality exempted" is the contract.
    if report.equality:
        if marker is not None:
            print(
                "[OK] Ratchet bump guard: parity checked, equality "
                f"exempted via {marker} in commit log range "
                f"{display_range}.\n"
                f"  Parity:    {preflight_path.name} == "
                f"{ci_workflow_path.name} on both dimensions."
            )
            return EXIT_OK
        for msg in report.equality:
            print(f"[DRIFT] {msg}", file=sys.stderr)
        print(
            f"[DRIFT] Bypass with {REALIGNMENT_MARKER} or "
            f"{TEST_REMOVAL_MARKER} in a commit SUBJECT line in "
            f"{display_range} (scanned via `git log --oneline`; "
            "markers in commit bodies are NOT honored). The marker "
            "waives actual-vs-floor equality only; inter-file parity "
            "and parse validation continue to run unconditionally.",
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
            "Base git ref for marker scan and shallow-clone guard. "
            "Accepts 'origin/<branch>' (pass-through) or a bare "
            "'<branch>' name; bare names are normalized to "
            "'origin/<branch>' up front, and names containing "
            "slashes (e.g. 'release/v1.7') are treated as single "
            "bare branch names rather than remote-qualified refs. "
            "Only the literal 'origin/' prefix is recognized as a "
            "remote qualifier. HEAD, '@', full ref paths "
            "('refs/heads/main'), bare SHAs, and empty values are "
            "rejected with an explicit setup error. Default: "
            "origin/main."
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
    parser.add_argument(
        "--marker-range",
        help=(
            "Optional git commit range to scan for bypass markers. "
            "Defaults to '<base-ref>..HEAD'. Use this on push workflows "
            "that need to scan the pushed commits directly (for example "
            "'<before>..<after>' on main) instead of the branch-relative "
            "default range."
        ),
    )
    args = parser.parse_args(argv)

    # Normalize --base-ref up front so every downstream consumer
    # (ensure_base_ref_reachable, scan_bypass_marker, the marker-range
    # log/rev-list calls) operates on the canonical remote-tracking
    # ref. Without this step, a caller passing ``--base-ref main``
    # would fetch ``origin/main`` but scan the (possibly stale or
    # nonexistent) local ``main`` branch.
    try:
        normalized_base_ref = _normalize_base_ref(args.base_ref)
    except RatchetSetupError as exc:
        print(f"[SETUP] {exc}", file=sys.stderr)
        return EXIT_SETUP

    return run_gate(
        preflight_path=args.preflight_script,
        ci_workflow_path=args.ci_workflow,
        junit_extension_path=args.junit_extension,
        base_ref=normalized_base_ref,
        marker_range=args.marker_range,
    )


if __name__ == "__main__":
    raise SystemExit(main())
