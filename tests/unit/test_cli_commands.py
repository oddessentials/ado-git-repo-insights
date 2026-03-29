"""Tests for CLI command functions.

This module tests the core command functions in cli.py:
- cmd_extract: PR extraction with error handling
- cmd_generate_csv: CSV generation from database
- cmd_generate_aggregates: JSON aggregate generation with ML flags
- _validate_serve_flags: Shared flag validation logic

These tests complement the existing CLI tests by covering error paths
and internal function behavior.
"""

from __future__ import annotations

import sys
from argparse import Namespace
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


class TestCmdExtract:
    """Tests for cmd_extract command function."""

    @patch("ado_git_repo_insights.config.load_config")
    def test_configuration_error_returns_1(
        self,
        mock_load_config: MagicMock,
        tmp_path: Path,
    ) -> None:
        """ConfigurationError should return exit code 1."""
        from ado_git_repo_insights.cli import cmd_extract
        from ado_git_repo_insights.config import ConfigurationError

        mock_load_config.side_effect = ConfigurationError("Invalid config")

        artifacts_dir = tmp_path / "artifacts"
        args = Namespace(
            organization="test-org",
            projects="proj",
            pat="test-pat",
            config=None,
            database=tmp_path / "test.sqlite",
            start_date=None,
            end_date=None,
            backfill_days=None,
            include_comments=False,
            comments_max_prs_per_run=100,
            comments_max_threads_per_pr=50,
            artifacts_dir=artifacts_dir,
        )

        result = cmd_extract(args)

        assert result == 1
        # Verify run summary was written
        assert (artifacts_dir / "run_summary.json").exists()

    @patch("ado_git_repo_insights.config.load_config")
    @patch("ado_git_repo_insights.persistence.database.DatabaseManager")
    def test_database_error_returns_1(
        self,
        mock_db_manager: MagicMock,
        mock_load_config: MagicMock,
        tmp_path: Path,
    ) -> None:
        """DatabaseError should return exit code 1."""
        from ado_git_repo_insights.cli import cmd_extract
        from ado_git_repo_insights.persistence.database import DatabaseError

        # Setup mock config
        mock_config = MagicMock()
        mock_config.database = tmp_path / "test.sqlite"
        mock_load_config.return_value = mock_config

        # Database connection fails
        mock_db_manager.side_effect = DatabaseError("Connection failed")

        artifacts_dir = tmp_path / "artifacts"
        args = Namespace(
            organization="test-org",
            projects="proj",
            pat="test-pat",
            config=None,
            database=tmp_path / "test.sqlite",
            start_date=None,
            end_date=None,
            backfill_days=None,
            include_comments=False,
            comments_max_prs_per_run=100,
            comments_max_threads_per_pr=50,
            artifacts_dir=artifacts_dir,
        )

        result = cmd_extract(args)

        assert result == 1
        assert (artifacts_dir / "run_summary.json").exists()

    @patch("ado_git_repo_insights.config.load_config")
    @patch("ado_git_repo_insights.persistence.database.DatabaseManager")
    @patch("ado_git_repo_insights.extractor.ado_client.ADOClient")
    def test_extraction_error_returns_1(
        self,
        mock_ado_client: MagicMock,
        mock_db_manager: MagicMock,
        mock_load_config: MagicMock,
        tmp_path: Path,
    ) -> None:
        """ExtractionError should return exit code 1."""
        from ado_git_repo_insights.cli import cmd_extract
        from ado_git_repo_insights.extractor.ado_client import ExtractionError

        # Setup mock config
        mock_config = MagicMock()
        mock_config.database = tmp_path / "test.sqlite"
        mock_config.organization = "test-org"
        mock_config.pat = "test-pat"
        mock_config.projects = ["proj"]
        mock_config.api = MagicMock()
        mock_load_config.return_value = mock_config

        # Setup mock database
        mock_db = MagicMock()
        mock_db_manager.return_value = mock_db

        # ADO client test_connection fails
        mock_client = MagicMock()
        mock_client.test_connection.side_effect = ExtractionError("API error")
        mock_ado_client.return_value = mock_client

        artifacts_dir = tmp_path / "artifacts"
        args = Namespace(
            organization="test-org",
            projects="proj",
            pat="test-pat",
            config=None,
            database=tmp_path / "test.sqlite",
            start_date=None,
            end_date=None,
            backfill_days=None,
            include_comments=False,
            comments_max_prs_per_run=100,
            comments_max_threads_per_pr=50,
            artifacts_dir=artifacts_dir,
        )

        result = cmd_extract(args)

        assert result == 1


