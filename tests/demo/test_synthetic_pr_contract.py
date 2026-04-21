"""Unit contract tests for the synthetic PR-record generator (feature 309, slice 2c).

Contracts:
    * ``specs/309-demo-pr-drilldown/contracts/byte-determinism-regen.md`` §4-5
      (key-insertion order; isolated RNG)
    * ``specs/309-demo-pr-drilldown/contracts/synthetic-authorization-signal.md``
      (sentinel protocol — consumed indirectly via generator tests)

These tests drive ``generate_pr_records`` directly (via importlib) at unit
level; they do NOT invoke the full build pipeline. Slice 2c lands the
helper as scaffolding only; slice 2d wires emission + regenerates rollups.

Cross-OS (QG-39): pathlib + UTF-8; no shell.
Typing  (QG-40): full annotations; no ``typing.Any``.
"""

from __future__ import annotations

import importlib.util
import random
import sys
from pathlib import Path
from types import ModuleType
from typing import Final

import pytest

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
GENERATE_DATA_SCRIPT: Final[Path] = REPO_ROOT / "scripts" / "generate-demo-data.py"

_PR_RECORD_KEYS: Final[frozenset[str]] = frozenset(
    {"id", "title", "author_id", "repository_id", "cycle_time"}
)


@pytest.fixture(scope="module")
def generate_demo_data() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "generate_demo_data", GENERATE_DATA_SCRIPT
    )
    assert spec is not None, "generate-demo-data.py spec"
    assert spec.loader is not None, "generate-demo-data.py loader"
    module = importlib.util.module_from_spec(spec)
    sys.modules["generate_demo_data"] = module
    spec.loader.exec_module(module)
    return module


def _default_repos(count: int) -> list[str]:
    """Build `count` synthetic repo identifiers (one per qualified PR)."""
    return [f"repo-{idx:04d}" for idx in range(count)]


def _default_authors(count: int = 12) -> list[str]:
    return [f"author-{idx:03d}" for idx in range(count)]


def test_prs_conform_to_pr_record_shape(generate_demo_data: ModuleType) -> None:
    pr_record_rng = random.Random(4242)
    records = generate_demo_data.generate_pr_records(
        "2025-W10",
        _default_repos(5),
        _default_authors(),
        pr_record_rng,
    )
    assert records, "generator must return at least one record on non-empty input"
    for record in records:
        assert set(record.keys()) == _PR_RECORD_KEYS, (
            f"unexpected PrRecord key set: {sorted(record.keys())}"
        )
        assert isinstance(record["id"], int)
        assert isinstance(record["title"], str)
        assert record["title"], "title must be non-empty"
        assert len(record["title"]) <= 72, (
            f"title exceeds 72 chars: {record['title']!r}"
        )
        assert isinstance(record["author_id"], str)
        assert record["author_id"].startswith("author-")
        assert isinstance(record["repository_id"], str)
        assert record["repository_id"].startswith("repo-")
        assert isinstance(record["cycle_time"], float)
        assert record["cycle_time"] > 0.0


def test_prs_cap_and_sort_invariant(generate_demo_data: ModuleType) -> None:
    pr_record_rng = random.Random(4242)
    records = generate_demo_data.generate_pr_records(
        "2025-W11",
        _default_repos(501),
        _default_authors(),
        pr_record_rng,
    )
    assert len(records) <= 500, f"cap violation: {len(records)} records"
    expected = sorted(records, key=lambda r: (-float(r["cycle_time"]), int(r["id"])))
    assert records == expected, "records must be sorted by (-cycle_time, id)"


@pytest.mark.parametrize(
    ("input_count", "expect_truncated", "expect_len"),
    [(499, False, 499), (500, False, 500), (501, True, 500)],
)
def test_truncation_boundary_parametrized(
    generate_demo_data: ModuleType,
    input_count: int,
    expect_truncated: bool,
    expect_len: int,
) -> None:
    pr_record_rng = random.Random(4242)
    records = generate_demo_data.generate_pr_records(
        "2025-W12",
        _default_repos(input_count),
        _default_authors(),
        pr_record_rng,
    )
    truncated = input_count > 500
    assert truncated == expect_truncated, (
        f"local truncation decision drift at input_count={input_count}"
    )
    assert len(records) == expect_len, (
        f"expected {expect_len} records for input_count={input_count}, "
        f"got {len(records)}"
    )


def test_rng_isolation(generate_demo_data: ModuleType) -> None:
    """Helper must consume only the passed-in pr_record_rng (no shared RNG dip).

    Consumes from one pr_record_rng BEFORE calling the helper, then calls with
    a fresh seed-matched instance, and compares with a control run. Any hidden
    dependency on module-level RNG would surface as drifted output.
    """
    control_rng = random.Random(2000 + 42)
    control_records = generate_demo_data.generate_pr_records(
        "2025-W13",
        _default_repos(15),
        _default_authors(),
        control_rng,
    )

    perturbed_rng = random.Random(2000 + 42)
    # Perturb the shared/module-level RNG before invoking the helper; if the
    # helper dips into it, the resulting titles/cycle-times will differ.
    shared_rng = getattr(generate_demo_data, "RNG", random.Random(0))
    for _ in range(64):
        shared_rng.random()

    perturbed_records = generate_demo_data.generate_pr_records(
        "2025-W13",
        _default_repos(15),
        _default_authors(),
        perturbed_rng,
    )

    assert perturbed_records == control_records, (
        "generator's output drifted when the shared RNG was perturbed — "
        "helper must consume only the passed pr_record_rng"
    )
