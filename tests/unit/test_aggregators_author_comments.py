"""Feature 334 producer-side tests: per-(week, author) comments-density emission.

Covers the invariants asserted by the producer contract
(``specs/334-comments-author-density/contracts/per-author-comments-density.md``):

- FR-1-01..02  Capability gating + emission shape: when ``_has_comments()``
               is False, the aggregator omits the entire
               ``rollup[W].by_author_comments`` key (FR-3-03 + INV-2-09).
               When True, an outer dict keyed by ``author_id`` (or
               sentinel literal) is emitted on the rollup root with
               atomic 4-field entries (INV-2-08).
- FR-1-03      Sentinel bucketing per CL-03: PRs whose ``user_id`` is
               absent from the ``users`` table collapse into the single
               reserved bucket key
               ``FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL``.
- FR-1-05      Extracted-subset rule: per-bucket numeric sums range over
               the bucket's extracted-subset (PRs with
               ``comments_extracted_at IS NOT NULL``).
- FR-1-06      Per-bucket ``coverage_partial``: True iff at least one PR
               in the bucket's canonical set has
               ``comments_extracted_at IS NULL``.
- FR-1-07      Atomicity: every entry has all four fields together
               (INV-2-08); partial entries are forbidden.
- FR-1-08      Ordering: ``active_thread_count <= thread_count`` per
               entry including the sentinel bucket (INV-2-07).
- Determinism  Outer dict key order is ascending by author key (the
               stable identity string, including the sentinel which
               sorts between digit-starting and letter-starting UUIDs
               in ASCII).  Display name is NOT the producer's sort key.

Harness mirrors ``tests/unit/test_aggregators_pr_records_comments.py``
(Feature 310 producer test scaffold) so regressions across features are
localized.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Final

import pytest

from ado_git_repo_insights.persistence.database import DatabaseManager
from ado_git_repo_insights.transform.aggregators import AggregateGenerator
from ado_git_repo_insights.transform.constants import (
    FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL,
)

ORG_NAME: Final[str] = "org1"
PROJECT_NAME: Final[str] = "proj1"
REPOSITORY_ID: Final[str] = "repo1"
USER_ALICE: Final[str] = "alice-uid"
USER_BOB: Final[str] = "bob-uid"
USER_GHOST: Final[str] = "ghost-uid"  # NOT inserted into users table


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
            USER_ALICE,
            "body",
            "text",
            "2026-01-02T00:00:00Z",
            "2026-01-02T00:00:00Z",
            is_deleted,
        ),
    )


@pytest.fixture
def author_comments_db(
    tmp_path: Path,
) -> Iterator[tuple[DatabaseManager, Path]]:
    """DB seeded with org/project/repo + alice + bob (NOT ghost)."""
    db_path = tmp_path / "author-comments.sqlite"
    db = DatabaseManager(db_path)
    db.connect()
    # Disable FK enforcement so the fixture can seed ghost PRs whose
    # ``user_id`` is absent from the ``users`` table.  This mirrors the
    # production reality (deprovisioned users leave orphaned PRs) per
    # Feature 334 CL-03 + FR-1-03 — the aggregator's LEFT JOIN +
    # sentinel CASE is the boundary the test exercises.
    db.execute("PRAGMA foreign_keys = OFF")
    db.execute("INSERT INTO organizations (organization_name) VALUES (?)", (ORG_NAME,))
    db.execute(
        "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
        (ORG_NAME, PROJECT_NAME),
    )
    db.execute(
        "INSERT INTO repositories (repository_id, repository_name, project_name, "
        "organization_name) VALUES (?, ?, ?, ?)",
        (REPOSITORY_ID, "Repository 1", PROJECT_NAME, ORG_NAME),
    )
    db.execute(
        "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
        (USER_ALICE, "Alice", "alice@example.com"),
    )
    db.execute(
        "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
        (USER_BOB, "Bob", "bob@example.com"),
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


def _by_author_comments(rollup: dict[str, object]) -> dict[str, dict[str, object]]:
    raw = rollup.get("by_author_comments")
    assert isinstance(raw, dict), (
        f"expected dict at by_author_comments, got {type(raw).__name__}"
    )
    typed: dict[str, dict[str, object]] = {}
    for key, entry in raw.items():
        assert isinstance(entry, dict)
        typed[str(key)] = entry
    return typed


# --------------------------------------------------------------------------- #
# T007 — FR-1-* coverage                                                       #
# --------------------------------------------------------------------------- #


def test_capability_off_omits_by_author_comments_key(
    author_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-3-03 + INV-2-09: no pr_threads → ``_has_comments()`` False → key absent."""
    db, tmp_path = author_comments_db
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
    assert "by_author_comments" not in rollup, (
        "FR-3-03 violation: by_author_comments key emitted under "
        f"capability-off (no pr_threads in DB).  Got: "
        f"{rollup.get('by_author_comments')!r}"
    )


