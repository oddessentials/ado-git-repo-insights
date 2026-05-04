"""Feature 333 FR-2-03 (b) — per-PR week-attribution parity test.

ADR T003 pinned **option (b)** for FR-2-03 because throughput's
week-attribution is fully
inlined in ``aggregators.py::_generate_weekly_rollups`` (lines 647-657) as a
sequence of pandas operations: ``pd.to_datetime(closed_date) ->
.dt.isocalendar().year/.week -> f"{year}-W{week:02d}"``. Extracting that
formula into a shared helper would refactor a hot path also feeding
throughput's ``start_date`` / ``end_date`` derivation — out of scope for the
foundation PR. Instead, this test verifies that throughput's emitted per-PR
week mapping (the ``prs[]`` array on each weekly rollup) honors the formula
for every PR throughput emits.

The comments aggregator added in T011 reuses throughput's per-week iteration
(it is called inside ``_generate_weekly_rollups`` with the same
``week_pr_uids`` set throughput just produced), so by construction it
inherits throughput's week-attribution. **Drift detection** therefore comes
from this test catching throughput-side regressions: if throughput's
formula ever changes without a coordinated update everywhere it is applied,
the formula re-implemented here stops matching throughput's emitted ``prs[]``
mapping and this test fails. The companion FR-2-04 (b) reconciliation test
(``test_comments_trend_reconciliation.py``) catches comments-side drift via
per-week sum comparison.

Together the pair covers both surfaces: T012 (this file) catches
throughput-side week-attribution drift; T007 catches comments-side
aggregate drift; round-9 isolation keeps T007 independent of throughput's
implementation. Removing T012 would leave throughput-side drift visible
only via the SC-05 reconciliation, which round-9 prohibits from importing
throughput — closing the loop here is what makes the parity contract
end-to-end verifiable.

Authoritative refs:

* FR-2-03, INV-1-02.
* ADR T003 + Decision 6 (round-9 isolation rule).
* T012.

Fixture (Round 14, revised — production-driven): the test consumes the
session-scoped ``sc05_fixture`` (``tests/integration/conftest.py``). The
fixture writes raw rows then runs the production ``build-aggregates`` CLI
to produce real rollups. NO env-var discovery, NO tiered fallback, NO skips.

Test floor: +1 Python (single test function). Floor bump is handled by the
parent session's Phase 2 commit, not this file.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pandas as pd
import pytest

from tests.fixtures.sc05.fixture_builder import SC05Fixture


def _isoweek_key(closed_date: str) -> str:
    """Apply throughput's inlined ISO-week formula to a ``closed_date`` value.

    Mirrors ``aggregators.py::_generate_weekly_rollups`` lines 647-657
    EXACTLY: ``pd.to_datetime`` -> ``.dt.isocalendar()`` -> Python int cast
    -> ``f"{year}-W{week:02d}"``. Any drift between throughput's formula
    and this implementation surfaces as a per-PR mismatch in the test
    body, which is the FR-2-03 (b) failure signal.
    """
    parsed = pd.to_datetime([closed_date])
    iso = parsed.isocalendar().iloc[0]
    year_int = int(iso["year"])
    week_int = int(iso["week"])
    return f"{year_int}-W{week_int:02d}"


def _read_throughput_pr_week_map(rollups_dir: Path) -> dict[int, str]:
    """Build {pull_request_id: week_key} from every weekly rollup's ``prs[]``.

    The rollup ``prs[]`` array carries the top-500-by-cycle-time slice per
    week (310 INV-02). Each entry has ``id`` (pull_request_id) and lives
    under the rollup whose filename stem is the week key. We invert that
    structure to produce a per-PR map covering every PR throughput EMITS.
    PRs throughput attributes to a week but does NOT emit (those outside
    the top-500 slice on a high-volume week) are not visible here; the
    parity contract is for emitted PRs only — the round-9 isolation rule
    prevents this test from grounding against throughput's internal
    attribution beyond the emission surface.
    """
    pr_to_week: dict[int, str] = {}
    for rollup_path in sorted(rollups_dir.glob("*.json")):
        week_key = rollup_path.stem
        payload = json.loads(rollup_path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            continue
        prs = payload.get("prs")
        if not isinstance(prs, list):
            continue
        for entry in prs:
            if not isinstance(entry, dict):
                continue
            pr_id = entry.get("id")
            if not isinstance(pr_id, int):
                continue
            pr_to_week[pr_id] = week_key
    return pr_to_week


def test_throughput_per_pr_week_attribution_matches_isoweek_formula(
    sc05_fixture: SC05Fixture,
) -> None:
    """FR-2-03 (b): every PR in throughput's prs[] must match the ISO-week formula.

    For every PR ``P`` that appears in some weekly rollup's ``prs[]`` array,
    ``_isoweek_key(P.closed_date)`` (re-implemented inline per ADR T003)
    MUST equal the rollup's week key. Any divergence indicates throughput's
    week-attribution has drifted from the contract formula — which would
    silently break the comments aggregator's parity with throughput
    (since T011 reuses throughput's per-week iteration) and would otherwise
    only surface as a per-week sum mismatch in the SC-05 reconciliation
    test (T007).
    """
    pr_to_throughput_week = _read_throughput_pr_week_map(sc05_fixture.rollups_dir)
    assert pr_to_throughput_week, (
        f"sc05_fixture has no PRs in any rollup's prs[] under "
        f"{sc05_fixture.rollups_dir}; fixture builder is broken"
    )

    db_path = sc05_fixture.sqlite_path
    with closing(sqlite3.connect(str(db_path))) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(
            "SELECT pull_request_id, closed_date FROM pull_requests "
            "WHERE status = 'completed' AND closed_date IS NOT NULL"
        )
        pr_rows = cursor.fetchall()

    assert pr_rows, (
        f"sc05_fixture sqlite at {db_path} has no completed PRs with "
        "closed_date; fixture builder is broken"
    )

    pr_id_to_closed_date: dict[int, str] = {}
    for row in pr_rows:
        pr_id_raw = row["pull_request_id"]
        closed_date_raw = row["closed_date"]
        if not isinstance(pr_id_raw, int):
            continue
        if not isinstance(closed_date_raw, str):
            continue
        pr_id_to_closed_date[pr_id_raw] = closed_date_raw

    mismatches: list[str] = []
    missing_source_dates: list[int] = []
    for pr_id, throughput_week in pr_to_throughput_week.items():
        closed_date = pr_id_to_closed_date.get(pr_id)
        if closed_date is None:
            missing_source_dates.append(pr_id)
            continue
        formula_week = _isoweek_key(closed_date)
        if formula_week != throughput_week:
            mismatches.append(
                f"PR id={pr_id}: throughput emitted week={throughput_week!r} "
                f"but formula(closed_date={closed_date!r}) = {formula_week!r}"
            )

    if missing_source_dates:
        # Source DB lacks closed_date for a PR throughput emitted; this is a
        # demo-data integrity issue distinct from formula drift but worth
        # surfacing as a test failure rather than a silent skip — round-9
        # round-9 spirit (don't ground tests on weakened assumptions).
        pytest.fail(
            f"FR-2-03 (b) source-data integrity: {len(missing_source_dates)} "
            f"PR(s) appear in throughput's emitted prs[] but have no row in "
            f"pull_requests with a closed_date; first 10 ids="
            f"{missing_source_dates[:10]}. Demo data may need regeneration "
            f"(scripts/manage_generated_artifacts.py sync --scope all --stage)."
        )

    assert not mismatches, (
        "FR-2-03 (b) parity violation — throughput's emitted week mapping "
        "diverges from the inline ISO-week formula re-implemented here per "
        "ADR T003. This means throughput's week-attribution at "
        "aggregators.py:647-657 has drifted from the contract formula, "
        "which silently breaks the comments aggregator's parity (T011 "
        "reuses throughput's per-week iteration so any drift in throughput's "
        "rule propagates to comments). First 10 mismatches:\n  "
        + "\n  ".join(mismatches[:10])
    )
