#!/usr/bin/env python3
"""
Generate deterministic synthetic data for GitHub Pages demo dashboard.

This script produces byte-identical output on every run using:
- Fixed random seed (42)
- UUID v5 with DNS namespace for all entity IDs
- Canonical JSON formatting (sorted keys, 3-decimal floats, UTC timestamps, LF newlines)

Output: dataset root containing all demo data files

Usage:
    python scripts/generate-demo-data.py

Requirements:
    Python 3.12.x baseline (machine-enforced for committed demo artifacts)
"""

from __future__ import annotations

import argparse
import functools
import importlib.util
import json
import math
import random
import sys
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Final, TypedDict

if TYPE_CHECKING:
    from ado_git_repo_insights.types import (
        CommentsCoverage,
        PrRecord,
        ReviewerSliceMetrics,
        SliceMetrics,
    )

# Load package modules via importlib (allows direct script execution from checkout)
_schema_spec = importlib.util.spec_from_file_location(
    "schema_versions",
    Path(__file__).resolve().parent.parent
    / "src"
    / "ado_git_repo_insights"
    / "transform"
    / "schema_versions.py",
)
assert _schema_spec is not None
assert _schema_spec.loader is not None
_schema_mod = importlib.util.module_from_spec(_schema_spec)
_schema_spec.loader.exec_module(_schema_mod)
AGGREGATES_SCHEMA_VERSION: int = _schema_mod.AGGREGATES_SCHEMA_VERSION

# Feature 336 (T015): the per-reviewer demo synthesizer + helper
# (``synthesize_pr_comment_streams_for_week`` /
# ``_aggregate_by_reviewer_comments_for_week``) reuse the production
# aggregator's reserved sentinel literal for ghost-commenter bucketing
# (CL-03 / INV-4-12).  Load the canonical Python constant from
# ``src/ado_git_repo_insights/transform/constants.py`` via importlib so
# the demo path cannot drift from production.  The widened T029
# collision-safety test
# (``tests/unit/test_aggregators_author_comments.py:test_sentinel_literal_does_not_collide_with_real_author_ids``)
# additionally asserts no real user_id / reviewer_id / author_id in any
# committed demo fixture surface collides with this literal.
_constants_spec = importlib.util.spec_from_file_location(
    "transform_constants",
    Path(__file__).resolve().parent.parent
    / "src"
    / "ado_git_repo_insights"
    / "transform"
    / "constants.py",
)
assert _constants_spec is not None
assert _constants_spec.loader is not None
_constants_mod = importlib.util.module_from_spec(_constants_spec)
_constants_spec.loader.exec_module(_constants_mod)
FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL: str = (
    _constants_mod.FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL
)

# Load demo_generation_common from scripts/ via importlib
_common_spec = importlib.util.spec_from_file_location(
    "demo_generation_common",
    Path(__file__).resolve().parent / "demo_generation_common.py",
)
assert _common_spec is not None
assert _common_spec.loader is not None
_common_mod = importlib.util.module_from_spec(_common_spec)
_common_spec.loader.exec_module(_common_mod)
FIXED_GENERATED_AT: str = _common_mod.FIXED_GENERATED_AT
build_generation_provenance = _common_mod.build_generation_provenance
discover_demo_feature_flags = _common_mod.discover_demo_feature_flags
largest_remainder_allocate = _common_mod.largest_remainder_allocate
round_float = _common_mod.round_float
require_demo_generation_baseline_for_output = (
    _common_mod.require_demo_generation_baseline_for_output
)
write_json_file = _common_mod.write_json_file

# =============================================================================
# Configuration Constants
# =============================================================================

SEED = 42
DNS_NAMESPACE = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")

# Date range: 2021-W01 through 2025-W52 (exactly 260 ISO weeks)
START_YEAR = 2021
END_YEAR = 2025
START_WEEK = 1
END_WEEK = 52

# Entity counts (enterprise demo profile)
NUM_ORGS = 3
NUM_PROJECTS = 8
NUM_REPOS = 23
NUM_USERS = 200
NUM_TEAMS = 4
NUM_WEEKS = 260
GROWTH_RATE_PER_YEAR = 0.12
HOLIDAY_SUPPRESSION_FACTOR = 0.35

# Weekly PR metrics baseline — 80 PRs/week for a 50-person org with 23 repos
BASE_PR_COUNT = 80
PR_COUNT_SEASONAL_AMPLITUDE = 0.2  # ±20%
PR_COUNT_NOISE_AMPLITUDE = 0.1  # ±10%
REPO_WEIGHT_EXPONENT = 1.35

# Cycle time distribution parameters (log-normal)
CYCLE_TIME_MU = 6.0  # log-minutes
CYCLE_TIME_SIGMA = 1.5

# Feature 060 FR-023 bypass closure: the default output root is a scratch
# directory, NOT `docs/data/`. The orchestrated flow in
# `scripts/build-demo-dataset.py` passes `ARTIFACT_DATA_DIR` explicitly and
# is unaffected by this default change. Developer-standalone invocations
# now write to `.tmp/generate-demo-data-output/` so direct writes to
# `docs/data/` cannot bypass the strip gate inside `promote_data`.
DEFAULT_OUTPUT_DIR = Path(__file__).parent.parent / ".tmp" / "generate-demo-data-output"
# The managed public surface path. Kept here as a resolvable literal so the
# early-exit guard below can reject `--output-root docs/data` without
# importing the full build-demo-dataset module.
_DOCS_DATA_DIR = Path(__file__).parent.parent / "docs" / "data"
DEMO_PROFILE_NAME = "enterprise-demo"
DEMO_PROFILE_VERSION = "2.1.0"
GENERATOR_SCRIPT = "scripts/generate-demo-data.py"
GENERATION_MODE = "helper-demo-data"
DEMO_COMMENT_BATCH_COUNT = 100
DEMO_COMMENT_PRS_PER_BATCH = 3
DEMO_COMMENT_COMMENTS_PER_PR = 2

# Power-law repository weights (Contract 5, FR-004)
# Top 3 repos get >= 40% share after idle zeroing redistributes PRs to top repos.
# Base weights before idle zeroing — actual PR share is higher for top repos
# because zeroed PRs get redistributed to the highest-weight repo.
REPO_WEIGHTS: dict[str, float] = {
    # High-traffic
    "user-service": 1.0,
    "react-shell": 0.9,
    "ios-app": 0.85,
    # Medium-traffic
    "auth-service": 0.5,
    "gateway-core": 0.45,
    "android-app": 0.4,
    "etl-jobs": 0.4,
    "model-training": 0.35,
    "dashboard-api": 0.35,
    "notification-service": 0.3,
    "design-system": 0.3,
    # Low-traffic
    "data-warehouse": 0.2,
    "stream-processor": 0.15,
    "feature-store": 0.15,
    "inference-service": 0.12,
    "report-generator": 0.12,
    "metrics-collector": 0.1,
    "shared-core": 0.1,
    # Utility/idle — low but enough to occasionally get >= 5 PRs
    "rate-limiter": 0.08,
    "ci-scripts": 0.07,
    "terraform-modules": 0.06,
    "monitoring-stack": 0.06,
    "forms-lib": 0.05,
}

# Team-repo affinity matrix (Contract 5, FR-007)
# 65% of team PRs go to primary repos, 35% to others
TEAM_PRIMARY_REPOS: dict[str, list[str]] = {
    "Platform Team": ["user-service", "auth-service", "notification-service"],
    "Frontend Team": ["react-shell", "design-system", "ios-app"],
    "Data Team": ["etl-jobs", "data-warehouse", "stream-processor"],
    "ML Team": ["model-training", "inference-service", "feature-store"],
}

# Cycle time category multipliers (FR-008)
# Applied to CYCLE_TIME_MU per repo
REPO_CYCLE_TIME_CATEGORY: dict[str, float] = {
    # Utility/DevOps (mu_factor=0.5 — fastest)
    "ci-scripts": 0.5,
    "terraform-modules": 0.5,
    "monitoring-stack": 0.5,
    "rate-limiter": 0.5,
    # Frontend (mu_factor=0.8)
    "react-shell": 0.8,
    "design-system": 0.8,
    "ios-app": 0.8,
    "android-app": 0.8,
    "forms-lib": 0.8,
    # Backend (mu_factor=1.0)
    "user-service": 1.0,
    "auth-service": 1.0,
    "gateway-core": 1.0,
    "notification-service": 1.0,
    "dashboard-api": 1.0,
    # Data/ML (mu_factor=1.3 — slowest)
    "etl-jobs": 1.3,
    "data-warehouse": 1.3,
    "stream-processor": 1.3,
    "model-training": 1.3,
    "inference-service": 1.3,
    "feature-store": 1.3,
    "metrics-collector": 1.3,
    "report-generator": 1.3,
    # Remaining repos default to 1.0
    "shared-core": 1.0,
}

# Idle repo-week threshold (Contract 5, FR-009)
# Repos with weight below this have a probability of being zeroed out each week.
# Higher threshold = more repos eligible for idle zeroing = more idle repo-weeks.
# With threshold 0.35, repos up to weight 0.35 are eligible (13 of 23 repos).
IDLE_WEIGHT_THRESHOLD = 0.35

# Author/reviewer scaling (Contract 5, FR-016)
AUTHOR_RATIO = 0.3  # Root-level: ~30% of weekly PR count
REVIEWER_RATIO = 0.45  # Root-level: ~45% of weekly PR count
SUBLINEAR_EXPONENT = 0.6  # Sub-linear scaling for repo/team/team-repo counts
TEAM_AFFINITY_PRIMARY_SHARE = 0.65  # 65% of team PRs go to primary repos
MIN_ACTIVE_REVIEWERS = 5
MIN_REVIEWED_PRS_PER_ACTIVE_REVIEWER = 3
MIN_REVIEW_ACTIONS_PER_ACTIVE_REVIEWER = 3
MIN_MULTI_REPO_REVIEWERS = 1
REVIEWER_FILTER_EXAMPLE_COUNT = 3


# =============================================================================
# Deterministic Random Utilities (T006)
# =============================================================================


def init_random(seed: int = SEED) -> random.Random:
    """Initialize deterministic random generator with fixed seed."""
    rng = random.Random(seed)
    return rng


# Global random generator (initialized at module load)
RNG = init_random(SEED)

# Seed offset for the review-time RNG stream.  Isolated from the main
# stream so adding/removing review-time fields does not perturb
# pr_count, cycle_time, or allocation draws.  A fresh RNG is created
# per generate_weekly_rollups() call for in-process determinism.
_REVIEW_TIME_SEED_OFFSET = 1_000_000

# Feature 309 (#315): synthetic PR-record generator state. Isolated seed
# offset keeps pr-record draws independent of the shared RNG, mirroring
# the review-time pattern above. Contract:
# specs/309-demo-pr-drilldown/contracts/byte-determinism-regen.md §5.
_PR_RECORD_SEED_OFFSET: Final[int] = 2000
_PR_DETAIL_CAP: Final[int] = 500
_DISTRIBUTION_FIXTURE_DIR: Final[Path] = (
    Path(__file__).resolve().parent / "demo-distributions"
)
_PR_TITLE_MAX_LEN: Final[int] = 72
_PR_TITLE_TOKEN_COUNT_RANGE: Final[tuple[int, int]] = (2, 6)

# Feature 310 (#182): synthetic comments-metrics generator state.  The
# offset is intentionally far from ``_PR_RECORD_SEED_OFFSET`` and
# ``_REVIEW_TIME_SEED_OFFSET`` so the three draw streams cannot collide.
# Draws are ALWAYS made regardless of the ``--comments-metrics`` flag
# (zero branching in the generation layer per R-08); the flag gates
# only the serialization step.  This keeps the variant-on and
# variant-off artifacts byte-identical except for the gated keys the
# R-08 byte-identity test strips.
_COMMENTS_METRICS_SEED_OFFSET: Final[int] = 3_000_000

# Feature 336 (T015): synthetic pr_comments stream RNG.  The offset is
# intentionally far from ``_PR_RECORD_SEED_OFFSET``,
# ``_COMMENTS_METRICS_SEED_OFFSET``, and ``_REVIEW_TIME_SEED_OFFSET`` so
# the synthesizer's choice sequence cannot collide with any pre-existing
# stream.  Per CL-14 the synthetic streams are demo-internal (NOT
# serialized to rollup files); only the AGGREGATED ``by_reviewer_comments``
# key reaches disk, so this RNG's draws affect ONLY that one rollup-root
# key and never perturb the existing demo's serialized output.
_COMMENT_STREAM_SEED_OFFSET: Final[int] = 4_000_000
# Per CL-14 step 4: ≥1 demo week MUST include synthetic ghost commenters
# (UUIDs absent from the seeded ``users`` table) so the per-reviewer
# sentinel reconciliation branch is exercised non-vacuously.  Three
# ghost UUIDs is a small, easily-attributable set; the synthesizer's
# ghost-forcing logic guarantees ≥1 ghost commenter is emitted across
# the full year regardless of the choice RNG's distribution.
_GHOST_POOL_SIZE: Final[int] = 3

pr_record_rng = random.Random(SEED + _PR_RECORD_SEED_OFFSET)
comments_metrics_rng = random.Random(SEED + _COMMENTS_METRICS_SEED_OFFSET)
comment_stream_rng = random.Random(SEED + _COMMENT_STREAM_SEED_OFFSET)

# Feature 310 serialization-layer flag.  ``generate-demo-data.py`` sets
# this in ``main`` from the ``--comments-metrics {true,false}`` CLI arg
# (default ``True``).  Nothing at the generation layer (PR record,
# thread, or comment construction) reads it — per R-08's single-code-
# path constraint.  Serialization sites gate the 5 comments-metrics
# artifact keys (``manifest.capabilities.comments_metrics``,
# ``manifest.features.comments``, ``manifest.coverage.comments``,
# ``prs[*].thread_count`` / ``comment_count`` / ``active_thread_count``).
_EMIT_COMMENTS_METRICS: bool = True


