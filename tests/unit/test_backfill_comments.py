"""Tests for the backfill-comments subcommand (feature 058).

Covers selection, snapshot stability, per-PR atomicity, interrupt safety,
filter-parsing parity with extract, discriminator invariants, coverage-marker
invariants, end-to-end flows, and flag validation.

Uses real SQLite on tmp_path with a mocked ADOClient. Principle XXVI:
every test defined unconditionally at module scope, no runtime skips, no
conditional decorators. Parametrize corpora are module-level tuples.
"""

from __future__ import annotations

import ast
import json
import re
import sqlite3
from argparse import Namespace
from datetime import date
from pathlib import Path
from sqlite3 import Cursor
from unittest.mock import MagicMock, patch

import pytest

from ado_git_repo_insights.cli import (
    _legacy_schema_missing_thread_tables,
    _select_uncovered_prs_for_backfill,
    cmd_backfill_comments,
    create_parser,
)
from ado_git_repo_insights.config import _parse_iso_date, _parse_projects_list
from ado_git_repo_insights.extractor.ado_client import ExtractionError
from ado_git_repo_insights.persistence.database import DatabaseError, DatabaseManager
from ado_git_repo_insights.persistence.repository import PRRepository
from ado_git_repo_insights.transform.aggregators import AggregateGenerator
from ado_git_repo_insights.types import SqliteParam
from ado_git_repo_insights.utils.path_security import safe_join

# ---------------------------------------------------------------------------
# Module-level corpora (Principle XXVI — locked at collection time)
# ---------------------------------------------------------------------------

_PROJECTS_CORPUS: tuple[tuple[str, list[str]], ...] = (
    ("", []),
    ("A", ["A"]),
    ("A,B", ["A", "B"]),
    (" A , B ", ["A", "B"]),
    ("A,,B", ["A", "B"]),
    ("A ,B", ["A", "B"]),
    (",A,", ["A"]),
    ("  ", []),
)

_DATE_CORPUS: tuple[tuple[str, bool], ...] = (
    ("2024-01-01", True),
    ("2024-12-31", True),
    ("2024-13-01", False),
    ("2024-02-30", False),
    ("2024-00-01", False),
    ("", False),
    ("not-a-date", False),
    ("2024/01/01", False),
    ("01-01-2024", False),
    ("2024-1-1", False),
    ("20240101", False),  # compact form — Python 3.11+ fromisoformat accepts
    ("2024-W01-1", False),  # ISO-week form — accepted by fromisoformat
    ("2024-001", False),  # ordinal day-of-year — accepted by fromisoformat
)

_FORBIDDEN_UNCONDITIONAL = (
    re.compile(r"(?i)\bthread-safe\b"),
    re.compile(r"(?i)\bconcurrent\b"),
)
_FORBIDDEN_ATOMIC = re.compile(r"(?i)(?<!per-PR )\batomic\b")
_FORBIDDEN_COMPLETE = re.compile(r"(?i)(?<!per-PR )(?<!loop-)\bcomplete\b")
_FORBIDDEN_RESUMABLE = re.compile(r"(?i)\bresumable\b")


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _create_backfill_db(tmp_path: Path) -> DatabaseManager:
    """Create a v4+ database with FK entities ready for PR rows."""
    db = DatabaseManager(tmp_path / "test.db")
    db.connect()
    db.execute("INSERT INTO organizations (organization_name) VALUES ('org')")
    db.execute(
        "INSERT INTO projects (organization_name, project_name) "
        "VALUES ('org', 'ProjectA')"
    )
    db.execute(
        "INSERT INTO projects (organization_name, project_name) "
        "VALUES ('org', 'ProjectB')"
    )
    db.execute(
        "INSERT INTO repositories "
        "(repository_id, repository_name, project_name, organization_name) "
        "VALUES ('r1', 'repoA', 'ProjectA', 'org')"
    )
    db.execute(
        "INSERT INTO repositories "
        "(repository_id, repository_name, project_name, organization_name) "
        "VALUES ('r2', 'repoB', 'ProjectB', 'org')"
    )
    db.execute("INSERT INTO users (user_id, display_name) VALUES ('u1', 'Alice')")
    db.connection.commit()
    return db


def _insert_pr(
    db: DatabaseManager,
    pr_uid: str,
    closed_date: str = "2026-01-16T10:00:00Z",
    project: str = "ProjectA",
    repo: str = "r1",
    pr_id: int = 1,
    covered: bool = False,
) -> None:
    """Insert one completed PR row."""
    marker_value = "2026-01-20T00:00:00Z" if covered else None
    db.execute(
        "INSERT INTO pull_requests "
        "(pull_request_uid, pull_request_id, organization_name, project_name, "
        "repository_id, user_id, title, status, creation_date, closed_date, "
        "comments_extracted_at) VALUES (?, ?, 'org', ?, ?, 'u1', 'PR', "
        "'completed', '2026-01-15T10:00:00Z', ?, ?)",
        (pr_uid, pr_id, project, repo, closed_date, marker_value),
    )
    db.connection.commit()


def _make_thread(
    tid: int,
    updated: str = "2026-01-16T00:00:00Z",
    author_id: str = "ua",
) -> dict[str, object]:
    return {
        "id": tid,
        "status": "active",
        "lastUpdatedDate": updated,
        "publishedDate": updated,
        "isDeleted": False,
        "comments": [
            {
                "id": tid * 100,
                "author": {
                    "id": author_id,
                    "displayName": "Author",
                    "uniqueName": "a@x",
                },
                "content": "hi",
                "commentType": "text",
                "publishedDate": updated,
                "lastUpdatedDate": updated,
                "isDeleted": False,
            }
        ],
    }


def _mock_client(
    threads: list[dict[str, object]] | None = None,
    per_pr: dict[str, list[dict[str, object]]] | None = None,
    raises: dict[str, BaseException] | None = None,
    organization_probe_error: BaseException | None = None,
) -> MagicMock:
    """Return a MagicMock ADO client. If *raises* has an entry for a PR's
    pull_request_id (as int), get_pr_threads raises it for that call."""
    client = MagicMock()
    raises = raises or {}
    per_pr = per_pr or {}

    def _get_pr_threads(
        project: str, repository_id: str, pull_request_id: int
    ) -> list[dict[str, object]]:
        key = str(pull_request_id)
        if key in raises:
            raise raises[key]
        if key in per_pr:
            return per_pr[key]
        return threads or []

    client.get_pr_threads.side_effect = _get_pr_threads
    client.test_connection.return_value = None
    if organization_probe_error is None:
        client.test_organization_connection.return_value = None
    else:
        client.test_organization_connection.side_effect = organization_probe_error
    return client


def _make_args(
    tmp_path: Path,
    db_path: Path,
    projects: str | None = None,
    since: date | None = None,
    until: date | None = None,
    limit: int = 0,
    max_threads: int = 50,
) -> Namespace:
    return Namespace(
        organization="org",
        pat="pat",
        database=db_path,
        projects=projects,
        since=since,
        until=until,
        limit=limit,
        comments_max_threads_per_pr=max_threads,
        artifacts_dir=tmp_path / "artifacts",
    )


def _run_backfill(
    args: Namespace, client: MagicMock | None = None
) -> tuple[int, dict[str, object]]:
    """Invoke cmd_backfill_comments with ADOClient mocked; return (exit, artifact).

    cmd_backfill_comments builds its own minimal config inline (see P1
    contract fix; FR-004 / contracts §10), so this helper only needs to
    patch the ADO client to prevent real HTTP calls. load_config is never
    invoked by the subcommand.
    """
    client = client or _mock_client(threads=[])

    with patch(
        "ado_git_repo_insights.extractor.ado_client.ADOClient",
        return_value=client,
    ):
        exit_code = cmd_backfill_comments(args)

    artifact_path = args.artifacts_dir / "run_summary.json"
    artifact: dict[str, object] = {}
    if artifact_path.exists():
        with artifact_path.open() as f:
            artifact = json.load(f)
    return exit_code, artifact


def _create_raw_backfill_schema(
    db_path: Path,
    *,
    include_pull_requests: bool = True,
    include_pr_threads: bool = False,
    include_pr_comments: bool = False,
) -> None:
    conn = sqlite3.connect(str(db_path))
    try:
        if include_pull_requests:
            conn.execute(
                """
                CREATE TABLE pull_requests (
                    pull_request_uid TEXT PRIMARY KEY
                )
                """
            )
        if include_pr_threads:
            conn.execute(
                """
                CREATE TABLE pr_threads (
                    thread_id TEXT PRIMARY KEY,
                    pull_request_uid TEXT NOT NULL
                )
                """
            )
        if include_pr_comments:
            conn.execute(
                """
                CREATE TABLE pr_comments (
                    comment_id TEXT PRIMARY KEY,
                    thread_id TEXT NOT NULL,
                    pull_request_uid TEXT NOT NULL
                )
                """
            )
        conn.commit()
    finally:
        conn.close()


def _select_uids(db: DatabaseManager, **kwargs: object) -> list[str]:
    organization = kwargs.get("organization", "org")
    projects = kwargs.get("projects", [])
    since = kwargs.get("since")
    until = kwargs.get("until")
    limit = kwargs.get("limit", 0)
    rows = _select_uncovered_prs_for_backfill(
        db,
        organization if isinstance(organization, str) else "org",
        projects if isinstance(projects, list) else [],
        since if isinstance(since, date) else None,
        until if isinstance(until, date) else None,
        limit if isinstance(limit, int) else 0,
    )
    return [str(r["pull_request_uid"]) for r in rows]


# ---------------------------------------------------------------------------
# #1-6 Selection
# ---------------------------------------------------------------------------


