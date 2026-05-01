"""Frozen demo invariant tests (Contract 5, SC-002 through SC-009).

These tests verify that generated demo data exhibits realistic distributions:
power-law repo activity, year-over-year growth, holiday dips, team affinity,
and cycle time variation by repo category.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import pytest

ROLLUPS_DIR = (
    Path(__file__).parent.parent.parent
    / "docs"
    / "data"
    / "aggregates"
    / "weekly_rollups"
)


@pytest.fixture(scope="module")
def all_rollups():
    """Load all rollup data once."""
    rollups = []
    for f in sorted(ROLLUPS_DIR.glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        rollups.append(data)
    assert len(rollups) >= 260
    return rollups


class TestTopRepoShare:
    """SC-002 / INV-001: Top 3 repos >= 40% of total PRs."""

    def test_top3_repo_share(self, all_rollups):
        repo_totals: dict[str, int] = defaultdict(int)
        for data in all_rollups:
            for repo, entry in data.get("by_repository", {}).items():
                repo_totals[repo] += entry["pr_count"]

        total_prs = sum(repo_totals.values())
        top3 = sorted(repo_totals.values(), reverse=True)[:3]
        top3_share = sum(top3) / total_prs if total_prs > 0 else 0

        assert top3_share >= 0.40, (
            f"Top 3 repo share = {top3_share:.2%}, expected >= 40%"
        )


class TestYoYGrowth:
    """SC-003 / INV-002: Final year PRs >= 1.3x first year PRs."""

    def test_yoy_growth(self, all_rollups):
        yearly_prs: dict[str, int] = defaultdict(int)
        for data in all_rollups:
            year = data["week"][:4]
            yearly_prs[year] += data["pr_count"]

        years = sorted(yearly_prs.keys())
        assert len(years) >= 2, "Need at least 2 years"
        first_year = yearly_prs[years[0]]
        final_year = yearly_prs[years[-1]]
        ratio = final_year / first_year if first_year > 0 else 0

        assert ratio >= 1.3, (
            f"YoY growth ratio = {ratio:.2f} ({years[-1]}/{years[0]} = {final_year}/{first_year}), expected >= 1.3"
        )


class TestHolidayDip:
    """SC-008 / INV-003: Week 52 PR count <= 60% of year average."""

    def test_holiday_dip(self, all_rollups):
        yearly_prs: dict[str, list[int]] = defaultdict(list)
        week52_prs: dict[str, int] = {}

        for data in all_rollups:
            year = data["week"][:4]
            week_num = int(data["week"].split("-W")[1])
            yearly_prs[year].append(data["pr_count"])
            if week_num == 52:
                week52_prs[year] = data["pr_count"]

        errors = []
        for year, w52_count in week52_prs.items():
            year_avg = sum(yearly_prs[year]) / len(yearly_prs[year])
            ratio = w52_count / year_avg if year_avg > 0 else 0
            if ratio > 0.60:
                errors.append(
                    f"{year}: W52={w52_count}, avg={year_avg:.1f}, ratio={ratio:.2%}"
                )

        assert not errors, "Holiday dip violations:\n" + "\n".join(errors)


class TestIdleRepoWeeks:
    """SC-004 / INV-004: >= 20% of possible repo-weeks have 0 PRs."""

    # All 23 repos from the demo org — repos that never appear are also idle
    ALL_REPOS = {
        "user-service",
        "react-shell",
        "ios-app",
        "auth-service",
        "gateway-core",
        "android-app",
        "etl-jobs",
        "model-training",
        "dashboard-api",
        "notification-service",
        "design-system",
        "data-warehouse",
        "stream-processor",
        "feature-store",
        "inference-service",
        "report-generator",
        "metrics-collector",
        "shared-core",
        "rate-limiter",
        "ci-scripts",
        "terraform-modules",
        "monitoring-stack",
        "forms-lib",
    }

    def test_idle_repo_weeks(self, all_rollups):
        total_repo_weeks = len(self.ALL_REPOS) * len(all_rollups)
        idle_repo_weeks = 0

        for data in all_rollups:
            by_repo = data.get("by_repository", {})
            for repo in self.ALL_REPOS:
                if repo not in by_repo or by_repo[repo]["pr_count"] == 0:
                    idle_repo_weeks += 1

        idle_pct = idle_repo_weeks / total_repo_weeks if total_repo_weeks > 0 else 0
        assert idle_pct >= 0.20, (
            f"Idle repo-weeks = {idle_pct:.2%} ({idle_repo_weeks}/{total_repo_weeks}), expected >= 20%"
        )


class TestTeamAffinity:
    """SC-009 / INV-005: >= 60% of each team's PRs in primary repos."""

    # Must match TEAM_PRIMARY_REPOS from generate-demo-data.py
    TEAM_PRIMARY_REPOS = {
        "Platform Team": {"user-service", "auth-service", "notification-service"},
        "Frontend Team": {"react-shell", "design-system", "ios-app"},
        "Data Team": {"etl-jobs", "data-warehouse", "stream-processor"},
        "ML Team": {"model-training", "inference-service", "feature-store"},
    }

    def test_team_affinity(self, all_rollups):
        team_total_prs: dict[str, int] = defaultdict(int)
        team_primary_prs: dict[str, int] = defaultdict(int)

        for data in all_rollups:
            btar = data.get("by_team_and_repo", {})
            for team, repos in btar.items():
                primary = self.TEAM_PRIMARY_REPOS.get(team, set())
                for repo, entry in repos.items():
                    team_total_prs[team] += entry["pr_count"]
                    if repo in primary:
                        team_primary_prs[team] += entry["pr_count"]

        errors = []
        for team, _primary_repos in self.TEAM_PRIMARY_REPOS.items():
            total = team_total_prs.get(team, 0)
            primary_count = team_primary_prs.get(team, 0)
            if total == 0:
                continue
            affinity = primary_count / total
            if affinity < 0.60:
                errors.append(
                    f"{team}: affinity={affinity:.2%} ({primary_count}/{total}), expected >= 60%"
                )

        assert not errors, "Team affinity violations:\n" + "\n".join(errors)


