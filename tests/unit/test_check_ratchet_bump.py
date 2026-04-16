"""Unit tests for scripts/check_ratchet_bump.py (issue #280).

These tests lock the behavior of every branch the plan v4 calls out:
core drift/parity/marker paths (T1-T10), the v3 hardenings (T11-T13),
and the v4 hardenings that turned v3 gaps into explicit asserts
(T14-T18). All pytest/jest invocations are mocked via ``monkeypatch``
so the gate's logic is verified without running real collection.
"""

from __future__ import annotations

import importlib
import json
import subprocess
import sys
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import pytest

# Load the gate under its dotted package name so Python sets
# ``__package__ = "scripts"`` on the module. That context is what lets the
# gate's runtime ``from . import _ci_yaml_parser`` branch resolve cleanly
# here without any ``sys.path`` or ``sys.modules`` manipulation. ``scripts``
# is a PEP 420 namespace package (no ``scripts/__init__.py``), so the
# dotted name works without a package marker on disk — the absence of the
# marker is enforced by test_mypy_crossfile_enforcement.py
# ::test_scripts_init_py_does_not_exist.
#
# The runtime ``importlib.import_module`` form is used in place of a
# static ``from scripts import check_ratchet_bump`` because the latter
# makes mypy resolve ``check_ratchet_bump`` under *two* names at once
# (both ``check_ratchet_bump`` via ``mypy_path = ["scripts"]`` AND
# ``scripts.check_ratchet_bump`` via the dotted import), which mypy
# rejects with a "source file found twice" error. The string argument
# to ``import_module`` is opaque to mypy, so the dual-name conflict
# never arises at type-check time while the runtime package context is
# still established for the relative import in the gate.
gate = importlib.import_module("scripts.check_ratchet_bump")

_UNSET = object()


@dataclass
class _FakeCompleted:
    """Stand-in for subprocess.CompletedProcess for monkeypatched runs."""

    returncode: int = 0
    stdout: str = ""
    stderr: str = ""


@dataclass
class _FakeRunCall:
    args: list[str]
    env: dict[str, str] | None
    cwd: Path | None


class _GitFakeRecorder:
    """Replaces subprocess.run with a scripted responder for git and pytest."""

    def __init__(
        self,
        *,
        git_responses: dict[tuple[str, ...], _FakeCompleted] | None = None,
        pytest_collected: int | None = None,
        pytest_rc: int = 0,
        pytest_stderr: str = "",
        pytest_empty_output: bool = False,
    ) -> None:
        self.git_responses: dict[tuple[str, ...], _FakeCompleted] = git_responses or {}
        self.pytest_collected = pytest_collected
        self.pytest_rc = pytest_rc
        self.pytest_stderr = pytest_stderr
        self.pytest_empty_output = pytest_empty_output
        self.calls: list[_FakeRunCall] = []

    def __call__(
        self,
        args: list[str] | tuple[str, ...],
        **kwargs: object,
    ) -> _FakeCompleted:
        normalized = list(args)
        env_obj = kwargs.get("env")
        env_dict: dict[str, str] | None = None
        if isinstance(env_obj, dict):
            env_dict = {str(k): str(v) for k, v in env_obj.items()}
        cwd_obj = kwargs.get("cwd")
        cwd_path: Path | None = None
        if isinstance(cwd_obj, (str, Path)):
            cwd_path = Path(cwd_obj)
        self.calls.append(_FakeRunCall(args=normalized, env=env_dict, cwd=cwd_path))

        if normalized and normalized[0] == "git":
            key = tuple(normalized[1:])
            if key in self.git_responses:
                return self.git_responses[key]
            # Default git response: success with empty output. Individual
            # tests override explicit cases via git_responses.
            return _FakeCompleted(returncode=0, stdout="", stderr="")

        if _is_pytest_collect(normalized):
            if self.pytest_rc != 0:
                return _FakeCompleted(
                    returncode=self.pytest_rc,
                    stdout="",
                    stderr=self.pytest_stderr,
                )
            # Simulate the collector plugin writing the count file.
            output_path = None
            node_ids_output = None
            if env_dict is not None:
                output_path = env_dict.get("RATCHET_COUNT_OUTPUT")
                node_ids_output = env_dict.get("RATCHET_NODEIDS_OUTPUT")
            if output_path is not None:
                if self.pytest_empty_output:
                    # Simulate a partial write / plugin-load failure:
                    # the file exists but is empty. Exercises T23.
                    Path(output_path).write_text("", encoding="utf-8")
                elif self.pytest_collected is not None:
                    Path(output_path).write_text(
                        f"{self.pytest_collected}\n", encoding="utf-8"
                    )
            if node_ids_output is not None and self.pytest_collected is not None:
                node_ids = [
                    f"tests/test_stub.py::test_case_{index}"
                    for index in range(self.pytest_collected)
                ]
                Path(node_ids_output).write_text(json.dumps(node_ids), encoding="utf-8")
            return _FakeCompleted(returncode=0, stdout="", stderr="")

        raise AssertionError(f"Unexpected subprocess invocation: {normalized!r}")


def _is_pytest_collect(args: list[str]) -> bool:
    return (
        len(args) >= 3
        and args[0] == sys.executable
        and args[1] == "-m"
        and args[2] == "pytest"
    )


def _install_recorder(
    monkeypatch: pytest.MonkeyPatch, recorder: _GitFakeRecorder
) -> _GitFakeRecorder:
    monkeypatch.setattr(gate.subprocess, "run", recorder)
    monkeypatch.setattr(subprocess, "run", recorder)
    return recorder


def _write_preflight(tmp_path: Path, python_floor: int, ext_floor: int) -> Path:
    content = f'''"""Stub preflight for ratchet-bump gate tests."""
from dataclasses import dataclass


@dataclass(frozen=True)
class CommandSpec:
    name: str
    command: tuple[str, ...]


SPECS = (
    CommandSpec(
        "Python test count validation",
        (
            "python",
            ".github/scripts/validate-test-results.py",
            "test-results.xml",
            "--min-collected={python_floor}",
            "--max-skips=0",
        ),
    ),
    CommandSpec(
        "Extension test count validation",
        (
            "python",
            ".github/scripts/validate-test-results.py",
            "extension/test-results.xml",
            "--min-collected={ext_floor}",
            "--max-skips=0",
        ),
    ),
)
'''
    path = tmp_path / "run_pr_preflight.py"
    path.write_text(content, encoding="utf-8")
    return path


def _write_ci_yaml(tmp_path: Path, python_floor: int, ext_floor: int) -> Path:
    content = f"""name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Validate Test Results (Python)
        run: |
          python .github/scripts/validate-test-results.py \\
            test-results.xml \\
            --min-collected={python_floor} \\
            --max-skips=0
  extension-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Validate Test Results (Extension)
        run: |
          python .github/scripts/validate-test-results.py \\
            extension/test-results.xml \\
            --min-collected={ext_floor} \\
            --max-skips=0
"""
    path = tmp_path / "ci.yml"
    path.write_text(content, encoding="utf-8")
    return path


def _write_extension_junit(tmp_path: Path, count: int) -> Path:
    path = tmp_path / "extension-test-results.xml"
    path.write_text(
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<testsuites name="jest" tests="{count}" failures="0" errors="0">\n'
        f'  <testsuite name="foo" tests="{count}" failures="0" errors="0"/>\n'
        f"</testsuites>\n",
        encoding="utf-8",
    )
    return path


def _write_floor_contract(tmp_path: Path, python_floor: int, ext_floor: int) -> Path:
    path = tmp_path / ".test-floor-contract.json"
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "python": {
                    "min_collected": python_floor,
                    "authority": "pytest collector",
                },
                "extension": {
                    "min_collected": ext_floor,
                    "authority": "extension junit",
                },
            }
        ),
        encoding="utf-8",
    )
    return path


def _default_git_responses() -> dict[tuple[str, ...], _FakeCompleted]:
    """Return git responses that make ensure_base_ref_reachable pass.

    Marker scanning uses ``git log --oneline`` (subject-only) — same
    key as the range-consistency check — so a single response covers
    both call sites. Subject-only scanning is the project convention
    (cf. check_threshold_changes.py / check-version-unchanged.py) and
    prevents feature-documentation text in commit bodies from
    disarming the gate.
    """
    return {
        ("rev-parse", "--verify", "origin/main^{commit}"): _FakeCompleted(
            returncode=0, stdout="deadbeef\n"
        ),
        ("log", "--oneline", "origin/main..HEAD"): _FakeCompleted(
            returncode=0, stdout="abc1234 feat: stub\n"
        ),
        ("rev-list", "--count", "origin/main..HEAD"): _FakeCompleted(
            returncode=0, stdout="1\n"
        ),
    }


