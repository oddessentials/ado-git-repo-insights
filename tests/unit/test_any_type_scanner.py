"""FR-011: Validate the Any-type ratchet scanner (check_no_any_types.py).

Ensures the token-based scanner correctly handles replacement patterns,
aliased imports, identifier shadowing, and comments/strings.

FR-012: Verify no variable/class/function in src/ is named ``Any``.
"""

from __future__ import annotations

import importlib.util
import subprocess
import textwrap
from pathlib import Path

# Import the scanner's core function directly
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"
SRC_DIR = REPO_ROOT / "src"

_spec = importlib.util.spec_from_file_location(
    "check_no_any_types", SCRIPTS_DIR / "check_no_any_types.py"
)
if _spec is None or _spec.loader is None:
    msg = f"Cannot load scanner from {SCRIPTS_DIR / 'check_no_any_types.py'}"
    raise ImportError(msg)
_scanner = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_scanner)
scan_bytes = _scanner.scan_bytes


class TestScannerReplacementPatterns:
    """Scanner must report 0 for files using replacement patterns."""

    def test_typeddict_reports_zero(self) -> None:
        source = textwrap.dedent("""\
            from __future__ import annotations
            from typing import TypedDict

            class MyDict(TypedDict):
                name: str
                value: int
        """).encode()
        hits, error = scan_bytes(source)
        assert error is None
        assert len(hits) == 0

    def test_object_annotation_reports_zero(self) -> None:
        source = textwrap.dedent("""\
            from __future__ import annotations

            def foo(x: object) -> dict[str, object]:
                return {"key": x}
        """).encode()
        hits, error = scan_bytes(source)
        assert error is None
        assert len(hits) == 0

    def test_explicit_union_reports_zero(self) -> None:
        source = textwrap.dedent("""\
            from __future__ import annotations

            def bar(param: str | int | float | None) -> str | int:
                return param or 0
        """).encode()
        hits, error = scan_bytes(source)
        assert error is None
        assert len(hits) == 0

    def test_recursive_type_alias_reports_zero(self) -> None:
        source = textwrap.dedent("""\
            from __future__ import annotations
            from typing import TypeAlias

            JSONValue: TypeAlias = (
                "str | int | float | bool | None | list[JSONValue] | dict[str, JSONValue]"
            )

            def redact(data: dict[str, JSONValue]) -> dict[str, JSONValue]:
                result: dict[str, JSONValue] = {}
                return result
        """).encode()
        hits, error = scan_bytes(source)
        assert error is None
        assert len(hits) == 0


class TestScannerDetection:
    """Scanner must report non-zero for files still containing Any."""

    def test_import_any_reports_one(self) -> None:
        source = b"from typing import Any\n"
        hits, error = scan_bytes(source)
        assert error is None
        assert len(hits) == 1

    def test_annotation_any_reports_count(self) -> None:
        source = textwrap.dedent("""\
            from typing import Any

            def foo(x: dict[str, Any]) -> list[Any]:
                result: Any = x
                return [result]
        """).encode()
        hits, error = scan_bytes(source)
        assert error is None
        # 1 import + 2 annotations (dict[str, Any], list[Any]) + 1 variable = 4
        assert len(hits) == 4


class TestScannerEdgeCases:
    """Scanner edge cases for aliases and shadowing."""

    def test_aliased_import_counts(self) -> None:
        """FR-011: ``from typing import Any as X`` MUST count (token present)."""
        source = b"from typing import Any as X\n"
        hits, error = scan_bytes(source)
        assert error is None
        assert len(hits) == 1, "Aliased import still contains the Any token"

    def test_local_variable_named_any_counts(self) -> None:
        """FR-011: Local variable named ``Any`` counts (documented false positive).

        The scanner is token-based and cannot distinguish type references
        from identifier shadowing.  FR-012 bans this pattern in src/.
        """
        source = textwrap.dedent("""\
            from __future__ import annotations

            Any = 42  # noqa: N806 — deliberate test of scanner behavior
        """).encode()
        hits, error = scan_bytes(source)
        assert error is None
        assert len(hits) == 1, (
            "Scanner counts Any as identifier (documented false positive)"
        )

    def test_any_in_comments_ignored(self) -> None:
        source = textwrap.dedent("""\
            from __future__ import annotations

            # This function does not use Any at all
            def foo() -> None:
                pass
        """).encode()
        hits, error = scan_bytes(source)
        assert error is None
        assert len(hits) == 0

    def test_any_in_string_ignored(self) -> None:
        source = textwrap.dedent("""\
            from __future__ import annotations

            msg = "Do not use Any in your code"
        """).encode()
        hits, error = scan_bytes(source)
        assert error is None
        assert len(hits) == 0

    def test_parse_error_fails_closed(self) -> None:
        source = b"def broken(\n"
        hits, error = scan_bytes(source)
        assert error is not None


class TestFR012NoAnyIdentifiersInSrc:
    """FR-012: No variable, class, or function in src/ may be named ``Any``."""

    def test_no_any_identifiers_in_src(self) -> None:
        """Verify no .py file in src/ defines a variable/class/function named Any."""
        result = subprocess.run(
            [
                "python",
                "-c",
                (
                    "import ast, pathlib, sys\n"
                    "src = pathlib.Path(r'" + str(SRC_DIR) + "')\n"
                    "violations = []\n"
                    "for f in sorted(src.rglob('*.py')):\n"
                    "    if '__pycache__' in f.parts:\n"
                    "        continue\n"
                    "    try:\n"
                    "        tree = ast.parse(f.read_text('utf-8'), filename=str(f))\n"
                    "    except SyntaxError:\n"
                    "        continue\n"
                    "    for node in ast.walk(tree):\n"
                    "        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):\n"
                    "            if node.name == 'Any':\n"
                    "                violations.append(f'{f}:{node.lineno}')\n"
                    "        elif isinstance(node, ast.Name) and isinstance(getattr(node, 'ctx', None), ast.Store):\n"
                    "            if node.id == 'Any':\n"
                    "                violations.append(f'{f}:{node.lineno}')\n"
                    "if violations:\n"
                    "    print('FR-012 violations:')\n"
                    "    for v in violations:\n"
                    "        print(f'  {v}')\n"
                    "    sys.exit(1)\n"
                    "print(f'FR-012 OK: no Any identifiers in {len(list(src.rglob(chr(42)+\".py\")))} files')\n"
                ),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, (
            f"FR-012 violation: identifiers named 'Any' found in src/:\n{result.stdout}"
        )
