#!/usr/bin/env python3
"""
Generate deterministic rule-based AI insights for GitHub Pages demo dashboard.

This script produces insights by analyzing weekly rollup data against
predefined thresholds. No LLM calls - fully deterministic rule-based generation.

Insight Templates (per data-model.md):
- bottleneck-001: P90 > 3x P50 in any repo (warning)
- bottleneck-002: P90 > 5 days in any repo (critical)
- trend-001: Throughput up 20%+ over 4 weeks (info)
- trend-002: Cycle time down 15%+ over 4 weeks (info)
- trend-003: Throughput down 20%+ over 4 weeks (warning)
- anomaly-001: PR count 2σ above rolling avg (info)
- anomaly-002: PR count 2σ below rolling avg (warning)
- anomaly-003: No PRs merged in 2+ weeks (critical)

Output: docs/data/insights/summary.json

Usage:
    python scripts/generate-demo-insights.py

Requirements:
    - Must run AFTER generate-demo-data.py (needs weekly rollups)
    - Python 3.11+ (pinned for cross-platform reproducibility)
"""

from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

# =============================================================================
# Configuration Constants
# =============================================================================

# Thresholds for insight detection
BOTTLENECK_P90_P50_RATIO = 3.0  # P90 > 3x P50 triggers bottleneck-001
BOTTLENECK_P90_DAYS = (
    5.0  # P90 > 5 days triggers bottleneck-002 (in minutes: 5 * 24 * 60)
)
BOTTLENECK_P90_MINUTES = BOTTLENECK_P90_DAYS * 24 * 60  # 7200 minutes

TREND_WEEKS = 4  # Look at last 4 weeks for trend detection
TREND_THROUGHPUT_INCREASE = 0.20  # 20% increase
TREND_THROUGHPUT_DECREASE = 0.20  # 20% decrease
TREND_CYCLE_TIME_DECREASE = 0.15  # 15% decrease

ANOMALY_SIGMA = 2.0  # 2 standard deviations
ANOMALY_ROLLING_WEEKS = 8  # Rolling window for average
ANOMALY_INACTIVE_WEEKS = 2  # Weeks with no PRs

# Paths
DATA_DIR = Path(__file__).parent.parent / "docs" / "data"
ROLLUPS_DIR = DATA_DIR / "aggregates" / "weekly_rollups"
INSIGHTS_DIR = DATA_DIR / "insights"
OUTPUT_FILE = INSIGHTS_DIR / "summary.json"
MANIFEST_FILE = DATA_DIR / "dataset-manifest.json"

# Schema version
INSIGHTS_SCHEMA_VERSION = 1


# =============================================================================
# Canonical JSON Utilities (matching generate-demo-data.py)
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
        processed, sort_keys=True, indent=indent, default=default_serializer
    )
    # Ensure LF line endings and trailing newline
    json_str = json_str.replace("\r\n", "\n")
    if not json_str.endswith("\n"):
        json_str += "\n"
    return json_str


def write_json_file(path: Path, data: Any) -> None:
    """Write data to JSON file with canonical formatting."""
    path.parent.mkdir(parents=True, exist_ok=True)
    content = canonical_json(data)
    path.write_text(content, encoding="utf-8", newline="\n")


# =============================================================================
# Data Structures
# =============================================================================


@dataclass
class RepoMetrics:
    """Metrics for a single repository in a week."""

    name: str
    pr_count: int
    cycle_time_p50: float
    cycle_time_p90: float


@dataclass
class WeeklyRollup:
    """Weekly rollup data."""

    week: str
    start_date: date
    pr_count: int
    cycle_time_p50: float
    cycle_time_p90: float
    repos: list[RepoMetrics] = field(default_factory=list)


@dataclass
class AffectedEntity:
    """Affected entity (team, repository, or user)."""

    type: str  # "repository", "team", or "user"
    id: str
    name: str


