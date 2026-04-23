#!/usr/bin/env python3
"""PrRecord cross-surface schema parity gate (Feature 310, DIRECTIVE 2).

Parses the four authoritative PrRecord schema surfaces and fails the build
when any two disagree on field name set or type.  The four surfaces are:

1. Python ``PrRecord`` TypedDict at
   ``src/ado_git_repo_insights/types.py``.
2. TypeScript ``PrRecord`` interface at
   ``extension/ui/schemas/rollup.schema.ts``.
3. TypeScript ``PR_RECORD_REQUIRED_FIELDS`` array literal in the same file.
4. 310 sibling contract §1 canonical field declaration table at
   ``specs/310-comments-visualization/contracts/pr-record-comments-fields.md``.

**Python-only implementation.** No node / TypeScript runtime dependency —
the TypeScript interface + required-fields array are parsed via Python
regex against tightly-locked source shapes so the gate stays green under
``pre-commit run --all-files`` in the Python test matrix (where
``extension/node_modules`` is absent).  The accepted source shapes are
intentionally narrow; anything outside them fails closed with a diagnostic
that points at the offending construct.  Broadening the parser is the
caller's lever — broadening via silent permissive branches is forbidden
(feedback_hook_env_parity_across_all_ci_jobs +
feedback_parser_tolerance_is_silent_mutation).

Contract: ``specs/310-comments-visualization/contracts/schema-parity-gate.md``.

Usage (identical across all four QG-49 entry points):

    python scripts/check_pr_record_schema_parity.py

Exit status: ``0`` — parity held.  Non-zero — drift detected (human-readable
diff printed to stderr).
"""

from __future__ import annotations

import argparse
import ast
import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PY_TYPES_PATH = REPO_ROOT / "src" / "ado_git_repo_insights" / "types.py"
TS_SCHEMA_PATH = REPO_ROOT / "extension" / "ui" / "schemas" / "rollup.schema.ts"
CONTRACT_PATH = (
    REPO_ROOT
    / "specs"
    / "310-comments-visualization"
    / "contracts"
    / "pr-record-comments-fields.md"
)

# Accepted value-type sets.  Any annotation / TS expression outside these
# sets fails the gate closed — callers MUST broaden the parser in the same
# commit that broadens the source.
PYTHON_VALUE_TYPES: frozenset[str] = frozenset({"int", "float", "str", "bool"})
TS_VALUE_TYPES: frozenset[str] = frozenset({"number", "string", "boolean"})

# Cross-language value-type mapping used for type-compatibility checks.
PY_TO_TS: dict[str, str] = {
    "int": "number",
    "float": "number",
    "str": "string",
    "bool": "boolean",
}

CONTRACT_SECTION_HEADING: str = "## §1 Canonical field declaration"


@dataclass(frozen=True)
class FieldDecl:
    """One field declaration harvested from one surface.

    ``type_str`` is stored in canonical Python form
    (``int`` / ``str`` / ``float`` / ``bool`` / ``X | None``) for the
    Python TypedDict and the contract rows, and in canonical TS form
    (``number`` / ``string`` / ``boolean`` / ``X | null``) for the
    TypeScript interface.  ``_types_compatible`` bridges the two.
    """

    name: str
    presence: str  # "required" | "optional"
    type_str: str


class ParityError(ValueError):
    """Raised when a surface has unexpected shape or drift is detected."""


# ---------------------------------------------------------------------------
# Surface 1 — Python PrRecord TypedDict (ast).
# ---------------------------------------------------------------------------


