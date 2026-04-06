"""Schema migration functions for SQLite database versioning.

Each migration is a function that takes a sqlite3.Connection and applies
the schema changes needed to advance from one version to the next.
Migrations are idempotent — re-running a migration on a database that
already has the target version is a no-op (checked by _apply_migrations
in database.py via get_schema_version).

DDL statements (ALTER TABLE) run under autocommit — the database connection
uses isolation_level=None, so each statement commits immediately.  This is
safe for ADD COLUMN which is atomic in SQLite.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlite3 import Connection

logger = logging.getLogger(__name__)


def _column_exists(conn: Connection, table: str, column: str) -> bool:
    """Check whether *column* already exists on *table* via PRAGMA."""
    cursor = conn.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cursor.fetchall())


def migrate_v1_to_v2(conn: Connection) -> None:
    """Add review_time columns to reviewers and pull_requests tables.

    Schema v1 → v2:
    - reviewers: add ``reviewed_at TEXT`` (ISO 8601 vote timestamp)
    - pull_requests: add ``review_time_minutes REAL`` (earliest approval − creation_date)

    Existing rows receive NULL defaults automatically (SQLite ADD COLUMN behaviour).
    Idempotent: skips ADD COLUMN if the column already exists (handles partial
    migration from a previous interrupted run).
    """
    if not _column_exists(conn, "reviewers", "reviewed_at"):
        conn.execute("ALTER TABLE reviewers ADD COLUMN reviewed_at TEXT")
        logger.info("Added column reviewers.reviewed_at")

    if not _column_exists(conn, "pull_requests", "review_time_minutes"):
        conn.execute("ALTER TABLE pull_requests ADD COLUMN review_time_minutes REAL")
        logger.info("Added column pull_requests.review_time_minutes")

    conn.execute(
        "INSERT OR IGNORE INTO schema_version (version, applied_at) "
        "VALUES (2, datetime('now'))"
    )
    logger.info("Applied migration v1 → v2")


def migrate_v2_to_v3(conn: Connection) -> None:
    """Add per-PR comment extraction marker to pull_requests table.

    Schema v2 → v3:
    - pull_requests: add ``comments_extracted_at TEXT`` (ISO 8601 timestamp set
      when the comment extractor processes a PR, even if zero threads are found)

    This column enables dataset-level coverage calculation that is monotonic
    across incremental extraction runs — unlike the batch-scoped
    ``comments_extraction_metadata.prs_processed`` which only records the most
    recent run.

    For databases that already have pr_threads data from prior extraction runs,
    we backfill comments_extracted_at from the extraction metadata timestamp so
    that coverage is not incorrectly downgraded after the migration.
    """
    if not _column_exists(conn, "pull_requests", "comments_extracted_at"):
        conn.execute("ALTER TABLE pull_requests ADD COLUMN comments_extracted_at TEXT")
        logger.info("Added column pull_requests.comments_extracted_at")

    # Backfill: evidence-based only.
    #
    # In a v2 database we cannot distinguish a PR that was successfully
    # visited but had zero threads from one that failed due to an API error
    # — neither leaves rows in pr_threads.  Batch-level metadata (capped,
    # prs_processed) is insufficient because API failures within an
    # uncapped run still leave gaps.
    #
    # Strategy: stamp only PRs with concrete evidence of processing
    # (rows in pr_threads or pr_comments).  This may temporarily
    # understate coverage for zero-thread PRs, but one subsequent
    # --include-comments run will stamp all successfully processed PRs
    # and coverage converges to the correct value.
    #
    # Preferring understatement over overstatement avoids marking
    # API-failed PRs as covered, which would be a data integrity bug.
    # Determine the best available timestamp for the backfill stamp.
    # Prefer the metadata row's last_run_timestamp when present; fall
    # back to the latest evidence timestamp from pr_threads/pr_comments
    # so that provably covered PRs are never left unmarked just because
    # the metadata row is missing or unreadable.
    stamp: str | None = None

    try:
        meta_row = conn.execute(
            "SELECT last_run_timestamp FROM comments_extraction_metadata WHERE id = 1"
        ).fetchone()
        if meta_row is not None:
            stamp = (
                meta_row[0]
                if isinstance(meta_row, tuple)
                else meta_row["last_run_timestamp"]
            )
    except Exception as exc:
        logger.debug("comments_extraction_metadata not readable: %s", exc)

    if stamp is None:
        # No metadata — derive timestamp from the latest evidence row.
        try:
            evidence_row = conn.execute(
                "SELECT MAX(ts) AS latest FROM ("
                "  SELECT MAX(created_at) AS ts FROM pr_threads "
                "  UNION ALL "
                "  SELECT MAX(created_at) AS ts FROM pr_comments"
                ")"
            ).fetchone()
            if evidence_row is not None:
                raw = (
                    evidence_row[0]
                    if isinstance(evidence_row, tuple)
                    else evidence_row["latest"]
                )
                if isinstance(raw, str) and raw:
                    stamp = raw
        except Exception as exc:
            logger.debug("Evidence timestamp query failed: %s", exc)

    if stamp is None:
        logger.info(
            "No extraction metadata or evidence timestamps — "
            "skipping comments_extracted_at backfill"
        )
    else:
        conn.execute(
            "UPDATE pull_requests SET comments_extracted_at = ? "
            "WHERE comments_extracted_at IS NULL "
            "AND pull_request_uid IN ("
            "  SELECT DISTINCT pull_request_uid FROM pr_threads "
            "  UNION "
            "  SELECT DISTINCT pull_request_uid FROM pr_comments"
            ")",
            (stamp,),
        )
        logger.info("Backfilled comments_extracted_at from evidence")

    conn.execute(
        "INSERT OR IGNORE INTO schema_version (version, applied_at) "
        "VALUES (3, datetime('now'))"
    )
    logger.info("Applied migration v2 → v3")


def migrate_v3_to_v4(conn: Connection) -> None:
    """Change pr_threads primary key from thread_id to (pull_request_uid, thread_id).

    Schema v3 → v4:
    ADO thread IDs are PR-scoped integers (1, 2, 3, …), not globally
    unique.  The v3 schema used ``thread_id TEXT PRIMARY KEY`` which
    could collide across PRs.  This migration rebuilds the table with
    a composite primary key and updates the pr_comments foreign key.

    Each table is handled independently: either rebuilt from its old
    copy (if present) or created fresh (if absent).  This ensures the
    migration succeeds on partial schemas (e.g. pr_threads exists but
    pr_comments was never created due to an interrupted rollout).
    """
    _ensure_v4_pr_threads(conn)
    _ensure_v4_pr_comments(conn)

    conn.execute(
        "INSERT OR IGNORE INTO schema_version (version, applied_at) "
        "VALUES (4, datetime('now'))"
    )
    logger.info("Applied migration v3 → v4: PR-scoped thread identity")


# -- v4 table helpers (called by migrate_v3_to_v4) --

_V4_PR_THREADS_DDL = """
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

