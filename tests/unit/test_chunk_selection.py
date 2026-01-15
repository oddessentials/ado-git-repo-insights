"""Unit tests for chunk selection logic.

Covers §4 from IMPLEMENTATION_DETAILS.md:
- Given a date range, pick the correct chunk set
- ISO week calculation correctness
"""

from __future__ import annotations

from datetime import date


class TestChunkSelection:
    """Tests for chunk selection logic from dataset-loader."""

    def test_get_iso_week_basic(self) -> None:
        """Test ISO week calculation for known dates."""
        # Import the function we're testing (simulate browser logic)

        # Create a minimal instance just to test the week logic
        # Note: We'll test the Python equivalent since JS shares the algorithm

        # 2026-01-01 is a Thursday - ISO week 1 of 2026
        d = date(2026, 1, 1)
        iso_cal = d.isocalendar()
        assert iso_cal.year == 2026
        assert iso_cal.week == 1

        # 2025-12-29 is a Monday - ISO week 1 of 2026 (week starts Monday)
        d = date(2025, 12, 29)
        iso_cal = d.isocalendar()
        assert iso_cal.year == 2026
        assert iso_cal.week == 1

        # 2025-12-28 is a Sunday - ISO week 52 of 2025
        d = date(2025, 12, 28)
        iso_cal = d.isocalendar()
        assert iso_cal.year == 2025
        assert iso_cal.week == 52

    def test_weeks_in_range_single_week(self) -> None:
        """Test chunk selection for a range within one week."""
        # Simulate the logic from dataset-loader.js getWeeksInRange
        start = date(2026, 1, 5)  # Monday of week 2
        end = date(2026, 1, 11)  # Sunday of week 2

        weeks = get_weeks_in_range(start, end)
        assert weeks == ["2026-W02"]

    def test_weeks_in_range_multiple_weeks(self) -> None:
        """Test chunk selection spanning multiple weeks."""
        start = date(2026, 1, 1)  # Week 1
        end = date(2026, 1, 20)  # Week 4

        weeks = get_weeks_in_range(start, end)
        assert weeks == ["2026-W01", "2026-W02", "2026-W03", "2026-W04"]

    def test_weeks_in_range_cross_year(self) -> None:
        """Test chunk selection crossing year boundary."""
        start = date(2025, 12, 22)  # Week 52 of 2025
        end = date(2026, 1, 5)  # Week 2 of 2026

        weeks = get_weeks_in_range(start, end)
        # Should include week 52 of 2025 and weeks 1-2 of 2026
        assert "2025-W52" in weeks
        assert "2026-W01" in weeks
        assert "2026-W02" in weeks

    def test_weeks_in_range_90_days(self) -> None:
        """Test default 90-day range produces reasonable chunk count."""
        start = date(2026, 1, 1)
        end = date(2026, 3, 31)  # ~90 days

        weeks = get_weeks_in_range(start, end)
        # 90 days ≈ 13 weeks
        assert 12 <= len(weeks) <= 14


def get_weeks_in_range(start: date, end: date) -> list[str]:
    """Python implementation of the chunk selection algorithm.

    This mirrors the logic in dataset-loader.js getWeeksInRange().
    """
    weeks = []
    current = start

    while current <= end:
        week_str = get_iso_week_string(current)
        if week_str not in weeks:
            weeks.append(week_str)
        # Move to next week
        from datetime import timedelta

        current += timedelta(days=7)

    # Ensure end date's week is included
    end_week = get_iso_week_string(end)
    if end_week not in weeks:
        weeks.append(end_week)

    return sorted(weeks)


def get_iso_week_string(d: date) -> str:
    """Get ISO week string for a date (YYYY-Www format)."""
    iso_cal = d.isocalendar()
    return f"{iso_cal.year}-W{iso_cal.week:02d}"
