"""Datetime utilities for ado-git-repo-insights.

Ported from the original generate_raw_data.py to ensure identical behavior.
"""

from __future__ import annotations

import logging
from datetime import datetime

logger = logging.getLogger(__name__)


def parse_iso_datetime(date_str: str | None) -> datetime | None:
    """Parse ISO 8601 datetime strings from ADO API.

    Handles 7-digit microseconds and 'Z' suffix quirks from ADO API responses.
    Preserved from original implementation for compatibility.

    Args:
        date_str: ISO 8601 datetime string, or None.

    Returns:
        Parsed datetime, or None if parsing fails or input is None.

    Examples:
        >>> parse_iso_datetime("2024-01-15T10:30:45.1234567Z")
        datetime.datetime(2024, 1, 15, 10, 30, 45, 123456)
        >>> parse_iso_datetime(None)
        None
    """
    if not date_str:
        return None

    try:
        # Remove trailing 'Z' (Zulu/UTC indicator)
        date_str = date_str.rstrip("Z")

        if "." in date_str:
            # ADO API sometimes returns 7-digit microseconds, Python only supports 6
            date_part, microseconds = date_str.split(".")
            microseconds = microseconds[:6]  # Truncate to 6 digits
            date_str = f"{date_part}.{microseconds}"
            return datetime.strptime(date_str, "%Y-%m-%dT%H:%M:%S.%f")
        else:
            # No microseconds
            return datetime.strptime(date_str, "%Y-%m-%dT%H:%M:%S")

    except ValueError as e:
        logger.warning(f"Failed to parse date '{date_str}': {e}")
        return None


def calculate_cycle_time_minutes(
    creation_date: str | None, closed_date: str | None
) -> float | None:
    """Calculate PR cycle time in minutes.

    Cycle time is the duration from PR creation to closure.
    Minimum value is 1 minute to avoid zero/negative values.

    Args:
        creation_date: ISO 8601 creation date string.
        closed_date: ISO 8601 closed date string.

    Returns:
        Cycle time in minutes (minimum 1.0), or None if dates are invalid.

    Examples:
        >>> calculate_cycle_time_minutes(
        ...     "2024-01-15T10:00:00Z",
        ...     "2024-01-15T10:30:00Z"
        ... )
        30.0
    """
    created = parse_iso_datetime(creation_date)
    closed = parse_iso_datetime(closed_date)

    if created and closed:
        delta_seconds = (closed - created).total_seconds()
        minutes = delta_seconds / 60
        # Minimum 1 minute, rounded to 2 decimal places
        return max(1.0, round(minutes, 2))

    return None


def format_date_for_api(dt: datetime) -> str:
    """Format a datetime for ADO API queries.

    Args:
        dt: Datetime to format.

    Returns:
        ISO 8601 formatted string with 'Z' suffix.

    Examples:
        >>> format_date_for_api(datetime(2024, 1, 15, 10, 30, 0))
        '2024-01-15T10:30:00Z'
    """
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
