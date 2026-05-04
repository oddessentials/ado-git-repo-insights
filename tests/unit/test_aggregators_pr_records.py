"""Unit tests for feature 060 PR-level detail emission in weekly rollups.

Covers the six producer-side requirements from T017:

1. PR array shape + field order (exactly five fields per PrRecord).
2. Sort key `(-cycle_time_minutes, pull_request_id)`.
3. Truncation at `_PR_DETAIL_CAP = 500` with `_prs_truncated=true` at 501.
4. No `_prs_truncated` at exactly 500 (boundary — not truncated).
5. Exclusion of PRs with NULL / NaN / non-finite `cycle_time_minutes`.
6. `_prs_cap = 500` always present whenever `prs` is present.
7. All three fields absent when the qualified set is empty.
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
    _PR_DETAIL_CAP,
    AggregateGenerator,
)

ORG_NAME: Final[str] = "org1"
PROJECT_NAME: Final[str] = "proj1"
REPOSITORY_ID: Final[str] = "repo1"
USER_ID: Final[str] = "user1"


def _week_monday(year: int, iso_week: int) -> date:
    return date.fromisocalendar(year, iso_week, 1)


def _insert_pr(
    db: DatabaseManager,
    *,
    uid: str,
    pr_id: int,
    title: str,
    user_id: str = USER_ID,
    repository_id: str = REPOSITORY_ID,
    closed_date: str,
    cycle_time_minutes: float | None,
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
            repository_id,
            user_id,
            title,
            "completed",
            None,
            "2026-01-01T00:00:00Z",
            closed_date,
            cycle_time_minutes,
        ),
    )


@pytest.fixture
def pr_records_db(tmp_path: Path) -> Iterator[tuple[DatabaseManager, Path]]:
    """Database pre-seeded with org/project/repo/user/team; tests add PRs."""
    db_path = tmp_path / "pr-records.sqlite"
    db = DatabaseManager(db_path)
    db.connect()

    db.execute("INSERT INTO organizations (organization_name) VALUES (?)", (ORG_NAME,))
    db.execute(
        "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
        (ORG_NAME, PROJECT_NAME),
    )
    db.execute(
        "INSERT INTO repositories (repository_id, repository_name, project_name, organization_name) VALUES (?, ?, ?, ?)",
        (REPOSITORY_ID, "Repository 1", PROJECT_NAME, ORG_NAME),
    )
    db.execute(
        "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
        (USER_ID, "User One", "u1@example.com"),
    )
    db.connection.commit()

    yield db, tmp_path

    db.close()


def _read_single_rollup(tmp_path: Path) -> dict[str, object]:
    """Read the single rollup file produced by the test run."""
    rollup_files = list(
        (tmp_path / "out" / "aggregates" / "weekly_rollups").glob("*.json"),
    )
    assert len(rollup_files) == 1, f"expected 1 rollup, got {len(rollup_files)}"
    loaded = json.loads(rollup_files[0].read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


def _generate(tmp_path: Path, db: DatabaseManager) -> dict[str, object]:
    db.connection.commit()
    AggregateGenerator(db, tmp_path / "out").generate_all()
    return _read_single_rollup(tmp_path)


def test_pr_records_field_shape(
    pr_records_db: tuple[DatabaseManager, Path],
) -> None:
    """Each element of `prs` has exactly the five fields defined by PrRecord."""
    db, tmp_path = pr_records_db
    monday = _week_monday(2026, 2)
    _insert_pr(
        db,
        uid="repo1-10",
        pr_id=10,
        title="Feature: OAuth",
        closed_date=monday.isoformat(),
        cycle_time_minutes=120.0,
    )

    rollup = _generate(tmp_path, db)
    prs = rollup["prs"]
    assert isinstance(prs, list)
    assert len(prs) == 1
    row = prs[0]
    assert isinstance(row, dict)
    assert set(row.keys()) == {
        "id",
        "title",
        "author_id",
        "repository_id",
        "cycle_time",
    }
    assert row == {
        "id": 10,
        "title": "Feature: OAuth",
        "author_id": USER_ID,
        "repository_id": REPOSITORY_ID,
        "cycle_time": 120.0,
    }


def test_pr_records_sorted_by_cycle_time_desc_then_id_asc(
    pr_records_db: tuple[DatabaseManager, Path],
) -> None:
    """Sort comparator is (-cycle_time_minutes, pull_request_id)."""
    db, tmp_path = pr_records_db
    monday = _week_monday(2026, 3)
    # Three PRs — two with equal cycle_time to force the id-asc tiebreak.
    _insert_pr(
        db,
        uid="repo1-100",
        pr_id=100,
        title="short",
        closed_date=monday.isoformat(),
        cycle_time_minutes=50.0,
    )
    _insert_pr(
        db,
        uid="repo1-200",
        pr_id=200,
        title="tied-high-b",
        closed_date=(monday + timedelta(days=1)).isoformat(),
        cycle_time_minutes=300.0,
    )
    _insert_pr(
        db,
        uid="repo1-150",
        pr_id=150,
        title="tied-high-a",
        closed_date=(monday + timedelta(days=2)).isoformat(),
        cycle_time_minutes=300.0,
    )

    rollup = _generate(tmp_path, db)
    prs = rollup["prs"]
    assert isinstance(prs, list)
    ids_in_order = [row["id"] for row in prs if isinstance(row, dict)]
    # Expected: 150 and 200 tied at cycle_time=300 (id asc) then 100 at 50.
    assert ids_in_order == [150, 200, 100]


def test_pr_records_truncated_above_cap(
    pr_records_db: tuple[DatabaseManager, Path],
) -> None:
    """501 PRs in a week -> first 500 by cycle_time desc, `_prs_truncated=True`."""
    db, tmp_path = pr_records_db
    monday = _week_monday(2026, 4)
    # 501 PRs with strictly-increasing cycle_time so truncation drops the
    # lowest cycle_time PR (id=1 which has cycle_time=1.0).
    for i in range(1, 502):
        _insert_pr(
            db,
            uid=f"repo1-{i}",
            pr_id=i,
            title=f"PR {i}",
            closed_date=monday.isoformat(),
            cycle_time_minutes=float(i),
        )

    rollup = _generate(tmp_path, db)
    prs = rollup["prs"]
    assert isinstance(prs, list)
    assert len(prs) == _PR_DETAIL_CAP == 500
    assert rollup["_prs_truncated"] is True
    assert rollup["_prs_cap"] == 500
    # Lowest cycle_time (id=1, cycle=1.0) MUST be dropped; highest (id=501)
    # must be first.
    head = prs[0]
    tail = prs[-1]
    assert isinstance(head, dict)
    assert isinstance(tail, dict)
    assert head["id"] == 501
    assert tail["id"] == 2  # id=1 was truncated out


def test_pr_records_not_truncated_at_cap(
    pr_records_db: tuple[DatabaseManager, Path],
) -> None:
    """Exactly 500 PRs -> all kept, `_prs_truncated=False`."""
    db, tmp_path = pr_records_db
    monday = _week_monday(2026, 5)
    for i in range(1, 501):  # 500 PRs
        _insert_pr(
            db,
            uid=f"repo1-{i}",
            pr_id=i,
            title=f"PR {i}",
            closed_date=monday.isoformat(),
            cycle_time_minutes=float(i),
        )

    rollup = _generate(tmp_path, db)
    prs = rollup["prs"]
    assert isinstance(prs, list)
    assert len(prs) == 500
    assert rollup["_prs_truncated"] is False
    assert rollup["_prs_cap"] == 500


def test_pr_records_excludes_null_and_nan_cycle_time(
    pr_records_db: tuple[DatabaseManager, Path],
) -> None:
    """PRs with NULL or NaN cycle_time are excluded from `prs`."""
    db, tmp_path = pr_records_db
    monday = _week_monday(2026, 6)
    _insert_pr(
        db,
        uid="repo1-1",
        pr_id=1,
        title="kept",
        closed_date=monday.isoformat(),
        cycle_time_minutes=250.0,
    )
    _insert_pr(
        db,
        uid="repo1-2",
        pr_id=2,
        title="null-cycle",
        closed_date=monday.isoformat(),
        cycle_time_minutes=None,
    )
    _insert_pr(
        db,
        uid="repo1-3",
        pr_id=3,
        title="nan-cycle",
        closed_date=monday.isoformat(),
        cycle_time_minutes=float("nan"),
    )

    rollup = _generate(tmp_path, db)
    prs = rollup["prs"]
    assert isinstance(prs, list)
    ids = {row["id"] for row in prs if isinstance(row, dict)}
    assert ids == {1}


def test_pr_records_cap_always_present_when_prs_present(
    pr_records_db: tuple[DatabaseManager, Path],
) -> None:
    """Even for a single-PR week, `_prs_cap=500` is emitted."""
    db, tmp_path = pr_records_db
    monday = _week_monday(2026, 7)
    _insert_pr(
        db,
        uid="repo1-42",
        pr_id=42,
        title="single",
        closed_date=monday.isoformat(),
        cycle_time_minutes=77.0,
    )

    rollup = _generate(tmp_path, db)
    assert rollup["_prs_cap"] == 500
    assert rollup["_prs_truncated"] is False
    assert isinstance(rollup["prs"], list)


def test_pr_records_absent_when_qualified_set_empty(
    pr_records_db: tuple[DatabaseManager, Path],
) -> None:
    """Week with no qualified PRs omits `prs`, `_prs_truncated`, `_prs_cap`.

    Contract: "If the qualified set is empty, the aggregator MUST NOT emit
    any of the three fields." Absence reads cleanly at the UI consumer.
    """
    db, tmp_path = pr_records_db
    monday = _week_monday(2026, 8)
    # Only PRs with NULL cycle_time → qualified set empty for this week.
    _insert_pr(
        db,
        uid="repo1-8",
        pr_id=8,
        title="null-only",
        closed_date=monday.isoformat(),
        cycle_time_minutes=None,
    )

    rollup = _generate(tmp_path, db)
    assert "prs" not in rollup
    assert "_prs_truncated" not in rollup
    assert "_prs_cap" not in rollup
