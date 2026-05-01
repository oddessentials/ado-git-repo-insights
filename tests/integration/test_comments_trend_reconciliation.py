"""Feature 333 FR-2-04 SC-05 cross-feature reconciliation test.

This module is the executable closure of feature 310's deferred SC-05
cross-feature coherence obligation (310 spec lines 145-146; closed by 333
spec SC-1-05 / INV-1-02). For every week W in the SC-05 fixture, the test
asserts two properties per spec ``FR-2-04`` (a) + (b):

* (a) **Cross-surface coherence on the extracted-subset of the intersection**
  (``FR-2-01`` + round-9 positive-sentinel extension): for every PR P in
  ``rollup[W].prs[]`` AND in W's extracted-subset
  (``pull_requests.comments_extracted_at IS NOT NULL``), the per-PR
  ``thread_count`` / ``comment_count`` / ``active_thread_count`` rendered in
  the drill-down equal an independent re-computation of those values from
  ``pr_threads`` / ``pr_comments``. For PRs in the drill-down slice that are
  unextracted (``comments_extracted_at IS NULL``), the test ALSO positively
  asserts that the drill-down's three numeric fields are 310's per-PR partial
  sentinel (``None``), not zero, not silently absent.
* (b) **End-to-end aggregator correctness via independent re-computation**
  (``FR-2-03``): for every week W, each numeric field of ``rollup[W].comments``
  matches the result of an independent re-computation that determines W's
  canonical throughput PR set via DIRECT SQL against the ``pull_requests``
  table (week-attribution rule re-implemented inline per ADR T003 in
  ``research.md`` Decision 7), filters to W's extracted-subset, applies C1
  inclusion rules from the authoritative site (``specs/310-comments-visualization
  /spec.md`` lines 75-87) directly against ``pr_threads`` / ``pr_comments``,
  sums per-PR contributions, and re-derives ``coverage_partial`` independently.

Authoritative refs:

* Spec FRs: ``specs/333-comments-trend-chart/spec.md`` FR-2-01, FR-2-03, FR-2-04
  (a)/(b), INV-1-02, INV-1-06, INV-1-08, SC-1-05.
* Contract: ``specs/333-comments-trend-chart/contracts/sc05-reconciliation-test.md``
  sections 1, 2.
* C1 inclusion rules (DO NOT re-declare here per INV-1-03):
  ``specs/310-comments-visualization/spec.md`` lines 75-87.

Round-9 isolation rule (load-bearing — enforced structurally by sibling
``test_comments_trend_reconciliation_isolation.py``): this module MUST NOT
import anything from ``src.ado_git_repo_insights.transform.aggregators`` (which
houses BOTH the comments aggregator and the throughput aggregator). All
data-source grounding goes through DIRECT SQL against ``pull_requests``,
``pr_threads``, ``pr_comments``; nothing here calls into either aggregator's
helpers, and the test does NOT read the throughput rollup's ``prs[]`` list as
the source of W's PR set (that would couple reconciliation to throughput's
correctness — round-9 explicitly forbids it).

Fixture (Round 14, revised — production-driven):

The test consumes the session-scoped ``sc05_fixture`` (see
``tests/integration/conftest.py`` / ``tests/fixtures/sc05/fixture_builder.py``).
The fixture writes raw rows into a SQLite using the production schema
(``DatabaseManager``), then shells out to
``python -m ado_git_repo_insights build-aggregates --db <sqlite> --out <data>``
so the rollups + manifest under test are REAL production output of
``aggregators.py::_compute_weekly_comments_aggregate``. The subprocess
boundary keeps ``aggregators.py`` out of T007's import graph (preserving
the round-9 isolation walked by T008). NO env-var-driven discovery, NO
tiered fallback, NO skip-on-missing.

Test floor: +1 Python (single test function; pytest reports per-week failures
via the first-failing-assertion pattern). Floor bump is handled by the parent
session's Phase 2 commit, not this file.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Final, TypedDict

import pandas as pd
import pytest

from ado_git_repo_insights.transform.constants import (
    FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL,
)
from tests.fixtures.sc05.fixture_builder import SC05Fixture


class _CanonicalPrRow(TypedDict):
    """Per-PR row shape returned by ``_attribute_prs_to_weeks``.

    Typed explicitly so downstream callers can pass ``pull_request_id``
    to ``int()`` / ``set()`` operations without mypy widening to ``object``.
    """

    pull_request_uid: str
    pull_request_id: int
    comments_extracted_at: str | None


# --------------------------------------------------------------------------- #
# Independent week-attribution (re-implements throughput's inlined rule)       #
# --------------------------------------------------------------------------- #
#
# Per ADR T003 in ``research.md`` Decision 7, throughput's week-attribution
# rule is inlined inside ``aggregators.py::_generate_weekly_rollups()`` (no
# extracted helper). This test re-implements the SAME formula independently:
#
#     closed_dt   = pd.to_datetime(closed_date)
#     iso_year    = closed_dt.dt.isocalendar().year
#     iso_week    = closed_dt.dt.isocalendar().week
#     week_key    = f"{iso_year}-W{iso_week:02d}"
#
# This is permitted under the round-9 isolation rule — pandas is a third-party
# import, not a re-export of aggregator code. FR-2-03 requires throughput's
# week-attribution and the test's week-attribution to AGREE per-PR, which is
# enforced by a separate parity test (T012). This test independently mirrors
# the formula; T012 catches any drift.

_WEEK_ATTRIBUTION_SQL: Final[str] = (
    "SELECT pull_request_uid, "
    "       pull_request_id, "
    "       closed_date, "
    "       comments_extracted_at "
    "FROM pull_requests "
    "WHERE closed_date IS NOT NULL "
    "  AND status = 'completed' "
    "ORDER BY closed_date"
)


def _attribute_prs_to_weeks(
    db_path: Path,
) -> dict[str, list[_CanonicalPrRow]]:
    """Group PRs by ISO week using throughput's inlined rule (re-implemented).

    Returns a mapping ``week_key -> [_CanonicalPrRow]``. Throughput's ISO-week
    rule is mirrored here independently per ADR T003; FR-2-03's parity test
    (T012) guards against drift.
    """
    with closing(sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)) as conn:
        df = pd.read_sql_query(_WEEK_ATTRIBUTION_SQL, conn)

    if df.empty:
        return {}

    df["closed_dt"] = pd.to_datetime(df["closed_date"])
    df["iso_year"] = df["closed_dt"].dt.isocalendar().year
    df["iso_week"] = df["closed_dt"].dt.isocalendar().week

    result: dict[str, list[_CanonicalPrRow]] = {}
    for (iso_year, iso_week), group in df.groupby(["iso_year", "iso_week"]):
        year_int = int(str(iso_year))
        week_int = int(str(iso_week))
        week_key = f"{year_int}-W{week_int:02d}"
        rows: list[_CanonicalPrRow] = []
        for row in group.itertuples(index=False):
            extracted_raw = row.comments_extracted_at
            # pandas converts SQL NULL to NaN (not None) inside read_sql_query
            # results, so a plain ``is None`` check would silently misclassify
            # unextracted PRs as extracted — pd.isna() handles both.
            extracted: str | None = (
                None if pd.isna(extracted_raw) else str(extracted_raw)
            )
            rows.append(
                _CanonicalPrRow(
                    pull_request_uid=str(row.pull_request_uid),
                    pull_request_id=int(str(row.pull_request_id)),
                    comments_extracted_at=extracted,
                )
            )
        result[week_key] = rows
    return result


# --------------------------------------------------------------------------- #
# Per-PR C1 counts via direct SQL (re-implements C1 from 310 spec lines 75-87) #
# --------------------------------------------------------------------------- #
#
# C1 inclusion rules (DO NOT re-declare in docstring — INV-1-03 forbids it).
# The authoritative site is ``specs/310-comments-visualization/spec.md`` lines
# 75-87. The SQL below encodes those rules directly, NOT via aggregator helpers.
#
# The SQL composition uses ``" ".join([...])`` for any dynamic parts per
# ``reference_s608_refactor_pattern.md``. There are no dynamic parts in these
# specific queries (only literal SQL + parameter placeholders), so no join is
# needed; the queries use ? placeholders for the PR UID input.

_THREAD_COUNTS_SQL: Final[str] = (
    "SELECT "
    "  COUNT(*) AS thread_count, "
    "  SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_thread_count "
    "FROM pr_threads "
    "WHERE pull_request_uid = ? "
    "  AND is_deleted = 0"
)

_COMMENT_COUNT_SQL: Final[str] = (
    "SELECT COUNT(*) AS comment_count "
    "FROM pr_comments "
    "WHERE pull_request_uid = ? "
    "  AND is_deleted = 0"
)

# #356: independent per-PR vote_event_count.  Mirrors the production
# subquery's predicate (``comment_type='system' AND <vote-pattern>``)
# but uses a SQLite GLOB pattern instead of the registered Python UDF
# so this reconciliation re-computation does NOT depend on the
# aggregator's UDF registration — it independently classifies vote
# rows from raw SQL.  GLOB pattern ``"* voted -[0-9]*"`` matches the
# negative-integer suffix; the OR branch covers non-negative.  False
# positives are bounded by the literal ``" voted "`` substring AND the
# digit-only suffix character class, mirroring the
# ``^.+ voted -?\d+$`` semantics of the production regex on real
# fixtures (the ``test_vote_events.py`` parser-equivalence table is
# the authoritative classification contract; this SQL is only used to
# re-derive a totals-level count for reconciliation, where any one-off
# false-positive divergence would surface as a fail-loud assertion).
_VOTE_EVENT_COUNT_SQL: Final[str] = (
    "SELECT COUNT(*) AS vote_event_count "
    "FROM pr_comments "
    "WHERE pull_request_uid = ? "
    "  AND is_deleted = 0 "
    "  AND comment_type = 'system' "
    "  AND ("
    "    content GLOB '* voted [0-9]*' "
    "    OR content GLOB '* voted -[0-9]*'"
    "  )"
)


def _per_pr_counts(
    conn: sqlite3.Connection, pull_request_uid: str
) -> tuple[int, int, int, int]:
    """Independent per-PR ``(thread_count, comment_count, active_thread_count, vote_event_count)``.

    Applies C1 inclusion rules (per ``specs/310-comments-visualization/spec.md``
    lines 75-87) directly against ``pr_threads`` and ``pr_comments`` — no
    aggregator helpers. ``COALESCE``s NULL results from ``SUM(...) OVER an
    empty set`` to 0 so the integer-typed return shape is unconditional.

    #356: also returns ``vote_event_count`` — the additive subset of
    ``comment_count`` over rows where ``comment_type='system'`` and
    content matches the vote-event regex.  Re-derived independently
    from raw SQL via :data:`_VOTE_EVENT_COUNT_SQL` (NOT through the
    aggregator's registered UDF) so the reconciliation surface stays
    independent of the production code path.
    """
    threads_row = conn.execute(_THREAD_COUNTS_SQL, (pull_request_uid,)).fetchone()
    comments_row = conn.execute(_COMMENT_COUNT_SQL, (pull_request_uid,)).fetchone()
    vote_row = conn.execute(_VOTE_EVENT_COUNT_SQL, (pull_request_uid,)).fetchone()

    raw_thread_count = threads_row[0] if threads_row is not None else 0
    raw_active_thread_count = threads_row[1] if threads_row is not None else 0
    raw_comment_count = comments_row[0] if comments_row is not None else 0
    raw_vote_event_count = vote_row[0] if vote_row is not None else 0

    thread_count = int(raw_thread_count if raw_thread_count is not None else 0)
    active_thread_count = int(
        raw_active_thread_count if raw_active_thread_count is not None else 0
    )
    comment_count = int(raw_comment_count if raw_comment_count is not None else 0)
    vote_event_count = int(
        raw_vote_event_count if raw_vote_event_count is not None else 0
    )
    return thread_count, comment_count, active_thread_count, vote_event_count


# --------------------------------------------------------------------------- #
# Rollup loading                                                               #
# --------------------------------------------------------------------------- #


def _load_rollup(rollup_path: Path) -> dict[str, object]:
    payload = json.loads(rollup_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        pytest.fail(
            f"rollup {rollup_path} is not a JSON object (top-level type: "
            f"{type(payload).__name__})"
        )
    return payload


def _drilldown_pr_records(rollup: dict[str, object]) -> list[dict[str, object]]:
    """Return the PR records from ``rollup.prs`` (drill-down PrRecord list)."""
    raw = rollup.get("prs")
    if raw is None:
        return []
    if not isinstance(raw, list):
        pytest.fail(
            f"rollup.prs has unexpected type {type(raw).__name__}; expected list"
        )
    records: list[dict[str, object]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            pytest.fail(f"rollup.prs[] contains non-dict entry {type(entry).__name__}")
        records.append(entry)
    return records


# --------------------------------------------------------------------------- #
# The test                                                                     #
# --------------------------------------------------------------------------- #


def test_sc05_reconciliation_per_week(sc05_fixture: SC05Fixture) -> None:
    """FR-2-04 (a) + (b): every fixture week's ``rollup[W].comments`` matches an
    independent re-computation, and per-PR drill-down values agree with the
    aggregator on the extracted-subset of the intersection.

    Iterates every week W in the SC-05 fixture. Per-week assertions:

    * (a) Cross-surface coherence (FR-2-01 + round-9 positive sentinel):
      For each PR P in ``rollup[W].prs[]``:
        - If P is in W's extracted-subset (``comments_extracted_at IS NOT
          NULL``), the drill-down's ``thread_count`` / ``comment_count`` /
          ``active_thread_count`` MUST equal an independent C1 re-computation
          from ``pr_threads`` / ``pr_comments``.
        - If P is NOT in W's extracted-subset, the drill-down MUST render P
          with all three numeric fields set to ``None`` (310's per-PR partial
          sentinel per INV-10), NOT zero, NOT silently absent.

    * (b) End-to-end aggregator correctness (FR-2-03):
      ``rollup[W].comments`` MUST exist, MUST contain the four atomic fields
      (INV-1-08), and each numeric field MUST equal the sum over W's
      extracted-subset of the per-PR C1 counts; ``coverage_partial`` MUST
      equal ``(|canonical PR set| != |extracted-subset|)``.

    Fixture is built fresh at session start by invoking the production
    ``build-aggregates`` CLI (see ``conftest.py``); no skip paths.
    """
    db_path = sc05_fixture.sqlite_path
    weeks_to_prs = _attribute_prs_to_weeks(db_path)
    rollup_paths = sorted(sc05_fixture.rollups_dir.glob("*.json"))
    assert rollup_paths, (
        f"sc05_fixture has no weekly rollups under {sc05_fixture.rollups_dir}; "
        "fixture builder is broken"
    )

    with closing(sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)) as conn:
        conn.row_factory = sqlite3.Row

        for rollup_path in rollup_paths:
            week_key = rollup_path.stem
            rollup = _load_rollup(rollup_path)

            canonical_prs: list[_CanonicalPrRow] = weeks_to_prs.get(week_key, [])
            extracted_prs: list[_CanonicalPrRow] = [
                pr for pr in canonical_prs if pr["comments_extracted_at"] is not None
            ]

            # ---------------- (b) End-to-end aggregator correctness -------- #
            #
            # The "comments key missing" gate fires before any field-by-field
            # comparison so the TDD failure mode (T011 not yet landed) reports
            # a clean message instead of a confusing KeyError stack.
            assert "comments" in rollup, (
                f"week {week_key}: rollup[W].comments key MISSING. "
                "FR-2-06 requires the aggregator to emit the four-field "
                "comments sub-object on every weekly rollup when "
                "capabilities.comments_metrics is enabled. Until T011 lands "
                "the aggregator emission, this assertion is the TDD failure "
                "mode for the SC-05 reconciliation test."
            )
            comments_obj_raw = rollup["comments"]
            assert isinstance(comments_obj_raw, dict), (
                f"week {week_key}: rollup[W].comments has unexpected type "
                f"{type(comments_obj_raw).__name__}; expected dict per "
                "INV-1-08 atomicity"
            )
            comments_obj: dict[str, object] = comments_obj_raw

            expected_keys = {
                "thread_count",
                "comment_count",
                "active_thread_count",
                # #356: vote_event_count joined the atomic 5-field shape
                # per INV-1-08.  Independent re-computation below proves
                # the rollup-level field equals the sum across W's
                # extracted-subset of per-PR vote-event counts.
                "vote_event_count",
                "coverage_partial",
            }
            assert set(comments_obj.keys()) == expected_keys, (
                f"week {week_key}: rollup[W].comments key set "
                f"{sorted(comments_obj.keys())!r} != expected "
                f"{sorted(expected_keys)!r} (INV-1-08 atomicity violation)"
            )

            expected_thread_count = 0
            expected_comment_count = 0
            expected_active_thread_count = 0
            expected_vote_event_count = 0
            for pr in extracted_prs:
                pr_uid = pr["pull_request_uid"]
                tc, cc, atc, vec = _per_pr_counts(conn, pr_uid)
                expected_thread_count += tc
                expected_comment_count += cc
                expected_active_thread_count += atc
                expected_vote_event_count += vec
            expected_coverage_partial = len(extracted_prs) != len(canonical_prs)

            assert comments_obj["thread_count"] == expected_thread_count, (
                f"week {week_key}: rollup[W].comments.thread_count="
                f"{comments_obj['thread_count']} != independent re-computation "
                f"{expected_thread_count} (sum over W's extracted-subset of "
                f"{len(extracted_prs)} PRs of per-PR C1 thread_count)"
            )
            assert comments_obj["comment_count"] == expected_comment_count, (
                f"week {week_key}: rollup[W].comments.comment_count="
                f"{comments_obj['comment_count']} != independent re-computation "
                f"{expected_comment_count} (sum over W's extracted-subset of "
                f"{len(extracted_prs)} PRs of per-PR C1 comment_count)"
            )
            assert (
                comments_obj["active_thread_count"] == expected_active_thread_count
            ), (
                f"week {week_key}: rollup[W].comments.active_thread_count="
                f"{comments_obj['active_thread_count']} != independent "
                f"re-computation {expected_active_thread_count} (sum over W's "
                f"extracted-subset of {len(extracted_prs)} PRs of per-PR C1 "
                "active_thread_count)"
            )
            assert comments_obj["vote_event_count"] == expected_vote_event_count, (
                f"week {week_key}: rollup[W].comments.vote_event_count="
                f"{comments_obj['vote_event_count']} != independent "
                f"re-computation {expected_vote_event_count} (#356 sum over "
                f"W's extracted-subset of {len(extracted_prs)} PRs of per-PR "
                "vote-pattern system rows)"
            )
            assert comments_obj["coverage_partial"] is expected_coverage_partial, (
                f"week {week_key}: rollup[W].comments.coverage_partial="
                f"{comments_obj['coverage_partial']!r} != independent "
                f"re-computation {expected_coverage_partial!r} "
                f"(|canonical|={len(canonical_prs)}, "
                f"|extracted-subset|={len(extracted_prs)}; partial iff "
                "those differ per FR-2-06 round-7 / FR-2-03)"
            )

            # ---------------- (a) Cross-surface coherence ------------------ #
            #
            # Build a uid lookup so we can map drill-down PR records (keyed by
            # pull_request_id integer) back to pull_request_uid (the SQL key).
            id_to_uid_extracted: dict[int, str] = {
                pr["pull_request_id"]: pr["pull_request_uid"] for pr in extracted_prs
            }
            extracted_id_set: set[int] = set(id_to_uid_extracted.keys())
            canonical_id_set: set[int] = {pr["pull_request_id"] for pr in canonical_prs}

            for record in _drilldown_pr_records(rollup):
                pr_id_raw = record.get("id")
                if not isinstance(pr_id_raw, int):
                    # Skip malformed entries — schema parity gate covers shape.
                    continue
                pr_id = pr_id_raw

                drill_thread = record.get("thread_count")
                drill_comment = record.get("comment_count")
                drill_active = record.get("active_thread_count")

                if pr_id in extracted_id_set:
                    # Pairwise numeric equality on the extracted-subset.
                    pr_uid = id_to_uid_extracted[pr_id]
                    expected_tc, expected_cc, expected_atc, _expected_vec = (
                        _per_pr_counts(conn, pr_uid)
                    )
                    assert drill_thread == expected_tc, (
                        f"week {week_key}, PR id={pr_id}: drill-down "
                        f"thread_count={drill_thread} != independent "
                        f"re-computation {expected_tc} (FR-2-01 cross-surface "
                        "coherence violation on the extracted-subset of the "
                        "intersection)"
                    )
                    assert drill_comment == expected_cc, (
                        f"week {week_key}, PR id={pr_id}: drill-down "
                        f"comment_count={drill_comment} != independent "
                        f"re-computation {expected_cc} (FR-2-01 violation)"
                    )
                    assert drill_active == expected_atc, (
                        f"week {week_key}, PR id={pr_id}: drill-down "
                        f"active_thread_count={drill_active} != independent "
                        f"re-computation {expected_atc} (FR-2-01 violation)"
                    )
                elif pr_id in canonical_id_set:
                    # Round-9 positive sentinel assertion: drill-down MUST
                    # render the per-PR partial sentinel (None) for unextracted
                    # PRs in W's canonical set (310 INV-10), NOT zero, NOT a
                    # number, NOT silently absent.
                    assert drill_thread is None, (
                        f"week {week_key}, PR id={pr_id}: PR is in W's "
                        "canonical throughput set but unextracted "
                        "(comments_extracted_at IS NULL); drill-down "
                        f"thread_count={drill_thread!r} MUST be None per 310 "
                        "INV-10 partial sentinel. Round-9 positive assertion: "
                        "the 'no data / pending' state must surface on the "
                        "drill-down side, not as zero (which would silently "
                        "misrepresent 'no data' as 'no activity')"
                    )
                    assert drill_comment is None, (
                        f"week {week_key}, PR id={pr_id}: drill-down "
                        f"comment_count={drill_comment!r} MUST be None for "
                        "an unextracted PR per 310 INV-10 (round-9 positive "
                        "assertion)"
                    )
                    assert drill_active is None, (
                        f"week {week_key}, PR id={pr_id}: drill-down "
                        f"active_thread_count={drill_active!r} MUST be None "
                        "for an unextracted PR per 310 INV-10 (round-9 "
                        "positive assertion)"
                    )
                # PRs in the drill-down that are NOT in the canonical set at
                # all are out of scope for FR-2-04 (a) — the contract only
                # covers PRs in the drill-down ∩ canonical intersection. No
                # assertion here.


# --------------------------------------------------------------------------- #
# Feature 334 per-author reconciliation                                        #
# --------------------------------------------------------------------------- #
#
# FR-2-01 / FR-2-02 / FR-2-03 (Feature 334): every (W, author_or_sentinel)
# bucket emitted under ``rollup[W].by_author_comments`` MUST match an
# independent re-computation grounded outside ``aggregators.py``.  The
# round-9 isolation rule extends automatically since the import-forbid is
# by-FILE; the helpers here re-implement bucket grouping via direct SQL
# (LEFT JOIN to ``users`` for sentinel detection per FR-1-03 + CL-03) and
# C1 inclusion rules (re-implemented inline per the existing 333 helpers
# above, no aggregator imports).


def _author_bucket_for_uid(
    conn: sqlite3.Connection,
    pull_request_uid: str,
) -> str:
    """Resolve the bucket key for one PR (author_id or sentinel literal).

    Independent of ``aggregators.py``.  LEFT JOIN to ``users`` mirrors
    the producer's resolution rule: PRs whose ``user_id`` is absent
    from the ``users`` table collapse into the single sentinel bucket
    ``FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL`` (CL-03 + FR-1-03).  A
    NULL ``user_id`` on the PR row is treated as unknown-to-``users``
    (also collapses into the sentinel bucket) — the same behavior the
    aggregator's ``CASE WHEN u.user_id IS NULL`` produces.
    """
    cursor = conn.execute(
        "SELECT pr.user_id, u.user_id AS users_match "
        "FROM pull_requests pr "
        "LEFT JOIN users u ON u.user_id = pr.user_id "
        "WHERE pr.pull_request_uid = ?",
        (pull_request_uid,),
    )
    row = cursor.fetchone()
    if row is None:
        return FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL
    if row["users_match"] is None:
        return FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL
    return str(row["user_id"])


class _ExpectedBucket(TypedDict):
    """Independent re-computation result for one (W, author_or_sentinel) bucket."""

    thread_count: int
    comment_count: int
    active_thread_count: int
    coverage_partial: bool


def _build_expected_buckets(
    conn: sqlite3.Connection,
    canonical_prs: list[_CanonicalPrRow],
) -> dict[str, _ExpectedBucket]:
    """Independent re-computation of one week's per-author bucket emissions.

    Groups ``canonical_prs`` by resolved bucket key (author_id or
    sentinel) via direct SQL on each PR's ``user_id`` LEFT JOIN
    ``users``.  For each bucket: filters to extracted-subset (PRs
    with ``comments_extracted_at IS NOT NULL``), sums per-PR C1
    counts via ``_per_pr_counts``, derives ``coverage_partial`` as
    ``(any PR in the bucket has comments_extracted_at IS NULL)``.

    Buckets with empty extracted-subset still emit (numeric=0, but
    ``coverage_partial = True`` since by definition all the bucket's
    PRs are unextracted — every author with any canonical PR gets a
    bucket regardless of extraction state).
    """
    grouped: dict[str, list[_CanonicalPrRow]] = {}
    for pr in canonical_prs:
        bucket = _author_bucket_for_uid(conn, pr["pull_request_uid"])
        grouped.setdefault(bucket, []).append(pr)

    expected: dict[str, _ExpectedBucket] = {}
    for bucket, prs in grouped.items():
        thread_count = 0
        comment_count = 0
        active_thread_count = 0
        any_unextracted = False
        for pr in prs:
            if pr["comments_extracted_at"] is None:
                any_unextracted = True
                continue
            tc, cc, atc, _vec = _per_pr_counts(conn, pr["pull_request_uid"])
            thread_count += tc
            comment_count += cc
            active_thread_count += atc
        expected[bucket] = _ExpectedBucket(
            thread_count=thread_count,
            comment_count=comment_count,
            active_thread_count=active_thread_count,
            coverage_partial=any_unextracted,
        )
    return expected


def _by_author_comments_dict(
    rollup: dict[str, object],
    week_key: str,
) -> dict[str, dict[str, object]]:
    """Return ``rollup[W].by_author_comments`` validated as a dict-of-dicts.

    Fails the test with a clear message rather than a confusing type
    error when the producer has not yet emitted the key (TDD failure
    mode for the per-author reconciliation tests).
    """
    raw = rollup.get("by_author_comments")
    assert raw is not None, (
        f"week {week_key}: rollup[W].by_author_comments key MISSING. "
        "FR-1-01 requires the aggregator to emit the per-author bucket "
        "outer dict on every weekly rollup when "
        "capabilities.comments_metrics is enabled and the canonical set "
        "is non-empty.  Until Feature 334's aggregator emission lands, "
        "this assertion is the TDD failure mode for the per-author "
        "reconciliation tests."
    )
    assert isinstance(raw, dict), (
        f"week {week_key}: rollup[W].by_author_comments has unexpected "
        f"type {type(raw).__name__}; expected dict per INV-2-08 atomicity"
    )
    typed: dict[str, dict[str, object]] = {}
    for key, entry in raw.items():
        assert isinstance(entry, dict), (
            f"week {week_key}: by_author_comments[{key!r}] has unexpected "
            f"type {type(entry).__name__}; expected 4-field dict"
        )
        typed[str(key)] = entry
    return typed


def test_sc05_reconciliation_per_week_by_author_independent(
    sc05_fixture: SC05Fixture,
) -> None:
    """FR-2-02 (Feature 334): per-(W, bucket) independent re-computation parity.

    For every week W and every bucket key in ``rollup[W].by_author_comments``,
    the four atomic fields MUST equal the result of an independent
    re-computation that:

    1. Determines W's canonical throughput PR set via direct SQL against
       ``pull_requests`` (re-implemented week-attribution rule per ADR T005).
    2. Groups each PR by resolved bucket key (author_id or sentinel)
       via LEFT JOIN to ``users``.
    3. Filters each bucket's PRs to W's extracted-subset.
    4. Sums per-PR C1 counts (``_per_pr_counts``).
    5. Derives ``coverage_partial`` per bucket as
       ``(∃ PR in bucket with comments_extracted_at IS NULL)``.

    Round-9 isolation: helpers re-implement everything inline; no
    imports from ``aggregators.py``.  The sentinel literal is imported
    from ``transform.constants`` (a non-aggregator module).
    """
    db_path = sc05_fixture.sqlite_path
    weeks_to_prs = _attribute_prs_to_weeks(db_path)
    rollup_paths = sorted(sc05_fixture.rollups_dir.glob("*.json"))
    assert rollup_paths, (
        f"sc05_fixture has no weekly rollups under {sc05_fixture.rollups_dir}; "
        "fixture builder is broken"
    )

    with closing(sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)) as conn:
        conn.row_factory = sqlite3.Row

        for rollup_path in rollup_paths:
            week_key = rollup_path.stem
            rollup = _load_rollup(rollup_path)
            canonical_prs = weeks_to_prs.get(week_key, [])
            if not canonical_prs:
                # Week with no canonical PRs — producer omits the key
                # entirely (FR-3-03 omission contract).
                assert "by_author_comments" not in rollup, (
                    f"week {week_key}: rollup has empty canonical PR set "
                    "but emits a non-omitted by_author_comments key"
                )
                continue

            buckets_emitted = _by_author_comments_dict(rollup, week_key)
            expected_buckets = _build_expected_buckets(conn, canonical_prs)

            assert set(buckets_emitted.keys()) == set(expected_buckets.keys()), (
                f"week {week_key}: by_author_comments key set "
                f"{sorted(buckets_emitted.keys())!r} != independent "
                f"re-computation {sorted(expected_buckets.keys())!r} "
                "(FR-1-03 + FR-2-02: every author/sentinel with a canonical "
                "PR in W MUST appear in the bucket dict)"
            )

            for bucket_key, emitted in buckets_emitted.items():
                expected = expected_buckets[bucket_key]
                assert emitted["thread_count"] == expected["thread_count"], (
                    f"week {week_key}, bucket {bucket_key!r}: thread_count="
                    f"{emitted['thread_count']!r} != independent re-computation "
                    f"{expected['thread_count']} (FR-2-02 violation)"
                )
                assert emitted["comment_count"] == expected["comment_count"], (
                    f"week {week_key}, bucket {bucket_key!r}: comment_count="
                    f"{emitted['comment_count']!r} != independent re-computation "
                    f"{expected['comment_count']} (FR-2-02 violation)"
                )
                assert (
                    emitted["active_thread_count"] == expected["active_thread_count"]
                ), (
                    f"week {week_key}, bucket {bucket_key!r}: "
                    f"active_thread_count={emitted['active_thread_count']!r} != "
                    f"independent re-computation {expected['active_thread_count']} "
                    "(FR-2-02 violation)"
                )
                assert emitted["coverage_partial"] is expected["coverage_partial"], (
                    f"week {week_key}, bucket {bucket_key!r}: coverage_partial="
                    f"{emitted['coverage_partial']!r} != independent re-computation "
                    f"{expected['coverage_partial']!r} (FR-1-06: True iff at least "
                    "one PR in the bucket's canonical set has "
                    "comments_extracted_at IS NULL)"
                )


def test_sc05_reconciliation_per_week_by_author_sentinel_parity(
    sc05_fixture: SC05Fixture,
) -> None:
    """FR-2-03 (Feature 334): sentinel bucket aggregates ALL unknown-to-users PRs.

    For each week W, if ``rollup[W].by_author_comments`` carries an entry
    keyed by the reserved sentinel literal, that entry's metrics MUST
    equal the SUM of contributions from ALL PRs in W's canonical set
    whose ``user_id`` is absent from the ``users`` table.  If zero such
    PRs exist for W, the sentinel bucket MUST NOT be emitted for W.
    """
    db_path = sc05_fixture.sqlite_path
    weeks_to_prs = _attribute_prs_to_weeks(db_path)
    rollup_paths = sorted(sc05_fixture.rollups_dir.glob("*.json"))

    # Non-vacuity tripwire: tally how many unknown-author PRs the test
    # actually saw across all weeks.  Zero means the fixture has no
    # ghost-author PRs and the sentinel-value-parity branch is never
    # exercised — the test would pass vacuously and the contract
    # surface would silently rot.  Asserted at the end of the loop.
    total_unknown_prs_seen = 0

    with closing(sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)) as conn:
        conn.row_factory = sqlite3.Row

        for rollup_path in rollup_paths:
            week_key = rollup_path.stem
            rollup = _load_rollup(rollup_path)
            canonical_prs = weeks_to_prs.get(week_key, [])

            unknown_prs: list[_CanonicalPrRow] = [
                pr
                for pr in canonical_prs
                if _author_bucket_for_uid(conn, pr["pull_request_uid"])
                == FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL
            ]

            buckets_raw = rollup.get("by_author_comments")
            sentinel_emitted: dict[str, object] | None
            if isinstance(buckets_raw, dict):
                raw_entry = buckets_raw.get(FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL)
                sentinel_emitted = raw_entry if isinstance(raw_entry, dict) else None
            else:
                sentinel_emitted = None

            if not unknown_prs:
                assert sentinel_emitted is None, (
                    f"week {week_key}: zero unknown-to-users PRs in canonical "
                    "set but sentinel bucket "
                    f"{FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL!r} is emitted "
                    "(FR-2-03 + CL-03: sentinel MUST NOT be emitted when no "
                    "unknown-author PRs exist for W)"
                )
                continue

            assert sentinel_emitted is not None, (
                f"week {week_key}: {len(unknown_prs)} unknown-to-users PRs "
                "in canonical set but sentinel bucket "
                f"{FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL!r} is missing from "
                "rollup[W].by_author_comments (FR-2-03 violation)"
            )

            expected_thread = 0
            expected_comment = 0
            expected_active = 0
            any_unextracted = False
            for pr in unknown_prs:
                if pr["comments_extracted_at"] is None:
                    any_unextracted = True
                    continue
                tc, cc, atc, _vec = _per_pr_counts(conn, pr["pull_request_uid"])
                expected_thread += tc
                expected_comment += cc
                expected_active += atc

            assert sentinel_emitted["thread_count"] == expected_thread, (
                f"week {week_key}: sentinel bucket thread_count="
                f"{sentinel_emitted['thread_count']!r} != independent SUM "
                f"{expected_thread} over {len(unknown_prs)} unknown-author PRs "
                "(FR-2-03)"
            )
            assert sentinel_emitted["comment_count"] == expected_comment, (
                f"week {week_key}: sentinel bucket comment_count="
                f"{sentinel_emitted['comment_count']!r} != independent SUM "
                f"{expected_comment} (FR-2-03)"
            )
            assert sentinel_emitted["active_thread_count"] == expected_active, (
                f"week {week_key}: sentinel bucket active_thread_count="
                f"{sentinel_emitted['active_thread_count']!r} != independent "
                f"SUM {expected_active} (FR-2-03)"
            )
            assert sentinel_emitted["coverage_partial"] is any_unextracted, (
                f"week {week_key}: sentinel bucket coverage_partial="
                f"{sentinel_emitted['coverage_partial']!r} != independent "
                f"re-computation {any_unextracted!r} (FR-1-06 propagated "
                "to sentinel bucket)"
            )
            total_unknown_prs_seen += len(unknown_prs)

    assert total_unknown_prs_seen > 0, (
        "Vacuity guard: zero unknown-to-users PRs across every fixture "
        "week, so the sentinel-value-parity branch above never fired.  "
        "The fixture builder MUST seed at least one ghost-author PR "
        "(see GHOST_USER_ID in tests/fixtures/sc05/fixture_builder.py) "
        "so this test exercises FR-2-03's hot path on real demo data."
    )


def test_sc05_reconciliation_per_week_by_author_pairwise_drilldown(
    sc05_fixture: SC05Fixture,
) -> None:
    """FR-2-01 (Feature 334): drill-down ∩ extracted-subset PRs map to a bucket.

    For every PR P in ``rollup[W].prs`` AND in W's extracted-subset, P's
    resolved bucket key MUST exist in ``rollup[W].by_author_comments``,
    and P's drill-down per-PR values MUST equal an independent C1
    re-computation (the value-equality side; the existing 333 test
    covers this for ``rollup[W].comments`` — this test extends the
    cross-surface coherence check to the per-author surface).
    """
    db_path = sc05_fixture.sqlite_path
    weeks_to_prs = _attribute_prs_to_weeks(db_path)
    rollup_paths = sorted(sc05_fixture.rollups_dir.glob("*.json"))

    with closing(sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)) as conn:
        conn.row_factory = sqlite3.Row

        for rollup_path in rollup_paths:
            week_key = rollup_path.stem
            rollup = _load_rollup(rollup_path)
            canonical_prs = weeks_to_prs.get(week_key, [])
            extracted_prs = [
                pr for pr in canonical_prs if pr["comments_extracted_at"] is not None
            ]
            if not canonical_prs:
                continue

            buckets_emitted = _by_author_comments_dict(rollup, week_key)
            id_to_uid_extracted: dict[int, str] = {
                pr["pull_request_id"]: pr["pull_request_uid"] for pr in extracted_prs
            }

            for record in _drilldown_pr_records(rollup):
                pr_id_raw = record.get("id")
                if not isinstance(pr_id_raw, int):
                    continue
                pr_id = pr_id_raw
                if pr_id not in id_to_uid_extracted:
                    # Unextracted drill-down PRs are out of scope — covered
                    # by the existing 333 reconciliation test for the
                    # round-9 positive sentinel.
                    continue

                pr_uid = id_to_uid_extracted[pr_id]
                bucket_key = _author_bucket_for_uid(conn, pr_uid)
                assert bucket_key in buckets_emitted, (
                    f"week {week_key}, PR id={pr_id}: resolved bucket "
                    f"{bucket_key!r} is missing from "
                    f"rollup[W].by_author_comments (FR-2-01: every "
                    "drill-down ∩ extracted-subset PR's author MUST have "
                    "a bucket emission)"
                )

                expected_tc, expected_cc, expected_atc, _expected_vec = _per_pr_counts(
                    conn, pr_uid
                )
                drill_thread = record.get("thread_count")
                drill_comment = record.get("comment_count")
                drill_active = record.get("active_thread_count")
                assert drill_thread == expected_tc, (
                    f"week {week_key}, PR id={pr_id}: drill-down thread_count="
                    f"{drill_thread!r} != independent re-computation "
                    f"{expected_tc} (FR-2-01: per-author surface coherence)"
                )
                assert drill_comment == expected_cc, (
                    f"week {week_key}, PR id={pr_id}: drill-down comment_count="
                    f"{drill_comment!r} != independent re-computation "
                    f"{expected_cc} (FR-2-01)"
                )
                assert drill_active == expected_atc, (
                    f"week {week_key}, PR id={pr_id}: drill-down "
                    f"active_thread_count={drill_active!r} != independent "
                    f"re-computation {expected_atc} (FR-2-01)"
                )


# --------------------------------------------------------------------------- #
# Feature 335 per-repo reconciliation extensions                              #
# --------------------------------------------------------------------------- #
#
# Mirrors the 334 per-author block above with three changes per CL-03 / CL-04:
#
# - Bucket key is ``pr.repository_id`` directly — NO LEFT JOIN to a users-style
#   table; the FK constraint at ``models.py:88``
#   (``pull_requests.repository_id REFERENCES repositories(repository_id)``)
#   guarantees every emitted ``repository_id`` corresponds to a row in
#   ``repositories``.  No sentinel literal exists for the per-repo dimension
#   (INV-3-12).
# - There is NO sentinel-parity test — the 334 sentinel-parity test (T009 (c) /
#   ``test_sc05_reconciliation_per_week_by_author_sentinel_parity``) does not
#   apply.  Instead this block adds a NEW cross-aggregate sum-coherence test
#   (FR-2-03) that closes the deferred 333 / 334 cross-aggregate parity
#   obligation on truncated weeks.
# - Round-9 isolation: same posture — re-implement everything inline; no
#   imports from ``aggregators.py``.


def _repo_bucket_for_uid(
    conn: sqlite3.Connection,
    pull_request_uid: str,
) -> str:
    """Resolve the per-repo bucket key for one PR — its raw ``repository_id``.

    Independent of ``aggregators.py``.  Per CL-03 / FR-1-03 / INV-3-12,
    the per-repo dimension uses the PR's ``repository_id`` value directly
    as the bucket key — there is no sentinel branch and no LEFT JOIN to
    the ``repositories`` table because the FK constraint at
    ``models.py:88`` makes unknown-to-``repositories`` IDs impossible in
    well-formed production data.
    """
    cursor = conn.execute(
        "SELECT pr.repository_id FROM pull_requests pr WHERE pr.pull_request_uid = ?",
        (pull_request_uid,),
    )
    row = cursor.fetchone()
    assert row is not None, (
        f"pull_request_uid={pull_request_uid!r}: row not found in "
        "pull_requests table when independently resolving repository_id "
        "for the per-repo reconciliation test (fixture builder bug)"
    )
    repo_id = row["repository_id"]
    assert isinstance(repo_id, str), (
        f"pull_request_uid={pull_request_uid!r}: repository_id is "
        f"{repo_id!r} (expected string per FK constraint at models.py:88)"
    )
    assert repo_id, (
        f"pull_request_uid={pull_request_uid!r}: repository_id is the "
        "empty string (expected non-empty per NOT NULL constraint at "
        "models.py:88)"
    )
    return repo_id


def _build_expected_repo_buckets(
    conn: sqlite3.Connection,
    canonical_prs: list[_CanonicalPrRow],
) -> dict[str, _ExpectedBucket]:
    """Independent re-computation of one week's per-repo bucket emissions.

    Mirrors ``_build_expected_buckets`` (per-author) but groups by
    ``pr.repository_id`` directly.  No sentinel resolution branch.
    """
    grouped: dict[str, list[_CanonicalPrRow]] = {}
    for pr in canonical_prs:
        bucket = _repo_bucket_for_uid(conn, pr["pull_request_uid"])
        grouped.setdefault(bucket, []).append(pr)

    expected: dict[str, _ExpectedBucket] = {}
    for bucket, prs in grouped.items():
        thread_count = 0
        comment_count = 0
        active_thread_count = 0
        any_unextracted = False
        for pr in prs:
            if pr["comments_extracted_at"] is None:
                any_unextracted = True
                continue
            tc, cc, atc, _vec = _per_pr_counts(conn, pr["pull_request_uid"])
            thread_count += tc
            comment_count += cc
            active_thread_count += atc
        expected[bucket] = _ExpectedBucket(
            thread_count=thread_count,
            comment_count=comment_count,
            active_thread_count=active_thread_count,
            coverage_partial=any_unextracted,
        )
    return expected


def _by_repository_comments_dict(
    rollup: dict[str, object],
    week_key: str,
) -> dict[str, dict[str, object]]:
    """Return ``rollup[W].by_repository_comments`` validated as dict-of-dicts.

    Fails with a clear TDD-mode message when the producer has not yet
    emitted the key (Phase 2.2 ``T011`` aggregator emission gating).
    """
    raw = rollup.get("by_repository_comments")
    assert raw is not None, (
        f"week {week_key}: rollup[W].by_repository_comments key MISSING. "
        "FR-1-01 requires the aggregator to emit the per-repo bucket "
        "outer dict on every weekly rollup when "
        "capabilities.comments_metrics is enabled and the canonical set "
        "is non-empty.  Until Feature 335's aggregator emission lands, "
        "this assertion is the TDD failure mode for the per-repo "
        "reconciliation tests."
    )
    assert isinstance(raw, dict), (
        f"week {week_key}: rollup[W].by_repository_comments has unexpected "
        f"type {type(raw).__name__}; expected dict per INV-3-08 atomicity"
    )
    typed: dict[str, dict[str, object]] = {}
    for key, entry in raw.items():
        assert isinstance(entry, dict), (
            f"week {week_key}: by_repository_comments[{key!r}] has unexpected "
            f"type {type(entry).__name__}; expected 4-field dict"
        )
        typed[str(key)] = entry
    return typed


def test_sc05_reconciliation_per_week_by_repository_independent(
    sc05_fixture: SC05Fixture,
) -> None:
    """FR-2-02 (Feature 335): per-(W, repo) independent re-computation parity.

    For every week W and every bucket key in
    ``rollup[W].by_repository_comments``, the four atomic fields MUST
    equal the result of an independent re-computation that:

    1. Determines W's canonical throughput PR set via direct SQL against
       ``pull_requests`` (re-implemented week-attribution rule).
    2. Groups each PR by ``pull_requests.repository_id`` (raw FK-
       protected value; no sentinel).
    3. Filters each bucket's PRs to W's extracted-subset.
    4. Sums per-PR C1 counts.
    5. Derives ``coverage_partial`` per bucket as
       ``(∃ PR in bucket with comments_extracted_at IS NULL)``.
    """
    db_path = sc05_fixture.sqlite_path
    weeks_to_prs = _attribute_prs_to_weeks(db_path)
    rollup_paths = sorted(sc05_fixture.rollups_dir.glob("*.json"))
    assert rollup_paths, (
        f"sc05_fixture has no weekly rollups under {sc05_fixture.rollups_dir}; "
        "fixture builder is broken"
    )

    with closing(sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)) as conn:
        conn.row_factory = sqlite3.Row

        for rollup_path in rollup_paths:
            week_key = rollup_path.stem
            rollup = _load_rollup(rollup_path)
            canonical_prs = weeks_to_prs.get(week_key, [])
            if not canonical_prs:
                # FR-1-10 omission contract: empty canonical set → key absent.
                assert "by_repository_comments" not in rollup, (
                    f"week {week_key}: rollup has empty canonical PR set "
                    "but emits a non-omitted by_repository_comments key"
                )
                continue

            buckets_emitted = _by_repository_comments_dict(rollup, week_key)
            expected_buckets = _build_expected_repo_buckets(conn, canonical_prs)

            assert set(buckets_emitted.keys()) == set(expected_buckets.keys()), (
                f"week {week_key}: by_repository_comments key set "
                f"{sorted(buckets_emitted.keys())!r} != independent "
                f"re-computation {sorted(expected_buckets.keys())!r} "
                "(FR-1-03 + FR-2-02: every repository with a canonical PR "
                "in W MUST appear in the bucket dict)"
            )

            for bucket_key, emitted in buckets_emitted.items():
                expected = expected_buckets[bucket_key]
                assert emitted["thread_count"] == expected["thread_count"], (
                    f"week {week_key}, repo {bucket_key!r}: thread_count="
                    f"{emitted['thread_count']!r} != independent re-computation "
                    f"{expected['thread_count']} (FR-2-02 violation)"
                )
                assert emitted["comment_count"] == expected["comment_count"], (
                    f"week {week_key}, repo {bucket_key!r}: comment_count="
                    f"{emitted['comment_count']!r} != independent re-computation "
                    f"{expected['comment_count']} (FR-2-02 violation)"
                )
                assert (
                    emitted["active_thread_count"] == expected["active_thread_count"]
                ), (
                    f"week {week_key}, repo {bucket_key!r}: "
                    f"active_thread_count={emitted['active_thread_count']!r} != "
                    f"independent re-computation {expected['active_thread_count']} "
                    "(FR-2-02 violation)"
                )
                assert emitted["coverage_partial"] is expected["coverage_partial"], (
                    f"week {week_key}, repo {bucket_key!r}: coverage_partial="
                    f"{emitted['coverage_partial']!r} != independent re-computation "
                    f"{expected['coverage_partial']!r} (FR-1-06 propagated to "
                    "per-repo bucket)"
                )


def test_sc05_reconciliation_per_week_by_repository_pairwise_drilldown(
    sc05_fixture: SC05Fixture,
) -> None:
    """FR-2-01 (Feature 335): drill-down ∩ extracted-subset PRs map to a bucket.

    For every PR P in ``rollup[W].prs`` AND in W's extracted-subset, P's
    resolved repository_id MUST exist as a key in
    ``rollup[W].by_repository_comments``, and P's drill-down per-PR
    values MUST equal an independent C1 re-computation.
    """
    db_path = sc05_fixture.sqlite_path
    weeks_to_prs = _attribute_prs_to_weeks(db_path)
    rollup_paths = sorted(sc05_fixture.rollups_dir.glob("*.json"))

    with closing(sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)) as conn:
        conn.row_factory = sqlite3.Row

        for rollup_path in rollup_paths:
            week_key = rollup_path.stem
            rollup = _load_rollup(rollup_path)
            canonical_prs = weeks_to_prs.get(week_key, [])
            extracted_prs = [
                pr for pr in canonical_prs if pr["comments_extracted_at"] is not None
            ]
            if not canonical_prs:
                continue

            buckets_emitted = _by_repository_comments_dict(rollup, week_key)
            id_to_uid_extracted: dict[int, str] = {
                pr["pull_request_id"]: pr["pull_request_uid"] for pr in extracted_prs
            }

            for record in _drilldown_pr_records(rollup):
                pr_id_raw = record.get("id")
                if not isinstance(pr_id_raw, int):
                    continue
                pr_id = pr_id_raw
                if pr_id not in id_to_uid_extracted:
                    # Unextracted drill-down PRs covered by 333's per-PR
                    # round-9 positive sentinel test.
                    continue

                pr_uid = id_to_uid_extracted[pr_id]
                bucket_key = _repo_bucket_for_uid(conn, pr_uid)
                assert bucket_key in buckets_emitted, (
                    f"week {week_key}, PR id={pr_id}: resolved repository "
                    f"{bucket_key!r} is missing from "
                    "rollup[W].by_repository_comments (FR-2-01: every "
                    "drill-down ∩ extracted-subset PR's repository MUST "
                    "have a bucket emission)"
                )

                expected_tc, expected_cc, expected_atc, _expected_vec = _per_pr_counts(
                    conn, pr_uid
                )
                drill_thread = record.get("thread_count")
                drill_comment = record.get("comment_count")
                drill_active = record.get("active_thread_count")
                assert drill_thread == expected_tc, (
                    f"week {week_key}, PR id={pr_id}: drill-down thread_count="
                    f"{drill_thread!r} != independent re-computation "
                    f"{expected_tc} (FR-2-01: per-repo surface coherence)"
                )
                assert drill_comment == expected_cc, (
                    f"week {week_key}, PR id={pr_id}: drill-down comment_count="
                    f"{drill_comment!r} != independent re-computation "
                    f"{expected_cc} (FR-2-01)"
                )
                assert drill_active == expected_atc, (
                    f"week {week_key}, PR id={pr_id}: drill-down "
                    f"active_thread_count={drill_active!r} != independent "
                    f"re-computation {expected_atc} (FR-2-01)"
                )


def test_sc05_reconciliation_cross_aggregate_sum_coherence(
    sc05_fixture: SC05Fixture,
) -> None:
    """FR-2-03 (Feature 335 NEW): cross-aggregate sum-coherence between
    ``rollup[W].comments`` (333) and ``rollup[W].by_repository_comments``
    (this feature).

    For every week W where both aggregates are emitted (non-empty), the
    SUM over all repositories of each numeric field MUST equal
    ``comments.<numeric_field>``, AND the OR over all repositories of
    ``coverage_partial`` MUST equal ``comments.coverage_partial``.

    Both aggregates compute over W's full canonical extracted-subset
    (333 FR-2-03 / 334 INV-2-10 / 335 INV-3-10 propagation), so the
    contract holds even on truncated weeks where the per-PR drill-down
    ``prs`` field is capped (310 INV-02).  The truncated W26 demo
    fixture is the most-interesting witness; the assertion is week-
    agnostic so it survives demo regeneration if truncation shifts to a
    different week.

    Pre-loop fixture-validation guard (G3 from /speckit.analyze): asserts
    at least ONE week W in the demo dataset satisfies "both ``comments``
    AND ``by_repository_comments`` are emitted (non-empty)".  Without
    this guard, a demo regeneration that breaks the witness condition
    would let the loop iterate zero applicable weeks and silently pass —
    no positive control.  A-11 documents the spec-level assumption this
    guard enforces.
    """
    rollup_paths = sorted(sc05_fixture.rollups_dir.glob("*.json"))
    assert rollup_paths, (
        f"sc05_fixture has no weekly rollups under {sc05_fixture.rollups_dir}"
    )

    # Pre-loop fixture-validation guard (G3 / A-11).
    applicable_weeks: list[str] = []
    for rollup_path in rollup_paths:
        rollup = _load_rollup(rollup_path)
        comments_obj = rollup.get("comments")
        by_repo = rollup.get("by_repository_comments")
        if (
            isinstance(comments_obj, dict)
            and isinstance(by_repo, dict)
            and len(by_repo) > 0
        ):
            applicable_weeks.append(rollup_path.stem)
    assert applicable_weeks, (
        "FR-2-03 fixture-validation guard (G3 / A-11): no week W in the "
        "SC-05 demo fixture has BOTH ``rollup[W].comments`` AND "
        "``rollup[W].by_repository_comments`` emitted (non-empty).  The "
        "sum-coherence loop below would iterate zero weeks and silently "
        "pass — no positive control.  This means the demo regeneration "
        "has shifted past the assertion's domain (e.g., the truncated W26 "
        "witness was lost, or capability-on emission has regressed).  "
        "A-11 documents the spec-level assumption this guard enforces."
    )

    # Sum-coherence loop: assert per-week SUM equality for every applicable
    # week.  Iterates ALL applicable weeks, not just truncated ones — the
    # contract holds equally on non-truncated weeks (the truncated weeks
    # are the most-interesting witness, but the assertion's domain is
    # broader per ADR R002).
    for rollup_path in rollup_paths:
        week_key = rollup_path.stem
        rollup = _load_rollup(rollup_path)
        comments_obj = rollup.get("comments")
        by_repo = rollup.get("by_repository_comments")
        if not isinstance(comments_obj, dict) or not isinstance(by_repo, dict):
            continue
        if len(by_repo) == 0:
            continue

        sum_thread = 0
        sum_comment = 0
        sum_active = 0
        any_partial = False
        for repo_key, entry in by_repo.items():
            if not isinstance(entry, dict):
                continue
            tc = entry.get("thread_count")
            cc = entry.get("comment_count")
            atc = entry.get("active_thread_count")
            cp = entry.get("coverage_partial")
            assert isinstance(tc, int), (
                f"week {week_key}, repo {repo_key!r}: non-integer thread_count {tc!r}"
            )
            assert isinstance(cc, int), (
                f"week {week_key}, repo {repo_key!r}: non-integer comment_count {cc!r}"
            )
            assert isinstance(atc, int), (
                f"week {week_key}, repo {repo_key!r}: non-integer "
                f"active_thread_count {atc!r}"
            )
            assert isinstance(cp, bool), (
                f"week {week_key}, repo {repo_key!r}: non-boolean "
                f"coverage_partial {cp!r}"
            )
            sum_thread += tc
            sum_comment += cc
            sum_active += atc
            any_partial = any_partial or cp

        c_thread = comments_obj.get("thread_count")
        c_comment = comments_obj.get("comment_count")
        c_active = comments_obj.get("active_thread_count")
        c_partial = comments_obj.get("coverage_partial")
        assert sum_thread == c_thread, (
            f"week {week_key}: SUM_repo by_repository_comments[r].thread_count="
            f"{sum_thread} != comments.thread_count={c_thread!r} "
            "(FR-2-03 cross-aggregate sum-coherence violation: per-repo "
            "and per-week aggregates disagree on the same set's numeric "
            "thread total — possible truncation-vs-full-set scope drift "
            "or an aggregator regression)"
        )
        assert sum_comment == c_comment, (
            f"week {week_key}: SUM_repo by_repository_comments[r].comment_count="
            f"{sum_comment} != comments.comment_count={c_comment!r} "
            "(FR-2-03)"
        )
        assert sum_active == c_active, (
            f"week {week_key}: SUM_repo by_repository_comments[r].active_thread_count="
            f"{sum_active} != comments.active_thread_count={c_active!r} "
            "(FR-2-03)"
        )
        assert any_partial == c_partial, (
            f"week {week_key}: OR_repo by_repository_comments[r].coverage_partial="
            f"{any_partial!r} != comments.coverage_partial={c_partial!r} "
            "(FR-2-03 OR-coherence: any per-repo bucket marked partial "
            "should equal the per-week aggregate's partial flag)"
        )


# --------------------------------------------------------------------------- #
# Feature 336 per-reviewer reconciliation extensions                           #
# --------------------------------------------------------------------------- #
#
# Mirrors the 334 per-author block at lines 462-857 with three substantive
# divergences per CL-04 / CL-10 / CL-12:
#
# - Iteration unit is ``pr_comments`` rows (NOT ``pull_requests`` rows).  The
#   bucket key resolves from ``pr_comments.author_id`` (with sentinel branch
#   per CL-03 when absent from ``users``); self-comments are excluded by an
#   INNER JOIN to ``pull_requests`` filtering ``pc.author_id != pr.user_id``
#   per CL-04.
# - ``coverage_partial`` is a same-W flag per CL-10: every reviewer in W
#   shares ``comments.coverage_partial`` value.  Bucket-specific definition
#   would be degenerate because R's commenter relationship to a PR is
#   invisible until extraction.
# - Cross-aggregate parity (FR-2-03) compares ``SUM_R(comment_count)`` to an
#   INDEPENDENT count of eligible-reviewer-comment rows (commenter ≠ PR
#   author) computed by direct SQL — NOT to ``comments.comment_count``
#   which over-counts by the self-comment delta per CL-12.  ``thread_count`` /
#   ``active_thread_count`` sum-coherence is NOT asserted (multi-counting
#   metrics — a thread with N distinct non-self commenters contributes 1
#   to each commenter's thread_count and N to ``SUM_R(thread_count)``).
# - Round-9 isolation: same posture — re-implement everything inline; no
#   imports from ``aggregators.py``.


def _reviewer_bucket_for_author_id(
    conn: sqlite3.Connection,
    author_id: str,
) -> str:
    """Resolve the per-(week, reviewer) bucket key for one ``pr_comments.author_id``.

    Per FR-1-03 / CL-03 / INV-4-12: the bucket key is the commenter's
    ``user_id`` when present in ``users``, else
    ``FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL``.  Mirrors #334's
    ``_author_bucket_for_uid`` posture but applied to the commenter's
    ``author_id`` from ``pr_comments`` (NOT to the PR's ``user_id``).
    """
    cursor = conn.execute(
        "SELECT user_id FROM users WHERE user_id = ?",
        (author_id,),
    )
    row = cursor.fetchone()
    if row is None:
        return FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL
    return author_id


_RW_PR_AUTHOR_SQL: Final[str] = (
    "SELECT user_id FROM pull_requests WHERE pull_request_uid = ?"
)

# Iterates ``pr_comments`` rows for one PR: returns (commenter_author_id,
# thread_id, thread_status) for every C1-included row whose commenter is
# NOT the PR's author (self-comment exclusion per CL-04).  LEFT JOIN to
# ``pr_threads`` so the thread's status is available for the
# ``active_thread_count`` filter (per FR-1-05's COUNT(DISTINCT thread_id
# WHERE status='active') semantics).
_RW_NON_SELF_COMMENTS_SQL: Final[str] = (
    "SELECT pc.author_id AS commenter, pc.thread_id AS thread_id, "
    "       t.status AS thread_status, "
    "       t.is_deleted AS thread_is_deleted "
    "FROM pr_comments pc "
    "INNER JOIN pull_requests pr ON pr.pull_request_uid = pc.pull_request_uid "
    "LEFT JOIN pr_threads t "
    "  ON t.pull_request_uid = pc.pull_request_uid "
    "  AND t.thread_id = pc.thread_id "
    "WHERE pc.pull_request_uid = ? "
    "  AND pc.is_deleted = 0 "
    "  AND pc.author_id != pr.user_id"
)

_RW_SELF_COMMENT_COUNT_SQL: Final[str] = (
    "SELECT COUNT(*) AS self_count "
    "FROM pr_comments pc "
    "INNER JOIN pull_requests pr ON pr.pull_request_uid = pc.pull_request_uid "
    "WHERE pc.pull_request_uid = ? "
    "  AND pc.is_deleted = 0 "
    "  AND pc.author_id = pr.user_id"
)


def _build_expected_reviewer_buckets(
    conn: sqlite3.Connection,
    canonical_prs: list[_CanonicalPrRow],
) -> tuple[dict[str, _ExpectedBucket], int]:
    """Independent re-computation of one week's per-reviewer bucket emissions.

    Iterates each PR's eligible non-self ``pr_comments`` rows (commenter ≠
    PR author per CL-04, ``is_deleted = 0`` per C1).  Groups by commenter
    bucket key (``user_id`` or sentinel literal per FR-1-03).  Computes:

    - ``comment_count``: raw row count per commenter (FR-1-05).
    - ``thread_count``: COUNT(DISTINCT thread_id) per commenter (FR-1-05 —
      divergence from #334 / #335 raw row count).
    - ``active_thread_count``: COUNT(DISTINCT thread_id) where thread's
      status='active' per commenter (FR-1-05).
    - ``coverage_partial``: same-W flag per CL-10 — True iff any PR in
      ``canonical_prs`` is unextracted.  Bucket-independent.

    Returns ``(buckets_dict, eligible_comment_count)`` where the second
    element is the independent count of all eligible-reviewer-comment rows
    in W's extracted-subset (= sum of comment_count across buckets).  This
    is the right-hand side for FR-2-03 sum-coherence vs INDEPENDENT count.
    """
    same_w_partial = any(pr["comments_extracted_at"] is None for pr in canonical_prs)

    threads_by_bucket: dict[str, set[tuple[str, object]]] = {}
    active_threads_by_bucket: dict[str, set[tuple[str, object]]] = {}
    comment_count_by_bucket: dict[str, int] = {}

    for pr in canonical_prs:
        if pr["comments_extracted_at"] is None:
            # FR-1-06 extracted-subset rule: unextracted PRs contribute zero
            # to every bucket.  same_w_partial above already captured the
            # W-level partial signal.
            continue
        cursor = conn.execute(
            _RW_NON_SELF_COMMENTS_SQL,
            (pr["pull_request_uid"],),
        )
        for row in cursor.fetchall():
            commenter_raw = row["commenter"]
            assert isinstance(commenter_raw, str), (
                f"pr {pr['pull_request_uid']!r}: pr_comments.author_id is "
                f"{commenter_raw!r} (expected string per NOT NULL + extractor "
                "UUID convention)"
            )
            bucket = _reviewer_bucket_for_author_id(conn, commenter_raw)
            # Comment count is raw row count: includes non-deleted comments
            # on deleted threads (matches FR-2-03's INDEPENDENT count
            # right-hand side which filters only pc.is_deleted = 0).
            comment_count_by_bucket[bucket] = comment_count_by_bucket.get(bucket, 0) + 1
            # Thread tracking applies the C1 rule
            # (specs/310-comments-visualization/spec.md line 81:
            # "pr_threads.is_deleted = 1 MUST be excluded from every
            # thread count").  Match the production aggregator's
            # ``t.is_deleted = 0`` CASE filter so the per-bucket
            # thread_count + active_thread_count expectations align with
            # the SQL output post-Codex stop-time review fix.  Threads
            # with no pr_threads row (LEFT JOIN miss → thread_is_deleted
            # IS NULL) are also excluded — by C1 a thread that doesn't
            # exist in pr_threads cannot count toward thread_count.
            thread_is_deleted = row["thread_is_deleted"]
            if thread_is_deleted == 0:
                thread_key = (pr["pull_request_uid"], row["thread_id"])
                threads_by_bucket.setdefault(bucket, set()).add(thread_key)
                if row["thread_status"] == "active":
                    active_threads_by_bucket.setdefault(bucket, set()).add(thread_key)

    expected: dict[str, _ExpectedBucket] = {}
    for bucket, count in comment_count_by_bucket.items():
        expected[bucket] = _ExpectedBucket(
            thread_count=len(threads_by_bucket.get(bucket, set())),
            comment_count=count,
            active_thread_count=len(active_threads_by_bucket.get(bucket, set())),
            coverage_partial=same_w_partial,
        )
    return expected, sum(comment_count_by_bucket.values())


def _by_reviewer_comments_dict(
    rollup: dict[str, object],
    week_key: str,
) -> dict[str, dict[str, object]]:
    """Return ``rollup[W].by_reviewer_comments`` validated as dict-of-dicts.

    Fails the test with a clear TDD-mode message when the producer has
    not yet emitted the key (Phase 2.5 ``T016`` aggregator emission
    gating).
    """
    raw = rollup.get("by_reviewer_comments")
    assert raw is not None, (
        f"week {week_key}: rollup[W].by_reviewer_comments key MISSING. "
        "FR-1-01 requires the aggregator to emit the per-reviewer bucket "
        "outer dict on every weekly rollup when "
        "capabilities.comments_metrics is enabled and the canonical set "
        "has at least one eligible-reviewer-comment row.  Until Feature "
        "336's aggregator emission lands (T016), this assertion is the "
        "TDD failure mode for the per-reviewer reconciliation tests."
    )
    assert isinstance(raw, dict), (
        f"week {week_key}: rollup[W].by_reviewer_comments has unexpected "
        f"type {type(raw).__name__}; expected dict per INV-4-08 atomicity"
    )
    typed: dict[str, dict[str, object]] = {}
    for key, entry in raw.items():
        assert isinstance(entry, dict), (
            f"week {week_key}: by_reviewer_comments[{key!r}] has unexpected "
            f"type {type(entry).__name__}; expected 4-field dict"
        )
        typed[str(key)] = entry
    return typed


def test_sc05_reconciliation_per_week_by_reviewer_independent(
    sc05_fixture: SC05Fixture,
) -> None:
    """FR-2-02 (Feature 336): per-(W, reviewer) independent re-computation parity.

    For every week W and every bucket key in ``rollup[W].by_reviewer_comments``,
    the four atomic fields MUST equal the result of an independent
    re-computation that:

    1. Determines W's canonical throughput PR set via direct SQL against
       ``pull_requests`` (re-implemented week-attribution rule).
    2. For each PR P in the extracted-subset, iterates ``pr_comments`` rows
       where ``pc.author_id != pr.user_id`` AND ``is_deleted = 0`` (CL-04
       self-comment exclusion + C1).
    3. Resolves each commenter's bucket key (``user_id`` or sentinel
       literal per FR-1-03).
    4. Aggregates per bucket: comment_count = raw row count;
       thread_count = COUNT(DISTINCT thread_id); active_thread_count =
       COUNT(DISTINCT thread_id where status='active').
    5. Same-W coverage_partial per CL-10.
    """
    db_path = sc05_fixture.sqlite_path
    weeks_to_prs = _attribute_prs_to_weeks(db_path)
    rollup_paths = sorted(sc05_fixture.rollups_dir.glob("*.json"))
    assert rollup_paths, (
        f"sc05_fixture has no weekly rollups under {sc05_fixture.rollups_dir}; "
        "fixture builder is broken"
    )

    with closing(sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)) as conn:
        conn.row_factory = sqlite3.Row

        for rollup_path in rollup_paths:
            week_key = rollup_path.stem
            rollup = _load_rollup(rollup_path)
            canonical_prs = weeks_to_prs.get(week_key, [])
            if not canonical_prs:
                # FR-1-11 omission contract: empty canonical set → key absent.
                assert "by_reviewer_comments" not in rollup, (
                    f"week {week_key}: rollup has empty canonical PR set "
                    "but emits a non-omitted by_reviewer_comments key"
                )
                continue

            expected_buckets, _ = _build_expected_reviewer_buckets(conn, canonical_prs)

            if not expected_buckets:
                # No eligible-reviewer-comment rows in W's extracted-subset
                # → key absent per FR-1-11 (ALL comments in W are
                # self-comments, OR W's extracted-subset is empty).
                assert "by_reviewer_comments" not in rollup, (
                    f"week {week_key}: no eligible non-self comments in W's "
                    "extracted-subset but rollup emits a non-omitted "
                    "by_reviewer_comments key"
                )
                continue

            buckets_emitted = _by_reviewer_comments_dict(rollup, week_key)

            assert set(buckets_emitted.keys()) == set(expected_buckets.keys()), (
                f"week {week_key}: by_reviewer_comments key set "
                f"{sorted(buckets_emitted.keys())!r} != independent "
                f"re-computation {sorted(expected_buckets.keys())!r} "
                "(FR-1-03 + FR-2-02: every commenter (user_id or sentinel) "
                "with at least one eligible non-self comment in W's "
                "extracted-subset MUST appear in the bucket dict)"
            )

            for bucket_key, emitted in buckets_emitted.items():
                expected = expected_buckets[bucket_key]
                assert emitted["thread_count"] == expected["thread_count"], (
                    f"week {week_key}, reviewer {bucket_key!r}: "
                    f"thread_count={emitted['thread_count']!r} != independent "
                    f"re-computation {expected['thread_count']} "
                    "(FR-2-02: must equal COUNT(DISTINCT thread_id) per "
                    "commenter, NOT raw row count)"
                )
                assert emitted["comment_count"] == expected["comment_count"], (
                    f"week {week_key}, reviewer {bucket_key!r}: "
                    f"comment_count={emitted['comment_count']!r} != "
                    f"independent re-computation {expected['comment_count']} "
                    "(FR-2-02 violation)"
                )
                assert (
                    emitted["active_thread_count"] == expected["active_thread_count"]
                ), (
                    f"week {week_key}, reviewer {bucket_key!r}: "
                    f"active_thread_count={emitted['active_thread_count']!r} != "
                    f"independent re-computation "
                    f"{expected['active_thread_count']} (FR-2-02 violation)"
                )
                assert emitted["coverage_partial"] is expected["coverage_partial"], (
                    f"week {week_key}, reviewer {bucket_key!r}: "
                    f"coverage_partial={emitted['coverage_partial']!r} != "
                    f"independent re-computation "
                    f"{expected['coverage_partial']!r} (FR-2-02 + CL-10 "
                    "same-W flag: every reviewer in W shares the same "
                    "value, equal to comments.coverage_partial)"
                )


def test_sc05_reconciliation_per_week_by_reviewer_cross_aggregate_parity(
    sc05_fixture: SC05Fixture,
) -> None:
    """FR-2-03 (Feature 336 NEW shape): cross-aggregate parity vs INDEPENDENT count.

    For every week W where ``by_reviewer_comments`` is emitted (non-empty),
    asserts:

    1. ``SUM_R(by_reviewer_comments[R].comment_count)`` EQUALS an INDEPENDENT
       count of ``pr_comments`` rows in W's extracted-subset where
       ``pc.author_id != pr.user_id`` AND ``pc.is_deleted = 0`` (computed
       INDEPENDENTLY by direct SQL — NOT vs ``comments.comment_count``
       which over-counts by the self-comment delta per CL-12).
    2. ``thread_count`` and ``active_thread_count`` sum-coherence is NOT
       asserted at FR-2-03 level (multi-counting metrics: a thread with
       N distinct non-self commenters contributes 1 to each commenter's
       thread_count and N to ``SUM_R(thread_count)`` — bound is non-
       closed-form per CL-12).  FR-2-02 covers per-bucket correctness.
    3. ``OR_R(coverage_partial)`` EQUALS ``comments.coverage_partial``
       (drift guard against CL-10 same-W lock breakage).  Tautological
       under same-W lock; valuable as a producer regression guard.

    Pre-loop fixture-validation guard: asserts at least ONE week W in the
    SC-05 fixture satisfies "both ``comments`` AND ``by_reviewer_comments``
    are emitted (non-empty)".  Without the guard, a fixture regression
    (e.g., all PRs become self-comment-only) would let the loop iterate
    zero applicable weeks and silently pass — no positive control.
    """
    db_path = sc05_fixture.sqlite_path
    weeks_to_prs = _attribute_prs_to_weeks(db_path)
    rollup_paths = sorted(sc05_fixture.rollups_dir.glob("*.json"))
    assert rollup_paths, (
        f"sc05_fixture has no weekly rollups under {sc05_fixture.rollups_dir}"
    )

    # Pre-loop guard.
    applicable_weeks: list[str] = []
    for rollup_path in rollup_paths:
        rollup = _load_rollup(rollup_path)
        comments_obj = rollup.get("comments")
        by_reviewer = rollup.get("by_reviewer_comments")
        if (
            isinstance(comments_obj, dict)
            and isinstance(by_reviewer, dict)
            and len(by_reviewer) > 0
        ):
            applicable_weeks.append(rollup_path.stem)
    assert applicable_weeks, (
        "FR-2-03 fixture-validation guard: no week W in the SC-05 fixture "
        "has BOTH ``rollup[W].comments`` AND ``rollup[W].by_reviewer_comments``"
        " emitted (non-empty).  The cross-aggregate parity loop below would "
        "iterate zero weeks and silently pass — no positive control.  This "
        "means the fixture has regressed past the assertion's domain (e.g., "
        "all comments are self-comments, OR capability-on emission has "
        "regressed in the aggregator)."
    )

    with closing(sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)) as conn:
        conn.row_factory = sqlite3.Row

        for rollup_path in rollup_paths:
            week_key = rollup_path.stem
            rollup = _load_rollup(rollup_path)
            comments_obj = rollup.get("comments")
            by_reviewer = rollup.get("by_reviewer_comments")
            if not isinstance(comments_obj, dict) or not isinstance(by_reviewer, dict):
                continue
            if len(by_reviewer) == 0:
                continue

            # Aggregate-side: SUM_R(comment_count).
            sum_comment = 0
            any_partial = False
            for reviewer_key, entry in by_reviewer.items():
                if not isinstance(entry, dict):
                    continue
                cc = entry.get("comment_count")
                cp = entry.get("coverage_partial")
                assert isinstance(cc, int), (
                    f"week {week_key}, reviewer {reviewer_key!r}: non-integer "
                    f"comment_count {cc!r}"
                )
                assert isinstance(cp, bool), (
                    f"week {week_key}, reviewer {reviewer_key!r}: non-boolean "
                    f"coverage_partial {cp!r}"
                )
                sum_comment += cc
                any_partial = any_partial or cp

            # Independent-side: count pr_comments rows in W's extracted-subset
            # where commenter != PR author AND is_deleted = 0.  Computed via
            # the same direct SQL the per-bucket independent re-computation
            # uses, but summed across all buckets — gives the eligible-
            # reviewer-comments total for the week.
            canonical_prs = weeks_to_prs.get(week_key, [])
            _expected_buckets, eligible_count = _build_expected_reviewer_buckets(
                conn,
                canonical_prs,
            )

            assert sum_comment == eligible_count, (
                f"week {week_key}: SUM_R by_reviewer_comments[r].comment_count="
                f"{sum_comment} != INDEPENDENT eligible-reviewer-comments "
                f"count={eligible_count} (FR-2-03 cross-aggregate parity "
                "violation: per-reviewer aggregator's comment_count sum "
                "disagrees with the direct-SQL count of pr_comments rows in "
                "W's extracted-subset where commenter != PR author).  The "
                "right-hand side is computed INDEPENDENTLY, NOT vs "
                "comments.comment_count which would over-count by the "
                "self-comment delta per CL-12."
            )

            c_partial = comments_obj.get("coverage_partial")
            assert any_partial == c_partial, (
                f"week {week_key}: OR_R by_reviewer_comments[r].coverage_partial="
                f"{any_partial!r} != comments.coverage_partial={c_partial!r} "
                "(FR-2-03 OR-coherence drift guard: tautological under CL-10 "
                "same-W lock; surfaced here to catch a producer regression "
                "where the W-level flag fails to propagate uniformly across "
                "reviewer buckets in W)"
            )


def test_sc05_reconciliation_per_week_by_reviewer_pairwise_drilldown(
    sc05_fixture: SC05Fixture,
) -> None:
    """FR-2-01 (Feature 336 narrowed): per-PR drill-down ↔ per-reviewer
    aggregator ``comment_count`` distribution coherence.

    For every PR P in the drill-down's slice for week W AND in W's
    extracted-subset, asserts:

        P.comment_count_drilldown - count_self_comments(P) ==
            count_non_self_comments(P)

    where the right-hand side is the count of ``pr_comments`` rows for P
    where ``pc.author_id != pr.user_id`` AND ``is_deleted = 0``.  The
    equality witnesses that no eligible non-self comment is dropped during
    bucket attribution at the per-PR level.

    NOTE per spec FR-2-01 narrowing (post-/speckit.analyze C1+U1
    remediation): ``thread_count`` and ``active_thread_count`` distribution
    are NOT asserted at the per-PR level.  The "PR with mixed self-only
    and non-self threads" edge case makes the per-PR bound non-closed-form
    for those metrics (self-only threads contribute to drill-down
    thread_count but 0 to any reviewer bucket).  FR-2-02 covers per-bucket
    correctness for thread_count / active_thread_count.
    """
    db_path = sc05_fixture.sqlite_path
    weeks_to_prs = _attribute_prs_to_weeks(db_path)
    rollup_paths = sorted(sc05_fixture.rollups_dir.glob("*.json"))
    assert rollup_paths, (
        f"sc05_fixture has no weekly rollups under {sc05_fixture.rollups_dir}"
    )

    # Pre-loop guard: at least one PR in drilldown ∩ extracted-subset MUST
    # carry ≥1 non-self comment.  Without the guard, a fixture regression
    # (e.g., all comments become self-comments, OR no PRs are extracted)
    # would let the per-PR loop iterate zero load-bearing PRs and silently
    # pass — no positive control on the bucket-existence check below.
    #
    # Drilldown records use ``id`` (int) per 310 PrRecord shape, NOT
    # ``pull_request_uid`` — mirrors the per-author pairwise_drilldown
    # test's ``id_to_uid_extracted`` mapping at line 813-814.
    applicable_pr_count = 0
    with closing(sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)) as guard_conn:
        guard_conn.row_factory = sqlite3.Row
        for rollup_path in rollup_paths:
            rollup = _load_rollup(rollup_path)
            prs_field = rollup.get("prs")
            if not isinstance(prs_field, list):
                continue
            canonical_prs = weeks_to_prs.get(rollup_path.stem, [])
            id_to_uid_extracted: dict[int, str] = {
                pr["pull_request_id"]: pr["pull_request_uid"]
                for pr in canonical_prs
                if pr["comments_extracted_at"] is not None
            }
            for drilldown_entry in prs_field:
                if not isinstance(drilldown_entry, dict):
                    continue
                pr_id = drilldown_entry.get("id")
                if not isinstance(pr_id, int) or pr_id not in id_to_uid_extracted:
                    continue
                uid = id_to_uid_extracted[pr_id]
                non_self_rows = guard_conn.execute(
                    _RW_NON_SELF_COMMENTS_SQL,
                    (uid,),
                ).fetchall()
                if non_self_rows:
                    applicable_pr_count += 1
    assert applicable_pr_count > 0, (
        "FR-2-01 fixture-validation guard: no PR in any week's drilldown ∩ "
        "extracted-subset has ≥1 non-self comment in the SC-05 fixture.  The "
        "per-PR loop below would iterate zero load-bearing PRs and silently "
        "pass — no positive control on the bucket-existence check.  Either "
        "the fixture builder no longer seeds non-self comments (e.g., all "
        "comments became self-comments), OR the drilldown is empty/all-"
        "unextracted across every week."
    )

    with closing(sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)) as conn:
        conn.row_factory = sqlite3.Row

        for rollup_path in rollup_paths:
            week_key = rollup_path.stem
            rollup = _load_rollup(rollup_path)
            prs_field = rollup.get("prs")
            if not isinstance(prs_field, list):
                continue
            canonical_prs = weeks_to_prs.get(week_key, [])
            id_to_uid_extracted_inner: dict[int, str] = {
                pr["pull_request_id"]: pr["pull_request_uid"]
                for pr in canonical_prs
                if pr["comments_extracted_at"] is not None
            }
            by_reviewer_raw = rollup.get("by_reviewer_comments")
            for drilldown_entry in prs_field:
                if not isinstance(drilldown_entry, dict):
                    continue
                pr_id = drilldown_entry.get("id")
                if not isinstance(pr_id, int):
                    continue
                if pr_id not in id_to_uid_extracted_inner:
                    # Unextracted drill-down PRs are out of scope — covered
                    # by the 333 / 334 round-9 positive sentinel test.
                    continue
                uid = id_to_uid_extracted_inner[pr_id]
                cc_raw = drilldown_entry.get("comment_count")
                if not isinstance(cc_raw, int):
                    # 310 partial sentinel (None) — skip; FR-2-01 only
                    # constrains extracted-subset PRs.
                    continue
                drilldown_cc = cc_raw

                self_row = conn.execute(
                    _RW_SELF_COMMENT_COUNT_SQL,
                    (uid,),
                ).fetchone()
                self_cc = (
                    int(self_row["self_count"])
                    if self_row is not None and self_row["self_count"] is not None
                    else 0
                )

                non_self_rows = conn.execute(
                    _RW_NON_SELF_COMMENTS_SQL,
                    (uid,),
                ).fetchall()
                non_self_cc = len(non_self_rows)

                # Identity check: drilldown_cc partitions cleanly into self
                # + non-self counts (310 PrRecord coherence with the
                # per-reviewer dimension's CL-04 split).
                assert drilldown_cc - self_cc == non_self_cc, (
                    f"week {week_key}, PR id={pr_id}, uid={uid!r}: "
                    f"drill-down comment_count={drilldown_cc} MINUS "
                    f"self-comments={self_cc} ({drilldown_cc - self_cc}) "
                    f"!= non-self pr_comments rows={non_self_cc} (FR-2-01 "
                    "identity: drilldown_cc must partition into self + "
                    "non-self per CL-04; an inequality means the "
                    "drilldown's per-PR comment_count includes/excludes "
                    "self-comments inconsistently with the direct-SQL "
                    "counts, OR the SQL queries are buggy)"
                )

                # Bucket-existence check (load-bearing for FR-2-01 narrowed):
                # if P has ≥1 non-self comment, every non-self commenter's
                # resolved bucket key MUST be present in
                # rollup[W].by_reviewer_comments.  This witnesses that no
                # eligible non-self comment is dropped during bucket
                # attribution at the aggregator level.
                if non_self_cc == 0:
                    continue
                assert isinstance(by_reviewer_raw, dict), (
                    f"week {week_key}, PR id={pr_id}, uid={uid!r}: has "
                    f"{non_self_cc} non-self comments in W's extracted-"
                    "subset but rollup has no by_reviewer_comments "
                    "emission (FR-2-01 bucket-existence: every non-self "
                    "commenter MUST appear as a bucket key)"
                )
                emitted_keys = set(by_reviewer_raw.keys())
                seen_buckets: set[str] = set()
                for row in non_self_rows:
                    commenter_raw = row["commenter"]
                    assert isinstance(commenter_raw, str)
                    bucket = _reviewer_bucket_for_author_id(conn, commenter_raw)
                    seen_buckets.add(bucket)
                missing_buckets = seen_buckets - emitted_keys
                assert not missing_buckets, (
                    f"week {week_key}, PR id={pr_id}, uid={uid!r}: "
                    f"non-self commenters resolve to buckets "
                    f"{sorted(seen_buckets)!r} but rollup's "
                    f"by_reviewer_comments only emits "
                    f"{sorted(emitted_keys)!r}; missing: "
                    f"{sorted(missing_buckets)!r} (FR-2-01 bucket-"
                    "existence violation: no eligible non-self comment "
                    "may be dropped during bucket attribution)"
                )
