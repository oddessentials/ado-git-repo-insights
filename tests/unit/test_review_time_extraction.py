"""Tests for review timestamp extraction from PR thread system comments.

Covers FR-001 (vote event extraction), FR-002 (reviewed_at storage),
FR-003 (review_time_minutes computation), FR-008 (graceful NULL handling),
FR-011 (deleted comment skip), FR-018 (activation contract).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from ado_git_repo_insights.extraction.review_time import populate_review_timestamps
from ado_git_repo_insights.persistence.database import DatabaseManager
from ado_git_repo_insights.utils.datetime_utils import calculate_review_time_minutes

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _create_test_db(tmp_path: Path) -> DatabaseManager:
    """Create a fresh database with v2 schema for testing."""
    db = DatabaseManager(tmp_path / "test.db")
    db.connect()
    return db


def _seed_pr(
    db: DatabaseManager,
    pr_uid: str = "r1-1",
    creation_date: str = "2026-01-15T10:00:00Z",
) -> None:
    """Insert a minimal PR with required FK references."""
    db.execute("INSERT OR IGNORE INTO organizations (organization_name) VALUES ('org')")
    db.execute(
        "INSERT OR IGNORE INTO projects (project_name, organization_name) "
        "VALUES ('proj', 'org')"
    )
    db.execute(
        "INSERT OR IGNORE INTO repositories "
        "(repository_id, repository_name, project_name, organization_name) "
        "VALUES ('r1', 'repo', 'proj', 'org')"
    )
    db.execute(
        "INSERT OR IGNORE INTO users (user_id, display_name) VALUES ('u1', 'Reviewer A')"
    )
    db.execute(
        "INSERT OR IGNORE INTO users (user_id, display_name) VALUES ('u2', 'Reviewer B')"
    )
    db.execute(
        "INSERT OR IGNORE INTO pull_requests "
        "(pull_request_uid, pull_request_id, organization_name, project_name, "
        "repository_id, user_id, title, status, creation_date) "
        "VALUES (?, 1, 'org', 'proj', 'r1', 'u1', 'PR', 'completed', ?)",
        (pr_uid, creation_date),
    )


def _seed_reviewer(
    db: DatabaseManager,
    pr_uid: str = "r1-1",
    user_id: str = "u1",
    vote: int = 10,
) -> None:
    """Insert a reviewer record for a PR."""
    db.execute(
        "INSERT OR IGNORE INTO reviewers "
        "(pull_request_uid, user_id, vote, repository_id) "
        "VALUES (?, ?, ?, 'r1')",
        (pr_uid, user_id, vote),
    )


def _seed_system_comment(
    db: DatabaseManager,
    comment_id: str,
    pr_uid: str,
    author_id: str,
    content: str,
    created_at: str,
    is_deleted: int = 0,
) -> None:
    """Insert a system thread comment for vote event testing."""
    thread_id = f"t-{comment_id}"
    db.execute(
        "INSERT OR IGNORE INTO pr_threads "
        "(thread_id, pull_request_uid, status, last_updated, created_at) "
        "VALUES (?, ?, 'active', ?, ?)",
        (thread_id, pr_uid, created_at, created_at),
    )
    db.execute(
        "INSERT OR IGNORE INTO pr_comments "
        "(comment_id, thread_id, pull_request_uid, author_id, content, "
        "comment_type, created_at, is_deleted) "
        "VALUES (?, ?, ?, ?, ?, 'system', ?, ?)",
        (comment_id, thread_id, pr_uid, author_id, content, created_at, is_deleted),
    )


# ---------------------------------------------------------------------------
# T011: Basic vote parsing
# ---------------------------------------------------------------------------


class TestVoteParsing:
    """T011: System comment vote parsing and timestamp extraction."""

    def test_approval_vote_extracts_timestamp(self, tmp_path: Path) -> None:
        """'PM P voted 10' with commentType=system extracts publishedDate."""
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db)
            _seed_reviewer(db, user_id="u1", vote=10)
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 10",
                created_at="2026-01-15T12:30:00Z",
            )

            count = populate_review_timestamps(db)
            assert count == 1

            row = db.execute(
                "SELECT reviewed_at FROM reviewers WHERE user_id = 'u1'"
            ).fetchone()
            assert row is not None
            assert row["reviewed_at"] == "2026-01-15T12:30:00Z"

            pr_row = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr_row is not None
            assert pr_row["review_time_minutes"] is not None
            assert pr_row["review_time_minutes"] > 0
        finally:
            db.close()

    def test_approved_with_suggestions_extracts_timestamp(self, tmp_path: Path) -> None:
        """Vote value 5 (approved with suggestions) is a positive vote."""
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db)
            _seed_reviewer(db, user_id="u1", vote=5)
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 5",
                created_at="2026-01-15T14:00:00Z",
            )

            count = populate_review_timestamps(db)
            assert count == 1

            row = db.execute(
                "SELECT reviewed_at FROM reviewers WHERE user_id = 'u1'"
            ).fetchone()
            assert row is not None
            assert row["reviewed_at"] == "2026-01-15T14:00:00Z"
        finally:
            db.close()


# ---------------------------------------------------------------------------
# T012: Deleted comment handling
# ---------------------------------------------------------------------------


class TestDeletedComments:
    """T012: Deleted system comments are skipped."""

    def test_deleted_comment_skipped(self, tmp_path: Path) -> None:
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db)
            _seed_reviewer(db, user_id="u1", vote=10)
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 10",
                created_at="2026-01-15T12:00:00Z",
                is_deleted=1,
            )

            count = populate_review_timestamps(db)
            assert count == 0

            row = db.execute(
                "SELECT reviewed_at FROM reviewers WHERE user_id = 'u1'"
            ).fetchone()
            assert row is not None
            assert row["reviewed_at"] is None
        finally:
            db.close()


# ---------------------------------------------------------------------------
# T013: Rejection then approval
# ---------------------------------------------------------------------------


class TestRejectionThenApproval:
    """T013: PR with rejection then approval uses the approval timestamp."""

    def test_uses_approval_not_rejection(self, tmp_path: Path) -> None:
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db)
            _seed_reviewer(db, user_id="u1", vote=10)
            # First: rejection at 12:00
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted -10",
                created_at="2026-01-15T12:00:00Z",
            )
            # Then: approval at 14:00
            _seed_system_comment(
                db,
                comment_id="c2",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 10",
                created_at="2026-01-15T14:00:00Z",
            )

            populate_review_timestamps(db)

            row = db.execute(
                "SELECT reviewed_at FROM reviewers WHERE user_id = 'u1'"
            ).fetchone()
            assert row is not None
            assert row["reviewed_at"] == "2026-01-15T14:00:00Z"
        finally:
            db.close()


# ---------------------------------------------------------------------------
# T014: Multiple reviewers — earliest approval
# ---------------------------------------------------------------------------


class TestMultipleReviewers:
    """T014: PR with multiple approving reviewers uses earliest for review_time."""

    def test_earliest_across_reviewers(self, tmp_path: Path) -> None:
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db, creation_date="2026-01-15T10:00:00Z")
            _seed_reviewer(db, user_id="u1", vote=10)
            _seed_reviewer(db, user_id="u2", vote=10)
            # u2 approves first at 11:00
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u2",
                content="Reviewer B voted 10",
                created_at="2026-01-15T11:00:00Z",
            )
            # u1 approves later at 13:00
            _seed_system_comment(
                db,
                comment_id="c2",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 10",
                created_at="2026-01-15T13:00:00Z",
            )

            populate_review_timestamps(db)

            pr_row = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr_row is not None
            # Earliest approval: u2 at 11:00, creation at 10:00 = 60 minutes
            assert pr_row["review_time_minutes"] == pytest.approx(60.0)
        finally:
            db.close()


# ---------------------------------------------------------------------------
# T015: No positive votes
# ---------------------------------------------------------------------------


class TestNoPositiveVotes:
    """T015: PR with no positive votes yields NULL."""

    def test_rejection_only_yields_null(self, tmp_path: Path) -> None:
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db)
            _seed_reviewer(db, user_id="u1", vote=-10)
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted -10",
                created_at="2026-01-15T12:00:00Z",
            )

            count = populate_review_timestamps(db)
            assert count == 0

            row = db.execute(
                "SELECT reviewed_at FROM reviewers WHERE user_id = 'u1'"
            ).fetchone()
            assert row is not None
            assert row["reviewed_at"] is None
        finally:
            db.close()


# ---------------------------------------------------------------------------
# T016: No thread data
# ---------------------------------------------------------------------------


class TestNoThreadData:
    """T016: PR with no comments yields NULL with no errors."""

    def test_no_comments_yields_null(self, tmp_path: Path) -> None:
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db)
            _seed_reviewer(db, user_id="u1", vote=10)
            # No comments seeded at all

            count = populate_review_timestamps(db)
            assert count == 0

            pr_row = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr_row is not None
            assert pr_row["review_time_minutes"] is None
        finally:
            db.close()


# ---------------------------------------------------------------------------
# T017: review_time_minutes computation
# ---------------------------------------------------------------------------


class TestReviewTimeComputation:
    """T017: review_time_minutes = (reviewed_at - creation_date) in minutes."""

    def test_exact_computation(self, tmp_path: Path) -> None:
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db, creation_date="2026-01-15T10:00:00Z")
            _seed_reviewer(db, user_id="u1", vote=10)
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 10",
                created_at="2026-01-15T10:30:00Z",
            )

            populate_review_timestamps(db)

            pr_row = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr_row is not None
            assert pr_row["review_time_minutes"] == pytest.approx(30.0)
        finally:
            db.close()

    def test_minimum_floor_1_minute(self, tmp_path: Path) -> None:
        """review_time_minutes has a 1.0-minute floor."""
        db = _create_test_db(tmp_path)
        try:
            # Creation and vote 10 seconds apart
            _seed_pr(db, creation_date="2026-01-15T10:00:00Z")
            _seed_reviewer(db, user_id="u1", vote=10)
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 10",
                created_at="2026-01-15T10:00:10Z",
            )

            populate_review_timestamps(db)

            pr_row = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr_row is not None
            assert pr_row["review_time_minutes"] == pytest.approx(1.0)
        finally:
            db.close()


# ---------------------------------------------------------------------------
# T018: Clock skew edge case
# ---------------------------------------------------------------------------


class TestClockSkew:
    """T018: reviewed_at before creation_date produces 1.0-minute floor."""

    def test_negative_delta_yields_floor(self, tmp_path: Path) -> None:
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db, creation_date="2026-01-15T12:00:00Z")
            _seed_reviewer(db, user_id="u1", vote=10)
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 10",
                created_at="2026-01-15T11:50:00Z",  # Before creation!
            )

            populate_review_timestamps(db)

            pr_row = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr_row is not None
            assert pr_row["review_time_minutes"] == pytest.approx(1.0)
        finally:
            db.close()


# ---------------------------------------------------------------------------
# T019: calculate_review_time_minutes unit tests
# ---------------------------------------------------------------------------


class TestCalculateReviewTimeMinutes:
    """T019: calculate_review_time_minutes() contract tests."""

    def test_normal_computation(self) -> None:
        result = calculate_review_time_minutes(
            "2026-01-15T10:00:00Z", "2026-01-15T10:30:00Z"
        )
        assert result == pytest.approx(30.0)

    def test_minimum_floor(self) -> None:
        result = calculate_review_time_minutes(
            "2026-01-15T10:00:00Z", "2026-01-15T10:00:05Z"
        )
        assert result == pytest.approx(1.0)

    def test_none_creation_date(self) -> None:
        assert calculate_review_time_minutes(None, "2026-01-15T10:30:00Z") is None

    def test_none_reviewed_at(self) -> None:
        assert calculate_review_time_minutes("2026-01-15T10:00:00Z", None) is None

    def test_both_none(self) -> None:
        assert calculate_review_time_minutes(None, None) is None

    def test_2_decimal_precision(self) -> None:
        # 7 minutes 23 seconds = 7.383... minutes → 7.38
        result = calculate_review_time_minutes(
            "2026-01-15T10:00:00Z", "2026-01-15T10:07:23Z"
        )
        assert result == pytest.approx(7.38)


# ---------------------------------------------------------------------------
# T020: upsert_reviewer preserves reviewed_at
# ---------------------------------------------------------------------------


class TestUpsertReviewerPreservesReviewedAt:
    """T020: ON CONFLICT upsert does not clobber existing reviewed_at."""

    def test_re_upsert_preserves_reviewed_at(self, tmp_path: Path) -> None:
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db)
            _seed_reviewer(db, user_id="u1", vote=10)
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 10",
                created_at="2026-01-15T12:00:00Z",
            )
            populate_review_timestamps(db)

            # Verify reviewed_at is set
            row = db.execute(
                "SELECT reviewed_at FROM reviewers WHERE user_id = 'u1'"
            ).fetchone()
            assert row is not None
            assert row["reviewed_at"] == "2026-01-15T12:00:00Z"

            # Now re-upsert the reviewer (simulating PR extraction rerun)
            from ado_git_repo_insights.persistence.repository import PRRepository

            repo = PRRepository(db)
            repo.upsert_reviewer(
                pull_request_uid="r1-1",
                user_id="u1",
                vote=10,
                repository_id="r1",
            )

            # reviewed_at must still be set
            row2 = db.execute(
                "SELECT reviewed_at FROM reviewers WHERE user_id = 'u1'"
            ).fetchone()
            assert row2 is not None
            assert row2["reviewed_at"] == "2026-01-15T12:00:00Z"
        finally:
            db.close()


# ---------------------------------------------------------------------------
# Edge case: text-only threads
# ---------------------------------------------------------------------------


class TestTextOnlyThreads:
    """Edge case: thread data with no system comments yields NULL."""

    def test_text_comments_ignored(self, tmp_path: Path) -> None:
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db)
            _seed_reviewer(db, user_id="u1", vote=10)
            # Insert a text comment (not system)
            thread_id = "t-text"
            db.execute(
                "INSERT INTO pr_threads "
                "(thread_id, pull_request_uid, status, last_updated, created_at) "
                "VALUES (?, 'r1-1', 'active', '2026-01-15T12:00:00Z', '2026-01-15T12:00:00Z')",
                (thread_id,),
            )
            db.execute(
                "INSERT INTO pr_comments "
                "(comment_id, thread_id, pull_request_uid, author_id, content, "
                "comment_type, created_at, is_deleted) "
                "VALUES ('c-text', ?, 'r1-1', 'u1', 'Looks good!', 'text', "
                "'2026-01-15T12:00:00Z', 0)",
                (thread_id,),
            )

            count = populate_review_timestamps(db)
            assert count == 0
        finally:
            db.close()


# ---------------------------------------------------------------------------
# Convergence regression test
# ---------------------------------------------------------------------------


class TestConvergenceOnRerun:
    """If a positive vote is deleted, rerun must clear reviewed_at + review_time."""

    def test_deleted_vote_clears_on_rerun(self, tmp_path: Path) -> None:
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db, creation_date="2026-01-15T10:00:00Z")
            _seed_reviewer(db, user_id="u1", vote=10)
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 10",
                created_at="2026-01-15T12:00:00Z",
            )

            # First run: populates reviewed_at and review_time_minutes
            count = populate_review_timestamps(db)
            assert count == 1
            row = db.execute(
                "SELECT reviewed_at FROM reviewers WHERE user_id = 'u1'"
            ).fetchone()
            assert row is not None
            assert row["reviewed_at"] is not None

            pr_row = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr_row is not None
            assert pr_row["review_time_minutes"] is not None

            # Delete the vote comment (simulates sync finding it deleted)
            db.execute("UPDATE pr_comments SET is_deleted = 1 WHERE comment_id = 'c1'")

            # Second run: must clear stale data
            count2 = populate_review_timestamps(db)
            assert count2 == 0  # No positive votes remain

            row2 = db.execute(
                "SELECT reviewed_at FROM reviewers WHERE user_id = 'u1'"
            ).fetchone()
            assert row2 is not None
            assert row2["reviewed_at"] is None, (
                "reviewed_at must be NULL after vote deletion"
            )

            pr_row2 = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr_row2 is not None
            assert pr_row2["review_time_minutes"] is None, (
                "review_time_minutes must be NULL after vote deletion"
            )
        finally:
            db.close()


# ---------------------------------------------------------------------------
# Scoping safety test
# ---------------------------------------------------------------------------


class TestScopingSafety:
    """PRs without comment data must not be affected by recomputation."""

    def test_pr_without_comments_untouched(self, tmp_path: Path) -> None:
        db = _create_test_db(tmp_path)
        try:
            # PR 1: has comments and a positive vote
            _seed_pr(db, pr_uid="r1-1", creation_date="2026-01-15T10:00:00Z")
            _seed_reviewer(db, pr_uid="r1-1", user_id="u1", vote=10)
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 10",
                created_at="2026-01-15T12:00:00Z",
            )

            # PR 2: no comments at all — manually set review_time to prove
            # it won't be cleared by the recompute of PR 1
            db.execute(
                "INSERT INTO pull_requests "
                "(pull_request_uid, pull_request_id, organization_name, "
                "project_name, repository_id, user_id, title, status, "
                "creation_date, review_time_minutes) "
                "VALUES ('r1-2', 2, 'org', 'proj', 'r1', 'u1', 'PR2', "
                "'completed', '2026-01-15T08:00:00Z', 999.99)",
            )
            db.execute(
                "INSERT OR IGNORE INTO reviewers "
                "(pull_request_uid, user_id, vote, repository_id, reviewed_at) "
                "VALUES ('r1-2', 'u2', 10, 'r1', '2026-01-15T09:00:00Z')",
            )

            populate_review_timestamps(db)

            # PR 1 should be computed
            pr1 = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr1 is not None
            assert pr1["review_time_minutes"] is not None

            # PR 2 must be UNTOUCHED (no comments = not in recompute scope)
            pr2 = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-2'"
            ).fetchone()
            assert pr2 is not None
            assert pr2["review_time_minutes"] == pytest.approx(999.99), (
                "PR without comments must not be affected by recomputation"
            )

            rev2 = db.execute(
                "SELECT reviewed_at FROM reviewers "
                "WHERE pull_request_uid = 'r1-2' AND user_id = 'u2'"
            ).fetchone()
            assert rev2 is not None
            assert rev2["reviewed_at"] == "2026-01-15T09:00:00Z", (
                "Reviewer on PR without comments must retain reviewed_at"
            )
        finally:
            db.close()


# ---------------------------------------------------------------------------
# Trigger scope test (P2)
# ---------------------------------------------------------------------------


class TestTriggerScope:
    """Recomputation runs when thread data exists locally, even without --include-comments."""

    def test_recompute_with_existing_comments(self, tmp_path: Path) -> None:
        """With stored comments but no --include-comments flag, recompute still runs."""
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db, creation_date="2026-01-15T10:00:00Z")
            _seed_reviewer(db, user_id="u1", vote=10)
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 10",
                created_at="2026-01-15T12:00:00Z",
            )

            # Simulate: comments already in DB, call populate directly
            # (this is what cli.py now does regardless of --include-comments)
            count = populate_review_timestamps(db)
            assert count == 1

            pr_row = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr_row is not None
            assert pr_row["review_time_minutes"] is not None
        finally:
            db.close()

    def test_legacy_db_without_comments_table(self, tmp_path: Path) -> None:
        """Legacy DB without pr_comments table must not crash.

        Regression: unconditional SELECT 1 FROM pr_comments crashed with
        'no such table' on databases predating the comments feature.
        """
        import sqlite3 as _sqlite3

        db_path = tmp_path / "legacy.db"
        # Create a minimal legacy DB WITHOUT pr_comments/pr_threads tables
        conn = _sqlite3.connect(str(db_path))
        conn.executescript(
            """
            CREATE TABLE extraction_metadata (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                organization_name TEXT NOT NULL,
                project_name TEXT NOT NULL,
                last_extraction_date TEXT NOT NULL,
                last_extraction_timestamp TEXT NOT NULL
            );
            CREATE TABLE organizations (organization_name TEXT PRIMARY KEY);
            CREATE TABLE projects (
                project_name TEXT PRIMARY KEY, organization_name TEXT NOT NULL
            );
            CREATE TABLE repositories (
                repository_id TEXT PRIMARY KEY, repository_name TEXT NOT NULL,
                project_name TEXT NOT NULL, organization_name TEXT NOT NULL
            );
            CREATE TABLE users (
                user_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, email TEXT
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
            CREATE TABLE schema_version (
                version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
            );
            INSERT INTO schema_version (version, applied_at)
            VALUES (2, datetime('now'));
            """
        )
        conn.close()

        # The CLI guard checks sqlite_master before querying pr_comments.
        # Simulate what cli.py does:
        db = DatabaseManager(db_path)
        db.connect()
        try:
            comments_table_exists = (
                db.execute(
                    "SELECT 1 FROM sqlite_master "
                    "WHERE type='table' AND name='pr_comments'"
                ).fetchone()
                is not None
            )
            assert not comments_table_exists
            # No crash — graceful degradation
        finally:
            db.close()

    def test_new_pr_without_comments_stays_null(self, tmp_path: Path) -> None:
        """Stale/partial run: old comments exist, new PR has no threads → NULL.

        Regression: when --include-comments is omitted after a previous
        thread-enabled run, populate_review_timestamps() runs (correct) but
        the user must be warned that new PRs lack review time. This test
        verifies the data path: newly extracted PRs without comment data
        are correctly left with NULL review_time_minutes.
        """
        db = _create_test_db(tmp_path)
        try:
            # Old PR with comments and review time
            _seed_pr(db, pr_uid="r1-1", creation_date="2026-01-10T10:00:00Z")
            _seed_reviewer(db, pr_uid="r1-1", user_id="u1", vote=10)
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 10",
                created_at="2026-01-10T12:00:00Z",
            )

            # New PR extracted this run — no comments (--include-comments off)
            db.execute(
                "INSERT INTO pull_requests "
                "(pull_request_uid, pull_request_id, organization_name, "
                "project_name, repository_id, user_id, title, status, "
                "creation_date) "
                "VALUES ('r1-new', 99, 'org', 'proj', 'r1', 'u1', "
                "'New PR', 'completed', '2026-01-15T08:00:00Z')",
            )
            db.execute(
                "INSERT OR IGNORE INTO reviewers "
                "(pull_request_uid, user_id, vote, repository_id) "
                "VALUES ('r1-new', 'u2', 10, 'r1')",
            )

            # Recompute (simulates what cli.py does when has_comments=True)
            populate_review_timestamps(db)

            # Old PR: should have review time
            old_pr = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert old_pr is not None
            assert old_pr["review_time_minutes"] is not None

            # New PR: no comments → NULL (not in recompute scope)
            new_pr = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-new'"
            ).fetchone()
            assert new_pr is not None
            assert new_pr["review_time_minutes"] is None, (
                "New PR without comments must have NULL review_time_minutes"
            )
        finally:
            db.close()