@dataclass
class Insight:
    """Generated insight."""

    id: str
    category: str
    severity: str
    title: str
    description: str
    affected_entities: list[AffectedEntity]
    evidence_refs: list[str] = field(default_factory=list)


# =============================================================================
# Data Loading
# =============================================================================


def load_weekly_rollups() -> list[WeeklyRollup]:
    """Load all weekly rollups with full repo breakdown."""
    rollups = []

    for rollup_file in sorted(ROLLUPS_DIR.glob("*.json")):
        with open(rollup_file, encoding="utf-8") as f:
            data = json.load(f)

        repos = []
        for repo_name, repo_data in data.get("by_repository", {}).items():
            repos.append(
                RepoMetrics(
                    name=repo_name,
                    pr_count=repo_data["pr_count"],
                    cycle_time_p50=repo_data["cycle_time_p50"],
                    cycle_time_p90=repo_data["cycle_time_p90"],
                )
            )

        rollups.append(
            WeeklyRollup(
                week=data["week"],
                start_date=date.fromisoformat(data["start_date"]),
                pr_count=data["pr_count"],
                cycle_time_p50=data["cycle_time_p50"],
                cycle_time_p90=data["cycle_time_p90"],
                repos=repos,
            )
        )

    return sorted(rollups, key=lambda r: r.week)


# =============================================================================
# Insight Generators (T041-T048)
# =============================================================================


def detect_bottleneck_001(rollups: list[WeeklyRollup]) -> list[Insight]:
    """
    T041: Detect repos where P90 > 3x P50 (warning severity).

    This indicates high variability - some PRs take much longer than typical.
    Scans entire dataset to find the most notable examples.
    """
    insights = []

    # Track best ratio for each repo across all weeks
    best_by_repo: dict[str, tuple[float, RepoMetrics, WeeklyRollup]] = {}

    for rollup in rollups:
        for repo in rollup.repos:
            # Only consider repos with multiple PRs (ratio is more meaningful)
            if repo.cycle_time_p50 > 0 and repo.pr_count >= 2:
                ratio = repo.cycle_time_p90 / repo.cycle_time_p50
                if ratio > BOTTLENECK_P90_P50_RATIO:
                    if (
                        repo.name not in best_by_repo
                        or ratio > best_by_repo[repo.name][0]
                    ):
                        best_by_repo[repo.name] = (ratio, repo, rollup)

    # Generate insights for top 2 repos with highest ratios
    sorted_repos = sorted(best_by_repo.items(), key=lambda x: x[1][0], reverse=True)[:2]

    for repo_name, (ratio, repo, rollup) in sorted_repos:
        insights.append(
            Insight(
                id=f"bottleneck-001-{repo_name}",
                category="bottleneck",
                severity="warning",
                title=f"High cycle time variability in {repo_name}",
                description=(
                    f"The {repo_name} repository showed high cycle time variability in {rollup.week}. "
                    f"The P90 cycle time ({round_float(repo.cycle_time_p90 / 60, 1)} hours) was "
                    f"{round_float(ratio, 1)}x higher than P50 ({round_float(repo.cycle_time_p50 / 60, 1)} hours). "
                    f"This suggests some PRs were getting stuck in review or blocked by dependencies."
                ),
                affected_entities=[
                    AffectedEntity(type="repository", id=repo_name, name=repo_name)
                ],
                evidence_refs=[f"rollup:{rollup.week}"],
            )
        )

    return insights


def detect_bottleneck_002(rollups: list[WeeklyRollup]) -> list[Insight]:
    """
    T042: Detect repos where P90 > 5 days (critical severity).

    This indicates severely slow PR completion times.
    """
    insights = []
    latest = rollups[-1]

    for repo in latest.repos:
        if repo.cycle_time_p90 > BOTTLENECK_P90_MINUTES:
            days = repo.cycle_time_p90 / (24 * 60)
            insights.append(
                Insight(
                    id=f"bottleneck-002-{repo.name}",
                    category="bottleneck",
                    severity="critical",
                    title=f"Critical slowdown in {repo.name}",
                    description=(
                        f"The {repo.name} repository has critically slow PR completion times. "
                        f"The P90 cycle time is {round_float(days, 1)} days, exceeding the 5-day threshold. "
                        f"Consider reviewing code review practices or breaking up large PRs."
                    ),
                    affected_entities=[
                        AffectedEntity(type="repository", id=repo.name, name=repo.name)
                    ],
                    evidence_refs=[f"rollup:{latest.week}"],
                )
            )

    return insights


