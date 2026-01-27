"""Unit tests for doctor command."""

from __future__ import annotations

from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

import pytest

from ado_git_repo_insights.commands.doctor import (
    _get_version,
    _print_conflict_recommendations,
    cmd_doctor,
)


class TestGetVersion:
    """Tests for _get_version() function."""

    def test_returns_string(self) -> None:
        """Returns a string."""
        result = _get_version()
        assert isinstance(result, str)

    def test_returns_version_or_unknown(self) -> None:
        """Returns either a version string or 'unknown'."""
        result = _get_version()
        assert result == "unknown" or "." in result  # Version strings contain dots


class TestCmdDoctor:
    """Tests for cmd_doctor() function."""

    def test_outputs_structured_report(self, capsys: pytest.CaptureFixture) -> None:
        """Outputs a structured diagnostic report."""
        args = Namespace()

        with patch(
            "ado_git_repo_insights.commands.doctor.detect_installation_method",
            return_value="pip",
        ):
            with patch(
                "ado_git_repo_insights.commands.doctor.detect_shell",
                return_value="bash",
            ):
                with patch(
                    "ado_git_repo_insights.commands.doctor.get_scripts_directory",
                    return_value=Path("/home/user/.local/bin"),
                ):
                    with patch(
                        "ado_git_repo_insights.commands.doctor.is_on_path",
                        return_value=True,
                    ):
                        with patch(
                            "ado_git_repo_insights.commands.doctor.find_all_installations",
                            return_value=[],
                        ):
                            cmd_doctor(args)

        captured = capsys.readouterr()

        # Check for required sections
        assert "ado-insights doctor" in captured.out
        assert "Executable:" in captured.out
        assert "Version:" in captured.out
        assert "Python:" in captured.out
        assert "Installation Method:" in captured.out
        assert "Environment" in captured.out
        assert "Scripts Directory:" in captured.out
        assert "On PATH:" in captured.out
        assert "Status:" in captured.out

    def test_returns_zero_when_no_issues(self) -> None:
        """Returns 0 when no issues detected."""
        args = Namespace()

        with patch(
            "ado_git_repo_insights.commands.doctor.detect_installation_method",
            return_value="pipx",
        ):
            with patch(
                "ado_git_repo_insights.commands.doctor.detect_shell",
                return_value="bash",
            ):
                with patch(
                    "ado_git_repo_insights.commands.doctor.get_scripts_directory",
                    return_value=Path("/home/user/.local/bin"),
                ):
                    with patch(
                        "ado_git_repo_insights.commands.doctor.is_on_path",
                        return_value=True,
                    ):
                        with patch(
                            "ado_git_repo_insights.commands.doctor.find_all_installations",
                            return_value=[
                                (Path("/home/user/.local/bin/ado-insights"), "pipx")
                            ],
                        ):
                            result = cmd_doctor(args)

        assert result == 0

    def test_returns_one_when_conflicts_detected(
        self, capsys: pytest.CaptureFixture
    ) -> None:
        """Returns 1 when conflicts detected."""
        args = Namespace()
        installations = [
            (Path("/home/user/.local/pipx/venvs/pkg/bin/ado-insights"), "pipx"),
            (Path("/home/user/.local/bin/ado-insights"), "pip"),
        ]

        with patch(
            "ado_git_repo_insights.commands.doctor.detect_installation_method",
            return_value="pipx",
        ):
            with patch(
                "ado_git_repo_insights.commands.doctor.detect_shell",
                return_value="bash",
            ):
                with patch(
                    "ado_git_repo_insights.commands.doctor.get_scripts_directory",
                    return_value=Path("/home/user/.local/bin"),
                ):
                    with patch(
                        "ado_git_repo_insights.commands.doctor.is_on_path",
                        return_value=True,
                    ):
                        with patch(
                            "ado_git_repo_insights.commands.doctor.find_all_installations",
                            return_value=installations,
                        ):
                            result = cmd_doctor(args)

        captured = capsys.readouterr()
        assert result == 1
        assert "Multiple installations found" in captured.out
        assert "Conflicts" in captured.out

    def test_reports_path_issue_for_pip(self, capsys: pytest.CaptureFixture) -> None:
        """Reports PATH issue when pip install and scripts not on PATH."""
        args = Namespace()

        with patch(
            "ado_git_repo_insights.commands.doctor.detect_installation_method",
            return_value="pip",
        ):
            with patch(
                "ado_git_repo_insights.commands.doctor.detect_shell",
                return_value="bash",
            ):
                with patch(
                    "ado_git_repo_insights.commands.doctor.get_scripts_directory",
                    return_value=Path("/home/user/.local/bin"),
                ):
                    with patch(
                        "ado_git_repo_insights.commands.doctor.is_on_path",
                        return_value=False,
                    ):
                        with patch(
                            "ado_git_repo_insights.commands.doctor.find_all_installations",
                            return_value=[],
                        ):
                            result = cmd_doctor(args)

        captured = capsys.readouterr()
        assert result == 1
        assert "PATH Issue Detected" in captured.out
        assert "setup-path" in captured.out

    def test_output_is_stable_and_line_oriented(
        self, capsys: pytest.CaptureFixture
    ) -> None:
        """Output is stable, line-oriented, and free of emojis/ANSI."""
        args = Namespace()

        with patch(
            "ado_git_repo_insights.commands.doctor.detect_installation_method",
            return_value="pip",
        ):
            with patch(
                "ado_git_repo_insights.commands.doctor.detect_shell",
                return_value="bash",
            ):
                with patch(
                    "ado_git_repo_insights.commands.doctor.get_scripts_directory",
                    return_value=Path("/home/user/.local/bin"),
                ):
                    with patch(
                        "ado_git_repo_insights.commands.doctor.is_on_path",
                        return_value=True,
                    ):
                        with patch(
                            "ado_git_repo_insights.commands.doctor.find_all_installations",
                            return_value=[],
                        ):
                            cmd_doctor(args)

        captured = capsys.readouterr()

        # Check no ANSI escape codes
        assert "\x1b[" not in captured.out
        assert "\033[" not in captured.out

        # Check no common emojis (basic check)
        emoji_ranges = [
            ("\U0001f600", "\U0001f64f"),  # Emoticons
            ("\U0001f300", "\U0001f5ff"),  # Misc symbols
            ("\U0001f680", "\U0001f6ff"),  # Transport
        ]
        for start, end in emoji_ranges:
            for char in captured.out:
                assert not (start <= char <= end), f"Found emoji: {char}"


