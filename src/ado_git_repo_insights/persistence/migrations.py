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
import re
from collections import defaultdict
from collections.abc import Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlite3 import Connection

logger = logging.getLogger(__name__)

# Valid SQL identifier: starts with letter/underscore, contains only
# alphanumerics and underscores.  Used to guard f-string PRAGMA queries
# against injection — PRAGMA does not support parameterized identifiers.
_IDENTIFIER_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def _column_exists(conn: Connection, table: str, column: str) -> bool:
    """Check whether *column* already exists on *table* via PRAGMA.

    Raises ``ValueError`` if *table* or *column* is not a valid SQL
    identifier.  PRAGMA queries do not support parameterized identifiers,
    so the names must be validated before interpolation.
    """
    if not _IDENTIFIER_RE.match(table):
        raise ValueError(f"Invalid table identifier: {table!r}")
    if not _IDENTIFIER_RE.match(column):
        raise ValueError(f"Invalid column identifier: {column!r}")
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

    FK enforcement is disabled during the rebuild because SQLite renames
    update FK targets — dropping the old table would fail if another
    table already references it via a FK constraint.
    """
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        _ensure_v4_pr_threads(conn)
        _ensure_v4_pr_comments(conn)
    finally:
        conn.execute("PRAGMA foreign_keys = ON")

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


def _ensure_pr_threads_indexes(conn: Connection) -> None:
    """Create required pr_threads indexes if missing (idempotent)."""
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pr_threads_updated ON pr_threads(last_updated)"
    )


def _ensure_pr_comments_indexes(conn: Connection) -> None:
    """Create required pr_comments indexes if missing (idempotent)."""
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


def _ensure_v4_pr_threads(conn: Connection) -> None:
    """Ensure pr_threads has composite PK (pull_request_uid, thread_id).

    Handles three recovery scenarios beyond normal migration:
    - Stale ``_pr_threads_v3`` from an interrupted prior run
    - Duplicate ``(pull_request_uid, thread_id)`` rows (v3 single-PK collision)
    - Recovered table that needs full rebuild (never trusted as-is)
    """
    # -- Stale artifact cleanup (F2) --
    # A prior interrupted migration may have left _pr_threads_v3 behind.
    # Recover or discard it, then fall through to the normal rebuild path.
    if _table_exists(conn, "_pr_threads_v3"):
        if not _table_exists(conn, "pr_threads"):
            conn.execute("ALTER TABLE _pr_threads_v3 RENAME TO pr_threads")
            logger.warning(
                "Recovered stale _pr_threads_v3 → pr_threads "
                "(prior migration interrupted before rebuild)"
            )
            # Fall through — recovered table still needs composite-PK rebuild.
        else:
            conn.execute("DROP TABLE _pr_threads_v3")
            logger.warning(
                "Dropped stale _pr_threads_v3 "
                "(prior migration completed but cleanup was interrupted)"
            )

    if not _table_exists(conn, "pr_threads"):
        conn.execute(_V4_PR_THREADS_DDL)
        _ensure_pr_threads_indexes(conn)
        logger.info("Created pr_threads with composite PK (was absent)")
        return

    pk_info = conn.execute("PRAGMA table_info(pr_threads)").fetchall()
    pk_cols = [row[1] for row in pk_info if row[5] > 0]
    if len(pk_cols) > 1:
        # Already composite PK — ensure indexes exist even if a prior
        # interrupted migration created the table but died before indexes.
        _ensure_pr_threads_indexes(conn)
        return

    # -- Rename → dedup → rebuild (F1) --
    source_count: int = conn.execute("SELECT COUNT(*) FROM pr_threads").fetchone()[0]

    conn.execute("ALTER TABLE pr_threads RENAME TO _pr_threads_v3")
    conn.execute(_V4_PR_THREADS_DDL)

    # Deterministic dedup: prefer non-deleted rows over deleted ones,
    # then newest last_updated, then highest rowid as final tiebreaker.
    conn.execute(
        """
        INSERT INTO pr_threads
            (thread_id, pull_request_uid, status, thread_context,
             last_updated, created_at, is_deleted)
        SELECT thread_id, pull_request_uid, status, thread_context,
               last_updated, created_at, is_deleted
        FROM (
            SELECT *, ROW_NUMBER() OVER (
                PARTITION BY pull_request_uid, thread_id
                ORDER BY is_deleted ASC, last_updated DESC, rowid DESC
            ) AS rn
            FROM _pr_threads_v3
        ) WHERE rn = 1
        """
    )
    inserted_count: int = conn.execute("SELECT COUNT(*) FROM pr_threads").fetchone()[0]
    dup_count = source_count - inserted_count
    if dup_count > 0:
        logger.warning(
            "Merged %d duplicate (pull_request_uid, thread_id) rows "
            "during v3→v4 migration (kept newest non-deleted)",
            dup_count,
        )

    conn.execute("DROP TABLE _pr_threads_v3")
    _ensure_pr_threads_indexes(conn)
    logger.info("Rebuilt pr_threads with composite PK")


def _ensure_v4_pr_comments(conn: Connection) -> None:
    """Ensure pr_comments references composite FK on pr_threads.

    Handles stale ``_pr_comments_v3`` artifacts, deduplicates by
    ``comment_id`` (preferring non-deleted rows), and validates the
    FK constraint structurally — not just by column name presence.
    """
    # -- Stale artifact cleanup (F2) --
    if _table_exists(conn, "_pr_comments_v3"):
        if not _table_exists(conn, "pr_comments"):
            conn.execute("ALTER TABLE _pr_comments_v3 RENAME TO pr_comments")
            logger.warning(
                "Recovered stale _pr_comments_v3 → pr_comments "
                "(prior migration interrupted before rebuild)"
            )
        else:
            conn.execute("DROP TABLE _pr_comments_v3")
            logger.warning(
                "Dropped stale _pr_comments_v3 "
                "(prior migration completed but cleanup was interrupted)"
            )

    if not _table_exists(conn, "pr_comments"):
        conn.execute(_V4_PR_COMMENTS_DDL)
        _ensure_pr_comments_indexes(conn)
        logger.info("Created pr_comments with composite FK (was absent)")
        return

    # -- FK validation (F3) --
    # Check if the FK already references the composite PK by grouping
    # PRAGMA foreign_key_list rows by constraint id.  Two separate
    # single-column FKs targeting pr_threads would not satisfy this —
    # both columns must belong to a single FK constraint.
    fk_info = conn.execute("PRAGMA foreign_key_list(pr_comments)").fetchall()
    fk_groups: dict[int, list[tuple[str, str]]] = defaultdict(list)
    for row in fk_info:
        # row[0]=id, row[2]=table, row[3]=from-col, row[4]=to-col
        fk_groups[int(row[0])].append((str(row[2]), str(row[4])))

    for constraint_cols in fk_groups.values():
        tables = {t for t, _ in constraint_cols}
        if tables != {"pr_threads"}:
            continue
        to_cols = {c for _, c in constraint_cols}
        if to_cols == {"pull_request_uid", "thread_id"}:
            # Already composite FK — ensure indexes exist even if a prior
            # interrupted migration created the table but died before indexes.
            _ensure_pr_comments_indexes(conn)
            return

    # -- Rename → dedup → rebuild (F1) --
    source_count: int = conn.execute("SELECT COUNT(*) FROM pr_comments").fetchone()[0]

    conn.execute("ALTER TABLE pr_comments RENAME TO _pr_comments_v3")
    conn.execute(_V4_PR_COMMENTS_DDL)

    # Deterministic dedup by comment_id: prefer non-deleted, then
    # newest last_updated (NULLS LAST), then highest rowid.
    conn.execute(
        """
        INSERT INTO pr_comments
            (comment_id, thread_id, pull_request_uid, author_id,
             content, comment_type, created_at, last_updated, is_deleted)
        SELECT comment_id, thread_id, pull_request_uid, author_id,
               content, comment_type, created_at, last_updated, is_deleted
        FROM (
            SELECT *, ROW_NUMBER() OVER (
                PARTITION BY comment_id
                ORDER BY is_deleted ASC,
                         CASE WHEN last_updated IS NULL THEN 1 ELSE 0 END,
                         last_updated DESC,
                         rowid DESC
            ) AS rn
            FROM _pr_comments_v3
        ) WHERE rn = 1
        """
    )
    inserted_count: int = conn.execute("SELECT COUNT(*) FROM pr_comments").fetchone()[0]
    dup_count = source_count - inserted_count
    if dup_count > 0:
        logger.warning(
            "Merged %d duplicate comment_id rows during v3→v4 migration "
            "(kept newest non-deleted)",
            dup_count,
        )

    # Check for orphaned comments whose parent thread was removed by dedup.
    orphan_count: int = conn.execute(
        "SELECT COUNT(*) FROM pr_comments c "
        "WHERE NOT EXISTS ("
        "  SELECT 1 FROM pr_threads t "
        "  WHERE t.pull_request_uid = c.pull_request_uid "
        "  AND t.thread_id = c.thread_id"
        ")"
    ).fetchone()[0]
    if orphan_count > 0:
        logger.warning(
            "%d pr_comments rows reference threads removed during dedup "
            "— FK enforcement is deferred; orphans will be re-fetched "
            "on next --include-comments run",
            orphan_count,
        )

    conn.execute("DROP TABLE _pr_comments_v3")
    _ensure_pr_comments_indexes(conn)
    logger.info("Rebuilt pr_comments with composite FK")


# v5 pr_comments DDL — composite PK (pull_request_uid, thread_id, comment_id).
# ADO comment IDs are thread-scoped (every thread's first comment is id=1);
# the v4 single-column PK on comment_id caused cross-thread and cross-PR
# upserts to collide via ON CONFLICT, collapsing the table to ~1 row
# regardless of upstream volume.
_V5_PR_COMMENTS_DDL = """
    CREATE TABLE pr_comments (
        comment_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        pull_request_uid TEXT NOT NULL,
        author_id TEXT NOT NULL,
        content TEXT,
        comment_type TEXT,
        created_at TEXT NOT NULL,
        last_updated TEXT,
        is_deleted INTEGER DEFAULT 0,
        PRIMARY KEY (pull_request_uid, thread_id, comment_id),
        FOREIGN KEY (pull_request_uid, thread_id)
            REFERENCES pr_threads(pull_request_uid, thread_id),
        FOREIGN KEY (pull_request_uid)
            REFERENCES pull_requests(pull_request_uid),
        FOREIGN KEY (author_id) REFERENCES users(user_id)
    )
