"""SC-05 reconciliation fixture builder.

Per directive (Round 14, revised): T007 / T012 are deterministic,
fixture-backed integration tests that drive the PRODUCTION aggregator
(``aggregators.py``) end-to-end. The fixture writes ONLY raw rows into
a fresh SQLite using the production schema (``DatabaseManager``), then
shells out to ``python -m ado_git_repo_insights build-aggregates --db
<sqlite> --out <data_dir>`` to produce the rollups + manifest. Tests
then read those production-generated artifacts and verify them against
an INDEPENDENT SQL re-computation from the raw rows.

Why subprocess invocation:

* The reconciliation test (T007) MUST NOT transitively import
  ``aggregators.py`` (round-9 isolation, structurally enforced by T008
  walking T007's import graph). The subprocess CLI boundary keeps the
  production aggregator out of T007's import graph while still letting
  the rollups under test be REAL production output.
* The fixture builder itself imports ``DatabaseManager`` for schema
  initialization — that import is safe because ``DatabaseManager``
  does not transitively pull in ``aggregators.py``.

Why hand-curated raw rows:

* Source of truth is this Python module's data spec. The SQLite +
  production-generated JSON tree are derivative and never committed —
  they live only in pytest's session tmp dir.
* Five weeks × 3-5 PRs/week is enough surface to exercise every spec
  edge case (all-extracted, mixed, all-partial, all-zero-extracted,
  high-volume) without ballooning into demo-scale data.
* Tombstone rows (``is_deleted=1``) make C1's filter non-trivial — a
  regression that drops the filter would over-count visible threads
  / comments by exactly the tombstone count, surfacing in T007.
* ``comment_type='text'`` on every comment row keeps
  ``_backfill_review_timestamps_if_needed`` (cli.py:2089 → review_time.py)
  a clean no-op (it only acts on ``comment_type='system'`` matching a
  vote-parse pattern). Without that, the backfill would mutate
  ``review_time_minutes`` on the fixture PRs and obscure the
  reconciliation contract.

Public API:

* ``build_fixture(out_dir: Path) -> SC05Fixture`` — populates
  ``out_dir/dataset.sqlite`` (raw rows) then runs the production
  ``build-aggregates`` CLI to write ``out_dir/data/dataset-manifest.json``
  and ``out_dir/data/aggregates/weekly_rollups/*.json``. Returns a typed
  handle to the paths.
"""

from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from ado_git_repo_insights.persistence.database import DatabaseManager

# ---------------------------------------------------------------------------
# Hand-curated source-of-truth data
# ---------------------------------------------------------------------------

ORG_NAME: Final[str] = "demo-org"
PROJECT_NAME: Final[str] = "demo-project"
REPO_ID: Final[str] = "demo-repo"
REPO_NAME: Final[str] = "Demo Repository"
# Feature 336 / T016 production-vs-fixture parity (FR-1-12 / CL-15):
# the production extractor emits ``users.user_id`` and
# ``pr_comments.author_id`` as canonical UUID-format strings (32 hex +
# 4 hyphens) per the kickoff comment-2 directive ("demo key-shape
# verification — do this FIRST.  ...verify it produces author_id values
# that match the canonical extractor's UUID shape").  The
# ``_compute_weekly_by_reviewer_comments`` helper (T016) raises
# ``RuntimeError`` on non-UUID-format author_id values per FR-1-12.
# Pre-#336 these constants were short opaque strings (``"user-001"`` /
# ``"ghost-001"``); T016's FAIL-LOUD check fired on the legacy values
# and broke the SC-05 reconciliation fixture.  The fix is to bring the
# fixture's identity space into shape compliance with the production
# extractor — UUID-format strings whose contents remain human-readable
# enough to debug fixture failures (``...000001`` for the real user;
# ``...0000ff`` for the ghost, sortable last lexicographically).
USER_ID: Final[str] = "00000000-0000-0000-0000-000000000001"
USER_NAME: Final[str] = "Demo User"
USER_EMAIL: Final[str] = "demo@example.local"

