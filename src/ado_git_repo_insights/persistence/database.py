"""SQLite database connection and management.

This module handles database connections, schema initialization, and
ensures safe transaction handling per Invariant 7 (no publish-on-failure).
"""

from __future__ import annotations

import logging
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING

from ado_git_repo_insights.types import SqliteParam

from .migrations import MIGRATIONS
from .models import SCHEMA_SQL

if TYPE_CHECKING:
    from sqlite3 import Connection, Cursor

logger = logging.getLogger(__name__)


class DatabaseError(Exception):
    """Database operation failed."""


class DatabaseManager:
    """Manages SQLite database connections and schema.

    Invariant 5: SQLite is the source of truth for derived outputs.
    Invariant 9: Persistence must be recoverable.
    """

    def __init__(self, db_path: Path) -> None:
        """Initialize the database manager.

        Args:
            db_path: Path to the SQLite database file.
        """
        self.db_path = db_path
        self._connection: Connection | None = None

    @property
    def is_in_memory(self) -> bool:
        """Whether this manager targets SQLite's in-memory database."""
        return str(self.db_path) == ":memory:"

    @property
    def connection(self) -> Connection:
        """Get the active database connection.

        Raises:
            DatabaseError: If not connected.
        """
        if self._connection is None:
            raise DatabaseError("Database not connected. Call connect() first.")
        return self._connection

    def connect(self) -> None:
        """Open a connection to the database.

        Creates the database file and parent directories if they don't exist.
        Initializes the schema on first connection.
        """
        is_new_db = self.is_in_memory or not self.db_path.exists()

        if not self.is_in_memory:
            # Ensure parent directory exists for on-disk databases.
            self.db_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            self._connection = sqlite3.connect(
                ":memory:" if self.is_in_memory else str(self.db_path),
                isolation_level=None,  # Autocommit; we'll manage transactions explicitly
            )
            self._connection.row_factory = sqlite3.Row

            # Enable foreign keys
            self._connection.execute("PRAGMA foreign_keys = ON")

            if is_new_db:
                logger.info(f"Creating new database at {self.db_path}")
                self._initialize_schema()
            else:
                logger.info(f"Connected to existing database at {self.db_path}")
                # Migrate BEFORE validating so migrations can repair any
                # schema shape the current required_tables list enforces
                # (e.g. comments_extraction_metadata added in v5→v6).
                self._apply_migrations()
                self._validate_schema()

        except sqlite3.Error as e:
            self.close()  # Ensure connection is closed on error
            raise DatabaseError(f"Failed to connect to database: {e}") from e
        except DatabaseError:
            self.close()  # Ensure connection is closed on validation error
            raise

    def close(self) -> None:
        """Close the database connection."""
        if self._connection is not None:
            self._connection.close()
            self._connection = None
            logger.debug("Database connection closed")

    def _initialize_schema(self) -> None:
        """Create all tables and indexes."""
        try:
            # Use property accessor which validates connection is active
            self.connection.executescript(SCHEMA_SQL)
            logger.info("Database schema initialized")
        except sqlite3.Error as e:
            raise DatabaseError(f"Failed to initialize schema: {e}") from e

    def _validate_schema(self) -> None:
        """Validate that required tables exist.

        Invariant 9: If schema is invalid, fail fast with clear error.
        """
        required_tables = [
            "extraction_metadata",
            "comments_extraction_metadata",
            "organizations",
            "projects",
            "repositories",
            "users",
            "pull_requests",
            "reviewers",
        ]

        cursor = self.connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
        existing_tables = {row["name"] for row in cursor.fetchall()}

        missing = set(required_tables) - existing_tables
        if missing:
            raise DatabaseError(
                f"Database schema invalid. Missing tables: {missing}. "
                "Consider creating a fresh database."
            )

    def _apply_migrations(self) -> None:
        """Apply pending schema migrations based on current version.

        Compares the stored schema version against the MIGRATIONS registry
        and applies each pending migration in order.  Idempotent — if the
        database is already at the latest version, this is a no-op.
        """
        current = self.get_schema_version()
        pending = sorted(v for v in MIGRATIONS if v > current)
        if not pending:
            return
        for version in pending:
            logger.info(f"Applying schema migration to v{version}")
            MIGRATIONS[version](self.connection)
        logger.info(f"Schema migrations complete: v{current} → v{pending[-1]}")

    @contextmanager
    def transaction(self) -> Iterator[Cursor]:
        """Execute operations within a transaction.

        Invariant 7: On failure, changes are rolled back.

        Yields:
            Database cursor for executing queries.
        """
        conn = self.connection
        cursor = conn.cursor()

        try:
            cursor.execute("BEGIN TRANSACTION")
            yield cursor
            cursor.execute("COMMIT")
        except Exception:
            cursor.execute("ROLLBACK")
            raise
        finally:
            cursor.close()

    def execute(self, sql: str, parameters: tuple[SqliteParam, ...] = ()) -> Cursor:
        """Execute a single SQL statement.

        Args:
            sql: SQL statement to execute.
            parameters: Parameters for the statement.

        Returns:
            Cursor with results.
        """
        return self.connection.execute(sql, parameters)

    def executemany(
        self,
        sql: str,
        parameters: list[tuple[SqliteParam, ...]],
    ) -> Cursor:
        """Execute a SQL statement with multiple parameter sets.

        Args:
            sql: SQL statement to execute.
            parameters: List of parameter tuples.

        Returns:
            Cursor with results.
        """
        return self.connection.executemany(sql, parameters)

    def get_schema_version(self) -> int:
        """Get the current schema version.

        Returns:
            Current schema version number.
        """
        try:
            cursor = self.execute("SELECT MAX(version) as version FROM schema_version")
            row = cursor.fetchone()
            return int(row["version"]) if row and row["version"] is not None else 0
        except sqlite3.Error:
            return 0
