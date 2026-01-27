"""Unit tests for setup-path command."""

from __future__ import annotations

from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

import pytest

from ado_git_repo_insights.commands.setup_path import (
    SENTINEL_END,
    SENTINEL_START,
    _format_path_block,
    _has_existing_config,
    _remove_existing_config,
    cmd_setup_path,
)


class TestFormatPathBlock:
    """Tests for _format_path_block() function."""

    def test_bash_block_format(self) -> None:
        """bash block uses export syntax with sentinels."""
        scripts_dir = Path("/home/user/.local/bin")
        block = _format_path_block(scripts_dir, "bash")

        assert SENTINEL_START in block
        assert SENTINEL_END in block
        assert "export PATH=" in block
        assert str(scripts_dir) in block

    def test_powershell_block_format(self) -> None:
        """PowerShell block uses $env:PATH syntax with sentinels."""
        scripts_dir = Path("C:/Users/user/Scripts")
        block = _format_path_block(scripts_dir, "powershell")

        assert SENTINEL_START in block
        assert SENTINEL_END in block
        assert "$env:PATH" in block
        assert str(scripts_dir) in block


class TestHasExistingConfig:
    """Tests for _has_existing_config() function."""

    def test_returns_true_when_sentinel_present(self) -> None:
        """Returns True when sentinel markers are found."""
        content = f"some content\n{SENTINEL_START}\nexport PATH=...\n{SENTINEL_END}\nmore content"
        assert _has_existing_config(content) is True

    def test_returns_false_when_no_sentinel(self) -> None:
        """Returns False when no sentinel markers."""
        content = "some shell config\nexport PATH=/usr/bin\n"
        assert _has_existing_config(content) is False

    def test_returns_false_for_empty_content(self) -> None:
        """Returns False for empty content."""
        assert _has_existing_config("") is False


class TestRemoveExistingConfig:
    """Tests for _remove_existing_config() function."""

    def test_removes_sentinel_block(self) -> None:
        """Removes the entire sentinel block."""
        content = (
            f"before\n{SENTINEL_START}\nexport PATH=something\n{SENTINEL_END}\nafter"
        )
        result = _remove_existing_config(content)

        assert SENTINEL_START not in result
        assert SENTINEL_END not in result
        assert "before" in result
        assert "after" in result
        assert "export PATH=something" not in result

    def test_preserves_other_content(self) -> None:
        """Preserves content outside the sentinel block."""
        content = (
            "# My custom config\n"
            f"{SENTINEL_START}\n"
            "export PATH=something\n"
            f"{SENTINEL_END}\n"
            "# End of file"
        )
        result = _remove_existing_config(content)

        assert "# My custom config" in result
        assert "# End of file" in result


