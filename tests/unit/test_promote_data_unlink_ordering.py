"""Unlink-ordering + atomic-failure tests for promote_data (feature 309, slice 2b).

Contract: `specs/309-demo-pr-drilldown/contracts/demo-strip-gate-v2.md` §1 and
`specs/309-demo-pr-drilldown/contracts/synthetic-authorization-signal.md` §5.

Records the exact order of mutating calls (`sentinel.unlink`,
`destination.mkdir`, `shutil.copytree`, `strip_pr_arrays_from_rollups`) on
the sentinel-present branch of ``promote_data``. Asserts unlink is the FIRST
mutating call after the branch decision — every subsequent step depends on
unlink having succeeded, so if unlink raises (PermissionError, OSError, or
a race-induced FileNotFoundError), the destination directory MUST remain
byte-identical to its pre-call state.

Cross-OS (QG-39): pathlib + UTF-8; no shell. ``shutil`` and monkeypatch
are cross-platform. Typing (QG-40): full annotations; no `typing.Any`.
"""

from __future__ import annotations

import hashlib
import importlib.util
import shutil
import sys
from collections.abc import Callable, Iterable
from pathlib import Path
from types import ModuleType
from typing import Final
from unittest.mock import MagicMock

import pytest

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
BUILD_SCRIPT: Final[Path] = REPO_ROOT / "scripts" / "build-demo-dataset.py"
FIXTURES_ROOT: Final[Path] = REPO_ROOT / "tests" / "demo" / "fixtures" / "strip_gate"


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


def _hash_tree(root: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    if not root.exists():
        return result
    for path in sorted(root.rglob("*")):
        if path.is_file():
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            result[path.relative_to(root).as_posix()] = digest
    return result


def _prepare_scratch_source(tmp_path: Path) -> Path:
    """Clone the sentinel-present-synthetic-shaped fixture into tmp_path.

    promote_data mutates the source (unlinks the sentinel) so tests run
    against a scratch copy rather than the committed fixture.
    """
    scratch = tmp_path / "source"
    shutil.copytree(FIXTURES_ROOT / "sentinel-present-synthetic-shaped", scratch)
    return scratch


def test_sentinel_unlink_precedes_all_destination_mutations(
    build_module: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = _prepare_scratch_source(tmp_path)
    destination = tmp_path / "docs-data"
    monkeypatch.setattr(build_module, "DOCS_DATA_DIR", destination)

    order: list[str] = []

    original_unlink = Path.unlink

    def _record_unlink(self: Path, missing_ok: bool = False) -> None:
        if self.name == build_module.SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME:
            order.append("sentinel.unlink")
        original_unlink(self, missing_ok=missing_ok)

    original_mkdir = Path.mkdir

    def _record_mkdir(
        self: Path,
        mode: int = 0o777,
        parents: bool = False,
        exist_ok: bool = False,
    ) -> None:
        if self == destination:
            order.append("destination.mkdir")
        original_mkdir(self, mode=mode, parents=parents, exist_ok=exist_ok)

    original_copytree = shutil.copytree
    copytree_seen = [False]

    def _record_copytree(
        src: str,
        dst: str,
        symlinks: bool = False,
        ignore: Callable[[str, list[str]], Iterable[str]] | None = None,
        copy_function: Callable[[str, str], object] = shutil.copy2,
        ignore_dangling_symlinks: bool = False,
        dirs_exist_ok: bool = False,
    ) -> str:
        if not copytree_seen[0]:
            order.append("shutil.copytree")
            copytree_seen[0] = True
        return original_copytree(
            src,
            dst,
            symlinks=symlinks,
            ignore=ignore,
            copy_function=copy_function,
            ignore_dangling_symlinks=ignore_dangling_symlinks,
            dirs_exist_ok=dirs_exist_ok,
        )

    monkeypatch.setattr(Path, "unlink", _record_unlink)
    monkeypatch.setattr(Path, "mkdir", _record_mkdir)
    monkeypatch.setattr(build_module.shutil, "copytree", _record_copytree)

    build_module.promote_data(source, destination)

    assert order, "Expected promote_data to mutate something"
    assert order[0] == "sentinel.unlink", (
        f"Expected sentinel.unlink to be the first mutation; got order={order}"
    )


def test_sentinel_unlink_failure_leaves_destination_untouched(
    build_module: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = _prepare_scratch_source(tmp_path)
    destination = tmp_path / "docs-data"
    destination.mkdir()
    (destination / "pre-existing.marker").write_bytes(b"baseline\n")
    pre_tree = _hash_tree(destination)

    monkeypatch.setattr(build_module, "DOCS_DATA_DIR", destination)

    mkdir_mock = MagicMock()
    copytree_mock = MagicMock()
    monkeypatch.setattr(Path, "mkdir", mkdir_mock)
    monkeypatch.setattr(build_module.shutil, "copytree", copytree_mock)

    original_unlink = Path.unlink

    def _raising_unlink(self: Path, missing_ok: bool = False) -> None:
        if self.name == build_module.SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME:
            raise PermissionError("simulated unlink failure")
        original_unlink(self, missing_ok=missing_ok)

    monkeypatch.setattr(Path, "unlink", _raising_unlink)

    with pytest.raises(PermissionError):
        build_module.promote_data(source, destination)

    mkdir_mock.assert_not_called()
    copytree_mock.assert_not_called()
    assert _hash_tree(destination) == pre_tree, (
        "Destination byte-diverged after unlink failure — atomicity violated."
    )
