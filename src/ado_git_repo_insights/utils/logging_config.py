"""Logging configuration with selective secret redaction.

Provides console and JSONL logging formats with precise redaction rules.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class RedactionConfig:
    """Configuration for selective secret redaction."""

    # Known secret value patterns (regex)
    value_patterns: list[str] = field(
        default_factory=lambda: [
            r"[A-Za-z0-9]{52}",  # Azure DevOps PAT format (52 chars)
            r"Bearer\s+[A-Za-z0-9\-._~+/]+=*",  # Bearer tokens
        ]
    )

    # Explicit key deny-list (exact matches, case-insensitive)
    key_denylist: set[str] = field(
        default_factory=lambda: {
            "pat",
            "personal_access_token",
            "auth_header",
            "authorization",
            "webhook_url",
            "secret",
            "password",
        }
    )

    def should_redact_key(self, key: str) -> bool:
        """Check if a key should be redacted based on deny-list."""
        return key.lower() in self.key_denylist

    def redact_value(self, value: str) -> str:
        """Redact known secret patterns in a value."""
        result = value
        for pattern in self.value_patterns:
            result = re.sub(pattern, "***REDACTED***", result)
        return result


class RedactingFormatter(logging.Formatter):
    """Formatter that redacts sensitive information."""

    def __init__(self, fmt: str | None = None, datefmt: str | None = None) -> None:
        super().__init__(fmt, datefmt)
        self.redaction_config = RedactionConfig()

    def format(self, record: logging.LogRecord) -> str:
        # Redact message
        if isinstance(record.msg, str):
            record.msg = self.redaction_config.redact_value(record.msg)

        # Redact args
        if record.args:
            record.args = tuple(
                self.redaction_config.redact_value(str(arg))
                if isinstance(arg, str)
                else arg
                for arg in record.args
            )

        return super().format(record)


class JsonlHandler(logging.Handler):
    """Handler that writes structured JSONL log entries with redaction."""

    def __init__(self, log_file: Path) -> None:
        super().__init__()
        self.log_file = log_file
        self.redaction_config = RedactionConfig()

        # Set a basic formatter for timestamp formatting
        self.setFormatter(logging.Formatter())

        # Ensure parent directory exists
        self.log_file.parent.mkdir(parents=True, exist_ok=True)

    def emit(self, record: logging.LogRecord) -> None:
        try:
            # P1 Fix: Redact the message before writing to JSONL
            message = record.getMessage()
            redacted_message = self.redaction_config.redact_value(message)

            log_entry: dict[str, Any] = {
                "timestamp": self.formatter.formatTime(record)
                if self.formatter
                else "",
                "level": record.levelname,
                "logger": record.name,
                "message": redacted_message,
            }

            # Add extra fields if present (context dict)
            if hasattr(record, "extra") and isinstance(record.extra, dict):
                log_entry["context"] = self._redact_dict(record.extra)

            with self.log_file.open("a", encoding="utf-8") as f:
                f.write(json.dumps(log_entry) + "\n")

        except Exception:
            self.handleError(record)

    def _redact_dict(self, data: dict[str, Any]) -> dict[str, Any]:
        """Recursively redact sensitive keys/values in a dictionary."""
        result: dict[str, Any] = {}
        for key, value in data.items():
            if self.redaction_config.should_redact_key(key):
                result[key] = "***REDACTED***"
            elif isinstance(value, str):
                result[key] = self.redaction_config.redact_value(value)
            elif isinstance(value, dict):
                result[key] = self._redact_dict(value)  # Recursive call
            else:
                result[key] = value
        return result


@dataclass
class LoggingConfig:
    """Configuration for logging setup."""

    format: str = "console"  # "console" or "jsonl"
    artifacts_dir: Path = field(default_factory=lambda: Path("run_artifacts"))
    log_file: Path | None = None


def setup_logging(config: LoggingConfig) -> None:
    """Configure logging based on format selection.

    Args:
        config: Logging configuration.
    """
    # Get root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # Remove existing handlers
    root_logger.handlers.clear()

    if config.format == "console":
        # Console handler with redaction
        handler = logging.StreamHandler()
        formatter = RedactingFormatter(
            "%(asctime)s - %(levelname)s - %(message)s",
        )
        handler.setFormatter(formatter)
        root_logger.addHandler(handler)

    elif config.format == "jsonl":
        # JSONL file handler with redaction
        if config.log_file is None:
            config.log_file = config.artifacts_dir / f"run_{os.getpid()}.log.jsonl"

        jsonl_handler: logging.Handler = JsonlHandler(config.log_file)
        root_logger.addHandler(jsonl_handler)

    else:
        raise ValueError(f"Invalid log format: {config.format}")