"""


def migrate_v4_to_v5(conn: Connection) -> None:
    """Rebuild pr_comments with composite PK; reset coverage markers.

    Schema v4 → v5:
    - Drop the v4 ``pr_comments`` table (single-column PK on thread-scoped
      comment_id caused silent cross-thread data loss — existing rows are
      lossy by definition and are not preserved).
    - Recreate ``pr_comments`` with composite PK
      ``(pull_request_uid, thread_id, comment_id)``.
    - Reset every ``pull_requests.comments_extracted_at`` to NULL so
      ``backfill-comments`` reselects every previously-covered PR and
      re-fetches its comments under the correct schema.
    - Recreate required indexes.

    All four steps plus the ``schema_version`` bump run inside a single
    ``BEGIN IMMEDIATE`` transaction so a mid-migration failure leaves
    the database in its pre-migration state (either all changes commit
    or none do).  ``BEGIN IMMEDIATE`` takes the writer lock up front so
    no other writer can interleave.

    Idempotent: ``_apply_migrations`` only calls this when
    ``schema_version < 5``; a DB already at v5 is a no-op.
    """
    # ``BEGIN IMMEDIATE`` can itself raise (e.g., lock contention) before any
    # transaction is active; issuing ``ROLLBACK`` in that case would raise
    # ``OperationalError: cannot rollback - no transaction is active`` and mask
    # the real cause. Track whether BEGIN succeeded so ROLLBACK only runs when
    # a transaction is actually open.
    txn_started = False
    try:
        conn.execute("BEGIN IMMEDIATE")
        txn_started = True
        conn.execute("DROP TABLE IF EXISTS pr_comments")
        conn.execute(_V5_PR_COMMENTS_DDL)
        conn.execute(
            "UPDATE pull_requests SET comments_extracted_at = NULL "
            "WHERE comments_extracted_at IS NOT NULL"
        )
        _ensure_pr_comments_indexes(conn)
        conn.execute(
            "INSERT OR IGNORE INTO schema_version (version, applied_at) "
            "VALUES (5, datetime('now'))"
        )
        conn.execute("COMMIT")
    except Exception:
        if txn_started:
            conn.execute("ROLLBACK")
        raise
    logger.info("Applied migration v4 → v5 (pr_comments composite PK)")


_V6_COMMENTS_EXTRACTION_METADATA_DDL = """
    CREATE TABLE IF NOT EXISTS comments_extraction_metadata (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_run_timestamp TEXT NOT NULL,
        prs_processed INTEGER NOT NULL DEFAULT 0,
        threads_fetched INTEGER NOT NULL DEFAULT 0,
        comments_fetched INTEGER NOT NULL DEFAULT 0,
        capped INTEGER NOT NULL DEFAULT 0
    )
