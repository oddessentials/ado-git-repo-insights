"""Unit tests for team extraction (Phase 3.3 data plane + #296 control plane).

- Team extraction with pagination (ADOClient.get_teams / get_team_members)
- Graceful degradation when team APIs unavailable
- Team persistence (PRRepository upsert/get helpers)
- Control-plane pipeline wiring: ``_extract_teams`` helper (#296)
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from datetime import UTC, date, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, patch

import pytest
import requests

from ado_git_repo_insights.config import APIConfig, Config
from ado_git_repo_insights.extractor.ado_client import ADOClient, ExtractionError
from ado_git_repo_insights.extractor.pr_extractor import (
    ExtractionSummary,
    ProjectExtractionResult,
)
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
    def db(self, tmp_path) -> Iterator[DatabaseManager]:
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


class TestRepositoryTeamQueries:
    """Tests for PRRepository team/member query methods (QG-40 coverage)."""

    @pytest.fixture
    def db(self, tmp_path: Path) -> Iterator[DatabaseManager]:
        db_path = tmp_path / "test.sqlite"
        db = DatabaseManager(db_path)
        db.connect()
        yield db
        db.close()

    @pytest.fixture
    def repo(self, db: DatabaseManager) -> PRRepository:
        return PRRepository(db)

    def _setup_team(self, repo: PRRepository, db: DatabaseManager) -> None:
        db.execute(
            "INSERT INTO organizations (organization_name) VALUES (?)", ("org1",)
        )
        db.execute(
            "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
            ("org1", "proj1"),
        )
        repo.upsert_team(
            team_id="team1",
            team_name="Alpha",
            project_name="proj1",
            organization_name="org1",
            description="Test team",
        )
        repo.upsert_team_member("team1", "u1", "User One", "u1@test.com", True)
        repo.upsert_team_member("team1", "u2", "User Two", "u2@test.com", False)
        db.connection.commit()

    def test_get_teams_for_project_returns_typed_rows(
        self, repo: PRRepository, db: DatabaseManager
    ) -> None:
        self._setup_team(repo, db)
        teams = repo.get_teams_for_project("org1", "proj1")
        assert len(teams) == 1
        assert teams[0]["team_id"] == "team1"
        assert teams[0]["team_name"] == "Alpha"
        assert teams[0]["description"] == "Test team"

    def test_get_team_members_returns_typed_rows(
        self, repo: PRRepository, db: DatabaseManager
    ) -> None:
        self._setup_team(repo, db)
        members = repo.get_team_members("team1")
        assert len(members) == 2
        assert members[0]["user_id"] in ("u1", "u2")
        assert "display_name" in members[0]

    def test_get_teams_for_project_empty(
        self, repo: PRRepository, db: DatabaseManager
    ) -> None:
        db.execute(
            "INSERT INTO organizations (organization_name) VALUES (?)", ("org1",)
        )
        db.execute(
            "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
            ("org1", "proj1"),
        )
        db.connection.commit()
        assert repo.get_teams_for_project("org1", "proj1") == []


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
        from datetime import datetime

        now = datetime.now(UTC).isoformat()
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


class TestExtractTeamsPipeline:
    """End-to-end pipeline tests for ``_extract_teams`` (#296 control plane).

    Exercises the helper against a real ``DatabaseManager`` (so upserts
    actually persist and the ``db.transaction()`` wrapper behaves as in
    production) with a mocked ``ADOClient`` and a ``SimpleNamespace``
    config stub.  Each test covers one invariant from the #296 review:

    - Per-project fan-out filtered to ``success == True`` (option b)
    - Per-project team-fetch failures skip-not-fail
    - Per-team member-fetch failures skip-not-fail, team still persists
    - Current-state membership via ``clear_team_members`` + refresh
    - Transaction wrapper rolls back both ``teams`` and ``team_members``
      on unhandled mid-loop exception (directive #3, tightened)
    - Terminal log uses ``PR-successful projects`` wording (directive #3,
      invariant portion only)
    - Empty projects list is a clean no-op
    """

    @pytest.fixture
    def ctx(
        self, tmp_path: Path
    ) -> Iterator[tuple[MagicMock, DatabaseManager, Config]]:
        """Mocked ADOClient + real DatabaseManager (with FK seed) + config stub."""
        db_path = tmp_path / "test.sqlite"
        db = DatabaseManager(db_path)
        db.connect()

        db.execute("INSERT INTO organizations (organization_name) VALUES ('org1')")
        db.execute(
            "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
            ("org1", "projA"),
        )
        db.execute(
            "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
            ("org1", "projB"),
        )
        db.connection.commit()

        mock_client = MagicMock(spec=ADOClient)
        # _extract_teams only reads ``config.organization``; a duck-typed
        # namespace covers the real contract without constructing a full
        # Config (which requires every production field).  The cast keeps
        # mypy strict against the helper's annotated shape.
        config = cast(Config, SimpleNamespace(organization="org1"))

        try:
            yield mock_client, db, config
        finally:
            db.close()

    @staticmethod
    def _mk_result(project: str, *, success: bool = True) -> ProjectExtractionResult:
        return ProjectExtractionResult(
            project=project,
            start_date=date(2026, 4, 1),
            end_date=date(2026, 4, 19),
            prs_extracted=5 if success else 0,
            success=success,
            error=None if success else "simulated PR fetch failure",
        )

    @staticmethod
    def _mk_summary(*results: ProjectExtractionResult) -> ExtractionSummary:
        summary = ExtractionSummary()
        for r in results:
            summary.add_result(r)
        return summary

    def test_happy_path_all_projects_succeed_extracts_teams(
        self,
        ctx: tuple[MagicMock, DatabaseManager, Config],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """All PR-successful projects: every team + member persists; terminal
        log locks the ``PR-successful projects`` invariant wording."""
        from ado_git_repo_insights.cli import _extract_teams

        client, db, config = ctx

        def teams_for(proj: str) -> list[dict[str, object]]:
            if proj == "projA":
                return [
                    {"id": "t1", "name": "Team One", "description": "first"},
                    {"id": "t2", "name": "Team Two", "description": None},
                ]
            return [{"id": "t3", "name": "Team Three", "description": "b-team"}]

        def members_for(proj: str, tid: str) -> list[dict[str, object]]:
            return [
                {
                    "identity": {"id": f"u-{tid}-1", "displayName": "Alice"},
                    "isTeamAdmin": True,
                },
                {
                    "identity": {"id": f"u-{tid}-2", "displayName": "Bob"},
                    "isTeamAdmin": False,
                },
            ]

        client.get_teams.side_effect = teams_for
        client.get_team_members.side_effect = members_for

        summary = self._mk_summary(
            self._mk_result("projA"),
            self._mk_result("projB"),
        )

        with caplog.at_level(logging.INFO, logger="ado_git_repo_insights.cli"):
            stats = _extract_teams(client, db, config, summary)

        assert stats["teams_extracted"] == 3
        assert stats["team_members_extracted"] == 6
        assert stats["projects_team_skipped"] == 0

        assert db.execute("SELECT COUNT(*) FROM teams").fetchone()[0] == 3
        assert db.execute("SELECT COUNT(*) FROM team_members").fetchone()[0] == 6

        # Lock only the invariant portion of the terminal log (directive #3).
        combined = " ".join(r.getMessage() for r in caplog.records)
        assert "PR-successful projects" in combined
        assert "3 teams" in combined
        assert "6 members" in combined

    def test_skips_project_with_failed_pr_extraction(
        self,
        ctx: tuple[MagicMock, DatabaseManager, Config],
    ) -> None:
        """Option (b): project with ``success=False`` is NEVER passed to
        ``get_teams``; succeeded projects are still processed."""
        from ado_git_repo_insights.cli import _extract_teams

        client, db, config = ctx
        client.get_teams.return_value = [
            {"id": "t1", "name": "Team", "description": None}
        ]
        client.get_team_members.return_value = []

        summary = self._mk_summary(
            self._mk_result("projA", success=True),
            self._mk_result("projB", success=False),
        )

        _extract_teams(client, db, config, summary)

        called_projects = [call.args[0] for call in client.get_teams.call_args_list]
        assert called_projects == ["projA"]

    def test_project_team_fetch_403_logs_and_continues(
        self,
        ctx: tuple[MagicMock, DatabaseManager, Config],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """``get_teams`` raising ``ExtractionError`` on one project logs a
        WARNING, increments ``projects_team_skipped``, and continues."""
        from ado_git_repo_insights.cli import _extract_teams

        client, db, config = ctx

        def team_fetch(proj: str) -> list[dict[str, object]]:
            if proj == "projA":
                raise ExtractionError("403 Forbidden on projA teams")
            return [{"id": "t3", "name": "Team B", "description": None}]

        client.get_teams.side_effect = team_fetch
        client.get_team_members.return_value = []

        summary = self._mk_summary(
            self._mk_result("projA"),
            self._mk_result("projB"),
        )

        with caplog.at_level(logging.WARNING, logger="ado_git_repo_insights.cli"):
            stats = _extract_teams(client, db, config, summary)

        assert stats["teams_extracted"] == 1
        assert stats["projects_team_skipped"] == 1

        team_names = [
            row[0] for row in db.execute("SELECT team_name FROM teams").fetchall()
        ]
        assert team_names == ["Team B"]

        warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING"]
        assert any("projA" in m and "skipping" in m for m in warnings)

    def test_member_fetch_failure_team_persisted_members_skipped(
        self,
        ctx: tuple[MagicMock, DatabaseManager, Config],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """``get_team_members`` failing for one team: team row still
        persisted, its members skipped with WARN, sibling teams unaffected."""
        from ado_git_repo_insights.cli import _extract_teams

        client, db, config = ctx

        client.get_teams.return_value = [
            {"id": "t1", "name": "Team 1", "description": None},
            {"id": "t2", "name": "Team 2", "description": None},
        ]

        def members(proj: str, tid: str) -> list[dict[str, object]]:
            if tid == "t1":
                raise ExtractionError("member fetch failed for t1")
            return [
                {
                    "identity": {"id": "u1", "displayName": "Alice"},
                    "isTeamAdmin": False,
                }
            ]

        client.get_team_members.side_effect = members

        summary = self._mk_summary(self._mk_result("projA"))

        with caplog.at_level(logging.WARNING, logger="ado_git_repo_insights.cli"):
            _extract_teams(client, db, config, summary)

        assert db.execute("SELECT COUNT(*) FROM teams").fetchone()[0] == 2
        member_team_ids = [
            row[0] for row in db.execute("SELECT team_id FROM team_members").fetchall()
        ]
        assert member_team_ids == ["t2"]

        warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING"]
        assert any("t1" in m for m in warnings)

    def test_clear_team_members_called_before_refresh(
        self,
        ctx: tuple[MagicMock, DatabaseManager, Config],
    ) -> None:
        """Pre-seeded stale member must be removed before new members are
        written — locks current-state membership semantics."""
        from ado_git_repo_insights.cli import _extract_teams

        client, db, config = ctx

        db.execute(
            "INSERT INTO users (user_id, display_name) VALUES ('stale_user', 'Stale')"
        )
        now = datetime.now(UTC).isoformat()
        db.execute(
            "INSERT INTO teams (team_id, team_name, project_name, "
            "organization_name, last_updated) VALUES (?, ?, ?, ?, ?)",
            ("t1", "Team 1", "projA", "org1", now),
        )
        db.execute(
            "INSERT INTO team_members (team_id, user_id, is_team_admin) "
            "VALUES ('t1', 'stale_user', 0)"
        )
        db.connection.commit()

        client.get_teams.return_value = [
            {"id": "t1", "name": "Team 1", "description": None}
        ]
        client.get_team_members.return_value = [
            {
                "identity": {"id": "fresh_user", "displayName": "Fresh"},
                "isTeamAdmin": True,
            }
        ]

        summary = self._mk_summary(self._mk_result("projA"))
        _extract_teams(client, db, config, summary)

        users_for_t1 = [
            row[0]
            for row in db.execute(
                "SELECT user_id FROM team_members WHERE team_id = 't1'"
            ).fetchall()
        ]
        assert users_for_t1 == ["fresh_user"]

    def test_empty_teams_list_no_upserts_no_warning(
        self,
        ctx: tuple[MagicMock, DatabaseManager, Config],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """A project with zero teams: no upserts, no WARNING, no crash."""
        from ado_git_repo_insights.cli import _extract_teams

        client, db, config = ctx
        client.get_teams.return_value = []

        summary = self._mk_summary(self._mk_result("projA"))

        with caplog.at_level(logging.WARNING, logger="ado_git_repo_insights.cli"):
            stats = _extract_teams(client, db, config, summary)

        assert stats["teams_extracted"] == 0
        assert stats["projects_team_skipped"] == 0
        assert db.execute("SELECT COUNT(*) FROM teams").fetchone()[0] == 0
        assert [r for r in caplog.records if r.levelname == "WARNING"] == []
        assert client.get_team_members.call_count == 0

    def test_unhandled_exception_mid_loop_rolls_back_all_writes(
        self,
        ctx: tuple[MagicMock, DatabaseManager, Config],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Directive #3 tightened: BOTH ``teams`` AND ``team_members`` must
        remain empty after a mid-loop unhandled exception — proves the
        single-transaction wrapper rolls back cross-table writes, not
        just one table."""
        from ado_git_repo_insights.cli import _extract_teams

        client, db, config = ctx

        client.get_teams.return_value = [
            {"id": "t1", "name": "Team 1", "description": None},
            {"id": "t2", "name": "Team 2", "description": None},
            {"id": "t3", "name": "Team 3", "description": None},
        ]
        client.get_team_members.return_value = [
            {
                "identity": {"id": "u1", "displayName": "Alice"},
                "isTeamAdmin": False,
            }
        ]

        # Force an unhandled exception on upsert_team_member.  By the
        # time this fires, the outer transaction has already persisted
        # at least one ``teams`` row (upsert_team runs first in the
        # inner loop); the rollback must undo that too — not just the
        # pending team_members write that never completed.
        def always_fail(self: PRRepository, **kwargs: object) -> None:
            raise RuntimeError("simulated mid-loop failure")

        monkeypatch.setattr(PRRepository, "upsert_team_member", always_fail)

        summary = self._mk_summary(self._mk_result("projA"))

        with pytest.raises(RuntimeError, match="simulated mid-loop failure"):
            _extract_teams(client, db, config, summary)

        assert db.execute("SELECT COUNT(*) FROM teams").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM team_members").fetchone()[0] == 0

    def test_no_succeeded_projects_is_clean_noop(
        self,
        ctx: tuple[MagicMock, DatabaseManager, Config],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """All projects failed PR extract: zero API calls, clean INFO log,
        no exception."""
        from ado_git_repo_insights.cli import _extract_teams

        client, db, config = ctx

        summary = self._mk_summary(
            self._mk_result("projA", success=False),
            self._mk_result("projB", success=False),
        )

        with caplog.at_level(logging.INFO, logger="ado_git_repo_insights.cli"):
            stats = _extract_teams(client, db, config, summary)

        assert stats == {
            "teams_extracted": 0,
            "team_members_extracted": 0,
            "projects_team_skipped": 0,
        }
        assert client.get_teams.call_count == 0
        assert client.get_team_members.call_count == 0

        info_msgs = [r.getMessage() for r in caplog.records if r.levelname == "INFO"]
        assert any("no PR-successful projects" in m for m in info_msgs)