def detect_trend_001(rollups: list[WeeklyRollup]) -> list[Insight]:
    """
    T043: Detect throughput increase of 20%+ over 4 weeks (info severity).

    Scans the entire dataset to find the most significant throughput increase.
    """
    insights = []
    if len(rollups) < TREND_WEEKS * 2:
        return insights

    best_change = 0.0
    best_period = None

    # Scan through all possible 4-week windows
    for i in range(TREND_WEEKS * 2, len(rollups)):
        recent = rollups[i - TREND_WEEKS : i]
        earlier = rollups[i - TREND_WEEKS * 2 : i - TREND_WEEKS]

        recent_avg = sum(r.pr_count for r in recent) / len(recent)
        earlier_avg = sum(r.pr_count for r in earlier) / len(earlier)

        if earlier_avg > 0:
            change = (recent_avg - earlier_avg) / earlier_avg
            if change > best_change and change >= TREND_THROUGHPUT_INCREASE:
                best_change = change
                best_period = (recent, earlier, recent_avg, earlier_avg)

    if best_period:
        recent, earlier, recent_avg, earlier_avg = best_period
        insights.append(
            Insight(
                id="trend-001",
                category="trend",
                severity="info",
                title="PR throughput surge detected",
                description=(
                    f"PR throughput increased by {round_float(best_change * 100, 0)}% during {recent[0].week} to {recent[-1].week}. "
                    f"Average weekly PRs went from {round_float(earlier_avg, 1)} to {round_float(recent_avg, 1)}. "
                    f"This surge could indicate a major release push or increased team capacity."
                ),
                affected_entities=[
                    AffectedEntity(type="team", id="all", name="All Teams")
                ],
                evidence_refs=[f"rollup:{r.week}" for r in recent],
            )
        )

    return insights


def detect_trend_002(rollups: list[WeeklyRollup]) -> list[Insight]:
    """
    T044: Detect cycle time decrease of 15%+ over 4 weeks (info severity).

    Scans the entire dataset to find the most significant cycle time improvement.
    """
    insights = []
    if len(rollups) < TREND_WEEKS * 2:
        return insights

    best_change = 0.0
    best_period = None

    # Scan through all possible 4-week windows
    for i in range(TREND_WEEKS * 2, len(rollups)):
        recent = rollups[i - TREND_WEEKS : i]
        earlier = rollups[i - TREND_WEEKS * 2 : i - TREND_WEEKS]

        recent_avg = sum(r.cycle_time_p50 for r in recent) / len(recent)
        earlier_avg = sum(r.cycle_time_p50 for r in earlier) / len(earlier)

        if earlier_avg > 0:
            change = (earlier_avg - recent_avg) / earlier_avg
            if change > best_change and change >= TREND_CYCLE_TIME_DECREASE:
                best_change = change
                best_period = (recent, earlier, recent_avg, earlier_avg)

    if best_period:
        recent, earlier, recent_avg, earlier_avg = best_period
        insights.append(
            Insight(
                id="trend-002",
                category="trend",
                severity="info",
                title="Cycle time improvement detected",
                description=(
                    f"PR cycle time decreased by {round_float(best_change * 100, 0)}% during {recent[0].week} to {recent[-1].week}. "
                    f"Median cycle time dropped from {round_float(earlier_avg / 60, 1)} hours to {round_float(recent_avg / 60, 1)} hours. "
                    f"This improvement suggests review processes became more efficient during this period."
                ),
                affected_entities=[
                    AffectedEntity(type="team", id="all", name="All Teams")
                ],
                evidence_refs=[f"rollup:{r.week}" for r in recent],
            )
        )

    return insights


