#!/usr/bin/env python3
"""Generate synthetic datasets for performance testing.

Contract-validated output matching AggregateGenerator schema exactly.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from dataclasses import asdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# Add src to path before local imports
_src_path = Path(__file__).parent.parent / "src"
if str(_src_path) not in sys.path:
    sys.path.insert(0, str(_src_path))

from ado_git_repo_insights.transform.aggregators import (  # noqa: E402  # type: ignore[import-not-found]
    AggregateIndex,
    DatasetManifest,
    Dimensions,
    WeeklyRollup,
    YearlyDistribution,
)


def generate_dimensions(pr_count: int, seed: int) -> Dimensions:
    """Generate synthetic filter dimensions."""
    rng = random.Random(seed)  # noqa: S311

    # Generate repositories (5-10 repos)
    num_repos = rng.randint(5, 10)
    repositories = []
    for i in range(num_repos):
        repositories.append(
            {
                "repository_id": f"repo-{i + 1}",
                "repository_name": f"Repository-{i + 1}",
                "project_name": f"Project-{(i % 3) + 1}",
                "organization_name": "SyntheticOrg",
            }
        )

    # Generate users (10-30 users)
    num_users = min(30, max(10, pr_count // 10))
    users = []
    for i in range(num_users):
        users.append({"user_id": f"user-{i + 1}", "display_name": f"User {i + 1}"})

    # Generate projects
    projects = [
        {"organization_name": "SyntheticOrg", "project_name": "Project-1"},
        {"organization_name": "SyntheticOrg", "project_name": "Project-2"},
        {"organization_name": "SyntheticOrg", "project_name": "Project-3"},
    ]

    # Generate teams
    teams = [
        {
            "team_id": "team-1",
            "team_name": "Team Alpha",
            "project_name": "Project-1",
            "organization_name": "SyntheticOrg",
            "member_count": rng.randint(3, 8),
        },
        {
            "team_id": "team-2",
            "team_name": "Team Beta",
            "project_name": "Project-2",
            "organization_name": "SyntheticOrg",
            "member_count": rng.randint(3, 8),
        },
    ]

    # Date range (end = today, start = weeks ago)
    end_date = date.today()
    weeks = min(52, max(4, pr_count // 20))
    start_date = end_date - timedelta(weeks=weeks)

    return Dimensions(
        repositories=repositories,
        users=users,
        projects=projects,
        teams=teams,
        date_range={"min": start_date.isoformat(), "max": end_date.isoformat()},
    )


def generate_weekly_rollups(
    pr_count: int, weeks: int, seed: int, output_dir: Path
) -> list[dict[str, Any]]:
    """Generate weekly rollup files."""
    rng = random.Random(seed)  # noqa: S311

    end_date = date.today()
    start_date = end_date - timedelta(weeks=weeks)

    # Distribute PRs across weeks
    prs_per_week = pr_count // weeks if weeks > 0 else pr_count

    index = []
    current_date = start_date

    for week_offset in range(weeks):
        # Calculate ISO week
        week_date = current_date + timedelta(weeks=week_offset)
        iso_cal = week_date.isocalendar()
        week_str = f"{iso_cal.year}-W{iso_cal.week:02d}"

        week_start = date.fromisocalendar(iso_cal.year, iso_cal.week, 1)
        week_end = date.fromisocalendar(iso_cal.year, iso_cal.week, 7)

        # Generate metrics
        week_pr_count = prs_per_week + rng.randint(-5, 5)
        week_pr_count = max(1, week_pr_count)

        rollup = WeeklyRollup(
            week=week_str,
            start_date=week_start.isoformat(),
            end_date=week_end.isoformat(),
            pr_count=week_pr_count,
            cycle_time_p50=rng.uniform(120, 480),  # 2-8 hours
            cycle_time_p90=rng.uniform(480, 1440),  # 8-24 hours
            authors_count=rng.randint(5, 15),
            reviewers_count=rng.randint(3, 10),
        )

        # Write file
        rollup_dir = output_dir / "aggregates" / "weekly_rollups"
        rollup_dir.mkdir(parents=True, exist_ok=True)

        file_path = rollup_dir / f"{week_str}.json"
        write_json(file_path, asdict(rollup))

        # Add to index
        index.append(
            {
                "week": week_str,
                "path": f"aggregates/weekly_rollups/{week_str}.json",
                "start_date": rollup.start_date,
                "end_date": rollup.end_date,
                "size_bytes": file_path.stat().st_size,
            }
        )

    return index


def generate_distributions(
    pr_count: int, weeks: int, seed: int, output_dir: Path
) -> list[dict[str, Any]]:
    """Generate yearly distribution files."""
    rng = random.Random(seed + 1000)  # noqa: S311

    end_date = date.today()
    start_date = end_date - timedelta(weeks=weeks)

    # Determine years covered
    years = list(range(start_date.year, end_date.year + 1))

    index = []

    for year in years:
        # Distribute PRs proportionally
        if year == start_date.year and year == end_date.year:
            # All PRs in single year
            year_prs = pr_count
        elif year == start_date.year:
            # Partial first year
            year_prs = pr_count // len(years)
        elif year == end_date.year:
            # Partial last year
            year_prs = pr_count // len(years)
        else:
            # Full year
            year_prs = pr_count // len(years)

        # Generate cycle time buckets
        buckets = {
            "0-1h": rng.randint(year_prs // 10, year_prs // 5),
            "1-4h": rng.randint(year_prs // 5, year_prs // 3),
            "4-24h": rng.randint(year_prs // 4, year_prs // 2),
            "1-3d": rng.randint(year_prs // 8, year_prs // 4),
            "3-7d": rng.randint(year_prs // 10, year_prs // 6),
            "7d+": rng.randint(1, year_prs // 10),
        }

        # Generate PRs by month
        prs_by_month = {}
        for month in range(1, 13):
            month_str = f"{year}-{month:02d}"
            prs_by_month[month_str] = rng.randint(max(1, year_prs // 20), year_prs // 8)

        dist = YearlyDistribution(
            year=str(year),
            start_date=f"{year}-01-01",
            end_date=f"{year}-12-31",
            total_prs=year_prs,
            cycle_time_buckets=buckets,
            prs_by_month=prs_by_month,
        )

        # Write file
        dist_dir = output_dir / "aggregates" / "distributions"
        dist_dir.mkdir(parents=True, exist_ok=True)

        file_path = dist_dir / f"{year}.json"
        write_json(file_path, asdict(dist))

        index.append(
            {
                "year": str(year),
                "path": f"aggregates/distributions/{year}.json",
                "start_date": dist.start_date,
                "end_date": dist.end_date,
                "size_bytes": file_path.stat().st_size,
            }
        )

    return index


def write_json(path: Path, data: dict[str, Any]) -> None:
    """Write JSON with deterministic formatting (matches aggregators.py)."""
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)


def generate_dataset(pr_count: int, weeks: int, seed: int, output_dir: Path) -> None:
    """Generate complete synthetic dataset."""
    output_dir.mkdir(parents=True, exist_ok=True)

    # Set global seed
    random.seed(seed)

    print(f"Generating synthetic dataset: {pr_count} PRs, {weeks} weeks")
    print(f"Output: {output_dir}")
    print(f"Seed: {seed}")

    # Generate dimensions
    dimensions = generate_dimensions(pr_count, seed)
    dim_path = output_dir / "aggregates" / "dimensions.json"
    dim_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(dim_path, asdict(dimensions))
    print("[OK] Generated dimensions.json")

    # Generate weekly rollups
    weekly_index = generate_weekly_rollups(pr_count, weeks, seed, output_dir)
    print(f"[OK] Generated {len(weekly_index)} weekly rollup files")

    # Generate distributions
    dist_index = generate_distributions(pr_count, weeks, seed, output_dir)
    print(f"[OK] Generated {len(dist_index)} distribution files")

    # Generate manifest
    manifest = DatasetManifest(
        generated_at=datetime.now(timezone.utc).isoformat(),
        run_id=f"synthetic-{seed}",
        warnings=["SYNTHETIC TEST DATA"],
        aggregate_index=AggregateIndex(
            weekly_rollups=weekly_index, distributions=dist_index
        ),
        defaults={"default_date_range_days": 90},
        limits={"max_date_range_days_soft": 730},
        features={
            "teams": True,
            "comments": False,
            "predictions": False,
            "ai_insights": False,
        },
        coverage={
            "total_prs": pr_count,
            "date_range": dimensions.date_range,
            "teams_count": len(dimensions.teams),
            "comments": {"status": "disabled"},
            "row_counts": {
                "pull_requests": pr_count,
                "reviewers": 0,
                "users": len(dimensions.users),
                "repositories": len(dimensions.repositories),
            },
        },
    )

    # Add operational summary
    manifest_dict = asdict(manifest)

    total_size = sum(item["size_bytes"] for item in weekly_index)
    total_size += sum(item["size_bytes"] for item in dist_index)
    total_size += dim_path.stat().st_size

    manifest_dict["operational"] = {
        "artifact_size_bytes": total_size,
        "weekly_rollup_count": len(weekly_index),
        "distribution_count": len(dist_index),
        "retention_notice": None,
    }

    manifest_path = output_dir / "dataset-manifest.json"
    write_json(manifest_path, manifest_dict)
    print("[OK] Generated dataset-manifest.json")

    print("\n[SUCCESS] Dataset generated successfully")
    print(f"   Total size: {total_size:,} bytes")
    print(f"   Manifest: {manifest_path}")


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Generate synthetic datasets for performance testing"
    )
    parser.add_argument(
        "--pr-count",
        type=int,
        required=True,
        choices=[100, 1000, 5000, 10000, 20000],
        help="Number of PRs to simulate",
    )
    parser.add_argument(
        "--weeks",
        type=int,
        default=None,
        help="Number of weeks to span (default: auto-calculated from pr-count)",
    )
    parser.add_argument(
        "--seed", type=int, default=42, help="Random seed for deterministic generation"
    )
    parser.add_argument("--output", type=Path, required=True, help="Output directory")

    args = parser.parse_args()

    # Auto-calculate weeks if not specified
    weeks = args.weeks
    if weeks is None:
        weeks = min(52, max(4, args.pr_count // 20))

    generate_dataset(args.pr_count, weeks, args.seed, args.output)


if __name__ == "__main__":
    main()
