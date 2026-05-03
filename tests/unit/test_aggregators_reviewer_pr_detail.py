"""Unit tests for Feature 362 producer-side per-(reviewer, week) PR detail.

Producer contract: ``specs/362-reviewer-pr-drilldown/contracts/per-reviewer-week-prs.md``.

Covers the producer-side requirements asserted by Feature 362's contract:

- Basic emission shape (T013): every ``by_reviewer[reviewer_id]`` entry
  carries the new atomic trio (``prs`` / ``_prs_truncated`` / ``_prs_cap``);
  each ``PrRecord`` has the locked five fields plus the optional Feature-310
  triplet when capability is on; sort is ``cycle_time desc, id asc``;
  ``_prs_cap`` is always 500.
- Duplication invariant (T014): a PR reviewed by ``N`` distinct reviewers
  appears in ``N`` per-(reviewer, week) entries — the byte-cost trade-off
  acknowledged in CL-01.
- Cap-boundary regression at 500 / 501 (T027 / FR-029): the retained 500
  records under truncation are the slowest cycle-times by sort, with
  ``id`` ascending tiebreak; the dropped record is the fastest by
  cycle-time.
- ``prs.length == _prs_cap`` invariant under truncation (T028).
- Atomicity (T029): every reviewer entry where ``prs`` is present also
  has ``_prs_truncated`` and ``_prs_cap``.

Harness mirrors ``tests/unit/test_aggregators_pr_records.py`` (Feature 060
producer test scaffold).  No FK manipulation needed — the reviewers table
joins against the canonical PR set produced by the fixture.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import date, timedelta
from pathlib import Path
from typing import Final

import pytest

from ado_git_repo_insights.persistence.database import DatabaseManager
from ado_git_repo_insights.transform.aggregators import (
    _PR_DETAIL_CAP_PER_REVIEWER_WEEK,
    AggregateGenerator,
)

ORG_NAME: Final[str] = "org1"
PROJECT_NAME: Final[str] = "proj1"
REPOSITORY_ID: Final[str] = "repo1"
AUTHOR_USER_ID: Final[str] = "author-1"
REVIEWER_A: Final[str] = "reviewer-a"
REVIEWER_B: Final[str] = "reviewer-b"
REVIEWER_C: Final[str] = "reviewer-c"


def _week_monday(year: int, iso_week: int) -> date:
    return date.fromisocalendar(year, iso_week, 1)


def _insert_pr(
    db: DatabaseManager,
    *,
    uid: str,
    pr_id: int,
    closed_date: str,
    cycle_time_minutes: float | None,
    title: str | None = None,
) -> None:
    db.execute(
        """
        INSERT INTO pull_requests (
            pull_request_uid, pull_request_id, organization_name,
            project_name, repository_id, user_id, title, status,
            description, creation_date, closed_date, cycle_time_minutes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            uid,
            pr_id,
            ORG_NAME,
            PROJECT_NAME,
            REPOSITORY_ID,
            AUTHOR_USER_ID,
            title if title is not None else f"PR {pr_id}",
            "completed",
            None,
            "2026-01-01T00:00:00Z",
            closed_date,
            cycle_time_minutes,
        ),
    )


def _insert_reviewer(
    db: DatabaseManager,
    *,
    uid: str,
    user_id: str,
    vote: int,
) -> None:
    db.execute(
        "INSERT INTO reviewers (pull_request_uid, user_id, vote, repository_id) "
        "VALUES (?, ?, ?, ?)",
        (uid, user_id, vote, REPOSITORY_ID),
    )