"""


def migrate_v5_to_v6(conn: Connection) -> None:
    """Create ``comments_extraction_metadata`` for legacy pre-existing DBs.

    Schema v5 → v6:
    The table is declared in ``SCHEMA_SQL`` (``models.py``) but no prior
    migration ever created it.  Databases whose creation predates that
    addition passed every migration cycle without gaining the table, so
    the first call to ``update_comments_extraction_metadata()`` crashed
    with ``sqlite3.OperationalError: no such table`` after comment
    extraction had already completed (live repro: build 332 on oddessentials,
    task 2.8.0, 1044 PRs extracted then lost at the final metadata write).

    Backfill: the singleton ``id=1`` row is derived from the per-PR
    ``comments_extracted_at`` markers when any exist — ``last_run_timestamp``
    takes ``MAX(comments_extracted_at)``, counts are read from
    ``pull_requests`` / ``pr_threads`` / ``pr_comments``, ``capped`` defaults
    to ``0``.  When no PR has been marked yet (comment extraction never ran
    on this DB), the table is left empty; ``last_run_timestamp`` is
    ``NOT NULL`` so inserting a fabricated stamp would be worse than no row.

    Runs inside ``BEGIN IMMEDIATE`` so a mid-migration failure rolls back
    table creation along with the version bump — either all three statements
    commit or none do.  Idempotent via ``IF NOT EXISTS`` + ``INSERT OR IGNORE``.
    """
    txn_started = False
    try:
        conn.execute("BEGIN IMMEDIATE")
        txn_started = True
        conn.execute(_V6_COMMENTS_EXTRACTION_METADATA_DDL)
        conn.execute(
            """
            INSERT OR IGNORE INTO comments_extraction_metadata
                (id, last_run_timestamp, prs_processed,
                 threads_fetched, comments_fetched, capped)
            SELECT
                1,
                (SELECT MAX(comments_extracted_at) FROM pull_requests
                    WHERE comments_extracted_at IS NOT NULL),
                (SELECT COUNT(*) FROM pull_requests
                    WHERE comments_extracted_at IS NOT NULL),
                (SELECT COUNT(*) FROM pr_threads),
                (SELECT COUNT(*) FROM pr_comments),
                0
            WHERE (SELECT COUNT(*) FROM pull_requests
                WHERE comments_extracted_at IS NOT NULL) > 0
            """
        )
        conn.execute(
            "INSERT OR IGNORE INTO schema_version (version, applied_at) "
            "VALUES (6, datetime('now'))"
        )
        conn.execute("COMMIT")
    except Exception:
        if txn_started:
            conn.execute("ROLLBACK")
        raise
    logger.info("Applied migration v5 → v6 (comments_extraction_metadata)")


# Version-keyed migration registry.  Keys are the *target* version;
# the function upgrades from (key - 1) -> key.
MIGRATIONS: dict[int, Callable[[Connection], None]] = {
    2: migrate_v1_to_v2,
    3: migrate_v2_to_v3,
    4: migrate_v3_to_v4,
    5: migrate_v4_to_v5,
    6: migrate_v5_to_v6,
}