class TestPrintConflictRecommendations:
    """Tests for _print_conflict_recommendations() function."""

    def test_recommends_removing_pip_when_pipx_present(
        self, capsys: pytest.CaptureFixture
    ) -> None:
        """Recommends removing pip when pipx is present."""
        installations = [
            (Path("/pipx/path"), "pipx"),
            (Path("/pip/path"), "pip"),
        ]
        _print_conflict_recommendations(installations)

        captured = capsys.readouterr()
        assert "pip uninstall" in captured.out
        assert "pipx" in captured.out.lower()

    def test_recommends_removing_pip_when_uv_present(
        self, capsys: pytest.CaptureFixture
    ) -> None:
        """Recommends removing pip when uv is present."""
        installations = [
            (Path("/uv/path"), "uv"),
            (Path("/pip/path"), "pip"),
        ]
        _print_conflict_recommendations(installations)

        captured = capsys.readouterr()
        assert "pip uninstall" in captured.out

    def test_offers_choice_when_pipx_and_uv(
        self, capsys: pytest.CaptureFixture
    ) -> None:
        """Offers choice when both pipx and uv are present."""
        installations = [
            (Path("/pipx/path"), "pipx"),
            (Path("/uv/path"), "uv"),
        ]
        _print_conflict_recommendations(installations)

        captured = capsys.readouterr()
        assert "pipx" in captured.out.lower()
        assert "uv" in captured.out.lower()
        assert "preference" in captured.out.lower()