class TestCmdGenerateCsv:
    """Tests for cmd_generate_csv command function."""

    def test_missing_database_returns_1(self, tmp_path: Path) -> None:
        """Missing database file should return exit code 1."""
        from ado_git_repo_insights.cli import cmd_generate_csv

        args = Namespace(
            database=tmp_path / "nonexistent.sqlite",
            output=tmp_path / "output",
        )

        result = cmd_generate_csv(args)

        assert result == 1

    @patch("ado_git_repo_insights.persistence.database.DatabaseManager")
    def test_database_error_returns_1(
        self,
        mock_db_manager: MagicMock,
        tmp_path: Path,
    ) -> None:
        """DatabaseError during generation should return exit code 1."""
        from ado_git_repo_insights.cli import cmd_generate_csv
        from ado_git_repo_insights.persistence.database import DatabaseError

        # Create a dummy database file
        db_path = tmp_path / "test.sqlite"
        db_path.touch()

        mock_db_manager.side_effect = DatabaseError("Read error")

        args = Namespace(
            database=db_path,
            output=tmp_path / "output",
        )

        result = cmd_generate_csv(args)

        assert result == 1

    @patch("ado_git_repo_insights.persistence.database.DatabaseManager")
    @patch("ado_git_repo_insights.transform.csv_generator.CSVGenerator")
    def test_csv_generation_error_returns_1(
        self,
        mock_csv_generator: MagicMock,
        mock_db_manager: MagicMock,
        tmp_path: Path,
    ) -> None:
        """CSVGenerationError should return exit code 1."""
        from ado_git_repo_insights.cli import cmd_generate_csv
        from ado_git_repo_insights.transform.csv_generator import CSVGenerationError

        # Create a dummy database file
        db_path = tmp_path / "test.sqlite"
        db_path.touch()

        mock_db = MagicMock()
        mock_db_manager.return_value = mock_db

        mock_generator = MagicMock()
        mock_generator.generate_all.side_effect = CSVGenerationError("Write error")
        mock_csv_generator.return_value = mock_generator

        args = Namespace(
            database=db_path,
            output=tmp_path / "output",
        )

        result = cmd_generate_csv(args)

        assert result == 1

    @patch("ado_git_repo_insights.persistence.database.DatabaseManager")
    @patch("ado_git_repo_insights.transform.csv_generator.CSVGenerator")
    def test_successful_generation_returns_0(
        self,
        mock_csv_generator: MagicMock,
        mock_db_manager: MagicMock,
        tmp_path: Path,
    ) -> None:
        """Successful CSV generation should return exit code 0."""
        from ado_git_repo_insights.cli import cmd_generate_csv

        # Create a dummy database file
        db_path = tmp_path / "test.sqlite"
        db_path.touch()

        mock_db = MagicMock()
        mock_db_manager.return_value = mock_db

        mock_generator = MagicMock()
        mock_generator.generate_all.return_value = {"prs": 100, "repos": 10}
        mock_csv_generator.return_value = mock_generator

        args = Namespace(
            database=db_path,
            output=tmp_path / "output",
        )

        result = cmd_generate_csv(args)

        assert result == 0