class SyntheticPrThread(TypedDict):
    """Feature 336 CL-14: per-(PR, thread) demo-internal record.

    Mirrors the production ``pr_threads`` row shape (``models.py:143``)
    enough for the demo's ``synthesize_pr_comment_streams_for_week`` +
    ``_aggregate_by_reviewer_comments_for_week`` round-trip to validate
    against the per-reviewer aggregator's contract.  NOT serialized to
    any rollup file (privacy posture per CL-14 step 5); only the
    AGGREGATED ``by_reviewer_comments`` key reaches disk.
    """

    pull_request_uid: str
    thread_id: str
    status: str  # ``"active"`` or ``"fixed"``; mirrors pr_threads.status
    is_deleted: int  # always 0 per C1


class SyntheticPrComment(TypedDict):
    """Feature 336 CL-14: per-(PR, thread, comment) demo-internal record.

    Mirrors the production ``pr_comments`` row shape (``models.py:156``)
    enough for the demo's per-reviewer aggregator round-trip.  Synthesis
    enforces CL-04 self-comment exclusion at construction time
    (``author_id != PR's author_id`` is invariant on every emitted row).
    NOT serialized to any rollup file (privacy posture per CL-14 step 5);
    only the AGGREGATED ``by_reviewer_comments`` key reaches disk.
    """

    pull_request_uid: str
    thread_id: str
    author_id: str  # commenter; never == PR's author_id (CL-04)
    is_deleted: int  # always 0 per C1


class _TruncationExerciseConfig(TypedDict):
    week: str
    target_qualified_pr_count: int
    contrast_weeks: list[str]
    contrast_max_pr_count: int


@functools.lru_cache(maxsize=1)
def _load_truncation_exercise_config() -> _TruncationExerciseConfig:
    """Load + validate the locked truncation-exercise-week fixture.

    Contract: ``specs/309-demo-pr-drilldown/contracts/distribution-fixture-schema.md``
    §2.5 — the values are locked LITERALS. If the fixture drifts, the
    generator aborts loudly instead of silently emitting a non-contract spike.
    """
    path = _DISTRIBUTION_FIXTURE_DIR / "truncation-exercise-week.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("week") != "2025-W26":
        raise ValueError(
            f"truncation-exercise-week.json: week must be '2025-W26'; got {payload.get('week')!r}"
        )
    if payload.get("target_qualified_pr_count") != 520:
        raise ValueError(
            "truncation-exercise-week.json: target_qualified_pr_count must be 520; "
            f"got {payload.get('target_qualified_pr_count')!r}"
        )
    if payload.get("contrast_weeks") != ["2025-W25", "2025-W27"]:
        raise ValueError(
            "truncation-exercise-week.json: contrast_weeks must be "
            f"['2025-W25', '2025-W27']; got {payload.get('contrast_weeks')!r}"
        )
    if payload.get("contrast_max_pr_count") != 300:
        raise ValueError(
            "truncation-exercise-week.json: contrast_max_pr_count must be 300; "
            f"got {payload.get('contrast_max_pr_count')!r}"
        )
    return _TruncationExerciseConfig(
        week=str(payload["week"]),
        target_qualified_pr_count=int(payload["target_qualified_pr_count"]),
        contrast_weeks=[str(w) for w in payload["contrast_weeks"]],
        contrast_max_pr_count=int(payload["contrast_max_pr_count"]),
    )


def _box_muller_normal(rng: random.Random) -> float:
    """Generate standard normal variate using Box-Muller transform.
    Uses only rng.random() and stable math operations.
    Contractually deterministic (Contract 2).
    """
    u1 = rng.random()
    u2 = rng.random()
    while u1 == 0.0:
        u1 = rng.random()
    return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)


def _log_normal(rng: random.Random, mu: float, sigma: float) -> float:
    """Generate log-normal variate using locked Box-Muller implementation."""
    return math.exp(mu + sigma * _box_muller_normal(rng))


# =============================================================================
# Synthetic PR Records (feature 309 #315, slice 2c)
# =============================================================================

# Distribution-fixture loaders are memoized via functools.lru_cache so unit
# tests can import this module without touching disk until they exercise
# the helper, while keeping the per-call cost at a single dict lookup.
# Contract: specs/309-demo-pr-drilldown/contracts/distribution-fixture-schema.md.
_REPO_CATEGORY_LABELS: Final[tuple[str, str, str]] = ("small", "medium", "large")


@functools.lru_cache(maxsize=1)
def _load_title_tokens() -> tuple[tuple[str, float], ...]:
    path = _DISTRIBUTION_FIXTURE_DIR / "title-tokens.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    entries = payload["tokens"]
    return tuple((str(entry["token"]), float(entry["weight"])) for entry in entries)


@functools.lru_cache(maxsize=1)
def _load_cycle_time_categories() -> tuple[tuple[str, float, float], ...]:
    path = _DISTRIBUTION_FIXTURE_DIR / "cycle-time-per-repo-size.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    categories_obj = payload["categories"]
    return tuple(
        (name, float(body["mu"]), float(body["sigma"]))
        for name, body in categories_obj.items()
    )


def _week_pr_id_base(week: str) -> int:
    """Deterministic per-week id offset; globally unique across the 2021-2025 range."""
    try:
        year_str, week_str = week.split("-W")
        year = int(year_str)
        week_num = int(week_str)
    except (ValueError, AttributeError) as exc:
        raise ValueError(f"Invalid ISO week label: {week!r}") from exc
    return year * 100 * _PR_DETAIL_CAP * 2 + week_num * _PR_DETAIL_CAP * 2


def _repo_category(repo_id: str) -> str:
    """Deterministically assign a repo to small/medium/large via stable hash."""
    digest = uuid.uuid5(DNS_NAMESPACE, f"repo-category::{repo_id}").int
    return _REPO_CATEGORY_LABELS[digest % len(_REPO_CATEGORY_LABELS)]


def _sample_title(rng: random.Random, tokens: tuple[tuple[str, float], ...]) -> str:
    low, high = _PR_TITLE_TOKEN_COUNT_RANGE
    count = rng.randint(low, high)
    weights = [weight for _tok, weight in tokens]
    population = [tok for tok, _weight in tokens]
    chosen = rng.choices(population, weights=weights, k=count)
    title = "-".join(chosen)
    return title[:_PR_TITLE_MAX_LEN]


def generate_pr_records(
    week: str,
    repo_entries: list[object],
    author_entries: list[object],
    pr_record_rng: random.Random,
    comments_metrics_rng: random.Random | None = None,
    cap: int = _PR_DETAIL_CAP,
) -> list[PrRecord]:
    """Produce synthetic PR records for a single rollup week.

    Each entry in ``repo_entries`` represents one qualified PR in the week
    (the caller computes the qualified count; the helper assigns title,
    cycle time, author, and id to each). Returns at most ``cap`` records
    (default ``_PR_DETAIL_CAP``), sorted by ``(-cycle_time, id)``. Slice
    2c scaffolds the helper; slice 2d wires emission into the rollup
    loop and regenerates ``docs/data/``.

    Feature 310 (#182): the three comments-metrics fields
    (``thread_count`` / ``comment_count`` / ``active_thread_count``)
    are synthesized from a dedicated ``comments_metrics_rng`` argument.
    Defaulting to the module-level stream keeps the standalone CLI
    path simple; test harnesses that check RNG isolation MUST pass a
    fresh ``random.Random`` so the two streams stay independent.

    Feature 334 (#334): the optional ``cap`` parameter lets callers
    request the FULL week of qualified PRs (``cap=len(repo_entries)``)
    so the per-author comments-density aggregate (``by_author_comments``)
    can be summed over W's full extracted-subset per INV-2-10 — not the
    500-row drill-down slice.  Default behaviour is unchanged
    (``cap=_PR_DETAIL_CAP``) so byte-determinism for the legacy
    drill-down emission stays intact; callers wanting the full set MUST
    snapshot/restore both RNG streams around the call so downstream
    weeks see the original RNG state advancement.

    Contract:
        * ``specs/309-demo-pr-drilldown/contracts/byte-determinism-regen.md``
          §4 (key-insertion order) and §5 (isolated RNG).
        * Reads fixtures from ``scripts/demo-distributions/`` (slice 2a).
    """
    # Fall back to the module-level stream when callers don't supply
    # one (the CLI entrypoint + most production paths). Tests pass their
    # own instance to exercise isolation contracts.
    if comments_metrics_rng is None:
        comments_metrics_rng = globals()["comments_metrics_rng"]
    title_tokens = _load_title_tokens()
    categories_tuple = _load_cycle_time_categories()
    categories: dict[str, tuple[float, float]] = {
        name: (mu, sigma) for name, mu, sigma in categories_tuple
    }
    base_id = _week_pr_id_base(week)
    capped_entries = list(repo_entries)[:cap]

    if not author_entries:
        raise ValueError("author_entries must be non-empty")
    author_pool = [str(entry) for entry in author_entries]

    records: list[PrRecord] = []
    for idx, entry in enumerate(capped_entries):
        repo_id = str(entry)
        category = _repo_category(repo_id)
        mu_sigma = categories.get(category)
        if mu_sigma is None:
            mu_sigma = next(iter(categories.values()))
        mu, sigma = mu_sigma
        # Round cycle_time to canonical 3-decimal precision BEFORE sort so
        # the sorted order matches the post-serialization byte layout written
        # by canonical_json (demo_generation_common._process_floats). Without
        # this, ties created by post-write rounding can invert sort order.
        cycle_time = round_float(_log_normal(pr_record_rng, mu, sigma))
        author_id = pr_record_rng.choice(author_pool)
        title = _sample_title(pr_record_rng, title_tokens)
        # Feature 310 (#182): synthesize the comments-metrics triplet
        # using the dedicated ``comments_metrics_rng`` stream — the
        # ``pr_record_rng`` consumption pattern stays byte-identical
        # across pre-310 and post-310 artifacts, so the canonical demo
        # output for the legacy 5 fields does not shift.  Coverage
        # distribution: ~10% of PRs are partial (triplet = null); the
        # rest carry integer counts with INV-09 enforced at draw time
        # (active_thread_count sampled from [0, thread_count]).
        if comments_metrics_rng.random() < 0.1:
            thread_count: int | None = None
            comment_count: int | None = None
            active_thread_count: int | None = None
        else:
            thread_count = comments_metrics_rng.randint(0, 15)
            active_thread_count = (
                0
                if thread_count == 0
                else comments_metrics_rng.randint(0, thread_count)
            )
            # Typical ADO patterns: ~2-5 comments per thread, with a
            # floor of thread_count (one comment per thread minimum
            # when threads exist).
            #
            # Production schema (``models.py:170``) requires every
            # ``pr_comments`` row to have a non-NULL ``thread_id`` with
            # FK to ``pr_threads``.  Pre-#336 the demo allowed
            # (thread_count=0, comment_count>0) "drive-by system
            # comments" — a synthetic abstraction that does not map to
            # production where system messages belong to system-
            # generated threads.  Feature 336 per-reviewer dimension
            # iterates ``pr_comments`` rows joined with ``pr_threads``
            # to compute COUNT(DISTINCT thread_id) per commenter; the
            # legacy abstraction made the per-reviewer synthesizer's
            # contract (CL-14) unsatisfiable on existing demo PR
            # shapes (Codex stop-time review caught this on the T007
            # commit).  The fix forces ``comment_count = 0`` when
            # ``thread_count = 0`` so the demo data is production-
            # schema-compatible end to end.
            #
            # The historical ``randint(0, 3)`` draw is consumed and
            # discarded so the rest of the byte-identity sequence
            # stays in lockstep with the pre-#336 RNG state — only
            # the per-PR ``comment_count`` (a gated key per
            # ``test_demo_variants_byte_identity.py``) shifts on the
            # affected PRs, plus the rollup-level aggregates that
            # depend on it (also gated keys).
            if thread_count == 0:
                _ = comments_metrics_rng.randint(0, 3)
                comment_count = 0
            else:
                comment_count = thread_count * comments_metrics_rng.randint(2, 5)
        records.append(
            {
                "id": base_id + idx,
                "title": title,
                "author_id": author_id,
                "repository_id": repo_id,
                "cycle_time": float(cycle_time),
                "thread_count": thread_count,
                "comment_count": comment_count,
                "active_thread_count": active_thread_count,
            }
        )

    records.sort(key=lambda r: (-float(r["cycle_time"]), int(r["id"])))
    return records


def _strip_comments_metrics_from_pr(pr: PrRecord) -> PrRecord:
    """Return a new PrRecord with the three comments-metrics fields dropped.

    Feature 310 serialization-layer gate: when
    ``_EMIT_COMMENTS_METRICS`` is False, every PR emitted into the
    weekly rollup must carry only the 5 feature-060 fields.  Every
    non-gated byte stays byte-identical across the variant-on and
    variant-off outputs, by construction (same generation pass, same
    sort, same rounding).
    """
    return {
        "id": pr["id"],
        "title": pr["title"],
        "author_id": pr["author_id"],
        "repository_id": pr["repository_id"],
        "cycle_time": pr["cycle_time"],
    }


def _aggregate_comments_for_week(prs: list[PrRecord]) -> dict[str, int | bool]:
    """Sum per-PR comments-metrics into a rollup-level aggregate (FR-2-06).

    Mirrors ``aggregators.py::_compute_weekly_comments_aggregate`` so the
    synthetic demo and real-data aggregator emit identical shapes:

    * Numeric fields are sums over the EXTRACTED-SUBSET (PRs where the
      per-PR triplet is NOT the partial sentinel from 310 INV-10 — i.e.,
      ``thread_count`` is not None).
    * PRs with the partial sentinel contribute zero to the sums and flip
      ``coverage_partial`` to True per FR-2-03.
    * All four fields present together per INV-1-08 atomicity.

    Caller is responsible for capability gating — only invoke when
    ``_EMIT_COMMENTS_METRICS`` is True.  Capability-off rollups MUST
    omit the entire ``comments`` key (FR-3-03).
    """
    thread_total = 0
    comment_total = 0
    active_total = 0
    coverage_partial = False
    for pr in prs:
        thread = pr.get("thread_count")
        if thread is None:
            coverage_partial = True
            continue
        thread_total += int(thread)
        comment_total += int(pr.get("comment_count") or 0)
        active_total += int(pr.get("active_thread_count") or 0)
    return {
        "thread_count": thread_total,
        "comment_count": comment_total,
        "active_thread_count": active_total,
        "coverage_partial": coverage_partial,
    }


