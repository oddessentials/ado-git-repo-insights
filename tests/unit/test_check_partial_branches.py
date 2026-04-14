"""Unit coverage for ``scripts/check_partial_branches.py``.

Exercises the lcov BRDA parser, the baseline comparator, and all three
failure categories (``COVERAGE_REGRESSION``, ``BASELINE_COCHANGE_REQUIRED``,
``SETUP``) against in-memory fixtures so the gate's semantics are locked.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
GATE_SCRIPT = REPO_ROOT / "scripts" / "check_partial_branches.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_partial_branches", GATE_SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["check_partial_branches"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def gate():
    return _load_gate_module()


def _write_lcov(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "lcov.info"
    path.write_text(body, encoding="utf-8")
    return path


def _write_baseline(tmp_path: Path, files: dict[str, int]) -> Path:
    payload = {
        "schema_version": 1,
        "generated_from": "fixture",
        "files": files,
    }
    path = tmp_path / "baseline.json"
    path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    return path


class TestParseLcovPartialBranches:
    def test_line_with_mixed_branches_is_counted(self, gate, tmp_path: Path) -> None:
        """A line with one taken branch and one missed branch is partial."""
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/metrics.ts\nBRDA:10,0,0,1\nBRDA:10,0,1,0\nend_of_record\n",
        )
        counts = gate.parse_lcov_partial_branches(lcov)
        assert counts == {"extension/ui/modules/metrics.ts": 1}

    def test_line_with_all_branches_taken_is_not_partial(
        self, gate, tmp_path: Path
    ) -> None:
        """If every BRDA at a line has taken > 0, the line is fully covered."""
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/metrics.ts\nBRDA:10,0,0,3\nBRDA:10,0,1,2\nend_of_record\n",
        )
        assert gate.parse_lcov_partial_branches(lcov) == {}

    def test_line_with_all_branches_missed_is_not_partial(
        self, gate, tmp_path: Path
    ) -> None:
        """If every BRDA at a line has taken == 0, the line is uncovered,
        not partial (matches Codecov's definition)."""
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/metrics.ts\nBRDA:10,0,0,0\nBRDA:10,0,1,0\nend_of_record\n",
        )
        assert gate.parse_lcov_partial_branches(lcov) == {}

    def test_unreached_branch_points_are_ignored(self, gate, tmp_path: Path) -> None:
        """BRDA records with ``taken == '-'`` (unreached block) do not
        contribute to the partial or taken count."""
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/metrics.ts\nBRDA:10,0,0,-\nBRDA:10,0,1,-\nend_of_record\n",
        )
        assert gate.parse_lcov_partial_branches(lcov) == {}

    def test_windows_backslash_paths_are_normalized(self, gate, tmp_path: Path) -> None:
        """Windows-generated lcov uses backslashes; parser normalizes to
        forward slashes and roots at ``extension/``."""
        lcov = _write_lcov(
            tmp_path,
            "SF:ui\\modules\\metrics.ts\nBRDA:10,0,0,1\nBRDA:10,0,1,0\nend_of_record\n",
        )
        counts = gate.parse_lcov_partial_branches(lcov)
        assert counts == {"extension/ui/modules/metrics.ts": 1}

    def test_multiple_files_tracked_independently(self, gate, tmp_path: Path) -> None:
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/metrics.ts\n"
            "BRDA:10,0,0,1\n"
            "BRDA:10,0,1,0\n"
            "end_of_record\n"
            "SF:ui/modules/sdk.ts\n"
            "BRDA:20,0,0,1\n"
            "BRDA:20,0,1,0\n"
            "BRDA:30,0,0,1\n"
            "BRDA:30,0,1,0\n"
            "end_of_record\n",
        )
        counts = gate.parse_lcov_partial_branches(lcov)
        assert counts == {
            "extension/ui/modules/metrics.ts": 1,
            "extension/ui/modules/sdk.ts": 2,
        }

    def test_missing_lcov_raises(self, gate, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            gate.parse_lcov_partial_branches(tmp_path / "does-not-exist.info")


class TestLoadBaseline:
    def test_valid_baseline_round_trips(self, gate, tmp_path: Path) -> None:
        path = _write_baseline(tmp_path, {"extension/ui/a.ts": 2})
        loaded = gate.load_baseline(path)
        assert loaded["schema_version"] == 1
        assert loaded["files"] == {"extension/ui/a.ts": 2}

    def test_wrong_schema_version_rejected(self, gate, tmp_path: Path) -> None:
        path = tmp_path / "baseline.json"
        path.write_text(
            json.dumps({"schema_version": 2, "generated_from": "x", "files": {}}),
            encoding="utf-8",
        )
        with pytest.raises(ValueError, match="schema version mismatch"):
            gate.load_baseline(path)

    def test_missing_generated_from_rejected(self, gate, tmp_path: Path) -> None:
        path = tmp_path / "baseline.json"
        path.write_text(
            json.dumps({"schema_version": 1, "files": {}}), encoding="utf-8"
        )
        with pytest.raises(ValueError, match="generated_from"):
            gate.load_baseline(path)

    def test_negative_count_rejected(self, gate, tmp_path: Path) -> None:
        path = tmp_path / "baseline.json"
        path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "generated_from": "x",
                    "files": {"extension/ui/a.ts": -1},
                }
            ),
            encoding="utf-8",
        )
        with pytest.raises(ValueError, match="non-negative"):
            gate.load_baseline(path)