def parse_python_pr_record(source: str) -> dict[str, FieldDecl]:
    """Parse the ``PrRecord(TypedDict)`` class from ``types.py`` source."""
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef) or node.name != "PrRecord":
            continue
        fields: dict[str, FieldDecl] = {}
        for stmt in node.body:
            if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant):
                # docstring — ignore
                continue
            if not isinstance(stmt, ast.AnnAssign):
                raise ParityError(
                    f"Unexpected statement in PrRecord class body: {ast.dump(stmt)!r}"
                )
            if not isinstance(stmt.target, ast.Name):
                raise ParityError(
                    f"Unexpected PrRecord field target: {ast.dump(stmt.target)!r}"
                )
            name = stmt.target.id
            presence, type_str = _parse_python_annotation(stmt.annotation)
            fields[name] = FieldDecl(name=name, presence=presence, type_str=type_str)
        return fields
    raise ParityError(
        f"PrRecord TypedDict class not found in {PY_TYPES_PATH.name}; "
        "the Python surface anchor is missing."
    )


def _parse_python_annotation(node: ast.expr) -> tuple[str, str]:
    """Return ``(presence, canonical_type_str)``.

    Presence is ``"optional"`` iff the annotation is wrapped in
    ``NotRequired[...]`` (PEP 655).  The inner type is always rendered in
    canonical Python form.
    """
    if isinstance(node, ast.Subscript):
        value = node.value
        if isinstance(value, ast.Name) and value.id == "NotRequired":
            return ("optional", _canon_python_type(node.slice))
    return ("required", _canon_python_type(node))


def _canon_python_type(node: ast.expr) -> str:
    """Canonicalize a Python annotation to ``int`` or ``int | None`` form."""
    if isinstance(node, ast.Name):
        if node.id in PYTHON_VALUE_TYPES:
            return node.id
        if node.id == "None":
            return "None"
        raise ParityError(
            f"Unsupported Python type name in PrRecord: {node.id!r}; "
            f"accepted value types are {sorted(PYTHON_VALUE_TYPES)}"
        )
    if isinstance(node, ast.Constant) and node.value is None:
        return "None"
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        left = _canon_python_type(node.left)
        right = _canon_python_type(node.right)
        if right == "None" and left in PYTHON_VALUE_TYPES:
            return f"{left} | None"
        if left == "None" and right in PYTHON_VALUE_TYPES:
            return f"{right} | None"
        raise ParityError(
            f"Unsupported union annotation in PrRecord: {left} | {right}; "
            "only 'ValueType | None' unions are accepted."
        )
    raise ParityError(
        f"Unsupported Python annotation node in PrRecord: {ast.dump(node)!r}"
    )


# ---------------------------------------------------------------------------
# Surface 2 — TypeScript PrRecord interface (regex).
# ---------------------------------------------------------------------------


_TS_INTERFACE_START = re.compile(r"^export\s+interface\s+PrRecord\s*\{\s*$")
_TS_INTERFACE_END = re.compile(r"^\}\s*$")
_TS_FIELD = re.compile(
    r"^\s*(?P<name>[A-Za-z_][A-Za-z0-9_]*)(?P<optional>\?)?\s*:\s*"
    r"(?P<type>[A-Za-z0-9_| ]+?);\s*$"
)
_TS_ACCEPTED_TYPES: frozenset[str] = frozenset(
    {
        "number",
        "string",
        "boolean",
        "number | null",
        "string | null",
        "boolean | null",
    }
)


def parse_ts_pr_record(source: str) -> dict[str, FieldDecl]:
    """Parse the ``export interface PrRecord { ... }`` block."""
    lines = source.splitlines()
    in_block = False
    fields: dict[str, FieldDecl] = {}
    for line in lines:
        if not in_block:
            if _TS_INTERFACE_START.match(line):
                in_block = True
            continue
        if _TS_INTERFACE_END.match(line):
            return fields
        if not line.strip():
            continue
        match = _TS_FIELD.match(line)
        if match is None:
            raise ParityError(
                "Unexpected line inside PrRecord interface block "
                f"(accepted shape is '<ident>(?:\\?)?: <type>;'): {line!r}. "
                "Broaden ``_TS_FIELD`` / ``_TS_ACCEPTED_TYPES`` in "
                "scripts/check_pr_record_schema_parity.py or restore the source."
            )
        name = match.group("name")
        presence = "optional" if match.group("optional") else "required"
        type_str = _normalize_ts_type(match.group("type"))
        if type_str not in _TS_ACCEPTED_TYPES:
            raise ParityError(
                f"Unsupported TypeScript type in PrRecord.{name}: {type_str!r}; "
                f"accepted shapes are {sorted(_TS_ACCEPTED_TYPES)}"
            )
        fields[name] = FieldDecl(name=name, presence=presence, type_str=type_str)
    raise ParityError(
        f"PrRecord interface not found or unterminated in {TS_SCHEMA_PATH.name}"
    )