def _run_gate(
    tmp_path: Path,
    *,
    python_floor: int,
    ext_floor: int,
    python_actual: int,
    ext_actual: int,
    ci_python_floor: int | None = None,
    ci_ext_floor: int | None = None,
    marker_range: str | None = None,
    git_responses: dict[tuple[str, ...], _FakeCompleted] | None = None,
    pytest_rc: int = 0,
    pytest_stderr: str = "",
    pytest_empty_output: bool = False,
    python_commit_accounting: object = _UNSET,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[int, _GitFakeRecorder]:
    """Spin up all fixtures and run the gate; return (exit_code, recorder)."""
    preflight = _write_preflight(tmp_path, python_floor, ext_floor)
    ci = _write_ci_yaml(
        tmp_path,
        ci_python_floor if ci_python_floor is not None else python_floor,
        ci_ext_floor if ci_ext_floor is not None else ext_floor,
    )
    junit = _write_extension_junit(tmp_path, ext_actual)

    responses = _default_git_responses()
    if git_responses:
        responses.update(git_responses)

    recorder = _GitFakeRecorder(
        git_responses=responses,
        pytest_collected=python_actual,
        pytest_rc=pytest_rc,
        pytest_stderr=pytest_stderr,
        pytest_empty_output=pytest_empty_output,
    )
    _install_recorder(monkeypatch, recorder)
    if python_commit_accounting is not _UNSET:
        monkeypatch.setattr(
            gate,
            "evaluate_python_commit_accounting",
            lambda base_ref, *, marker_range=None: python_commit_accounting,
        )

    exit_code = gate.run_gate(
        preflight_path=preflight,
        ci_workflow_path=ci,
        junit_extension_path=junit,
        base_ref="origin/main",
        marker_range=marker_range,
    )
    return exit_code, recorder


# ---------------------------------------------------------------------------
# T1 — aligned on every dimension → exit 0
# ---------------------------------------------------------------------------


def test_t1_aligned_state_passes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=100,
        ext_actual=200,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_OK
    captured = capsys.readouterr()
    assert "aligned" in captured.out
    assert "Python:    floor=100, actual=100" in captured.out
    assert "Extension: floor=200, actual=200" in captured.out


# ---------------------------------------------------------------------------
# T2 — Python actual > floor, no marker → exit 1
# ---------------------------------------------------------------------------


def test_t2_python_drift_up_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=104,
        ext_actual=200,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_DRIFT
    stderr = capsys.readouterr().err
    assert "Python ratchet drift" in stderr
    assert "actual=104" in stderr
    assert "floor=100" in stderr
    assert "Delta: +4" in stderr


# ---------------------------------------------------------------------------
# T3 — Extension actual > floor, no marker → exit 1
# ---------------------------------------------------------------------------


def test_t3_extension_drift_up_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=100,
        ext_actual=203,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_DRIFT
    stderr = capsys.readouterr().err
    assert "Extension ratchet drift" in stderr
    assert "actual=203" in stderr
    assert "Delta: +3" in stderr


# ---------------------------------------------------------------------------
# T4 — actual < floor (test removal without floor decrease) → exit 1
# ---------------------------------------------------------------------------


def test_t4_actual_below_floor_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=99,
        ext_actual=200,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_DRIFT
    stderr = capsys.readouterr().err
    assert "Python ratchet drift" in stderr
    assert "Delta: -1" in stderr


# ---------------------------------------------------------------------------
# T5 — [ratchet-realignment] marker in commit log → exit 0
# ---------------------------------------------------------------------------


def test_t5_realignment_marker_exempts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    responses: dict[tuple[str, ...], _FakeCompleted] = {
        ("log", "--oneline", "origin/main..HEAD"): _FakeCompleted(
            returncode=0,
            stdout="abc1234 chore: [ratchet-realignment] catch up on drift\n",
        ),
        ("rev-list", "--count", "origin/main..HEAD"): _FakeCompleted(
            returncode=0, stdout="1\n"
        ),
    }
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=150,  # Huge drift that would normally fail
        ext_actual=200,
        git_responses=responses,
        python_commit_accounting=None,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_OK
    out = capsys.readouterr().out
    assert "[ratchet-realignment]" in out
    # The success message must positively prove that parity was
    # evaluated before the equality exemption fired. "parity checked,
    # equality exempted" is the exact contract that closes the
    # short-circuit hole — a bare "exempted" keyword used to match
    # even when run_gate short-circuited before parsing the sources
    # at all. Keep both assertions so a regression is unambiguous.
    assert "parity checked" in out, (
        "Realignment marker success message must say 'parity checked' "
        "to prove inter-file parity was actually evaluated before the "
        "equality exemption fired. This is the regression lock for the "
        "original marker short-circuit hole where run_gate returned "
        "EXIT_OK without ever parsing run_pr_preflight.py or ci.yml."
    )
    assert "equality exempted" in out
    assert "Parity:" in out, (
        "Success message must include the 'Parity:' summary line "
        "describing which two files were checked, matching the clean "
        "aligned-path output."
    )


# ---------------------------------------------------------------------------
# T6 — [ratchet-test-removal] marker → exit 0
# ---------------------------------------------------------------------------


def test_t6_test_removal_marker_exempts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    responses: dict[tuple[str, ...], _FakeCompleted] = {
        ("log", "--oneline", "origin/main..HEAD"): _FakeCompleted(
            returncode=0,
            stdout="def5678 test: [ratchet-test-removal] retire legacy suite\n",
        ),
        ("rev-list", "--count", "origin/main..HEAD"): _FakeCompleted(
            returncode=0, stdout="1\n"
        ),
    }
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=85,  # Intentional reduction below floor
        ext_actual=200,
        git_responses=responses,
        python_commit_accounting=None,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_OK
    out = capsys.readouterr().out
    assert "[ratchet-test-removal]" in out
    # Symmetric lock with T5 — the test-removal marker success path
    # must also positively prove that parity was evaluated before the
    # equality exemption fired.
    assert "parity checked" in out, (
        "Test-removal marker success message must say 'parity checked' "
        "to prove inter-file parity was actually evaluated before the "
        "equality exemption fired."
    )
    assert "equality exempted" in out
    assert "Parity:" in out


# ---------------------------------------------------------------------------
# T6a — mismatched bypass markers do NOT exempt equality drift
# ---------------------------------------------------------------------------


def test_t6a_test_removal_marker_does_not_exempt_test_addition_drift(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    failure = gate.CommitFailure(
        commit_sha="def5678",
        commit_subject="test: [ratchet-test-removal] retire legacy suite",
        parent_sha="abc1234",
        suite="python",
        failure_class="delta mismatch",
        detail=(
            "  floor delta:  +0\n"
            "  actual delta: +15\n"
            "  marker(s):    [ratchet-test-removal]\n"
            "  expected marker for this commit: [ratchet-realignment]"
        ),
    )
    responses: dict[tuple[str, ...], _FakeCompleted] = {
        ("log", "--oneline", "origin/main..HEAD"): _FakeCompleted(
            returncode=0,
            stdout="def5678 test: [ratchet-test-removal] retire legacy suite\n",
        ),
        ("rev-list", "--count", "origin/main..HEAD"): _FakeCompleted(
            returncode=0, stdout="1\n"
        ),
    }
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=115,
        ext_actual=200,
        git_responses=responses,
        python_commit_accounting=failure,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_DRIFT
    stderr = capsys.readouterr().err
    assert "Python per-commit ratchet accounting failed" in stderr
    assert "suite: python" in stderr
    assert "failure class: delta mismatch" in stderr
    assert "[ratchet-test-removal]" in stderr
    assert "expected marker for this commit: [ratchet-realignment]" in stderr


def test_t6aa_realignment_marker_does_not_exempt_test_removal_drift(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    failure = gate.CommitFailure(
        commit_sha="abc1234",
        commit_subject="chore: [ratchet-realignment] catch up on drift",
        parent_sha="feedface",
        suite="python",
        failure_class="delta mismatch",
        detail=(
            "  floor delta:  +0\n"
            "  actual delta: -15\n"
            "  marker(s):    [ratchet-realignment]\n"
            "  expected marker for this commit: [ratchet-test-removal]"
        ),
    )
    responses: dict[tuple[str, ...], _FakeCompleted] = {
        ("log", "--oneline", "origin/main..HEAD"): _FakeCompleted(
            returncode=0,
            stdout="abc1234 chore: [ratchet-realignment] catch up on drift\n",
        ),
        ("rev-list", "--count", "origin/main..HEAD"): _FakeCompleted(
            returncode=0, stdout="1\n"
        ),
    }
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=85,
        ext_actual=200,
        git_responses=responses,
        python_commit_accounting=failure,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_DRIFT
    stderr = capsys.readouterr().err
    assert "Python per-commit ratchet accounting failed" in stderr
    assert "suite: python" in stderr
    assert "failure class: delta mismatch" in stderr
    assert "[ratchet-realignment]" in stderr
    assert "expected marker for this commit: [ratchet-test-removal]" in stderr


def test_t6ab_required_marker_exempts_even_when_unrelated_marker_is_also_present(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    responses: dict[tuple[str, ...], _FakeCompleted] = {
        ("log", "--oneline", "origin/main..HEAD"): _FakeCompleted(
            returncode=0,
            stdout=(
                "abc1234 chore: [ratchet-realignment] prior floor catch-up\n"
                "def5678 test: [ratchet-test-removal] retire legacy suite\n"
            ),
        ),
        ("rev-list", "--count", "origin/main..HEAD"): _FakeCompleted(
            returncode=0, stdout="2\n"
        ),
    }
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=85,
        ext_actual=200,
        git_responses=responses,
        python_commit_accounting=None,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_OK
    out = capsys.readouterr().out
    assert "[ratchet-test-removal]" in out
    assert "parity checked" in out
    assert "equality exempted" in out


def test_t6ac_unrelated_extra_marker_is_ignored_when_required_marker_is_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    failure = gate.CommitFailure(
        commit_sha="abc1234",
        commit_subject="chore: [ratchet-realignment] prior floor catch up",
        parent_sha="deadbeef",
        suite="python",
        failure_class="delta mismatch",
        detail=(
            "  floor delta:  +0\n"
            "  actual delta: -15\n"
            "  marker(s):    [ratchet-realignment]\n"
            "  expected marker for this commit: [ratchet-test-removal]"
        ),
    )
    responses: dict[tuple[str, ...], _FakeCompleted] = {
        ("log", "--oneline", "origin/main..HEAD"): _FakeCompleted(
            returncode=0,
            stdout="abc1234 chore: [ratchet-realignment] prior floor catch up\n",
        ),
        ("rev-list", "--count", "origin/main..HEAD"): _FakeCompleted(
            returncode=0, stdout="1\n"
        ),
    }
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=85,
        ext_actual=200,
        git_responses=responses,
        python_commit_accounting=failure,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_DRIFT
    stderr = capsys.readouterr().err
    assert "Python per-commit ratchet accounting failed" in stderr
    assert "suite: python" in stderr
    assert "failure class: delta mismatch" in stderr
    assert "[ratchet-realignment]" in stderr
    assert "expected marker for this commit: [ratchet-test-removal]" in stderr


# ---------------------------------------------------------------------------
# T6b — explicit marker range is honored for push-to-main workflows
# ---------------------------------------------------------------------------


def test_t6b_explicit_marker_range_overrides_base_relative_log_scan(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    marker_range = "deadbeef..feedface"
    responses: dict[tuple[str, ...], _FakeCompleted] = {
        ("log", "--oneline", "origin/main..HEAD"): _FakeCompleted(
            returncode=0,
            stdout="abc1234 feat: ordinary merge without marker\n",
        ),
        ("rev-list", "--count", "origin/main..HEAD"): _FakeCompleted(
            returncode=0, stdout="1\n"
        ),
        ("log", "--oneline", marker_range): _FakeCompleted(
            returncode=0,
            stdout="feedface chore: [ratchet-realignment] merge ratchet update\n",
        ),
    }
    exit_code, recorder = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=150,
        ext_actual=200,
        marker_range=marker_range,
        git_responses=responses,
        python_commit_accounting=None,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_OK
    out = capsys.readouterr().out
    assert marker_range in out, (
        "The success message must report the explicit pushed-commit "
        "range so main-branch CI makes it obvious which commits were "
        "scanned for a bypass marker."
    )
    matching_logs = [
        call.args
        for call in recorder.calls
        if call.args[:3] == ["git", "log", "--oneline"]
        and call.args[-1] == marker_range
    ]
    assert matching_logs, (
        "run_gate must scan the explicit marker range when provided; "
        "otherwise push workflows on main will inspect an empty "
        "origin/main..HEAD range after merge and miss marker-bearing "
        "commits that just landed."
    )


def test_t6c_python_marker_accounting_setup_failure_exits_setup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    responses: dict[tuple[str, ...], _FakeCompleted] = {
        ("log", "--oneline", "origin/main..HEAD"): _FakeCompleted(
            returncode=0,
            stdout="abc1234 chore: [ratchet-realignment] catch up on drift\n",
        ),
        ("rev-list", "--count", "origin/main..HEAD"): _FakeCompleted(
            returncode=0, stdout="1\n"
        ),
    }

    def boom(base_ref: str, *, marker_range: str | None = None) -> None:
        raise gate.RatchetSetupError("historical snapshot unavailable")

    monkeypatch.setattr(gate, "evaluate_python_commit_accounting", boom)
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=150,
        ext_actual=200,
        git_responses=responses,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_SETUP
    stderr = capsys.readouterr().err
    assert "[SETUP] Python per-commit ratchet accounting failed" in stderr
    assert "historical snapshot unavailable" in stderr


def test_t6d_extension_marker_cannot_waive_equality_drift(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    responses: dict[tuple[str, ...], _FakeCompleted] = {
        ("log", "--oneline", "origin/main..HEAD"): _FakeCompleted(
            returncode=0,
            stdout="abc1234 chore: [ratchet-realignment] catch up on drift\n",
        ),
        ("rev-list", "--count", "origin/main..HEAD"): _FakeCompleted(
            returncode=0, stdout="1\n"
        ),
    }
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=100,
        ext_actual=205,
        git_responses=responses,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_DRIFT
    stderr = capsys.readouterr().err
    assert "Extension equality drift cannot be waived by a marker" in stderr
    assert "suite: extension" in stderr
    assert "failure class: setup failure" in stderr
    assert "extension/test-results.xml" in stderr


# ---------------------------------------------------------------------------
# T7 — preflight and ci.yml floors disagree → exit 1 (self-contained parity)
# ---------------------------------------------------------------------------


def test_t7_inter_file_parity_violation_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=100,
        ext_actual=200,
        ci_python_floor=101,  # CI disagrees with preflight
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_DRIFT
    stderr = capsys.readouterr().err
    assert "Inter-file parity violation" in stderr
    assert "Python floor mismatch" in stderr
    assert "update them together" in stderr


# ---------------------------------------------------------------------------
# T8 — missing Extension JUnit XML → exit 2
# ---------------------------------------------------------------------------


def test_t8_missing_extension_junit_is_setup_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    preflight = _write_preflight(tmp_path, python_floor=100, ext_floor=200)
    ci = _write_ci_yaml(tmp_path, python_floor=100, ext_floor=200)
    missing = tmp_path / "does-not-exist.xml"

    recorder = _GitFakeRecorder(
        git_responses=_default_git_responses(),
        pytest_collected=100,
    )
    _install_recorder(monkeypatch, recorder)

    exit_code = gate.run_gate(
        preflight_path=preflight,
        ci_workflow_path=ci,
        junit_extension_path=missing,
        base_ref="origin/main",
    )
    assert exit_code == gate.EXIT_SETUP
    stderr = capsys.readouterr().err
    assert "[SETUP]" in stderr
    assert "Extension JUnit XML not found" in stderr


# ---------------------------------------------------------------------------
# T9 — malformed preflight (missing --min-collected token) → exit 2
# ---------------------------------------------------------------------------


def test_t9_malformed_preflight_is_setup_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    preflight = tmp_path / "run_pr_preflight.py"
    preflight.write_text(
        '''"""Malformed stub."""
from dataclasses import dataclass


@dataclass(frozen=True)
class CommandSpec:
    name: str
    command: tuple[str, ...]


SPECS = (
    CommandSpec(
        "Python test count validation",
        (
            "python",
            ".github/scripts/validate-test-results.py",
            "test-results.xml",
        ),
    ),
)
''',
        encoding="utf-8",
    )
    ci = _write_ci_yaml(tmp_path, python_floor=100, ext_floor=200)
    junit = _write_extension_junit(tmp_path, 200)

    recorder = _GitFakeRecorder(
        git_responses=_default_git_responses(),
        pytest_collected=100,
    )
    _install_recorder(monkeypatch, recorder)

    exit_code = gate.run_gate(
        preflight_path=preflight,
        ci_workflow_path=ci,
        junit_extension_path=junit,
        base_ref="origin/main",
    )
    assert exit_code == gate.EXIT_SETUP
    stderr = capsys.readouterr().err
    assert "has neither --min-collected=N nor --min-collected-artifact" in stderr


# ---------------------------------------------------------------------------
# T10 — Python AND Extension drift simultaneously → exit 1 with both messages
# ---------------------------------------------------------------------------


def test_t10_simultaneous_drift_reports_both(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=102,
        ext_actual=205,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_DRIFT
    stderr = capsys.readouterr().err
    assert "Python ratchet drift" in stderr
    assert "Extension ratchet drift" in stderr
    assert "Delta: +2" in stderr
    assert "Delta: +5" in stderr


# ---------------------------------------------------------------------------
# T11 — shallow clone + unshallow success → exit 0
# ---------------------------------------------------------------------------


def test_t11_shallow_clone_unshallow_succeeds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Shallow-clone path: fetch --unshallow is used and the gate passes.

    Note on semantics after the always-fetch refactor
    (``ensure_base_ref_reachable`` no longer short-circuits on a pre-existing
    ref): the old T11 used to assert that rev-parse fired *twice* —
    once before the unshallow fetch, once after — because the old
    control flow called ``_base_ref_present`` first and only fetched
    if that failed. That shortcut is gone: the gate now fetches
    unconditionally (stale-ref correctness), so rev-parse is called
    exactly once, *after* the fetch. The invariant this test now
    locks is narrower and more accurate:

    - The shallow marker is honored (``--unshallow`` is in the fetch
      argv, not ``--depth=N``).
    - After the shallow recovery fetch, the post-fetch rev-parse /
      log / rev-list checks succeed and the gate returns EXIT_OK.
    """
    preflight = _write_preflight(tmp_path, python_floor=100, ext_floor=200)
    ci = _write_ci_yaml(tmp_path, python_floor=100, ext_floor=200)
    junit = _write_extension_junit(tmp_path, 200)

    # Pretend the repo is shallow by creating a marker file.
    shallow_marker = tmp_path / ".git" / "shallow"
    shallow_marker.parent.mkdir(parents=True, exist_ok=True)
    shallow_marker.write_text("", encoding="utf-8")
    monkeypatch.setattr(gate, "REPO_ROOT", tmp_path)

    call_counter = {"fetch_unshallow": 0, "rev_parse": 0}

    def responsive_run(
        args: list[str] | tuple[str, ...], **kwargs: object
    ) -> _FakeCompleted:
        normalized = list(args)
        if normalized[:1] == ["git"]:
            rest = normalized[1:]
            if rest[:3] == ["rev-parse", "--verify", "origin/main^{commit}"]:
                call_counter["rev_parse"] += 1
                return _FakeCompleted(returncode=0, stdout="deadbeef\n")
            if rest[:3] == ["log", "--oneline", "origin/main..HEAD"]:
                return _FakeCompleted(returncode=0, stdout="abc feat\n")
            if rest[:3] == ["rev-list", "--count", "origin/main..HEAD"]:
                return _FakeCompleted(returncode=0, stdout="1\n")
            if rest[:2] == ["log", "--format=%s%n%b"]:
                return _FakeCompleted(returncode=0, stdout="feat: noop\n")
            if rest[:2] == ["fetch", "--no-tags"]:
                # Positive lock: shallow recovery MUST include --unshallow
                # and MUST NOT fall back to --depth=N.
                assert "--unshallow" in rest, (
                    "Shallow-clone recovery must use `--unshallow` so the "
                    "fetch is deterministic; found: " + repr(rest)
                )
                assert not any(arg.startswith("--depth") for arg in rest), (
                    "Shallow-clone recovery must not fall back to "
                    "`--depth=N`; the only deterministic option is "
                    "`--unshallow`. Found: " + repr(rest)
                )
                call_counter["fetch_unshallow"] += 1
                return _FakeCompleted(returncode=0, stdout="", stderr="")
            return _FakeCompleted(returncode=0)
        if _is_pytest_collect(normalized):
            env_obj = kwargs.get("env")
            if isinstance(env_obj, dict):
                out = env_obj.get("RATCHET_COUNT_OUTPUT")
                node_ids_out = env_obj.get("RATCHET_NODEIDS_OUTPUT")
                if isinstance(out, str):
                    Path(out).write_text("100\n", encoding="utf-8")
                if isinstance(node_ids_out, str):
                    Path(node_ids_out).write_text(
                        json.dumps(["tests/test_stub.py::test_case_0"]),
                        encoding="utf-8",
                    )
            return _FakeCompleted(returncode=0)
        raise AssertionError(f"Unexpected run: {normalized!r}")

    monkeypatch.setattr(gate.subprocess, "run", responsive_run)
    monkeypatch.setattr(subprocess, "run", responsive_run)

    exit_code = gate.run_gate(
        preflight_path=preflight,
        ci_workflow_path=ci,
        junit_extension_path=junit,
        base_ref="origin/main",
    )
    assert exit_code == gate.EXIT_OK
    assert call_counter["fetch_unshallow"] == 1, (
        "Shallow recovery should issue exactly one `fetch --unshallow`; "
        f"got {call_counter['fetch_unshallow']}"
    )
    assert call_counter["rev_parse"] >= 1, (
        "rev-parse should be called at least once AFTER the unshallow "
        "fetch as the post-fetch reachability check"
    )


# ---------------------------------------------------------------------------
# T12 — YAML backslash-continuation flags are correctly folded
# ---------------------------------------------------------------------------


def test_t12_multiline_yaml_run_block_is_folded(tmp_path: Path) -> None:
    ci_content = """name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Validate Test Results (Python)
        run: |
          python \\
            .github/scripts/validate-test-results.py \\
            test-results.xml \\
            --min-collected=1234 \\
            --max-skips=0
  extension-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Validate Test Results (Extension)
        run: |
          python \\
            .github/scripts/validate-test-results.py \\
            extension/test-results.xml \\
            --min-collected=5678 \\
            --max-skips=0
"""
    ci_path = tmp_path / "ci.yml"
    ci_path.write_text(ci_content, encoding="utf-8")

    floors = gate.read_ci_floors(ci_path)
    assert floors.python == 1234, (
        "Backslash-continuation run block must fold into a single command "
        "so --min-collected=1234 is captured on the Python side"
    )
    assert floors.extension == 5678, (
        "Backslash-continuation run block must fold into a single command "
        "so --min-collected=5678 is captured on the Extension side"
    )


def test_t12a_preflight_can_read_min_collected_from_committed_artifact(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_floor_contract(tmp_path, python_floor=1234, ext_floor=5678)
    preflight_path = tmp_path / "run_pr_preflight.py"
    preflight_path.write_text(
        '''"""Artifact-backed stub preflight."""
from dataclasses import dataclass


@dataclass(frozen=True)
class CommandSpec:
    name: str
    command: tuple[str, ...]


SPECS = (
    CommandSpec(
        "Python test count validation",
        (
            "python",
            ".github/scripts/validate-test-results.py",
            "test-results.xml",
            "--min-collected-artifact",
            ".test-floor-contract.json",
            "--suite",
            "python",
            "--max-skips=0",
        ),
    ),
    CommandSpec(
        "Extension test count validation",
        (
            "python",
            ".github/scripts/validate-test-results.py",
            "extension/test-results.xml",
            "--min-collected-artifact",
            ".test-floor-contract.json",
            "--suite",
            "extension",
            "--max-skips=0",
        ),
    ),
)
''',
        encoding="utf-8",
    )
    monkeypatch.setattr(gate, "REPO_ROOT", tmp_path)

    floors = gate.read_preflight_floors(preflight_path)
    assert floors.python == 1234
    assert floors.extension == 5678


def test_t12b_ci_can_read_min_collected_from_committed_artifact(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_floor_contract(tmp_path, python_floor=1234, ext_floor=5678)
    ci_path = tmp_path / "ci.yml"
    ci_path.write_text(
        """name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Validate Test Results (Python)
        run: |
          python .github/scripts/validate-test-results.py \\
            test-results.xml \\
            --min-collected-artifact .test-floor-contract.json \\
            --suite python \\
            --max-skips=0
  extension-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Validate Test Results (Extension)
        run: |
          python .github/scripts/validate-test-results.py \\
            extension/test-results.xml \\
            --min-collected-artifact .test-floor-contract.json \\
            --suite extension \\
            --max-skips=0
""",
        encoding="utf-8",
    )
    monkeypatch.setattr(gate, "REPO_ROOT", tmp_path)

    floors = gate.read_ci_floors(ci_path)
    assert floors.python == 1234
    assert floors.extension == 5678


# ---------------------------------------------------------------------------
# T13 — collector subprocess non-zero exit → setup error
# ---------------------------------------------------------------------------


def test_t13_collector_nonzero_exit_is_setup_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=100,
        ext_actual=200,
        pytest_rc=2,
        pytest_stderr="ImportError: cannot import name 'foo'",
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_SETUP
    stderr = capsys.readouterr().err
    assert "pytest collect-only failed" in stderr
    assert "ImportError" in stderr


# ---------------------------------------------------------------------------
# T14 — Fix 1: subprocess env includes autoload-disable and scrubs user flags
# ---------------------------------------------------------------------------


def test_t14_pytest_env_is_isolated_from_autoload_and_user_flags(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Pollute the parent env with flags that the gate must scrub or override.
    monkeypatch.setenv("PYTEST_ADDOPTS", "--randomly-seed=0xdead --cov")
    monkeypatch.setenv("PYTEST_PLUGINS", "rogue_plugin")

    _, recorder = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=100,
        ext_actual=200,
        monkeypatch=monkeypatch,
    )

    pytest_calls = [c for c in recorder.calls if _is_pytest_collect(c.args)]
    assert pytest_calls, "gate must spawn pytest at least once"
    call = pytest_calls[0]

    assert call.env is not None
    assert call.env.get("PYTEST_DISABLE_PLUGIN_AUTOLOAD") == "1", (
        "Fix 1: PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 must be set so third-party "
        "plugins on the dev machine cannot alter the collected count"
    )
    assert "PYTEST_ADDOPTS" not in call.env, (
        "Fix 1: PYTEST_ADDOPTS from the user environment must be scrubbed; "
        "it could inject --cov or plugin flags that affect collection"
    )
    assert "PYTEST_PLUGINS" not in call.env, (
        "Fix 1: PYTEST_PLUGINS from the user environment must be scrubbed"
    )

    command = call.args
    # -o addopts= must neutralize pyproject.toml's addopts setting so
    # neither --cov nor any other pyproject-level flag can skew collection.
    assert "-o" in command, (
        "Fix 1: the gate must pass `-o addopts=` so pyproject.toml's addopts "
        "cannot inject --cov or other plugin flags into collection"
    )
    assert "addopts=" in command, (
        "Fix 1: the `-o addopts=` override must carry an empty addopts value"
    )
    # Defense-in-depth: common third-party plugins explicitly disabled
    for plugin in ("no:randomly", "no:xdist", "no:sugar", "no:forked"):
        assert plugin in command, (
            f"Fix 1: the gate must pass `-p {plugin}` as defense in depth "
            f"even with autoload disabled"
        )
    # Committed collector plugin must be the explicit plugin
    assert "scripts._pytest_count_collector" in command, (
        "Fix 1: the gate must load the committed collector plugin explicitly"
    )
    assert "--ignore-glob=**/test_*_windows.py" in command, (
        "Cross-platform minimum requires excluding Windows-only tests"
    )
    assert "--import-mode=importlib" in command, (
        "Fix 1: --import-mode=importlib makes import resolution deterministic"
    )


# ---------------------------------------------------------------------------
# T15 — Fix 2: shallow clone + unshallow failure → exit 2, deterministic
# ---------------------------------------------------------------------------


def test_t15_shallow_clone_unshallow_failure_is_setup_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    preflight = _write_preflight(tmp_path, python_floor=100, ext_floor=200)
    ci = _write_ci_yaml(tmp_path, python_floor=100, ext_floor=200)
    junit = _write_extension_junit(tmp_path, 200)

    shallow_marker = tmp_path / ".git" / "shallow"
    shallow_marker.parent.mkdir(parents=True, exist_ok=True)
    shallow_marker.write_text("", encoding="utf-8")
    monkeypatch.setattr(gate, "REPO_ROOT", tmp_path)

    def responsive_run(
        args: list[str] | tuple[str, ...], **kwargs: object
    ) -> _FakeCompleted:
        normalized = list(args)
        if normalized[:1] == ["git"]:
            rest = normalized[1:]
            if rest[:3] == ["rev-parse", "--verify", "origin/main^{commit}"]:
                return _FakeCompleted(
                    returncode=1, stdout="", stderr="unknown revision"
                )
            if rest[:3] == ["log", "--oneline", "origin/main..HEAD"]:
                return _FakeCompleted(returncode=128, stdout="", stderr="bad revision")
            if rest[:3] == ["rev-list", "--count", "origin/main..HEAD"]:
                return _FakeCompleted(returncode=128, stdout="", stderr="bad revision")
            if rest[:2] == ["fetch", "--no-tags"]:
                assert "--unshallow" in rest, (
                    "Fix 2: shallow clone fetch MUST use --unshallow "
                    "(deterministic full history), never --depth=N"
                )
                assert not any(arg.startswith("--depth") for arg in rest), (
                    "Fix 2: the gate must NOT fall back to --depth=N; the "
                    "only deterministic option is --unshallow"
                )
                return _FakeCompleted(
                    returncode=128,
                    stdout="",
                    stderr="fatal: --unshallow on a complete repository does not make sense",
                )
            return _FakeCompleted(returncode=0)
        raise AssertionError(f"Unexpected run: {normalized!r}")

    monkeypatch.setattr(gate.subprocess, "run", responsive_run)
    monkeypatch.setattr(subprocess, "run", responsive_run)

    exit_code = gate.run_gate(
        preflight_path=preflight,
        ci_workflow_path=ci,
        junit_extension_path=junit,
        base_ref="origin/main",
    )
    assert exit_code == gate.EXIT_SETUP
    stderr = capsys.readouterr().err
    # Message wording updated in the always-fetch refactor: the old
    # "Failed to fetch full history" was the pre-fetch-shortcut phrasing;
    # the new wording "Failed to refresh base ref" names the invariant
    # being enforced (base ref freshness) and is the string T33 also
    # asserts on for the non-shallow fetch-failure path.
    assert "Failed to refresh base ref" in stderr
    assert "fetch-depth: 0" in stderr
    assert "--unshallow" in stderr


# ---------------------------------------------------------------------------
# T16 — Fix 3: YAML missing 'jobs' key → CiYamlParseError → exit 2
# ---------------------------------------------------------------------------


def test_t16_yaml_missing_jobs_key_is_setup_error(tmp_path: Path) -> None:
    ci_path = tmp_path / "ci.yml"
    ci_path.write_text(
        "name: CI\non: [push]\n# Missing 'jobs' section entirely\n",
        encoding="utf-8",
    )
    with pytest.raises(gate.RatchetSetupError) as exc_info:
        gate.read_ci_floors(ci_path)
    message = str(exc_info.value)
    assert "missing or malformed 'jobs'" in message
    assert "ci.yml" in message


# ---------------------------------------------------------------------------
# T17 — Fix 3: YAML missing step name → CiYamlParseError with available list
# ---------------------------------------------------------------------------


def test_t17_yaml_missing_step_lists_available_names(tmp_path: Path) -> None:
    ci_path = tmp_path / "ci.yml"
    ci_path.write_text(
        """name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Some other step
        run: echo ok
  extension-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Validate Test Results (Extension)
        run: |
          python .github/scripts/validate-test-results.py \\
            extension/test-results.xml --min-collected=200
""",
        encoding="utf-8",
    )
    with pytest.raises(gate.RatchetSetupError) as exc_info:
        gate.read_ci_floors(ci_path)
    message = str(exc_info.value)
    assert "Validate Test Results (Python)" in message
    assert "Some other step" in message
    assert "available steps" in message


# ---------------------------------------------------------------------------
# T18 — Fix 3: YAML step missing 'run' value → CiYamlParseError
# ---------------------------------------------------------------------------


def test_t18_yaml_step_missing_run_is_setup_error(tmp_path: Path) -> None:
    ci_path = tmp_path / "ci.yml"
    ci_path.write_text(
        """name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Validate Test Results (Python)
        uses: some/action@v1
  extension-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Validate Test Results (Extension)
        run: |
          python .github/scripts/validate-test-results.py \\
            extension/test-results.xml --min-collected=200
""",
        encoding="utf-8",
    )
    with pytest.raises(gate.RatchetSetupError) as exc_info:
        gate.read_ci_floors(ci_path)
    message = str(exc_info.value)
    assert "missing or non-string 'run'" in message
    assert "Validate Test Results (Python)" in message


# ---------------------------------------------------------------------------
# T19 — cleanup retries transient PermissionError and succeeds
# ---------------------------------------------------------------------------


def test_t19_cleanup_retries_on_permission_error_then_succeeds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Transient PermissionError on unlink is retried and absorbed.

    Simulates the Windows AV / deferred-close window: the first unlink
    attempt on the collector tempfile raises PermissionError, the
    second succeeds. The gate must still exit 0 AND the attempt
    counter must stop at exactly 2 per tempfile — the loop uses an
    explicit ``break`` on success so a third iteration is forbidden.

    On Windows, ``run_gate`` spawns two collection subprocesses per
    invocation (one through :func:`measure_python_count` for the
    cross-platform floor and one through :func:`measure_windows_full_count`
    for the display-only Windows hermetic full count), so two independent
    tempfile-cleanup sequences are expected. On Linux/macOS,
    :func:`measure_windows_full_count` short-circuits to ``None`` before
    touching a subprocess, so exactly one tempfile is expected.
    """
    real_unlink = Path.unlink
    call_counts: dict[str, int] = {}

    def flaky_unlink(self: Path, missing_ok: bool = False) -> None:
        # Only intercept unlinks on the gate's own tempfile; leave
        # tmp_path fixture cleanup and unrelated paths to the real impl.
        if not self.name.startswith("ratchet-count-"):
            real_unlink(self, missing_ok=missing_ok)
            return
        call_counts[self.name] = call_counts.get(self.name, 0) + 1
        if call_counts[self.name] == 1:
            raise PermissionError(f"simulated transient AV hold on {self.name}")
        real_unlink(self, missing_ok=missing_ok)

    monkeypatch.setattr(Path, "unlink", flaky_unlink)
    monkeypatch.setattr(gate, "_CLEANUP_RETRY_SLEEP_SECONDS", 0.0)

    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=100,
        ext_actual=200,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_OK
    expected_sequences = 2 if sys.platform == "win32" else 1
    assert len(call_counts) == expected_sequences, (
        f"Expected exactly {expected_sequences} ratchet-count-* tempfile "
        f"unlink sequence(s) on {sys.platform}; got: {call_counts!r}. "
        f"measure_python_count always runs; measure_windows_full_count "
        f"runs on Windows only."
    )
    for tempfile_name, attempts in call_counts.items():
        assert attempts == 2, (
            "Retry loop must break immediately on success — expected 2 "
            f"unlink attempts (1 transient fail + 1 retry success) for "
            f"{tempfile_name!r}, got {attempts}"
        )


# ---------------------------------------------------------------------------
# T20 — cleanup retries exhausted do NOT propagate and are bounded
# ---------------------------------------------------------------------------


def test_t20_cleanup_permission_error_exhausted_does_not_propagate(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Persistent PermissionError must not mask the measurement verdict.

    Every unlink attempt raises PermissionError. The gate must still
    return exit 0 (cleanup failure is not a gate failure), and the
    attempt counter must cap exactly at ``_CLEANUP_RETRY_ATTEMPTS`` per
    tempfile — the loop must never retry beyond its bound even if all
    attempts fail.

    On Windows, two tempfiles are produced per ``run_gate`` invocation
    (see the T19 docstring). Each independently exercises the bounded
    retry loop. On Linux/macOS, the Windows-only display measurement
    short-circuits to ``None`` before touching a subprocess, so exactly
    one tempfile is produced.
    """
    real_unlink = Path.unlink
    call_counts: dict[str, int] = {}

    def always_fail_unlink(self: Path, missing_ok: bool = False) -> None:
        if not self.name.startswith("ratchet-count-"):
            real_unlink(self, missing_ok=missing_ok)
            return
        call_counts[self.name] = call_counts.get(self.name, 0) + 1
        raise PermissionError(f"simulated persistent lock on {self.name}")

    monkeypatch.setattr(Path, "unlink", always_fail_unlink)
    monkeypatch.setattr(gate, "_CLEANUP_RETRY_SLEEP_SECONDS", 0.0)

    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=100,
        ext_actual=200,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_OK
    expected_sequences = 2 if sys.platform == "win32" else 1
    assert len(call_counts) == expected_sequences, (
        f"Expected exactly {expected_sequences} ratchet-count-* tempfile "
        f"unlink sequence(s) on {sys.platform}; got: {call_counts!r}. "
        f"measure_python_count always runs; measure_windows_full_count "
        f"runs on Windows only."
    )
    for tempfile_name, attempts in call_counts.items():
        assert attempts == gate._CLEANUP_RETRY_ATTEMPTS, (
            f"Retry loop must cap at _CLEANUP_RETRY_ATTEMPTS="
            f"{gate._CLEANUP_RETRY_ATTEMPTS} for {tempfile_name!r}; "
            f"got {attempts} attempts"
        )


# ---------------------------------------------------------------------------
# T21 — non-PermissionError OSError MUST propagate (narrow catch contract)
# ---------------------------------------------------------------------------


def test_t21_cleanup_non_permission_oserror_propagates(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Disk-full / I/O errors on unlink must NOT be swallowed.

    The cleanup helper catches only PermissionError — all other
    OSError subclasses indicate real filesystem bugs that must surface
    instead of being silently hidden. This test uses ENOSPC (disk
    full) which is a plain OSError subclass, not a PermissionError,
    and asserts the error escapes the gate.
    """
    real_unlink = Path.unlink

    def enospc_unlink(self: Path, missing_ok: bool = False) -> None:
        if not self.name.startswith("ratchet-count-"):
            real_unlink(self, missing_ok=missing_ok)
            return
        # ENOSPC = 28. OSError(errno, strerror) is a plain OSError,
        # NOT a PermissionError subclass — must propagate.
        raise OSError(28, "simulated disk full (ENOSPC)")

    monkeypatch.setattr(Path, "unlink", enospc_unlink)
    monkeypatch.setattr(gate, "_CLEANUP_RETRY_SLEEP_SECONDS", 0.0)

    with pytest.raises(OSError, match="simulated disk full") as exc_info:
        _run_gate(
            tmp_path,
            python_floor=100,
            ext_floor=200,
            python_actual=100,
            ext_actual=200,
            monkeypatch=monkeypatch,
        )
    # Positive guard: the escaping error is genuinely OSError and NOT
    # a PermissionError (otherwise the narrow-catch contract is broken).
    assert not isinstance(exc_info.value, PermissionError), (
        "Cleanup helper must catch PermissionError only; a plain "
        "OSError (ENOSPC / I/O error) was incorrectly swallowed"
    )


# ---------------------------------------------------------------------------
# T22 — gate leaves zero tempfile or tempdir artifacts after a clean run
# ---------------------------------------------------------------------------


def test_t22_gate_leaves_no_temp_artifacts_in_isolated_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Post-run temp dir must be empty — regression lock for #280 v3.

    Redirects ``tempfile.tempdir`` to a subdir owned exclusively by
    this test so the assertion cannot be tripped by unrelated
    ratchet-count-* files from earlier runs, parallel test processes,
    or CI matrix legs. After a successful gate run the isolated dir
    must be empty — proving both that the mkstemp file was unlinked
    AND that no ``ratchet-collect-*`` subdirectory was reintroduced
    (the TemporaryDirectory pattern must never come back).
    """
    import tempfile as stdlib_tempfile

    isolated_tmp = tmp_path / "isolated-temp"
    isolated_tmp.mkdir()
    # tempfile.tempdir is the module-level cache that gettempdir()
    # returns first. Setting it here forces mkstemp (which the gate
    # calls with dir=None) to create its files inside isolated_tmp
    # instead of the real %TEMP%.
    monkeypatch.setattr(stdlib_tempfile, "tempdir", str(isolated_tmp))

    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=100,
        ext_actual=200,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_OK

    leftovers = sorted(p.name for p in isolated_tmp.iterdir())
    assert not leftovers, (
        f"Gate must leave no artifacts in its temp dir; found: "
        f"{leftovers}. This locks both (a) successful unlink of the "
        "mkstemp collector file AND (b) no reintroduction of "
        "tempfile.TemporaryDirectory (which would leak a "
        "ratchet-collect-* subdirectory on Windows cleanup failure)."
    )


# ---------------------------------------------------------------------------
# T23 — empty collector output is a setup error (partial-write guard)
# ---------------------------------------------------------------------------


def test_t23_empty_count_file_is_setup_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Empty count file must raise a setup error, not pass int('').

    If the collector plugin starts writing but fails mid-write (or
    Windows flushes late), the tempfile can exist but contain an
    empty string. The gate must flag this as EXIT_SETUP with a
    message that distinguishes "empty" from the generic "not an
    integer" path, so reviewers can tell at a glance whether they
    hit a partial-write / plugin-load issue vs. a corrupt count.
    """
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=100,  # Ignored: pytest_empty_output overrides
        ext_actual=200,
        pytest_empty_output=True,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_SETUP
    stderr = capsys.readouterr().err
    assert "empty" in stderr.lower()
    assert "partial write" in stderr.lower()


# ---------------------------------------------------------------------------
# T24 — marker scan reads subjects only (no body-text false positives)
# ---------------------------------------------------------------------------


def test_t24_marker_scan_reads_subjects_only_via_oneline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The marker scan must invoke ``git log --oneline``, never
    ``git log --format=%s%n%b``.

    Commit bodies frequently mention the bypass marker strings for
    documentation purposes — e.g., the #280 gate's own commit message
    explains what ``[ratchet-realignment]`` and
    ``[ratchet-test-removal]`` mean. If the scan read bodies, those
    prose references would falsely exempt subsequent commits from
    the drift check. The convention (shared with
    ``check_threshold_changes.py`` and ``check-version-unchanged.py``)
    is to scan subject lines only via ``--oneline``, so markers only
    take effect when placed deliberately in a commit subject.
    """
    exit_code, recorder = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=100,
        ext_actual=200,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_OK

    git_log_calls = [call for call in recorder.calls if call.args[:2] == ["git", "log"]]
    subject_scans = [c for c in git_log_calls if "--oneline" in c.args]
    body_scans = [c for c in git_log_calls if any("--format=" in a for a in c.args)]

    assert subject_scans, (
        "Gate must invoke `git log --oneline` at least once for marker "
        "scanning (subject-only convention); observed git log calls: "
        f"{[c.args for c in git_log_calls]}"
    )
    assert not body_scans, (
        "Gate must NOT use `git log --format=%s%n%b` (or any --format "
        "variant) — body-text mentions of bypass markers would trigger "
        "false exemptions. This locks the subject-only convention "
        "against regression. Offending calls: "
        f"{[c.args for c in body_scans]}"
    )


# ---------------------------------------------------------------------------
# T25 — drift remediation hint matches the subject-only scan behavior
# ---------------------------------------------------------------------------


def test_t25_drift_bypass_hint_points_at_commit_subject(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Drift remediation must tell users the marker goes in a SUBJECT line.

    After T24 locked the subject-only scan convention, the legacy
    "any commit message" phrasing in the drift error hint became a
    false-negative trap: a user could follow the outdated remediation,
    put ``[ratchet-realignment]`` in a commit body, and still fail the
    gate because the scan never reads bodies. This test locks the
    hint wording to "subject" so enforcement and remediation stay
    aligned — if the scan semantics ever change again, either this
    test fails or T24 fails, and they cannot diverge silently.
    """
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=101,  # Force drift so the hint line is emitted.
        ext_actual=200,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_DRIFT

    stderr = capsys.readouterr().err.lower()
    # Positive: the hint must name the correct placement site.
    assert "subject" in stderr, (
        "Drift remediation hint must tell users the marker goes in a "
        f"commit subject line; got: {stderr!r}"
    )
    # Negative: the misleading legacy phrasing must be gone. A user
    # following "any commit message" could place the marker in a
    # commit body and still fail the gate.
    assert "any commit message" not in stderr, (
        "Drift remediation hint must not say 'any commit message' — "
        "the scan reads only commit subjects via `git log --oneline`, "
        f"so that phrasing is misleading. Current stderr: {stderr!r}"
    )
    # Positive: the hint must name the scan command so users can
    # verify the contract themselves if the remediation surprises them.
    assert "git log --oneline" in stderr, (
        "Drift remediation hint must reference `git log --oneline` "
        "so users can self-verify the subject-only scan contract; "
        f"got: {stderr!r}"
    )


# ---------------------------------------------------------------------------
# T26 — [ratchet-realignment] marker + Python inter-file parity drift → exit 1
#
# Regression lock for the original v1 short-circuit hole: run_gate used to
# return EXIT_OK as soon as a bypass marker was detected, before ever parsing
# run_pr_preflight.py or ci.yml. A realignment PR that updated only one
# authoritative site was silently accepted even though the two sites
# disagreed — exactly the regression #280 was filed to prevent. The fix
# moves parity validation in front of the marker exemption, and this test
# locks the new behavior so the hole cannot reopen.
# ---------------------------------------------------------------------------


def test_t26_realignment_marker_does_not_waive_python_parity(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A [ratchet-realignment] marker must NOT waive inter-file parity.

    Preflight says python_floor=100 but ci.yml says python_floor=101. Both
    sites match on the extension dimension and the actual count lines up
    with the preflight floor, so equality drift is clean. Only the parity
    check fails. The marker in the commit log must NOT rescue this — the
    gate must still exit DRIFT and must explicitly print that the marker
    was ignored for parity.
    """
    responses: dict[tuple[str, ...], _FakeCompleted] = {
        ("log", "--oneline", "origin/main..HEAD"): _FakeCompleted(
            returncode=0,
            stdout="abc1234 chore: [ratchet-realignment] realign python floor\n",
        ),
        ("rev-list", "--count", "origin/main..HEAD"): _FakeCompleted(
            returncode=0, stdout="1\n"
        ),
    }
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=100,
        ext_actual=200,
        ci_python_floor=101,  # Parity violation only; equality clean
        git_responses=responses,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_DRIFT, (
        "Marker must not waive inter-file parity; parity-only drift with "
        "a marker present must still exit DRIFT."
    )
    stderr = capsys.readouterr().err
    assert "Inter-file parity violation" in stderr
    assert "Python floor mismatch" in stderr
    # The user-facing message must explain that the marker was
    # deliberately ignored for this check — silently suppressing it
    # would be surprising to someone who added the marker in good
    # faith, and the message documents the invariant.
    assert "[ratchet-realignment]" in stderr, (
        "Stderr must name the marker that was present so the user "
        "sees why the gate flagged this despite the exemption attempt."
    )
    assert "ignored for inter-file parity" in stderr, (
        "Stderr must explicitly say the marker was 'ignored for "
        "inter-file parity', documenting that bypass markers only "
        "waive actual-vs-floor equality drift."
    )


# ---------------------------------------------------------------------------
# T27 — [ratchet-realignment] marker + Extension inter-file parity drift → exit 1
# ---------------------------------------------------------------------------


def test_t27_realignment_marker_does_not_waive_extension_parity(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Same hole as T26, exercised on the extension dimension.

    Separate T-case because run_gate has two independent parity checks
    (Python and Extension) and a single-dimension regression could
    hide in either branch. Locking both dimensions explicitly keeps
    them symmetric.
    """
    responses: dict[tuple[str, ...], _FakeCompleted] = {
        ("log", "--oneline", "origin/main..HEAD"): _FakeCompleted(
            returncode=0,
            stdout="bcd2345 chore: [ratchet-realignment] realign extension floor\n",
        ),
        ("rev-list", "--count", "origin/main..HEAD"): _FakeCompleted(
            returncode=0, stdout="1\n"
        ),
    }
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=100,
        ext_actual=200,
        ci_ext_floor=201,  # Parity violation only; equality clean
        git_responses=responses,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_DRIFT
    stderr = capsys.readouterr().err
    assert "Inter-file parity violation" in stderr
    assert "Extension floor mismatch" in stderr
    assert "[ratchet-realignment]" in stderr
    assert "ignored for inter-file parity" in stderr


# ---------------------------------------------------------------------------
# T28 — [ratchet-test-removal] marker + inter-file parity drift → exit 1
#
# Symmetry lock: the two bypass markers behave identically on the parity
# axis. A future refactor that accidentally carves out a special case for
# one marker but not the other would break this test.
# ---------------------------------------------------------------------------


def test_t28_test_removal_marker_does_not_waive_parity(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    responses: dict[tuple[str, ...], _FakeCompleted] = {
        ("log", "--oneline", "origin/main..HEAD"): _FakeCompleted(
            returncode=0,
            stdout="cde3456 test: [ratchet-test-removal] retire legacy suite\n",
        ),
        ("rev-list", "--count", "origin/main..HEAD"): _FakeCompleted(
            returncode=0, stdout="1\n"
        ),
    }
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=100,
        ext_actual=200,
        ci_python_floor=99,  # Parity violation only; equality clean
        git_responses=responses,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_DRIFT, (
        "The test-removal marker must behave symmetrically with the "
        "realignment marker: neither waives inter-file parity."
    )
    stderr = capsys.readouterr().err
    assert "Inter-file parity violation" in stderr
    assert "[ratchet-test-removal]" in stderr
    assert "ignored for inter-file parity" in stderr


def test_t28a_both_markers_still_do_not_waive_parity(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    responses: dict[tuple[str, ...], _FakeCompleted] = {
        ("log", "--oneline", "origin/main..HEAD"): _FakeCompleted(
            returncode=0,
            stdout=(
                "abc1234 chore: [ratchet-realignment] move floors\n"
                "def5678 test: [ratchet-test-removal] retire legacy suite\n"
            ),
        ),
        ("rev-list", "--count", "origin/main..HEAD"): _FakeCompleted(
            returncode=0, stdout="2\n"
        ),
    }
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=100,
        ext_actual=200,
        ci_python_floor=99,
        git_responses=responses,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_DRIFT
    stderr = capsys.readouterr().err
    assert "Inter-file parity violation" in stderr
    assert "[ratchet-realignment]" in stderr
    assert "[ratchet-test-removal]" in stderr
    assert "ignored for inter-file parity" in stderr


# ---------------------------------------------------------------------------
# T29 — bypass marker present + malformed ci.yml → exit 2 (setup error)
#
# Regression lock for the "parse validation not exempted" half of the
# original short-circuit hole. If a realignment PR corrupts ci.yml — by
# deleting the jobs key, renaming a step, or otherwise breaking the YAML
# navigation the gate depends on — that must surface as a SETUP error
# regardless of the marker. Silently accepting an unparseable ci.yml
# would defeat the entire point of the gate, because subsequent CI
# runs on main would fail with no record of what changed.
# ---------------------------------------------------------------------------


def test_t29_marker_does_not_exempt_malformed_ci_yaml(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    preflight = _write_preflight(tmp_path, python_floor=100, ext_floor=200)
    # Malformed ci.yml — missing the `jobs` key entirely. T16 already
    # locks this as a function-level parse error; T29 locks the
    # end-to-end run_gate contract that a marker does NOT rescue it.
    ci_path = tmp_path / "ci.yml"
    ci_path.write_text(
        "name: CI\non: [push]\n# Missing 'jobs' section entirely\n",
        encoding="utf-8",
    )
    junit = _write_extension_junit(tmp_path, count=200)

    responses = _default_git_responses()
    responses[("log", "--oneline", "origin/main..HEAD")] = _FakeCompleted(
        returncode=0,
        stdout="def4567 chore: [ratchet-realignment] move floors\n",
    )
    recorder = _GitFakeRecorder(
        git_responses=responses,
        pytest_collected=100,
    )
    _install_recorder(monkeypatch, recorder)

    exit_code = gate.run_gate(
        preflight_path=preflight,
        ci_workflow_path=ci_path,
        junit_extension_path=junit,
        base_ref="origin/main",
    )
    assert exit_code == gate.EXIT_SETUP, (
        "A bypass marker must NOT exempt parse failures. An unparseable "
        "ci.yml in a realignment commit is still a setup error — the "
        "gate cannot produce a verdict when it cannot read the "
        "authoritative sources."
    )
    stderr = capsys.readouterr().err
    assert "[SETUP]" in stderr
    assert "missing or malformed 'jobs'" in stderr


# ---------------------------------------------------------------------------
# T30 — no marker + both parity and equality drift → exit 1 with both categories
#
# Regression lock for the DriftReport bucket split. Without this test a
# future refactor could collapse parity and equality back into a single
# list and silently lose one bucket; T30 ensures both categories appear
# in the reported stderr when both fail at once.
# ---------------------------------------------------------------------------


def test_t30_simultaneous_parity_and_equality_drift_reports_both(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=105,  # Python equality drift (+5)
        ext_actual=200,
        ci_python_floor=101,  # AND Python parity drift (preflight=100, ci=101)
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_DRIFT
    stderr = capsys.readouterr().err
    # Parity is reported even when equality also drifts — the gate
    # surfaces the first bucket (parity) with its own message set
    # because parity failure is unconditional and equality
    # exemption-eligible; they should not bleed together.
    assert "Inter-file parity violation" in stderr, (
        "Parity violation must be surfaced even when equality also "
        "drifts in the same run — the DriftReport split must keep "
        "both categories visible to the user."
    )
    assert "Python floor mismatch" in stderr
    # When parity fails, the gate exits immediately on parity — this
    # is deliberate: a broken parity configuration makes any equality
    # comparison meaningless, so the parity bucket wins priority.
    # The equality messages are NOT printed in that case; locking
    # that behavior here prevents a future refactor from accidentally
    # printing both buckets and confusing the user about which one
    # actually blocked the commit.
    assert "ratchet drift" not in stderr, (
        "When parity fails, the equality bucket must NOT be printed "
        "— parity wins priority because a broken parity configuration "
        "makes the equality comparison semantically meaningless. "
        f"Current stderr: {stderr!r}"
    )


# ---------------------------------------------------------------------------
# T31 — ensure_base_ref_reachable ALWAYS issues git fetch even on a clean repo
#
# Regression lock for the stale-local-origin/main hole: the old
# ensure_base_ref_reachable short-circuited when the ref was already present
# and the range was internally consistent, trusting a stale ref. That gave
# wrong verdicts locally when a [ratchet-realignment] or [ratchet-test-removal]
# commit had been merged to main upstream but the developer had not fetched
# — the merged marker would still live in the stale origin/main..HEAD range
# and silently exempt an unrelated PR. The fix removes the short-circuit;
# this test locks that the fetch is unconditional.
# ---------------------------------------------------------------------------


def test_t31_fetch_is_unconditional_even_on_clean_repo(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A fully aligned repo still issues one `git fetch` during the gate run."""
    exit_code, recorder = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=100,
        ext_actual=200,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_OK
    fetch_calls = [call for call in recorder.calls if call.args[:2] == ["git", "fetch"]]
    assert len(fetch_calls) >= 1, (
        "ensure_base_ref_reachable must issue a `git fetch` on every "
        "invocation, even when the base ref is already present and the "
        "rev-range is internally consistent. Locking this prevents a "
        "future refactor from re-introducing the stale-ref short-circuit "
        "that allowed merged bypass-marker commits to exempt unrelated "
        "PRs locally. Recorded calls: "
        f"{[call.args for call in recorder.calls]}"
    )
    # Positive: the fetch is for the exact refspec we care about, not
    # a generic `git fetch` (which would drag in everything and may
    # silently skip the ref if it wasn't already tracked).
    fetch_argv = fetch_calls[0].args
    assert "--no-tags" in fetch_argv, (
        "Refresh fetch must use --no-tags so release tag refs don't "
        f"come along for the ride. Got: {fetch_argv!r}"
    )
    refspec_tokens = [
        token
        for token in fetch_argv
        if token.startswith("+refs/heads/main:refs/remotes/origin/main")
    ]
    assert refspec_tokens, (
        "Refresh fetch must pass an explicit refspec that forces "
        "origin/main to track remotes/origin/main so the local ref is "
        f"guaranteed to advance. Got: {fetch_argv!r}"
    )


# ---------------------------------------------------------------------------
# T32 — fetch is sequenced strictly before the marker scan's git log
#
# The real invariant behind T31 is ordering: the fetch must happen BEFORE
# any git log --oneline origin/main..HEAD call that the marker scanner
# reads. If a future refactor moved the fetch to after the marker scan,
# the gate would silently reopen the stale-ref hole because the log
# would still be computed against the pre-fetch ref. This test locks
# the ordering explicitly by inspecting the recorder's call sequence.
# ---------------------------------------------------------------------------


def test_t32_fetch_is_sequenced_before_marker_scan_log(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`git fetch` must precede every `git log --oneline base..HEAD` call."""
    exit_code, recorder = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=100,
        ext_actual=200,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_OK

    fetch_index: int | None = None
    log_index: int | None = None
    for i, call in enumerate(recorder.calls):
        if fetch_index is None and call.args[:2] == ["git", "fetch"]:
            fetch_index = i
        if (
            log_index is None
            and call.args[:3] == ["git", "log", "--oneline"]
            and any(arg.endswith("..HEAD") or ".." in arg for arg in call.args[3:])
        ):
            log_index = i
        if fetch_index is not None and log_index is not None:
            break

    assert fetch_index is not None, (
        "Expected at least one `git fetch` call in the recorder; got none"
    )
    assert log_index is not None, (
        "Expected at least one `git log --oneline <range>` call; got none"
    )
    assert fetch_index < log_index, (
        "`git fetch` must be sequenced strictly before the first "
        "`git log --oneline base..HEAD` call. This ordering is the "
        "load-bearing invariant that closes the stale-ref hole: if "
        "the marker scanner's `git log` runs first, it reads a stale "
        "range and can honor a merged [ratchet-realignment] / "
        "[ratchet-test-removal] subject from an unrelated PR. "
        f"fetch_index={fetch_index}, log_index={log_index}, "
        f"calls={[call.args for call in recorder.calls]}"
    )


# ---------------------------------------------------------------------------
# T33 — fetch failure → EXIT_SETUP with explicit remediation
#
# The old short-circuit never even attempted a fetch on a clean repo, so
# a network outage was indistinguishable from success. After always-fetch,
# a failed fetch becomes a SETUP error with a loud actionable message
# pointing at the manual fix. T33 locks both the exit code and the
# remediation wording so a future refactor cannot silently swallow the
# failure.
# ---------------------------------------------------------------------------


def test_t33_fetch_failure_surfaces_as_setup_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A failed `git fetch origin <ref>` exits SETUP with remediation text."""
    preflight = _write_preflight(tmp_path, python_floor=100, ext_floor=200)
    ci = _write_ci_yaml(tmp_path, python_floor=100, ext_floor=200)
    junit = _write_extension_junit(tmp_path, 200)

    def responsive_run(
        args: list[str] | tuple[str, ...], **kwargs: object
    ) -> _FakeCompleted:
        normalized = list(args)
        if normalized[:2] == ["git", "fetch"]:
            return _FakeCompleted(
                returncode=128,
                stdout="",
                stderr="fatal: Could not read from remote repository.",
            )
        if normalized[:1] == ["git"]:
            # Every other git call succeeds — we are isolating the
            # fetch-failure path, not the shallow-recovery path.
            return _FakeCompleted(returncode=0, stdout="", stderr="")
        raise AssertionError(f"Unexpected run: {normalized!r}")

    monkeypatch.setattr(gate.subprocess, "run", responsive_run)
    monkeypatch.setattr(subprocess, "run", responsive_run)

    exit_code = gate.run_gate(
        preflight_path=preflight,
        ci_workflow_path=ci,
        junit_extension_path=junit,
        base_ref="origin/main",
    )
    assert exit_code == gate.EXIT_SETUP, (
        "A failed refresh fetch must exit SETUP (not DRIFT, not OK) so "
        "the gate is unambiguous about 'I could not produce a verdict' "
        "vs 'I produced a verdict and it's bad'."
    )
    stderr = capsys.readouterr().err
    assert "[SETUP]" in stderr
    assert "Failed to refresh base ref" in stderr
    assert "git fetch origin main" in stderr, (
        "Remediation text must name the exact command the user should "
        "run to fix this locally; bare 'run git fetch' is not actionable."
    )
    # Named the marker strings so a user who sees this error understands
    # why a stale ref is refused instead of just dismissing the failure
    # as a network blip.
    assert "ratchet-realignment" in stderr
    assert "ratchet-test-removal" in stderr


# ---------------------------------------------------------------------------
# T39-T48 — _normalize_base_ref() contract
#
# The gate's --base-ref CLI flag must be normalized to origin/<branch> up
# front, before ensure_base_ref_reachable / scan_bypass_marker /
# compute_drift_report ever see the value. The motivating hole:
# `--base-ref main` would fetch `origin/main` but then run
# `git rev-parse --verify main` and `git log main..HEAD`, which resolve
# against the LOCAL `main` branch — potentially stale or nonexistent.
# Normalizing up front pins every downstream call to the remote-tracking
# ref. T39-T48 lock both the pass-through and the rejection paths so a
# future refactor cannot silently reopen the bare-local-branch hole.
# ---------------------------------------------------------------------------


class TestNormalizeBaseRef:
    """Contract lock for ``_normalize_base_ref`` (issue #280 CLI hygiene)."""

    def test_t39_origin_main_passes_through_unchanged(self) -> None:
        assert gate._normalize_base_ref("origin/main") == "origin/main"

    def test_t40_bare_main_is_normalized_to_origin_main(self) -> None:
        assert gate._normalize_base_ref("main") == "origin/main"

    def test_t41_bare_release_branch_with_dots_and_hyphens_is_normalized(
        self,
    ) -> None:
        """Release branch names with non-alphanumeric chars work as-is."""
        assert gate._normalize_base_ref("release-101.7") == "origin/release-101.7"

    def test_t41b_nested_origin_branch_passes_through(self) -> None:
        """Nested branch names like origin/release/v1.7 are allowed.

        Git supports nested branch names and release-branch layouts
        that use slashes are a legitimate pattern. The normalizer
        treats anything after the ``origin/`` prefix as the full
        branch name, so ``origin/release/v1.7`` round-trips as-is.
        """
        assert gate._normalize_base_ref("origin/release/v1.7") == "origin/release/v1.7"

    def test_t42_bare_slash_name_is_normalized_to_origin_prefix(self) -> None:
        """A bare branch name containing a slash is normalized, not rejected.

        Regression lock for the "any slash means remote-qualified"
        bug in the initial normalizer. Git supports branch names
        with slashes (``release/v1.7``, ``feat/auth-refactor``) and
        the normalizer must accept them in their bare form. The
        rule is simple and symmetric with the ``origin/``-prefixed
        case: only the literal ``origin/`` prefix is treated as a
        remote qualifier. Everything else — slashes or no — is a
        bare branch name that gets normalized to ``origin/<name>``.

        The reviewer flagged that ``--base-ref release/v1.7`` was
        being parsed as ``remote=release, rest=v1.7`` and rejected
        with a confusing "must use the 'origin' remote" error,
        despite the docstring and CLI help advertising bare
        ``<branch>`` support. This test is the explicit fix lock.
        """
        assert gate._normalize_base_ref("release/v1.7") == "origin/release/v1.7", (
            "Bare branch names containing slashes (e.g., 'release/v1.7') "
            "must be normalized to 'origin/<name>' like any other bare "
            "name. Rejecting them would contradict the CLI contract "
            "that advertises bare branch support and would break "
            "release-branch workflows that use slash-delimited names."
        )
        # Second positive case: a nested feature-branch layout.
        assert (
            gate._normalize_base_ref("feat/auth-refactor")
            == "origin/feat/auth-refactor"
        )

    def test_t43_head_ref_is_rejected(self) -> None:
        """HEAD is a ref but not a branch; scanning HEAD..HEAD is nonsense."""
        for raw in ("HEAD", "@"):
            with pytest.raises(gate.RatchetSetupError) as exc_info:
                gate._normalize_base_ref(raw)
            assert "not a branch ref" in str(exc_info.value), (
                f"HEAD / @ rejection must say 'not a branch ref'; "
                f"got: {exc_info.value!s}"
            )

    def test_t44_full_ref_path_is_rejected(self) -> None:
        """refs/heads/... and refs/remotes/... are rejected up front."""
        for raw in (
            "refs/heads/main",
            "refs/remotes/origin/main",
            "refs/tags/v1.0",
        ):
            with pytest.raises(gate.RatchetSetupError) as exc_info:
                gate._normalize_base_ref(raw)
            message = str(exc_info.value)
            assert "full ref path" in message, (
                f"Full-ref-path rejection must name 'full ref path'; got: {message!r}"
            )
            assert raw in message, "Rejection must quote the offending input."

    def test_t45_empty_or_whitespace_is_rejected(self) -> None:
        for raw in ("", "   ", "\t", "\n"):
            with pytest.raises(gate.RatchetSetupError) as exc_info:
                gate._normalize_base_ref(raw)
            assert "empty" in str(exc_info.value), (
                f"Empty/whitespace rejection must say 'empty'; got: {exc_info.value!s}"
            )

    def test_t46_origin_without_branch_name_is_rejected(self) -> None:
        """'origin/' with no branch name after the slash is malformed."""
        with pytest.raises(gate.RatchetSetupError) as exc_info:
            gate._normalize_base_ref("origin/")
        message = str(exc_info.value)
        assert "missing a branch name" in message, (
            f"origin/ rejection must say 'missing a branch name'; got: {message!r}"
        )
        assert "origin/main" in message or "origin/release" in message, (
            "Rejection message must include a concrete example of a "
            "valid input so the user sees how to fix it."
        )

    def test_t47_main_normalizes_base_ref_before_run_gate(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """End-to-end lock: gate.main(['--base-ref', 'main', ...]) normalizes.

        This is the integration lock that proves the normalizer
        actually runs inside main() and its result is threaded through
        to run_gate. Without this test, a future refactor could add
        the helper, wire up the tests, and silently forget to call it
        from main() — the unit tests on _normalize_base_ref would pass
        while the real CLI still scanned the stale local branch.
        """
        recorded: dict[str, str] = {}

        def recording_run_gate(
            *,
            preflight_path: Path,
            ci_workflow_path: Path,
            junit_extension_path: Path,
            base_ref: str,
            marker_range: str | None = None,
        ) -> int:
            # Capture the base_ref value that main() actually hands
            # to run_gate. If normalization ran, this is "origin/main".
            # If normalization was skipped, this is "main" and the
            # assertion below fails with a clear message.
            recorded["base_ref"] = base_ref
            recorded["marker_range"] = "" if marker_range is None else marker_range
            return gate.EXIT_OK

        monkeypatch.setattr(gate, "run_gate", recording_run_gate)

        exit_code = gate.main(["--base-ref", "main"])
        assert exit_code == gate.EXIT_OK
        assert recorded.get("base_ref") == "origin/main", (
            "main() must normalize --base-ref before calling run_gate. "
            "A bare 'main' input to the CLI should become 'origin/main' "
            "on the run_gate call path. If this assertion fires, a "
            "refactor has broken the wiring between argparse and "
            f"run_gate. Got: base_ref={recorded.get('base_ref')!r}"
        )

    def test_t48_bare_sha_is_rejected_explicitly(self) -> None:
        """Bare SHA-like inputs are rejected with a SHA-specific message.

        The reviewer asked for explicit rejection rather than waiting
        for the fetch step to say 'remote ref not found'. This test
        locks both the rejection itself and the wording, so a future
        refactor cannot silently drop the explicit check (which would
        make the failure message misleading) or change the SHA regex
        in a way that accepts hex strings as bare branch names.
        """
        # 7-char short SHA
        with pytest.raises(gate.RatchetSetupError) as exc_info:
            gate._normalize_base_ref("abc1234")
        assert "SHA" in str(exc_info.value), (
            "Short SHA rejection must mention 'SHA' in the message "
            "so the user understands why a 7-char hex string was "
            f"refused; got: {exc_info.value!s}"
        )

        # 40-char full SHA
        with pytest.raises(gate.RatchetSetupError) as exc_info:
            gate._normalize_base_ref("abc1234def567890abc1234def567890abc12345")
        assert "SHA" in str(exc_info.value)

        # Mixed case hex (git accepts both)
        with pytest.raises(gate.RatchetSetupError) as exc_info:
            gate._normalize_base_ref("ABC1234")
        assert "SHA" in str(exc_info.value)

        # Rejection message must point at the escape hatch so a user
        # with a legitimately hex-named branch can still get past it.
        message = str(exc_info.value)
        assert "origin/" in message, (
            "SHA rejection must document the explicit 'origin/<name>' "
            "escape hatch, so a user with a legitimately hex-named "
            f"branch can bypass the bare-SHA check; got: {message!r}"
        )

    def test_t48b_non_sha_hex_adjacent_names_still_work(self) -> None:
        """Branch names that are 'mostly hex' but not entirely hex pass.

        Regression lock for the regex boundary: the SHA regex is
        ``^[0-9a-fA-F]{7,40}$`` — anchored on both ends. A branch
        named ``feat-abc123`` contains hex but is not entirely hex
        (because of the ``feat-`` prefix), so it must pass. Similarly
        ``123-feature`` mixes digits and letters outside the hex set.
        """
        assert gate._normalize_base_ref("feat-abc123") == "origin/feat-abc123"
        assert gate._normalize_base_ref("123-feature") == "origin/123-feature"
        # Six hex chars (below the 7-char SHA minimum) — branch, not SHA.
        assert gate._normalize_base_ref("abcdef") == "origin/abcdef"
        # 41 hex chars (above the 40-char SHA maximum) — also not a SHA.
        assert gate._normalize_base_ref("a" * 41) == f"origin/{'a' * 41}"


def test_t49_python_commit_accounting_uses_first_parent_snapshot_deltas(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    parent_root = tmp_path / "parent"
    commit_root = tmp_path / "commit"
    parent_root.mkdir()
    commit_root.mkdir()

    monkeypatch.setattr(
        gate,
        "list_first_parent_commits",
        lambda base_ref, *, marker_range=None: ("childsha",),
    )
    monkeypatch.setattr(gate, "commit_first_parent", lambda commit_sha: "parentsha")
    monkeypatch.setattr(gate, "commit_subject", lambda commit_sha: "feat: add tests")

    @contextmanager
    def fake_snapshot(commit_sha: str):
        yield parent_root if commit_sha == "parentsha" else commit_root

    monkeypatch.setattr(gate, "materialize_commit_snapshot", fake_snapshot)

    def fake_preflight(path: Path, *, repo_root: Path = gate.REPO_ROOT):
        if repo_root == parent_root:
            return gate.FloorReadings(python=100, extension=200)
        return gate.FloorReadings(python=102, extension=200)

    def fake_ci(path: Path, *, repo_root: Path = gate.REPO_ROOT):
        if repo_root == parent_root:
            return gate.FloorReadings(python=100, extension=200)
        return gate.FloorReadings(python=102, extension=200)

    def fake_python_count(*, repo_root: Path = gate.REPO_ROOT) -> int:
        return 100 if repo_root == parent_root else 102

    monkeypatch.setattr(gate, "read_preflight_floors", fake_preflight)
    monkeypatch.setattr(gate, "read_ci_floors", fake_ci)
    monkeypatch.setattr(gate, "measure_python_count", fake_python_count)

    failure = gate.evaluate_python_commit_accounting("origin/main")
    assert failure is None


def test_t50_python_commit_accounting_parent_authority_mismatch_is_not_waived(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    parent_root = tmp_path / "parent"
    commit_root = tmp_path / "commit"
    parent_root.mkdir()
    commit_root.mkdir()

    monkeypatch.setattr(
        gate,
        "list_first_parent_commits",
        lambda base_ref, *, marker_range=None: ("childsha",),
    )
    monkeypatch.setattr(gate, "commit_first_parent", lambda commit_sha: "parentsha")
    monkeypatch.setattr(
        gate,
        "commit_subject",
        lambda commit_sha: "feat: [ratchet-realignment] add tests",
    )

    @contextmanager
    def fake_snapshot(commit_sha: str):
        yield parent_root if commit_sha == "parentsha" else commit_root

    monkeypatch.setattr(gate, "materialize_commit_snapshot", fake_snapshot)

    def fake_preflight(path: Path, *, repo_root: Path = gate.REPO_ROOT):
        if repo_root == parent_root:
            return gate.FloorReadings(python=100, extension=200)
        return gate.FloorReadings(python=102, extension=200)

    def fake_ci(path: Path, *, repo_root: Path = gate.REPO_ROOT):
        if repo_root == parent_root:
            return gate.FloorReadings(python=101, extension=200)
        return gate.FloorReadings(python=102, extension=200)

    def fake_python_count(*, repo_root: Path = gate.REPO_ROOT) -> int:
        return 100 if repo_root == parent_root else 102

    monkeypatch.setattr(gate, "read_preflight_floors", fake_preflight)
    monkeypatch.setattr(gate, "read_ci_floors", fake_ci)
    monkeypatch.setattr(gate, "measure_python_count", fake_python_count)

    failure = gate.evaluate_python_commit_accounting("origin/main")
    assert failure is not None
    assert failure.suite == "python"
    assert failure.failure_class == "authority mismatch"
    assert "parent snapshot authority mismatch" in failure.detail
