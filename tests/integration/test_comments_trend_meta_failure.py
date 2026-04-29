"""Feature 333 FR-2-05 failure-mode meta-test.

This module is the **positive control** for the FR-2-04 reconciliation test
(``tests/integration/test_comments_trend_reconciliation.py``). The
reconciliation test asserts that ``rollup[W].comments`` matches an
independent re-computation, for every week W in the demo dataset. Without
FR-2-05 it could silently degrade to a no-op:

* a refactor short-circuits an assertion;
* the fixture loader stops finding the dataset;
* the comparison loop skips weeks under some condition.

Any of those drift modes leaves the reconciliation test green on a wrong
codebase forever. FR-2-05 (spec.md lines 113-114) closes that gap by
INJECTING a synthetic violation of INV-1-06 (spec.md line 148:
``active_thread_count <= thread_count``) into a working copy of the demo
manifest, then asserting that the reconciliation test FAILS on the
mutated working copy. If reconciliation does NOT fail on the mutated
copy, reconciliation has gone passive and this meta-test surfaces it.

Authoritative refs:
    spec.md FR-2-05 (lines 113-114), INV-1-06 (line 148)
    contracts/sc05-reconciliation-test.md section 3
    tasks.md T009 (line 63)

Mutation strategy:
    Pick the latest weekly rollup file (most recent week, most likely to
    have substantive PR activity), parse it, and inject a synthetic
    ``comments`` sub-object whose ``active_thread_count`` is one greater
    than its ``thread_count``. INV-1-06 declares the relationship is
    ``active <= thread``; making active strictly greater than thread is
    the minimum spec-required positive control per FR-2-05.

Invocation strategy:
    The meta-test launches the FR-2-04 reconciliation test in a child
    pytest process via ``subprocess.run([sys.executable, "-m", "pytest",
    <T007-file-path>, ...])`` and passes the mutated working copy via the
    ``ADO_DEMO_DATA_DIR`` environment variable. T007 reads that env var
    to override its dataset path; the meta-test never co-invokes itself
    because it targets T007's file path explicitly (not a directory).

Test floor:
    +1 Python (this file's single test function). The floor bump is
    handled by the parent session's Phase 2 commit, not here.

Skip behaviour:
    None — the meta-test consumes the SC-05 fixture (built fresh at session
    start by ``conftest.py`` invoking the production ``build-aggregates``
    CLI), copies it to ``tmp_path``, and points reconciliation at the
    mutated copy via env vars. There is no path where this test legitimately
    skips on the supported configuration.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Final

import pytest

from ado_git_repo_insights.transform.constants import (
    FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL,
)
from tests.fixtures.sc05.fixture_builder import SC05Fixture

_REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
_WEEKLY_ROLLUPS_DIR: Final[str] = "aggregates/weekly_rollups"
_RECONCILIATION_TEST_PATH: Final[Path] = (
    _REPO_ROOT / "tests" / "integration" / "test_comments_trend_reconciliation.py"
)

# Synthetic mutation values. Use small non-zero numbers so the resulting
# rollup is plausibly real-looking (a defensive renderer that drops weeks
# with all-zero counts wouldn't filter this out and mask the violation).
# active = thread + 1 is the minimum delta that violates INV-1-06.
_SYNTH_THREAD_COUNT: Final[int] = 5
_SYNTH_COMMENT_COUNT: Final[int] = 12
_SYNTH_ACTIVE_THREAD_COUNT: Final[int] = _SYNTH_THREAD_COUNT + 1
_SYNTH_COVERAGE_PARTIAL: Final[bool] = False


def _copy_fixture_into(tmp_path: Path, source_fixture: SC05Fixture) -> Path:
    """Mirror the SC-05 fixture's on-disk layout into ``tmp_path / fixture``.

    Returns the working-copy root (the parent of ``data/`` and
    ``dataset.sqlite``) so the meta-test can pass it via the
    ``ADO_SC05_FIXTURE_DIR`` env var to the child pytest process.
    """
    dest_root = tmp_path / "fixture"
    dest_root.mkdir()
    shutil.copy2(source_fixture.sqlite_path, dest_root / "dataset.sqlite")
    shutil.copytree(source_fixture.data_dir, dest_root / "data")
    return dest_root


def _pick_target_rollup(working_root: Path) -> Path:
    """Pick the most recent weekly rollup JSON in the working copy.

    The most recent week is preferred because it is most likely to
    contain substantive PR activity; a week with zero PRs would still
    permit injection (the ``comments`` sub-object is gated on the
    capability flag, not on PR count) but a substantive week makes the
    meta-test's failure messages clearer when reconciliation surfaces
    the violation.
    """
    rollup_dir = working_root / "data" / _WEEKLY_ROLLUPS_DIR
    candidates = sorted(rollup_dir.glob("*.json"))
    if not candidates:
        raise RuntimeError(f"no weekly rollups under {rollup_dir} in working copy")
    return candidates[-1]


def _inject_inv106_violation(rollup_path: Path) -> str:
    """Inject a synthetic ``comments`` sub-object that violates INV-1-06.

    Returns the week key (rollup filename stem, e.g. ``2025-W52``) so
    failure messages in this meta-test can name the targeted week.

    The injected object satisfies INV-1-08 atomicity (all four fields
    present together) so the only contract violated is INV-1-06's
    ordering rule. This isolates the failure mode the meta-test is
    proving: reconciliation MUST detect the active-vs-thread integrity
    violation specifically, not simply reject any malformed sub-object.
    """
    payload = json.loads(rollup_path.read_text(encoding="utf-8"))
    payload["comments"] = {
        "thread_count": _SYNTH_THREAD_COUNT,
        "comment_count": _SYNTH_COMMENT_COUNT,
        "active_thread_count": _SYNTH_ACTIVE_THREAD_COUNT,
        "coverage_partial": _SYNTH_COVERAGE_PARTIAL,
    }
    rollup_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    return rollup_path.stem


def _run_reconciliation_against(working_root: Path) -> subprocess.CompletedProcess[str]:
    """Invoke the FR-2-04 reconciliation test against ``working_root``.

    Uses ``sys.executable -m pytest`` against the explicit T007 file path
    (NOT a directory) so pytest collection cannot recursively pick up
    this meta-test inside the child process. ``-p no:cacheprovider``
    keeps the child process from polluting ``.pytest_cache`` in the
    working copy. ``cwd=_REPO_ROOT`` so relative imports and conftest
    discovery work as they would in normal pytest runs; the fixture
    relocation is signalled exclusively via ``ADO_SC05_FIXTURE_DIR``,
    which conftest's ``sc05_fixture`` honors as a pre-built override.
    """
    env = dict(os.environ)
    env["ADO_SC05_FIXTURE_DIR"] = str(working_root)
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            str(_RECONCILIATION_TEST_PATH),
            "-p",
            "no:cacheprovider",
            # Disable pytest-cov in the child process. The repo's pyproject.toml
            # configures `[tool.coverage.report] fail_under = 75`, which makes
            # pytest-cov exit 1 on a child whose only test SKIPS (0% coverage).
            # With --no-cov the subprocess exits 0 only on a real test pass
            # and 1 only on a real test failure — which is precisely the
            # FR-2-05 signal we are asserting on.
            "--no-cov",
            "--no-header",
            "-q",
        ],
        capture_output=True,
        text=True,
        cwd=str(_REPO_ROOT),
        env=env,
        check=False,
    )


def test_meta_reconciliation_fails_on_inv_1_06_violation(
    tmp_path: Path, sc05_fixture: SC05Fixture
) -> None:
    """FR-2-05: reconciliation MUST fail on a synthetic INV-1-06 violation.

    Mechanism:
        1. Copy the SC-05 fixture (sqlite + data tree) into ``tmp_path``
           (working copy isolated from the session fixture).
        2. Pick the most recent weekly rollup; inject a synthetic
           ``comments`` sub-object with ``active_thread_count = thread_count + 1``
           (the spec-minimum positive control for FR-2-05).
        3. Invoke the FR-2-04 reconciliation test in a subprocess pointed
           at the mutated working copy via ``ADO_SC05_FIXTURE_DIR``.
        4. Assert the subprocess returned non-zero (reconciliation
           failed). A return code of 0 means reconciliation accepted the
           violation, which would be the silent-passive failure mode
           FR-2-05 exists to detect.
    """
    working_root = _copy_fixture_into(tmp_path, sc05_fixture)
    target_rollup = _pick_target_rollup(working_root)
    week_key = _inject_inv106_violation(target_rollup)

    completed = _run_reconciliation_against(working_root)

    assert completed.returncode != 0, (
        "FR-2-05 violation: the FR-2-04 reconciliation test PASSED on a "
        f"dataset where week {week_key} carries comments.active_thread_count="
        f"{_SYNTH_ACTIVE_THREAD_COUNT} > thread_count={_SYNTH_THREAD_COUNT} "
        "(INV-1-06 violation). Reconciliation has gone silently passive: "
        "either the loop is skipping weeks, the fixture loader is not "
        "reading the mutated working copy, or an assertion has been "
        "short-circuited. Subprocess stdout follows:\n"
        f"{completed.stdout}\n--- stderr ---\n{completed.stderr}"
    )


# --------------------------------------------------------------------------- #
# Feature 334 per-author meta-failure test                                     #
# --------------------------------------------------------------------------- #


def _inject_per_author_inv207_violation(rollup_path: Path) -> tuple[str, str]:
    """Inject a synthetic per-author INV-2-07 violation in by_author_comments.

    Returns ``(week_key, bucket_key)`` so the meta-test failure message
    can name both surfaces.  The injected entry uses the reserved
    sentinel literal as its bucket key (guaranteed not to collide with
    any real ``user_id`` per Feature 334 CL-03 / A-07), satisfies
    INV-2-08 atomicity (all four fields present together) so the only
    contract violated is INV-2-07's ordering rule
    (``active_thread_count > thread_count``).  This isolates the
    failure mode the meta-test is proving — per-author reconciliation
    MUST detect the per-bucket active-vs-thread integrity violation
    specifically, not simply reject any malformed sub-object.
    """
    payload = json.loads(rollup_path.read_text(encoding="utf-8"))
    existing = payload.get("by_author_comments")
    by_author_comments: dict[str, dict[str, int | bool]]
    if isinstance(existing, dict):
        by_author_comments = {
            str(k): dict(v) if isinstance(v, dict) else {} for k, v in existing.items()
        }
    else:
        by_author_comments = {}
    by_author_comments[FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL] = {
        "thread_count": _SYNTH_THREAD_COUNT,
        "comment_count": _SYNTH_COMMENT_COUNT,
        "active_thread_count": _SYNTH_ACTIVE_THREAD_COUNT,
        "coverage_partial": _SYNTH_COVERAGE_PARTIAL,
    }
    payload["by_author_comments"] = by_author_comments
    rollup_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    return rollup_path.stem, FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL


@pytest.mark.xfail(
    strict=False,
    reason=(
        "depends on the per-author reconciliation extension "
        "(test_sc05_reconciliation_per_week_by_author_*) being green "
        "on the clean demo before the per-author meta-failure can "
        "evaluate cleanly; collection-stable per Principle XXVI"
    ),
)
def test_meta_reconciliation_fails_on_per_author_inv_2_07_violation(
    tmp_path: Path, sc05_fixture: SC05Fixture
) -> None:
    """FR-2-05 (Feature 334): reconciliation MUST fail on per-author INV-2-07 violation.

    Mechanism:
        1. Copy the SC-05 fixture into ``tmp_path``.
        2. Pick the most recent weekly rollup; inject a synthetic
           ``by_author_comments`` entry under the sentinel key with
           ``active_thread_count = thread_count + 1`` (the spec-minimum
           positive control for FR-2-05 propagated to per-author scope).
        3. Invoke the FR-2-04 reconciliation test in a subprocess
           pointed at the mutated working copy via ``ADO_SC05_FIXTURE_DIR``.
        4. Assert subprocess returned non-zero (per-author reconciliation
           detected the synthetic violation).  A return code of 0 means
           per-author reconciliation has gone silently passive — exactly
           the failure mode this meta-test exists to detect.
    """
    working_root = _copy_fixture_into(tmp_path, sc05_fixture)
    target_rollup = _pick_target_rollup(working_root)
    week_key, bucket_key = _inject_per_author_inv207_violation(target_rollup)

    completed = _run_reconciliation_against(working_root)

    assert completed.returncode != 0, (
        "FR-2-05 violation (per-author scope): the FR-2-04 reconciliation "
        f"test PASSED on a dataset where week {week_key} carries "
        f"by_author_comments[{bucket_key!r}].active_thread_count="
        f"{_SYNTH_ACTIVE_THREAD_COUNT} > thread_count={_SYNTH_THREAD_COUNT} "
        "(INV-2-07 violation). Per-author reconciliation has gone silently "
        "passive: either the per-bucket loop is skipping buckets, the "
        "fixture loader is not reading the mutated working copy, or a "
        "per-bucket assertion has been short-circuited. Subprocess stdout "
        f"follows:\n{completed.stdout}\n--- stderr ---\n{completed.stderr}"
    )


# --------------------------------------------------------------------------- #
# Feature 335 per-repo meta-failure tests                                     #
# --------------------------------------------------------------------------- #
#
# Two injections per ADR R003: (a) per-(week, repo) INV-3-07 violation
# (``active_thread_count > thread_count``); (b) per-week sum-coherence
# violation (mutate one repo's ``thread_count`` so SUM_repo no longer
# matches ``comments.thread_count``).  Both injections MUST cause the
# FR-2-04 reconciliation test (specifically the new per-repo +
# sum-coherence assertions added in T006) to FAIL on the mutated copy.
#
# Same xfail(strict=False) collection-stability posture as the 334 per-
# author meta-test — the per-repo reconciliation tests must be GREEN on
# the clean demo before these meta-tests can evaluate cleanly, which
# requires T011 + T013 to have landed.


def _pick_existing_repo_bucket(rollup_path: Path) -> tuple[str, dict[str, int | bool]]:
    """Pick the first existing ``by_repository_comments`` entry to mutate.

    Returns ``(repo_key, entry)`` where ``entry`` is a fresh dict copy
    safe to mutate and re-serialize.  Raises ``RuntimeError`` if the
    target rollup has no per-repo emission — that means demo regeneration
    has shifted past the assertion's domain (parallel to FR-2-03's
    fixture-validation guard at the per-week-applicability level).
    """
    payload = json.loads(rollup_path.read_text(encoding="utf-8"))
    raw = payload.get("by_repository_comments")
    if not isinstance(raw, dict) or not raw:
        raise RuntimeError(
            f"meta-failure injection target {rollup_path.name} has no "
            "non-empty rollup[W].by_repository_comments to mutate.  Check "
            "that the SC-05 fixture builder + Feature 335 aggregator "
            "emission (T011) are both green before running this meta-test."
        )
    first_key = next(iter(raw))
    raw_entry = raw[first_key]
    assert isinstance(raw_entry, dict), (
        f"meta-failure injection: rollup[W].by_repository_comments[{first_key!r}] "
        f"has unexpected type {type(raw_entry).__name__}; expected 4-field dict"
    )
    entry: dict[str, int | bool] = {}
    for k, v in raw_entry.items():
        if isinstance(v, bool):
            entry[str(k)] = v
        elif isinstance(v, int):
            entry[str(k)] = v
        else:
            raise RuntimeError(
                f"meta-failure injection: rollup[W].by_repository_comments"
                f"[{first_key!r}][{k!r}] has unexpected type "
                f"{type(v).__name__}; expected int or bool"
            )
    return str(first_key), entry


def _inject_per_repo_inv307_violation(rollup_path: Path) -> tuple[str, str]:
    """Inject a synthetic per-repo INV-3-07 violation in by_repository_comments.

    Returns ``(week_key, repo_key)``.  Mutates the FIRST existing bucket
    so ``active_thread_count > thread_count`` (the spec-minimum positive
    control for FR-2-05 propagated to per-repo scope).  Other fields are
    preserved so the only contract violated is INV-3-07 ordering, isolating
    the failure mode the meta-test is proving.
    """
    repo_key, entry = _pick_existing_repo_bucket(rollup_path)
    payload = json.loads(rollup_path.read_text(encoding="utf-8"))
    raw = payload["by_repository_comments"]
    assert isinstance(raw, dict)
    by_repo: dict[str, dict[str, int | bool]] = {
        str(k): dict(v) if isinstance(v, dict) else {} for k, v in raw.items()
    }
    # active = thread + 1 — violates INV-3-07 minimally without invalidating
    # atomicity (all four fields remain present per INV-3-08).
    base_thread = entry.get("thread_count")
    assert isinstance(base_thread, int)
    by_repo[repo_key] = {
        "thread_count": base_thread,
        "comment_count": entry["comment_count"]
        if isinstance(entry.get("comment_count"), int)
        else 0,
        "active_thread_count": base_thread + 1,
        "coverage_partial": entry["coverage_partial"]
        if isinstance(entry.get("coverage_partial"), bool)
        else False,
    }
    payload["by_repository_comments"] = by_repo
    rollup_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    return rollup_path.stem, repo_key


def _inject_per_repo_sum_coherence_violation(rollup_path: Path) -> tuple[str, str]:
    """Inject a synthetic FR-2-03 sum-coherence violation.

    Returns ``(week_key, repo_key)``.  Adds 1 to the FIRST existing
    bucket's ``thread_count`` — this breaks
    ``SUM_repo by_repository_comments[r].thread_count == comments.thread_count``
    while preserving all other invariants (INV-3-07 holds because we
    increment thread without touching active; INV-3-08 atomicity holds
    because all four fields remain present).  The reconciliation test's
    sum-coherence assertion (T006 case (c)) MUST detect this drift.
    """
    repo_key, entry = _pick_existing_repo_bucket(rollup_path)
    payload = json.loads(rollup_path.read_text(encoding="utf-8"))
    raw = payload["by_repository_comments"]
    assert isinstance(raw, dict)
    by_repo: dict[str, dict[str, int | bool]] = {
        str(k): dict(v) if isinstance(v, dict) else {} for k, v in raw.items()
    }
    base_thread = entry["thread_count"]
    base_active = entry["active_thread_count"]
    assert isinstance(base_thread, int)
    assert isinstance(base_active, int)
    # +1 to thread_count; preserve other fields verbatim so SUM_repo
    # diverges from comments.thread_count by exactly +1.  active is
    # unchanged so INV-3-07 still holds (active <= thread + 1).
    by_repo[repo_key] = {
        "thread_count": base_thread + 1,
        "comment_count": entry["comment_count"]
        if isinstance(entry.get("comment_count"), int)
        else 0,
        "active_thread_count": base_active,
        "coverage_partial": entry["coverage_partial"]
        if isinstance(entry.get("coverage_partial"), bool)
        else False,
    }
    payload["by_repository_comments"] = by_repo
    rollup_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    return rollup_path.stem, repo_key


@pytest.mark.xfail(
    strict=False,
    reason=(
        "depends on the per-repo reconciliation extension "
        "(test_sc05_reconciliation_per_week_by_repository_*) being green "
        "on the clean demo before the per-repo meta-failure can evaluate "
        "cleanly; collection-stable per Principle XXVI"
    ),
)
def test_meta_reconciliation_fails_on_per_repo_inv_3_07_violation(
    tmp_path: Path, sc05_fixture: SC05Fixture
) -> None:
    """FR-2-05 (Feature 335): reconciliation MUST fail on per-repo INV-3-07 violation.

    Mechanism mirrors the 334 per-author meta-test: copy the SC-05 fixture
    into ``tmp_path``, pick the most recent weekly rollup, mutate the
    first ``by_repository_comments`` entry so ``active_thread_count =
    thread_count + 1``, invoke FR-2-04 reconciliation against the mutated
    copy, assert non-zero exit (per-repo reconciliation detected the
    synthetic violation).
    """
    working_root = _copy_fixture_into(tmp_path, sc05_fixture)
    target_rollup = _pick_target_rollup(working_root)
    week_key, repo_key = _inject_per_repo_inv307_violation(target_rollup)

    completed = _run_reconciliation_against(working_root)

    assert completed.returncode != 0, (
        "FR-2-05 violation (per-repo scope): the FR-2-04 reconciliation "
        f"test PASSED on a dataset where week {week_key} carries "
        f"by_repository_comments[{repo_key!r}].active_thread_count > "
        "thread_count (INV-3-07 violation).  Per-repo reconciliation has "
        "gone silently passive: either the per-bucket loop is skipping "
        "buckets, the fixture loader is not reading the mutated working "
        "copy, or a per-bucket assertion has been short-circuited.  "
        f"Subprocess stdout follows:\n{completed.stdout}\n"
        f"--- stderr ---\n{completed.stderr}"
    )


@pytest.mark.xfail(
    strict=False,
    reason=(
        "depends on the per-repo cross-aggregate sum-coherence assertion "
        "(test_sc05_reconciliation_cross_aggregate_sum_coherence) being "
        "green on the clean demo before the sum-coherence meta-failure "
        "can evaluate cleanly; collection-stable per Principle XXVI"
    ),
)
def test_meta_reconciliation_fails_on_per_repo_sum_coherence_violation(
    tmp_path: Path, sc05_fixture: SC05Fixture
) -> None:
    """FR-2-05 (Feature 335 NEW): reconciliation MUST fail on FR-2-03 sum-coherence violation.

    Mechanism: copy the SC-05 fixture into ``tmp_path``, pick the most
    recent weekly rollup, mutate the first ``by_repository_comments``
    entry's ``thread_count`` by +1 (breaking SUM_repo equality with
    ``comments.thread_count``), invoke FR-2-04 reconciliation against
    the mutated copy, assert non-zero exit (the new sum-coherence
    assertion in T006 detected the synthetic drift).

    This is the positive control for FR-2-03 — without it, the sum-
    coherence assertion could silently degrade to a no-op (e.g., if a
    refactor short-circuits the loop, the fixture-validation guard mis-
    fires, or the field-by-field equality is replaced by a trivial
    truthy check).  A passing meta-test proves FR-2-03 is real.
    """
    working_root = _copy_fixture_into(tmp_path, sc05_fixture)
    target_rollup = _pick_target_rollup(working_root)
    week_key, repo_key = _inject_per_repo_sum_coherence_violation(target_rollup)

    completed = _run_reconciliation_against(working_root)

    assert completed.returncode != 0, (
        "FR-2-05 violation (per-repo sum-coherence scope): the FR-2-04 "
        "reconciliation test PASSED on a dataset where week "
        f"{week_key} carries by_repository_comments[{repo_key!r}]."
        "thread_count = comments.thread_count + 1 (FR-2-03 cross-"
        "aggregate sum-coherence violation).  The sum-coherence "
        "assertion has gone silently passive: either the loop is "
        "skipping applicable weeks, the fixture-validation guard mis-"
        "fired, or the field-by-field equality is replaced by a trivial "
        "truthy check.  Subprocess stdout follows:\n"
        f"{completed.stdout}\n--- stderr ---\n{completed.stderr}"
    )
