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
import subprocess
from argparse import Namespace
from datetime import date
from pathlib import Path
from sqlite3 import Cursor
from unittest.mock import MagicMock, patch

import pytest

from ado_git_repo_insights.cli import (
    _get_probe_project,
    _select_uncovered_prs_for_backfill,
    cmd_backfill_comments,
    create_parser,
)
from ado_git_repo_insights.config import _parse_iso_date, _parse_projects_list
from ado_git_repo_insights.extractor.ado_client import ExtractionError
from ado_git_repo_insights.persistence.database import DatabaseManager
from ado_git_repo_insights.persistence.repository import PRRepository
from ado_git_repo_insights.types import SqliteParam

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


def _select_uids(db: DatabaseManager, **kwargs: object) -> list[str]:
    projects = kwargs.get("projects", [])
    since = kwargs.get("since")
    until = kwargs.get("until")
    limit = kwargs.get("limit", 0)
    rows = _select_uncovered_prs_for_backfill(
        db,
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
            all_rows = _select_uncovered_prs_for_backfill(db, [], None, None, 0)
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

            snapshot = _select_uncovered_prs_for_backfill(db, [], None, None, 0)
            assert len(snapshot) == 3

            # Mutate the DB after snapshot materializes.
            _insert_pr(db, "p4", pr_id=4, closed_date="2025-12-31T00:00:00Z")

            # Snapshot list is independent of the DB now.
            assert len(snapshot) == 3
            snapshot_uids = {str(r["pull_request_uid"]) for r in snapshot}
            assert "p4" not in snapshot_uids

            # A fresh invocation sees the new row.
            fresh = _select_uncovered_prs_for_backfill(db, [], None, None, 0)
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
                remaining = _select_uncovered_prs_for_backfill(db2, [], None, None, 0)
                remaining_uids = {str(r["pull_request_uid"]) for r in remaining}
                assert remaining_uids == {"p3"}
            finally:
                db2.close()
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

                remaining = _select_uncovered_prs_for_backfill(db2, [], None, None, 0)
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
# #13 DocsTreeUntouched
# ---------------------------------------------------------------------------


class TestDocsTreeUntouched:
    """FR-029/029a + FR-030g: feature branch leaves docs/ unchanged."""

    def test_feature_branch_has_zero_diff_under_docs(self) -> None:
        # Find merge-base with origin/main and diff docs/ between it and HEAD.
        try:
            merge_base = subprocess.run(
                ["git", "merge-base", "origin/main", "HEAD"],
                capture_output=True,
                text=True,
                check=False,
                timeout=10,
            )
        except (OSError, subprocess.TimeoutExpired):
            pytest.skip("git unavailable")
            return

        if merge_base.returncode != 0:
            pytest.skip(f"merge-base unavailable: {merge_base.stderr}")
            return

        base = merge_base.stdout.strip()
        diff = subprocess.run(
            ["git", "diff", "--name-only", f"{base}..HEAD", "--", "docs/"],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
        assert diff.returncode == 0, diff.stderr
        changed = [line for line in diff.stdout.splitlines() if line.strip()]
        assert changed == [], f"Feature 058 MUST NOT touch docs/; changed: {changed}"


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
            remaining = _select_uncovered_prs_for_backfill(db2, [], None, None, 0)
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
            remaining = _select_uncovered_prs_for_backfill(db2, [], None, None, 0)
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


# ---------------------------------------------------------------------------
# ConnectionProbe — P2 contract fix (probe from filtered snapshot)
# ---------------------------------------------------------------------------


class TestConnectionProbe:
    """P2: ``test_connection`` probes the filtered selection, not the
    broader DB. Locks FR-004/5/6 empty-filter semantics and FR-030d-style
    parity between declared filter and network work.
    """

    def test_get_probe_project_picks_row_zero_or_none(self) -> None:
        """Unit test on the pure helper. Covers: empty snapshot returns
        None; row 0 with a valid string wins; null / non-str / empty
        project_name at row 0 is treated as "no probe" (defensive guard
        against bad data); later rows are never consulted.
        """
        # Empty snapshot → None.
        assert _get_probe_project([]) is None

        # Row 0 valid str → returned unchanged.
        assert _get_probe_project([{"project_name": "ProjectA"}]) == "ProjectA"

        # Row 0 null → None (defensive).
        assert _get_probe_project([{"project_name": None}]) is None

        # Row 0 empty str → None.
        assert _get_probe_project([{"project_name": ""}]) is None

        # Row 0 wrong type → None.
        assert _get_probe_project([{"project_name": 42}]) is None

        # Only row 0 consulted — later rows ignored.
        assert (
            _get_probe_project(
                [
                    {"project_name": "First"},
                    {"project_name": "Second"},
                ]
            )
            == "First"
        )

    def test_empty_filtered_snapshot_skips_connection_probe(
        self, tmp_path: Path
    ) -> None:
        """A filtered selection that matches zero PRs MUST NOT call
        ``test_connection`` against any project — not even a DB-sample
        project outside the filter window (regression against the old
        _resolve_backfill_probe_project behavior).
        """
        db = _create_backfill_db(tmp_path)
        # Seed a completed PR outside the --since window. It would be a
        # valid DB-sample fallback project under the old behavior, but
        # the filtered snapshot is empty so no probe should fire.
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
        assert client.test_connection.call_count == 0
        assert client.get_pr_threads.call_count == 0
        # Full-shape empty-selection artifact.
        counts = artifact.get("counts")
        assert isinstance(counts, dict)
        assert counts.get("prs_updated") == 0

    def test_probe_respects_since_until_filter(self, tmp_path: Path) -> None:
        """When a filter excludes project A but includes project B, the
        probe MUST target project B (the actual snapshot's row 0),
        not any project from the broader DB.
        """
        db = _create_backfill_db(tmp_path)
        # ProjectA PR is outside the window.
        _insert_pr(
            db,
            "a-old",
            pr_id=1,
            project="ProjectA",
            repo="r1",
            closed_date="2024-01-01T00:00:00Z",
        )
        # ProjectB PR is inside the window.
        _insert_pr(
            db,
            "b-new",
            pr_id=2,
            project="ProjectB",
            repo="r2",
            closed_date="2026-02-15T00:00:00Z",
        )
        db.close()

        args = _make_args(
            tmp_path,
            tmp_path / "test.db",
            since=date(2026, 1, 1),
            until=date(2026, 6, 1),
            max_threads=0,
        )
        client = _mock_client(per_pr={"2": [_make_thread(20)]})
        exit_code, _ = _run_backfill(args, client=client)

        assert exit_code == 0
        assert client.test_connection.call_count == 1
        # Probe target is ProjectB (the only project the filter retains).
        call_args = client.test_connection.call_args
        positional_args = call_args.args if call_args else ()
        called_project = positional_args[0] if positional_args else None
        assert called_project == "ProjectB", call_args


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
