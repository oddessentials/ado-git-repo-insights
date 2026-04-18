"""Tests for schema migration v4 → v5 (pr_comments composite PK).

Root cause addressed:
    ADO comment IDs are thread-scoped — every thread's first comment is id=1.
    Shipped v4 pr_comments used ``comment_id TEXT PRIMARY KEY`` (single-column
    PK) and ``ON CONFLICT(comment_id) DO UPDATE`` on upsert, so cross-thread
    and cross-PR upserts collided and silently overwrote the single surviving
    row.  Live-QA evidence: 502 PRs × ~8 threads each → 4394 thread rows but
    only 1 pr_comments row persisted.

Fix locked by tests in this module:
    pr_comments PK becomes composite ``(pull_request_uid, thread_id, comment_id)``.
    Migration drops the lossy table entirely (no preservation), rebuilds with
    the correct PK, and resets ``pull_requests.comments_extracted_at`` so every
    PR is reselected by backfill.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from ado_git_repo_insights.persistence.database import DatabaseManager
from ado_git_repo_insights.persistence.migrations import migrate_v4_to_v5
from ado_git_repo_insights.persistence.repository import PRRepository


class TestMigrationV4ToV5PrCommentsCompositePK:
    """v4 → v5 migration: pr_comments PK becomes composite."""

    _V4_SCHEMA_SQL = """
        CREATE TABLE extraction_metadata (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            organization_name TEXT NOT NULL,
            project_name TEXT NOT NULL,
            last_extraction_date TEXT NOT NULL,
            last_extraction_timestamp TEXT NOT NULL
        );
        CREATE TABLE organizations (organization_name TEXT PRIMARY KEY);
        CREATE TABLE projects (
            project_name TEXT PRIMARY KEY,
            organization_name TEXT NOT NULL
        );
        CREATE TABLE repositories (
            repository_id TEXT PRIMARY KEY,
            repository_name TEXT NOT NULL,
            project_name TEXT NOT NULL,
            organization_name TEXT NOT NULL
        );
        CREATE TABLE users (
            user_id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            email TEXT
        );
        CREATE TABLE pull_requests (
            pull_request_uid TEXT PRIMARY KEY,
            pull_request_id INTEGER NOT NULL,
            organization_name TEXT NOT NULL,
            project_name TEXT NOT NULL,
            repository_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL,
            description TEXT,
            creation_date TEXT NOT NULL,
            closed_date TEXT,
            cycle_time_minutes REAL,
            review_time_minutes REAL,
            comments_extracted_at TEXT,
            raw_json TEXT
        );
        CREATE TABLE reviewers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pull_request_uid TEXT NOT NULL,
            user_id TEXT NOT NULL,
            vote INTEGER NOT NULL,
            repository_id TEXT NOT NULL,
            reviewed_at TEXT,
            UNIQUE(pull_request_uid, user_id)
        );
        CREATE TABLE pr_threads (
            thread_id TEXT NOT NULL,
            pull_request_uid TEXT NOT NULL,
            status TEXT,
            thread_context TEXT,
            last_updated TEXT NOT NULL,
            created_at TEXT NOT NULL,
            is_deleted INTEGER DEFAULT 0,
            PRIMARY KEY (pull_request_uid, thread_id),
            FOREIGN KEY (pull_request_uid)
                REFERENCES pull_requests(pull_request_uid)
        );
        CREATE TABLE pr_comments (
            comment_id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            pull_request_uid TEXT NOT NULL,
            author_id TEXT NOT NULL,
            content TEXT,
            comment_type TEXT,
            created_at TEXT NOT NULL,
            last_updated TEXT,
            is_deleted INTEGER DEFAULT 0,
            FOREIGN KEY (pull_request_uid, thread_id)
                REFERENCES pr_threads(pull_request_uid, thread_id),
            FOREIGN KEY (pull_request_uid)
                REFERENCES pull_requests(pull_request_uid),
            FOREIGN KEY (author_id) REFERENCES users(user_id)
        );
        CREATE INDEX idx_pr_threads_updated ON pr_threads(last_updated);
        CREATE INDEX idx_pr_comments_thread
            ON pr_comments(pull_request_uid, thread_id);
        CREATE INDEX idx_pr_comments_pr ON pr_comments(pull_request_uid);
        CREATE INDEX idx_pr_comments_author ON pr_comments(author_id);
        CREATE TABLE comments_extraction_metadata (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            last_run_timestamp TEXT,
            prs_processed INTEGER NOT NULL DEFAULT 0,
            threads_fetched INTEGER NOT NULL DEFAULT 0,
            comments_fetched INTEGER NOT NULL DEFAULT 0,
            capped INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE teams (
            team_id TEXT PRIMARY KEY,
            team_name TEXT NOT NULL,
            organization_name TEXT NOT NULL,
            project_name TEXT NOT NULL,
            description TEXT
        );
        CREATE TABLE team_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            is_team_admin INTEGER NOT NULL DEFAULT 0,
            UNIQUE(team_id, user_id)
        );
        CREATE TABLE schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
        INSERT INTO schema_version (version, applied_at) VALUES (1, datetime('now'));
        INSERT INTO schema_version (version, applied_at) VALUES (2, datetime('now'));
        INSERT INTO schema_version (version, applied_at) VALUES (3, datetime('now'));
        INSERT INTO schema_version (version, applied_at) VALUES (4, datetime('now'));
    """

    def _create_v4_db(self, path: Path) -> sqlite3.Connection:
        """Create a v4 database with shared FK entities and 2 PRs with markers set."""
        conn = sqlite3.connect(str(path))
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.executescript(self._V4_SCHEMA_SQL)
        conn.execute("INSERT INTO users (user_id, display_name) VALUES ('u1', 'Alice')")
        conn.execute(
            "INSERT INTO repositories (repository_id, repository_name, "
            "project_name, organization_name) "
            "VALUES ('r1', 'repo', 'proj', 'org')"
        )
        conn.execute(
            "INSERT INTO pull_requests (pull_request_uid, pull_request_id, "
            "organization_name, project_name, repository_id, user_id, "
            "title, status, creation_date, comments_extracted_at) "
            "VALUES ('r1-1', 1, 'org', 'proj', 'r1', 'u1', 'PR 1', "
            "'completed', '2026-01-15T10:00:00Z', '2026-01-16T00:00:00Z')"
        )
        conn.execute(
            "INSERT INTO pull_requests (pull_request_uid, pull_request_id, "
            "organization_name, project_name, repository_id, user_id, "
            "title, status, creation_date, comments_extracted_at) "
            "VALUES ('r1-2', 2, 'org', 'proj', 'r1', 'u1', 'PR 2', "
            "'completed', '2026-01-15T10:00:00Z', '2026-01-16T00:00:00Z')"
        )
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def test_old_schema_upgrades_to_composite_pk(self, tmp_path: Path) -> None:
        """After v4→v5, pr_comments PRIMARY KEY covers (pull_request_uid, thread_id, comment_id)."""
        db_path = tmp_path / "v4_to_v5.db"
        conn = self._create_v4_db(db_path)
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert db.get_schema_version() == 6
            pk_cols = [
                row["name"]
                for row in sorted(
                    db.execute("PRAGMA table_info(pr_comments)").fetchall(),
                    key=lambda r: r["pk"],
                )
                if row["pk"] > 0
            ]
            assert pk_cols == ["pull_request_uid", "thread_id", "comment_id"], pk_cols
        finally:
            db.close()

    def test_existing_pr_comments_rows_are_dropped(self, tmp_path: Path) -> None:
        """v4→v5 force-rebuilds pr_comments; existing (lossy) rows are not preserved."""
        db_path = tmp_path / "v4_existing_rows.db"
        conn = self._create_v4_db(db_path)
        conn.execute(
            "INSERT INTO pr_threads "
            "(thread_id, pull_request_uid, status, last_updated, created_at) "
            "VALUES ('t1', 'r1-1', 'active', "
            "'2026-01-15T12:00:00Z', '2026-01-15T12:00:00Z')"
        )
        conn.execute(
            "INSERT INTO pr_comments "
            "(comment_id, thread_id, pull_request_uid, author_id, "
            "content, comment_type, created_at) "
            "VALUES ('1', 't1', 'r1-1', 'u1', 'lossy content', "
            "'text', '2026-01-15T12:00:00Z')"
        )
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        try:
            row = db.execute("SELECT COUNT(*) AS n FROM pr_comments").fetchone()
            assert row["n"] == 0
        finally:
            db.close()

    def test_all_pull_requests_comments_extracted_at_reset_to_null(
        self, tmp_path: Path
    ) -> None:
        """v4→v5 resets every pull_requests.comments_extracted_at to NULL."""
        db_path = tmp_path / "v4_reset_markers.db"
        conn = self._create_v4_db(db_path)
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        try:
            rows = db.execute(
                "SELECT comments_extracted_at FROM pull_requests"
            ).fetchall()
            assert len(rows) == 2
            for row in rows:
                assert row["comments_extracted_at"] is None
        finally:
            db.close()

    def test_post_migration_upsert_with_thread_scoped_ids_persists_all(
        self, tmp_path: Path
    ) -> None:
        """After v4→v5, realistic ADO-shaped upserts (every thread's
        comment id=1) persist every comment instead of collapsing to one row.
        """
        db_path = tmp_path / "v4_post_migration.db"
        conn = self._create_v4_db(db_path)
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        try:
            repo = PRRepository(db)
            cells = [
                ("r1-1", "t-a"),
                ("r1-1", "t-b"),
                ("r1-2", "t-a"),
                ("r1-2", "t-b"),
            ]
            for pr_uid, thread_id in cells:
                repo.upsert_thread(
                    thread_id=thread_id,
                    pull_request_uid=pr_uid,
                    status="active",
                    thread_context=None,
                    last_updated="2026-01-15T12:00:00Z",
                    created_at="2026-01-15T12:00:00Z",
                )
                repo.upsert_comment(
                    comment_id="1",
                    thread_id=thread_id,
                    pull_request_uid=pr_uid,
                    author_id="u1",
                    content=f"{pr_uid}/{thread_id}",
                    comment_type="text",
                    created_at="2026-01-15T12:00:00Z",
                )
            db.connection.commit()

            total = db.execute("SELECT COUNT(*) AS n FROM pr_comments").fetchone()["n"]
            assert total == 4
        finally:
            db.close()

    def test_begin_immediate_failure_does_not_rollback_or_mask_error(
        self, tmp_path: Path
    ) -> None:
        """migrate_v4_to_v5 MUST NOT issue ROLLBACK after a failed BEGIN IMMEDIATE.

        If the initial ``BEGIN IMMEDIATE`` raises (e.g., another writer
        holds the lock), no transaction is open. An unconditional
        ``ROLLBACK`` would itself raise
        ``OperationalError: cannot rollback - no transaction is active``
        and shadow the real lock error, making the migration failure
        much harder to diagnose.

        Real-shape reproduction: hold the writer lock on one connection
        and invoke the migration on a second connection with
        ``busy_timeout=0`` so ``BEGIN IMMEDIATE`` raises immediately
        without retrying. The original "database is locked" message
        must surface; the masking "cannot rollback" form must not.
        """
        db_path = tmp_path / "begin_fails.db"
        # Materialize the DB file so both connections can open it.
        sqlite3.connect(str(db_path)).close()

        # Holder acquires the writer lock via autocommit-mode BEGIN.
        holder = sqlite3.connect(str(db_path), isolation_level=None)
        holder.execute("BEGIN IMMEDIATE")
        try:
            # Migrator uses autocommit to mirror DatabaseManager.connect
            # (database.py:78); busy_timeout=0 forces the second BEGIN
            # to raise immediately instead of spinning.
            migrator = sqlite3.connect(str(db_path), isolation_level=None)
            migrator.execute("PRAGMA busy_timeout = 0")
            try:
                with pytest.raises(sqlite3.OperationalError) as excinfo:
                    migrate_v4_to_v5(migrator)
                message = str(excinfo.value).lower()
                assert "database is locked" in message, message
                # The masking "cannot rollback - no transaction is
                # active" text from the previous unguarded
                # implementation must NOT appear.
                assert "cannot rollback" not in message, message
                assert not migrator.in_transaction
            finally:
                migrator.close()
        finally:
            holder.execute("ROLLBACK")
            holder.close()

    def test_migration_idempotent_when_rerun_at_v5(self, tmp_path: Path) -> None:
        """A DB already at v5 must not re-run v4→v5.

        First connect runs v4→v5 then v5→v6 (the latter creates
        comments_extraction_metadata on this seed fixture which lacks it).
        Second connect is a full no-op.
        """
        db_path = tmp_path / "v5_rerun.db"
        conn = self._create_v4_db(db_path)
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        assert db.get_schema_version() == 6
        db.close()

        db2 = DatabaseManager(db_path)
        db2.connect()
        try:
            assert db2.get_schema_version() == 6
            pk_cols = [
                row["name"]
                for row in sorted(
                    db2.execute("PRAGMA table_info(pr_comments)").fetchall(),
                    key=lambda r: r["pk"],
                )
                if row["pk"] > 0
            ]
            assert pk_cols == ["pull_request_uid", "thread_id", "comment_id"]
        finally:
            db2.close()
