"""Extract review timestamps from stored PR thread system comments.

Scans ``pr_comments`` for vote events (``comment_type = 'system'``,
content matching ``^(.+) voted (-?\\d+)$``) and populates:

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
import re
from datetime import datetime
from typing import TYPE_CHECKING

from ado_git_repo_insights.utils.datetime_utils import (
    calculate_review_time_minutes,
    parse_iso_datetime,
)

if TYPE_CHECKING:
    from ado_git_repo_insights.persistence.database import DatabaseManager

logger = logging.getLogger(__name__)

# Matches ADO system comments for vote events:
#   "PM P voted 10", "admin@oddessentials.com voted -10"
_VOTE_PATTERN = re.compile(r"^(.+) voted (-?\d+)$")

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

    # Step 4: Parse vote events and collect earliest positive vote per
    # (pull_request_uid, author_id).
    earliest_votes: dict[tuple[str, str], tuple[datetime, str]] = {}

    for row in rows:
        content = row["content"]
        match = _VOTE_PATTERN.match(content)
        if not match:
            continue
        vote_value = int(match.group(2))
        if vote_value not in _POSITIVE_VOTES:
            continue

        pr_uid = row["pull_request_uid"]
        author_id = row["author_id"]
        vote_ts_raw: str = row["created_at"]
        vote_dt = parse_iso_datetime(vote_ts_raw)
        if vote_dt is None:
            continue
        key = (pr_uid, author_id)

        if key not in earliest_votes or vote_dt < earliest_votes[key][0]:
            earliest_votes[key] = (vote_dt, vote_ts_raw)

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

    # Step 6: Compute review_time_minutes on each PR from the earliest
    # positive reviewed_at across all its reviewers.
    pr_uids_with_votes = {pr_uid for pr_uid, _ in earliest_votes}
    updated_count = 0

    for pr_uid in pr_uids_with_votes:
        result = db.execute(
            """
            SELECT
                p.creation_date,
                MIN(r.reviewed_at) AS earliest_reviewed_at
            FROM pull_requests p
            JOIN reviewers r ON r.pull_request_uid = p.pull_request_uid
            WHERE p.pull_request_uid = ?
              AND r.reviewed_at IS NOT NULL
            GROUP BY p.pull_request_uid
            """,
            (pr_uid,),
        ).fetchone()

        if result is None:
            continue

        creation_date: str | None = result["creation_date"]
        earliest_reviewed_at: str | None = result["earliest_reviewed_at"]
        review_minutes = calculate_review_time_minutes(
            creation_date, earliest_reviewed_at
        )

        db.execute(
            "UPDATE pull_requests SET review_time_minutes = ? "
            "WHERE pull_request_uid = ?",
            (review_minutes, pr_uid),
        )
        updated_count += 1

    # Step 7: SC-002 invariant check — review_time should not exceed cycle_time.
    invariant_row = db.execute(
        "SELECT COUNT(*) AS count FROM pull_requests "
        "WHERE review_time_minutes IS NOT NULL "
        "AND cycle_time_minutes IS NOT NULL "
        "AND review_time_minutes > cycle_time_minutes"
    ).fetchone()
    violation_count = int(invariant_row["count"]) if invariant_row else 0
    if violation_count > 0:
        logger.warning(
            f"SC-002 invariant: {violation_count} PR(s) have "
            f"review_time_minutes > cycle_time_minutes "
            f"(possible post-merge approval votes)"
        )

    logger.info(
        f"Review timestamps populated: {len(earliest_votes)} reviewer votes, "
        f"{updated_count} PRs with review_time_minutes"
    )
    return updated_count