class TestSelection:
    """FR-002 through FR-006: selection-query invariants."""

    def test_excludes_already_covered_prs(self, tmp_path: Path) -> None:
        db = _create_backfill_db(tmp_path)
        try:
            _insert_pr(db, "p1", pr_id=1, covered=True)
            _insert_pr(db, "p2", pr_id=2, covered=True)
            _insert_pr(db, "p3", pr_id=3, covered=True)
            _insert_pr(db, "p4", pr_id=4, covered=False)
            _insert_pr(db, "p5", pr_id=5, covered=False)

            uids = _select_uids(db)
            assert set(uids) == {"p4", "p5"}
            assert len(uids) == 2
        finally:
            db.close()

    def test_stable_ordering_on_equal_closed_dates(self, tmp_path: Path) -> None:
        db = _create_backfill_db(tmp_path)
        try:
            same_date = "2026-01-16T10:00:00Z"
            _insert_pr(db, "z", pr_id=1, closed_date=same_date)
            _insert_pr(db, "a", pr_id=2, closed_date=same_date)
            _insert_pr(db, "m", pr_id=3, closed_date=same_date)

            uids = _select_uids(db)
            assert uids == ["a", "m", "z"]
        finally:
            db.close()

    def test_projects_filter_selects_only_matching_project(
        self, tmp_path: Path
    ) -> None:
        db = _create_backfill_db(tmp_path)
        try:
            _insert_pr(db, "a1", pr_id=1, project="ProjectA", repo="r1")
            _insert_pr(db, "a2", pr_id=2, project="ProjectA", repo="r1")
            _insert_pr(db, "b1", pr_id=3, project="ProjectB", repo="r2")

            uids = _select_uids(db, projects=["ProjectA"])
            assert set(uids) == {"a1", "a2"}
        finally:
            db.close()

    def test_selection_scopes_to_requested_organization(self, tmp_path: Path) -> None:
        db = _create_backfill_db(tmp_path)
        try:
            _insert_pr(db, "org-a", pr_id=1, project="ProjectA", repo="r1")
            db.execute("INSERT INTO organizations (organization_name) VALUES ('other')")
            db.execute(
                "INSERT INTO projects (organization_name, project_name) "
                "VALUES ('other', 'ProjectA')"
            )
            db.execute(
                "INSERT INTO repositories "
                "(repository_id, repository_name, project_name, organization_name) "
                "VALUES ('r-other', 'repo-other', 'ProjectA', 'other')"
            )
            db.execute(
                "INSERT INTO pull_requests "
                "(pull_request_uid, pull_request_id, organization_name, project_name, "
                "repository_id, user_id, title, status, creation_date, closed_date, "
                "comments_extracted_at) VALUES "
                "('org-b', 2, 'other', 'ProjectA', 'r-other', 'u1', 'PR', "
                "'completed', '2026-01-15T10:00:00Z', '2026-01-16T10:00:00Z', NULL)"
            )
            db.connection.commit()

            assert _select_uids(db, organization="org") == ["org-a"]
            assert _select_uids(db, organization="other") == ["org-b"]
        finally:
            db.close()

    def test_since_until_half_open_interval(self, tmp_path: Path) -> None:
        db = _create_backfill_db(tmp_path)
        try:
            _insert_pr(db, "before", pr_id=1, closed_date="2025-12-31T00:00:00Z")
            _insert_pr(db, "lower", pr_id=2, closed_date="2026-01-01T00:00:00Z")
            _insert_pr(db, "mid", pr_id=3, closed_date="2026-03-01T00:00:00Z")
            _insert_pr(db, "upper", pr_id=4, closed_date="2026-06-01T00:00:00Z")
            _insert_pr(db, "after", pr_id=5, closed_date="2026-06-02T00:00:00Z")

            uids = _select_uids(db, since=date(2026, 1, 1), until=date(2026, 6, 1))
            # closed_date >= "2026-01-01" AND < "2026-06-01"
            assert set(uids) == {"lower", "mid"}
        finally:
            db.close()

    def test_limit_zero_is_unbounded(self, tmp_path: Path) -> None:
        db = _create_backfill_db(tmp_path)
        try:
            for i in range(100):
                _insert_pr(
                    db,
                    f"p{i:03d}",
                    pr_id=i + 1,
                    closed_date=f"2026-03-{(i % 28) + 1:02d}T00:00:00Z",
                )
            uids = _select_uids(db, limit=0)
            assert len(uids) == 100
        finally:
            db.close()

    def test_limit_positive_caps_selection_to_oldest_n(self, tmp_path: Path) -> None:
        db = _create_backfill_db(tmp_path)
        try:
            for i in range(50):
                _insert_pr(
                    db,
                    f"p{i:03d}",
                    pr_id=i + 1,
                    closed_date=f"2026-{(i % 12) + 1:02d}-{(i % 28) + 1:02d}T00:00:00Z",
                )
            uids = _select_uids(db, limit=10)
            assert len(uids) == 10
            # Oldest first — verify ordered by closed_date ASC
            all_rows = _select_uncovered_prs_for_backfill(db, "org", [], None, None, 0)
            oldest_10 = {str(r["pull_request_uid"]) for r in all_rows[:10]}
            assert set(uids) == oldest_10
        finally:
            db.close()


# ---------------------------------------------------------------------------
# #7 SelectionSnapshotStability
# ---------------------------------------------------------------------------


class TestSelectionSnapshotStability:
    """FR-011a: selection snapshot materialized before loop iterates."""

    def test_mid_loop_inserts_do_not_change_t_or_order(self, tmp_path: Path) -> None:
        db = _create_backfill_db(tmp_path)
        try:
            _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
            _insert_pr(db, "p2", pr_id=2, closed_date="2026-01-02T00:00:00Z")
            _insert_pr(db, "p3", pr_id=3, closed_date="2026-01-03T00:00:00Z")

            snapshot = _select_uncovered_prs_for_backfill(db, "org", [], None, None, 0)
            assert len(snapshot) == 3

            # Mutate the DB after snapshot materializes.
            _insert_pr(db, "p4", pr_id=4, closed_date="2025-12-31T00:00:00Z")

            # Snapshot list is independent of the DB now.
            assert len(snapshot) == 3
            snapshot_uids = {str(r["pull_request_uid"]) for r in snapshot}
            assert "p4" not in snapshot_uids

            # A fresh invocation sees the new row.
            fresh = _select_uncovered_prs_for_backfill(db, "org", [], None, None, 0)
            assert len(fresh) == 4
        finally:
            db.close()


# ---------------------------------------------------------------------------
# #8 PerPRAtomicity
# ---------------------------------------------------------------------------