def detect_trend_003(rollups: list[WeeklyRollup]) -> list[Insight]:
    """
    T045: Detect throughput decrease of 20%+ over 4 weeks (warning severity).

    Scans the entire dataset to find the most significant throughput decline.
    """
    insights = []
    if len(rollups) < TREND_WEEKS * 2:
        return insights

    best_change = 0.0
    best_period = None

    # Scan through all possible 4-week windows
    for i in range(TREND_WEEKS * 2, len(rollups)):
        recent = rollups[i - TREND_WEEKS : i]
        earlier = rollups[i - TREND_WEEKS * 2 : i - TREND_WEEKS]

        recent_avg = sum(r.pr_count for r in recent) / len(recent)
        earlier_avg = sum(r.pr_count for r in earlier) / len(earlier)

        if earlier_avg > 0:
            change = (earlier_avg - recent_avg) / earlier_avg
            if change > best_change and change >= TREND_THROUGHPUT_DECREASE:
                best_change = change
                best_period = (recent, earlier, recent_avg, earlier_avg)

    if best_period:
        recent, earlier, recent_avg, earlier_avg = best_period
        insights.append(
            Insight(
                id="trend-003",
                category="trend",
                severity="warning",
                title="PR throughput decline detected",
                description=(
                    f"PR throughput decreased by {round_float(best_change * 100, 0)}% during {recent[0].week} to {recent[-1].week}. "
                    f"Average weekly PRs dropped from {round_float(earlier_avg, 1)} to {round_float(recent_avg, 1)}. "
                    f"This decline may indicate team capacity issues, blockers, or seasonal slowdown."
                ),
                affected_entities=[
                    AffectedEntity(type="team", id="all", name="All Teams")
                ],
                evidence_refs=[f"rollup:{r.week}" for r in recent],
            )
        )

    return insights


def detect_anomaly_001(rollups: list[WeeklyRollup]) -> list[Insight]:
    """
    T046: Detect PR count 2 sigma above rolling average (info severity).

    Scans the entire dataset to find the most notable high-activity week.
    """
    insights = []
    if len(rollups) < ANOMALY_ROLLING_WEEKS + 1:
        return insights

    best_z = 0.0
    best_week = None

    # Scan all weeks (excluding first few that don't have enough history)
    for i in range(ANOMALY_ROLLING_WEEKS, len(rollups)):
        rolling_data = rollups[i - ANOMALY_ROLLING_WEEKS : i]
        current = rollups[i]

        pr_counts = [r.pr_count for r in rolling_data]
        mean = sum(pr_counts) / len(pr_counts)
        variance = sum((x - mean) ** 2 for x in pr_counts) / len(pr_counts)
        std_dev = math.sqrt(variance) if variance > 0 else 0

        if std_dev > 0:
            z_score = (current.pr_count - mean) / std_dev
            if z_score > best_z and z_score >= ANOMALY_SIGMA:
                best_z = z_score
                best_week = (current, mean, z_score)

    if best_week:
        current, mean, z_score = best_week
        insights.append(
            Insight(
                id="anomaly-001",
                category="anomaly",
                severity="info",
                title="High PR activity spike detected",
                description=(
                    f"Week {current.week} had {current.pr_count} PRs, which is {round_float(z_score, 1)} "
                    f"standard deviations above the {ANOMALY_ROLLING_WEEKS}-week rolling average of {round_float(mean, 1)}. "
                    f"This spike could indicate a major release, hackathon, or concentrated feature work."
                ),
                affected_entities=[
                    AffectedEntity(type="team", id="all", name="All Teams")
                ],
                evidence_refs=[f"rollup:{current.week}"],
            )
        )

    return insights