def _normalize_ts_type(raw: str) -> str:
    """Collapse whitespace around pipes: ``number|null`` → ``number | null``."""
    parts = [p.strip() for p in raw.split("|") if p.strip()]
    return " | ".join(parts)


# ---------------------------------------------------------------------------
# Surface 3 — TypeScript PR_RECORD_REQUIRED_FIELDS array (regex).
# ---------------------------------------------------------------------------


_TS_REQUIRED_ARRAY = re.compile(
    r"const\s+PR_RECORD_REQUIRED_FIELDS\s*:\s*readonly\s+\(keyof\s+PrRecord\)\[\]"
    r"\s*=\s*\[(?P<body>[^\]]+)\]\s*;",
    re.DOTALL,
)
_TS_STRING_LITERAL = re.compile(r'"([^"]+)"')


def parse_ts_required_fields(source: str) -> tuple[str, ...]:
    """Parse the ``PR_RECORD_REQUIRED_FIELDS`` array literal."""
    match = _TS_REQUIRED_ARRAY.search(source)
    if match is None:
        raise ParityError(
            f"PR_RECORD_REQUIRED_FIELDS declaration not found in "
            f"{TS_SCHEMA_PATH.name}; the Surface 3 anchor is missing."
        )
    body = match.group("body")
    entries = tuple(_TS_STRING_LITERAL.findall(body))
    # Fail closed if the body contains anything other than string literals,
    # commas, and whitespace.
    residual = _TS_STRING_LITERAL.sub("", body).replace(",", "").strip()
    if residual:
        raise ParityError(
            "Unexpected content inside PR_RECORD_REQUIRED_FIELDS array literal "
            f"(only double-quoted string entries + commas accepted): {residual!r}"
        )
    return entries


# ---------------------------------------------------------------------------
# Surface 4 — 310 sibling contract §1 canonical field declaration (markdown).
# ---------------------------------------------------------------------------


_UNESCAPED_PIPE = re.compile(r"(?<!\\)\|")


def parse_contract_section(source: str) -> dict[str, FieldDecl]:
    """Parse the §1 Canonical field declaration table from the 310 contract."""
    if CONTRACT_SECTION_HEADING not in source:
        raise ParityError(
            f"Anchor heading {CONTRACT_SECTION_HEADING!r} not found in "
            f"{CONTRACT_PATH.name}; the parity gate cannot proceed."
        )
    after_heading = source.split(CONTRACT_SECTION_HEADING, maxsplit=1)[1]
    lines = after_heading.splitlines()
    table_start: int | None = None
    for idx, line in enumerate(lines):
        stripped = line.strip()
        # Match the header row exactly: ``| Field | Python type | TypeScript type | ...``
        if stripped.startswith("| Field ") and "Python type" in stripped:
            table_start = idx
            break
    if table_start is None:
        raise ParityError(
            f"§1 Canonical field declaration table not found in {CONTRACT_PATH.name}"
        )
    # Skip header + separator rows.
    fields: dict[str, FieldDecl] = {}
    for line in lines[table_start + 2 :]:
        stripped = line.strip()
        if not stripped or not stripped.startswith("|"):
            break
        cells = _split_table_row(stripped)
        if len(cells) < 3:
            raise ParityError(f"Contract §1 row has fewer than 3 columns: {line!r}")
        raw_name = cells[0]
        raw_py = cells[1]
        raw_ts = cells[2]
        name = _strip_backticks(raw_name)
        py_cell = _strip_backticks(raw_py)
        ts_cell = _strip_backticks(raw_ts)
        presence_py = "optional" if py_cell.startswith("NotRequired[") else "required"
        presence_ts = "optional" if ts_cell.startswith("?:") else "required"
        if presence_py != presence_ts:
            raise ParityError(
                f"Contract §1 row {name!r} has a presence mismatch within "
                f"the row: Python={presence_py!r} vs TypeScript={presence_ts!r}"
            )
        inner_py = _strip_not_required(py_cell)
        inner_ts = _strip_ts_optional(ts_cell)
        _assert_contract_row_type_compat(name, inner_py, inner_ts)
        fields[name] = FieldDecl(name=name, presence=presence_py, type_str=inner_py)
    if not fields:
        raise ParityError(
            f"Contract §1 table at {CONTRACT_PATH.name} is empty; expected "
            "at least one field row."
        )
    return fields


