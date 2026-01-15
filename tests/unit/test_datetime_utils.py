"""Unit tests for datetime utilities."""

from datetime import datetime

from ado_git_repo_insights.utils.datetime_utils import (
    calculate_cycle_time_minutes,
    format_date_for_api,
    parse_iso_datetime,
)


class TestParseIsoDatetime:
    """Tests for parse_iso_datetime function."""

    def test_parse_standard_datetime_with_z_suffix(self) -> None:
        """Test parsing standard ISO datetime with Z suffix."""
        result = parse_iso_datetime("2024-01-15T10:30:45Z")
        assert result == datetime(2024, 1, 15, 10, 30, 45)

    def test_parse_datetime_with_microseconds(self) -> None:
        """Test parsing datetime with 6-digit microseconds."""
        result = parse_iso_datetime("2024-01-15T10:30:45.123456Z")
        assert result == datetime(2024, 1, 15, 10, 30, 45, 123456)

    def test_parse_datetime_with_7_digit_microseconds(self) -> None:
        """Test ADO API quirk: 7-digit microseconds truncated to 6."""
        result = parse_iso_datetime("2024-01-15T10:30:45.1234567Z")
        assert result == datetime(2024, 1, 15, 10, 30, 45, 123456)

    def test_parse_none_returns_none(self) -> None:
        """Test that None input returns None."""
        assert parse_iso_datetime(None) is None

    def test_parse_empty_string_returns_none(self) -> None:
        """Test that empty string returns None."""
        assert parse_iso_datetime("") is None

    def test_parse_invalid_datetime_returns_none(self) -> None:
        """Test that invalid datetime strings return None."""
        assert parse_iso_datetime("not-a-date") is None

    def test_parse_malformed_datetime_returns_none(self) -> None:
        """Test that malformed datetime returns None with logging."""
        assert parse_iso_datetime("2024-13-45T99:99:99Z") is None

    def test_parse_datetime_without_z_suffix(self) -> None:
        """Test parsing datetime without Z suffix."""
        result = parse_iso_datetime("2024-01-15T10:30:45")
        assert result == datetime(2024, 1, 15, 10, 30, 45)


class TestCalculateCycleTimeMinutes:
    """Tests for calculate_cycle_time_minutes function."""

    def test_calculate_30_minute_cycle(self) -> None:
        """Test basic 30-minute cycle time calculation."""
        result = calculate_cycle_time_minutes(
            "2024-01-15T10:00:00Z", "2024-01-15T10:30:00Z"
        )
        assert result == 30.0

    def test_calculate_with_rounding(self) -> None:
        """Test cycle time with sub-minute precision rounding."""
        result = calculate_cycle_time_minutes(
            "2024-01-15T10:00:00Z",
            "2024-01-15T10:01:30Z",  # 90 seconds = 1.5 minutes
        )
        assert result == 1.5

    def test_minimum_cycle_time_is_one_minute(self) -> None:
        """Test that minimum cycle time is 1 minute."""
        result = calculate_cycle_time_minutes(
            "2024-01-15T10:00:00Z",
            "2024-01-15T10:00:10Z",  # 10 seconds
        )
        assert result == 1.0  # Minimum is 1 minute

    def test_none_creation_date_returns_none(self) -> None:
        """Test that None creation date returns None."""
        result = calculate_cycle_time_minutes(None, "2024-01-15T10:30:00Z")
        assert result is None

    def test_none_closed_date_returns_none(self) -> None:
        """Test that None closed date returns None."""
        result = calculate_cycle_time_minutes("2024-01-15T10:00:00Z", None)
        assert result is None

    def test_both_none_returns_none(self) -> None:
        """Test that both None returns None."""
        result = calculate_cycle_time_minutes(None, None)
        assert result is None

    def test_invalid_dates_return_none(self) -> None:
        """Test that invalid date strings return None."""
        result = calculate_cycle_time_minutes("invalid", "also-invalid")
        assert result is None


class TestFormatDateForApi:
    """Tests for format_date_for_api function."""

    def test_format_basic_datetime(self) -> None:
        """Test formatting a basic datetime."""
        dt = datetime(2024, 1, 15, 10, 30, 0)
        result = format_date_for_api(dt)
        assert result == "2024-01-15T10:30:00Z"

    def test_format_datetime_with_seconds(self) -> None:
        """Test formatting datetime with specific seconds."""
        dt = datetime(2024, 12, 31, 23, 59, 59)
        result = format_date_for_api(dt)
        assert result == "2024-12-31T23:59:59Z"

    def test_format_midnight(self) -> None:
        """Test formatting midnight datetime."""
        dt = datetime(2024, 1, 1, 0, 0, 0)
        result = format_date_for_api(dt)
        assert result == "2024-01-01T00:00:00Z"
