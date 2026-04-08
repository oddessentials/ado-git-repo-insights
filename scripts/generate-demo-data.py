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
import importlib.util
import math
import random
import sys
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ado_git_repo_insights.types import (
        CommentsCoverage,
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

DEFAULT_OUTPUT_DIR = Path(__file__).parent.parent / "docs" / "data"
DEMO_PROFILE_NAME = "enterprise-demo"
DEMO_PROFILE_VERSION = "2.0.0"
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
    """Generate dataset-manifest.json."""
    # Calculate date range
    min_date = rollups[0].start_date if rollups else date(START_YEAR, 1, 1)
    max_date = rollups[-1].end_date if rollups else date(END_YEAR, 12, 31)
    total_prs = sum(r.pr_count for r in rollups)
    reviewer_fixture_metadata = _select_reviewer_fixture_metadata(rollups, users)

    published_globs = [
        "aggregates/comments/comments-batch-*.json",
    ]

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
        "features": {
            "teams": True,
            "comments": True,
            **discover_demo_feature_flags(output_dir),
        },
        "capabilities": {
            "author_filters": True,
            "author_repo_exact": True,
            "comments_metrics": True,
            "reviewer_repository_mode": "constrained",
            "reviewer_team_mode": "disallowed",
            "cross_dimensional_available": True,
        },
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
            "comments": comments_coverage,
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
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Generate all demo data files."""
    args = parse_args(argv)
    output_dir = args.output_root.resolve()
    require_demo_generation_baseline_for_output(GENERATOR_SCRIPT, output_dir)
    print("Generating demo data with seed=42...")
    print(f"Output directory: {output_dir}")

    # Reset random state for consistent generation across repeated
    # in-process calls (test harnesses, orchestrators).
    global RNG
    RNG = init_random(SEED)

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
    for rollup in rollups:
        rollup_data = {
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
