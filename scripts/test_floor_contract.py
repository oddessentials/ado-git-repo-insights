#!/usr/bin/env python3
"""Helpers for the committed Python/Extension test floor contract."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class SuiteFloor:
    min_collected: int
    authority: str


@dataclass(frozen=True)
class TestFloorContract:
    python: SuiteFloor
    extension: SuiteFloor


def load_test_floor_contract(path: Path) -> TestFloorContract:
    """Load the committed test floor contract from disk."""
    data = json.loads(path.read_text(encoding="utf-8"))
    return TestFloorContract(
        python=_load_suite(data, "python", path),
        extension=_load_suite(data, "extension", path),
    )


def render_test_floor_contract(
    *, python_min_collected: int, extension_min_collected: int
) -> dict[str, object]:
    """Render the canonical JSON shape for the committed test floor contract."""
    return {
        "schema_version": 1,
        "python": {
            "min_collected": python_min_collected,
            "authority": (
                "scripts.check_ratchet_bump.collect_python_snapshot"
                "(apply_platform_filters=True)"
            ),
        },
        "extension": {
            "min_collected": extension_min_collected,
            "authority": "extension/test-results.xml parsed via measure_extension_count",
        },
    }


def _load_suite(data: dict[str, object], suite: str, path: Path) -> SuiteFloor:
    suite_raw = data.get(suite)
    if not isinstance(suite_raw, dict):
        raise ValueError(f"{path}: missing suite object {suite!r}")
    min_collected = suite_raw.get("min_collected")
    authority = suite_raw.get("authority")
    if not isinstance(min_collected, int):
        raise ValueError(f"{path}: {suite!r}.min_collected must be an integer")
    if not isinstance(authority, str) or not authority:
        raise ValueError(f"{path}: {suite!r}.authority must be a non-empty string")
    return SuiteFloor(min_collected=min_collected, authority=authority)