def detect_anomaly_002(rollups: list[WeeklyRollup]) -> list[Insight]:
    """
    T047: Detect PR count 2 sigma below rolling average (warning severity).

    Scans the entire dataset to find the most notable low-activity week.
    """
    insights = []
    if len(rollups) < ANOMALY_ROLLING_WEEKS + 1:
        return insights

    best_z = 0.0
    best_week = None

    # Scan all weeks (excluding first few that don't have enough history)
    for i in range(ANOMALY_ROLLING_WEEKS, len(rollups)):
        rolling_data = rollups[i - ANOMALY_ROLLING_WEEKS : i]
        current = rollups[i]

        pr_counts = [r.pr_count for r in rolling_data]
        mean = sum(pr_counts) / len(pr_counts)
        variance = sum((x - mean) ** 2 for x in pr_counts) / len(pr_counts)
        std_dev = math.sqrt(variance) if variance > 0 else 0

        if std_dev > 0:
            z_score = (mean - current.pr_count) / std_dev
            if z_score > best_z and z_score >= ANOMALY_SIGMA:
                best_z = z_score
                best_week = (current, mean, z_score)

    if best_week:
        current, mean, z_score = best_week
        insights.append(
            Insight(
                id="anomaly-002",
                category="anomaly",
                severity="warning",
                title="Low PR activity detected",
                description=(
                    f"Week {current.week} had only {current.pr_count} PRs, which is {round_float(z_score, 1)} "
                    f"standard deviations below the {ANOMALY_ROLLING_WEEKS}-week rolling average of {round_float(mean, 1)}. "
                    f"This dip could indicate team absences, blockers, or focus on non-PR work."
                ),
                affected_entities=[
                    AffectedEntity(type="team", id="all", name="All Teams")
                ],
                evidence_refs=[f"rollup:{current.week}"],
            )
        )

    return insights


def detect_anomaly_003(rollups: list[WeeklyRollup]) -> list[Insight]:
    """
    T048: Detect repos with no PRs merged in 2+ weeks (critical severity).
    """
    insights = []
    if len(rollups) < ANOMALY_INACTIVE_WEEKS:
        return insights

    recent = rollups[-ANOMALY_INACTIVE_WEEKS:]

    # Find all repos
    all_repos = set()
    for rollup in rollups:
        for repo in rollup.repos:
            all_repos.add(repo.name)

    # Check which repos had no PRs in recent weeks
    inactive_repos = []
    for repo_name in sorted(all_repos):
        has_activity = False
        for rollup in recent:
            for repo in rollup.repos:
                if repo.name == repo_name and repo.pr_count > 0:
                    has_activity = True
                    break
            if has_activity:
                break

        if not has_activity:
            inactive_repos.append(repo_name)

    for repo_name in inactive_repos[:3]:  # Limit to top 3 to avoid noise
        insights.append(
            Insight(
                id=f"anomaly-003-{repo_name}",
                category="anomaly",
                severity="critical",
                title=f"No recent activity in {repo_name}",
                description=(
                    f"The {repo_name} repository has had no merged PRs in the last {ANOMALY_INACTIVE_WEEKS} weeks. "
                    f"This could indicate the repository is inactive, blocked, or all work is happening on long-lived branches."
                ),
                affected_entities=[
                    AffectedEntity(type="repository", id=repo_name, name=repo_name)
                ],
                evidence_refs=[f"rollup:{r.week}" for r in recent],
            )
        )

    return insights


# =============================================================================
# Manifest Update (T050)
# =============================================================================


def update_manifest_insights_flag() -> None:
    """Update dataset-manifest.json to set features.ai_insights=true."""
    with open(MANIFEST_FILE, encoding="utf-8") as f:
        manifest = json.load(f)

    manifest["features"]["ai_insights"] = True

    write_json_file(MANIFEST_FILE, manifest)
    print(f"  Updated: {MANIFEST_FILE}")


# =============================================================================
# Main Generation
# =============================================================================


