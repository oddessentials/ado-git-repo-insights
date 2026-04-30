"""Feature 336 producer-side tests: per-(week, reviewer) comments-density emission.

Covers the invariants asserted by the producer contract
(``specs/336-comments-reviewer-density/contracts/per-reviewer-comments-density.md``):

- FR-1-01..02  Capability gating + emission shape: when ``_has_comments()``
               is False, the aggregator omits the entire
               ``rollup[W].by_reviewer_comments`` key (FR-3-03 + INV-4-09).
               When True, an outer dict keyed by ``commenter_or_sentinel``
               is emitted on the rollup root with atomic 4-field entries
               (INV-4-08).
- FR-1-03      Sentinel bucketing per CL-03 / INV-4-12: ``pr_comments.author_id``
               values absent from the ``users`` table collapse into the
               single reserved bucket key
               ``FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL``.  Sentinel applies
               (mirrors #334; divergence from #335 which is FK-protected).
- FR-1-04      Reviewer semantics per CL-04: commenter ≠ PR author
               (self-comments excluded entirely from the dimension);
               deleted comments excluded (C1 ``is_deleted = 0``).
- FR-1-05      Numeric semantics — divergence from #334 / #335:
               ``comment_count`` is raw row count; ``thread_count`` is
               ``COUNT(DISTINCT thread_id)`` per commenter (NOT raw rows);
               ``active_thread_count`` is the active subset of those
               distinct threads.  Multi-counting at the cross-bucket
               level is structural (a thread with N distinct non-self
               commenters contributes 1 to each commenter's thread_count
               and N to ``SUM_R(thread_count)``).
- FR-1-06      Extracted-subset rule: per-bucket numeric sums range over
               the bucket's extracted-subset (PRs with
               ``comments_extracted_at IS NOT NULL``).
- FR-1-07      Same-W ``coverage_partial`` per CL-10: every reviewer R
               emitted for week W shares the SAME flag value, equal to
               ``rollup[W].comments.coverage_partial`` (333's flag).
               Bucket-specific definition would be degenerate for the
               per-reviewer dimension because R's commenter relationship
               is invisible until extraction.
- FR-1-08      Atomicity (INV-4-08): every entry has all four fields
               together; partial entries are forbidden.
- FR-1-09      Ordering (INV-4-07): ``active_thread_count <= thread_count``
               per entry.
- FR-1-10      Full canonical PR set scope (INV-4-10): emission covers W's
               FULL canonical throughput PR set, NOT a drill-down-capped
               slice.
- FR-1-11      Key omission under empty buckets: empty outer dict ⇒ key
               absent (NOT ``{}``-valued, NOT ``null``-valued, NOT
               partial-fielded).
- FR-1-12      FAIL-LOUD per CL-15: ``RuntimeError`` raised when the
               aggregator encounters a non-UUID ``pr_comments.author_id``
               value during iteration.  NOTE: the FR-1-12 NULL clause is
               structurally unreachable in the production SQL path (the
               CASE expression maps absent-from-users rows to the
               sentinel literal, and ``pr_comments.author_id NOT NULL``
               at ``models.py:160`` prevents NULL at INSERT) — the
               defensive NULL check in the helper is retained for
               forward-compat but no test exercises it (mock-based
               testing would couple to internal SQL invocations).
- Determinism  Outer dict key order is ascending by commenter key (the
               stable identity string, including the sentinel which
               sorts deterministically among UUID-shaped real keys at
               the leading-``__`` position).  Display name is NOT the
               producer's sort key.

Harness mirrors ``tests/unit/test_aggregators_author_comments.py``
(Feature 334 producer test scaffold) and
``tests/unit/test_aggregators_repo_comments.py`` (Feature 335) so
regressions across features are localized.  FK enforcement is disabled
in the fixture so the sentinel branch (CL-03) and shape-corruption
(CL-15) edges are exercisable.
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
    AggregateGenerator,
    AggregationError,
)
from ado_git_repo_insights.transform.constants import (
    FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL,
)

ORG_NAME: Final[str] = "org1"
PROJECT_NAME: Final[str] = "proj1"
REPOSITORY_ID: Final[str] = "repo-001"
REPOSITORY_NAME: Final[str] = "Repository 1"

# UUID-shaped user identifiers for the fixture (32 hex + 4 hyphens per the
# existing extractor's convention).  All fixture users + the ghost-user
# UUID are valid UUID-shape strings; the FAIL-LOUD test deliberately
# inserts a non-UUID-shaped author_id to exercise CL-15 / FR-1-12.
USER_ALICE: Final[str] = "00000000-0000-0000-0000-00000000000a"
USER_BOB: Final[str] = "00000000-0000-0000-0000-00000000000b"
USER_CHARLIE: Final[str] = "00000000-0000-0000-0000-00000000000c"
USER_DAVE: Final[str] = "00000000-0000-0000-0000-00000000000d"
GHOST_USER: Final[str] = "00000000-0000-0000-0000-00000000000f"  # absent from users
NON_UUID_USER: Final[str] = "not-a-uuid-shaped-string"


def _week_monday(year: int, iso_week: int) -> date:
    return date.fromisocalendar(year, iso_week, 1)


def _insert_pr(
    db: DatabaseManager,
    *,
    uid: str,
    pr_id: int,
    user_id: str,
    closed_date: str,
    comments_extracted_at: str | None,
    cycle_time_minutes: float = 100.0,
) -> None:
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
            REPOSITORY_ID,
            user_id,
            f"PR {pr_id}",
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
    status: str = "active",
    is_deleted: int = 0,
) -> None:
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
    author_id: str,
    is_deleted: int = 0,
) -> None:
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
            "text",
            "2026-01-02T00:00:00Z",
            "2026-01-02T00:00:00Z",
            is_deleted,
        ),
    )


@pytest.fixture
def reviewer_comments_db(
    tmp_path: Path,
) -> Iterator[tuple[DatabaseManager, Path]]:
    """DB seeded with org/project/one-repo + four users + ghost slot.

    FK enforcement is disabled so the fixture can seed:

    - PRs whose ``user_id`` matches a known user (the standard case).
    - PRs whose author commented on themselves (self-comment exclusion).
    - ``pr_comments`` rows whose ``author_id`` is the GHOST_USER UUID
      (absent from ``users``) — exercises the CL-03 sentinel branch.
    - ``pr_comments`` rows whose ``author_id`` is a non-UUID-shaped
      string — exercises the CL-15 / FR-1-12 FAIL-LOUD branch.

    Mirrors the FK-off pattern from
    ``tests/unit/test_aggregators_author_comments.py`` (Feature 334).
    """
    db_path = tmp_path / "reviewer-comments.sqlite"
    db = DatabaseManager(db_path)
    db.connect()
    db.execute("PRAGMA foreign_keys = OFF")
    db.execute("INSERT INTO organizations (organization_name) VALUES (?)", (ORG_NAME,))
    db.execute(
        "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
        (ORG_NAME, PROJECT_NAME),
    )
    db.execute(
        "INSERT INTO repositories (repository_id, repository_name, project_name, "
        "organization_name) VALUES (?, ?, ?, ?)",
        (REPOSITORY_ID, REPOSITORY_NAME, PROJECT_NAME, ORG_NAME),
    )
    for user_id, display_name, email in (
        (USER_ALICE, "Alice", "alice@example.com"),
        (USER_BOB, "Bob", "bob@example.com"),
        (USER_CHARLIE, "Charlie", "charlie@example.com"),
        (USER_DAVE, "Dave", "dave@example.com"),
    ):
        db.execute(
            "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
            (user_id, display_name, email),
        )
    db.connection.commit()
    yield db, tmp_path
    db.close()


def _generate_rollup(tmp_path: Path, db: DatabaseManager) -> dict[str, object]:
    db.connection.commit()
    AggregateGenerator(db, tmp_path / "out").generate_all()
    rollup_files = sorted(
        (tmp_path / "out" / "aggregates" / "weekly_rollups").glob("*.json"),
    )
    assert len(rollup_files) == 1, f"expected 1 rollup, got {len(rollup_files)}"
    loaded = json.loads(rollup_files[0].read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


def _by_reviewer_comments(rollup: dict[str, object]) -> dict[str, dict[str, object]]:
    raw = rollup.get("by_reviewer_comments")
    assert isinstance(raw, dict), (
        f"expected dict at by_reviewer_comments, got {type(raw).__name__}"
    )
    typed: dict[str, dict[str, object]] = {}
    for key, entry in raw.items():
        assert isinstance(entry, dict)
        typed[str(key)] = entry
    return typed


# --------------------------------------------------------------------------- #
# T008 — FR-1-* coverage                                                       #
# --------------------------------------------------------------------------- #


def test_capability_off_omits_by_reviewer_comments_key(
    reviewer_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-3-03 + INV-4-09 (case iv): no pr_threads → ``_has_comments()`` False → key absent.

    Same gating posture as #334 / #335: capability-off is signalled by the
    absence of any ``pr_threads`` rows in the source DB; ``_has_comments()``
    detects this and the aggregator emits the rollup without the
    ``by_reviewer_comments`` key (NOT ``{}``-valued, NOT ``null``-valued,
    NOT partial-fielded — gated by FR-3-03 four omission failure modes).
    """
    db, tmp_path = reviewer_comments_db
    monday = _week_monday(2026, 2)
    _insert_pr(
        db,
        uid="pr-1",
        pr_id=1,
        user_id=USER_ALICE,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    rollup = _generate_rollup(tmp_path, db)
    assert "by_reviewer_comments" not in rollup, (
        "FR-3-03 violation: by_reviewer_comments key emitted under "
        f"capability-off (no pr_threads in DB).  Got: "
        f"{rollup.get('by_reviewer_comments')!r}"
    )


def test_all_extracted_no_self_comments_coverage_partial_false(
    reviewer_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-05 + FR-1-06 + FR-1-07 (case i): all-extracted, no self-comments
    → all entries ``coverage_partial=False``, sums correct.

    PR by alice; bob and charlie comment (non-self).  bob commented twice
    on one thread; charlie commented once on a second thread.  Expected:
    bob has comment_count=2, thread_count=1; charlie has comment_count=1,
    thread_count=1.  No self-comment by alice → alice is NOT in the
    by_reviewer_comments output.
    """
    db, tmp_path = reviewer_comments_db
    monday = _week_monday(2026, 2)
    _insert_pr(
        db,
        uid="pr-alpha",
        pr_id=1,
        user_id=USER_ALICE,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-alpha", thread_id="t1", status="active")
    _insert_thread(db, uid="pr-alpha", thread_id="t2", status="closed")
    _insert_comment(
        db, uid="pr-alpha", thread_id="t1", comment_id="c1", author_id=USER_BOB
    )
    _insert_comment(
        db, uid="pr-alpha", thread_id="t1", comment_id="c2", author_id=USER_BOB
    )
    _insert_comment(
        db, uid="pr-alpha", thread_id="t2", comment_id="c3", author_id=USER_CHARLIE
    )

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_reviewer_comments(rollup)
    assert set(buckets.keys()) == {USER_BOB, USER_CHARLIE}, (
        f"expected exactly bob + charlie buckets (no self-comments by alice), "
        f"got {sorted(buckets.keys())!r}"
    )
    assert buckets[USER_BOB]["comment_count"] == 2
    assert buckets[USER_BOB]["thread_count"] == 1  # COUNT(DISTINCT thread_id)
    assert buckets[USER_BOB]["active_thread_count"] == 1
    assert buckets[USER_BOB]["coverage_partial"] is False
    assert buckets[USER_CHARLIE]["comment_count"] == 1
    assert buckets[USER_CHARLIE]["thread_count"] == 1
    assert buckets[USER_CHARLIE]["active_thread_count"] == 0
    assert buckets[USER_CHARLIE]["coverage_partial"] is False


def test_mixed_extraction_week_coverage_partial_true_same_w_flag(
    reviewer_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-07 (case ii): mixed-extraction week → every reviewer in W shares
    ``coverage_partial=True`` (same-W flag per CL-10).

    W contains an extracted PR (pr-1 with bob's comment) AND an unextracted
    PR (pr-2 with no extracted comment data).  Per CL-10, every reviewer
    bucket emitted for W shares the SAME ``coverage_partial=True`` because
    "any PR in W has comments_extracted_at IS NULL" — NOT bucket-specific.
    """
    db, tmp_path = reviewer_comments_db
    monday = _week_monday(2026, 2)
    _insert_pr(
        db,
        uid="pr-1",
        pr_id=1,
        user_id=USER_ALICE,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-1", thread_id="t1", status="active")
    _insert_comment(db, uid="pr-1", thread_id="t1", comment_id="c1", author_id=USER_BOB)
    # Unextracted PR in same W — pr_threads rows attached to it must NOT
    # be counted, but the W-level coverage_partial flag MUST be True.
    _insert_pr(
        db,
        uid="pr-2",
        pr_id=2,
        user_id=USER_BOB,
        closed_date=monday.isoformat(),
        comments_extracted_at=None,
    )
    _insert_thread(db, uid="pr-2", thread_id="t2", status="active")
    _insert_comment(
        db, uid="pr-2", thread_id="t2", comment_id="c-skip", author_id=USER_CHARLIE
    )

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_reviewer_comments(rollup)
    # bob commented on the EXTRACTED PR (pr-1) → bob bucket present.
    # charlie commented on the UNEXTRACTED PR (pr-2) → charlie's comments
    # are filtered out by FR-1-06 extracted-subset rule → no charlie bucket.
    assert USER_BOB in buckets, (
        f"bob bucket missing from W with mixed extraction; "
        f"got {sorted(buckets.keys())!r}"
    )
    assert USER_CHARLIE not in buckets, (
        f"charlie's comments are on an unextracted PR (FR-1-06 excludes them) "
        f"— charlie bucket should NOT appear; got {sorted(buckets.keys())!r}"
    )
    # Same-W coverage_partial flag — every emitted bucket has True.
    for commenter, entry in buckets.items():
        assert entry["coverage_partial"] is True, (
            f"reviewer {commenter}: coverage_partial={entry['coverage_partial']!r}, "
            f"expected True per same-W flag (W has unextracted PR pr-2)"
        )


def test_all_unextracted_week_omits_key(
    reviewer_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-11 + FR-3-03 (case iii): all-unextracted week → key omitted entirely.

    Every PR in W has ``comments_extracted_at IS NULL``; the extracted-subset
    is empty; no eligible ``pr_comments`` rows exist; the outer dict is
    empty; the aggregator omits the ``by_reviewer_comments`` key entirely
    (NOT ``{}``-valued, NOT ``null``-valued).
    """
    db, tmp_path = reviewer_comments_db
    monday = _week_monday(2026, 2)
    _insert_pr(
        db,
        uid="pr-1",
        pr_id=1,
        user_id=USER_ALICE,
        closed_date=monday.isoformat(),
        comments_extracted_at=None,
    )
    _insert_thread(db, uid="pr-1", thread_id="t1", status="active")
    _insert_comment(db, uid="pr-1", thread_id="t1", comment_id="c1", author_id=USER_BOB)

    rollup = _generate_rollup(tmp_path, db)
    assert "by_reviewer_comments" not in rollup, (
        "FR-1-11 violation: by_reviewer_comments key emitted on an "
        f"all-unextracted W (every PR has comments_extracted_at IS NULL); "
        f"got {rollup.get('by_reviewer_comments')!r}"
    )


def test_atomicity_all_four_fields_per_entry(
    reviewer_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-08 / INV-4-08 (case v): every emitted entry has all four fields together.

    Atomicity is the schema invariant the validator enforces in STRICT
    mode (``rollup.schema.ts:validateReviewerCommentsDensity``); the
    producer guarantees it by emitting each bucket as a single dict
    literal.  This test asserts every emitted entry's key set equals
    ``{thread_count, comment_count, active_thread_count, coverage_partial}``
    — no missing fields, no extra fields.
    """
    db, tmp_path = reviewer_comments_db
    monday = _week_monday(2026, 2)
    _insert_pr(
        db,
        uid="pr-1",
        pr_id=1,
        user_id=USER_ALICE,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-1", thread_id="t1", status="active")
    _insert_comment(db, uid="pr-1", thread_id="t1", comment_id="c1", author_id=USER_BOB)
    _insert_comment(
        db, uid="pr-1", thread_id="t1", comment_id="c2", author_id=USER_CHARLIE
    )

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_reviewer_comments(rollup)
    expected_fields = {
        "thread_count",
        "comment_count",
        "active_thread_count",
        "coverage_partial",
    }
    for commenter, entry in buckets.items():
        assert set(entry.keys()) == expected_fields, (
            f"reviewer {commenter}: entry key set {sorted(entry.keys())!r} "
            f"!= expected {sorted(expected_fields)!r} (INV-4-08 atomicity violation)"
        )


def test_ordering_active_thread_count_le_thread_count_per_entry(
    reviewer_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-09 / INV-4-07 (case vi): ``active_thread_count <= thread_count`` per entry.

    The active subset of distinct threads cannot exceed the full
    distinct-thread set; the SQL's ``COUNT(DISTINCT CASE WHEN status =
    'active' THEN thread_id ELSE NULL END)`` is structurally a subset of
    ``COUNT(DISTINCT thread_id)`` so the constraint holds at the SQL
    level.  Test seeds bob across one active and one closed thread on
    the same PR, asserts the inequality holds for every emitted bucket.
    """
    db, tmp_path = reviewer_comments_db
    monday = _week_monday(2026, 2)
    _insert_pr(
        db,
        uid="pr-1",
        pr_id=1,
        user_id=USER_ALICE,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-1", thread_id="t1", status="active")
    _insert_thread(db, uid="pr-1", thread_id="t2", status="closed")
    _insert_thread(db, uid="pr-1", thread_id="t3", status="fixed")
    _insert_comment(db, uid="pr-1", thread_id="t1", comment_id="c1", author_id=USER_BOB)
    _insert_comment(db, uid="pr-1", thread_id="t2", comment_id="c2", author_id=USER_BOB)
    _insert_comment(db, uid="pr-1", thread_id="t3", comment_id="c3", author_id=USER_BOB)

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_reviewer_comments(rollup)
    for commenter, entry in buckets.items():
        thread_count = entry["thread_count"]
        active_thread_count = entry["active_thread_count"]
        assert isinstance(thread_count, int)
        assert isinstance(active_thread_count, int)
        assert active_thread_count <= thread_count, (
            f"reviewer {commenter}: active_thread_count={active_thread_count} > "
            f"thread_count={thread_count} (INV-4-07 violation)"
        )
    # bob commented on 3 threads (1 active + 1 closed + 1 fixed).
    assert buckets[USER_BOB]["thread_count"] == 3
    assert buckets[USER_BOB]["active_thread_count"] == 1


def test_full_canonical_pr_set_scope_not_drilldown_capped(
    reviewer_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-10 / INV-4-10 (case vii): emission covers W's FULL canonical
    throughput PR set — NOT the drill-down's top-500-by-cycle-time slice.

    Seeds three PRs in W with widely-varying cycle_time values (high,
    low, very-low).  The drill-down (per FR-1-10) caps at top-500 by
    cycle_time; for our 3-PR fixture all three are within the cap.
    The test instead asserts that all three PRs' commenters appear in
    the per-(week, reviewer) buckets — there's no per-reviewer-side
    truncation that would mirror the drill-down's cap.  This is the
    prerequisite that makes FR-2-03 cross-aggregate parity-vs-INDEPENDENT-
    count honor-able on truncated weeks.
    """
    db, tmp_path = reviewer_comments_db
    monday = _week_monday(2026, 2)
    # Three PRs, three distinct commenters, varying cycle_time — all
    # extracted, all in W.  bob commented on the high-cycle-time PR;
    # charlie on the medium; dave on the low.
    for pr_id, uid, author, cycle_time, commenter in (
        (1, "pr-high", USER_ALICE, 10000.0, USER_BOB),
        (2, "pr-med", USER_ALICE, 100.0, USER_CHARLIE),
        (3, "pr-low", USER_ALICE, 1.0, USER_DAVE),
    ):
        _insert_pr(
            db,
            uid=uid,
            pr_id=pr_id,
            user_id=author,
            closed_date=monday.isoformat(),
            comments_extracted_at="2026-01-02T00:00:00Z",
            cycle_time_minutes=cycle_time,
        )
        _insert_thread(db, uid=uid, thread_id=f"t-{uid}", status="active")
        _insert_comment(
            db,
            uid=uid,
            thread_id=f"t-{uid}",
            comment_id=f"c-{uid}",
            author_id=commenter,
        )

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_reviewer_comments(rollup)
    # All three commenters MUST appear — no truncation by cycle_time.
    assert {USER_BOB, USER_CHARLIE, USER_DAVE}.issubset(buckets.keys()), (
        f"FR-1-10 violation: per-reviewer aggregator dropped a low-cycle-time "
        f"PR's commenter; expected bob + charlie + dave, got "
        f"{sorted(buckets.keys())!r}"
    )


def test_self_comment_excluded_per_cl_04(
    reviewer_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-04 (case viii): PR author commenting on own PR does NOT appear in by_reviewer_comments.

    alice authors pr-1 AND comments on her own thread; bob comments
    (non-self).  Per CL-04, the self-comment is excluded entirely; only
    bob's bucket appears.  A self-comment leak (alice in by_reviewer_comments)
    would be caught here AND by FR-2-05 meta-test injection (T010) at
    the integration level.
    """
    db, tmp_path = reviewer_comments_db
    monday = _week_monday(2026, 2)
    _insert_pr(
        db,
        uid="pr-1",
        pr_id=1,
        user_id=USER_ALICE,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-1", thread_id="t1", status="active")
    # alice (PR author) self-comments — MUST be excluded.
    _insert_comment(
        db, uid="pr-1", thread_id="t1", comment_id="c-self", author_id=USER_ALICE
    )
    # bob (non-self) — MUST be included.
    _insert_comment(
        db, uid="pr-1", thread_id="t1", comment_id="c-bob", author_id=USER_BOB
    )

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_reviewer_comments(rollup)
    assert USER_ALICE not in buckets, (
        f"FR-1-04 / CL-04 violation: PR author alice (commenter == PR author) "
        f"appears in by_reviewer_comments — self-comments MUST be excluded.  "
        f"Got buckets {sorted(buckets.keys())!r}"
    )
    assert USER_BOB in buckets, (
        f"bob (non-self commenter) missing from by_reviewer_comments; "
        f"got {sorted(buckets.keys())!r}"
    )
    assert buckets[USER_BOB]["comment_count"] == 1


def test_thread_count_count_distinct_thread_id_per_commenter(
    reviewer_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-05 (case ix): thread_count = COUNT(DISTINCT thread_id) per commenter.

    Divergence from #334 / #335 where ``thread_count`` is a raw row
    count.  bob commented 5 times across 2 distinct threads → bob's
    thread_count=2 (NOT 5).  Asserting raw count != distinct count
    catches a producer regression that uses ``COUNT(*)`` instead of
    ``COUNT(DISTINCT thread_id)``.
    """
    db, tmp_path = reviewer_comments_db
    monday = _week_monday(2026, 2)
    _insert_pr(
        db,
        uid="pr-1",
        pr_id=1,
        user_id=USER_ALICE,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-1", thread_id="t1", status="active")
    _insert_thread(db, uid="pr-1", thread_id="t2", status="active")
    # bob commented 3 times on t1 + 2 times on t2 = 5 raw rows, 2 distinct threads.
    for thread_id, comment_id in (
        ("t1", "c1"),
        ("t1", "c2"),
        ("t1", "c3"),
        ("t2", "c4"),
        ("t2", "c5"),
    ):
        _insert_comment(
            db,
            uid="pr-1",
            thread_id=thread_id,
            comment_id=comment_id,
            author_id=USER_BOB,
        )

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_reviewer_comments(rollup)
    assert buckets[USER_BOB]["comment_count"] == 5, (
        f"comment_count is RAW row count: expected 5, got "
        f"{buckets[USER_BOB]['comment_count']}"
    )
    assert buckets[USER_BOB]["thread_count"] == 2, (
        f"FR-1-05 violation: thread_count must be COUNT(DISTINCT thread_id) "
        f"= 2 (bob commented across 2 distinct threads), got "
        f"{buckets[USER_BOB]['thread_count']} (likely raw row count)"
    )


def test_active_thread_count_subset_of_distinct_threads(
    reviewer_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-05 (case x): active_thread_count restricts to threads with status='active'.

    bob commented across three threads: t1 (active), t2 (closed), t3
    (active).  thread_count = 3; active_thread_count = 2 (subset of
    threads where pr_threads.status='active').
    """
    db, tmp_path = reviewer_comments_db
    monday = _week_monday(2026, 2)
    _insert_pr(
        db,
        uid="pr-1",
        pr_id=1,
        user_id=USER_ALICE,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-1", thread_id="t1", status="active")
    _insert_thread(db, uid="pr-1", thread_id="t2", status="closed")
    _insert_thread(db, uid="pr-1", thread_id="t3", status="active")
    for thread_id, comment_id in (("t1", "c1"), ("t2", "c2"), ("t3", "c3")):
        _insert_comment(
            db,
            uid="pr-1",
            thread_id=thread_id,
            comment_id=comment_id,
            author_id=USER_BOB,
        )

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_reviewer_comments(rollup)
    assert buckets[USER_BOB]["thread_count"] == 3
    assert buckets[USER_BOB]["active_thread_count"] == 2, (
        f"FR-1-05 violation: active_thread_count must restrict to threads "
        f"with status='active' (= 2 of 3), got "
        f"{buckets[USER_BOB]['active_thread_count']}"
    )


def test_sentinel_bucketing_for_unknown_to_users_commenter(
    reviewer_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-03 / CL-03 / INV-4-12 (case xi): pr_comments.author_id absent
    from users → sentinel literal as bucket key.

    GHOST_USER's UUID is intentionally NOT inserted into the ``users``
    table by the fixture.  bob (in users) and ghost-user (not in users)
    both comment on alice's PR.  The aggregator's LEFT JOIN finds no
    user row for ghost-user; the CASE expression maps it to the
    ``FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL`` literal.  Expected:
    bob has his own bucket; ghost-user collapses into the sentinel
    bucket (NOT a raw-UUID-keyed bucket).

    FK enforcement is OFF in the fixture (mirrors #334's pattern); in
    well-formed production data the FK at ``models.py:172`` would
    prevent ghost-user from being inserted into pr_comments at all.
    """
    db, tmp_path = reviewer_comments_db
    monday = _week_monday(2026, 2)
    _insert_pr(
        db,
        uid="pr-1",
        pr_id=1,
        user_id=USER_ALICE,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-1", thread_id="t1", status="active")
    _insert_comment(
        db, uid="pr-1", thread_id="t1", comment_id="c-bob", author_id=USER_BOB
    )
    _insert_comment(
        db,
        uid="pr-1",
        thread_id="t1",
        comment_id="c-ghost",
        author_id=GHOST_USER,
    )

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_reviewer_comments(rollup)
    assert FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL in buckets, (
        f"FR-1-03 violation: ghost-user (UUID absent from users) did NOT "
        f"collapse into the sentinel bucket.  Got {sorted(buckets.keys())!r}"
    )
    assert GHOST_USER not in buckets, (
        f"FR-1-03 violation: ghost-user UUID appears as a raw bucket key "
        f"(should have been mapped to the sentinel literal).  Got "
        f"{sorted(buckets.keys())!r}"
    )
    assert USER_BOB in buckets, (
        f"bob (real user) missing from buckets; got {sorted(buckets.keys())!r}"
    )
    assert buckets[FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL]["comment_count"] == 1
    assert buckets[USER_BOB]["comment_count"] == 1


def test_fail_loud_on_non_uuid_author_id(
    reviewer_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-12 / CL-15 (case xii): RuntimeError on non-UUID pr_comments.author_id.

    The non-UUID-shaped author_id ``not-a-uuid-shaped-string`` is
    inserted into both ``users`` (so the LEFT JOIN matches) and
    ``pr_comments`` (so the SELECT row carries the non-UUID value
    through the CASE expression as ``commenter_or_sentinel``).  The
    aggregator's defensive shape-corruption check raises ``RuntimeError``
    per CL-15 because the value violates the production extractor's
    UUID convention (32 hex + 4 hyphens).

    NOTE: the FR-1-12 NULL clause (RuntimeError on NULL author_id) is
    NOT exercised by this suite — the SQL CASE expression maps absent-
    from-users rows to the sentinel literal, and ``pr_comments.author_id
    NOT NULL`` at ``models.py:160`` prevents NULL at INSERT, making the
    NULL path structurally unreachable.  Tasks.md T008 records this
    explicitly.
    """
    db, tmp_path = reviewer_comments_db
    monday = _week_monday(2026, 2)
    # Insert a user with a non-UUID-shaped user_id (FK off allows this).
    db.execute(
        "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
        (NON_UUID_USER, "Non-UUID User", "non-uuid@example.com"),
    )
    _insert_pr(
        db,
        uid="pr-1",
        pr_id=1,
        user_id=USER_ALICE,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-1", thread_id="t1", status="active")
    _insert_comment(
        db,
        uid="pr-1",
        thread_id="t1",
        comment_id="c-bad",
        author_id=NON_UUID_USER,
    )

    # The helper raises RuntimeError per FR-1-12 / CL-15.  The
    # AggregateGenerator.generate_all() wrapper catches all exceptions
    # and re-raises as AggregationError preserving the original via
    # ``raise ... from e`` (existing behavior since #334 / #335 — not
    # part of the per-reviewer dimension's contract).  The test
    # validates BOTH: (1) the wrapper fires (AggregationError caught),
    # AND (2) the root cause is RuntimeError per the FR-1-12 helper
    # contract.
    with pytest.raises(AggregationError) as exc_info:
        _generate_rollup(tmp_path, db)
    root_cause = exc_info.value.__cause__
    assert isinstance(root_cause, RuntimeError), (
        f"FR-1-12 / CL-15: per-reviewer helper must raise RuntimeError "
        f"(got {type(root_cause).__name__ if root_cause else 'None'} "
        f"via the AggregationError wrapper).  The wrapper preserves the "
        f"original exception via ``raise ... from e``; the helper's "
        f"contract is RuntimeError, not AggregationError."
    )
    # Helpful diagnostic — the error message should mention the offending
    # value or shape constraint so debugging is straightforward.
    error_msg = str(root_cause)
    assert NON_UUID_USER in error_msg or "UUID" in error_msg or "shape" in error_msg, (
        f"RuntimeError raised but message lacks a clue about the offending "
        f"non-UUID value or shape contract: {error_msg!r}"
    )


def test_determinism_outer_dict_key_order_ascending_by_commenter(
    reviewer_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """Determinism (case xiii): outer dict keys are ascending by commenter key.

    Display name (``users.display_name``) MUST NOT influence the
    producer's sort order — that's renderer-side tie-breaking per
    FR-4-05.  Only the commenter key (``user_id`` or sentinel literal)
    is guaranteed stable for sorting.

    Insert comments in an order DIFFERENT from the expected sort order
    to guard against insert-order leakage.  bob (USER_BOB) sorts before
    charlie (USER_CHARLIE) by user_id ASCII order.  Insert charlie
    first; expected emit order is bob → charlie regardless.
    """
    db, tmp_path = reviewer_comments_db
    monday = _week_monday(2026, 2)
    _insert_pr(
        db,
        uid="pr-1",
        pr_id=1,
        user_id=USER_ALICE,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-1", thread_id="t1", status="active")
    # Insert charlie's comment first.
    _insert_comment(
        db, uid="pr-1", thread_id="t1", comment_id="c-charlie", author_id=USER_CHARLIE
    )
    # Then bob's.
    _insert_comment(
        db, uid="pr-1", thread_id="t1", comment_id="c-bob", author_id=USER_BOB
    )

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_reviewer_comments(rollup)
    keys = list(buckets.keys())
    assert keys == sorted(keys), (
        f"Determinism violation: outer dict keys are not ascending. Got: {keys!r}"
    )
    # Bonus: bob < charlie by user_id ASCII order — expected canonical
    # order regardless of insert order.
    assert keys.index(USER_BOB) < keys.index(USER_CHARLIE)