class TestPerPRAtomicity:
    """FR-012/013: per-PR commit/rollback boundaries."""

    def test_exception_mid_upsert_leaves_db_bit_identical(self, tmp_path: Path) -> None:
        db = _create_backfill_db(tmp_path)
        try:
            _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
            _insert_pr(db, "p2", pr_id=2, closed_date="2026-01-02T00:00:00Z")
            _insert_pr(db, "p3", pr_id=3, closed_date="2026-01-03T00:00:00Z")
            db.close()

            args = _make_args(tmp_path, tmp_path / "test.db")
            client = _mock_client(
                per_pr={
                    "1": [_make_thread(10)],
                    "3": [_make_thread(30)],
                },
                raises={"2": ExtractionError("upstream 503")},
            )
            exit_code, artifact = _run_backfill(args, client=client)
            assert exit_code == 0

            # Verify DB: p1 + p3 covered; p2 not covered with no partial rows.
            db2 = DatabaseManager(tmp_path / "test.db")
            db2.connect()
            try:

                def _stamp(uid: str) -> str | None:
                    row = db2.execute(
                        "SELECT comments_extracted_at FROM pull_requests "
                        "WHERE pull_request_uid=?",
                        (uid,),
                    ).fetchone()
                    return row["comments_extracted_at"] if row else None

                assert _stamp("p1") is not None
                assert _stamp("p2") is None
                assert _stamp("p3") is not None

                p2_threads = db2.execute(
                    "SELECT COUNT(*) FROM pr_threads WHERE pull_request_uid=?",
                    ("p2",),
                ).fetchone()[0]
                assert p2_threads == 0
            finally:
                db2.close()
        finally:
            pass

    def test_per_pr_transaction_issues_begin_commit_on_success(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Structural lock: successful iteration issues BEGIN IMMEDIATE
        then COMMIT, with no interleaved ROLLBACK. Detects regression to
        implicit db.connection.commit() (autocommit no-op)."""
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
        db.close()

        sql_log: list[str] = []
        original_execute = DatabaseManager.execute

        def spy_execute(
            self_db: DatabaseManager,
            sql: str,
            parameters: tuple[SqliteParam, ...] = (),
        ) -> Cursor:
            sql_log.append(sql)
            return original_execute(self_db, sql, parameters)

        monkeypatch.setattr(DatabaseManager, "execute", spy_execute)

        args = _make_args(tmp_path, tmp_path / "test.db", max_threads=0)
        client = _mock_client(per_pr={"1": [_make_thread(10)]})
        exit_code, _ = _run_backfill(args, client=client)
        assert exit_code == 0

        # Per-PR tx is the first transaction in the log. Later entries
        # are the review-time recomputation (its own BEGIN TRANSACTION
        # pair at end-of-loop) — out of scope for this assertion.
        tx_log = [
            s
            for s in sql_log
            if s in ("BEGIN IMMEDIATE", "BEGIN TRANSACTION", "COMMIT", "ROLLBACK")
        ]
        assert tx_log[:2] == ["BEGIN IMMEDIATE", "COMMIT"], tx_log

    def test_remote_fetch_returns_before_begin_immediate(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Regression guard: the ADO fetch must complete before the backfill
        loop opens ``BEGIN IMMEDIATE`` so network latency never becomes SQLite
        write-lock time.
        """
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
        db.close()

        events: list[str] = []
        original_execute = DatabaseManager.execute

        def spy_execute(
            self_db: DatabaseManager,
            sql: str,
            parameters: tuple[SqliteParam, ...] = (),
        ) -> Cursor:
            if sql == "BEGIN IMMEDIATE":
                events.append("begin_immediate")
            return original_execute(self_db, sql, parameters)

        monkeypatch.setattr(DatabaseManager, "execute", spy_execute)

        client = MagicMock()

        def get_pr_threads(
            project: str, repository_id: str, pull_request_id: int
        ) -> list[dict[str, object]]:
            events.append("get_pr_threads:start")
            payload = [_make_thread(10)]
            events.append("get_pr_threads:return")
            return payload

        client.get_pr_threads.side_effect = get_pr_threads
        client.test_connection.return_value = None

        args = _make_args(tmp_path, tmp_path / "test.db", max_threads=0)
        exit_code, _ = _run_backfill(args, client=client)
        assert exit_code == 0
        assert events.count("begin_immediate") == 1, events
        assert events.index("get_pr_threads:return") < events.index(
            "begin_immediate"
        ), events

    def test_fetch_error_does_not_open_transaction(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Structural lock: a fetch-side ExtractionError occurs before
        ``BEGIN IMMEDIATE`` and therefore opens no transaction at all."""
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
        db.close()

        sql_log: list[str] = []
        original_execute = DatabaseManager.execute

        def spy_execute(
            self_db: DatabaseManager,
            sql: str,
            parameters: tuple[SqliteParam, ...] = (),
        ) -> Cursor:
            sql_log.append(sql)
            return original_execute(self_db, sql, parameters)

        monkeypatch.setattr(DatabaseManager, "execute", spy_execute)

        args = _make_args(tmp_path, tmp_path / "test.db", max_threads=0)
        client = _mock_client(raises={"1": ExtractionError("boom")})
        exit_code, _ = _run_backfill(args, client=client)
        assert exit_code == 0

        tx_log = [
            s
            for s in sql_log
            if s in ("BEGIN IMMEDIATE", "BEGIN TRANSACTION", "COMMIT", "ROLLBACK")
        ]
        assert tx_log == [], tx_log

    def test_mid_iteration_failure_leaves_no_rows(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Behavioral lock (proves rollback correctness, not just SQL).

        Patches ``repo.upsert_comment`` to raise ``ExtractionError`` on
        the second call so the first comment's row has already landed
        inside the per-PR transaction when the failure fires. With the
        explicit BEGIN IMMEDIATE / ROLLBACK wrapping, ROLLBACK MUST
        unwind every thread and comment row for that PR, leaving the
        database bit-identical to its pre-iteration state
        (FR-012 / FR-013). Without the transaction, the first row
        would have autocommitted and the assertion would fail.
        """
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
        db.close()

        args = _make_args(tmp_path, tmp_path / "test.db", max_threads=0)
        client = _mock_client(
            per_pr={
                "1": [_make_thread(10), _make_thread(20)],
            }
        )

        original_upsert_comment = PRRepository.upsert_comment
        call_count = 0

        def wrapped_upsert_comment(
            repo_self: PRRepository,
            *,
            comment_id: str,
            thread_id: str,
            pull_request_uid: str,
            author_id: str,
            content: str | None,
            comment_type: str | None,
            created_at: str,
            last_updated: str | None = None,
            is_deleted: bool = False,
        ) -> None:
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                raise ExtractionError("injected mid-iteration upsert failure")
            original_upsert_comment(
                repo_self,
                comment_id=comment_id,
                thread_id=thread_id,
                pull_request_uid=pull_request_uid,
                author_id=author_id,
                content=content,
                comment_type=comment_type,
                created_at=created_at,
                last_updated=last_updated,
                is_deleted=is_deleted,
            )

        monkeypatch.setattr(PRRepository, "upsert_comment", wrapped_upsert_comment)

        exit_code, _ = _run_backfill(args, client=client)
        assert exit_code == 0

        db2 = DatabaseManager(tmp_path / "test.db")
        db2.connect()
        try:
            threads = db2.execute(
                "SELECT COUNT(*) FROM pr_threads WHERE pull_request_uid=?",
                ("p1",),
            ).fetchone()[0]
            comments = db2.execute(
                "SELECT COUNT(*) FROM pr_comments WHERE pull_request_uid=?",
                ("p1",),
            ).fetchone()[0]
            assert threads == 0, (
                f"Per-PR rollback failed: expected 0 threads, got {threads}. "
                "Backfill must bracket each PR in BEGIN IMMEDIATE / COMMIT / "
                "ROLLBACK — autocommit semantics do not honor the contract."
            )
            assert comments == 0, (
                f"Per-PR rollback failed: expected 0 comments, got {comments}."
            )
            marker_row = db2.execute(
                "SELECT comments_extracted_at FROM pull_requests "
                "WHERE pull_request_uid='p1'"
            ).fetchone()
            assert marker_row["comments_extracted_at"] is None
        finally:
            db2.close()

    def test_sqlite_error_from_repo_upsert_routes_through_site_d2(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
        db.close()

        sql_log: list[str] = []
        original_execute = DatabaseManager.execute

        def spy_execute(
            self_db: DatabaseManager,
            sql: str,
            parameters: tuple[SqliteParam, ...] = (),
        ) -> Cursor:
            if sql in ("BEGIN IMMEDIATE", "COMMIT", "ROLLBACK"):
                sql_log.append(sql)
            return original_execute(self_db, sql, parameters)

        monkeypatch.setattr(DatabaseManager, "execute", spy_execute)

        original_upsert_comment = PRRepository.upsert_comment
        call_count = 0

        def wrapped_upsert_comment(
            repo_self: PRRepository,
            *,
            comment_id: str,
            thread_id: str,
            pull_request_uid: str,
            author_id: str,
            content: str | None,
            comment_type: str | None,
            created_at: str,
            last_updated: str | None = None,
            is_deleted: bool = False,
        ) -> None:
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                raise sqlite3.DatabaseError("comment upsert exploded")
            original_upsert_comment(
                repo_self,
                comment_id=comment_id,
                thread_id=thread_id,
                pull_request_uid=pull_request_uid,
                author_id=author_id,
                content=content,
                comment_type=comment_type,
                created_at=created_at,
                last_updated=last_updated,
                is_deleted=is_deleted,
            )

        monkeypatch.setattr(PRRepository, "upsert_comment", wrapped_upsert_comment)

        args = _make_args(tmp_path, tmp_path / "test.db", max_threads=0)
        client = _mock_client(per_pr={"1": [_make_thread(10), _make_thread(20)]})
        exit_code, artifact = _run_backfill(args, client=client)

        assert exit_code == 1
        assert sql_log == ["BEGIN IMMEDIATE", "ROLLBACK"], sql_log
        fatal = str(artifact.get("first_fatal_error", ""))
        assert fatal.startswith("Database error:"), fatal
        assert "could not persist threads for PR p1" in fatal, fatal
        assert "comment upsert exploded" in fatal, fatal
        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        assert (
            "backfill-comments: fatal-abort: Database error: "
            "backfill-comments could not persist threads for PR p1: "
            "comment upsert exploded"
        ) in warnings
        assert (
            "backfill-comments: fatal-abort: "
            "backfill-comments could not persist threads for PR p1: "
            "comment upsert exploded"
        ) not in warnings

        db2 = DatabaseManager(tmp_path / "test.db")
        db2.connect()
        try:
            threads = db2.execute(
                "SELECT COUNT(*) FROM pr_threads WHERE pull_request_uid=?",
                ("p1",),
            ).fetchone()[0]
            comments = db2.execute(
                "SELECT COUNT(*) FROM pr_comments WHERE pull_request_uid=?",
                ("p1",),
            ).fetchone()[0]
            marker_row = db2.execute(
                "SELECT comments_extracted_at FROM pull_requests "
                "WHERE pull_request_uid=?",
                ("p1",),
            ).fetchone()
            assert threads == 0
            assert comments == 0
            assert marker_row["comments_extracted_at"] is None
        finally:
            db2.close()

    def test_sqlite_error_from_persist_helper_routes_through_site_d2(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
        db.close()

        sql_log: list[str] = []
        original_execute = DatabaseManager.execute

        def spy_execute(
            self_db: DatabaseManager,
            sql: str,
            parameters: tuple[SqliteParam, ...] = (),
        ) -> Cursor:
            if sql in ("BEGIN IMMEDIATE", "COMMIT", "ROLLBACK"):
                sql_log.append(sql)
            return original_execute(self_db, sql, parameters)

        def fake_persist(
            _db: DatabaseManager,
            _repo: PRRepository,
            _pr_row: dict[str, object],
            _payload: object,
        ) -> object:
            raise sqlite3.DatabaseError("persist helper exploded")

        monkeypatch.setattr(DatabaseManager, "execute", spy_execute)
        monkeypatch.setattr(
            "ado_git_repo_insights.cli._persist_threads_for_pr",
            fake_persist,
        )

        args = _make_args(tmp_path, tmp_path / "test.db", max_threads=0)
        client = _mock_client(per_pr={"1": [_make_thread(10)]})
        exit_code, artifact = _run_backfill(args, client=client)

        assert exit_code == 1
        assert sql_log == ["BEGIN IMMEDIATE", "ROLLBACK"], sql_log
        fatal = str(artifact.get("first_fatal_error", ""))
        assert fatal.startswith("Database error:"), fatal
        assert "could not persist threads for PR p1" in fatal, fatal
        assert "persist helper exploded" in fatal, fatal
        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        assert (
            "backfill-comments: fatal-abort: Database error: "
            "backfill-comments could not persist threads for PR p1: "
            "persist helper exploded"
        ) in warnings
        assert (
            "backfill-comments: fatal-abort: "
            "backfill-comments could not persist threads for PR p1: "
            "persist helper exploded"
        ) not in warnings

        db2 = DatabaseManager(tmp_path / "test.db")
        db2.connect()
        try:
            threads = db2.execute(
                "SELECT COUNT(*) FROM pr_threads WHERE pull_request_uid=?",
                ("p1",),
            ).fetchone()[0]
            comments = db2.execute(
                "SELECT COUNT(*) FROM pr_comments WHERE pull_request_uid=?",
                ("p1",),
            ).fetchone()[0]
            marker_row = db2.execute(
                "SELECT comments_extracted_at FROM pull_requests "
                "WHERE pull_request_uid=?",
                ("p1",),
            ).fetchone()
            assert threads == 0
            assert comments == 0
            assert marker_row["comments_extracted_at"] is None
        finally:
            db2.close()

    def test_sqlite_error_from_dropped_thread_check_routes_through_site_d2(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
        db.close()

        sql_log: list[str] = []
        original_execute = DatabaseManager.execute

        def spy_execute(
            self_db: DatabaseManager,
            sql: str,
            parameters: tuple[SqliteParam, ...] = (),
        ) -> Cursor:
            if sql in ("BEGIN IMMEDIATE", "COMMIT", "ROLLBACK"):
                sql_log.append(sql)
            return original_execute(self_db, sql, parameters)

        def fake_dropped_threads_all_stored(
            _db: DatabaseManager,
            _pr_uid: str,
            _dropped_threads: list[dict[str, object]],
        ) -> bool:
            raise sqlite3.DatabaseError("dropped-thread probe exploded")

        monkeypatch.setattr(DatabaseManager, "execute", spy_execute)
        monkeypatch.setattr(
            "ado_git_repo_insights.cli._dropped_threads_all_stored",
            fake_dropped_threads_all_stored,
        )

        args = _make_args(tmp_path, tmp_path / "test.db", max_threads=1)
        client = _mock_client(per_pr={"1": [_make_thread(10), _make_thread(20)]})
        exit_code, artifact = _run_backfill(args, client=client)

        assert exit_code == 1
        assert sql_log == ["BEGIN IMMEDIATE", "ROLLBACK"], sql_log
        fatal = str(artifact.get("first_fatal_error", ""))
        assert fatal.startswith("Database error:"), fatal
        assert "could not verify dropped-thread coverage for PR p1" in fatal, fatal
        assert "dropped-thread probe exploded" in fatal, fatal
        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        assert (
            "backfill-comments: fatal-abort: Database error: "
            "backfill-comments could not verify dropped-thread coverage for PR p1: "
            "dropped-thread probe exploded"
        ) in warnings
        assert (
            "backfill-comments: fatal-abort: "
            "backfill-comments could not verify dropped-thread coverage for PR p1: "
            "dropped-thread probe exploded"
        ) not in warnings

        db2 = DatabaseManager(tmp_path / "test.db")
        db2.connect()
        try:
            threads = db2.execute(
                "SELECT COUNT(*) FROM pr_threads WHERE pull_request_uid=?",
                ("p1",),
            ).fetchone()[0]
            comments = db2.execute(
                "SELECT COUNT(*) FROM pr_comments WHERE pull_request_uid=?",
                ("p1",),
            ).fetchone()[0]
            marker_row = db2.execute(
                "SELECT comments_extracted_at FROM pull_requests "
                "WHERE pull_request_uid=?",
                ("p1",),
            ).fetchone()
            assert threads == 0
            assert comments == 0
            assert marker_row["comments_extracted_at"] is None
        finally:
            db2.close()

    def test_sqlite_error_from_begin_immediate_routes_through_site_d2(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
        db.close()

        sql_log: list[str] = []
        original_execute = DatabaseManager.execute

        def spy_execute(
            self_db: DatabaseManager,
            sql: str,
            parameters: tuple[SqliteParam, ...] = (),
        ) -> Cursor:
            if sql in ("BEGIN IMMEDIATE", "COMMIT", "ROLLBACK"):
                sql_log.append(sql)
            if sql == "BEGIN IMMEDIATE":
                raise sqlite3.DatabaseError("database is locked")
            return original_execute(self_db, sql, parameters)

        monkeypatch.setattr(DatabaseManager, "execute", spy_execute)

        args = _make_args(tmp_path, tmp_path / "test.db", max_threads=0)
        client = _mock_client(per_pr={"1": [_make_thread(10)]})
        exit_code, artifact = _run_backfill(args, client=client)

        assert exit_code == 1
        assert sql_log == ["BEGIN IMMEDIATE"], sql_log
        fatal = str(artifact.get("first_fatal_error", ""))
        assert fatal.startswith("Database error:"), fatal
        assert "could not begin transaction for PR p1" in fatal, fatal
        assert "database is locked" in fatal, fatal
        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        assert (
            "backfill-comments: fatal-abort: Database error: "
            "backfill-comments could not begin transaction for PR p1: "
            "database is locked"
        ) in warnings

    def test_sqlite_error_from_commit_routes_through_site_d2(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
        db.close()

        sql_log: list[str] = []
        original_execute = DatabaseManager.execute

        def spy_execute(
            self_db: DatabaseManager,
            sql: str,
            parameters: tuple[SqliteParam, ...] = (),
        ) -> Cursor:
            if sql in ("BEGIN IMMEDIATE", "COMMIT", "ROLLBACK"):
                sql_log.append(sql)
            if sql == "COMMIT":
                raise sqlite3.DatabaseError("disk full")
            return original_execute(self_db, sql, parameters)

        monkeypatch.setattr(DatabaseManager, "execute", spy_execute)

        args = _make_args(tmp_path, tmp_path / "test.db", max_threads=0)
        client = _mock_client(per_pr={"1": [_make_thread(10)]})
        exit_code, artifact = _run_backfill(args, client=client)

        assert exit_code == 1
        assert sql_log == ["BEGIN IMMEDIATE", "COMMIT", "ROLLBACK"], sql_log
        fatal = str(artifact.get("first_fatal_error", ""))
        assert fatal.startswith("Database error:"), fatal
        assert "could not commit transaction for PR p1" in fatal, fatal
        assert "disk full" in fatal, fatal
        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        assert (
            "backfill-comments: fatal-abort: Database error: "
            "backfill-comments could not commit transaction for PR p1: disk full"
        ) in warnings


# ---------------------------------------------------------------------------
# #9-10 InterruptSafety
# ---------------------------------------------------------------------------


class TestInterruptSafety:
    """FR-013a: SIGINT safety."""

    def test_signal_between_iterations_leaves_committed_prs_persisted(
        self, tmp_path: Path
    ) -> None:
        db = _create_backfill_db(tmp_path)
        try:
            _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
            _insert_pr(db, "p2", pr_id=2, closed_date="2026-01-02T00:00:00Z")
            _insert_pr(db, "p3", pr_id=3, closed_date="2026-01-03T00:00:00Z")
            db.close()

            # Third PR raises KeyboardInterrupt mid-fetch — simulating SIGINT
            # delivered after PR1 + PR2 committed.
            args = _make_args(tmp_path, tmp_path / "test.db")
            client = _mock_client(
                per_pr={
                    "1": [_make_thread(10)],
                    "2": [_make_thread(20)],
                },
                raises={"3": KeyboardInterrupt()},
            )

            with pytest.raises(KeyboardInterrupt):
                _run_backfill(args, client=client)

            db2 = DatabaseManager(tmp_path / "test.db")
            db2.connect()
            try:

                def _stamp(uid: str) -> str | None:
                    row = db2.execute(
                        "SELECT comments_extracted_at FROM pull_requests "
                        "WHERE pull_request_uid=?",
                        (uid,),
                    ).fetchone()
                    return row["comments_extracted_at"] if row else None

                assert _stamp("p1") is not None
                assert _stamp("p2") is not None
                assert _stamp("p3") is None

                # Re-invocation should only see p3.
                remaining = _select_uncovered_prs_for_backfill(
                    db2, "org", [], None, None, 0
                )
                remaining_uids = {str(r["pull_request_uid"]) for r in remaining}
                assert remaining_uids == {"p3"}
            finally:
                db2.close()
        finally:
            pass

    def test_signal_preserves_keyboardinterrupt_when_summary_write_fails(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _create_backfill_db(tmp_path)
        try:
            _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
            db.close()

            args = _make_args(tmp_path, tmp_path / "test.db")
            client = _mock_client(raises={"1": KeyboardInterrupt()})

            def fake_write_summary(_summary: object, _artifacts_dir: Path) -> None:
                raise DatabaseError("summary write failed during interrupt handling")

            monkeypatch.setattr(
                "ado_git_repo_insights.cli._write_backfill_run_summary",
                fake_write_summary,
            )

            with pytest.raises(KeyboardInterrupt):
                _run_backfill(args, client=client)
        finally:
            pass

    def test_signal_mid_iteration_rolls_back_affected_pr(self, tmp_path: Path) -> None:
        db = _create_backfill_db(tmp_path)
        try:
            _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
            _insert_pr(db, "p2", pr_id=2, closed_date="2026-01-02T00:00:00Z")
            _insert_pr(db, "p3", pr_id=3, closed_date="2026-01-03T00:00:00Z")
            db.close()

            args = _make_args(tmp_path, tmp_path / "test.db")
            # KeyboardInterrupt during PR2's fetch. PR1 already committed.
            client = _mock_client(
                per_pr={"1": [_make_thread(10)]},
                raises={"2": KeyboardInterrupt()},
            )

            with pytest.raises(KeyboardInterrupt):
                _run_backfill(args, client=client)

            db2 = DatabaseManager(tmp_path / "test.db")
            db2.connect()
            try:

                def _stamp(uid: str) -> str | None:
                    row = db2.execute(
                        "SELECT comments_extracted_at FROM pull_requests "
                        "WHERE pull_request_uid=?",
                        (uid,),
                    ).fetchone()
                    return row["comments_extracted_at"] if row else None

                assert _stamp("p1") is not None
                assert _stamp("p2") is None
                assert _stamp("p3") is None

                remaining = _select_uncovered_prs_for_backfill(
                    db2, "org", [], None, None, 0
                )
                remaining_uids = {str(r["pull_request_uid"]) for r in remaining}
                assert "p2" in remaining_uids
                assert "p3" in remaining_uids
            finally:
                db2.close()
        finally:
            pass


# ---------------------------------------------------------------------------
# #11-12 FilterParsingParity
# ---------------------------------------------------------------------------


class TestFilterParsingParity:
    """FR-030d: extract and backfill parse identically via shared helpers."""

    @pytest.mark.parametrize(("raw", "expected"), _PROJECTS_CORPUS)
    def test_projects_parser_matches_extract_on_corpus(
        self, raw: str, expected: list[str]
    ) -> None:
        assert _parse_projects_list(raw) == expected

    @pytest.mark.parametrize(("raw", "valid"), _DATE_CORPUS)
    def test_date_parser_matches_extract_on_corpus(self, raw: str, valid: bool) -> None:
        if valid:
            # Accept: returns a date object, no raise.
            result = _parse_iso_date(raw)
            assert isinstance(result, date)
        else:
            with pytest.raises(ValueError, match=r".*"):
                _parse_iso_date(raw)


# ---------------------------------------------------------------------------
# #14 ProgressLogOrdering
# ---------------------------------------------------------------------------


class TestProgressLogOrdering:
    """FR-018c: progress line reflects post-commit/post-rollback outcome."""

    def test_commit_failure_mid_loop_logs_failed_not_processed(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        db = _create_backfill_db(tmp_path)
        try:
            _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
            _insert_pr(db, "p2", pr_id=2, closed_date="2026-01-02T00:00:00Z")
            _insert_pr(db, "p3", pr_id=3, closed_date="2026-01-03T00:00:00Z")
            db.close()

            args = _make_args(tmp_path, tmp_path / "test.db")
            client = _mock_client(
                per_pr={
                    "1": [_make_thread(10)],
                    "3": [_make_thread(30)],
                },
                raises={"2": ExtractionError("transient error")},
            )
            with caplog.at_level("INFO"):
                exit_code, _ = _run_backfill(args, client=client)
            assert exit_code == 0

            lines = [r.getMessage() for r in caplog.records]
            p2_lines = [line for line in lines if "PR p2" in line]
            assert any("[Failed]" in line for line in p2_lines), (
                f"Expected [Failed] line for p2; got: {p2_lines}"
            )
            p1_lines = [line for line in lines if "PR p1" in line]
            assert any("[Processed]" in line for line in p1_lines), (
                f"Expected [Processed] line for p1; got: {p1_lines}"
            )
        finally:
            pass


# ---------------------------------------------------------------------------
# #15-16 LegacySchemaDiscriminator
# ---------------------------------------------------------------------------


class TestLegacySchemaDiscriminator:
    """FR-017 + FR-017a: legacy-schema-skip invariants."""

    def test_true_legacy_db_is_detected_before_connect_migrates(
        self, tmp_path: Path
    ) -> None:
        db_path = tmp_path / "legacy-pre-migration.db"
        _create_raw_backfill_schema(
            db_path,
            include_pull_requests=True,
            include_pr_threads=False,
            include_pr_comments=False,
        )

        args = _make_args(tmp_path, db_path)
        exit_code, artifact = _run_backfill(args)

        assert exit_code == 0
        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        assert any(
            isinstance(w, str)
            and w.startswith("backfill-comments: legacy-schema-skip:")
            for w in warnings
        ), warnings

        conn = sqlite3.connect(str(db_path))
        try:
            present = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master "
                    "WHERE type='table' AND name IN ('pr_threads', 'pr_comments')"
                ).fetchall()
            }
        finally:
            conn.close()
        assert present == set(), present

    def test_legacy_schema_emits_skip_prefix_warning(self, tmp_path: Path) -> None:
        db_path = tmp_path / "legacy.db"
        db = DatabaseManager(db_path)
        db.connect()
        # Drop the thread tables to simulate legacy schema.
        db.execute("DROP TABLE IF EXISTS pr_comments")
        db.execute("DROP TABLE IF EXISTS pr_threads")
        db.connection.commit()
        db.close()

        args = _make_args(tmp_path, db_path)
        exit_code, artifact = _run_backfill(args)
        assert exit_code == 0

        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        skip_entries = [
            w
            for w in warnings
            if isinstance(w, str)
            and w.startswith("backfill-comments: legacy-schema-skip:")
        ]
        assert len(skip_entries) == 1, warnings
        assert "pr_threads" in skip_entries[0]
        assert "pr_comments" in skip_entries[0]

    def test_empty_selection_does_not_emit_skip_prefix(self, tmp_path: Path) -> None:
        db = _create_backfill_db(tmp_path)
        # Modern schema, zero uncovered completed PRs.
        db.close()

        args = _make_args(tmp_path, tmp_path / "test.db")
        exit_code, artifact = _run_backfill(args)
        assert exit_code == 0

        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        assert not any(
            isinstance(w, str) and "legacy-schema-skip:" in w for w in warnings
        )
        loop_entries = [
            w
            for w in warnings
            if isinstance(w, str) and w.startswith("backfill-comments: loop-complete:")
        ]
        assert len(loop_entries) == 1, warnings

    def test_only_pr_threads_present_fails_as_database_error(
        self, tmp_path: Path
    ) -> None:
        db_path = tmp_path / "test.db"
        db = _create_backfill_db(tmp_path)
        db.execute("DROP TABLE IF EXISTS pr_comments")
        db.connection.commit()
        db.close()

        args = _make_args(tmp_path, db_path)
        exit_code, artifact = _run_backfill(args)

        assert exit_code == 1
        assert artifact.get("final_status") == "failed"
        fatal = str(artifact.get("first_fatal_error", ""))
        assert fatal.startswith("Database error:"), fatal
        assert "missing table: pr_comments" in fatal, fatal
        assert "present table: pr_threads" in fatal, fatal
        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        assert not any(
            isinstance(w, str) and "legacy-schema-skip:" in w for w in warnings
        ), warnings

    def test_partial_raw_schema_fails_before_connect_migrates(
        self, tmp_path: Path
    ) -> None:
        db_path = tmp_path / "partial-pre-migration.db"
        _create_raw_backfill_schema(
            db_path,
            include_pull_requests=True,
            include_pr_threads=True,
            include_pr_comments=False,
        )

        args = _make_args(tmp_path, db_path)
        exit_code, artifact = _run_backfill(args)

        assert exit_code == 1
        fatal = str(artifact.get("first_fatal_error", ""))
        assert fatal.startswith("Database error:"), fatal
        assert "missing table: pr_comments" in fatal, fatal
        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        assert not any(
            isinstance(w, str) and "legacy-schema-skip:" in w for w in warnings
        ), warnings

        conn = sqlite3.connect(str(db_path))
        try:
            present = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master "
                    "WHERE type='table' AND name IN ('pr_threads', 'pr_comments')"
                ).fetchall()
            }
        finally:
            conn.close()
        assert present == {"pr_threads"}, present

    def test_only_pr_comments_present_fails_as_database_error(
        self, tmp_path: Path
    ) -> None:
        db_path = tmp_path / "test.db"
        db = _create_backfill_db(tmp_path)
        db.execute("DROP TABLE IF EXISTS pr_threads")
        db.connection.commit()
        db.close()

        args = _make_args(tmp_path, db_path)
        exit_code, artifact = _run_backfill(args)

        assert exit_code == 1
        assert artifact.get("final_status") == "failed"
        fatal = str(artifact.get("first_fatal_error", ""))
        assert fatal.startswith("Database error:"), fatal
        assert "missing table: pr_threads" in fatal, fatal
        assert "present table: pr_comments" in fatal, fatal
        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        assert not any(
            isinstance(w, str) and "legacy-schema-skip:" in w for w in warnings
        ), warnings

    def test_missing_pull_requests_is_not_legacy_schema(self, tmp_path: Path) -> None:
        db = _create_backfill_db(tmp_path)
        db.execute("DROP TABLE IF EXISTS pr_comments")
        db.execute("DROP TABLE IF EXISTS pr_threads")
        db.execute("DROP TABLE IF EXISTS pull_requests")
        db.connection.commit()

        with pytest.raises(DatabaseError) as exc_info:
            _legacy_schema_missing_thread_tables(db)

        message = str(exc_info.value)
        assert "pull_requests" in message
        assert "recognized extracted insights database" in message
        db.close()

    def test_schema_probe_sqlite_failures_are_normalized(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _create_backfill_db(tmp_path)

        def explode(*args: object, **kwargs: object) -> object:
            raise sqlite3.DatabaseError("schema probe exploded")

        monkeypatch.setattr(db, "execute", explode)

        with pytest.raises(DatabaseError) as exc_info:
            _legacy_schema_missing_thread_tables(db)

        assert (
            str(exc_info.value)
            == "backfill-comments could not inspect database schema: schema probe exploded"
        )
        db.close()


# ---------------------------------------------------------------------------
# #17-19 NoImplicitSafetyClaims
# ---------------------------------------------------------------------------


def _scan_forbidden(text: str) -> list[str]:
    """Return list of forbidden matches in *text* (FR-024a)."""
    violations: list[str] = []
    for pattern in _FORBIDDEN_UNCONDITIONAL:
        for m in pattern.finditer(text):
            violations.append(f"{pattern.pattern}: {m.group(0)!r}")
    for m in _FORBIDDEN_ATOMIC.finditer(text):
        violations.append(f"atomic (unqualified): {m.group(0)!r}")
    for m in _FORBIDDEN_COMPLETE.finditer(text):
        violations.append(f"complete (unqualified): {m.group(0)!r}")
    for m in _FORBIDDEN_RESUMABLE.finditer(text):
        # Accept resumable iff qualified by FR-012/FR-013 / per-PR commit
        start = max(0, m.start() - 120)
        end = min(len(text), m.end() + 120)
        window = text[start:end]
        if not (
            "per-PR commit boundary" in window
            or "FR-012" in window
            or "FR-013" in window
        ):
            violations.append(f"resumable (unqualified): {m.group(0)!r}")
    return violations


class TestNoImplicitSafetyClaims:
    """FR-024a: no unqualified thread-safe / concurrent / atomic / complete /
    resumable in help, logs, or artifact prose."""

    def test_help_output_has_no_forbidden_claims(self) -> None:
        parser = create_parser()
        help_text = parser.format_help()
        # Also include the backfill subparser's help.
        import io
        from contextlib import redirect_stdout

        buf = io.StringIO()
        with redirect_stdout(buf):
            try:
                parser.parse_args(["backfill-comments", "--help"])
            except SystemExit:
                pass
        combined = help_text + "\n" + buf.getvalue()
        violations = _scan_forbidden(combined)
        assert violations == [], violations

    def test_log_stream_has_no_forbidden_claims(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
        _insert_pr(db, "p2", pr_id=2, closed_date="2026-01-02T00:00:00Z")
        _insert_pr(db, "p3", pr_id=3, closed_date="2026-01-03T00:00:00Z")
        db.close()

        args = _make_args(tmp_path, tmp_path / "test.db")
        client = _mock_client(
            per_pr={"1": [_make_thread(10)], "3": [_make_thread(30)]},
            raises={"2": ExtractionError("transient")},
        )
        with caplog.at_level("INFO"):
            _run_backfill(args, client=client)

        log_text = "\n".join(r.getMessage() for r in caplog.records)
        violations = _scan_forbidden(log_text)
        assert violations == [], violations

    def test_artifact_has_no_forbidden_claims(self, tmp_path: Path) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
        db.close()

        args = _make_args(tmp_path, tmp_path / "test.db")
        _, artifact = _run_backfill(args)
        blob = json.dumps(artifact)
        violations = _scan_forbidden(blob)
        assert violations == [], violations


# ---------------------------------------------------------------------------
# #19a BackfillWarningEmissionParity (AST scan)
# ---------------------------------------------------------------------------


class TestBackfillWarningEmissionParity:
    """Plan §4 shared-helper invariant: the prefix literal appears only in
    the sanctioned locations."""

    def test_discriminator_prefix_literal_appears_only_inside_helper(self) -> None:
        import ado_git_repo_insights.cli as cli_mod

        src = Path(cli_mod.__file__).read_text(encoding="utf-8")
        tree = ast.parse(src)

        prefix = "backfill-comments: "
        violations: list[tuple[int, str]] = []

        # Build an id(node) → parent map instead of mutating nodes in place
        # (QG-41 forbids inline suppressions; ast nodes have no parent slot).
        parents: dict[int, ast.AST] = {}
        for parent in ast.walk(tree):
            for child in ast.iter_child_nodes(parent):
                parents[id(child)] = parent

        class Visitor(ast.NodeVisitor):
            def __init__(self) -> None:
                self._enclosing: list[str] = []

            def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
                self._enclosing.append(node.name)
                self.generic_visit(node)
                self._enclosing.pop()

            def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
                self._enclosing.append(node.name)
                self.generic_visit(node)
                self._enclosing.pop()

            def visit_ClassDef(self, node: ast.ClassDef) -> None:
                self._enclosing.append(node.name)
                self.generic_visit(node)
                self._enclosing.pop()

            def _check(
                self, value: object, lineno: int, parent: ast.AST | None
            ) -> None:
                if not isinstance(value, str) or prefix not in value:
                    return
                if (
                    self._enclosing
                    and self._enclosing[-1] == "_append_backfill_warning"
                ):
                    return
                # Accept the _BACKFILL_WARNING_PREFIX constant assignment.
                if isinstance(parent, ast.Assign) and any(
                    isinstance(t, ast.Name) and t.id == "_BACKFILL_WARNING_PREFIX"
                    for t in parent.targets
                ):
                    return
                violations.append((lineno, value[:60]))

            def visit_Constant(self, node: ast.Constant) -> None:
                self._check(node.value, node.lineno, parents.get(id(node)))
                self.generic_visit(node)

        Visitor().visit(tree)
        assert violations == [], (
            f"Discriminator prefix leaked outside helper: {violations}"
        )


# ---------------------------------------------------------------------------
# #20-24 CoverageMarkerInvariants
# ---------------------------------------------------------------------------


def _read_marker(db: DatabaseManager, uid: str) -> str | None:
    row = db.execute(
        "SELECT comments_extracted_at FROM pull_requests WHERE pull_request_uid=?",
        (uid,),
    ).fetchone()
    return row["comments_extracted_at"] if row else None


class TestCoverageMarkerInvariants:
    """FR-031: per-PR stamp branches under backfill's 2-outcome rule."""

    def test_full_success_branch_sets_stamp(self, tmp_path: Path) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1)
        db.close()

        args = _make_args(tmp_path, tmp_path / "test.db", max_threads=0)
        client = _mock_client(per_pr={"1": [_make_thread(10), _make_thread(20)]})
        _run_backfill(args, client=client)

        db2 = DatabaseManager(tmp_path / "test.db")
        db2.connect()
        try:
            assert _read_marker(db2, "p1") is not None
        finally:
            db2.close()

    def test_truncation_verified_complete_preiteration_null_sets_stamp(
        self, tmp_path: Path
    ) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1)

        repo = PRRepository(db)
        # Pre-store all threads locally with current last_updated.
        for tid in (1, 2, 3):
            repo.upsert_thread(
                thread_id=str(tid),
                pull_request_uid="p1",
                status="active",
                thread_context=None,
                last_updated="2026-01-16T00:00:00Z",
                created_at="2026-01-16T00:00:00Z",
                is_deleted=False,
            )
        db.connection.commit()
        db.close()

        args = _make_args(tmp_path, tmp_path / "test.db", max_threads=1)
        # API returns 3 threads; cap 1 → truncated, dropped threads all stored.
        client = _mock_client(
            per_pr={
                "1": [
                    _make_thread(1),
                    _make_thread(2),
                    _make_thread(3),
                ]
            }
        )
        _run_backfill(args, client=client)

        db2 = DatabaseManager(tmp_path / "test.db")
        db2.connect()
        try:
            assert _read_marker(db2, "p1") is not None
        finally:
            db2.close()

    def test_truncation_verified_complete_preiteration_set_keeps_or_refreshes_stamp(
        self, tmp_path: Path
    ) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1)
        db.execute(
            "UPDATE pull_requests SET comments_extracted_at = ? "
            "WHERE pull_request_uid = 'p1'",
            ("2025-12-01T00:00:00Z",),
        )
        db.connection.commit()
        # NOTE: backfill only selects uncovered PRs (marker IS NULL). A
        # pre-set marker means the PR is not in the selection set; the
        # marker is preserved trivially by virtue of being un-iterated.
        # This test locks that the selection predicate excludes covered PRs.
        db.close()

        args = _make_args(tmp_path, tmp_path / "test.db")
        _run_backfill(args)

        db2 = DatabaseManager(tmp_path / "test.db")
        db2.connect()
        try:
            marker = _read_marker(db2, "p1")
            assert marker is not None  # preserved
        finally:
            db2.close()

    def test_truncation_clear_branch_leaves_marker_null(self, tmp_path: Path) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1)
        db.close()

        args = _make_args(tmp_path, tmp_path / "test.db", max_threads=1)
        # API returns 3 threads; cap 1 → truncated; dropped threads NOT
        # present locally → leave marker unchanged (still NULL).
        client = _mock_client(
            per_pr={
                "1": [
                    _make_thread(1),
                    _make_thread(2, updated="2026-01-20T00:00:00Z"),
                    _make_thread(3, updated="2026-01-21T00:00:00Z"),
                ]
            }
        )
        _run_backfill(args, client=client)

        db2 = DatabaseManager(tmp_path / "test.db")
        db2.connect()
        try:
            assert _read_marker(db2, "p1") is None
            # Re-invocation reselects this PR.
            remaining = _select_uncovered_prs_for_backfill(
                db2, "org", [], None, None, 0
            )
            remaining_uids = {str(r["pull_request_uid"]) for r in remaining}
            assert "p1" in remaining_uids
        finally:
            db2.close()

    def test_non_fatal_error_branch_leaves_marker_unchanged(
        self, tmp_path: Path
    ) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1)
        db.close()

        args = _make_args(tmp_path, tmp_path / "test.db")
        client = _mock_client(raises={"1": ExtractionError("API down")})
        exit_code, _ = _run_backfill(args, client=client)
        assert exit_code == 0

        db2 = DatabaseManager(tmp_path / "test.db")
        db2.connect()
        try:
            assert _read_marker(db2, "p1") is None
            remaining = _select_uncovered_prs_for_backfill(
                db2, "org", [], None, None, 0
            )
            remaining_uids = {str(r["pull_request_uid"]) for r in remaining}
            assert "p1" in remaining_uids
        finally:
            db2.close()


# ---------------------------------------------------------------------------
# #25-28 EndToEnd
# ---------------------------------------------------------------------------


class TestEndToEnd:
    """FR-032: end-to-end scenarios."""

    def test_happy_path_drains_uncovered_prs(self, tmp_path: Path) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
        _insert_pr(db, "p2", pr_id=2, closed_date="2026-01-02T00:00:00Z")
        _insert_pr(db, "p3", pr_id=3, closed_date="2026-01-03T00:00:00Z")
        db.close()

        args = _make_args(tmp_path, tmp_path / "test.db", max_threads=0)
        client = _mock_client(
            per_pr={
                "1": [_make_thread(10)],
                "2": [_make_thread(20)],
                "3": [_make_thread(30)],
            }
        )
        exit_code, artifact = _run_backfill(args, client=client)
        assert exit_code == 0
        counts = artifact.get("counts")
        assert isinstance(counts, dict)
        assert counts.get("prs_updated") == 3
        assert artifact.get("final_status") == "success"

    def test_partial_failure_continues_loop_and_exits_zero(
        self, tmp_path: Path
    ) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
        _insert_pr(db, "p2", pr_id=2, closed_date="2026-01-02T00:00:00Z")
        _insert_pr(db, "p3", pr_id=3, closed_date="2026-01-03T00:00:00Z")
        db.close()

        args = _make_args(tmp_path, tmp_path / "test.db", max_threads=0)
        client = _mock_client(
            per_pr={
                "1": [_make_thread(10)],
                "3": [_make_thread(30)],
            },
            raises={"2": ExtractionError("rate-limited")},
        )
        exit_code, artifact = _run_backfill(args, client=client)
        assert exit_code == 0
        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        failed_entries = [
            w for w in warnings if isinstance(w, str) and "failed to process PR p2" in w
        ]
        loop_entries = [
            w for w in warnings if isinstance(w, str) and "loop-complete:" in w
        ]
        assert len(failed_entries) == 1
        assert len(loop_entries) == 1

    def test_resumability_zero_api_calls_on_drained_fixture(
        self, tmp_path: Path
    ) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1, covered=True)
        _insert_pr(db, "p2", pr_id=2, covered=True)
        _insert_pr(db, "p3", pr_id=3, covered=True)
        db.close()

        args = _make_args(tmp_path, tmp_path / "test.db")
        client = _mock_client()
        exit_code, artifact = _run_backfill(args, client=client)
        assert exit_code == 0
        assert client.get_pr_threads.call_count == 0

        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        loop_entries = [
            w for w in warnings if isinstance(w, str) and "loop-complete:" in w
        ]
        assert len(loop_entries) == 1
        assert "processed=0" in loop_entries[0]
        assert "failed=0" in loop_entries[0]

    def test_legacy_schema_successful_no_op_full_artifact(self, tmp_path: Path) -> None:
        db_path = tmp_path / "legacy.db"
        db = DatabaseManager(db_path)
        db.connect()
        db.execute("DROP TABLE IF EXISTS pr_comments")
        db.execute("DROP TABLE IF EXISTS pr_threads")
        db.connection.commit()
        db.close()

        args = _make_args(tmp_path, db_path)
        exit_code, artifact = _run_backfill(args)
        assert exit_code == 0
        assert artifact.get("final_status") == "success"
        assert artifact.get("first_fatal_error") is None
        counts = artifact.get("counts")
        assert isinstance(counts, dict)
        assert counts.get("prs_fetched") == 0
        assert counts.get("prs_updated") == 0

    def test_projectless_invocation_succeeds(self, tmp_path: Path) -> None:
        """FR-004 + contracts/cli-subcommand.md §4.4: ``--projects`` is
        optional ("no filter — all projects eligible"). Locks the
        projectless contract against ``Config.__post_init__``'s
        project-required validation, which ``cmd_backfill_comments``
        deliberately bypasses by building its own minimal config inline.
        """
        db = _create_backfill_db(tmp_path)
        _insert_pr(
            db,
            "p1",
            pr_id=1,
            project="ProjectA",
            closed_date="2026-01-01T00:00:00Z",
        )
        _insert_pr(
            db,
            "p2",
            pr_id=2,
            project="ProjectB",
            repo="r2",
            closed_date="2026-01-02T00:00:00Z",
        )
        db.close()

        # projects=None mirrors the documented default invocation.
        args = _make_args(
            tmp_path,
            tmp_path / "test.db",
            projects=None,
            max_threads=0,
        )
        client = _mock_client(
            per_pr={
                "1": [_make_thread(10)],
                "2": [_make_thread(20)],
            }
        )
        exit_code, artifact = _run_backfill(args, client=client)

        assert exit_code == 0, artifact
        assert artifact.get("first_fatal_error") is None
        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        for entry in warnings:
            if isinstance(entry, str):
                assert "At least one project is required" not in entry, entry
        counts = artifact.get("counts")
        assert isinstance(counts, dict)
        assert counts.get("prs_updated") == 2

    def test_mixed_org_db_scopes_to_requested_organization_without_abort(
        self, tmp_path: Path
    ) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "org-a", pr_id=1, project="ProjectA", repo="r1")
        db.execute("INSERT INTO organizations (organization_name) VALUES ('other')")
        db.execute(
            "INSERT INTO projects (organization_name, project_name) "
            "VALUES ('other', 'ProjectA')"
        )
        db.execute(
            "INSERT INTO repositories "
            "(repository_id, repository_name, project_name, organization_name) "
            "VALUES ('r-other', 'repo-other', 'ProjectA', 'other')"
        )
        db.execute(
            "INSERT INTO pull_requests "
            "(pull_request_uid, pull_request_id, organization_name, project_name, "
            "repository_id, user_id, title, status, creation_date, closed_date, "
            "comments_extracted_at) VALUES "
            "('org-b', 2, 'other', 'ProjectA', 'r-other', 'u1', 'PR', "
            "'completed', '2026-01-15T10:00:00Z', '2026-01-16T10:00:00Z', NULL)"
        )
        db.connection.commit()
        db.close()

        args = _make_args(tmp_path, tmp_path / "test.db", max_threads=0)
        client = _mock_client(per_pr={"1": [_make_thread(10)]})
        exit_code, artifact = _run_backfill(args, client=client)

        assert exit_code == 0, artifact
        client.test_organization_connection.assert_called_once_with()
        assert client.get_pr_threads.call_count == 1
        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        assert all(
            "requested organization 'org'" not in str(entry) for entry in warnings
        ), warnings
        counts = artifact.get("counts")
        assert isinstance(counts, dict)
        assert counts.get("prs_updated") == 1

        db2 = DatabaseManager(tmp_path / "test.db")
        db2.connect()
        try:
            assert _read_marker(db2, "org-a") is not None
            assert _read_marker(db2, "org-b") is None
            remaining = _select_uncovered_prs_for_backfill(
                db2, "other", [], None, None, 0
            )
            assert [str(r["pull_request_uid"]) for r in remaining] == ["org-b"]
        finally:
            db2.close()

    def test_backfill_persists_comments_metadata_and_coverage_state(
        self, tmp_path: Path
    ) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
        _insert_pr(db, "p2", pr_id=2, closed_date="2026-01-02T00:00:00Z")
        db.close()

        args = _make_args(tmp_path, tmp_path / "test.db", limit=1, max_threads=0)
        client = _mock_client(per_pr={"1": [_make_thread(10)]})
        exit_code, artifact = _run_backfill(args, client=client)

        assert exit_code == 0, artifact

        db2 = DatabaseManager(tmp_path / "test.db")
        db2.connect()
        try:
            row = db2.execute(
                """
                SELECT prs_processed, threads_fetched, comments_fetched, capped
                FROM comments_extraction_metadata
                WHERE id = 1
                """
            ).fetchone()
            assert row is not None
            assert int(row["prs_processed"]) == 1
            assert int(row["threads_fetched"]) == 1
            assert int(row["comments_fetched"]) == 1
            assert int(row["capped"]) == 1

            manifest = AggregateGenerator(db2, tmp_path / "output").generate_all()
            comments = manifest.coverage["comments"]
            assert isinstance(comments, dict)
            assert comments["status"] == "partial"
            assert comments["capped"] is True
        finally:
            db2.close()


