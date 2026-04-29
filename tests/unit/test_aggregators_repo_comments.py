"""Feature 335 producer-side tests: per-(week, repo) comments-density emission.

Covers the invariants asserted by the producer contract
(``specs/335-comments-repo-density/contracts/per-repo-comments-density.md``):

- FR-1-01..02  Capability gating + emission shape: when ``_has_comments()``
               is False, the aggregator omits the entire
               ``rollup[W].by_repository_comments`` key (FR-3-03 + INV-3-09).
               When True, an outer dict keyed by ``repository_id`` is
               emitted on the rollup root with atomic 4-field entries
               (INV-3-08).
- FR-1-03      FK-protected keying (CL-03 / INV-3-12): the outer dict key is
               the PR's ``repository_id`` value directly.  There is NO
               sentinel literal — the FK constraint at
               ``models.py:88`` (``pull_requests.repository_id REFERENCES
               repositories(repository_id)``) makes unknown-to-``repositories``
               IDs impossible in well-formed production data.
- FR-1-05      Extracted-subset rule: per-bucket numeric sums range over
               the bucket's extracted-subset (PRs with
               ``comments_extracted_at IS NOT NULL``).
- FR-1-06      Per-bucket ``coverage_partial``: True iff at least one PR
               in the bucket's canonical set has
               ``comments_extracted_at IS NULL``.
- FR-1-07      Atomicity: every entry has all four fields together
               (INV-3-08); partial entries are forbidden.
- FR-1-08      Ordering: ``active_thread_count <= thread_count`` per
               entry (INV-3-07).
- FR-1-09      Full extracted-subset scope: emission covers W's FULL
               canonical throughput PR set (INV-3-10), NOT a drill-down-
               capped slice — the prerequisite that makes FR-2-03 cross-
               aggregate sum-coherence honor-able on truncated weeks.
- Determinism  Outer dict key order is ascending by ``repository_id``
               (the stable identity string).  Display name is NOT the
               producer's sort key.

Harness mirrors ``tests/unit/test_aggregators_author_comments.py``
(Feature 334 producer test scaffold) so regressions across features are
localized.  NOTE: this file deliberately omits the sentinel collision-
safety unit test (334 T029 equivalent) per CL-03 — repository_id is
FK-protected; the sentinel concept does not apply to the per-repo
dimension.
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

ORG_NAME: Final[str] = "org1"
PROJECT_NAME: Final[str] = "proj1"
REPOSITORY_ID_ALPHA: Final[str] = "repo-alpha"
REPOSITORY_ID_BETA: Final[str] = "repo-beta"
REPOSITORY_NAME_ALPHA: Final[str] = "Repository Alpha"
REPOSITORY_NAME_BETA: Final[str] = "Repository Beta"
USER_ALICE: Final[str] = "alice-uid"
USER_BOB: Final[str] = "bob-uid"


def _week_monday(year: int, iso_week: int) -> date:
    return date.fromisocalendar(year, iso_week, 1)


def _insert_pr(
    db: DatabaseManager,
    *,
    uid: str,
    pr_id: int,
    user_id: str,
    repository_id: str,
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
            repository_id,
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
def repo_comments_db(
    tmp_path: Path,
) -> Iterator[tuple[DatabaseManager, Path]]:
    """DB seeded with org/project/two-repos + alice + bob.

    Two repositories (alpha + beta) so per-(week, repo) grouping tests
    can exercise multi-bucket emission.  Users alice + bob are both in
    the ``users`` table — there is NO ghost user here (CL-03: no sentinel
    concept for the per-repo dimension; the per-repo aggregator does not
    LEFT JOIN ``users``).
    """
    db_path = tmp_path / "repo-comments.sqlite"
    db = DatabaseManager(db_path)
    db.connect()
    db.execute("INSERT INTO organizations (organization_name) VALUES (?)", (ORG_NAME,))
    db.execute(
        "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
        (ORG_NAME, PROJECT_NAME),
    )
    db.execute(
        "INSERT INTO repositories (repository_id, repository_name, project_name, "
        "organization_name) VALUES (?, ?, ?, ?)",
        (REPOSITORY_ID_ALPHA, REPOSITORY_NAME_ALPHA, PROJECT_NAME, ORG_NAME),
    )
    db.execute(
        "INSERT INTO repositories (repository_id, repository_name, project_name, "
        "organization_name) VALUES (?, ?, ?, ?)",
        (REPOSITORY_ID_BETA, REPOSITORY_NAME_BETA, PROJECT_NAME, ORG_NAME),
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


def _by_repository_comments(rollup: dict[str, object]) -> dict[str, dict[str, object]]:
    raw = rollup.get("by_repository_comments")
    assert isinstance(raw, dict), (
        f"expected dict at by_repository_comments, got {type(raw).__name__}"
    )
    typed: dict[str, dict[str, object]] = {}
    for key, entry in raw.items():
        assert isinstance(entry, dict)
        typed[str(key)] = entry
    return typed


# --------------------------------------------------------------------------- #
# T004 — FR-1-* coverage (cases (i)-(vi))                                      #
# --------------------------------------------------------------------------- #


def test_capability_off_omits_by_repository_comments_key(
    repo_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-3-03 + INV-3-09 (case iv): no pr_threads → ``_has_comments()`` False → key absent."""
    db, tmp_path = repo_comments_db
    monday = _week_monday(2026, 2)
    _insert_pr(
        db,
        uid="pr-1",
        pr_id=1,
        user_id=USER_ALICE,
        repository_id=REPOSITORY_ID_ALPHA,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    rollup = _generate_rollup(tmp_path, db)
    assert "by_repository_comments" not in rollup, (
        "FR-3-03 violation: by_repository_comments key emitted under "
        f"capability-off (no pr_threads in DB).  Got: "
        f"{rollup.get('by_repository_comments')!r}"
    )


def test_all_extracted_week_coverage_partial_false(
    repo_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-05 + FR-1-06 (case i): all-extracted week → every entry coverage_partial=False."""
    db, tmp_path = repo_comments_db
    monday = _week_monday(2026, 2)
    # Alpha: one extracted PR with one active thread + one comment.
    _insert_pr(
        db,
        uid="pr-alpha",
        pr_id=1,
        user_id=USER_ALICE,
        repository_id=REPOSITORY_ID_ALPHA,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-alpha", thread_id="t1", status="active")
    _insert_comment(db, uid="pr-alpha", thread_id="t1", comment_id="c1")

    # Beta: one extracted PR with one closed thread (no comment).
    _insert_pr(
        db,
        uid="pr-beta",
        pr_id=2,
        user_id=USER_BOB,
        repository_id=REPOSITORY_ID_BETA,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-beta", thread_id="t2", status="closed")

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_repository_comments(rollup)
    assert set(buckets.keys()) == {REPOSITORY_ID_ALPHA, REPOSITORY_ID_BETA}, (
        f"expected exactly two buckets, got {sorted(buckets.keys())!r}"
    )
    assert buckets[REPOSITORY_ID_ALPHA]["coverage_partial"] is False
    assert buckets[REPOSITORY_ID_ALPHA]["thread_count"] == 1
    assert buckets[REPOSITORY_ID_ALPHA]["comment_count"] == 1
    assert buckets[REPOSITORY_ID_ALPHA]["active_thread_count"] == 1
    assert buckets[REPOSITORY_ID_BETA]["coverage_partial"] is False
    assert buckets[REPOSITORY_ID_BETA]["thread_count"] == 1
    assert buckets[REPOSITORY_ID_BETA]["comment_count"] == 0
    assert buckets[REPOSITORY_ID_BETA]["active_thread_count"] == 0


def test_mixed_extraction_repo_coverage_partial_true(
    repo_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-05 + FR-1-06 (case ii): mixed-extraction repo → coverage_partial=True, sums over extracted only."""
    db, tmp_path = repo_comments_db
    monday = _week_monday(2026, 2)
    # Alpha has both extracted and unextracted PRs in the same week.
    _insert_pr(
        db,
        uid="pr-alpha-1",
        pr_id=1,
        user_id=USER_ALICE,
        repository_id=REPOSITORY_ID_ALPHA,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-alpha-1", thread_id="t1", status="active")
    _insert_thread(db, uid="pr-alpha-1", thread_id="t2", status="closed")

    _insert_pr(
        db,
        uid="pr-alpha-2",
        pr_id=2,
        user_id=USER_BOB,
        repository_id=REPOSITORY_ID_ALPHA,
        closed_date=monday.isoformat(),
        comments_extracted_at=None,  # unextracted
    )
    # pr_threads attached to the unextracted PR — must NOT be counted.
    _insert_thread(db, uid="pr-alpha-2", thread_id="t3", status="active")
    _insert_comment(db, uid="pr-alpha-2", thread_id="t3", comment_id="c-skip")

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_repository_comments(rollup)
    assert REPOSITORY_ID_ALPHA in buckets
    alpha = buckets[REPOSITORY_ID_ALPHA]
    assert alpha["coverage_partial"] is True, (
        "FR-1-06 violation: bucket has unextracted PR but coverage_partial "
        f"is {alpha['coverage_partial']!r}"
    )
    # Sum is over extracted PRs only (FR-1-05): only pr-alpha-1's threads.
    assert alpha["thread_count"] == 2
    assert alpha["active_thread_count"] == 1
    assert alpha["comment_count"] == 0


def test_all_unextracted_repo_emits_zeros_with_coverage_partial_true(
    repo_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-05 + FR-1-06 (case iii): bucket with no extracted PRs → (0,0,0,True)."""
    db, tmp_path = repo_comments_db
    monday = _week_monday(2026, 2)
    # Beta has only unextracted PRs.
    _insert_pr(
        db,
        uid="pr-beta-1",
        pr_id=1,
        user_id=USER_BOB,
        repository_id=REPOSITORY_ID_BETA,
        closed_date=monday.isoformat(),
        comments_extracted_at=None,
    )
    _insert_thread(db, uid="pr-beta-1", thread_id="t1", status="active")
    _insert_comment(db, uid="pr-beta-1", thread_id="t1", comment_id="c-skip")
    # Alpha gets one extracted PR so _has_comments() is True via Alpha's
    # threads AND the rollup has at least one canonical PR.  This isolates
    # Beta's all-unextracted bucket.
    _insert_pr(
        db,
        uid="pr-alpha-1",
        pr_id=2,
        user_id=USER_ALICE,
        repository_id=REPOSITORY_ID_ALPHA,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-alpha-1", thread_id="t2", status="active")

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_repository_comments(rollup)
    assert REPOSITORY_ID_BETA in buckets
    beta = buckets[REPOSITORY_ID_BETA]
    assert beta["thread_count"] == 0
    assert beta["comment_count"] == 0
    assert beta["active_thread_count"] == 0
    assert beta["coverage_partial"] is True


def test_atomicity_every_entry_has_all_four_fields(
    repo_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-07 + INV-3-08 (case v): every emitted bucket entry carries all 4 atomic fields."""
    db, tmp_path = repo_comments_db
    monday = _week_monday(2026, 2)
    _insert_pr(
        db,
        uid="pr-alpha",
        pr_id=1,
        user_id=USER_ALICE,
        repository_id=REPOSITORY_ID_ALPHA,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-alpha", thread_id="t1", status="active")
    _insert_pr(
        db,
        uid="pr-beta",
        pr_id=2,
        user_id=USER_BOB,
        repository_id=REPOSITORY_ID_BETA,
        closed_date=monday.isoformat(),
        comments_extracted_at=None,
    )
    _insert_thread(db, uid="pr-beta", thread_id="t2", status="closed")

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_repository_comments(rollup)
    expected_fields = {
        "thread_count",
        "comment_count",
        "active_thread_count",
        "coverage_partial",
    }
    for key, entry in buckets.items():
        assert set(entry.keys()) == expected_fields, (
            f"INV-3-08 atomicity violation at bucket {key!r}: "
            f"present={sorted(entry.keys())!r}, expected="
            f"{sorted(expected_fields)!r}"
        )


def test_inv307_ordering_active_le_thread_per_entry(
    repo_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-08 + INV-3-07 (case vi): active_thread_count <= thread_count per entry."""
    db, tmp_path = repo_comments_db
    monday = _week_monday(2026, 2)
    # Alpha: 3 threads (2 active, 1 closed) → active=2, thread=3.
    _insert_pr(
        db,
        uid="pr-a",
        pr_id=1,
        user_id=USER_ALICE,
        repository_id=REPOSITORY_ID_ALPHA,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    for tid, status in [("t1", "active"), ("t2", "active"), ("t3", "closed")]:
        _insert_thread(db, uid="pr-a", thread_id=tid, status=status)

    # Beta: 2 threads (1 active, 1 closed).
    _insert_pr(
        db,
        uid="pr-b",
        pr_id=2,
        user_id=USER_BOB,
        repository_id=REPOSITORY_ID_BETA,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    for tid, status in [("t4", "active"), ("t5", "closed")]:
        _insert_thread(db, uid="pr-b", thread_id=tid, status=status)

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_repository_comments(rollup)
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
            f"INV-3-07 violation at bucket {key!r}: "
            f"active_thread_count={active} > thread_count={thread}"
        )


def test_full_canonical_pr_set_scope_not_drilldown_capped(
    repo_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-1-09 + INV-3-10 (case vii): emission covers W's FULL canonical PR set.

    The aggregator MUST emit per-(week, repo) sums over W's full canonical
    throughput PR set, NOT a drill-down-capped slice (310 INV-02's top-500-
    by-cycle-time cap applies only to the per-PR ``prs[]`` field, not to
    aggregator scope).  This is the prerequisite that makes FR-2-03 cross-
    aggregate sum-coherence honor-able on truncated weeks.

    This test seeds a fixture with PRs spanning a wide cycle-time range
    where one repository's PRs would be EXCLUDED from a hypothetical top-N
    cycle-time slice but are STILL covered by the per-repo aggregator
    emission.  The fixture is small enough to verify by direct row count
    rather than triggering the actual 500-PR cap (which would require a
    much larger fixture and add no signal beyond this scope assertion).
    """
    db, tmp_path = repo_comments_db
    monday = _week_monday(2026, 2)
    # Alpha: 3 PRs with varied cycle-time (high cycle-time means they'd
    # rank highest in a top-N-by-cycle-time slice).
    for idx, ct in enumerate([1000.0, 800.0, 600.0], start=1):
        _insert_pr(
            db,
            uid=f"pr-alpha-{idx}",
            pr_id=idx,
            user_id=USER_ALICE,
            repository_id=REPOSITORY_ID_ALPHA,
            closed_date=monday.isoformat(),
            comments_extracted_at="2026-01-02T00:00:00Z",
            cycle_time_minutes=ct,
        )
        _insert_thread(
            db, uid=f"pr-alpha-{idx}", thread_id=f"ta-{idx}", status="active"
        )

    # Beta: 2 PRs with LOW cycle-time (would be excluded from a top-N-by-
    # cycle-time slice, but MUST still be covered by per-repo emission).
    for idx, ct in enumerate([10.0, 5.0], start=4):
        _insert_pr(
            db,
            uid=f"pr-beta-{idx}",
            pr_id=idx,
            user_id=USER_BOB,
            repository_id=REPOSITORY_ID_BETA,
            closed_date=monday.isoformat(),
            comments_extracted_at="2026-01-02T00:00:00Z",
            cycle_time_minutes=ct,
        )
        _insert_thread(db, uid=f"pr-beta-{idx}", thread_id=f"tb-{idx}", status="closed")

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_repository_comments(rollup)
    # Both repos must appear — Beta's low-cycle-time PRs are NOT excluded
    # from per-repo aggregation, validating FR-1-09 / INV-3-10 full-scope.
    assert REPOSITORY_ID_ALPHA in buckets
    assert REPOSITORY_ID_BETA in buckets
    # Alpha: 3 active threads.
    assert buckets[REPOSITORY_ID_ALPHA]["thread_count"] == 3
    assert buckets[REPOSITORY_ID_ALPHA]["active_thread_count"] == 3
    # Beta: 2 closed threads.
    assert buckets[REPOSITORY_ID_BETA]["thread_count"] == 2
    assert buckets[REPOSITORY_ID_BETA]["active_thread_count"] == 0


# --------------------------------------------------------------------------- #
# T005 — determinism                                                            #
# --------------------------------------------------------------------------- #


def test_determinism_outer_dict_key_order_ascending_by_repository_id(
    repo_comments_db: tuple[DatabaseManager, Path],
) -> None:
    """Determinism: outer dict keys are ascending by ``repository_id`` string.

    Display name (``repository_name``) MUST NOT influence the producer's
    sort order — that's renderer-side tie-breaking per FR-4-05.  Only
    ``repository_id`` is guaranteed unique per the FK; sorting by it
    yields byte-deterministic output across runs.
    """
    db, tmp_path = repo_comments_db
    monday = _week_monday(2026, 2)
    # Insert PRs in an order DIFFERENT from the expected sort order so a
    # producer that didn't sort would emit in insert order.  ``repo-beta``
    # PR is inserted first; ``repo-alpha`` second.  Expected emit order
    # is alpha → beta (ascending by ``repository_id``).
    _insert_pr(
        db,
        uid="pr-beta",
        pr_id=1,
        user_id=USER_BOB,
        repository_id=REPOSITORY_ID_BETA,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-beta", thread_id="t-b", status="active")
    _insert_pr(
        db,
        uid="pr-alpha",
        pr_id=2,
        user_id=USER_ALICE,
        repository_id=REPOSITORY_ID_ALPHA,
        closed_date=monday.isoformat(),
        comments_extracted_at="2026-01-02T00:00:00Z",
    )
    _insert_thread(db, uid="pr-alpha", thread_id="t-a", status="active")

    rollup = _generate_rollup(tmp_path, db)
    buckets = _by_repository_comments(rollup)
    keys = list(buckets.keys())
    assert keys == sorted(keys), (
        f"Determinism violation: outer dict keys are not ascending. Got: {keys!r}"
    )
    # Bonus: ``repo-alpha`` < ``repo-beta`` lexicographically — the
    # expected canonical order regardless of insert order.
    assert keys.index(REPOSITORY_ID_ALPHA) < keys.index(REPOSITORY_ID_BETA)
