"""Tests for the canonical version resolver precedence contract.

Each test exercises one branch of the precedence rules:
1. Repo checkout + stale metadata → VERSION file wins
2. Repo checkout + fresh metadata → metadata wins (more precise)
3. Repo checkout + no metadata → VERSION file fallback
4. No repo (wheel install) + metadata → metadata wins
5. Neither available → "unknown (dev)"
6. "0.0.0" never appears in any scenario
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from ado_git_repo_insights.utils.version import (
    _is_metadata_stale,
    _read_metadata_version,
    _read_repo_version,
    resolve_version,
)


class TestPrecedenceContract:
    """Test the exact precedence rules of resolve_version()."""

    def test_repo_checkout_stale_metadata_uses_version_file(
        self, tmp_path: Path
    ) -> None:
        """Stale editable metadata + VERSION file → VERSION wins."""
        version_file = tmp_path / "VERSION"
        version_file.write_text("5.28.1\n")

        with patch(
            "ado_git_repo_insights.utils.version._read_metadata_version",
            return_value="5.27.2.dev89+g3bf5b3ba7",
        ):
            with patch(
                "ado_git_repo_insights.utils.version._read_repo_version",
                return_value="5.28.1",
            ):
                result = resolve_version()

        assert result == "5.28.1"

    def test_repo_checkout_fresh_metadata_uses_metadata(self) -> None:
        """Fresh metadata matching VERSION base → metadata wins (more precise)."""
        with patch(
            "ado_git_repo_insights.utils.version._read_metadata_version",
            return_value="5.28.1.dev2+gabcdef",
        ):
            with patch(
                "ado_git_repo_insights.utils.version._read_repo_version",
                return_value="5.28.1",
            ):
                result = resolve_version()

        assert result == "5.28.1.dev2+gabcdef"

    def test_repo_checkout_no_metadata_uses_version_file(self) -> None:
        """No metadata + VERSION file → VERSION fallback."""
        with patch(
            "ado_git_repo_insights.utils.version._read_metadata_version",
            return_value=None,
        ):
            with patch(
                "ado_git_repo_insights.utils.version._read_repo_version",
                return_value="5.28.1",
            ):
                result = resolve_version()

        assert result == "5.28.1"

    def test_installed_no_repo_uses_metadata(self) -> None:
        """Wheel install (no VERSION file) → metadata wins."""
        with patch(
            "ado_git_repo_insights.utils.version._read_metadata_version",
            return_value="5.28.1",
        ):
            with patch(
                "ado_git_repo_insights.utils.version._read_repo_version",
                return_value=None,
            ):
                result = resolve_version()

        assert result == "5.28.1"

    def test_neither_available_returns_unknown_dev(self) -> None:
        """No metadata, no VERSION → 'unknown (dev)'."""
        with patch(
            "ado_git_repo_insights.utils.version._read_metadata_version",
            return_value=None,
        ):
            with patch(
                "ado_git_repo_insights.utils.version._read_repo_version",
                return_value=None,
            ):
                result = resolve_version()

        assert result == "unknown (dev)"

    def test_zero_never_appears(self) -> None:
        """'0.0.0' must never appear in any resolution path."""
        scenarios = [
            ("5.28.1", "5.28.1"),
            ("5.27.2.dev89+gabcdef", "5.28.1"),
            (None, "5.28.1"),
            ("5.28.1", None),
            (None, None),
        ]
        for metadata, repo in scenarios:
            with patch(
                "ado_git_repo_insights.utils.version._read_metadata_version",
                return_value=metadata,
            ):
                with patch(
                    "ado_git_repo_insights.utils.version._read_repo_version",
                    return_value=repo,
                ):
                    result = resolve_version()
            assert "0.0.0" not in result, (
                f"0.0.0 found for metadata={metadata}, repo={repo}"
            )


class TestStalenessDetection:
    """Test the explicit staleness comparison logic."""

    def test_different_base_is_stale(self) -> None:
        assert _is_metadata_stale("5.27.2.dev89+gabcdef", "5.28.1") is True

    def test_same_base_is_not_stale(self) -> None:
        assert _is_metadata_stale("5.28.1.dev2+gabcdef", "5.28.1") is False

    def test_exact_match_is_not_stale(self) -> None:
        assert _is_metadata_stale("5.28.1", "5.28.1") is False

    def test_dev_suffix_stripped_for_comparison(self) -> None:
        assert _is_metadata_stale("5.27.2.dev0", "5.28.1") is True
        assert _is_metadata_stale("5.28.1.dev0", "5.28.1") is False


class TestHelpers:
    """Test helper functions directly."""

    def test_read_metadata_version_returns_string(self) -> None:
        result = _read_metadata_version()
        # In editable install, should return a version string
        assert result is None or isinstance(result, str)

    def test_read_repo_version_from_real_file(self) -> None:
        result = _read_repo_version()
        # In source checkout, VERSION file should exist
        if result is not None:
            assert isinstance(result, str)
            assert len(result) > 0
