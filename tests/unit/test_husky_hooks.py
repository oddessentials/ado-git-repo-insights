"""Regression tests for husky shell hooks' Python interpreter resolution.

Husky owns the choice of Python interpreter for the entire git-hook chain:
the user-edited scripts at ``.husky/pre-commit`` and ``.husky/pre-push``
prepend the project venv's bin directory to ``PATH`` (via the shared
``.husky/_python_path.sh`` helper) before invoking ``run_repo_hook.py``.
That deterministic ``PATH`` then propagates to every subprocess underneath,
including the ``language: system`` hooks declared in
``.pre-commit-config.yaml`` whose entries are bare ``python``.

If anyone shifts interpreter resolution into the YAML (e.g. ``python3``,
``.venv/bin/python``, ``py -3``), or into a per-hook shim, the cross-
platform parity contract this module locks is broken — the symptom is
the cryptic ``Executable 'python' not found`` regression that hit Linux
WSL workstations in 2026-05.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
HUSKY_DIR = REPO_ROOT / ".husky"
PYTHON_PATH_HELPER = HUSKY_DIR / "_python_path.sh"
PRE_COMMIT_HOOK = HUSKY_DIR / "pre-commit"
PRE_PUSH_HOOK = HUSKY_DIR / "pre-push"
PRE_COMMIT_CONFIG = REPO_ROOT / ".pre-commit-config.yaml"


class TestHuskyPythonPathHelper:
    """The shared ``.husky/_python_path.sh`` helper is the single source of
    truth for the project venv. It must be platform-aware and fail fast on a
    missing venv (rather than silently falling back to a system interpreter).
    """

    def test_helper_exists_and_is_a_shell_script(self) -> None:
        assert PYTHON_PATH_HELPER.exists(), (
            f"Helper missing at {PYTHON_PATH_HELPER.relative_to(REPO_ROOT)}"
        )

    def test_helper_handles_linux_macos_and_windows_shells(self) -> None:
        """Platform-aware case branches must cover Linux/Darwin/(MINGW|MSYS|CYGWIN).

        Linux/macOS map to ``.venv/bin``; Git Bash / MSYS / Cygwin map to
        ``.venv/Scripts``. We deliberately do NOT cross-fall-back, because a
        Windows-created ``.venv/Scripts`` could exist alongside a Linux repo
        clone and would otherwise route Linux hooks to a Windows-side
        interpreter.
        """
        text = PYTHON_PATH_HELPER.read_text(encoding="utf-8")
        assert "Linux" in text, "Helper case statement must handle Linux"
        assert "Darwin" in text, "Helper case statement must handle Darwin (macOS)"
        windows_shells = ("CYGWIN", "MINGW", "MSYS")
        assert any(s in text for s in windows_shells), (
            "Helper must handle at least one Windows shell environment"
            f" ({windows_shells})"
        )
        assert ".venv/bin" in text, (
            "Helper must reference the Linux/macOS venv layout (.venv/bin)"
        )
        assert ".venv/Scripts" in text, (
            "Helper must reference the Windows venv layout (.venv/Scripts)"
        )

    def test_helper_exports_venv_python_and_path(self) -> None:
        text = PYTHON_PATH_HELPER.read_text(encoding="utf-8")
        assert "VENV_PYTHON" in text, "Helper must export VENV_PYTHON"
        assert "PATH=" in text, "Helper must prepend PATH"
        assert "export" in text, "Helper must export its computed values"

    def test_helper_fails_with_actionable_setup_message_when_venv_missing(
        self, tmp_path: Path
    ) -> None:
        """Sourcing the helper from a directory without ``.venv`` must exit
        with the canonical ``uv sync --extra dev`` remediation, NOT silently
        fall back to a system interpreter.
        """
        helper_copy = tmp_path / "helper.sh"
        helper_copy.write_text(
            PYTHON_PATH_HELPER.read_text(encoding="utf-8"), encoding="utf-8"
        )
        result = subprocess.run(
            ["sh", "-c", f". {helper_copy}; echo SHOULD_NOT_REACH"],
            cwd=tmp_path,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 2, (
            f"Helper must exit 2 (setup failure) when venv missing; got {result.returncode}"
        )
        assert "SHOULD_NOT_REACH" not in result.stdout, (
            "Helper must terminate the calling shell, not fall through"
        )
        combined = result.stdout + result.stderr
        assert "Python venv not found" in combined, (
            "Helper must print a clear missing-venv message"
        )
        assert "uv sync --extra dev" in combined, (
            "Helper must point users to the canonical setup command"
        )

    def test_helper_resolves_correctly_with_synthetic_venv(
        self, tmp_path: Path
    ) -> None:
        """With a synthetic ``.venv`` stub planted in ``tmp_path``, sourcing
        the helper must export ``VENV_PYTHON`` and prepend the venv's bin
        dir to ``PATH``.

        Uses a temp fixture rather than reading the real repo's ``.venv``,
        so the assertion runs identically on local (where ``.venv``
        exists) AND on CI's ``test`` matrix (which uses
        ``actions/setup-python`` + ``pip install -e .[dev]`` and never
        creates ``.venv``). Both layouts are covered every run — the
        sibling ``test_helper_fails_with_actionable_setup_message_when_venv_missing``
        proves the negative path the same way (separate temp fixture,
        no ``.venv`` planted), so together the two tests assert both
        sides of the contract on every host without depending on
        environment state.
        """
        # Plant a stub interpreter the helper's `[ -x ... ]` check accepts.
        # The helper does not exec it; it only needs the path to be a
        # regular executable file to pass the existence guard.
        is_windows_shell = sys.platform == "win32"
        if is_windows_shell:
            venv_bin_rel = ".venv/Scripts"
            python_name = "python.exe"
        else:
            venv_bin_rel = ".venv/bin"
            python_name = "python"
        venv_bin = tmp_path / venv_bin_rel
        venv_bin.mkdir(parents=True)
        stub = venv_bin / python_name
        stub.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        stub.chmod(0o755)

        # Mirror the helper into the temp tree so its `./.husky/...` path
        # resolves relative to the cwd we'll set below.
        husky_dir = tmp_path / ".husky"
        husky_dir.mkdir()
        helper_copy = husky_dir / "_python_path.sh"
        helper_copy.write_text(
            PYTHON_PATH_HELPER.read_text(encoding="utf-8"), encoding="utf-8"
        )

        result = subprocess.run(
            [
                "sh",
                "-c",
                ". ./.husky/_python_path.sh"
                ' && echo "VENV_PYTHON=$VENV_PYTHON"'
                ' && echo "PATH_HEAD=$(echo $PATH | cut -d: -f1)"',
            ],
            cwd=tmp_path,
            capture_output=True,
            text=True,
            check=False,
            env={**os.environ},
        )
        assert result.returncode == 0, (
            f"Helper must succeed with synthetic venv; got rc={result.returncode}\n"
            f"stdout={result.stdout!r}\nstderr={result.stderr!r}"
        )
        expected_python = f"{venv_bin_rel}/{python_name}"
        assert f"VENV_PYTHON={expected_python}" in result.stdout, (
            f"Helper must export VENV_PYTHON pointing at the planted stub;"
            f" stdout={result.stdout!r}"
        )
        assert f"PATH_HEAD={venv_bin_rel}" in result.stdout, (
            f"Helper must prepend the venv bin dir to PATH; stdout={result.stdout!r}"
        )


class TestHuskyHooksDelegateInterpreterResolutionToHelper:
    """``.husky/pre-commit`` and ``.husky/pre-push`` must source the helper
    BEFORE invoking ``run_repo_hook.py``, so the deterministic interpreter
    PATH propagates to every subprocess pre-commit spawns underneath
    (including ``language: system`` hooks declared in
    ``.pre-commit-config.yaml`` whose entries are bare ``python``).
    """

    @pytest.mark.parametrize(
        "hook_path", [PRE_COMMIT_HOOK, PRE_PUSH_HOOK], ids=["pre-commit", "pre-push"]
    )
    def test_hook_sources_helper_before_invoking_orchestrator(
        self, hook_path: Path
    ) -> None:
        text = hook_path.read_text(encoding="utf-8")
        lines = text.splitlines()
        source_idx = next(
            (
                i
                for i, line in enumerate(lines)
                if "_python_path.sh" in line
                and (line.lstrip().startswith(".") or "source " in line)
            ),
            None,
        )
        exec_idx = next(
            (i for i, line in enumerate(lines) if "run_repo_hook.py" in line),
            None,
        )
        assert source_idx is not None, (
            f"{hook_path.name} must source .husky/_python_path.sh"
        )
        assert exec_idx is not None, (
            f"{hook_path.name} must invoke scripts/run_repo_hook.py"
        )
        assert source_idx < exec_idx, (
            f"{hook_path.name}: helper must be sourced BEFORE run_repo_hook.py;"
            f" got source@{source_idx}, exec@{exec_idx}"
        )

    @pytest.mark.parametrize(
        "hook_path", [PRE_COMMIT_HOOK, PRE_PUSH_HOOK], ids=["pre-commit", "pre-push"]
    )
    def test_hook_invokes_orchestrator_through_venv_python(
        self, hook_path: Path
    ) -> None:
        """The exec line must use ``$VENV_PYTHON`` (set by the helper), not a
        bare ``python``/``python3``/``py``. Otherwise the orchestrator
        process itself could land on a non-canonical interpreter even though
        ``language: system`` subprocesses are PATH-correct.
        """
        text = hook_path.read_text(encoding="utf-8")
        exec_lines = [line for line in text.splitlines() if "run_repo_hook.py" in line]
        assert exec_lines, f"{hook_path.name}: no run_repo_hook.py invocation found"
        for line in exec_lines:
            assert "$VENV_PYTHON" in line or "${VENV_PYTHON}" in line, (
                f"{hook_path.name}: orchestrator must be invoked via $VENV_PYTHON;"
                f" got: {line!r}"
            )


class TestPreCommitConfigDelegatesPythonResolutionToHusky:
    """Python-backed ``language: system`` entries in
    ``.pre-commit-config.yaml`` must NOT pin a specific interpreter
    (``python3``, ``.venv/bin/python``, ``.venv/Scripts/python.exe``, ``py -3``).

    The contract is "Husky owns interpreter resolution": embedding any of
    those into the YAML re-introduces the platform skew the helper exists
    to eliminate. This test does NOT require entries to literally start
    with the word ``python`` (that would be too rigid for future hooks);
    it only forbids the known footguns.
    """

    FORBIDDEN_TOKENS = (
        # Pinned interpreter names — defeat the helper's PATH override
        re.compile(r"^\s*entry:\s*python3(\s|$)", re.MULTILINE),
        re.compile(r"^\s*entry:\s*py\s+-3(\s|$)", re.MULTILINE),
        # Hard-coded venv paths — break Windows/Linux symmetry
        re.compile(r"^\s*entry:\s*\.venv/bin/python", re.MULTILINE),
        re.compile(r"^\s*entry:\s*\.venv/Scripts/python", re.MULTILINE),
        re.compile(r"^\s*entry:\s*\.venv\\Scripts\\python", re.MULTILINE),
    )

    def test_pre_commit_config_does_not_pin_interpreter(self) -> None:
        text = PRE_COMMIT_CONFIG.read_text(encoding="utf-8")
        offenders: list[str] = []
        for pattern in self.FORBIDDEN_TOKENS:
            match = pattern.search(text)
            if match:
                offenders.append(match.group(0).strip())
        assert not offenders, (
            "Python interpreter resolution belongs in .husky/_python_path.sh,"
            " not in .pre-commit-config.yaml entries. Found pinned"
            f" interpreter(s): {offenders!r}"
        )
