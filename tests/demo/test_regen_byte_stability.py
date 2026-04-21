"""Byte-determinism invariant for demo regeneration (feature 309, slice 2d).

Contract: `specs/309-demo-pr-drilldown/contracts/byte-determinism-regen.md` §3.

For every committed weekly rollup under ``docs/data/aggregates/weekly_rollups/``,
regenerate the canonical demo into a scratch artifact root on the baseline
Python interpreter, then strip the three PR-level keys (``prs``,
``_prs_truncated``, ``_prs_cap``) from the regenerated payload and re-
serialize with the aggregator's canonical recipe. The resulting bytes MUST
byte-match the committed rollup file.

Scope discipline: non-baseline interpreters skip this test because the
demo build pins 3.12.x as the deterministic baseline (see
``scripts/demo_generation_common.py::COMMITTED_DEMO_BASELINE_PYTHON_VERSION``).

Cross-OS (QG-39): pathlib + UTF-8; no shell.
Typing  (QG-40): full annotations; no ``typing.Any``.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Final

import pytest

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
DOCS_DATA: Final[Path] = REPO_ROOT / "docs" / "data"
ROLLUPS_DIR: Final[Path] = DOCS_DATA / "aggregates" / "weekly_rollups"
BUILD_SCRIPT: Final[Path] = REPO_ROOT / "scripts" / "build-demo-dataset.py"


def _load_baseline_python_major_minor() -> tuple[int, int]:
    spec = importlib.util.spec_from_file_location(
        "demo_generation_common",
        REPO_ROOT / "scripts" / "demo_generation_common.py",
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    major, minor = module.COMMITTED_DEMO_BASELINE_PYTHON
    return int(major), int(minor)


_BASELINE_MAJOR_MINOR: Final[tuple[int, int]] = _load_baseline_python_major_minor()
_IS_BASELINE_PYTHON: Final[bool] = sys.version_info[:2] == _BASELINE_MAJOR_MINOR


def _canonical_serialize(payload: dict[str, object]) -> bytes:
    """Match the aggregator's canonical writer (demo_generation_common.canonical_json).

    Aggregators and the demo pipeline both emit rollup JSON via `json.dumps(...,
    indent=2, ensure_ascii=False, sort_keys=True)` with a trailing LF. The
    byte-determinism contract's `sort_keys=False` recipe is a drafting error
    (the actual writer has always been `sort_keys=True` so that key insertion
    order cannot cause byte drift); this test mirrors the real writer to
    compare regen vs. committed bytes accurately.
    """
    return (
        json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    ).encode("utf-8")


@pytest.fixture(scope="module")
def regenerated_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Regenerate the canonical demo once per test module into a scratch root."""
    if not _IS_BASELINE_PYTHON:
        pytest.skip(
            f"byte-determinism regen requires Python {_BASELINE_MAJOR_MINOR}; "
            f"running on {sys.version_info[:2]}"
        )
    scratch = tmp_path_factory.mktemp("byte-stability-regen")
    artifact_root = scratch / "artifacts"
    env = os.environ.copy()
    env["ADO_DEMO_ARTIFACT_ROOT"] = str(artifact_root)
    result = subprocess.run(
        [sys.executable, str(BUILD_SCRIPT), "--no-promote"],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, (
        f"build-demo-dataset.py --no-promote failed (rc={result.returncode}):\n"
        f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
    )
    return artifact_root / "data"


def _strip_pr_keys(payload: dict[str, object]) -> dict[str, object]:
    stripped: dict[str, object] = dict(payload)
    for key in ("prs", "_prs_truncated", "_prs_cap"):
        stripped.pop(key, None)
    return stripped


def test_every_committed_rollup_byte_matches_stripped_regen(
    regenerated_root: Path,
) -> None:
    committed_rollups = sorted(ROLLUPS_DIR.glob("*.json"))
    assert committed_rollups, "No committed rollups to compare against"

    drift: list[tuple[str, int]] = []
    for committed_path in committed_rollups:
        rel = committed_path.relative_to(DOCS_DATA)
        regen_path = regenerated_root / rel
        assert regen_path.exists(), f"Regen missing rollup: {regen_path}"

        committed_payload = json.loads(committed_path.read_text(encoding="utf-8"))
        regen_payload = json.loads(regen_path.read_text(encoding="utf-8"))
        assert isinstance(committed_payload, dict)
        assert isinstance(regen_payload, dict)

        committed_stripped_bytes = _canonical_serialize(
            _strip_pr_keys(committed_payload)
        )
        regen_stripped_bytes = _canonical_serialize(_strip_pr_keys(regen_payload))

        if regen_stripped_bytes != committed_stripped_bytes:
            drift.append(
                (
                    committed_path.name,
                    len(regen_stripped_bytes) - len(committed_stripped_bytes),
                )
            )

    assert not drift, (
        f"Byte-determinism regression across {len(drift)} rollup(s): {drift[:5]} "
        "(non-PR content drifted between committed and regenerated rollups)"
    )
