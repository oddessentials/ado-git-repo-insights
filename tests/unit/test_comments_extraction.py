"""Unit tests for comments/threads extraction (Phase 3.4).

Covers §6 from IMPLEMENTATION_DETAILS.md:
- Incremental comment sync (no refetch when unchanged)
- 429 handling/backoff boundedness
- Coverage flags when caps trigger
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
import requests

from ado_git_repo_insights.config import APIConfig
from ado_git_repo_insights.extractor.ado_client import ADOClient, ExtractionError
from ado_git_repo_insights.persistence.database import DatabaseManager
from ado_git_repo_insights.persistence.repository import PRRepository


class TestThreadExtraction:
    """Tests for PR thread extraction API methods."""

    @pytest.fixture
    def api_config(self) -> APIConfig:
        """Create test API config."""
        return APIConfig(
            base_url="https://dev.azure.com",
            version="7.1-preview.1",
            rate_limit_sleep_seconds=0,
            max_retries=1,
            retry_delay_seconds=0,
            retry_backoff_multiplier=1.0,
        )

    @pytest.fixture
    def client(self, api_config: APIConfig) -> ADOClient:
        """Create test ADO client."""
        return ADOClient(
            organization="test-org",
            pat="test-pat",
            config=api_config,
        )

    def test_get_pr_threads_returns_list(self, client: ADOClient) -> None:
        """Test that get_pr_threads returns a list of threads."""
        mock_response = MagicMock()
        mock_response.ok = True
        mock_response.status_code = 200
        mock_response.headers = {}
        mock_response.json.return_value = {
            "count": 2,
            "value": [
                {
                    "id": 1,
                    "status": "active",
                    "lastUpdatedDate": "2026-01-14T10:00:00Z",
                    "comments": [{"id": 1, "content": "Test"}],
                },
                {
                    "id": 2,
                    "status": "fixed",
                    "lastUpdatedDate": "2026-01-14T11:00:00Z",
                    "comments": [],
                },
            ],
        }

        with patch("requests.get", return_value=mock_response):
            threads = client.get_pr_threads("TestProject", "repo1", 123)

        assert len(threads) == 2
        assert threads[0]["id"] == 1
        assert threads[1]["status"] == "fixed"

    def test_get_pr_threads_handles_429_rate_limit(self, client: ADOClient) -> None:
        """Test that 429 response triggers bounded backoff (§6)."""
        # First response is 429
        rate_limit_response = MagicMock()
        rate_limit_response.ok = False
        rate_limit_response.status_code = 429
        rate_limit_response.headers = {"Retry-After": "1"}

        # Second response is success
        success_response = MagicMock()
        success_response.ok = True
        success_response.status_code = 200
        success_response.headers = {}
        success_response.json.return_value = {"value": [{"id": 1}]}

        with patch("requests.get", side_effect=[rate_limit_response, success_response]):
            with patch("time.sleep") as mock_sleep:
                threads = client.get_pr_threads("TestProject", "repo1", 123)

        # Should have waited after 429
        mock_sleep.assert_called()
        assert len(threads) == 1

    def test_get_pr_threads_raises_on_error(self, client: ADOClient) -> None:
        """Test that get_pr_threads raises ExtractionError on failure."""
        mock_response = MagicMock()
        mock_response.ok = False
        mock_response.status_code = 500
        mock_response.raise_for_status.side_effect = requests.HTTPError("Server Error")

        with patch("requests.get", return_value=mock_response):
            with pytest.raises(ExtractionError, match="Failed to fetch threads"):
                client.get_pr_threads("TestProject", "repo1", 123)


class TestThreadPersistence:
    """Tests for thread/comment persistence operations."""

    @pytest.fixture
    def db(self, tmp_path) -> DatabaseManager:
        """Create test database."""
        db_path = tmp_path / "test.sqlite"
        db = DatabaseManager(db_path)
        db.connect()
        yield db
        db.close()

    @pytest.fixture
    def repo(self, db: DatabaseManager) -> PRRepository:
        """Create test repository."""
        return PRRepository(db)

    def setup_pr(self, db: DatabaseManager) -> str:
        """Set up required parent entities and return PR UID."""
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
        db.execute(
            """
            INSERT INTO pull_requests (
                pull_request_uid, pull_request_id, organization_name, project_name,
                repository_id, user_id, title, status, creation_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "repo1-1",
                1,
                "org1",
                "proj1",
                "repo1",
                "user1",
                "Test PR",
                "completed",
                "2026-01-01T10:00:00Z",
            ),
        )
        db.connection.commit()
        return "repo1-1"

    def test_upsert_thread(self, repo: PRRepository, db: DatabaseManager) -> None:
        """Test thread upsert creates and updates threads."""
        pr_uid = self.setup_pr(db)

        now = datetime.now(timezone.utc).isoformat()
        repo.upsert_thread(
            thread_id="thread1",
            pull_request_uid=pr_uid,
            status="active",
            thread_context=json.dumps({"filePath": "/src/main.py"}),
            last_updated=now,
            created_at=now,
        )
        db.connection.commit()

        # Verify insertion
        cursor = db.execute(
            "SELECT * FROM pr_threads WHERE thread_id = ?", ("thread1",)
        )
        row = cursor.fetchone()
        assert row is not None
        assert row["status"] == "active"

        # Update thread
        repo.upsert_thread(
            thread_id="thread1",
            pull_request_uid=pr_uid,
            status="fixed",
            thread_context=None,
            last_updated=now,
            created_at=now,
        )
        db.connection.commit()

        cursor = db.execute(
            "SELECT * FROM pr_threads WHERE thread_id = ?", ("thread1",)
        )
        row = cursor.fetchone()
        assert row["status"] == "fixed"

    def test_upsert_comment(self, repo: PRRepository, db: DatabaseManager) -> None:
        """Test comment upsert."""
        pr_uid = self.setup_pr(db)

        now = datetime.now(timezone.utc).isoformat()
        repo.upsert_thread(
            thread_id="thread1",
            pull_request_uid=pr_uid,
            status="active",
            thread_context=None,
            last_updated=now,
            created_at=now,
        )

        repo.upsert_comment(
            comment_id="comment1",
            thread_id="thread1",
            pull_request_uid=pr_uid,
            author_id="user1",
            content="This is a test comment",
            comment_type="text",
            created_at=now,
        )
        db.connection.commit()

        cursor = db.execute(
            "SELECT * FROM pr_comments WHERE comment_id = ?", ("comment1",)
        )
        row = cursor.fetchone()
        assert row is not None
        assert "test comment" in row["content"]

    def test_get_thread_last_updated_for_incremental_sync(
        self, repo: PRRepository, db: DatabaseManager
    ) -> None:
        """Test incremental sync uses last_updated (§6)."""
        pr_uid = self.setup_pr(db)

        # No threads yet
        last_updated = repo.get_thread_last_updated(pr_uid)
        assert last_updated is None

        # Add threads with different timestamps
        repo.upsert_thread(
            thread_id="thread1",
            pull_request_uid=pr_uid,
            status="active",
            thread_context=None,
            last_updated="2026-01-14T10:00:00Z",
            created_at="2026-01-14T09:00:00Z",
        )
        repo.upsert_thread(
            thread_id="thread2",
            pull_request_uid=pr_uid,
            status="active",
            thread_context=None,
            last_updated="2026-01-14T12:00:00Z",
            created_at="2026-01-14T11:00:00Z",
        )
        db.connection.commit()

        # Should return the most recent
        last_updated = repo.get_thread_last_updated(pr_uid)
        assert last_updated == "2026-01-14T12:00:00Z"


