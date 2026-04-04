"""Parity tests for demo_generation_common serializer signatures.

Verifies that the `object`-typed serialization utilities produce the
same output as they did when typed `Any`.  Added as part of #243
(QG-40 scripts/ Any elimination) to guard against signature-induced
runtime regressions.
"""

from __future__ import annotations

import importlib.util
import json
import uuid
from datetime import UTC, date, datetime
from pathlib import Path
from types import ModuleType

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"


def _load_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "demo_generation_common", SCRIPTS_DIR / "demo_generation_common.py"
    )
    if spec is None or spec.loader is None:
        raise AssertionError("Unable to load demo_generation_common")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_MOD = _load_module()
_default_serializer = _MOD._default_serializer
_process_floats = _MOD._process_floats
canonical_json = _MOD.canonical_json
write_json_file = _MOD.write_json_file
load_json_file = _MOD.load_json_file


# ---------------------------------------------------------------------------
# _default_serializer
# ---------------------------------------------------------------------------


class TestDefaultSerializer:
    def test_datetime(self) -> None:
        dt = datetime(2026, 1, 30, 12, 0, 0, tzinfo=UTC)
        assert _default_serializer(dt) == "2026-01-30T12:00:00Z"

    def test_date(self) -> None:
        d = date(2026, 1, 30)
        assert _default_serializer(d) == "2026-01-30"

    def test_uuid(self) -> None:
        u = uuid.UUID("12345678-1234-5678-1234-567812345678")
        assert _default_serializer(u) == "12345678-1234-5678-1234-567812345678"

    def test_unsupported_raises_type_error(self) -> None:
        with pytest.raises(TypeError, match="not JSON serializable"):
            _default_serializer(object())

    def test_return_type_is_str(self) -> None:
        results = [
            _default_serializer(datetime(2026, 1, 1, tzinfo=UTC)),
            _default_serializer(date(2026, 1, 1)),
            _default_serializer(uuid.uuid4()),
        ]
        assert all(isinstance(r, str) for r in results)


# ---------------------------------------------------------------------------
# _process_floats
# ---------------------------------------------------------------------------


class TestProcessFloats:
    def test_rounds_float(self) -> None:
        result = _process_floats(1.23456)
        assert result == 1.235

    def test_recurses_into_dict(self) -> None:
        data = {"a": 1.23456, "b": "text"}
        result = _process_floats(data)
        assert isinstance(result, dict)
        assert result["a"] == 1.235
        assert result["b"] == "text"

    def test_recurses_into_list(self) -> None:
        data = [1.23456, 2.34567]
        result = _process_floats(data)
        assert isinstance(result, list)
        assert result == [1.235, 2.346]

    def test_passes_through_non_float(self) -> None:
        assert _process_floats(42) == 42
        assert _process_floats("text") == "text"
        assert _process_floats(None) is None


# ---------------------------------------------------------------------------
# canonical_json
# ---------------------------------------------------------------------------


class TestCanonicalJson:
    def test_datetime_serialized(self) -> None:
        data = {"ts": datetime(2026, 1, 30, 12, 0, 0, tzinfo=UTC)}
        result = canonical_json(data)
        parsed = json.loads(result)
        assert parsed["ts"] == "2026-01-30T12:00:00Z"

    def test_float_rounding(self) -> None:
        data = {"val": 1.23456}
        result = canonical_json(data)
        parsed = json.loads(result)
        assert parsed["val"] == 1.235

    def test_ends_with_lf(self) -> None:
        result = canonical_json({"a": 1})
        assert result.endswith("\n")
        assert "\r\n" not in result


# ---------------------------------------------------------------------------
# write_json_file / load_json_file round-trip
# ---------------------------------------------------------------------------


class TestJsonFileRoundTrip:
    def test_round_trip_preserves_structure(self, tmp_path: Path) -> None:
        data = {"key": "value", "nested": {"n": 42}, "list": [1, 2, 3]}
        path = tmp_path / "test.json"
        write_json_file(path, data)
        loaded = load_json_file(path)
        assert loaded == data

    def test_round_trip_with_floats(self, tmp_path: Path) -> None:
        data = {"pi": 3.14159}
        path = tmp_path / "test.json"
        write_json_file(path, data)
        loaded = load_json_file(path)
        assert loaded["pi"] == 3.142  # rounded to 3 decimals
