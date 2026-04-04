"""CI guards: enforce JSONValue narrowing discipline in caller scripts.

Guard 1: No direct chained access from load_json_file() — callers must
          narrow before accessing .get() or subscripting.

Guard 2: No raw isinstance(x, dict) narrowing in caller scripts — must
          use the shared narrow_mapping/narrow_sequence helpers to avoid
          the implicit dict[str, Any] that raw isinstance produces.

Both guards use AST analysis so they reliably catch nested calls,
commas in arguments, and formatter-driven line wrapping.
"""

from __future__ import annotations

import ast
import textwrap
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"


def _imports_load_json_file(path: Path) -> bool:
    """True if *path* contains an import of ``load_json_file`` (AST-based)."""
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except SyntaxError:
        return False
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name == "load_json_file":
                    return True
        # Also catch bare `import demo_generation_common` + attribute access,
        # but the primary pattern in this repo is `from ... import load_json_file`.
    return False


def _discover_caller_scripts() -> list[Path]:
    """Auto-discover scripts/ files that import load_json_file."""
    # demo_generation_common.py *defines* load_json_file — it is not a caller.
    return sorted(
        path
        for path in SCRIPTS_DIR.glob("*.py")
        if path.name != "demo_generation_common.py" and _imports_load_json_file(path)
    )


# Auto-discovered: scripts that consume load_json_file and must use narrowing discipline
CALLER_SCRIPTS = _discover_caller_scripts()


def _parse(source: str, filename: str = "<test>") -> ast.Module:
    return ast.parse(source, filename=filename)


def _parse_script(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


# -----------------------------------------------------------------------
# Guard 1: No direct chained access from load_json_file()
# -----------------------------------------------------------------------


def _is_load_json_file_call(node: ast.expr) -> bool:
    """True if *node* is a call to load_json_file(...) (bare or qualified)."""
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    # Bare: load_json_file(...)
    if isinstance(func, ast.Name) and func.id == "load_json_file":
        return True
    # Qualified: something.load_json_file(...)
    if isinstance(func, ast.Attribute) and func.attr == "load_json_file":
        return True
    return False


def find_chained_json_access(tree: ast.Module) -> list[int]:
    """Return line numbers where load_json_file() result is accessed directly."""
    lines: list[int] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and _is_load_json_file_call(node.value):
            lines.append(node.lineno)
        if isinstance(node, ast.Subscript) and _is_load_json_file_call(node.value):
            lines.append(node.lineno)
    return lines


class TestNoDirectChainedJsonAccess:
    """load_json_file() returns dict[str, JSONValue] — callers must narrow first."""

    def test_no_chained_access_in_caller_scripts(self) -> None:
        violations: list[str] = []
        for script in CALLER_SCRIPTS:
            tree = _parse_script(script)
            source_lines = script.read_text(encoding="utf-8").splitlines()
            for lineno in find_chained_json_access(tree):
                line_text = (
                    source_lines[lineno - 1].strip()
                    if lineno <= len(source_lines)
                    else ""
                )
                violations.append(f"  {script.name}:{lineno}: {line_text}")

        assert not violations, (
            "Direct chained access on load_json_file() bypasses narrowing.\n"
            "Assign the result to a variable first, then narrow with "
            "narrow_mapping() before accessing nested values.\n" + "\n".join(violations)
        )

    def test_catches_bare_call(self) -> None:
        tree = _parse('x = load_json_file(p).get("k")')
        assert find_chained_json_access(tree) == [1]

    def test_catches_qualified_call(self) -> None:
        tree = _parse('x = common.load_json_file(p).get("k")')
        assert find_chained_json_access(tree) == [1]

    def test_catches_subscript(self) -> None:
        tree = _parse('x = load_json_file(p)["key"]')
        assert find_chained_json_access(tree) == [1]

    def test_allows_assigned_then_accessed(self) -> None:
        tree = _parse('data = load_json_file(p)\nx = data.get("k")')
        assert find_chained_json_access(tree) == []


# -----------------------------------------------------------------------
# Guard 2: No raw isinstance(x, dict) narrowing in caller scripts
# -----------------------------------------------------------------------


def _is_isinstance_dict(node: ast.expr) -> bool:
    """True if *node* is isinstance(<anything>, dict) or isinstance(<anything>, (..., dict, ...))."""
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    if not (isinstance(func, ast.Name) and func.id == "isinstance"):
        return False
    if len(node.args) < 2:
        return False
    second_arg = node.args[1]
    if isinstance(second_arg, ast.Name) and second_arg.id == "dict":
        return True
    if isinstance(second_arg, ast.Tuple):
        for elt in second_arg.elts:
            if isinstance(elt, ast.Name) and elt.id == "dict":
                return True
    return False


def _is_terminal_call(node: ast.Call) -> bool:
    """True if *node* is exactly sys.exit(...)."""
    func = node.func
    return (
        isinstance(func, ast.Attribute)
        and func.attr == "exit"
        and isinstance(func.value, ast.Name)
        and func.value.id == "sys"
    )


def _body_unconditionally_exits(body: list[ast.stmt]) -> bool:
    """True if *body* unconditionally terminates (raise/return/sys.exit).

    Only top-level statements count.  Nested conditionals, try/except,
    and non-approved calls do not qualify.
    """
    for stmt in body:
        if isinstance(stmt, (ast.Raise, ast.Return)):
            return True
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call):
            if _is_terminal_call(stmt.value):
                return True
    return False


