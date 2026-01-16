"""Integration tests for backfill convergence.

Victory Gate 1.5: Backfill Convergence
- Late PR changes are corrected
- SQLite and CSV outputs reflect updated state
- Invariant 25: Backfill mode must be tested
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
from ado_git_repo_insights.transform.csv_generator import CSVGenerator


def make_mock_pr(
    pr_id: int,
    repo_id: str = "repo-1",
    title: str = "Test PR",
    status: str = "completed",
    reviewers: list[dict] | None = None,
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
            "id": "user-author",
            "displayName": "Author",
            "uniqueName": "author@example.com",
        },
        "reviewers": reviewers or [],
    }


@pytest.fixture
def backfill_setup() -> tuple[DatabaseManager, Config, Path]:
    """Set up database and config for backfill testing."""
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
            backfill=BackfillConfig(enabled=True, window_days=30),
            date_range=DateRangeConfig(),
        )

        yield db, config, tmp_path

        db.close()


class TestBackfillConvergence:
    """Integration tests for backfill convergence (Victory Gate 1.5, Invariant 25)."""

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_late_reviewer_vote_corrected(
        self,
        mock_get: MagicMock,
        backfill_setup: tuple[DatabaseManager, Config, Path],
    ) -> None:
        """Backfill corrects a late reviewer vote change.

        Scenario:
        1. Initial extraction: PR has reviewer with vote=0 (no vote)
        2. Later, reviewer approves (vote=10)
        3. Backfill re-extracts and updates the vote
        """
        db, config, tmp_path = backfill_setup
        _ = tmp_path  # Unused, but kept for consistency

        # Initial extraction: reviewer with no vote
        initial_reviewer = {
            "id": "user-reviewer",
            "displayName": "Reviewer",
            "uniqueName": "reviewer@example.com",
            "vote": 0,
        }

        mock_response1 = MagicMock()
        mock_response1.json.return_value = {
            "value": [make_mock_pr(1, reviewers=[initial_reviewer])]
        }
        mock_response1.headers = {}
        mock_response1.raise_for_status = MagicMock()

        mock_get.return_value = mock_response1

        config.date_range.start = date(2024, 1, 15)
        config.date_range.end = date(2024, 1, 15)

        client = ADOClient("TestOrg", "test-pat", config.api)
        extractor = PRExtractor(client, db, config)

        # Initial extraction
        extractor.extract_all()

        # Verify initial vote is 0
        cursor = db.execute(
            "SELECT vote FROM reviewers WHERE user_id = 'user-reviewer'"
        )
        row = cursor.fetchone()
        assert row["vote"] == 0

        # Backfill: reviewer now has approved (vote=10)
        updated_reviewer = {
            "id": "user-reviewer",
            "displayName": "Reviewer",
            "uniqueName": "reviewer@example.com",
            "vote": 10,
        }

        mock_response2 = MagicMock()
        mock_response2.json.return_value = {
            "value": [make_mock_pr(1, reviewers=[updated_reviewer])]
        }
        mock_response2.headers = {}
        mock_response2.raise_for_status = MagicMock()

        mock_get.return_value = mock_response2

        # Run backfill
        extractor.extract_all(backfill_days=30)

        # Verify vote updated to 10
        cursor = db.execute(
            "SELECT vote FROM reviewers WHERE user_id = 'user-reviewer'"
        )
        row = cursor.fetchone()
        assert row["vote"] == 10

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_pr_reopened_and_reclosed(
        self,
        mock_get: MagicMock,
        backfill_setup: tuple[DatabaseManager, Config, Path],
    ) -> None:
        """Backfill updates PR that was reopened and re-closed with new data.

        Scenario:
        1. Initial: PR closed Jan 15, cycle_time = 120 min
        2. PR reopened, more work done, re-closed Jan 16
        3. Backfill updates closed_date and cycle_time
        """
        db, config, _ = backfill_setup

        # Initial PR
        initial_pr = make_mock_pr(1)
        initial_pr["closedDate"] = "2024-01-15T12:00:00Z"

        mock_response1 = MagicMock()
        mock_response1.json.return_value = {"value": [initial_pr]}
        mock_response1.headers = {}
        mock_response1.raise_for_status = MagicMock()

        mock_get.return_value = mock_response1

        config.date_range.start = date(2024, 1, 15)
        config.date_range.end = date(2024, 1, 15)

        client = ADOClient("TestOrg", "test-pat", config.api)
        extractor = PRExtractor(client, db, config)

        # Initial extraction
        extractor.extract_all()

        # Verify initial closed_date
        cursor = db.execute("SELECT closed_date FROM pull_requests")
        row = cursor.fetchone()
        assert "2024-01-15" in row["closed_date"]

        # Updated PR (re-closed on Jan 16)
        updated_pr = make_mock_pr(1)
        updated_pr["closedDate"] = "2024-01-16T18:00:00Z"

        mock_response2 = MagicMock()
        mock_response2.json.return_value = {"value": [updated_pr]}
        mock_response2.headers = {}
        mock_response2.raise_for_status = MagicMock()

        mock_get.return_value = mock_response2

        # Backfill
        extractor.extract_all(backfill_days=30)

        # Verify closed_date updated
        cursor = db.execute("SELECT closed_date FROM pull_requests")
        row = cursor.fetchone()
        assert "2024-01-16" in row["closed_date"]

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_csv_reflects_backfill_updates(
        self,
        mock_get: MagicMock,
        backfill_setup: tuple[DatabaseManager, Config, Path],
    ) -> None:
        """CSVs generated after backfill reflect updated state."""
        import pandas as pd

        db, config, tmp_path = backfill_setup

        # Initial PR with title "Old Title"
        initial_pr = make_mock_pr(1, title="Old Title")

        mock_response1 = MagicMock()
        mock_response1.json.return_value = {"value": [initial_pr]}
        mock_response1.headers = {}
        mock_response1.raise_for_status = MagicMock()

        mock_get.return_value = mock_response1

        config.date_range.start = date(2024, 1, 15)
        config.date_range.end = date(2024, 1, 15)

        client = ADOClient("TestOrg", "test-pat", config.api)
        extractor = PRExtractor(client, db, config)
        extractor.extract_all()

        # Updated PR with title "New Title"
        updated_pr = make_mock_pr(1, title="New Title")

        mock_response2 = MagicMock()
        mock_response2.json.return_value = {"value": [updated_pr]}
        mock_response2.headers = {}
        mock_response2.raise_for_status = MagicMock()

        mock_get.return_value = mock_response2

        # Backfill
        extractor.extract_all(backfill_days=30)

        # Generate CSVs
        csv_output = tmp_path / "csv_output"
        generator = CSVGenerator(db, csv_output)
        generator.generate_all()

        # Verify CSV has updated title
        df = pd.read_csv(csv_output / "pull_requests.csv")
        assert df.iloc[0]["title"] == "New Title"

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_backfill_adds_new_reviewer(
        self,
        mock_get: MagicMock,
        backfill_setup: tuple[DatabaseManager, Config, Path],
    ) -> None:
        """Backfill adds a reviewer that was added after initial extraction."""
        db, config, _ = backfill_setup

        # Initial: no reviewers
        mock_response1 = MagicMock()
        mock_response1.json.return_value = {"value": [make_mock_pr(1, reviewers=[])]}
        mock_response1.headers = {}
        mock_response1.raise_for_status = MagicMock()

        mock_get.return_value = mock_response1

        config.date_range.start = date(2024, 1, 15)
        config.date_range.end = date(2024, 1, 15)

        client = ADOClient("TestOrg", "test-pat", config.api)
        extractor = PRExtractor(client, db, config)
        extractor.extract_all()

        # Verify no reviewers
        cursor = db.execute("SELECT COUNT(*) as count FROM reviewers")
        row = cursor.fetchone()
        assert row["count"] == 0

        # Backfill: reviewer added
        new_reviewer = {
            "id": "user-new-reviewer",
            "displayName": "New Reviewer",
            "uniqueName": "new@example.com",
            "vote": 10,
        }

        mock_response2 = MagicMock()
        mock_response2.json.return_value = {
            "value": [make_mock_pr(1, reviewers=[new_reviewer])]
        }
        mock_response2.headers = {}
        mock_response2.raise_for_status = MagicMock()

        mock_get.return_value = mock_response2

        # Backfill
        extractor.extract_all(backfill_days=30)

        # Verify reviewer added
        cursor = db.execute("SELECT COUNT(*) as count FROM reviewers")
        row = cursor.fetchone()
        assert row["count"] == 1
