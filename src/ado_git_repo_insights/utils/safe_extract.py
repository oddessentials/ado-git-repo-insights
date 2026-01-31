"""Safe ZIP extraction with Zip Slip protection.

This module provides secure ZIP extraction functionality that protects against
Zip Slip attacks by validating all entry paths before extraction and using
a temp-directory-then-swap approach for atomic operations.
"""

from __future__ import annotations

import re
import shutil
import time
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import uuid4

if TYPE_CHECKING:
    pass

# Pattern to match Windows drive letters (e.g., C:, D:\, E:/)
_WINDOWS_DRIVE_PATTERN = re.compile(r"^[A-Za-z]:[/\\]?")

__all__ = [
    "ZipSlipError",
    "ExtractionError",
    "is_symlink_entry",
    "validate_entry_path",
    "safe_extract_zip",
]


class ZipSlipError(Exception):
    """Raised when a ZIP entry fails security validation.

    Attributes:
        entry_name: The name of the ZIP entry that failed validation.
        reason: Human-readable description of why validation failed.
    """

    def __init__(self, entry_name: str, reason: str) -> None:
        self.entry_name = entry_name
        self.reason = reason
        super().__init__(f"Zip Slip attack detected: {reason}")


class ExtractionError(Exception):
    """Raised when extraction or directory swap fails."""

    pass


# Unix mode bit constants
_S_IFLNK = 0o120000  # Symlink
_S_IFMT = 0o170000  # File type mask


def is_symlink_entry(zip_info: zipfile.ZipInfo) -> bool:
    """Determine if a ZIP entry is a symlink based on Unix mode bits.

    Args:
        zip_info: A zipfile.ZipInfo object.

    Returns:
        True if entry is definitively a symlink, False otherwise.
        Returns False for missing/ambiguous metadata (Windows ZIPs).
    """
    # Unix mode is stored in upper 16 bits of external_attr
    unix_mode = (zip_info.external_attr >> 16) & _S_IFMT
    return unix_mode == _S_IFLNK


def validate_entry_path(entry_name: str, out_dir: Path) -> tuple[bool, str]:
    """Validate that a ZIP entry path is safe for extraction.

    Args:
        entry_name: The path stored in the ZIP entry.
        out_dir: The target extraction directory.

    Returns:
        Tuple of (is_valid, error_message). If valid, error_message is empty.

    Validation checks (in order):
        1. Reject absolute paths (starts with / or \\ or Windows drive letter)
        2. Reject path traversal sequences (contains ..)
        3. Reject if resolved path escapes out_dir
    """
    # Check for absolute paths (Unix and Windows)
    if entry_name.startswith("/") or entry_name.startswith("\\"):
        return False, f"Absolute path not allowed: {entry_name}"

    # Check for Windows drive letter paths (e.g., C:\, D:/)
    if _WINDOWS_DRIVE_PATTERN.match(entry_name):
        return False, f"Absolute path not allowed: {entry_name}"

    # Check for path traversal sequences (defense in depth)
    if ".." in entry_name:
        return False, f"Path traversal sequence detected: {entry_name}"

    # Resolve the full target path and verify containment
    try:
        target_path = (out_dir / entry_name).resolve()
        out_dir_resolved = out_dir.resolve()

        # Check if target is within output directory
        target_path.relative_to(out_dir_resolved)
    except ValueError:
        return False, f"Path escapes output directory: {entry_name} -> {target_path}"

    return True, ""


def _create_temp_dir(out_dir: Path) -> Path:
    """Create a temporary directory for extraction.

    Args:
        out_dir: The final output directory (temp dir created in same parent).

    Returns:
        Path to the newly created temp directory.
    """
    parent = out_dir.parent
    parent.mkdir(parents=True, exist_ok=True)
    temp_dir = parent / f".tmp.{uuid4().hex}"
    temp_dir.mkdir()
    return temp_dir


def _backup_and_swap(temp_dir: Path, out_dir: Path) -> None:
    """Perform backup-then-swap to finalize extraction.

    If out_dir exists, backs it up first. Then swaps temp_dir to out_dir.
    On failure, restores backup and raises ExtractionError.

    Args:
        temp_dir: The temporary directory containing extracted files.
        out_dir: The final output directory.

    Raises:
        ExtractionError: If swap fails (backup is restored first).
    """
    backup_dir: Path | None = None

    try:
        # Backup existing output directory if it exists
        if out_dir.exists():
            timestamp = int(time.time())
            backup_dir = out_dir.parent / f"{out_dir.name}.bak.{timestamp}"
            shutil.move(str(out_dir), str(backup_dir))

        # Swap temp directory to output directory
        try:
            shutil.move(str(temp_dir), str(out_dir))
        except Exception as e:
            # Restore backup on failure
            if backup_dir and backup_dir.exists():
                shutil.move(str(backup_dir), str(out_dir))
            raise ExtractionError(
                f"Failed to swap temp directory to output: {e}"
            ) from e

        # Clean up backup on success
        if backup_dir and backup_dir.exists():
            shutil.rmtree(backup_dir)

    except ExtractionError:
        raise
    except Exception as e:
        # Restore backup if anything else fails
        if backup_dir and backup_dir.exists() and not out_dir.exists():
            shutil.move(str(backup_dir), str(out_dir))
        raise ExtractionError(f"Backup/swap operation failed: {e}") from e


def safe_extract_zip(zip_path: Path, out_dir: Path) -> None:
    """Extract a ZIP file safely with Zip Slip protection.

    Uses a temp-directory-then-swap approach:
    1. Creates empty temp directory
    2. Scans all entries for symlinks (rejects if found)
    3. Validates all entry paths against temp directory
    4. Extracts valid entries to temp directory
    5. Backs up existing out_dir (if exists)
    6. Swaps temp directory to out_dir
    7. Cleans up backup on success; restores on failure

    Args:
        zip_path: Path to the ZIP file.
        out_dir: Final output directory.

    Raises:
        ZipSlipError: If any entry fails validation (symlink, traversal, escape).
        ExtractionError: If extraction or directory swap fails.

    Guarantees:
        - No files written to out_dir if any entry is invalid
        - Previous out_dir restored if swap fails
        - Temp directory cleaned up on success or failure
    """
    temp_dir: Path | None = None

    try:
        # Create temp directory in same parent as output
        temp_dir = _create_temp_dir(out_dir)

        with zipfile.ZipFile(zip_path, "r") as zf:
            # Phase 1: Scan all entries for symlinks
            for info in zf.infolist():
                if is_symlink_entry(info):
                    raise ZipSlipError(
                        info.filename,
                        f"Symlink entry detected: {info.filename}",
                    )

            # Phase 2: Validate all entry paths
            for info in zf.infolist():
                is_valid, error = validate_entry_path(info.filename, temp_dir)
                if not is_valid:
                    raise ZipSlipError(info.filename, error)

            # Phase 3: Extract to temp directory
            zf.extractall(temp_dir)

        # Phase 4: Backup and swap
        _backup_and_swap(temp_dir, out_dir)
        temp_dir = None  # Prevent cleanup since it's now out_dir

    finally:
        # Clean up temp directory if it still exists
        if temp_dir and temp_dir.exists():
            shutil.rmtree(temp_dir, ignore_errors=True)
