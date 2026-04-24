"""Feature 310 producer-side tests: per-PR comments-metrics fields.

Covers the invariants asserted by the producer contract
(``specs/310-comments-visualization/contracts/pr-record-comments-fields.md``):

- INV-01  Capability gating: when ``_has_comments()`` returns False, the
          aggregator emits the 5-field 060 shape — no new keys.
- INV-02  Top-500 slice inheritance: the per-PR join runs strictly AFTER
          the qualified+sorted+capped slice is built (R-05 / user
          constraint); PRs outside the capped set get no counts.
- INV-07  C1 inclusion rules are applied in producer SQL (cross-feature
          authoritative per spec.md "Shared inclusion-rule contract (C1)").
- INV-08  Field atomicity: the triplet emits together or not at all.
- INV-09  Ordering: ``active_thread_count <= thread_count`` always holds
          at the producer layer (subset relationship, not coverage state).
- INV-10  Coverage-partial consistency: when
          ``pull_requests.comments_extracted_at`` is NULL the triplet is
          all-``null``; when non-NULL the triplet is all-integer — never
          mixed within a record.

Harness shape mirrors ``tests/unit/test_aggregators_pr_records.py``
(existing 060 fixtures) so regressions across features are localized.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import date
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
    closed_date: str,
    cycle_time_minutes: float,
    comments_extracted_at: str | None,
    user_id: str = USER_ID,
    repository_id: str = REPOSITORY_ID,
) -> None:
    """Seed a completed PR row, optionally marking it comment-extracted."""
    db.execute(
        """
        INSERT INTO pull_requests (
            pull_request_uid, pull_request_id, organization_name,
            project_name, repository_id, user_id, title, status,
            description, creation_date, closed_date, cycle_time_minutes,
            comments_extracted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            comments_extracted_at,
        ),
    )


def _insert_thread(
    db: DatabaseManager,
    *,
    uid: str,
    thread_id: str,
    status: str,
    is_deleted: int = 0,
) -> None:
    """Seed a pr_threads row."""
    db.execute(
        """
        INSERT INTO pr_threads (
            thread_id, pull_request_uid, status, thread_context,
            last_updated, created_at, is_deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            thread_id,
            uid,
            status,
            None,
            "2026-01-02T00:00:00Z",
            "2026-01-02T00:00:00Z",
            is_deleted,
        ),
    )


def _insert_comment(
    db: DatabaseManager,
    *,
    uid: str,
    thread_id: str,
    comment_id: str,
    comment_type: str = "text",
    is_deleted: int = 0,
    author_id: str = USER_ID,
) -> None:
    """Seed a pr_comments row attached to an existing thread."""
    db.execute(
        """
        INSERT INTO pr_comments (
            comment_id, thread_id, pull_request_uid, author_id,
            content, comment_type, created_at, last_updated, is_deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            comment_id,
            thread_id,
            uid,
            author_id,
            "body",
            comment_type,
            "2026-01-02T00:00:00Z",
            "2026-01-02T00:00:00Z",
            is_deleted,
        ),
    )


@pytest.fixture
def comments_db(tmp_path: Path) -> Iterator[tuple[DatabaseManager, Path]]:
    """DB seeded with org/project/repo/user; tests add PRs + threads + comments."""
    db_path = tmp_path / "pr-records-comments.sqlite"
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


def _prs(rollup: dict[str, object]) -> list[dict[str, object]]:
    raw = rollup["prs"]
    assert isinstance(raw, list)
    records: list[dict[str, object]] = []
    for entry in raw:
        assert isinstance(entry, dict)
        records.append(entry)
    return records


# ---------------------------------------------------------------------------
# INV-01 capability gating
# ---------------------------------------------------------------------------


