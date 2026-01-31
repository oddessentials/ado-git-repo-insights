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
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

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
NUM_REPOS = 20
NUM_USERS = 50

# Weekly PR metrics baseline
BASE_PR_COUNT = 40
PR_COUNT_SEASONAL_AMPLITUDE = 0.2  # ±20%
PR_COUNT_NOISE_AMPLITUDE = 0.1  # ±10%

# Cycle time distribution parameters (log-normal)
CYCLE_TIME_MU = 6.0  # log-minutes
CYCLE_TIME_SIGMA = 1.5

# Output directory
OUTPUT_DIR = Path(__file__).parent.parent / "docs" / "data"


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


def write_json(path: Path, data: Any) -> None:
    """Write data to JSON file with canonical formatting."""
    path.parent.mkdir(parents=True, exist_ok=True)
    content = canonical_json(data)
    # Write in binary mode to prevent Windows CRLF conversion
    path.write_bytes(content.encode("utf-8"))


# =============================================================================
# Deterministic Random Utilities (T006)
# =============================================================================


def init_random(seed: int = SEED) -> random.Random:
    """Initialize deterministic random generator with fixed seed."""
    rng = random.Random(seed)  # noqa: S311 - Intentional for deterministic synthetic data
    return rng


# Global random generator (initialized at module load)
RNG = init_random(SEED)


def lognormal(mu: float, sigma: float) -> float:
    """Generate log-normal random value."""
    return RNG.lognormvariate(mu, sigma)


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
class WeeklyRollup:
    """Aggregated PR metrics for one ISO week."""

    week: str  # Format: YYYY-Www
    start_date: date
    end_date: date
    pr_count: int
    cycle_time_p50: float
    cycle_time_p90: float
    authors_count: int
    reviewers_count: int
    by_repository: dict[str, dict[str, Any]]
    # Note: by_team is omitted when teams feature is disabled (not null)


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
        "teams": [],  # Teams disabled per data model
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


def generate_cycle_times(count: int) -> list[float]:
    """Generate cycle times following log-normal distribution."""
    return [lognormal(CYCLE_TIME_MU, CYCLE_TIME_SIGMA) for _ in range(count)]


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
            pr_count = max(1, int(BASE_PR_COUNT * adjustment))

            # Generate cycle times for this week
            cycle_times = generate_cycle_times(pr_count)
            p50 = calculate_percentile(cycle_times, 50)
            p90 = calculate_percentile(cycle_times, 90)

            # Authors: ~30% of PR count
            authors_count = max(1, int(pr_count * 0.3))
            # Reviewers: ~45% of PR count
            reviewers_count = max(1, int(pr_count * 0.45))

            # Distribute PRs across repositories
            by_repository: dict[str, dict[str, Any]] = {}
            remaining_prs = pr_count
            repo_list = list(repositories)

            for i, repo in enumerate(repo_list):
                if i == len(repo_list) - 1:
                    repo_pr_count = remaining_prs
                else:
                    # Random distribution with minimum 1 per repo (if PRs available)
                    max_for_repo = max(1, remaining_prs - (len(repo_list) - i - 1))
                    repo_pr_count = RNG.randint(1, max(1, max_for_repo // 2))
                    remaining_prs -= repo_pr_count

                if repo_pr_count > 0:
                    repo_cycle_times = generate_cycle_times(repo_pr_count)
                    repo_p50 = calculate_percentile(repo_cycle_times, 50)
                    repo_p90 = calculate_percentile(repo_cycle_times, 90)

                    by_repository[repo.repository_name] = {
                        "pr_count": repo_pr_count,
                        "cycle_time_p50": repo_p50,
                        "cycle_time_p90": repo_p90,
                        "authors_count": max(1, int(repo_pr_count * 0.3)),
                        "reviewers_count": max(1, int(repo_pr_count * 0.45)),
                    }

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

# Expected proportions (from data-model.md)
BUCKET_PROPORTIONS = {
    "0-1h": 0.15,
    "1-4h": 0.25,
    "4-24h": 0.30,
    "1-3d": 0.15,
    "3-7d": 0.10,
    "7d+": 0.05,
}


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
        "aggregates_schema_version": 1,
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
            "teams": False,
            "comments": False,
            # predictions and ai_insights are set to False until Phase 5-6 implementation
            # These will be enabled by generate-demo-predictions.py and generate-demo-insights.py
            "predictions": False,
            "ai_insights": False,
        },
        "coverage": {
            "total_prs": total_prs,
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

    # Generate dimensions
    print("\n[2/6] Generating dimensions.json...")
    dimensions = generate_dimensions(organizations, projects, repositories, users)
    dimensions_path = OUTPUT_DIR / "aggregates" / "dimensions.json"
    write_json(dimensions_path, dimensions)
    print(f"  Written: {dimensions_path}")

    # Generate weekly rollups
    print("\n[3/6] Generating weekly rollups...")
    rollups = generate_weekly_rollups(repositories)
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
            # by_team is omitted when teams feature is disabled (schema expects object, not null)
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