class TestCompare:
    def test_no_drift_is_clean(self, gate) -> None:
        baseline = gate.BaselineFile(
            schema_version=1,
            generated_from="x",
            files={"extension/ui/a.ts": 3},
        )
        regressions, improvements, removed = gate.compare(
            {"extension/ui/a.ts": 3}, baseline
        )
        assert regressions == []
        assert improvements == []
        assert removed == []

    def test_observed_above_baseline_is_regression(self, gate) -> None:
        baseline = gate.BaselineFile(
            schema_version=1,
            generated_from="x",
            files={"extension/ui/a.ts": 3},
        )
        regressions, improvements, removed = gate.compare(
            {"extension/ui/a.ts": 5}, baseline
        )
        assert len(regressions) == 1
        assert "+2" in regressions[0]
        assert improvements == []
        assert removed == []

    def test_new_file_defaults_to_zero_allowed(self, gate) -> None:
        """A file not present in the baseline is treated as having a zero
        allowance, so ANY partial branches in a new file is a regression."""
        baseline = gate.BaselineFile(
            schema_version=1,
            generated_from="x",
            files={},
        )
        regressions, improvements, removed = gate.compare(
            {"extension/ui/new.ts": 1}, baseline
        )
        assert len(regressions) == 1
        assert "extension/ui/new.ts" in regressions[0]

    def test_observed_below_baseline_is_cochange(self, gate) -> None:
        baseline = gate.BaselineFile(
            schema_version=1,
            generated_from="x",
            files={"extension/ui/a.ts": 5},
        )
        regressions, improvements, removed = gate.compare(
            {"extension/ui/a.ts": 2}, baseline
        )
        assert regressions == []
        assert len(improvements) == 1
        assert "-3" in improvements[0]
        assert removed == []

    def test_baseline_file_missing_from_lcov_is_cochange(self, gate) -> None:
        baseline = gate.BaselineFile(
            schema_version=1,
            generated_from="x",
            files={"extension/ui/gone.ts": 4},
        )
        regressions, improvements, removed = gate.compare({}, baseline)
        assert regressions == []
        assert improvements == []
        assert len(removed) == 1
        assert "extension/ui/gone.ts" in removed[0]


class TestMainCli:
    def test_clean_state_exits_zero(
        self, gate, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/a.ts\nBRDA:1,0,0,1\nBRDA:1,0,1,0\nend_of_record\n",
        )
        baseline = _write_baseline(tmp_path, {"extension/ui/modules/a.ts": 1})
        monkeypatch.setattr(
            sys, "argv", ["check", "--lcov", str(lcov), "--baseline", str(baseline)]
        )
        assert gate.main() == 0

    def test_regression_exits_nonzero(
        self, gate, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/a.ts\n"
            "BRDA:1,0,0,1\n"
            "BRDA:1,0,1,0\n"
            "BRDA:2,0,0,1\n"
            "BRDA:2,0,1,0\n"
            "end_of_record\n",
        )
        baseline = _write_baseline(tmp_path, {"extension/ui/modules/a.ts": 1})
        monkeypatch.setattr(
            sys, "argv", ["check", "--lcov", str(lcov), "--baseline", str(baseline)]
        )
        assert gate.main() == 1

    def test_cochange_exits_nonzero(
        self,
        gate,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/a.ts\nBRDA:1,0,0,1\nBRDA:1,0,1,0\nend_of_record\n",
        )
        baseline = _write_baseline(tmp_path, {"extension/ui/modules/a.ts": 5})
        monkeypatch.setattr(
            sys, "argv", ["check", "--lcov", str(lcov), "--baseline", str(baseline)]
        )
        assert gate.main() == 1
        captured = capsys.readouterr()
        assert "BASELINE_COCHANGE_REQUIRED" in captured.err
        assert '"extension/ui/modules/a.ts": 1' in captured.err

    def test_missing_lcov_exits_setup_error(
        self,
        gate,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        baseline = _write_baseline(tmp_path, {})
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "check",
                "--lcov",
                str(tmp_path / "missing.info"),
                "--baseline",
                str(baseline),
            ],
        )
        assert gate.main() == 1
        captured = capsys.readouterr()
        assert "SETUP" in captured.err
