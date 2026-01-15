"""Tests for artifacts directory creation with filesystem isolation.

This module validates that the artifacts directory is created correctly
using tmp_path isolation to avoid polluting the real filesystem.
"""

from __future__ import annotations

from pathlib import Path

from ado_git_repo_insights.utils.logging_config import LoggingConfig, setup_logging


class TestArtifactsDirectoryCreation:
    """Test artifacts directory creation with tmp_path isolation."""

    def test_artifacts_dir_created_when_jsonl_enabled(self, tmp_path: Path) -> None:
        """Artifacts directory is created when JSONL logging is configured."""
        artifacts_dir = tmp_path / "nested" / "run_artifacts"
        assert not artifacts_dir.exists()

        # LoggingConfig with explicit artifacts_dir - JSONL mode creates dir
        config = LoggingConfig(format="jsonl", artifacts_dir=artifacts_dir)
        setup_logging(config)

        # Directory should now exist
        assert artifacts_dir.exists()

    def test_artifacts_dir_not_recreated_if_exists(self, tmp_path: Path) -> None:
        """Artifacts directory is not recreated if already exists."""
        artifacts_dir = tmp_path / "existing_artifacts"
        artifacts_dir.mkdir(parents=True)

        # Create a marker file
        marker = artifacts_dir / "marker.txt"
        marker.write_text("exists", encoding="utf-8")

        config = LoggingConfig(format="jsonl", artifacts_dir=artifacts_dir)
        setup_logging(config)

        # Marker should still exist (directory wasn't deleted and recreated)
        assert marker.exists()
        assert marker.read_text(encoding="utf-8") == "exists"

    def test_deeply_nested_artifacts_dir_created(self, tmp_path: Path) -> None:
        """Deeply nested artifacts directory is created."""
        artifacts_dir = tmp_path / "a" / "b" / "c" / "d" / "artifacts"
        assert not artifacts_dir.exists()

        config = LoggingConfig(format="jsonl", artifacts_dir=artifacts_dir)
        setup_logging(config)

        assert artifacts_dir.exists()
