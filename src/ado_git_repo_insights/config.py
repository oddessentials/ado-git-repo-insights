"""Configuration loader for ado-git-repo-insights.

Loads and validates configuration from YAML files or CLI arguments.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)


class ConfigurationError(Exception):
    """Configuration validation error."""


@dataclass
class APIConfig:
    """API configuration settings."""

    base_url: str = "https://dev.azure.com"
    version: str = "7.1-preview.1"
    rate_limit_sleep_seconds: float = 0.5
    max_retries: int = 3
    retry_delay_seconds: float = 5.0
    retry_backoff_multiplier: float = 2.0


@dataclass
class BackfillConfig:
    """Backfill configuration settings (Adjustment 1)."""

    enabled: bool = True
    window_days: int = 60  # Default: 60 days (configurable 30-90)


@dataclass
class DateRangeConfig:
    """Optional date range override."""

    start: date | None = None
    end: date | None = None


@dataclass
class Config:
    """Main configuration for ado-git-repo-insights."""

    organization: str
    projects: list[str]
    pat: str  # Will be masked in logs
    database: Path = field(default_factory=lambda: Path("ado-insights.sqlite"))
    api: APIConfig = field(default_factory=APIConfig)
    backfill: BackfillConfig = field(default_factory=BackfillConfig)
    date_range: DateRangeConfig = field(default_factory=DateRangeConfig)

    def __post_init__(self) -> None:
        """Validate configuration after initialization."""
        if not self.organization:
            raise ConfigurationError("organization is required")
        if not self.projects:
            raise ConfigurationError("At least one project is required")
        if not self.pat:
            raise ConfigurationError("PAT is required")

    def __repr__(self) -> str:
        """Repr with masked PAT (Invariant 19: Never expose secrets)."""
        return (
            f"Config(organization={self.organization!r}, "
            f"projects={self.projects!r}, "
            f"pat='********', "  # Masked
            f"database={self.database!r}, "
            f"api={self.api!r}, "
            f"backfill={self.backfill!r}, "
            f"date_range={self.date_range!r})"
        )

    def log_summary(self) -> None:
        """Log configuration summary (with PAT masked)."""
        logger.info(f"Organization: {self.organization}")
        logger.info(f"Projects: {', '.join(self.projects)}")
        logger.info(f"Database: {self.database}")
        logger.info(f"PAT: {'*' * 8}...{'*' * 4}")  # Invariant 19: Never log PAT
        if self.date_range.start or self.date_range.end:
            logger.info(f"Date range: {self.date_range.start} → {self.date_range.end}")
        if self.backfill.enabled:
            logger.info(f"Backfill: {self.backfill.window_days} days")


def load_config(
    config_path: Path | None = None,
    organization: str | None = None,
    projects: str | None = None,
    pat: str | None = None,
    database: Path | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    backfill_days: int | None = None,
) -> Config:
    """Load configuration from file and/or CLI arguments.

    CLI arguments override file values.

    Args:
        config_path: Path to config.yaml file.
        organization: Organization name (CLI override).
        projects: Comma-separated project names (CLI override).
        pat: Personal Access Token (CLI override).
        database: Database path (CLI override).
        start_date: Start date YYYY-MM-DD (CLI override).
        end_date: End date YYYY-MM-DD (CLI override).
        backfill_days: Backfill window in days (CLI override).

    Returns:
        Validated Config instance.

    Raises:
        ConfigurationError: If configuration is invalid.
    """
    # Start with defaults
    config_data: dict[str, object] = {}

    # Load from file if provided
    if config_path and config_path.exists():
        logger.info(f"Loading configuration from {config_path}")
        with config_path.open() as f:
            config_data = yaml.safe_load(f) or {}

    # Apply CLI overrides
    if organization:
        config_data["organization"] = organization
    if projects:
        config_data["projects"] = [p.strip() for p in projects.split(",")]
    if pat:
        config_data["pat"] = pat
    elif not config_data.get("pat"):
        # Try environment variable
        config_data["pat"] = os.environ.get("ADO_PAT", "")

    # Narrow nested dicts from YAML (values are object after deserialization)
    def _sub(key: str) -> dict[str, object]:
        val = config_data.get(key, {})
        return val if isinstance(val, dict) else {}

    def _str(d: dict[str, object], key: str, default: str) -> str:
        val = d.get(key)
        return str(val) if val is not None else default

    def _float(d: dict[str, object], key: str, default: float) -> float:
        val = d.get(key)
        if not isinstance(val, (int, float, str)):
            return default
        try:
            return float(val)
        except (ValueError, TypeError) as exc:
            raise ConfigurationError(
                f"Expected numeric value for '{key}', got: {val!r}"
            ) from exc

    def _int(d: dict[str, object], key: str, default: int) -> int:
        val = d.get(key)
        if not isinstance(val, (int, str)):
            return default
        try:
            return int(val)
        except (ValueError, TypeError) as exc:
            raise ConfigurationError(
                f"Expected integer value for '{key}', got: {val!r}"
            ) from exc

    # Build API config
    api_data = _sub("api")
    api_config = APIConfig(
        base_url=_str(api_data, "base_url", "https://dev.azure.com"),
        version=_str(api_data, "version", "7.1-preview.1"),
        rate_limit_sleep_seconds=_float(api_data, "rate_limit_sleep_seconds", 0.5),
        max_retries=_int(api_data, "max_retries", 3),
        retry_delay_seconds=_float(api_data, "retry_delay_seconds", 5.0),
        retry_backoff_multiplier=_float(api_data, "retry_backoff_multiplier", 2.0),
    )

    # Build backfill config
    backfill_data = _sub("backfill")
    backfill_config = BackfillConfig(
        enabled=backfill_data.get("enabled") is not False,
        window_days=backfill_days or _int(backfill_data, "window_days", 60),
    )

    # Build date range config
    date_range = DateRangeConfig()
    dr_data = _sub("date_range")
    try:
        if start_date:
            date_range.start = date.fromisoformat(start_date)
        elif dr_data.get("start"):
            date_range.start = date.fromisoformat(str(dr_data["start"]))
    except ValueError as e:
        raise ConfigurationError(
            f"Invalid start_date format (expected YYYY-MM-DD): {e}"
        ) from e

    try:
        if end_date:
            date_range.end = date.fromisoformat(end_date)
        elif dr_data.get("end"):
            date_range.end = date.fromisoformat(str(dr_data["end"]))
    except ValueError as e:
        raise ConfigurationError(
            f"Invalid end_date format (expected YYYY-MM-DD): {e}"
        ) from e

    if date_range.start and date_range.end and date_range.start > date_range.end:
        raise ConfigurationError(
            f"start_date ({date_range.start}) must be <= end_date ({date_range.end})"
        )

    # Build main config — only accept str values for required fields;
    # non-str (null, dict, int) falls through as "" so __post_init__ rejects it.
    raw_org = config_data.get("organization", "")
    raw_projects = config_data.get("projects", [])
    raw_pat = config_data.get("pat", "")
    raw_db = config_data.get("database", "ado-insights.sqlite")
    return Config(
        organization=raw_org if isinstance(raw_org, str) else "",
        projects=raw_projects if isinstance(raw_projects, list) else [],
        pat=raw_pat if isinstance(raw_pat, str) else "",
        database=database
        or Path(raw_db if isinstance(raw_db, str) else "ado-insights.sqlite"),
        api=api_config,
        backfill=backfill_config,
        date_range=date_range,
    )
