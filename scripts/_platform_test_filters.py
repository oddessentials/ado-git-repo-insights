"""Single source of truth for platform-conditional pytest collection filters.

Both ``tests/conftest.py`` and ``scripts/check_ratchet_bump.py`` must apply
the exact same set of platform-conditional ignore globs — otherwise the
ratchet-bump gate's "cross-platform minimum" measurement can silently
diverge from what the pytest session on Linux/macOS would actually collect.
This module is that single source of truth.

Contract:

* :data:`PLATFORM_CONDITIONAL_IGNORE_GLOBS` — the canonical tuple of glob
  patterns that match test files which must NEVER run outside their
  target platform. ``tests/conftest.py`` feeds this to pytest's
  ``collect_ignore_glob`` hook on non-Windows platforms;
  :func:`scripts.check_ratchet_bump._run_collect_subprocess` builds
  ``--ignore-glob=<pattern>`` CLI flags from the same tuple for its
  hermetic pytest subprocess. The AST parity test in
  ``tests/unit/test_platform_conditional_collection.py`` enforces that
  both consumers import this constant directly — not a derived helper —
  so either side dropping the import fails the test immediately.
* :func:`glob_platform_conditional_test_files` — enumerate every file
  matched by :data:`PLATFORM_CONDITIONAL_IGNORE_GLOBS` under a ``tests``
  root. The helper iterates over the full tuple so adding a new OS
  convention (``test_*_linux.py``, ``test_*_macos.py``, etc.) to the
  constant automatically expands the helper's match set without any
  second edit — the tuple is the ONLY place the filter surface is
  declared.
* :func:`count_platform_conditional_test_functions` — AST-count the
  module-level and class-level ``def test_*`` / ``async def test_*``
  definitions inside those files. The count is the authoritative
  platform-vs-cross-platform delta used for the gate's output label.

Parametrize limitation (deliberate):
:func:`count_platform_conditional_test_functions` counts test
definitions *source-wise*. If a platform-conditional test is decorated
with ``@pytest.mark.parametrize`` the AST count will under-report the
real pytest item count by the expansion factor. This is NOT papered
over here — the Windows-only measured test in
``tests/unit/test_platform_conditional_collection_windows.py`` runs
pytest ``--collect-only`` with and without the ignore globs and asserts
``raw - filtered == count_platform_conditional_test_functions(...)``,
so a parametrize expansion that diverges from the AST count fails the
test immediately on the first Windows run.
"""

from __future__ import annotations

import ast
from pathlib import Path

PLATFORM_CONDITIONAL_IGNORE_GLOBS: tuple[str, ...] = ("**/test_*_windows.py",)
"""Canonical glob patterns for platform-conditional pytest files.

Matches files under ``tests/`` whose names follow the ``test_*_windows.py``
convention. The ``**/`` prefix is pytest ``collect_ignore_glob`` syntax for
"match at any depth"; both consumers of this tuple handle that prefix
correctly (pytest natively, and the ``Path.rglob``-backed helpers in this
module via :func:`_pytest_glob_to_rglob_pattern`).

When a new OS convention is added (``test_*_linux.py``, ``test_*_macos.py``),
append the new pattern here — ``tests/conftest.py``, the ratchet-bump gate,
and :func:`glob_platform_conditional_test_files` /
:func:`count_platform_conditional_test_functions` all pick it up
automatically. No second edit required.
"""


def _pytest_glob_to_rglob_pattern(pytest_glob: str) -> str:
    """Convert a pytest ``collect_ignore_glob`` pattern to ``Path.rglob``.

    pytest's ``collect_ignore_glob`` uses ``**/<name>`` to mean "match
    ``<name>`` at any depth under the test root". :meth:`pathlib.Path.rglob`
    is already recursive, so a leading ``**/`` is redundant — and double-
    ``**`` glob expansions have historically had subtle cross-version
    quirks. Stripping the prefix normalizes every tuple entry to a plain
    file-basename pattern that ``rglob`` handles unambiguously. Patterns
    without the prefix pass through unchanged so a future entry like
    ``"test_special_case.py"`` would still work.
    """
    if pytest_glob.startswith("**/"):
        return pytest_glob[3:]
    return pytest_glob


def glob_platform_conditional_test_files(tests_root: Path) -> list[Path]:
    """Return every platform-conditional test file under ``tests_root``.

    Iterates over :data:`PLATFORM_CONDITIONAL_IGNORE_GLOBS`, converts each
    entry to a ``Path.rglob``-compatible pattern, and collects every
    matching file. Results are de-duplicated (if two patterns match the
    same file) and sorted for deterministic ordering across platforms
    (``Path.rglob`` result order is OS-dependent).

    The input path must point at a directory containing the project's
    pytest suite (e.g. the repository's ``tests/`` directory); a
    non-directory or missing path yields an empty list.
    """
    if not tests_root.is_dir():
        return []
    matches: set[Path] = set()
    for pytest_glob in PLATFORM_CONDITIONAL_IGNORE_GLOBS:
        rglob_pattern = _pytest_glob_to_rglob_pattern(pytest_glob)
        matches.update(tests_root.rglob(rglob_pattern))
    return sorted(matches)


def count_platform_conditional_test_functions(tests_root: Path) -> int:
    """Return the AST-derived ``test_*`` function count across platform files.

    Walks every file returned by
    :func:`glob_platform_conditional_test_files`, parses each source
    once, and counts ``def test_*`` / ``async def test_*`` definitions
    at module scope and inside class bodies. Function bodies are NOT
    recursed into, so helper functions nested inside a test method
    never accidentally inflate the count.

    Parametrize decorators are NOT expanded — see the module docstring
    for why. Callers that need the parametrize-expanded item count must
    run pytest ``--collect-only`` directly (the Windows-only measured
    drift test does exactly this and fails if the two counts diverge).
    """
    total = 0
    for file in glob_platform_conditional_test_files(tests_root):
        try:
            source = file.read_text(encoding="utf-8")
        except OSError:
            continue
        try:
            tree = ast.parse(source, filename=str(file))
        except SyntaxError:
            continue
        total += _count_test_definitions_in_module(tree)
    return total


def _count_test_definitions_in_module(tree: ast.Module) -> int:
    """Count module-level + class-level ``test_*`` definitions, no recursion."""
    count = 0
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name.startswith("test_"):
                count += 1
        elif isinstance(node, ast.ClassDef):
            for child in node.body:
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    if child.name.startswith("test_"):
                        count += 1
    return count
