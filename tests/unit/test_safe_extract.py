"""Unit tests for safe ZIP extraction with Zip Slip protection.

Tests cover:
- Symlink detection via Unix mode bits
- Path validation (absolute paths, traversal sequences, escape detection)
- Safe extraction with backup-then-swap
- Error recovery on swap failure
"""

from __future__ import annotations

import shutil
import stat
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING
from unittest.mock import patch

import pytest

from ado_git_repo_insights.utils.safe_extract import (
    ExtractionError,
    ZipSlipError,
    is_symlink_entry,
    safe_extract_zip,
    validate_entry_path,
)

if TYPE_CHECKING:
    from collections.abc import Generator


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def temp_dir(tmp_path: Path) -> Generator[Path, None, None]:
    """Create a temporary directory for test extraction."""
    out_dir = tmp_path / "output"
    out_dir.mkdir()
    return out_dir
    # Cleanup handled by tmp_path fixture


@pytest.fixture
def valid_zip(tmp_path: Path) -> Path:
    """Create a valid ZIP file with safe entries."""
    zip_path = tmp_path / "valid.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("file.txt", "Hello, World!")
        zf.writestr("subdir/nested.txt", "Nested content")
    return zip_path


@pytest.fixture
def traversal_zip(tmp_path: Path) -> Path:
    """Create a malicious ZIP with path traversal entry."""
    zip_path = tmp_path / "traversal.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("safe.txt", "Safe content")
        zf.writestr("../../evil.txt", "Malicious content")
    return zip_path


@pytest.fixture
def absolute_path_zip(tmp_path: Path) -> Path:
    """Create a malicious ZIP with absolute path entry."""
    zip_path = tmp_path / "absolute.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("safe.txt", "Safe content")
        zf.writestr("/etc/passwd", "Malicious content")
    return zip_path


@pytest.fixture
def windows_drive_zip(tmp_path: Path) -> Path:
    """Create a malicious ZIP with Windows drive letter path entry."""
    zip_path = tmp_path / "windows_drive.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("safe.txt", "Safe content")
        zf.writestr("C:\\Windows\\System32\\evil.dll", "Malicious content")
    return zip_path


def _create_symlink_zip(tmp_path: Path) -> Path:
    """Create a ZIP with a symlink entry using Unix mode bits."""
    zip_path = tmp_path / "symlink.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        # Add a regular file
        zf.writestr("safe.txt", "Safe content")

        # Create a symlink entry with Unix mode bits
        # S_IFLNK = 0o120000 (symlink mode)
        info = zipfile.ZipInfo("evil_link")
        # Set external_attr: Unix mode in upper 16 bits
        # 0o120777 = symlink with full permissions
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        zf.writestr(info, "/etc/passwd")  # symlink target
    return zip_path


@pytest.fixture
def symlink_zip(tmp_path: Path) -> Path:
    """Create a malicious ZIP with symlink entry."""
    return _create_symlink_zip(tmp_path)


# ============================================================================
# is_symlink_entry() Tests
# ============================================================================


class TestIsSymlinkEntry:
    """Tests for symlink detection via Unix mode bits."""

    def test_detects_unix_symlink(self, symlink_zip: Path) -> None:
        """Test that Unix symlinks are detected via external_attr."""
        with zipfile.ZipFile(symlink_zip, "r") as zf:
            for info in zf.infolist():
                if info.filename == "evil_link":
                    assert is_symlink_entry(info) is True
                else:
                    assert is_symlink_entry(info) is False

    def test_returns_false_for_regular_file(self, valid_zip: Path) -> None:
        """Test that regular files are not detected as symlinks."""
        with zipfile.ZipFile(valid_zip, "r") as zf:
            for info in zf.infolist():
                assert is_symlink_entry(info) is False

    def test_returns_false_for_windows_zip(self, tmp_path: Path) -> None:
        """Test that Windows ZIPs without Unix mode bits return False."""
        zip_path = tmp_path / "windows.zip"
        with zipfile.ZipFile(zip_path, "w") as zf:
            info = zipfile.ZipInfo("file.txt")
            # Windows-style: no Unix mode bits set
            info.external_attr = 0
            zf.writestr(info, "Content")

        with zipfile.ZipFile(zip_path, "r") as zf:
            for info in zf.infolist():
                assert is_symlink_entry(info) is False

    def test_returns_false_for_directory(self, tmp_path: Path) -> None:
        """Test that directories are not detected as symlinks."""
        zip_path = tmp_path / "with_dir.zip"
        with zipfile.ZipFile(zip_path, "w") as zf:
            # Directory entry
            info = zipfile.ZipInfo("mydir/")
            info.external_attr = (stat.S_IFDIR | 0o755) << 16
            zf.writestr(info, "")

        with zipfile.ZipFile(zip_path, "r") as zf:
            for info in zf.infolist():
                assert is_symlink_entry(info) is False


