"""Unit tests for team extraction (Phase 3.3).

Covers §5 from IMPLEMENTATION_DETAILS.md:
- Team extraction with pagination
- Graceful degradation when team APIs unavailable
- Team persistence and membership
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
import requests

from ado_git_repo_insights.config import APIConfig
from ado_git_repo_insights.extractor.ado_client import ADOClient, ExtractionError
from ado_git_repo_insights.persistence.database import DatabaseManager
from ado_git_repo_insights.persistence.repository import PRRepository


class TestTeamExtraction:
    """Tests for team extraction API methods."""

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

    def test_get_teams_returns_list(self, client: ADOClient) -> None:
        """Test that get_teams returns a list of teams."""
        mock_response = MagicMock()
        mock_response.ok = True
        mock_response.status_code = 200
        mock_response.headers = {}
        mock_response.json.return_value = {
            "count": 2,
            "value": [
                {"id": "team1", "name": "Team Alpha", "description": "First team"},
                {"id": "team2", "name": "Team Beta", "description": "Second team"},
            ],
        }

        with patch("requests.get", return_value=mock_response):
            teams = client.get_teams("TestProject")

        assert len(teams) == 2
        assert teams[0]["id"] == "team1"
        assert teams[1]["name"] == "Team Beta"

    def test_get_teams_handles_pagination(self, client: ADOClient) -> None:
        """Test that get_teams handles continuation tokens (§5: pagination)."""
        # First page with continuation token
        page1_response = MagicMock()
        page1_response.ok = True
        page1_response.status_code = 200
        page1_response.headers = {"x-ms-continuationtoken": "token123"}
        page1_response.json.return_value = {
            "value": [{"id": "team1", "name": "Team 1"}],
        }

        # Second page (no continuation)
        page2_response = MagicMock()
        page2_response.ok = True
        page2_response.status_code = 200
        page2_response.headers = {}
        page2_response.json.return_value = {
            "value": [{"id": "team2", "name": "Team 2"}],
        }

        with patch("requests.get", side_effect=[page1_response, page2_response]):
            teams = client.get_teams("TestProject")

        assert len(teams) == 2
        assert teams[0]["id"] == "team1"
        assert teams[1]["id"] == "team2"

    def test_get_teams_raises_on_error(self, client: ADOClient) -> None:
        """Test that get_teams raises ExtractionError on failure."""
        mock_response = MagicMock()
        mock_response.ok = False
        mock_response.status_code = 403
        mock_response.raise_for_status.side_effect = requests.HTTPError("Forbidden")

        with patch("requests.get", return_value=mock_response):
            with pytest.raises(ExtractionError, match="Failed to fetch teams"):
                client.get_teams("TestProject")

    def test_get_team_members_returns_list(self, client: ADOClient) -> None:
        """Test that get_team_members returns member list."""
        mock_response = MagicMock()
        mock_response.ok = True
        mock_response.status_code = 200
        mock_response.headers = {}
        mock_response.json.return_value = {
            "value": [
                {
                    "identity": {"id": "user1", "displayName": "User One"},
                    "isTeamAdmin": True,
                },
                {
                    "identity": {"id": "user2", "displayName": "User Two"},
                    "isTeamAdmin": False,
                },
            ],
        }

        with patch("requests.get", return_value=mock_response):
            members = client.get_team_members("TestProject", "team1")

        assert len(members) == 2


class TestTeamPersistence:
    """Tests for team persistence operations."""

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

    def test_upsert_team(self, repo: PRRepository, db: DatabaseManager) -> None:
        """Test team upsert creates and updates teams."""
        # Setup required parent entities
        db.execute(
            "INSERT INTO organizations (organization_name) VALUES (?)", ("org1",)
        )
        db.execute(
            "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
            ("org1", "proj1"),
        )

        # Insert team
        repo.upsert_team(
            team_id="team1",
            team_name="Alpha Team",
            project_name="proj1",
            organization_name="org1",
            description="Test team",
        )
        db.connection.commit()

        # Verify insertion
        cursor = db.execute("SELECT * FROM teams WHERE team_id = ?", ("team1",))
        row = cursor.fetchone()
        assert row is not None
        assert row["team_name"] == "Alpha Team"

        # Update team
        repo.upsert_team(
            team_id="team1",
            team_name="Alpha Team Renamed",
            project_name="proj1",
            organization_name="org1",
        )
        db.connection.commit()

        cursor = db.execute("SELECT * FROM teams WHERE team_id = ?", ("team1",))
        row = cursor.fetchone()
        assert row["team_name"] == "Alpha Team Renamed"

    def test_upsert_team_member(self, repo: PRRepository, db: DatabaseManager) -> None:
        """Test team member upsert."""
        # Setup
        db.execute(
            "INSERT INTO organizations (organization_name) VALUES (?)", ("org1",)
        )
        db.execute(
            "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
            ("org1", "proj1"),
        )
        # Note: user1 is NOT pre-inserted - testing that upsert_team_member creates it
        repo.upsert_team(
            team_id="team1",
            team_name="Test Team",
            project_name="proj1",
            organization_name="org1",
        )
        db.connection.commit()

        # Add member (no need to pre-insert user - upsert_team_member handles it)
        repo.upsert_team_member(
            team_id="team1",
            user_id="user1",
            display_name="Test User",
            email="test@example.com",
            is_team_admin=True,
        )
        db.connection.commit()

        # Verify
        cursor = db.execute(
            "SELECT * FROM team_members WHERE team_id = ? AND user_id = ?",
            ("team1", "user1"),
        )
        row = cursor.fetchone()
        assert row is not None
        assert row["is_team_admin"] == 1

    def test_clear_team_members(self, repo: PRRepository, db: DatabaseManager) -> None:
        """Test clearing team members for refresh."""
        # Setup
        db.execute(
            "INSERT INTO organizations (organization_name) VALUES (?)", ("org1",)
        )
        db.execute(
            "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
            ("org1", "proj1"),
        )
        # Note: users are NOT pre-inserted - testing that upsert_team_member creates them
        repo.upsert_team(
            team_id="team1",
            team_name="Test Team",
            project_name="proj1",
            organization_name="org1",
        )
        # Add members - upsert_team_member now handles user creation
        repo.upsert_team_member("team1", "user1", "User 1", "u1@example.com")
        repo.upsert_team_member("team1", "user2", "User 2", "u2@example.com")
        db.connection.commit()

        # Verify members exist
        cursor = db.execute(
            "SELECT COUNT(*) FROM team_members WHERE team_id = ?", ("team1",)
        )
        assert cursor.fetchone()[0] == 2

        # Clear members
        repo.clear_team_members("team1")
        db.connection.commit()

        # Verify cleared
        cursor = db.execute(
            "SELECT COUNT(*) FROM team_members WHERE team_id = ?", ("team1",)
        )
        assert cursor.fetchone()[0] == 0


class TestTeamGracefulDegradation:
    """Tests for graceful degradation when teams unavailable."""

    def test_aggregates_generated_without_teams(self, tmp_path) -> None:
        """Test that aggregates are generated with teams=false when no teams exist."""
        from ado_git_repo_insights.transform.aggregators import AggregateGenerator

        db_path = tmp_path / "test.sqlite"
        db = DatabaseManager(db_path)
        db.connect()

        # No teams inserted - manifest should have teams=false
        output_dir = tmp_path / "output"
        generator = AggregateGenerator(db, output_dir)
        manifest = generator.generate_all()

        assert manifest.features["teams"] is False
        assert manifest.coverage["teams_count"] == 0

        db.close()

    def test_aggregates_include_teams_when_present(self, tmp_path) -> None:
        """Test that aggregates include teams dimension when teams exist."""
        from ado_git_repo_insights.transform.aggregators import AggregateGenerator

        db_path = tmp_path / "test.sqlite"
        db = DatabaseManager(db_path)
        db.connect()

        # Insert required entities
        db.execute(
            "INSERT INTO organizations (organization_name) VALUES (?)", ("org1",)
        )
        db.execute(
            "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
            ("org1", "proj1"),
        )

        # Insert a team
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            """
            INSERT INTO teams (team_id, team_name, project_name, organization_name, last_updated)
            VALUES (?, ?, ?, ?, ?)
            """,
            ("team1", "Test Team", "proj1", "org1", now),
        )
        db.connection.commit()

        output_dir = tmp_path / "output"
        generator = AggregateGenerator(db, output_dir)
        manifest = generator.generate_all()

        assert manifest.features["teams"] is True
        assert manifest.coverage["teams_count"] == 1

        db.close()
