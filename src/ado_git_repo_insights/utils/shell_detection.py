"""Cross-platform shell detection utilities.

This module provides reliable shell detection across Windows, macOS, and Linux,
following research.md R1 and R2 algorithms.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


class UnsupportedShellError(Exception):
    """Raised when shell is not supported for PATH configuration."""

    pass


def detect_shell() -> str:
    """Detect the current shell environment.

    Detection order (per research.md R1):
    1. Check PSModulePath for PowerShell (cross-platform)
    2. Check SHELL env var (Unix/macOS)
    3. On Windows without PowerShell markers, default to cmd
    4. Fall back to bash if unable to detect on Unix

    Returns:
        Shell name: "powershell", "zsh", "bash", or "cmd"
    """
    # 1. Check if running in PowerShell (cross-platform)
    if os.environ.get("PSModulePath"):
        return "powershell"

    # 2. Check SHELL env var (Unix/macOS)
    shell_path = os.environ.get("SHELL", "")
    if "zsh" in shell_path:
        return "zsh"
    if "bash" in shell_path:
        return "bash"

    # 3. Windows-specific checks
    if sys.platform == "win32":
        # PSModulePath already checked above
        return "cmd"  # Best-effort for CMD

    # 4. Default fallback for Unix
    return "bash"


def get_shell_config_path(shell: str) -> Path:
    """Get the configuration file path for a given shell.

    Configuration files (per research.md R2):
    - bash (Linux): ~/.bashrc
    - bash (macOS): ~/.bash_profile (if exists) or ~/.bashrc
    - zsh: ~/.zshrc
    - PowerShell (Win): $PROFILE or $HOME/Documents/PowerShell/Microsoft.PowerShell_profile.ps1
    - PowerShell (Unix): $PROFILE or ~/.config/powershell/Microsoft.PowerShell_profile.ps1

    Args:
        shell: Shell name from detect_shell()

    Returns:
        Path to shell configuration file

    Raises:
        UnsupportedShellError: If shell is not supported
    """
    home = Path.home()

    if shell == "zsh":
        return home / ".zshrc"

    if shell == "bash":
        if sys.platform == "darwin":
            # macOS uses .bash_profile for login shells
            profile = home / ".bash_profile"
            if profile.exists():
                return profile
        return home / ".bashrc"

    if shell == "powershell":
        # Check $PROFILE first for custom locations
        profile_env = os.environ.get("PROFILE")
        if profile_env:
            return Path(profile_env)
        # Use platform-specific defaults
        if sys.platform == "win32":
            return (
                home / "Documents" / "PowerShell" / "Microsoft.PowerShell_profile.ps1"
            )
        return home / ".config" / "powershell" / "Microsoft.PowerShell_profile.ps1"

    if shell == "cmd":
        # CMD doesn't have a standard user config file
        raise UnsupportedShellError(
            "CMD does not support automatic PATH configuration. "
            "Use PowerShell or set PATH manually via System Properties."
        )

    raise UnsupportedShellError(
        f"Shell '{shell}' is not supported for automatic PATH configuration. "
        "Supported shells: bash, zsh, PowerShell"
    )


def is_supported_shell(shell: str) -> bool:
    """Check if a shell is fully supported for PATH configuration.

    Fully supported shells: bash, zsh, PowerShell
    Best-effort only: fish, nushell, cmd, others

    Args:
        shell: Shell name

    Returns:
        True if shell is fully supported
    """
    return shell in ("bash", "zsh", "powershell")