def main() -> int:
    """Generate insights data."""
    print("Generating demo insights...")
    print(f"Output: {INSIGHTS_DIR}")

    # Verify rollups exist
    if not ROLLUPS_DIR.exists():
        print(f"ERROR: Weekly rollups not found at {ROLLUPS_DIR}")
        print("Please run generate-demo-data.py first.")
        return 1

    # Load rollups
    print("\n[1/4] Loading weekly rollups...")
    rollups = load_weekly_rollups()
    print(f"  Loaded {len(rollups)} weekly rollups")

    # Generate insights (T041-T048)
    print("\n[2/4] Detecting insights...")
    all_insights: list[Insight] = []

    # Bottleneck insights
    bottleneck_001 = detect_bottleneck_001(rollups)
    bottleneck_002 = detect_bottleneck_002(rollups)
    all_insights.extend(bottleneck_001)
    all_insights.extend(bottleneck_002)
    print(f"  bottleneck-001 (P90/P50 ratio): {len(bottleneck_001)} insights")
    print(f"  bottleneck-002 (P90 > 5 days): {len(bottleneck_002)} insights")

    # Trend insights
    trend_001 = detect_trend_001(rollups)
    trend_002 = detect_trend_002(rollups)
    trend_003 = detect_trend_003(rollups)
    all_insights.extend(trend_001)
    all_insights.extend(trend_002)
    all_insights.extend(trend_003)
    print(f"  trend-001 (throughput up): {len(trend_001)} insights")
    print(f"  trend-002 (cycle time down): {len(trend_002)} insights")
    print(f"  trend-003 (throughput down): {len(trend_003)} insights")

    # Anomaly insights
    anomaly_001 = detect_anomaly_001(rollups)
    anomaly_002 = detect_anomaly_002(rollups)
    anomaly_003 = detect_anomaly_003(rollups)
    all_insights.extend(anomaly_001)
    all_insights.extend(anomaly_002)
    all_insights.extend(anomaly_003)
    print(f"  anomaly-001 (high activity): {len(anomaly_001)} insights")
    print(f"  anomaly-002 (low activity): {len(anomaly_002)} insights")
    print(f"  anomaly-003 (inactive repos): {len(anomaly_003)} insights")

    print(f"\n  Total insights generated: {len(all_insights)}")

    # T049: Ensure at least 5 diverse insights
    if len(all_insights) < 5:
        print(f"  WARNING: Only {len(all_insights)} insights generated (target: 5+)")

    # Build insights document
    print("\n[3/4] Writing insights/summary.json...")
    insights_data = {
        "schema_version": INSIGHTS_SCHEMA_VERSION,
        "generated_at": datetime(2026, 1, 30, 12, 0, 0, tzinfo=timezone.utc),
        "generated_by": "generate-demo-insights.py",
        "is_stub": False,
        "insights": [
            {
                "id": i.id,
                "category": i.category,
                "severity": i.severity,
                "title": i.title,
                "description": i.description,
                "affected_entities": [
                    {"type": e.type, "id": e.id, "name": e.name}
                    for e in i.affected_entities
                ],
                "evidence_refs": i.evidence_refs,
            }
            for i in all_insights
        ],
    }

    write_json_file(OUTPUT_FILE, insights_data)
    print(f"  Written: {OUTPUT_FILE}")

    # Update manifest (T050)
    print("\n[4/4] Updating dataset-manifest.json...")
    update_manifest_insights_flag()

    print("\nInsights generation complete!")

    # Summary by category
    by_category = {}
    for i in all_insights:
        by_category[i.category] = by_category.get(i.category, 0) + 1

    print("\nInsight summary:")
    for category, count in sorted(by_category.items()):
        print(f"  {category}: {count}")

    by_severity = {}
    for i in all_insights:
        by_severity[i.severity] = by_severity.get(i.severity, 0) + 1

    print("\nBy severity:")
    for severity, count in sorted(by_severity.items()):
        print(f"  {severity}: {count}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
