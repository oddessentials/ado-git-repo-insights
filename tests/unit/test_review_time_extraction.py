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
from ado_git_repo_insights.types import AdoThread
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


def _make_ado_thread(
    tid: int | str,
    last_updated: str,
    published: str = "2026-01-01T00:00:00Z",
) -> AdoThread:
    """Build a minimal AdoThread dict for _dropped_threads_all_stored tests."""
    return AdoThread(
        id=int(tid) if isinstance(tid, str) else tid,
        status="active",
        lastUpdatedDate=last_updated,
        publishedDate=published,
        isDeleted=False,
        comments=[],
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

    def test_same_timestamp_yields_floor(self) -> None:
        """reviewed_at == creation_date produces the 1.0-minute floor."""
        result = calculate_review_time_minutes(
            "2026-01-15T10:00:00Z", "2026-01-15T10:00:00Z"
        )
        assert result == pytest.approx(1.0)


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
# Withdrawn approval test
# ---------------------------------------------------------------------------


class TestWithdrawnApproval:
    """Reviewer who approved then changed vote must not contribute review_time."""

    def test_withdrawn_approval_nulls_review_time(self, tmp_path: Path) -> None:
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db, creation_date="2026-01-15T10:00:00Z")
            # Reviewer approved (vote=10 in reviewer record)
            _seed_reviewer(db, user_id="u1", vote=10)
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 10",
                created_at="2026-01-15T12:00:00Z",
            )

            # First run: review_time computed
            populate_review_timestamps(db)
            pr1 = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr1 is not None
            assert pr1["review_time_minutes"] is not None

            # Reviewer withdraws approval: ADO creates a new "voted 0"
            # system comment and the reviewer's vote changes to 0.
            db.execute(
                "UPDATE reviewers SET vote = 0 "
                "WHERE pull_request_uid = 'r1-1' AND user_id = 'u1'"
            )
            _seed_system_comment(
                db,
                comment_id="c2",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 0",
                created_at="2026-01-15T14:00:00Z",
            )

            # Recompute: the latest vote event for u1 is "voted 0", so
            # their earlier approval is withdrawn and must not contribute
            # to review_time_minutes.
            populate_review_timestamps(db)
            pr2 = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr2 is not None
            assert pr2["review_time_minutes"] is None, (
                "Withdrawn approval must NULL review_time_minutes"
            )
        finally:
            db.close()

    def test_removed_reviewer_does_not_contribute_review_time(
        self, tmp_path: Path
    ) -> None:
        """Reviewer removed from PR must not contribute review_time.

        Regression: the reviewers table never deletes rows for removed
        reviewers, so a stale vote=10 row survived incremental re-extracts.
        The old code joined reviewers and filtered on r.vote IN (5, 10),
        which matched the stale row.  The fix derives review_time solely
        from pr_comments vote events, bypassing the stale reviewers table.
        """
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db, creation_date="2026-01-15T10:00:00Z")
            # Only reviewer: u1 approved.
            _seed_reviewer(db, user_id="u1", vote=10)
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 10",
                created_at="2026-01-15T12:00:00Z",
            )
            db.connection.commit()

            # First run: review_time computed from u1's approval.
            count1 = populate_review_timestamps(db)
            assert count1 == 1
            pr1 = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr1 is not None
            assert pr1["review_time_minutes"] is not None

            # u1 is removed from the PR in ADO.  Next extraction will NOT
            # update u1's reviewer row (it's just skipped), so vote stays 10.
            # But their vote event comment is deleted in ADO and the local
            # copy is marked as deleted.
            db.execute("UPDATE pr_comments SET is_deleted = 1 WHERE comment_id = 'c1'")
            db.connection.commit()

            # Recompute: c1 is deleted, so no positive vote events exist.
            # review_time_minutes must be NULL even though reviewers.vote=10.
            count2 = populate_review_timestamps(db)
            assert count2 == 0
            pr2 = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr2 is not None
            assert pr2["review_time_minutes"] is None, (
                "Removed reviewer's stale vote=10 must not contribute "
                "review_time after their vote event is deleted"
            )
        finally:
            db.close()


# ---------------------------------------------------------------------------
# Post-close approval filtering (SC-002)
# ---------------------------------------------------------------------------