# Feature 334: a deliberately deprovisioned author whose ``user_id`` is
# NOT inserted into the ``users`` table.  PRs assigned to this id (the
# first PR of each fixture week per ``_populate_raw_rows``) exercise the
# sentinel-bucket branch of the per-author reconciliation tests.  The
# fixture insert path toggles ``PRAGMA foreign_keys = OFF`` before
# inserting these PRs to mirror the production reality where deletions /
# legacy migrations may leave orphaned PRs.
GHOST_USER_ID: Final[str] = "00000000-0000-0000-0000-0000000000ff"


@dataclass(frozen=True)
class _ThreadSpec:
    """One pr_threads row in the fixture."""

    status: str  # 'active' | 'fixed' | 'unknown'
    is_deleted: int  # 0 (visible) or 1 (tombstone)
    visible_comment_count: int  # comments to attach (is_deleted=0)
    tombstone_comment_count: int  # comments to attach with is_deleted=1


@dataclass(frozen=True)
class _PrSpec:
    """One pull_requests row + its associated thread/comment rows."""

    pr_id: int
    closed_date: str  # YYYY-MM-DDTHH:MM:SSZ — must fall within week_start..week_end
    extracted: bool  # comments_extracted_at IS NOT NULL when True
    threads: tuple[_ThreadSpec, ...]


@dataclass(frozen=True)
class _WeekSpec:
    """One ISO week worth of PRs in the fixture."""

    week_key: str  # e.g. "2026-W02"
    start_date: str  # ISO date — Monday of the week
    end_date: str  # ISO date — Sunday of the week
    prs: tuple[_PrSpec, ...]


