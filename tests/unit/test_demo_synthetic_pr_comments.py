"""Coherence guard tests for the demo synthetic pr_comments stream (Feature 336).

T007 (FIRST test in Phase 2 per ADR R005 / kickoff "demo key-shape verification —
do this FIRST"). Asserts the round-trip property described by CL-14 step 3 /
data-model.md §3 / quickstart.md §2: re-aggregating the new internal
``synthetic_pr_threads`` + ``synthetic_pr_comments`` lists per PR P MUST yield
P's pre-existing PrRecord aggregate counts (``thread_count`` / ``comment_count``
/ ``active_thread_count``).

Until T015 lands the ``synthesize_pr_comment_streams_for_week`` helper in
``scripts/generate-demo-data.py``, every test in this module fails with
``AttributeError`` at the helper call site (collection-stable: the attribute
access happens inside test bodies, not at import time, so ``pytest --collect-only``
remains stable).

Six coherence cases (per tasks.md T007 +6 Python floor bump):
    (a) thread_count match — len(synthetic_pr_threads for P) == P.thread_count
    (b) active_thread_count match — count of status='active' threads == P.active_thread_count
    (c) comment_count match — len(synthetic_pr_comments for P) == P.comment_count
    (d) referential integrity — no orphan threads + every comment's thread exists
    (e+g) commenter shape — author_id != PR author AND matches UUID format
    (f) ghost commenter inclusion — non-empty ghost_pool yields ≥1 emitted ghost commenter

Cross-OS (QG-39): pathlib + UTF-8; no shell.
Typing  (QG-40): full annotations; no ``typing.Any``.
"""

from __future__ import annotations

import importlib.util
import random
import re
import sys
from pathlib import Path
from types import ModuleType
from typing import Final

import pytest

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
GENERATE_DATA_SCRIPT: Final[Path] = REPO_ROOT / "scripts" / "generate-demo-data.py"

# UUID-shape regex per the existing extractor's UUID convention (32 hex + 4
# hyphens).  Used to assert synthetic commenter author_ids match the canonical
# shape so the production aggregator's FAIL-LOUD on shape corruption (FR-1-12 /
# CL-15) cannot fire on demo-derived data.
UUID_REGEX: Final[re.Pattern[str]] = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

# Fixed seed for the synthesizer's RNG.  Deterministic per kickoff lesson —
# tests must produce reproducible output across runs and across Cross-OS lanes.
_SYNTH_SEED: Final[int] = 7777


@pytest.fixture(scope="module")
def generate_demo_data() -> ModuleType:
    """Load ``scripts/generate-demo-data.py`` as an in-process module.

    Mirrors the importlib loader at
    ``tests/demo/test_synthetic_pr_contract.py:46-56``.
    """
    spec = importlib.util.spec_from_file_location(
        "generate_demo_data", GENERATE_DATA_SCRIPT
    )
    assert spec is not None, "generate-demo-data.py spec"
    assert spec.loader is not None, "generate-demo-data.py loader"
    module = importlib.util.module_from_spec(spec)
    sys.modules["generate_demo_data"] = module
    spec.loader.exec_module(module)
    return module


# Author UUIDs for the fixture.  All UUID-shaped per the existing extractor's
# convention (32 hex + 4 hyphens) so the production aggregator's FAIL-LOUD
# shape check (FR-1-12) cannot fire on demo data.
_AUTHOR_A: Final[str] = "00000000-0000-0000-0000-00000000000a"
_AUTHOR_B: Final[str] = "00000000-0000-0000-0000-00000000000b"
_AUTHOR_C: Final[str] = "00000000-0000-0000-0000-00000000000c"
_USER_D: Final[str] = "00000000-0000-0000-0000-00000000000d"
_USER_E: Final[str] = "00000000-0000-0000-0000-00000000000e"
_USER_F: Final[str] = "00000000-0000-0000-0000-00000000000f"
_GHOST_G1: Final[str] = "00000000-0000-0000-0000-0000000000ff"


