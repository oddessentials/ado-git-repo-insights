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
import json
import random
import sys
from pathlib import Path
from types import ModuleType
from typing import Final

import pytest

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
GENERATE_DATA_SCRIPT: Final[Path] = REPO_ROOT / "scripts" / "generate-demo-data.py"

_PR_RECORD_REQUIRED_KEYS: Final[frozenset[str]] = frozenset(
    {"id", "title", "author_id", "repository_id", "cycle_time"}
)
# Feature 310 extends the synthetic PR record with three
# comments-metrics keys.  They arrive together or not at all
# (INV-08); non-partial rows emit integer values, partial rows emit
# ``None``.  The shape contract below accepts either the 5-field
# legacy shape OR the 8-field extended shape and enforces INV-08 on
# the extended one.
_PR_RECORD_COMMENTS_KEYS: Final[frozenset[str]] = frozenset(
    {"thread_count", "comment_count", "active_thread_count"}
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
    comments_metrics_rng = random.Random(5555)
    records = generate_demo_data.generate_pr_records(
        "2025-W10",
        _default_repos(5),
        _default_authors(),
        pr_record_rng,
        comments_metrics_rng,
    )
    assert records, "generator must return at least one record on non-empty input"
    for record in records:
        keys = set(record.keys())
        # The record MUST carry at least the 5 presence-required fields;
        # it MAY additionally carry the 3 comments-metrics fields
        # (Feature 310) — but atomically, all-three or none.
        assert _PR_RECORD_REQUIRED_KEYS.issubset(keys), (
            f"missing required PrRecord keys: {sorted(_PR_RECORD_REQUIRED_KEYS - keys)}"
        )
        extra = keys - _PR_RECORD_REQUIRED_KEYS
        if extra:
            assert extra == _PR_RECORD_COMMENTS_KEYS, (
                f"unexpected extra PrRecord keys: {sorted(extra)}; expected "
                f"either no extras or the Feature 310 triplet "
                f"{sorted(_PR_RECORD_COMMENTS_KEYS)}"
            )
            # INV-08: the three must land together — asserted by the set
            # equality above — and each MUST be either None (partial
            # sentinel) or a non-negative integer (covered count).
            for field in _PR_RECORD_COMMENTS_KEYS:
                value = record[field]
                assert value is None or (isinstance(value, int) and value >= 0), (
                    f"PrRecord[{field!r}] MUST be None or non-negative int; "
                    f"got {value!r}"
                )
            # INV-09: active_thread_count <= thread_count when both numeric.
            thread_count = record["thread_count"]
            active_thread_count = record["active_thread_count"]
            if isinstance(thread_count, int) and isinstance(active_thread_count, int):
                assert active_thread_count <= thread_count, (
                    f"INV-09 violated: active_thread_count "
                    f"({active_thread_count}) > thread_count ({thread_count})"
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


def test_truncation_exercise_week_locked() -> None:
    """The committed rollups for 2025-W26, W25, W27 must follow the spike contract."""
    rollups_dir = REPO_ROOT / "docs" / "data" / "aggregates" / "weekly_rollups"
    target = json.loads((rollups_dir / "2025-W26.json").read_text(encoding="utf-8"))
    assert target.get("_prs_truncated") is True, (
        f"2025-W26 must be truncated; got _prs_truncated={target.get('_prs_truncated')!r}"
    )
    prs = target.get("prs")
    assert isinstance(prs, list), (
        f"2025-W26 prs must be a list; got {type(prs).__name__}"
    )
    assert len(prs) == 500, f"2025-W26 must have exactly 500 prs; got len={len(prs)}"

    for week in ("2025-W25", "2025-W27"):
        contrast = json.loads(
            (rollups_dir / f"{week}.json").read_text(encoding="utf-8")
        )
        assert contrast.get("_prs_truncated") is False, (
            f"{week} must NOT be truncated; got _prs_truncated={contrast.get('_prs_truncated')!r}"
        )


def test_truncation_badge_renders_for_exercise_week() -> None:
    """UI-contract regression (PR #320 Codex P1): the badge-gate condition must fire.

    The badge-render gate in
    ``extension/ui/modules/shared/detail-panel.ts:456`` is
    ``renderedCount < actualFilteredCount``, where ``actualFilteredCount``
    is ``rollup.pr_count`` and ``renderedCount`` is ``len(rollup.prs)``.
    For the committed truncation-exercise week (``2025-W26``), that
    condition MUST evaluate to true — otherwise the drill-down renders
    500 PR rows with no truncation indicator, silently failing feature
    309 US3. Locks the load-bearing inequality: ``pr_count > _prs_cap``.
    """
    rollups_dir = REPO_ROOT / "docs" / "data" / "aggregates" / "weekly_rollups"
    payload = json.loads((rollups_dir / "2025-W26.json").read_text(encoding="utf-8"))
    pr_count = payload.get("pr_count")
    prs_cap = payload.get("_prs_cap")
    prs = payload.get("prs")
    assert isinstance(pr_count, int), f"pr_count must be int; got {pr_count!r}"
    assert isinstance(prs_cap, int), f"_prs_cap must be int; got {prs_cap!r}"
    assert isinstance(prs, list), f"prs must be list; got {type(prs).__name__}"
    assert pr_count > prs_cap, (
        f"truncation-badge gate requires pr_count ({pr_count}) > _prs_cap "
        f"({prs_cap}); otherwise `renderedCount < actualFilteredCount` is "
        "false and the drill-down renders 500 rows with no indicator."
    )
    assert len(prs) == prs_cap, (
        f"len(prs)={len(prs)} must equal _prs_cap={prs_cap} on the exercise week"
    )


def test_synthetic_exercise_weeks_data_coherence() -> None:
    """PR count, prs length, and _prs_truncated must be coherent across the three
    synthetic-exercise weeks (contract: #315 slice 2d, Codex P1 correction).

    - W26 (truncation week): ``len(prs) == _prs_cap == 500``,
      ``pr_count == target_qualified_pr_count == 520``, ``_prs_truncated == True``.
    - W25 & W27 (contrast weeks): ``_prs_truncated == False``,
      ``len(prs) == pr_count`` (1:1 correspondence).
    """
    rollups_dir = REPO_ROOT / "docs" / "data" / "aggregates" / "weekly_rollups"
    w26 = json.loads((rollups_dir / "2025-W26.json").read_text(encoding="utf-8"))
    assert w26.get("_prs_truncated") is True, (
        f"W26 _prs_truncated must be True; got {w26.get('_prs_truncated')!r}"
    )
    assert w26.get("_prs_cap") == 500, (
        f"W26 _prs_cap must be 500; got {w26.get('_prs_cap')!r}"
    )
    assert isinstance(w26.get("prs"), list), "W26 prs must be a list"
    assert len(w26["prs"]) == 500, f"W26 len(prs) must be 500; got {len(w26['prs'])}"
    assert w26.get("pr_count") == 520, (
        f"W26 pr_count must be target_qualified_pr_count (520); "
        f"got {w26.get('pr_count')!r}"
    )

    for week in ("2025-W25", "2025-W27"):
        payload = json.loads((rollups_dir / f"{week}.json").read_text(encoding="utf-8"))
        assert payload.get("_prs_truncated") is False, (
            f"{week} _prs_truncated must be False; got {payload.get('_prs_truncated')!r}"
        )
        prs = payload.get("prs")
        pr_count = payload.get("pr_count")
        assert isinstance(prs, list), f"{week} prs must be a list"
        assert isinstance(pr_count, int), f"{week} pr_count must be int"
        assert len(prs) == pr_count, (
            f"{week} len(prs)={len(prs)} must equal pr_count={pr_count}"
        )


def test_key_insertion_order_matches_aggregator() -> None:
    """The three PR-level keys MUST be present in a committed rollup.

    The aggregator (aggregators.py:1705) and the demo writer
    (demo_generation_common.canonical_json) both use ``sort_keys=True``, so the
    emitted JSON is key-sorted regardless of insertion order — the
    byte-determinism contract's original "last three keys" wording was a
    drafting error (insertion order is normalized away). The real invariant
    is: every synthetic rollup on a non-empty week carries the three PR-level
    keys, and the sort-normalized output matches the committed bytes. Key
    position after sort is load-bearing for neither correctness nor byte
    stability.
    """
    rollups_dir = REPO_ROOT / "docs" / "data" / "aggregates" / "weekly_rollups"
    sample_path = rollups_dir / "2025-W26.json"
    text = sample_path.read_text(encoding="utf-8")
    ordered_pairs = json.loads(text, object_pairs_hook=list)
    assert isinstance(ordered_pairs, list), "object_pairs_hook must yield a list"
    assert ordered_pairs, "object_pairs_hook must yield a non-empty list"
    keys = {str(k) for k, _v in ordered_pairs}
    required = {"prs", "_prs_truncated", "_prs_cap"}
    missing = required - keys
    assert not missing, (
        f"Non-empty rollup must carry all three PR-level keys; missing {sorted(missing)}"
    )


def test_committed_rollup_bytes_survive_round_trip() -> None:
    """Verify the sort-normalized JSON round-trip on a committed rollup.

    Ensures the writer's byte layout matches `json.dumps(..., sort_keys=True,
    ensure_ascii=False, indent=2)` — the load-bearing byte-determinism
    invariant that lets slice 2d's regen test compare stripped bytes to
    committed bytes without key-position drift.
    """
    rollups_dir = REPO_ROOT / "docs" / "data" / "aggregates" / "weekly_rollups"
    sample_path = rollups_dir / "2025-W26.json"
    text = sample_path.read_text(encoding="utf-8")
    parsed = json.loads(text)
    reserialized = (
        json.dumps(parsed, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    )
    assert reserialized == text, (
        "Committed rollup bytes drift from sort_keys=True canonical layout; "
        "the writer's serialization recipe changed without updating this test."
    )


def test_rng_isolation(generate_demo_data: ModuleType) -> None:
    """Helper must consume only the explicitly-passed RNG streams.

    Consumes from a fresh ``pr_record_rng`` + ``comments_metrics_rng``
    pair, then calls with seed-matched fresh instances and compares with
    a control run.  Any hidden dependency on a module-level RNG would
    surface as drifted output.

    Feature 310 extended the helper with ``comments_metrics_rng``.
    Both streams are tested for isolation from the shared ``RNG`` and
    from each other — so perturbing either module-level global MUST
    NOT change the output as long as the helper receives fresh
    seed-matched inputs.
    """
    control_pr_rng = random.Random(2000 + 42)
    control_comments_rng = random.Random(3000 + 42)
    control_records = generate_demo_data.generate_pr_records(
        "2025-W13",
        _default_repos(15),
        _default_authors(),
        control_pr_rng,
        control_comments_rng,
    )

    perturbed_pr_rng = random.Random(2000 + 42)
    perturbed_comments_rng = random.Random(3000 + 42)
    # Perturb the shared/module-level RNGs before invoking the helper;
    # if the helper dips into any of them, the result will drift.
    shared_rng = getattr(generate_demo_data, "RNG", random.Random(0))
    for _ in range(64):
        shared_rng.random()
    module_pr_rng = getattr(generate_demo_data, "pr_record_rng", random.Random(0))
    for _ in range(32):
        module_pr_rng.random()
    module_comments_rng = getattr(
        generate_demo_data, "comments_metrics_rng", random.Random(0)
    )
    for _ in range(48):
        module_comments_rng.random()

    perturbed_records = generate_demo_data.generate_pr_records(
        "2025-W13",
        _default_repos(15),
        _default_authors(),
        perturbed_pr_rng,
        perturbed_comments_rng,
    )

    assert perturbed_records == control_records, (
        "generator's output drifted when the shared / module RNGs were "
        "perturbed — helper must consume only the explicitly-passed "
        "pr_record_rng + comments_metrics_rng streams"
    )
