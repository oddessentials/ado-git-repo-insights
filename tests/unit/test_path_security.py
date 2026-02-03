"""Tests for path security helpers."""

from __future__ import annotations

from pathlib import Path

import pytest

from ado_git_repo_insights.utils.path_security import (
    ensure_safe_filename,
    ensure_safe_relative_path,
    safe_join,
)


class TestEnsureSafeFilename:
    def test_rejects_empty(self) -> None:
        with pytest.raises(ValueError, match="empty"):
            ensure_safe_filename("")

    def test_rejects_absolute_paths(self) -> None:
        with pytest.raises(ValueError, match="Absolute path"):
            ensure_safe_filename("/etc/passwd")
        with pytest.raises(ValueError, match="Absolute path"):
            ensure_safe_filename("\\Windows\\System32")

    def test_rejects_traversal(self) -> None:
        with pytest.raises(ValueError, match="separators"):
            ensure_safe_filename("../evil.zip")
        with pytest.raises(ValueError, match="Unsafe filename segment"):
            ensure_safe_filename("..")

    def test_rejects_separators(self) -> None:
        with pytest.raises(ValueError, match="separators"):
            ensure_safe_filename("nested/file.zip")
        with pytest.raises(ValueError, match="separators"):
            ensure_safe_filename("nested\\file.zip")

    def test_rejects_windows_drive(self) -> None:
        with pytest.raises(ValueError, match="Absolute path"):
            ensure_safe_filename("C:\\windows\\system.ini")
        with pytest.raises(ValueError, match="Absolute path"):
            ensure_safe_filename("D:/data/evil.txt")

    def test_accepts_simple_name(self) -> None:
        assert ensure_safe_filename("artifact.zip") == "artifact.zip"
        assert ensure_safe_filename("archive..zip") == "archive..zip"


class TestEnsureSafeRelativePath:
    def test_rejects_absolute_paths(self) -> None:
        with pytest.raises(ValueError, match="Absolute path"):
            ensure_safe_relative_path("/etc/passwd")
        with pytest.raises(ValueError, match="Absolute path"):
            ensure_safe_relative_path("\\Windows\\System32")

    def test_rejects_traversal(self) -> None:
        with pytest.raises(ValueError, match="traversal"):
            ensure_safe_relative_path("../evil.txt")
        with pytest.raises(ValueError, match="traversal"):
            ensure_safe_relative_path("subdir/../../escape.txt")

    def test_rejects_windows_drive(self) -> None:
        with pytest.raises(ValueError, match="Absolute path"):
            ensure_safe_relative_path("E:autorun.inf")
        with pytest.raises(ValueError, match="Absolute path"):
            ensure_safe_relative_path("C:\\windows\\system.ini")

    def test_accepts_nested_relative(self) -> None:
        assert ensure_safe_relative_path("aggregates/weekly_rollups/2026-W01.json") == (
            "aggregates/weekly_rollups/2026-W01.json"
        )
        assert ensure_safe_relative_path("foo..bar/baz") == "foo..bar/baz"


class TestSafeJoin:
    def test_anchors_to_root(self, tmp_path: Path) -> None:
        target = safe_join(tmp_path, "dataset-manifest.json")
        assert target.parent == tmp_path.resolve()

    def test_rejects_escape(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="traversal"):
            safe_join(tmp_path, "../outside.json")
