"""Integration tests for incremental extraction.

Victory Gate 1.4: Incremental Run
- No duplicate logical rows
- Extraction metadata advances correctly
- UPSERT behavior converges
"""

from __future__ import annotations

import tempfile
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from ado_git_repo_insights.config import (
    APIConfig,
    BackfillConfig,
    Config,
    DateRangeConfig,
)
from ado_git_repo_insights.extractor.ado_client import ADOClient
from ado_git_repo_insights.extractor.pr_extractor import PRExtractor
from ado_git_repo_insights.persistence.database import DatabaseManager
from ado_git_repo_insights.persistence.repository import PRRepository


def make_mock_pr(
    pr_id: int,
    repo_id: str = "repo-1",
    title: str = "Test PR",
    status: str = "completed",
) -> dict:
    """Create a mock PR response from ADO API."""
    return {
        "pullRequestId": pr_id,
        "title": title,
        "status": status,
        "description": f"Description for PR {pr_id}",
        "creationDate": "2024-01-15T10:00:00Z",
        "closedDate": "2024-01-15T12:00:00Z",
        "repository": {"id": repo_id, "name": "TestRepo"},
        "createdBy": {
            "id": f"user-{pr_id}",
            "displayName": f"User {pr_id}",
            "uniqueName": f"user{pr_id}@example.com",
        },
        "reviewers": [],
    }


@pytest.fixture
def incremental_setup() -> tuple[DatabaseManager, Config, Path]:
    """Set up database and config for incremental testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        db_path = tmp_path / "test.sqlite"

        db = DatabaseManager(db_path)
        db.connect()

        config = Config(
            organization="TestOrg",
            projects=["TestProject"],
            pat="test-pat",
            database=db_path,
            api=APIConfig(
                max_retries=1,
                retry_delay_seconds=0,
                rate_limit_sleep_seconds=0,
            ),
            backfill=BackfillConfig(enabled=False),
            date_range=DateRangeConfig(),
        )

        yield db, config, tmp_path

        db.close()


class TestIncrementalExtraction:
    """Integration tests for incremental extraction (Victory Gate 1.4)."""

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_first_run_populates_database(
        self,
        mock_get: MagicMock,
        incremental_setup: tuple[DatabaseManager, Config, Path],
    ) -> None:
        """First run with no prior data creates database entries."""
        db, config, _ = incremental_setup

        # Mock API to return 2 PRs
        mock_response = MagicMock()
        mock_response.json.return_value = {"value": [make_mock_pr(1), make_mock_pr(2)]}
        mock_response.headers = {}
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        client = ADOClient("TestOrg", "test-pat", config.api)
        extractor = PRExtractor(client, db, config)

        # Force a specific date range for testing
        config.date_range.start = date(2024, 1, 15)
        config.date_range.end = date(2024, 1, 15)

        summary = extractor.extract_all()

        assert summary.success
        assert summary.total_prs == 2

        # Verify database has entries
        cursor = db.execute("SELECT COUNT(*) as count FROM pull_requests")
        row = cursor.fetchone()
        assert row["count"] == 2

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_second_run_no_duplicates(
        self,
        mock_get: MagicMock,
        incremental_setup: tuple[DatabaseManager, Config, Path],
    ) -> None:
        """Second run with same data doesn't create duplicates."""
        db, config, _ = incremental_setup

        mock_response = MagicMock()
        mock_response.json.return_value = {"value": [make_mock_pr(1)]}
        mock_response.headers = {}
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        config.date_range.start = date(2024, 1, 15)
        config.date_range.end = date(2024, 1, 15)

        client = ADOClient("TestOrg", "test-pat", config.api)
        extractor = PRExtractor(client, db, config)

        # Run twice
        extractor.extract_all()
        extractor.extract_all()

        # Should still have only 1 PR (UPSERT semantics)
        cursor = db.execute("SELECT COUNT(*) as count FROM pull_requests")
        row = cursor.fetchone()
        assert row["count"] == 1

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_extraction_metadata_advances(
        self,
        mock_get: MagicMock,
        incremental_setup: tuple[DatabaseManager, Config, Path],
    ) -> None:
        """Extraction metadata is updated after successful run."""
        db, config, _ = incremental_setup
        repo = PRRepository(db)

        mock_response = MagicMock()
        mock_response.json.return_value = {"value": [make_mock_pr(1)]}
        mock_response.headers = {}
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        config.date_range.start = date(2024, 1, 15)
        config.date_range.end = date(2024, 1, 15)

        client = ADOClient("TestOrg", "test-pat", config.api)
        extractor = PRExtractor(client, db, config)

        # Verify no metadata before
        last_date = repo.get_last_extraction_date("TestOrg", "TestProject")
        assert last_date is None

        # Run extraction
        extractor.extract_all()

        # Verify metadata updated
        last_date = repo.get_last_extraction_date("TestOrg", "TestProject")
        assert last_date == date(2024, 1, 15)

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_upsert_updates_changed_fields(
        self,
        mock_get: MagicMock,
        incremental_setup: tuple[DatabaseManager, Config, Path],
    ) -> None:
        """UPSERT updates mutable fields when PR data changes."""
        db, config, _ = incremental_setup

        # First run: PR with original title
        mock_response1 = MagicMock()
        mock_response1.json.return_value = {
            "value": [make_mock_pr(1, title="Original Title")]
        }
        mock_response1.headers = {}
        mock_response1.raise_for_status = MagicMock()

        # Second run: PR with updated title
        mock_response2 = MagicMock()
        mock_response2.json.return_value = {
            "value": [make_mock_pr(1, title="Updated Title")]
        }
        mock_response2.headers = {}
        mock_response2.raise_for_status = MagicMock()

        mock_get.side_effect = [mock_response1, mock_response2]

        config.date_range.start = date(2024, 1, 15)
        config.date_range.end = date(2024, 1, 15)

        client = ADOClient("TestOrg", "test-pat", config.api)
        extractor = PRExtractor(client, db, config)

        # Run twice
        extractor.extract_all()
        extractor.extract_all()

        # Verify title updated
        cursor = db.execute("SELECT title FROM pull_requests WHERE pull_request_id = 1")
        row = cursor.fetchone()
        assert row["title"] == "Updated Title"

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_incremental_uses_last_extraction_date(
        self,
        mock_get: MagicMock,
        incremental_setup: tuple[DatabaseManager, Config, Path],
    ) -> None:
        """Incremental run starts from last extraction date + 1 day."""
        db, config, _ = incremental_setup
        repo = PRRepository(db)

        # Pre-set extraction metadata
        repo.update_extraction_metadata("TestOrg", "TestProject", date(2024, 1, 14))

        mock_response = MagicMock()
        mock_response.json.return_value = {"value": []}
        mock_response.headers = {}
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        # Don't set date_range - should use incremental mode
        config.date_range = DateRangeConfig()

        client = ADOClient("TestOrg", "test-pat", config.api)
        extractor = PRExtractor(client, db, config)

        # Determine start date
        start = extractor._determine_start_date("TestProject", None)

        # Should be Jan 15 (day after last extraction)
        assert start == date(2024, 1, 15)
