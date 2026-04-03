"""Regression tests for the launcher-only pytest-cov plugin."""

from __future__ import annotations

import importlib.util
from collections.abc import Iterable
from io import StringIO
from pathlib import Path
from typing import Protocol, cast

import coverage
from coverage.sqldata import CoverageData

_plugin_path = (
    Path(__file__).resolve().parents[2] / "scripts" / "pytest_cov_launcher_plugin.py"
)
_spec = importlib.util.spec_from_file_location(
    "pytest_cov_launcher_plugin", _plugin_path
)
assert _spec is not None
assert _spec.loader is not None
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)


class CombineFunc(Protocol):
    def __call__(
        self,
        cov: coverage.Coverage,
        data_paths: Iterable[str] | None = None,
        strict: bool = False,
        keep: bool = False,
    ) -> None: ...


def _write_shard(base: Path, suffix: str, filename: str, lines: list[int]) -> Path:
    data = CoverageData(basename=str(base), suffix=suffix)
    data.add_lines({filename: lines})
    data.write()
    return Path(data.data_filename())


def _combine_total(
    combine_func: CombineFunc,
    data_dir: Path,
    data_file: Path,
    source_dir: Path,
    *,
    keep: bool,
) -> tuple[float, set[int]]:
    cov = coverage.Coverage(
        data_file=str(data_file),
        source=[str(source_dir)],
        config_file=False,
    )
    combine_func(cov, [str(data_dir)], False, keep)
    cov.save()
    total = cov.report(file=StringIO())
    lines = set(cov.get_data().lines(str(source_dir / "mod.py")) or [])
    return total, lines


class TestPytestCovLauncherPlugin:
    def test_keep_true_preserves_coverage_result(self, tmp_path: Path) -> None:
        source_dir = tmp_path / "pkg"
        source_dir.mkdir()
        source_file = source_dir / "mod.py"
        source_file.write_text(
            "def covered(flag):\n"
            "    x = 1\n"
            "    if flag:\n"
            "        return x\n"
            "    return 0\n",
            encoding="utf-8",
        )

        base_false = tmp_path / "false" / ".coverage"
        base_false.parent.mkdir()
        shard_false_a = _write_shard(base_false, "a", str(source_file), [1, 2, 3, 4])
        shard_false_b = _write_shard(base_false, "b", str(source_file), [1, 2, 5])

        base_true = tmp_path / "true" / ".coverage"
        base_true.parent.mkdir()
        shard_true_a = _write_shard(base_true, "a", str(source_file), [1, 2, 3, 4])
        shard_true_b = _write_shard(base_true, "b", str(source_file), [1, 2, 5])

        unpatched_combine = cast(
            CombineFunc,
            getattr(
                coverage.Coverage.combine, "__wrapped__", coverage.Coverage.combine
            ),
        )

        total_false, lines_false = _combine_total(
            unpatched_combine,
            base_false.parent,
            tmp_path / "combined-false" / ".coverage",
            source_dir,
            keep=False,
        )
        total_true, lines_true = _combine_total(
            unpatched_combine,
            base_true.parent,
            tmp_path / "combined-true" / ".coverage",
            source_dir,
            keep=True,
        )

        assert total_true == total_false
        assert lines_true == lines_false
        assert shard_false_a.exists() is False
        assert shard_false_b.exists() is False
        assert shard_true_a.exists()
        assert shard_true_b.exists()

    def test_plugin_forces_keep_without_changing_other_kwargs(self) -> None:
        original_combine = cast(CombineFunc, coverage.Coverage.combine)
        original_patched = cast(bool, _module._PATCHED)
        try:
            _module._PATCHED = False
            captured: dict[str, object] = {}

            def fake_original(
                self: coverage.Coverage,
                data_paths: Iterable[str] | None = None,
                strict: bool = False,
                keep: bool = False,
            ) -> None:
                captured["data_paths"] = data_paths
                captured["strict"] = strict
                captured["keep"] = keep

            coverage.Coverage.combine = cast(CombineFunc, fake_original)
            _module.pytest_configure()
            result = cast(CombineFunc, coverage.Coverage.combine)(
                coverage.Coverage(config_file=False),
                "data",
                strict=True,
            )

            assert result is None
            assert captured == {
                "data_paths": "data",
                "strict": True,
                "keep": True,
            }
        finally:
            coverage.Coverage.combine = original_combine
            _module._PATCHED = original_patched
