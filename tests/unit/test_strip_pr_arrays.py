"""Unit tests for ``scripts/strip_pr_arrays.py`` (feature 060 FR-023).

Covers the full positive + negative matrix from the contract:

* Mixed input (some rollups with PR-level fields, some without) stripped
  cleanly; unaffected files byte-identical.
* Rollup with all three PR-level fields present: all three removed.
* Empty directory: zeroed report, no error.
* Already-stripped directory: no modifications, no error.
* Non-existent directory: ``FileNotFoundError``.
* Synthetic residue (non-JSON-serializable + injection case): re-verify
  raises ``PrArrayResidueError``.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from types import ModuleType


REPO_ROOT = Path(__file__).resolve().parents[2]
STRIP_MODULE_PATH = REPO_ROOT / "scripts" / "strip_pr_arrays.py"


def _load_strip_module() -> ModuleType:
    import sys

    spec = importlib.util.spec_from_file_location("strip_pr_arrays", STRIP_MODULE_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    # Dataclass machinery on CPython 3.14 reads `sys.modules[cls.__module__]`
    # to resolve forward-referenced types; for ad-hoc importlib loads we
    # register the module BEFORE executing it so frozen-dataclass classes
    # in the loaded file can introspect their own module.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


_strip = _load_strip_module()
strip_pr_arrays_from_rollups = _strip.strip_pr_arrays_from_rollups
PrArrayResidueError = _strip.PrArrayResidueError
PR_LEVEL_FIELDS = _strip.PR_LEVEL_FIELDS


@pytest.fixture
def rollup_dir(tmp_path: Path) -> Path:
    """A fresh rollup source dir with `weekly_rollups/` subfolder."""
    root = tmp_path / "aggregates"
    (root / "weekly_rollups").mkdir(parents=True, exist_ok=True)
    return root


def _write_rollup(rollup_dir: Path, name: str, payload: dict[str, object]) -> Path:
    path = rollup_dir / "weekly_rollups" / name
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    return path


def _hash_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _tenant_rollup(week: str) -> dict[str, object]:
    return {
        "week": week,
        "start_date": "2025-01-06",
        "end_date": "2025-01-12",
        "pr_count": 3,
        "cycle_time_p50": 120.0,
        "cycle_time_p90": 480.0,
        "authors_count": 2,
        "reviewers_count": 1,
        "by_repository": {"web-app": {"pr_count": 3}},
        "by_author": {"alice": {"pr_count": 3}},
        "prs": [
            {
                "id": 1,
                "title": "feat",
                "author_id": "alice",
                "repository_id": "r1",
                "cycle_time": 120.0,
            },
        ],
        "_prs_truncated": False,
        "_prs_cap": 500,
    }


def _stripped_rollup(week: str) -> dict[str, object]:
    payload = _tenant_rollup(week)
    for key in PR_LEVEL_FIELDS:
        payload.pop(key, None)
    return payload


def test_mixed_input_strips_pr_level_fields_and_leaves_other_files_byte_identical(
    rollup_dir: Path,
) -> None:
    tenant_path = _write_rollup(rollup_dir, "2025-W01.json", _tenant_rollup("2025-W01"))
    already_clean_payload = _stripped_rollup("2025-W02")
    clean_path = _write_rollup(rollup_dir, "2025-W02.json", already_clean_payload)
    clean_hash_before = _hash_file(clean_path)

    report = strip_pr_arrays_from_rollups(rollup_dir)

    assert report.files_scanned == 2
    assert report.files_modified == 1  # only the tenant rollup was modified
    assert report.fields_removed == {"prs": 1, "_prs_truncated": 1, "_prs_cap": 1}

    # Tenant rollup now matches the stripped shape.
    with tenant_path.open("r", encoding="utf-8") as fh:
        tenant_payload = json.load(fh)
    for key in PR_LEVEL_FIELDS:
        assert key not in tenant_payload

    # Already-clean rollup is byte-identical before and after the strip pass.
    assert _hash_file(clean_path) == clean_hash_before


def test_all_three_pr_level_fields_are_removed_when_all_present(
    rollup_dir: Path,
) -> None:
    path = _write_rollup(rollup_dir, "2025-W03.json", _tenant_rollup("2025-W03"))
    strip_pr_arrays_from_rollups(rollup_dir)
    with path.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    for key in PR_LEVEL_FIELDS:
        assert key not in payload


def test_empty_directory_returns_zero_report_and_no_error(
    rollup_dir: Path,
) -> None:
    report = strip_pr_arrays_from_rollups(rollup_dir)
    assert report.files_scanned == 0
    assert report.files_modified == 0
    assert report.fields_removed == {"prs": 0, "_prs_truncated": 0, "_prs_cap": 0}


def test_already_stripped_directory_is_a_no_op(rollup_dir: Path) -> None:
    clean_path = _write_rollup(
        rollup_dir, "2025-W04.json", _stripped_rollup("2025-W04")
    )
    before = _hash_file(clean_path)

    report = strip_pr_arrays_from_rollups(rollup_dir)

    assert report.files_scanned == 1
    assert report.files_modified == 0
    assert _hash_file(clean_path) == before


def test_missing_rollup_dir_raises_file_not_found(tmp_path: Path) -> None:
    ghost = tmp_path / "does-not-exist"
    with pytest.raises(FileNotFoundError):
        strip_pr_arrays_from_rollups(ghost)


def test_path_is_not_a_directory_raises_file_not_found(tmp_path: Path) -> None:
    sentinel = tmp_path / "scalar.json"
    sentinel.write_text("{}\n", encoding="utf-8")
    with pytest.raises(FileNotFoundError):
        strip_pr_arrays_from_rollups(sentinel)


def test_synthetic_residue_injection_after_strip_raises_residue_error(
    rollup_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Simulate a bug where the strip-write step silently drops keys.

    We monkeypatch the `_strip_one` helper to bypass the mutation pass, so
    the re-verify sweep is the only line of defense. A file still carrying
    PR-level fields MUST surface as PrArrayResidueError — proving the gate
    does not rely on the strip function being correct on its own.
    """
    _write_rollup(rollup_dir, "2025-W05.json", _tenant_rollup("2025-W05"))

    def _sabotaged_strip(path: Path, fields_removed: dict[str, int]) -> bool:
        # No-op: skip the mutation entirely, leaving residue in place.
        return False

    monkeypatch.setattr(_strip, "_strip_one", _sabotaged_strip)
    with pytest.raises(PrArrayResidueError) as exc_info:
        strip_pr_arrays_from_rollups(rollup_dir)
    # Message MUST identify at least one residue field.
    assert "prs" in str(exc_info.value)
