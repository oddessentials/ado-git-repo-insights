"""Unit tests for PR status filtering (completed-only semantics).

Covers §1 from IMPLEMENTATION_DETAILS.md:
- Only completed (merged) PRs are extracted
- Abandoned PRs are excluded even when closedDate exists
"""

from __future__ import annotations

from ado_git_repo_insights.persistence.database import DatabaseManager
from ado_git_repo_insights.transform.aggregators import AggregateGenerator


class TestCompletedOnlyFiltering:
    """Tests proving only completed PRs are included in aggregates."""

    def test_abandoned_prs_excluded_from_aggregates(self, tmp_path) -> None:
        """Prove that abandoned PRs with closedDate are excluded from aggregates.

        §1 Required Test: abandoned PRs are excluded even when closedDate exists.
        """
        db_path = tmp_path / "test.sqlite"
        db = DatabaseManager(db_path)
        db.connect()

        # Insert supporting entities
        db.execute(
            "INSERT INTO organizations (organization_name) VALUES (?)", ("org1",)
        )
        db.execute(
            "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
            ("org1", "proj1"),
        )
        db.execute(
            "INSERT INTO repositories (repository_id, repository_name, project_name, organization_name) VALUES (?, ?, ?, ?)",
            ("repo1", "Test Repo", "proj1", "org1"),
        )
        db.execute(
            "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
            ("user1", "Test User", "test@example.com"),
        )

        # Insert PRs with different statuses - ALL have closed_date
        test_prs = [
            # Completed PR (should be included)
            (
                "repo1-1",
                1,
                "org1",
                "proj1",
                "repo1",
                "user1",
                "Merged PR",
                "completed",
                None,
                "2026-01-01T10:00:00Z",
                "2026-01-02T10:00:00Z",
                1440.0,
            ),
            # Abandoned PR with closedDate (should be EXCLUDED)
            (
                "repo1-2",
                2,
                "org1",
                "proj1",
                "repo1",
                "user1",
                "Abandoned PR",
                "abandoned",
                None,
                "2026-01-01T11:00:00Z",
                "2026-01-02T11:00:00Z",
                1440.0,
            ),
            # Another completed PR (should be included)
            (
                "repo1-3",
                3,
                "org1",
                "proj1",
                "repo1",
                "user1",
                "Another Merged",
                "completed",
                None,
                "2026-01-02T10:00:00Z",
                "2026-01-03T10:00:00Z",
                1440.0,
            ),
            # Active PR with closedDate set (edge case - should be EXCLUDED)
            (
                "repo1-4",
                4,
                "org1",
                "proj1",
                "repo1",
                "user1",
                "Active PR",
                "active",
                None,
                "2026-01-03T10:00:00Z",
                "2026-01-04T10:00:00Z",
                1440.0,
            ),
        ]

        for pr in test_prs:
            db.execute(
                """
                INSERT INTO pull_requests (
                    pull_request_uid, pull_request_id, organization_name, project_name,
                    repository_id, user_id, title, status, description,
                    creation_date, closed_date, cycle_time_minutes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                pr,
            )

        db.connection.commit()

        # Generate aggregates
        output_dir = tmp_path / "aggregates"
        generator = AggregateGenerator(db, output_dir)
        manifest = generator.generate_all()

        # Verify only completed PRs are counted
        assert manifest.coverage["total_prs"] == 2, (
            f"Expected 2 completed PRs, got {manifest.coverage['total_prs']}"
        )

        db.close()

    def test_completed_status_is_case_sensitive(self, tmp_path) -> None:
        """Verify that status matching is exact (lowercase 'completed')."""
        db_path = tmp_path / "test.sqlite"
        db = DatabaseManager(db_path)
        db.connect()

        db.execute(
            "INSERT INTO organizations (organization_name) VALUES (?)", ("org1",)
        )
        db.execute(
            "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
            ("org1", "proj1"),
        )
        db.execute(
            "INSERT INTO repositories (repository_id, repository_name, project_name, organization_name) VALUES (?, ?, ?, ?)",
            ("repo1", "Test Repo", "proj1", "org1"),
        )
        db.execute(
            "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
            ("user1", "Test User", "test@example.com"),
        )

        # Insert PRs with various status casings
        test_prs = [
            (
                "repo1-1",
                1,
                "org1",
                "proj1",
                "repo1",
                "user1",
                "PR 1",
                "completed",
                None,
                "2026-01-01T10:00:00Z",
                "2026-01-02T10:00:00Z",
                100.0,
            ),
            (
                "repo1-2",
                2,
                "org1",
                "proj1",
                "repo1",
                "user1",
                "PR 2",
                "Completed",
                None,
                "2026-01-01T10:00:00Z",
                "2026-01-02T10:00:00Z",
                100.0,
            ),
            (
                "repo1-3",
                3,
                "org1",
                "proj1",
                "repo1",
                "user1",
                "PR 3",
                "COMPLETED",
                None,
                "2026-01-01T10:00:00Z",
                "2026-01-02T10:00:00Z",
                100.0,
            ),
        ]

        for pr in test_prs:
            db.execute(
                """
                INSERT INTO pull_requests (
                    pull_request_uid, pull_request_id, organization_name, project_name,
                    repository_id, user_id, title, status, description,
                    creation_date, closed_date, cycle_time_minutes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                pr,
            )

        db.connection.commit()

        output_dir = tmp_path / "aggregates"
        generator = AggregateGenerator(db, output_dir)
        manifest = generator.generate_all()

        # Only lowercase 'completed' should match
        assert manifest.coverage["total_prs"] == 1, (
            "Only lowercase 'completed' should be included"
        )

        db.close()
