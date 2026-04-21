"""Entrypoint-command parity for the sentinel-absence subcommand (feature 309, slice 2c).

Contract: `specs/309-demo-pr-drilldown/contracts/demo-strip-gate-v2.md` §8.

Verifies that the SAME CLI invocation
``python scripts/run_repo_hook.py sentinel-absence`` runs identically from
two invocation sources (local pre-push and CI first-step) — both surfaces
route through the same dispatch function, so drift cannot arise from copy-
paste. Tests drive the subcommand via ``subprocess.run`` with an explicit
``--docs-data-dir`` override pointing at a scratched ``tmp_path`` tree,
then toggle the sentinel present/absent and assert identical returncodes
and stderr signatures across two env variants (local vs CI-equivalent).

Cross-OS (QG-39): pathlib + UTF-8; forward-slash paths for subprocess.
Typing  (QG-40): full annotations; no ``typing.Any``.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Final

import pytest

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
RUN_HOOK_SCRIPT: Final[Path] = REPO_ROOT / "scripts" / "run_repo_hook.py"
SENTINEL_NAME: Final[str] = ".synthetic-prs-authorized"


def _run(docs_data_dir: Path, *, ci_env: bool) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    if ci_env:
        env["GITHUB_ACTIONS"] = "true"
        env["CI"] = "true"
    return subprocess.run(
        [
            sys.executable,
            str(RUN_HOOK_SCRIPT),
            "sentinel-absence",
            "--docs-data-dir",
            str(docs_data_dir),
        ],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.fixture
def scratched_docs_data(tmp_path: Path) -> Path:
    docs_data = tmp_path / "docs" / "data"
    docs_data.mkdir(parents=True)
    return docs_data


def test_sentinel_absent_returns_zero_from_both_entrypoints(
    scratched_docs_data: Path,
) -> None:
    local = _run(scratched_docs_data, ci_env=False)
    ci = _run(scratched_docs_data, ci_env=True)
    assert local.returncode == 0, (
        f"local entrypoint non-zero: {local.returncode}; stdout={local.stdout}; stderr={local.stderr}"
    )
    assert ci.returncode == 0, (
        f"CI entrypoint non-zero: {ci.returncode}; stdout={ci.stdout}; stderr={ci.stderr}"
    )
    assert local.returncode == ci.returncode


def test_sentinel_present_returns_nonzero_from_both_entrypoints(
    scratched_docs_data: Path,
) -> None:
    (scratched_docs_data / "aggregates").mkdir(parents=True)
    (scratched_docs_data / "aggregates" / SENTINEL_NAME).touch()

    local = _run(scratched_docs_data, ci_env=False)
    ci = _run(scratched_docs_data, ci_env=True)

    assert local.returncode != 0, "local entrypoint should fail on sentinel present"
    assert ci.returncode != 0, "CI entrypoint should fail on sentinel present"
    assert local.returncode == ci.returncode, (
        f"entrypoint drift: local={local.returncode} ci={ci.returncode}"
    )

    combined_local = local.stdout + local.stderr
    combined_ci = ci.stdout + ci.stderr
    assert "sentinel leaked" in combined_local, (
        f"local stderr missing 'sentinel leaked' marker: {combined_local}"
    )
    assert "sentinel leaked" in combined_ci, (
        f"CI stderr missing 'sentinel leaked' marker: {combined_ci}"
    )