def _aggregate_by_author_comments_for_week(
    prs: list[PrRecord],
) -> dict[str, dict[str, int | bool]] | None:
    """Per-(week, author) comments-density emission for the synthetic demo.

    Mirrors ``aggregators.py::_compute_weekly_by_author_comments``
    semantics so the demo and the real-data aggregator emit byte-aligned
    shapes for the Feature 334 ``by_author_comments`` rollup-root key.

    One bucket per ``author_id`` appearing on any PR in ``prs``.  Numeric
    fields sum over the bucket's extracted-subset (PRs whose
    ``thread_count`` is not None per 310 INV-10).  ``coverage_partial``
    is True iff at least one PR in the bucket has ``thread_count is None``
    (FR-1-06).  Outer dict keys are emitted in ascending order by
    author key for byte-determinism (matches the aggregator's
    ``ORDER BY author_or_sentinel ASC`` plus ``json.dumps(sort_keys=True)``).

    All synthetic-demo authors exist in the users surface, so the
    reserved sentinel literal ``__former_or_unavailable_author__`` is
    never used here — sentinel-value parity is exercised by the SC05
    reconciliation test against the production aggregator on a fixture
    that DOES include a ghost author (see ``GHOST_USER_ID`` in
    ``tests/fixtures/sc05/fixture_builder.py``).

    Returns ``None`` when ``prs`` is empty so callers can omit the
    ``by_author_comments`` key entirely (FR-3-03 / INV-2-09 omission
    contract).  Caller is responsible for capability gating.
    """
    if not prs:
        return None
    grouped: dict[str, list[PrRecord]] = {}
    for pr in prs:
        author = str(pr["author_id"])
        grouped.setdefault(author, []).append(pr)
    buckets: dict[str, dict[str, int | bool]] = {}
    for author in sorted(grouped):
        thread_total = 0
        comment_total = 0
        active_total = 0
        coverage_partial = False
        for pr in grouped[author]:
            thread = pr.get("thread_count")
            if thread is None:
                coverage_partial = True
                continue
            thread_total += int(thread)
            comment_total += int(pr.get("comment_count") or 0)
            active_total += int(pr.get("active_thread_count") or 0)
        buckets[author] = {
            "thread_count": thread_total,
            "comment_count": comment_total,
            "active_thread_count": active_total,
            "coverage_partial": coverage_partial,
        }
    return buckets if buckets else None


def _aggregate_by_repository_comments_for_week(
    prs: list[PrRecord],
    repository_name_to_id: dict[str, str],
) -> dict[str, dict[str, int | bool]] | None:
    """Per-(week, repo) comments-density emission for the synthetic demo.

    Mirrors ``aggregators.py::_compute_weekly_by_repository_comments``
    semantics so the demo and the real-data aggregator emit byte-aligned
    shapes for the Feature 335 ``by_repository_comments`` rollup-root key.

    Production aggregator emits outer-dict keys equal to
    ``pull_requests.repository_id`` (UUID per FR-1-03 + the FK constraint
    at ``models.py:88``).  In the synthetic demo, the pre-existing
    ``by_repository`` throughput emission is keyed by ``repository_name``
    (line 1736-1754), so each PrRecord's ``repository_id`` field holds
    the synthetic repository_name (line 396-499 — ``repo_id = str(entry)``
    where ``entry`` came from ``rollup.by_repository.keys()``).  This
    helper RESOLVES that name back to the canonical UUID via
    ``repository_name_to_id`` so the emitted ``by_repository_comments``
    namespace matches production (UUID-keyed) — closing the namespace
    divergence Codex flagged on Phase 2.4.  The broader demo's
    ``by_repository`` keying is intentionally left as-is per the user's
    "no broader cleanup" directive (NAME = stable identity throughout
    the existing synthetic path).

    One bucket per UUID-resolved ``repository_id`` appearing on any PR in
    ``prs``.  Numeric fields sum over the bucket's extracted-subset (PRs
    whose ``thread_count`` is not None per 310 INV-10).  ``coverage_partial``
    is True iff at least one PR in the bucket has ``thread_count is None``
    (FR-1-06).  Outer dict keys are emitted in ascending order by the
    resolved UUID for byte-determinism (matches the aggregator's
    ``ORDER BY pr.repository_id ASC`` plus ``json.dumps(sort_keys=True)``).

    No sentinel concept (Feature 335 CL-03 / FR-1-03 / INV-3-12 —
    repository_id is FK-protected at ``models.py:88``).  Lookup failures
    in ``repository_name_to_id`` are FAIL-LOUD per CL-03: the helper
    raises ``RuntimeError`` rather than silently coercing the name back
    into the bucket key namespace.  Should be impossible in a well-
    formed demo because the same ``repositories`` list seeds both the
    dimension and the ``by_repository`` keys; a missing entry is a
    demo-generator bug (e.g., the call site built the map from a
    different list than the one used to construct ``rollup.by_repository``).

    Returns ``None`` when ``prs`` is empty so callers can omit the
    ``by_repository_comments`` key entirely (FR-3-03 / INV-3-09 / FR-1-10
    omission contract).  Caller is responsible for capability gating.
    """
    if not prs:
        return None
    grouped: dict[str, list[PrRecord]] = {}
    for pr in prs:
        # In the demo path pr["repository_id"] holds a repository_name
        # (pre-existing demo design — see this helper's docstring above).
        # Resolve the name back to the canonical UUID so the emitted
        # outer-dict keys match production's namespace (FR-1-03).
        # FAIL-LOUD per CL-03 if the lookup misses — a silent fallback
        # would re-emit the name as a key and re-introduce the namespace
        # divergence Codex flagged.
        name = str(pr["repository_id"])
        repo_uuid = repository_name_to_id.get(name)
        if repo_uuid is None:
            raise RuntimeError(
                "Feature 335 demo namespace FAIL-LOUD (CL-03): "
                f'PrRecord["repository_id"]={name!r} has no matching entry '
                "in repository_name_to_id (the map was built from the demo's "
                "repositories list outside the per-week loop).  This should "
                "be impossible in a well-formed demo because the same "
                "repositories list seeds both the dimension and the "
                "rollup.by_repository keys that PrRecord names are sampled "
                "from — investigate the demo generator's data-flow integrity "
                "(e.g., did the call site build the map from a different "
                "list than the one used to construct rollup.by_repository?)."
            )
        grouped.setdefault(repo_uuid, []).append(pr)
    buckets: dict[str, dict[str, int | bool]] = {}
    for repo in sorted(grouped):
        thread_total = 0
        comment_total = 0
        active_total = 0
        coverage_partial = False
        for pr in grouped[repo]:
            thread = pr.get("thread_count")
            if thread is None:
                coverage_partial = True
                continue
            thread_total += int(thread)
            comment_total += int(pr.get("comment_count") or 0)
            active_total += int(pr.get("active_thread_count") or 0)
        buckets[repo] = {
            "thread_count": thread_total,
            "comment_count": comment_total,
            "active_thread_count": active_total,
            "coverage_partial": coverage_partial,
        }
    return buckets if buckets else None


def synthesize_pr_comment_streams_for_week(
    prs: list[PrRecord],
    user_pool: list[str],
    ghost_pool: list[str],
    rng: random.Random,
) -> tuple[list[SyntheticPrThread], list[SyntheticPrComment]]:
    """Feature 336 CL-14 / T015: synthesize per-(PR, thread) and
    per-(PR, thread, comment) demo-internal records for one week.

    The production ``pr_comments`` table is the per-reviewer aggregator's
    iteration unit (CL-13 / INV-4-13); the demo path has no live
    ``pr_comments`` source.  This synthesizer fabricates the missing
    rows from each PR's pre-existing PrRecord aggregate counts
    (``thread_count`` / ``comment_count`` / ``active_thread_count``) such
    that re-aggregating the synthetic streams yields P's aggregate
    counts back (the coherence guard at
    ``tests/unit/test_demo_synthetic_pr_comments.py`` enforces this
    round-trip per CL-14 step 3).

    Inputs:

    - ``prs``: per-week PrRecord list (the SAME ``synthetic_prs_full``
      list the existing per-author / per-repo aggregators consume; per
      INV-4-10 the per-reviewer aggregator MUST also span W's full
      extracted-subset, NOT the 500-row drill-down slice).
    - ``user_pool``: real user UUIDs from the demo's ``users`` directory
      (the FK target for ``pr_comments.author_id`` per ``models.py:172``).
      Synthesizer samples commenters from this pool minus the PR's
      author (CL-04 self-comment exclusion enforced at synthesis time).
    - ``ghost_pool``: synthetic UUIDs ABSENT from ``user_pool`` (per
      CL-14 step 4 ghost-commenter inclusion guarantee).  ≥1 ghost MUST
      appear in the emitted comment stream so the per-reviewer sentinel
      reconciliation branch is exercised non-vacuously.
    - ``rng``: deterministic ``random.Random`` (seeded via
      ``_COMMENT_STREAM_SEED_OFFSET`` so synthesis cannot perturb
      ``pr_record_rng`` / ``comments_metrics_rng`` / ``RNG`` streams).

    Outputs (NOT serialized to rollup files per CL-14 step 5):

    - ``synthetic_pr_threads``: ``SyntheticPrThread`` list.  For each
      PR with non-NULL ``thread_count``, emits ``thread_count`` rows;
      the first ``active_thread_count`` carry ``status='active'`` and
      the remainder carry ``status='fixed'``; ``is_deleted=0`` per C1.
    - ``synthetic_pr_comments``: ``SyntheticPrComment`` list.  For each
      PR with non-NULL ``comment_count > 0``, emits ``comment_count``
      rows distributed across the PR's threads (each thread gets ≥1
      comment first; remaining comments distributed uniformly).
      Commenters sampled from ``user_pool ∪ ghost_pool`` excluding PR
      author.  ``is_deleted=0`` per C1.

    Coherence guarantees (per CL-14 step 3):

    - ``len([t for t in synthetic_pr_threads if t.pull_request_uid == str(P.id)]) == P.thread_count``
    - ``len([t for t in synthetic_pr_threads if t.pull_request_uid == str(P.id) and t.status == 'active']) == P.active_thread_count``
    - ``len([c for c in synthetic_pr_comments if c.pull_request_uid == str(P.id)]) == P.comment_count``
    - Every emitted thread has ≥1 comment in synthetic_pr_comments
      (no orphan threads).
    - Every commenter ``author_id`` ≠ corresponding PR's
      ``author_id`` (CL-04 self-comment exclusion at synthesis time).
    - When ``ghost_pool`` is non-empty AND any PR yields a
      ghost-eligible comment slot, ≥1 emitted commenter is drawn from
      ``ghost_pool``.

    Per the FK invariant from commit 242bbd21 (``scripts/generate-demo-data.py:486-510``),
    PrRecord shapes ALWAYS satisfy ``comment_count > 0 ⇒ thread_count > 0``;
    this helper does NOT need to special-case the legacy "drive-by
    system comments" shape (which is now structurally absent).

    310 INV-10 partial sentinel: PRs with ``thread_count is None`` are
    skipped entirely (no threads or comments emitted for them); the
    same-W ``coverage_partial`` flag at the AGGREGATOR level captures
    the partial-coverage signal independently.
    """
    threads: list[SyntheticPrThread] = []
    comments: list[SyntheticPrComment] = []

    # Phase 1: synthesize threads for every PR with non-NULL aggregates.
    for pr in prs:
        thread_count_raw = pr.get("thread_count")
        active_thread_count_raw = pr.get("active_thread_count")
        if thread_count_raw is None or active_thread_count_raw is None:
            # 310 INV-10 partial sentinel — skip synthesis.
            continue
        thread_count = int(thread_count_raw)
        active_thread_count = int(active_thread_count_raw)
        pr_uid = str(pr["id"])
        for thread_idx in range(thread_count):
            threads.append(
                {
                    "pull_request_uid": pr_uid,
                    "thread_id": f"thread-{pr_uid}-{thread_idx}",
                    "status": (
                        "active" if thread_idx < active_thread_count else "fixed"
                    ),
                    "is_deleted": 0,
                }
            )

    # Phase 2: synthesize comments + ghost-forcing.
    ghost_used = False
    for pr in prs:
        thread_count_raw = pr.get("thread_count")
        comment_count_raw = pr.get("comment_count")
        if thread_count_raw is None or comment_count_raw is None:
            continue
        thread_count = int(thread_count_raw)
        comment_count = int(comment_count_raw)
        if thread_count == 0 or comment_count == 0:
            # FK invariant from commit 242bbd21: comment_count == 0 when
            # thread_count == 0.  Skip both branches uniformly — no
            # comments emitted for empty PRs.
            continue
        pr_uid = str(pr["id"])
        pr_author = str(pr["author_id"])

        # Eligible commenter pools (CL-04 self-comment exclusion at
        # synthesis time): drop the PR's author from both pools.  If
        # ghost_pool happens to contain the PR's author, the ghost-pool
        # filter drops them too — ghost UUIDs are intended to be
        # synthetic UUIDs absent from ``users``, so this is defensive
        # (the same UUID being both a ``users`` author and in
        # ghost_pool would be a setup-stage construction bug).
        eligible_user_pool = [u for u in user_pool if u != pr_author]
        eligible_ghost_pool = [g for g in ghost_pool if g != pr_author]
        if not eligible_user_pool and not eligible_ghost_pool:
            raise RuntimeError(
                "synthesize_pr_comment_streams_for_week: no eligible "
                f"commenter pool for PR {pr_uid!r} (author "
                f"{pr_author!r}); user_pool={user_pool!r}, "
                f"ghost_pool={ghost_pool!r} — every entry equals the PR's "
                "author, making CL-04 self-comment exclusion unsatisfiable"
            )
        eligible_pool = eligible_user_pool + eligible_ghost_pool

        # Each thread gets ≥1 comment first (CL-14 step 2: no orphan
        # threads).  Then distribute the remaining comments uniformly
        # across the PR's threads.
        pr_thread_ids = [f"thread-{pr_uid}-{i}" for i in range(thread_count)]
        per_pr_comments: list[SyntheticPrComment] = []
        for thread_id in pr_thread_ids:
            commenter = rng.choice(eligible_pool)
            per_pr_comments.append(
                {
                    "pull_request_uid": pr_uid,
                    "thread_id": thread_id,
                    "author_id": commenter,
                    "is_deleted": 0,
                }
            )
        # comment_count >= thread_count holds by FK invariant + the
        # generator's distribution rule (lines 480-510).
        remaining = comment_count - thread_count
        for _ in range(remaining):
            thread_id = rng.choice(pr_thread_ids)
            commenter = rng.choice(eligible_pool)
            per_pr_comments.append(
                {
                    "pull_request_uid": pr_uid,
                    "thread_id": thread_id,
                    "author_id": commenter,
                    "is_deleted": 0,
                }
            )

        # Ghost-forcing per CL-14 step 4: if ghost_pool is non-empty AND
        # not yet used AND this PR has eligible ghosts, rewrite the FIRST
        # comment to use a ghost commenter.  This guarantees ≥1 ghost
        # emission across the full week regardless of the RNG's choice
        # distribution (without forcing, a small fixture or unlucky
        # seed could miss the ghost pool entirely).
        if not ghost_used and eligible_ghost_pool and per_pr_comments:
            per_pr_comments[0]["author_id"] = rng.choice(eligible_ghost_pool)
            ghost_used = True

        comments.extend(per_pr_comments)

    if ghost_pool and not ghost_used:
        # Defensive: every PR's author equals every ghost (impossible
        # in practice when ghost_pool is constructed from UUIDs absent
        # from ``users``), OR every PR has thread_count=0/comment_count=0
        # and produced no comments — degenerate fixture.
        raise RuntimeError(
            "synthesize_pr_comment_streams_for_week: ghost_pool is "
            f"non-empty ({ghost_pool!r}) but no PR yielded a ghost-"
            "eligible comment slot — ghost-commenter inclusion guarantee "
            "per CL-14 step 4 cannot be satisfied.  Either every PR's "
            "author equals every ghost (impossible if ghost_pool was "
            "constructed disjoint from user_pool), OR every PR has "
            "thread_count=0/comment_count=0 and produced no comments."
        )

    return threads, comments


