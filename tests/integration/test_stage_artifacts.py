"""Integration tests for stage-artifacts security hardening.

These tests verify the end-to-end security behavior of the stage-artifacts
command, specifically:
1. Zip Slip protection via safe_extract_zip
2. ZipSlipError handling with actionable messages
3. Malicious ZIP rejection before any extraction occurs

Security Requirements:
- SC-007: Zip Slip blocked - malicious entry does NOT end up on disk
- SC-008: Regression tests to prevent reintroduction of vulnerability
"""

from __future__ import annotations

import stat
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from ado_git_repo_insights.utils.safe_extract import (
    ZipSlipError,
    safe_extract_zip,
)

if TYPE_CHECKING:
    pass


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def malicious_traversal_zip(tmp_path: Path) -> Path:
    """Create a ZIP with path traversal attack."""
    zip_path = tmp_path / "malicious_traversal.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("safe_file.txt", "This is safe content")
        zf.writestr("subdir/nested.txt", "Nested content")
        # Malicious entry that tries to escape the output directory
        zf.writestr("../../etc/passwd", "root:x:0:0:root:/root:/bin/bash")
    return zip_path


@pytest.fixture
def malicious_symlink_zip(tmp_path: Path) -> Path:
    """Create a ZIP with symlink attack."""
    zip_path = tmp_path / "malicious_symlink.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("safe_file.txt", "This is safe content")

        # Create symlink entry pointing to /etc/passwd
        symlink_info = zipfile.ZipInfo("evil_link")
        # Set Unix symlink mode (S_IFLNK | 0o777)
        symlink_info.external_attr = (stat.S_IFLNK | 0o777) << 16
        zf.writestr(symlink_info, "/etc/passwd")
    return zip_path


@pytest.fixture
def malicious_absolute_path_zip(tmp_path: Path) -> Path:
    """Create a ZIP with absolute path attack."""
    zip_path = tmp_path / "malicious_absolute.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("safe_file.txt", "This is safe content")
        # Absolute path entry
        zf.writestr("/etc/shadow", "sensitive:data")
    return zip_path


@pytest.fixture
def malicious_windows_drive_zip(tmp_path: Path) -> Path:
    """Create a ZIP with Windows drive letter path attack."""
    zip_path = tmp_path / "malicious_windows.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("safe_file.txt", "This is safe content")
        # Windows drive letter path entry
        zf.writestr("C:\\Windows\\System32\\evil.dll", "Malicious DLL content")
    return zip_path


@pytest.fixture
def valid_zip(tmp_path: Path) -> Path:
    """Create a valid, safe ZIP file."""
    zip_path = tmp_path / "valid.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("file.txt", "Hello, World!")
        zf.writestr("subdir/nested.txt", "Nested content")
        zf.writestr("subdir/deep/file.json", '{"key": "value"}')
    return zip_path


# ============================================================================
# Security Regression Tests (SC-008)
# ============================================================================


class TestZipSlipProtection:
    """Security regression tests for Zip Slip vulnerability."""

    def test_path_traversal_blocked_before_extraction(
        self, malicious_traversal_zip: Path, tmp_path: Path
    ) -> None:
        """SC-007: Path traversal entry does NOT end up on disk.

        Verifies that:
        1. ZipSlipError is raised with correct entry name
        2. No files are written to the output directory
        3. No files are written to the parent directory (traversal target)
        """
        out_dir = tmp_path / "output"
        parent_dir = tmp_path  # Where ../../ would escape to

        # Record existing files in parent
        parent_files_before = set(parent_dir.iterdir())

        with pytest.raises(ZipSlipError) as exc_info:
            safe_extract_zip(malicious_traversal_zip, out_dir)

        # Verify error contains actionable information
        assert "../../etc/passwd" in exc_info.value.entry_name
        assert "traversal" in exc_info.value.reason.lower()

        # CRITICAL: Verify no files were written to output
        assert not out_dir.exists() or not any(out_dir.iterdir())

        # CRITICAL: Verify no files were written to parent (escape target)
        parent_files_after = set(parent_dir.iterdir())
        # Only difference should be the temp files created by the test
        new_files = parent_files_after - parent_files_before
        # Filter out expected test artifacts
        unexpected_files = [
            f for f in new_files if not f.name.endswith(".zip") and f.name != "output"
        ]
        assert len(unexpected_files) == 0, (
            f"Unexpected files created: {unexpected_files}"
        )

    def test_symlink_blocked_before_extraction(
        self, malicious_symlink_zip: Path, tmp_path: Path
    ) -> None:
        """SC-007: Symlink entry does NOT end up on disk.

        Verifies that symlink attacks are detected and blocked before any
        extraction occurs.
        """
        out_dir = tmp_path / "output"

        with pytest.raises(ZipSlipError) as exc_info:
            safe_extract_zip(malicious_symlink_zip, out_dir)

        # Verify error identifies the symlink
        assert "evil_link" in exc_info.value.entry_name
        assert "symlink" in exc_info.value.reason.lower()

        # CRITICAL: Verify no files were written
        assert not out_dir.exists() or not any(out_dir.iterdir())

    def test_absolute_path_blocked_before_extraction(
        self, malicious_absolute_path_zip: Path, tmp_path: Path
    ) -> None:
        """SC-007: Absolute path entry does NOT end up on disk.

        Verifies that absolute paths are rejected before extraction.
        """
        out_dir = tmp_path / "output"

        with pytest.raises(ZipSlipError) as exc_info:
            safe_extract_zip(malicious_absolute_path_zip, out_dir)

        # Verify error identifies the absolute path
        assert "/etc/shadow" in exc_info.value.entry_name
        assert "absolute" in exc_info.value.reason.lower()

        # CRITICAL: Verify /etc/shadow was not modified (if we had permissions)
        # In practice, this would fail anyway, but the test verifies intent
        assert not out_dir.exists() or not any(out_dir.iterdir())

    def test_windows_drive_path_blocked_before_extraction(
        self, malicious_windows_drive_zip: Path, tmp_path: Path
    ) -> None:
        r"""SC-007: Windows drive letter path does NOT end up on disk.

        Verifies that Windows-style absolute paths (C:\, D:\, etc.) are
        detected and blocked before any extraction occurs.
        """
        out_dir = tmp_path / "output"

        with pytest.raises(ZipSlipError) as exc_info:
            safe_extract_zip(malicious_windows_drive_zip, out_dir)

        # Verify error identifies the Windows drive path
        # ZIP may normalize to forward slashes, check for C: prefix
        assert exc_info.value.entry_name.startswith("C:")
        assert "Absolute path not allowed" in exc_info.value.reason

        # CRITICAL: Verify no files were written
        assert not out_dir.exists() or not any(out_dir.iterdir())

    def test_valid_zip_extracts_successfully(
        self, valid_zip: Path, tmp_path: Path
    ) -> None:
        """Verify that valid ZIPs still extract correctly.

        Ensures security measures don't break legitimate use cases.
        """
        out_dir = tmp_path / "output"

        # Should not raise
        safe_extract_zip(valid_zip, out_dir)

        # Verify contents
        assert (out_dir / "file.txt").read_text() == "Hello, World!"
        assert (out_dir / "subdir" / "nested.txt").read_text() == "Nested content"
        assert (out_dir / "subdir" / "deep" / "file.json").exists()


