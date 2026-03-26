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
        # Parse-boundary validation catches empty org → exit code 2
        with pytest.raises(SystemExit) as exc_info:
            main()
        assert exc_info.value.code == 2

    def test_extract_without_org_exits_code_2(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """extract --pat x without org/config exits code 2 (T-08, FR-008..FR-011, SC-004)."""
        from ado_git_repo_insights.cli import main

        monkeypatch.setattr("sys.argv", ["ado-insights", "extract", "--pat", "x"])
        with pytest.raises(SystemExit) as exc_info:
            main()
        assert exc_info.value.code == 2

    def test_extract_with_config_bypasses_org_requirement(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """extract with --config bypasses org requirement (T-09, FR-008, SC-004)."""
        from ado_git_repo_insights.cli import main

        config_file = tmp_path / "config.yaml"
        config_file.write_text(
            "organization: TestOrg\nprojects:\n  - TestProj\n", encoding="utf-8"
        )
        artifacts_dir = tmp_path / "artifacts"

        monkeypatch.setattr(
            "sys.argv",
            [
                "ado-insights",
                "--artifacts-dir",
                str(artifacts_dir),
                "extract",
                "--pat",
                "fake-pat",
                "--config",
                str(config_file),
            ],
        )
        # Should pass parse-boundary validation (won't succeed at API level, but
        # should NOT exit 2 — it should reach runtime and fail with exit 1)
        result = main()
        assert result != 2, "Config path should bypass org/projects requirement"

    def test_cmd_extract_configuration_error_returns_1(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """cmd_extract ConfigurationError path returns 1, no NameError (T-10, FR-014)."""
        from ado_git_repo_insights.cli import main

        artifacts_dir = tmp_path / "artifacts"
        config_file = tmp_path / "nonexistent.yaml"

        monkeypatch.setattr(
            "sys.argv",
            [
                "ado-insights",
                "--artifacts-dir",
                str(artifacts_dir),
                "extract",
                "--pat",
                "x",
                "--config",
                str(config_file),
                "--organization",
                "",
                "--projects",
                "P",
            ],
        )
        result = main()
        assert result == 1

    def test_cmd_generate_csv_missing_db_returns_1(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """cmd_generate_csv missing DB returns 1, no NameError (T-11, FR-014)."""
        from ado_git_repo_insights.cli import main

        monkeypatch.setattr(
            "sys.argv",
            [
                "ado-insights",
                "--artifacts-dir",
                str(tmp_path),
                "generate-csv",
                "--database",
                str(tmp_path / "missing.sqlite"),
            ],
        )
        result = main()
        assert result == 1

    def test_cmd_generate_aggregates_missing_db_returns_1(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """cmd_generate_aggregates missing DB returns 1, no NameError (T-12, FR-014)."""
        from ado_git_repo_insights.cli import main

        monkeypatch.setattr(
            "sys.argv",
            [
                "ado-insights",
                "--artifacts-dir",
                str(tmp_path),
                "generate-aggregates",
                "--database",
                str(tmp_path / "missing.sqlite"),
            ],
        )
        result = main()
        assert result == 1

    def test_cmd_build_aggregates_missing_db_returns_1(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """cmd_build_aggregates missing DB returns 1, no NameError (T-13, FR-014)."""
        from ado_git_repo_insights.cli import main

        monkeypatch.setattr(
            "sys.argv",
            [
                "ado-insights",
                "--artifacts-dir",
                str(tmp_path),
                "build-aggregates",
                "--db",
                str(tmp_path / "missing.sqlite"),
            ],
        )
        result = main()
        assert result == 1
