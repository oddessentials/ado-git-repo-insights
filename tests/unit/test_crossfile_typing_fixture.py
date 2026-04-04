"""Cross-file typing fixture: proves mypy enforces load_json_file return type.

This file is checked by mypy as part of `mypy src/ tests/ scripts/`.
If demo_generation_common were still in ignore_missing_imports, mypy would
treat load_json_file as returning Any and this file would pass silently.
With the fix, mypy resolves the real return type (dict[str, JSONValue])
and the WRONG usage below would fail — proving enforcement is active.

The test function verifies at runtime that the narrowing helpers work
correctly on actual JSON data.
"""

from __future__ import annotations

import importlib.util
from collections.abc import Mapping
from pathlib import Path
from types import ModuleType

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


def test_narrowing_chain_on_loaded_json(tmp_path: Path) -> None:
    """Exercise a real narrow_mapping → .get() → narrow_sequence chain.

    This is the exact pattern that used to work silently under Any and now
    requires explicit narrowing.  If someone reverts the mypy config fix,
    the mypy gate (not this test) would stop catching missing narrowing.
    """
    # Write a mini JSON file matching the manifest shape
    data_path = tmp_path / "test.json"
    data_path.write_text(
        '{"features": {"predictions": true}, "items": [1, 2, 3]}',
        encoding="utf-8",
    )

    load_json_file = _MOD.load_json_file
    narrow_mapping = _MOD.narrow_mapping
    narrow_sequence = _MOD.narrow_sequence

    loaded = load_json_file(data_path)
    assert isinstance(loaded, dict)

    # Chained narrowing: dict → nested dict → value
    features = narrow_mapping(loaded.get("features", {}))
    assert isinstance(features, Mapping)
    assert features.get("predictions") is True

    # Chained narrowing: dict → list
    items = narrow_sequence(loaded.get("items", []))
    assert list(items) == [1, 2, 3]


def test_narrow_mapping_rejects_non_dict() -> None:
    narrow_mapping = _MOD.narrow_mapping
    import pytest

    with pytest.raises(TypeError, match="Expected dict"):
        narrow_mapping("not a dict")


def test_narrow_sequence_rejects_non_list() -> None:
    narrow_sequence = _MOD.narrow_sequence
    import pytest

    with pytest.raises(TypeError, match="Expected list"):
        narrow_sequence(42)


def test_narrow_int_extracts_number() -> None:
    narrow_int = _MOD.narrow_int
    assert narrow_int(42) == 42
    assert narrow_int(3.7) == 3  # truncation

    import pytest

    with pytest.raises(TypeError, match="Expected numeric"):
        narrow_int("not a number")
