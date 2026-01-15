"""Unit tests for comments CLI flags (Phase 3.4 §6).

Tests --include-comments, --comments-max-prs-per-run, --comments-max-threads-per-pr
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from ado_git_repo_insights.cli import _extract_comments, create_parser
from ado_git_repo_insights.persistence.database import DatabaseManager


class TestCommentsCliFlags:
    """Tests for comments CLI argument parsing."""

    def test_include_comments_flag_defaults_to_false(self) -> None:
        """Test that --include-comments defaults to False."""
        parser = create_parser()
        args = parser.parse_args(
            ["extract", "--pat", "test-pat", "--config", "test.yaml"]
        )
        assert args.include_comments is False

    def test_include_comments_flag_can_be_enabled(self) -> None:
        """Test that --include-comments can be set to True."""
        parser = create_parser()
        args = parser.parse_args(
            [
                "extract",
                "--pat",
                "test-pat",
                "--config",
                "test.yaml",
                "--include-comments",
            ]
        )
        assert args.include_comments is True

    def test_comments_max_prs_default(self) -> None:
        """Test --comments-max-prs-per-run default value."""
        parser = create_parser()
        args = parser.parse_args(
            ["extract", "--pat", "test-pat", "--config", "test.yaml"]
        )
        assert args.comments_max_prs_per_run == 100

    def test_comments_max_prs_can_be_set(self) -> None:
        """Test --comments-max-prs-per-run can be customized."""
        parser = create_parser()
        args = parser.parse_args(
            [
                "extract",
                "--pat",
                "test-pat",
                "--config",
                "test.yaml",
                "--comments-max-prs-per-run",
                "50",
            ]
        )
        assert args.comments_max_prs_per_run == 50

    def test_comments_max_threads_default(self) -> None:
        """Test --comments-max-threads-per-pr default value."""
        parser = create_parser()
        args = parser.parse_args(
            ["extract", "--pat", "test-pat", "--config", "test.yaml"]
        )
        assert args.comments_max_threads_per_pr == 50

    def test_comments_max_threads_can_be_set(self) -> None:
        """Test --comments-max-threads-per-pr can be customized."""
        parser = create_parser()
        args = parser.parse_args(
            [
                "extract",
                "--pat",
                "test-pat",
                "--config",
                "test.yaml",
                "--comments-max-threads-per-pr",
                "25",
            ]
        )
        assert args.comments_max_threads_per_pr == 25


class TestExtractComments:
    """Tests for _extract_comments helper function."""

    @pytest.fixture
    def db(self, tmp_path) -> DatabaseManager:
        """Create test database with sample data."""
        db_path = tmp_path / "test.sqlite"
        db = DatabaseManager(db_path)
        db.connect()

        # Insert required parent entities
        db.execute(
            "INSERT INTO organizations (organization_name) VALUES (?)", ("org1",)
        )
        db.execute(
            "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
            ("org1", "proj1"),
        )
        db.execute(
            """INSERT INTO repositories
            (repository_id, repository_name, project_name, organization_name)
            VALUES (?, ?, ?, ?)""",
            ("repo1", "Test Repo", "proj1", "org1"),
        )
        db.execute(
            "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
            ("user1", "Test User", "test@example.com"),
        )
        # Insert sample PRs
        for i in range(5):
            db.execute(
                """INSERT INTO pull_requests
                (pull_request_uid, pull_request_id, organization_name, project_name,
                repository_id, user_id, title, status, creation_date, closed_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    f"repo1-{i + 1}",
                    i + 1,
                    "org1",
                    "proj1",
                    "repo1",
                    "user1",
                    f"PR {i + 1}",
                    "completed",
                    "2026-01-01T10:00:00Z",
                    f"2026-01-{10 + i:02d}T10:00:00Z",
                ),
            )
        db.connection.commit()

        yield db
        db.close()

    @pytest.fixture
    def mock_client(self) -> MagicMock:
        """Create mock ADO client."""
        client = MagicMock()
        return client

    @pytest.fixture
    def mock_config(self) -> MagicMock:
        """Create mock config."""
        config = MagicMock()
        config.projects = ["proj1"]
        return config

    def test_respects_max_prs_limit(
        self, db: DatabaseManager, mock_client: MagicMock, mock_config: MagicMock
    ) -> None:
        """Test that max_prs limit is respected and capped flag is set."""
        mock_client.get_pr_threads.return_value = []

        stats = _extract_comments(
            client=mock_client,
            db=db,
            config=mock_config,
            max_prs=3,  # Only process 3 of 5 PRs
            max_threads_per_pr=50,
        )

        assert stats["prs_processed"] == 3
        assert stats["capped"] is True

    def test_respects_max_threads_limit(
        self, db: DatabaseManager, mock_client: MagicMock, mock_config: MagicMock
    ) -> None:
        """Test that max_threads_per_pr limit is applied."""
        # Return 10 threads but limit to 3
        mock_client.get_pr_threads.return_value = [
            {
                "id": i,
                "status": "active",
                "lastUpdatedDate": "2026-01-14T10:00:00Z",
                "comments": [],
            }
            for i in range(10)
        ]

        stats = _extract_comments(
            client=mock_client,
            db=db,
            config=mock_config,
            max_prs=1,
            max_threads_per_pr=3,  # Limit to 3 threads
        )

        # Should only process 3 threads per PR
        assert stats["threads"] == 3

    def test_incremental_sync_skips_unchanged(
        self, db: DatabaseManager, mock_client: MagicMock, mock_config: MagicMock
    ) -> None:
        """Test that unchanged threads are skipped (§6 incremental sync)."""
        # Insert existing thread with a timestamp
        # Note: repo1-5 has closed_date 2026-01-14, so it will be processed first in DESC order
        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            """INSERT INTO pr_threads
            (thread_id, pull_request_uid, status, last_updated, created_at)
            VALUES (?, ?, ?, ?, ?)""",
            ("thread1", "repo1-5", "active", "2026-01-14T12:00:00Z", now),
        )
        db.connection.commit()

        # Return thread with older timestamp (should be skipped)
        mock_client.get_pr_threads.return_value = [
            {
                "id": 1,
                "status": "active",
                "lastUpdatedDate": "2026-01-14T10:00:00Z",
                "comments": [],
            },  # Older - skip
            {
                "id": 2,
                "status": "fixed",
                "lastUpdatedDate": "2026-01-14T14:00:00Z",
                "comments": [],
            },  # Newer - process
        ]

        stats = _extract_comments(
            client=mock_client,
            db=db,
            config=mock_config,
            max_prs=1,  # Only process repo1-5 (first in DESC order)
            max_threads_per_pr=0,
        )

        # Only the newer thread should be processed
        assert stats["threads"] == 1

    def test_extracts_comments_from_threads(
        self, db: DatabaseManager, mock_client: MagicMock, mock_config: MagicMock
    ) -> None:
        """Test that comments are extracted from thread payloads."""
        mock_client.get_pr_threads.return_value = [
            {
                "id": 1,
                "status": "active",
                "lastUpdatedDate": "2026-01-14T10:00:00Z",
                "comments": [
                    {
                        "id": 1,
                        "author": {"id": "user1"},
                        "content": "Comment 1",
                        "publishedDate": "2026-01-14T09:00:00Z",
                    },
                    {
                        "id": 2,
                        "author": {"id": "user2"},
                        "content": "Comment 2",
                        "publishedDate": "2026-01-14T09:30:00Z",
                    },
                ],
            },
        ]

        stats = _extract_comments(
            client=mock_client,
            db=db,
            config=mock_config,
            max_prs=1,
            max_threads_per_pr=0,
        )

        assert stats["threads"] == 1
        assert stats["comments"] == 2

    def test_continues_on_pr_error(
        self, db: DatabaseManager, mock_client: MagicMock, mock_config: MagicMock
    ) -> None:
        """Test that extraction continues if one PR fails."""
        from ado_git_repo_insights.extractor.ado_client import ExtractionError

        # First call fails, second succeeds
        mock_client.get_pr_threads.side_effect = [
            ExtractionError("API error"),
            [
                {
                    "id": 1,
                    "status": "active",
                    "lastUpdatedDate": "2026-01-14T10:00:00Z",
                    "comments": [],
                }
            ],
        ]

        stats = _extract_comments(
            client=mock_client,
            db=db,
            config=mock_config,
            max_prs=2,
            max_threads_per_pr=0,
        )

        # Should have processed 1 PR (the successful one)
        assert stats["prs_processed"] == 1