# Five weeks covering every reconciliation edge case the spec calls out.
# Counts intentionally varied so a regression that confuses any of them
# (e.g., over-counting tombstones, dropping the active filter) shows up
# in T007's per-week comparison rather than aliasing to a passing total.
#
# Week keys are aligned to the closed_dates' actual ISO weeks: Jan 1 2026
# is a Thursday, so 2026-W01 ends Jan 4 by ISO calendar; the spec dates
# start Jan 5, putting them in W02.
_WEEKS: Final[tuple[_WeekSpec, ...]] = (
    # Week 1: mixed coverage — most extracted, one partial. Exercises the
    # extracted-subset rule + coverage_partial=True.
    _WeekSpec(
        week_key="2026-W02",
        start_date="2026-01-05",
        end_date="2026-01-11",
        prs=(
            _PrSpec(
                pr_id=101,
                closed_date="2026-01-05T10:00:00Z",
                extracted=True,
                threads=(
                    _ThreadSpec(
                        status="active",
                        is_deleted=0,
                        visible_comment_count=2,
                        tombstone_comment_count=0,
                    ),
                    _ThreadSpec(
                        status="fixed",
                        is_deleted=0,
                        visible_comment_count=3,
                        tombstone_comment_count=1,
                    ),
                    _ThreadSpec(
                        status="active",
                        is_deleted=1,
                        visible_comment_count=0,
                        tombstone_comment_count=0,
                    ),
                ),
            ),
            _PrSpec(
                pr_id=102,
                closed_date="2026-01-07T12:00:00Z",
                extracted=True,
                threads=(
                    _ThreadSpec(
                        status="active",
                        is_deleted=0,
                        visible_comment_count=4,
                        tombstone_comment_count=0,
                    ),
                ),
            ),
            _PrSpec(
                pr_id=103,
                closed_date="2026-01-09T08:00:00Z",
                extracted=False,  # 310 partial sentinel; no thread/comment rows
                threads=(),
            ),
            _PrSpec(
                pr_id=104,
                closed_date="2026-01-10T15:00:00Z",
                extracted=True,
                threads=(
                    _ThreadSpec(
                        status="fixed",
                        is_deleted=0,
                        visible_comment_count=1,
                        tombstone_comment_count=0,
                    ),
                ),
            ),
        ),
    ),
    # Week 2: all extracted, no partials. Exercises the
    # coverage_partial=False path with non-zero counts.
    _WeekSpec(
        week_key="2026-W03",
        start_date="2026-01-12",
        end_date="2026-01-18",
        prs=(
            _PrSpec(
                pr_id=201,
                closed_date="2026-01-13T09:00:00Z",
                extracted=True,
                threads=(
                    _ThreadSpec(
                        status="active",
                        is_deleted=0,
                        visible_comment_count=2,
                        tombstone_comment_count=0,
                    ),
                    _ThreadSpec(
                        status="active",
                        is_deleted=0,
                        visible_comment_count=2,
                        tombstone_comment_count=0,
                    ),
                ),
            ),
            _PrSpec(
                pr_id=202,
                closed_date="2026-01-15T14:00:00Z",
                extracted=True,
                threads=(
                    _ThreadSpec(
                        status="fixed",
                        is_deleted=0,
                        visible_comment_count=3,
                        tombstone_comment_count=2,
                    ),
                ),
            ),
        ),
    ),
    # Week 3: all PRs extracted but with zero threads — exercises the
    # FR-2-06 "extracted-but-empty" case (comments_extracted_at non-null
    # AND zero threads/comments → 0/0/0/false, NOT partial).
    _WeekSpec(
        week_key="2026-W04",
        start_date="2026-01-19",
        end_date="2026-01-25",
        prs=(
            _PrSpec(
                pr_id=301,
                closed_date="2026-01-20T11:00:00Z",
                extracted=True,
                threads=(),
            ),
            _PrSpec(
                pr_id=302,
                closed_date="2026-01-22T16:00:00Z",
                extracted=True,
                threads=(),
            ),
        ),
    ),
    # Week 4: all PRs unextracted — exercises FR-2-06 (vi) all-unextracted
    # week (rollup MUST emit comments with all-zero numerics +
    # coverage_partial=true).
    _WeekSpec(
        week_key="2026-W05",
        start_date="2026-01-26",
        end_date="2026-02-01",
        prs=(
            _PrSpec(
                pr_id=401,
                closed_date="2026-01-27T10:00:00Z",
                extracted=False,
                threads=(),
            ),
            _PrSpec(
                pr_id=402,
                closed_date="2026-01-30T12:00:00Z",
                extracted=False,
                threads=(),
            ),
        ),
    ),
    # Week 5: high-volume mix to stress the SUM aggregation +
    # active-vs-resolved split. One PR with many threads, mix of statuses
    # and tombstones, plus a partial PR for coverage_partial=true.
    _WeekSpec(
        week_key="2026-W06",
        start_date="2026-02-02",
        end_date="2026-02-08",
        prs=(
            _PrSpec(
                pr_id=501,
                closed_date="2026-02-03T08:00:00Z",
                extracted=True,
                threads=(
                    _ThreadSpec(
                        status="active",
                        is_deleted=0,
                        visible_comment_count=3,
                        tombstone_comment_count=0,
                    ),
                    _ThreadSpec(
                        status="active",
                        is_deleted=0,
                        visible_comment_count=2,
                        tombstone_comment_count=0,
                    ),
                    _ThreadSpec(
                        status="fixed",
                        is_deleted=0,
                        visible_comment_count=4,
                        tombstone_comment_count=1,
                    ),
                    _ThreadSpec(
                        status="fixed",
                        is_deleted=0,
                        visible_comment_count=2,
                        tombstone_comment_count=0,
                    ),
                    _ThreadSpec(
                        status="unknown",
                        is_deleted=0,
                        visible_comment_count=1,
                        tombstone_comment_count=0,
                    ),
                    _ThreadSpec(
                        status="active",
                        is_deleted=1,
                        visible_comment_count=0,
                        tombstone_comment_count=0,
                    ),
                    _ThreadSpec(
                        status="fixed",
                        is_deleted=1,
                        visible_comment_count=0,
                        tombstone_comment_count=0,
                    ),
                ),
            ),
            _PrSpec(
                pr_id=502,
                closed_date="2026-02-05T13:00:00Z",
                extracted=False,
                threads=(),
            ),
            _PrSpec(
                pr_id=503,
                closed_date="2026-02-07T17:00:00Z",
                extracted=True,
                threads=(
                    _ThreadSpec(
                        status="active",
                        is_deleted=0,
                        visible_comment_count=1,
                        tombstone_comment_count=0,
                    ),
                ),
            ),
        ),
    ),
)


# ---------------------------------------------------------------------------
# Output handle
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SC05Fixture:
    """Paths to a built SC05 fixture (production-aggregator-driven)."""

    sqlite_path: Path
    data_dir: Path
    rollups_dir: Path
    manifest_path: Path
    week_keys: tuple[str, ...]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _pr_uid(pr_id: int) -> str:
    return f"{REPO_ID}-{pr_id}"


