#!/usr/bin/env python3
"""
Generate deterministic synthetic data for GitHub Pages demo dashboard.

This script produces byte-identical output on every run using:
- Fixed random seed (42)
- UUID v5 with DNS namespace for all entity IDs
- Canonical JSON formatting (sorted keys, 3-decimal floats, UTC timestamps, LF newlines)

Output: docs/data/ directory with all demo data files

Usage:
    python scripts/generate-demo-data.py

Requirements:
    Python 3.11+ (pinned for cross-platform reproducibility)
"""

from __future__ import annotations

import json
import math
import random
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

# Add src to path for schema version import
_src_path = Path(__file__).resolve().parent.parent / "src"
if str(_src_path) not in sys.path:
    sys.path.insert(0, str(_src_path))

from ado_git_repo_insights.transform.aggregators import AGGREGATES_SCHEMA_VERSION  # noqa: E402, I001

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

# Entity counts (per data-model.md)
NUM_ORGS = 3
NUM_PROJECTS = 8
NUM_REPOS = 23
NUM_USERS = 50
NUM_TEAMS = 4
NUM_WEEKS = 260
GROWTH_RATE_PER_YEAR = 0.12
HOLIDAY_SUPPRESSION_FACTOR = 0.35

# Weekly PR metrics baseline — 80 PRs/week for a 50-person org with 23 repos
BASE_PR_COUNT = 80
PR_COUNT_SEASONAL_AMPLITUDE = 0.2  # ±20%
PR_COUNT_NOISE_AMPLITUDE = 0.1  # ±10%

# Cycle time distribution parameters (log-normal)
CYCLE_TIME_MU = 6.0  # log-minutes
CYCLE_TIME_SIGMA = 1.5

# Output directory
OUTPUT_DIR = Path(__file__).parent.parent / "docs" / "data"

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


# =============================================================================
# Canonical JSON Utilities (T005)
# =============================================================================


def round_float(value: float, decimals: int = 3) -> float:
    """Round float to specified decimal places using HALF_UP rounding."""
    d = Decimal(str(value)).quantize(Decimal(10) ** -decimals, rounding=ROUND_HALF_UP)
    return float(d)


