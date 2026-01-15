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

        # Create minimal valid database file so we reach the API key validation
        db_path = tmp_path / "test.db"
        # Create empty SQLite database with tables
        import sqlite3

        conn = sqlite3.connect(str(db_path))
        conn.execute(
            "CREATE TABLE IF NOT EXISTS pull_requests (id INTEGER PRIMARY KEY)"
        )
        conn.close()

        output_dir = tmp_path / "output"
        output_dir.mkdir(exist_ok=True)

        # Note: This runs in a subprocess, so monkeypatch doesn't affect it.
        # We must explicitly control the environment via env= parameter.
        env = {k: v for k, v in os.environ.items() if k != "OPENAI_API_KEY"}

        result = subprocess.run(  # noqa: S603 - controlled subprocess call with known arguments
            [
                sys.executable,
                "-m",
                "ado_git_repo_insights.cli",
                "generate-aggregates",
                "--database",
                str(db_path),
                "--output",
                str(output_dir),
                "--enable-insights",
            ],
            capture_output=True,
            text=True,
            check=False,
            env=env,
            cwd=str(tmp_path),  # Ensure clean working directory
        )

        # Should fail with clear error
        assert result.returncode != 0
        # Check stderr (logging) or stdout for the error message
        combined_output = result.stdout + result.stderr
        assert "OPENAI_API_KEY" in combined_output, (
            f"Expected 'OPENAI_API_KEY' in output. Got:\n"
            f"stdout: {result.stdout}\n"
            f"stderr: {result.stderr}"
        )
