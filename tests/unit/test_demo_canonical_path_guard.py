"""Hard-guard contract for committed canonical demo paths."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SCRIPTS_DIR = _REPO_ROOT / "scripts"

_spec = importlib.util.spec_from_file_location(
    "demo_generation_common",
    _SCRIPTS_DIR / "demo_generation_common.py",
)
assert _spec is not None
assert _spec.loader is not None
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
assert_safe_output_root = _module.assert_safe_output_root


@pytest.mark.parametrize(
    "canonical_subpath",
    [
        "docs/data",
        "artifacts/demo-enterprise/data",
        "artifacts/demo-enterprise-comments-off/data",
    ],
)
def test_rejects_committed_path_without_override(canonical_subpath: str) -> None:
    target = _REPO_ROOT / canonical_subpath
    with pytest.raises(RuntimeError, match="Refusing to write demo artifacts"):
        assert_safe_output_root(target, commit_canonical=False)


@pytest.mark.parametrize(
    "canonical_subpath",
    [
        "docs/data",
        "artifacts/demo-enterprise/data",
        "artifacts/demo-enterprise-comments-off/data",
    ],
)
def test_allows_committed_path_with_override(canonical_subpath: str) -> None:
    target = _REPO_ROOT / canonical_subpath
    assert_safe_output_root(target, commit_canonical=True)


def test_allows_path_outside_canonical_roots(tmp_path: Path) -> None:
    target = tmp_path / "scratch_output"
    assert_safe_output_root(target, commit_canonical=False)