class TestPostCloseApproval:
    """Approvals after PR close must not produce review_time_minutes."""

    def test_post_close_approval_produces_null_review_time(
        self, tmp_path: Path
    ) -> None:
        """If the earliest positive vote is after closed_date, review_time
        must be NULL — not an impossible duration exceeding cycle_time.

        Regression: review_time.py persisted the computed value and only
        logged a warning, allowing inflated review-time metrics in rollups.
        """
        db = _create_test_db(tmp_path)
        try:
            # PR created Jan 15 10:00, closed Jan 16 10:00 (24h cycle)
            _seed_pr(db, creation_date="2026-01-15T10:00:00Z")
            db.execute(
                "UPDATE pull_requests SET closed_date = '2026-01-16T10:00:00Z', "
                "cycle_time_minutes = 1440.0 WHERE pull_request_uid = 'r1-1'"
            )
            # Reviewer approves AFTER close (post-merge approval)
            _seed_reviewer(db, user_id="u1", vote=10)
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 10",
                created_at="2026-01-17T08:00:00Z",  # 22h after close
            )

            count = populate_review_timestamps(db)

            pr = db.execute(
                "SELECT review_time_minutes, cycle_time_minutes "
                "FROM pull_requests WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr is not None
            assert pr["review_time_minutes"] is None, (
                "Post-close approval must not produce review_time_minutes"
            )
            assert count == 0, "Post-close approvals must not count toward updated PRs"
        finally:
            db.close()

    def test_pre_close_approval_still_populates_review_time(
        self, tmp_path: Path
    ) -> None:
        """Normal approval before close must still produce review_time."""
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db, creation_date="2026-01-15T10:00:00Z")
            db.execute(
                "UPDATE pull_requests SET closed_date = '2026-01-16T10:00:00Z', "
                "cycle_time_minutes = 1440.0 WHERE pull_request_uid = 'r1-1'"
            )
            _seed_reviewer(db, user_id="u1", vote=10)
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 10",
                created_at="2026-01-15T14:00:00Z",  # 4h after creation, before close
            )

            count = populate_review_timestamps(db)

            pr = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr is not None
            assert pr["review_time_minutes"] is not None
            assert pr["review_time_minutes"] == 240.0  # 4 hours
            assert count == 1
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

    def test_coverage_full_when_all_prs_have_threads(self, tmp_path: Path) -> None:
        """Full coverage: all completed PRs have thread data."""
        db = _create_test_db(tmp_path)
        try:
            db.execute(
                "INSERT INTO comments_extraction_metadata "
                "(id, last_run_timestamp, prs_processed, threads_fetched, "
                "comments_fetched, capped) "
                "VALUES (1, '2026-01-10T00:00:00Z', 50, 100, 200, 0)"
            )
            _seed_pr(db, pr_uid="r1-1")
            _seed_reviewer(db, user_id="u1", vote=10)
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 10",
                created_at="2026-01-15T12:00:00Z",
            )
            # Only 1 completed PR (r1-1), mark it as extraction-covered.
            db.execute(
                "UPDATE pull_requests SET comments_extracted_at = "
                "'2026-01-10T00:00:00Z' WHERE pull_request_uid = 'r1-1'"
            )

            from ado_git_repo_insights.transform.aggregators import (
                AggregateGenerator,
            )

            output = tmp_path / "agg_out"
            gen = AggregateGenerator(db, output)
            coverage = gen._get_comments_coverage()
            assert coverage["status"] == "full"
        finally:
            db.close()

    def test_coverage_partial_when_new_prs_lack_threads(self, tmp_path: Path) -> None:
        """Coverage becomes partial when new PRs are added after extraction.

        Extraction processed 1 PR, then a second completed PR was added
        without re-running extraction → prs_processed < total_completed →
        coverage must become partial.
        """
        db = _create_test_db(tmp_path)
        try:
            # Extraction only processed 1 PR (before the new one was added)
            db.execute(
                "INSERT INTO comments_extraction_metadata "
                "(id, last_run_timestamp, prs_processed, threads_fetched, "
                "comments_fetched, capped) "
                "VALUES (1, '2026-01-10T00:00:00Z', 1, 1, 1, 0)"
            )
            # Covered PR: has threads
            _seed_pr(db, pr_uid="r1-1")
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 10",
                created_at="2026-01-15T12:00:00Z",
            )
            # New PR added after extraction ran (never processed)
            db.execute(
                "INSERT INTO pull_requests "
                "(pull_request_uid, pull_request_id, organization_name, "
                "project_name, repository_id, user_id, title, status, "
                "creation_date) "
                "VALUES ('r1-uncovered', 99, 'org', 'proj', 'r1', 'u1', "
                "'Uncovered PR', 'completed', '2026-01-16T08:00:00Z')",
            )

            from ado_git_repo_insights.transform.aggregators import (
                AggregateGenerator,
            )

            output = tmp_path / "agg_out"
            gen = AggregateGenerator(db, output)
            coverage = gen._get_comments_coverage()
            assert coverage["status"] == "partial", (
                "prs_processed < total_completed must downgrade to partial"
            )

            # Metadata preserved — NOT overwritten
            row = db.execute(
                "SELECT prs_processed, capped "
                "FROM comments_extraction_metadata WHERE id = 1"
            ).fetchone()
            assert row is not None
            assert row["prs_processed"] == 1
            assert row["capped"] == 0
        finally:
            db.close()

    def test_coverage_partial_when_capped(self, tmp_path: Path) -> None:
        """Capped extraction reports partial coverage. Metadata preserved."""
        db = _create_test_db(tmp_path)
        try:
            db.execute(
                "INSERT INTO comments_extraction_metadata "
                "(id, last_run_timestamp, prs_processed, threads_fetched, "
                "comments_fetched, capped) "
                "VALUES (1, '2026-01-10T00:00:00Z', 100, 200, 400, 1)"
            )
            _seed_pr(db, pr_uid="r1-1")
            _seed_system_comment(
                db,
                comment_id="c1",
                pr_uid="r1-1",
                author_id="u1",
                content="Reviewer A voted 10",
                created_at="2026-01-15T12:00:00Z",
            )

            from ado_git_repo_insights.transform.aggregators import (
                AggregateGenerator,
            )

            output = tmp_path / "agg_out"
            gen = AggregateGenerator(db, output)
            coverage = gen._get_comments_coverage()
            assert coverage["status"] == "partial"

            row = db.execute(
                "SELECT prs_processed FROM comments_extraction_metadata WHERE id = 1"
            ).fetchone()
            assert row is not None
            assert row["prs_processed"] == 100, "Metadata preserved"
        finally:
            db.close()

    def test_coverage_full_when_extraction_found_zero_threads(
        self, tmp_path: Path
    ) -> None:
        """Uncapped extraction with zero threads/comments → full.

        Extraction ran and covered all completed PRs.  The absence of
        threads is a legitimate result (those PRs simply had no discussion),
        not a coverage gap.
        """
        db = _create_test_db(tmp_path)
        try:
            db.execute(
                "INSERT INTO comments_extraction_metadata "
                "(id, last_run_timestamp, prs_processed, threads_fetched, "
                "comments_fetched, capped) "
                "VALUES (1, '2026-01-10T00:00:00Z', 30, 0, 0, 0)"
            )
            _seed_pr(db)
            # Per-PR marker: extraction visited the PR even though zero threads.
            db.execute(
                "UPDATE pull_requests SET comments_extracted_at = "
                "'2026-01-10T00:00:00Z' WHERE pull_request_uid = 'r1-1'"
            )

            from ado_git_repo_insights.transform.aggregators import (
                AggregateGenerator,
            )

            output = tmp_path / "agg_out"
            gen = AggregateGenerator(db, output)
            coverage = gen._get_comments_coverage()
            assert coverage["status"] == "full", (
                "Extraction processed all PRs — zero threads is full coverage"
            )
        finally:
            db.close()

    def test_incremental_extraction_preserves_full_coverage(
        self, tmp_path: Path
    ) -> None:
        """Full historical extraction → incremental batch → coverage stays full.

        Regression: _get_comments_coverage used the batch-scoped
        comments_extraction_metadata.prs_processed (overwritten each run) to
        derive global coverage.  After a full run (1000 PRs), a small
        incremental run (5 PRs) overwrote prs_processed to 5, incorrectly
        downgrading coverage to "partial".  Dataset-level coverage must be
        derived from per-PR comments_extracted_at markers, not batch metadata.
        """
        db = _create_test_db(tmp_path)
        try:
            # _seed_pr inserts FK references (org, project, repo, user).
            _seed_pr(db, pr_uid="r1-1", creation_date="2026-01-15T10:00:00Z")
            db.execute(
                "UPDATE pull_requests SET comments_extracted_at = "
                "'2026-01-20T00:00:00Z' WHERE pull_request_uid = 'r1-1'"
            )
            # Seed additional completed PRs (FK entities already exist).
            for i in range(2, 4):
                uid = f"r1-{i}"
                db.execute(
                    "INSERT OR IGNORE INTO pull_requests "
                    "(pull_request_uid, pull_request_id, organization_name, "
                    "project_name, repository_id, user_id, title, status, "
                    "creation_date, comments_extracted_at) "
                    "VALUES (?, ?, 'org', 'proj', 'r1', 'u1', ?, 'completed', "
                    "'2026-01-15T10:00:00Z', '2026-01-20T00:00:00Z')",
                    (uid, i, f"PR {i}"),
                )

            # Simulate incremental run that only processed 1 new PR.
            # Metadata is overwritten with the small batch size.
            db.execute(
                "INSERT INTO comments_extraction_metadata "
                "(id, last_run_timestamp, prs_processed, threads_fetched, "
                "comments_fetched, capped) "
                "VALUES (1, '2026-01-25T00:00:00Z', 1, 0, 0, 0)"
            )

            from ado_git_repo_insights.transform.aggregators import (
                AggregateGenerator,
            )

            output = tmp_path / "agg_out"
            gen = AggregateGenerator(db, output)
            coverage = gen._get_comments_coverage()

            # All 3 completed PRs have comments_extracted_at set from the
            # historical run — coverage must remain "full" regardless of
            # the small batch metadata.
            assert coverage["status"] == "full", (
                "Incremental batch must not degrade coverage when all "
                "completed PRs have per-PR extraction markers"
            )
        finally:
            db.close()

    def test_truncated_thread_fetch_does_not_stamp_coverage(
        self, tmp_path: Path
    ) -> None:
        """Per-PR thread cap must prevent comments_extracted_at stamp.

        Regression: _extract_comments stamped comments_extracted_at even
        when --comments-max-threads-per-pr truncated the thread list,
        causing _get_comments_coverage() to report 'full' for a dataset
        where some vote events may have been skipped.

        This test verifies the stamping logic directly: if a PR had more
        threads than the cap, its comments_extracted_at must remain NULL.
        """
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db, pr_uid="r1-1")
            # Simulate: 2 completed PRs, one truncated, one not.
            # The truncated PR should NOT have comments_extracted_at.
            # The non-truncated PR SHOULD have comments_extracted_at.
            db.execute(
                "UPDATE pull_requests SET comments_extracted_at = "
                "'2026-01-20T00:00:00Z' WHERE pull_request_uid = 'r1-1'"
            )

            db.execute(
                "INSERT OR IGNORE INTO pull_requests "
                "(pull_request_uid, pull_request_id, organization_name, "
                "project_name, repository_id, user_id, title, status, "
                "creation_date) "
                "VALUES ('r1-2', 2, 'org', 'proj', 'r1', 'u1', "
                "'Truncated PR', 'completed', '2026-01-16T08:00:00Z')"
            )
            # r1-2 has NO comments_extracted_at (simulates truncated fetch)

            from ado_git_repo_insights.transform.aggregators import (
                AggregateGenerator,
            )

            output = tmp_path / "agg_out"
            gen = AggregateGenerator(db, output)
            coverage = gen._get_comments_coverage()
            assert coverage["status"] != "full", (
                "Dataset with truncated-fetch PR must not report full coverage"
            )
        finally:
            db.close()

    def test_truncated_rerun_preserves_stamp_when_no_changes(
        self, tmp_path: Path
    ) -> None:
        """Truncated rerun with no unseen thread updates must keep stamp.

        If a PR was fully extracted before and the dropped threads have
        no updates since the last extraction, local data is still complete.
        The stamp must survive so coverage stays correct.
        """
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db, pr_uid="r1-1")
            db.execute(
                "UPDATE pull_requests SET comments_extracted_at = "
                "'2026-01-20T00:00:00Z' WHERE pull_request_uid = 'r1-1'"
            )
            db.execute(
                "INSERT INTO comments_extraction_metadata "
                "(id, last_run_timestamp, prs_processed, threads_fetched, "
                "comments_fetched, capped) "
                "VALUES (1, '2026-01-20T00:00:00Z', 1, 5, 10, 0)"
            )

            from ado_git_repo_insights.transform.aggregators import (
                AggregateGenerator,
            )

            output = tmp_path / "agg_out"
            gen = AggregateGenerator(db, output)
            assert gen._get_comments_coverage()["status"] == "full"

            # Simulate truncated rerun where all dropped threads are
            # unchanged (no-op path in cli.py).  Stamp must survive.
            # (No DB changes — stamp stays as-is.)

            assert gen._get_comments_coverage()["status"] == "full", (
                "Truncated rerun with no unseen updates must preserve stamp"
            )
        finally:
            db.close()

    def test_truncated_rerun_clears_stamp_when_updates_hidden(
        self, tmp_path: Path
    ) -> None:
        """Truncated rerun with unseen thread updates must clear stamp.

        If a PR was fully extracted before but the truncated rerun dropped
        threads that have updates newer than what is stored, local data is
        now incomplete.  The stamp must be cleared.
        """
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db, pr_uid="r1-1")
            db.execute(
                "UPDATE pull_requests SET comments_extracted_at = "
                "'2026-01-20T00:00:00Z' WHERE pull_request_uid = 'r1-1'"
            )
            db.execute(
                "INSERT INTO comments_extraction_metadata "
                "(id, last_run_timestamp, prs_processed, threads_fetched, "
                "comments_fetched, capped) "
                "VALUES (1, '2026-01-20T00:00:00Z', 1, 5, 10, 0)"
            )

            from ado_git_repo_insights.transform.aggregators import (
                AggregateGenerator,
            )

            output = tmp_path / "agg_out"
            gen = AggregateGenerator(db, output)
            assert gen._get_comments_coverage()["status"] == "full"

            # Simulate: truncation hid threads with unseen updates.
            # cli.py clears stamp in this case.
            db.execute(
                "UPDATE pull_requests SET comments_extracted_at = NULL "
                "WHERE pull_request_uid = 'r1-1'"
            )

            coverage = gen._get_comments_coverage()
            assert coverage["status"] != "full", (
                "Truncated rerun with hidden updates must invalidate stamp"
            )
        finally:
            db.close()

    def test_dropped_thread_missing_locally_clears_stamp(self, tmp_path: Path) -> None:
        """Dropped thread absent locally must invalidate stamp even if
        its lastUpdatedDate is older than the stored PR-wide max.

        Regression: the preservation check compared dropped threads'
        lastUpdatedDate against MAX(last_updated) of stored threads.
        A dropped thread with an older timestamp than some other stored
        thread was treated as "unchanged" even though it was never stored.

        Scenario:
        - PR r1-1 previously stamped as fully covered
        - Stored thread t1 with last_updated = 2026-01-10
        - Dropped thread t2 (NOT stored) with lastUpdatedDate = 2026-01-09
        - Old check: "2026-01-09" <= "2026-01-10" → no-op (wrong!)
        - New check: t2 missing from pr_threads → invalidate (correct)
        """
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db, pr_uid="r1-1")
            db.execute(
                "UPDATE pull_requests SET comments_extracted_at = "
                "'2026-01-20T00:00:00Z' WHERE pull_request_uid = 'r1-1'"
            )
            db.execute(
                "INSERT INTO comments_extraction_metadata "
                "(id, last_run_timestamp, prs_processed, threads_fetched, "
                "comments_fetched, capped) "
                "VALUES (1, '2026-01-20T00:00:00Z', 1, 1, 0, 0)"
            )

            # Thread 1 is stored locally with a newer timestamp.
            db.execute(
                "INSERT INTO pr_threads (thread_id, pull_request_uid, "
                "status, last_updated, created_at) "
                "VALUES ('1', 'r1-1', 'active', '2026-01-10T00:00:00Z', "
                "'2026-01-09T00:00:00Z')"
            )

            # Now test _dropped_threads_all_stored directly.
            # Thread 2 is NOT stored but has an older timestamp than thread 1.
            from ado_git_repo_insights.cli import _dropped_threads_all_stored

            dropped = [_make_ado_thread(2, "2026-01-09T00:00:00Z")]
            assert not _dropped_threads_all_stored(db, "r1-1", dropped), (
                "Thread 2 is missing locally — must not be treated as stored"
            )

            # Verify: if thread 2 WERE stored, the check would pass.
            db.execute(
                "INSERT INTO pr_threads (thread_id, pull_request_uid, "
                "status, last_updated, created_at) "
                "VALUES ('2', 'r1-1', 'active', '2026-01-09T00:00:00Z', "
                "'2026-01-08T00:00:00Z')"
            )
            assert _dropped_threads_all_stored(db, "r1-1", dropped), (
                "Thread 2 is now stored and current — should pass"
            )
        finally:
            db.close()

    def test_stale_local_thread_fails_dropped_check(self, tmp_path: Path) -> None:
        """Stored thread with older last_updated than API must return False.

        The thread exists locally but the API has a newer version.
        _dropped_threads_all_stored must detect the staleness.
        """
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db, pr_uid="r1-1")
            # Thread stored locally with older timestamp.
            db.execute(
                "INSERT INTO pr_threads (thread_id, pull_request_uid, "
                "status, last_updated, created_at) "
                "VALUES ('1', 'r1-1', 'active', '2026-01-08T00:00:00Z', "
                "'2026-01-07T00:00:00Z')"
            )

            from ado_git_repo_insights.cli import _dropped_threads_all_stored

            # API has a newer version of this thread.
            dropped = [_make_ado_thread(1, "2026-01-10T00:00:00Z")]
            assert not _dropped_threads_all_stored(db, "r1-1", dropped), (
                "Local thread is stale (API updated 01-10, local 01-08) — "
                "must not treat as current"
            )

            # After updating the local thread, it should pass.
            db.execute(
                "UPDATE pr_threads SET last_updated = '2026-01-10T00:00:00Z' "
                "WHERE thread_id = '1' AND pull_request_uid = 'r1-1'"
            )
            assert _dropped_threads_all_stored(db, "r1-1", dropped), (
                "Local thread now current — should pass"
            )
        finally:
            db.close()

    def test_cross_pr_thread_id_does_not_preserve_stamp(self, tmp_path: Path) -> None:
        """Thread stored for PR B must not make PR A pass the dropped check.

        Regression: _dropped_threads_all_stored queried pr_threads by
        thread_id alone.  ADO thread IDs are PR-scoped integers, so two
        PRs can share the same numeric thread_id.  A match on the wrong
        PR falsely preserved coverage.
        """
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db, pr_uid="r1-1")
            # Seed a second PR with its own FK references.
            db.execute(
                "INSERT OR IGNORE INTO pull_requests "
                "(pull_request_uid, pull_request_id, organization_name, "
                "project_name, repository_id, user_id, title, status, "
                "creation_date) "
                "VALUES ('r1-2', 2, 'org', 'proj', 'r1', 'u1', "
                "'PR 2', 'completed', '2026-01-16T08:00:00Z')"
            )

            # Thread "1" stored for PR r1-2 only.
            db.execute(
                "INSERT INTO pr_threads (thread_id, pull_request_uid, "
                "status, last_updated, created_at) "
                "VALUES ('1', 'r1-2', 'active', '2026-01-16T00:00:00Z', "
                "'2026-01-16T00:00:00Z')"
            )

            from ado_git_repo_insights.cli import _dropped_threads_all_stored

            # Dropped thread "1" for PR r1-1.  Only r1-2 has it stored.
            dropped = [_make_ado_thread(1, "2026-01-15T00:00:00Z")]
            assert not _dropped_threads_all_stored(db, "r1-1", dropped), (
                "Thread '1' exists for r1-2 but NOT r1-1 — must not match"
            )

            # If r1-1 also has the thread stored, it should pass.
            db.execute(
                "INSERT INTO pr_threads (thread_id, pull_request_uid, "
                "status, last_updated, created_at) "
                "VALUES ('1', 'r1-1', 'active', '2026-01-15T00:00:00Z', "
                "'2026-01-15T00:00:00Z')"
            )
            assert _dropped_threads_all_stored(db, "r1-1", dropped), (
                "Thread '1' now stored for r1-1 — should pass"
            )
        finally:
            db.close()

    def test_backfill_helper_populates_review_time(self, tmp_path: Path) -> None:
        """DB with pr_comments but no review_time_minutes gets backfilled
        when _backfill_review_timestamps_if_needed() runs.

        Regression: populate_review_timestamps was only wired into cmd_extract.
        generate-aggregates and build-aggregates on an upgraded DB with existing
        comment data produced null review_time rollups. The shared helper must
        work identically from all three entry points.
        """
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

            # Verify review_time_minutes is NULL before backfill
            pr_before = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr_before is not None
            assert pr_before["review_time_minutes"] is None

            # Simulate what cmd_generate_aggregates now does:
            from ado_git_repo_insights.cli import (
                _backfill_review_timestamps_if_needed,
            )

            _backfill_review_timestamps_if_needed(db)

            # review_time_minutes must now be populated
            pr_after = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr_after is not None
            assert pr_after["review_time_minutes"] is not None, (
                "Aggregate-path backfill must populate review_time_minutes"
            )
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

        # After connect, migrations run and create empty comment tables.
        # The CLI backfill guard must still degrade gracefully (no crash,
        # no backfill on empty tables).
        db = DatabaseManager(db_path)
        db.connect()
        try:
            from ado_git_repo_insights.cli import (
                _backfill_review_timestamps_if_needed,
            )

            # Must not crash — empty comment tables are a no-op.
            _backfill_review_timestamps_if_needed(db)
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


