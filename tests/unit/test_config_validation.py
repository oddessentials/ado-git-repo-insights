"""Unit tests for configuration validation."""

from pathlib import Path

import pytest

from ado_git_repo_insights.config import (
    APIConfig,
    BackfillConfig,
    Config,
    ConfigurationError,
    DateRangeConfig,
)


class TestConfigValidation:
    """Tests for Config dataclass validation."""

    def test_valid_config_creates_successfully(self) -> None:
        """Test that valid config parameters create a Config successfully."""
        config = Config(
            organization="test-org",
            projects=["project1", "project2"],
            pat="test-pat-token",
            database=Path("test.sqlite"),
        )
        assert config.organization == "test-org"
        assert config.projects == ["project1", "project2"]
        assert config.pat == "test-pat-token"

    def test_missing_organization_raises_error(self) -> None:
        """Test that missing organization raises ConfigurationError."""
        with pytest.raises(ConfigurationError, match="organization is required"):
            Config(
                organization="",
                projects=["project1"],
                pat="test-pat",
                database=Path("test.sqlite"),
            )

    def test_empty_projects_raises_error(self) -> None:
        """Test that empty projects list raises ConfigurationError."""
        with pytest.raises(
            ConfigurationError, match="At least one project is required"
        ):
            Config(
                organization="test-org",
                projects=[],
                pat="test-pat",
                database=Path("test.sqlite"),
            )

    def test_missing_pat_raises_error(self) -> None:
        """Test that missing PAT raises ConfigurationError."""
        with pytest.raises(ConfigurationError, match="PAT is required"):
            Config(
                organization="test-org",
                projects=["project1"],
                pat="",
                database=Path("test.sqlite"),
            )

    def test_config_repr_masks_pat(self) -> None:
        """Test that Config repr masks the PAT (Invariant 19)."""
        config = Config(
            organization="test-org",
            projects=["project1"],
            pat="super-secret-token",
            database=Path("test.sqlite"),
        )
        repr_str = repr(config)
        assert "super-secret-token" not in repr_str
        assert "********" in repr_str

    def test_default_api_config(self) -> None:
        """Test that default API config is applied."""
        config = Config(
            organization="test-org",
            projects=["project1"],
            pat="test-pat",
            database=Path("test.sqlite"),
        )
        assert config.api.base_url == "https://dev.azure.com"
        assert config.api.version == "7.1-preview.1"

    def test_custom_api_config(self) -> None:
        """Test that custom API config can be provided."""
        custom_api = APIConfig(
            base_url="https://custom.azure.com",
            version="6.0",
            rate_limit_sleep_seconds=1.0,
        )
        config = Config(
            organization="test-org",
            projects=["project1"],
            pat="test-pat",
            database=Path("test.sqlite"),
            api=custom_api,
        )
        assert config.api.base_url == "https://custom.azure.com"
        assert config.api.version == "6.0"


class TestAPIConfigDefaults:
    """Tests for APIConfig defaults."""

    def test_default_values(self) -> None:
        """Test default APIConfig values."""
        api = APIConfig()
        assert api.base_url == "https://dev.azure.com"
        assert api.version == "7.1-preview.1"
        assert api.rate_limit_sleep_seconds == 0.5
        assert api.max_retries == 3
        assert api.retry_delay_seconds == 5
        assert api.retry_backoff_multiplier == 2.0


class TestBackfillConfigDefaults:
    """Tests for BackfillConfig defaults."""

    def test_default_values(self) -> None:
        """Test default BackfillConfig values."""
        backfill = BackfillConfig()
        assert backfill.enabled is True
        assert backfill.window_days == 60


class TestDateRangeConfigDefaults:
    """Tests for DateRangeConfig defaults."""

    def test_default_values(self) -> None:
        """Test default DateRangeConfig values."""
        date_range = DateRangeConfig()
        assert date_range.start is None
        assert date_range.end is None
