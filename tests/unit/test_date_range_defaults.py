"""Unit tests for date range default behavior.

Tests the extraction date range logic to prevent regressions:
- End date defaults to yesterday (local time)
- Start date defaults to Jan 1 on first run (empty metadata)
- Corrupt metadata warns and uses default (no hard fail)
- Explicit dates override defaults
- Backfill calculates start as today - N days
"""

from __future__ import annotations

from datetime import date as real_date
from typing import TYPE_CHECKING
from unittest.mock import MagicMock, patch

if TYPE_CHECKING:
    import pytest

    from ado_git_repo_insights.extractor.pr_extractor import PRExtractor


class FrozenDate(real_date):
    """Date class with frozen today() for deterministic testing.

    Preserves date() constructor while allowing today() to be controlled.
    """

    _frozen_today: real_date | None = None

    @classmethod
    def today(cls) -> real_date:
        if cls._frozen_today is None:
            raise RuntimeError("FrozenDate.today() called without freezing")
        return cls._frozen_today

    @classmethod
    def set_today(cls, frozen: real_date) -> None:
        cls._frozen_today = frozen


def create_extractor_with_mocks(
    config_end_date: real_date | None = None,
    config_start_date: real_date | None = None,
    last_extraction_date: real_date | None = None,
) -> PRExtractor:
    """Create a PRExtractor with mocked dependencies for testing."""
    from ado_git_repo_insights.extractor.pr_extractor import PRExtractor

    # Mock config
    mock_config = MagicMock()
    mock_config.date_range.end = config_end_date
    mock_config.date_range.start = config_start_date
    mock_config.organization = "TestOrg"
    mock_config.projects = ["TestProject"]
    mock_config.api = MagicMock()

    # Mock database and repository
    mock_db = MagicMock()
    mock_repository = MagicMock()
    mock_repository.get_last_extraction_date.return_value = last_extraction_date

    # Create extractor
    extractor = PRExtractor(
        client=MagicMock(),
        db=mock_db,
        config=mock_config,
    )
    extractor.repository = mock_repository

    return extractor


class TestEndDateDefaults:
    """Tests for _determine_end_date() behavior."""

    def test_end_date_defaults_to_yesterday(self) -> None:
        """End date should default to yesterday when not configured."""
        frozen = real_date(2026, 1, 15)
        FrozenDate.set_today(frozen)

        with patch("ado_git_repo_insights.extractor.pr_extractor.date", FrozenDate):
            extractor = create_extractor_with_mocks(config_end_date=None)
            result = extractor._determine_end_date()

        expected = real_date(2026, 1, 14)  # Yesterday
        assert result == expected

    def test_explicit_end_date_overrides_default(self) -> None:
        """Configured end date should override the yesterday default."""
        frozen = real_date(2026, 1, 15)
        FrozenDate.set_today(frozen)

        explicit_end = real_date(2026, 1, 20)

        with patch("ado_git_repo_insights.extractor.pr_extractor.date", FrozenDate):
            extractor = create_extractor_with_mocks(config_end_date=explicit_end)
            result = extractor._determine_end_date()

        assert result == explicit_end


class TestStartDateDefaults:
    """Tests for _determine_start_date() behavior."""

    def test_start_date_defaults_to_jan1_on_first_run(self) -> None:
        """Start date should default to Jan 1 of current year when no metadata exists."""
        frozen = real_date(2026, 3, 15)
        FrozenDate.set_today(frozen)

        with patch("ado_git_repo_insights.extractor.pr_extractor.date", FrozenDate):
            extractor = create_extractor_with_mocks(last_extraction_date=None)
            result = extractor._determine_start_date("TestProject", backfill_days=None)

        expected = real_date(2026, 1, 1)
        assert result == expected

    def test_explicit_start_date_overrides_default(self) -> None:
        """Configured start date should override all other logic."""
        frozen = real_date(2026, 3, 15)
        FrozenDate.set_today(frozen)

        explicit_start = real_date(2025, 6, 1)

        with patch("ado_git_repo_insights.extractor.pr_extractor.date", FrozenDate):
            extractor = create_extractor_with_mocks(config_start_date=explicit_start)
            result = extractor._determine_start_date("TestProject", backfill_days=None)

        assert result == explicit_start

    def test_incremental_start_is_last_date_plus_one(self) -> None:
        """Incremental mode should start from day after last extraction."""
        frozen = real_date(2026, 1, 15)
        FrozenDate.set_today(frozen)

        last_date = real_date(2026, 1, 10)

        with patch("ado_git_repo_insights.extractor.pr_extractor.date", FrozenDate):
            extractor = create_extractor_with_mocks(last_extraction_date=last_date)
            result = extractor._determine_start_date("TestProject", backfill_days=None)

        expected = real_date(2026, 1, 11)  # Day after last extraction
        assert result == expected


