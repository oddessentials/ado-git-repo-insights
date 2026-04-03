"""Tests for CLI module - argument parsing only."""

from pathlib import Path

import pytest

from ado_git_repo_insights.cli import create_parser


class TestArgumentParsing:
    """Tests for CLI argument parsing."""

    def test_version_flag_exits_zero(self, capsys: pytest.CaptureFixture) -> None:
        """--version flag prints version and exits 0 (T-01, FR-001/FR-002)."""
        import re

        parser = create_parser()
        with pytest.raises(SystemExit) as exc_info:
            parser.parse_args(["--version"])
        assert exc_info.value.code == 0
        captured = capsys.readouterr()
        assert "ado-insights" in captured.out
        version = captured.out.strip().split()[-1]
        assert re.match(r"^\d+\.\d+\.\d+", version), f"Not a valid version: {version}"
        assert version != "0.0.0", "Version must not be the unresolved sentinel"

    def test_extract_command_required_args(self) -> None:
        parser = create_parser()
        args = parser.parse_args(["extract", "--pat", "test-pat"])
        assert args.command == "extract"
        assert args.pat == "test-pat"

    def test_generate_csv_command(self) -> None:
        parser = create_parser()
        args = parser.parse_args(
            [
                "generate-csv",
                "--database",
                "test.db",
                "--output",
                "csv_out",
            ]
        )
        assert args.command == "generate-csv"
        assert args.database == Path("test.db")

    def test_default_artifacts_dir(self) -> None:
        parser = create_parser()
        args = parser.parse_args(["extract", "--pat", "x"])
        assert args.artifacts_dir == Path("run_artifacts")

    def test_build_aggregates_command(self) -> None:
        """Test build-aggregates command parses correctly (Phase 6)."""
        parser = create_parser()
        args = parser.parse_args(
            [
                "build-aggregates",
                "--db",
                "test.sqlite",
                "--out",
                "./my-dataset",
            ]
        )
        assert args.command == "build-aggregates"
        assert args.db == Path("test.sqlite")
        assert args.out == Path("./my-dataset")

    def test_build_aggregates_default_out(self) -> None:
        """Test build-aggregates uses default output directory."""
        parser = create_parser()
        args = parser.parse_args(["build-aggregates", "--db", "test.sqlite"])
        assert args.out == Path("dataset")

    def test_build_aggregates_with_ml_flags(self) -> None:
        """Test build-aggregates with ML feature flags."""
        parser = create_parser()
        args = parser.parse_args(
            [
                "build-aggregates",
                "--db",
                "test.sqlite",
                "--enable-predictions",
                "--enable-insights",
            ]
        )
        assert args.enable_predictions is True
        assert args.enable_insights is True

    def test_dashboard_command(self) -> None:
        """Test dashboard command parses correctly (Phase 6)."""
        parser = create_parser()
        args = parser.parse_args(
            [
                "dashboard",
                "--dataset",
                "./my-dataset",
                "--port",
                "9000",
            ]
        )
        assert args.command == "dashboard"
        assert args.dataset == Path("./my-dataset")
        assert args.port == 9000

    def test_dashboard_default_port(self) -> None:
        """Test dashboard uses default port 8080."""
        parser = create_parser()
        args = parser.parse_args(["dashboard", "--dataset", "./dataset"])
        assert args.port == 8080

    def test_dashboard_open_flag(self) -> None:
        """Test dashboard --open flag."""
        parser = create_parser()
        args = parser.parse_args(["dashboard", "--dataset", "./dataset", "--open"])
        assert args.open is True