# ============================================================================
# validate_entry_path() Tests
# ============================================================================


class TestValidateEntryPath:
    """Tests for path validation."""

    def test_rejects_absolute_unix_path(self, temp_dir: Path) -> None:
        """Test that absolute Unix paths are rejected."""
        is_valid, error = validate_entry_path("/etc/passwd", temp_dir)
        assert is_valid is False
        assert "Absolute path not allowed" in error

    def test_rejects_absolute_windows_path(self, temp_dir: Path) -> None:
        """Test that absolute Windows paths are rejected."""
        is_valid, error = validate_entry_path("\\Windows\\System32\\config", temp_dir)
        assert is_valid is False
        assert "Absolute path not allowed" in error

    def test_rejects_path_traversal(self, temp_dir: Path) -> None:
        """Test that path traversal sequences are rejected."""
        is_valid, error = validate_entry_path("../../evil.txt", temp_dir)
        assert is_valid is False
        assert "Path traversal sequence detected" in error

    def test_rejects_hidden_traversal(self, temp_dir: Path) -> None:
        """Test that hidden traversal (foo/../../../bar) is rejected."""
        is_valid, error = validate_entry_path("foo/../../../bar.txt", temp_dir)
        assert is_valid is False
        assert "Path traversal sequence detected" in error

    def test_rejects_path_escaping_output(self, temp_dir: Path) -> None:
        """Test that paths resolving outside output dir are rejected."""
        # This shouldn't happen if .. check works, but defense in depth
        # Create a scenario where resolved path escapes
        is_valid, error = validate_entry_path("subdir/../../escape.txt", temp_dir)
        assert is_valid is False
        # Should be caught by traversal check first
        assert "Path traversal sequence detected" in error

    def test_accepts_valid_relative_path(self, temp_dir: Path) -> None:
        """Test that valid relative paths are accepted."""
        is_valid, error = validate_entry_path("file.txt", temp_dir)
        assert is_valid is True
        assert error == ""

    def test_accepts_nested_relative_path(self, temp_dir: Path) -> None:
        """Test that nested relative paths are accepted."""
        is_valid, error = validate_entry_path("subdir/nested/file.txt", temp_dir)
        assert is_valid is True
        assert error == ""

    def test_accepts_path_with_dots_in_filename(self, temp_dir: Path) -> None:
        """Test that filenames with dots are accepted."""
        is_valid, error = validate_entry_path("file.backup.txt", temp_dir)
        assert is_valid is True
        assert error == ""

    def test_rejects_windows_drive_letter_c(self, temp_dir: Path) -> None:
        """Test that Windows C: drive paths are rejected."""
        is_valid, error = validate_entry_path(
            "C:\\Windows\\System32\\evil.dll", temp_dir
        )
        assert is_valid is False
        assert "Absolute path not allowed" in error

    def test_rejects_windows_drive_letter_d(self, temp_dir: Path) -> None:
        """Test that Windows D: drive paths are rejected."""
        is_valid, error = validate_entry_path("D:/data/sensitive.txt", temp_dir)
        assert is_valid is False
        assert "Absolute path not allowed" in error

    def test_rejects_windows_drive_letter_lowercase(self, temp_dir: Path) -> None:
        """Test that lowercase Windows drive letters are rejected."""
        is_valid, error = validate_entry_path("c:/users/evil.exe", temp_dir)
        assert is_valid is False
        assert "Absolute path not allowed" in error

    def test_rejects_windows_drive_letter_no_slash(self, temp_dir: Path) -> None:
        """Test that Windows drive letter without slash is rejected."""
        is_valid, error = validate_entry_path("E:autorun.inf", temp_dir)
        assert is_valid is False
        assert "Absolute path not allowed" in error


# ============================================================================
# safe_extract_zip() Tests
# ============================================================================


