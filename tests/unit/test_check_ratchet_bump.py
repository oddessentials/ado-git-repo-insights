"""Unit tests for scripts/check_ratchet_bump.py (issue #280).

These tests lock the behavior of every branch the plan v4 calls out:
core drift/parity/marker paths (T1-T10), the v3 hardenings (T11-T13),
and the v4 hardenings that turned v3 gaps into explicit asserts
(T14-T18). All pytest/jest invocations are mocked via ``monkeypatch``
so the gate's logic is verified without running real collection.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_GATE_PATH = REPO_ROOT / "scripts" / "check_ratchet_bump.py"
_YAML_PARSER_PATH = REPO_ROOT / "scripts" / "_ci_yaml_parser.py"


def _load_script_module(module_name: str, script_path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(module_name, script_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    # The gate does `from _ci_yaml_parser import ...` which will fail under
    # test import unless _ci_yaml_parser is pre-registered as a top-level
    # module. Register it eagerly so either import order works.
    if "_ci_yaml_parser" not in sys.modules:
        yaml_spec = importlib.util.spec_from_file_location(
            "_ci_yaml_parser", _YAML_PARSER_PATH
        )
        assert yaml_spec is not None
        assert yaml_spec.loader is not None
        yaml_module = importlib.util.module_from_spec(yaml_spec)
        sys.modules["_ci_yaml_parser"] = yaml_module
        yaml_spec.loader.exec_module(yaml_module)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


gate = _load_script_module("check_ratchet_bump", _GATE_PATH)
yaml_parser = sys.modules["_ci_yaml_parser"]


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
    ) -> None:
        self.git_responses: dict[tuple[str, ...], _FakeCompleted] = git_responses or {}
        self.pytest_collected = pytest_collected
        self.pytest_rc = pytest_rc
        self.pytest_stderr = pytest_stderr
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
            if env_dict is not None:
                output_path = env_dict.get("RATCHET_COUNT_OUTPUT")
            if output_path and self.pytest_collected is not None:
                Path(output_path).write_text(
                    f"{self.pytest_collected}\n", encoding="utf-8"
                )
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


def _default_git_responses() -> dict[tuple[str, ...], _FakeCompleted]:
    """Return git responses that make ensure_base_ref_reachable pass."""
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
        ("log", "--format=%s%n%b", "origin/main..HEAD"): _FakeCompleted(
            returncode=0, stdout="feat: stub\n\n"
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
    git_responses: dict[tuple[str, ...], _FakeCompleted] | None = None,
    pytest_rc: int = 0,
    pytest_stderr: str = "",
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
    )
    _install_recorder(monkeypatch, recorder)

    exit_code = gate.run_gate(
        preflight_path=preflight,
        ci_workflow_path=ci,
        junit_extension_path=junit,
        base_ref="origin/main",
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
        ("log", "--format=%s%n%b", "origin/main..HEAD"): _FakeCompleted(
            returncode=0,
            stdout="chore: catch up on accumulated drift\n\n[ratchet-realignment]\n",
        ),
    }
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=150,  # Huge drift that would normally fail
        ext_actual=200,
        git_responses=responses,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_OK
    out = capsys.readouterr().out
    assert "[ratchet-realignment]" in out
    assert "exempted" in out


# ---------------------------------------------------------------------------
# T6 — [ratchet-test-removal] marker → exit 0
# ---------------------------------------------------------------------------


def test_t6_test_removal_marker_exempts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    responses: dict[tuple[str, ...], _FakeCompleted] = {
        ("log", "--format=%s%n%b", "origin/main..HEAD"): _FakeCompleted(
            returncode=0,
            stdout="test: retire legacy suite\n\n[ratchet-test-removal]\n",
        ),
    }
    exit_code, _ = _run_gate(
        tmp_path,
        python_floor=100,
        ext_floor=200,
        python_actual=85,  # Intentional reduction below floor
        ext_actual=200,
        git_responses=responses,
        monkeypatch=monkeypatch,
    )
    assert exit_code == gate.EXIT_OK
    assert "[ratchet-test-removal]" in capsys.readouterr().out


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
    assert "no --min-collected=N token" in stderr


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
    preflight = _write_preflight(tmp_path, python_floor=100, ext_floor=200)
    ci = _write_ci_yaml(tmp_path, python_floor=100, ext_floor=200)
    junit = _write_extension_junit(tmp_path, 200)

    # Pretend the repo is shallow by creating a marker file.
    shallow_marker = tmp_path / ".git" / "shallow"
    shallow_marker.parent.mkdir(parents=True, exist_ok=True)
    shallow_marker.write_text("", encoding="utf-8")
    monkeypatch.setattr(gate, "REPO_ROOT", tmp_path)

    # Initial rev-parse fails (shallow), log returns empty, rev-list too.
    # After fetch --unshallow, every git check starts succeeding.
    call_counter = {"rev_parse": 0, "log_oneline": 0, "rev_list": 0}

    def responsive_run(
        args: list[str] | tuple[str, ...], **kwargs: object
    ) -> _FakeCompleted:
        normalized = list(args)
        if normalized[:1] == ["git"]:
            rest = normalized[1:]
            if rest[:3] == ["rev-parse", "--verify", "origin/main^{commit}"]:
                call_counter["rev_parse"] += 1
                if call_counter["rev_parse"] == 1:
                    return _FakeCompleted(returncode=1, stdout="", stderr="unknown")
                return _FakeCompleted(returncode=0, stdout="deadbeef\n")
            if rest[:3] == ["log", "--oneline", "origin/main..HEAD"]:
                call_counter["log_oneline"] += 1
                return _FakeCompleted(returncode=0, stdout="abc feat\n")
            if rest[:3] == ["rev-list", "--count", "origin/main..HEAD"]:
                call_counter["rev_list"] += 1
                return _FakeCompleted(returncode=0, stdout="1\n")
            if rest[:2] == ["log", "--format=%s%n%b"]:
                return _FakeCompleted(returncode=0, stdout="feat: noop\n")
            if rest[:2] == ["fetch", "--no-tags"]:
                return _FakeCompleted(returncode=0, stdout="", stderr="")
            return _FakeCompleted(returncode=0)
        if _is_pytest_collect(normalized):
            env_obj = kwargs.get("env")
            if isinstance(env_obj, dict):
                out = env_obj.get("RATCHET_COUNT_OUTPUT")
                if isinstance(out, str):
                    Path(out).write_text("100\n", encoding="utf-8")
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
    assert call_counter["rev_parse"] >= 2, (
        "rev-parse should be called twice: once before the unshallow fetch "
        "(fails) and once after (succeeds)"
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
    assert "Failed to fetch full history" in stderr
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
