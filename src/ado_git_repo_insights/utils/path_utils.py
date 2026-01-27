"""PATH manipulation utilities for CLI distribution.

This module provides cross-platform PATH detection and guidance generation,
following research.md R4, R7, and R3 algorithms.
"""

from __future__ import annotations

import logging
import os
import sys
import sysconfig
from pathlib import Path

logger = logging.getLogger(__name__)


def get_scripts_directory() -> Path:
    """Get the directory where console scripts are installed.

    Uses sysconfig for reliable cross-platform detection (per research.md R4).
    Handles user installs, system installs, and virtual environments.

    Returns:
        Path to scripts directory
    """
    # Get the default scripts path
    scripts_path = sysconfig.get_path("scripts")

    # For user installs (pip install --user), use the user scheme
    # Check if we're in a user install context
    if scripts_path:
        scripts_path_obj = Path(scripts_path)
        # If path doesn't exist or looks like a system path, check user scheme
        if not scripts_path_obj.exists():
            scheme = "posix_user" if sys.platform != "win32" else "nt_user"
            user_scripts = sysconfig.get_path("scripts", scheme)
            if user_scripts:
                return Path(user_scripts)

    return Path(scripts_path) if scripts_path else Path.home() / ".local" / "bin"


def is_on_path(directory: Path) -> bool:
    """Check if a directory is on the system PATH.

    Uses path resolution to handle symlinks and case differences (per research.md R7).

    Args:
        directory: Directory to check

    Returns:
        True if directory is on PATH
    """
    try:
        dir_resolved = str(directory.resolve())
    except (OSError, ValueError) as e:
        logger.debug(f"Failed to resolve directory '{directory}': {e}")
        return False

    path_dirs = os.environ.get("PATH", "").split(os.pathsep)

    for path_dir in path_dirs:
        if not path_dir:
            continue
        try:
            if str(Path(path_dir).resolve()) == dir_resolved:
                return True
        except (OSError, ValueError) as e:
            # Invalid path entry, skip
            logger.debug(f"Skipping invalid PATH entry '{path_dir}': {e}")
            continue

    return False


def format_path_guidance(scripts_dir: Path, shell: str) -> str:
    """Generate shell-specific PATH guidance for users.

    Args:
        scripts_dir: Scripts directory to add to PATH
        shell: Shell name from detect_shell()

    Returns:
        Human-readable instructions with copy/paste command
    """
    scripts_str = str(scripts_dir)

    if shell == "powershell":
        command = f'$env:PATH = "$env:PATH;{scripts_str}"'
        permanent_hint = (
            "To make this permanent, add the line to your PowerShell profile:\n"
            "  notepad $PROFILE"
        )
    elif shell == "cmd":
        command = f"set PATH=%PATH%;{scripts_str}"
        permanent_hint = (
            "To make this permanent, use System Properties > Environment Variables,\n"
            'or run: setx PATH "%PATH%;{scripts_str}"'
        )
    else:
        # bash, zsh, and other Unix shells
        command = f'export PATH="$PATH:{scripts_str}"'
        if shell == "zsh":
            config_file = "~/.zshrc"
        elif shell == "bash":
            config_file = "~/.bashrc (or ~/.bash_profile on macOS)"
        else:
            config_file = "your shell configuration file"
        permanent_hint = f"To make this permanent, add the line to {config_file}"

    return (
        f"The ado-insights scripts directory is not on your PATH.\n"
        f"\n"
        f"Scripts directory: {scripts_str}\n"
        f"\n"
        f"To add it temporarily, run:\n"
        f"  {command}\n"
        f"\n"
        f"{permanent_hint}\n"
        f"\n"
        f"Or run: ado-insights setup-path"
    )


def format_path_command(scripts_dir: Path, shell: str) -> str:
    """Generate the PATH modification command for a shell.

    Used by --print-only to output just the command (per research.md R9).

    Args:
        scripts_dir: Scripts directory to add to PATH
        shell: Shell name

    Returns:
        Shell command to add directory to PATH
    """
    scripts_str = str(scripts_dir)

    if shell == "powershell":
        return f'$env:PATH = "$env:PATH;{scripts_str}"'
    elif shell == "cmd":
        return f"set PATH=%PATH%;{scripts_str}"
    else:
        # bash, zsh, and other Unix shells
        return f'export PATH="$PATH:{scripts_str}"'


def format_unsupported_shell_guidance(scripts_dir: Path, shell: str) -> str:
    """Generate best-effort guidance for unsupported shells.

    Args:
        scripts_dir: Scripts directory to add to PATH
        shell: Shell name (fish, nushell, etc.)

    Returns:
        Best-effort guidance message
    """
    scripts_str = str(scripts_dir)

    if shell == "fish":
        command = f"set -gx PATH $PATH {scripts_str}"
        config_hint = "Add to ~/.config/fish/config.fish"
    elif shell == "nushell":
        command = f'$env.PATH = ($env.PATH | append "{scripts_str}")'
        config_hint = "Add to your Nushell config"
    else:
        command = f"(shell-specific syntax to add {scripts_str} to PATH)"
        config_hint = "Consult your shell's documentation"

    return (
        f"Shell '{shell}' is not fully supported. Best-effort guidance:\n"
        f"\n"
        f"Scripts directory: {scripts_str}\n"
        f"Suggested command: {command}\n"
        f"{config_hint}\n"
        f"\n"
        f"For full support, use bash, zsh, or PowerShell."
    )