@pytest.fixture
def reviewer_pr_detail_db(
    tmp_path: Path,
) -> Iterator[tuple[DatabaseManager, Path]]:
    """Database pre-seeded with the canonical org / project / repo / users."""
    db_path = tmp_path / "reviewer-pr-detail.sqlite"
    db = DatabaseManager(db_path)
    db.connect()

    db.execute("INSERT INTO organizations (organization_name) VALUES (?)", (ORG_NAME,))
    db.execute(
        "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
        (ORG_NAME, PROJECT_NAME),
    )
    db.execute(
        "INSERT INTO repositories (repository_id, repository_name, "
        "project_name, organization_name) VALUES (?, ?, ?, ?)",
        (REPOSITORY_ID, "Repository 1", PROJECT_NAME, ORG_NAME),
    )
    db.execute(
        "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
        (AUTHOR_USER_ID, "Author One", "author1@example.com"),
    )
    for reviewer_id, name in (
        (REVIEWER_A, "Reviewer Alpha"),
        (REVIEWER_B, "Reviewer Bravo"),
        (REVIEWER_C, "Reviewer Charlie"),
    ):
        db.execute(
            "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
            (reviewer_id, name, f"{reviewer_id}@example.com"),
        )
    db.connection.commit()

    yield db, tmp_path

    db.close()


def _read_single_rollup(tmp_path: Path) -> dict[str, object]:
    rollup_files = list(
        (tmp_path / "out" / "aggregates" / "weekly_rollups").glob("*.json"),
    )
    assert len(rollup_files) == 1, f"expected 1 rollup, got {len(rollup_files)}"
    payload = json.loads(rollup_files[0].read_text(encoding="utf-8"))
    assert isinstance(payload, dict)
    return payload


def _generate(tmp_path: Path, db: DatabaseManager) -> dict[str, object]:
    db.connection.commit()
    AggregateGenerator(db, tmp_path / "out").generate_all()
    return _read_single_rollup(tmp_path)


def _by_reviewer(rollup: dict[str, object]) -> dict[str, dict[str, object]]:
    by_reviewer = rollup.get("by_reviewer")
    assert isinstance(by_reviewer, dict)
    typed: dict[str, dict[str, object]] = {}
    for key, value in by_reviewer.items():
        assert isinstance(key, str)
        assert isinstance(value, dict)
        typed[key] = value
    return typed


# ---------------------------------------------------------------------------
# T013 — basic emission shape + sort + atomicity (FR-016, contract §§ 1-7)
# ---------------------------------------------------------------------------


