"""Installation method detection utilities.

This module detects how ado-insights was installed (pipx, uv, pip, etc.)
and finds all installations on PATH for conflict detection.
Following research.md R5 and R6 algorithms.
"""

from __future__ import annotations

import os
import sys
import sysconfig
from pathlib import Path


def detect_installation_method() -> str:
    """Detect how ado-insights was installed.

    Detection logic (per research.md R5):
    - pipx: Path contains pipx/venvs markers
    - uv: Path contains uv/tools markers
    - pip (virtualenv): In a virtualenv but not pipx/uv
    - pip (user): User-level pip install
    - pip (system): System-wide pip install
    - unknown: Cannot determine

    Note:
        exe_path comes from sys.executable, a trusted system value.
        The string matching heuristics are safe for this trusted input.

    Returns:
        Installation method: \"pipx\", \"uv\", \"pip\", or \"unknown\"
    """
    exe_path = Path(sys.executable).resolve()
    exe_str = str(exe_path).lower()

    # Normalize path separators for cross-platform matching
    exe_str_normalized = exe_str.replace("\\", "/")

    # pipx creates venvs in ~/.local/pipx/venvs/ (Unix) or similar on Windows
    if "pipx" in exe_str_normalized and "venvs" in exe_str_normalized:
        return "pipx"

    # uv creates tools in ~/.local/share/uv/tools/ (Unix) or similar on Windows
    if "uv" in exe_str_normalized and "tools" in exe_str_normalized:
        return "uv"

    # Check if in a virtualenv (but not pipx/uv)
    in_venv = hasattr(sys, "real_prefix") or (
        hasattr(sys, "base_prefix") and sys.base_prefix != sys.prefix
    )

    if in_venv:
        return "pip"

    # Check for user install markers
    try:
        scheme = "posix_user" if sys.platform != "win32" else "nt_user"
        user_scripts = sysconfig.get_path("scripts", scheme)
        if user_scripts and exe_str.startswith(str(Path(user_scripts).parent).lower()):
            return "pip"
    except (KeyError, TypeError):
        pass

    # If we can find site-packages in the path, it's likely a pip install
    if "site-packages" in exe_str_normalized:
        return "pip"

    # Cannot determine installation method
    return "unknown"


def detect_installation_method_for_path(exe_path: Path) -> str:
    """Detect installation method for a specific executable path.

    Used by find_all_installations() to classify each found executable.

    Args:
        exe_path: Path to the executable

    Returns:
        Installation method string
    """
    path_str = str(exe_path).lower().replace("\\", "/")

    if "pipx" in path_str and "venvs" in path_str:
        return "pipx"
    if "uv" in path_str and "tools" in path_str:
        return "uv"
    if ".local/bin" in path_str or "scripts" in path_str.lower():
        return "pip"

    return "unknown"


def find_all_installations() -> list[tuple[Path, str]]:
    """Find all ado-insights installations on PATH.

    Searches PATH for all instances of the ado-insights executable
    and deduplicates by resolved path (per research.md R6).

    Returns:
        List of (resolved_path, installation_method) tuples
    """
    exe_name = "ado-insights.exe" if sys.platform == "win32" else "ado-insights"
    installations: list[tuple[Path, str]] = []

    path_dirs = os.environ.get("PATH", "").split(os.pathsep)

    for path_dir in path_dirs:
        if not path_dir:
            continue

        exe_path = Path(path_dir) / exe_name
        try:
            if exe_path.exists():
                resolved = exe_path.resolve()
                method = detect_installation_method_for_path(resolved)
                installations.append((resolved, method))
        except (OSError, ValueError):
            # Invalid path or permission error, skip
            continue

    # Deduplicate by resolved path
    seen: set[Path] = set()
    unique: list[tuple[Path, str]] = []

    for path, method in installations:
        if path not in seen:
            seen.add(path)
            unique.append((path, method))

    return unique


def get_uninstall_command(method: str) -> str:
    """Get the uninstall command for an installation method.

    Args:
        method: Installation method from detect_installation_method()

    Returns:
        Uninstall command string
    """
    if method == "pipx":
        return "pipx uninstall ado-git-repo-insights"
    elif method == "uv":
        return "uv tool uninstall ado-git-repo-insights"
    elif method == "pip":
        return "pip uninstall ado-git-repo-insights"
    else:
        return "# Unable to determine uninstall command"
