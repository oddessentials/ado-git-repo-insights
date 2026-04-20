"""Static parity guard: every SCHEMA_SQL table is fundamental or migration-created.

Closes #304.

Codifies the structural defense for the SCHEMA_SQL-without-migration landmine
that bit twice in one quarter (#295 ``comments_extraction_metadata``, #296
``teams`` / ``team_members``).  In both cases a ``CREATE TABLE`` was added to
``models.SCHEMA_SQL`` without a paired migration; legacy databases passed
every CI cycle but crashed on first prod write with
``sqlite3.OperationalError: no such table``.

This guard fires at PR-CI time on the introducing commit, complementing the
runtime ``_REQUIRED_TABLES`` post-migration sweep in
``DatabaseManager.connect()`` that catches the same defect class on first
legacy-DB open.

The two contracts are intentionally separate: ``_REQUIRED_TABLES`` enforces
post-connect validation policy (which tables the running code expects), while
this test enforces the static source-level invariant (every declared table
has a path from v1).  Conflating them would blur two responsibilities.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from ado_git_repo_insights.persistence import models
from ado_git_repo_insights.persistence.database import (
    _FUNDAMENTAL_TABLES,
    DatabaseManager,
)

# Intentional shared-baseline import: ``_V1_SCHEMA_SQL`` is the canonical
# oldest-supported seed used by the migration-chain tests.  Re-importing it
# here (rather than copying the constant) keeps both test surfaces pinned to
# the same baseline automatically — the exact drift surface this parity guard
# exists to reduce.  Do not "clean up" by inlining a duplicate; future
# changes to the v1 baseline must propagate to every test that walks the
# migration chain in lockstep.
from tests.unit.test_schema_migration import _V1_SCHEMA_SQL


def _user_table_names(conn: sqlite3.Connection) -> frozenset[str]:
    """Return user-facing table names from ``sqlite_master``.

    Filters SQLite-internal tables (``sqlite_sequence`` from AUTOINCREMENT,
    and any future ``sqlite_*`` artifacts) so the parity comparison is
    stable across schema changes that incidentally toggle internals.
    """
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )
    return frozenset(row[0] for row in cursor.fetchall())


def _enumerate_schema_sql_tables(schema_sql: str) -> frozenset[str]:
    """Tables declared by ``schema_sql``, via real ``sqlite_master`` snapshot.

    Executing the script and reading ``sqlite_master`` is materially more
    robust than regex/AST scanning of the DDL string — it captures whatever
    tables SQLite actually creates, regardless of statement form.
    """
    conn = sqlite3.connect(":memory:")
    try:
        conn.executescript(schema_sql)
        return _user_table_names(conn)
    finally:
        conn.close()


def _enumerate_migration_chain_tables(tmp_path: Path) -> frozenset[str]:
    """Tables present after running the full migration chain on the v1 seed.

    Goes through ``DatabaseManager.connect()`` rather than calling each
    ``migrate_vN_to_vN+1`` directly so the test exercises the real upgrade
    path users hit on legacy databases — including ordering, the
    ``_FUNDAMENTAL_TABLES`` pre-validation, and the post-validation sweep.
    """
    db_path = tmp_path / "v1_seed.db"
    seed = sqlite3.connect(str(db_path))
    try:
        seed.executescript(_V1_SCHEMA_SQL)
    finally:
        seed.close()

    manager = DatabaseManager(db_path)
    manager.connect()
    try:
        return _user_table_names(manager.connection)
    finally:
        manager.close()


def _check_schema_sql_parity(
    schema_sql: str, tmp_path: Path
) -> tuple[frozenset[str], str]:
    """Return ``(unmigrated_tables, formatted_failure_message)``.

    Empty ``unmigrated_tables`` means parity holds.  When non-empty, callers
    raise ``message`` as the assertion failure; the message wording is the
    single source of truth so happy-path and red-path tests cannot drift.
    """
    schema_tables = _enumerate_schema_sql_tables(schema_sql)
    migration_chain_tables = _enumerate_migration_chain_tables(tmp_path)
    allowed = _FUNDAMENTAL_TABLES | migration_chain_tables
    unmigrated = schema_tables - allowed

    message = (
        f"Tables declared in SCHEMA_SQL but neither in _FUNDAMENTAL_TABLES "
        f"nor created by any registered migration: {sorted(unmigrated)}. "
        "Add a migration that creates each missing table (see "
        "migrate_v5_to_v6 / migrate_v6_to_v7 in "
        "src/ado_git_repo_insights/persistence/migrations.py for the "
        "canonical pattern), or extend _FUNDAMENTAL_TABLES if the table "
        "has always been part of this project's schema."
    )
    return unmigrated, message


class TestSchemaSqlMigrationParity:
    """Static parity: every SCHEMA_SQL table is fundamental or migration-created."""

    def test_schema_sql_tables_are_fundamental_or_migration_created(
        self, tmp_path: Path
    ) -> None:
        unmigrated, message = _check_schema_sql_parity(models.SCHEMA_SQL, tmp_path)
        assert not unmigrated, message


class TestSchemaSqlMigrationParityRedPath:
    """Prove the parity guard catches drift — not just passes when healthy."""

    def test_synthetic_unmigrated_table_in_schema_sql_is_caught(
        self, tmp_path: Path
    ) -> None:
        """Append a canary CREATE TABLE to a copy of SCHEMA_SQL and prove the
        guard names it explicitly.

        Per project memory ``feedback_never_claim_enforcement_without_proof``:
        a guard without a red-path test is a guard you cannot trust.  The
        failure message must name the offending table and state the
        violation in actionable terms so reviewers act on the diff, not on
        a tally.
        """
        canary_ddl = (
            "\nCREATE TABLE IF NOT EXISTS unmigrated_canary (id INTEGER PRIMARY KEY);\n"
        )
        unmigrated, message = _check_schema_sql_parity(
            models.SCHEMA_SQL + canary_ddl, tmp_path
        )

        assert unmigrated == frozenset({"unmigrated_canary"}), (
            "Guard failed to detect the synthetic unmigrated table; expected "
            f"{{'unmigrated_canary'}}, got {sorted(unmigrated)}."
        )
        assert "unmigrated_canary" in message, (
            f"Guard message must explicitly name the offending table; got: {message!r}"
        )
        assert "SCHEMA_SQL" in message, (
            "Guard message must reference SCHEMA_SQL so reviewers know where "
            f"to look; got: {message!r}"
        )
        assert "_FUNDAMENTAL_TABLES" in message, (
            "Guard message must reference _FUNDAMENTAL_TABLES so reviewers "
            f"know the second remediation path; got: {message!r}"
        )
        assert "migration" in message, (
            "Guard message must mention migration as the primary remediation "
            f"path; got: {message!r}"
        )
