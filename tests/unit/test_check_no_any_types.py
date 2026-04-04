"""Tests for scripts/check_no_any_types.py."""

from __future__ import annotations

import importlib.util
import json
import shutil
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "check_no_any_types.py"
SPEC = importlib.util.spec_from_file_location("check_no_any_types", SCRIPT_PATH)
assert SPEC is not None
assert SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules["check_no_any_types"] = MODULE
SPEC.loader.exec_module(MODULE)


class TestCheckNoAnyTypes:
    TMP_ROOT = Path(__file__).resolve().parents[2] / "tmp_test_work" / "check-no-any"

    def _fresh_case_dir(self, name: str) -> Path:
        case_dir = self.TMP_ROOT / name
        shutil.rmtree(case_dir, ignore_errors=True)
        (case_dir / "src").mkdir(parents=True, exist_ok=True)
        (case_dir / "tests").mkdir(parents=True, exist_ok=True)
        (case_dir / "scripts").mkdir(parents=True, exist_ok=True)
        return case_dir

    def test_parse_error_fails_closed(self, capsys: pytest.CaptureFixture[str]) -> None:
        case_dir = self._fresh_case_dir("parse-error")
        baseline_path = case_dir / ".any-type-baseline.json"
        baseline_path.write_text(
            json.dumps({"total": 0, "files": {"src/existing.py": 0}}, indent=2) + "\n",
            encoding="utf-8",
        )
        broken_file = case_dir / "src" / "broken_any.py"
        broken_file.write_text(
            "from typing import Any\ndef bad() -> Any:\n    x = 1\n  y = 2\n",
            encoding="utf-8",
        )

        with (
            patch.object(MODULE, "REPO_ROOT", case_dir),
            patch.object(MODULE, "SRC_DIR", case_dir / "src"),
            patch.object(MODULE, "TESTS_DIR", case_dir / "tests"),
            patch.object(MODULE, "SCRIPTS_DIR", case_dir / "scripts"),
            patch.object(MODULE, "BASELINE_PATH", baseline_path),
            patch.object(sys, "argv", ["check_no_any_types.py"]),
        ):
            assert MODULE.main() == 1

        out = capsys.readouterr().out
        assert "Could not parse Python file(s):" in out
        assert "src/broken_any.py" in out

    def test_diff_mode_passes_when_no_staged_src_python(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        with (
            patch.object(MODULE, "staged_src_py_files", return_value=[]),
            patch.object(sys, "argv", ["check_no_any_types.py", "--diff"]),
        ):
            assert MODULE.main() == 0

        out = capsys.readouterr().out
        assert "No staged Python files under src/, tests/, or scripts/" in out

    def test_diff_mode_checks_only_staged_files(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        case_dir = self._fresh_case_dir("diff-mode")
        baseline_path = case_dir / ".any-type-baseline.json"
        baseline_path.write_text(
            json.dumps({"total": 0, "files": {"src/existing.py": 0}}, indent=2) + "\n",
            encoding="utf-8",
        )
        staged_file = case_dir / "src" / "new_any.py"
        staged_file.write_text(
            "from typing import Any\nvalue: Any = 1\n",
            encoding="utf-8",
        )
        unstaged_file = case_dir / "src" / "ignored_any.py"
        unstaged_file.write_text(
            "from typing import Any\nother: Any = 2\n",
            encoding="utf-8",
        )

        with (
            patch.object(MODULE, "REPO_ROOT", case_dir),
            patch.object(MODULE, "SRC_DIR", case_dir / "src"),
            patch.object(MODULE, "BASELINE_PATH", baseline_path),
            patch.object(
                MODULE, "staged_src_py_files", return_value=["src/new_any.py"]
            ),
            patch.object(
                MODULE,
                "staged_file_bytes",
                return_value=b"from typing import Any\nvalue: Any = 1\n",
            ),
            patch.object(sys, "argv", ["check_no_any_types.py", "--diff"]),
        ):
            assert MODULE.main() == 1

        out = capsys.readouterr().out
        assert "src/new_any.py" in out
        assert "src/ignored_any.py" not in out

    def test_diff_mode_reads_staged_blob_not_worktree(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        case_dir = self._fresh_case_dir("diff-staged-blob")
        baseline_path = case_dir / ".any-type-baseline.json"
        baseline_path.write_text(
            json.dumps({"total": 0, "files": {"src/example.py": 0}}, indent=2) + "\n",
            encoding="utf-8",
        )
        worktree_file = case_dir / "src" / "example.py"
        worktree_file.write_text("value = 1\n", encoding="utf-8")

        with (
            patch.object(MODULE, "REPO_ROOT", case_dir),
            patch.object(MODULE, "SRC_DIR", case_dir / "src"),
            patch.object(MODULE, "BASELINE_PATH", baseline_path),
            patch.object(
                MODULE, "staged_src_py_files", return_value=["src/example.py"]
            ),
            patch.object(
                MODULE,
                "staged_file_bytes",
                return_value=b"from typing import Any\nvalue: Any = 1\n",
            ),
            patch.object(sys, "argv", ["check_no_any_types.py", "--diff"]),
        ):
            assert MODULE.main() == 1

        out = capsys.readouterr().out
        assert "src/example.py" in out

    def test_diff_and_update_baseline_is_rejected(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        with patch.object(
            sys,
            "argv",
            ["check_no_any_types.py", "--diff", "--update-baseline"],
        ):
            assert MODULE.main() == 1

        out = capsys.readouterr().out
        assert "--diff and --update-baseline cannot be used together" in out

    def test_diff_mode_success_message_does_not_claim_global_decrease(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        case_dir = self._fresh_case_dir("diff-pass")
        baseline_path = case_dir / ".any-type-baseline.json"
        baseline_path.write_text(
            json.dumps({"total": 5, "files": {"src/existing.py": 5}}, indent=2) + "\n",
            encoding="utf-8",
        )
        clean_file = case_dir / "src" / "clean.py"
        clean_file.write_text("value = 1\n", encoding="utf-8")

        with (
            patch.object(MODULE, "REPO_ROOT", case_dir),
            patch.object(MODULE, "SRC_DIR", case_dir / "src"),
            patch.object(MODULE, "BASELINE_PATH", baseline_path),
            patch.object(MODULE, "staged_src_py_files", return_value=["src/clean.py"]),
            patch.object(MODULE, "staged_file_bytes", return_value=b"value = 1\n"),
            patch.object(sys, "argv", ["check_no_any_types.py", "--diff"]),
        ):
            assert MODULE.main() == 0

        out = capsys.readouterr().out
        assert "No staged typing.Any increases" in out
        assert "Run --update-baseline to ratchet down" not in out

    def test_scripts_dir_any_detected(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Any-containing file under scripts/ is detected by the scanner."""
        case_dir = self._fresh_case_dir("scripts-any")
        baseline_path = case_dir / ".any-type-baseline.json"
        baseline_path.write_text(
            json.dumps({"total": 0, "files": {}}, indent=2) + "\n",
            encoding="utf-8",
        )
        any_file = case_dir / "scripts" / "bad_script.py"
        any_file.write_text(
            "from typing import Any\nvalue: Any = 1\n",
            encoding="utf-8",
        )

        with (
            patch.object(MODULE, "REPO_ROOT", case_dir),
            patch.object(MODULE, "SRC_DIR", case_dir / "src"),
            patch.object(MODULE, "TESTS_DIR", case_dir / "tests"),
            patch.object(MODULE, "SCRIPTS_DIR", case_dir / "scripts"),
            patch.object(MODULE, "BASELINE_PATH", baseline_path),
            patch.object(sys, "argv", ["check_no_any_types.py"]),
        ):
            assert MODULE.main() == 1

        out = capsys.readouterr().out
        assert "scripts/bad_script.py" in out

    def test_diff_mode_detects_staged_scripts_file(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Staged scripts/ file with Any is detected in --diff mode."""
        case_dir = self._fresh_case_dir("diff-scripts")
        baseline_path = case_dir / ".any-type-baseline.json"
        baseline_path.write_text(
            json.dumps({"total": 0, "files": {}}, indent=2) + "\n",
            encoding="utf-8",
        )

        with (
            patch.object(MODULE, "REPO_ROOT", case_dir),
            patch.object(MODULE, "SRC_DIR", case_dir / "src"),
            patch.object(MODULE, "BASELINE_PATH", baseline_path),
            patch.object(
                MODULE,
                "staged_src_py_files",
                return_value=["scripts/new_script.py"],
            ),
            patch.object(
                MODULE,
                "staged_file_bytes",
                return_value=b"from typing import Any\nvalue: Any = 1\n",
            ),
            patch.object(sys, "argv", ["check_no_any_types.py", "--diff"]),
        ):
            assert MODULE.main() == 1

        out = capsys.readouterr().out
        assert "scripts/new_script.py" in out
