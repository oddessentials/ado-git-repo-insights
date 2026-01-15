"""Unit tests for ML CLI flags without importing ML dependencies (Phase 5 hardening)."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


class TestMLCLIFlags:
    """Test ML CLI flags comprehensively without requiring [ml] extras."""

    def test_cli_help_includes_predictions_flag(self) -> None:
        """--enable-predictions flag appears in CLI help."""
        result = subprocess.run(  # noqa: S603 - controlled subprocess call with known arguments
            [
                sys.executable,
                "-m",
                "ado_git_repo_insights.cli",
                "generate-aggregates",
                "--help",
            ],
            capture_output=True,
            text=True,
            check=False,
        )

        assert result.returncode == 0
        assert "--enable-predictions" in result.stdout

    def test_cli_help_includes_insights_flag(self) -> None:
        """--enable-insights flag appears in CLI help."""
        result = subprocess.run(  # noqa: S603 - controlled subprocess call with known arguments
            [
                sys.executable,
                "-m",
                "ado_git_repo_insights.cli",
                "generate-aggregates",
                "--help",
            ],
            capture_output=True,
            text=True,
            check=False,
        )

        assert result.returncode == 0
        assert "--enable-insights" in result.stdout

    def test_cli_help_includes_dry_run_flag(self) -> None:
        """--insights-dry-run flag appears in CLI help."""
        result = subprocess.run(  # noqa: S603 - controlled subprocess call with known arguments
            [
                sys.executable,
                "-m",
                "ado_git_repo_insights.cli",
                "generate-aggregates",
                "--help",
            ],
            capture_output=True,
            text=True,
            check=False,
        )

        assert result.returncode == 0
        assert "--insights-dry-run" in result.stdout

    def test_enable_insights_without_api_key_fails_early(
        self, tmp_path: Path, monkeypatch: any
    ) -> None:
        """--enable-insights without OPENAI_API_KEY fails early with clear message."""
        # Remove API key if set
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)

        # Create minimal test database
        db_path = tmp_path / "test.db"
        # Note: This would require a real DB or mock, simplify for now
        # Just verify CLI parsing doesn't crash
        result = subprocess.run(  # noqa: S603 - controlled subprocess call with known arguments
            [
                sys.executable,
                "-m",
                "ado_git_repo_insights.cli",
                "generate-aggregates",
                "--database",
                str(db_path),
                "--output",
                str(tmp_path / "output"),
                "--enable-insights",
            ],
            capture_output=True,
            text=True,
            check=False,
            env={**os.environ, "OPENAI_API_KEY": ""},  # Explicitly unset
        )

        # Should fail with clear error
        assert result.returncode != 0
        assert "OPENAI_API_KEY" in result.stderr or "OPENAI_API_KEY" in result.stdout
