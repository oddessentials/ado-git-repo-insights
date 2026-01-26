"""Tests for CLI --serve flags (Flight 260127A).

This module tests --serve, --open, --port flags on both:
- build-aggregates command (DEV workflow)
- stage-artifacts command (PROD workflow)

Test coverage:
- US1: --serve, --open, --port flag acceptance
- US2: Backward compatibility (no --serve = no server)
- US3: Invalid flag combinations error handling
"""

from argparse import Namespace
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest  # noqa: F401 - required for tmp_path fixture

from ado_git_repo_insights.cli import cmd_build_aggregates, create_parser


class TestServeFlagParsing:
    """Tests for --serve, --open, --port argument parsing (US1)."""

    def test_serve_flag_accepted(self) -> None:
        """T004: Test --serve flag is accepted by build-aggregates."""
        parser = create_parser()
        args = parser.parse_args(["build-aggregates", "--db", "test.sqlite", "--serve"])
        assert args.serve is True

    def test_serve_with_open_accepted(self) -> None:
        """T005: Test --serve --open combination is accepted."""
        parser = create_parser()
        args = parser.parse_args(
            ["build-aggregates", "--db", "test.sqlite", "--serve", "--open"]
        )
        assert args.serve is True
        assert args.open is True

    def test_serve_with_port_accepted(self) -> None:
        """T006: Test --serve --port combination is accepted."""
        parser = create_parser()
        args = parser.parse_args(
            ["build-aggregates", "--db", "test.sqlite", "--serve", "--port", "3000"]
        )
        assert args.serve is True
        assert args.port == 3000

    def test_serve_with_all_flags_accepted(self) -> None:
        """Test --serve --open --port combination is accepted."""
        parser = create_parser()
        args = parser.parse_args(
            [
                "build-aggregates",
                "--db",
                "test.sqlite",
                "--serve",
                "--open",
                "--port",
                "3000",
            ]
        )
        assert args.serve is True
        assert args.open is True
        assert args.port == 3000

    def test_default_port_is_8080(self) -> None:
        """Test default port is 8080."""
        parser = create_parser()
        args = parser.parse_args(["build-aggregates", "--db", "test.sqlite", "--serve"])
        assert args.port == 8080

    def test_default_serve_is_false(self) -> None:
        """Test default serve is False (backward compatibility)."""
        parser = create_parser()
        args = parser.parse_args(["build-aggregates", "--db", "test.sqlite"])
        assert args.serve is False

    def test_default_open_is_false(self) -> None:
        """Test default open is False."""
        parser = create_parser()
        args = parser.parse_args(["build-aggregates", "--db", "test.sqlite"])
        assert args.open is False


class TestBackwardCompatibility:
    """Tests for backward compatibility - no --serve means no server (US2)."""

    def test_without_serve_does_not_start_server(self) -> None:
        """T011: build-aggregates without --serve should NOT start server."""
        parser = create_parser()
        args = parser.parse_args(["build-aggregates", "--db", "test.sqlite"])
        # Verify serve flag is False by default
        assert args.serve is False
        # The command should not call _serve_dashboard when serve is False
        # This is verified by the implementation logic, not just parsing

    def test_dashboard_command_unchanged(self) -> None:
        """T012: dashboard command should be unchanged."""
        parser = create_parser()
        args = parser.parse_args(
            ["dashboard", "--dataset", "./dataset", "--port", "9000", "--open"]
        )
        assert args.command == "dashboard"
        assert args.dataset == Path("./dataset")
        assert args.port == 9000
        assert args.open is True


class TestInvalidFlagCombinations:
    """Tests for invalid flag combination errors (US3)."""

    def test_open_without_serve_error(self) -> None:
        """T015: --open without --serve should error."""
        args = Namespace(
            db=Path("test.sqlite"),
            out=Path("dataset"),
            run_id="local",
            serve=False,
            open=True,
            port=8080,
            enable_predictions=False,
            enable_insights=False,
        )

        with patch("ado_git_repo_insights.cli.logger") as mock_logger:
            result = cmd_build_aggregates(args)

        assert result == 1
        mock_logger.error.assert_called_once()
        error_msg = mock_logger.error.call_args[0][0]
        assert "--open" in error_msg
        assert "--serve" in error_msg

    def test_port_without_serve_error(self) -> None:
        """T016: --port (non-default) without --serve should error."""
        args = Namespace(
            db=Path("test.sqlite"),
            out=Path("dataset"),
            run_id="local",
            serve=False,
            open=False,
            port=3000,  # Non-default port
            enable_predictions=False,
            enable_insights=False,
        )

        with patch("ado_git_repo_insights.cli.logger") as mock_logger:
            result = cmd_build_aggregates(args)

        assert result == 1
        mock_logger.error.assert_called_once()
        error_msg = mock_logger.error.call_args[0][0]
        assert "--port" in error_msg
        assert "--serve" in error_msg

    def test_open_and_port_without_serve_error(self) -> None:
        """T017: --open and --port without --serve should error listing both."""
        args = Namespace(
            db=Path("test.sqlite"),
            out=Path("dataset"),
            run_id="local",
            serve=False,
            open=True,
            port=3000,
            enable_predictions=False,
            enable_insights=False,
        )

        with patch("ado_git_repo_insights.cli.logger") as mock_logger:
            result = cmd_build_aggregates(args)

        assert result == 1
        mock_logger.error.assert_called_once()
        error_msg = mock_logger.error.call_args[0][0]
        assert "--open" in error_msg
        assert "--port" in error_msg
        assert "--serve" in error_msg

    def test_default_port_without_serve_no_error(self) -> None:
        """Default port (8080) without --serve should NOT error (not explicit usage)."""
        args = Namespace(
            db=Path(
                "nonexistent.sqlite"
            ),  # Will fail later, but not on flag validation
            out=Path("dataset"),
            run_id="local",
            serve=False,
            open=False,
            port=8080,  # Default port - should not trigger error
            enable_predictions=False,
            enable_insights=False,
        )

        with patch("ado_git_repo_insights.cli.logger") as mock_logger:
            result = cmd_build_aggregates(args)

        # Should fail for different reason (db not found), not flag validation
        assert result == 1  # DB not found error, not flag validation
        # Check that the flag validation error was NOT called
        for call in mock_logger.error.call_args_list:
            assert "--serve" not in call[0][0] or "--port" not in call[0][0]


