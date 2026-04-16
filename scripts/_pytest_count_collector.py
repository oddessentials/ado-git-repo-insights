"""Pytest plugin: write collected item metadata to configured output paths.

Used exclusively by scripts/check_ratchet_bump.py (issue #280) to obtain a
parametrize-expanded collected-item count without stdout parsing. The gate
spawns pytest as an isolated subprocess with PYTEST_DISABLE_PLUGIN_AUTOLOAD=1
so that third-party plugins cannot affect the result; this committed plugin
is loaded explicitly via `-p scripts._pytest_count_collector`.

Contract:
    - Reads destination path from env var ``RATCHET_COUNT_OUTPUT``.
    - Writes the final collected-item count (after parametrize expansion)
      to that path as a plain ASCII integer, no trailing whitespace.
    - If ``RATCHET_NODEIDS_OUTPUT`` is set, writes a UTF-8 JSON array of
      sorted collected node IDs to that path.
    - Silently no-ops when neither env var is present so the plugin can be
      loaded in non-gate contexts without side effects.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

_OUTPUT_ENV_VAR = "RATCHET_COUNT_OUTPUT"
_NODEIDS_OUTPUT_ENV_VAR = "RATCHET_NODEIDS_OUTPUT"


def pytest_collection_modifyitems(
    config: pytest.Config, items: list[pytest.Item]
) -> None:
    """Write collected metadata after collection completes.

    pytest_collection_modifyitems fires after parametrize expansion, so
    ``len(items)`` is the real count the user would see as
    "collected N items" — no approximation, no regex on stdout.
    """
    del config  # unused: count is derived from items only
    output = os.environ.get(_OUTPUT_ENV_VAR)
    nodeids_output = os.environ.get(_NODEIDS_OUTPUT_ENV_VAR)
    if not output and not nodeids_output:
        return
    if output:
        Path(output).write_text(f"{len(items)}\n", encoding="utf-8")
    if nodeids_output:
        Path(nodeids_output).write_text(
            json.dumps(sorted(item.nodeid for item in items), indent=2) + "\n",
            encoding="utf-8",
        )