def _split_table_row(line: str) -> list[str]:
    """Split a markdown-table row on unescaped pipes; trim leading/trailing."""
    trimmed = line.strip()
    if trimmed.startswith("|"):
        trimmed = trimmed[1:]
    if trimmed.endswith("|"):
        trimmed = trimmed[:-1]
    raw_cells = _UNESCAPED_PIPE.split(trimmed)
    return [cell.strip() for cell in raw_cells]


def _strip_backticks(cell: str) -> str:
    """Strip backticks and unescape the markdown ``\\|`` pipe escape."""
    text = cell.strip().replace("\\|", "|").replace("`", "")
    return text.strip()


def _strip_not_required(py_type_str: str) -> str:
    """Return ``X`` from ``NotRequired[X]``, else the input unchanged."""
    if py_type_str.startswith("NotRequired[") and py_type_str.endswith("]"):
        return py_type_str[len("NotRequired[") : -1].strip()
    return py_type_str


def _strip_ts_optional(ts_type_str: str) -> str:
    """Return ``X`` from ``?: X``, else the input unchanged."""
    if ts_type_str.startswith("?:"):
        return ts_type_str[2:].strip()
    return ts_type_str


def _assert_contract_row_type_compat(name: str, py: str, ts: str) -> None:
    """Verify a contract row's Python cell and TypeScript cell agree."""
    py_norm = " | ".join(p.strip() for p in py.split("|") if p.strip())
    ts_norm = " | ".join(p.strip() for p in ts.split("|") if p.strip())
    if not _types_compatible(py_norm, ts_norm):
        raise ParityError(
            f"Contract §1 row {name!r} declares incompatible types: "
            f"Python {py_norm!r} vs TypeScript {ts_norm!r}"
        )


# ---------------------------------------------------------------------------
# Type compatibility + cross-surface comparison.
# ---------------------------------------------------------------------------


def _types_compatible(py: str, ts: str) -> bool:
    """Cross-language type compatibility per ``schema-parity-gate.md``."""
    py_nullable = py.endswith(" | None")
    ts_nullable = ts.endswith(" | null")
    if py_nullable != ts_nullable:
        return False
    if py_nullable:
        py_inner = py[: -len(" | None")]
        ts_inner = ts[: -len(" | null")]
    else:
        py_inner = py
        ts_inner = ts
    return PY_TO_TS.get(py_inner) == ts_inner