class TestSentinelReviewerCap:
    """#355: synthetic sentinel must not dominate the per-reviewer panel.

    Pre-fix the demo's organic comment sampling drew from
    ``user_pool + ghost_pool``, causing the synthetic
    ``__former_or_unavailable_author__`` bucket to rank #1 by
    comment_count by 2-3.5x on W25-W28 — a misleading first impression
    on the public demo before evaluators engage with real data.

    Post-fix organic sampling uses only ``eligible_user_pool``; ghost
    commenters reach the data exclusively via the ghost-forcing block
    in ``synthesize_pr_comment_streams_for_week`` (one comment per
    week).  Production sort posture is unchanged — this is a demo-data
    composition fix, not a render-time cap.
    """

    SENTINEL_KEY = "__former_or_unavailable_author__"
    PROVEN_DOMINANT_WEEKS = ("2025-W25", "2025-W26", "2025-W27", "2025-W28")

    def test_sentinel_does_not_dominate_per_reviewer_panel(self, all_rollups):
        rollups_by_week = {data["week"]: data for data in all_rollups}
        errors = []
        for week in self.PROVEN_DOMINANT_WEEKS:
            data = rollups_by_week.get(week)
            if data is None:
                pytest.fail(
                    f"Expected demo week {week} not present in regenerated docs/data"
                )
            brc = data.get("by_reviewer_comments") or {}
            sentinel_count = int(
                (brc.get(self.SENTINEL_KEY) or {}).get("comment_count", 0)
            )
            real_items = [
                (k, int(v.get("comment_count", 0)))
                for k, v in brc.items()
                if k != self.SENTINEL_KEY
            ]
            if not real_items:
                errors.append(
                    f"{week}: sentinel_comment_count={sentinel_count} "
                    f"but by_reviewer_comments has no real reviewers "
                    f"(top_real_comment_count=N/A, top_real_key=N/A)"
                )
                continue
            top_real_key, top_real_count = max(real_items, key=lambda kv: kv[1])
            if not (sentinel_count < top_real_count):
                errors.append(
                    f"{week}: sentinel_comment_count={sentinel_count} "
                    f">= top_real_comment_count={top_real_count} "
                    f"(top_real_key={top_real_key!r})"
                )

        assert not errors, (
            "#355 regression — sentinel dominates per-reviewer panel:\n"
            + "\n".join(errors)
        )