def _populate_raw_rows(sqlite_path: Path) -> None:
    """Write every fixture raw row into ``sqlite_path``.

    Uses ``DatabaseManager`` to initialize the production schema (the
    constructor + ``connect()`` runs ``models.SCHEMA_SQL`` for a fresh
    DB, giving every ``_REQUIRED_TABLE``). Then inserts rows in
    FK-safe order: orgs → projects → repos → users → PRs → threads →
    comments.

    All comments are ``comment_type='text'`` so
    ``_backfill_review_timestamps_if_needed`` (cli.py:2089) is a clean
    no-op (it only acts on ``comment_type='system'`` matching the
    vote-parse pattern in extraction/review_time.py).
    """
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    sqlite_path.unlink(missing_ok=True)

    db = DatabaseManager(sqlite_path)
    db.connect()
    try:
        conn = db.connection
        conn.execute(
            "INSERT INTO organizations (organization_name) VALUES (?)",
            (ORG_NAME,),
        )
        conn.execute(
            "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
            (ORG_NAME, PROJECT_NAME),
        )
        conn.execute(
            "INSERT INTO repositories "
            "(repository_id, repository_name, project_name, organization_name) "
            "VALUES (?, ?, ?, ?)",
            (REPO_ID, REPO_NAME, PROJECT_NAME, ORG_NAME),
        )
        conn.execute(
            "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
            (USER_ID, USER_NAME, USER_EMAIL),
        )

        # Feature 334: disable FK enforcement so the first PR of each
        # week can be authored by ``GHOST_USER_ID`` (absent from the
        # ``users`` table) — required to exercise the sentinel-bucket
        # branch of the per-author reconciliation tests
        # (FR-2-03, CL-03).  The PRAGMA is restored to ON before
        # ``build-aggregates`` runs so the production aggregator path
        # encounters the same FK posture it would in production after
        # an out-of-band user deletion.
        conn.execute("PRAGMA foreign_keys = OFF")
        for week in _WEEKS:
            for idx, pr in enumerate(week.prs):
                pr_uid = _pr_uid(pr.pr_id)
                comments_extracted_at = pr.closed_date if pr.extracted else None
                # Route the FIRST PR of each fixture week to the
                # ghost author so every week's per-author bucket dict
                # contains exactly one sentinel-keyed entry — non-vacuous
                # coverage for the sentinel parity assertion.  All other
                # PRs continue to point at ``USER_ID`` so the
                # known-author bucket also exists per week (cross-bucket
                # coverage).
                pr_user_id = GHOST_USER_ID if idx == 0 else USER_ID
                conn.execute(
                    "INSERT INTO pull_requests "
                    "(pull_request_uid, pull_request_id, organization_name, "
                    "project_name, repository_id, user_id, title, status, "
                    "description, creation_date, closed_date, "
                    "cycle_time_minutes, review_time_minutes, "
                    "comments_extracted_at, raw_json) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        pr_uid,
                        pr.pr_id,
                        ORG_NAME,
                        PROJECT_NAME,
                        REPO_ID,
                        pr_user_id,
                        f"PR {pr.pr_id}",
                        "completed",
                        None,
                        "2026-01-01T00:00:00Z",
                        pr.closed_date,
                        100.0 + pr.pr_id,
                        None,
                        comments_extracted_at,
                        None,
                    ),
                )
                for thread_idx, thread in enumerate(pr.threads, start=1):
                    thread_id = f"t{pr.pr_id}-{thread_idx}"
                    conn.execute(
                        "INSERT INTO pr_threads "
                        "(thread_id, pull_request_uid, status, thread_context, "
                        "last_updated, created_at, is_deleted) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (
                            thread_id,
                            pr_uid,
                            thread.status,
                            None,
                            pr.closed_date,
                            pr.closed_date,
                            thread.is_deleted,
                        ),
                    )
                    for c_idx in range(thread.visible_comment_count):
                        comment_id = f"c{pr.pr_id}-{thread_idx}-v{c_idx + 1}"
                        conn.execute(
                            "INSERT INTO pr_comments "
                            "(comment_id, thread_id, pull_request_uid, "
                            "author_id, content, comment_type, created_at, "
                            "last_updated, is_deleted) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            (
                                comment_id,
                                thread_id,
                                pr_uid,
                                USER_ID,
                                f"text comment {c_idx + 1}",
                                "text",
                                pr.closed_date,
                                pr.closed_date,
                                0,
                            ),
                        )
                    for c_idx in range(thread.tombstone_comment_count):
                        comment_id = f"c{pr.pr_id}-{thread_idx}-t{c_idx + 1}"
                        conn.execute(
                            "INSERT INTO pr_comments "
                            "(comment_id, thread_id, pull_request_uid, "
                            "author_id, content, comment_type, created_at, "
                            "last_updated, is_deleted) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            (
                                comment_id,
                                thread_id,
                                pr_uid,
                                USER_ID,
                                f"tombstoned comment {c_idx + 1}",
                                "text",
                                pr.closed_date,
                                pr.closed_date,
                                1,
                            ),
                        )
        # Restore FK enforcement so the production ``build-aggregates``
        # CLI invoked by ``build_fixture`` runs against the same FK
        # posture it would in production.
        conn.execute("PRAGMA foreign_keys = ON")
    finally:
        db.close()


