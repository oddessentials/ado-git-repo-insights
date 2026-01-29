"""Run summary tracking with enriched error diagnostics.

Captures comprehensive run telemetry including per-project status and first fatal error.
"""
# ruff: noqa: S603, S607

from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any, Literal


def normalize_error_message(error: str, max_length: int = 500) -> str:
    """Normalize and bound error messages to prevent secret leakage.

    Args:
        error: Raw error message.
        max_length: Maximum length for bounded message.

    Returns:
        Normalized error message.
    """
    # Strip URLs with query strings (can contain secrets)
    error = re.sub(r"https?://[^\s]+\?[^\s]+", "[URL_WITH_PARAMS]", error)

    # Strip full URLs (can contain hostnames/paths)
    error = re.sub(r"https?://[^\s]+", "[URL]", error)

    # Truncate to max length
    if len(error) > max_length:
        error = error[:max_length] + "...[truncated]"

    return error


@dataclass
class RunCounts:
    """Counts of extracted/generated items."""

    prs_fetched: int = 0
    prs_updated: int = 0
    rows_per_csv: dict[str, int] = field(default_factory=dict)


@dataclass
class RunTimings:
    """Timing information for run phases."""

    total_seconds: float = 0.0
    extract_seconds: float = 0.0
    persist_seconds: float = 0.0
    export_seconds: float = 0.0


@dataclass
class RunSummary:
    """Comprehensive run summary with forensic diagnostics."""

    tool_version: str
    git_sha: str | None
    organization: str
    projects: list[str]
    date_range_start: str  # ISO format date
    date_range_end: str  # ISO format date
    counts: RunCounts
    timings: RunTimings
    warnings: list[str]
    final_status: Literal["success", "failed"]
    per_project_status: dict[str, str] = field(default_factory=dict)
    first_fatal_error: str | None = None

    def __post_init__(self) -> None:
        """Normalize error message on initialization."""
        if self.first_fatal_error:
            self.first_fatal_error = normalize_error_message(self.first_fatal_error)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "tool_version": self.tool_version,
            "git_sha": self.git_sha,
            "organization": self.organization,
            "projects": self.projects,
            "date_range": {
                "start": self.date_range_start,
                "end": self.date_range_end,
            },
            "counts": {
                "prs_fetched": self.counts.prs_fetched,
                "prs_updated": self.counts.prs_updated,
                "rows_per_csv": self.counts.rows_per_csv,
            },
            "timings": {
                "total_seconds": self.timings.total_seconds,
                "extract_seconds": self.timings.extract_seconds,
                "persist_seconds": self.timings.persist_seconds,
                "export_seconds": self.timings.export_seconds,
            },
            "warnings": self.warnings,
            "final_status": self.final_status,
            "per_project_status": self.per_project_status,
            "first_fatal_error": self.first_fatal_error,
        }

    def write(self, path: Path) -> None:
        """Write summary to JSON file.

        Args:
            path: Path to write summary file.
        """
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)

    def print_final_line(self) -> None:
        """Print one-liner summary to stdout."""
        # Use ASCII symbols for Windows cp1252 compatibility
        status_symbol = "[OK]" if self.final_status == "success" else "[FAIL]"
        print(
            f"{status_symbol} {self.final_status.upper()}: "
            f"{self.counts.prs_fetched} PRs extracted, "
            f"{len(self.counts.rows_per_csv)} CSVs written "
            f"({self.timings.total_seconds:.1f}s)"
        )

    def emit_ado_commands(self) -> None:
        """Emit Azure Pipelines logging commands."""
        # Only emit if running in Azure Pipelines
        if os.environ.get("TF_BUILD") != "true":
            return

        if self.final_status == "failed":
            if self.first_fatal_error:
                print(f"##vso[task.logissue type=error]{self.first_fatal_error}")
            print("##vso[task.complete result=Failed]")
        elif self.warnings:
            for warning in self.warnings:
                print(f"##vso[task.logissue type=warning]{warning}")


def get_tool_version() -> str:
    """Get tool version from VERSION file."""
    version_file = Path(__file__).parent.parent.parent.parent / "VERSION"
    if version_file.exists():
        return version_file.read_text().strip()
    return "unknown"


def get_git_sha() -> str | None:
    """Get Git SHA from VERSION file or git command.

    Returns:
        Git SHA or None if unavailable.
    """
    # Try VERSION file first
    version_file = Path(__file__).parent.parent.parent.parent / "VERSION"
    if version_file.exists():
        version = version_file.read_text().strip()
        if "+" in version:  # Version format like "1.0.7+8d88fb4"
            return version.split("+")[1]

    # Fallback to git command
    try:
        result = subprocess.run(  # noqa: S603, S607 -- SECURITY: hardcoded git command with no user input
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        )
        return result.stdout.strip()
    except Exception:
        return None


def create_minimal_summary(
    error_message: str,
    artifacts_dir: Path = Path("run_artifacts"),
) -> RunSummary:
    """Create a partial summary for early failures.

    Args:
        error_message: Error message describing the failure.
        artifacts_dir: Directory for artifacts.

    Returns:
        Minimal RunSummary with failure status.
    """
    return RunSummary(
        tool_version=get_tool_version(),
        git_sha=get_git_sha(),
        organization="unknown",
        projects=[],
        date_range_start=str(date.today()),
        date_range_end=str(date.today()),
        counts=RunCounts(),
        timings=RunTimings(),
        warnings=[],
        final_status="failed",
        first_fatal_error=normalize_error_message(error_message),
    )
