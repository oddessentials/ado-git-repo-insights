"""AST regression lock: no test or script may shell out via bare ``python``.

Repo-owned Python code that spawns a Python subprocess MUST use
``sys.executable`` (or another resolved interpreter path), never the bare
string ``"python"``. The bare form depends on whether the developer
activated the venv or has ``python-is-python3`` symlinked, neither of
which the project's setup contract assumes.

This rule was tightened in 2026-05 after
``tests/unit/test_any_type_scanner.py::test_no_any_identifiers_in_src``
(which used ``subprocess.run(["python", "-c", …])``) failed under the
preflight chain on a Linux/WSL workstation that had not run
``source .venv/bin/activate``. The fix was twofold:

1. Repo-wide: tests/scripts use ``sys.executable`` instead of bare
   ``"python"`` — locked by this test.
2. Orchestrator: ``scripts/run_pr_preflight.py::prepend_venv_to_path()``
   prepends ``.venv/bin`` (or ``.venv/Scripts``) so direct preflight
   invocations don't require shell activation either.

Detection is AST-based, not regex, so string-literal fixtures embedded
inside test bodies (e.g. the ``"import subprocess\\nresult = subprocess.run(…)"``
fixture in ``tests/unit/test_rule_disable_invariants.py``) are never
flagged — those are checking that the audit catches the pattern, not
spawning Python themselves.
"""

from __future__ import annotations

import ast
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

_SUBPROCESS_SPAWN_FUNCS = frozenset(
    {"run", "check_call", "check_output", "Popen", "call"}
)


def _is_subprocess_spawn_call(node: ast.Call) -> bool:
    """Return True if ``node`` is a call to a known subprocess spawn function.

    Matches both qualified (``subprocess.run(...)``) and bare (``run(...)``)
    forms in case the test imports the function directly. The bare form
    is rare but cheap to cover.
    """
    func = node.func
    if isinstance(func, ast.Attribute):
        if func.attr not in _SUBPROCESS_SPAWN_FUNCS:
            return False
        # subprocess.run / subprocess.Popen / etc.
        if isinstance(func.value, ast.Name) and func.value.id == "subprocess":
            return True
        return False
    if isinstance(func, ast.Name):
        return func.id in _SUBPROCESS_SPAWN_FUNCS
    return False


def _first_argv_element_is_bare_python(node: ast.Call) -> bool:
    """Return True if the call's first positional arg is a list literal whose
    first element is the string literal ``"python"``.

    Skips:
        - Calls with no positional args (would be a different kind of bug).
        - Calls whose first arg is not a list literal (variables, joined strings,
          dynamic args). Those are ALREADY flagged by the ``S603`` audit and are
          out of this lock's scope.
        - Empty list literals (no first element to test).
        - First elements that are not constant strings (variables, f-strings).
    """
    if not node.args:
        return False
    first = node.args[0]
    if not isinstance(first, ast.List) or not first.elts:
        return False
    head = first.elts[0]
    return isinstance(head, ast.Constant) and head.value == "python"


def _scan_file(py_file: Path) -> list[tuple[int, str]]:
    """Return ``[(line_number, source_excerpt), …]`` for every offending call.

    A non-empty result means the file contains at least one
    ``subprocess.<spawn>(["python", …])`` call. Source excerpts are the
    AST-unparsed call (``ast.unparse``) — stable across formatter changes.
    """
    try:
        source = py_file.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []
    try:
        tree = ast.parse(source, filename=str(py_file))
    except SyntaxError:
        return []
    offenders: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if not _is_subprocess_spawn_call(node):
            continue
        if _first_argv_element_is_bare_python(node):
            offenders.append((node.lineno, ast.unparse(node)))
    return offenders


def test_no_bare_python_in_subprocess_calls() -> None:
    """No real subprocess spawn in the repo may pass ``"python"`` as argv[0].

    Use ``sys.executable`` (the canonical idiom — it spawns the same
    interpreter that's running the test/script). Bare ``"python"``
    requires either venv activation or a system ``python-is-python3``
    symlink, neither of which we assume.
    """
    scan_roots = [
        REPO_ROOT / "tests",
        REPO_ROOT / "scripts",
        REPO_ROOT / ".github" / "scripts",
    ]
    offenders: list[str] = []
    for scan_root in scan_roots:
        if not scan_root.is_dir():
            continue
        for py_file in sorted(scan_root.rglob("*.py")):
            for line_no, excerpt in _scan_file(py_file):
                rel = py_file.relative_to(REPO_ROOT)
                offenders.append(f"{rel}:{line_no}: {excerpt}")

    assert not offenders, (
        "Subprocess spawns must use sys.executable (or another resolved "
        "interpreter path), not bare 'python'. The bare form depends on "
        "venv activation or a system python-is-python3 symlink that the "
        "project setup does not assume.\n  Offenders:\n    " + "\n    ".join(offenders)
    )