class TestBackfillRunSummaryDateRange:
    """Regression coverage for backfill-only artifact date serialization."""

    def test_no_bounds_preserves_empty_strings_and_full_artifact_shape(
        self, tmp_path: Path
    ) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
        db.close()

        args = _make_args(tmp_path, tmp_path / "test.db", max_threads=0)
        client = _mock_client(per_pr={"1": [_make_thread(10)]})
        exit_code, artifact = _run_backfill(args, client=client)

        assert exit_code == 0
        date_range = artifact.get("date_range")
        assert isinstance(date_range, dict)
        assert date_range.get("start") == ""
        assert date_range.get("end") == ""
        assert artifact.get("final_status") == "success"
        counts = artifact.get("counts")
        assert isinstance(counts, dict)
        assert counts.get("prs_updated") == 1

    def test_since_only_preserves_unset_end_as_empty_string(
        self, tmp_path: Path
    ) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
        db.close()

        args = _make_args(
            tmp_path,
            tmp_path / "test.db",
            since=date(2026, 1, 1),
            max_threads=0,
        )
        client = _mock_client(per_pr={"1": [_make_thread(10)]})
        exit_code, artifact = _run_backfill(args, client=client)

        assert exit_code == 0
        date_range = artifact.get("date_range")
        assert isinstance(date_range, dict)
        assert date_range.get("start") == "2026-01-01"
        assert date_range.get("end") == ""

    def test_until_only_preserves_unset_start_as_empty_string(
        self, tmp_path: Path
    ) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(db, "p1", pr_id=1, closed_date="2026-01-01T00:00:00Z")
        db.close()

        args = _make_args(
            tmp_path,
            tmp_path / "test.db",
            until=date(2026, 6, 1),
            max_threads=0,
        )
        client = _mock_client(per_pr={"1": [_make_thread(10)]})
        exit_code, artifact = _run_backfill(args, client=client)

        assert exit_code == 0
        date_range = artifact.get("date_range")
        assert isinstance(date_range, dict)
        assert date_range.get("start") == ""
        assert date_range.get("end") == "2026-06-01"


