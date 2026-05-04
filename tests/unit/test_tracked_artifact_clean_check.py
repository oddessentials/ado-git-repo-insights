"""Preflight escape-blocker contract for tracked canonical demo paths."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SCRIPT = _REPO_ROOT / "scripts" / "check_tracked_artifacts_clean.py"


def _init_repo(repo: Path) -> None:
    subprocess.run(
        ["git", "init", "--quiet", "--initial-branch=main", str(repo)],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(repo), "config", "user.email", "test@example.com"],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(repo), "config", "user.name", "Test"],
        check=True,
    )
    for tracked in (
        "artifacts/demo-enterprise/data",
        "artifacts/demo-enterprise-comments-off/data",
        "docs/data",
    ):
        target = repo / tracked
        target.mkdir(parents=True)
        (target / "manifest.json").write_text('{"x": 1}\n', encoding="utf-8")
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
    subprocess.run(
        ["git", "-C", str(repo), "commit", "--quiet", "-m", "seed"],
        check=True,
    )


def _run_check(repo: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(_SCRIPT)],
        cwd=repo,
        capture_output=True,
        text=True,
        check=False,
    )


def test_clean_tree_exits_zero(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)
    result = _run_check(repo)
    assert result.returncode == 0, (
        f"expected exit 0, got {result.returncode}; stderr={result.stderr!r}"
    )


@pytest.mark.parametrize(
    "tracked_subpath",
    [
        "artifacts/demo-enterprise/data/manifest.json",
        "artifacts/demo-enterprise-comments-off/data/manifest.json",
        "docs/data/manifest.json",
    ],
)
def test_modified_tracked_artifact_exits_one(
    tmp_path: Path, tracked_subpath: str
) -> None:
    repo = tmp_path / "repo"
    _init_repo(repo)
    (repo / tracked_subpath).write_text('{"x": 2}\n', encoding="utf-8")
    result = _run_check(repo)
    assert result.returncode == 1, (
        f"expected exit 1, got {result.returncode}; stderr={result.stderr!r}"
    )
    assert tracked_subpath in result.stderr
