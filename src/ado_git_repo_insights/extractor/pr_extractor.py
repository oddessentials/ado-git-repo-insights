"""Pull Request extractor orchestration.

Coordinates extraction across multiple projects with incremental and backfill support.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, timedelta

from ..config import Config
from ..persistence.database import DatabaseManager
from ..persistence.repository import PRRepository
from .ado_client import ADOClient, ExtractionError

logger = logging.getLogger(__name__)


@dataclass
class ProjectExtractionResult:
    """Result of extracting PRs for a single project."""

    project: str
    start_date: date
    end_date: date
    prs_extracted: int
    success: bool
    error: str | None = None


@dataclass
class ExtractionSummary:
    """Summary of an extraction run."""

    projects: list[ProjectExtractionResult] = field(default_factory=list)
    total_prs: int = 0
    success: bool = True

    def add_result(self, result: ProjectExtractionResult) -> None:
        """Add a project result to the summary."""
        self.projects.append(result)
        self.total_prs += result.prs_extracted
        if not result.success:
            self.success = False

    def log_summary(self) -> None:
        """Log the extraction summary."""
        logger.info("=" * 50)
        logger.info("Extraction Summary")
        logger.info("=" * 50)
        for result in self.projects:
            status = "✓" if result.success else "✗"
            logger.info(
                f"  {status} {result.project}: "
                f"{result.prs_extracted} PRs ({result.start_date} → {result.end_date})"
            )
            if result.error:
                logger.error(f"    Error: {result.error}")
        logger.info(f"Total: {self.total_prs} PRs")
        logger.info(f"Status: {'SUCCESS' if self.success else 'FAILED'}")
        logger.info("=" * 50)


class PRExtractor:
    """Orchestrates PR extraction across multiple projects.

    Invariant 10: Daily incremental extraction is the default mode.
    Invariant 11: Periodic backfill is required to prevent drift.
    """

    def __init__(
        self,
        client: ADOClient,
        db: DatabaseManager,
        config: Config,
    ) -> None:
        """Initialize the PR extractor.

        Args:
            client: ADO API client.
            db: Database manager.
            config: Extraction configuration.
        """
        self.client = client
        self.db = db
        self.repository = PRRepository(db)
        self.config = config

    def extract_all(self, backfill_days: int | None = None) -> ExtractionSummary:
        """Extract PRs for all configured projects.

        For each project:
        1. Determine date range (incremental from last extraction, or configured)
        2. Fetch PRs from ADO API
        3. UPSERT into SQLite
        4. Update extraction metadata

        Args:
            backfill_days: If provided, re-extract the last N days (Adjustment 1).

        Returns:
            Summary of extraction results.
        """
        summary = ExtractionSummary()

        for project in self.config.projects:
            result = self._extract_project(project, backfill_days)
            summary.add_result(result)

            # Adjustment 4: Fail fast on any project failure
            if not result.success:
                logger.error(f"Extraction failed for {project}, aborting run")
                break

        summary.log_summary()
        return summary

    def _extract_project(
        self,
        project: str,
        backfill_days: int | None,
    ) -> ProjectExtractionResult:
        """Extract PRs for a single project.

        Args:
            project: Project name.
            backfill_days: Optional backfill window.

        Returns:
            Extraction result for this project.
        """
        try:
            start_date = self._determine_start_date(project, backfill_days)
            end_date = self._determine_end_date()

            if start_date > end_date:
                logger.info(f"{project}: Already up to date (last: {start_date})")
                return ProjectExtractionResult(
                    project=project,
                    start_date=start_date,
                    end_date=end_date,
                    prs_extracted=0,
                    success=True,
                )

            logger.info(
                f"Extracting {self.config.organization}/{project}: "
                f"{start_date} → {end_date}"
            )

            count = 0
            for pr_data in self.client.get_pull_requests(project, start_date, end_date):
                self.repository.upsert_pr_with_related(
                    pr_data=pr_data,
                    organization_name=self.config.organization,
                    project_name=project,
                )
                count += 1

            # Update extraction metadata only on success
            self.repository.update_extraction_metadata(
                self.config.organization,
                project,
                end_date,
            )

            logger.info(f"{project}: Extracted {count} PRs")
            return ProjectExtractionResult(
                project=project,
                start_date=start_date,
                end_date=end_date,
                prs_extracted=count,
                success=True,
            )

        except ExtractionError as e:
            logger.error(f"{project}: Extraction failed: {e}")
            return ProjectExtractionResult(
                project=project,
                start_date=start_date if "start_date" in dir() else date.today(),
                end_date=end_date if "end_date" in dir() else date.today(),
                prs_extracted=0,
                success=False,
                error=str(e),
            )

    def _determine_start_date(
        self,
        project: str,
        backfill_days: int | None,
    ) -> date:
        """Determine the start date for extraction.

        Invariant 10: Incremental by default.
        Invariant 11: Backfill for convergence.

        Args:
            project: Project name.
            backfill_days: Optional backfill window.

        Returns:
            Start date for extraction.
        """
        # Priority 1: Explicit date range from config
        if self.config.date_range.start:
            return self.config.date_range.start

        # Priority 2: Backfill mode
        if backfill_days:
            backfill_start = date.today() - timedelta(days=backfill_days)
            logger.info(f"{project}: Backfill mode - {backfill_days} days")
            return backfill_start

        # Priority 3: Incremental from last extraction
        last_date = self.repository.get_last_extraction_date(
            self.config.organization,
            project,
        )
        if last_date:
            # Start from day after last extraction
            return last_date + timedelta(days=1)

        # Default: Start of current year (first run)
        default_start = date(date.today().year, 1, 1)
        logger.info(f"{project}: First run - starting from {default_start}")
        return default_start

    def _determine_end_date(self) -> date:
        """Determine the end date for extraction.

        Returns:
            End date (yesterday by default, or configured).
        """
        if self.config.date_range.end:
            return self.config.date_range.end

        # Default: yesterday (avoids incomplete day data)
        return date.today() - timedelta(days=1)