class TestBackfillDatabasePreconditions:
    """Backfill requires an existing, non-empty extracted database."""

    def test_missing_database_fails_before_connect(self, tmp_path: Path) -> None:
        db_path = tmp_path / "missing.db"
        args = _make_args(tmp_path, db_path)
        artifact_path = args.artifacts_dir / "run_summary.json"

        with patch(
            "ado_git_repo_insights.extractor.ado_client.ADOClient"
        ) as ado_client_cls:
            exit_code = cmd_backfill_comments(args)

        assert exit_code == 1
        assert not db_path.exists()
        ado_client_cls.assert_not_called()
        artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        assert artifact.get("final_status") == "failed"
        assert "database not found" in str(artifact.get("first_fatal_error", ""))

    def test_zero_byte_database_fails_before_connect(self, tmp_path: Path) -> None:
        db_path = tmp_path / "empty.db"
        db_path.write_bytes(b"")
        args = _make_args(tmp_path, db_path)
        artifact_path = args.artifacts_dir / "run_summary.json"

        with patch(
            "ado_git_repo_insights.extractor.ado_client.ADOClient"
        ) as ado_client_cls:
            exit_code = cmd_backfill_comments(args)

        assert exit_code == 1
        assert db_path.exists()
        assert db_path.stat().st_size == 0
        ado_client_cls.assert_not_called()
        artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        assert artifact.get("final_status") == "failed"
        assert "database is empty" in str(artifact.get("first_fatal_error", ""))

    def test_directory_path_fails_before_connect(self, tmp_path: Path) -> None:
        db_path = tmp_path / "not-a-file"
        db_path.mkdir()
        args = _make_args(tmp_path, db_path)
        artifact_path = args.artifacts_dir / "run_summary.json"

        with patch(
            "ado_git_repo_insights.extractor.ado_client.ADOClient"
        ) as ado_client_cls:
            exit_code = cmd_backfill_comments(args)

        assert exit_code == 1
        assert db_path.is_dir()
        ado_client_cls.assert_not_called()
        artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        assert artifact.get("final_status") == "failed"
        assert "not a file" in str(artifact.get("first_fatal_error", ""))

    def test_oserror_during_preflight_routes_through_site_d2(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Regression lock: if ``Path.exists`` / ``is_file`` / ``stat`` raise
        ``OSError`` during the DB preflight (permission denied on the parent
        directory, disconnected network drive, symlink loop, path too long),
        the failure MUST surface as ``DatabaseError`` and route through Site
        D2. Without the wrap, the raw ``OSError`` escapes to Site D5's
        generic ``except Exception`` branch, and the artifact loses the
        ``"Database error:"`` prefix the contract guarantees for unopenable
        databases.
        """
        db_path = tmp_path / "cursed.db"
        db_path.write_bytes(b"\x00")  # exists + nonzero, but preflight will raise
        args = _make_args(tmp_path, db_path)
        artifact_path = args.artifacts_dir / "run_summary.json"

        real_exists = Path.exists

        def fake_exists(self: Path) -> bool:
            if self == db_path:
                raise PermissionError("simulated permission denied on parent")
            return real_exists(self)

        monkeypatch.setattr(Path, "exists", fake_exists)

        with patch(
            "ado_git_repo_insights.extractor.ado_client.ADOClient"
        ) as ado_client_cls:
            exit_code = cmd_backfill_comments(args)

        assert exit_code == 1
        ado_client_cls.assert_not_called()
        artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        assert artifact.get("final_status") == "failed"
        fatal = str(artifact.get("first_fatal_error", ""))
        # Site D2 (not D5) — the artifact MUST carry the "Database error:"
        # prefix and the specific "could not inspect" phrase from the wrap.
        assert fatal.startswith("Database error:"), fatal
        assert "could not inspect" in fatal, fatal
        # Confirm the underlying OSError cause propagated through str().
        assert "simulated permission denied" in fatal, fatal

    def test_arbitrary_sqlite_file_never_emits_legacy_skip(
        self, tmp_path: Path
    ) -> None:
        db_path = tmp_path / "wrong.db"
        with sqlite3.connect(str(db_path)) as conn:
            conn.execute("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)")

        args = _make_args(tmp_path, db_path)
        exit_code, artifact = _run_backfill(args)

        assert exit_code == 1
        fatal = str(artifact.get("first_fatal_error", ""))
        assert fatal.startswith("Database error:"), fatal
        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        assert not any(
            isinstance(w, str) and "legacy-schema-skip:" in w for w in warnings
        ), warnings

    def test_non_database_file_routes_through_database_error(
        self, tmp_path: Path
    ) -> None:
        db_path = tmp_path / "garbage.db"
        db_path.write_bytes(b"this is not sqlite")

        args = _make_args(tmp_path, db_path)
        exit_code, artifact = _run_backfill(args)

        assert exit_code == 1
        fatal = str(artifact.get("first_fatal_error", ""))
        assert fatal.startswith("Database error:"), fatal
        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        assert not any(
            isinstance(w, str) and "legacy-schema-skip:" in w for w in warnings
        ), warnings

    def test_raw_schema_probe_routes_through_database_error(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _create_backfill_db(tmp_path)
        db.close()

        real_connect = sqlite3.connect

        class _ProbeConn:
            def __init__(self, inner: sqlite3.Connection) -> None:
                self._inner = inner

            def execute(self, sql: str) -> Cursor:
                if (
                    "sqlite_master" in sql
                    and "pr_threads" in sql
                    and "pr_comments" in sql
                ):
                    raise sqlite3.DatabaseError("schema probe exploded")
                return self._inner.execute(sql)

            def close(self) -> None:
                self._inner.close()

        def fake_connect(database: str) -> _ProbeConn:
            return _ProbeConn(real_connect(database))

        monkeypatch.setattr("ado_git_repo_insights.cli.sqlite3.connect", fake_connect)

        args = _make_args(tmp_path, tmp_path / "test.db")
        exit_code, artifact = _run_backfill(args)

        assert exit_code == 1
        fatal = str(artifact.get("first_fatal_error", ""))
        assert fatal.startswith("Database error:"), fatal
        assert "could not inspect database schema" in fatal, fatal
        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        assert not any(
            isinstance(w, str) and "legacy-schema-skip:" in w for w in warnings
        ), warnings

    def test_post_connect_selection_probe_routes_through_database_error(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _create_backfill_db(tmp_path)
        db.close()

        real_execute = DatabaseManager.execute

        def fake_execute(
            self: DatabaseManager,
            sql: str,
            parameters: tuple[SqliteParam, ...] = (),
        ) -> Cursor:
            if sql.startswith(
                "SELECT pull_request_uid, pull_request_id, repository_id,"
            ):
                raise sqlite3.DatabaseError("selection exploded")
            return real_execute(self, sql, parameters)

        monkeypatch.setattr(DatabaseManager, "execute", fake_execute)

        args = _make_args(tmp_path, tmp_path / "test.db")
        exit_code, artifact = _run_backfill(args)

        assert exit_code == 1
        fatal = str(artifact.get("first_fatal_error", ""))
        assert fatal.startswith("Database error:"), fatal
        assert "could not select candidate pull requests" in fatal, fatal

    def test_connect_oserror_routes_through_site_d2(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _create_backfill_db(tmp_path)
        db.close()

        def fake_connect(self: DatabaseManager) -> None:
            raise PermissionError("connect parent mkdir denied")

        monkeypatch.setattr(DatabaseManager, "connect", fake_connect)

        args = _make_args(tmp_path, tmp_path / "test.db")
        exit_code, artifact = _run_backfill(args)

        assert exit_code == 1
        fatal = str(artifact.get("first_fatal_error", ""))
        assert fatal.startswith("Database error:"), fatal
        assert "could not connect to the database" in fatal, fatal
        assert "connect parent mkdir denied" in fatal, fatal

    def test_review_timestamp_recompute_sqlite_error_routes_through_site_d2(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _create_backfill_db(tmp_path)
        db.close()

        def fake_recompute(_db: DatabaseManager) -> None:
            raise sqlite3.DatabaseError("review timestamp recompute exploded")

        monkeypatch.setattr(
            "ado_git_repo_insights.cli._backfill_review_timestamps_if_needed",
            fake_recompute,
        )

        args = _make_args(tmp_path, tmp_path / "test.db")
        exit_code, artifact = _run_backfill(args)

        assert exit_code == 1
        fatal = str(artifact.get("first_fatal_error", ""))
        assert fatal.startswith("Database error:"), fatal
        assert "could not recompute review timestamps" in fatal, fatal
        assert "review timestamp recompute exploded" in fatal, fatal

    def test_run_summary_path_resolution_failure_routes_through_site_d2(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _create_backfill_db(tmp_path)
        db.close()

        from ado_git_repo_insights import cli as cli_mod

        real_safe_join = safe_join
        calls = {"count": 0}

        def fake_safe_join(root: Path, relative: str) -> Path:
            calls["count"] += 1
            if calls["count"] == 1:
                raise ValueError("Path escapes root: run_summary.json")
            return real_safe_join(root, relative)

        monkeypatch.setattr(cli_mod, "safe_join", fake_safe_join)

        args = _make_args(tmp_path, tmp_path / "test.db")
        exit_code, artifact = _run_backfill(args)

        assert exit_code == 1
        fatal = str(artifact.get("first_fatal_error", ""))
        assert fatal.startswith("Database error:"), fatal
        assert "could not resolve run summary artifact path" in fatal, fatal
        assert "Path escapes root" in fatal, fatal
        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        assert not any(
            isinstance(w, str)
            and w == "fatal-abort: Path escapes root: run_summary.json"
            for w in warnings
        ), warnings

    def test_run_summary_write_oserror_routes_through_site_d2(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _create_backfill_db(tmp_path)
        db.close()

        from ado_git_repo_insights.utils.run_summary import RunSummary

        real_write = RunSummary.write
        calls = {"count": 0}

        def fake_write(self: RunSummary, path: Path) -> None:
            calls["count"] += 1
            if calls["count"] == 1:
                raise OSError("disk full during summary write")
            real_write(self, path)

        monkeypatch.setattr(RunSummary, "write", fake_write)

        args = _make_args(tmp_path, tmp_path / "test.db")
        exit_code, artifact = _run_backfill(args)

        assert exit_code == 1
        fatal = str(artifact.get("first_fatal_error", ""))
        assert fatal.startswith("Database error:"), fatal
        assert "could not write run summary artifact" in fatal, fatal
        assert "disk full during summary write" in fatal, fatal
        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        assert not any(
            isinstance(w, str) and w == "fatal-abort: disk full during summary write"
            for w in warnings
        ), warnings

    def test_unexpected_exception_preserved_when_summary_write_fails(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _create_backfill_db(tmp_path)
        db.close()

        def fake_select(
            _db: DatabaseManager,
            _organization: str,
            _projects: list[str],
            _since: date | None,
            _until: date | None,
            _limit: int,
        ) -> list[object]:
            raise RuntimeError("selection blew up unexpectedly")

        def fake_write_summary(_summary: object, _artifacts_dir: Path) -> None:
            raise DatabaseError("summary write failed during D5 handling")

        monkeypatch.setattr(
            "ado_git_repo_insights.cli._select_uncovered_prs_for_backfill",
            fake_select,
        )
        monkeypatch.setattr(
            "ado_git_repo_insights.cli._write_backfill_run_summary",
            fake_write_summary,
        )
        # The pre-loop ADO probe would otherwise fail first (bogus PAT
        # redirects to sign-in) and short-circuit the D5 path under test.
        # Force it to pass so the monkey-patched selection is reached.
        monkeypatch.setattr(
            "ado_git_repo_insights.extractor.ado_client.ADOClient."
            "test_organization_connection",
            lambda self: True,
        )

        args = _make_args(tmp_path, tmp_path / "test.db")
        with pytest.raises(RuntimeError, match="selection blew up unexpectedly"):
            cmd_backfill_comments(args)


# ---------------------------------------------------------------------------
# ConnectionProbe — auth/org pre-loop fatal, project failures in-loop
# ---------------------------------------------------------------------------


class TestPreLoopConnectivity:
    """Auth/org failures are fatal pre-loop; project failures stay in-loop."""

    def test_empty_filtered_snapshot_still_runs_org_probe(self, tmp_path: Path) -> None:
        """A valid org/PAT must still be probed before an empty run succeeds."""
        db = _create_backfill_db(tmp_path)
        # Seed a completed PR outside the --since window. The filtered
        # snapshot is still empty, so no per-PR API call should fire.
        _insert_pr(
            db,
            "old",
            pr_id=1,
            project="ProjectA",
            closed_date="2024-01-01T00:00:00Z",
        )
        db.close()

        args = _make_args(
            tmp_path,
            tmp_path / "test.db",
            since=date(2026, 1, 1),
            until=date(2026, 6, 1),
        )
        client = _mock_client()
        exit_code, artifact = _run_backfill(args, client=client)

        assert exit_code == 0
        client.test_organization_connection.assert_called_once_with()
        assert client.test_connection.call_count == 0
        assert client.get_pr_threads.call_count == 0
        # Full-shape empty-selection artifact.
        counts = artifact.get("counts")
        assert isinstance(counts, dict)
        assert counts.get("prs_updated") == 0

    def test_invalid_org_or_pat_fails_pre_loop_even_when_snapshot_empty(
        self, tmp_path: Path
    ) -> None:
        """Auth/org misconfiguration must fail before reporting a no-op run."""
        db = _create_backfill_db(tmp_path)
        _insert_pr(
            db,
            "old",
            pr_id=1,
            project="ProjectA",
            closed_date="2024-01-01T00:00:00Z",
        )
        db.close()

        args = _make_args(
            tmp_path,
            tmp_path / "test.db",
            since=date(2026, 1, 1),
            until=date(2026, 6, 1),
        )
        client = _mock_client(
            organization_probe_error=ExtractionError("bad PAT or organization")
        )
        exit_code, artifact = _run_backfill(args, client=client)

        assert exit_code == 1
        client.test_organization_connection.assert_called_once_with()
        assert client.get_pr_threads.call_count == 0
        fatal = str(artifact.get("first_fatal_error", ""))
        assert fatal.startswith("Extraction error:"), fatal
        assert "bad PAT or organization" in fatal, fatal

    def test_inaccessible_first_pr_is_recorded_in_loop_and_run_continues(
        self, tmp_path: Path
    ) -> None:
        """A stale/inaccessible first PR must remain a per-PR failure."""
        db = _create_backfill_db(tmp_path)
        _insert_pr(
            db,
            "p1",
            pr_id=1,
            project="ProjectA",
            repo="r1",
            closed_date="2026-01-01T00:00:00Z",
        )
        _insert_pr(
            db,
            "p2",
            pr_id=2,
            project="ProjectB",
            repo="r2",
            closed_date="2026-01-02T00:00:00Z",
        )
        db.close()

        args = _make_args(tmp_path, tmp_path / "test.db", max_threads=0)
        client = _mock_client(
            per_pr={"2": [_make_thread(20)]},
            raises={"1": ExtractionError("project no longer accessible")},
        )
        exit_code, artifact = _run_backfill(args, client=client)

        assert exit_code == 0
        client.test_organization_connection.assert_called_once_with()
        assert client.test_connection.call_count == 0
        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)
        failed_entries = [
            w for w in warnings if isinstance(w, str) and "failed to process PR p1" in w
        ]
        assert len(failed_entries) == 1, warnings
        counts = artifact.get("counts")
        assert isinstance(counts, dict)
        assert counts.get("prs_updated") == 1

        db2 = DatabaseManager(tmp_path / "test.db")
        db2.connect()
        try:
            assert _read_marker(db2, "p1") is None
            assert _read_marker(db2, "p2") is not None
            remaining = _select_uncovered_prs_for_backfill(
                db2, "org", [], None, None, 0
            )
            remaining_uids = {str(r["pull_request_uid"]) for r in remaining}
            assert remaining_uids == {"p1"}
        finally:
            db2.close()

    def test_all_prs_failing_in_loop_still_exits_success(self, tmp_path: Path) -> None:
        """SC-012: a 100%-failure run is a loop-completed run, exit 0.

        Authoritative contract:
          - specs/058-backfill-comments/spec.md:19 Q&A — exit 0 on loop
            completion regardless of per-PR failure rate; non-zero is
            reserved for fatal pre-loop errors.
          - specs/058-backfill-comments/spec.md:346 SC-012 — "A run in which
            every attempted pull request fails still exits with status code
            zero, and its run_summary.json artifact carries counts accurate
            enough for a downstream consumer to enforce its own failure-rate
            policy."
          - contracts/cli-subcommand.md:233 — exit code 0 row includes
            "100%-failure" explicitly.
          - contracts/cli-subcommand.md:271,273 — final_status="success" and
            first_fatal_error=null on every loop-completed run.

        Downstream consumers enforce their own failure-rate policy by
        reading counts.prs_updated and the per-PR failure warnings.
        """
        db = _create_backfill_db(tmp_path)
        _insert_pr(
            db,
            "pr1",
            pr_id=1,
            project="ProjectA",
            repo="r1",
            closed_date="2026-01-01T00:00:00Z",
        )
        _insert_pr(
            db,
            "pr2",
            pr_id=2,
            project="ProjectA",
            repo="r1",
            closed_date="2026-01-02T00:00:00Z",
        )
        db.close()

        args = _make_args(tmp_path, tmp_path / "test.db")
        client = _mock_client(
            raises={
                "1": ExtractionError("ADO API failure"),
                "2": ExtractionError("ADO API failure"),
            }
        )
        exit_code, artifact = _run_backfill(args, client=client)

        # Exit 0 on loop completion.
        assert exit_code == 0
        assert client.get_pr_threads.call_count == 2

        # final_status = "success", first_fatal_error = None on loop-completed
        # runs (contract lines 271 and 273).
        assert artifact.get("final_status") == "success"
        assert artifact.get("first_fatal_error") is None

        # Counts accurate enough for a downstream consumer to enforce its
        # own failure-rate policy (SC-012 verbatim).
        counts = artifact.get("counts")
        assert isinstance(counts, dict)
        assert counts.get("prs_updated") == 0

        warnings = artifact.get("warnings", [])
        assert isinstance(warnings, list)

        # Per-PR failure warnings preserved — one per Failed PR in
        # FR-019b parser-stable form.
        per_pr_failures = [
            w for w in warnings if isinstance(w, str) and "failed to process PR" in w
        ]
        assert len(per_pr_failures) == 2, warnings
        assert any("pr1" in w for w in per_pr_failures), per_pr_failures
        assert any("pr2" in w for w in per_pr_failures), per_pr_failures

        # Exactly one Site C loop-complete warning with processed=0 failed=T.
        loop_complete = [
            w for w in warnings if isinstance(w, str) and "loop-complete:" in w
        ]
        assert len(loop_complete) == 1, warnings
        assert "processed=0" in loop_complete[0]
        assert "failed=2" in loop_complete[0]

        # No fatal-abort warning — this is not a fatal path.
        assert not any(
            isinstance(w, str) and w.startswith("backfill-comments: fatal-abort:")
            for w in warnings
        ), warnings


# ---------------------------------------------------------------------------
# #29-32 FlagValidation
# ---------------------------------------------------------------------------


class TestFlagValidation:
    """FR-010 + FR-033: argparse rejects malformed flags with exit 2."""

    def test_negative_limit_rejected(self) -> None:
        parser = create_parser()
        with pytest.raises(SystemExit) as exc:
            parser.parse_args(
                [
                    "backfill-comments",
                    "--organization",
                    "org",
                    "--pat",
                    "pat",
                    "--limit",
                    "-1",
                ]
            )
        assert exc.value.code == 2

    def test_negative_comments_max_threads_rejected(self) -> None:
        parser = create_parser()
        with pytest.raises(SystemExit) as exc:
            parser.parse_args(
                [
                    "backfill-comments",
                    "--organization",
                    "org",
                    "--pat",
                    "pat",
                    "--comments-max-threads-per-pr",
                    "-1",
                ]
            )
        assert exc.value.code == 2

    def test_malformed_since_rejected(self) -> None:
        parser = create_parser()
        with pytest.raises(SystemExit) as exc:
            parser.parse_args(
                [
                    "backfill-comments",
                    "--organization",
                    "org",
                    "--pat",
                    "pat",
                    "--since",
                    "2024-13-99",
                ]
            )
        assert exc.value.code == 2

    def test_malformed_until_rejected(self) -> None:
        parser = create_parser()
        with pytest.raises(SystemExit) as exc:
            parser.parse_args(
                [
                    "backfill-comments",
                    "--organization",
                    "org",
                    "--pat",
                    "pat",
                    "--until",
                    "not-a-date",
                ]
            )
        assert exc.value.code == 2


# ---------------------------------------------------------------------------
# Realistic ADO-shaped comment ID regression (pr_comments composite PK)
# ---------------------------------------------------------------------------


def _make_thread_with_thread_scoped_comment_id(
    tid: int,
    updated: str = "2026-01-16T00:00:00Z",
    author_id: str = "ua",
) -> dict[str, object]:
    """Build a thread whose sole comment has id=1 regardless of the thread id.

    Mirrors real ADO behavior: comment IDs are thread-scoped, so every
    thread's first comment is always id=1.  The original ``_make_thread``
    helper uses ``tid * 100`` (globally unique) which accidentally
    sidestepped the single-column-PK collision bug.
    """
    return {
        "id": tid,
        "status": "active",
        "lastUpdatedDate": updated,
        "publishedDate": updated,
        "isDeleted": False,
        "comments": [
            {
                "id": 1,
                "author": {
                    "id": author_id,
                    "displayName": "Author",
                    "uniqueName": "a@x",
                },
                "content": f"comment in thread {tid}",
                "commentType": "text",
                "publishedDate": updated,
                "lastUpdatedDate": updated,
                "isDeleted": False,
            }
        ],
    }


class TestRealisticAdoShapedCommentIds:
    """E2E regression guard for the ``pr_comments`` composite-PK fix.

    ADO comment IDs are thread-scoped — every thread's first comment is
    id=1.  The pre-fix schema used ``comment_id TEXT PRIMARY KEY`` and
    ``ON CONFLICT(comment_id) DO UPDATE``, so cross-thread and cross-PR
    upserts collided and the final ``pr_comments`` row count collapsed
    to ~1 regardless of how many threads carried comments upstream.

    This test seeds the mock client with realistic thread-scoped IDs
    (every thread's comment has id=1) and verifies every comment
    persists as its own row.
    """

    def test_multi_pr_multi_thread_comments_all_persist_with_id_1(
        self, tmp_path: Path
    ) -> None:
        db = _create_backfill_db(tmp_path)
        _insert_pr(
            db,
            "pr1",
            pr_id=1,
            project="ProjectA",
            repo="r1",
            closed_date="2026-01-01T00:00:00Z",
        )
        _insert_pr(
            db,
            "pr2",
            pr_id=2,
            project="ProjectA",
            repo="r1",
            closed_date="2026-01-02T00:00:00Z",
        )
        db.close()

        threads_pr1 = [
            _make_thread_with_thread_scoped_comment_id(10),
            _make_thread_with_thread_scoped_comment_id(11),
            _make_thread_with_thread_scoped_comment_id(12),
        ]
        threads_pr2 = [
            _make_thread_with_thread_scoped_comment_id(20),
            _make_thread_with_thread_scoped_comment_id(21),
            _make_thread_with_thread_scoped_comment_id(22),
        ]
        client = _mock_client(per_pr={"1": threads_pr1, "2": threads_pr2})

        args = _make_args(tmp_path, tmp_path / "test.db")
        exit_code, artifact = _run_backfill(args, client=client)

        assert exit_code == 0, artifact
        assert artifact.get("first_fatal_error") is None

        db2 = DatabaseManager(tmp_path / "test.db")
        db2.connect()
        try:
            thread_count = db2.execute(
                "SELECT COUNT(*) AS n FROM pr_threads"
            ).fetchone()["n"]
            comment_count = db2.execute(
                "SELECT COUNT(*) AS n FROM pr_comments"
            ).fetchone()["n"]
            assert thread_count == 6, thread_count
            assert comment_count == 6, comment_count

            # Every PR has exactly 3 comments, each tied to a distinct thread.
            for pr_uid in ("pr1", "pr2"):
                per_pr = db2.execute(
                    "SELECT COUNT(DISTINCT thread_id) AS n FROM pr_comments "
                    "WHERE pull_request_uid = ?",
                    (pr_uid,),
                ).fetchone()["n"]
                assert per_pr == 3, (pr_uid, per_pr)
        finally:
            db2.close()


# ---------------------------------------------------------------------------
# Post-loop metadata-write classification (FR-019b — Site D2 ownership)
# ---------------------------------------------------------------------------


class TestPostLoopMetadataWriteClassification:
    """Post-loop metadata write sqlite3.Error must route through Site D2.

    ``cmd_backfill_comments`` ends with
    ``repo.update_comments_extraction_metadata(...)`` followed by
    ``db.connection.commit()``. A raw ``sqlite3.Error`` from that write
    must be translated to ``DatabaseError`` so Site D2 owns the artifact
    form. Without the translator, the error escapes to Site D5 and the
    artifact carries a generic ``fatal-abort: <raw>`` warning instead of
    the contract's ``fatal-abort: Database error: <msg>`` D2 form.
    """

    def test_metadata_write_sqlite_error_classified_as_database_error(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _create_backfill_db(tmp_path)
        try:
            _insert_pr(db, "pr-1", pr_id=1, closed_date="2026-01-16T10:00:00Z")
        finally:
            db.close()

        def _raise_op_err(*_args: object, **_kwargs: object) -> None:
            raise sqlite3.OperationalError(
                "no such table: comments_extraction_metadata"
            )

        monkeypatch.setattr(
            "ado_git_repo_insights.persistence.repository."
            "PRRepository.update_comments_extraction_metadata",
            _raise_op_err,
        )

        args = _make_args(tmp_path, tmp_path / "test.db")
        client = _mock_client(threads=[_make_thread(1)])
        exit_code, artifact = _run_backfill(args, client=client)

        assert exit_code == 1
        assert artifact.get("final_status") == "failed"
        fatal = str(artifact.get("first_fatal_error", ""))
        assert fatal.startswith("Database error:"), fatal
        assert "could not persist comments extraction metadata" in fatal, fatal
        warnings_raw = artifact.get("warnings", [])
        assert isinstance(warnings_raw, list)
        warnings = [w for w in warnings_raw if isinstance(w, str)]
        expected_prefix = (
            "backfill-comments: fatal-abort: Database error: "
            "backfill-comments could not persist comments extraction metadata:"
        )
        assert any(w.startswith(expected_prefix) for w in warnings), warnings
        # The raw D5 form for the same sqlite text MUST NOT appear — that
        # would indicate the wrap is missing and Site D5 swallowed it.
        d5_raw = (
            "backfill-comments: fatal-abort: "
            "no such table: comments_extraction_metadata"
        )
        assert d5_raw not in warnings, warnings