class TestAtomicExtraction:
    """Tests for atomic extraction with backup-then-swap."""

    def test_existing_output_preserved_on_malicious_zip(
        self, malicious_traversal_zip: Path, tmp_path: Path
    ) -> None:
        """Existing output directory is preserved when extraction fails.

        This is critical for atomic operations - a failed extraction should
        not corrupt or delete existing data.
        """
        out_dir = tmp_path / "output"
        out_dir.mkdir()
        existing_file = out_dir / "important_data.txt"
        existing_file.write_text("Critical existing data")

        with pytest.raises(ZipSlipError):
            safe_extract_zip(malicious_traversal_zip, out_dir)

        # CRITICAL: Existing data must still be present
        assert existing_file.exists()
        assert existing_file.read_text() == "Critical existing data"

    def test_temp_directory_cleaned_up_on_failure(
        self, malicious_traversal_zip: Path, tmp_path: Path
    ) -> None:
        """Temp directory is cleaned up even when extraction fails."""
        out_dir = tmp_path / "output"
        parent_dir = out_dir.parent

        with pytest.raises(ZipSlipError):
            safe_extract_zip(malicious_traversal_zip, out_dir)

        # No .tmp.* directories should remain
        tmp_dirs = list(parent_dir.glob(".tmp.*"))
        assert len(tmp_dirs) == 0, f"Temp directories not cleaned up: {tmp_dirs}"

    def test_temp_directory_cleaned_up_on_success(
        self, valid_zip: Path, tmp_path: Path
    ) -> None:
        """Temp directory is cleaned up after successful extraction."""
        out_dir = tmp_path / "output"
        parent_dir = out_dir.parent

        safe_extract_zip(valid_zip, out_dir)

        # No .tmp.* directories should remain
        tmp_dirs = list(parent_dir.glob(".tmp.*"))
        assert len(tmp_dirs) == 0, f"Temp directories not cleaned up: {tmp_dirs}"


# ============================================================================
# Pagination Token Security Tests
# ============================================================================


class TestPaginationTokenEncoding:
    """Tests for secure pagination token handling."""

    def test_special_chars_encoded_correctly(self) -> None:
        """Tokens with special characters are URL-encoded.

        This prevents parameter injection attacks where a token like
        'foo&admin=true' could be interpreted as multiple parameters.
        """
        from ado_git_repo_insights.extractor.pagination import add_continuation_token

        # Token with characters that could cause parameter injection
        malicious_token = "foo&admin=true&delete=all"  # noqa: S105 - not a password
        url = "https://dev.azure.com/org/_apis/teams?api-version=7.0"

        result = add_continuation_token(url, malicious_token)

        # The token should be URL-encoded, not interpreted as separate params
        # %26 = &, %3D = =
        assert "foo%26admin%3Dtrue%26delete%3Dall" in result
        assert "&admin=" not in result  # NOT interpreted as separate param
        assert "&delete=" not in result

    def test_token_with_spaces_encoded(self) -> None:
        """Spaces in tokens are encoded as + (query string standard)."""
        from ado_git_repo_insights.extractor.pagination import add_continuation_token

        token_with_space = "token with spaces"  # noqa: S105 - not a password
        url = "https://example.com/api"

        result = add_continuation_token(url, token_with_space)

        # Spaces should be encoded as + (quote_plus behavior)
        assert "token+with+spaces" in result
        assert " " not in result  # No literal spaces

    def test_preexisting_params_preserved(self) -> None:
        """Existing URL parameters are preserved when adding token."""
        from ado_git_repo_insights.extractor.pagination import add_continuation_token

        url = (
            "https://dev.azure.com/org/_apis/git/pullrequests?status=completed&top=100"
        )
        token = "abc123"  # noqa: S105 - continuation token, not a password

        result = add_continuation_token(url, token)

        # Original params should still be present
        assert "status=completed" in result
        assert "top=100" in result
        assert "continuationToken=abc123" in result