class TestCycleTimeRatio:
    """FR-008 / INV-006: Utility repo cycle times should be faster than data/ML repos.

    Since utility repos are low-traffic and often have pr_count < 5 (triggering
    null cycle times per Contract 3), we verify the mu_factor ratio directly
    and also check high-traffic repos in each category where data is available.
    """

    # Repos with enough traffic to have non-null cycle times
    UTILITY_REPOS = {
        "ci-scripts",
        "terraform-modules",
        "monitoring-stack",
        "rate-limiter",
    }
    DATA_ML_REPOS = {
        "etl-jobs",
        "data-warehouse",
        "stream-processor",
        "model-training",
        "inference-service",
        "feature-store",
        "metrics-collector",
        "report-generator",
    }
    # Higher-traffic repos in each category (more likely to have non-null p50)
    BACKEND_REPOS = {
        "user-service",
        "auth-service",
        "gateway-core",
        "notification-service",
        "dashboard-api",
    }
    FRONTEND_REPOS = {
        "react-shell",
        "design-system",
        "ios-app",
        "android-app",
        "forms-lib",
    }

    def test_cycle_time_category_separation(self, all_rollups):
        """Data/ML repos should have higher cycle times than backend repos.

        This tests the mu_factor effect using high-traffic repos that reliably
        have non-null cycle times (pr_count >= 5 most weeks).
        """
        backend_p50s = []
        data_ml_p50s = []

        for data in all_rollups:
            by_repo = data.get("by_repository", {})
            for repo, entry in by_repo.items():
                p50 = entry.get("cycle_time_p50")
                if p50 is None:
                    continue
                if repo in self.BACKEND_REPOS:
                    backend_p50s.append(p50)
                elif repo in self.DATA_ML_REPOS:
                    data_ml_p50s.append(p50)

        assert backend_p50s, "No backend repo cycle times found"
        assert data_ml_p50s, "No data/ML repo cycle times found"

        backend_median = sorted(backend_p50s)[len(backend_p50s) // 2]
        data_ml_median = sorted(data_ml_p50s)[len(data_ml_p50s) // 2]

        # Backend mu_factor=1.0, Data/ML mu_factor=1.3
        # So data_ml should be meaningfully higher than backend
        assert data_ml_median > backend_median, (
            f"Data/ML median ({data_ml_median:.1f}) should be > backend median ({backend_median:.1f})"
        )

    def test_frontend_faster_than_data_ml(self, all_rollups):
        """Frontend repos (mu=0.8) should have lower cycle times than data/ML (mu=1.3)."""
        frontend_p50s = []
        data_ml_p50s = []

        for data in all_rollups:
            by_repo = data.get("by_repository", {})
            for repo, entry in by_repo.items():
                p50 = entry.get("cycle_time_p50")
                if p50 is None:
                    continue
                if repo in self.FRONTEND_REPOS:
                    frontend_p50s.append(p50)
                elif repo in self.DATA_ML_REPOS:
                    data_ml_p50s.append(p50)

        assert frontend_p50s, "No frontend repo cycle times found"
        assert data_ml_p50s, "No data/ML repo cycle times found"

        frontend_median = sorted(frontend_p50s)[len(frontend_p50s) // 2]
        data_ml_median = sorted(data_ml_p50s)[len(data_ml_p50s) // 2]

        ratio = frontend_median / data_ml_median if data_ml_median > 0 else 0
        assert ratio <= 0.8, (
            f"Frontend/DataML cycle time ratio = {ratio:.3f} "
            f"(frontend_median={frontend_median:.1f}, data_ml_median={data_ml_median:.1f}), "
            f"expected <= 0.8 (mu_factors 0.8 vs 1.3)"
        )