def _test_has_not_isinstance_dict(test: ast.expr) -> bool:
    """True if *test* contains `not isinstance(x, dict)` (simple or compound `or`)."""
    # Simple: not isinstance(x, dict)
    if isinstance(test, ast.UnaryOp) and isinstance(test.op, ast.Not):
        if _is_isinstance_dict(test.operand):
            return True
    # Compound: not isinstance(x, dict) or ...
    if isinstance(test, ast.BoolOp) and isinstance(test.op, ast.Or):
        for val in test.values:
            if isinstance(val, ast.UnaryOp) and isinstance(val.op, ast.Not):
                if _is_isinstance_dict(val.operand):
                    return True
    return False


def _is_failfast_isinstance(node: ast.If) -> bool:
    """True if this `if` is a fail-fast validation that raises for non-dict.

    Matches any `if not isinstance(x, dict) [or ...]:` block whose body
    contains a raise anywhere — including after variable assignments,
    logging calls, or nested conditionals.

    Does NOT match positive-branch isinstance or ternary defaults.
    """
    if not _test_has_not_isinstance_dict(node.test):
        return False
    return _body_unconditionally_exits(node.body)


def find_raw_isinstance_dict(tree: ast.Module) -> list[int]:
    """Return line numbers of raw isinstance(x, dict) that are NOT fail-fast validation."""
    # Collect line numbers of isinstance calls in approved fail-fast if-blocks
    approved_lines: set[int] = set()
    for node in ast.walk(tree):
        if not (isinstance(node, ast.If) and _is_failfast_isinstance(node)):
            continue
        # Extract the isinstance call lineno from the test expression
        test = node.test
        if isinstance(test, ast.UnaryOp) and isinstance(test.op, ast.Not):
            if _is_isinstance_dict(test.operand):
                approved_lines.add(test.operand.lineno)
        if isinstance(test, ast.BoolOp):
            for val in test.values:
                if isinstance(val, ast.UnaryOp) and isinstance(val.op, ast.Not):
                    if _is_isinstance_dict(val.operand):
                        approved_lines.add(val.operand.lineno)

    violations: list[int] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.expr):
            continue
        if _is_isinstance_dict(node) and node.lineno not in approved_lines:
            violations.append(node.lineno)
    return violations