class TestSafeExtractZip:
    """Tests for the main safe extraction function."""

    def test_extracts_valid_zip_successfully(
        self, valid_zip: Path, temp_dir: Path
    ) -> None:
        """Test successful extraction of a valid ZIP."""
        out_dir = temp_dir / "extracted"
        safe_extract_zip(valid_zip, out_dir)

        assert out_dir.exists()
        assert (out_dir / "file.txt").read_text() == "Hello, World!"
        assert (out_dir / "subdir" / "nested.txt").read_text() == "Nested content"

    def test_rejects_zip_with_symlink_entry(
        self, symlink_zip: Path, temp_dir: Path
    ) -> None:
        """Test that ZIPs with symlink entries are rejected before extraction."""
        out_dir = temp_dir / "extracted"

        with pytest.raises(ZipSlipError) as exc_info:
            safe_extract_zip(symlink_zip, out_dir)

        assert "evil_link" in exc_info.value.entry_name
        assert "symlink" in exc_info.value.reason.lower()
        # Verify no files were written
        assert not out_dir.exists() or not any(out_dir.iterdir())

    def test_rejects_zip_with_traversal_path(
        self, traversal_zip: Path, temp_dir: Path
    ) -> None:
        """Test that ZIPs with path traversal are rejected."""
        out_dir = temp_dir / "extracted"

        with pytest.raises(ZipSlipError) as exc_info:
            safe_extract_zip(traversal_zip, out_dir)

        assert "../../evil.txt" in exc_info.value.entry_name
        # Verify no files were written to final output
        assert not out_dir.exists() or not any(out_dir.iterdir())

    def test_rejects_zip_with_absolute_path(
        self, absolute_path_zip: Path, temp_dir: Path
    ) -> None:
        """Test that ZIPs with absolute paths are rejected."""
        out_dir = temp_dir / "extracted"

        with pytest.raises(ZipSlipError) as exc_info:
            safe_extract_zip(absolute_path_zip, out_dir)

        assert "/etc/passwd" in exc_info.value.entry_name
        # Verify no files were written
        assert not out_dir.exists() or not any(out_dir.iterdir())

    def test_rejects_zip_with_windows_drive_path(
        self, windows_drive_zip: Path, temp_dir: Path
    ) -> None:
        """Test that ZIPs with Windows drive letter paths are rejected."""
        out_dir = temp_dir / "extracted"

        with pytest.raises(ZipSlipError) as exc_info:
            safe_extract_zip(windows_drive_zip, out_dir)

        # ZIP may normalize to forward slashes, check for either C:\ or C:/
        assert exc_info.value.entry_name.startswith("C:")
        assert "Absolute path not allowed" in exc_info.value.reason
        # Verify no files were written
        assert not out_dir.exists() or not any(out_dir.iterdir())

    def test_restores_backup_on_swap_failure(
        self, valid_zip: Path, temp_dir: Path
    ) -> None:
        """Test that backup is restored if swap fails."""
        out_dir = temp_dir / "extracted"
        # Create existing content that should be preserved on failure
        out_dir.mkdir()
        existing_file = out_dir / "existing.txt"
        existing_file.write_text("Original content")

        # Mock shutil.move to fail on the final swap
        original_move = shutil.move
        call_count = 0

        def failing_move(src: str, dst: str) -> str:
            nonlocal call_count
            call_count += 1
            # Let backup succeed, fail on swap
            if call_count == 2:  # Second move is the swap
                raise OSError("Simulated swap failure")
            return original_move(src, dst)

        with patch("shutil.move", side_effect=failing_move):
            with pytest.raises(ExtractionError) as exc_info:
                safe_extract_zip(valid_zip, out_dir)

        assert (
            "swap" in str(exc_info.value).lower()
            or "failed" in str(exc_info.value).lower()
        )
        # Verify original content is restored
        assert out_dir.exists()
        assert existing_file.exists()
        assert existing_file.read_text() == "Original content"

    def test_overwrites_existing_output_directory(
        self, valid_zip: Path, temp_dir: Path
    ) -> None:
        """Test that existing output directory is replaced on success."""
        out_dir = temp_dir / "extracted"
        out_dir.mkdir()
        (out_dir / "old_file.txt").write_text("Old content")

        safe_extract_zip(valid_zip, out_dir)

        # Old file should be gone, new files present
        assert not (out_dir / "old_file.txt").exists()
        assert (out_dir / "file.txt").read_text() == "Hello, World!"

    def test_cleans_up_temp_directory_on_success(
        self, valid_zip: Path, temp_dir: Path
    ) -> None:
        """Test that temp directory is cleaned up after successful extraction."""
        out_dir = temp_dir / "extracted"
        safe_extract_zip(valid_zip, out_dir)

        # Check no .tmp directories remain
        tmp_dirs = list(temp_dir.glob(".tmp.*"))
        assert len(tmp_dirs) == 0

    def test_cleans_up_temp_directory_on_failure(
        self, traversal_zip: Path, temp_dir: Path
    ) -> None:
        """Test that temp directory is cleaned up after failed extraction."""
        out_dir = temp_dir / "extracted"

        with pytest.raises(ZipSlipError):
            safe_extract_zip(traversal_zip, out_dir)

        # Check no .tmp directories remain
        tmp_dirs = list(temp_dir.glob(".tmp.*"))
        assert len(tmp_dirs) == 0


# ============================================================================
# Exception Tests
# ============================================================================


class TestExceptions:
    """Tests for exception classes."""

    def test_zipslip_error_attributes(self) -> None:
        """Test ZipSlipError has correct attributes."""
        error = ZipSlipError("evil.txt", "Path traversal detected")
        assert error.entry_name == "evil.txt"
        assert error.reason == "Path traversal detected"
        assert "Zip Slip attack detected" in str(error)

    def test_extraction_error_message(self) -> None:
        """Test ExtractionError can be raised with message."""
        error = ExtractionError("Swap failed")
        assert "Swap failed" in str(error)
