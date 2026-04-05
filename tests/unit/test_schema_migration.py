"""Tests for schema migration v1 → v2 (review_time columns).

Covers three scenarios per US3 acceptance criteria:
1. Upgrade: existing v1 database gains new columns, version advances to 2
2. Idempotency: running migration on v2 database produces no error
3. Fresh install: new database starts at v2 with columns already present
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from ado_git_repo_insights.persistence.database import DatabaseManager

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Minimal v1 schema: just enough tables to pass _validate_schema(),
# with schema_version seeded at 1 and NO reviewed_at / review_time_minutes.
_V1_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS extraction_metadata (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    organization_name TEXT NOT NULL,
    project_name TEXT NOT NULL,
    last_extraction_date TEXT NOT NULL,
    last_extraction_timestamp TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS organizations (
    organization_name TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS projects (
    project_name TEXT PRIMARY KEY,
    organization_name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repositories (
    repository_id TEXT PRIMARY KEY,
    repository_name TEXT NOT NULL,
    project_name TEXT NOT NULL,
    organization_name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT
);
CREATE TABLE IF NOT EXISTS pull_requests (
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
    raw_json TEXT,
    FOREIGN KEY (repository_id) REFERENCES repositories(repository_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);
CREATE TABLE IF NOT EXISTS reviewers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pull_request_uid TEXT NOT NULL,
    user_id TEXT NOT NULL,
    vote INTEGER NOT NULL,
    repository_id TEXT NOT NULL,
    FOREIGN KEY (pull_request_uid) REFERENCES pull_requests(pull_request_uid),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    UNIQUE(pull_request_uid, user_id)
);
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_version (version, applied_at)
VALUES (1, datetime('now'));
"""


def _create_v1_database(path: Path) -> None:
    """Create a database file with v1 schema (no review_time columns)."""
    conn = sqlite3.connect(str(path))
    conn.executescript(_V1_SCHEMA_SQL)
    conn.close()


def _seed_v1_data(path: Path) -> None:
    """Insert sample data into a v1 database for preservation testing."""
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("INSERT INTO users (user_id, display_name) VALUES ('u1', 'Alice')")
    conn.execute(
        "INSERT INTO repositories (repository_id, repository_name, "
        "project_name, organization_name) VALUES ('r1', 'repo', 'proj', 'org')"
    )
    conn.execute(
        "INSERT INTO pull_requests (pull_request_uid, pull_request_id, "
        "organization_name, project_name, repository_id, user_id, title, "
        "status, creation_date, cycle_time_minutes) "
        "VALUES ('r1-1', 1, 'org', 'proj', 'r1', 'u1', 'PR1', "
        "'completed', '2026-01-01T00:00:00Z', 120.5)"
    )
    conn.execute(
        "INSERT INTO reviewers (pull_request_uid, user_id, vote, repository_id) "
        "VALUES ('r1-1', 'u1', 10, 'r1')"
    )
    conn.commit()
    conn.close()


def _get_column_names(path: Path, table: str) -> set[str]:
    """Get column names for a table from a database file."""
    conn = sqlite3.connect(str(path))
    cursor = conn.execute(f"PRAGMA table_info({table})")
    columns = {row[1] for row in cursor.fetchall()}
    conn.close()
    return columns


def _get_schema_version(path: Path) -> int:
    """Read the max schema version from a database file."""
    conn = sqlite3.connect(str(path))
    cursor = conn.execute("SELECT MAX(version) FROM schema_version")
    row = cursor.fetchone()
    version = int(row[0]) if row and row[0] is not None else 0
    conn.close()
    return version


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestMigrationV1ToV2:
    """T004: v1 → v2 migration adds columns and preserves data."""

    def test_adds_reviewed_at_to_reviewers(self, tmp_path: Path) -> None:
        db_path = tmp_path / "test.db"
        _create_v1_database(db_path)
        _seed_v1_data(db_path)

        assert "reviewed_at" not in _get_column_names(db_path, "reviewers")

        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert "reviewed_at" in _get_column_names(db_path, "reviewers")
        finally:
            db.close()

    def test_adds_review_time_minutes_to_pull_requests(self, tmp_path: Path) -> None:
        db_path = tmp_path / "test.db"
        _create_v1_database(db_path)
        _seed_v1_data(db_path)

        assert "review_time_minutes" not in _get_column_names(db_path, "pull_requests")

        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert "review_time_minutes" in _get_column_names(db_path, "pull_requests")
        finally:
            db.close()

    def test_advances_schema_version_to_latest(self, tmp_path: Path) -> None:
        db_path = tmp_path / "test.db"
        _create_v1_database(db_path)

        assert _get_schema_version(db_path) == 1

        db = DatabaseManager(db_path)
        db.connect()
        try:
            # All pending migrations applied: v1→v2→v3
            assert db.get_schema_version() == 3
        finally:
            db.close()

    def test_preserves_existing_data(self, tmp_path: Path) -> None:
        db_path = tmp_path / "test.db"
        _create_v1_database(db_path)
        _seed_v1_data(db_path)

        db = DatabaseManager(db_path)
        db.connect()
        try:
            row = db.execute(
                "SELECT vote, reviewed_at FROM reviewers WHERE user_id = 'u1'"
            ).fetchone()
            assert row is not None
            assert row["vote"] == 10
            assert row["reviewed_at"] is None

            pr_row = db.execute(
                "SELECT cycle_time_minutes, review_time_minutes "
                "FROM pull_requests WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr_row is not None
            assert pr_row["cycle_time_minutes"] == pytest.approx(120.5)
            assert pr_row["review_time_minutes"] is None
        finally:
            db.close()


class TestMigrationIdempotency:
    """T005: running migration on v2 database is a no-op."""

    def test_no_error_on_v2_database(self, tmp_path: Path) -> None:
        db_path = tmp_path / "test.db"
        _create_v1_database(db_path)

        # First connect: migrates v1 → v2
        db = DatabaseManager(db_path)
        db.connect()
        db.close()

        assert _get_schema_version(db_path) == 3

        # Second connect: should be a no-op
        db2 = DatabaseManager(db_path)
        db2.connect()
        try:
            assert db2.get_schema_version() == 3
            assert "reviewed_at" in _get_column_names(db_path, "reviewers")
        finally:
            db2.close()


class TestFreshInstall:
    """T006: new database starts at v3 with all columns."""

    def test_fresh_db_has_reviewed_at(self, tmp_path: Path) -> None:
        db_path = tmp_path / "fresh.db"
        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert "reviewed_at" in _get_column_names(db_path, "reviewers")
        finally:
            db.close()

    def test_fresh_db_has_review_time_minutes(self, tmp_path: Path) -> None:
        db_path = tmp_path / "fresh.db"
        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert "review_time_minutes" in _get_column_names(db_path, "pull_requests")
        finally:
            db.close()

    def test_fresh_db_has_comments_extracted_at(self, tmp_path: Path) -> None:
        db_path = tmp_path / "fresh.db"
        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert "comments_extracted_at" in _get_column_names(
                db_path, "pull_requests"
            )
        finally:
            db.close()

    def test_fresh_db_starts_at_version_3(self, tmp_path: Path) -> None:
        db_path = tmp_path / "fresh.db"
        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert db.get_schema_version() == 3
        finally:
            db.close()