# ---------------------------------------------------------------------------
# F6: Malformed timestamp handling
# ---------------------------------------------------------------------------


class TestMalformedTimestamp:
    """Malformed created_at on vote comments must be safely skipped."""

    def test_malformed_created_at_skipped_gracefully(self, tmp_path: Path) -> None:
        """Vote comment with unparseable timestamp → no crash, reviewed_at NULL."""
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db)
            _seed_reviewer(db)
            _seed_system_comment(
                db, "c1", "r1-1", "u1", "Reviewer A voted 10", "NOT-A-DATE"
            )
            db.connection.commit()

            count = populate_review_timestamps(db)
            assert count == 0

            reviewer = db.execute(
                "SELECT reviewed_at FROM reviewers "
                "WHERE pull_request_uid = 'r1-1' AND user_id = 'u1'"
            ).fetchone()
            assert reviewer is not None
            assert reviewer["reviewed_at"] is None
        finally:
            db.close()

    def test_malformed_among_valid_uses_valid(self, tmp_path: Path) -> None:
        """Same reviewer: one malformed + one valid → valid timestamp used."""
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db)
            _seed_reviewer(db)
            _seed_system_comment(
                db, "c1", "r1-1", "u1", "Reviewer A voted 10", "NOT-A-DATE"
            )
            _seed_system_comment(
                db,
                "c2",
                "r1-1",
                "u1",
                "Reviewer A voted 10",
                "2026-01-16T14:00:00Z",
            )
            db.connection.commit()

            count = populate_review_timestamps(db)
            assert count == 1

            reviewer = db.execute(
                "SELECT reviewed_at FROM reviewers "
                "WHERE pull_request_uid = 'r1-1' AND user_id = 'u1'"
            ).fetchone()
            assert reviewer is not None
            assert reviewer["reviewed_at"] == "2026-01-16T14:00:00Z"
        finally:
            db.close()

    def test_malformed_does_not_corrupt_other_reviewers(self, tmp_path: Path) -> None:
        """Reviewer A malformed, reviewer B valid → B correct, A NULL.

        Ensures malformed data on one reviewer doesn't propagate to
        another reviewer's calculations or to review_time_minutes.
        """
        db = _create_test_db(tmp_path)
        try:
            _seed_pr(db)
            _seed_reviewer(db, user_id="u1")
            _seed_reviewer(db, user_id="u2")
            # u1 has only a malformed timestamp.
            _seed_system_comment(
                db, "c1", "r1-1", "u1", "Reviewer A voted 10", "GARBAGE"
            )
            # u2 has a valid timestamp.
            _seed_system_comment(
                db,
                "c2",
                "r1-1",
                "u2",
                "Reviewer B voted 10",
                "2026-01-16T14:00:00Z",
            )
            db.connection.commit()

            count = populate_review_timestamps(db)
            assert count == 1

            # u1's reviewed_at should be NULL (malformed skipped).
            r1 = db.execute(
                "SELECT reviewed_at FROM reviewers "
                "WHERE pull_request_uid = 'r1-1' AND user_id = 'u1'"
            ).fetchone()
            assert r1 is not None
            assert r1["reviewed_at"] is None

            # u2's reviewed_at should be set correctly.
            r2 = db.execute(
                "SELECT reviewed_at FROM reviewers "
                "WHERE pull_request_uid = 'r1-1' AND user_id = 'u2'"
            ).fetchone()
            assert r2 is not None
            assert r2["reviewed_at"] == "2026-01-16T14:00:00Z"

            # review_time_minutes should be computed from u2's valid timestamp.
            pr = db.execute(
                "SELECT review_time_minutes FROM pull_requests "
                "WHERE pull_request_uid = 'r1-1'"
            ).fetchone()
            assert pr is not None
            assert pr["review_time_minutes"] is not None
            assert pr["review_time_minutes"] > 0
        finally:
            db.close()