class TestNoRawIsinstanceDictNarrowing:
    """Raw isinstance(x, dict) leaks implicit Any — use narrow_mapping() instead."""

    def test_no_raw_isinstance_dict_in_caller_scripts(self) -> None:
        violations: list[str] = []
        for script in CALLER_SCRIPTS:
            tree = _parse_script(script)
            source_lines = script.read_text(encoding="utf-8").splitlines()
            for lineno in find_raw_isinstance_dict(tree):
                line_text = (
                    source_lines[lineno - 1].strip()
                    if lineno <= len(source_lines)
                    else ""
                )
                violations.append(f"  {script.name}:{lineno}: {line_text}")

        assert not violations, (
            "Raw isinstance(x, dict) narrows to dict[str, Any] in mypy, "
            "leaking implicit Any.\n"
            "Use narrow_mapping(val) from demo_generation_common instead, "
            "or convert to a fail-fast validation: "
            "`if not isinstance(x, dict): raise TypeError(...)`.\n"
            + "\n".join(violations)
        )

    def test_catches_ternary_default(self) -> None:
        """x if isinstance(x, dict) else {} — the silent-default pattern."""
        tree = _parse("y = x if isinstance(x, dict) else {}")
        assert find_raw_isinstance_dict(tree) == [1]

    def test_catches_isinstance_with_get_arg(self) -> None:
        """isinstance(rollup.get('by_reviewer'), dict) — commas in first arg."""
        tree = _parse('ok = isinstance(rollup.get("by_reviewer"), dict)')
        assert find_raw_isinstance_dict(tree) == [1]

    def test_catches_nearby_unrelated_raise(self) -> None:
        """A raise on a later line for a different condition must NOT exempt the isinstance."""
        source = textwrap.dedent("""\
            by_rev = x if isinstance(x, dict) else {}
            if "key" not in by_rev:
                raise RuntimeError("missing key")
        """)
        tree = _parse(source)
        assert find_raw_isinstance_dict(tree) == [1]

    def test_allows_failfast_not_isinstance_raise(self) -> None:
        """if not isinstance(x, dict): raise TypeError(...) — the approved pattern."""
        source = textwrap.dedent("""\
            if not isinstance(val, dict):
                raise TypeError("expected dict")
        """)
        tree = _parse(source)
        assert find_raw_isinstance_dict(tree) == []

    def test_allows_assigned_message_then_raise(self) -> None:
        source = textwrap.dedent("""\
            if not isinstance(val, dict):
                msg = f"expected dict, got {type(val).__name__}"
                raise TypeError(msg)
        """)
        tree = _parse(source)
        assert find_raw_isinstance_dict(tree) == []

    def test_allows_nested_log_then_raise(self) -> None:
        source = textwrap.dedent("""\
            if not isinstance(val, dict):
                if debug:
                    log(val)
                raise TypeError("expected dict")
        """)
        tree = _parse(source)
        assert find_raw_isinstance_dict(tree) == []

    def test_allows_compound_failfast(self) -> None:
        """if not isinstance(x, dict) or not x: raise ... — compound validation."""
        source = textwrap.dedent("""\
            if not isinstance(val, dict) or not val:
                raise TypeError("expected non-empty dict")
        """)
        tree = _parse(source)
        assert find_raw_isinstance_dict(tree) == []

    def test_rejects_conditional_raise_with_continuation(self) -> None:
        """Raise inside a nested conditional — control can continue past it."""
        source = textwrap.dedent("""\
            if not isinstance(val, dict):
                if debug:
                    raise TypeError("expected dict")
                recover()
        """)
        tree = _parse(source)
        assert find_raw_isinstance_dict(tree) == [1]

    def test_rejects_caught_raise_with_continuation(self) -> None:
        """Raise inside try/except — caught and continued, not a real exit."""
        source = textwrap.dedent("""\
            if not isinstance(val, dict):
                try:
                    raise TypeError("expected dict")
                except TypeError:
                    recover()
        """)
        tree = _parse(source)
        assert find_raw_isinstance_dict(tree) == [1]

    def test_allows_sys_exit(self) -> None:
        source = textwrap.dedent("""\
            if not isinstance(val, dict):
                sys.exit(1)
        """)
        tree = _parse(source)
        assert find_raw_isinstance_dict(tree) == []

    def test_rejects_bare_exit(self) -> None:
        source = textwrap.dedent("""\
            if not isinstance(val, dict):
                exit(1)
        """)
        tree = _parse(source)
        assert find_raw_isinstance_dict(tree) == [1]

    def test_rejects_shadowed_exit(self) -> None:
        source = textwrap.dedent("""\
            def exit(code=None):
                return None
            if not isinstance(val, dict):
                exit(1)
        """)
        tree = _parse(source)
        assert find_raw_isinstance_dict(tree) == [3]

    def test_rejects_logger_exit(self) -> None:
        source = textwrap.dedent("""\
            if not isinstance(val, dict):
                logger.exit("expected dict")
        """)
        tree = _parse(source)
        assert find_raw_isinstance_dict(tree) == [1]

    def test_rejects_client_exit(self) -> None:
        source = textwrap.dedent("""\
            if not isinstance(val, dict):
                client.exit()
        """)
        tree = _parse(source)
        assert find_raw_isinstance_dict(tree) == [1]

    def test_rejects_isinstance_in_positive_if(self) -> None:
        """if isinstance(x, dict): ... — positive branch, no raise for non-dict."""
        source = textwrap.dedent("""\
            if isinstance(x, dict):
                use(x)
        """)
        tree = _parse(source)
        assert find_raw_isinstance_dict(tree) == [1]


# -----------------------------------------------------------------------
# Guard 3: Auto-discovery covers all load_json_file callers
# -----------------------------------------------------------------------


class TestCallerScriptsAutoDiscovery:
    """CALLER_SCRIPTS must be auto-discovered, not a stale hard-coded list."""

    def test_known_callers_are_discovered(self) -> None:
        """The three original callers must still be in the auto-discovered set."""
        names = {p.name for p in CALLER_SCRIPTS}
        assert "build-demo-dataset.py" in names
        assert "generate-demo-insights.py" in names
        assert "generate-demo-predictions.py" in names

    def test_discovery_excludes_definer(self) -> None:
        """demo_generation_common.py defines load_json_file — it is not a caller."""
        names = {p.name for p in CALLER_SCRIPTS}
        assert "demo_generation_common.py" not in names

    def test_temporary_script_is_auto_discovered(self, tmp_path: Path) -> None:
        """A new script importing load_json_file is picked up by discovery."""
        # Write a temporary script into scripts/ — but we don't want to pollute
        # the real directory, so test the discovery function directly.
        fake_script = tmp_path / "fake_caller.py"
        fake_script.write_text(
            "from demo_generation_common import load_json_file\n",
            encoding="utf-8",
        )
        assert _imports_load_json_file(fake_script)

    def test_non_caller_script_excluded(self, tmp_path: Path) -> None:
        """A script that does NOT import load_json_file is excluded."""
        fake_script = tmp_path / "unrelated.py"
        fake_script.write_text("import json\n", encoding="utf-8")
        assert not _imports_load_json_file(fake_script)
