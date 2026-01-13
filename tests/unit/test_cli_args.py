"""Tests for CLI module - argument parsing only."""

from pathlib import Path

from ado_git_repo_insights.cli import create_parser


class TestArgumentParsing:
    """Tests for CLI argument parsing."""

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