def test_basic_emission_shape_and_sort_with_atomicity(
    reviewer_pr_detail_db: tuple[DatabaseManager, Path],
) -> None:
    """Each reviewer entry carries the atomic trio with cycle_time-desc / id-asc sort.

    Five PRs, three reviewers; deterministic cycle-times so the sort order
    is exact; assignments distributed so each reviewer reviews a known
    subset.  Asserts:

      * Every reviewer entry has all three new fields together (atomicity).
      * ``_prs_cap`` equals 500; ``_prs_truncated`` is ``false`` (under cap).
      * ``len(prs) == reviewed_prs`` (coherence under non-truncation, § 7).
      * Sort order within each reviewer's slice is ``cycle_time desc,
        id asc`` (CL-02 guardrail #4 / contract § 3).
      * Each PrRecord has exactly the locked five 060 fields (no Feature-310
        capability fields on this fixture — no pr_threads rows).
    """
    db, tmp_path = reviewer_pr_detail_db
    monday = _week_monday(2026, 5)
    # Five PRs with deterministic cycle-times.  Cycle times differ enough
    # to anchor the sort order without ties.
    prs = [
        ("repo1-1", 1, 100.0, "PR 1"),
        ("repo1-2", 2, 200.0, "PR 2"),
        ("repo1-3", 3, 300.0, "PR 3"),
        ("repo1-4", 4, 400.0, "PR 4"),
        ("repo1-5", 5, 500.0, "PR 5"),
    ]
    for offset, (uid, pr_id, cycle_time, title) in enumerate(prs):
        _insert_pr(
            db,
            uid=uid,
            pr_id=pr_id,
            closed_date=(monday + timedelta(days=offset)).isoformat(),
            cycle_time_minutes=cycle_time,
            title=title,
        )
    # Reviewer assignments: A=[1,2,3], B=[2,3,4,5], C=[3,4].
    review_map: dict[str, list[str]] = {
        REVIEWER_A: ["repo1-1", "repo1-2", "repo1-3"],
        REVIEWER_B: ["repo1-2", "repo1-3", "repo1-4", "repo1-5"],
        REVIEWER_C: ["repo1-3", "repo1-4"],
    }
    for reviewer_id, uids in review_map.items():
        for uid in uids:
            _insert_reviewer(db, uid=uid, user_id=reviewer_id, vote=10)

    rollup = _generate(tmp_path, db)
    by_reviewer = _by_reviewer(rollup)
    assert set(by_reviewer.keys()) == {REVIEWER_A, REVIEWER_B, REVIEWER_C}

    expected_by_reviewer = {
        REVIEWER_A: [3, 2, 1],
        REVIEWER_B: [5, 4, 3, 2],
        REVIEWER_C: [4, 3],
    }
    for reviewer_id, expected_ids in expected_by_reviewer.items():
        entry = by_reviewer[reviewer_id]
        # Atomicity — all three present together.
        assert "prs" in entry
        assert "_prs_truncated" in entry
        assert "_prs_cap" in entry
        prs_array = entry["prs"]
        assert isinstance(prs_array, list)
        assert entry["_prs_truncated"] is False
        assert entry["_prs_cap"] == 500
        # Coherence under non-truncation (§ 7 (1)).
        assert len(prs_array) == entry["reviewed_prs"]
        # Sort order.
        ids_in_order = [row["id"] for row in prs_array if isinstance(row, dict)]
        assert ids_in_order == expected_ids
        # Locked PrRecord shape (5 fields; no 310 triplet on this fixture
        # because no pr_threads rows exist).
        for row in prs_array:
            assert isinstance(row, dict)
            assert set(row.keys()) == {
                "id",
                "title",
                "author_id",
                "repository_id",
                "cycle_time",
            }
            assert row["author_id"] == AUTHOR_USER_ID
            assert row["repository_id"] == REPOSITORY_ID


# ---------------------------------------------------------------------------
# T014 — duplication invariant (FR-016, contract § 7 (3))
# ---------------------------------------------------------------------------


def test_duplication_invariant_n_reviewers_k_prs(
    reviewer_pr_detail_db: tuple[DatabaseManager, Path],
) -> None:
    """A PR reviewed by N reviewers appears in N per-(reviewer, week) entries.

    Three reviewers each reviewing the same four PRs — sum of
    ``len(by_reviewer[r].prs)`` across the three reviewers equals
    ``N * K = 3 * 4 = 12``, mirroring the cross-bucket multi-counting
    semantic that CL-01's byte-cost trade-off acknowledged.
    """
    db, tmp_path = reviewer_pr_detail_db
    monday = _week_monday(2026, 6)
    pr_ids = [101, 102, 103, 104]
    for offset, pr_id in enumerate(pr_ids):
        _insert_pr(
            db,
            uid=f"repo1-{pr_id}",
            pr_id=pr_id,
            closed_date=(monday + timedelta(days=offset)).isoformat(),
            cycle_time_minutes=100.0 + offset * 50.0,
        )
    for reviewer_id in (REVIEWER_A, REVIEWER_B, REVIEWER_C):
        for pr_id in pr_ids:
            _insert_reviewer(
                db,
                uid=f"repo1-{pr_id}",
                user_id=reviewer_id,
                vote=10,
            )

    rollup = _generate(tmp_path, db)
    by_reviewer = _by_reviewer(rollup)
    total_pr_entries = 0
    for reviewer_id in (REVIEWER_A, REVIEWER_B, REVIEWER_C):
        prs_array = by_reviewer[reviewer_id]["prs"]
        assert isinstance(prs_array, list)
        assert len(prs_array) == len(pr_ids)
        total_pr_entries += len(prs_array)
    assert total_pr_entries == len(pr_ids) * 3  # N=3 reviewers × K=4 PRs = 12
    # Sanity check on the alias's value (the source-of-truth single edit
    # point per CL-02 guardrail #1).
    assert _PR_DETAIL_CAP_PER_REVIEWER_WEEK == 500