def test_no_fields_when_capability_off(
    comments_db: tuple[DatabaseManager, Path],
) -> None:
    """DB with no pr_threads rows: _has_comments()=False → 5-field PR records."""
    db, tmp_path = comments_db
    monday = _week_monday(2026, 2)
    _insert_pr(
        db,
        uid="repo1-1",
        pr_id=1,
        title="Feature: off",
        closed_date=monday.isoformat(),
        cycle_time_minutes=100.0,
        comments_extracted_at="2026-01-02T00:00:00Z",  # set but irrelevant
    )
    rollup = _generate(tmp_path, db)
    prs = _prs(rollup)
    assert len(prs) == 1
    row = prs[0]
    assert set(row.keys()) == {
        "id",
        "title",
        "author_id",
        "repository_id",
        "cycle_time",
    }


# ---------------------------------------------------------------------------
# INV-08 field atomicity
# ---------------------------------------------------------------------------


def test_field_atomicity_capability_on(
    comments_db: tuple[DatabaseManager, Path],
) -> None:
    """When _has_comments() is True, every emitted PR MUST carry all three fields."""
    db, tmp_path = comments_db
    monday = _week_monday(2026, 3)
    for index, uid_suffix in enumerate(("11", "12", "13"), start=1):
        _insert_pr(
            db,
            uid=f"repo1-{uid_suffix}",
            pr_id=10 + index,
            title=f"PR {index}",
            closed_date=monday.isoformat(),
            cycle_time_minutes=100.0 + index,
            comments_extracted_at="2026-01-02T00:00:00Z",
        )
    # Seed one thread so _has_comments() returns True; rest of the PRs will
    # pick up the partial-vs-covered logic via their own extracted_at stamp.
    _insert_thread(db, uid="repo1-11", thread_id="t1", status="active")
    rollup = _generate(tmp_path, db)
    prs = _prs(rollup)
    assert len(prs) == 3
    for row in prs:
        assert "thread_count" in row
        assert "comment_count" in row
        assert "active_thread_count" in row


def test_field_atomicity_capability_off_none_emitted(
    comments_db: tuple[DatabaseManager, Path],
) -> None:
    """Capability-off path: no partial emission (none of the three fields)."""
    db, tmp_path = comments_db
    monday = _week_monday(2026, 4)
    _insert_pr(
        db,
        uid="repo1-21",
        pr_id=21,
        title="PR absent",
        closed_date=monday.isoformat(),
        cycle_time_minutes=42.0,
        comments_extracted_at=None,
    )
    rollup = _generate(tmp_path, db)
    prs = _prs(rollup)
    row = prs[0]
    # _has_comments() is False because pr_threads is empty; emitting even
    # one of the three fields would violate atomicity.
    for field in ("thread_count", "comment_count", "active_thread_count"):
        assert field not in row


# ---------------------------------------------------------------------------
# INV-07 C1 inclusion rules
# ---------------------------------------------------------------------------


def test_c1_inclusion_rules_applied(
    comments_db: tuple[DatabaseManager, Path],
) -> None:
    """Seed every C1 toggle state on one PR and assert the counts match the rule set.

    Expected counts after applying C1:
      - thread_count    = 3 (active + unknown + fixed; deleted-thread excluded)
      - active_thread_count = 1 (active only; unknown naturally excluded)
      - comment_count   = 3 (text + system + codeChange on kept threads;
                             deleted-comment excluded; comment on deleted
                             thread is NOT excluded because C1 scopes the
                             deletion filter to the comment's own is_deleted
                             flag — the thread filter covers thread counts
                             only).
    """
    db, tmp_path = comments_db
    monday = _week_monday(2026, 5)
    uid = "repo1-31"
    _insert_pr(
        db,
        uid=uid,
        pr_id=31,
        title="C1 toggle grid",
        closed_date=monday.isoformat(),
        cycle_time_minutes=200.0,
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid=uid, thread_id="t-active", status="active")
    _insert_thread(db, uid=uid, thread_id="t-unknown", status="unknown")
    _insert_thread(db, uid=uid, thread_id="t-fixed", status="fixed")
    _insert_thread(db, uid=uid, thread_id="t-deleted", status="active", is_deleted=1)
    _insert_comment(db, uid=uid, thread_id="t-active", comment_id="c1")
    _insert_comment(
        db, uid=uid, thread_id="t-active", comment_id="c2", comment_type="system"
    )
    _insert_comment(
        db, uid=uid, thread_id="t-unknown", comment_id="c3", comment_type="codeChange"
    )
    _insert_comment(db, uid=uid, thread_id="t-fixed", comment_id="c4", is_deleted=1)
    rollup = _generate(tmp_path, db)
    prs = _prs(rollup)
    assert len(prs) == 1
    row = prs[0]
    assert row["thread_count"] == 3
    assert row["active_thread_count"] == 1
    assert row["comment_count"] == 3


