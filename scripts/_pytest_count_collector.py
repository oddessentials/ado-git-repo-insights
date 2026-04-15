"""Pytest plugin: write collected item count to the path in RATCHET_COUNT_OUTPUT.

Used exclusively by scripts/check_ratchet_bump.py (issue #280) to obtain a
parametrize-expanded collected-item count without stdout parsing. The gate
spawns pytest as an isolated subprocess with PYTEST_DISABLE_PLUGIN_AUTOLOAD=1
so that third-party plugins cannot affect the result; this committed plugin
is loaded explicitly via `-p scripts._pytest_count_collector`.

Contract:
    - Reads destination path from env var RATCHET_COUNT_OUTPUT.
    - Writes the final collected-item count (after parametrize expansion)
      to that path as a plain ASCII integer, no trailing whitespace.
    - Silently no-ops if the env var is absent so the plugin can be loaded
      in non-gate contexts without side effects.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

_OUTPUT_ENV_VAR = "RATCHET_COUNT_OUTPUT"


def pytest_collection_modifyitems(
    config: pytest.Config, items: list[pytest.Item]
) -> None:
    """Write len(items) to $RATCHET_COUNT_OUTPUT after collection completes.

    pytest_collection_modifyitems fires after parametrize expansion, so
    ``len(items)`` is the real count the user would see as
    "collected N items" — no approximation, no regex on stdout.
    """
    del config  # unused: count is derived from items only
    output = os.environ.get(_OUTPUT_ENV_VAR)
    if not output:
        return
    Path(output).write_text(f"{len(items)}\n", encoding="utf-8")
