"""Tests for schema migration v1 → v2 (review_time columns).

Covers three scenarios per US3 acceptance criteria:
1. Upgrade: existing v1 database gains new columns, version advances to 2
2. Idempotency: running migration on v2 database produces no error
3. Fresh install: new database starts at v2 with columns already present
"""

from __future__ import annotations

import logging
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
            assert db.get_schema_version() == 5
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

        assert _get_schema_version(db_path) == 5

        # Second connect: should be a no-op
        db2 = DatabaseManager(db_path)
        db2.connect()
        try:
            assert db2.get_schema_version() == 5
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
            assert db.get_schema_version() == 5
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

    @pytest.fixture(autouse=True)
    def _freeze_migrations_at_v4(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Stop auto-migrations at v4 so v4→v5 (which resets every
        ``comments_extracted_at`` to NULL as part of the pr_comments
        composite-PK rebuild) does not destroy the v2→v3 coverage-backfill
        state under test here.  The v4→v5 migration has its own dedicated
        test class in ``test_schema_migration_v4_to_v5.py``.
        """
        from ado_git_repo_insights.persistence.migrations import (
            MIGRATIONS as _SOURCE_MIGRATIONS,
        )

        monkeypatch.setattr(
            "ado_git_repo_insights.persistence.database.MIGRATIONS",
            {k: v for k, v in _SOURCE_MIGRATIONS.items() if k < 5},
        )

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

    def test_migration_succeeds_with_pr_threads_but_no_pr_comments(
        self, tmp_path: Path
    ) -> None:
        """v3→v4 must not crash when pr_threads exists but pr_comments is absent.

        Regression: the migration unconditionally ran ALTER TABLE pr_comments
        RENAME after checking only pr_threads existence.  A partial schema
        (interrupted rollout, manual repair) could have pr_threads without
        pr_comments.
        """
        db_path = tmp_path / "v2_partial.db"
        conn = self._create_v2_db(db_path)

        # Insert a PR and a thread, but do NOT create pr_comments.
        conn.execute(
            "INSERT INTO pull_requests (pull_request_uid, pull_request_id, "
            "organization_name, project_name, repository_id, user_id, "
            "title, status, creation_date) "
            "VALUES ('r1-1', 1, 'org', 'proj', 'r1', 'u1', 'PR 1', "
            "'completed', '2026-01-15T10:00:00Z')"
        )
        conn.execute(
            "INSERT INTO pr_threads (thread_id, pull_request_uid, status, "
            "last_updated, created_at) "
            "VALUES ('1', 'r1-1', 'active', '2026-01-16T00:00:00Z', "
            "'2026-01-16T00:00:00Z')"
        )
        # Drop pr_comments to simulate partial schema.
        conn.execute("DROP TABLE IF EXISTS pr_comments")
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert db.get_schema_version() == 4

            # pr_threads must have composite PK now.
            pk_info = db.execute("PRAGMA table_info(pr_threads)").fetchall()
            pk_cols = [row["name"] for row in pk_info if row["pk"] > 0]
            assert len(pk_cols) > 1, "pr_threads must have composite PK after migration"

            # pr_comments must exist (created fresh).
            row = db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pr_comments'"
            ).fetchone()
            assert row is not None, "pr_comments must be created by migration"

            # Thread data preserved.
            thread = db.execute(
                "SELECT * FROM pr_threads WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert thread is not None
        finally:
            db.close()

    def test_normal_v3_to_v4_rebuild_both_tables(self, tmp_path: Path) -> None:
        """v3→v4 with both old pr_threads and pr_comments present must rebuild
        both tables to composite PK/FK and preserve all data.
        """
        db_path = tmp_path / "v2_both.db"
        conn = self._create_v2_db(db_path)

        # Insert PRs, threads, and comments (old single-column PK schema).
        conn.execute(
            "INSERT INTO pull_requests (pull_request_uid, pull_request_id, "
            "organization_name, project_name, repository_id, user_id, "
            "title, status, creation_date) "
            "VALUES ('r1-1', 1, 'org', 'proj', 'r1', 'u1', 'PR 1', "
            "'completed', '2026-01-15T10:00:00Z')"
        )
        conn.execute(
            "INSERT INTO pr_threads (thread_id, pull_request_uid, status, "
            "last_updated, created_at) "
            "VALUES ('1', 'r1-1', 'active', '2026-01-16T00:00:00Z', "
            "'2026-01-16T00:00:00Z')"
        )
        conn.execute(
            "INSERT INTO pr_comments (comment_id, thread_id, "
            "pull_request_uid, author_id, content, comment_type, "
            "created_at) "
            "VALUES ('c1', '1', 'r1-1', 'u1', 'LGTM', 'text', "
            "'2026-01-16T01:00:00Z')"
        )
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert db.get_schema_version() == 4

            # pr_threads must have composite PK.
            pk_info = db.execute("PRAGMA table_info(pr_threads)").fetchall()
            pk_cols = [row["name"] for row in pk_info if row["pk"] > 0]
            assert set(pk_cols) == {"pull_request_uid", "thread_id"}

            # Data preserved.
            thread = db.execute(
                "SELECT * FROM pr_threads "
                "WHERE pull_request_uid = 'r1-1' AND thread_id = '1'"
            ).fetchone()
            assert thread is not None
            assert thread["status"] == "active"

            comment = db.execute(
                "SELECT * FROM pr_comments WHERE comment_id = 'c1'"
            ).fetchone()
            assert comment is not None
            assert comment["content"] == "LGTM"
        finally:
            db.close()


class TestMigrationV3ToV4DedupAndRecovery:
    """v3→v4 migration: dedup, stale artifact recovery, and FK validation.

    Tests cover the three critical correctness fixes:
    F1 — Duplicate rows merged deterministically (prefer non-deleted, newest)
    F2 — Stale _pr_threads_v3 / _pr_comments_v3 recovered or dropped
    F3 — Composite FK validated structurally, not just by column name
    """

    @pytest.fixture(autouse=True)
    def _freeze_migrations_at_v4(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Stop auto-migrations at v4 so v4→v5 (which drops pr_comments and
        resets every ``comments_extracted_at`` as part of the composite-PK
        rebuild) does not destroy the v3→v4 dedup/recovery state under test
        here.  The v4→v5 migration has its own dedicated test class in
        ``test_schema_migration_v4_to_v5.py``.
        """
        from ado_git_repo_insights.persistence.migrations import (
            MIGRATIONS as _SOURCE_MIGRATIONS,
        )

        monkeypatch.setattr(
            "ado_git_repo_insights.persistence.database.MIGRATIONS",
            {k: v for k, v in _SOURCE_MIGRATIONS.items() if k < 5},
        )

    # v3 schema: v2 + comments_extracted_at column, version=3.
    # pr_threads still has thread_id TEXT PRIMARY KEY (single-column PK)
    # to trigger the v3→v4 rebuild.
    _V3_SCHEMA_SQL = """
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
        VALUES (3, datetime('now'));
    """

    def _create_v3_db(self, path: Path) -> sqlite3.Connection:
        """Create a v3 database with shared FK entities."""
        conn = sqlite3.connect(str(path))
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.executescript(self._V3_SCHEMA_SQL)
        conn.execute("INSERT INTO users (user_id, display_name) VALUES ('u1', 'Alice')")
        conn.execute("INSERT INTO users (user_id, display_name) VALUES ('u2', 'Bob')")
        conn.execute(
            "INSERT INTO repositories (repository_id, repository_name, "
            "project_name, organization_name) "
            "VALUES ('r1', 'repo', 'proj', 'org')"
        )
        conn.execute(
            "INSERT INTO pull_requests (pull_request_uid, pull_request_id, "
            "organization_name, project_name, repository_id, user_id, "
            "title, status, creation_date) "
            "VALUES ('r1-1', 1, 'org', 'proj', 'r1', 'u1', 'PR 1', "
            "'completed', '2026-01-15T10:00:00Z')"
        )
        conn.execute(
            "INSERT INTO pull_requests (pull_request_uid, pull_request_id, "
            "organization_name, project_name, repository_id, user_id, "
            "title, status, creation_date) "
            "VALUES ('r1-2', 2, 'org', 'proj', 'r1', 'u1', 'PR 2', "
            "'completed', '2026-01-16T10:00:00Z')"
        )
        return conn

    # -- F1: Dedup tests --
    # In v3, thread_id TEXT PRIMARY KEY prevents true duplicates within
    # the table. However, a recovered _pr_threads_v3 from an interrupted
    # migration may lack PK constraints, and defense-in-depth requires
    # the dedup to handle this. We test by creating _pr_threads_v3
    # directly (simulating stale artifact with duplicates).

    def test_duplicate_threads_keeps_newest_nondel(self, tmp_path: Path) -> None:
        """Newer deleted + older active: active row survives (is_deleted ASC).

        Simulates a stale _pr_threads_v3 artifact with duplicate
        (pull_request_uid, thread_id) rows — the recovery path renames
        it back to pr_threads, which then goes through the full rebuild
        with dedup.
        """
        db_path = tmp_path / "dedup_del.db"
        conn = self._create_v3_db(db_path)
        conn.execute("DROP TABLE pr_threads")

        # Create _pr_threads_v3 WITHOUT PK (simulates corrupted/recovered state).
        conn.execute(
            """
            CREATE TABLE _pr_threads_v3 (
                thread_id TEXT NOT NULL,
                pull_request_uid TEXT NOT NULL,
                status TEXT,
                thread_context TEXT,
                last_updated TEXT NOT NULL,
                created_at TEXT NOT NULL,
                is_deleted INTEGER DEFAULT 0
            )
            """
        )
        # Two rows same (pr_uid, thread_id): older active, newer deleted.
        conn.execute(
            "INSERT INTO _pr_threads_v3 VALUES "
            "('1', 'r1-1', 'active', NULL, "
            "'2026-01-16T00:00:00Z', '2026-01-15T12:00:00Z', 0)"
        )
        conn.execute(
            "INSERT INTO _pr_threads_v3 VALUES "
            "('1', 'r1-1', 'closed', NULL, "
            "'2026-01-17T00:00:00Z', '2026-01-15T12:00:00Z', 1)"
        )
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert db.get_schema_version() == 4

            rows = db.execute(
                "SELECT * FROM pr_threads "
                "WHERE pull_request_uid = 'r1-1' AND thread_id = '1'"
            ).fetchall()
            assert len(rows) == 1
            # Active (is_deleted=0) row kept, not the newer deleted one.
            assert rows[0]["is_deleted"] == 0
            assert rows[0]["status"] == "active"
        finally:
            db.close()

    def test_duplicate_threads_keeps_newest_when_both_active(
        self, tmp_path: Path
    ) -> None:
        """Two active rows with same composite key: newest last_updated wins."""
        db_path = tmp_path / "dedup_active.db"
        conn = self._create_v3_db(db_path)
        conn.execute("DROP TABLE pr_threads")

        conn.execute(
            """
            CREATE TABLE _pr_threads_v3 (
                thread_id TEXT NOT NULL,
                pull_request_uid TEXT NOT NULL,
                status TEXT,
                thread_context TEXT,
                last_updated TEXT NOT NULL,
                created_at TEXT NOT NULL,
                is_deleted INTEGER DEFAULT 0
            )
            """
        )
        conn.execute(
            "INSERT INTO _pr_threads_v3 VALUES "
            "('1', 'r1-1', 'active', NULL, "
            "'2026-01-16T00:00:00Z', '2026-01-15T12:00:00Z', 0)"
        )
        conn.execute(
            "INSERT INTO _pr_threads_v3 VALUES "
            "('1', 'r1-1', 'fixed', NULL, "
            "'2026-01-18T00:00:00Z', '2026-01-15T12:00:00Z', 0)"
        )
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        try:
            rows = db.execute(
                "SELECT * FROM pr_threads "
                "WHERE pull_request_uid = 'r1-1' AND thread_id = '1'"
            ).fetchall()
            assert len(rows) == 1
            # Newest last_updated wins.
            assert rows[0]["status"] == "fixed"
            assert rows[0]["last_updated"] == "2026-01-18T00:00:00Z"
        finally:
            db.close()

    def test_duplicate_comments_keeps_newest(self, tmp_path: Path) -> None:
        """Duplicate comment_id rows: newest non-deleted survives."""
        db_path = tmp_path / "dedup_comments.db"
        conn = self._create_v3_db(db_path)

        # Need a thread for FK context.
        conn.execute(
            "INSERT INTO pr_threads "
            "(thread_id, pull_request_uid, status, last_updated, created_at) "
            "VALUES ('1', 'r1-1', 'active', '2026-01-16T00:00:00Z', "
            "'2026-01-15T12:00:00Z')"
        )
        # Drop pr_comments and create _pr_comments_v3 without PK.
        conn.execute("DROP TABLE pr_comments")
        conn.execute(
            """
            CREATE TABLE _pr_comments_v3 (
                comment_id TEXT NOT NULL,
                thread_id TEXT NOT NULL,
                pull_request_uid TEXT NOT NULL,
                author_id TEXT NOT NULL,
                content TEXT,
                comment_type TEXT,
                created_at TEXT NOT NULL,
                last_updated TEXT,
                is_deleted INTEGER DEFAULT 0
            )
            """
        )
        conn.execute(
            "INSERT INTO _pr_comments_v3 VALUES "
            "('c1', '1', 'r1-1', 'u1', 'old content', 'text', "
            "'2026-01-16T01:00:00Z', '2026-01-16T01:00:00Z', 0)"
        )
        conn.execute(
            "INSERT INTO _pr_comments_v3 VALUES "
            "('c1', '1', 'r1-1', 'u1', 'new content', 'text', "
            "'2026-01-17T01:00:00Z', '2026-01-17T01:00:00Z', 0)"
        )
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        try:
            rows = db.execute(
                "SELECT * FROM pr_comments WHERE comment_id = 'c1'"
            ).fetchall()
            assert len(rows) == 1
            assert rows[0]["content"] == "new content"
            assert rows[0]["last_updated"] == "2026-01-17T01:00:00Z"
        finally:
            db.close()

    # -- F2: Stale artifact recovery tests --

    def test_stale_pr_threads_v3_recovered_then_normalized(
        self, tmp_path: Path
    ) -> None:
        """_pr_threads_v3 exists, pr_threads absent: recover then rebuild."""
        db_path = tmp_path / "stale_threads.db"
        conn = self._create_v3_db(db_path)

        conn.execute(
            "INSERT INTO pr_threads "
            "(thread_id, pull_request_uid, status, last_updated, created_at) "
            "VALUES ('1', 'r1-1', 'active', '2026-01-16T00:00:00Z', "
            "'2026-01-16T00:00:00Z')"
        )
        # Simulate interrupted migration: rename happened, but rebuild didn't.
        conn.execute("ALTER TABLE pr_threads RENAME TO _pr_threads_v3")
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert db.get_schema_version() == 4

            # Must have composite PK (not just recovered with old single PK).
            pk_info = db.execute("PRAGMA table_info(pr_threads)").fetchall()
            pk_cols = [row["name"] for row in pk_info if row["pk"] > 0]
            assert set(pk_cols) == {"pull_request_uid", "thread_id"}

            # Data preserved.
            row = db.execute(
                "SELECT * FROM pr_threads "
                "WHERE pull_request_uid = 'r1-1' AND thread_id = '1'"
            ).fetchone()
            assert row is not None
            assert row["status"] == "active"

            # Stale table cleaned up.
            assert not db.execute(
                "SELECT 1 FROM sqlite_master "
                "WHERE type='table' AND name='_pr_threads_v3'"
            ).fetchone()
        finally:
            db.close()

    def test_stale_pr_threads_v3_dropped_when_pr_threads_present(
        self, tmp_path: Path
    ) -> None:
        """Both pr_threads and _pr_threads_v3 exist: drop stale artifact."""
        db_path = tmp_path / "stale_both.db"
        conn = self._create_v3_db(db_path)

        conn.execute(
            "INSERT INTO pr_threads "
            "(thread_id, pull_request_uid, status, last_updated, created_at) "
            "VALUES ('1', 'r1-1', 'active', '2026-01-16T00:00:00Z', "
            "'2026-01-16T00:00:00Z')"
        )
        # Create stale artifact alongside existing table.
        conn.execute(
            "CREATE TABLE _pr_threads_v3 ("
            "  thread_id TEXT PRIMARY KEY, "
            "  pull_request_uid TEXT NOT NULL, "
            "  status TEXT, thread_context TEXT, "
            "  last_updated TEXT NOT NULL, "
            "  created_at TEXT NOT NULL, "
            "  is_deleted INTEGER DEFAULT 0"
            ")"
        )
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert db.get_schema_version() == 4
            # Stale artifact must be gone.
            assert not db.execute(
                "SELECT 1 FROM sqlite_master "
                "WHERE type='table' AND name='_pr_threads_v3'"
            ).fetchone()
            # Original data preserved.
            assert db.execute(
                "SELECT 1 FROM pr_threads "
                "WHERE pull_request_uid = 'r1-1' AND thread_id = '1'"
            ).fetchone()
        finally:
            db.close()

    def test_stale_pr_comments_v3_recovered_then_normalized(
        self, tmp_path: Path
    ) -> None:
        """_pr_comments_v3 exists, pr_comments absent: recover then rebuild."""
        db_path = tmp_path / "stale_comments.db"
        conn = self._create_v3_db(db_path)

        conn.execute(
            "INSERT INTO pr_threads "
            "(thread_id, pull_request_uid, status, last_updated, created_at) "
            "VALUES ('1', 'r1-1', 'active', '2026-01-16T00:00:00Z', "
            "'2026-01-16T00:00:00Z')"
        )
        conn.execute(
            "INSERT INTO pr_comments "
            "(comment_id, thread_id, pull_request_uid, author_id, "
            "content, comment_type, created_at) "
            "VALUES ('c1', '1', 'r1-1', 'u1', 'LGTM', 'text', "
            "'2026-01-16T01:00:00Z')"
        )
        # Simulate interrupted migration on comments only.
        conn.execute("ALTER TABLE pr_comments RENAME TO _pr_comments_v3")
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert db.get_schema_version() == 4

            # FK must reference composite PK.
            fk_info = db.execute("PRAGMA foreign_key_list(pr_comments)").fetchall()
            thread_fk_cols = [
                row["to"] for row in fk_info if row["table"] == "pr_threads"
            ]
            assert "pull_request_uid" in thread_fk_cols
            assert "thread_id" in thread_fk_cols

            # Data preserved.
            assert db.execute(
                "SELECT 1 FROM pr_comments WHERE comment_id = 'c1'"
            ).fetchone()

            # Stale table gone.
            assert not db.execute(
                "SELECT 1 FROM sqlite_master "
                "WHERE type='table' AND name='_pr_comments_v3'"
            ).fetchone()
        finally:
            db.close()

    def test_stale_pr_comments_v3_dropped_when_pr_comments_present(
        self, tmp_path: Path
    ) -> None:
        """Both pr_comments and _pr_comments_v3 exist: drop stale artifact."""
        db_path = tmp_path / "stale_both_comments.db"
        conn = self._create_v3_db(db_path)

        conn.execute(
            "INSERT INTO pr_threads "
            "(thread_id, pull_request_uid, status, last_updated, created_at) "
            "VALUES ('1', 'r1-1', 'active', '2026-01-16T00:00:00Z', "
            "'2026-01-16T00:00:00Z')"
        )
        conn.execute(
            "INSERT INTO pr_comments "
            "(comment_id, thread_id, pull_request_uid, author_id, "
            "content, comment_type, created_at) "
            "VALUES ('c1', '1', 'r1-1', 'u1', 'LGTM', 'text', "
            "'2026-01-16T01:00:00Z')"
        )
        conn.execute(
            "CREATE TABLE _pr_comments_v3 ("
            "  comment_id TEXT PRIMARY KEY, "
            "  thread_id TEXT NOT NULL, "
            "  pull_request_uid TEXT NOT NULL, "
            "  author_id TEXT NOT NULL, "
            "  content TEXT, comment_type TEXT, "
            "  created_at TEXT NOT NULL, "
            "  last_updated TEXT, "
            "  is_deleted INTEGER DEFAULT 0"
            ")"
        )
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert db.get_schema_version() == 4
            assert not db.execute(
                "SELECT 1 FROM sqlite_master "
                "WHERE type='table' AND name='_pr_comments_v3'"
            ).fetchone()
            assert db.execute(
                "SELECT 1 FROM pr_comments WHERE comment_id = 'c1'"
            ).fetchone()
        finally:
            db.close()

    # -- F3: FK validation test --

    def test_fk_validation_detects_separate_single_column_fks(
        self, tmp_path: Path
    ) -> None:
        """Two separate single-column FKs to pr_threads (not composite): rebuild.

        This is the gap the flat-list check missed — both column names appear
        in PRAGMA foreign_key_list but belong to different constraints.
        """
        db_path = tmp_path / "separate_fks.db"
        conn = self._create_v3_db(db_path)

        conn.execute(
            "INSERT INTO pr_threads "
            "(thread_id, pull_request_uid, status, last_updated, created_at) "
            "VALUES ('1', 'r1-1', 'active', '2026-01-16T00:00:00Z', "
            "'2026-01-16T00:00:00Z')"
        )
        # Drop existing pr_comments (single PK, no FK) and create one
        # with two separate single-column FKs to pr_threads.
        conn.execute("DROP TABLE pr_comments")
        conn.execute(
            """
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
                FOREIGN KEY (pull_request_uid)
                    REFERENCES pr_threads(pull_request_uid),
                FOREIGN KEY (thread_id)
                    REFERENCES pr_threads(thread_id)
            )
            """
        )
        conn.execute(
            "INSERT INTO pr_comments "
            "(comment_id, thread_id, pull_request_uid, author_id, "
            "content, comment_type, created_at) "
            "VALUES ('c1', '1', 'r1-1', 'u1', 'LGTM', 'text', "
            "'2026-01-16T01:00:00Z')"
        )
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert db.get_schema_version() == 4

            # After migration, FK must be a single composite constraint.
            fk_info = db.execute("PRAGMA foreign_key_list(pr_comments)").fetchall()
            # Group by constraint id to verify single composite FK.
            from collections import defaultdict

            fk_groups: dict[int, set[str]] = defaultdict(set)
            for row in fk_info:
                if row["table"] == "pr_threads":
                    fk_groups[row["id"]].add(row["to"])
            composite = [
                cols
                for cols in fk_groups.values()
                if cols == {"pull_request_uid", "thread_id"}
            ]
            assert len(composite) == 1, (
                "Expected exactly one composite FK to pr_threads"
            )

            # Data preserved.
            assert db.execute(
                "SELECT 1 FROM pr_comments WHERE comment_id = 'c1'"
            ).fetchone()
        finally:
            db.close()

    # -- Orphan warning test --

    def test_orphaned_comments_after_thread_dedup_warning(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Comment referencing nonexistent thread after rebuild → warning."""
        db_path = tmp_path / "orphan.db"
        conn = self._create_v3_db(db_path)

        # Thread exists for (r1-1, '1').
        conn.execute(
            "INSERT INTO pr_threads "
            "(thread_id, pull_request_uid, status, last_updated, created_at) "
            "VALUES ('1', 'r1-1', 'active', '2026-01-16T00:00:00Z', "
            "'2026-01-16T00:00:00Z')"
        )
        # Comment references (r1-1, '99') — a thread that doesn't exist.
        # After rebuild the orphan check should detect this.
        conn.execute(
            "INSERT INTO pr_comments "
            "(comment_id, thread_id, pull_request_uid, author_id, "
            "content, comment_type, created_at) "
            "VALUES ('c_orphan', '99', 'r1-1', 'u1', 'orphan', 'text', "
            "'2026-01-16T01:00:00Z')"
        )
        conn.commit()
        conn.close()

        with caplog.at_level(logging.WARNING):
            db = DatabaseManager(db_path)
            db.connect()
        try:
            assert db.get_schema_version() == 4
            assert any(
                "pr_comments rows reference threads removed" in msg
                for msg in caplog.messages
            )
        finally:
            db.close()

    # -- Integration test --

    def test_integrated_dedup_recovery_fk_rebuild(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Full integration: stale artifacts + duplicates + FK rebuild.

        Validates that a single migrate_v3_to_v4() call handles all three
        scenarios together: recovery, dedup, and FK validation.
        """
        db_path = tmp_path / "integrated.db"
        conn = self._create_v3_db(db_path)

        # Drop the PK-constrained tables and create stale artifacts with dups.
        conn.execute("DROP TABLE pr_comments")
        conn.execute("DROP TABLE pr_threads")

        # Stale _pr_threads_v3 with duplicate (r1-1, '1') rows.
        conn.execute(
            """
            CREATE TABLE _pr_threads_v3 (
                thread_id TEXT NOT NULL,
                pull_request_uid TEXT NOT NULL,
                status TEXT,
                thread_context TEXT,
                last_updated TEXT NOT NULL,
                created_at TEXT NOT NULL,
                is_deleted INTEGER DEFAULT 0
            )
            """
        )
        conn.execute(
            "INSERT INTO _pr_threads_v3 VALUES "
            "('1', 'r1-1', 'active', NULL, "
            "'2026-01-18T00:00:00Z', '2026-01-15T12:00:00Z', 0)"
        )
        conn.execute(
            "INSERT INTO _pr_threads_v3 VALUES "
            "('1', 'r1-1', 'closed', NULL, "
            "'2026-01-16T00:00:00Z', '2026-01-15T12:00:00Z', 1)"
        )

        # Stale _pr_comments_v3 with a valid comment.
        conn.execute(
            """
            CREATE TABLE _pr_comments_v3 (
                comment_id TEXT NOT NULL,
                thread_id TEXT NOT NULL,
                pull_request_uid TEXT NOT NULL,
                author_id TEXT NOT NULL,
                content TEXT,
                comment_type TEXT,
                created_at TEXT NOT NULL,
                last_updated TEXT,
                is_deleted INTEGER DEFAULT 0
            )
            """
        )
        conn.execute(
            "INSERT INTO _pr_comments_v3 VALUES "
            "('c1', '1', 'r1-1', 'u1', 'LGTM', 'text', "
            "'2026-01-16T01:00:00Z', NULL, 0)"
        )
        conn.commit()
        conn.close()

        with caplog.at_level(logging.WARNING):
            db = DatabaseManager(db_path)
            db.connect()
        try:
            assert db.get_schema_version() == 4

            # Composite PK on pr_threads.
            pk_info = db.execute("PRAGMA table_info(pr_threads)").fetchall()
            pk_cols = [row["name"] for row in pk_info if row["pk"] > 0]
            assert set(pk_cols) == {"pull_request_uid", "thread_id"}

            # Dedup: only one thread row for (r1-1, '1').
            thread_rows = db.execute(
                "SELECT * FROM pr_threads "
                "WHERE pull_request_uid = 'r1-1' AND thread_id = '1'"
            ).fetchall()
            assert len(thread_rows) == 1
            assert thread_rows[0]["is_deleted"] == 0  # Non-deleted won

            # Comment preserved.
            assert db.execute(
                "SELECT 1 FROM pr_comments WHERE comment_id = 'c1'"
            ).fetchone()

            # Stale artifacts cleaned up.
            assert not db.execute(
                "SELECT 1 FROM sqlite_master "
                "WHERE type='table' AND name='_pr_threads_v3'"
            ).fetchone()
            assert not db.execute(
                "SELECT 1 FROM sqlite_master "
                "WHERE type='table' AND name='_pr_comments_v3'"
            ).fetchone()

            # Composite FK on pr_comments.
            fk_info = db.execute("PRAGMA foreign_key_list(pr_comments)").fetchall()
            from collections import defaultdict

            fk_groups: dict[int, set[str]] = defaultdict(set)
            for row in fk_info:
                if row["table"] == "pr_threads":
                    fk_groups[row["id"]].add(row["to"])
            assert any(
                cols == {"pull_request_uid", "thread_id"} for cols in fk_groups.values()
            )

            # Dedup warning logged.
            assert any("duplicate" in msg.lower() for msg in caplog.messages)
            # Stale artifact warning logged.
            assert any("stale" in msg.lower() for msg in caplog.messages)
        finally:
            db.close()

    # -- End-to-end: migration → aggregation → coverage --

    def test_migrate_then_aggregate_coverage_consistent(self, tmp_path: Path) -> None:
        """v3 DB → migrate v4 → _get_comments_coverage → consistent status."""
        db_path = tmp_path / "e2e.db"
        conn = self._create_v3_db(db_path)

        # PR r1-1 has threads and comments_extracted_at set.
        conn.execute(
            "UPDATE pull_requests SET comments_extracted_at = "
            "'2026-01-20T00:00:00Z' WHERE pull_request_uid = 'r1-1'"
        )
        conn.execute(
            "INSERT INTO pr_threads "
            "(thread_id, pull_request_uid, status, last_updated, created_at) "
            "VALUES ('1', 'r1-1', 'active', '2026-01-16T00:00:00Z', "
            "'2026-01-16T00:00:00Z')"
        )
        conn.execute(
            "INSERT INTO pr_comments "
            "(comment_id, thread_id, pull_request_uid, author_id, "
            "content, comment_type, created_at) "
            "VALUES ('c1', '1', 'r1-1', 'u1', 'LGTM', 'text', "
            "'2026-01-16T01:00:00Z')"
        )
        # PR r1-2 has no comments_extracted_at → partial coverage.
        conn.execute(
            "INSERT INTO comments_extraction_metadata "
            "(id, last_run_timestamp, prs_processed, threads_fetched, "
            "comments_fetched, capped) "
            "VALUES (1, '2026-01-20T00:00:00Z', 1, 1, 1, 0)"
        )
        conn.commit()
        conn.close()

        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert db.get_schema_version() == 4

            from ado_git_repo_insights.transform.aggregators import (
                AggregateGenerator,
            )

            output = tmp_path / "output"
            gen = AggregateGenerator(db, output)
            coverage = gen._get_comments_coverage()

            # r1-1 is stamped, r1-2 is not → partial.
            assert coverage["status"] == "partial"
            assert coverage["threads_fetched"] == 1
            assert coverage["comments_fetched"] == 1
        finally:
            db.close()

    def test_partial_v4_with_missing_indexes_recovers(self, tmp_path: Path) -> None:
        """v4 tables with correct PK/FK but missing indexes get indexes on rerun.

        Regression: the structural fast-path (already composite PK/FK)
        returned before creating indexes, leaving partially recovered
        databases in a slower and inconsistent state.
        """
        db_path = tmp_path / "partial_v4.db"
        conn = self._create_v3_db(db_path)

        # Build v4-shaped tables manually WITHOUT indexes.
        conn.execute("DROP TABLE pr_comments")
        conn.execute("DROP TABLE pr_threads")
        conn.execute(
            """
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
            )
            """
        )
        conn.execute(
            """
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
            )
            """
        )
        # NO indexes created — simulates interrupted migration after table
        # creation but before index creation.
        conn.commit()
        conn.close()

        # Open with DatabaseManager to trigger v3→v4 migration.
        db = DatabaseManager(db_path)
        db.connect()
        try:
            assert db.get_schema_version() == 4

            # All four required indexes must now exist.
            indexes = db.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='index' AND name NOT LIKE 'sqlite_autoindex_%'"
            ).fetchall()
            index_names = {row["name"] for row in indexes}
            required = {
                "idx_pr_threads_updated",
                "idx_pr_comments_thread",
                "idx_pr_comments_pr",
                "idx_pr_comments_author",
            }
            assert required.issubset(index_names), (
                f"Missing indexes: {required - index_names}"
            )
        finally:
            db.close()


class TestColumnExistsValidation:
    """F5: _column_exists must reject non-identifier table/column names."""

    def test_rejects_injection_in_table(self, tmp_path: Path) -> None:
        from ado_git_repo_insights.persistence.migrations import _column_exists

        conn = sqlite3.connect(str(tmp_path / "test.db"))
        with pytest.raises(ValueError, match="Invalid table identifier"):
            _column_exists(conn, "users; DROP TABLE users", "user_id")
        conn.close()

    def test_rejects_injection_in_column(self, tmp_path: Path) -> None:
        from ado_git_repo_insights.persistence.migrations import _column_exists

        conn = sqlite3.connect(str(tmp_path / "test.db"))
        with pytest.raises(ValueError, match="Invalid column identifier"):
            _column_exists(conn, "users", "user_id; DROP TABLE users")
        conn.close()

    def test_accepts_valid_identifiers(self, tmp_path: Path) -> None:
        from ado_git_repo_insights.persistence.migrations import _column_exists

        conn = sqlite3.connect(str(tmp_path / "test.db"))
        conn.execute("CREATE TABLE users (user_id TEXT PRIMARY KEY)")
        assert _column_exists(conn, "users", "user_id") is True
        assert _column_exists(conn, "users", "nonexistent") is False
        conn.close()

    def test_rejects_empty_table_name(self, tmp_path: Path) -> None:
        from ado_git_repo_insights.persistence.migrations import _column_exists

        conn = sqlite3.connect(str(tmp_path / "test.db"))
        with pytest.raises(ValueError, match="Invalid table identifier"):
            _column_exists(conn, "", "user_id")
        conn.close()


# ---------------------------------------------------------------------------
# F4: Index parity between fresh install and migrated DB
# ---------------------------------------------------------------------------


def _get_user_indexes(path: Path) -> set[tuple[str, str, str]]:
    """Get all user-created indexes as (name, table, normalized_sql) tuples.

    Excludes autoindexes created by SQLite for PRIMARY KEY / UNIQUE
    constraints.  The SQL is normalized (lowercased, whitespace collapsed)
    so comparisons are deterministic across SQLite versions.
    """
    conn = sqlite3.connect(str(path))
    rows = conn.execute(
        "SELECT name, tbl_name, sql FROM sqlite_master "
        "WHERE type='index' AND name NOT LIKE 'sqlite_autoindex_%' "
        "AND sql IS NOT NULL"
    ).fetchall()
    conn.close()
    result: set[tuple[str, str, str]] = set()
    for row in rows:
        name: str = row[0]
        tbl_name: str = row[1]
        raw_sql: str = row[2]
        normalized = " ".join(raw_sql.lower().split())
        result.add((name, tbl_name, normalized))
    return result


class TestIndexParity:
    """F4: Fresh install and migrated DB must produce identical indexes
    on the tables affected by the v3→v4 migration (pr_threads, pr_comments).
    """

    _MIGRATION_TABLES = {"pr_threads", "pr_comments"}

    @staticmethod
    def _filter_migration_indexes(
        indexes: set[tuple[str, str, str]],
    ) -> set[tuple[str, str, str]]:
        return {
            (name, tbl, sql)
            for name, tbl, sql in indexes
            if tbl in TestIndexParity._MIGRATION_TABLES
        }

    def test_fresh_and_migrated_v1_produce_same_thread_comment_indexes(
        self, tmp_path: Path
    ) -> None:
        """v1 → v4 migrated DB has same pr_threads/pr_comments indexes as fresh."""
        fresh_path = tmp_path / "fresh.db"
        fresh_db = DatabaseManager(fresh_path)
        fresh_db.connect()
        fresh_db.close()

        migrated_path = tmp_path / "migrated.db"
        _create_v1_database(migrated_path)
        migrated_db = DatabaseManager(migrated_path)
        migrated_db.connect()
        migrated_db.close()

        fresh = self._filter_migration_indexes(_get_user_indexes(fresh_path))
        migrated = self._filter_migration_indexes(_get_user_indexes(migrated_path))
        assert fresh == migrated, (
            f"Index mismatch on pr_threads/pr_comments:\n"
            f"  Fresh only: {fresh - migrated}\n"
            f"  Migrated only: {migrated - fresh}"
        )

    def test_fresh_and_migrated_v2_produce_same_thread_comment_indexes(
        self, tmp_path: Path
    ) -> None:
        """v2 → v4 migrated DB (with old pr_threads/pr_comments) matches fresh."""
        fresh_path = tmp_path / "fresh.db"
        fresh_db = DatabaseManager(fresh_path)
        fresh_db.connect()
        fresh_db.close()

        migrated_path = tmp_path / "migrated_v2.db"
        # Use the v3 test class schema (inherits v2 structure + comments_extracted_at).
        # Since v3→v4 is the only remaining migration, this exercises the same
        # rebuild path and index creation as a v2→v3→v4 migration.
        conn = sqlite3.connect(str(migrated_path))
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.executescript(TestMigrationV3ToV4DedupAndRecovery._V3_SCHEMA_SQL)
        conn.execute("INSERT INTO users (user_id, display_name) VALUES ('u1', 'Alice')")
        conn.execute(
            "INSERT INTO repositories (repository_id, repository_name, "
            "project_name, organization_name) "
            "VALUES ('r1', 'repo', 'proj', 'org')"
        )
        conn.commit()
        conn.close()
        migrated_db = DatabaseManager(migrated_path)
        migrated_db.connect()
        migrated_db.close()

        fresh = self._filter_migration_indexes(_get_user_indexes(fresh_path))
        migrated = self._filter_migration_indexes(_get_user_indexes(migrated_path))
        assert fresh == migrated, (
            f"Index mismatch on pr_threads/pr_comments:\n"
            f"  Fresh only: {fresh - migrated}\n"
            f"  Migrated only: {migrated - fresh}"
        )
