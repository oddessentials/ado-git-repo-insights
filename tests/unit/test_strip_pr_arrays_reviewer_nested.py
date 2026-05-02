"""Feature 362 FR-028 — strip-helper depth-2 coverage tests.

Contract: ``specs/362-reviewer-pr-drilldown/contracts/per-reviewer-week-prs.md`` § 8.

Covers the three FR-028 invariants:

1. **Top-level strip preserved**: a rollup with rollup-root PR-level fields
   AND empty ``by_reviewer`` has all rollup-root fields removed by
   ``_strip_one`` — the Feature 060 surface stays correct after the
   Feature 362 extension lands.
2. **Nested strip works**: a rollup with rollup-root fields AND
   ``by_reviewer[*]`` entries carrying the trio has BOTH levels stripped;
   ``_verify_clean`` returns an empty list.
3. **Residue-on-incomplete-walk fails-loud**: monkey-patching ``_strip_one``
   to skip the depth-2 walk forces ``strip_pr_arrays_from_rollups`` to raise
   ``PrArrayResidueError`` referencing the per-(reviewer, week) residue
   path — proving the gate's belt-and-braces verify-after-strip design
   catches a regression even if a future ``_strip_one`` change drops the
   nested visitor.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from types import ModuleType


REPO_ROOT = Path(__file__).resolve().parents[2]
STRIP_MODULE_PATH = REPO_ROOT / "scripts" / "strip_pr_arrays.py"


def _load_strip_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "strip_pr_arrays_for_reviewer_nested_tests",
        STRIP_MODULE_PATH,
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


_strip = _load_strip_module()
strip_pr_arrays_from_rollups = _strip.strip_pr_arrays_from_rollups
PrArrayResidueError = _strip.PrArrayResidueError
PR_LEVEL_FIELDS = _strip.PR_LEVEL_FIELDS


@pytest.fixture
def rollup_dir(tmp_path: Path) -> Path:
    root = tmp_path / "aggregates"
    (root / "weekly_rollups").mkdir(parents=True, exist_ok=True)
    return root


def _write_rollup(rollup_dir: Path, name: str, payload: dict[str, object]) -> Path:
    path = rollup_dir / "weekly_rollups" / name
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    return path


def _make_pr_record(pr_id: int, cycle_time: float) -> dict[str, object]:
    return {
        "id": pr_id,
        "title": f"PR {pr_id}",
        "author_id": "alice",
        "repository_id": "r1",
        "cycle_time": cycle_time,
    }


def _rollup_with_root_only(week: str) -> dict[str, object]:
    return {
        "week": week,
        "start_date": "2025-01-06",
        "end_date": "2025-01-12",
        "pr_count": 1,
        "prs": [_make_pr_record(1, 100.0)],
        "_prs_truncated": False,
        "_prs_cap": 500,
        "by_reviewer": {},
    }


def _rollup_with_root_and_nested(week: str) -> dict[str, object]:
    return {
        "week": week,
        "start_date": "2025-01-06",
        "end_date": "2025-01-12",
        "pr_count": 2,
        "prs": [
            _make_pr_record(1, 100.0),
            _make_pr_record(2, 200.0),
        ],
        "_prs_truncated": False,
        "_prs_cap": 500,
        "by_reviewer": {
            "alice@example.com": {
                "reviewed_prs": 2,
                "reviews_count": 2,
                "approval_rate": 1.0,
                "repositories_count": 1,
                "prs": [
                    _make_pr_record(1, 100.0),
                    _make_pr_record(2, 200.0),
                ],
                "_prs_truncated": False,
                "_prs_cap": 500,
            },
            "bob@example.com": {
                "reviewed_prs": 1,
                "reviews_count": 1,
                "approval_rate": 1.0,
                "repositories_count": 1,
                "prs": [_make_pr_record(2, 200.0)],
                "_prs_truncated": False,
                "_prs_cap": 500,
            },
        },
    }


# ---------------------------------------------------------------------------
# (1) Top-level strip preserved (regression lock for the Feature-060 surface)
# ---------------------------------------------------------------------------


def test_top_level_strip_preserved_when_by_reviewer_is_empty(
    rollup_dir: Path,
) -> None:
    path = _write_rollup(
        rollup_dir, "2025-W01.json", _rollup_with_root_only("2025-W01")
    )
    report = strip_pr_arrays_from_rollups(rollup_dir)

    assert report.files_modified == 1
    assert report.fields_removed == {"prs": 1, "_prs_truncated": 1, "_prs_cap": 1}

    with path.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    for key in PR_LEVEL_FIELDS:
        assert key not in payload
    # by_reviewer key remains (we strip its contents not the key itself).
    assert payload["by_reviewer"] == {}


# ---------------------------------------------------------------------------
# (2) Nested strip works at depth 2 (FR-028 — the new contract)
# ---------------------------------------------------------------------------


def test_nested_strip_removes_per_reviewer_week_trio_at_depth_2(
    rollup_dir: Path,
) -> None:
    path = _write_rollup(
        rollup_dir,
        "2025-W02.json",
        _rollup_with_root_and_nested("2025-W02"),
    )
    report = strip_pr_arrays_from_rollups(rollup_dir)

    assert report.files_modified == 1
    # 1 root-level removal per field + 2 reviewer-level removals per field
    # → 3 total removals per field across the two depths.
    assert report.fields_removed == {"prs": 3, "_prs_truncated": 3, "_prs_cap": 3}

    with path.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    # Root-level: stripped.
    for key in PR_LEVEL_FIELDS:
        assert key not in payload
    # Depth 2: each by_reviewer entry has the trio stripped, but the entry
    # itself remains with the original 4 metric fields intact.
    by_reviewer = payload["by_reviewer"]
    assert isinstance(by_reviewer, dict)
    assert set(by_reviewer.keys()) == {"alice@example.com", "bob@example.com"}
    for reviewer_id, entry in by_reviewer.items():
        assert isinstance(entry, dict), f"non-dict entry for {reviewer_id}"
        for forbidden in PR_LEVEL_FIELDS:
            assert forbidden not in entry, (
                f"by_reviewer[{reviewer_id}].{forbidden} not stripped"
            )
        # Original reviewer metric fields preserved.
        assert "reviewed_prs" in entry
        assert "reviews_count" in entry


# ---------------------------------------------------------------------------
# (3) Fail-loud regression: monkey-patched _strip_one that skips depth-2
# ---------------------------------------------------------------------------


def test_residue_on_incomplete_depth_2_walk_raises_residue_error(
    rollup_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Depth-2 residue surfaces as ``PrArrayResidueError`` when ``_strip_one`` regresses.

    Simulates a future regression where ``_strip_one`` reverts to the
    Feature-060 single-depth pattern (depth-0 only).  The verify-after-
    strip pass MUST raise ``PrArrayResidueError`` referencing the
    ``by_reviewer[<reviewer_id>].<field>`` residue path so demo-build CI
    fails loud rather than silently shipping per-(reviewer, week) PR
    detail to public artifacts.
    """
    _write_rollup(
        rollup_dir,
        "2025-W03.json",
        _rollup_with_root_and_nested("2025-W03"),
    )

    # Patched strip drops depth-2: only the root-level fields are removed.
    def _depth_zero_only_strip(path: Path, fields_removed: dict[str, int]) -> bool:
        payload = _strip._load_rollup(path)
        modified = False
        for key in PR_LEVEL_FIELDS:
            if key in payload:
                payload.pop(key, None)
                fields_removed[key] += 1
                modified = True
        if modified:
            _strip._write_rollup(path, payload)
        return modified

    monkeypatch.setattr(_strip, "_strip_one", _depth_zero_only_strip)
    with pytest.raises(PrArrayResidueError) as exc_info:
        strip_pr_arrays_from_rollups(rollup_dir)
    msg = str(exc_info.value)
    # Residue path explicitly mentions the by_reviewer bucket so a future
    # fix author has the offending site without rerunning the strip.
    assert "by_reviewer[" in msg
    assert "prs" in msg
