"""Data access layer for ado-git-repo-insights.

This module implements UPSERT operations and state tracking per Invariant 8
(idempotent and convergent state updates).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .database import DatabaseManager

logger = logging.getLogger(__name__)


@dataclass
class ExtractionMetadata:
    """Metadata about the last extraction for a project."""

    organization_name: str
    project_name: str
    last_extraction_date: date
    last_extraction_timestamp: datetime


class PRRepository:
    """Data access layer for Pull Request data.

    Invariant 8: State updates must be idempotent and converge.
    Invariant 14: Stable identifiers are required for UPSERT keys.
    Invariant 15: All entities must be scoped to organization + project.
    """

    def __init__(self, db: DatabaseManager) -> None:
        """Initialize the repository.

        Args:
            db: Database manager instance.
        """
        self.db = db

    # --- Extraction Metadata ---

    def get_last_extraction_date(self, organization: str, project: str) -> date | None:
        """Get the last successful extraction date for a project.

        Args:
            organization: Organization name.
            project: Project name.

        Returns:
            Last extraction date, or None if never extracted or metadata is corrupt.
        """
        cursor = self.db.execute(
            """
            SELECT last_extraction_date FROM extraction_metadata
            WHERE organization_name = ? AND project_name = ?
            """,
            (organization, project),
        )
        row = cursor.fetchone()
        if row:
            date_value = row["last_extraction_date"]
            # Handle NULL or empty string
            if not date_value:
                return None
            # Handle corrupt date format gracefully (warn + fallback)
            try:
                return date.fromisoformat(date_value)
            except (ValueError, TypeError) as e:
                logger.warning(
                    f"Invalid/corrupt extraction metadata date for "
                    f"{organization}/{project}: '{date_value}' - {e}"
                )
                return None
        return None

    def update_extraction_metadata(
        self, organization: str, project: str, extraction_date: date
    ) -> None:
        """Record successful extraction for the given date.

        Args:
            organization: Organization name.
            project: Project name.
            extraction_date: Date that was extracted.
        """
        self.db.execute(
            """
            INSERT OR REPLACE INTO extraction_metadata
            (organization_name, project_name, last_extraction_date, last_extraction_timestamp)
            VALUES (?, ?, ?, ?)
            """,
            (
                organization,
                project,
                extraction_date.isoformat(),
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        logger.debug(
            f"Updated extraction metadata: {organization}/{project} = {extraction_date}"
        )

    # --- Organizations ---

    def upsert_organization(self, organization_name: str) -> None:
        """Insert or update an organization.

        Args:
            organization_name: Organization name.
        """
        self.db.execute(
            "INSERT OR IGNORE INTO organizations (organization_name) VALUES (?)",
            (organization_name,),
        )

    # --- Projects ---

    def upsert_project(self, organization_name: str, project_name: str) -> None:
        """Insert or update a project.

        Args:
            organization_name: Organization name.
            project_name: Project name.
        """
        # Ensure organization exists first
        self.upsert_organization(organization_name)

        self.db.execute(
            """
            INSERT OR IGNORE INTO projects (organization_name, project_name)
            VALUES (?, ?)
            """,
            (organization_name, project_name),
        )

    # --- Repositories ---

    def upsert_repository(
        self,
        repository_id: str,
        repository_name: str,
        project_name: str,
        organization_name: str,
    ) -> None:
        """Insert or update a repository.

        Invariant 14: repository_id is the stable ADO ID.
        Invariant 16: repository_name is a mutable label.

        Args:
            repository_id: Stable ADO repository ID.
            repository_name: Current repository name.
            project_name: Project name.
            organization_name: Organization name.
        """
        # Ensure project exists first
        self.upsert_project(organization_name, project_name)

        self.db.execute(
            """
            INSERT OR REPLACE INTO repositories
            (repository_id, repository_name, project_name, organization_name)
            VALUES (?, ?, ?, ?)
            """,
            (repository_id, repository_name, project_name, organization_name),
        )

    # --- Users ---

    def upsert_user(
        self, user_id: str, display_name: str, email: str | None = None
    ) -> None:
        """Insert or update a user.

        Invariant 16: user_id is stable, display_name/email are mutable.

        Args:
            user_id: Stable ADO user ID.
            display_name: Current display name.
            email: Current email (optional).
        """
        self.db.execute(
            """
            INSERT OR REPLACE INTO users (user_id, display_name, email)
            VALUES (?, ?, ?)
            """,
            (user_id, display_name, email),
        )

    # --- Pull Requests ---

    def upsert_pull_request(
        self,
        pull_request_uid: str,
        pull_request_id: int,
        organization_name: str,
        project_name: str,
        repository_id: str,
        user_id: str,
        title: str,
        status: str,
        description: str | None,
        creation_date: str,
        closed_date: str | None,
        cycle_time_minutes: float | None,
        raw_json: dict[str, Any] | None = None,
    ) -> None:
        """Insert or update a pull request.

        Invariant 8: UPSERT semantics ensure idempotent updates.
        Invariant 14: pull_request_uid = {repository_id}-{pull_request_id}.

        Args:
            pull_request_uid: Unique identifier (repo_id-pr_id).
            pull_request_id: ADO PR ID.
            organization_name: Organization name.
            project_name: Project name.
            repository_id: Repository ID.
            user_id: Author user ID.
            title: PR title.
            status: PR status.
            description: PR description.
            creation_date: ISO 8601 creation date.
            closed_date: ISO 8601 closed date.
            cycle_time_minutes: Calculated cycle time.
            raw_json: Original ADO API response for auditing.
        """
        self.db.execute(
            """
            INSERT OR REPLACE INTO pull_requests (
                pull_request_uid, pull_request_id, organization_name, project_name,
                repository_id, user_id, title, status, description,
                creation_date, closed_date, cycle_time_minutes, raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                pull_request_uid,
                pull_request_id,
                organization_name,
                project_name,
                repository_id,
                user_id,
                title,
                status,
                description,
                creation_date,
                closed_date,
                cycle_time_minutes,
                json.dumps(raw_json) if raw_json else None,
            ),
        )

    # --- Reviewers ---

    def upsert_reviewer(
        self,
        pull_request_uid: str,
        user_id: str,
        vote: int,
        repository_id: str,
    ) -> None:
        """Insert or update a reviewer.

        Args:
            pull_request_uid: PR unique identifier.
            user_id: Reviewer user ID.
            vote: Vote value.
            repository_id: Repository ID.
        """
        self.db.execute(
            """
            INSERT OR REPLACE INTO reviewers
            (pull_request_uid, user_id, vote, repository_id)
            VALUES (?, ?, ?, ?)
            """,
            (pull_request_uid, user_id, vote, repository_id),
        )

    # --- Bulk Operations ---

    def upsert_pr_with_related(
        self,
        pr_data: dict[str, Any],
        organization_name: str,
        project_name: str,
    ) -> None:
        """Insert or update a PR and all related entities.

        This is the main entry point for processing a PR from the ADO API.
        Handles repository, user, reviewers, and the PR itself.

        Args:
            pr_data: Raw PR data from ADO API.
            organization_name: Organization name.
            project_name: Project name.
        """
        from ..utils.datetime_utils import calculate_cycle_time_minutes

        # Extract repository
        repo = pr_data.get("repository", {})
        repository_id = repo.get("id", "")
        repository_name = repo.get("name", "")

        self.upsert_repository(
            repository_id=repository_id,
            repository_name=repository_name,
            project_name=project_name,
            organization_name=organization_name,
        )

        # Extract author
        created_by = pr_data.get("createdBy", {})
        user_id = created_by.get("id", "")
        display_name = created_by.get("displayName", "")
        email = created_by.get("uniqueName")

        self.upsert_user(
            user_id=user_id,
            display_name=display_name,
            email=email,
        )

        # Build PR UID (Invariant 14)
        pr_id = pr_data.get("pullRequestId", 0)
        pull_request_uid = f"{repository_id}-{pr_id}"

        # Calculate cycle time
        creation_date = pr_data.get("creationDate", "")
        closed_date = pr_data.get("closedDate")
        cycle_time = calculate_cycle_time_minutes(creation_date, closed_date)

        # Upsert PR
        self.upsert_pull_request(
            pull_request_uid=pull_request_uid,
            pull_request_id=pr_id,
            organization_name=organization_name,
            project_name=project_name,
            repository_id=repository_id,
            user_id=user_id,
            title=pr_data.get("title", ""),
            status=pr_data.get("status", ""),
            description=pr_data.get("description"),
            creation_date=creation_date,
            closed_date=closed_date,
            cycle_time_minutes=cycle_time,
            raw_json=pr_data,
        )

        # Upsert reviewers
        for reviewer in pr_data.get("reviewers", []):
            reviewer_id = reviewer.get("id", "")
            reviewer_name = reviewer.get("displayName", "")
            reviewer_email = reviewer.get("uniqueName")
            vote = reviewer.get("vote", 0)

            self.upsert_user(
                user_id=reviewer_id,
                display_name=reviewer_name,
                email=reviewer_email,
            )

            self.upsert_reviewer(
                pull_request_uid=pull_request_uid,
                user_id=reviewer_id,
                vote=vote,
                repository_id=repository_id,
            )

        logger.debug(f"Upserted PR: {pull_request_uid}")