# ---------------------------------------------------------------------------
# INV-10 coverage-partial consistency
# ---------------------------------------------------------------------------


def test_partial_state_triplet_null(
    comments_db: tuple[DatabaseManager, Path],
) -> None:
    """comments_extracted_at IS NULL → all three fields emit as None."""
    db, tmp_path = comments_db
    monday = _week_monday(2026, 6)
    _insert_pr(
        db,
        uid="repo1-covered",
        pr_id=41,
        title="Covered",
        closed_date=monday.isoformat(),
        cycle_time_minutes=150.0,
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_pr(
        db,
        uid="repo1-partial",
        pr_id=42,
        title="Partial",
        closed_date=monday.isoformat(),
        cycle_time_minutes=250.0,  # higher cycle_time → sorts first
        comments_extracted_at=None,
    )
    # Seed one thread anywhere so _has_comments() returns True.
    _insert_thread(db, uid="repo1-covered", thread_id="t1", status="active")
    rollup = _generate(tmp_path, db)
    prs = _prs(rollup)
    by_id: dict[int, dict[str, object]] = {}
    for row in prs:
        row_id = row["id"]
        assert isinstance(row_id, int)
        by_id[row_id] = row
    partial = by_id[42]
    assert partial["thread_count"] is None
    assert partial["comment_count"] is None
    assert partial["active_thread_count"] is None
    covered = by_id[41]
    assert covered["thread_count"] == 1
    assert covered["comment_count"] == 0
    assert covered["active_thread_count"] == 1


def test_partial_state_no_mixed_null_numeric(
    comments_db: tuple[DatabaseManager, Path],
) -> None:
    """Every emitted PR MUST have all three fields of the same kind (all None or all int)."""
    db, tmp_path = comments_db
    monday = _week_monday(2026, 7)
    _insert_pr(
        db,
        uid="repo1-a",
        pr_id=51,
        title="a",
        closed_date=monday.isoformat(),
        cycle_time_minutes=100.0,
        comments_extracted_at=None,
    )
    _insert_pr(
        db,
        uid="repo1-b",
        pr_id=52,
        title="b",
        closed_date=monday.isoformat(),
        cycle_time_minutes=200.0,
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="repo1-b", thread_id="t1", status="active")
    _insert_thread(db, uid="repo1-b", thread_id="t2", status="fixed")
    _insert_comment(db, uid="repo1-b", thread_id="t1", comment_id="c1")
    rollup = _generate(tmp_path, db)
    prs = _prs(rollup)
    for row in prs:
        triplet = (
            row["thread_count"],
            row["comment_count"],
            row["active_thread_count"],
        )
        all_none = all(value is None for value in triplet)
        all_int = all(isinstance(value, int) for value in triplet)
        assert all_none or all_int, (
            f"Mixed null/numeric violates INV-10 on PR {row['id']!r}: {triplet!r}"
        )


def test_true_zeros_when_extracted_at_nonnull_and_joins_empty(
    comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-3-05 / Acceptance Scenario 2.2: a covered PR with zero threads and
    zero comments MUST emit ``(0, 0, 0)`` — explicit integer zeros — NOT the
    ``(None, None, None)`` partial sentinel reserved for
    ``comments_extracted_at IS NULL``.

    The partial sentinel is consumer-visible (the renderer shows ``0`` vs
    ``—``), so the producer MUST preserve the distinction.  Contract anchor:
    ``specs/310-comments-visualization/contracts/pr-record-comments-fields.md``
    (Producer-contract Failure modes) — "emit ``(0, 0, 0)`` in that case
    (true zeros per Acceptance Scenario 2.2). The partial sentinel is
    reserved for ``comments_extracted_at IS NULL``."

    Seeds a sibling PR with a real thread + comment so the aggregator's
    JOIN subqueries DO return rows — guarding against a pass-by-accident
    where an entirely empty join masquerades as ``(0, 0, 0)`` on the
    target.
    """
    db, tmp_path = comments_db
    monday = _week_monday(2026, 10)
    # Target: covered (extracted_at non-null) with no threads/comments.
    _insert_pr(
        db,
        uid="repo1-target-zero",
        pr_id=71,
        title="Covered empty",
        closed_date=monday.isoformat(),
        cycle_time_minutes=200.0,
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    # Sibling: covered with a thread + comment so the per-week SELECT
    # returns non-empty result rows for at least one uid.
    _insert_pr(
        db,
        uid="repo1-sibling",
        pr_id=72,
        title="Covered nonempty",
        closed_date=monday.isoformat(),
        cycle_time_minutes=100.0,
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="repo1-sibling", thread_id="t1", status="active")
    _insert_comment(db, uid="repo1-sibling", thread_id="t1", comment_id="c1")
    rollup = _generate(tmp_path, db)
    prs = _prs(rollup)
    by_id: dict[int, dict[str, object]] = {}
    for row in prs:
        row_id = row["id"]
        assert isinstance(row_id, int)
        by_id[row_id] = row
    target = by_id[71]
    # Explicit integer zeros, NOT ``None``.  The ``isinstance`` check is
    # load-bearing: the partial sentinel is ``None`` and would equal ``0``
    # under neither ``==`` nor the consumer's ``value === null`` branch,
    # but asserting the type anchors the wire-level distinction so future
    # refactors cannot silently swap the sentinel and zero.
    assert target["thread_count"] == 0
    assert isinstance(target["thread_count"], int)
    assert target["comment_count"] == 0
    assert isinstance(target["comment_count"], int)
    assert target["active_thread_count"] == 0
    assert isinstance(target["active_thread_count"], int)
    # Sibling sanity: non-zero counts prove the query did return rows —
    # the ``(0, 0, 0)`` on the target is a correct per-PR zero, not an
    # empty-result-set artifact.
    sibling = by_id[72]
    assert sibling["thread_count"] == 1
    assert sibling["comment_count"] == 1
    assert sibling["active_thread_count"] == 1


# ---------------------------------------------------------------------------
# INV-09 active_thread_count <= thread_count (property)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("n_active", "n_fixed", "n_unknown"),
    [
        (0, 0, 0),
        (0, 5, 0),
        (5, 0, 0),
        (3, 2, 0),
        (3, 2, 4),
        (10, 0, 0),
        (1, 1, 1),
    ],
)
def test_active_bounded_by_total(
    comments_db: tuple[DatabaseManager, Path],
    n_active: int,
    n_fixed: int,
    n_unknown: int,
) -> None:
    """For any covered PR the producer emits active_thread_count <= thread_count.

    A filler PR in a different ISO week seeds one unrelated thread so
    ``_has_comments()`` returns True even on the (0, 0, 0) combination —
    this isolates the property assertion to the per-week aggregator join.
    """
    db, tmp_path = comments_db
    target_monday = _week_monday(2026, 8)
    filler_monday = _week_monday(2026, 9)
    _insert_pr(
        db,
        uid="repo1-prop-filler",
        pr_id=59,
        title="Filler (capability enabler)",
        closed_date=filler_monday.isoformat(),
        cycle_time_minutes=50.0,
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="repo1-prop-filler", thread_id="enabler", status="fixed")
    target_uid = "repo1-prop"
    _insert_pr(
        db,
        uid=target_uid,
        pr_id=60,
        title="Property",
        closed_date=target_monday.isoformat(),
        cycle_time_minutes=321.0,
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    counter = 0
    for _ in range(n_active):
        counter += 1
        _insert_thread(db, uid=target_uid, thread_id=f"a{counter}", status="active")
    for _ in range(n_fixed):
        counter += 1
        _insert_thread(db, uid=target_uid, thread_id=f"f{counter}", status="fixed")
    for _ in range(n_unknown):
        counter += 1
        _insert_thread(db, uid=target_uid, thread_id=f"u{counter}", status="unknown")
    db.connection.commit()
    AggregateGenerator(db, tmp_path / "out").generate_all()
    rollup_path = (
        tmp_path
        / "out"
        / "aggregates"
        / "weekly_rollups"
        / f"{target_monday.isocalendar().year}-W{target_monday.isocalendar().week:02d}.json"
    )
    loaded = json.loads(rollup_path.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    raw_prs = loaded["prs"]
    assert isinstance(raw_prs, list)
    assert len(raw_prs) == 1
    row = raw_prs[0]
    assert isinstance(row, dict)
    total = row["thread_count"]
    active = row["active_thread_count"]
    assert isinstance(total, int)
    assert isinstance(active, int)
    assert 0 <= active <= total
    expected_total = n_active + n_fixed + n_unknown
    assert total == expected_total
    assert active == n_active


# ---------------------------------------------------------------------------
# INV-02 top-500 slice scope
# ---------------------------------------------------------------------------


def test_join_scoped_to_capped_slice(
    comments_db: tuple[DatabaseManager, Path],
) -> None:
    """Threads on PRs OUTSIDE the top-500 slice MUST NOT influence emitted counts.

    Seeds ``_PR_DETAIL_CAP + 1`` PRs; the PR with the smallest cycle_time is
    the one that falls outside the capped slice.  Seed threads on that PR
    only.  Expected: the capped-slice PRs emit (0, 0, 0) numeric triplets
    (covered-but-empty), proving the aggregator did not scan pr_threads for
    the excluded PR.
    """
    db, tmp_path = comments_db
    monday = _week_monday(2026, 9)
    # Cycle times chosen so PR id 9999 has the smallest cycle_time →
    # sorted last → truncated out of the top-500 slice.
    out_of_slice_uid = "repo1-9999"
    _insert_pr(
        db,
        uid=out_of_slice_uid,
        pr_id=9999,
        title="Out of slice",
        closed_date=monday.isoformat(),
        cycle_time_minutes=1.0,
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    for index in range(_PR_DETAIL_CAP):
        _insert_pr(
            db,
            uid=f"repo1-slice-{index}",
            pr_id=100 + index,
            title=f"Slice {index}",
            closed_date=monday.isoformat(),
            cycle_time_minutes=1000.0 + index,
            comments_extracted_at="2026-01-02T00:00:00Z",
        )
    # Seed threads ONLY on the out-of-slice PR — they must not leak into
    # any slice record's count.
    _insert_thread(db, uid=out_of_slice_uid, thread_id="leak1", status="active")
    _insert_thread(db, uid=out_of_slice_uid, thread_id="leak2", status="active")
    _insert_thread(db, uid=out_of_slice_uid, thread_id="leak3", status="active")
    _insert_comment(db, uid=out_of_slice_uid, thread_id="leak1", comment_id="c1")
    rollup = _generate(tmp_path, db)
    prs = _prs(rollup)
    assert len(prs) == _PR_DETAIL_CAP
    # The out-of-slice PR must not appear in prs[].
    slice_ids: set[int] = set()
    for row in prs:
        row_id = row["id"]
        assert isinstance(row_id, int)
        slice_ids.add(row_id)
    assert 9999 not in slice_ids
    # Every slice record must emit the covered-but-empty triplet — zero
    # threads / comments sourced from pr_threads / pr_comments.
    for row in prs:
        assert row["thread_count"] == 0
        assert row["comment_count"] == 0
        assert row["active_thread_count"] == 0


# ---------------------------------------------------------------------------
# SC-04 INV-07 in-feature closure (#324)
# ---------------------------------------------------------------------------


def test_sc04_per_pr_counts_reproducible_via_contract_sql(
    comments_db: tuple[DatabaseManager, Path],
) -> None:
    """SC-04 (#324) closure: the aggregator's emitted per-PR triplet equals
    the result of an INDEPENDENT re-computation using the canonical SQL
    declared in
    ``specs/310-comments-visualization/contracts/pr-record-comments-fields.md``
    §Producer-contract — composed end-to-end, not rule-by-rule.

    This is the INV-07 in-feature closure check the spec promised.  The
    sibling tests above (``test_c1_inclusion_rules_applied``, INV-08 /
    INV-09 / INV-10) cover each C1 toggle in isolation; they would not
    catch a refactor of ``aggregators.py:836-879`` (currently a temp-table
    ``INNER JOIN _aggr_pr_slice`` form) that drifts from the contract's
    ``WHERE pr.pull_request_uid IN (:slice_uids)`` LEFT-JOIN form in a way
    that happens to preserve the per-rule outputs but composes a different
    triplet.  This test does.

    The "missing-author" C1 toggle (``pr_comments.author_id`` not in
    ``users``) is intentionally NOT seeded: ``users.user_id`` is a hard FK
    on ``pr_comments.author_id`` (migrations.py:240), and the contract SQL
    has no JOIN to ``users`` (the missing-author rule is a downstream
    rendering concern, not a count filter).  Aggregator and recomputation
    therefore cannot drift on that toggle, so omitting it loses no SC-04
    signal — matches the existing ``test_c1_inclusion_rules_applied``
    seed pattern.
    """
    db, tmp_path = comments_db
    monday = _week_monday(2026, 11)

    # Explicit pull_request_uid → pull_request_id bridge.  Rollup
    # ``prs[*].id`` is the numeric ``pull_request_id``; the contract SQL
    # returns ``pull_request_uid``.  Carrying per-PR identity through both
    # sides explicitly anchors the dict-equality assertion to a stable
    # key, independent of the Feature 060 sort order.
    bridge: dict[str, int] = {
        "repo1-sc04-populated": 81,  # full C1 toggle grid
        "repo1-sc04-empty": 82,  # covered, zero rows in joined tables
        "repo1-sc04-partial": 83,  # extracted_at IS NULL → partial sentinel
        "repo1-sc04-multi": 84,  # multi-PR slice / GROUP BY isolation
    }

    # PR 81 — populated covered: every C1 toggle that the contract SQL
    # filters on.  Expected from the contract SQL on this PR:
    #   thread_count           = 3  (active + unknown + fixed; deleted excluded)
    #   active_thread_count    = 1  (active only)
    #   comment_count          = 3  (text + system + codeChange; deleted excluded)
    _insert_pr(
        db,
        uid="repo1-sc04-populated",
        pr_id=81,
        title="SC04 populated",
        closed_date=monday.isoformat(),
        cycle_time_minutes=400.0,
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(
        db, uid="repo1-sc04-populated", thread_id="p-active", status="active"
    )
    _insert_thread(
        db, uid="repo1-sc04-populated", thread_id="p-unknown", status="unknown"
    )
    _insert_thread(db, uid="repo1-sc04-populated", thread_id="p-fixed", status="fixed")
    _insert_thread(
        db,
        uid="repo1-sc04-populated",
        thread_id="p-deleted",
        status="active",
        is_deleted=1,
    )
    _insert_comment(
        db, uid="repo1-sc04-populated", thread_id="p-active", comment_id="p-c1"
    )
    _insert_comment(
        db,
        uid="repo1-sc04-populated",
        thread_id="p-active",
        comment_id="p-c2",
        comment_type="system",
    )
    _insert_comment(
        db,
        uid="repo1-sc04-populated",
        thread_id="p-unknown",
        comment_id="p-c3",
        comment_type="codeChange",
    )
    _insert_comment(
        db,
        uid="repo1-sc04-populated",
        thread_id="p-fixed",
        comment_id="p-c-deleted",
        is_deleted=1,
    )

    # PR 82 — covered, empty (extracted_at non-NULL, no joined rows).
    # Contract SQL emits (0, 0, 0) via COALESCE; aggregator must agree
    # (the partial sentinel is reserved for ``extracted_at IS NULL``).
    _insert_pr(
        db,
        uid="repo1-sc04-empty",
        pr_id=82,
        title="SC04 empty",
        closed_date=monday.isoformat(),
        cycle_time_minutes=300.0,
        comments_extracted_at="2026-01-02T00:00:00Z",
    )

    # PR 83 — partial coverage (extracted_at IS NULL).  Seed an active
    # thread that the contract SQL would otherwise count — the partial
    # sentinel mapping at aggregators.py:872-879 must override the SQL
    # result to ``(None, None, None)``, and the independent
    # recomputation below MUST mirror that mapping (cf. producer-contract
    # Failure modes / INV-10).  The seeded thread proves the precedence
    # is exercised, not pass-by-accident on an empty join.
    _insert_pr(
        db,
        uid="repo1-sc04-partial",
        pr_id=83,
        title="SC04 partial",
        closed_date=monday.isoformat(),
        cycle_time_minutes=200.0,
        comments_extracted_at=None,
    )
    _insert_thread(
        db, uid="repo1-sc04-partial", thread_id="part-active", status="active"
    )

    # PR 84 — second populated covered PR with a different distribution.
    # Proves the GROUP BY isolates each ``pull_request_uid`` and that
    # multi-PR slice composition does not cross-contaminate per-PR
    # triplets.  Expected: (3, 5, 2).
    _insert_pr(
        db,
        uid="repo1-sc04-multi",
        pr_id=84,
        title="SC04 multi",
        closed_date=monday.isoformat(),
        cycle_time_minutes=100.0,
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="repo1-sc04-multi", thread_id="m-a1", status="active")
    _insert_thread(db, uid="repo1-sc04-multi", thread_id="m-a2", status="active")
    _insert_thread(db, uid="repo1-sc04-multi", thread_id="m-fixed", status="fixed")
    for index in range(5):
        _insert_comment(
            db,
            uid="repo1-sc04-multi",
            thread_id="m-a1",
            comment_id=f"m-c{index}",
        )

    # Run the aggregator and read the emitted PR records.
    rollup = _generate(tmp_path, db)
    prs = _prs(rollup)

    # Independent re-computation via the contract's canonical SQL
    # (``specs/310-comments-visualization/contracts/pr-record-comments-fields.md``
    # §Producer-contract, lines 56-82) — issued VERBATIM modulo the
    # ``WHERE IN`` placeholder form.  ``sqlite3`` cannot bind a list to a
    # single named placeholder, so the ``:slice_uids`` parameter is
    # expanded to positional ``?, ?, ?, ...`` of equal arity — purely a
    # binding-form difference, semantically identical.  The clause shape
    # (``WHERE pr.pull_request_uid IN (...)``) is preserved; that's the
    # whole point of the test, since the producer's own SQL uses the
    # alternative ``INNER JOIN _aggr_pr_slice`` form and SC-04 is the
    # check that the two forms agree on the composed per-PR triplet.
    #
    # SQL assembly via ``" ".join([...])`` rather than f-string follows
    # the project's zero-suppressions refactor pattern
    # (``specs/043-zero-suppressions/research.md``: replace
    # ``f"SELECT {x} FROM {y}"`` with ``" ".join(["SELECT", x, "FROM",
    # y])`` to satisfy ruff S608 without a suppression comment).  The
    # placeholders string is a SINGLE element of the join list — only
    # ``?`` characters and commas, both internally generated and never
    # user-influenced.
    slice_uids = list(bridge.keys())
    placeholders = ",".join("?" * len(slice_uids))
    sql = " ".join(
        [
            "SELECT",
            "  pr.pull_request_uid AS pull_request_uid,",
            "  pr.comments_extracted_at AS comments_extracted_at,",
            "  COALESCE(t.thread_count, 0) AS thread_count,",
            "  COALESCE(t.active_thread_count, 0) AS active_thread_count,",
            "  COALESCE(c.comment_count, 0) AS comment_count",
            "FROM pull_requests pr",
            "LEFT JOIN (",
            "  SELECT pull_request_uid,",
            "         COUNT(*) AS thread_count,",
            "         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)",
            "           AS active_thread_count",
            "  FROM pr_threads",
            "  WHERE is_deleted = 0",
            "  GROUP BY pull_request_uid",
            ") t ON t.pull_request_uid = pr.pull_request_uid",
            "LEFT JOIN (",
            "  SELECT pull_request_uid, COUNT(*) AS comment_count",
            "  FROM pr_comments",
            "  WHERE is_deleted = 0",
            "  GROUP BY pull_request_uid",
            ") c ON c.pull_request_uid = pr.pull_request_uid",
            "WHERE pr.pull_request_uid IN (",
            placeholders,
            ")",
        ]
    )
    cursor = db.execute(sql, tuple(slice_uids))
    expected_by_uid: dict[str, tuple[int | None, int | None, int | None]] = {}
    for db_row in cursor.fetchall():
        row_uid = str(db_row["pull_request_uid"])
        # Mirror the producer's partial-sentinel mapping
        # (aggregators.py:872-879).  This is the ONE non-SQL step in the
        # producer pipeline — the independent recomputation must apply
        # the same rule or partial-coverage PRs would falsely report
        # drift.
        if db_row["comments_extracted_at"] is None:
            expected_by_uid[row_uid] = (None, None, None)
        else:
            expected_by_uid[row_uid] = (
                int(db_row["thread_count"]),
                int(db_row["comment_count"]),
                int(db_row["active_thread_count"]),
            )

    # Cross-walk the emitted prs by ``pull_request_uid`` (via the bridge),
    # then assert dict equality.  Dict-keyed comparison is independent of
    # the Feature 060 sort order; positional/list comparison would couple
    # this test to that ordering for no SC-04 benefit.
    pr_id_to_uid: dict[int, str] = {pr_id: uid for uid, pr_id in bridge.items()}
    actual_by_uid: dict[str, tuple[int | None, int | None, int | None]] = {}
    for row in prs:
        row_id = row["id"]
        assert isinstance(row_id, int)
        uid = pr_id_to_uid.get(row_id)
        if uid is None:
            continue
        # Runtime ``isinstance`` checks narrow the ``object | None`` values
        # returned from ``dict[str, object].get(...)`` down to ``int | None``
        # for mypy without any suppression: the assertions are genuine
        # producer-side invariants (INV-08 atomicity + INV-10 consistency)
        # — a malformed PR record SHOULD fail this test loudly rather than
        # be silently coerced.
        tc = row.get("thread_count")
        cc = row.get("comment_count")
        atc = row.get("active_thread_count")
        assert tc is None or isinstance(tc, int)
        assert cc is None or isinstance(cc, int)
        assert atc is None or isinstance(atc, int)
        actual_by_uid[uid] = (tc, cc, atc)

    # Anchor the uid set first — an asymmetric set (e.g., a PR silently
    # dropped from emission, or the recomputation scoping the wrong rows)
    # is a contract violation in its own right and a clearer failure
    # message than a triplet mismatch on a missing key.
    assert (
        set(actual_by_uid.keys()) == set(expected_by_uid.keys()) == set(bridge.keys())
    )
    # Composed-triplet equality: the SC-04 closure assertion.
    assert actual_by_uid == expected_by_uid