# ---------------------------------------------------------------------------
# T027 — cap-boundary regression at 500 / 501 (FR-029, contract § 6)
# ---------------------------------------------------------------------------


def test_cap_boundary_at_exactly_500_records_no_truncation(
    reviewer_pr_detail_db: tuple[DatabaseManager, Path],
) -> None:
    """Exactly 500 reviewed PRs: emitted slice is all 500, ``_prs_truncated == false``.

    Locks the boundary semantic at the cap value: the cap is the SIZE of
    the retained slice, not a hard upper bound — at exactly 500 nothing
    was dropped, so the truncation flag stays ``false`` (CL-02 guardrail #2).
    """
    db, tmp_path = reviewer_pr_detail_db
    monday = _week_monday(2026, 7)
    # 500 PRs with cycle-times evenly spaced from 100 to 599 minutes; ids
    # 1..500.  Reviewer A votes on each.  Expected sort: cycle-time
    # descending → ids 500, 499, ..., 1 (id-asc tiebreak unused since each
    # cycle-time is unique).
    for pr_id in range(1, 501):
        _insert_pr(
            db,
            uid=f"repo1-{pr_id}",
            pr_id=pr_id,
            closed_date=(monday + timedelta(days=pr_id % 7)).isoformat(),
            cycle_time_minutes=100.0 + float(pr_id - 1),
        )
        _insert_reviewer(
            db,
            uid=f"repo1-{pr_id}",
            user_id=REVIEWER_A,
            vote=10,
        )

    rollup = _generate(tmp_path, db)
    by_reviewer = _by_reviewer(rollup)
    entry = by_reviewer[REVIEWER_A]
    assert entry["_prs_cap"] == 500
    assert entry["_prs_truncated"] is False
    prs_array = entry["prs"]
    assert isinstance(prs_array, list)
    assert len(prs_array) == 500
    # All 500 PRs present, sorted cycle_time desc.
    ids = [row["id"] for row in prs_array if isinstance(row, dict)]
    assert ids == list(range(500, 0, -1))


def test_cap_boundary_at_501_records_truncates_to_top_500_by_cycle_time(
    reviewer_pr_detail_db: tuple[DatabaseManager, Path],
) -> None:
    """501 reviewed PRs: emitted slice is the 500 highest cycle-times.

    The added 501st record has the FASTEST cycle-time (50.0); under the
    sort-before-truncate contract, it is the record dropped.  Asserts:

      * ``_prs_truncated == true``, ``_prs_cap == 500``.
      * ``len(prs) == 500`` (T028 invariant under truncation).
      * The retained 500 records are ids 1..500 (the slowest cycle-times),
        sorted cycle_time desc → ids 500, 499, ..., 1.
      * The dropped id is 501 (the 50.0-minute record).

    This is the FR-029 cap-boundary regression lock — without sort-before-
    truncate, the truncation would drop in arrival order or arbitrary order.
    """
    db, tmp_path = reviewer_pr_detail_db
    monday = _week_monday(2026, 8)
    for pr_id in range(1, 501):
        _insert_pr(
            db,
            uid=f"repo1-{pr_id}",
            pr_id=pr_id,
            closed_date=(monday + timedelta(days=pr_id % 7)).isoformat(),
            cycle_time_minutes=100.0 + float(pr_id - 1),
        )
        _insert_reviewer(
            db,
            uid=f"repo1-{pr_id}",
            user_id=REVIEWER_A,
            vote=10,
        )
    # 501st record — the fastest by cycle_time.  Under sort-before-truncate
    # this is the record dropped to fit the 500-cap.
    _insert_pr(
        db,
        uid="repo1-501",
        pr_id=501,
        closed_date=(monday + timedelta(days=1)).isoformat(),
        cycle_time_minutes=50.0,
    )
    _insert_reviewer(
        db,
        uid="repo1-501",
        user_id=REVIEWER_A,
        vote=10,
    )

    rollup = _generate(tmp_path, db)
    by_reviewer = _by_reviewer(rollup)
    entry = by_reviewer[REVIEWER_A]
    assert entry["_prs_cap"] == 500
    assert entry["_prs_truncated"] is True
    prs_array = entry["prs"]
    assert isinstance(prs_array, list)
    assert len(prs_array) == 500  # T028 invariant.
    ids = [row["id"] for row in prs_array if isinstance(row, dict)]
    # Retained 500 are ids 1..500 (cycle-times 100..599); dropped is id
    # 501 (cycle-time 50).  Sorted cycle_time desc → 500, 499, ..., 1.
    assert ids == list(range(500, 0, -1))
    assert 501 not in ids


