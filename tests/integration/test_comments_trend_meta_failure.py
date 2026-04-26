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
    +1 Python (this file's single test function counts toward the floor
    even when xfail; pytest collects xfail tests). The floor bump is
    handled by the parent session's Phase 2 commit, not here.

xfail / skip behaviour:
    Marked ``xfail(strict=False)`` per tasks.md T009 because, until T007
    + T011 land, T007 fails on a CLEAN demo too. Asserting that
    reconciliation fails on a MUTATED dataset is a degenerate result
    while reconciliation is still red on the unmutated dataset; xfail
    keeps this test collection-stable per Principle XXVI without
    inverting the assertion's truth value when T011 finally lands.
    Once reconciliation is green on clean demo, this meta-test starts
    emitting XPASS, at which point the xfail marker can be removed and
    the test becomes a regular green guard. Additionally, if T007's file
    has not yet been created in the workspace (parallel-author race
    where this file lands before T007), the meta-test skips with a clear
    reason rather than failing on a missing path.
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

_REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
_DEMO_DATA_DIR: Final[Path] = _REPO_ROOT / "docs" / "data"
_MANIFEST_FILENAME: Final[str] = "dataset-manifest.json"
_WEEKLY_ROLLUPS_DIR: Final[str] = "aggregates/weekly_rollups"
_RECONCILIATION_TEST_PATH: Final[Path] = (
    _REPO_ROOT / "tests" / "integration" / "test_comments_trend_reconciliation.py"
)
# T007 must read this env var to relocate its demo-data root. The meta-test
# uses it to point reconciliation at the mutated working copy. If T007's
# implementation diverges from this contract, the meta-test will degrade
# to "pytest exits zero on the unmutated repo dataset" and FAIL its own
# assertion clearly (rather than silently passing).
_DEMO_DATA_ENV_VAR: Final[str] = "ADO_DEMO_DATA_DIR"

# Synthetic mutation values. Use small non-zero numbers so the resulting
# rollup is plausibly real-looking (a defensive renderer that drops weeks
# with all-zero counts wouldn't filter this out and mask the violation).
# active = thread + 1 is the minimum delta that violates INV-1-06.
_SYNTH_THREAD_COUNT: Final[int] = 5
_SYNTH_COMMENT_COUNT: Final[int] = 12
_SYNTH_ACTIVE_THREAD_COUNT: Final[int] = _SYNTH_THREAD_COUNT + 1
_SYNTH_COVERAGE_PARTIAL: Final[bool] = False


def _copy_demo_data_into(tmp_path: Path) -> Path:
    """Mirror ``docs/data/`` into ``tmp_path / data`` and return the copy root.

    Uses ``shutil.copytree`` so the working copy is fully isolated from the
    repo dataset; the meta-test never writes into ``docs/data/``.
    """
    dest = tmp_path / "data"
    shutil.copytree(_DEMO_DATA_DIR, dest)
    return dest


def _pick_target_rollup(working_root: Path) -> Path:
    """Pick the most recent weekly rollup JSON in the working copy.

    The most recent week is preferred because it is most likely to
    contain real PR activity in the demo dataset; a week with zero PRs
    would still permit injection (the ``comments`` sub-object is gated
    on the capability flag, not on PR count) but a substantive week
    makes the meta-test's failure messages clearer when reconciliation
    surfaces the violation.
    """
    rollup_dir = working_root / _WEEKLY_ROLLUPS_DIR
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
    discovery work as they would in normal pytest runs; the dataset
    relocation is signalled exclusively via the env var.
    """
    env = dict(os.environ)
    env[_DEMO_DATA_ENV_VAR] = str(working_root)
    # Defensive recursion guard: if T007 ever uses ``pytest.main`` to
    # invoke other tests, this flag (read by the meta-test only) lets
    # T007's discovery code skip the meta-test deterministically. T007
    # is not contractually required to honour this var; the explicit
    # file-path argument to pytest below is the primary recursion guard.
    env["ADO_META_FAILURE_TEST_RUNNING"] = "1"
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
            # That false-positive non-zero exit would be indistinguishable from
            # "reconciliation detected the mutation," silently breaking the
            # meta-test's signal: T009 would XPASS pre-T011 for the wrong
            # reason. With --no-cov the subprocess exits 0 on skip and 1 only
            # on real test failure (which is precisely the FR-2-05 signal).
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


@pytest.mark.xfail(
    strict=False,
    reason="depends on T007 + T012 making the reconciliation test green on clean demo",
)
def test_meta_reconciliation_fails_on_inv_1_06_violation(tmp_path: Path) -> None:
    """FR-2-05: reconciliation MUST fail on a synthetic INV-1-06 violation.

    Mechanism:
        1. Copy ``docs/data/`` into ``tmp_path`` (working copy isolated
           from the repo dataset; the test never writes to ``docs/data/``).
        2. Pick the most recent weekly rollup; inject a synthetic
           ``comments`` sub-object with ``active_thread_count = thread_count + 1``
           (the spec-minimum positive control for FR-2-05).
        3. Invoke the FR-2-04 reconciliation test in a subprocess
           pointed at the mutated working copy via the ``ADO_DEMO_DATA_DIR``
           env var.
        4. Assert the subprocess returned non-zero (reconciliation
           failed). A return code of 0 means reconciliation accepted the
           violation, which would be the silent-passive failure mode
           FR-2-05 exists to detect.

    Marked xfail strict=False because T011 has not yet emitted the
    ``comments`` sub-object on clean demo, so reconciliation still fails
    on the unmutated dataset; the "fails on mutated dataset" property
    cannot be cleanly proven until T011 lands. After T011, reconciliation
    is green on clean demo and this meta-test transitions XPASS, at
    which point the xfail marker is removed and this becomes a regular
    guard. Both states are collection-stable per Principle XXVI.
    """
    if not _RECONCILIATION_TEST_PATH.exists():
        pytest.skip(
            f"FR-2-04 reconciliation test missing at {_RECONCILIATION_TEST_PATH}; "
            "meta-test cannot run until T007 lands"
        )
    if not _DEMO_DATA_DIR.exists():
        pytest.skip(
            f"demo dataset missing at {_DEMO_DATA_DIR}; "
            "meta-test cannot exercise FR-2-05 without it"
        )

    working_root = _copy_demo_data_into(tmp_path)
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
