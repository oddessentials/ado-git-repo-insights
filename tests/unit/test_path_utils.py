"""Unit tests for PATH utilities."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

from ado_git_repo_insights.utils.path_utils import (
    format_path_command,
    format_path_guidance,
    format_unsupported_shell_guidance,
    get_scripts_directory,
    is_on_path,
)


class TestGetScriptsDirectory:
    """Tests for get_scripts_directory() function."""

    def test_returns_path_object(self) -> None:
        """Returns a Path object."""
        result = get_scripts_directory()
        assert isinstance(result, Path)

    def test_returns_non_empty_path(self) -> None:
        """Returns a non-empty path."""
        result = get_scripts_directory()
        assert str(result) != ""


class TestIsOnPath:
    """Tests for is_on_path() function."""

    def test_directory_on_path_returns_true(self) -> None:
        """Returns True when directory is on PATH."""
        # Use the current Python's Scripts directory which should be on PATH
        scripts_dir = get_scripts_directory()
        # Create a mock PATH that includes our directory
        with patch.dict(os.environ, {"PATH": str(scripts_dir)}):
            assert is_on_path(scripts_dir) is True

    def test_directory_not_on_path_returns_false(self) -> None:
        """Returns False when directory is not on PATH."""
        fake_dir = Path("/nonexistent/fake/directory")
        with patch.dict(os.environ, {"PATH": "/usr/bin:/bin"}):
            assert is_on_path(fake_dir) is False

    def test_handles_empty_path(self) -> None:
        """Handles empty PATH gracefully."""
        with patch.dict(os.environ, {"PATH": ""}):
            assert is_on_path(Path("/some/dir")) is False

    def test_handles_invalid_path_entries(self) -> None:
        """Handles invalid entries in PATH gracefully."""
        # Include some potentially invalid entries
        with patch.dict(os.environ, {"PATH": ":::invalid:::"}):
            assert is_on_path(Path("/some/dir")) is False

    def test_resolves_symlinks(self, tmp_path: Path) -> None:
        """Resolves symlinks when checking PATH."""
        # Create a real directory and a symlink to it
        real_dir = tmp_path / "real"
        real_dir.mkdir()

        # On Windows, symlinks may require admin privileges
        if sys.platform != "win32":
            link_dir = tmp_path / "link"
            link_dir.symlink_to(real_dir)

            # Add the symlink to PATH
            with patch.dict(os.environ, {"PATH": str(link_dir)}):
                # The real directory should be detected as on PATH
                assert is_on_path(real_dir) is True


class TestFormatPathGuidance:
    """Tests for format_path_guidance() function."""

    def test_bash_guidance_format(self) -> None:
        """bash guidance includes export command."""
        scripts_dir = Path("/home/user/.local/bin")
        guidance = format_path_guidance(scripts_dir, "bash")

        assert "export PATH=" in guidance
        assert str(scripts_dir) in guidance
        assert "~/.bashrc" in guidance

    def test_zsh_guidance_format(self) -> None:
        """zsh guidance includes export command and zshrc reference."""
        scripts_dir = Path("/home/user/.local/bin")
        guidance = format_path_guidance(scripts_dir, "zsh")

        assert "export PATH=" in guidance
        assert str(scripts_dir) in guidance
        assert "~/.zshrc" in guidance

    def test_powershell_guidance_format(self) -> None:
        """PowerShell guidance includes $env:PATH syntax."""
        scripts_dir = Path("C:/Users/user/Scripts")
        guidance = format_path_guidance(scripts_dir, "powershell")

        assert "$env:PATH" in guidance
        assert str(scripts_dir) in guidance
        assert "$PROFILE" in guidance

    def test_cmd_guidance_format(self) -> None:
        """cmd guidance includes set PATH syntax."""
        scripts_dir = Path("C:/Users/user/Scripts")
        guidance = format_path_guidance(scripts_dir, "cmd")

        assert "set PATH=" in guidance
        assert str(scripts_dir) in guidance
        assert "System Properties" in guidance

    def test_includes_setup_path_hint(self) -> None:
        """Guidance includes hint about setup-path command."""
        scripts_dir = Path("/home/user/.local/bin")
        guidance = format_path_guidance(scripts_dir, "bash")

        assert "ado-insights setup-path" in guidance


class TestFormatPathCommand:
    """Tests for format_path_command() function."""

    def test_bash_command(self) -> None:
        """bash command uses export syntax."""
        scripts_dir = Path("/home/user/.local/bin")
        command = format_path_command(scripts_dir, "bash")

        assert command == f'export PATH="$PATH:{scripts_dir}"'

    def test_zsh_command(self) -> None:
        """zsh command uses export syntax."""
        scripts_dir = Path("/home/user/.local/bin")
        command = format_path_command(scripts_dir, "zsh")

        assert command == f'export PATH="$PATH:{scripts_dir}"'

    def test_powershell_command(self) -> None:
        """PowerShell command uses $env:PATH syntax."""
        scripts_dir = Path("C:/Users/user/Scripts")
        command = format_path_command(scripts_dir, "powershell")

        assert command == f'$env:PATH = "$env:PATH;{scripts_dir}"'

    def test_cmd_command(self) -> None:
        """cmd command uses set PATH syntax."""
        scripts_dir = Path("C:/Users/user/Scripts")
        command = format_path_command(scripts_dir, "cmd")

        assert command == f"set PATH=%PATH%;{scripts_dir}"


class TestFormatUnsupportedShellGuidance:
    """Tests for format_unsupported_shell_guidance() function."""

    def test_fish_guidance(self) -> None:
        """fish receives best-effort guidance."""
        scripts_dir = Path("/home/user/.local/bin")
        guidance = format_unsupported_shell_guidance(scripts_dir, "fish")

        assert "fish" in guidance
        assert "set -gx PATH" in guidance
        assert "config.fish" in guidance
        assert "not fully supported" in guidance

    def test_nushell_guidance(self) -> None:
        """nushell receives best-effort guidance."""
        scripts_dir = Path("/home/user/.local/bin")
        guidance = format_unsupported_shell_guidance(scripts_dir, "nushell")

        assert "nushell" in guidance
        assert "$env.PATH" in guidance
        assert "not fully supported" in guidance

    def test_unknown_shell_guidance(self) -> None:
        """Unknown shells receive generic guidance."""
        scripts_dir = Path("/home/user/.local/bin")
        guidance = format_unsupported_shell_guidance(scripts_dir, "unknown_shell")

        assert "unknown_shell" in guidance
        assert "shell-specific syntax" in guidance
        assert "not fully supported" in guidance

    def test_suggests_supported_shells(self) -> None:
        """Guidance suggests using supported shells."""
        scripts_dir = Path("/home/user/.local/bin")
        guidance = format_unsupported_shell_guidance(scripts_dir, "fish")

        assert "bash" in guidance
        assert "zsh" in guidance
        assert "PowerShell" in guidance