def _build_fixture_prs() -> list[dict[str, object]]:
    """Construct a small fixture of PrRecord-shaped dicts spanning the
    coherence cases.

    Composition:
      - PR 1 (author A): 3 threads / 5 comments / 1 active — multiple threads,
        mixed active/inactive, comments distributed across threads.
      - PR 2 (author B): 2 threads / 4 comments / 2 active — all threads
        active; multiple commenters expected.
      - PR 3 (author A): 1 thread / 2 comments / 0 active — single inactive
        thread with the minimum viable comment count.
      - PR 4 (author C): 0 / 0 / 0 — empty PR (helper MUST emit no synthetic
        rows for P4 per FR-1-11 omission contract analog).

    Total: 6 threads / 11 comments / 3 active across 4 PRs / 3 authors.
    """
    return [
        {
            "id": 1,
            "title": "feat: thing",
            "author_id": _AUTHOR_A,
            "repository_id": "repo-001",
            "cycle_time": 100,
            "thread_count": 3,
            "comment_count": 5,
            "active_thread_count": 1,
        },
        {
            "id": 2,
            "title": "fix: thing",
            "author_id": _AUTHOR_B,
            "repository_id": "repo-002",
            "cycle_time": 200,
            "thread_count": 2,
            "comment_count": 4,
            "active_thread_count": 2,
        },
        {
            "id": 3,
            "title": "chore: thing",
            "author_id": _AUTHOR_A,
            "repository_id": "repo-001",
            "cycle_time": 50,
            "thread_count": 1,
            "comment_count": 2,
            "active_thread_count": 0,
        },
        {
            "id": 4,
            "title": "doc: thing",
            "author_id": _AUTHOR_C,
            "repository_id": "repo-003",
            "cycle_time": 80,
            "thread_count": 0,
            "comment_count": 0,
            "active_thread_count": 0,
        },
    ]


def _user_pool() -> list[str]:
    """Canonical user UUIDs (excluding ghosts).  Includes the three PR authors
    plus three additional non-author users available as commenter candidates."""
    return [_AUTHOR_A, _AUTHOR_B, _AUTHOR_C, _USER_D, _USER_E, _USER_F]


def _ghost_pool() -> list[str]:
    """Synthetic ghost UUIDs (absent from the canonical user pool).  Per
    CL-14 step 4, ≥1 ghost MUST appear in the emitted comment stream so the
    per-reviewer sentinel reconciliation branch is exercised non-vacuously."""
    return [_GHOST_G1]


