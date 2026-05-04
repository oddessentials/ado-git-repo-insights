"""Guard invariant: the sentinel must never appear under `docs/data/`.

Feature 309 (`309-demo-pr-drilldown`), slice 2b. Enforces contract:
the sentinel file `.synthetic-prs-authorized` is consumed (unlinked from the
scratch artifact tree) by ``promote_data`` before ``shutil.copytree`` runs.
If the published mirror under `docs/data/` ever contains the sentinel, the
orchestrator's unlink-before-copy ordering has regressed.

Defense in depth with:
    * the pre-push `sentinel-absence` subcommand in
      `scripts/run_repo_hook.py` (slice 2b T019)
    * the CI first-step guard in `.github/workflows/demo.yml` (slice 2b T020)

The constant name is imported from `scripts.strip_pr_arrays` — the
authorized single-source-of-truth per T016 — so a rename propagates
automatically through this guard.

Cross-OS (QG-39): pathlib + UTF-8; no shell; `rglob` is cross-platform.
Typing  (QG-40): full annotations; no `typing.Any`.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Final

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
DOCS_DATA_DIR: Final[Path] = REPO_ROOT / "docs" / "data"


def _load_sentinel_name() -> str:
    """Import the sentinel-name constant from its single source of truth.

    Loaded lazily via ``importlib.util`` because ``scripts/`` is not a
    proper package; top-level ``from scripts.strip_pr_arrays import ...``
    works because of ``mypy_path``/``pyproject`` wiring at runtime, but
    loading by path keeps this test independent of that configuration.
    """
    spec = importlib.util.spec_from_file_location(
        "strip_pr_arrays",
        REPO_ROOT / "scripts" / "strip_pr_arrays.py",
    )
    target = REPO_ROOT / "scripts" / "strip_pr_arrays.py"
    assert spec is not None, f"Cannot build spec for {target}"
    assert spec.loader is not None, f"Spec for {target} has no loader"
    module = importlib.util.module_from_spec(spec)
    sys.modules["strip_pr_arrays"] = module
    spec.loader.exec_module(module)
    name = module.SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME
    assert isinstance(name, str), "SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME must be str"
    return name


SENTINEL_NAME: Final[str] = _load_sentinel_name()


def test_sentinel_absent_from_docs_data() -> None:
    leaks = sorted(DOCS_DATA_DIR.rglob(SENTINEL_NAME))
    assert leaks == [], (
        f"Sentinel {SENTINEL_NAME!r} leaked into the published demo tree: "
        f"{[p.relative_to(REPO_ROOT).as_posix() for p in leaks]}. "
        "promote_data must unlink the sentinel before copytree runs."
    )
