"""doctor command implementation.

This command provides installation diagnostics and conflict detection.
Per spec FR-014 through FR-018 and plan.md D3.
"""

from __future__ import annotations

import logging
import sys
from argparse import Namespace
from pathlib import Path

from ..utils.install_detection import (
    detect_installation_method,
    find_all_installations,
    get_uninstall_command,
)
from ..utils.path_utils import get_scripts_directory, is_on_path
from ..utils.shell_detection import detect_shell

logger = logging.getLogger(__name__)


def _get_version() -> str:
    """Get the installed version of ado-insights.

    Returns:
        Version string or 'unknown'
    """
    try:
        from importlib.metadata import PackageNotFoundError, version

        return version("ado-git-repo-insights")
    except PackageNotFoundError:
        return "unknown"


def cmd_doctor(args: Namespace) -> int:
    """Execute the doctor command.

    Outputs a deterministic diagnostic report showing:
    - Executable location
    - Python environment
    - Installation method
    - PATH status
    - Conflict detection
    - Recommended fixes

    Output is stable, line-oriented, and free of emojis/ANSI color (per T033).

    Args:
        args: Parsed command line arguments

    Returns:
        Exit code (0 for OK, 1 for issues detected)
    """
    issues_found = False

    # Header
    print("ado-insights doctor")
    print("=" * 40)
    print()

    # Basic information (FR-015, FR-016)
    exe_path = Path(sys.executable).resolve()
    version = _get_version()
    python_version = (
        f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    )
    install_method = detect_installation_method()
    shell = detect_shell()

    print(f"Executable: {exe_path}")
    print(f"Version: {version}")
    print(f"Python: {exe_path} ({python_version})")
    print(f"Installation Method: {install_method}")
    print(f"Detected Shell: {shell}")
    print()

    # Environment section
    print("Environment")
    print("-" * 40)

    scripts_dir = get_scripts_directory()
    on_path = is_on_path(scripts_dir)

    print(f"Scripts Directory: {scripts_dir}")
    print(f"On PATH: {'Yes' if on_path else 'No'}")

    if not on_path and install_method == "pip":
        issues_found = True
        print()
        print("PATH Issue Detected:")
        print("  The scripts directory is not on your PATH.")
        print("  Run: ado-insights setup-path")
    print()

    # Conflict detection (FR-017, FR-018)
    installations = find_all_installations()

    if len(installations) > 1:
        issues_found = True
        print("Conflicts")
        print("-" * 40)
        print("Multiple installations found:")
        for i, (path, method) in enumerate(installations, 1):
            print(f"  {i}. {path} ({method})")
        print()

        # Generate recommendations
        print("Recommendation:")
        _print_conflict_recommendations(installations)
        print()
    elif len(installations) == 1:
        print("Conflicts")
        print("-" * 40)
        print("No conflicts detected.")
        print()

    # Status summary
    if issues_found:
        print("Status: ISSUES_DETECTED")
        return 1
    else:
        print("Status: OK")
        return 0


def _print_conflict_recommendations(
    installations: list[tuple[Path, str]],
) -> None:
    """Print recommendations for resolving conflicts.

    Prioritizes keeping pipx/uv over pip installations.

    Args:
        installations: List of (path, method) tuples
    """
    methods = {method for _, method in installations}

    # Determine what to keep and what to remove
    if "pipx" in methods and "pip" in methods:
        print("  Keep the pipx installation (recommended).")
        print(f"  Run: {get_uninstall_command('pip')}")
    elif "uv" in methods and "pip" in methods:
        print("  Keep the uv installation (recommended).")
        print(f"  Run: {get_uninstall_command('pip')}")
    elif "pipx" in methods and "uv" in methods:
        print("  You have both pipx and uv installations.")
        print("  Keep one and remove the other based on preference:")
        print(f"    To keep pipx: {get_uninstall_command('uv')}")
        print(f"    To keep uv: {get_uninstall_command('pipx')}")
    else:
        # Multiple pip installs or other combinations
        print("  Remove all and reinstall with your preferred method:")
        for _, method in installations:
            if method != "unknown":
                print(f"    {get_uninstall_command(method)}")
        print("  Then reinstall with: pipx install ado-git-repo-insights")
