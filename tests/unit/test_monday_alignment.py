"""Unit tests for Monday alignment edge cases (Phase 5)."""

from __future__ import annotations

from datetime import date

from ado_git_repo_insights.ml.date_utils import align_to_monday, get_next_monday


class TestMondayAlignmentEdgeCases:
    """Test Monday alignment with year-boundary edge cases."""

    def test_jan1_2026_thursday_belongs_to_2026_w01(self) -> None:
        """Jan 1, 2026 (Thursday) belongs to 2026-W01 starting Dec 29, 2025."""
        # Jan 1, 2026 is a Thursday
        d = date(2026, 1, 1)
        monday = align_to_monday(d)

        # ISO week 2026-W01 starts on Monday, December 29, 2025
        assert monday == date(2025, 12, 29)
        assert monday.weekday() == 0  # Monday

    def test_jan1_2027_friday_belongs_to_2026_w53(self) -> None:
        """Jan 1, 2027 (Friday) belongs to 2026-W53 starting Dec 28, 2026."""
        # Jan 1, 2027 is a Friday
        d = date(2027, 1, 1)
        monday = align_to_monday(d)

        # Should align to 2026-W53 starting Monday, Dec 28, 2026
        assert monday == date(2026, 12, 28)
        assert monday.weekday() == 0

    def test_dec28_2026_is_week53_monday(self) -> None:
        """Dec 28, 2026 is Monday of week 53 (2026-W53)."""
        d = date(2026, 12, 28)
        monday = align_to_monday(d)

        # Should return itself (already Monday)
        assert monday == date(2026, 12, 28)
        assert monday.weekday() == 0

    def test_dec31_2026_belongs_to_week53(self) -> None:
        """Dec 31, 2026 (Thursday) belongs to 2026-W53."""
        d = date(2026, 12, 31)
        monday = align_to_monday(d)

        # Should align to Monday of same ISO week (W53)
        assert monday == date(2026, 12, 28)
        assert monday.weekday() == 0

    def test_jan2_2026_friday_same_as_jan1(self) -> None:
        """Jan 2, 2026 (Friday) belongs to same week as Jan 1."""
        d = date(2026, 1, 2)
        monday = align_to_monday(d)

        # Same 2026-W01 starting Dec 29, 2025
        assert monday == date(2025, 12, 29)

    def test_jan5_2026_monday_is_week2(self) -> None:
        """Jan 5, 2026 (Monday) is the start of 2026-W02."""
        d = date(2026, 1, 5)
        monday = align_to_monday(d)

        # Should return itself (Monday of W02)
        assert monday == date(2026, 1, 5)
        assert monday.weekday() == 0

    def test_get_next_monday_from_thursday(self) -> None:
        """get_next_monday from Thursday should return following Monday."""
        d = date(2026, 1, 1)  # Thursday
        next_mon = get_next_monday(d)

        assert next_mon == date(2026, 1, 5)  # Monday
        assert next_mon.weekday() == 0

    def test_get_next_monday_from_monday(self) -> None:
        """get_next_monday from Monday should return same day."""
        d = date(2026, 1, 5)  # Monday
        next_mon = get_next_monday(d)

        assert next_mon == date(2026, 1, 5)  # Same day
        assert next_mon.weekday() == 0

    def test_get_next_monday_from_sunday(self) -> None:
        """get_next_monday from Sunday should return next day (Monday)."""
        d = date(2026, 1, 4)  # Sunday
        next_mon = get_next_monday(d)

        assert next_mon == date(2026, 1, 5)  # Next day
        assert next_mon.weekday() == 0
