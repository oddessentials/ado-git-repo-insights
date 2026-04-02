"""Unit tests for LLMInsightsGenerator patch coverage.

Tests for:
- _get_pr_stats date parsing edge cases (null/short dates → "N/A")
- _check_cache naive datetime handling (tzinfo=None → UTC)
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

from ado_git_repo_insights.ml.insights import LLMInsightsGenerator


class TestGetPrStatsDateParsing:
    """Tests for _get_pr_stats date range fallback to 'N/A'."""

    def _make_generator(self, tmp_path: Path) -> LLMInsightsGenerator:
        """Create a generator with a mock db."""
        db = MagicMock()
        return LLMInsightsGenerator(db=db, output_dir=tmp_path, dry_run=True)

    def _setup_db_mock(
        self,
        generator: LLMInsightsGenerator,
        min_date: str | None,
        max_date: str | None,
    ) -> None:
        """Configure the mock db to return specific min/max dates.

        _get_pr_stats calls db.execute() multiple times:
        1. COUNT completed PRs → {"cnt": 0}
        2. MIN/MAX closed_date → {"min_date": ..., "max_date": ...}
        3. AVG cycle_time_minutes → {"avg_cycle": None}
        4. P90 subquery → {"cycle_time_minutes": None} or None row
        5. COUNT DISTINCT user_id → {"cnt": 0}
        6. COUNT repositories → {"cnt": 0}
        """
        count_cursor = MagicMock()
        count_cursor.fetchone.return_value = {"cnt": 0}

        date_cursor = MagicMock()
        date_cursor.fetchone.return_value = {
            "min_date": min_date,
            "max_date": max_date,
        }

        avg_cursor = MagicMock()
        avg_cursor.fetchone.return_value = {"avg_cycle": None}

        p90_cursor = MagicMock()
        p90_cursor.fetchone.return_value = None  # No rows for P90

        authors_cursor = MagicMock()
        authors_cursor.fetchone.return_value = {"cnt": 0}

        repos_cursor = MagicMock()
        repos_cursor.fetchone.return_value = {"cnt": 0}

        mock_execute = generator.db.execute  # MagicMock from __init__
        assert isinstance(mock_execute, MagicMock)
        mock_execute.side_effect = [
            count_cursor,
            date_cursor,
            avg_cursor,
            p90_cursor,
            authors_cursor,
            repos_cursor,
        ]

    def test_null_dates_return_na(self, tmp_path: Path) -> None:
        """When min_date and max_date are None, returns 'N/A'."""
        gen = self._make_generator(tmp_path)
        self._setup_db_mock(gen, min_date=None, max_date=None)

        stats = gen._get_pr_stats()
        assert stats["date_range_start"] == "N/A"
        assert stats["date_range_end"] == "N/A"

    def test_short_dates_return_na(self, tmp_path: Path) -> None:
        """When date strings are too short (< 10 chars), returns 'N/A'."""
        gen = self._make_generator(tmp_path)
        self._setup_db_mock(gen, min_date="2024-01", max_date="2024")

        stats = gen._get_pr_stats()
        assert stats["date_range_start"] == "N/A"
        assert stats["date_range_end"] == "N/A"

    def test_valid_iso_dates_parsed(self, tmp_path: Path) -> None:
        """Full ISO datetime strings are truncated to date part."""
        gen = self._make_generator(tmp_path)
        self._setup_db_mock(
            gen,
            min_date="2024-01-15T10:30:00Z",
            max_date="2024-06-20T14:00:00Z",
        )

        stats = gen._get_pr_stats()
        assert stats["date_range_start"] == "2024-01-15"
        assert stats["date_range_end"] == "2024-06-20"

    def test_sqlite_space_separated_dates_parsed(self, tmp_path: Path) -> None:
        """SQLite-style 'YYYY-MM-DD HH:MM:SS' dates are truncated correctly.

        Regression test: split('T')[0] fails for space-separated timestamps
        because there is no 'T' to split on, returning the full datetime string.
        The [:10] slice handles both ISO 8601 and SQLite formats correctly.
        """
        gen = self._make_generator(tmp_path)
        self._setup_db_mock(
            gen,
            min_date="2024-03-15 14:30:00",
            max_date="2024-09-22 09:15:45",
        )

        stats = gen._get_pr_stats()
        assert stats["date_range_start"] == "2024-03-15"
        assert stats["date_range_end"] == "2024-09-22"

    def test_date_only_strings_parsed(self, tmp_path: Path) -> None:
        """Plain 'YYYY-MM-DD' strings (no time component) are returned as-is."""
        gen = self._make_generator(tmp_path)
        self._setup_db_mock(
            gen,
            min_date="2024-05-01",
            max_date="2024-12-31",
        )

        stats = gen._get_pr_stats()
        assert stats["date_range_start"] == "2024-05-01"
        assert stats["date_range_end"] == "2024-12-31"


class TestCheckCacheNaiveDatetime:
    """Tests for _check_cache handling of naive datetime strings."""

    def test_naive_cached_at_treated_as_utc(self, tmp_path: Path) -> None:
        """Cache file with naive datetime (no tzinfo) is treated as UTC."""
        db = MagicMock()
        gen = LLMInsightsGenerator(
            db=db, output_dir=tmp_path, cache_ttl_hours=24, dry_run=True
        )

        # Write a cache file with a naive datetime (no timezone)
        cache_key = "test-key"
        now_utc = datetime.now(timezone.utc)
        naive_str = now_utc.strftime("%Y-%m-%dT%H:%M:%S")  # No timezone

        cache_path = tmp_path / "cache.json"
        cache_data = {
            "cache_key": cache_key,
            "cached_at": naive_str,
            "insights_data": {"test": "data"},
        }
        cache_path.write_text(json.dumps(cache_data), encoding="utf-8")

        result = gen._check_cache(cache_path, cache_key)
        assert result == {"test": "data"}

    def test_aware_cached_at_also_works(self, tmp_path: Path) -> None:
        """Cache file with timezone-aware datetime also works."""
        db = MagicMock()
        gen = LLMInsightsGenerator(
            db=db, output_dir=tmp_path, cache_ttl_hours=24, dry_run=True
        )

        cache_key = "test-key"
        now_utc = datetime.now(timezone.utc)
        aware_str = now_utc.isoformat()  # Includes +00:00

        cache_path = tmp_path / "cache.json"
        cache_data = {
            "cache_key": cache_key,
            "cached_at": aware_str,
            "insights_data": {"test": "aware"},
        }
        cache_path.write_text(json.dumps(cache_data), encoding="utf-8")

        result = gen._check_cache(cache_path, cache_key)
        assert result == {"test": "aware"}

    def test_expired_cache_returns_none(self, tmp_path: Path) -> None:
        """Expired cache returns None even with naive datetime."""
        db = MagicMock()
        gen = LLMInsightsGenerator(
            db=db, output_dir=tmp_path, cache_ttl_hours=1, dry_run=True
        )

        cache_key = "test-key"
        # Set cached_at to 2 hours ago (expired for 1-hour TTL)
        from datetime import timedelta

        old_time = datetime.now(timezone.utc) - timedelta(hours=2)
        naive_str = old_time.strftime("%Y-%m-%dT%H:%M:%S")

        cache_path = tmp_path / "cache.json"
        cache_data = {
            "cache_key": cache_key,
            "cached_at": naive_str,
            "insights_data": {"test": "expired"},
        }
        cache_path.write_text(json.dumps(cache_data), encoding="utf-8")

        result = gen._check_cache(cache_path, cache_key)
        assert result is None
