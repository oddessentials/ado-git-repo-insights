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
            # All pending migrations applied: v1→v2→v3→v4
            assert db.get_schema_version() == 4
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

        assert _get_schema_version(db_path) == 4

        # Second connect: should be a no-op
        db2 = DatabaseManager(db_path)
        db2.connect()
        try:
            assert db2.get_schema_version() == 4
            assert "reviewed_at" in _get_column_names(db_path, "reviewers")
        finally:
            db2.close()


class TestFreshInstall:
    """T006: new database starts at v4 with all columns."""

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

    def test_fresh_db_starts_at_version_4(self, tmp_path: Path) -> None:
        db_path = tmp_path / "fresh.db"
        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert db.get_schema_version() == 4
        finally:
            db.close()


class TestMigrationV2ToV3CoverageBackfill:
    """v2→v3 migration backfills comments_extracted_at from evidence only.

    The migration cannot distinguish zero-thread PRs (visited, nothing to
    store) from API-failed PRs (never processed).  It stamps only PRs with
    rows in pr_threads or pr_comments — preferring understatement over
    overstatement.  One subsequent --include-comments run converges
    coverage to the correct value.
    """

    # Shared v2 schema DDL for all tests in this class.
    _V2_SCHEMA_SQL = """
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
            thread_id TEXT PRIMARY KEY,
            pull_request_uid TEXT NOT NULL,
            status TEXT,
            thread_context TEXT,
            last_updated TEXT NOT NULL,
            created_at TEXT NOT NULL,
            is_deleted INTEGER DEFAULT 0
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
            is_deleted INTEGER DEFAULT 0
        );
        CREATE TABLE comments_extraction_metadata (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            last_run_timestamp TEXT NOT NULL,
            prs_processed INTEGER NOT NULL DEFAULT 0,
            threads_fetched INTEGER NOT NULL DEFAULT 0,
            comments_fetched INTEGER NOT NULL DEFAULT 0,
            capped INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
        INSERT INTO schema_version (version, applied_at)
        VALUES (2, datetime('now'));
    """

    def _create_v2_db(self, path: Path) -> sqlite3.Connection:
        """Create a v2 database with shared entities and return the connection."""
        conn = sqlite3.connect(str(path))
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.executescript(self._V2_SCHEMA_SQL)
        conn.execute("INSERT INTO users (user_id, display_name) VALUES ('u1', 'Alice')")
        conn.execute(
            "INSERT INTO repositories (repository_id, repository_name, "
            "project_name, organization_name) "
            "VALUES ('r1', 'repo', 'proj', 'org')"
        )
        return conn

    def test_migration_understates_coverage_for_ambiguous_zero_thread_prs(
        self, tmp_path: Path
    ) -> None:
        """After v2→v3, zero-thread PRs are not stamped → coverage is 'partial'.

        3 completed PRs, 1 with threads, 2 with zero threads.  The migration
        can only prove r1-1 was processed (has pr_threads rows).  r1-2 and
        r1-3 are ambiguous — they may have been visited or may have failed.
        The safe direction is partial.
        """
        db_path = tmp_path / "v2_ambiguous.db"
        conn = self._create_v2_db(db_path)

        for i in range(1, 4):
            conn.execute(
                "INSERT INTO pull_requests (pull_request_uid, pull_request_id, "
                "organization_name, project_name, repository_id, user_id, "
                "title, status, creation_date) "
                "VALUES (?, ?, 'org', 'proj', 'r1', 'u1', ?, 'completed', "
                "'2026-01-15T10:00:00Z')",
                (f"r1-{i}", i, f"PR {i}"),
            )
        # Only r1-1 has evidence.
        conn.execute(
            "INSERT INTO pr_threads (thread_id, pull_request_uid, status, "
            "last_updated, created_at) "
            "VALUES ('t1', 'r1-1', 'active', '2026-01-16T00:00:00Z', "
            "'2026-01-16T00:00:00Z')"
        )
        conn.execute(
            "INSERT INTO comments_extraction_metadata "
            "(id, last_run_timestamp, prs_processed, threads_fetched, "
            "comments_fetched, capped) "
            "VALUES (1, '2026-01-20T00:00:00Z', 3, 1, 0, 0)"
        )
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert db.get_schema_version() == 4

            # Only the 1 PR with evidence should be stamped.
            row = db.execute(
                "SELECT COUNT(*) AS cnt FROM pull_requests "
                "WHERE comments_extracted_at IS NOT NULL"
            ).fetchone()
            assert int(row["cnt"]) == 1

            from ado_git_repo_insights.transform.aggregators import (
                AggregateGenerator,
            )

            output = tmp_path / "agg_out"
            gen = AggregateGenerator(db, output)
            coverage = gen._get_comments_coverage()
            assert coverage["status"] == "partial", (
                "Ambiguous zero-thread PRs must not be stamped — partial "
                "is the safe direction after migration"
            )
        finally:
            db.close()

    def test_coverage_converges_to_full_after_rerun(self, tmp_path: Path) -> None:
        """After migration (partial), one --include-comments rerun → full.

        Simulates the runtime stamping that happens when the extractor
        processes each PR successfully (including zero-thread PRs).
        """
        db_path = tmp_path / "v2_converge.db"
        conn = self._create_v2_db(db_path)

        for i in range(1, 4):
            conn.execute(
                "INSERT INTO pull_requests (pull_request_uid, pull_request_id, "
                "organization_name, project_name, repository_id, user_id, "
                "title, status, creation_date) "
                "VALUES (?, ?, 'org', 'proj', 'r1', 'u1', ?, 'completed', "
                "'2026-01-15T10:00:00Z')",
                (f"r1-{i}", i, f"PR {i}"),
            )
        conn.execute(
            "INSERT INTO pr_threads (thread_id, pull_request_uid, status, "
            "last_updated, created_at) "
            "VALUES ('t1', 'r1-1', 'active', '2026-01-16T00:00:00Z', "
            "'2026-01-16T00:00:00Z')"
        )
        conn.execute(
            "INSERT INTO comments_extraction_metadata "
            "(id, last_run_timestamp, prs_processed, threads_fetched, "
            "comments_fetched, capped) "
            "VALUES (1, '2026-01-20T00:00:00Z', 3, 1, 0, 0)"
        )
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        try:
            from ado_git_repo_insights.transform.aggregators import (
                AggregateGenerator,
            )

            # Post-migration: partial (zero-thread PRs ambiguous).
            output = tmp_path / "agg_out"
            gen = AggregateGenerator(db, output)
            assert gen._get_comments_coverage()["status"] == "partial"

            # Simulate a successful --include-comments rerun that stamps
            # all 3 PRs (the runtime path in cli.py).
            db.execute(
                "UPDATE pull_requests SET comments_extracted_at = "
                "'2026-02-01T00:00:00Z' WHERE status = 'completed'"
            )

            assert gen._get_comments_coverage()["status"] == "full"
        finally:
            db.close()

    def test_uncapped_run_with_api_failures_stays_partial(self, tmp_path: Path) -> None:
        """Uncapped extraction with API failures → partial after migration.

        Regression: migration previously stamped all completed PRs when
        capped = 0, incorrectly marking API-failed PRs as covered.

        3 completed PRs:
        - r1-1: has a thread (successfully processed)
        - r1-2: has a comment (successfully processed)
        - r1-3: no evidence (API failure during extraction)
        Metadata: uncapped, prs_processed=2, prs_comment_failures implied.
        """
        db_path = tmp_path / "v2_api_fail.db"
        conn = self._create_v2_db(db_path)

        for i in range(1, 4):
            conn.execute(
                "INSERT INTO pull_requests (pull_request_uid, pull_request_id, "
                "organization_name, project_name, repository_id, user_id, "
                "title, status, creation_date) "
                "VALUES (?, ?, 'org', 'proj', 'r1', 'u1', ?, 'completed', "
                "'2026-01-15T10:00:00Z')",
                (f"r1-{i}", i, f"PR {i}"),
            )
        # r1-1: has a thread.
        conn.execute(
            "INSERT INTO pr_threads (thread_id, pull_request_uid, status, "
            "last_updated, created_at) "
            "VALUES ('t1', 'r1-1', 'active', '2026-01-16T00:00:00Z', "
            "'2026-01-16T00:00:00Z')"
        )
        # r1-2: has a comment (different evidence path).
        conn.execute(
            "INSERT INTO pr_threads (thread_id, pull_request_uid, status, "
            "last_updated, created_at) "
            "VALUES ('t2', 'r1-2', 'active', '2026-01-16T00:00:00Z', "
            "'2026-01-16T00:00:00Z')"
        )
        conn.execute(
            "INSERT INTO pr_comments (comment_id, thread_id, "
            "pull_request_uid, author_id, content, comment_type, "
            "created_at) "
            "VALUES ('c1', 't2', 'r1-2', 'u1', 'LGTM', 'text', "
            "'2026-01-16T01:00:00Z')"
        )
        # r1-3: no rows anywhere — API failure.
        conn.execute(
            "INSERT INTO comments_extraction_metadata "
            "(id, last_run_timestamp, prs_processed, threads_fetched, "
            "comments_fetched, capped) "
            "VALUES (1, '2026-01-20T00:00:00Z', 2, 2, 1, 0)"
        )
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert db.get_schema_version() == 4

            # Only 2 PRs with evidence should be stamped.
            row = db.execute(
                "SELECT COUNT(*) AS cnt FROM pull_requests "
                "WHERE comments_extracted_at IS NOT NULL"
            ).fetchone()
            assert int(row["cnt"]) == 2, "API-failed PR must NOT be stamped as covered"

            from ado_git_repo_insights.transform.aggregators import (
                AggregateGenerator,
            )

            output = tmp_path / "agg_out"
            gen = AggregateGenerator(db, output)
            coverage = gen._get_comments_coverage()
            assert coverage["status"] == "partial", (
                "Uncapped run with API failures must report partial, not full"
            )
        finally:
            db.close()

    def test_evidence_backfill_without_metadata_row(self, tmp_path: Path) -> None:
        """PRs with pr_threads/pr_comments evidence must be stamped even
        when comments_extraction_metadata is empty.

        Regression: the backfill was gated on the metadata row existing.
        A v2 database can have concrete evidence in pr_threads/pr_comments
        while the metadata singleton is absent (e.g. interrupted first run,
        manual import, or table present but empty).  Missing metadata must
        not erase provable per-PR coverage evidence.
        """
        db_path = tmp_path / "v2_no_meta.db"
        conn = self._create_v2_db(db_path)

        # 2 completed PRs.
        for i in range(1, 3):
            conn.execute(
                "INSERT INTO pull_requests (pull_request_uid, pull_request_id, "
                "organization_name, project_name, repository_id, user_id, "
                "title, status, creation_date) "
                "VALUES (?, ?, 'org', 'proj', 'r1', 'u1', ?, 'completed', "
                "'2026-01-15T10:00:00Z')",
                (f"r1-{i}", i, f"PR {i}"),
            )
        # r1-1 has a thread (evidence of processing).
        conn.execute(
            "INSERT INTO pr_threads (thread_id, pull_request_uid, status, "
            "last_updated, created_at) "
            "VALUES ('t1', 'r1-1', 'active', '2026-01-16T00:00:00Z', "
            "'2026-01-16T00:00:00Z')"
        )
        # No comments_extraction_metadata row — table is empty.
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert db.get_schema_version() == 4

            # r1-1 must be stamped from evidence despite missing metadata.
            row = db.execute(
                "SELECT comments_extracted_at FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert row is not None
            assert row["comments_extracted_at"] is not None, (
                "PR with pr_threads evidence must be stamped even without metadata row"
            )

            # r1-2 has no evidence — must NOT be stamped.
            row2 = db.execute(
                "SELECT comments_extracted_at FROM pull_requests "
                "WHERE pull_request_uid = 'r1-2'"
            ).fetchone()
            assert row2 is not None
            assert row2["comments_extracted_at"] is None
        finally:
            db.close()
