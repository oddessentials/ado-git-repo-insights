"""Sentinel-present nested-PR strip test for promote_data (Feature 362, FR-028).

When the synthetic-authorization sentinel is present in the source
aggregates, the public ``docs/data/`` promotion preserves the rollup-root
PR trio (so the #309 / #315 demo PR drill-down works on the synthetic
surface) but MUST strip the Feature-362 nested per-(reviewer, week) PR
detail (``by_reviewer[*].prs`` / ``_prs_truncated`` / ``_prs_cap``) — that
surface is too granular for public consumption.

This test asserts the dual-state invariant on the sentinel-present
branch of ``promote_data``: depth-0 trio survives, depth-2 trio is gone.
The companion atomicity / ordering coverage lives in
``tests/unit/test_promote_data_unlink_ordering.py`` (sentinel.unlink
ordering + failure rollback) and
``tests/demo/test_demo_parity_pipeline.py`` (full pipeline).

Cross-OS (QG-39): pathlib + UTF-8; no shell. Typing (QG-40): full
annotations; no ``typing.Any``.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType
from typing import Final

import pytest

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
BUILD_SCRIPT: Final[Path] = REPO_ROOT / "scripts" / "build-demo-dataset.py"
SENTINEL_NAME: Final[str] = ".synthetic-prs-authorized"


def _load_script_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None, f"No spec for {name} at {path}"
    assert spec.loader is not None, f"Spec for {name} has no loader"
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def build_module() -> ModuleType:
    scripts_dir = REPO_ROOT / "scripts"
    _load_script_module(
        "demo_generation_common", scripts_dir / "demo_generation_common.py"
    )
    _load_script_module("demo_shell", scripts_dir / "demo_shell.py")
    _load_script_module("strip_pr_arrays", scripts_dir / "strip_pr_arrays.py")
    return _load_script_module("build_demo_dataset", BUILD_SCRIPT)


def _build_sentinel_present_source(root: Path) -> Path:
    """Materialize a sentinel-present source tree with depth-0 + depth-2 trios.

    Mirrors the committed fixture
    ``tests/demo/fixtures/strip_gate/sentinel-present-synthetic-shaped``
    augmented with a Feature-362 ``by_reviewer`` entry that carries the
    nested PR trio.  Both depths must be present in the input for this
    test to be meaningful.
    """
    aggregates = root / "aggregates"
    rollups = aggregates / "weekly_rollups"
    rollups.mkdir(parents=True)
    (aggregates / SENTINEL_NAME).write_bytes(b"")
    pr_alpha = {
        "id": 10,
        "title": "synthetic-alpha",
        "author_id": "user-aaa",
        "repository_id": "repo-1",
        "cycle_time": 60.0,
    }
    pr_beta = {
        "id": 11,
        "title": "synthetic-beta",
        "author_id": "user-bbb",
        "repository_id": "repo-2",
        "cycle_time": 45.0,
    }
    rollup = {
        "week": "2025-W10",
        "pr_count": 2,
        "prs": [pr_alpha, pr_beta],
        "_prs_truncated": False,
        "_prs_cap": 500,
        "by_reviewer": {
            "reviewer-1": {
                "reviews_count": 2,
                "reviewed_prs": 2,
                "approval_rate": 1.0,
                "repositories_count": 2,
                "prs": [pr_alpha, pr_beta],
                "_prs_truncated": False,
                "_prs_cap": 500,
            },
        },
    }
    (rollups / "2025-W10.json").write_text(
        json.dumps(rollup, indent=2),
        encoding="utf-8",
    )
    return root


def test_sentinel_present_promotion_strips_nested_reviewer_pr_detail(
    build_module: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = _build_sentinel_present_source(tmp_path / "source")
    destination = tmp_path / "docs-data"
    monkeypatch.setattr(build_module, "DOCS_DATA_DIR", destination)

    build_module.promote_data(source, destination)

    promoted = destination / "aggregates" / "weekly_rollups" / "2025-W10.json"
    assert promoted.exists(), "promoted rollup missing in destination"
    payload = json.loads(promoted.read_text(encoding="utf-8"))

    # Depth-0 trio survives — #309 / #315 binary gate.
    assert "prs" in payload, (
        "depth-0 prs stripped from sentinel-present promotion; "
        "#309 demo PR drill-down on docs/data is broken"
    )
    assert "_prs_truncated" in payload
    assert "_prs_cap" in payload
    assert payload["prs"] == [
        {
            "id": 10,
            "title": "synthetic-alpha",
            "author_id": "user-aaa",
            "repository_id": "repo-1",
            "cycle_time": 60.0,
        },
        {
            "id": 11,
            "title": "synthetic-beta",
            "author_id": "user-bbb",
            "repository_id": "repo-2",
            "cycle_time": 45.0,
        },
    ]

    # Depth-2 trio is gone — Feature 362 FR-028.
    by_reviewer = payload["by_reviewer"]
    assert "reviewer-1" in by_reviewer
    reviewer_entry = by_reviewer["reviewer-1"]
    assert "prs" not in reviewer_entry, (
        "by_reviewer[reviewer-1].prs survived sentinel-present promotion; "
        "Feature 362 FR-028 nested-strip contract violated"
    )
    assert "_prs_truncated" not in reviewer_entry
    assert "_prs_cap" not in reviewer_entry
    # Non-PR-level reviewer fields stay intact (helper is name-scoped).
    assert reviewer_entry["reviews_count"] == 2
    assert reviewer_entry["reviewed_prs"] == 2
    assert reviewer_entry["approval_rate"] == 1.0
    assert reviewer_entry["repositories_count"] == 2

    # Sentinel removed from destination per the #309 binary gate.
    assert not (destination / "aggregates" / SENTINEL_NAME).exists(), (
        "sentinel survived promotion; #309 binary gate broken"
    )

    # Source artifact must be byte-preserved across promote_data —
    # canonical private tenant tree retains both depth-0 AND depth-2
    # PR detail.  Codex P1 fix: the depth-2 strip runs on the DESTINATION
    # only, never the source.
    source_rollup_path = source / "aggregates" / "weekly_rollups" / "2025-W10.json"
    source_payload = json.loads(source_rollup_path.read_text(encoding="utf-8"))

    # Depth-0 trio still present in source (unaffected — only sentinel
    # was removed pre-copytree).
    assert "prs" in source_payload, (
        "source depth-0 prs disappeared; promote_data is mutating the "
        "canonical artifact tree (it must not)"
    )
    assert "_prs_truncated" in source_payload
    assert "_prs_cap" in source_payload

    # Depth-2 trio still present in source (the regression Codex caught:
    # earlier revision in-place-stripped the source aggregates tree
    # before copytree, degrading the tenant artifact).
    source_by_reviewer = source_payload["by_reviewer"]
    assert "reviewer-1" in source_by_reviewer
    source_reviewer_entry = source_by_reviewer["reviewer-1"]
    assert "prs" in source_reviewer_entry, (
        "source by_reviewer[reviewer-1].prs was stripped during promotion; "
        "the canonical tenant artifact must retain Feature-362 nested "
        "PR detail"
    )
    assert "_prs_truncated" in source_reviewer_entry
    assert "_prs_cap" in source_reviewer_entry

    # Sentinel was removed from source pre-copytree (this part of the
    # #309 binary gate is unchanged) — confirm so the test surface
    # documents the full lifecycle.
    assert not (source / "aggregates" / SENTINEL_NAME).exists(), (
        "sentinel still present on source after promotion; #309 binary "
        "gate's sentinel-unlink-first contract broken"
    )


def test_sentinel_present_promotion_skips_stale_destination_rollups(
    build_module: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Strip must run AFTER stale-file cleanup, never on stale rollups.

    Codex stop-time review caught: ``copytree(dirs_exist_ok=True)`` does
    not remove destination files that aren't in source.  If the depth-2
    strip walks the destination's ``weekly_rollups/`` glob before the
    existing stale-files cleanup, it can hit a rollup left over from a
    prior build whose schema or shape differs from what
    ``strip_nested_reviewer_prs_from_rollups`` accepts — the strip's
    ``_load_rollup`` would then raise and the entire ``promote_data``
    call would fail on benign drift the cleanup would have removed
    anyway.

    Setup: destination already contains a stale rollup file
    (``1999-W99.json``) that is a JSON array — ``_load_rollup`` rejects
    non-object payloads with ``PrArrayResidueError``.  Source has the
    standard sentinel-present synthetic shape with one valid rollup
    (``2025-W10.json``).

    With the strip running after the stale-file cleanup pass, the stale
    rollup is removed before the strip walker sees it; ``promote_data``
    succeeds, the destination ends with only the source's rollup
    (depth-2 stripped, depth-0 preserved), and the stale rollup is
    gone.
    """
    source = _build_sentinel_present_source(tmp_path / "source")
    destination = tmp_path / "docs-data"
    stale_rollups_dir = destination / "aggregates" / "weekly_rollups"
    stale_rollups_dir.mkdir(parents=True)
    stale_path = stale_rollups_dir / "1999-W99.json"
    # JSON array, not object — strip's _load_rollup would raise on this.
    stale_path.write_text("[1, 2, 3]\n", encoding="utf-8")

    monkeypatch.setattr(build_module, "DOCS_DATA_DIR", destination)

    build_module.promote_data(source, destination)

    # Stale destination rollup removed by the cleanup pass.
    assert not stale_path.exists(), (
        "stale destination rollup not cleaned up; ordering or scope "
        "of stale-file cleanup regressed"
    )

    # Source rollup promoted with the standard sentinel-present shape:
    # depth-0 preserved, depth-2 stripped.
    promoted = destination / "aggregates" / "weekly_rollups" / "2025-W10.json"
    assert promoted.exists()
    payload = json.loads(promoted.read_text(encoding="utf-8"))
    assert "prs" in payload, "depth-0 prs lost on sentinel-present promotion"
    assert "_prs_truncated" in payload
    assert "_prs_cap" in payload
    by_reviewer = payload["by_reviewer"]
    assert "reviewer-1" in by_reviewer
    reviewer_entry = by_reviewer["reviewer-1"]
    assert "prs" not in reviewer_entry, (
        "depth-2 prs survived sentinel-present promotion; FR-028 broken"
    )
    assert "_prs_truncated" not in reviewer_entry
    assert "_prs_cap" not in reviewer_entry
