"""CI guards: enforce JSONValue narrowing discipline in caller scripts.

Guard 1: No direct chained access from load_json_file() — callers must
          narrow before accessing .get() or subscripting.

Guard 2: No raw isinstance(x, dict) narrowing in caller scripts — must
          use the shared narrow_mapping/narrow_sequence helpers to avoid
          the implicit dict[str, Any] that raw isinstance produces.

Both guards use AST analysis (not regex) so they reliably catch nested
calls, commas in arguments, and formatter-driven line wrapping.
"""

from __future__ import annotations

import ast
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"

# Scripts that consume load_json_file and must use narrowing discipline
CALLER_SCRIPTS = [
    SCRIPTS_DIR / "build-demo-dataset.py",
    SCRIPTS_DIR / "generate-demo-insights.py",
    SCRIPTS_DIR / "generate-demo-predictions.py",
]


def _parse_script(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


# -----------------------------------------------------------------------
# Guard 1: No direct chained access from load_json_file()
# -----------------------------------------------------------------------


def _is_load_json_file_call(node: ast.expr) -> bool:
    """True if *node* is a call to load_json_file(...)."""
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "load_json_file"
    )


class TestNoDirectChainedJsonAccess:
    """load_json_file() returns dict[str, JSONValue] — callers must narrow first."""

    def test_no_chained_access_on_load_json_file(self) -> None:
        """Detect .attr or [subscript] directly on a load_json_file() call."""
        violations: list[str] = []
        for script in CALLER_SCRIPTS:
            tree = _parse_script(script)
            for node in ast.walk(tree):
                # Attribute access: load_json_file(...).get(...)
                if isinstance(node, ast.Attribute) and _is_load_json_file_call(
                    node.value
                ):
                    violations.append(
                        f"  {script.name}:{node.lineno}: "
                        f"load_json_file(...).{node.attr}"
                    )
                # Subscript access: load_json_file(...)[key]
                if isinstance(node, ast.Subscript) and _is_load_json_file_call(
                    node.value
                ):
                    violations.append(
                        f"  {script.name}:{node.lineno}: load_json_file(...)[...]"
                    )

        assert not violations, (
            "Direct chained access on load_json_file() bypasses narrowing.\n"
            "Assign the result to a variable first, then narrow with "
            "narrow_mapping() before accessing nested values.\n" + "\n".join(violations)
        )


# -----------------------------------------------------------------------
# Guard 2: No raw isinstance(x, dict) narrowing in caller scripts
# -----------------------------------------------------------------------


def _is_isinstance_dict(node: ast.expr) -> bool:
    """True if *node* is isinstance(<anything>, dict)."""
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    if not (isinstance(func, ast.Name) and func.id == "isinstance"):
        return False
    if len(node.args) < 2:
        return False
    second_arg = node.args[1]
    # isinstance(x, dict)
    if isinstance(second_arg, ast.Name) and second_arg.id == "dict":
        return True
    # isinstance(x, (dict, ...)) — dict inside a tuple
    if isinstance(second_arg, ast.Tuple):
        for elt in second_arg.elts:
            if isinstance(elt, ast.Name) and elt.id == "dict":
                return True
    return False


def _is_inside_validation_block(tree: ast.Module, target_lineno: int) -> bool:
    """True if the isinstance at *target_lineno* is followed by a raise within 4 lines."""
    for node in ast.walk(tree):
        if not isinstance(node, ast.Raise):
            continue
        if target_lineno < node.lineno <= target_lineno + 4:
            return True
    # Also allow `not isinstance(...)` on the same line as an if that leads to raise
    for node in ast.walk(tree):
        if not isinstance(node, ast.If):
            continue
        if node.lineno != target_lineno:
            continue
        for child in ast.walk(node):
            if isinstance(child, ast.Raise):
                return True
    return False


class TestNoRawIsinstanceDictNarrowing:
    """Raw isinstance(x, dict) leaks implicit Any — use narrow_mapping() instead."""

    def test_no_raw_isinstance_dict_in_caller_scripts(self) -> None:
        violations: list[str] = []
        for script in CALLER_SCRIPTS:
            tree = _parse_script(script)
            source_lines = script.read_text(encoding="utf-8").splitlines()

            for node in ast.walk(tree):
                if not _is_isinstance_dict(node):
                    continue
                if _is_inside_validation_block(tree, node.lineno):
                    continue

                line_text = (
                    source_lines[node.lineno - 1].strip()
                    if node.lineno <= len(source_lines)
                    else ""
                )
                violations.append(f"  {script.name}:{node.lineno}: {line_text}")

        assert not violations, (
            "Raw isinstance(x, dict) narrows to dict[str, Any] in mypy, "
            "leaking implicit Any.\n"
            "Use narrow_mapping(val) from demo_generation_common instead, "
            "or convert to a fail-fast validation (isinstance + raise).\n"
            + "\n".join(violations)
        )
