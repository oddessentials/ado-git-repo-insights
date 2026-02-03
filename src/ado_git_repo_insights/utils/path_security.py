"""Path security helpers for artifact writes."""

from __future__ import annotations

import re
from pathlib import Path

_WINDOWS_DRIVE_PATTERN = re.compile(r"^[A-Za-z]:[/\\]?")
_PATH_SEP_PATTERN = re.compile(r"[\\/]")


def ensure_safe_filename(name: str) -> str:
    """Validate a filename does not contain traversal or separators.

    Args:
        name: Filename to validate (single path segment).

    Returns:
        The original filename if valid.

    Raises:
        ValueError: If the filename is unsafe.
    """
    if not name:
        raise ValueError("Filename is empty")
    if name in {".", ".."}:
        raise ValueError(f"Unsafe filename segment: {name}")
    if name.startswith(("/", "\\")) or _WINDOWS_DRIVE_PATTERN.match(name):
        raise ValueError(f"Absolute path not allowed: {name}")
    if _PATH_SEP_PATTERN.search(name):
        raise ValueError(f"Path separators not allowed in filename: {name}")
    return name


def ensure_safe_relative_path(path: str) -> str:
    """Validate a relative path is safe to join under a root.

    Args:
        path: Relative path to validate.

    Returns:
        The original relative path if valid.

    Raises:
        ValueError: If the path is unsafe.
    """
    if not path:
        raise ValueError("Path is empty")
    if path.startswith(("/", "\\")) or _WINDOWS_DRIVE_PATTERN.match(path):
        raise ValueError(f"Absolute path not allowed: {path}")
    # Reject traversal/empty segments while allowing legitimate ".." in names
    segments = re.split(r"[\\/]+", path)
    if any(segment in {"", ".", ".."} for segment in segments):
        raise ValueError(f"Path traversal sequence detected: {path}")
    return path


def safe_join(root: Path, relative: str) -> Path:
    """Join a relative path to a root with canonicalization and anchoring.

    Args:
        root: Root directory to anchor to.
        relative: Relative path to join.

    Returns:
        Resolved path under root.

    Raises:
        ValueError: If the joined path escapes the root.
    """
    relative = ensure_safe_relative_path(relative)
    root_resolved = root.resolve()
    target = (root_resolved / relative).resolve()
    try:
        target.relative_to(root_resolved)
    except ValueError as exc:
        raise ValueError(f"Path escapes root: {relative}") from exc
    return target
