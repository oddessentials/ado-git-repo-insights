"""Lock the shared platform-conditional filter contract between gate and conftest.

``scripts/_platform_test_filters.py`` is the single source of truth for the
glob patterns that mark tests as platform-conditional. Two independent call
sites must apply those globs consistently:

1. ``tests/conftest.py`` — uses them in ``collect_ignore_glob`` on non-Windows
   platforms so pytest never tries to collect (and therefore never skips)
   ``test_*_windows.py`` files on Linux/macOS. This is how the zero-skip CI
   policy is satisfied for platform-specific tests.

2. ``scripts/check_ratchet_bump.py`` — uses them to build
   ``--ignore-glob=<pattern>`` CLI flags for its hermetic subprocess pytest
   collection. This is how the gate's "cross-platform minimum" Python count
   matches what Linux/macOS cells actually collect.

If either site stops importing the shared constant, the filter sets can
drift and the gate's floor will diverge from CI's real collection count on
non-Windows runners — which is exactly the silent-parity failure the
ratchet-bump guard (#280) exists to prevent. The AST-level parity test
below fails loudly and independently on either side so a one-sided
regression cannot slip through.
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    # mypy resolves the helper under its top-level name via
    # pyproject.toml ``mypy_path = ["scripts"]``. Using the bare name
    # here avoids the "source file found twice" dual-name error that
    # ``from scripts._platform_test_filters import ...`` would
    # otherwise trigger when mypy walks both this file AND
    # ``scripts/_platform_test_filters.py``.
    from _platform_test_filters import (
        PLATFORM_CONDITIONAL_IGNORE_GLOBS,
        count_windows_only_test_functions,
        glob_windows_only_test_files,
    )
else:
    # Runtime: ``scripts`` is an importable PEP 420 namespace package
    # from the project root.
    from scripts._platform_test_filters import (
        PLATFORM_CONDITIONAL_IGNORE_GLOBS,
        count_windows_only_test_functions,
        glob_windows_only_test_files,
    )

_REPO_ROOT = Path(__file__).resolve().parents[2]
_TESTS_ROOT = _REPO_ROOT / "tests"
_CONFTEST_PATH = _TESTS_ROOT / "conftest.py"
_GATE_PATH = _REPO_ROOT / "scripts" / "check_ratchet_bump.py"

_SHARED_CONSTANT_NAME = "PLATFORM_CONDITIONAL_IGNORE_GLOBS"
_SHARED_MODULE_SUFFIX = "_platform_test_filters"


def _file_imports_shared_constant(path: Path) -> bool:
    """Return True if ``path`` imports ``PLATFORM_CONDITIONAL_IGNORE_GLOBS``.

    Accepts any of the three equivalent ImportFrom forms the gate and
    conftest use:

    * ``from scripts._platform_test_filters import PLATFORM_CONDITIONAL_IGNORE_GLOBS``
      (conftest.py form — explicit package qualification)
    * ``from ._platform_test_filters import PLATFORM_CONDITIONAL_IGNORE_GLOBS``
      (gate relative-import runtime fallback for ``python -m`` mode)
    * ``from _platform_test_filters import PLATFORM_CONDITIONAL_IGNORE_GLOBS``
      (gate TYPE_CHECKING / direct-script runtime fallback)

    Any ``ImportFrom`` whose module name ends with ``_platform_test_filters``
    and whose imported names include ``PLATFORM_CONDITIONAL_IGNORE_GLOBS``
    satisfies the check. Bare ``import X`` forms do NOT satisfy the check —
    they import the module object but do not bind the constant by name,
    so a caller could pass the wrong object to pytest without a
    typechecker catching it.
    """
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(path))
    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom):
            continue
        module = node.module or ""
        if not module.endswith(_SHARED_MODULE_SUFFIX):
            continue
        names = {alias.name for alias in node.names}
        if _SHARED_CONSTANT_NAME in names:
            return True
    return False


def test_conftest_imports_shared_platform_conditional_globs() -> None:
    """``tests/conftest.py`` MUST import the shared constant.

    If this test fails: ``tests/conftest.py`` stopped importing
    ``PLATFORM_CONDITIONAL_IGNORE_GLOBS`` from
    ``scripts._platform_test_filters``. A literal glob list in
    ``collect_ignore_glob`` will drift from what the ratchet-bump gate
    filters, and the gate's "cross-platform minimum" will no longer match
    what Linux/macOS cells actually collect — silently reopening the
    parity hole that #280 exists to close.
    """
    assert _file_imports_shared_constant(_CONFTEST_PATH), (
        f"{_CONFTEST_PATH.relative_to(_REPO_ROOT)} must import "
        f"{_SHARED_CONSTANT_NAME} from scripts._platform_test_filters "
        "so the conftest and the ratchet-bump gate share one source of "
        "truth for platform-conditional pytest filters. A literal "
        "collect_ignore_glob list will drift from the gate's --ignore-glob "
        "flags and silently break the Python cross-platform minimum."
    )


def test_ratchet_bump_gate_imports_shared_platform_conditional_globs() -> None:
    """``scripts/check_ratchet_bump.py`` MUST import the shared constant.

    If this test fails: ``scripts/check_ratchet_bump.py`` stopped importing
    ``PLATFORM_CONDITIONAL_IGNORE_GLOBS`` from
    ``scripts._platform_test_filters``. A literal ``--ignore-glob`` flag in
    ``_run_collect_subprocess`` will drift from what ``tests/conftest.py``
    filters, and the gate's "cross-platform minimum" will stop matching
    what Linux/macOS cells actually collect — silently reopening the
    parity hole that #280 exists to close.
    """
    assert _file_imports_shared_constant(_GATE_PATH), (
        f"{_GATE_PATH.relative_to(_REPO_ROOT)} must import "
        f"{_SHARED_CONSTANT_NAME} from scripts._platform_test_filters "
        "so the conftest and the ratchet-bump gate share one source of "
        "truth for platform-conditional pytest filters. A literal "
        "--ignore-glob flag will drift from conftest's collect_ignore_glob "
        "and silently break the Python cross-platform minimum."
    )


def test_platform_delta_is_mechanically_derived_from_file_tree() -> None:
    """The Windows-delta is computed at runtime from the file tree.

    The gate prints ``local Windows full count: N`` on Windows. The
    difference ``N - cross_platform_minimum`` is the number of
    platform-conditional tests. That number is never hardcoded in source
    or docs — it is derived from ``count_windows_only_test_functions``,
    which AST-walks every file matching
    ``PLATFORM_CONDITIONAL_IGNORE_GLOBS``. A new ``test_*_windows.py``
    file or a new ``def test_*`` inside an existing one self-updates the
    expected delta without touching any documentation.

    The assertion here is intentionally weak (``> 0``): the strong
    drift-catcher is the Windows-only measured test in
    ``test_platform_conditional_collection_windows.py`` which runs
    pytest with and without the filter and asserts the measured delta
    equals the AST-derived count. This cross-platform test only guards
    against total disappearance of the file tree — a regression where
    someone removes every platform-conditional file without updating
    the gate's expectations.
    """
    assert PLATFORM_CONDITIONAL_IGNORE_GLOBS, (
        "PLATFORM_CONDITIONAL_IGNORE_GLOBS must not be empty; at least "
        "one pattern is required for the gate's ignore_glob_cli_args() "
        "helper to have a meaningful effect."
    )
    delta = count_windows_only_test_functions(_TESTS_ROOT)
    assert delta > 0, (
        f"Expected at least one platform-conditional test function under "
        f"{_TESTS_ROOT.relative_to(_REPO_ROOT)}, but "
        f"count_windows_only_test_functions returned {delta}. Either the "
        f"file tree lost every test_*_windows.py file (check `git log -- "
        f"tests/**/test_*_windows.py`), or the glob pattern "
        f"{PLATFORM_CONDITIONAL_IGNORE_GLOBS!r} no longer matches the "
        "naming convention used by those files."
    )
    files = glob_windows_only_test_files(_TESTS_ROOT)
    assert files, (
        f"glob_windows_only_test_files returned no files even though "
        f"count_windows_only_test_functions returned {delta}; the two "
        f"helpers must agree. Check scripts/_platform_test_filters.py."
    )
    for file in files:
        name = file.name
        relative = file.relative_to(_REPO_ROOT)
        assert name.startswith("test_"), (
            f"Platform-conditional file {relative} must start with "
            f"'test_' so pytest's default test discovery finds it."
        )
        assert name.endswith("_windows.py"), (
            f"Platform-conditional file {relative} must end with "
            f"'_windows.py' so conftest's collect_ignore_glob and the "
            f"gate's --ignore-glob patterns match it."
        )