# ---------------------------------------------------------------------------
# T028 — prs.length == _prs_cap under truncation (FR-016, contract § 7 (2))
# ---------------------------------------------------------------------------


def test_prs_length_equals_cap_under_truncation(
    reviewer_pr_detail_db: tuple[DatabaseManager, Path],
) -> None:
    """Under truncation, ``len(prs)`` exactly matches ``_prs_cap``.

    Built on the 501-record fixture: with the cap at 500, the slice MUST
    be exactly 500 records — never 499, never 501.
    """
    db, tmp_path = reviewer_pr_detail_db
    monday = _week_monday(2026, 9)
    # 600 PRs to ensure truncation fires.
    for pr_id in range(1, 601):
        _insert_pr(
            db,
            uid=f"repo1-{pr_id}",
            pr_id=pr_id,
            closed_date=(monday + timedelta(days=pr_id % 7)).isoformat(),
            cycle_time_minutes=100.0 + float(pr_id - 1),
        )
        _insert_reviewer(
            db,
            uid=f"repo1-{pr_id}",
            user_id=REVIEWER_A,
            vote=10,
        )

    rollup = _generate(tmp_path, db)
    entry = _by_reviewer(rollup)[REVIEWER_A]
    assert entry["_prs_truncated"] is True
    prs_array = entry["prs"]
    assert isinstance(prs_array, list)
    assert len(prs_array) == entry["_prs_cap"] == 500


# ---------------------------------------------------------------------------
# T029 — atomicity: _prs_cap always present alongside prs (FR-016, contract § 5)
# ---------------------------------------------------------------------------


def test_atomicity_prs_cap_always_present_alongside_prs(
    reviewer_pr_detail_db: tuple[DatabaseManager, Path],
) -> None:
    """Every reviewer entry where ``prs`` is present also has ``_prs_cap`` and ``_prs_truncated``.

    Walks the canonical fixture's full ``by_reviewer`` map and asserts the
    atomic invariant per contract § 5: any one of the three present
    implies all three present.
    """
    db, tmp_path = reviewer_pr_detail_db
    monday = _week_monday(2026, 10)
    for offset, pr_id in enumerate(range(1, 6)):
        _insert_pr(
            db,
            uid=f"repo1-{pr_id}",
            pr_id=pr_id,
            closed_date=(monday + timedelta(days=offset)).isoformat(),
            cycle_time_minutes=100.0 * pr_id,
        )
        _insert_reviewer(
            db,
            uid=f"repo1-{pr_id}",
            user_id=REVIEWER_A,
            vote=10,
        )
        if pr_id % 2 == 0:
            _insert_reviewer(
                db,
                uid=f"repo1-{pr_id}",
                user_id=REVIEWER_B,
                vote=-10,  # vote != 0; treated as a cast vote (not approved)
            )

    rollup = _generate(tmp_path, db)
    by_reviewer = _by_reviewer(rollup)
    assert by_reviewer  # at least one reviewer entry produced
    for reviewer_id, entry in by_reviewer.items():
        present_count = sum(
            1 for key in ("prs", "_prs_truncated", "_prs_cap") if key in entry
        )
        assert present_count == 3, (
            f"atomicity violated on by_reviewer[{reviewer_id}]: "
            f"got {present_count} of 3 present"
        )
