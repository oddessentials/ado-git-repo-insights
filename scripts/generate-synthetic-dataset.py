#!/usr/bin/env python3
"""Generate synthetic datasets for performance testing.

Contract-validated output matching AggregateGenerator schema exactly.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import random
import sys
from dataclasses import asdict
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from types import ModuleType
from typing import TYPE_CHECKING, cast

# Load aggregators via importlib with package stubs so relative imports resolve.
# This allows direct script execution from a plain checkout without editable install.
_src = Path(__file__).resolve().parent.parent / "src"
_pkg = _src / "ado_git_repo_insights"
_transform = _pkg / "transform"

_pkg_stub = ModuleType("ado_git_repo_insights")
_pkg_stub.__path__ = [str(_pkg)]
sys.modules.setdefault("ado_git_repo_insights", _pkg_stub)

_transform_stub = ModuleType("ado_git_repo_insights.transform")
_transform_stub.__path__ = [str(_transform)]
sys.modules.setdefault("ado_git_repo_insights.transform", _transform_stub)

_sv_spec = importlib.util.spec_from_file_location(
    "ado_git_repo_insights.transform.schema_versions",
    _transform / "schema_versions.py",
)
assert _sv_spec is not None
assert _sv_spec.loader is not None
_sv_mod = importlib.util.module_from_spec(_sv_spec)
sys.modules.setdefault("ado_git_repo_insights.transform.schema_versions", _sv_mod)
_sv_spec.loader.exec_module(_sv_mod)

if TYPE_CHECKING:
    from ado_git_repo_insights.transform.aggregators import (
        AggregateIndex,
        DatasetManifest,
        Dimensions,
        WeeklyRollup,
        YearlyDistribution,
    )
    from ado_git_repo_insights.types import (
        DistributionIndexEntry,
        JSONValue,
        ProjectRecord,
        RepositoryRecord,
        TeamRecord,
        UserRecord,
        WeeklyRollupIndexEntry,
    )
else:
    _agg_spec = importlib.util.spec_from_file_location(
        "ado_git_repo_insights.transform.aggregators",
        _transform / "aggregators.py",
    )
    assert _agg_spec is not None
    assert _agg_spec.loader is not None
    _agg_mod = importlib.util.module_from_spec(_agg_spec)
    sys.modules.setdefault("ado_git_repo_insights.transform.aggregators", _agg_mod)
    _agg_spec.loader.exec_module(_agg_mod)

    AggregateIndex = _agg_mod.AggregateIndex
    DatasetManifest = _agg_mod.DatasetManifest
    Dimensions = _agg_mod.Dimensions
    WeeklyRollup = _agg_mod.WeeklyRollup
    YearlyDistribution = _agg_mod.YearlyDistribution

    # Types module is loaded as a side-effect of aggregators importing from ..types
    _types_mod = sys.modules["ado_git_repo_insights.types"]
    DistributionIndexEntry = _types_mod.DistributionIndexEntry
    JSONValue = _types_mod.JSONValue
    ProjectRecord = _types_mod.ProjectRecord
    RepositoryRecord = _types_mod.RepositoryRecord
    TeamRecord = _types_mod.TeamRecord
    UserRecord = _types_mod.UserRecord
    WeeklyRollupIndexEntry = _types_mod.WeeklyRollupIndexEntry

# Load demo_generation_common from scripts/ via importlib (avoids sys.path manipulation)
_common_spec = importlib.util.spec_from_file_location(
    "demo_generation_common",
    Path(__file__).resolve().parent / "demo_generation_common.py",
)
assert _common_spec is not None
assert _common_spec.loader is not None
_common_mod = importlib.util.module_from_spec(_common_spec)
_common_spec.loader.exec_module(_common_mod)
largest_remainder_allocate = _common_mod.largest_remainder_allocate


def generate_dimensions(
    pr_count: int, seed: int, num_users: int | None = None, weeks: int | None = None
) -> Dimensions:
    """Generate synthetic filter dimensions."""
    rng = random.Random(seed)

    # Generate repositories (5-10 repos)
    num_repos = rng.randint(5, 10)
    repositories: list[RepositoryRecord] = []
    for i in range(num_repos):
        repositories.append(
            {
                "repository_id": f"repo-{i + 1}",
                "repository_name": f"Repository-{i + 1}",
                "project_name": f"Project-{(i % 3) + 1}",
                "organization_name": "SyntheticOrg",
            }
        )

    # Generate users
    if num_users is None:
        num_users = min(200, max(10, pr_count // 10))
    users: list[UserRecord] = []
    for i in range(num_users):
        users.append({"user_id": f"user-{i + 1}", "display_name": f"User {i + 1}"})

    # Generate projects
    projects: list[ProjectRecord] = [
        {"organization_name": "SyntheticOrg", "project_name": "Project-1"},
        {"organization_name": "SyntheticOrg", "project_name": "Project-2"},
        {"organization_name": "SyntheticOrg", "project_name": "Project-3"},
    ]

    # Generate teams
    teams: list[TeamRecord] = [
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
    if weeks is None:
        weeks = min(156, max(4, pr_count // 20))
    start_date = end_date - timedelta(weeks=weeks)

    return Dimensions(
        repositories=repositories,
        users=users,
        projects=projects,
        teams=teams,
        date_range={"min": start_date.isoformat(), "max": end_date.isoformat()},
    )


def _reviewer_count(rng: random.Random, num_users: int) -> int:
    """Return a random reviewer count bounded by num_users.

    For enterprise datasets (num_users=200), values should span up to
    num_users so the dashboard exercises large reviewer counts.
    """
    low = min(max(3, num_users // 10), num_users)
    high = max(low, num_users)
    return rng.randint(low, high)


def generate_weekly_rollups(
    pr_count: int,
    weeks: int,
    seed: int,
    output_dir: Path,
    num_users: int = 30,
    repositories: list[RepositoryRecord] | None = None,
) -> list[dict[str, object]]:
    """Generate weekly rollup files."""
    rng = random.Random(seed)

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

        ct_p50 = rng.uniform(120, 480)  # 2-8 hours
        ct_p90 = rng.uniform(480, 1440)  # 8-24 hours
        # Review time: 30-70% of cycle time with per-percentile null independence
        rt_ratio_p50 = rng.uniform(0.3, 0.7)
        rt_ratio_p90 = rng.uniform(0.3, 0.7)
        rt_p50: float | None = round(ct_p50 * rt_ratio_p50, 3)
        rt_p90: float | None = round(ct_p90 * rt_ratio_p90, 3)
        if rng.random() < 0.10:  # ~10% null rate per percentile
            rt_p50 = None
        if rng.random() < 0.10:
            rt_p90 = None

        rollup = WeeklyRollup(
            week=week_str,
            start_date=week_start.isoformat(),
            end_date=week_end.isoformat(),
            pr_count=week_pr_count,
            cycle_time_p50=ct_p50,
            cycle_time_p90=ct_p90,
            review_time_p50=rt_p50,
            review_time_p90=rt_p90,
            authors_count=rng.randint(5, 15),
            reviewers_count=_reviewer_count(rng, num_users),
        )

        rollup_dict = asdict(rollup)

        # Add by_team breakdown so the team filter dropdown works.
        # Keys must be team_name (not team_id) to match the dashboard
        # contract — see dashboard.ts line 1119.
        # All metrics are split deterministically so every chart reacts
        # to the team filter, not just PR Throughput.
        alpha_ratio = rng.random()
        team_alpha_prs = round(week_pr_count * alpha_ratio)
        team_beta_prs = week_pr_count - team_alpha_prs
        team_alpha_authors = max(1, round(rollup.authors_count * alpha_ratio))
        team_beta_authors = max(1, rollup.authors_count - team_alpha_authors)
        team_alpha_reviewers = max(1, round(rollup.reviewers_count * alpha_ratio))
        team_beta_reviewers = max(1, rollup.reviewers_count - team_alpha_reviewers)
        alpha_ct_p50 = (rollup.cycle_time_p50 or 0.0) * (0.8 + alpha_ratio * 0.4)
        alpha_ct_p90 = (rollup.cycle_time_p90 or 0.0) * (0.8 + alpha_ratio * 0.4)
        beta_ct_p50 = (rollup.cycle_time_p50 or 0.0) * (1.2 - alpha_ratio * 0.4)
        beta_ct_p90 = (rollup.cycle_time_p90 or 0.0) * (1.2 - alpha_ratio * 0.4)
        alpha_rt_ratio = rng.uniform(0.3, 0.7)
        beta_rt_ratio = rng.uniform(0.3, 0.7)
        rollup_dict["by_team"] = {
            "Team Alpha": {
                "pr_count": team_alpha_prs,
                "cycle_time_p50": alpha_ct_p50,
                "cycle_time_p90": alpha_ct_p90,
                "review_time_p50": round(alpha_ct_p50 * alpha_rt_ratio, 3),
                "review_time_p90": round(alpha_ct_p90 * alpha_rt_ratio, 3),
                "authors_count": team_alpha_authors,
                "reviewers_count": team_alpha_reviewers,
            },
            "Team Beta": {
                "pr_count": team_beta_prs,
                "cycle_time_p50": beta_ct_p50,
                "cycle_time_p90": beta_ct_p90,
                "review_time_p50": round(beta_ct_p50 * beta_rt_ratio, 3),
                "review_time_p90": round(beta_ct_p90 * beta_rt_ratio, 3),
                "authors_count": team_beta_authors,
                "reviewers_count": team_beta_reviewers,
            },
        }

        # Add by_team_and_repo cross-dimensional breakdown.
        # Uses correlated team-repo distributions so that Team Alpha is
        # heavily weighted toward earlier repos (Backend) and Team Beta
        # toward later repos (Frontend). This ensures proportional
        # estimation produces meaningful error (>20%) for at least one
        # team-repo pair, validating the cross-dim feature.
        if repositories:
            repo_names = [r["repository_name"] for r in repositories]
            num_repos = len(repo_names)

            # Correlated weight profiles: Alpha skews toward early repos
            # (Backend-like), Beta skews toward late repos (Frontend-like).
            # This creates non-independent distributions that expose
            # proportional estimation failures.
            alpha_repo_raw = [
                max(0.01, (num_repos - i) / num_repos) for i in range(num_repos)
            ]
            beta_repo_raw = [max(0.01, (i + 1) / num_repos) for i in range(num_repos)]
            alpha_repo_sum = sum(alpha_repo_raw)
            beta_repo_sum = sum(beta_repo_raw)
            alpha_repo_weights = [w / alpha_repo_sum for w in alpha_repo_raw]
            beta_repo_weights = [w / beta_repo_sum for w in beta_repo_raw]

            team_repo_profiles: dict[str, tuple[int, int, int, list[float]]] = {
                "Team Alpha": (
                    team_alpha_prs,
                    team_alpha_authors,
                    team_alpha_reviewers,
                    alpha_repo_weights,
                ),
                "Team Beta": (
                    team_beta_prs,
                    team_beta_authors,
                    team_beta_reviewers,
                    beta_repo_weights,
                ),
            }

            by_team_and_repo: dict[str, dict[str, object]] = {}
            for team_name, (
                t_prs,
                t_authors,
                t_reviewers,
                repo_weights,
            ) in team_repo_profiles.items():
                if t_prs == 0:
                    continue
                team_repo_entries: dict[str, object] = {}

                alloc_prs = largest_remainder_allocate(t_prs, repo_weights)
                alloc_authors = largest_remainder_allocate(t_authors, repo_weights)
                alloc_reviewers = largest_remainder_allocate(t_reviewers, repo_weights)

                for j, rname in enumerate(repo_names):
                    r_prs = alloc_prs[j]
                    r_authors = (
                        max(1, alloc_authors[j]) if r_prs > 0 else alloc_authors[j]
                    )
                    r_reviewers = (
                        max(1, alloc_reviewers[j]) if r_prs > 0 else alloc_reviewers[j]
                    )

                    if r_prs <= 0:
                        continue

                    # Cycle time variation per intersection:
                    # null when fewer than 5 PRs (FR-019 minimum sample size)
                    tr_ct_p50: float | None
                    tr_ct_p90: float | None
                    if r_prs < 5:
                        tr_ct_p50 = None
                        tr_ct_p90 = None
                    else:
                        team_entry = rollup_dict["by_team"][team_name]
                        ct_factor = 0.7 + repo_weights[j] * num_repos * 0.6
                        tr_ct_p50 = team_entry["cycle_time_p50"] * ct_factor
                        tr_ct_p90 = team_entry["cycle_time_p90"] * ct_factor

                    tr_rt_ratio = rng.uniform(0.3, 0.7)
                    rt_p50_tr = (
                        round(tr_ct_p50 * tr_rt_ratio, 3)
                        if tr_ct_p50 is not None
                        else None
                    )
                    rt_p90_tr = (
                        round(tr_ct_p90 * tr_rt_ratio, 3)
                        if tr_ct_p90 is not None
                        else None
                    )
                    team_repo_entries[rname] = {
                        "pr_count": r_prs,
                        "cycle_time_p50": tr_ct_p50,
                        "cycle_time_p90": tr_ct_p90,
                        "review_time_p50": rt_p50_tr,
                        "review_time_p90": rt_p90_tr,
                        "authors_count": r_authors,
                        "reviewers_count": r_reviewers,
                    }

                if team_repo_entries:
                    by_team_and_repo[team_name] = team_repo_entries

            if by_team_and_repo:
                rollup_dict["by_team_and_repo"] = by_team_and_repo

        # Add by_repository breakdown so the repo filter dropdown works.
        # Keys must be repository_name (not repository_id) to match the
        # dashboard contract — see dashboard.ts filter population.
        if repositories:
            repo_names = [r["repository_name"] for r in repositories]
            # Random weights per repo, normalized to sum=1
            raw_weights = [rng.random() for _ in repo_names]
            weight_sum = sum(raw_weights)
            weights = [w / weight_sum for w in raw_weights]

            by_repo: dict[str, dict[str, object]] = {}
            alloc_repo_prs = largest_remainder_allocate(week_pr_count, weights)
            alloc_repo_authors = largest_remainder_allocate(
                rollup.authors_count, weights
            )
            alloc_repo_reviewers = largest_remainder_allocate(
                rollup.reviewers_count, weights
            )

            for i, name in enumerate(repo_names):
                repo_prs = alloc_repo_prs[i]
                repo_authors = (
                    max(1, alloc_repo_authors[i])
                    if repo_prs > 0
                    else alloc_repo_authors[i]
                )
                repo_reviewers = (
                    max(1, alloc_repo_reviewers[i])
                    if repo_prs > 0
                    else alloc_repo_reviewers[i]
                )

                # Vary cycle times by weight for realistic spread
                factor = 0.6 + weights[i] * len(repo_names) * 0.8
                repo_ct_p50 = (rollup.cycle_time_p50 or 0.0) * factor
                repo_ct_p90 = (rollup.cycle_time_p90 or 0.0) * factor
                repo_rt_ratio = rng.uniform(0.3, 0.7)
                by_repo[name] = {
                    "pr_count": repo_prs,
                    "cycle_time_p50": repo_ct_p50,
                    "cycle_time_p90": repo_ct_p90,
                    "review_time_p50": round(repo_ct_p50 * repo_rt_ratio, 3),
                    "review_time_p90": round(repo_ct_p90 * repo_rt_ratio, 3),
                    "authors_count": repo_authors,
                    "reviewers_count": repo_reviewers,
                }

            rollup_dict["by_repository"] = by_repo

        # Write file
        rollup_dir = output_dir / "aggregates" / "weekly_rollups"
        rollup_dir.mkdir(parents=True, exist_ok=True)

        file_path = rollup_dir / f"{week_str}.json"
        write_json(file_path, rollup_dict)

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
) -> list[dict[str, object]]:
    """Generate yearly distribution files."""
    rng = random.Random(seed + 1000)

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


def generate_comments(
    pr_count: int,
    seed: int,
    users: list[UserRecord],
    output_dir: Path,
    batch_size: int = 100,
) -> dict[str, object]:
    """Generate comment threads and comments for PRs in batched files.

    Instead of one file per PR, writes batched JSON files
    (``comments-batch-0001.json``, etc.) for better filesystem performance.

    Returns comment statistics for the manifest coverage section.
    """
    rng = random.Random(seed + 2000)

    comments_dir = output_dir / "aggregates" / "comments"
    comments_dir.mkdir(parents=True, exist_ok=True)

    total_threads = 0
    total_comments = 0
    batch: list[dict[str, object]] = []
    batch_num = 0

    for pr_id in range(1, pr_count + 1):
        num_threads = rng.randint(2, 5)
        threads = []

        for thread_idx in range(num_threads):
            num_comments = rng.randint(1, 4)
            thread_comments = []

            for comment_idx in range(num_comments):
                author = rng.choice(users)
                thread_comments.append(
                    {
                        "comment_id": f"comment-{pr_id}-{thread_idx}-{comment_idx}",
                        "author": author["display_name"],
                        "author_id": author["user_id"],
                        "content_length": rng.randint(10, 500),
                    }
                )

            threads.append(
                {
                    "thread_id": f"thread-{pr_id}-{thread_idx}",
                    "status": rng.choice(["active", "fixed", "closed", "byDesign"]),
                    "comments": thread_comments,
                }
            )

            total_comments += num_comments

        total_threads += num_threads
        batch.append({"pr_id": pr_id, "threads": threads})

        # Flush batch when full
        if len(batch) >= batch_size:
            batch_num += 1
            batch_file = comments_dir / f"comments-batch-{batch_num:04d}.json"
            write_json(batch_file, {"prs": batch})
            batch = []

    # Flush remaining
    if batch:
        batch_num += 1
        batch_file = comments_dir / f"comments-batch-{batch_num:04d}.json"
        write_json(batch_file, {"prs": batch})

    return {
        "total_threads": total_threads,
        "total_comments": total_comments,
        "prs_with_comments": pr_count,
        "batch_count": batch_num,
        "batch_size": batch_size,
        "batch_pattern": "aggregates/comments/comments-batch-*.json",
    }


def write_json(path: Path, data: object) -> None:
    """Write JSON with deterministic formatting (matches aggregators.py)."""
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)


def generate_dataset(
    pr_count: int,
    weeks: int,
    seed: int,
    output_dir: Path,
    num_users: int | None = None,
    include_comments: bool = False,
) -> None:
    """Generate complete synthetic dataset."""
    output_dir.mkdir(parents=True, exist_ok=True)

    # Set global seed
    random.seed(seed)

    print(f"Generating synthetic dataset: {pr_count} PRs, {weeks} weeks")
    print(f"Output: {output_dir}")
    print(f"Seed: {seed}")

    # Generate dimensions
    dimensions = generate_dimensions(pr_count, seed, num_users=num_users, weeks=weeks)
    dim_path = output_dir / "aggregates" / "dimensions.json"
    dim_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(dim_path, asdict(dimensions))
    print("[OK] Generated dimensions.json")

    # Generate weekly rollups
    weekly_index = generate_weekly_rollups(
        pr_count,
        weeks,
        seed,
        output_dir,
        num_users=len(dimensions.users),
        repositories=dimensions.repositories,
    )
    print(f"[OK] Generated {len(weekly_index)} weekly rollup files")

    # Generate distributions
    dist_index = generate_distributions(pr_count, weeks, seed, output_dir)
    print(f"[OK] Generated {len(dist_index)} distribution files")

    # Generate comments if requested
    comment_stats: dict[str, object] = {"status": "disabled"}
    if include_comments:
        comment_stats = generate_comments(pr_count, seed, dimensions.users, output_dir)
        comment_stats["status"] = "full"
        comment_stats["capped"] = False
        comment_stats["threads_fetched"] = comment_stats["total_threads"]
        comment_stats["comments_fetched"] = comment_stats["total_comments"]
        comment_stats["prs_with_threads"] = comment_stats["prs_with_comments"]
        print(
            f"[OK] Generated comments: {comment_stats['total_threads']} threads, "
            f"{comment_stats['total_comments']} comments"
        )

    # Generate manifest
    manifest = DatasetManifest(
        generated_at=datetime.now(UTC).isoformat(),
        run_id=f"synthetic-{seed}",
        warnings=["SYNTHETIC TEST DATA"],
        aggregate_index=AggregateIndex(
            weekly_rollups=cast(list[WeeklyRollupIndexEntry], weekly_index),
            distributions=cast(list[DistributionIndexEntry], dist_index),
        ),
        defaults={"default_date_range_days": 90},
        limits={"max_date_range_days_soft": 730},
        features={
            "teams": True,
            "cross_dimensional": True,
            "comments": include_comments,
            "predictions": False,
            "ai_insights": False,
        },
        capabilities={
            "author_filters": True,
            "author_repo_exact": True,
            "comments_metrics": include_comments,
            "reviewer_repository_mode": "constrained",
            "reviewer_team_mode": "disallowed",
            "cross_dimensional_available": True,
        },
        coverage=cast(
            dict[str, JSONValue],
            {
                "total_prs": pr_count,
                "date_range": dimensions.date_range,
                "teams_count": len(dimensions.teams),
                "comments": comment_stats,
                "row_counts": {
                    "pull_requests": pr_count,
                    "reviewers": 0,
                    "users": len(dimensions.users),
                    "repositories": len(dimensions.repositories),
                },
            },
        ),
    )

    # Add operational summary
    manifest_dict = asdict(manifest)

    def _int(val: object) -> int:
        if not isinstance(val, int):
            raise TypeError(f"Expected int, got {type(val).__name__}")
        return val

    total_size = sum(_int(item["size_bytes"]) for item in weekly_index)
    total_size += sum(_int(item["size_bytes"]) for item in dist_index)
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
        help="Number of weeks to span, 1-520 (default: auto-calculated from pr-count)",
    )
    parser.add_argument(
        "--users",
        type=int,
        default=None,
        help="Number of users to generate, 1-500 (default: auto-calculated from pr-count)",
    )
    parser.add_argument(
        "--include-comments",
        action="store_true",
        default=False,
        help="Enable comment data generation",
    )
    parser.add_argument(
        "--seed", type=int, default=42, help="Random seed for deterministic generation"
    )
    parser.add_argument("--output", type=Path, required=True, help="Output directory")

    args = parser.parse_args()

    # Validate bounds
    if args.weeks is not None and not (1 <= args.weeks <= 520):
        parser.error(f"--weeks must be between 1 and 520, got {args.weeks}")
    if args.users is not None and not (1 <= args.users <= 500):
        parser.error(f"--users must be between 1 and 500, got {args.users}")

    # Auto-calculate weeks if not specified
    weeks = args.weeks
    if weeks is None:
        weeks = min(156, max(4, args.pr_count // 20))

    generate_dataset(
        args.pr_count,
        weeks,
        args.seed,
        args.output,
        num_users=args.users,
        include_comments=args.include_comments,
    )


if __name__ == "__main__":
    main()