def test_all_extracted_week_coverage_partial_false(
    author_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-05 + FR-1-06: all-extracted week → every entry coverage_partial=False."""
    db, tmp_path = author_comments_db
    monday = _week_monday(2026, 2)
    _insert_pr(
        db,
        uid="pr-alice",
        pr_id=1,
        user_id=USER_ALICE,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-alice", thread_id="t1", status="active")
    _insert_comment(db, uid="pr-alice", thread_id="t1", comment_id="c1")

    _insert_pr(
        db,
        uid="pr-bob",
        pr_id=2,
        user_id=USER_BOB,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-bob", thread_id="t2", status="closed")

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_author_comments(rollup)
    assert set(buckets.keys()) == {USER_ALICE, USER_BOB}, (
        f"expected exactly two buckets, got {sorted(buckets.keys())!r}"
    )
    assert buckets[USER_ALICE]["coverage_partial"] is False
    assert buckets[USER_ALICE]["thread_count"] == 1
    assert buckets[USER_ALICE]["comment_count"] == 1
    assert buckets[USER_ALICE]["active_thread_count"] == 1
    assert buckets[USER_BOB]["coverage_partial"] is False
    assert buckets[USER_BOB]["thread_count"] == 1
    assert buckets[USER_BOB]["comment_count"] == 0
    assert buckets[USER_BOB]["active_thread_count"] == 0


def test_mixed_extraction_author_coverage_partial_true(
    author_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-05 + FR-1-06: mixed-extraction author → coverage_partial=True, sums over extracted only."""
    db, tmp_path = author_comments_db
    monday = _week_monday(2026, 2)
    # Alice has both extracted and unextracted PRs in the same week.
    _insert_pr(
        db,
        uid="pr-alice-1",
        pr_id=1,
        user_id=USER_ALICE,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-alice-1", thread_id="t1", status="active")
    _insert_thread(db, uid="pr-alice-1", thread_id="t2", status="closed")

    _insert_pr(
        db,
        uid="pr-alice-2",
        pr_id=2,
        user_id=USER_ALICE,
        closed_date=monday.isoformat(),
        comments_extracted_at=None,  # unextracted
    )
    # pr_threads attached to the unextracted PR — must NOT be counted.
    _insert_thread(db, uid="pr-alice-2", thread_id="t3", status="active")
    _insert_comment(db, uid="pr-alice-2", thread_id="t3", comment_id="c-skip")

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_author_comments(rollup)
    assert USER_ALICE in buckets
    alice = buckets[USER_ALICE]
    assert alice["coverage_partial"] is True, (
        "FR-1-06 violation: bucket has unextracted PR but coverage_partial "
        f"is {alice['coverage_partial']!r}"
    )
    # Sum is over extracted PRs only (FR-1-05): only pr-alice-1's threads.
    assert alice["thread_count"] == 2
    assert alice["active_thread_count"] == 1
    assert alice["comment_count"] == 0


def test_all_unextracted_author_emits_zeros_with_coverage_partial_true(
    author_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-05 + FR-1-06: bucket with no extracted PRs → (0,0,0,True)."""
    db, tmp_path = author_comments_db
    monday = _week_monday(2026, 2)
    # Bob has only unextracted PRs.
    _insert_pr(
        db,
        uid="pr-bob-1",
        pr_id=1,
        user_id=USER_BOB,
        closed_date=monday.isoformat(),
        comments_extracted_at=None,
    )
    _insert_thread(db, uid="pr-bob-1", thread_id="t1", status="active")
    _insert_comment(db, uid="pr-bob-1", thread_id="t1", comment_id="c-skip")
    # Alice gets one extracted PR so _has_comments() is True via Alice's threads
    # AND the rollup has at least one canonical PR.  This isolates Bob's
    # all-unextracted bucket.
    _insert_pr(
        db,
        uid="pr-alice-1",
        pr_id=2,
        user_id=USER_ALICE,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-alice-1", thread_id="t2", status="active")

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_author_comments(rollup)
    assert USER_BOB in buckets
    bob = buckets[USER_BOB]
    assert bob["thread_count"] == 0
    assert bob["comment_count"] == 0
    assert bob["active_thread_count"] == 0
    assert bob["coverage_partial"] is True


def test_sentinel_bucketing_for_unknown_to_users_authors(
    author_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-03 + CL-03: PRs whose user_id is absent from users → single sentinel bucket."""
    db, tmp_path = author_comments_db
    monday = _week_monday(2026, 2)
    # Two PRs by different unknown-to-users authors must collapse into the
    # SAME sentinel bucket.
    _insert_pr(
        db,
        uid="pr-ghost-1",
        pr_id=1,
        user_id=USER_GHOST,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-ghost-1", thread_id="t1", status="active")

    _insert_pr(
        db,
        uid="pr-ghost-2",
        pr_id=2,
        user_id="another-ghost",
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-ghost-2", thread_id="t2", status="active")
    _insert_thread(db, uid="pr-ghost-2", thread_id="t3", status="closed")

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_author_comments(rollup)
    assert FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL in buckets
    sentinel = buckets[FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL]
    # Both PRs collapse: total threads = 1 (active) + 2 (1 active + 1 closed) = 3.
    assert sentinel["thread_count"] == 3
    assert sentinel["active_thread_count"] == 2
    # No real-author bucket should appear with the raw ghost ids.
    assert USER_GHOST not in buckets
    assert "another-ghost" not in buckets


def test_atomicity_every_entry_has_all_four_fields(
    author_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-07 + INV-2-08: every emitted bucket entry carries all 4 atomic fields."""
    db, tmp_path = author_comments_db
    monday = _week_monday(2026, 2)
    _insert_pr(
        db,
        uid="pr-alice",
        pr_id=1,
        user_id=USER_ALICE,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-alice", thread_id="t1", status="active")
    _insert_pr(
        db,
        uid="pr-bob",
        pr_id=2,
        user_id=USER_BOB,
        closed_date=monday.isoformat(),
        comments_extracted_at=None,
    )
    _insert_thread(db, uid="pr-bob", thread_id="t2", status="closed")
    _insert_pr(
        db,
        uid="pr-ghost",
        pr_id=3,
        user_id=USER_GHOST,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-ghost", thread_id="t3", status="active")

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_author_comments(rollup)
    expected_fields = {
        "thread_count",
        "comment_count",
        "active_thread_count",
        "coverage_partial",
    }
    for key, entry in buckets.items():
        assert set(entry.keys()) == expected_fields, (
            f"INV-2-08 atomicity violation at bucket {key!r}: "
            f"present={sorted(entry.keys())!r}, expected="
            f"{sorted(expected_fields)!r}"
        )


def test_inv207_ordering_active_le_thread_per_entry(
    author_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-08 + INV-2-07: active_thread_count <= thread_count per entry incl. sentinel."""
    db, tmp_path = author_comments_db
    monday = _week_monday(2026, 2)
    # Alice: 3 threads (2 active, 1 closed) → active=2, thread=3.
    _insert_pr(
        db,
        uid="pr-a",
        pr_id=1,
        user_id=USER_ALICE,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    for tid, status in [("t1", "active"), ("t2", "active"), ("t3", "closed")]:
        _insert_thread(db, uid="pr-a", thread_id=tid, status=status)

    # Sentinel bucket: 2 threads (1 active, 1 closed).
    _insert_pr(
        db,
        uid="pr-g",
        pr_id=2,
        user_id=USER_GHOST,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    for tid, status in [("t4", "active"), ("t5", "closed")]:
        _insert_thread(db, uid="pr-g", thread_id=tid, status=status)

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_author_comments(rollup)
    for key, entry in buckets.items():
        thread = entry["thread_count"]
        active = entry["active_thread_count"]
        assert isinstance(thread, int), (
            f"non-integer thread_count in bucket {key!r}: {thread!r}"
        )
        assert isinstance(active, int), (
            f"non-integer active_thread_count in bucket {key!r}: {active!r}"
        )
        assert active <= thread, (
            f"INV-2-07 violation at bucket {key!r}: "
            f"active_thread_count={active} > thread_count={thread}"
        )


# --------------------------------------------------------------------------- #
# T008 — determinism                                                            #
# --------------------------------------------------------------------------- #


def test_sentinel_literal_does_not_collide_with_real_author_ids() -> None:
    """T029 (US4): the reserved sentinel literal MUST NOT match any real author_id.

    Spec assumption A-07 declares ``__former_or_unavailable_author__``
    namespace-safe (production author_ids are UUID-format strings —
    32 hex + 4 hyphens — and cannot collide with the leading-double-
    underscore literal).  This test is the executable closure: scan
    every committed demo fixture surface where an ``author_id`` (or
    its renamed-by-dimension peers ``user_id`` / ``reviewer_id``)
    value could appear and assert the literal never shows up there.

    Surfaces scanned:

    * ``docs/data/aggregates/dimensions.json``:
      - every ``authors[].author_id`` value (the canonical authors
        directory the dashboard renders display names from).
      - every ``users[].user_id`` value (Feature 336 widening — the
        ``pr_comments.author_id`` FK target per ``models.py:172``;
        scanning users[].user_id covers the per-reviewer dimension's
        bucket-key namespace because every commenter ``author_id``
        references this ``user_id`` via FK).
      - every ``reviewers[].reviewer_id`` value (Feature 336 widening
        — the throughput per-reviewer dimension's identity namespace,
        which is the same UUID space as ``user_id`` / ``author_id``).
    * ``docs/data/aggregates/weekly_rollups/*.json``:
      - every key in ``rollup[W].by_author`` (the throughput per-
        author slice; pre-existing throughput-side mirror of the
        author_id space).
      - every key in ``rollup[W].by_reviewer`` (Feature 336 widening
        — the throughput per-reviewer slice; one bucket per real
        ``reviewer_id`` / ``user_id``).

    The test does NOT scan ``rollup[W].by_author_comments`` or
    ``rollup[W].by_reviewer_comments`` — those are the producers' own
    emissions and the literal IS a valid bucket key there by design
    (CL-03 / INV-2-12 / INV-4-12).  The check only asserts that NO
    REAL author_id / user_id / reviewer_id collides with it.

    Per kickoff directive on #336: "extend its assertion list, don't
    duplicate the test" — this test is the single executable closure
    for the sentinel literal's namespace-safety guarantee across all
    UUID-shaped identity spaces (author / user / reviewer) that appear
    in the demo fixture's serialized surfaces.
    """
    repo_root = Path(__file__).resolve().parents[2]
    docs_data = repo_root / "docs" / "data" / "aggregates"

    dimensions_path = docs_data / "dimensions.json"
    assert dimensions_path.is_file(), (
        f"docs/data/aggregates/dimensions.json missing at {dimensions_path} — "
        "the canonical demo fixture must exist before this safety test runs"
    )
    dimensions = json.loads(dimensions_path.read_text(encoding="utf-8"))
    authors_dim_raw = dimensions.get("authors")
    assert isinstance(authors_dim_raw, list), (
        "dimensions.json missing or non-list authors array"
    )
    for entry in authors_dim_raw:
        if not isinstance(entry, dict):
            continue
        author_id = entry.get("author_id")
        assert author_id != FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL, (
            "Feature 334 A-07 violation: dimensions.json carries an authors[] "
            f"entry whose author_id collides with the reserved sentinel "
            f"literal {FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL!r}.  Real "
            "author_ids must NEVER equal the sentinel literal — see "
            "specs/334-comments-author-density/spec.md Assumption A-07."
        )

    # Feature 336 widening: scan users[].user_id (the FK target for
    # pr_comments.author_id) and reviewers[].reviewer_id (throughput's
    # per-reviewer identity namespace).  Both are UUID-shaped strings
    # in the same namespace as authors[].author_id; collisions with
    # the sentinel literal are equally forbidden.
    users_dim_raw = dimensions.get("users")
    assert isinstance(users_dim_raw, list), (
        "dimensions.json missing or non-list users array — Feature 336 "
        "T014 widened scan requires this surface"
    )
    for entry in users_dim_raw:
        if not isinstance(entry, dict):
            continue
        user_id = entry.get("user_id")
        assert user_id != FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL, (
            "Feature 336 A-07 violation: dimensions.json carries a users[] "
            f"entry whose user_id collides with the reserved sentinel "
            f"literal {FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL!r}.  Real "
            "user_ids must NEVER equal the sentinel literal — see "
            "specs/336-comments-reviewer-density/spec.md Assumption A-07.  "
            "The pr_comments.author_id FK at models.py:172 references this "
            "user_id; a collision would corrupt the per-reviewer "
            "by_reviewer_comments bucket-key namespace (INV-4-12)."
        )

    reviewers_dim_raw = dimensions.get("reviewers")
    assert isinstance(reviewers_dim_raw, list), (
        "dimensions.json missing or non-list reviewers array — Feature 336 "
        "T014 widened scan requires this surface"
    )
    for entry in reviewers_dim_raw:
        if not isinstance(entry, dict):
            continue
        reviewer_id = entry.get("reviewer_id")
        assert reviewer_id != FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL, (
            "Feature 336 A-07 violation: dimensions.json carries a "
            f"reviewers[] entry whose reviewer_id collides with the reserved "
            f"sentinel literal {FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL!r}.  "
            "Real reviewer_ids must NEVER equal the sentinel literal."
        )

    rollups_dir = docs_data / "weekly_rollups"
    assert rollups_dir.is_dir(), (
        f"docs/data/aggregates/weekly_rollups missing at {rollups_dir}"
    )
    rollup_files = sorted(rollups_dir.glob("*.json"))
    assert rollup_files, (
        f"docs/data/aggregates/weekly_rollups is empty at {rollups_dir}"
    )
    for rollup_path in rollup_files:
        payload = json.loads(rollup_path.read_text(encoding="utf-8"))
        by_author = payload.get("by_author")
        if isinstance(by_author, dict):
            assert FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL not in by_author, (
                f"Feature 334 A-07 violation: {rollup_path.name} carries a "
                f"by_author bucket keyed by the reserved sentinel literal "
                f"{FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL!r}.  Throughput's "
                "per-author slice must NEVER use a real author_id equal to "
                "the sentinel literal — that would collide with Feature "
                "334's by_author_comments sentinel-bucket convention (CL-03)."
            )
        # Feature 336 widening: the throughput per-reviewer slice's bucket
        # keys are the same UUID space as authors / users — collisions
        # equally forbidden.
        by_reviewer = payload.get("by_reviewer")
        if isinstance(by_reviewer, dict):
            assert FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL not in by_reviewer, (
                f"Feature 336 A-07 violation: {rollup_path.name} carries a "
                f"by_reviewer bucket keyed by the reserved sentinel literal "
                f"{FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL!r}.  Throughput's "
                "per-reviewer slice must NEVER use a real reviewer_id equal "
                "to the sentinel literal — that would collide with Feature "
                "336's by_reviewer_comments sentinel-bucket convention "
                "(CL-03 / INV-4-12)."
            )


def test_determinism_outer_dict_key_order_ascending(
    author_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """Determinism: outer dict keys are ascending by stable identity string."""
    db, tmp_path = author_comments_db
    monday = _week_monday(2026, 2)
    # Insert PRs in an order DIFFERENT from the expected sort order so a
    # producer that didn't sort would emit in insert order.
    _insert_pr(
        db,
        uid="pr-bob",
        pr_id=1,
        user_id=USER_BOB,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-bob", thread_id="t-b", status="active")
    _insert_pr(
        db,
        uid="pr-alice",
        pr_id=2,
        user_id=USER_ALICE,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-alice", thread_id="t-a", status="active")
    _insert_pr(
        db,
        uid="pr-ghost",
        pr_id=3,
        user_id=USER_GHOST,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-ghost", thread_id="t-g", status="active")

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_author_comments(rollup)
    keys = list(buckets.keys())
    assert keys == sorted(keys), (
        f"Determinism violation: outer dict keys are not ascending. Got: {keys!r}"
    )
    # Bonus: the sentinel literal sorts BEFORE 'a'-prefixed UUIDs because
    # '_' (0x5F) < 'a' (0x61) in ASCII, but AFTER any digit-prefixed key.
    # Both alice-uid and bob-uid start with letters in this fixture; the
    # sentinel sorts before both.
    assert keys.index(FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL) < keys.index(USER_ALICE)
    assert keys.index(USER_ALICE) < keys.index(USER_BOB)
