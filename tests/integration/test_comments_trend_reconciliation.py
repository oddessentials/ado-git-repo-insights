"""Feature 333 FR-2-04 SC-05 cross-feature reconciliation test.

This module is the executable closure of feature 310's deferred SC-05 cross-feature
coherence obligation (310 spec lines 145-146; closed by 333 spec SC-1-05 / INV-1-02).
For every week W in the demo dataset, the test asserts two properties per spec
``FR-2-04`` (a) + (b):

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

Demo dataset discovery:

* Reads ``ADO_DEMO_DATA_DIR`` env var (default: ``<repo>/docs/data``) for the
  demo manifest + weekly rollup JSONs. The sibling FR-2-05 meta-test
  (``test_comments_trend_meta_failure.py``) sets this env var to point at a
  mutated working copy.
* Reads ``ADO_DEMO_DB`` env var for the source SQLite path. If unset, falls
  back to checking ``<demo-root>/dataset.sqlite``,
  ``<repo>/artifacts/demo-enterprise/dataset.sqlite``, then ``<repo>/ado-insights.sqlite``.
* If ``capabilities.comments_metrics`` is False on the manifest, the test
  skips with reason ``"capability off"`` (FR-3-03 says no ``comments`` object
  is emitted; nothing to reconcile).
* If the manifest is capability-on but no source SQLite is locatable OR the
  located SQLite has no PR data, the test skips with a clear reason. The
  reconciliation cannot ground the independent re-computation without source
  rows; skipping a missing fixture is acceptable, passing without
  verification is not.
* If both the manifest and a populated SQLite are present, the test runs
  fully and FAILS if any week's ``rollup[W].comments`` values diverge from
  the independent re-computation (this includes the TDD failure mode where
  ``rollup[W].comments`` is absent altogether before T011 lands — a
  ``"comments key missing"`` assertion fires before the field-by-field
  comparison so the failure message is clear).

TDD intent (T007 ordering):

This test MUST currently FAIL on a populated demo (T011 has not yet emitted
``rollup[W].comments``). The "comments key missing" assertion at the head
of each week's check delivers a clean failure message until T011 lands the
aggregator emission. After T011 + T026 regenerate the demo with the
``comments`` sub-object, this test transitions to GREEN and remains the
authoritative parity check for weekly comments aggregates.

Test floor: +1 Python (single test function; pytest reports per-week failures
via the first-failing-assertion pattern). Floor bump is handled by the parent
session's Phase 2 commit, not this file.
"""

from __future__ import annotations

import json
import os
import sqlite3
from collections.abc import Iterator
from contextlib import closing
from pathlib import Path
from typing import Final, TypedDict

import pandas as pd
import pytest


class _CanonicalPrRow(TypedDict):
    """Per-PR row shape returned by ``_attribute_prs_to_weeks``.

    Typed explicitly so downstream callers can pass ``pull_request_id``
    to ``int()`` / ``set()`` operations without mypy widening to ``object``.
    """

    pull_request_uid: str
    pull_request_id: int
    comments_extracted_at: str | None


# --------------------------------------------------------------------------- #
# Paths & env vars                                                             #
# --------------------------------------------------------------------------- #

_REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]

# Override env var for relocating the demo data root. Honored by the
# FR-2-05 meta-test (``test_comments_trend_meta_failure.py``) so it can
# point reconciliation at a tmp_path mutated working copy without
# touching ``docs/data/`` in the repo.
_DEMO_DATA_ENV_VAR: Final[str] = "ADO_DEMO_DATA_DIR"
_DEMO_DB_ENV_VAR: Final[str] = "ADO_DEMO_DB"

# Default demo data root (capability-on demo committed in the repo).
_DEFAULT_DEMO_DATA_DIR: Final[Path] = _REPO_ROOT / "docs" / "data"

# Demo SQLite candidate locations searched in order when ADO_DEMO_DB is unset.
# The list is intentionally short and explicit; T011 / T026 will pin a single
# canonical location once the demo workflow exposes a backing SQLite.
_DEFAULT_DB_CANDIDATES_RELATIVE: Final[tuple[Path, ...]] = (
    Path("artifacts") / "demo-enterprise" / "dataset.sqlite",
    Path("ado-insights.sqlite"),
)


# --------------------------------------------------------------------------- #
# Demo dataset discovery                                                       #
# --------------------------------------------------------------------------- #


def _resolve_demo_data_dir() -> Path:
    """Return the demo data root. Honors ``ADO_DEMO_DATA_DIR`` env var."""
    override = os.environ.get(_DEMO_DATA_ENV_VAR)
    if override:
        return Path(override).resolve()
    return _DEFAULT_DEMO_DATA_DIR


def _resolve_demo_db_path(demo_data_dir: Path) -> Path | None:
    """Find the source SQLite that backs the demo dataset, or ``None``.

    Search order:
      1. ``ADO_DEMO_DB`` env var (absolute path).
      2. ``<demo-data-dir>/dataset.sqlite`` — convention for a future demo
         workflow that publishes the SQLite alongside the JSON tree.
      3. ``<repo>/artifacts/demo-enterprise/dataset.sqlite`` — convention
         pinned by the 310 quickstart §2.
      4. ``<repo>/ado-insights.sqlite`` — local-developer extraction default.

    Returns the first existing path, or ``None`` if no candidate exists. The
    caller decides whether to skip the test or proceed.
    """
    override = os.environ.get(_DEMO_DB_ENV_VAR)
    if override:
        candidate = Path(override)
        return candidate if candidate.exists() else None

    candidates: list[Path] = [demo_data_dir / "dataset.sqlite"]
    candidates.extend(_REPO_ROOT / rel for rel in _DEFAULT_DB_CANDIDATES_RELATIVE)
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def _load_manifest(demo_data_dir: Path) -> dict[str, object]:
    manifest_path = demo_data_dir / "dataset-manifest.json"
    if not manifest_path.exists():
        pytest.skip(
            f"demo manifest not found at {manifest_path}; "
            "cannot exercise FR-2-04 without a manifest"
        )
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        pytest.fail(f"manifest {manifest_path} is not a JSON object")
    return payload