class TestCmdGenerateAggregates:
    """Tests for cmd_generate_aggregates command function."""

    def test_missing_database_returns_1(self, tmp_path: Path) -> None:
        """Missing database file should return exit code 1."""
        from ado_git_repo_insights.cli import cmd_generate_aggregates

        args = Namespace(
            database=tmp_path / "nonexistent.sqlite",
            output=tmp_path / "output",
            run_id="",
            enable_ml_stubs=False,
            seed_base="",
            enable_predictions=False,
            enable_insights=False,
            insights_max_tokens=1000,
            insights_cache_ttl_hours=24,
            insights_dry_run=False,
            stub_mode=False,
        )

        result = cmd_generate_aggregates(args)

        assert result == 1

    def test_insights_without_api_key_returns_1(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """--enable-insights without OPENAI_API_KEY should return exit code 1."""
        from ado_git_repo_insights.cli import cmd_generate_aggregates

        # Ensure no API key
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)

        # Create a dummy database file
        db_path = tmp_path / "test.sqlite"
        db_path.touch()

        args = Namespace(
            database=db_path,
            output=tmp_path / "output",
            run_id="",
            enable_ml_stubs=False,
            seed_base="",
            enable_predictions=False,
            enable_insights=True,  # Enabled without API key
            insights_max_tokens=1000,
            insights_cache_ttl_hours=24,
            insights_dry_run=False,  # Not dry run
            stub_mode=False,
        )

        with patch("ado_git_repo_insights.cli.logger") as mock_logger:
            result = cmd_generate_aggregates(args)

        assert result == 1
        assert mock_logger.error.called
        error_msg = mock_logger.error.call_args[0][0]
        assert "OPENAI_API_KEY is required" in error_msg

    @patch("ado_git_repo_insights.persistence.database.DatabaseManager")
    @patch("ado_git_repo_insights.transform.aggregators.AggregateGenerator")
    def test_insights_dry_run_without_api_key_proceeds(
        self,
        mock_agg_generator: MagicMock,
        mock_db_manager: MagicMock,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """--enable-insights --insights-dry-run should proceed without API key."""
        from ado_git_repo_insights.cli import cmd_generate_aggregates

        # Ensure no API key
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)

        # Create a dummy database file
        db_path = tmp_path / "test.sqlite"
        db_path.touch()

        mock_db = MagicMock()
        mock_db_manager.return_value = mock_db

        mock_generator = MagicMock()
        mock_manifest = MagicMock()
        mock_manifest.aggregate_index.weekly_rollups = []
        mock_manifest.aggregate_index.distributions = []
        mock_manifest.features = {"predictions": False, "ai_insights": True}
        mock_manifest.warnings = []
        mock_generator.generate_all.return_value = mock_manifest
        mock_agg_generator.return_value = mock_generator

        args = Namespace(
            database=db_path,
            output=tmp_path / "output",
            run_id="",
            enable_ml_stubs=False,
            seed_base="",
            enable_predictions=False,
            enable_insights=True,
            insights_max_tokens=1000,
            insights_cache_ttl_hours=24,
            insights_dry_run=True,  # Dry run mode
            stub_mode=False,
        )

        with patch.dict("sys.modules", {"openai": MagicMock()}):
            with patch("ado_git_repo_insights.cli.logger") as mock_logger:
                result = cmd_generate_aggregates(args)

        assert result == 0
        assert not any(
            "OPENAI_API_KEY is required" in call.args[0]
            for call in mock_logger.error.call_args_list
        )

    @patch("ado_git_repo_insights.persistence.database.DatabaseManager")
    @patch("ado_git_repo_insights.transform.aggregators.AggregateGenerator")
    def test_insights_dry_run_openai_not_installed(
        self,
        mock_agg_generator: MagicMock,
        mock_db_manager: MagicMock,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """--insights-dry-run must succeed even when openai is not installed.

        The dry-run path writes prompt.json without importing openai,
        so the SDK availability check must be bypassed entirely.
        """
        from ado_git_repo_insights.cli import cmd_generate_aggregates

        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        db_path = tmp_path / "test.sqlite"
        db_path.touch()

        mock_db = MagicMock()
        mock_db_manager.return_value = mock_db
        mock_generator = MagicMock()
        mock_manifest = MagicMock()
        mock_manifest.aggregate_index.weekly_rollups = []
        mock_manifest.aggregate_index.distributions = []
        mock_manifest.features = {"predictions": False, "ai_insights": True}
        mock_manifest.warnings = []
        mock_generator.generate_all.return_value = mock_manifest
        mock_agg_generator.return_value = mock_generator

        args = Namespace(
            database=db_path,
            output=tmp_path / "output",
            run_id="",
            enable_ml_stubs=False,
            seed_base="",
            enable_predictions=False,
            enable_insights=True,
            insights_max_tokens=1000,
            insights_cache_ttl_hours=24,
            insights_dry_run=True,
            stub_mode=False,
        )

        # openai is NOT in sys.modules and find_spec returns None
        monkeypatch.delitem(sys.modules, "openai", raising=False)
        with patch("importlib.util.find_spec", return_value=None):
            with patch("ado_git_repo_insights.cli.logger") as mock_logger:
                result = cmd_generate_aggregates(args)

        assert result == 0, "dry-run must succeed without openai SDK"
        assert not any(
            "OpenAI SDK not installed" in str(call)
            for call in mock_logger.error.call_args_list
        )

    def test_insights_openai_not_installed_with_api_key(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """--enable-insights with API key but no openai should return 1."""
        from ado_git_repo_insights.cli import cmd_generate_aggregates

        monkeypatch.setenv("OPENAI_API_KEY", "sk-test-fake-key")
        db_path = tmp_path / "test.sqlite"
        db_path.touch()

        args = Namespace(
            database=db_path,
            output=tmp_path / "output",
            run_id="",
            enable_ml_stubs=False,
            seed_base="",
            enable_predictions=False,
            enable_insights=True,
            insights_max_tokens=1000,
            insights_cache_ttl_hours=24,
            insights_dry_run=False,
            stub_mode=False,
        )

        # Remove openai from sys.modules so "openai" in sys.modules is False,
        # then mock find_spec to return None (package not installed)
        monkeypatch.delitem(sys.modules, "openai", raising=False)
        with patch("importlib.util.find_spec", return_value=None):
            with patch("ado_git_repo_insights.cli.logger") as mock_logger:
                result = cmd_generate_aggregates(args)

        assert result == 1
        assert mock_logger.error.called
        assert "OpenAI SDK not installed" in mock_logger.error.call_args[0][0]

    @patch("ado_git_repo_insights.persistence.database.DatabaseManager")
    def test_database_error_returns_1(
        self,
        mock_db_manager: MagicMock,
        tmp_path: Path,
    ) -> None:
        """DatabaseError should return exit code 1."""
        from ado_git_repo_insights.cli import cmd_generate_aggregates
        from ado_git_repo_insights.persistence.database import DatabaseError

        # Create a dummy database file
        db_path = tmp_path / "test.sqlite"
        db_path.touch()

        mock_db_manager.side_effect = DatabaseError("Connection failed")

        args = Namespace(
            database=db_path,
            output=tmp_path / "output",
            run_id="",
            enable_ml_stubs=False,
            seed_base="",
            enable_predictions=False,
            enable_insights=False,
            insights_max_tokens=1000,
            insights_cache_ttl_hours=24,
            insights_dry_run=False,
            stub_mode=False,
        )

        result = cmd_generate_aggregates(args)

        assert result == 1

    @patch("ado_git_repo_insights.persistence.database.DatabaseManager")
    @patch("ado_git_repo_insights.transform.aggregators.AggregateGenerator")
    def test_aggregation_error_returns_1(
        self,
        mock_agg_generator: MagicMock,
        mock_db_manager: MagicMock,
        tmp_path: Path,
    ) -> None:
        """AggregationError should return exit code 1."""
        from ado_git_repo_insights.cli import cmd_generate_aggregates
        from ado_git_repo_insights.transform.aggregators import AggregationError

        # Create a dummy database file
        db_path = tmp_path / "test.sqlite"
        db_path.touch()

        mock_db = MagicMock()
        mock_db_manager.return_value = mock_db

        mock_generator = MagicMock()
        mock_generator.generate_all.side_effect = AggregationError("Generation failed")
        mock_agg_generator.return_value = mock_generator

        args = Namespace(
            database=db_path,
            output=tmp_path / "output",
            run_id="",
            enable_ml_stubs=False,
            seed_base="",
            enable_predictions=False,
            enable_insights=False,
            insights_max_tokens=1000,
            insights_cache_ttl_hours=24,
            insights_dry_run=False,
            stub_mode=False,
        )

        result = cmd_generate_aggregates(args)

        assert result == 1

    @patch("ado_git_repo_insights.persistence.database.DatabaseManager")
    @patch("ado_git_repo_insights.transform.aggregators.AggregateGenerator")
    def test_stub_generation_error_returns_1(
        self,
        mock_agg_generator: MagicMock,
        mock_db_manager: MagicMock,
        tmp_path: Path,
    ) -> None:
        """StubGenerationError should return exit code 1."""
        from ado_git_repo_insights.cli import cmd_generate_aggregates
        from ado_git_repo_insights.transform.aggregators import StubGenerationError

        # Create a dummy database file
        db_path = tmp_path / "test.sqlite"
        db_path.touch()

        mock_db = MagicMock()
        mock_db_manager.return_value = mock_db

        mock_generator = MagicMock()
        mock_generator.generate_all.side_effect = StubGenerationError("Stub error")
        mock_agg_generator.return_value = mock_generator

        args = Namespace(
            database=db_path,
            output=tmp_path / "output",
            run_id="",
            enable_ml_stubs=True,
            seed_base="test-seed",
            enable_predictions=False,
            enable_insights=False,
            insights_max_tokens=1000,
            insights_cache_ttl_hours=24,
            insights_dry_run=False,
            stub_mode=False,
        )

        result = cmd_generate_aggregates(args)

        assert result == 1

    @patch("ado_git_repo_insights.persistence.database.DatabaseManager")
    @patch("ado_git_repo_insights.transform.aggregators.AggregateGenerator")
    def test_successful_generation_returns_0(
        self,
        mock_agg_generator: MagicMock,
        mock_db_manager: MagicMock,
        tmp_path: Path,
    ) -> None:
        """Successful aggregate generation should return exit code 0."""
        from ado_git_repo_insights.cli import cmd_generate_aggregates

        # Create a dummy database file
        db_path = tmp_path / "test.sqlite"
        db_path.touch()

        mock_db = MagicMock()
        mock_db_manager.return_value = mock_db

        mock_generator = MagicMock()
        mock_manifest = MagicMock()
        mock_manifest.aggregate_index.weekly_rollups = []
        mock_manifest.aggregate_index.distributions = []
        mock_manifest.features = {"predictions": False, "ai_insights": False}
        mock_manifest.warnings = []
        mock_generator.generate_all.return_value = mock_manifest
        mock_agg_generator.return_value = mock_generator

        args = Namespace(
            database=db_path,
            output=tmp_path / "output",
            run_id="test-run",
            enable_ml_stubs=False,
            seed_base="",
            enable_predictions=False,
            enable_insights=False,
            insights_max_tokens=1000,
            insights_cache_ttl_hours=24,
            insights_dry_run=False,
            stub_mode=False,
        )

        result = cmd_generate_aggregates(args)

        assert result == 0


class TestValidateServeFlags:
    """Tests for _validate_serve_flags helper function."""

    def test_valid_serve_with_open_and_port(self) -> None:
        """--serve --open --port should pass validation."""
        from ado_git_repo_insights.cli import _validate_serve_flags

        args = Namespace(
            serve=True,
            open=True,
            port=3000,
        )

        result = _validate_serve_flags(args)

        assert result is None  # None means valid

    def test_valid_no_serve_no_extras(self) -> None:
        """No --serve and default port should pass validation."""
        from ado_git_repo_insights.cli import _validate_serve_flags

        args = Namespace(
            serve=False,
            open=False,
            port=8080,
        )

        result = _validate_serve_flags(args)

        assert result is None

    def test_invalid_open_without_serve(self) -> None:
        """--open without --serve should return 1."""
        from ado_git_repo_insights.cli import _validate_serve_flags

        args = Namespace(
            serve=False,
            open=True,
            port=8080,
        )

        result = _validate_serve_flags(args)

        assert result == 1

    def test_invalid_port_without_serve(self) -> None:
        """Non-default --port without --serve should return 1."""
        from ado_git_repo_insights.cli import _validate_serve_flags

        args = Namespace(
            serve=False,
            open=False,
            port=3000,  # Non-default
        )

        result = _validate_serve_flags(args)

        assert result == 1

    def test_invalid_both_without_serve(self) -> None:
        """Both --open and --port without --serve should return 1."""
        from ado_git_repo_insights.cli import _validate_serve_flags

        args = Namespace(
            serve=False,
            open=True,
            port=3000,
        )

        result = _validate_serve_flags(args)

        assert result == 1

    def test_missing_serve_attr_defaults_false(self) -> None:
        """Missing required attributes should fail fast."""
        from ado_git_repo_insights.cli import _validate_serve_flags

        args = Namespace(open=False, port=8080)

        with pytest.raises(ValueError, match="Missing required argument"):
            _validate_serve_flags(args)
