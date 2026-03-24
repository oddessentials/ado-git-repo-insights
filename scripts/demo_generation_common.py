"""Shared utilities for deterministic demo data generation."""

from __future__ import annotations

import json
import time
import uuid
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, cast

FIXED_GENERATED_AT = datetime(2026, 1, 30, 12, 0, 0, tzinfo=timezone.utc)


def round_float(value: float, decimals: int = 3) -> float:
    """Round float to specified decimal places using HALF_UP rounding."""
    quantized = Decimal(str(value)).quantize(
        Decimal(10) ** -decimals,
        rounding=ROUND_HALF_UP,
    )
    return float(quantized)


def largest_remainder_allocate(total: int, weights: list[float]) -> list[int]:
    """Allocate an integer total proportionally across weighted buckets."""
    if total < 0:
        raise ValueError(f"total must be non-negative, got {total}")
    if not weights:
        return []

    weight_sum = sum(weights)
    if weight_sum == 0:
        base = total // len(weights)
        remainder = total % len(weights)
        return [base + (1 if i < remainder else 0) for i in range(len(weights))]

    normalized = [weight / weight_sum for weight in weights]
    raw = [total * weight for weight in normalized]
    floors = [int(value // 1) for value in raw]
    remainder = total - sum(floors)
    ranked_remainders = sorted(
        ((raw[index] - floors[index], index) for index in range(len(weights))),
        key=lambda item: item[0],
        reverse=True,
    )
    for idx in range(remainder):
        floors[ranked_remainders[idx][1]] += 1
    return floors


def _process_floats(obj: Any) -> Any:
    if isinstance(obj, float):
        return round_float(obj)
    if isinstance(obj, dict):
        return {k: _process_floats(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_process_floats(item) for item in obj]
    return obj


def _default_serializer(obj: Any) -> Any:
    if isinstance(obj, datetime):
        return obj.strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(obj, date):
        return obj.isoformat()
    if isinstance(obj, uuid.UUID):
        return str(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def canonical_json(data: Any, indent: int = 2) -> str:
    """Generate canonical JSON with stable formatting and LF endings."""
    processed = _process_floats(data)
    json_str = json.dumps(
        processed,
        indent=indent,
        sort_keys=True,
        default=_default_serializer,
        ensure_ascii=False,
    )
    return json_str.replace("\r\n", "\n") + "\n"


def write_json_file(path: Path, data: Any, *, max_retries: int = 1) -> None:
    """Write canonical JSON with optional retries for transient OS errors."""
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = canonical_json(data).encode("utf-8")
    for attempt in range(max_retries):
        try:
            path.write_bytes(encoded)
            return
        except OSError:
            if attempt < max_retries - 1:
                time.sleep(0.1 * (attempt + 1))
            else:
                raise


def load_json_file(path: Path, *, max_retries: int = 3) -> dict[str, Any]:
    """Load JSON from disk with retries for transient filesystem races."""
    for attempt in range(max_retries):
        try:
            return cast(dict[str, Any], json.loads(path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            if attempt < max_retries - 1:
                time.sleep(0.1 * (attempt + 1))
            else:
                raise
    raise AssertionError("unreachable")


def discover_demo_feature_flags(data_dir: Path) -> dict[str, bool]:
    """Derive manifest feature flags from generated demo artifacts."""
    return {
        "predictions": (data_dir / "predictions" / "trends.json").exists(),
        "ai_insights": (data_dir / "insights" / "summary.json").exists(),
        "cross_dimensional": True,
    }


def refresh_demo_manifest_features(manifest_path: Path, data_dir: Path) -> None:
    """Refresh manifest feature flags from the generated demo dataset."""
    manifest = load_json_file(manifest_path)
    manifest.setdefault("features", {}).update(discover_demo_feature_flags(data_dir))
    write_json_file(manifest_path, manifest)
