"""Date utility functions for ML forecasting.

Provides ISO-week-aware date alignment functions with edge-case handling
for year boundaries and week 53 scenarios.
"""

from __future__ import annotations

from datetime import date, timedelta


def align_to_monday(d: date) -> date:
    """Align a date to the Monday of its ISO week.

    Uses ISO week date system (ISO 8601), which ensures:
    - Week 1 is the week containing the first Thursday of the year
    - Weeks start on Monday and end on Sunday
    - A year has 52 or 53 weeks

    Edge cases handled:
    - Jan 1-3 may belong to the previous year's week 53
    - Dec 29-31 may belong to the next year's week 1
    - Week 53 correctly spans year boundaries

    Args:
        d: Input date to align

    Returns:
        Monday of the ISO week containing d

    Examples:
        >>> align_to_monday(date(2026, 1, 1))  # Thursday
        date(2025, 12, 29)  # Previous year's Monday

        >>> align_to_monday(date(2026, 12, 28))  # Monday of week 53
        date(2026, 12, 28)

        >>> align_to_monday(date(2026, 12, 30))  # Wednesday of week 53
        date(2026, 12, 28)  # Monday of same ISO week
    """
    iso_year, iso_week, _ = d.isocalendar()
    return date.fromisocalendar(iso_year, iso_week, 1)


def get_next_monday(d: date | None = None) -> date:
    """Get the next Monday from a given date (or today).

    Args:
        d: Input date, defaults to today

    Returns:
        The next Monday (or today if today is Monday)

    Examples:
        >>> get_next_monday(date(2026, 1, 15))  # Thursday
        date(2026, 1, 19)  # Next Monday

        >>> get_next_monday(date(2026, 1, 19))  # Monday
        date(2026, 1, 19)  # Same day
    """
    if d is None:
        d = date.today()

    # If already Monday, return as-is
    if d.weekday() == 0:
        return d

    # Calculate days until next Monday
    days_until_monday = (7 - d.weekday()) % 7
    return d + timedelta(days=days_until_monday)
