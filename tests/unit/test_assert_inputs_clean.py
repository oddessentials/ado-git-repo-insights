"""Unit tests for `assert_inputs_clean` (feature 309, slice 2c).

Guards against running the promotion step on an undefined
combination of staged-and-unstaged input state that cannot be reproduced
from any single git commit.

Exercises three scenarios inside isolated ``tmp_path`` git repositories:
    1. Worktree-unstaged modification of a tracked input -> raises with
       stderr keyword `unstaged changes in inputs:`
    2. Staged modification not yet in HEAD -> raises with keyword
       `staged changes in inputs:`
    3. Clean worktree and index -> does NOT raise.

Cross-OS (QG-39): pathlib + UTF-8; git subprocess with forward-slash paths.
Typing  (QG-40): full annotations; no ``typing.Any``.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Final

import pytest

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
BUILD_SCRIPT: Final[Path] = REPO_ROOT / "scripts" / "build-demo-dataset.py"


def _load_script_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None, f"Cannot build spec for {name} at {path}"
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


def _init_repo(repo_root: Path) -> None:
    subprocess.run(["git", "init", "-q"], cwd=str(repo_root), check=True)
    subprocess.run(
        ["git", "config", "user.email", "test@example.com"],
        cwd=str(repo_root),
        check=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test"],
        cwd=str(repo_root),
        check=True,
    )


def _commit_inputs(repo_root: Path, inputs: list[Path]) -> None:
    for rel in inputs:
        path = repo_root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("baseline\n", encoding="utf-8")
    subprocess.run(
        ["git", "add", *(p.as_posix() for p in inputs)],
        cwd=str(repo_root),
        check=True,
    )
    subprocess.run(
        ["git", "commit", "-q", "-m", "baseline"],
        cwd=str(repo_root),
        check=True,
    )


def test_clean_worktree_and_index_passes(
    build_module: ModuleType, tmp_path: Path
) -> None:
    _init_repo(tmp_path)
    inputs = [Path("scripts/build-demo-dataset.py")]
    _commit_inputs(tmp_path, inputs)
    build_module.assert_inputs_clean(tmp_path, inputs)


def test_unstaged_worktree_change_raises(
    build_module: ModuleType, tmp_path: Path
) -> None:
    _init_repo(tmp_path)
    inputs = [Path("scripts/build-demo-dataset.py")]
    _commit_inputs(tmp_path, inputs)
    (tmp_path / inputs[0]).write_text("mutated\n", encoding="utf-8")
    with pytest.raises(build_module.UncommittedInputsError) as excinfo:
        build_module.assert_inputs_clean(tmp_path, inputs)
    assert "unstaged changes in inputs" in str(excinfo.value)


def test_staged_change_not_in_head_raises(
    build_module: ModuleType, tmp_path: Path
) -> None:
    _init_repo(tmp_path)
    inputs = [Path("scripts/build-demo-dataset.py")]
    _commit_inputs(tmp_path, inputs)
    (tmp_path / inputs[0]).write_text("staged-only\n", encoding="utf-8")
    subprocess.run(
        ["git", "add", inputs[0].as_posix()],
        cwd=str(tmp_path),
        check=True,
    )
    with pytest.raises(build_module.UncommittedInputsError) as excinfo:
        build_module.assert_inputs_clean(tmp_path, inputs)
    assert "staged changes in inputs" in str(excinfo.value)


def test_allow_dirty_flag_bypasses(build_module: ModuleType, tmp_path: Path) -> None:
    _init_repo(tmp_path)
    inputs = [Path("scripts/build-demo-dataset.py")]
    _commit_inputs(tmp_path, inputs)
    (tmp_path / inputs[0]).write_text("mutated\n", encoding="utf-8")
    build_module.assert_inputs_clean(tmp_path, inputs, allow_dirty=True)
