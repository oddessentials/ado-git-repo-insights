"""Configuration loader for ado-git-repo-insights.

Loads and validates configuration from YAML files or CLI arguments.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

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
    config_data: dict[str, Any] = {}

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

    # Build API config
    api_data = config_data.get("api", {})
    api_config = APIConfig(
        base_url=api_data.get("base_url", "https://dev.azure.com"),
        version=api_data.get("version", "7.1-preview.1"),
        rate_limit_sleep_seconds=api_data.get("rate_limit_sleep_seconds", 0.5),
        max_retries=api_data.get("max_retries", 3),
        retry_delay_seconds=api_data.get("retry_delay_seconds", 5.0),
        retry_backoff_multiplier=api_data.get("retry_backoff_multiplier", 2.0),
    )

    # Build backfill config
    backfill_data = config_data.get("backfill", {})
    backfill_config = BackfillConfig(
        enabled=backfill_data.get("enabled", True),
        window_days=backfill_days or backfill_data.get("window_days", 60),
    )

    # Build date range config
    date_range = DateRangeConfig()
    if start_date:
        date_range.start = date.fromisoformat(start_date)
    elif config_data.get("date_range", {}).get("start"):
        date_range.start = date.fromisoformat(config_data["date_range"]["start"])

    if end_date:
        date_range.end = date.fromisoformat(end_date)
    elif config_data.get("date_range", {}).get("end"):
        date_range.end = date.fromisoformat(config_data["date_range"]["end"])

    # Build main config
    return Config(
        organization=config_data.get("organization", ""),
        projects=config_data.get("projects", []),
        pat=config_data.get("pat", ""),
        database=database or Path(config_data.get("database", "ado-insights.sqlite")),
        api=api_config,
        backfill=backfill_config,
        date_range=date_range,
    )
