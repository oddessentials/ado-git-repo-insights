"""Cross-language schema parity test (P0 guardrail).

Validates that the Python WeeklyRollup dataclass fields and dynamically-added
breakdown fields match the TypeScript KNOWN_ROOT_FIELDS in rollup.schema.ts.

Prevents silent schema drift between the Python backend (data producer) and
TypeScript frontend (data consumer). If this test fails, a field was added
on one side without the other — which causes silent UI rendering failures.
"""

from __future__ import annotations

import dataclasses
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent

# Source of truth files
AGGREGATORS_PY = (
    REPO_ROOT / "src" / "ado_git_repo_insights" / "transform" / "aggregators.py"
)
ROLLUP_SCHEMA_TS = REPO_ROOT / "extension" / "ui" / "schemas" / "rollup.schema.ts"

# Fields that exist in TypeScript schema but are intentionally NOT produced
# by the Python backend. Each entry must have a comment explaining why.
TS_ONLY_FORWARD_COMPAT_FIELDS = {
    # Reserved for future review-time metrics; TS normalizer defaults to null.
    "review_time_p50",
    "review_time_p90",
}


def _extract_ts_set_fields(ts_source: str, set_name: str) -> set[str]:
    """Extract field names from a TypeScript `new Set([...])` declaration."""
    pattern = rf"{set_name}\s*=\s*new\s+Set\(\[\s*(.*?)\s*\]\)"
    match = re.search(pattern, ts_source, re.DOTALL)
    if not match:
        raise ValueError(f"Could not find {set_name} in schema source")
    fields_str = match.group(1)
    return set(re.findall(r'"(\w+)"', fields_str))


def _extract_python_dynamic_fields(py_source: str) -> set[str]:
    """Extract breakdown field names added dynamically to rollup_dict."""
    # Matches: rollup_dict["by_repository"] = ...
    return set(re.findall(r'rollup_dict\["(by_\w+)"\]', py_source))


@pytest.fixture(scope="module")
def python_rollup_fields() -> set[str]:
    """All fields the Python backend can produce in a weekly rollup."""
    # Import the dataclass to get declared fields
    from ado_git_repo_insights.transform.aggregators import WeeklyRollup

    dataclass_fields = {f.name for f in dataclasses.fields(WeeklyRollup)}

    # Also get dynamically-added breakdown fields from source
    py_source = AGGREGATORS_PY.read_text(encoding="utf-8")
    dynamic_fields = _extract_python_dynamic_fields(py_source)

    return dataclass_fields | dynamic_fields


@pytest.fixture(scope="module")
def typescript_known_fields() -> set[str]:
    """All fields the TypeScript frontend expects in a weekly rollup."""
    assert ROLLUP_SCHEMA_TS.exists(), f"Schema file not found: {ROLLUP_SCHEMA_TS}"
    ts_source = ROLLUP_SCHEMA_TS.read_text(encoding="utf-8")
    return _extract_ts_set_fields(ts_source, "KNOWN_ROOT_FIELDS")


class TestCrossLanguageSchemaParity:
    """Python WeeklyRollup fields must match TypeScript KNOWN_ROOT_FIELDS."""

    def test_python_fields_exist_in_typescript(
        self, python_rollup_fields, typescript_known_fields
    ):
        """Every field Python produces must be recognized by TypeScript."""
        python_only = python_rollup_fields - typescript_known_fields
        assert not python_only, (
            f"Python produces fields not in TypeScript KNOWN_ROOT_FIELDS: "
            f"{sorted(python_only)}. "
            f"Add them to KNOWN_ROOT_FIELDS in rollup.schema.ts, "
            f"or the TypeScript validator will emit unknown-field warnings."
        )

    def test_typescript_fields_exist_in_python(
        self, python_rollup_fields, typescript_known_fields
    ):
        """Every TypeScript field must be produced by Python or explicitly allowed."""
        ts_only = typescript_known_fields - python_rollup_fields
        unexplained = ts_only - TS_ONLY_FORWARD_COMPAT_FIELDS
        assert not unexplained, (
            f"TypeScript expects fields not produced by Python: "
            f"{sorted(unexplained)}. "
            f"Either add them to Python WeeklyRollup / aggregation logic, "
            f"or add to TS_ONLY_FORWARD_COMPAT_FIELDS with justification."
        )

    def test_forward_compat_fields_still_in_typescript(self, typescript_known_fields):
        """Forward-compat allowlist entries must actually exist in TypeScript."""
        stale = TS_ONLY_FORWARD_COMPAT_FIELDS - typescript_known_fields
        assert not stale, (
            f"TS_ONLY_FORWARD_COMPAT_FIELDS contains fields not in TypeScript: "
            f"{sorted(stale)}. Remove stale entries from the allowlist."
        )

    def test_forward_compat_fields_not_in_python(self, python_rollup_fields):
        """Forward-compat fields must NOT be produced by Python (or remove from allowlist)."""
        now_produced = TS_ONLY_FORWARD_COMPAT_FIELDS & python_rollup_fields
        assert not now_produced, (
            f"Forward-compat fields are now produced by Python: "
            f"{sorted(now_produced)}. "
            f"Remove them from TS_ONLY_FORWARD_COMPAT_FIELDS — they're no longer forward-compat."
        )


class TestSchemaParityRedPath:
    """Prove the parity guard catches drift — not just passes when healthy."""

    def test_extra_python_field_is_caught(
        self, python_rollup_fields, typescript_known_fields
    ):
        """Simulated drift: Python adds a field TypeScript doesn't know about."""
        drifted_py = python_rollup_fields | {"sentiment_score"}
        python_only = drifted_py - typescript_known_fields
        assert "sentiment_score" in python_only, (
            "Guard failed to detect a Python-only field — parity check is broken"
        )

    def test_extra_typescript_field_is_caught(
        self, python_rollup_fields, typescript_known_fields
    ):
        """Simulated drift: TypeScript adds a field Python doesn't produce."""
        drifted_ts = typescript_known_fields | {"response_time_p99"}
        ts_only = drifted_ts - python_rollup_fields - TS_ONLY_FORWARD_COMPAT_FIELDS
        assert "response_time_p99" in ts_only, (
            "Guard failed to detect a TypeScript-only field — parity check is broken"
        )
