"""Shared utilities for deterministic demo data generation."""

from __future__ import annotations

import json
import sys
import time
import uuid
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, cast

FIXED_GENERATED_AT = datetime(2026, 1, 30, 12, 0, 0, tzinfo=timezone.utc)
COMMITTED_DEMO_BASELINE_PYTHON = (3, 10)
COMMITTED_DEMO_BASELINE_PYTHON_VERSION = "3.10.x"
COMMITTED_DEMO_BASELINE_PYTHON_MAJOR_MINOR = "3.10"
CANONICAL_COMMITTED_DEMO_SCRIPT = "scripts/build-demo-dataset.py"
CANONICAL_COMMITTED_DEMO_MODE = "canonical-committed-demo"
GENERATION_PROVENANCE_KEYS = {
    "python_version",
    "python_major_minor",
    "generator_script",
    "generation_mode",
}
_REPO_ROOT = Path(__file__).resolve().parent.parent
COMMITTED_DEMO_OUTPUT_ROOTS = {
    _REPO_ROOT / "docs" / "data",
    _REPO_ROOT / "artifacts" / "demo-enterprise" / "data",
}


def _normalize_repo_relative_path(path: str | Path) -> str:
    """Normalize a path to a stable repo-relative forward-slash form."""
    path_obj = Path(path)
    if not path_obj.is_absolute():
        return str(path_obj).replace("\\", "/")
    return str(path_obj.relative_to(_REPO_ROOT)).replace("\\", "/")


def require_demo_generation_baseline(script_path: str | Path) -> None:
    """Fail fast if committed-demo generation is not running on baseline Python."""
    current_major_minor = (sys.version_info.major, sys.version_info.minor)
    if current_major_minor != COMMITTED_DEMO_BASELINE_PYTHON:
        normalized_script = _normalize_repo_relative_path(script_path)
        required = COMMITTED_DEMO_BASELINE_PYTHON_MAJOR_MINOR
        current = f"{sys.version_info.major}.{sys.version_info.minor}"
        raise RuntimeError(
            "Committed demo artifacts must be generated with Python "
            f"{required}.x. Refusing to run {normalized_script} under Python "
            f"{current}. Use the canonical committed-demo path on the approved "
            "baseline interpreter."
        )


def require_demo_generation_baseline_for_output(
    script_path: str | Path,
    output_root: str | Path,
) -> None:
    """Require baseline Python when writing to committed demo artifact roots."""
    resolved_output = Path(output_root).resolve()
    if resolved_output in COMMITTED_DEMO_OUTPUT_ROOTS:
        require_demo_generation_baseline(script_path)


def build_generation_provenance(
    *,
    generator_script: str | Path,
    generation_mode: str,
) -> dict[str, str]:
    """Build stable, comparison-safe generation provenance metadata."""
    return {
        "python_version": COMMITTED_DEMO_BASELINE_PYTHON_VERSION,
        "python_major_minor": COMMITTED_DEMO_BASELINE_PYTHON_MAJOR_MINOR,
        "generator_script": _normalize_repo_relative_path(generator_script),
        "generation_mode": generation_mode,
    }


def validate_generation_provenance(
    metadata: dict[str, Any],
    *,
    expected_generator_script: str | Path,
    expected_generation_mode: str,
    location: str,
) -> None:
    """Validate stable generation provenance metadata against expected values."""
    provenance = metadata.get("generation_provenance")
    if not isinstance(provenance, dict):
        raise RuntimeError(f"{location} is missing generation_provenance metadata")

    missing = sorted(GENERATION_PROVENANCE_KEYS - set(provenance))
    if missing:
        raise RuntimeError(
            f"{location} generation_provenance is missing required fields: {missing}"
        )

    expected = build_generation_provenance(
        generator_script=expected_generator_script,
        generation_mode=expected_generation_mode,
    )
    mismatches = {
        key: {"expected": expected[key], "actual": provenance.get(key)}
        for key in sorted(expected)
        if provenance.get(key) != expected[key]
    }
    if mismatches:
        raise RuntimeError(
            f"{location} generation_provenance does not match the approved "
            f"committed-demo contract: {mismatches}"
        )


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