class TestBackfillMode:
    """Tests for backfill date calculation."""

    def test_backfill_start_is_today_minus_n_days(self) -> None:
        """Backfill mode should calculate start as today - backfill_days.

        Contract: start = today - backfill_days (inclusive start date)
        Example: today=Jan 15, backfill_days=30 → start=Dec 16
        """
        frozen = real_date(2026, 1, 15)
        FrozenDate.set_today(frozen)

        with patch("ado_git_repo_insights.extractor.pr_extractor.date", FrozenDate):
            extractor = create_extractor_with_mocks()
            result = extractor._determine_start_date("TestProject", backfill_days=30)

        # Jan 15 - 30 days = Dec 16
        expected = real_date(2025, 12, 16)
        assert result == expected

    def test_backfill_overrides_incremental(self) -> None:
        """Backfill mode should override incremental even when metadata exists."""
        frozen = real_date(2026, 1, 15)
        FrozenDate.set_today(frozen)

        # Metadata says last extraction was Jan 10
        with patch("ado_git_repo_insights.extractor.pr_extractor.date", FrozenDate):
            extractor = create_extractor_with_mocks(
                last_extraction_date=real_date(2026, 1, 10)
            )
            result = extractor._determine_start_date("TestProject", backfill_days=7)

        # Should use backfill (Jan 15 - 7 = Jan 8), not incremental (Jan 11)
        expected = real_date(2026, 1, 8)
        assert result == expected


class TestCorruptMetadataHandling:
    """Tests for handling corrupt or invalid extraction metadata.

    These tests verify that corrupt metadata doesn't halt pipelines unexpectedly.
    Expected behavior: warn and use default (Jan 1), not hard fail.
    """

    def test_corrupt_metadata_date_format_warns_and_uses_default(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Invalid date format in metadata should warn and fall back to Jan 1.

        If extraction_metadata contains an unparseable date (e.g., from DB corruption),
        the system should log a warning and use the first-run default, not crash.
        """
        import logging

        from ado_git_repo_insights.persistence.repository import PRRepository

        frozen = real_date(2026, 3, 15)
        FrozenDate.set_today(frozen)

        # Create a mock database that returns an invalid date format
        mock_db = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = {"last_extraction_date": "not-a-valid-date"}
        mock_db.execute.return_value = mock_cursor

        repository = PRRepository(mock_db)

        with caplog.at_level(logging.WARNING):
            result = repository.get_last_extraction_date("TestOrg", "TestProject")

        # Should return None (treated as first run) and log a warning
        assert result is None
        assert "corrupt" in caplog.text.lower() or "invalid" in caplog.text.lower()

    def test_empty_string_metadata_returns_none(self) -> None:
        """Empty string in metadata should be treated as no metadata."""
        from ado_git_repo_insights.persistence.repository import PRRepository

        mock_db = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = {"last_extraction_date": ""}
        mock_db.execute.return_value = mock_cursor

        repository = PRRepository(mock_db)
        result = repository.get_last_extraction_date("TestOrg", "TestProject")

        # Empty string should return None (first run behavior)
        assert result is None

    def test_null_metadata_returns_none(self) -> None:
        """NULL value in metadata should be treated as no metadata."""
        from ado_git_repo_insights.persistence.repository import PRRepository

        mock_db = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = {"last_extraction_date": None}
        mock_db.execute.return_value = mock_cursor

        repository = PRRepository(mock_db)
        result = repository.get_last_extraction_date("TestOrg", "TestProject")

        assert result is None

    def test_future_date_in_metadata_is_allowed(self) -> None:
        """Future dates in metadata should be returned as-is (no validation).

        The extractor will handle the "start > end" case appropriately.
        """
        from ado_git_repo_insights.persistence.repository import PRRepository

        mock_db = MagicMock()
        mock_cursor = MagicMock()
        # Future date stored in metadata
        mock_cursor.fetchone.return_value = {"last_extraction_date": "2099-12-31"}
        mock_db.execute.return_value = mock_cursor

        repository = PRRepository(mock_db)
        result = repository.get_last_extraction_date("TestOrg", "TestProject")

        # Future dates are valid ISO format, should be returned
        assert result == real_date(2099, 12, 31)
