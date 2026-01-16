"""Integration tests for database open failure handling.

DoD 2.2: Corruption/Invalid DB Handling
- If SQLite cannot be opened or schema is invalid:
  - fail fast with clear error, OR
  - explicitly rebuild from configured start date (documented mode)
- The behavior is documented and test-covered.
"""

from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path

import pytest

from ado_git_repo_insights.persistence.database import DatabaseError, DatabaseManager


class TestDatabaseOpenFailure:
    """Test database open/corruption failure handling (DoD 2.2)."""

    def test_missing_database_creates_new(self) -> None:
        """Missing database file is created automatically."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "does_not_exist.sqlite"

            assert not db_path.exists()

            manager = DatabaseManager(db_path)
            manager.connect()

            # Database should now exist
            assert db_path.exists()

            # Schema should be applied
            cursor = manager.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
            tables = [row["name"] for row in cursor.fetchall()]

            # Core tables should exist
            assert "organizations" in tables
            assert "projects" in tables
            assert "pull_requests" in tables

            manager.close()

    def test_corrupted_database_fails_fast(self) -> None:
        """Corrupted database file causes immediate failure with clear error."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "corrupted.sqlite"

            # Write garbage to simulate corruption
            db_path.write_bytes(b"not a valid sqlite database" * 100)

            manager = DatabaseManager(db_path)

            # Should fail fast with DatabaseError
            with pytest.raises(DatabaseError) as exc_info:
                manager.connect()

            # Error should be clear and actionable
            error_str = str(exc_info.value).lower()
            assert "database" in error_str or "file" in error_str

    def test_partial_schema_fails_validation(self) -> None:
        """Database with missing tables fails schema validation."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "partial.sqlite"

            # Create database with only some tables
            conn = sqlite3.connect(db_path)
            conn.execute(
                "CREATE TABLE organizations (organization_name TEXT PRIMARY KEY)"
            )
            conn.execute(
                """
                CREATE TABLE schema_version (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL
                )
            """
            )
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (1, '2024-01-01')"
            )
            conn.commit()
            conn.close()

            manager = DatabaseManager(db_path)

            # Should fail schema validation (missing required tables)
            with pytest.raises(DatabaseError) as exc_info:
                manager.connect()

            error_msg = str(exc_info.value).lower()
            assert (
                "schema" in error_msg or "table" in error_msg or "missing" in error_msg
            )

    def test_directory_creation_on_connect(self) -> None:
        """Nested directories are created if they don't exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "nested" / "dirs" / "db.sqlite"

            assert not db_path.parent.exists()

            manager = DatabaseManager(db_path)
            manager.connect()

            assert db_path.exists()
            manager.close()

    def test_connection_error_provides_useful_message(self) -> None:
        """Connection errors include useful information for debugging."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bad.sqlite"
            db_path.write_bytes(b"corrupted content here" * 50)

            manager = DatabaseManager(db_path)

            with pytest.raises(DatabaseError) as exc_info:
                manager.connect()

            # Error should have some useful context
            error_str = str(exc_info.value)
            assert len(error_str) > 10  # Not just an empty error

    def test_existing_empty_database_fails_validation(self) -> None:
        """An existing empty SQLite file (no tables) fails schema validation."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "empty.sqlite"

            # Create a valid but completely empty SQLite file
            conn = sqlite3.connect(db_path)
            conn.close()

            manager = DatabaseManager(db_path)

            # Should fail schema validation - no required tables exist
            with pytest.raises(DatabaseError) as exc_info:
                manager.connect()

            error_msg = str(exc_info.value).lower()
            assert (
                "schema" in error_msg or "table" in error_msg or "missing" in error_msg
            )