def _aggregate_by_reviewer_comments_for_week(
    prs: list[PrRecord],
    synthetic_pr_threads: list[SyntheticPrThread],
    synthetic_pr_comments: list[SyntheticPrComment],
    users_uuid_set: set[str],
) -> dict[str, dict[str, int | bool]] | None:
    """Per-(week, reviewer) comments-density emission for the synthetic demo.

    Mirrors ``aggregators.py::_compute_weekly_by_reviewer_comments``
    semantics so the demo and the real-data aggregator emit byte-aligned
    shapes for the Feature 336 ``by_reviewer_comments`` rollup-root key.

    Iteration unit is ``synthetic_pr_comments`` (NOT ``prs`` — divergence
    from ``_aggregate_by_author_comments_for_week`` and
    ``_aggregate_by_repository_comments_for_week`` per CL-13 / INV-4-13;
    the per-reviewer dimension's aggregator iterates pr_comments rows).

    For each comment row:

    - Skip ``is_deleted != 0`` rows (C1).
    - Resolve the PR's author from ``prs`` for self-comment exclusion;
      a missing PR is FAIL-LOUD per CL-15 (defense against fixture
      drift between the synthesizer's PrRecord set and the aggregator's).
    - If ``commenter == pr_author``: skip (CL-04 self-comment exclusion;
      defensive — synthesis already enforces this invariant).
    - Resolve the bucket key: ``commenter`` if ``commenter in users_uuid_set``,
      else ``FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL`` (CL-03 / INV-4-12).
    - Increment ``comment_count`` (raw row count).  Add the
      ``(pull_request_uid, thread_id)`` tuple to the bucket's distinct-
      thread set; if the thread has ``status='active'``, also add to the
      active-thread set.

    Per-bucket emission: ``thread_count = COUNT(DISTINCT thread_id)``
    (FR-1-05 — divergence from #334 / #335 raw row count); same for
    ``active_thread_count`` restricted to active threads;
    ``comment_count`` is the raw count; ``coverage_partial`` is the
    same-W flag per CL-10 (every reviewer in W shares the same value =
    ``any PR in prs has thread_count is None``).

    Outer dict keys ascending by bucket key for byte-determinism (matches
    the production aggregator's ``ORDER BY commenter_or_sentinel ASC``
    plus ``json.dumps(sort_keys=True)``).

    Returns ``None`` when no eligible-reviewer-comment rows exist after
    filtering (FR-1-11 omission contract — caller MUST omit the
    ``by_reviewer_comments`` key entirely; not ``{}``-valued, not
    ``null``-valued).  Caller is responsible for capability gating.
    """
    if not prs:
        return None

    # Same-W coverage_partial flag per CL-10: every reviewer in W shares
    # the W-level value (NOT bucket-specific).  Computed once before the
    # iteration so every emitted bucket inherits the same flag.
    same_w_partial = any(pr.get("thread_count") is None for pr in prs)

    # PR -> author_id lookup for self-comment exclusion + FAIL-LOUD
    # defense against fixture drift (synthetic_pr_comments referencing a
    # PR uid not in prs).
    pr_authors: dict[str, str] = {str(pr["id"]): str(pr["author_id"]) for pr in prs}

    # (pull_request_uid, thread_id) -> status lookup for the
    # active_thread_count subset filter.
    thread_status: dict[tuple[str, str], str] = {
        (t["pull_request_uid"], t["thread_id"]): t["status"]
        for t in synthetic_pr_threads
    }

    comment_count_by_bucket: dict[str, int] = {}
    threads_by_bucket: dict[str, set[tuple[str, str]]] = {}
    active_threads_by_bucket: dict[str, set[tuple[str, str]]] = {}

    for c in synthetic_pr_comments:
        if int(c.get("is_deleted", 0)) != 0:
            continue
        pr_uid = c["pull_request_uid"]
        commenter = c["author_id"]
        pr_author = pr_authors.get(pr_uid)
        if pr_author is None:
            raise RuntimeError(
                "_aggregate_by_reviewer_comments_for_week: synthetic_pr_comments "
                f"row references pull_request_uid={pr_uid!r} which is NOT in "
                "the prs list — fixture drift between synthesizer output and "
                "aggregator input (CL-15 FAIL-LOUD)"
            )
        if commenter == pr_author:
            # CL-04 self-comment exclusion (defensive — synthesizer already
            # enforces this invariant at construction time).
            continue
        bucket_key = (
            commenter
            if commenter in users_uuid_set
            else FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL
        )
        comment_count_by_bucket[bucket_key] = (
            comment_count_by_bucket.get(bucket_key, 0) + 1
        )
        thread_key = (pr_uid, c["thread_id"])
        threads_by_bucket.setdefault(bucket_key, set()).add(thread_key)
        if thread_status.get(thread_key) == "active":
            active_threads_by_bucket.setdefault(bucket_key, set()).add(thread_key)

    if not comment_count_by_bucket:
        return None

    buckets: dict[str, dict[str, int | bool]] = {}
    for bucket_key in sorted(comment_count_by_bucket):
        buckets[bucket_key] = {
            "thread_count": len(threads_by_bucket.get(bucket_key, set())),
            "comment_count": comment_count_by_bucket[bucket_key],
            "active_thread_count": len(active_threads_by_bucket.get(bucket_key, set())),
            "coverage_partial": same_w_partial,
        }
    return buckets


# =============================================================================
# UUID v5 Generation (T007)
# =============================================================================


def generate_uuid(name: str) -> uuid.UUID:
    """Generate deterministic UUID v5 from name string."""
    return uuid.uuid5(DNS_NAMESPACE, name)


# =============================================================================
# Entity Definitions
# =============================================================================


@dataclass
class SyntheticOrganization:
    """Represents a fictional Azure DevOps organization."""

    organization_name: str


@dataclass
class SyntheticProject:
    """Represents a project within an organization."""

    organization_name: str
    project_name: str


@dataclass
class SyntheticRepository:
    """Represents a code repository within a project."""

    repository_id: uuid.UUID
    repository_name: str
    organization_name: str
    project_name: str


@dataclass
class SyntheticUser:
    """Represents a developer with activity in the system."""

    user_id: uuid.UUID
    display_name: str


@dataclass
class SyntheticTeam:
    """Represents a team within a project."""

    team_id: uuid.UUID
    team_name: str
    organization_name: str
    project_name: str
    member_count: int


@dataclass
class WeeklyRollup:
    """Aggregated PR metrics for one ISO week."""

    week: str  # Format: YYYY-Www
    start_date: date
    end_date: date
    pr_count: int
    cycle_time_p50: float | None
    cycle_time_p90: float | None
    review_time_p50: float | None
    review_time_p90: float | None
    authors_count: int
    reviewers_count: int
    by_repository: dict[str, SliceMetrics]
    by_team: dict[str, SliceMetrics]
    by_author: dict[str, SliceMetrics]
    by_author_and_repo: dict[str, dict[str, SliceMetrics]]
    by_reviewer: dict[str, ReviewerSliceMetrics] | None = None
    by_team_and_repo: dict[str, dict[str, SliceMetrics]] | None = None


@dataclass
class YearlyDistribution:
    """Cycle time bucket distribution for one calendar year."""

    year: str
    start_date: date
    end_date: date
    total_prs: int
    cycle_time_buckets: dict[str, int]
    prs_by_month: dict[str, int]


# =============================================================================
# Entity Generators (T008-T011)
# =============================================================================


# T008: Organization Generator
ORGANIZATION_NAMES = ["acme-corp", "contoso-dev", "fabrikam-eng"]


def generate_organizations() -> list[SyntheticOrganization]:
    """Generate 3 synthetic organizations."""
    return [SyntheticOrganization(name) for name in ORGANIZATION_NAMES]


# T009: Project Generator
PROJECT_MAPPING = {
    "acme-corp": ["platform-services", "mobile-apps", "data-pipeline"],
    "contoso-dev": ["web-frontend", "api-gateway"],
    "fabrikam-eng": ["analytics-engine", "ml-platform", "devops-tools"],
}


def generate_projects() -> list[SyntheticProject]:
    """Generate 8 synthetic projects across organizations."""
    projects = []
    for org_name, project_names in PROJECT_MAPPING.items():
        for proj_name in project_names:
            projects.append(SyntheticProject(org_name, proj_name))
    return projects


# T010: Repository Generator
REPOSITORY_MAPPING = {
    "platform-services": ["user-service", "auth-service", "notification-service"],
    "mobile-apps": ["ios-app", "android-app", "shared-core"],
    "data-pipeline": ["etl-jobs", "data-warehouse", "stream-processor"],
    "web-frontend": ["react-shell", "design-system", "forms-lib"],
    "api-gateway": ["gateway-core", "rate-limiter"],
    "analytics-engine": ["metrics-collector", "dashboard-api", "report-generator"],
    "ml-platform": ["model-training", "inference-service", "feature-store"],
    "devops-tools": ["ci-scripts", "terraform-modules", "monitoring-stack"],
}


def generate_repositories(
    projects: list[SyntheticProject],
) -> list[SyntheticRepository]:
    """Generate 23 synthetic repositories with UUID v5 IDs."""
    repos = []
    for project in projects:
        repo_names = REPOSITORY_MAPPING.get(project.project_name, [])
        for repo_name in repo_names:
            # UUID generated as: uuid5(DNS_NAMESPACE, f"{org}/{project}/{repo}")
            uuid_name = (
                f"{project.organization_name}/{project.project_name}/{repo_name}"
            )
            repo_id = generate_uuid(uuid_name)
            repos.append(
                SyntheticRepository(
                    repository_id=repo_id,
                    repository_name=repo_name,
                    organization_name=project.organization_name,
                    project_name=project.project_name,
                )
            )
    return repos


# Team Generator
TEAM_MAPPING = {
    "platform-services": "Platform Team",
    "web-frontend": "Frontend Team",
    "data-pipeline": "Data Team",
    "ml-platform": "ML Team",
}


def generate_teams(projects: list[SyntheticProject]) -> list[SyntheticTeam]:
    """Generate 4 synthetic teams mapped to specific projects."""
    teams = []
    for project in projects:
        team_name = TEAM_MAPPING.get(project.project_name)
        if team_name is None:
            continue
        team_id = generate_uuid(f"team/{project.organization_name}/{team_name}")
        member_count = 28 + int(RNG.random() * 34)
        teams.append(
            SyntheticTeam(
                team_id=team_id,
                team_name=team_name,
                organization_name=project.organization_name,
                project_name=project.project_name,
                member_count=member_count,
            )
        )
    return teams


# T011: User Generator
FIRST_NAMES = [
    "Alice",
    "Bob",
    "Carol",
    "David",
    "Emma",
    "Frank",
    "Grace",
    "Henry",
    "Iris",
    "Jack",
    "Karen",
    "Leo",
    "Maria",
    "Nathan",
    "Olivia",
    "Peter",
    "Quinn",
    "Rachel",
    "Samuel",
    "Tina",
    "Ursula",
    "Victor",
    "Wendy",
    "Xavier",
    "Yolanda",
    "Zachary",
    "Abigail",
    "Benjamin",
    "Charlotte",
    "Daniel",
    "Elizabeth",
    "Frederick",
    "Georgia",
    "Harold",
    "Isabella",
    "James",
    "Katherine",
    "Lawrence",
    "Margaret",
    "Nicholas",
    "Patricia",
    "Quentin",
    "Rebecca",
    "Stephen",
    "Theresa",
    "Ulysses",
    "Victoria",
    "William",
    "Ximena",
    "Yvonne",
]

LAST_NAMES = [
    "Johnson",
    "Smith",
    "Williams",
    "Brown",
    "Jones",
    "Garcia",
    "Miller",
    "Davis",
    "Rodriguez",
    "Martinez",
    "Hernandez",
    "Lopez",
    "Gonzalez",
    "Wilson",
    "Anderson",
    "Thomas",
    "Taylor",
    "Moore",
    "Jackson",
    "Martin",
    "Lee",
    "Perez",
    "Thompson",
    "White",
    "Harris",
    "Sanchez",
    "Clark",
    "Ramirez",
    "Lewis",
    "Robinson",
    "Walker",
    "Young",
    "Allen",
    "King",
    "Wright",
    "Scott",
    "Torres",
    "Nguyen",
    "Hill",
    "Flores",
    "Green",
    "Adams",
    "Nelson",
    "Baker",
    "Hall",
    "Rivera",
    "Campbell",
    "Mitchell",
    "Carter",
    "Roberts",
]


