"""Raw-byte tests proving canonical JSON writers emit LF-only line endings.

The demo build chain produces tracked JSON under ``docs/data/`` and
``artifacts/demo-enterprise{,-comments-off}/``.  Every committed byte is
LF.  A canonical writer that opens text-mode without ``newline=""`` will
silently translate ``\\n`` to ``\\r\\n`` on Windows; a subsequent
``copytree`` then carries CRLF into ``docs/data/`` and every "no-op"
canonical build re-dirties hundreds of files with line-ending-only
churn.  These tests lock the contract: every canonical writer in the
demo build chain MUST emit:

  - exactly the bytes ``json.dumps(...).encode("utf-8")`` plus one
    trailing ``b"\\n"`` (no platform CRLF translation);
  - exactly one trailing newline (not zero, not two).

Cross-OS (QG-39): assertions are byte-level and identical on
Windows / Linux / macOS.  The bug being locked manifests only on
Windows (where text-mode triggers translation), but the assertion
holds everywhere — Linux / macOS runs lock the contract; Windows
runs lock the regression.

Typing (QG-40): full annotations; no ``typing.Any``.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType
from typing import Final

import pytest

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
SCRIPTS_DIR: Final[Path] = REPO_ROOT / "scripts"


def _load_script_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None, f"No spec for {name} at {path}"
    assert spec.loader is not None, f"Spec for {name} has no loader"
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def demo_common() -> ModuleType:
    return _load_script_module(
        "demo_generation_common", SCRIPTS_DIR / "demo_generation_common.py"
    )


@pytest.fixture(scope="module")
def strip_pr_arrays() -> ModuleType:
    return _load_script_module("strip_pr_arrays", SCRIPTS_DIR / "strip_pr_arrays.py")


def _assert_lf_only(raw: bytes, *, who: str) -> None:
    """Assert ``raw`` carries LF line endings only and ends with one LF.

    Three properties locked:
      - no CRLF anywhere — would imply a Windows text-mode translation;
      - at least one LF — non-empty file with at least one logical line;
      - the last byte is ``\\n`` and the second-to-last is NOT ``\\n`` —
        exactly one trailing newline (no missing terminator, no double).
    """
    assert b"\r\n" not in raw, (
        f"{who} emitted CRLF — text-mode translation leaked.  "
        "Use bytes mode (path.write_bytes) or pass newline='\\n' to open()."
    )
    assert b"\n" in raw, f"{who} emitted no LF; payload appears empty"
    assert raw.endswith(b"\n"), f"{who} did not end with LF"
    assert not raw.endswith(b"\n\n"), f"{who} ended with multiple trailing LFs"


def test_write_json_file_emits_lf_only(demo_common: ModuleType, tmp_path: Path) -> None:
    """``demo_generation_common.write_json_file`` must emit LF-only bytes.

    This is the canonical writer used by every ``scripts/generate-demo-*.py``
    script; locking it here prevents a future regression from re-introducing
    text-mode opens that would CRLF-translate on Windows.
    """
    path = tmp_path / "rollup.json"
    payload = {
        "week": "2025-W10",
        "pr_count": 2,
        "by_reviewer": {
            "reviewer-1": {
                "reviews_count": 3,
                "reviewed_prs": 2,
            },
        },
    }
    demo_common.write_json_file(path, payload)

    raw = path.read_bytes()
    _assert_lf_only(raw, who="demo_generation_common.write_json_file")


def test_strip_pr_arrays_write_rollup_emits_lf_only(
    strip_pr_arrays: ModuleType, tmp_path: Path
) -> None:
    """``strip_pr_arrays._write_rollup`` must emit LF-only bytes.

    This is the helper invoked by every strip pass inside ``promote_data``
    (both sentinel-absent ``strip_pr_arrays_from_rollups`` and the new
    sentinel-present ``strip_nested_reviewer_prs_from_rollups``).  Without
    LF-stable output the sentinel-present strip path silently CRLFs every
    file it touches on Windows, which then propagates through ``copytree``
    into ``docs/data/`` — the regression that motivates this test.
    """
    path = tmp_path / "rollup.json"
    payload: dict[str, object] = {
        "week": "2025-W10",
        "pr_count": 1,
        "by_reviewer": {
            "reviewer-1": {
                "reviews_count": 2,
                "reviewed_prs": 1,
            },
        },
    }
    strip_pr_arrays._write_rollup(path, payload)

    raw = path.read_bytes()
    _assert_lf_only(raw, who="strip_pr_arrays._write_rollup")
