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

    # Backfill: any completed PR that already has rows in pr_threads was
    # clearly processed by a prior extraction run.  Stamp it with the
    # last_run_timestamp from comments_extraction_metadata so it counts as
    # covered without requiring a fresh extraction.
    try:
        meta_row = conn.execute(
            "SELECT last_run_timestamp FROM comments_extraction_metadata WHERE id = 1"
        ).fetchone()
    except Exception:
        meta_row = None

    if meta_row is not None:
        stamp = (
            meta_row[0]
            if isinstance(meta_row, tuple)
            else meta_row["last_run_timestamp"]
        )
        conn.execute(
            "UPDATE pull_requests SET comments_extracted_at = ? "
            "WHERE comments_extracted_at IS NULL "
            "AND pull_request_uid IN "
            "(SELECT DISTINCT pull_request_uid FROM pr_threads)",
            (stamp,),
        )
        logger.info("Backfilled comments_extracted_at from existing pr_threads data")

    conn.execute(
        "INSERT OR IGNORE INTO schema_version (version, applied_at) "
        "VALUES (3, datetime('now'))"
    )
    logger.info("Applied migration v2 → v3")


# Version-keyed migration registry.  Keys are the *target* version;
# the function upgrades from (key - 1) -> key.
MIGRATIONS: dict[int, Callable[[Connection], None]] = {
    2: migrate_v1_to_v2,
    3: migrate_v2_to_v3,
}