_V4_PR_COMMENTS_DDL = """
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


def _table_exists(conn: Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (name,),
    ).fetchone()
    return row is not None


def _ensure_v4_pr_threads(conn: Connection) -> None:
    """Ensure pr_threads has composite PK (pull_request_uid, thread_id)."""
    if not _table_exists(conn, "pr_threads"):
        conn.execute(_V4_PR_THREADS_DDL)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_pr_threads_updated "
            "ON pr_threads(last_updated)"
        )
        logger.info("Created pr_threads with composite PK (was absent)")
        return

    pk_info = conn.execute("PRAGMA table_info(pr_threads)").fetchall()
    pk_cols = [row[1] for row in pk_info if row[5] > 0]
    if len(pk_cols) > 1:
        return  # Already composite

    conn.execute("ALTER TABLE pr_threads RENAME TO _pr_threads_v3")
    conn.execute(_V4_PR_THREADS_DDL)
    conn.execute(
        """
        INSERT OR IGNORE INTO pr_threads
            (thread_id, pull_request_uid, status, thread_context,
             last_updated, created_at, is_deleted)
        SELECT thread_id, pull_request_uid, status, thread_context,
               last_updated, created_at, is_deleted
        FROM _pr_threads_v3
        """
    )
    conn.execute("DROP TABLE _pr_threads_v3")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pr_threads_updated ON pr_threads(last_updated)"
    )
    logger.info("Rebuilt pr_threads with composite PK")


def _ensure_v4_pr_comments(conn: Connection) -> None:
    """Ensure pr_comments references composite FK on pr_threads."""
    if not _table_exists(conn, "pr_comments"):
        conn.execute(_V4_PR_COMMENTS_DDL)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_pr_comments_thread "
            "ON pr_comments(pull_request_uid, thread_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_pr_comments_pr "
            "ON pr_comments(pull_request_uid)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_pr_comments_author "
            "ON pr_comments(author_id)"
        )
        logger.info("Created pr_comments with composite FK (was absent)")
        return

    # Check if the FK already references the composite PK by inspecting
    # the foreign_key_list pragma.  If the FK target is already
    # (pull_request_uid, thread_id), skip rebuild.
    fk_info = conn.execute("PRAGMA foreign_key_list(pr_comments)").fetchall()
    thread_fk_targets = [
        row[4]
        for row in fk_info
        if row[2] == "pr_threads"  # col 4 = to-column
    ]
    if "pull_request_uid" in thread_fk_targets and "thread_id" in thread_fk_targets:
        return  # Already has composite FK

    conn.execute("ALTER TABLE pr_comments RENAME TO _pr_comments_v3")
    conn.execute(_V4_PR_COMMENTS_DDL)
    conn.execute(
        """
        INSERT OR IGNORE INTO pr_comments
            (comment_id, thread_id, pull_request_uid, author_id,
             content, comment_type, created_at, last_updated, is_deleted)
        SELECT comment_id, thread_id, pull_request_uid, author_id,
               content, comment_type, created_at, last_updated, is_deleted
        FROM _pr_comments_v3
        """
    )
    conn.execute("DROP TABLE _pr_comments_v3")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pr_comments_thread "
        "ON pr_comments(pull_request_uid, thread_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pr_comments_pr ON pr_comments(pull_request_uid)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pr_comments_author ON pr_comments(author_id)"
    )
    logger.info("Rebuilt pr_comments with composite FK")


# Version-keyed migration registry.  Keys are the *target* version;
# the function upgrades from (key - 1) -> key.
MIGRATIONS: dict[int, Callable[[Connection], None]] = {
    2: migrate_v1_to_v2,
    3: migrate_v2_to_v3,
    4: migrate_v3_to_v4,
}
