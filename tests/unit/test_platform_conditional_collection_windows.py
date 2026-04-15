"""Windows-only measured drift lock for the platform-conditional filter.

Runs the ratchet-bump gate's real subprocess-isolated collectors twice —
once with ``PLATFORM_CONDITIONAL_IGNORE_GLOBS`` applied and once without —
and asserts the measured delta equals the AST-derived count from
:func:`scripts._platform_test_filters.count_windows_only_test_functions`.
This is the mechanical drift catcher the plan calls for: if someone adds
a ``@pytest.mark.parametrize`` to an existing ``test_*_windows.py`` test
without updating the AST helper, this test fails on the first Windows CI
run because the parametrize-expanded pytest count will exceed the
AST-counted definition count.

This file lives in the ``test_*_windows.py`` namespace on purpose so that
``tests/conftest.py`` auto-excludes it on Linux/macOS via
``collect_ignore_glob`` (sourced from
:data:`scripts._platform_test_filters.PLATFORM_CONDITIONAL_IGNORE_GLOBS`).
That means:

* Linux/macOS cells never collect this file — no false failures there.
* Windows cells collect and run it — the drift check fires wherever a
  developer or CI runner has a Windows environment.
* The file self-excludes via the same mechanism it validates — meta but
  correct: if the shared constant stops matching ``*_windows.py`` files,
  this test file will itself become visible on non-Windows, break AST
  imports that assume the Windows-only file is excluded, and fail the
  parity tests in ``test_platform_conditional_collection.py`` first.

The test does NOT affect the ``--min-collected`` floor: floors track the
cross-platform (Windows-filtered) count, and this file is in the filtered
set, so adding tests here leaves the floor unchanged.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    # mypy resolves the gate under its top-level name via
    # pyproject.toml ``mypy_path = ["scripts"]``. Using the bare name
    # here (and ``importlib.import_module`` at runtime) avoids the
    # "source file found twice" dual-name error that a static
    # ``from scripts.check_ratchet_bump import ...`` would otherwise
    # trigger — the exact same workaround test_check_ratchet_bump.py
    # uses for the same file.
    import check_ratchet_bump as _gate
    from _platform_test_filters import count_windows_only_test_functions
else:
    _gate = importlib.import_module("scripts.check_ratchet_bump")
    from scripts._platform_test_filters import count_windows_only_test_functions

measure_python_count = _gate.measure_python_count
measure_windows_full_count = _gate.measure_windows_full_count

_REPO_ROOT = Path(__file__).resolve().parents[2]
_TESTS_ROOT = _REPO_ROOT / "tests"


def test_raw_windows_count_minus_filtered_equals_ast_delta() -> None:
    """Measured Windows delta MUST equal the AST-derived definition count.

    Three load-bearing invariants locked here:

    1. :func:`measure_windows_full_count` returns a concrete integer on
       Windows (not ``None``). The gate's output logic keys on this to
       decide whether to print the ``local Windows full count`` line, and
       a regression that makes the helper return ``None`` on Windows
       would silently disable the cross-platform labeling.

    2. The raw pytest collection (no ``--ignore-glob``) exceeds the
       filtered collection by exactly the number of
       ``def test_*`` / ``async def test_*`` definitions inside
       platform-conditional files. Any mismatch means either:

       * A ``test_*_windows.py`` test was parametrized without updating
         :func:`count_windows_only_test_functions` (which does NOT expand
         parametrize — documented limitation).
       * A new ``test_*_windows.py`` file was added but is not being
         collected (glob pattern drift).
       * The shared glob constant is out of sync with what conftest is
         applying.

    3. :func:`measure_python_count` returns the cross-platform minimum
       (i.e. conftest's non-Windows collection equivalent), and the
       difference to the raw Windows count is a positive integer — a
       zero delta would mean the platform-conditional filter matches
       nothing on disk, which is a regression worth failing on.
    """
    assert sys.platform == "win32", (
        "This file is named test_platform_conditional_collection_windows.py "
        "so conftest.py's collect_ignore_glob excludes it on non-Windows. "
        "Reaching this test on a non-Windows platform means either the "
        "shared PLATFORM_CONDITIONAL_IGNORE_GLOBS no longer matches this "
        "file's name, or conftest stopped applying the filter."
    )

    cross_platform_minimum = measure_python_count()
    raw_windows_total = measure_windows_full_count()

    assert raw_windows_total is not None, (
        "measure_windows_full_count() must return a concrete int on "
        "Windows; got None. The gate's output label logic depends on "
        "this value to decide whether to show the 'local Windows full "
        "count' line, and a regression here silently disables the "
        "cross-platform disambiguation."
    )

    measured_delta = raw_windows_total - cross_platform_minimum
    ast_delta = count_windows_only_test_functions(_TESTS_ROOT)

    assert measured_delta == ast_delta, (
        f"Platform-conditional collection delta mismatch.\n"
        f"  measure_python_count()          = {cross_platform_minimum} "
        f"(cross-platform minimum, Windows-filtered)\n"
        f"  measure_windows_full_count()    = {raw_windows_total} "
        f"(raw Windows collection, no filter)\n"
        f"  measured delta (raw - filtered) = {measured_delta}\n"
        f"  count_windows_only_test_functions = {ast_delta} "
        f"(AST walk of test_*_windows.py)\n"
        f"\n"
        f"If measured > ast: a test_*_windows.py test was parametrized "
        f"without updating count_windows_only_test_functions, which does "
        f"NOT expand parametrize decorators.\n"
        f"If measured < ast: a def test_* inside a test_*_windows.py file "
        f"is being skipped at collection time (conditional skip, import "
        f"error, etc.).\n"
        f"If measured == 0: the shared glob constant "
        f"PLATFORM_CONDITIONAL_IGNORE_GLOBS is no longer matching real "
        f"files on disk; check scripts/_platform_test_filters.py."
    )

    assert measured_delta > 0, (
        f"Expected a positive Windows-vs-cross-platform delta, got "
        f"{measured_delta}. A zero delta means the platform-conditional "
        f"filter matches nothing on disk, which would make the gate's "
        f"'local Windows full count' output line redundant and suggest "
        f"the shared PLATFORM_CONDITIONAL_IGNORE_GLOBS constant is out of "
        f"sync with the test suite."
    )
