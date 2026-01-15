"""Tests for CLI exit codes via entrypoint harness (no subprocess).

This module verifies that the CLI returns appropriate non-zero exit codes
on failure without requiring subprocess calls.
"""

from __future__ import annotations

from pathlib import Path

import pytest


class TestCliExitCodes:
    """Test CLI exit codes via entrypoint (no subprocess)."""

    def test_extract_missing_pat_exits_nonzero(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """CLI returns non-zero when PAT is missing (argparse error)."""
        from ado_git_repo_insights.cli import main

        # argparse will fail with required argument missing - raises SystemExit
        monkeypatch.setattr(
            "sys.argv",
            [
                "ado-insights",
                "extract",
                "--organization",
                "TestOrg",
                "--projects",
                "Proj",
            ],
        )
        with pytest.raises(SystemExit) as exc_info:
            main()
        # argparse exits with 2 for missing required arguments
        assert exc_info.value.code != 0

    def test_extract_invalid_config_returns_nonzero(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """CLI returns non-zero for invalid config file."""
        from ado_git_repo_insights.cli import main

        # Create a malformed YAML file
        bad_config = tmp_path / "bad.yaml"
        bad_config.write_text("invalid: [", encoding="utf-8")

        artifacts_dir = tmp_path / "artifacts"

        # Global args (--artifacts-dir) must come BEFORE the subcommand
        monkeypatch.setattr(
            "sys.argv",
            [
                "ado-insights",
                "--artifacts-dir",
                str(artifacts_dir),
                "extract",
                "--config",
                str(bad_config),
                "--pat",
                "test-pat",
            ],
        )
        # main() returns 1 for config error (doesn't raise SystemExit)
        result = main()
        assert result == 1

    def test_generate_csv_missing_database_returns_nonzero(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """CLI returns non-zero when database doesn't exist."""
        from ado_git_repo_insights.cli import main

        missing_db = tmp_path / "nonexistent.sqlite"

        monkeypatch.setattr(
            "sys.argv",
            [
                "ado-insights",
                "generate-csv",
                "--database",
                str(missing_db),
            ],
        )
        # main() returns 1 for missing database
        result = main()
        assert result == 1

    def test_extract_empty_organization_returns_nonzero(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """CLI returns non-zero when organization is empty."""
        from ado_git_repo_insights.cli import main

        artifacts_dir = tmp_path / "artifacts"

        # Global args (--artifacts-dir) must come BEFORE the subcommand
        monkeypatch.setattr(
            "sys.argv",
            [
                "ado-insights",
                "--artifacts-dir",
                str(artifacts_dir),
                "extract",
                "--organization",
                "",
                "--projects",
                "TestProj",
                "--pat",
                "test-pat",
            ],
        )
        # ConfigurationError returns 1
        result = main()
        assert result == 1
