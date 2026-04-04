"""Schema migration functions for SQLite database versioning.

Each migration is a function that takes a sqlite3.Connection and applies
the schema changes needed to advance from one version to the next.
Migrations are idempotent — re-running a migration on a database that
already has the target version is a no-op.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlite3 import Connection

logger = logging.getLogger(__name__)


def migrate_v1_to_v2(conn: Connection) -> None:
    """Add review_time columns to reviewers and pull_requests tables.

    Schema v1 → v2:
    - reviewers: add ``reviewed_at TEXT`` (ISO 8601 vote timestamp)
    - pull_requests: add ``review_time_minutes REAL`` (earliest approval − creation_date)

    Existing rows receive NULL defaults automatically (SQLite ADD COLUMN behaviour).
    """
    cursor = conn.cursor()
    cursor.execute("BEGIN TRANSACTION")
    try:
        cursor.execute("ALTER TABLE reviewers ADD COLUMN reviewed_at TEXT")
        cursor.execute("ALTER TABLE pull_requests ADD COLUMN review_time_minutes REAL")
        cursor.execute(
            "INSERT OR IGNORE INTO schema_version (version, applied_at) "
            "VALUES (2, datetime('now'))"
        )
        conn.commit()
        logger.info(
            "Applied migration v1 → v2: added reviewed_at + review_time_minutes"
        )
    except Exception:
        conn.rollback()
        raise


# Version-keyed migration registry.  Keys are the *target* version;
# the function upgrades from (key - 1) -> key.
MIGRATIONS: dict[int, Callable[[Connection], None]] = {
    2: migrate_v1_to_v2,
}
