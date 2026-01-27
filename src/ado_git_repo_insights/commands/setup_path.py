"""setup-path command implementation.

This command provides automated PATH configuration for pip users.
Per spec FR-008 through FR-013 and research.md R3, R8, R9.
"""

from __future__ import annotations

import logging
from argparse import Namespace
from pathlib import Path

from ..utils.install_detection import detect_installation_method
from ..utils.path_utils import (
    format_path_command,
    get_scripts_directory,
    is_on_path,
)
from ..utils.shell_detection import (
    UnsupportedShellError,
    detect_shell,
    get_shell_config_path,
    is_supported_shell,
)

logger = logging.getLogger(__name__)

# Sentinel markers for idempotent PATH modifications (per research.md R3)
SENTINEL_START = "# >>> ado-insights setup-path >>>"
SENTINEL_END = "# <<< ado-insights setup-path <<<"


def _format_path_block(scripts_dir: Path, shell: str) -> str:
    """Format the PATH modification block with sentinel comments.

    Args:
        scripts_dir: Scripts directory to add to PATH
        shell: Shell name

    Returns:
        Complete block with sentinels and PATH command
    """
    command = format_path_command(scripts_dir, shell)
    return f"{SENTINEL_START}\n{command}\n{SENTINEL_END}\n"


def _has_existing_config(content: str) -> bool:
    """Check if configuration already contains our PATH block.

    Args:
        content: File content to check

    Returns:
        True if sentinel markers are found
    """
    return SENTINEL_START in content


def _remove_existing_config(content: str) -> str:
    """Remove existing PATH configuration block.

    Args:
        content: File content

    Returns:
        Content with PATH block removed
    """
    lines = content.split("\n")
    result = []
    skip = False

    for line in lines:
        if SENTINEL_START in line:
            skip = True
            continue
        if SENTINEL_END in line:
            skip = False
            continue
        if not skip:
            result.append(line)

    return "\n".join(result)


def cmd_setup_path(args: Namespace) -> int:
    """Execute the setup-path command.

    Supports:
    - Default: Modify shell config file to add scripts directory to PATH
    - --print-only: Output the command without modifying files
    - --remove: Remove previously added PATH configuration

    Args:
        args: Parsed command line arguments

    Returns:
        Exit code (0 for success, 1 for error)
    """
    print_only = getattr(args, "print_only", False)
    remove = getattr(args, "remove", False)

    # Detect installation method (per T024: refuse if pipx/uv)
    install_method = detect_installation_method()
    if install_method in ("pipx", "uv"):
        logger.error(
            f"setup-path is not needed for {install_method} installations.\n"
            f"{install_method} manages PATH automatically.\n"
            f"If you're having PATH issues, try:\n"
            f"  - For pipx: pipx ensurepath\n"
            f"  - For uv: uv tool update-shell"
        )
        return 1

    # Detect shell
    shell = detect_shell()
    logger.debug(f"Detected shell: {shell}")

    # Get scripts directory
    scripts_dir = get_scripts_directory()
    logger.debug(f"Scripts directory: {scripts_dir}")

    # Handle --print-only mode (per research.md R9)
    if print_only:
        # Output only the command, no extra text
        print(format_path_command(scripts_dir, shell))
        return 0

    # Check if shell is supported
    if not is_supported_shell(shell):
        logger.error(
            f"Shell '{shell}' is not fully supported for automatic PATH configuration.\n"
            f"Supported shells: bash, zsh, PowerShell\n"
            f"\n"
            f"You can manually add this to your shell configuration:\n"
            f"  {format_path_command(scripts_dir, shell)}"
        )
        return 1

    # Get shell config path
    try:
        config_path = get_shell_config_path(shell)
    except UnsupportedShellError as e:
        logger.error(str(e))
        return 1

    logger.debug(f"Config path: {config_path}")

    # Handle --remove mode
    if remove:
        return _remove_path_config(config_path, shell)

    # Check if scripts directory is already on PATH
    if is_on_path(scripts_dir):
        logger.info(f"Scripts directory is already on PATH: {scripts_dir}")
        logger.info("No changes needed.")
        return 0

    # Add PATH configuration
    return _add_path_config(config_path, scripts_dir, shell)


def _add_path_config(config_path: Path, scripts_dir: Path, shell: str) -> int:
    """Add PATH configuration to shell config file.

    Args:
        config_path: Path to shell configuration file
        scripts_dir: Scripts directory to add
        shell: Shell name

    Returns:
        Exit code (0 for success, 1 for error)
    """
    # Read existing content or create empty
    if config_path.exists():
        try:
            content = config_path.read_text(encoding="utf-8")
        except PermissionError:
            logger.error(
                f"Cannot read {config_path}: Permission denied.\n"
                f"\n"
                f"To fix manually, add this line to your shell configuration:\n"
                f"  {format_path_command(scripts_dir, shell)}"
            )
            return 1
    else:
        content = ""
        # Create parent directories if needed
        config_path.parent.mkdir(parents=True, exist_ok=True)

    # Check for idempotency (per research.md R8)
    if _has_existing_config(content):
        logger.info(f"PATH configuration already exists in {config_path}")
        logger.info(
            "No changes needed. Use --remove to remove the existing configuration."
        )
        return 0

    # Append our configuration block
    path_block = _format_path_block(scripts_dir, shell)

    # Ensure content ends with newline before appending
    if content and not content.endswith("\n"):
        content += "\n"

    new_content = content + path_block

    # Write back
    try:
        config_path.write_text(new_content, encoding="utf-8")
    except PermissionError:
        logger.error(
            f"Cannot write to {config_path}: Permission denied.\n"
            f"\n"
            f"To fix manually, add this line to your shell configuration:\n"
            f"  {format_path_command(scripts_dir, shell)}"
        )
        return 1

    # Report success (per FR-010)
    logger.info(f"Modified: {config_path}")
    logger.info(f"Added: {format_path_command(scripts_dir, shell)}")
    logger.info("")
    logger.info("Restart your terminal or run:")
    logger.info(
        f"  source {config_path}" if shell != "powershell" else f"  . {config_path}"
    )
    return 0


def _remove_path_config(config_path: Path, shell: str) -> int:
    """Remove PATH configuration from shell config file.

    Args:
        config_path: Path to shell configuration file
        shell: Shell name

    Returns:
        Exit code (0 for success, 1 for error)
    """
    if not config_path.exists():
        logger.info(f"Configuration file does not exist: {config_path}")
        logger.info("Nothing to remove.")
        return 0

    try:
        content = config_path.read_text(encoding="utf-8")
    except PermissionError:
        logger.error(f"Cannot read {config_path}: Permission denied.")
        return 1

    if not _has_existing_config(content):
        logger.info(f"No ado-insights PATH configuration found in {config_path}")
        logger.info("Nothing to remove.")
        return 0

    # Remove the configuration block
    new_content = _remove_existing_config(content)

    try:
        config_path.write_text(new_content, encoding="utf-8")
    except PermissionError:
        logger.error(f"Cannot write to {config_path}: Permission denied.")
        return 1

    logger.info(f"Removed ado-insights PATH configuration from {config_path}")
    logger.info("")
    logger.info("Restart your terminal or run:")
    logger.info(
        f"  source {config_path}" if shell != "powershell" else f"  . {config_path}"
    )
    return 0