def generate_users() -> list[SyntheticUser]:
    """Generate enterprise-scale synthetic users with realistic names."""
    total_name_pairs = len(FIRST_NAMES) * len(LAST_NAMES)
    if NUM_USERS > total_name_pairs:
        raise ValueError(
            "Not enough deterministic name pairs to generate unique synthetic users"
        )

    users = []
    permutation_step = 37  # co-prime with 2500 available name pairs
    for i in range(NUM_USERS):
        pair_index = (i * permutation_step) % total_name_pairs
        first_name = FIRST_NAMES[pair_index // len(LAST_NAMES)]
        last_name = LAST_NAMES[pair_index % len(LAST_NAMES)]
        display_name = f"{first_name} {last_name}"
        # UUID generated as: uuid5(DNS_NAMESPACE, f"user/{display_name}")
        user_id = generate_uuid(f"user/{display_name}")
        users.append(SyntheticUser(user_id=user_id, display_name=display_name))
    return users


def _stable_index(key: str, modulo: int) -> int:
    """Return a deterministic non-negative index for the given key."""
    if modulo <= 0:
        return 0
    return generate_uuid(key).int % modulo


def build_team_author_pools(
    users: list[SyntheticUser], teams: list[SyntheticTeam]
) -> dict[str, list[SyntheticUser]]:
    """Assign deterministic author pools to teams with slight overlap."""
    if not teams:
        return {}

    base_size = max(24, len(users) // len(teams))
    overlap = max(6, len(users) // 25)
    pools: dict[str, list[SyntheticUser]] = {}

    for index, team in enumerate(teams):
        start = index * base_size
        pool: list[SyntheticUser] = []
        for offset in range(base_size + overlap):
            user = users[(start + offset) % len(users)]
            if user not in pool:
                pool.append(user)
        pools[team.team_name] = pool

    return pools


def _allocate_author_repo_entries(
    *,
    week_key: str,
    team_name: str,
    repo_name: str,
    repo_entry: SliceMetrics,
    team_entry: SliceMetrics,
    team_pool: list[SyntheticUser],
    author_slices: dict[str, list[SliceMetrics]],
    by_author_and_repo: dict[str, dict[str, SliceMetrics]],
    rt_rng: random.Random,
) -> None:
    """Allocate team-repo activity across deterministic author slices."""
    repo_prs = int(repo_entry["pr_count"])
    if repo_prs <= 0 or not team_pool:
        return

    team_authors = max(1, int(team_entry["authors_count"]))
    target_authors = max(
        1,
        min(
            len(team_pool),
            team_authors,
            repo_prs,
            max(1, int(round(repo_prs**0.72))),
        ),
    )
    start_idx = _stable_index(f"{week_key}/{team_name}/{repo_name}", len(team_pool))
    selected_authors = [
        team_pool[(start_idx + offset) % len(team_pool)]
        for offset in range(target_authors)
    ]
    raw_weights = [
        1
        + (
            _stable_index(
                f"{week_key}/{team_name}/{repo_name}/{author.user_id}",
                9,
            )
            / 10.0
        )
        for author in selected_authors
    ]
    pr_allocations = largest_remainder_allocate(repo_prs, raw_weights)

    for author, author_prs in zip(selected_authors, pr_allocations, strict=True):
        if author_prs <= 0:
            continue
        factor = 0.92 + (
            _stable_index(
                f"{week_key}/{repo_name}/{author.user_id}/cycle",
                17,
            )
            / 100.0
        )
        author_entry: SliceMetrics = {
            "pr_count": author_prs,
            "cycle_time_p50": None,
            "cycle_time_p90": None,
            "review_time_p50": None,
            "review_time_p90": None,
            "authors_count": 1,
            "reviewers_count": max(
                1,
                min(
                    int(repo_entry["reviewers_count"]),
                    int(author_prs**SUBLINEAR_EXPONENT) + 1,
                ),
            ),
        }
        if author_prs >= 5:
            p50 = repo_entry["cycle_time_p50"]
            p90 = repo_entry["cycle_time_p90"]
            assert p50 is not None
            assert p90 is not None
            author_entry["cycle_time_p50"] = p50 * factor
            author_entry["cycle_time_p90"] = p90 * factor
            a_rt_p50, a_rt_p90 = _derive_review_time_pair(
                p50 * factor, p90 * factor, rt_rng
            )
            author_entry["review_time_p50"] = a_rt_p50
            author_entry["review_time_p90"] = a_rt_p90

        author_id = str(author.user_id)
        author_slices.setdefault(author_id, []).append(author_entry)
        by_author_and_repo.setdefault(author_id, {})[repo_name] = author_entry


def _collapse_author_slices(
    author_slices: dict[str, list[SliceMetrics]],
) -> dict[str, SliceMetrics]:
    """Aggregate exact author+repo entries into by_author slices."""
    by_author: dict[str, SliceMetrics] = {}
    for author_id, entries in author_slices.items():
        pr_count = sum(int(entry["pr_count"]) for entry in entries)
        if pr_count <= 0:
            continue
        weighted_p50_total = 0.0
        weighted_p90_total = 0.0
        weighted_prs = 0
        # Review time: accumulate P50 and P90 independently so that
        # per-percentile null independence is preserved through collapse.
        rt_p50_weighted_total = 0.0
        rt_p50_weighted_prs = 0
        rt_p90_weighted_total = 0.0
        rt_p90_weighted_prs = 0
        reviewers_count = 1
        for entry in entries:
            reviewers_count = max(reviewers_count, int(entry["reviewers_count"]))
            p50 = entry["cycle_time_p50"]
            p90 = entry["cycle_time_p90"]
            if p50 is not None and p90 is not None:
                weighted_prs += int(entry["pr_count"])
                weighted_p50_total += p50 * int(entry["pr_count"])
                weighted_p90_total += p90 * int(entry["pr_count"])
            rt_p50 = entry["review_time_p50"]
            if rt_p50 is not None:
                rt_p50_weighted_prs += int(entry["pr_count"])
                rt_p50_weighted_total += rt_p50 * int(entry["pr_count"])
            rt_p90 = entry["review_time_p90"]
            if rt_p90 is not None:
                rt_p90_weighted_prs += int(entry["pr_count"])
                rt_p90_weighted_total += rt_p90 * int(entry["pr_count"])

        by_author[author_id] = {
            "pr_count": pr_count,
            "cycle_time_p50": (
                weighted_p50_total / weighted_prs if weighted_prs >= 5 else None
            ),
            "cycle_time_p90": (
                weighted_p90_total / weighted_prs if weighted_prs >= 5 else None
            ),
            # Couple P50/P90 with same demo threshold as cycle_time (>= 5).
            "review_time_p50": (
                rt_p50_weighted_total / rt_p50_weighted_prs
                if rt_p50_weighted_prs >= 5 and rt_p90_weighted_prs >= 5
                else None
            ),
            "review_time_p90": (
                rt_p90_weighted_total / rt_p90_weighted_prs
                if rt_p50_weighted_prs >= 5 and rt_p90_weighted_prs >= 5
                else None
            ),
            "authors_count": 1,
            "reviewers_count": reviewers_count,
        }
    return by_author


def _generate_reviewer_breakdown(
    *,
    week_key: str,
    users: list[SyntheticUser],
    pr_count: int,
    authors_count: int,
    repo_count: int,
) -> dict[str, ReviewerSliceMetrics]:
    """Generate deterministic reviewer slices for one week."""
    if pr_count <= 0 or not users:
        return {}

    guaranteed_active_reviewers = min(
        len(users),
        MIN_ACTIVE_REVIEWERS,
        max(1, pr_count // MIN_REVIEWED_PRS_PER_ACTIVE_REVIEWER),
    )
    reviewer_count = max(
        guaranteed_active_reviewers,
        min(len(users), int(pr_count * REVIEWER_RATIO)),
    )
    week_offset = sum(ord(ch) for ch in week_key) % len(users)
    selected_reviewers = [
        users[(week_offset + offset * 3) % len(users)]
        for offset in range(reviewer_count)
    ]

    baseline_allocations = [0 for _ in range(reviewer_count)]
    guaranteed_prs = guaranteed_active_reviewers * MIN_REVIEWED_PRS_PER_ACTIVE_REVIEWER
    if pr_count >= guaranteed_prs:
        for idx in range(guaranteed_active_reviewers):
            baseline_allocations[idx] = MIN_REVIEWED_PRS_PER_ACTIVE_REVIEWER
        remaining_prs = pr_count - guaranteed_prs
    else:
        remaining_prs = pr_count

    additional_allocations = largest_remainder_allocate(
        remaining_prs,
        [1.0 + ((idx % 5) * 0.12) for idx in range(reviewer_count)],
    )
    review_allocations = [
        baseline_allocations[idx] + additional_allocations[idx]
        for idx in range(reviewer_count)
    ]

    by_reviewer: dict[str, ReviewerSliceMetrics] = {}
    for idx, (reviewer, reviewed_prs) in enumerate(
        zip(selected_reviewers, review_allocations, strict=True)
    ):
        if reviewed_prs <= 0:
            continue

        reviews_count = reviewed_prs + ((idx + len(week_key)) % 4)
        if idx < guaranteed_active_reviewers:
            reviews_count = max(reviews_count, MIN_REVIEW_ACTIONS_PER_ACTIVE_REVIEWER)
        approval_rate = round(
            min(0.95, max(0.55, 0.62 + ((idx % 7) * 0.04))),
            3,
        )
        reviewer_authors = max(
            1,
            min(authors_count, int(reviewed_prs**SUBLINEAR_EXPONENT) + 1),
        )
        repositories_count = max(
            1,
            min(repo_count, int(reviewed_prs**SUBLINEAR_EXPONENT)),
        )
        if idx < MIN_MULTI_REPO_REVIEWERS and repo_count >= 2:
            repositories_count = max(repositories_count, 2)

        by_reviewer[str(reviewer.user_id)] = {
            "reviewed_prs": reviewed_prs,
            "reviews_count": reviews_count,
            "approval_rate": approval_rate,
            "authors_count": reviewer_authors,
            "repositories_count": repositories_count,
        }

    return by_reviewer


# =============================================================================
# Dimensions Generator (T012)
# =============================================================================


def generate_dimensions(
    organizations: list[SyntheticOrganization],
    projects: list[SyntheticProject],
    repositories: list[SyntheticRepository],
    users: list[SyntheticUser],
    teams: list[SyntheticTeam],
) -> dict[str, object]:
    """Generate dimensions.json with all entities."""
    # Calculate date range from weekly rollups (2021-W01 to 2025-W52)
    min_date = iso_week_to_dates(START_YEAR, START_WEEK)[0]
    max_date = iso_week_to_dates(END_YEAR, END_WEEK)[1]

    return {
        "date_range": {
            "min": min_date,
            "max": max_date,
        },
        "projects": [
            {
                "organization_name": p.organization_name,
                "project_name": p.project_name,
            }
            for p in projects
        ],
        "repositories": [
            {
                "organization_name": r.organization_name,
                "project_name": r.project_name,
                "repository_id": r.repository_id,
                "repository_name": r.repository_name,
            }
            for r in repositories
        ],
        "teams": [
            {
                "team_id": t.team_id,
                "team_name": t.team_name,
                "organization_name": t.organization_name,
                "project_name": t.project_name,
                "member_count": t.member_count,
            }
            for t in teams
        ],
        "users": [
            {
                "user_id": u.user_id,
                "display_name": u.display_name,
            }
            for u in users
        ],
        "authors": [
            {
                "author_id": str(u.user_id),
                "author_name": u.display_name,
            }
            for u in users
        ],
        "reviewers": [
            {
                "reviewer_id": str(u.user_id),
                "reviewer_name": u.display_name,
            }
            for u in users
        ],
    }


def _select_reviewer_fixture_metadata(
    rollups: list[WeeklyRollup], users: list[SyntheticUser]
) -> dict[str, object]:
    """Select deterministic reviewer walkthrough fixtures from generated rollups."""
    user_lookup = {str(user.user_id): user.display_name for user in users}
    ranked_candidates: list[
        tuple[int, int, int, str, WeeklyRollup, list[tuple[str, ReviewerSliceMetrics]]]
    ] = []

    for rollup in rollups:
        by_reviewer = rollup.by_reviewer or {}
        if not by_reviewer or not rollup.by_repository or not rollup.by_team:
            continue

        eligible_reviewers = [
            (reviewer_id, entry)
            for reviewer_id, entry in by_reviewer.items()
            if entry["reviewed_prs"] >= MIN_REVIEWED_PRS_PER_ACTIVE_REVIEWER
            and entry["reviews_count"] >= MIN_REVIEW_ACTIONS_PER_ACTIVE_REVIEWER
        ]
        multi_repo_reviewers = [
            (reviewer_id, entry)
            for reviewer_id, entry in eligible_reviewers
            if entry["repositories_count"] >= 2
        ]
        if len(eligible_reviewers) < MIN_ACTIVE_REVIEWERS:
            continue
        if len(multi_repo_reviewers) < MIN_MULTI_REPO_REVIEWERS:
            continue

        ranked_candidates.append(
            (
                len(eligible_reviewers),
                len(multi_repo_reviewers),
                rollup.pr_count,
                rollup.week,
                rollup,
                eligible_reviewers,
            )
        )

    if not ranked_candidates:
        raise RuntimeError(
            "Unable to derive canonical reviewer fixtures from generated rollups"
        )

    ranked_candidates.sort(
        key=lambda item: (-item[0], -item[1], -item[2], item[3]),
    )
    _, _, _, _, fixture_rollup, eligible_reviewers = ranked_candidates[0]

    eligible_reviewers.sort(
        key=lambda item: (
            -item[1]["reviewed_prs"],
            -item[1]["reviews_count"],
            -item[1]["repositories_count"],
            item[0],
        )
    )
    top_examples = eligible_reviewers[:REVIEWER_FILTER_EXAMPLE_COUNT]
    primary_reviewer_id, primary_reviewer = top_examples[0]

    top_repository_name = max(
        fixture_rollup.by_repository.items(),
        key=lambda item: (item[1]["pr_count"], item[0]),
    )[0]
    top_team_name = max(
        fixture_rollup.by_team.items(),
        key=lambda item: (item[1]["pr_count"], item[0]),
    )[0]

    return {
        "minimum_active_reviewers": MIN_ACTIVE_REVIEWERS,
        "minimum_reviewed_prs_per_reviewer": MIN_REVIEWED_PRS_PER_ACTIVE_REVIEWER,
        "minimum_review_actions_per_reviewer": MIN_REVIEW_ACTIONS_PER_ACTIVE_REVIEWER,
        "minimum_multi_repo_reviewers": MIN_MULTI_REPO_REVIEWERS,
        "reviewer_filter_examples": [
            {
                "week": fixture_rollup.week,
                "reviewer_id": reviewer_id,
                "reviewer_name": user_lookup[reviewer_id],
                "reviewed_prs": entry["reviewed_prs"],
                "reviews_count": entry["reviews_count"],
                "repositories_count": entry["repositories_count"],
            }
            for reviewer_id, entry in top_examples
        ],
        "reviewer_constrained_example": {
            "week": fixture_rollup.week,
            "reviewer_id": primary_reviewer_id,
            "reviewer_name": user_lookup[primary_reviewer_id],
            "repository_name": top_repository_name,
            "mode": "constrained",
            "reason": "reviewer_repository_mode=constrained",
        },
        "reviewer_team_disallowed_example": {
            "week": fixture_rollup.week,
            "reviewer_id": primary_reviewer_id,
            "reviewer_name": user_lookup[primary_reviewer_id],
            "team_name": top_team_name,
            "mode": "disallowed",
            "reason": "reviewer_team_mode=disallowed",
        },
    }


# =============================================================================
# Weekly Rollup Generator (T013-T015)
# =============================================================================


def iso_week_to_dates(year: int, week: int) -> tuple[date, date]:
    """Convert ISO year/week to Monday start and Sunday end dates."""
    # ISO week date: Year, Week, Weekday (1=Monday)
    jan4 = date(year, 1, 4)
    # Find the Monday of week 1
    week1_monday = jan4 - timedelta(days=jan4.isoweekday() - 1)
    # Calculate target Monday
    target_monday = week1_monday + timedelta(weeks=week - 1)
    target_sunday = target_monday + timedelta(days=6)
    return target_monday, target_sunday


def get_seasonal_adjustment(week_of_year: int) -> float:
    """
    Calculate seasonal adjustment factor for a given week.

    Model: sinusoidal with period=52 weeks, amplitude=±20%
    Phase shift aligns trough with week 52 (late December)
    Peaks around week 13 (Q1) and 39 (Q3)
    """
    # adjustment = 0.2 * sin(2π * (week_num - 13) / 52)
    return PR_COUNT_SEASONAL_AMPLITUDE * math.sin(
        2 * math.pi * (week_of_year - 13) / 52
    )


def generate_cycle_times(count: int, mu_factor: float = 1.0) -> list[float]:
    """Generate cycle times following log-normal distribution."""
    return [
        _log_normal(RNG, CYCLE_TIME_MU * mu_factor, CYCLE_TIME_SIGMA)
        for _ in range(count)
    ]


# Review time is typically 30-70% of cycle time (FR-012).
# Per-percentile null independence: ~10% null rate per percentile,
# independent coin flips (FR-010).
REVIEW_TIME_RATIO_LOW = 0.3
REVIEW_TIME_RATIO_HIGH = 0.7
REVIEW_TIME_NULL_RATE = 0.10


def _derive_review_time_pair(
    cycle_time_p50: float | None,
    cycle_time_p90: float | None,
    rt_rng: random.Random,
) -> tuple[float | None, float | None]:
    """Derive review time p50/p90 from cycle time using a single shared ratio.

    A single ratio is drawn and applied to both percentiles, guaranteeing
    that review_time_p50 <= review_time_p90 whenever cycle_time_p50 <= cycle_time_p90.

    Production gates both percentiles from the same sample count — they are
    always both-null or both-non-null.  Null injection (~10% rate) is coupled:
    one coin flip determines both.
    """
    ratio = rt_rng.uniform(REVIEW_TIME_RATIO_LOW, REVIEW_TIME_RATIO_HIGH)

    if cycle_time_p50 is None and cycle_time_p90 is None:
        return None, None

    # Coupled null injection: both null or both present
    if rt_rng.random() < REVIEW_TIME_NULL_RATE:
        return None, None

    rt_p50: float | None = (
        round(cycle_time_p50 * ratio, 3) if cycle_time_p50 is not None else None
    )
    rt_p90: float | None = (
        round(cycle_time_p90 * ratio, 3) if cycle_time_p90 is not None else None
    )

    return rt_p50, rt_p90


def adjusted_repo_weight(repo_name: str) -> float:
    """Apply a stronger power-law bias when allocating demo PRs to repos."""
    return float(REPO_WEIGHTS.get(repo_name, 0.1) ** REPO_WEIGHT_EXPONENT)


def calculate_percentile(values: list[float], percentile: float) -> float:
    """Calculate percentile from sorted list of values."""
    if not values:
        return 0.0
    sorted_values = sorted(values)
    idx = (len(sorted_values) - 1) * percentile / 100
    lower = int(idx)
    upper = min(lower + 1, len(sorted_values) - 1)
    weight = idx - lower
    return float(sorted_values[lower] * (1 - weight) + sorted_values[upper] * weight)


def generate_weekly_rollups(
    repositories: list[SyntheticRepository],
    teams: list[SyntheticTeam],
    users: list[SyntheticUser],
) -> list[WeeklyRollup]:
    """Generate 260 weekly rollups with seasonal variation."""
    rollups = []
    # Fresh review-time RNG per call for in-process determinism.
    # Isolated seed keeps the review-time stream independent of the main RNG.
    rt_rng = random.Random(SEED + _REVIEW_TIME_SEED_OFFSET)
    team_author_pools = build_team_author_pools(users, teams)

    for year in range(START_YEAR, END_YEAR + 1):
        # Handle partial years at start/end
        start_w = START_WEEK if year == START_YEAR else 1
        end_w = END_WEEK if year == END_YEAR else 52

        for week in range(start_w, end_w + 1):
            start_date, end_date = iso_week_to_dates(year, week)
            week_str = f"{year}-W{week:02d}"

            # Calculate PR count with seasonal adjustment and noise
            seasonal_adj = get_seasonal_adjustment(week)
            noise = (RNG.random() * 2 - 1) * PR_COUNT_NOISE_AMPLITUDE
            adjustment = 1 + seasonal_adj + noise

            # T016: Holiday suppression for week 52
            if week == 52:
                adjustment = HOLIDAY_SUPPRESSION_FACTOR

            # T015: YoY growth factor
            growth_factor = 1.0 + GROWTH_RATE_PER_YEAR * (year - START_YEAR)
            pr_count = max(1, int(BASE_PR_COUNT * growth_factor * adjustment))

            # Generate cycle times for this week
            cycle_times = generate_cycle_times(pr_count)
            p50: float | None = calculate_percentile(cycle_times, 50)
            p90: float | None = calculate_percentile(cycle_times, 90)

            # Derive review time from cycle time (single ratio, per-percentile null independence)
            rt_p50, rt_p90 = _derive_review_time_pair(p50, p90, rt_rng)

            # Authors and reviewers at root level
            authors_count = max(1, int(pr_count * AUTHOR_RATIO))
            reviewers_count = max(1, int(pr_count * REVIEWER_RATIO))

            repo_names = [r.repository_name for r in repositories]
            # Distribute PRs across teams using random weights
            by_team: dict[str, SliceMetrics] = {}
            raw_team_weights = [RNG.random() for _ in teams]
            if pr_count >= len(teams):
                residual_allocation = largest_remainder_allocate(
                    pr_count - len(teams),
                    raw_team_weights,
                )
                team_pr_allocation = [value + 1 for value in residual_allocation]
            else:
                team_pr_allocation = largest_remainder_allocate(
                    pr_count,
                    raw_team_weights,
                )
            team_pr_counts: dict[str, int] = {}

            for i, team in enumerate(teams):
                team_pr_count = team_pr_allocation[i]
                if team_pr_count <= 0:
                    continue
                team_pr_counts[team.team_name] = team_pr_count

                team_cycle_times = generate_cycle_times(team_pr_count)
                team_p50 = calculate_percentile(team_cycle_times, 50)
                team_p90 = calculate_percentile(team_cycle_times, 90)
                team_authors = max(
                    1, min(team.member_count, int(team_pr_count**SUBLINEAR_EXPONENT))
                )
                team_reviewers = max(
                    1,
                    min(team.member_count, int(team_pr_count**SUBLINEAR_EXPONENT) + 1),
                )

                team_rt_p50, team_rt_p90 = _derive_review_time_pair(
                    team_p50, team_p90, rt_rng
                )
                by_team[team.team_name] = {
                    "pr_count": team_pr_count,
                    "cycle_time_p50": team_p50,
                    "cycle_time_p90": team_p90,
                    "review_time_p50": team_rt_p50,
                    "review_time_p90": team_rt_p90,
                    "authors_count": team_authors,
                    "reviewers_count": team_reviewers,
                }

            # Generate exact team-repo intersections first, then derive
            # by_repository from those intersections so parent totals are
            # internally consistent with exact combined-filter cells.
            by_team_and_repo: dict[str, dict[str, SliceMetrics]] = {}
            by_author_and_repo: dict[str, dict[str, SliceMetrics]] = {}
            author_slices: dict[str, list[SliceMetrics]] = {}
            repo_pr_counts = dict.fromkeys(repo_names, 0)
            for team in teams:
                team_pr_count = team_pr_counts.get(team.team_name, 0)
                if team_pr_count <= 0:
                    continue

                primary_repos = TEAM_PRIMARY_REPOS.get(team.team_name, [])
                team_repo_entries: dict[str, SliceMetrics] = {}
                team_authors = int(by_team[team.team_name]["authors_count"])
                team_reviewers = int(by_team[team.team_name]["reviewers_count"])
                primary_weight_sum = sum(
                    adjusted_repo_weight(repo_name) for repo_name in primary_repos
                )
                other_repos = [
                    repo_name
                    for repo_name in repo_names
                    if repo_name not in primary_repos
                ]
                other_weight_sum = sum(
                    adjusted_repo_weight(repo_name) for repo_name in other_repos
                )
                row_weights: list[float] = []
                for repo_name in repo_names:
                    base_weight = adjusted_repo_weight(repo_name)
                    if repo_name in primary_repos and primary_weight_sum > 0:
                        row_weights.append(
                            TEAM_AFFINITY_PRIMARY_SHARE
                            * (base_weight / primary_weight_sum)
                        )
                    elif repo_name not in primary_repos and other_weight_sum > 0:
                        row_weights.append(
                            (1.0 - TEAM_AFFINITY_PRIMARY_SHARE)
                            * (base_weight / other_weight_sum)
                        )
                    else:
                        row_weights.append(base_weight)

                team_repo_allocations = largest_remainder_allocate(
                    team_pr_count,
                    row_weights,
                )

                # T017: Idle repo-weeks — zero out low-weight non-primary repos
                for idx, repo_name in enumerate(repo_names):
                    base_weight = REPO_WEIGHTS.get(repo_name, 0.1)
                    if (
                        repo_name not in primary_repos
                        and base_weight < IDLE_WEIGHT_THRESHOLD
                        and team_repo_allocations[idx] > 0
                        and RNG.random() > base_weight / IDLE_WEIGHT_THRESHOLD
                    ):
                        team_repo_allocations[idx] = 0

                zeroed = team_pr_count - sum(team_repo_allocations)
                if zeroed > 0:
                    max_idx = max(
                        range(len(repo_names)),
                        key=lambda idx: (row_weights[idx], -idx),
                    )
                    team_repo_allocations[max_idx] += zeroed

                for rname, r_prs in zip(repo_names, team_repo_allocations, strict=True):
                    if r_prs <= 0:
                        continue
                    repo_pr_counts[rname] += r_prs
                    r_authors = max(
                        1, min(team_authors, int(r_prs**SUBLINEAR_EXPONENT))
                    )
                    r_reviewers = max(
                        1, min(team_reviewers, int(r_prs**SUBLINEAR_EXPONENT) + 1)
                    )
                    r_mu_factor = REPO_CYCLE_TIME_CATEGORY.get(rname, 1.0)
                    r_cts = generate_cycle_times(r_prs, r_mu_factor)
                    r_p50 = calculate_percentile(r_cts, 50)
                    r_p90 = calculate_percentile(r_cts, 90)
                    tr_rt_p50, tr_rt_p90 = _derive_review_time_pair(
                        r_p50, r_p90, rt_rng
                    )
                    team_repo_entries[rname] = {
                        "pr_count": r_prs,
                        "cycle_time_p50": r_p50,
                        "cycle_time_p90": r_p90,
                        "review_time_p50": tr_rt_p50,
                        "review_time_p90": tr_rt_p90,
                        "authors_count": r_authors,
                        "reviewers_count": r_reviewers,
                    }

                if team_repo_entries:
                    by_team_and_repo[team.team_name] = team_repo_entries
                    team_pool = team_author_pools.get(team.team_name, users)
                    for repo_name, repo_entry in team_repo_entries.items():
                        _allocate_author_repo_entries(
                            week_key=week_str,
                            team_name=team.team_name,
                            repo_name=repo_name,
                            repo_entry=repo_entry,
                            team_entry=by_team[team.team_name],
                            team_pool=team_pool,
                            author_slices=author_slices,
                            by_author_and_repo=by_author_and_repo,
                            rt_rng=rt_rng,
                        )

            by_repository: dict[str, SliceMetrics] = {}
            for repo_name in repo_names:
                repo_pr_count = repo_pr_counts[repo_name]
                if repo_pr_count <= 0:
                    continue
                mu_factor = REPO_CYCLE_TIME_CATEGORY.get(repo_name, 1.0)
                repo_cycle_times = generate_cycle_times(repo_pr_count, mu_factor)
                repo_p50 = calculate_percentile(repo_cycle_times, 50)
                repo_p90 = calculate_percentile(repo_cycle_times, 90)
                repo_authors = max(
                    1, min(repo_pr_count, int(repo_pr_count**SUBLINEAR_EXPONENT))
                )
                repo_reviewers = max(
                    1, min(repo_pr_count, int(repo_pr_count**SUBLINEAR_EXPONENT) + 1)
                )
                repo_rt_p50, repo_rt_p90 = _derive_review_time_pair(
                    repo_p50, repo_p90, rt_rng
                )
                by_repository[repo_name] = {
                    "pr_count": repo_pr_count,
                    "cycle_time_p50": repo_p50,
                    "cycle_time_p90": repo_p90,
                    "review_time_p50": repo_rt_p50,
                    "review_time_p90": repo_rt_p90,
                    "authors_count": repo_authors,
                    "reviewers_count": repo_reviewers,
                }

            # T010: Contract 3 — null all percentiles when pr_count < 5.
            # Review time uses the SAME demo threshold as cycle time so no
            # slice exposes review_time while cycle_time is suppressed.
            if pr_count < 5:
                p50 = None
                p90 = None
                rt_p50 = None
                rt_p90 = None
            for entry in by_repository.values():
                if entry["pr_count"] < 5:
                    entry["cycle_time_p50"] = None
                    entry["cycle_time_p90"] = None
                    entry["review_time_p50"] = None
                    entry["review_time_p90"] = None
            for entry in by_team.values():
                if entry["pr_count"] < 5:
                    entry["cycle_time_p50"] = None
                    entry["cycle_time_p90"] = None
                    entry["review_time_p50"] = None
                    entry["review_time_p90"] = None
            for team_entries in by_team_and_repo.values():
                for entry in team_entries.values():
                    if entry["pr_count"] < 5:
                        entry["cycle_time_p50"] = None
                        entry["cycle_time_p90"] = None
                        entry["review_time_p50"] = None
                        entry["review_time_p90"] = None

            by_author = _collapse_author_slices(author_slices)
            by_reviewer = _generate_reviewer_breakdown(
                week_key=week_str,
                users=users,
                pr_count=pr_count,
                authors_count=authors_count,
                repo_count=len(by_repository),
            )

            rollups.append(
                WeeklyRollup(
                    week=week_str,
                    start_date=start_date,
                    end_date=end_date,
                    pr_count=pr_count,
                    cycle_time_p50=p50,
                    cycle_time_p90=p90,
                    review_time_p50=rt_p50,
                    review_time_p90=rt_p90,
                    authors_count=authors_count,
                    reviewers_count=reviewers_count,
                    by_repository=by_repository,
                    by_team=by_team,
                    by_author=by_author,
                    by_author_and_repo=by_author_and_repo,
                    by_reviewer=by_reviewer,
                    by_team_and_repo=by_team_and_repo if by_team_and_repo else None,
                )
            )

    return rollups


# =============================================================================
# Distribution Generator (T016-T017)
# =============================================================================


BUCKET_THRESHOLDS = [
    ("0-1h", 0, 60),
    ("1-4h", 60, 240),
    ("4-24h", 240, 1440),
    ("1-3d", 1440, 4320),
    ("3-7d", 4320, 10080),
    ("7d+", 10080, float("inf")),
]


def categorize_cycle_time(minutes: float) -> str:
    """Categorize cycle time into bucket."""
    for bucket_name, min_val, max_val in BUCKET_THRESHOLDS:
        if min_val <= minutes < max_val:
            return bucket_name
    return "7d+"


def generate_distributions(rollups: list[WeeklyRollup]) -> list[YearlyDistribution]:
    """Generate 5 yearly distributions from weekly rollups."""
    distributions = []

    for year in range(START_YEAR, END_YEAR + 1):
        year_str = str(year)

        # Filter rollups for this year
        year_rollups = [r for r in rollups if r.week.startswith(year_str)]

        if not year_rollups:
            continue

        # Calculate total PRs and monthly breakdown
        total_prs = sum(r.pr_count for r in year_rollups)

        # Monthly PR counts
        prs_by_month: dict[str, int] = {}
        for month in range(1, 13):
            month_key = f"{year}-{month:02d}"
            month_prs = 0
            for r in year_rollups:
                # Check if rollup falls in this month
                if r.start_date.month == month and r.start_date.year == year:
                    month_prs += r.pr_count
            prs_by_month[month_key] = month_prs

        # Generate cycle time buckets based on proportions
        # We generate synthetic cycle times and bucket them
        all_cycle_times = []
        for r in year_rollups:
            all_cycle_times.extend(generate_cycle_times(r.pr_count))

        # Count actual buckets from generated data
        bucket_counts: dict[str, int] = {name: 0 for name, _, _ in BUCKET_THRESHOLDS}
        for ct in all_cycle_times:
            bucket = categorize_cycle_time(ct)
            bucket_counts[bucket] += 1

        distributions.append(
            YearlyDistribution(
                year=year_str,
                start_date=date(year, 1, 1),
                end_date=date(year, 12, 31),
                total_prs=total_prs,
                cycle_time_buckets=bucket_counts,
                prs_by_month=prs_by_month,
            )
        )

    return distributions


def generate_comment_batches(
    output_dir: Path,
    users: list[SyntheticUser],
) -> CommentsCoverage:
    """Generate deterministic auxiliary comment batch files for demo coverage."""
    comments_dir = output_dir / "aggregates" / "comments"
    total_prs = 0
    total_threads = 0
    total_comments = 0

    for batch_num in range(1, DEMO_COMMENT_BATCH_COUNT + 1):
        prs: list[dict[str, object]] = []
        for pr_offset in range(DEMO_COMMENT_PRS_PER_BATCH):
            pr_id = (batch_num - 1) * DEMO_COMMENT_PRS_PER_BATCH + pr_offset + 1
            thread_id = f"thread-{pr_id}-1"
            comments = []
            for comment_idx in range(DEMO_COMMENT_COMMENTS_PER_PR):
                author = users[(pr_id + comment_idx) % len(users)]
                comments.append(
                    {
                        "comment_id": f"comment-{pr_id}-{comment_idx + 1}",
                        "author": author.display_name,
                        "author_id": author.user_id,
                        "content_length": 64 + ((pr_id + comment_idx) % 48),
                    }
                )
                total_comments += 1

            prs.append(
                {
                    "pr_id": pr_id,
                    "threads": [
                        {
                            "thread_id": thread_id,
                            "status": "active" if pr_id % 4 else "fixed",
                            "comments": comments,
                        }
                    ],
                }
            )
            total_prs += 1
            total_threads += 1

        write_json_file(
            comments_dir / f"comments-batch-{batch_num:04d}.json",
            {"prs": prs},
            max_retries=3,
        )

    return {
        "status": "partial",
        "capped": True,
        "threads_fetched": total_threads,
        "comments_fetched": total_comments,
        "prs_with_threads": total_prs,
    }


# =============================================================================
# Dataset Manifest Generator (T018)
# =============================================================================


def generate_manifest(
    rollups: list[WeeklyRollup],
    distributions: list[YearlyDistribution],
    output_dir: Path,
    comments_coverage: CommentsCoverage,
    users: list[SyntheticUser],
) -> dict[str, object]:
    """Generate dataset-manifest.json.

    Feature 310 serialization-layer gating (R-08): three manifest keys
    (``features.comments``, ``capabilities.comments_metrics``,
    ``coverage.comments``) are gated by ``_EMIT_COMMENTS_METRICS``.  When
    the flag is ``True`` (variant-on default), the manifest carries the
    pre-310 shape verbatim.  When ``False`` (variant-off), the first two
    keys are OMITTED entirely and ``coverage.comments`` is replaced by
    the sentinel string ``"disabled"``.  The byte-identity test strips
    these gated keys from both variants before comparison.
    """
    # Calculate date range
    min_date = rollups[0].start_date if rollups else date(START_YEAR, 1, 1)
    max_date = rollups[-1].end_date if rollups else date(END_YEAR, 12, 31)
    total_prs = sum(r.pr_count for r in rollups)
    reviewer_fixture_metadata = _select_reviewer_fixture_metadata(rollups, users)

    published_globs = [
        "aggregates/comments/comments-batch-*.json",
    ]

    features: dict[str, object] = {
        "teams": True,
        **discover_demo_feature_flags(output_dir),
    }
    capabilities: dict[str, object] = {
        "author_filters": True,
        "author_repo_exact": True,
        "reviewer_repository_mode": "constrained",
        "reviewer_team_mode": "disallowed",
        "cross_dimensional_available": True,
    }
    if _EMIT_COMMENTS_METRICS:
        features["comments"] = True
        capabilities["comments_metrics"] = True
        coverage_comments: object = comments_coverage
    else:
        coverage_comments = "disabled"

    return {
        "manifest_schema_version": 1,
        "dataset_schema_version": 1,
        "aggregates_schema_version": AGGREGATES_SCHEMA_VERSION,
        "predictions_schema_version": 1,
        "insights_schema_version": 1,
        "generated_at": FIXED_GENERATED_AT,
        "run_id": "demo-static",
        "demo_profile": {
            "name": DEMO_PROFILE_NAME,
            "version": DEMO_PROFILE_VERSION,
            "seed": SEED,
            "canonical_output_root": "artifacts/demo-enterprise",
        },
        "generation_provenance": build_generation_provenance(
            generator_script=GENERATOR_SCRIPT,
            generation_mode=GENERATION_MODE,
        ),
        "defaults": {
            "default_date_range_days": 90,
        },
        "limits": {
            "max_weekly_files": 260,
            "max_distribution_files": 5,
        },
        "features": features,
        "capabilities": capabilities,
        "reviewer_fixtures": reviewer_fixture_metadata,
        "coverage": {
            "total_prs": total_prs,
            "teams_count": 4,
            "date_range": {
                "min": min_date,
                "max": max_date,
            },
            "row_counts": {
                "users": NUM_USERS,
                "repositories": NUM_REPOS,
                "pull_requests": total_prs,
            },
            "comments": coverage_comments,
        },
        "aggregate_index": {
            "weekly_rollups": [
                {
                    "week": r.week,
                    "path": f"aggregates/weekly_rollups/{r.week}.json",
                    "pr_count": r.pr_count,
                }
                for r in rollups
            ],
            "distributions": [
                {
                    "year": d.year,
                    "path": f"aggregates/distributions/{d.year}.json",
                    "total_prs": d.total_prs,
                }
                for d in distributions
            ],
        },
        "published_files": {
            "direct": [
                "dataset-manifest.json",
                "aggregates/dimensions.json",
                "predictions/trends.json",
                "insights/summary.json",
            ],
            "globs": published_globs,
        },
    }


# =============================================================================
# Main Generation Pipeline
# =============================================================================


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(description="Generate deterministic demo data")
    parser.add_argument(
        "--output-root",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Output directory root for generated demo dataset",
    )
    parser.add_argument(
        "--comments-metrics",
        choices=("true", "false"),
        default="true",
        help=(
            "Feature 310 serialization-layer gate.  When 'true' (default),"
            " the manifest includes the three comments-metrics keys"
            " (features.comments, capabilities.comments_metrics,"
            " coverage.comments) and each prs[*] entry carries"
            " thread_count / comment_count / active_thread_count.  When"
            " 'false', the first two keys are omitted and"
            " coverage.comments is replaced by the sentinel string"
            " 'disabled', and the three per-PR fields are stripped."
            "  Generation-layer draws are identical in both modes (R-08"
            " byte-identity contract)."
        ),
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Generate all demo data files."""
    args = parse_args(argv)
    output_dir = args.output_root.resolve()
    # Feature 310: thread the serialization-layer flag into the module-
    # level ``_EMIT_COMMENTS_METRICS`` so downstream write sites (manifest
    # builder + prs serializer) can gate the gated keys without any
    # generation-layer branching.  The CLI choice is parsed as the
    # string literals "true" / "false" to keep the argparse value
    # verbatim in CI logs; convert to bool here.
    global _EMIT_COMMENTS_METRICS
    _EMIT_COMMENTS_METRICS = args.comments_metrics == "true"
    # FR-023 bypass closure: reject direct writes to `docs/data/`. The
    # public demo surface is managed exclusively by
    # `scripts/build-demo-dataset.py`, whose `promote_data` helper runs
    # the strip gate. Standalone invocations here MUST target a scratch
    # directory so they cannot sidestep the gate.
    if output_dir == _DOCS_DATA_DIR.resolve():
        raise SystemExit(
            "docs/data/ is managed by scripts/build-demo-dataset.py; use "
            "that script to publish. generate-demo-data.py writes its "
            "artifacts to a scratch directory for developer inspection; "
            "pass --output-root <other-path> to direct output elsewhere."
        )
    require_demo_generation_baseline_for_output(GENERATOR_SCRIPT, output_dir)
    print("Generating demo data with seed=42...")
    print(f"Output directory: {output_dir}")

    # Reset random state for consistent generation across repeated
    # in-process calls (test harnesses, orchestrators). The PR-record
    # stream (feature 309 #315) has its own offset so it must be reset
    # alongside the shared stream.  Feature 310 (#182) adds a third
    # isolated stream for the comments-metrics triplet — keeping it
    # separate preserves byte-stability of pre-310 pr_record_rng
    # consumption (INV-05 demo-profile determinism).
    global RNG, pr_record_rng, comments_metrics_rng
    RNG = init_random(SEED)
    pr_record_rng = random.Random(SEED + _PR_RECORD_SEED_OFFSET)
    comments_metrics_rng = random.Random(SEED + _COMMENTS_METRICS_SEED_OFFSET)
    # Feature 336 (T015): comment-stream RNG for the per-reviewer
    # synthesizer.  Independent of pr_record_rng / comments_metrics_rng
    # so synthesis cannot perturb existing serialized output (per
    # _COMMENT_STREAM_SEED_OFFSET rationale at module-load init).
    comment_stream_rng = random.Random(SEED + _COMMENT_STREAM_SEED_OFFSET)

    # Generate entities
    print("\n[1/6] Generating entities...")
    organizations = generate_organizations()
    print(f"  Organizations: {len(organizations)}")

    projects = generate_projects()
    print(f"  Projects: {len(projects)}")

    repositories = generate_repositories(projects)
    print(f"  Repositories: {len(repositories)}")

    users = generate_users()
    print(f"  Users: {len(users)}")

    teams = generate_teams(projects)
    print(f"  Teams: {len(teams)}")

    # Generate dimensions
    print("\n[2/6] Generating dimensions.json...")
    dimensions = generate_dimensions(
        organizations, projects, repositories, users, teams
    )
    dimensions_path = output_dir / "aggregates" / "dimensions.json"
    write_json_file(dimensions_path, dimensions, max_retries=3)
    print(f"  Written: {dimensions_path}")

    # Generate weekly rollups
    print("\n[3/6] Generating weekly rollups...")
    rollups = generate_weekly_rollups(repositories, teams, users)
    print(f"  Generated {len(rollups)} weekly rollups")

    rollups_dir = output_dir / "aggregates" / "weekly_rollups"
    truncation_config = _load_truncation_exercise_config()
    truncation_week = truncation_config["week"]
    target_qualified_count = truncation_config["target_qualified_pr_count"]
    contrast_weeks: set[str] = set(truncation_config["contrast_weeks"])
    contrast_max_count = truncation_config["contrast_max_pr_count"]

    # Feature 335: pre-build the repository_name -> repository_id (UUID) map
    # so the per-week by_repository_comments emission can resolve names to
    # canonical UUIDs.  The demo's existing by_repository keying uses names
    # (pre-existing design); the new by_repository_comments emission MUST
    # match production's UUID-keyed namespace per FR-1-03 +
    # contracts/per-repo-comments-density.md §1.  Build once outside the
    # per-week loop since the repository roster is stable across weeks.
    repository_name_to_id: dict[str, str] = {
        str(r.repository_name): str(r.repository_id) for r in repositories
    }

    # Feature 336 (T015 / CL-14): pre-build the per-reviewer synthesis
    # inputs once outside the per-week loop.  user_pool_for_reviewer is
    # the list of real user UUIDs the synthesizer samples from (the FK
    # target for pr_comments.author_id per models.py:172);
    # users_uuid_set is the O(1)-lookup form for the aggregator's
    # sentinel-resolution branch (commenter in users → user_id bucket
    # key, else FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL per CL-03 /
    # INV-4-12); ghost_pool_for_reviewer is the deterministic synthetic
    # UUID set ABSENT from users (per CL-14 step 4 — ≥1 ghost commenter
    # MUST appear in the emitted stream so the per-reviewer sentinel
    # reconciliation branch is exercised non-vacuously).
    user_pool_for_reviewer: list[str] = sorted(str(u.user_id) for u in users)
    users_uuid_set_for_reviewer: set[str] = set(user_pool_for_reviewer)
    ghost_pool_for_reviewer: list[str] = sorted(
        str(generate_uuid(f"ghost/{idx:03d}")) for idx in range(1, _GHOST_POOL_SIZE + 1)
    )
    # Defensive: ghost UUIDs MUST be disjoint from user UUIDs (otherwise
    # the per-reviewer sentinel branch would never fire for "ghost"
    # commenters because the LEFT JOIN to users would match them as
    # real users).  generate_uuid is deterministic UUIDv5 with a fixed
    # namespace; collision would mean the demo's user-name-derived UUID
    # set + the ghost-key-derived UUID set share an input that hashed
    # to the same UUID — astronomically unlikely but worth guarding.
    _ghost_user_collision = set(ghost_pool_for_reviewer) & users_uuid_set_for_reviewer
    if _ghost_user_collision:
        raise RuntimeError(
            "Feature 336 ghost-pool collision: ghost UUIDs overlap with "
            f"users ({sorted(_ghost_user_collision)!r}).  generate_uuid is "
            "deterministic; this means the demo's user-name and ghost-name "
            "spaces share at least one collision-producing key.  Either "
            "the user roster grew to include a name like 'ghost/001' OR "
            "the UUID v5 namespace was changed."
        )

    for rollup in rollups:
        rollup_data: dict[str, object] = {
            "week": rollup.week,
            "start_date": rollup.start_date,
            "end_date": rollup.end_date,
            "pr_count": rollup.pr_count,
            "cycle_time_p50": rollup.cycle_time_p50,
            "cycle_time_p90": rollup.cycle_time_p90,
            "review_time_p50": rollup.review_time_p50,
            "review_time_p90": rollup.review_time_p90,
            "authors_count": rollup.authors_count,
            "reviewers_count": rollup.reviewers_count,
            "by_repository": rollup.by_repository,
            "by_team": rollup.by_team,
            "by_author": rollup.by_author,
            "by_author_and_repo": rollup.by_author_and_repo,
            "by_reviewer": rollup.by_reviewer,
            "by_team_and_repo": rollup.by_team_and_repo,
        }

        # Feature 309 #315: append synthetic PR-level detail as the LAST three
        # keys, matching the aggregator's insertion order at aggregators.py:832.
        # On the truncation-exercise week and the contrast weeks we also
        # overwrite `rollup_data["pr_count"]` so the top-level count, the
        # emitted `prs` array length, and the UI badge gate
        # (`renderedCount < actualFilteredCount` at
        # extension/ui/modules/shared/detail-panel.ts:456) stay coherent.
        # Non-override weeks keep the natural `rollup.pr_count` already set
        # in the dict literal above.
        if rollup.week == truncation_week:
            qualified_count = target_qualified_count
            rollup_data["pr_count"] = qualified_count
        elif rollup.week in contrast_weeks:
            qualified_count = min(int(rollup.pr_count), contrast_max_count)
            rollup_data["pr_count"] = qualified_count
        else:
            qualified_count = int(rollup.pr_count)

        if qualified_count > 0 and rollup.by_repository:
            repo_pool = list(rollup.by_repository.keys())
            repo_weights = [
                max(int(rollup.by_repository[r].get("pr_count", 1) or 1), 1)
                for r in repo_pool
            ]
            repo_entries: list[object] = list(
                pr_record_rng.choices(
                    repo_pool, weights=repo_weights, k=qualified_count
                )
            )
            author_entries: list[object] = (
                list(rollup.by_author.keys())
                if rollup.by_author
                else [f"fallback-author-{rollup.week}"]
            )
            # Feature 334 INV-2-10: the per-author comments-density aggregate
            # MUST sum over W's FULL extracted-subset, not the 500-row
            # drill-down slice (production aggregator's
            # ``_compute_weekly_by_author_comments`` is keyed on
            # ``week_pr_uids`` which holds the entire week's PR set).
            # To match that semantics in the synthetic demo without
            # advancing the RNG streams differently from the legacy
            # drill-down generation, snapshot both streams, generate the
            # full uncapped set for the per-author aggregate, restore the
            # streams, then generate the capped set as before.  After
            # this block both RNG states are exactly where they would
            # have been after a single ``generate_pr_records`` call —
            # downstream weeks see byte-identical input.
            pr_record_rng_state = pr_record_rng.getstate()
            comments_metrics_rng_state = comments_metrics_rng.getstate()
            synthetic_prs_full = generate_pr_records(
                rollup.week,
                repo_entries,
                author_entries,
                pr_record_rng,
                comments_metrics_rng=comments_metrics_rng,
                cap=len(repo_entries),
            )
            pr_record_rng.setstate(pr_record_rng_state)
            comments_metrics_rng.setstate(comments_metrics_rng_state)
            synthetic_prs = generate_pr_records(
                rollup.week, repo_entries, author_entries, pr_record_rng
            )
            prs_truncated = qualified_count > _PR_DETAIL_CAP
            # Feature 310 serialization-layer gate (R-08): strip the
            # three comments-metrics fields from every emitted PR when
            # ``_EMIT_COMMENTS_METRICS`` is False.  Generation always
            # produced all 8 fields above; this step simply decides
            # which 5-vs-8 shape reaches disk.  Both variants share the
            # exact same pre-strip synthesis, so all non-gated bytes
            # (id / title / author_id / repository_id / cycle_time)
            # stay byte-identical across runs.
            if _EMIT_COMMENTS_METRICS:
                rollup_data["prs"] = synthetic_prs
                # Feature 333 (FR-2-06) + Feature 334 (FR-1-01..08, INV-2-10):
                # both rollup-root comments aggregates MUST span W's FULL
                # extracted-subset, NOT the 500-row drill-down slice.
                # Production aggregators.py::_compute_weekly_comments_aggregate
                # and _compute_weekly_by_author_comments are both keyed on
                # week_pr_uids (the full week's PR set) — emitting them
                # from the capped synthetic_prs would diverge from
                # production on truncated weeks (qualified_count >
                # _PR_DETAIL_CAP=500) AND inconsistently between the two
                # rollup-root keys.  Aggregating both from
                # synthetic_prs_full keeps the demo aligned with production
                # and internally consistent (the per-week comments total
                # equals the sum across by_author_comments buckets on every
                # week, including W26 with 520 PRs).
                rollup_data["comments"] = _aggregate_comments_for_week(
                    synthetic_prs_full
                )
                # Feature 334 per-author bucketing.  Mirrors production
                # ``_compute_weekly_by_author_comments``; omits the key
                # when no buckets exist per FR-3-03 / INV-2-09.
                weekly_by_author_comments = _aggregate_by_author_comments_for_week(
                    synthetic_prs_full
                )
                if weekly_by_author_comments:
                    rollup_data["by_author_comments"] = weekly_by_author_comments
                # Feature 335 per-repo bucketing.  Mirrors production
                # ``_compute_weekly_by_repository_comments``; emits over
                # the FULL extracted-subset (synthetic_prs_full, NOT the
                # 500-row drill-down slice) per INV-3-10 — same scope
                # choice 333 ``comments`` and 334 ``by_author_comments``
                # use, so cross-aggregate sum-coherence (FR-2-03) holds
                # on every week.  Omits the key when no buckets exist
                # per FR-3-03 / INV-3-09 / FR-1-10.
                # Pass repository_name_to_id so the helper can resolve
                # the demo's name-keyed PrRecord["repository_id"] field
                # back to canonical UUIDs — keeps by_repository_comments
                # in production's namespace (FR-1-03) without disturbing
                # the demo's broader name-keyed by_repository emission.
                weekly_by_repository_comments = (
                    _aggregate_by_repository_comments_for_week(
                        synthetic_prs_full, repository_name_to_id
                    )
                )
                if weekly_by_repository_comments:
                    rollup_data["by_repository_comments"] = (
                        weekly_by_repository_comments
                    )
                # Feature 336 per-reviewer bucketing.  Mirrors production
                # ``aggregators.py::_compute_weekly_by_reviewer_comments``;
                # iterates the SYNTHETIC pr_comments stream (CL-13 /
                # INV-4-13 — the per-reviewer dimension's iteration unit
                # is pr_comments rows, NOT pull_requests).  Same FULL-
                # extracted-subset scope as 333 / 334 / 335 (uses
                # ``synthetic_prs_full``, NOT capped ``synthetic_prs``)
                # per INV-4-10.  Sentinel applies for ghost commenters
                # (CL-03 / INV-4-12) — divergence from 335 which is
                # FK-protected.  Self-comment exclusion enforced at
                # synthesis time per CL-04.  Emits the
                # ``by_reviewer_comments`` key when at least one
                # eligible non-self comment row exists; omits the key
                # entirely otherwise per FR-3-03 / FR-1-11.
                synthetic_pr_threads, synthetic_pr_comments = (
                    synthesize_pr_comment_streams_for_week(
                        synthetic_prs_full,
                        user_pool_for_reviewer,
                        ghost_pool_for_reviewer,
                        comment_stream_rng,
                    )
                )
                weekly_by_reviewer_comments = _aggregate_by_reviewer_comments_for_week(
                    synthetic_prs_full,
                    synthetic_pr_threads,
                    synthetic_pr_comments,
                    users_uuid_set_for_reviewer,
                )
                if weekly_by_reviewer_comments:
                    rollup_data["by_reviewer_comments"] = weekly_by_reviewer_comments
            else:
                rollup_data["prs"] = [
                    _strip_comments_metrics_from_pr(pr) for pr in synthetic_prs
                ]
                # Capability-off: the `comments` key is absent entirely
                # (FR-3-03 + INV-1-08 atomicity).  No null, no {}, no
                # partial-fielded shape — gated at the byte-identity test
                # at tests/integration/test_demo_variants_byte_identity.py.
            rollup_data["_prs_truncated"] = prs_truncated
            rollup_data["_prs_cap"] = _PR_DETAIL_CAP
        else:
            rollup_data["prs"] = []
            if _EMIT_COMMENTS_METRICS:
                # Empty-week capability-on: emit zeros with coverage_partial
                # False (no PRs to be missing extraction for).  All four
                # fields present together per INV-1-08 atomicity.
                rollup_data["comments"] = {
                    "thread_count": 0,
                    "comment_count": 0,
                    "active_thread_count": 0,
                    "coverage_partial": False,
                }
            rollup_data["_prs_truncated"] = False
            rollup_data["_prs_cap"] = _PR_DETAIL_CAP

        write_json_file(
            rollups_dir / f"{rollup.week}.json",
            rollup_data,
            max_retries=3,
        )
    print(f"  Written: {len(rollups)} files to {rollups_dir}")

    # Generate distributions
    print("\n[4/6] Generating yearly distributions...")
    distributions = generate_distributions(rollups)
    print(f"  Generated {len(distributions)} distributions")

    distributions_dir = output_dir / "aggregates" / "distributions"
    for dist in distributions:
        dist_data = {
            "year": dist.year,
            "start_date": dist.start_date,
            "end_date": dist.end_date,
            "total_prs": dist.total_prs,
            "cycle_time_buckets": dist.cycle_time_buckets,
            "prs_by_month": dist.prs_by_month,
        }
        write_json_file(
            distributions_dir / f"{dist.year}.json",
            dist_data,
            max_retries=3,
        )
    print(f"  Written: {len(distributions)} files to {distributions_dir}")

    # Generate auxiliary comments
    print("\n[5/6] Generating auxiliary comments...")
    comments_coverage = generate_comment_batches(output_dir, users)
    print(
        "  Written: "
        f"{DEMO_COMMENT_BATCH_COUNT} files to "
        f"{output_dir / 'aggregates' / 'comments'}"
    )

    # Generate manifest
    print("\n[6/6] Generating dataset-manifest.json...")
    manifest = generate_manifest(
        rollups,
        distributions,
        output_dir,
        comments_coverage,
        users,
    )
    manifest_path = output_dir / "dataset-manifest.json"
    write_json_file(manifest_path, manifest, max_retries=3)
    print(f"  Written: {manifest_path}")

    # Summary
    print("\n[6/6] Generation complete!")
    print(f"  Total files: {len(rollups) + len(distributions) + 2}")
    print(f"  Weekly rollups: {len(rollups)}")
    print(f"  Distributions: {len(distributions)}")
    print(f"  Total PRs: {sum(r.pr_count for r in rollups)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