def _synth_for_test(
    generate_demo_data: ModuleType,
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    """Invoke the future helper with the module fixture and a deterministic seed.

    Until T015 lands ``synthesize_pr_comment_streams_for_week``, this raises
    ``AttributeError`` — every test in the module fails consistently in RED.
    """
    rng = random.Random(_SYNTH_SEED)
    return generate_demo_data.synthesize_pr_comment_streams_for_week(
        _build_fixture_prs(),
        _user_pool(),
        _ghost_pool(),
        rng,
    )


def test_thread_count_matches_pr_record_per_pr(
    generate_demo_data: ModuleType,
) -> None:
    """Case (a): len(synthetic_pr_threads for P) == P.thread_count for every PR P.

    Asserts the per-PR thread emission count matches the PrRecord aggregate
    that the existing rollup-level ``comments`` and ``by_*_comments``
    emissions all sum from.  A drift here would propagate into every
    downstream aggregation via the demo's rollup-level ``thread_count`` sum.
    """
    threads, _comments = _synth_for_test(generate_demo_data)
    prs = _build_fixture_prs()
    for pr in prs:
        per_pr_threads = [t for t in threads if t["pull_request_uid"] == str(pr["id"])]
        assert len(per_pr_threads) == pr["thread_count"], (
            f"PR {pr['id']}: expected thread_count={pr['thread_count']} "
            f"synthetic threads, got {len(per_pr_threads)}"
        )


def test_active_thread_count_matches_pr_record_per_pr(
    generate_demo_data: ModuleType,
) -> None:
    """Case (b): count of synthetic_pr_threads for P with status='active' ==
    P.active_thread_count.

    Asserts the active subset is correctly distributed across each PR's
    threads.  Combined with case (a), this fully constrains the per-PR thread
    emission shape (count + active subset).
    """
    threads, _comments = _synth_for_test(generate_demo_data)
    prs = _build_fixture_prs()
    for pr in prs:
        per_pr_active = [
            t
            for t in threads
            if t["pull_request_uid"] == str(pr["id"]) and t["status"] == "active"
        ]
        assert len(per_pr_active) == pr["active_thread_count"], (
            f"PR {pr['id']}: expected active_thread_count="
            f"{pr['active_thread_count']} synthetic active threads, "
            f"got {len(per_pr_active)}"
        )


def test_comment_count_matches_pr_record_per_pr(
    generate_demo_data: ModuleType,
) -> None:
    """Case (c): len(synthetic_pr_comments for P) == P.comment_count for every PR P.

    Asserts the per-PR comment emission count matches the PrRecord aggregate.
    Combined with FR-2-03's per-week sum-coherence assertion (which compares
    SUM_R(comment_count) to an INDEPENDENT count of ``pr_comments`` rows),
    this case is the demo-side guarantor that the per-week sum is correct.
    """
    _threads, comments = _synth_for_test(generate_demo_data)
    prs = _build_fixture_prs()
    for pr in prs:
        per_pr_comments = [
            c for c in comments if c["pull_request_uid"] == str(pr["id"])
        ]
        assert len(per_pr_comments) == pr["comment_count"], (
            f"PR {pr['id']}: expected comment_count={pr['comment_count']} "
            f"synthetic comments, got {len(per_pr_comments)}"
        )


def test_no_orphan_threads_and_thread_id_referential_integrity(
    generate_demo_data: ModuleType,
) -> None:
    """Case (d) + composite: every emitted thread has ≥1 comment AND every
    comment's (pull_request_uid, thread_id) tuple resolves to an emitted
    thread (no dangling FK).

    The orphan-thread check enforces the CL-14 step 2 rule that each emitted
    thread has ≥1 comment.  The dangling-comment check enforces referential
    integrity to the synthetic_pr_threads list — the production schema's FK
    at ``models.py:170`` is the analog for real data; the demo synthesizer
    must not violate that shape.
    """
    threads, comments = _synth_for_test(generate_demo_data)
    thread_keys: set[tuple[object, object]] = {
        (t["pull_request_uid"], t["thread_id"]) for t in threads
    }
    threads_with_comments: set[tuple[object, object]] = {
        (c["pull_request_uid"], c["thread_id"]) for c in comments
    }
    orphan_threads = thread_keys - threads_with_comments
    assert not orphan_threads, (
        f"orphan threads (no comments emitted): {sorted(orphan_threads)} "
        f"— violates CL-14 step 2 'each emitted thread has ≥1 comment'"
    )
    dangling_comments = threads_with_comments - thread_keys
    assert not dangling_comments, (
        f"dangling comments (thread reference not in synthetic_pr_threads): "
        f"{sorted(dangling_comments)} — violates referential integrity to "
        f"synthetic_pr_threads"
    )


def test_commenter_excludes_self_and_uses_uuid_format(
    generate_demo_data: ModuleType,
) -> None:
    """Cases (e) + (g): every commenter author_id ≠ corresponding PR author
    AND matches UUID format (32 hex + 4 hyphens).

    The self-comment-exclusion rule (CL-04 / FR-1-04) is the per-reviewer
    dimension's defining filter; a leak here would corrupt the per-reviewer
    aggregator's downstream counts AND surface as an FR-2-05 self-comment-
    leak meta-test failure post-T010.

    The UUID-format check guards against the production aggregator's
    FR-1-12 / CL-15 FAIL-LOUD path firing on demo-derived data — every
    synthetic commenter author_id MUST be UUID-shaped so the live aggregator
    accepts demo input without raising.
    """
    _threads, comments = _synth_for_test(generate_demo_data)
    prs_by_uid: dict[str, dict[str, object]] = {
        str(pr["id"]): pr for pr in _build_fixture_prs()
    }
    for c in comments:
        pr_uid = c["pull_request_uid"]
        assert isinstance(pr_uid, str), (
            f"comment pull_request_uid must be str, got {type(pr_uid).__name__}: {pr_uid!r}"
        )
        pr = prs_by_uid[pr_uid]
        commenter = c["author_id"]
        assert isinstance(commenter, str), (
            f"comment author_id must be str, got {type(commenter).__name__}: {commenter!r}"
        )
        assert commenter != pr["author_id"], (
            f"comment for PR {pr['id']}: commenter author_id={commenter} "
            f"== PR author_id (self-comment leak — violates CL-04 / FR-1-04)"
        )
        assert UUID_REGEX.match(commenter), (
            f"comment for PR {pr['id']}: commenter author_id={commenter} "
            f"does not match UUID format (32 hex + 4 hyphens) — would trip "
            f"FR-1-12 / CL-15 shape corruption FAIL-LOUD on the production aggregator"
        )


def test_ghost_pool_yields_at_least_one_ghost_commenter_in_emission(
    generate_demo_data: ModuleType,
) -> None:
    """Case (f): when ghost_pool is non-empty, ≥1 emitted commenter author_id
    MUST be drawn from the ghost pool — exercises the per-reviewer sentinel
    reconciliation branch non-vacuously per CL-14 step 4 / SC-1-04.

    With only 11 total comments and 6 non-PR-author candidates per PR
    (5 user pool entries + 1 ghost), a uniform-random distribution could
    miss the ghost on any given seed.  T015's helper MUST therefore handle
    ghost inclusion deterministically (not via uniform sampling alone) so
    the per-reviewer sentinel reconciliation branch is exercised on every
    seed, not just statistically.  This test asserts the contract; T015's
    implementation choice (e.g., reserving one comment slot for a ghost
    commenter) is plan-level and tested here.
    """
    _threads, comments = _synth_for_test(generate_demo_data)
    ghost_set = set(_ghost_pool())
    emitted_commenters = {c["author_id"] for c in comments}
    ghost_commenters = emitted_commenters & ghost_set
    assert ghost_commenters, (
        f"no ghost commenter present in synthesis (ghost_pool={sorted(ghost_set)}; "
        f"emitted commenters={sorted(emitted_commenters)}); "
        f"the per-reviewer sentinel reconciliation branch would be exercised "
        f"vacuously — T015 must guarantee ghost inclusion when ghost_pool is "
        f"non-empty"
    )
