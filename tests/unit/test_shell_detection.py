"""Unit tests for shell detection utilities."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

from ado_git_repo_insights.utils.shell_detection import (
    UnsupportedShellError,
    detect_shell,
    get_shell_config_path,
    is_supported_shell,
)


class TestDetectShell:
    """Tests for detect_shell() function."""

    def test_detects_powershell_via_psmodulepath(self) -> None:
        """PowerShell is detected when PSModulePath is set."""
        with patch.dict(os.environ, {"PSModulePath": "C:\\Program Files\\PowerShell"}):
            assert detect_shell() == "powershell"

    def test_detects_zsh_via_shell_env(self) -> None:
        """zsh is detected from SHELL environment variable."""
        with patch.dict(
            os.environ, {"SHELL": "/bin/zsh", "PSModulePath": ""}, clear=False
        ):
            # Clear PSModulePath to avoid PowerShell detection
            env = os.environ.copy()
            env.pop("PSModulePath", None)
            with patch.dict(os.environ, env, clear=True):
                with patch.dict(os.environ, {"SHELL": "/bin/zsh"}):
                    assert detect_shell() == "zsh"

    def test_detects_bash_via_shell_env(self) -> None:
        """bash is detected from SHELL environment variable."""
        # Clear PSModulePath and set SHELL to bash
        with patch.dict(os.environ, {"SHELL": "/bin/bash"}, clear=True):
            assert detect_shell() == "bash"

    def test_defaults_to_cmd_on_windows_without_powershell(self) -> None:
        """Windows without PowerShell markers defaults to cmd."""
        env = {"SHELL": ""}
        with patch.dict(os.environ, env, clear=True):
            with patch.object(sys, "platform", "win32"):
                assert detect_shell() == "cmd"

    def test_defaults_to_bash_on_unix_without_shell_env(self) -> None:
        """Unix without SHELL env defaults to bash."""
        env = {"SHELL": ""}
        with patch.dict(os.environ, env, clear=True):
            with patch.object(sys, "platform", "linux"):
                assert detect_shell() == "bash"

    def test_powershell_takes_precedence_over_shell_env(self) -> None:
        """PSModulePath takes precedence over SHELL variable."""
        with patch.dict(
            os.environ,
            {"PSModulePath": "/usr/local/share/powershell", "SHELL": "/bin/zsh"},
        ):
            assert detect_shell() == "powershell"


class TestGetShellConfigPath:
    """Tests for get_shell_config_path() function."""

    def test_zsh_returns_zshrc(self) -> None:
        """zsh returns ~/.zshrc."""
        path = get_shell_config_path("zsh")
        assert path == Path.home() / ".zshrc"

    def test_bash_returns_bashrc_on_linux(self) -> None:
        """bash returns ~/.bashrc on Linux."""
        with patch.object(sys, "platform", "linux"):
            path = get_shell_config_path("bash")
            assert path == Path.home() / ".bashrc"

    def test_bash_prefers_bash_profile_on_macos_if_exists(self) -> None:
        """bash prefers ~/.bash_profile on macOS if it exists."""
        with patch.object(sys, "platform", "darwin"):
            # Mock .bash_profile existence
            with patch.object(Path, "exists", return_value=True):
                path = get_shell_config_path("bash")
                assert path == Path.home() / ".bash_profile"

    def test_bash_falls_back_to_bashrc_on_macos(self) -> None:
        """bash falls back to ~/.bashrc on macOS if .bash_profile doesn't exist."""
        with patch.object(sys, "platform", "darwin"):
            # Mock .bash_profile not existing
            original_exists = Path.exists

            def mock_exists(self: Path) -> bool:
                if self.name == ".bash_profile":
                    return False
                return original_exists(self)

            with patch.object(Path, "exists", mock_exists):
                path = get_shell_config_path("bash")
                assert path == Path.home() / ".bashrc"

    def test_powershell_uses_profile_env_if_set(self) -> None:
        """PowerShell uses $PROFILE if set."""
        with patch.dict(os.environ, {"PROFILE": "/custom/profile.ps1"}):
            path = get_shell_config_path("powershell")
            assert path == Path("/custom/profile.ps1")

    def test_powershell_windows_default(self) -> None:
        """PowerShell uses Windows default path."""
        env = os.environ.copy()
        env.pop("PROFILE", None)
        with patch.dict(os.environ, env, clear=True):
            with patch.object(sys, "platform", "win32"):
                path = get_shell_config_path("powershell")
                expected = (
                    Path.home()
                    / "Documents"
                    / "PowerShell"
                    / "Microsoft.PowerShell_profile.ps1"
                )
                assert path == expected

    def test_powershell_unix_default(self) -> None:
        """PowerShell uses Unix default path."""
        env = os.environ.copy()
        env.pop("PROFILE", None)
        with patch.dict(os.environ, env, clear=True):
            with patch.object(sys, "platform", "linux"):
                path = get_shell_config_path("powershell")
                expected = (
                    Path.home()
                    / ".config"
                    / "powershell"
                    / "Microsoft.PowerShell_profile.ps1"
                )
                assert path == expected

    def test_cmd_raises_unsupported_error(self) -> None:
        """cmd raises UnsupportedShellError."""
        with pytest.raises(UnsupportedShellError) as exc_info:
            get_shell_config_path("cmd")
        assert "CMD does not support" in str(exc_info.value)

    def test_unknown_shell_raises_unsupported_error(self) -> None:
        """Unknown shells raise UnsupportedShellError."""
        with pytest.raises(UnsupportedShellError) as exc_info:
            get_shell_config_path("fish")
        assert "not supported" in str(exc_info.value)


class TestIsSupportedShell:
    """Tests for is_supported_shell() function."""

    def test_bash_is_supported(self) -> None:
        """bash is a supported shell."""
        assert is_supported_shell("bash") is True

    def test_zsh_is_supported(self) -> None:
        """zsh is a supported shell."""
        assert is_supported_shell("zsh") is True

    def test_powershell_is_supported(self) -> None:
        """PowerShell is a supported shell."""
        assert is_supported_shell("powershell") is True

    def test_cmd_is_not_supported(self) -> None:
        """cmd is not a supported shell."""
        assert is_supported_shell("cmd") is False

    def test_fish_is_not_supported(self) -> None:
        """fish is not a supported shell (best-effort only)."""
        assert is_supported_shell("fish") is False

    def test_nushell_is_not_supported(self) -> None:
        """nushell is not a supported shell (best-effort only)."""
        assert is_supported_shell("nushell") is False
