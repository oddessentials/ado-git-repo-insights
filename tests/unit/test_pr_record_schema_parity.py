"""Pytest wrapper for the PrRecord cross-surface schema parity gate.

The authoritative command is ``python scripts/check_pr_record_schema_parity.py``
(Feature 310, DIRECTIVE 2).  This wrapper imports the script as a module
and asserts ``main([])`` returns zero on the current tree — giving coverage
credit, same-commit ratchet alignment, and a pytest-level smoke of the
same code path the QG-49 entry points invoke.

Targeted sub-parser smoke tests exercise each surface's parser against
small synthetic sources so parser regressions surface immediately in this
file, not via a confusing downstream error in a parity failure at the
top-level CLI.  Drift-against-drift scenarios are out of scope here —
those live in the gate's own self-tests once implementers need them
(Phase 2 keeps this file narrow per the task contract).
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_SCRIPT_PATH = (
    Path(__file__).resolve().parents[2] / "scripts" / "check_pr_record_schema_parity.py"
)
_SPEC = importlib.util.spec_from_file_location(
    "check_pr_record_schema_parity", _SCRIPT_PATH
)
assert _SPEC is not None
assert _SPEC.loader is not None
_MOD = importlib.util.module_from_spec(_SPEC)
# Register BEFORE exec_module so @dataclass(frozen=True) can resolve the
# module on Python 3.12+ (dataclasses introspects sys.modules to detect
# KW_ONLY sentinels; spec-loaded modules must be registered explicitly).
sys.modules["check_pr_record_schema_parity"] = _MOD
_SPEC.loader.exec_module(_MOD)


def test_parity_gate_holds_on_current_tree() -> None:
    """The gate MUST exit 0 against the committed tree.

    When this fails the diagnostic printed by ``main`` explains which
    surface drifted.  The fix is to land the missing / mismatched field
    in every surface in the same commit (types.py, rollup.schema.ts
    interface + PR_RECORD_REQUIRED_FIELDS, and the 310 §1 table).
    """
    exit_code = _MOD.main([])
    assert exit_code == 0, (
        "PrRecord schema parity drift detected — re-run "
        "`python scripts/check_pr_record_schema_parity.py` for the diagnostic."
    )


def test_python_surface_parses_expected_fields() -> None:
    """Surface 1 smoke: the real types.py yields at least the five 060 fields."""
    fields = _MOD.parse_python_pr_record(_MOD.PY_TYPES_PATH.read_text(encoding="utf-8"))
    for required_field in ("id", "title", "author_id", "repository_id", "cycle_time"):
        assert required_field in fields, (
            f"Python PrRecord TypedDict is missing required field {required_field!r}"
        )
        assert fields[required_field].presence == "required", (
            f"Field {required_field!r} MUST be presence-required (no NotRequired wrapper)"
        )


def test_ts_interface_surface_parses_expected_fields() -> None:
    """Surface 2 smoke: the real rollup.schema.ts yields at least the five 060 fields."""
    fields = _MOD.parse_ts_pr_record(_MOD.TS_SCHEMA_PATH.read_text(encoding="utf-8"))
    for required_field in ("id", "title", "author_id", "repository_id", "cycle_time"):
        assert required_field in fields, (
            f"TypeScript PrRecord interface is missing required field {required_field!r}"
        )
        assert fields[required_field].presence == "required", (
            f"Field {required_field!r} MUST NOT carry '?:' in the TS interface"
        )


def test_ts_required_fields_surface_parses_exact_five() -> None:
    """Surface 3 smoke: the array literal stays at exactly the five 060 entries."""
    required = _MOD.parse_ts_required_fields(
        _MOD.TS_SCHEMA_PATH.read_text(encoding="utf-8")
    )
    assert required == ("id", "title", "author_id", "repository_id", "cycle_time"), (
        f"PR_RECORD_REQUIRED_FIELDS drifted from the locked 5-entry 060 shape: {required!r}"
    )


def test_contract_surface_parses_expected_fields() -> None:
    """Surface 4 smoke: the 310 §1 table yields at least the five 060 fields."""
    fields = _MOD.parse_contract_section(_MOD.CONTRACT_PATH.read_text(encoding="utf-8"))
    for required_field in ("id", "title", "author_id", "repository_id", "cycle_time"):
        assert required_field in fields, (
            f"310 contract §1 table is missing required field {required_field!r}"
        )


def test_ts_interface_parser_fails_closed_on_unsupported_type() -> None:
    """An unrecognized TS type inside the interface MUST raise ParityError."""
    with pytest.raises(_MOD.ParityError, match="Unsupported TypeScript type"):
        _MOD.parse_ts_pr_record("export interface PrRecord {\n  id: bigint;\n}\n")


def test_python_annotation_parser_fails_closed_on_unsupported_union() -> None:
    """A Python union that isn't `ValueType | None` MUST raise ParityError."""
    with pytest.raises(_MOD.ParityError, match="Unsupported"):
        _MOD.parse_python_pr_record(
            "from typing import TypedDict\n"
            "class PrRecord(TypedDict):\n"
            "    id: int | str\n"
        )


def test_contract_parser_fails_closed_on_missing_anchor() -> None:
    """Contract parsing MUST fail if the §1 heading is removed."""
    with pytest.raises(_MOD.ParityError, match="Anchor heading"):
        _MOD.parse_contract_section("# Contract without the §1 anchor")


def test_types_compatible_matrix() -> None:
    """Spot-check the cross-language type-compatibility bridge."""
    assert _MOD._types_compatible("int", "number") is True
    assert _MOD._types_compatible("float", "number") is True
    assert _MOD._types_compatible("str", "string") is True
    assert _MOD._types_compatible("bool", "boolean") is True
    assert _MOD._types_compatible("int | None", "number | null") is True
    assert _MOD._types_compatible("str | None", "string | null") is True
    assert _MOD._types_compatible("int", "string") is False
    assert _MOD._types_compatible("int", "number | null") is False
    assert _MOD._types_compatible("int | None", "number") is False
