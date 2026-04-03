"""Unit tests for configuration validation."""

from pathlib import Path

import pytest

from ado_git_repo_insights.config import (
    APIConfig,
    BackfillConfig,
    Config,
    ConfigurationError,
    DateRangeConfig,
    load_config,
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


class TestLoadConfigBackfillEnabled:
    """Tests for backfill.enabled boolean parsing (QG-40 regression)."""

    def test_backfill_enabled_true(self, tmp_path: Path) -> None:
        config_file = tmp_path / "config.yaml"
        config_file.write_text(
            "organization: x\nprojects:\n  - p\npat: t\nbackfill:\n  enabled: true\n"
        )
        config = load_config(config_path=config_file, database=Path("test.sqlite"))
        assert config.backfill.enabled is True

    def test_backfill_enabled_false(self, tmp_path: Path) -> None:
        config_file = tmp_path / "config.yaml"
        config_file.write_text(
            "organization: x\nprojects:\n  - p\npat: t\nbackfill:\n  enabled: false\n"
        )
        config = load_config(config_path=config_file, database=Path("test.sqlite"))
        assert config.backfill.enabled is False

    def test_backfill_enabled_zero_defaults_to_true(self, tmp_path: Path) -> None:
        """YAML `enabled: 0` is int, not bool — must default to True."""
        config_file = tmp_path / "config.yaml"
        config_file.write_text(
            "organization: x\nprojects:\n  - p\npat: t\nbackfill:\n  enabled: 0\n"
        )
        config = load_config(config_path=config_file, database=Path("test.sqlite"))
        assert config.backfill.enabled is True

    def test_backfill_enabled_missing_defaults_to_true(self, tmp_path: Path) -> None:
        config_file = tmp_path / "config.yaml"
        config_file.write_text(
            "organization: x\nprojects:\n  - p\npat: t\nbackfill:\n  window_days: 30\n"
        )
        config = load_config(config_path=config_file, database=Path("test.sqlite"))
        assert config.backfill.enabled is True


class TestLoadConfigRequiredStringFields:
    """Tests for required string field validation (QG-40 regression).

    str() coercion must not silently convert non-string YAML values into
    truthy strings that bypass __post_init__ checks.
    """

    def test_null_organization_raises_configuration_error(self, tmp_path: Path) -> None:
        config_file = tmp_path / "config.yaml"
        config_file.write_text("organization: null\nprojects:\n  - p\npat: t\n")
        with pytest.raises(ConfigurationError, match="organization is required"):
            load_config(config_path=config_file, database=Path("test.sqlite"))

    def test_dict_organization_raises_configuration_error(self, tmp_path: Path) -> None:
        config_file = tmp_path / "config.yaml"
        config_file.write_text("organization:\n  name: foo\nprojects:\n  - p\npat: t\n")
        with pytest.raises(ConfigurationError, match="organization is required"):
            load_config(config_path=config_file, database=Path("test.sqlite"))

    def test_null_pat_raises_configuration_error(self, tmp_path: Path) -> None:
        config_file = tmp_path / "config.yaml"
        config_file.write_text("organization: x\nprojects:\n  - p\npat: null\n")
        with pytest.raises(ConfigurationError, match="PAT is required"):
            load_config(config_path=config_file, database=Path("test.sqlite"))

    def test_integer_pat_raises_configuration_error(self, tmp_path: Path) -> None:
        config_file = tmp_path / "config.yaml"
        config_file.write_text("organization: x\nprojects:\n  - p\npat: 12345\n")
        with pytest.raises(ConfigurationError, match="PAT is required"):
            load_config(config_path=config_file, database=Path("test.sqlite"))

    def test_valid_string_fields_pass(self, tmp_path: Path) -> None:
        config_file = tmp_path / "config.yaml"
        config_file.write_text("organization: my-org\nprojects:\n  - p\npat: my-pat\n")
        config = load_config(config_path=config_file, database=Path("test.sqlite"))
        assert config.organization == "my-org"
        assert config.pat == "my-pat"


class TestLoadConfigNumericCoercion:
    """Tests for numeric config value validation (QG-40 regression)."""

    def test_non_numeric_max_retries_raises_configuration_error(
        self, tmp_path: Path
    ) -> None:
        """Non-numeric string for max_retries raises ConfigurationError."""
        config_file = tmp_path / "config.yaml"
        config_file.write_text(
            "organization: x\nprojects:\n  - p\npat: t\napi:\n  max_retries: three\n"
        )
        with pytest.raises(ConfigurationError, match="Expected integer.*max_retries"):
            load_config(config_path=config_file, database=Path("test.sqlite"))

    def test_non_numeric_retry_delay_raises_configuration_error(
        self, tmp_path: Path
    ) -> None:
        """Non-numeric string for retry_delay_seconds raises ConfigurationError."""
        config_file = tmp_path / "config.yaml"
        config_file.write_text(
            "organization: x\nprojects:\n  - p\npat: t\n"
            "api:\n  retry_delay_seconds: fast\n"
        )
        with pytest.raises(ConfigurationError, match="Expected numeric.*retry_delay"):
            load_config(config_path=config_file, database=Path("test.sqlite"))

    def test_non_numeric_window_days_raises_configuration_error(
        self, tmp_path: Path
    ) -> None:
        """Non-numeric string for window_days raises ConfigurationError."""
        config_file = tmp_path / "config.yaml"
        config_file.write_text(
            "organization: x\nprojects:\n  - p\npat: t\n"
            "backfill:\n  window_days: lots\n"
        )
        with pytest.raises(ConfigurationError, match="Expected integer.*window_days"):
            load_config(config_path=config_file, database=Path("test.sqlite"))

    def test_valid_numeric_strings_coerce_correctly(self, tmp_path: Path) -> None:
        """Numeric strings like '5' coerce without error."""
        config_file = tmp_path / "config.yaml"
        config_file.write_text(
            "organization: x\nprojects:\n  - p\npat: t\n"
            "api:\n  max_retries: '5'\n  retry_delay_seconds: '2.5'\n"
        )
        config = load_config(config_path=config_file, database=Path("test.sqlite"))
        assert config.api.max_retries == 5
        assert config.api.retry_delay_seconds == 2.5


class TestLoadConfigDateValidation:
    """Tests for date validation in load_config."""

    def test_invalid_start_date_raises(self) -> None:
        """Invalid start_date format raises ConfigurationError."""
        with pytest.raises(ConfigurationError, match="Invalid start_date format"):
            load_config(
                organization="x",
                projects="p",
                pat="t",
                database=Path("test.sqlite"),
                start_date="not-a-date",
            )

    def test_invalid_end_date_raises(self) -> None:
        """Invalid end_date format raises ConfigurationError."""
        with pytest.raises(ConfigurationError, match="Invalid end_date format"):
            load_config(
                organization="x",
                projects="p",
                pat="t",
                database=Path("test.sqlite"),
                end_date="31-01-2024",
            )

    def test_valid_dates_parsed_from_cli(self) -> None:
        """Valid CLI start/end dates are parsed into config.date_range."""
        from datetime import date

        config = load_config(
            organization="x",
            projects="p",
            pat="t",
            database=Path("test.sqlite"),
            start_date="2024-01-15",
            end_date="2024-06-30",
        )
        assert config.date_range.start == date(2024, 1, 15)
        assert config.date_range.end == date(2024, 6, 30)

    def test_dates_parsed_from_config_file(self, tmp_path: Path) -> None:
        """Dates in a YAML config file are parsed into config.date_range."""
        from datetime import date

        config_file = tmp_path / "config.yaml"
        config_file.write_text(
            "organization: x\n"
            "projects:\n  - p\n"
            "pat: t\n"
            "date_range:\n"
            "  start: '2024-01-15'\n"
            "  end: '2024-06-30'\n"
        )
        config = load_config(config_path=config_file, database=Path("test.sqlite"))
        assert config.date_range.start == date(2024, 1, 15)
        assert config.date_range.end == date(2024, 6, 30)

    def test_start_after_end_raises(self) -> None:
        """start_date after end_date raises ConfigurationError."""
        with pytest.raises(
            ConfigurationError, match="start_date .* must be <= end_date"
        ):
            load_config(
                organization="x",
                projects="p",
                pat="t",
                database=Path("test.sqlite"),
                start_date="2024-06-01",
                end_date="2024-01-01",
            )
