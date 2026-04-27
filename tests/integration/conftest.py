"""Integration test fixtures.

The ``sc05_fixture`` session-scoped fixture builds a tiny SQLite from
``tests/fixtures/sc05/fixture_builder.py`` then runs the production
``build-aggregates`` CLI to produce real rollups + manifest in
pytest's session tmp dir. Tests that need the SC-05 reconciliation
substrate (T007 / T012 / T009) declare ``sc05_fixture`` as a
parameter and read from the returned :class:`SC05Fixture` paths.

Subprocess override (T009 only):
    The FR-2-05 meta-test (``test_comments_trend_meta_failure.py``)
    launches a child pytest process that runs T007 against a MUTATED
    copy of the fixture. The child cannot see the parent's session
    fixture, so the meta-test sets ``ADO_SC05_FIXTURE_DIR`` pointing at
    the mutated working copy. When that env var is set, this fixture
    skips the build step and returns a handle pointing at the existing
    files at that path. The override is the ONLY env-var code path
    here; primary discovery is always the session-built fixture.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from tests.fixtures.sc05.fixture_builder import SC05Fixture, build_fixture

_FIXTURE_OVERRIDE_ENV_VAR = "ADO_SC05_FIXTURE_DIR"


def _load_prebuilt(out_dir: Path) -> SC05Fixture:
    data_dir = out_dir / "data"
    rollups_dir = data_dir / "aggregates" / "weekly_rollups"
    manifest_path = data_dir / "dataset-manifest.json"
    week_keys = tuple(sorted(p.stem for p in rollups_dir.glob("*.json")))
    if not manifest_path.exists():
        raise RuntimeError(
            f"{_FIXTURE_OVERRIDE_ENV_VAR}={out_dir} does not contain a "
            f"prebuilt SC-05 fixture (missing {manifest_path})"
        )
    # Defensive: ensure manifest is valid JSON so failures surface here,
    # not deep inside a consumer test.
    json.loads(manifest_path.read_text(encoding="utf-8"))
    return SC05Fixture(
        sqlite_path=out_dir / "dataset.sqlite",
        data_dir=data_dir,
        rollups_dir=rollups_dir,
        manifest_path=manifest_path,
        week_keys=week_keys,
    )


@pytest.fixture(scope="session")
def sc05_fixture(tmp_path_factory: pytest.TempPathFactory) -> SC05Fixture:
    """Session-scoped SC-05 reconciliation fixture.

    Built ONCE per pytest session into a session-scoped tmp dir by
    invoking the production ``build-aggregates`` CLI. When
    ``ADO_SC05_FIXTURE_DIR`` is set (T009 subprocess invocation), the
    fixture is loaded from that pre-built path instead — that is the
    only path where the env var participates.
    """
    override = os.environ.get(_FIXTURE_OVERRIDE_ENV_VAR)
    if override:
        return _load_prebuilt(Path(override))
    out_dir: Path = tmp_path_factory.mktemp("sc05_fixture")
    return build_fixture(out_dir)