def _invoke_build_aggregates(sqlite_path: Path, data_dir: Path) -> None:
    """Run the production ``build-aggregates`` CLI against ``sqlite_path``.

    Subprocess boundary keeps ``aggregators.py`` out of the test process's
    import graph — this is what preserves T007's round-9 isolation while
    still letting the rollups under test be REAL production output.

    The CLI emits ``data_dir/dataset-manifest.json`` and
    ``data_dir/aggregates/weekly_rollups/*.json``.
    """
    data_dir.mkdir(parents=True, exist_ok=True)
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "ado_git_repo_insights",
            "build-aggregates",
            "--db",
            str(sqlite_path),
            "--out",
            str(data_dir),
            "--run-id",
            "sc05-fixture",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "build-aggregates failed for SC-05 fixture\n"
            f"--- stdout ---\n{completed.stdout}\n"
            f"--- stderr ---\n{completed.stderr}"
        )

    manifest_path = data_dir / "dataset-manifest.json"
    if not manifest_path.exists():
        raise RuntimeError(
            f"build-aggregates returned 0 but did not produce {manifest_path}"
        )
    rollups_dir = data_dir / "aggregates" / "weekly_rollups"
    if not any(rollups_dir.glob("*.json")):
        raise RuntimeError(
            f"build-aggregates produced no weekly rollups under {rollups_dir}"
        )

    # Sanity check: capability MUST be on for SC-05 reconciliation to be
    # meaningful. If the production aggregator decided comments_metrics
    # is False on this fixture, something is wrong with the row spec
    # (e.g., zero pr_threads rows) and the tests would skip out of
    # capability gates — surface the breakage here, not later.
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    capabilities = payload.get("capabilities") or {}
    if not capabilities.get("comments_metrics"):
        raise RuntimeError(
            "SC-05 fixture produced manifest with capabilities.comments_metrics "
            "= False; the production aggregator did not detect the fixture's "
            "pr_threads rows. The reconciliation test would degrade to a "
            "vacuous skip."
        )


def build_fixture(out_dir: Path) -> SC05Fixture:
    """Build the SC05 fixture into ``out_dir``.

    Layout::

        out_dir/
            dataset.sqlite           # raw rows (this module's data spec)
            data/
                dataset-manifest.json          # produced by build-aggregates
                aggregates/
                    dimensions.json            # produced by build-aggregates
                    weekly_rollups/
                        2026-W02.json          # produced by build-aggregates
                        ...
                    distributions/
                        2026.json              # produced by build-aggregates

    Returns a :class:`SC05Fixture` handle pointing at the
    production-generated artifacts.
    """
    out_dir = out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    sqlite_path = out_dir / "dataset.sqlite"
    data_dir = out_dir / "data"

    _populate_raw_rows(sqlite_path)
    _invoke_build_aggregates(sqlite_path, data_dir)

    rollups_dir = data_dir / "aggregates" / "weekly_rollups"
    manifest_path = data_dir / "dataset-manifest.json"
    week_keys = tuple(sorted(p.stem for p in rollups_dir.glob("*.json")))
    return SC05Fixture(
        sqlite_path=sqlite_path,
        data_dir=data_dir,
        rollups_dir=rollups_dir,
        manifest_path=manifest_path,
        week_keys=week_keys,
    )