def _capability_on(manifest: dict[str, object]) -> bool:
    capabilities = manifest.get("capabilities")
    if not isinstance(capabilities, dict):
        return False
    return bool(capabilities.get("comments_metrics"))


def _iter_rollup_paths(demo_data_dir: Path) -> Iterator[Path]:
    rollup_dir = demo_data_dir / "aggregates" / "weekly_rollups"
    if not rollup_dir.is_dir():
        pytest.skip(
            f"weekly rollup directory not found at {rollup_dir}; "
            "demo dataset is incomplete"
        )
    yield from sorted(rollup_dir.glob("*.json"))


def _has_source_pr_rows(db_path: Path) -> bool:
    """Return True iff the source SQLite has any pull_requests rows.

    A path that exists but has zero rows (e.g., a freshly-initialized DB
    file from a developer's local extraction that never ran) cannot ground
    the independent re-computation; the test skips rather than passing on
    an empty fixture.
    """
    try:
        with closing(sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)) as conn:
            cursor = conn.execute("SELECT COUNT(*) FROM pull_requests")
            count = cursor.fetchone()[0]
    except sqlite3.DatabaseError:
        return False
    return int(count) > 0


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
            extracted: str | None = (
                None if extracted_raw is None else str(extracted_raw)
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


def _per_pr_counts(
    conn: sqlite3.Connection, pull_request_uid: str
) -> tuple[int, int, int]:
    """Independent per-PR ``(thread_count, comment_count, active_thread_count)``.

    Applies C1 inclusion rules (per ``specs/310-comments-visualization/spec.md``
    lines 75-87) directly against ``pr_threads`` and ``pr_comments`` — no
    aggregator helpers. ``COALESCE``s NULL results from ``SUM(...) OVER an
    empty set`` to 0 so the integer-typed return shape is unconditional.
    """
    threads_row = conn.execute(_THREAD_COUNTS_SQL, (pull_request_uid,)).fetchone()
    comments_row = conn.execute(_COMMENT_COUNT_SQL, (pull_request_uid,)).fetchone()

    raw_thread_count = threads_row[0] if threads_row is not None else 0
    raw_active_thread_count = threads_row[1] if threads_row is not None else 0
    raw_comment_count = comments_row[0] if comments_row is not None else 0

    thread_count = int(raw_thread_count if raw_thread_count is not None else 0)
    active_thread_count = int(
        raw_active_thread_count if raw_active_thread_count is not None else 0
    )
    comment_count = int(raw_comment_count if raw_comment_count is not None else 0)
    return thread_count, comment_count, active_thread_count


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


def test_sc05_reconciliation_per_week() -> None:
    """FR-2-04 (a) + (b): every demo week's ``rollup[W].comments`` matches an
    independent re-computation, and per-PR drill-down values agree with the
    aggregator on the extracted-subset of the intersection.

    Iterates every week W discoverable in the demo dataset. Per-week assertions:

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

    Skip semantics: skips when the manifest is capability-off, when the
    source SQLite is missing, or when the located SQLite has zero PR rows.
    Skipping a missing fixture is acceptable; passing without verification
    is not.
    """
    demo_data_dir = _resolve_demo_data_dir()
    manifest = _load_manifest(demo_data_dir)

    if not _capability_on(manifest):
        pytest.skip(
            "capabilities.comments_metrics is False on the demo manifest; "
            "FR-3-03 specifies no comments object is emitted under "
            "capability-off, so reconciliation has nothing to compare"
        )

    db_path = _resolve_demo_db_path(demo_data_dir)
    if db_path is None:
        pytest.skip(
            "no source SQLite found for the demo dataset; set "
            f"{_DEMO_DB_ENV_VAR} to a path with pull_requests / pr_threads / "
            "pr_comments tables, or place a populated SQLite at one of: "
            f"{demo_data_dir / 'dataset.sqlite'}, "
            f"{_REPO_ROOT / 'artifacts' / 'demo-enterprise' / 'dataset.sqlite'}, "
            f"{_REPO_ROOT / 'ado-insights.sqlite'}. The independent "
            "re-computation requires direct SQL grounding (round-9 isolation "
            "forbids reading throughput's emitted PR list)"
        )
    if not _has_source_pr_rows(db_path):
        pytest.skip(
            f"source SQLite at {db_path} has no pull_requests rows; cannot "
            "ground the independent re-computation"
        )

    weeks_to_prs = _attribute_prs_to_weeks(db_path)
    rollup_paths = list(_iter_rollup_paths(demo_data_dir))
    if not rollup_paths:
        pytest.skip(f"no weekly rollups found under {demo_data_dir}")

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
            for pr in extracted_prs:
                pr_uid = pr["pull_request_uid"]
                tc, cc, atc = _per_pr_counts(conn, pr_uid)
                expected_thread_count += tc
                expected_comment_count += cc
                expected_active_thread_count += atc
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
                    expected_tc, expected_cc, expected_atc = _per_pr_counts(
                        conn, pr_uid
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
