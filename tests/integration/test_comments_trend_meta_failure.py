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