class TestServeFunctionality:
    """Tests for --serve functionality when flags are valid."""

    @patch("ado_git_repo_insights.cli._serve_dashboard")
    @patch("ado_git_repo_insights.cli.AggregateGenerator")
    @patch("ado_git_repo_insights.cli.DatabaseManager")
    def test_serve_called_after_successful_build(
        self,
        mock_db_manager: MagicMock,
        mock_agg_generator: MagicMock,
        mock_serve_dashboard: MagicMock,
        tmp_path: Path,
    ) -> None:
        """Test _serve_dashboard is called after successful aggregate build."""
        # Setup
        db_path = tmp_path / "test.sqlite"
        db_path.touch()
        out_path = tmp_path / "dataset"

        mock_db = MagicMock()
        mock_db_manager.return_value = mock_db

        mock_generator = MagicMock()
        mock_manifest = MagicMock()
        mock_manifest.aggregate_index.weekly_rollups = []
        mock_manifest.aggregate_index.distributions = []
        mock_manifest.warnings = []
        mock_generator.generate_all.return_value = mock_manifest
        mock_agg_generator.return_value = mock_generator

        mock_serve_dashboard.return_value = 0

        args = Namespace(
            db=db_path,
            out=out_path,
            run_id="local",
            serve=True,
            open=True,
            port=3000,
            enable_predictions=False,
            enable_insights=False,
        )

        # Execute
        result = cmd_build_aggregates(args)

        # Verify
        assert result == 0
        mock_serve_dashboard.assert_called_once_with(
            dataset_path=out_path.resolve(),
            port=3000,
            open_browser=True,
        )

    @patch("ado_git_repo_insights.cli._serve_dashboard")
    @patch("ado_git_repo_insights.cli.AggregateGenerator")
    @patch("ado_git_repo_insights.cli.DatabaseManager")
    def test_serve_not_called_without_flag(
        self,
        mock_db_manager: MagicMock,
        mock_agg_generator: MagicMock,
        mock_serve_dashboard: MagicMock,
        tmp_path: Path,
    ) -> None:
        """Test _serve_dashboard is NOT called when --serve is not set."""
        # Setup
        db_path = tmp_path / "test.sqlite"
        db_path.touch()
        out_path = tmp_path / "dataset"

        mock_db = MagicMock()
        mock_db_manager.return_value = mock_db

        mock_generator = MagicMock()
        mock_manifest = MagicMock()
        mock_manifest.aggregate_index.weekly_rollups = []
        mock_manifest.aggregate_index.distributions = []
        mock_manifest.warnings = []
        mock_generator.generate_all.return_value = mock_manifest
        mock_agg_generator.return_value = mock_generator

        args = Namespace(
            db=db_path,
            out=out_path,
            run_id="local",
            serve=False,  # No serve flag
            open=False,
            port=8080,
            enable_predictions=False,
            enable_insights=False,
        )

        # Execute
        result = cmd_build_aggregates(args)

        # Verify
        assert result == 0
        mock_serve_dashboard.assert_not_called()

    @patch("ado_git_repo_insights.cli._serve_dashboard")
    @patch("ado_git_repo_insights.cli.AggregateGenerator")
    @patch("ado_git_repo_insights.cli.DatabaseManager")
    def test_serve_not_called_on_build_failure(
        self,
        mock_db_manager: MagicMock,
        mock_agg_generator: MagicMock,
        mock_serve_dashboard: MagicMock,
        tmp_path: Path,
    ) -> None:
        """Test _serve_dashboard is NOT called when build fails (FR-006)."""
        from ado_git_repo_insights.transform.aggregators import AggregationError

        # Setup
        db_path = tmp_path / "test.sqlite"
        db_path.touch()
        out_path = tmp_path / "dataset"

        mock_db = MagicMock()
        mock_db_manager.return_value = mock_db

        mock_generator = MagicMock()
        mock_generator.generate_all.side_effect = AggregationError("Build failed")
        mock_agg_generator.return_value = mock_generator

        args = Namespace(
            db=db_path,
            out=out_path,
            run_id="local",
            serve=True,
            open=True,
            port=3000,
            enable_predictions=False,
            enable_insights=False,
        )

        # Execute
        result = cmd_build_aggregates(args)

        # Verify - should fail and NOT call serve
        assert result == 1
        mock_serve_dashboard.assert_not_called()