class TestCommentsCoverage:
    """Tests for comments coverage tracking."""

    def test_aggregates_set_comments_disabled_when_no_threads(self, tmp_path) -> None:
        """Test that coverage.comments.status is 'disabled' when no threads."""
        from ado_git_repo_insights.transform.aggregators import AggregateGenerator

        db_path = tmp_path / "test.sqlite"
        db = DatabaseManager(db_path)
        db.connect()

        output_dir = tmp_path / "output"
        generator = AggregateGenerator(db, output_dir)
        manifest = generator.generate_all()

        assert manifest.features["comments"] is False
        assert manifest.coverage["comments"]["status"] == "disabled"
        assert manifest.coverage["comments"]["threads_fetched"] == 0

        db.close()

    def test_aggregates_set_comments_enabled_when_threads_exist(self, tmp_path) -> None:
        """Test that coverage.comments.status is 'full' when threads exist."""
        from ado_git_repo_insights.transform.aggregators import AggregateGenerator

        db_path = tmp_path / "test.sqlite"
        db = DatabaseManager(db_path)
        db.connect()

        # Set up parent entities
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
        db.execute(
            """
            INSERT INTO pull_requests (
                pull_request_uid, pull_request_id, organization_name, project_name,
                repository_id, user_id, title, status, creation_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "repo1-1",
                1,
                "org1",
                "proj1",
                "repo1",
                "user1",
                "Test PR",
                "completed",
                "2026-01-01T10:00:00Z",
            ),
        )

        # Insert a thread
        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            """
            INSERT INTO pr_threads (thread_id, pull_request_uid, status, last_updated, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            ("thread1", "repo1-1", "active", now, now),
        )
        db.connection.commit()

        output_dir = tmp_path / "output"
        generator = AggregateGenerator(db, output_dir)
        manifest = generator.generate_all()

        assert manifest.features["comments"] is True
        assert manifest.coverage["comments"]["status"] == "full"
        assert manifest.coverage["comments"]["threads_fetched"] == 1
        assert manifest.coverage["comments"]["prs_with_threads"] == 1

        db.close()
