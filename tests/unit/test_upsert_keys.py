"""Unit tests for UPSERT keys and stable identity.

DoD 4.1: Stable Keys Enforced
- PR identity uses stable key (repository_id-pull_request_id)
- Users/repositories are keyed by stable IDs
- Tests ensure repeated ingest does not create duplicate logical rows
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from ado_git_repo_insights.persistence.database import DatabaseManager
from ado_git_repo_insights.persistence.repository import PRRepository


@pytest.fixture
def db_manager() -> DatabaseManager:
    """Create a temporary database for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.sqlite"
        manager = DatabaseManager(db_path)
        manager.connect()
        yield manager
        manager.close()


@pytest.fixture
def repository(db_manager: DatabaseManager) -> PRRepository:
    """Create a repository instance for testing."""
    return PRRepository(db_manager)


class TestStableKeys:
    """Test that stable keys prevent duplicate rows (Invariant 14)."""

    def test_organization_upsert_idempotent(
        self, repository: PRRepository, db_manager: DatabaseManager
    ) -> None:
        """Upserting the same organization twice should not create duplicates."""
        repository.upsert_organization("MyOrg")
        repository.upsert_organization("MyOrg")

        cursor = db_manager.execute("SELECT COUNT(*) as count FROM organizations")
        row = cursor.fetchone()
        assert row["count"] == 1

    def test_project_upsert_idempotent(
        self, repository: PRRepository, db_manager: DatabaseManager
    ) -> None:
        """Upserting the same project twice should not create duplicates."""
        repository.upsert_project("MyOrg", "MyProject")
        repository.upsert_project("MyOrg", "MyProject")

        cursor = db_manager.execute("SELECT COUNT(*) as count FROM projects")
        row = cursor.fetchone()
        assert row["count"] == 1

    def test_user_upsert_updates_mutable_fields(
        self, repository: PRRepository, db_manager: DatabaseManager
    ) -> None:
        """Upserting a user should update display_name and email (Invariant 16)."""
        # First insert
        repository.upsert_user("user-123", "John Doe", "john@example.com")

        # Update with changed name/email
        repository.upsert_user("user-123", "John Smith", "john.smith@example.com")

        cursor = db_manager.execute(
            "SELECT user_id, display_name, email FROM users WHERE user_id = ?",
            ("user-123",),
        )
        row = cursor.fetchone()

        assert row["user_id"] == "user-123"
        assert row["display_name"] == "John Smith"
        assert row["email"] == "john.smith@example.com"

        # Should still be only one row
        cursor = db_manager.execute("SELECT COUNT(*) as count FROM users")
        row = cursor.fetchone()
        assert row["count"] == 1

    def test_repository_upsert_uses_id_not_name(
        self, repository: PRRepository, db_manager: DatabaseManager
    ) -> None:
        """Repository identity uses ID, name is a mutable label (Invariant 16)."""
        # First insert
        repository.upsert_repository("repo-abc", "OldName", "Project1", "Org1")

        # Rename the repository (same ID, different name)
        repository.upsert_repository("repo-abc", "NewName", "Project1", "Org1")

        cursor = db_manager.execute(
            "SELECT repository_id, repository_name FROM repositories"
        )
        row = cursor.fetchone()

        assert row["repository_id"] == "repo-abc"
        assert row["repository_name"] == "NewName"

        # Should still be only one row
        cursor = db_manager.execute("SELECT COUNT(*) as count FROM repositories")
        row = cursor.fetchone()
        assert row["count"] == 1

    def test_pull_request_uid_format(
        self, repository: PRRepository, db_manager: DatabaseManager
    ) -> None:
        """PR UID must be {repository_id}-{pull_request_id} (Invariant 14)."""
        repository.upsert_project("Org1", "Project1")
        repository.upsert_repository("repo-xyz", "MyRepo", "Project1", "Org1")
        repository.upsert_user("user-1", "Author", None)

        repository.upsert_pull_request(
            pull_request_uid="repo-xyz-42",
            pull_request_id=42,
            organization_name="Org1",
            project_name="Project1",
            repository_id="repo-xyz",
            user_id="user-1",
            title="Test PR",
            status="completed",
            description="Test description",
            creation_date="2024-01-15T10:00:00Z",
            closed_date="2024-01-15T12:00:00Z",
            cycle_time_minutes=120.0,
        )

        cursor = db_manager.execute("SELECT pull_request_uid FROM pull_requests")
        row = cursor.fetchone()
        assert row["pull_request_uid"] == "repo-xyz-42"

    def test_pull_request_upsert_convergence(
        self, repository: PRRepository, db_manager: DatabaseManager
    ) -> None:
        """Re-upserting a PR with changes should update, not duplicate (Invariant 8)."""
        repository.upsert_project("Org1", "Project1")
        repository.upsert_repository("repo-1", "Repo", "Project1", "Org1")
        repository.upsert_user("user-1", "Author", None)

        # Initial insert
        repository.upsert_pull_request(
            pull_request_uid="repo-1-100",
            pull_request_id=100,
            organization_name="Org1",
            project_name="Project1",
            repository_id="repo-1",
            user_id="user-1",
            title="Original Title",
            status="active",
            description=None,
            creation_date="2024-01-15T10:00:00Z",
            closed_date=None,
            cycle_time_minutes=None,
        )

        # Simulate backfill update - title changed, now closed
        repository.upsert_pull_request(
            pull_request_uid="repo-1-100",
            pull_request_id=100,
            organization_name="Org1",
            project_name="Project1",
            repository_id="repo-1",
            user_id="user-1",
            title="Updated Title",
            status="completed",
            description="Added description",
            creation_date="2024-01-15T10:00:00Z",
            closed_date="2024-01-15T15:00:00Z",
            cycle_time_minutes=300.0,
        )

        # Should have exactly one PR
        cursor = db_manager.execute("SELECT COUNT(*) as count FROM pull_requests")
        row = cursor.fetchone()
        assert row["count"] == 1

        # Should have updated values
        cursor = db_manager.execute(
            "SELECT title, status, description, closed_date FROM pull_requests"
        )
        row = cursor.fetchone()
        assert row["title"] == "Updated Title"
        assert row["status"] == "completed"
        assert row["description"] == "Added description"
        assert row["closed_date"] == "2024-01-15T15:00:00Z"

    def test_reviewer_upsert_updates_vote(
        self, repository: PRRepository, db_manager: DatabaseManager
    ) -> None:
        """Re-upserting a reviewer should update their vote (backfill convergence)."""
        repository.upsert_project("Org1", "Project1")
        repository.upsert_repository("repo-1", "Repo", "Project1", "Org1")
        repository.upsert_user("user-1", "Author", None)
        repository.upsert_user("reviewer-1", "Reviewer", None)

        repository.upsert_pull_request(
            pull_request_uid="repo-1-100",
            pull_request_id=100,
            organization_name="Org1",
            project_name="Project1",
            repository_id="repo-1",
            user_id="user-1",
            title="Test",
            status="completed",
            description=None,
            creation_date="2024-01-15T10:00:00Z",
            closed_date="2024-01-15T12:00:00Z",
            cycle_time_minutes=120.0,
        )

        # Initial vote: 0 (no vote yet)
        repository.upsert_reviewer("repo-1-100", "reviewer-1", 0, "repo-1")

        # Update vote to approved (10)
        repository.upsert_reviewer("repo-1-100", "reviewer-1", 10, "repo-1")

        # Should have exactly one reviewer record
        cursor = db_manager.execute("SELECT COUNT(*) as count FROM reviewers")
        row = cursor.fetchone()
        assert row["count"] == 1

        # Should have updated vote
        cursor = db_manager.execute("SELECT vote FROM reviewers")
        row = cursor.fetchone()
        assert row["vote"] == 10