class TestCmdSetupPath:
    """Tests for cmd_setup_path() function."""

    def test_refuses_pipx_installation(self) -> None:
        """Refuses to run for pipx installations."""
        args = Namespace(print_only=False, remove=False)
        with patch(
            "ado_git_repo_insights.commands.setup_path.detect_installation_method",
            return_value="pipx",
        ):
            result = cmd_setup_path(args)
            assert result == 1

    def test_refuses_uv_installation(self) -> None:
        """Refuses to run for uv installations."""
        args = Namespace(print_only=False, remove=False)
        with patch(
            "ado_git_repo_insights.commands.setup_path.detect_installation_method",
            return_value="uv",
        ):
            result = cmd_setup_path(args)
            assert result == 1

    def test_print_only_outputs_command(self, capsys: pytest.CaptureFixture) -> None:
        """--print-only outputs the command without modifying files."""
        args = Namespace(print_only=True, remove=False)
        scripts_dir = Path("/home/user/.local/bin")

        with patch(
            "ado_git_repo_insights.commands.setup_path.detect_installation_method",
            return_value="pip",
        ):
            with patch(
                "ado_git_repo_insights.commands.setup_path.detect_shell",
                return_value="bash",
            ):
                with patch(
                    "ado_git_repo_insights.commands.setup_path.get_scripts_directory",
                    return_value=scripts_dir,
                ):
                    result = cmd_setup_path(args)

        captured = capsys.readouterr()
        assert result == 0
        assert "export PATH=" in captured.out
        assert str(scripts_dir) in captured.out

    def test_reports_already_on_path(self) -> None:
        """Reports when scripts directory is already on PATH."""
        args = Namespace(print_only=False, remove=False)
        scripts_dir = Path("/home/user/.local/bin")

        with patch(
            "ado_git_repo_insights.commands.setup_path.detect_installation_method",
            return_value="pip",
        ):
            with patch(
                "ado_git_repo_insights.commands.setup_path.detect_shell",
                return_value="bash",
            ):
                with patch(
                    "ado_git_repo_insights.commands.setup_path.get_scripts_directory",
                    return_value=scripts_dir,
                ):
                    with patch(
                        "ado_git_repo_insights.commands.setup_path.is_on_path",
                        return_value=True,
                    ):
                        result = cmd_setup_path(args)

        assert result == 0  # Success, no changes needed

    def test_creates_config_file(self, tmp_path: Path) -> None:
        """Creates config file if it doesn't exist."""
        args = Namespace(print_only=False, remove=False)
        scripts_dir = tmp_path / "bin"
        config_path = tmp_path / ".bashrc"

        with patch(
            "ado_git_repo_insights.commands.setup_path.detect_installation_method",
            return_value="pip",
        ):
            with patch(
                "ado_git_repo_insights.commands.setup_path.detect_shell",
                return_value="bash",
            ):
                with patch(
                    "ado_git_repo_insights.commands.setup_path.get_scripts_directory",
                    return_value=scripts_dir,
                ):
                    with patch(
                        "ado_git_repo_insights.commands.setup_path.is_on_path",
                        return_value=False,
                    ):
                        with patch(
                            "ado_git_repo_insights.commands.setup_path.get_shell_config_path",
                            return_value=config_path,
                        ):
                            result = cmd_setup_path(args)

        assert result == 0
        assert config_path.exists()
        content = config_path.read_text()
        assert SENTINEL_START in content
        assert str(scripts_dir) in content

    def test_idempotent_no_duplicate(self, tmp_path: Path) -> None:
        """Running twice doesn't duplicate PATH entries."""
        args = Namespace(print_only=False, remove=False)
        scripts_dir = tmp_path / "bin"
        config_path = tmp_path / ".bashrc"

        # Create config with existing sentinel block
        existing_content = f"{SENTINEL_START}\nexport PATH=old\n{SENTINEL_END}\n"
        config_path.write_text(existing_content)

        with patch(
            "ado_git_repo_insights.commands.setup_path.detect_installation_method",
            return_value="pip",
        ):
            with patch(
                "ado_git_repo_insights.commands.setup_path.detect_shell",
                return_value="bash",
            ):
                with patch(
                    "ado_git_repo_insights.commands.setup_path.get_scripts_directory",
                    return_value=scripts_dir,
                ):
                    with patch(
                        "ado_git_repo_insights.commands.setup_path.is_on_path",
                        return_value=False,
                    ):
                        with patch(
                            "ado_git_repo_insights.commands.setup_path.get_shell_config_path",
                            return_value=config_path,
                        ):
                            result = cmd_setup_path(args)

        assert result == 0
        # Content should be unchanged (already configured)
        content = config_path.read_text()
        assert content.count(SENTINEL_START) == 1

    def test_remove_flag_removes_config(self, tmp_path: Path) -> None:
        """--remove flag removes existing configuration."""
        args = Namespace(print_only=False, remove=True)
        scripts_dir = tmp_path / "bin"
        config_path = tmp_path / ".bashrc"

        # Create config with sentinel block
        existing_content = (
            "# before\n"
            f"{SENTINEL_START}\n"
            f'export PATH="$PATH:{scripts_dir}"\n'
            f"{SENTINEL_END}\n"
            "# after\n"
        )
        config_path.write_text(existing_content)

        with patch(
            "ado_git_repo_insights.commands.setup_path.detect_installation_method",
            return_value="pip",
        ):
            with patch(
                "ado_git_repo_insights.commands.setup_path.detect_shell",
                return_value="bash",
            ):
                with patch(
                    "ado_git_repo_insights.commands.setup_path.get_shell_config_path",
                    return_value=config_path,
                ):
                    result = cmd_setup_path(args)

        assert result == 0
        content = config_path.read_text()
        assert SENTINEL_START not in content
        assert "# before" in content
        assert "# after" in content


class TestEdgeCases:
    """Edge case tests for setup-path command."""

    def test_read_only_config_returns_error(self, tmp_path: Path) -> None:
        """Read-only config file returns error with manual instructions."""
        import stat

        from ado_git_repo_insights.commands.setup_path import _add_path_config

        scripts_dir = tmp_path / "bin"
        config_path = tmp_path / ".bashrc"

        # Create config and make it read-only
        config_path.write_text("# existing config\n")
        config_path.chmod(stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)

        try:
            result = _add_path_config(config_path, scripts_dir, "bash")
            assert result == 1  # Error exit code
        finally:
            # Restore write permissions for cleanup
            config_path.chmod(stat.S_IWUSR | stat.S_IRUSR)
