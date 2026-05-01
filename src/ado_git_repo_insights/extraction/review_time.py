"""Extract review timestamps from stored PR thread system comments.

Scans ``pr_comments`` for vote events (``comment_type = 'system'``,
content matching the shared
``ado_git_repo_insights.extraction.vote_events.VOTE_PATTERN``) and
populates:

- ``reviewers.reviewed_at`` — earliest positive vote timestamp per reviewer
- ``pull_requests.review_time_minutes`` — earliest approval − creation_date

Convergence guarantee: on every run the function first clears prior
review timestamps for every PR in the recompute scope (PRs that have
stored comment data), then repopulates from the current state of
``pr_comments``.  If a previously positive vote was deleted or
reclassified, the cleared values stay NULL — no stale data survives.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import TYPE_CHECKING

from ado_git_repo_insights.extraction.vote_events import VOTE_PATTERN
from ado_git_repo_insights.utils.datetime_utils import (
    calculate_review_time_minutes,
    parse_iso_datetime,
)

if TYPE_CHECKING:
    from ado_git_repo_insights.persistence.database import DatabaseManager

logger = logging.getLogger(__name__)

# Positive vote values (approve=10, approve-with-suggestions=5)
_POSITIVE_VOTES = frozenset({5, 10})


def populate_review_timestamps(db: DatabaseManager) -> int:
    """Scan stored thread comments for vote events and update review timestamps.

    Operates on a PR-scoped set: only PRs that have at least one row in
    ``pr_comments`` are touched.  PRs without comment data are never
    modified, preserving their existing state (typically NULL).

    Convergence: clears ``reviewed_at`` and ``review_time_minutes`` for
    all scoped PRs before repopulating, so deleted/reclassified votes
    correctly produce NULL on rerun.

    Returns:
        Number of PRs that had review_time_minutes populated.
    """
    # Step 1: Determine recompute scope — PRs with stored comment data.
    scope_rows = db.execute(
        "SELECT DISTINCT pull_request_uid FROM pr_comments"
    ).fetchall()
    scoped_pr_uids = [row["pull_request_uid"] for row in scope_rows]

    if not scoped_pr_uids:
        logger.info("No stored comment data — skipping review timestamp recompute")
        return 0

    logger.info(
        f"Review time recompute scope: {len(scoped_pr_uids)} PRs with comment data"
    )

    # Wrap all mutations in a transaction so a crash between clearing
    # (Step 2) and repopulating (Steps 5-6) never leaves the DB with
    # wiped timestamps.  The connection uses isolation_level=None
    # (autocommit), so BEGIN/COMMIT must be explicit.
    db.execute("BEGIN TRANSACTION")
    try:
        updated_count = _recompute_review_timestamps(db, scoped_pr_uids)
        db.execute("COMMIT")
    except BaseException:
        db.execute("ROLLBACK")
        raise

    return updated_count


def _recompute_review_timestamps(
    db: DatabaseManager,
    scoped_pr_uids: list[str],
) -> int:
    """Recompute review timestamps within an active transaction.

    Separated from :func:`populate_review_timestamps` so the caller
    can wrap the full clear-then-repopulate cycle in a single
    transaction, preventing a partial-clear state on crash.
    """
    # Step 2: Clear prior review timestamps for ALL scoped PRs.
    # This ensures convergence: if a vote was deleted since last run,
    # the old reviewed_at/review_time_minutes won't persist.
    # Uses a subquery join instead of IN(...) to avoid f-string SQL (S608).
    db.execute(
        "UPDATE reviewers SET reviewed_at = NULL "
        "WHERE pull_request_uid IN "
        "(SELECT DISTINCT pull_request_uid FROM pr_comments)"
    )
    db.execute(
        "UPDATE pull_requests SET review_time_minutes = NULL "
        "WHERE pull_request_uid IN "
        "(SELECT DISTINCT pull_request_uid FROM pr_comments)"
    )

    # Step 3: Find positive vote events from stored system comments.
    # Excludes deleted comments per FR-011.
    rows = db.execute(
        """
        SELECT
            c.pull_request_uid,
            c.author_id,
            c.content,
            c.created_at
        FROM pr_comments c
        WHERE c.comment_type = 'system'
          AND c.is_deleted = 0
          AND c.content IS NOT NULL
        ORDER BY c.pull_request_uid, c.created_at
        """
    ).fetchall()

    # Step 4: Parse vote events.
    #
    # Collect earliest positive vote AND latest vote (any value) per
    # (pull_request_uid, author_id).  A reviewer whose latest vote is
    # negative/neutral has withdrawn their approval — they must not
    # contribute to review_time even if an earlier positive vote exists.
    earliest_positive: dict[tuple[str, str], tuple[datetime, str]] = {}
    latest_vote: dict[tuple[str, str], tuple[datetime, int]] = {}

    for row in rows:
        content = row["content"]
        match = VOTE_PATTERN.match(content)
        if not match:
            continue
        vote_value = int(match.group(2))

        pr_uid = row["pull_request_uid"]
        author_id = row["author_id"]
        vote_ts_raw: str = row["created_at"]
        vote_dt = parse_iso_datetime(vote_ts_raw)
        if vote_dt is None:
            continue
        key = (pr_uid, author_id)

        # Track latest vote (any value) for withdrawal detection.
        if key not in latest_vote or vote_dt > latest_vote[key][0]:
            latest_vote[key] = (vote_dt, vote_value)

        # Track earliest positive vote.
        if vote_value not in _POSITIVE_VOTES:
            continue
        if key not in earliest_positive or vote_dt < earliest_positive[key][0]:
            earliest_positive[key] = (vote_dt, vote_ts_raw)

    # Exclude reviewers whose latest vote withdrew the approval.
    earliest_votes: dict[tuple[str, str], tuple[datetime, str]] = {
        key: val
        for key, val in earliest_positive.items()
        if latest_vote[key][1] in _POSITIVE_VOTES
    }

    if not earliest_votes:
        logger.info(
            "No positive vote events in stored threads — "
            "review timestamps cleared for scoped PRs"
        )
        return 0

    # Step 5: Apply discovered votes to reviewers.reviewed_at.
    for (pr_uid, author_id), (_vote_dt, vote_ts_raw) in earliest_votes.items():
        db.execute(
            """
            UPDATE reviewers
            SET reviewed_at = ?
            WHERE pull_request_uid = ?
              AND user_id = ?
            """,
            (vote_ts_raw, pr_uid, author_id),
        )

    # Step 6: Compute review_time_minutes from the earliest positive vote
    # per PR, using the earliest_votes dict (derived from pr_comments) as
    # the sole authority.  We do NOT join the reviewers table here because
    # removed reviewers are never deleted from it — a stale vote=10 row
    # would keep a removed reviewer's approval alive after incremental
    # re-extracts.  The earliest_votes dict already filters to positive
    # vote events and handles withdrawn approvals via convergence (Steps 2+5).

    # Aggregate to earliest vote per PR.
    pr_earliest: dict[str, tuple[datetime, str]] = {}
    for (pr_uid, _author_id), (vote_dt, vote_ts_raw) in earliest_votes.items():
        if pr_uid not in pr_earliest or vote_dt < pr_earliest[pr_uid][0]:
            pr_earliest[pr_uid] = (vote_dt, vote_ts_raw)

    updated_count = 0
    dropped_post_close = 0

    for pr_uid, (_vote_dt, vote_ts_raw) in pr_earliest.items():
        result = db.execute(
            "SELECT creation_date, closed_date FROM pull_requests "
            "WHERE pull_request_uid = ?",
            (pr_uid,),
        ).fetchone()

        if result is None:
            continue

        creation_date: str | None = result["creation_date"]
        closed_date: str | None = result["closed_date"]

        # SC-002: Drop post-close approvals.  If the earliest positive
        # vote arrived after the PR was already closed, the resulting
        # review_time_minutes would exceed cycle_time_minutes — an
        # impossible duration that must not enter aggregates.
        reviewed_dt = parse_iso_datetime(vote_ts_raw)
        closed_dt = parse_iso_datetime(closed_date)
        if (
            reviewed_dt is not None
            and closed_dt is not None
            and reviewed_dt > closed_dt
        ):
            dropped_post_close += 1
            # review_time_minutes was already cleared to NULL in Step 2;
            # leaving it NULL is the correct outcome.
            continue

        review_minutes = calculate_review_time_minutes(creation_date, vote_ts_raw)

        db.execute(
            "UPDATE pull_requests SET review_time_minutes = ? "
            "WHERE pull_request_uid = ?",
            (review_minutes, pr_uid),
        )
        updated_count += 1

    if dropped_post_close > 0:
        logger.info(
            f"Dropped {dropped_post_close} PR(s) with post-close approvals "
            f"(review_time_minutes set to NULL)"
        )

    logger.info(
        f"Review timestamps populated: {len(earliest_votes)} reviewer votes, "
        f"{updated_count} PRs with review_time_minutes"
    )
    return updated_count