# =============================================================================
# STAGE-ARTIFACTS --serve tests (PROD workflow)
# =============================================================================


class TestStageArtifactsServeFlagParsing:
    """Tests for --serve, --open, --port argument parsing on stage-artifacts."""

    def test_serve_flag_accepted(self) -> None:
        """Test --serve flag is accepted by stage-artifacts."""
        parser = create_parser()
        args = parser.parse_args(
            [
                "stage-artifacts",
                "--org",
                "myorg",
                "--project",
                "myproj",
                "--pipeline-id",
                "123",
                "--pat",
                "secret",
                "--serve",
            ]
        )
        assert args.serve is True

    def test_serve_with_open_accepted(self) -> None:
        """Test --serve --open combination is accepted."""
        parser = create_parser()
        args = parser.parse_args(
            [
                "stage-artifacts",
                "--org",
                "myorg",
                "--project",
                "myproj",
                "--pipeline-id",
                "123",
                "--pat",
                "secret",
                "--serve",
                "--open",
            ]
        )
        assert args.serve is True
        assert args.open is True

    def test_serve_with_port_accepted(self) -> None:
        """Test --serve --port combination is accepted."""
        parser = create_parser()
        args = parser.parse_args(
            [
                "stage-artifacts",
                "--org",
                "myorg",
                "--project",
                "myproj",
                "--pipeline-id",
                "123",
                "--pat",
                "secret",
                "--serve",
                "--port",
                "3000",
            ]
        )
        assert args.serve is True
        assert args.port == 3000

    def test_default_serve_is_false(self) -> None:
        """Test default serve is False (backward compatibility)."""
        parser = create_parser()
        args = parser.parse_args(
            [
                "stage-artifacts",
                "--org",
                "myorg",
                "--project",
                "myproj",
                "--pipeline-id",
                "123",
                "--pat",
                "secret",
            ]
        )
        assert args.serve is False


class TestStageArtifactsInvalidFlagCombinations:
    """Tests for invalid flag combination errors on stage-artifacts."""

    def test_open_without_serve_error(self) -> None:
        """--open without --serve should error."""
        from ado_git_repo_insights.cli import cmd_stage_artifacts

        args = Namespace(
            org="myorg",
            project="myproj",
            pipeline_id=123,
            pat="secret",
            artifact="aggregates",
            out=Path("./run_artifacts"),
            run_id=None,
            serve=False,
            open=True,
            port=8080,
        )

        with patch("ado_git_repo_insights.cli.logger") as mock_logger:
            result = cmd_stage_artifacts(args)

        assert result == 1
        mock_logger.error.assert_called_once()
        error_msg = mock_logger.error.call_args[0][0]
        assert "--open" in error_msg
        assert "--serve" in error_msg

    def test_port_without_serve_error(self) -> None:
        """--port (non-default) without --serve should error."""
        from ado_git_repo_insights.cli import cmd_stage_artifacts

        args = Namespace(
            org="myorg",
            project="myproj",
            pipeline_id=123,
            pat="secret",
            artifact="aggregates",
            out=Path("./run_artifacts"),
            run_id=None,
            serve=False,
            open=False,
            port=3000,  # Non-default port
        )

        with patch("ado_git_repo_insights.cli.logger") as mock_logger:
            result = cmd_stage_artifacts(args)

        assert result == 1
        mock_logger.error.assert_called_once()
        error_msg = mock_logger.error.call_args[0][0]
        assert "--port" in error_msg
        assert "--serve" in error_msg

    def test_open_and_port_without_serve_error(self) -> None:
        """--open and --port without --serve should error listing both."""
        from ado_git_repo_insights.cli import cmd_stage_artifacts

        args = Namespace(
            org="myorg",
            project="myproj",
            pipeline_id=123,
            pat="secret",
            artifact="aggregates",
            out=Path("./run_artifacts"),
            run_id=None,
            serve=False,
            open=True,
            port=3000,
        )

        with patch("ado_git_repo_insights.cli.logger") as mock_logger:
            result = cmd_stage_artifacts(args)

        assert result == 1
        mock_logger.error.assert_called_once()
        error_msg = mock_logger.error.call_args[0][0]
        assert "--open" in error_msg
        assert "--port" in error_msg
        assert "--serve" in error_msg
