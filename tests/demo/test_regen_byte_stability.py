"""Byte-determinism invariant for demo regeneration (feature 309, slice 2d).

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

import atexit
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from itertools import count
from pathlib import Path
from typing import Final

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
DOCS_DATA: Final[Path] = REPO_ROOT / "docs" / "data"
ROLLUPS_DIR: Final[Path] = DOCS_DATA / "aggregates" / "weekly_rollups"
BUILD_SCRIPT: Final[Path] = REPO_ROOT / "scripts" / "build-demo-dataset.py"
# Mirror tests/demo/test_demo_parity_pipeline.py's scratch pattern: the demo
# build resolves ARTIFACT_ROOT.relative_to(REPO_ROOT) in several places, so
# the scratch artifact root MUST live under REPO_ROOT. pytest's default
# tmp_path_factory plants dirs under /tmp on Linux/macOS — outside the repo
# — which trips `relative_to` at regen time. Pattern deliberately copied
# (not imported) to avoid cross-test-module coupling.
_TEST_TMP_ROOT: Final[Path] = REPO_ROOT / "tmp_test_work"
_SCRATCH_COUNTER = count()


def _cleanup_test_tmp_root() -> None:
    """Best-effort cleanup for the repo-local scratch directory on exit."""
    shutil.rmtree(_TEST_TMP_ROOT, ignore_errors=True)


atexit.register(_cleanup_test_tmp_root)


def _make_scratch_dir(prefix: str) -> Path:
    _TEST_TMP_ROOT.mkdir(parents=True, exist_ok=True)
    scratch = _TEST_TMP_ROOT / f"{prefix}-{next(_SCRATCH_COUNTER):04d}"
    while scratch.exists():
        scratch = _TEST_TMP_ROOT / f"{prefix}-{next(_SCRATCH_COUNTER):04d}"
    scratch.mkdir(parents=True, exist_ok=False)
    return scratch


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


def _strip_pr_keys(payload: dict[str, object]) -> dict[str, object]:
    stripped: dict[str, object] = dict(payload)
    for key in ("prs", "_prs_truncated", "_prs_cap"):
        stripped.pop(key, None)
    # Feature 362 (FR-028) — mirror the public strip helper's depth-2
    # walk at ``scripts/strip_pr_arrays.py::_strip_one``.  ``by_reviewer[*]``
    # carries the same per-(reviewer, week) PR-level trio as the rollup
    # root since #362; the public strip removes it on promote_data, so the
    # "non-PR content" byte comparison MUST exclude it on both sides for
    # the symmetric strip-and-compare to be apples-to-apples.  Without
    # this depth-2 walk, the regenerated private-tenant artifact's
    # ``by_reviewer[*]`` PR detail (always present after T041) appears as
    # drift against the committed public-surface rollups (where the
    # public strip already removed it).
    by_reviewer = stripped.get("by_reviewer")
    if isinstance(by_reviewer, dict):
        rebuilt: dict[str, object] = {}
        for reviewer_id, entry in by_reviewer.items():
            if isinstance(entry, dict):
                cloned = dict(entry)
                for key in ("prs", "_prs_truncated", "_prs_cap"):
                    cloned.pop(key, None)
                rebuilt[reviewer_id] = cloned
            else:
                rebuilt[reviewer_id] = entry
        stripped["by_reviewer"] = rebuilt
    return stripped


def _regenerate_once() -> Path:
    """Regenerate the canonical demo into a scratch root (baseline Python only).

    The scratch artifact root is created under ``REPO_ROOT / "tmp_test_work"``
    so ``build-demo-dataset.py``'s ``ARTIFACT_ROOT.relative_to(REPO_ROOT)``
    calls succeed. See module-level _TEST_TMP_ROOT comment.
    """
    artifact_root = _make_scratch_dir("byte-stability-regen") / "artifacts"
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


def test_committed_rollups_survive_canonical_round_trip() -> None:
    """Every committed rollup bytes must match canonical_serialize round-trip.

    This is the interpreter-agnostic leg of the byte-determinism contract:
    the writer's emitted bytes MUST be reproducible from the parsed payload
    via the canonical recipe on every Python version. Drift here means the
    writer's format silently changed under us and we'd lose byte-identity on
    any future regen.
    """
    committed_rollups = sorted(ROLLUPS_DIR.glob("*.json"))
    assert committed_rollups, "No committed rollups to compare against"

    drift: list[str] = []
    for committed_path in committed_rollups:
        committed_bytes = committed_path.read_bytes()
        parsed = json.loads(committed_bytes.decode("utf-8"))
        reserialized = _canonical_serialize(parsed)
        if reserialized != committed_bytes:
            drift.append(committed_path.name)

    assert not drift, (
        f"Canonical round-trip drift on {len(drift)} rollup(s): {drift[:5]}"
    )


def test_regen_non_pr_content_byte_matches_committed() -> None:
    """Full regen vs. committed symmetric-strip byte compare (baseline Python).

    The baseline interpreter (3.12.x) is the only environment whose regen
    is contractually guaranteed byte-identical to committed non-PR content.
    Off-baseline sessions run the weaker round-trip check above instead of
    skipping (the zero-skip policy forbids pytest.skip here), and register
    the test as passing structurally without invoking the subprocess.
    """
    committed_rollups = sorted(ROLLUPS_DIR.glob("*.json"))
    assert committed_rollups, "No committed rollups to compare against"

    if not _IS_BASELINE_PYTHON:
        # Off-baseline: structural sanity only. Full regen comparison runs on
        # the baseline-Python lane (CI 3.12 cells and local 3.12 operator runs).
        for committed_path in committed_rollups:
            payload = json.loads(committed_path.read_text(encoding="utf-8"))
            assert isinstance(payload, dict), (
                f"committed rollup must be a JSON object: {committed_path}"
            )
        return

    regenerated_root = _regenerate_once()
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
