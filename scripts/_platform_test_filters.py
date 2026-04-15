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
* :func:`glob_windows_only_test_files` — enumerate all ``test_*_windows.py``
  files under a ``tests`` root. Used by the drift-catching test.
* :func:`count_windows_only_test_functions` — AST-count the
  module-level and class-level ``def test_*`` / ``async def test_*``
  definitions inside those files. The count is the authoritative
  Windows-vs-cross-platform delta used for the gate's output label.

Parametrize limitation (deliberate): :func:`count_windows_only_test_functions`
counts test definitions *source-wise*. If a Windows-only test is decorated
with ``@pytest.mark.parametrize`` the AST count will under-report the real
pytest item count by the expansion factor. This is NOT papered over here —
the Windows-only measured test in
``tests/unit/test_platform_conditional_collection_windows.py`` runs pytest
``--collect-only`` with and without the ignore globs and asserts
``raw - filtered == count_windows_only_test_functions(...)``, so a
parametrize expansion that diverges from the AST count fails the test
immediately on the first Windows run.
"""

from __future__ import annotations

import ast
from pathlib import Path

PLATFORM_CONDITIONAL_IGNORE_GLOBS: tuple[str, ...] = ("**/test_*_windows.py",)
"""Canonical glob patterns for platform-conditional pytest files.

Matches files under ``tests/`` whose names follow the ``test_*_windows.py``
convention. The ``**/`` prefix handles nested subdirectories so tests can
live under ``tests/unit/``, ``tests/integration/``, etc., without the
conftest hook needing per-subdirectory glob entries.

When a new OS convention is added (``test_*_linux.py``, ``test_*_macos.py``),
append the new pattern here — both conftest and the ratchet-bump gate
pick it up automatically.
"""


def glob_windows_only_test_files(tests_root: Path) -> list[Path]:
    """Return every ``test_*_windows.py`` file under ``tests_root``.

    Returned list is sorted for deterministic ordering across platforms
    (``Path.rglob`` order is OS-dependent). The input path must point
    at a directory containing the project's pytest suite (e.g. the
    repository's ``tests/`` directory); a non-directory or missing path
    yields an empty list.
    """
    if not tests_root.is_dir():
        return []
    return sorted(tests_root.rglob("test_*_windows.py"))


def count_windows_only_test_functions(tests_root: Path) -> int:
    """Return the AST-derived count of ``test_*`` functions under Windows-only files.

    Walks each file matched by :func:`glob_windows_only_test_files`,
    parses the source once, and counts ``def test_*`` /
    ``async def test_*`` definitions at module scope and inside class
    bodies. Function bodies are NOT recursed into, so helper functions
    nested inside a test method never accidentally inflate the count.

    Parametrize decorators are NOT expanded — see the module docstring
    for why. Callers that need the parametrize-expanded item count must
    run pytest ``--collect-only`` directly.
    """
    total = 0
    for file in glob_windows_only_test_files(tests_root):
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
