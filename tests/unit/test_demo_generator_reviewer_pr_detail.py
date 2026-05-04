"""Feature 362 FR-023 — demo-generator parallel-path coherence tests.

Per repo memory ``feedback_demo_generator_parallel_path.md``: production
aggregator changes have a parallel demo helper that must be updated in
lockstep, or byte-identity tests on the demo dataset pass vacuously.
This test runs the demo generator in-process (mirroring
``TestDemoGeneratorInProcessDeterminism`` in
``test_generate_demo_data_types.py``) and asserts the demo's per-
(reviewer, week) ``prs[]`` emission satisfies the same atomicity / sort
/ coherence invariants the production producer asserts.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType


def _load_demo_module() -> ModuleType:
    """Import the demo generator script as a module (mirror of the existing helper)."""
    script_path = (
        Path(__file__).resolve().parent.parent.parent
        / "scripts"
        / "generate-demo-data.py"
    )
    spec = importlib.util.spec_from_file_location("generate_demo_data", script_path)
    assert spec is not None
    assert spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def _run_demo(tmp_path: Path) -> Path:
    """Run the demo generator into ``tmp_path`` and return the rollups dir."""
    mod = _load_demo_module()
    mod.main(["--output-root", str(tmp_path)])
    rollups_dir = tmp_path / "aggregates" / "weekly_rollups"
    assert rollups_dir.exists(), f"demo build did not produce {rollups_dir}"
    return rollups_dir


def _rollups_with_reviewer(
    rollups_dir: Path, max_files: int = 8
) -> list[dict[str, object]]:
    """Return the first ``max_files`` rollups that have a non-empty by_reviewer."""
    out: list[dict[str, object]] = []
    for path in sorted(rollups_dir.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict) and payload.get("by_reviewer"):
            out.append(payload)
            if len(out) >= max_files:
                break
    return out


# ---------------------------------------------------------------------------
# (a) Atomicity + cap value: every demo by_reviewer[*] entry carries the trio
# ---------------------------------------------------------------------------


def test_demo_every_reviewer_entry_has_atomic_pr_detail_trio(
    tmp_path: Path,
) -> None:
    """Every ``by_reviewer[*]`` entry has ``prs`` / ``_prs_truncated`` / ``_prs_cap``."""
    rollups_dir = _run_demo(tmp_path)
    sample = _rollups_with_reviewer(rollups_dir)
    assert sample, "demo build produced no rollups with by_reviewer data"
    for rollup in sample:
        by_reviewer = rollup["by_reviewer"]
        assert isinstance(by_reviewer, dict)
        assert by_reviewer
        for reviewer_id, entry in by_reviewer.items():
            assert isinstance(entry, dict), (
                f"week {rollup.get('week')!r} reviewer {reviewer_id!r} is not a dict"
            )
            for key in ("prs", "_prs_truncated", "_prs_cap"):
                assert key in entry, (
                    f"week {rollup.get('week')!r} reviewer {reviewer_id!r} "
                    f"missing {key!r}"
                )
            assert entry["_prs_truncated"] is False
            assert entry["_prs_cap"] == 500


# ---------------------------------------------------------------------------
# (b) Sort invariant: per-(reviewer, week) prs[] is cycle_time desc, id asc
# ---------------------------------------------------------------------------


def test_demo_per_reviewer_prs_sorted_cycle_time_desc_id_asc(
    tmp_path: Path,
) -> None:
    """Every demo per-(reviewer, week) ``prs[]`` is sorted ``cycle_time desc, id asc``."""
    rollups_dir = _run_demo(tmp_path)
    sample = _rollups_with_reviewer(rollups_dir)
    assert sample
    for rollup in sample:
        by_reviewer = rollup["by_reviewer"]
        assert isinstance(by_reviewer, dict)
        for reviewer_id, entry in by_reviewer.items():
            assert isinstance(entry, dict)
            prs = entry.get("prs")
            assert isinstance(prs, list)
            for prev, current in zip(prs, prs[1:], strict=False):
                assert isinstance(prev, dict)
                assert isinstance(current, dict)
                prev_ct = float(prev.get("cycle_time", 0.0))
                cur_ct = float(current.get("cycle_time", 0.0))
                if prev_ct != cur_ct:
                    assert prev_ct > cur_ct, (
                        f"sort violated in week {rollup.get('week')!r} "
                        f"reviewer {reviewer_id!r}: "
                        f"{prev.get('id')!r} ({prev_ct}) before "
                        f"{current.get('id')!r} ({cur_ct})"
                    )
                else:
                    prev_id = int(prev.get("id", 0))
                    cur_id = int(current.get("id", 0))
                    assert prev_id < cur_id, (
                        f"id-asc tiebreak violated in week "
                        f"{rollup.get('week')!r} reviewer {reviewer_id!r}: "
                        f"id={prev_id} not less than id={cur_id} at tied "
                        f"cycle_time={prev_ct}"
                    )


# ---------------------------------------------------------------------------
# (c) Coherence: len(prs) == reviewed_prs (demo never truncates)
# ---------------------------------------------------------------------------


def test_demo_per_reviewer_prs_length_matches_reviewed_prs(
    tmp_path: Path,
) -> None:
    """Demo seeds are bounded well below 500; ``len(prs) == reviewed_prs`` always."""
    rollups_dir = _run_demo(tmp_path)
    sample = _rollups_with_reviewer(rollups_dir)
    assert sample
    for rollup in sample:
        by_reviewer = rollup["by_reviewer"]
        assert isinstance(by_reviewer, dict)
        for reviewer_id, entry in by_reviewer.items():
            assert isinstance(entry, dict)
            prs = entry["prs"]
            assert isinstance(prs, list)
            reviewed_prs = entry["reviewed_prs"]
            assert isinstance(reviewed_prs, int)
            assert len(prs) == reviewed_prs, (
                f"coherence violated in week {rollup.get('week')!r} "
                f"reviewer {reviewer_id!r}: len(prs)={len(prs)} "
                f"!= reviewed_prs={reviewed_prs}"
            )


# ---------------------------------------------------------------------------
# (d) Duplication invariant — at least one PR appears in multiple reviewer slices
# ---------------------------------------------------------------------------


def test_demo_per_reviewer_prs_carries_duplication_signature(
    tmp_path: Path,
) -> None:
    """At least one demo week has a PR appearing in multiple reviewer slices.

    Asserts the cross-bucket multi-counting semantic CL-01 acknowledged:
    a PR reviewed by N distinct reviewers appears in N per-(reviewer, week)
    entries.  Locks the demo's mirroring of the production duplication.
    """
    rollups_dir = _run_demo(tmp_path)
    sample = _rollups_with_reviewer(rollups_dir)
    assert sample
    duplicates_observed = 0
    for rollup in sample:
        by_reviewer = rollup["by_reviewer"]
        assert isinstance(by_reviewer, dict)
        pr_id_counts: dict[int, int] = {}
        for entry in by_reviewer.values():
            assert isinstance(entry, dict)
            prs = entry.get("prs")
            if not isinstance(prs, list):
                continue
            for pr in prs:
                if not isinstance(pr, dict):
                    continue
                pr_id_raw = pr.get("id")
                if not isinstance(pr_id_raw, int):
                    continue
                pr_id_counts[pr_id_raw] = pr_id_counts.get(pr_id_raw, 0) + 1
        for count in pr_id_counts.values():
            if count >= 2:
                duplicates_observed += 1
    assert duplicates_observed > 0, (
        "expected at least one demo PR to appear in multiple reviewer slices "
        "(duplication invariant CL-01); none observed across "
        f"{len(sample)} sampled weeks"
    )