def canonical_json(data: Any, indent: int = 2) -> str:
    """
    Generate canonical JSON with:
    - Sorted keys
    - 3-decimal floats
    - LF newlines only
    - Trailing newline
    """

    def default_serializer(obj: Any) -> Any:
        if isinstance(obj, datetime):
            return obj.strftime("%Y-%m-%dT%H:%M:%SZ")
        if isinstance(obj, date):
            return obj.isoformat()
        if isinstance(obj, uuid.UUID):
            return str(obj)
        raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")

    # Pre-process floats to 3 decimal places
    def process_floats(obj: Any) -> Any:
        if isinstance(obj, float):
            return round_float(obj)
        if isinstance(obj, dict):
            return {k: process_floats(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [process_floats(item) for item in obj]
        return obj

    processed = process_floats(data)
    json_str = json.dumps(
        processed,
        indent=indent,
        sort_keys=True,
        default=default_serializer,
        ensure_ascii=False,
    )
    # Ensure LF newlines and trailing newline
    return json_str.replace("\r\n", "\n") + "\n"


def write_json(path: Path, data: Any, *, _max_retries: int = 3) -> None:
    """Write data to JSON file with canonical formatting.

    Retries on transient OS errors (e.g. Windows file locking from antivirus).
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    content = canonical_json(data)
    encoded = content.encode("utf-8")
    for attempt in range(_max_retries):
        try:
            path.write_bytes(encoded)
            return
        except OSError:
            if attempt < _max_retries - 1:
                time.sleep(0.1 * (attempt + 1))
            else:
                raise


# =============================================================================
# Deterministic Random Utilities (T006)
# =============================================================================


def init_random(seed: int = SEED) -> random.Random:
    """Initialize deterministic random generator with fixed seed."""
    rng = random.Random(seed)  # noqa: S311 - Intentional for deterministic synthetic data
    return rng


# Global random generator (initialized at module load)
RNG = init_random(SEED)


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


def _largest_remainder_allocate(total: int, weights: list[float]) -> list[int]:
    """Distribute *total* across buckets proportional to *weights*.
    Uses the largest-remainder method so sum(result) == total exactly.
    Callers pre-normalize weights. Empty/all-zero weights are handled.
    """
    assert total >= 0, f"total must be non-negative, got {total}"
    if not weights:
        return []
    weight_sum = sum(weights)
    if weight_sum == 0:
        # Round-robin: distribute evenly, remainder to first buckets
        base = total // len(weights)
        remainder = total % len(weights)
        return [base + (1 if i < remainder else 0) for i in range(len(weights))]
    normalized = [w / weight_sum for w in weights]
    raw = [total * w for w in normalized]
    floors = [int(r // 1) for r in raw]
    remainder = total - sum(floors)
    fracs = [(raw[k] - floors[k], k) for k in range(len(weights))]
    fracs.sort(key=lambda x: x[0], reverse=True)
    for idx in range(remainder):
        floors[fracs[idx][1]] += 1
    return floors


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
    authors_count: int
    reviewers_count: int
    by_repository: dict[str, dict[str, Any]]
    by_team: dict[str, dict[str, Any]]
    by_team_and_repo: dict[str, dict[str, Any]] | None = None


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
        member_count = 5 + int(RNG.random() * 11)
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
    """Generate 50 synthetic users with realistic names."""
    users = []
    for i in range(NUM_USERS):
        first_name = FIRST_NAMES[i % len(FIRST_NAMES)]
        last_name = LAST_NAMES[i % len(LAST_NAMES)]
        display_name = f"{first_name} {last_name}"
        # UUID generated as: uuid5(DNS_NAMESPACE, f"user/{display_name}")
        user_id = generate_uuid(f"user/{display_name}")
        users.append(SyntheticUser(user_id=user_id, display_name=display_name))
    return users


# =============================================================================
# Dimensions Generator (T012)
# =============================================================================


def generate_dimensions(
    organizations: list[SyntheticOrganization],
    projects: list[SyntheticProject],
    repositories: list[SyntheticRepository],
    users: list[SyntheticUser],
    teams: list[SyntheticTeam],
) -> dict[str, Any]:
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


def calculate_percentile(values: list[float], percentile: float) -> float:
    """Calculate percentile from sorted list of values."""
    if not values:
        return 0.0
    sorted_values = sorted(values)
    idx = (len(sorted_values) - 1) * percentile / 100
    lower = int(idx)
    upper = min(lower + 1, len(sorted_values) - 1)
    weight = idx - lower
    return sorted_values[lower] * (1 - weight) + sorted_values[upper] * weight


def generate_weekly_rollups(
    repositories: list[SyntheticRepository],
    teams: list[SyntheticTeam],
) -> list[WeeklyRollup]:
    """Generate 260 weekly rollups with seasonal variation."""
    rollups = []

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
            p50 = calculate_percentile(cycle_times, 50)
            p90 = calculate_percentile(cycle_times, 90)

            # Authors and reviewers at root level
            authors_count = max(1, int(pr_count * AUTHOR_RATIO))
            reviewers_count = max(1, int(pr_count * REVIEWER_RATIO))

            # Distribute PRs across repositories using power-law weights
            repo_names = [r.repository_name for r in repositories]
            repo_weights_list = [REPO_WEIGHTS.get(name, 0.1) for name in repo_names]
            repo_pr_allocation = _largest_remainder_allocate(
                pr_count, repo_weights_list
            )

            # T017: Idle repo-weeks — zero out low-weight repos
            for idx, name in enumerate(repo_names):
                w = REPO_WEIGHTS.get(name, 0.1)
                if w < IDLE_WEIGHT_THRESHOLD and repo_pr_allocation[idx] > 0:
                    if RNG.random() > w / IDLE_WEIGHT_THRESHOLD:
                        repo_pr_allocation[idx] = 0

            # Redistribute zeroed PRs to highest-weight repo
            zeroed = pr_count - sum(repo_pr_allocation)
            if zeroed > 0:
                max_idx = repo_weights_list.index(max(repo_weights_list))
                repo_pr_allocation[max_idx] += zeroed

            by_repository: dict[str, dict[str, Any]] = {}
            for i, repo in enumerate(repositories):
                repo_pr_count = repo_pr_allocation[i]
                if repo_pr_count <= 0:
                    continue
                mu_factor = REPO_CYCLE_TIME_CATEGORY.get(repo.repository_name, 1.0)
                repo_cycle_times = generate_cycle_times(repo_pr_count, mu_factor)
                repo_p50 = calculate_percentile(repo_cycle_times, 50)
                repo_p90 = calculate_percentile(repo_cycle_times, 90)
                repo_authors = max(
                    1, min(repo_pr_count, int(repo_pr_count**SUBLINEAR_EXPONENT))
                )
                repo_reviewers = max(
                    1, min(repo_pr_count, int(repo_pr_count**SUBLINEAR_EXPONENT) + 1)
                )
                by_repository[repo.repository_name] = {
                    "pr_count": repo_pr_count,
                    "cycle_time_p50": repo_p50,
                    "cycle_time_p90": repo_p90,
                    "authors_count": repo_authors,
                    "reviewers_count": repo_reviewers,
                }

            # Distribute PRs across teams using random weights
            by_team: dict[str, dict[str, Any]] = {}
            by_team_and_repo: dict[str, dict[str, Any]] = {}
            raw_team_weights = [RNG.random() for _ in teams]
            team_pr_allocation = _largest_remainder_allocate(pr_count, raw_team_weights)

            for i, team in enumerate(teams):
                team_pr_count = team_pr_allocation[i]
                if team_pr_count <= 0:
                    continue

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

                by_team[team.team_name] = {
                    "pr_count": team_pr_count,
                    "cycle_time_p50": team_p50,
                    "cycle_time_p90": team_p90,
                    "authors_count": team_authors,
                    "reviewers_count": team_reviewers,
                }

                # Generate by_team_and_repo using affinity-weighted allocation
                primary_repos = TEAM_PRIMARY_REPOS.get(team.team_name, [])
                primary_pr_count = int(team_pr_count * TEAM_AFFINITY_PRIMARY_SHARE)
                other_pr_count = team_pr_count - primary_pr_count

                # Allocate primary repo PRs
                primary_weights = [REPO_WEIGHTS.get(r, 0.1) for r in primary_repos]
                primary_alloc = (
                    _largest_remainder_allocate(primary_pr_count, primary_weights)
                    if primary_repos
                    else []
                )

                # Allocate other repo PRs across all repos weighted by REPO_WEIGHTS
                other_repos = [r for r in repo_names if r not in primary_repos]
                other_weights = [REPO_WEIGHTS.get(r, 0.1) for r in other_repos]
                other_alloc = (
                    _largest_remainder_allocate(other_pr_count, other_weights)
                    if other_repos
                    else []
                )

                # Build team-repo entries
                team_repo_entries: dict[str, dict[str, Any]] = {}
                for j, rname in enumerate(primary_repos):
                    r_prs = primary_alloc[j] if j < len(primary_alloc) else 0
                    if r_prs <= 0:
                        continue
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
                    team_repo_entries[rname] = {
                        "pr_count": r_prs,
                        "cycle_time_p50": r_p50,
                        "cycle_time_p90": r_p90,
                        "authors_count": r_authors,
                        "reviewers_count": r_reviewers,
                    }
                for j, rname in enumerate(other_repos):
                    r_prs = other_alloc[j] if j < len(other_alloc) else 0
                    if r_prs <= 0:
                        continue
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
                    team_repo_entries[rname] = {
                        "pr_count": r_prs,
                        "cycle_time_p50": r_p50,
                        "cycle_time_p90": r_p90,
                        "authors_count": r_authors,
                        "reviewers_count": r_reviewers,
                    }

                if team_repo_entries:
                    by_team_and_repo[team.team_name] = team_repo_entries

            # T010: Contract 3 cycle time threshold — null if pr_count < 5
            if pr_count < 5:
                p50 = None
                p90 = None
            for entry in by_repository.values():
                if entry["pr_count"] < 5:
                    entry["cycle_time_p50"] = None
                    entry["cycle_time_p90"] = None
            for entry in by_team.values():
                if entry["pr_count"] < 5:
                    entry["cycle_time_p50"] = None
                    entry["cycle_time_p90"] = None
            for team_entries in by_team_and_repo.values():
                for entry in team_entries.values():
                    if entry["pr_count"] < 5:
                        entry["cycle_time_p50"] = None
                        entry["cycle_time_p90"] = None

            rollups.append(
                WeeklyRollup(
                    week=week_str,
                    start_date=start_date,
                    end_date=end_date,
                    pr_count=pr_count,
                    cycle_time_p50=p50,
                    cycle_time_p90=p90,
                    authors_count=authors_count,
                    reviewers_count=reviewers_count,
                    by_repository=by_repository,
                    by_team=by_team,
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


# =============================================================================
# Dataset Manifest Generator (T018)
# =============================================================================


def generate_manifest(
    rollups: list[WeeklyRollup],
    distributions: list[YearlyDistribution],
) -> dict[str, Any]:
    """Generate dataset-manifest.json."""
    # Calculate date range
    min_date = rollups[0].start_date if rollups else date(START_YEAR, 1, 1)
    max_date = rollups[-1].end_date if rollups else date(END_YEAR, 12, 31)
    total_prs = sum(r.pr_count for r in rollups)

    # Use fixed timestamp for determinism
    generated_at = datetime(2026, 1, 30, 12, 0, 0, tzinfo=timezone.utc)

    return {
        "manifest_schema_version": 1,
        "dataset_schema_version": 1,
        "aggregates_schema_version": AGGREGATES_SCHEMA_VERSION,
        "predictions_schema_version": 1,
        "insights_schema_version": 1,
        "generated_at": generated_at,
        "run_id": "demo-static",
        "defaults": {
            "default_date_range_days": 90,
        },
        "limits": {
            "max_weekly_files": 260,
            "max_distribution_files": 5,
        },
        "features": {
            "teams": True,
            "comments": False,
            # predictions and ai_insights are set to False until Phase 5-6 implementation
            # These will be enabled by generate-demo-predictions.py and generate-demo-insights.py
            "predictions": False,
            "ai_insights": False,
            "cross_dimensional": True,
        },
        "coverage": {
            "total_prs": total_prs,
            "teams_count": 4,
            "date_range": {
                "min": min_date,
                "max": max_date,
            },
            "comments": "disabled",
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
    }


# =============================================================================
# Main Generation Pipeline
# =============================================================================


def main() -> int:
    """Generate all demo data files."""
    print("Generating demo data with seed=42...")
    print(f"Output directory: {OUTPUT_DIR}")

    # Reset random state for consistent generation
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
    dimensions_path = OUTPUT_DIR / "aggregates" / "dimensions.json"
    write_json(dimensions_path, dimensions)
    print(f"  Written: {dimensions_path}")

    # Generate weekly rollups
    print("\n[3/6] Generating weekly rollups...")
    rollups = generate_weekly_rollups(repositories, teams)
    print(f"  Generated {len(rollups)} weekly rollups")

    rollups_dir = OUTPUT_DIR / "aggregates" / "weekly_rollups"
    for rollup in rollups:
        rollup_data = {
            "week": rollup.week,
            "start_date": rollup.start_date,
            "end_date": rollup.end_date,
            "pr_count": rollup.pr_count,
            "cycle_time_p50": rollup.cycle_time_p50,
            "cycle_time_p90": rollup.cycle_time_p90,
            "authors_count": rollup.authors_count,
            "reviewers_count": rollup.reviewers_count,
            "by_repository": rollup.by_repository,
            "by_team": rollup.by_team,
            "by_team_and_repo": rollup.by_team_and_repo,
        }
        write_json(rollups_dir / f"{rollup.week}.json", rollup_data)
    print(f"  Written: {len(rollups)} files to {rollups_dir}")

    # Generate distributions
    print("\n[4/6] Generating yearly distributions...")
    distributions = generate_distributions(rollups)
    print(f"  Generated {len(distributions)} distributions")

    distributions_dir = OUTPUT_DIR / "aggregates" / "distributions"
    for dist in distributions:
        dist_data = {
            "year": dist.year,
            "start_date": dist.start_date,
            "end_date": dist.end_date,
            "total_prs": dist.total_prs,
            "cycle_time_buckets": dist.cycle_time_buckets,
            "prs_by_month": dist.prs_by_month,
        }
        write_json(distributions_dir / f"{dist.year}.json", dist_data)
    print(f"  Written: {len(distributions)} files to {distributions_dir}")

    # Generate manifest
    print("\n[5/6] Generating dataset-manifest.json...")
    manifest = generate_manifest(rollups, distributions)
    manifest_path = OUTPUT_DIR / "dataset-manifest.json"
    write_json(manifest_path, manifest)
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