def compare_surfaces(
    python_fields: dict[str, FieldDecl],
    ts_fields: dict[str, FieldDecl],
    required_array: tuple[str, ...],
    contract_fields: dict[str, FieldDecl],
) -> list[str]:
    """Return a list of human-readable drift diagnostics (empty = parity)."""
    diagnostics: list[str] = []

    py_names = set(python_fields.keys())
    ts_names = set(ts_fields.keys())
    contract_names = set(contract_fields.keys())
    required_names = set(required_array)

    all_names = py_names | ts_names | contract_names
    for surface_label, present in (
        ("Python TypedDict (types.py)", py_names),
        ("TypeScript interface (rollup.schema.ts)", ts_names),
        ("310 contract §1 table", contract_names),
    ):
        missing = all_names - present
        if missing:
            diagnostics.append(
                f"{surface_label} is missing field(s) {sorted(missing)!r}; "
                f"present-elsewhere union is {sorted(all_names)!r}"
            )

    for name in sorted(py_names & ts_names & contract_names):
        py_field = python_fields[name]
        ts_field = ts_fields[name]
        contract_field = contract_fields[name]
        presences = {py_field.presence, ts_field.presence, contract_field.presence}
        if len(presences) > 1:
            diagnostics.append(
                f"Field {name!r} presence mismatch: "
                f"Python={py_field.presence!r}, "
                f"TypeScript={ts_field.presence!r}, "
                f"contract={contract_field.presence!r}"
            )
            continue
        if py_field.type_str != contract_field.type_str:
            diagnostics.append(
                f"Field {name!r} Python-side type drift: "
                f"types.py declares {py_field.type_str!r}, "
                f"contract §1 declares {contract_field.type_str!r}"
            )
        if not _types_compatible(py_field.type_str, ts_field.type_str):
            diagnostics.append(
                f"Field {name!r} cross-language type mismatch: "
                f"Python={py_field.type_str!r} vs "
                f"TypeScript={ts_field.type_str!r}"
            )

    py_required = {
        name for name, field in python_fields.items() if field.presence == "required"
    }
    if py_required != required_names:
        diagnostics.append(
            f"PR_RECORD_REQUIRED_FIELDS drift: "
            f"array is {sorted(required_names)!r}, "
            f"Python non-NotRequired fields are {sorted(py_required)!r}"
        )

    # Detect accidental reordering / duplicate entries in the array literal.
    if len(required_array) != len(required_names):
        diagnostics.append(
            f"PR_RECORD_REQUIRED_FIELDS contains duplicate entries: "
            f"{list(required_array)!r}"
        )

    return diagnostics


# ---------------------------------------------------------------------------
# CLI entry point.
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    """Run the parity gate.  Returns 0 on parity, 1 on drift, 2 on bad input."""
    parser = argparse.ArgumentParser(
        description=(
            "PrRecord cross-surface schema parity gate (Feature 310). "
            "Asserts the Python TypedDict, TypeScript interface, "
            "PR_RECORD_REQUIRED_FIELDS array, and 310 contract §1 table "
            "all agree on the field name set and types."
        ),
    )
    parser.parse_args(argv)

    try:
        py_fields = parse_python_pr_record(PY_TYPES_PATH.read_text(encoding="utf-8"))
        ts_source = TS_SCHEMA_PATH.read_text(encoding="utf-8")
        ts_fields = parse_ts_pr_record(ts_source)
        required_array = parse_ts_required_fields(ts_source)
        contract_fields = parse_contract_section(
            CONTRACT_PATH.read_text(encoding="utf-8")
        )
    except ParityError as exc:
        print(
            f"[parity] failed to parse one of the four surfaces: {exc}",
            file=sys.stderr,
        )
        return 1
    except OSError as exc:
        print(f"[parity] cannot read a surface file: {exc}", file=sys.stderr)
        return 1

    diagnostics = compare_surfaces(
        py_fields, ts_fields, required_array, contract_fields
    )
    if diagnostics:
        print(
            "[parity] PrRecord schema drift detected across surfaces:",
            file=sys.stderr,
        )
        for msg in diagnostics:
            print(f"  - {msg}", file=sys.stderr)
        print(
            "  Fix: land the same field name + type in all four surfaces "
            "(types.py, rollup.schema.ts interface, PR_RECORD_REQUIRED_FIELDS, "
            "and the 310 contract §1 table) in the same commit.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
