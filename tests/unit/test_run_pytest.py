"""Regression tests for the documented local pytest launcher."""

from __future__ import annotations

import importlib.util
import os
import sys
import time
from pathlib import Path
from unittest.mock import patch

_script_path = Path(__file__).resolve().parents[2] / "scripts" / "run_pytest.py"
_spec = importlib.util.spec_from_file_location("run_pytest", _script_path)
assert _spec is not None
assert _spec.loader is not None
_module = importlib.util.module_from_spec(_spec)
sys.modules["run_pytest"] = _module
_spec.loader.exec_module(_module)


class TestRunPytestLauncher:
    def test_full_suite_keeps_coverage_floor(self) -> None:
        with (
            patch.object(sys, "argv", ["run_pytest.py"]),
            patch.dict(os.environ, {}, clear=True),
            patch("pytest.main", return_value=0) as pytest_main,
        ):
            assert _module.main() == 0
            assert os.environ["COVERAGE_NO_CLEANUP"] == "1"
            assert os.environ["COVERAGE_FILE"].endswith(".coverage")
            assert ".tmp" in os.environ["COVERAGE_FILE"]
            assert "runs" in os.environ["COVERAGE_FILE"]

        args = pytest_main.call_args.args[0]
        assert "--basetemp" not in args
        assert "--cov-fail-under=0" not in args
        assert len(pytest_main.call_args.kwargs["plugins"]) == 1

    def test_subset_run_disables_coverage_floor(self) -> None:
        with (
            patch.object(sys, "argv", ["run_pytest.py", "tests/unit/"]),
            patch.dict(os.environ, {}, clear=True),
            patch("pytest.main", return_value=0) as pytest_main,
        ):
            assert _module.main() == 0

        args = pytest_main.call_args.args[0]
        assert "--cov-fail-under=0" in args
        assert args[-1] == "tests/unit/"

    def test_k_selector_disables_coverage_floor(self) -> None:
        with (
            patch.object(sys, "argv", ["run_pytest.py", "-k", "test_foo"]),
            patch.dict(os.environ, {}, clear=True),
            patch("pytest.main", return_value=0) as pytest_main,
        ):
            assert _module.main() == 0

        args = pytest_main.call_args.args[0]
        assert "--cov-fail-under=0" in args

    def test_k_equals_selector_disables_coverage_floor(self) -> None:
        with (
            patch.object(sys, "argv", ["run_pytest.py", "-k=test_foo"]),
            patch.dict(os.environ, {}, clear=True),
            patch("pytest.main", return_value=0) as pytest_main,
        ):
            assert _module.main() == 0

        args = pytest_main.call_args.args[0]
        assert "--cov-fail-under=0" in args

    def test_m_selector_disables_coverage_floor(self) -> None:
        with (
            patch.object(sys, "argv", ["run_pytest.py", "-m", "slow"]),
            patch.dict(os.environ, {}, clear=True),
            patch("pytest.main", return_value=0) as pytest_main,
        ):
            assert _module.main() == 0

        args = pytest_main.call_args.args[0]
        assert "--cov-fail-under=0" in args

    def test_last_failed_disables_coverage_floor(self) -> None:
        with (
            patch.object(sys, "argv", ["run_pytest.py", "--lf"]),
            patch.dict(os.environ, {}, clear=True),
            patch("pytest.main", return_value=0) as pytest_main,
        ):
            assert _module.main() == 0

        args = pytest_main.call_args.args[0]
        assert "--cov-fail-under=0" in args

    def test_k_concat_selector_disables_coverage_floor(self) -> None:
        with (
            patch.object(sys, "argv", ["run_pytest.py", "-ktest_foo"]),
            patch.dict(os.environ, {}, clear=True),
            patch("pytest.main", return_value=0) as pytest_main,
        ):
            assert _module.main() == 0

        args = pytest_main.call_args.args[0]
        assert "--cov-fail-under=0" in args

    def test_m_concat_selector_disables_coverage_floor(self) -> None:
        with (
            patch.object(sys, "argv", ["run_pytest.py", "-mslow"]),
            patch.dict(os.environ, {}, clear=True),
            patch("pytest.main", return_value=0) as pytest_main,
        ):
            assert _module.main() == 0

        args = pytest_main.call_args.args[0]
        assert "--cov-fail-under=0" in args

    def test_last_failed_long_form_disables_coverage_floor(self) -> None:
        with (
            patch.object(sys, "argv", ["run_pytest.py", "--last-failed"]),
            patch.dict(os.environ, {}, clear=True),
            patch("pytest.main", return_value=0) as pytest_main,
        ):
            assert _module.main() == 0

        args = pytest_main.call_args.args[0]
        assert "--cov-fail-under=0" in args

    def test_non_selector_flags_keep_coverage_floor(self) -> None:
        with (
            patch.object(sys, "argv", ["run_pytest.py", "-v", "-x", "--no-cov"]),
            patch.dict(os.environ, {}, clear=True),
            patch("pytest.main", return_value=0) as pytest_main,
        ):
            assert _module.main() == 0

        args = pytest_main.call_args.args[0]
        assert "--cov-fail-under=0" not in args

    def test_lfnf_does_not_trigger_subset_mode(self) -> None:
        with (
            patch.object(sys, "argv", ["run_pytest.py", "--lfnf=all"]),
            patch.dict(os.environ, {}, clear=True),
            patch("pytest.main", return_value=0) as pytest_main,
        ):
            assert _module.main() == 0

        args = pytest_main.call_args.args[0]
        assert "--cov-fail-under=0" not in args

    def test_existing_coverage_file_is_preserved(self) -> None:
        with (
            patch.object(sys, "argv", ["run_pytest.py"]),
            patch.dict(os.environ, {"COVERAGE_FILE": "preflight.coverage"}, clear=True),
            patch("pytest.main", return_value=0) as pytest_main,
        ):
            assert _module.main() == 0
            assert os.environ["COVERAGE_FILE"] == "preflight.coverage"

        args = pytest_main.call_args.args[0]
        assert "--cov-fail-under=0" not in args

    def test_prunes_old_run_directories_best_effort(self, tmp_path: Path) -> None:
        runs_root = tmp_path / "runs"
        runs_root.mkdir()
        now = time.time()

        kept: list[Path] = []
        for index in range(3):
            path = runs_root / f"run-new-{index}"
            path.mkdir()
            os.utime(path, (now - index, now - index))
            kept.append(path)

        stale = runs_root / "run-stale"
        stale.mkdir()
        old_time = now - (_module._MAX_RUN_AGE_SECONDS + 60)
        os.utime(stale, (old_time, old_time))

        _module._prune_old_runs(runs_root)

        assert stale.exists() is False
        assert all(path.exists() for path in kept)
