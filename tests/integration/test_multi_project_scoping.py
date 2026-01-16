"""Integration tests for multi-project scoping.

DoD 4.2: Org/Project Scoping Verified
- All relevant rows include organization_name and project_name where required
- A test ensures multi-project extraction does not collide
"""

from __future__ import annotations

import tempfile
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd
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
    repo_id: str,
    repo_name: str,
    author_id: str = "user-1",
) -> dict:
    """Create a mock PR response from ADO API."""
    return {
        "pullRequestId": pr_id,
        "title": f"PR {pr_id} in {repo_name}",
        "status": "completed",
        "description": f"Description for PR {pr_id}",
        "creationDate": "2024-01-15T10:00:00Z",
        "closedDate": "2024-01-15T12:00:00Z",
        "repository": {"id": repo_id, "name": repo_name},
        "createdBy": {
            "id": author_id,
            "displayName": f"Author {author_id}",
            "uniqueName": f"{author_id}@example.com",
        },
        "reviewers": [],
    }


@pytest.fixture
def multi_project_setup() -> tuple[DatabaseManager, Config, Path]:
    """Set up database and config for multi-project testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        db_path = tmp_path / "test.sqlite"

        db = DatabaseManager(db_path)
        db.connect()

        # Config with multiple projects
        config = Config(
            organization="TestOrg",
            projects=["ProjectAlpha", "ProjectBeta"],
            pat="test-pat",
            database=db_path,
            api=APIConfig(
                max_retries=1,
                retry_delay_seconds=0,
                rate_limit_sleep_seconds=0,
            ),
            backfill=BackfillConfig(enabled=False),
            date_range=DateRangeConfig(
                start=date(2024, 1, 15),
                end=date(2024, 1, 15),
            ),
        )

        yield db, config, tmp_path

        db.close()


class TestMultiProjectScoping:
    """Integration tests for multi-project scoping (DoD 4.2)."""

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_same_pr_id_different_repos_no_collision(
        self,
        mock_get: MagicMock,
        multi_project_setup: tuple[DatabaseManager, Config, Path],
    ) -> None:
        """PR ID 100 in two different repos does not collide."""
        db, config, _ = multi_project_setup

        # Project Alpha: PR 100 in repo-alpha
        alpha_response = MagicMock()
        alpha_response.json.return_value = {
            "value": [make_mock_pr(100, "repo-alpha", "AlphaRepo")]
        }
        alpha_response.headers = {}
        alpha_response.raise_for_status = MagicMock()

        # Project Beta: PR 100 in repo-beta (same PR ID, different repo)
        beta_response = MagicMock()
        beta_response.json.return_value = {
            "value": [make_mock_pr(100, "repo-beta", "BetaRepo")]
        }
        beta_response.headers = {}
        beta_response.raise_for_status = MagicMock()

        mock_get.side_effect = [alpha_response, beta_response]

        client = ADOClient("TestOrg", "test-pat", config.api)
        extractor = PRExtractor(client, db, config)
        extractor.extract_all()

        # Should have 2 distinct PRs
        cursor = db.execute("SELECT COUNT(*) as count FROM pull_requests")
        row = cursor.fetchone()
        assert row["count"] == 2

        # Verify they have different UIDs
        cursor = db.execute(
            "SELECT pull_request_uid FROM pull_requests ORDER BY pull_request_uid"
        )
        rows = cursor.fetchall()
        uids = [r["pull_request_uid"] for r in rows]

        assert "repo-alpha-100" in uids
        assert "repo-beta-100" in uids

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_prs_scoped_by_organization_and_project(
        self,
        mock_get: MagicMock,
        multi_project_setup: tuple[DatabaseManager, Config, Path],
    ) -> None:
        """PRs include organization_name and project_name columns."""
        db, config, tmp_path = multi_project_setup

        # Create responses for each project
        alpha_response = MagicMock()
        alpha_response.json.return_value = {
            "value": [make_mock_pr(1, "repo-a", "RepoA")]
        }
        alpha_response.headers = {}
        alpha_response.raise_for_status = MagicMock()

        beta_response = MagicMock()
        beta_response.json.return_value = {
            "value": [make_mock_pr(2, "repo-b", "RepoB")]
        }
        beta_response.headers = {}
        beta_response.raise_for_status = MagicMock()

        mock_get.side_effect = [alpha_response, beta_response]

        client = ADOClient("TestOrg", "test-pat", config.api)
        extractor = PRExtractor(client, db, config)
        extractor.extract_all()

        # Generate CSVs
        csv_output = tmp_path / "csv_output"
        generator = CSVGenerator(db, csv_output)
        generator.generate_all()

        # Verify CSV has organization and project columns
        df = pd.read_csv(csv_output / "pull_requests.csv")

        assert "organization_name" in df.columns
        assert "project_name" in df.columns

        # Verify scoping is correct
        pr1 = df[df["pull_request_uid"] == "repo-a-1"].iloc[0]
        assert pr1["organization_name"] == "TestOrg"
        assert pr1["project_name"] == "ProjectAlpha"

        pr2 = df[df["pull_request_uid"] == "repo-b-2"].iloc[0]
        assert pr2["organization_name"] == "TestOrg"
        assert pr2["project_name"] == "ProjectBeta"

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_same_user_across_projects_single_record(
        self,
        mock_get: MagicMock,
        multi_project_setup: tuple[DatabaseManager, Config, Path],
    ) -> None:
        """Same user authoring PRs in multiple projects has single user record."""
        db, config, _ = multi_project_setup

        # Same author in both projects
        common_author = "user-shared"

        alpha_response = MagicMock()
        alpha_response.json.return_value = {
            "value": [make_mock_pr(1, "repo-a", "RepoA", author_id=common_author)]
        }
        alpha_response.headers = {}
        alpha_response.raise_for_status = MagicMock()

        beta_response = MagicMock()
        beta_response.json.return_value = {
            "value": [make_mock_pr(2, "repo-b", "RepoB", author_id=common_author)]
        }
        beta_response.headers = {}
        beta_response.raise_for_status = MagicMock()

        mock_get.side_effect = [alpha_response, beta_response]

        client = ADOClient("TestOrg", "test-pat", config.api)
        extractor = PRExtractor(client, db, config)
        extractor.extract_all()

        # Should have exactly 1 user (UPSERT behavior)
        cursor = db.execute("SELECT COUNT(*) as count FROM users")
        row = cursor.fetchone()
        assert row["count"] == 1

        cursor = db.execute("SELECT user_id FROM users")
        row = cursor.fetchone()
        assert row["user_id"] == common_author

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_repositories_scoped_to_projects(
        self,
        mock_get: MagicMock,
        multi_project_setup: tuple[DatabaseManager, Config, Path],
    ) -> None:
        """Repositories are correctly scoped to their projects."""
        db, config, tmp_path = multi_project_setup

        alpha_response = MagicMock()
        alpha_response.json.return_value = {
            "value": [make_mock_pr(1, "repo-alpha", "AlphaRepo")]
        }
        alpha_response.headers = {}
        alpha_response.raise_for_status = MagicMock()

        beta_response = MagicMock()
        beta_response.json.return_value = {
            "value": [make_mock_pr(2, "repo-beta", "BetaRepo")]
        }
        beta_response.headers = {}
        beta_response.raise_for_status = MagicMock()

        mock_get.side_effect = [alpha_response, beta_response]

        client = ADOClient("TestOrg", "test-pat", config.api)
        extractor = PRExtractor(client, db, config)
        extractor.extract_all()

        # Generate CSVs
        csv_output = tmp_path / "csv_output"
        generator = CSVGenerator(db, csv_output)
        generator.generate_all()

        df = pd.read_csv(csv_output / "repositories.csv")

        # Verify each repo is scoped to correct project
        alpha_repo = df[df["repository_id"] == "repo-alpha"].iloc[0]
        assert alpha_repo["project_name"] == "ProjectAlpha"
        assert alpha_repo["organization_name"] == "TestOrg"

        beta_repo = df[df["repository_id"] == "repo-beta"].iloc[0]
        assert beta_repo["project_name"] == "ProjectBeta"
        assert beta_repo["organization_name"] == "TestOrg"

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_projects_table_has_both_projects(
        self,
        mock_get: MagicMock,
        multi_project_setup: tuple[DatabaseManager, Config, Path],
    ) -> None:
        """Projects table contains both extracted projects."""
        db, config, tmp_path = multi_project_setup

        alpha_response = MagicMock()
        alpha_response.json.return_value = {"value": [make_mock_pr(1, "r1", "R1")]}
        alpha_response.headers = {}
        alpha_response.raise_for_status = MagicMock()

        beta_response = MagicMock()
        beta_response.json.return_value = {"value": [make_mock_pr(2, "r2", "R2")]}
        beta_response.headers = {}
        beta_response.raise_for_status = MagicMock()

        mock_get.side_effect = [alpha_response, beta_response]

        client = ADOClient("TestOrg", "test-pat", config.api)
        extractor = PRExtractor(client, db, config)
        extractor.extract_all()

        # Generate CSVs
        csv_output = tmp_path / "csv_output"
        generator = CSVGenerator(db, csv_output)
        generator.generate_all()

        df = pd.read_csv(csv_output / "projects.csv")

        projects = set(df["project_name"])
        assert "ProjectAlpha" in projects
        assert "ProjectBeta" in projects
