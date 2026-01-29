"""Chunked aggregate generator for Phase 3 UI.

Generates JSON aggregates from SQLite for scale-safe UI rendering:
- weekly_rollups/YYYY-Www.json - Weekly PR metrics
- distributions/YYYY.json - Yearly distribution data
- dimensions.json - Filter dimensions (repos, users, teams)
- dataset-manifest.json - Discovery metadata with schema versions
- predictions/trends.json - Trend forecasts (Phase 3.5)
- insights/summary.json - AI insights (Phase 3.5)
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import random
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pandas as pd

if TYPE_CHECKING:
    from ..persistence.database import DatabaseManager

logger = logging.getLogger(__name__)

# Schema versions (Phase 3 locked)
MANIFEST_SCHEMA_VERSION = 1
DATASET_SCHEMA_VERSION = 1
AGGREGATES_SCHEMA_VERSION = 1

# Phase 3.5 schema versions
PREDICTIONS_SCHEMA_VERSION = 1
INSIGHTS_SCHEMA_VERSION = 1

# Stub generator identifier
STUB_GENERATOR_ID = "phase3.5-stub-v1"


class AggregationError(Exception):
    """Aggregation failed."""


@dataclass
class WeeklyRollup:
    """Weekly PR metrics rollup."""

    week: str  # ISO week: YYYY-Www
    start_date: str  # ISO date
    end_date: str  # ISO date
    pr_count: int = 0
    cycle_time_p50: float | None = None
    cycle_time_p90: float | None = None
    authors_count: int = 0
    reviewers_count: int = 0


@dataclass
class YearlyDistribution:
    """Yearly distribution metrics."""

    year: str  # YYYY
    start_date: str
    end_date: str
    total_prs: int = 0
    cycle_time_buckets: dict[str, int] = field(default_factory=dict)
    prs_by_month: dict[str, int] = field(default_factory=dict)


@dataclass
class Dimensions:
    """Filter dimensions for UI."""

    repositories: list[dict[str, Any]] = field(default_factory=list)
    users: list[dict[str, Any]] = field(default_factory=list)
    projects: list[dict[str, Any]] = field(default_factory=list)
    teams: list[dict[str, Any]] = field(default_factory=list)  # Phase 3.3
    date_range: dict[str, str] = field(default_factory=dict)


@dataclass
class AggregateIndex:
    """Index of available aggregate files."""

    weekly_rollups: list[dict[str, Any]] = field(default_factory=list)
    distributions: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class DatasetManifest:
    """Dataset discovery manifest."""

    manifest_schema_version: int = MANIFEST_SCHEMA_VERSION
    dataset_schema_version: int = DATASET_SCHEMA_VERSION
    aggregates_schema_version: int = AGGREGATES_SCHEMA_VERSION
    predictions_schema_version: int = PREDICTIONS_SCHEMA_VERSION  # Phase 3.5
    insights_schema_version: int = INSIGHTS_SCHEMA_VERSION  # Phase 3.5
    generated_at: str = ""
    run_id: str = ""
    warnings: list[str] = field(default_factory=list)  # Phase 3.5: stub warnings
    aggregate_index: AggregateIndex = field(default_factory=AggregateIndex)
    defaults: dict[str, Any] = field(default_factory=dict)
    limits: dict[str, Any] = field(default_factory=dict)
    features: dict[str, bool] = field(default_factory=dict)
    coverage: dict[str, Any] = field(default_factory=dict)


class AggregateGenerator:
    """Generate chunked JSON aggregates from SQLite.

    Phase 3: Produces weekly rollups and distributions for lazy UI loading.
    Phase 3.5: Optionally generates predictions/insights stubs.
    Phase 5: Integrates Prophet forecaster and OpenAI insights.
    """

    def __init__(
        self,
        db: DatabaseManager,
        output_dir: Path,
        run_id: str = "",
        enable_ml_stubs: bool = False,
        seed_base: str = "",
        # Phase 5: ML parameters
        enable_predictions: bool = False,
        enable_insights: bool = False,
        insights_max_tokens: int = 1000,
        insights_cache_ttl_hours: int = 24,
        insights_dry_run: bool = False,
        stub_mode: bool = False,
    ) -> None:
        """Initialize the aggregate generator.

        Args:
            db: Database manager instance.
            output_dir: Directory for aggregate output.
            run_id: Pipeline run ID for manifest.
            enable_ml_stubs: Whether to generate stub predictions/insights (Phase 3.5).
            seed_base: Base string for deterministic stub seeding.
            enable_predictions: Enable Prophet-based forecasting (Phase 5).
            enable_insights: Enable OpenAI-based insights (Phase 5).
            insights_max_tokens: Max tokens for OpenAI response.
            insights_cache_ttl_hours: Cache TTL for insights.
            insights_dry_run: Write prompt artifact without calling API.
            stub_mode: Use deprecated stubs instead of real ML.
        """
        self.db = db
        self.output_dir = output_dir
        self.run_id = run_id or datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        self.enable_ml_stubs = enable_ml_stubs
        self.seed_base = seed_base or self.run_id
        # Phase 5
        self.enable_predictions = enable_predictions
        self.enable_insights = enable_insights
        self.insights_max_tokens = insights_max_tokens
        self.insights_cache_ttl_hours = insights_cache_ttl_hours
        self.insights_dry_run = insights_dry_run
        self.stub_mode = stub_mode

    def generate_all(self) -> DatasetManifest:
        """Generate all aggregate files and manifest.

        Returns:
            DatasetManifest with generated file index.

        Raises:
            AggregationError: If generation fails.
            StubGenerationError: If stubs requested without ALLOW_ML_STUBS env var.
        """
        import warnings as py_warnings

        # Create output directories
        self.output_dir.mkdir(parents=True, exist_ok=True)
        (self.output_dir / "aggregates").mkdir(exist_ok=True)
        (self.output_dir / "aggregates" / "weekly_rollups").mkdir(exist_ok=True)
        (self.output_dir / "aggregates" / "distributions").mkdir(exist_ok=True)

        try:
            # Generate dimensions
            dimensions = self._generate_dimensions()
            self._write_json(
                self.output_dir / "aggregates" / "dimensions.json",
                asdict(dimensions),
            )
            logger.info("Generated dimensions.json")

            # Generate weekly rollups
            weekly_index = self._generate_weekly_rollups()
            logger.info(f"Generated {len(weekly_index)} weekly rollup files")

            # Generate yearly distributions
            dist_index = self._generate_distributions()
            logger.info(f"Generated {len(dist_index)} distribution files")

            # Phase 5: ML features generation
            predictions_generated = False
            insights_generated = False
            warnings: list[str] = []

            # Stub mode (deprecated, for testing only)
            if self.stub_mode:
                py_warnings.warn(
                    "Stub mode is deprecated. Use --enable-predictions and "
                    "--enable-insights for real ML features.",
                    DeprecationWarning,
                    stacklevel=2,
                )
                # Use legacy stubs
                pred_gen = PredictionGenerator(self.output_dir, self.seed_base)
                pred_gen.generate()
                predictions_generated = True

                insights_gen = InsightsGenerator(self.output_dir, self.seed_base)
                insights_gen.generate()
                insights_generated = True

                warnings.append("STUB DATA - NOT PRODUCTION")
                logger.warning(
                    "Generated stub predictions/insights - NOT FOR PRODUCTION"
                )

            # Legacy enable_ml_stubs (LOUD WARNING - maps to stub mode)
            elif self.enable_ml_stubs:
                # Hard warning to prevent accidental stub usage in production
                logger.warning("=" * 80)
                logger.warning(
                    "WARNING: --enable-ml-stubs is DEPRECATED and generates "
                    "STUB DATA with is_stub:true"
                )
                logger.warning(
                    "Use --enable-predictions and --enable-insights for real ML features."
                )
                logger.warning(
                    "To explicitly use stubs for testing, use --stub-mode instead."
                )
                logger.warning("=" * 80)

                pred_gen = PredictionGenerator(self.output_dir, self.seed_base)
                pred_gen.generate()
                predictions_generated = True

                insights_gen = InsightsGenerator(self.output_dir, self.seed_base)
                insights_gen.generate()
                insights_generated = True

                warnings.append("STUB DATA - NOT PRODUCTION - DEPRECATED FLAG USED")
                logger.warning(
                    "Generated stub predictions/insights - NOT FOR PRODUCTION"
                )

            else:
                # Phase 5: Real ML features
                if self.enable_predictions:
                    predictions_generated = self._generate_predictions()

                if self.enable_insights:
                    insights_generated = self._generate_insights()

                # Check if files exist from previous runs
                if not predictions_generated:
                    predictions_generated = (
                        self.output_dir / "predictions" / "trends.json"
                    ).exists()
                if not insights_generated:
                    insights_generated = (
                        self.output_dir / "insights" / "summary.json"
                    ).exists()

            # Build manifest
            manifest = DatasetManifest(
                generated_at=datetime.now(timezone.utc).isoformat(),
                run_id=self.run_id,
                warnings=warnings,
                aggregate_index=AggregateIndex(
                    weekly_rollups=weekly_index,
                    distributions=dist_index,
                ),
                defaults={"default_date_range_days": 90},
                limits={"max_date_range_days_soft": 730},
                features={
                    "teams": len(dimensions.teams) > 0,  # Phase 3.3: dynamic
                    "comments": self._has_comments(),  # Phase 3.4: dynamic
                    "predictions": predictions_generated,  # Phase 3.5/5: file-gated
                    "ai_insights": insights_generated,  # Phase 3.5/5: file-gated
                },
                coverage={
                    "total_prs": self._get_pr_count(),
                    "date_range": dimensions.date_range,
                    "teams_count": len(dimensions.teams),  # Phase 3.3
                    "comments": self._get_comments_coverage(),  # Phase 3.4
                    # Phase 4 §5: Operational visibility
                    "row_counts": self._get_row_counts(),
                },
            )

            # Phase 4 §5: Calculate total artifact size after manifest written
            # We'll add this after initial manifest write
            manifest_dict = asdict(manifest)
            manifest_dict["operational"] = self._get_operational_summary(
                weekly_index, dist_index
            )

            # Write manifest
            self._write_json(
                self.output_dir / "dataset-manifest.json",
                manifest_dict,
            )
            logger.info("Generated dataset-manifest.json")

            return manifest

        except Exception as e:
            raise AggregationError(f"Failed to generate aggregates: {e}") from e

    def _generate_predictions(self) -> bool:
        """Generate predictions using best available forecaster (Phase 5).

        Uses get_forecaster() factory to auto-detect Prophet availability.
        Falls back to linear regression (FallbackForecaster) when Prophet
        is not installed, enabling zero-config predictions (FR-001).

        Returns:
            True if predictions file was successfully written, False otherwise.
        """
        try:
            from ..ml import get_forecaster

            forecaster = get_forecaster(
                db=self.db,
                output_dir=self.output_dir,
            )
            return forecaster.generate()
        except Exception as e:
            logger.warning(f"Prediction generation failed: {type(e).__name__}: {e}")
            return False

    def _generate_insights(self) -> bool:
        """Generate OpenAI-based insights (Phase 5).

        Returns:
            True if insights file was written, False otherwise.
        """
        try:
            from ..ml.insights import LLMInsightsGenerator
        except ImportError:
            # This should not happen as CLI validates openai is installed
            logger.error(
                "OpenAI SDK not installed. Install ML extras: pip install -e '.[ml]'"
            )
            raise AggregationError(
                "OpenAI SDK required for --enable-insights"
            ) from None

        try:
            insights_gen = LLMInsightsGenerator(
                db=self.db,
                output_dir=self.output_dir,
                max_tokens=self.insights_max_tokens,
                cache_ttl_hours=self.insights_cache_ttl_hours,
                dry_run=self.insights_dry_run,
            )
            return insights_gen.generate()
        except Exception as e:
            logger.warning(f"Insights generation failed: {type(e).__name__}: {e}")
            return False

    def _generate_dimensions(self) -> Dimensions:
        """Generate filter dimensions from SQLite."""
        # Repositories
        repos_df = pd.read_sql_query(
            """
            SELECT repository_id, repository_name, project_name, organization_name
            FROM repositories
            ORDER BY organization_name, project_name, repository_name
            """,
            self.db.connection,
        )

        # Users (authors only, not all users)
        users_df = pd.read_sql_query(
            """
            SELECT DISTINCT u.user_id, u.display_name
            FROM users u
            INNER JOIN pull_requests pr ON pr.user_id = u.user_id
            ORDER BY u.display_name
            """,
            self.db.connection,
        )

        # Projects
        projects_df = pd.read_sql_query(
            """
            SELECT organization_name, project_name
            FROM projects
            ORDER BY organization_name, project_name
            """,
            self.db.connection,
        )

        # Date range
        date_range_df = pd.read_sql_query(
            """
            SELECT MIN(closed_date) as min_date, MAX(closed_date) as max_date
            FROM pull_requests
            WHERE closed_date IS NOT NULL
            """,
            self.db.connection,
        )

        date_range = {}
        if not date_range_df.empty and date_range_df.iloc[0]["min_date"]:
            date_range = {
                "min": date_range_df.iloc[0]["min_date"][:10],  # YYYY-MM-DD
                "max": date_range_df.iloc[0]["max_date"][:10],
            }

        # Phase 3.3: Teams (defensive for legacy DBs without teams table)
        try:
            teams_df = pd.read_sql_query(
                """
                SELECT t.team_id, t.team_name, t.project_name, t.organization_name,
                       COUNT(tm.user_id) as member_count
                FROM teams t
                LEFT JOIN team_members tm ON t.team_id = tm.team_id
                GROUP BY t.team_id, t.team_name, t.project_name, t.organization_name
                ORDER BY t.organization_name, t.project_name, t.team_name
                """,
                self.db.connection,
            )
        except Exception as e:
            # P1 fix: Legacy databases may not have teams table
            logger.debug(f"Teams table not available (legacy DB?): {e}")
            teams_df = pd.DataFrame()

        # Cast pandas dict records to list[dict[str, Any]] for type safety
        # pandas to_dict returns dict[Hashable, Any], we need dict[str, Any]
        repos_records: list[dict[str, Any]] = [
            {str(k): v for k, v in r.items()}
            for r in repos_df.to_dict(orient="records")
        ]
        users_records: list[dict[str, Any]] = [
            {str(k): v for k, v in r.items()}
            for r in users_df.to_dict(orient="records")
        ]
        projects_records: list[dict[str, Any]] = [
            {str(k): v for k, v in r.items()}
            for r in projects_df.to_dict(orient="records")
        ]
        teams_records: list[dict[str, Any]] = (
            [
                {str(k): v for k, v in r.items()}
                for r in teams_df.to_dict(orient="records")
            ]
            if not teams_df.empty
            else []
        )
        return Dimensions(
            repositories=repos_records,
            users=users_records,
            projects=projects_records,
            teams=teams_records,
            date_range=date_range,
        )

    def _generate_weekly_rollups(self) -> list[dict[str, Any]]:
        """Generate weekly rollup files, one per ISO week."""
        # Query PRs with closed dates and repository info for dimension slicing
        df = pd.read_sql_query(
            """
            SELECT
                pr.closed_date,
                pr.cycle_time_minutes,
                pr.user_id,
                pr.pull_request_uid,
                pr.repository_id,
                r.repository_name
            FROM pull_requests pr
            LEFT JOIN repositories r ON pr.repository_id = r.repository_id
            WHERE pr.closed_date IS NOT NULL AND pr.status = 'completed'
            ORDER BY pr.closed_date
            """,
            self.db.connection,
        )

        if df.empty:
            return []

        # Query reviewers data separately for counting unique reviewers per PR
        reviewers_df = pd.read_sql_query(
            """
            SELECT
                rv.pull_request_uid,
                rv.user_id as reviewer_id
            FROM reviewers rv
            """,
            self.db.connection,
        )

        # Query team_members for team-based slicing (defensive for legacy DBs)
        try:
            team_members_df = pd.read_sql_query(
                """
                SELECT tm.user_id, t.team_name
                FROM team_members tm
                INNER JOIN teams t ON tm.team_id = t.team_id
                """,
                self.db.connection,
            )
        except Exception as e:
            # Legacy DBs may not have team_members table
            logger.debug(f"Team members table not available (legacy DB?): {e}")
            team_members_df = pd.DataFrame()

        # Convert to datetime and extract ISO week
        df["closed_dt"] = pd.to_datetime(df["closed_date"])
        df["iso_year"] = df["closed_dt"].dt.isocalendar().year
        df["iso_week"] = df["closed_dt"].dt.isocalendar().week

        index: list[dict[str, Any]] = []

        # Group by ISO year-week
        for (iso_year, iso_week), group in df.groupby(["iso_year", "iso_week"]):
            week_str = f"{iso_year}-W{iso_week:02d}"

            # iso_year/iso_week come from pandas isocalendar() which are UInt32
            # Cast via intermediate to satisfy mypy (Hashable -> int)
            year_int = int(str(iso_year))
            week_int = int(str(iso_week))
            start_date = date.fromisocalendar(year_int, week_int, 1)
            end_date = date.fromisocalendar(year_int, week_int, 7)

            # Count unique reviewers for PRs in this week
            week_pr_uids = set(group["pull_request_uid"].tolist())
            week_reviewers = reviewers_df[
                reviewers_df["pull_request_uid"].isin(week_pr_uids)
            ]
            reviewers_count = week_reviewers["reviewer_id"].nunique()

            # Generate dimension slices for filtering support
            by_repository = self._generate_repo_slice(group, week_reviewers)
            by_team = self._generate_team_slice(group, week_reviewers, team_members_df)

            rollup = WeeklyRollup(
                week=week_str,
                start_date=start_date.isoformat(),
                end_date=end_date.isoformat(),
                pr_count=len(group),
                cycle_time_p50=group["cycle_time_minutes"].quantile(0.5)
                if not group["cycle_time_minutes"].isna().all()
                else None,
                cycle_time_p90=group["cycle_time_minutes"].quantile(0.9)
                if not group["cycle_time_minutes"].isna().all()
                else None,
                authors_count=group["user_id"].nunique(),
                reviewers_count=reviewers_count,
            )

            # Build rollup dict with dimension slices
            rollup_dict = asdict(rollup)
            if by_repository:
                rollup_dict["by_repository"] = by_repository
            if by_team:
                rollup_dict["by_team"] = by_team

            # Write file
            file_path = (
                self.output_dir / "aggregates" / "weekly_rollups" / f"{week_str}.json"
            )
            self._write_json(file_path, rollup_dict)

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

    def _generate_repo_slice(
        self, week_group: pd.DataFrame, week_reviewers: pd.DataFrame
    ) -> dict[str, Any]:
        """Generate per-repository metrics slice for a week.

        Args:
            week_group: DataFrame of PRs for the week
            week_reviewers: DataFrame of reviewers for PRs in this week

        Returns:
            Dict mapping repository_name to metrics
        """
        by_repository: dict[str, Any] = {}

        for repo_name, repo_group in week_group.groupby("repository_name"):
            if pd.isna(repo_name):
                continue

            repo_pr_uids = set(repo_group["pull_request_uid"].tolist())
            repo_reviewers = week_reviewers[
                week_reviewers["pull_request_uid"].isin(repo_pr_uids)
            ]

            by_repository[str(repo_name)] = {
                "pr_count": len(repo_group),
                "cycle_time_p50": repo_group["cycle_time_minutes"].quantile(0.5)
                if not repo_group["cycle_time_minutes"].isna().all()
                else None,
                "cycle_time_p90": repo_group["cycle_time_minutes"].quantile(0.9)
                if not repo_group["cycle_time_minutes"].isna().all()
                else None,
                "authors_count": repo_group["user_id"].nunique(),
                "reviewers_count": repo_reviewers["reviewer_id"].nunique(),
            }

        return by_repository

    def _generate_team_slice(
        self,
        week_group: pd.DataFrame,
        week_reviewers: pd.DataFrame,
        team_members_df: pd.DataFrame,
    ) -> dict[str, Any]:
        """Generate per-team metrics slice for a week.

        Authors in multiple teams will have their PRs counted in each team's slice.
        This is intentional: "show me PRs for team X" means any PR authored by
        someone who is a member of team X, even if they're also on team Y.

        Global totals should be computed from the base rollup, not by summing
        team slices, to avoid double-counting.

        Args:
            week_group: DataFrame of PRs for the week (must have user_id column)
            week_reviewers: DataFrame of reviewers for PRs in this week
            team_members_df: DataFrame with team_name and user_id columns

        Returns:
            Dict mapping team_name to metrics, empty if no team data
        """
        if team_members_df.empty:
            return {}

        by_team: dict[str, Any] = {}

        # Get unique team names
        team_names = team_members_df["team_name"].unique()

        for team_name in team_names:
            if pd.isna(team_name):
                continue

            # Get team members
            team_member_ids = set(
                team_members_df[team_members_df["team_name"] == team_name][
                    "user_id"
                ].tolist()
            )

            # Filter PRs to those authored by team members
            team_prs = week_group[week_group["user_id"].isin(team_member_ids)]

            if team_prs.empty:
                continue

            # Get reviewers for team PRs
            team_pr_uids = set(team_prs["pull_request_uid"].tolist())
            team_reviewers = week_reviewers[
                week_reviewers["pull_request_uid"].isin(team_pr_uids)
            ]

            by_team[str(team_name)] = {
                "pr_count": len(team_prs),
                "cycle_time_p50": team_prs["cycle_time_minutes"].quantile(0.5)
                if not team_prs["cycle_time_minutes"].isna().all()
                else None,
                "cycle_time_p90": team_prs["cycle_time_minutes"].quantile(0.9)
                if not team_prs["cycle_time_minutes"].isna().all()
                else None,
                "authors_count": team_prs["user_id"].nunique(),
                "reviewers_count": team_reviewers["reviewer_id"].nunique(),
            }

        return by_team

    def _generate_distributions(self) -> list[dict[str, Any]]:
        """Generate yearly distribution files."""
        df = pd.read_sql_query(
            """
            SELECT
                closed_date,
                cycle_time_minutes
            FROM pull_requests
            WHERE closed_date IS NOT NULL AND status = 'completed'
            ORDER BY closed_date
            """,
            self.db.connection,
        )

        if df.empty:
            return []

        df["closed_dt"] = pd.to_datetime(df["closed_date"])
        df["year"] = df["closed_dt"].dt.year
        df["month"] = df["closed_dt"].dt.strftime("%Y-%m")

        index: list[dict[str, Any]] = []

        for year, group in df.groupby("year"):
            year_str = str(year)

            # Cycle time buckets (in hours)
            cycle_times = group["cycle_time_minutes"].dropna() / 60  # Convert to hours
            buckets = {
                "0-1h": int((cycle_times < 1).sum()),
                "1-4h": int(((cycle_times >= 1) & (cycle_times < 4)).sum()),
                "4-24h": int(((cycle_times >= 4) & (cycle_times < 24)).sum()),
                "1-3d": int(((cycle_times >= 24) & (cycle_times < 72)).sum()),
                "3-7d": int(((cycle_times >= 72) & (cycle_times < 168)).sum()),
                "7d+": int((cycle_times >= 168).sum()),
            }

            # PRs by month
            prs_by_month = group.groupby("month").size().to_dict()

            dist = YearlyDistribution(
                year=year_str,
                start_date=f"{year_str}-01-01",
                end_date=f"{year_str}-12-31",
                total_prs=len(group),
                cycle_time_buckets=buckets,
                prs_by_month={str(k): int(v) for k, v in prs_by_month.items()},
            )

            # Write file
            file_path = (
                self.output_dir / "aggregates" / "distributions" / f"{year_str}.json"
            )
            self._write_json(file_path, asdict(dist))

            index.append(
                {
                    "year": year_str,
                    "path": f"aggregates/distributions/{year_str}.json",
                    "start_date": dist.start_date,
                    "end_date": dist.end_date,
                    "size_bytes": file_path.stat().st_size,
                }
            )

        return index

    def _get_pr_count(self) -> int:
        """Get total PR count."""
        cursor = self.db.execute(
            "SELECT COUNT(*) as cnt FROM pull_requests WHERE status = 'completed'"
        )
        row = cursor.fetchone()
        return int(row["cnt"]) if row else 0

    def _has_comments(self) -> bool:
        """Check if comments data exists."""
        try:
            cursor = self.db.execute("SELECT COUNT(*) as cnt FROM pr_threads")
            row = cursor.fetchone()
            return int(row["cnt"]) > 0 if row else False
        except Exception:
            # Legacy DB may not have pr_threads table
            return False

    def _get_comments_coverage(self) -> dict[str, Any]:
        """Get comments coverage statistics.

        §6: coverage.comments: "full" | "partial" | "disabled"
        """
        try:
            # Count threads and comments
            thread_cursor = self.db.execute("SELECT COUNT(*) as cnt FROM pr_threads")
            thread_row = thread_cursor.fetchone()
            thread_count = int(thread_row["cnt"]) if thread_row else 0

            comment_cursor = self.db.execute("SELECT COUNT(*) as cnt FROM pr_comments")
            comment_row = comment_cursor.fetchone()
            comment_count = int(comment_row["cnt"]) if comment_row else 0

            # Count PRs with threads
            prs_with_threads_cursor = self.db.execute(
                "SELECT COUNT(DISTINCT pull_request_uid) as cnt FROM pr_threads"
            )
            prs_with_threads_row = prs_with_threads_cursor.fetchone()
            prs_with_threads = (
                int(prs_with_threads_row["cnt"]) if prs_with_threads_row else 0
            )
        except Exception:
            # Legacy DB may not have comments tables
            thread_count = 0
            comment_count = 0
            prs_with_threads = 0

        if thread_count == 0:
            status = "disabled"
        else:
            # For now, assume full coverage if any comments exist
            # A more complex implementation would track capped state
            status = "full"

        return {
            "status": status,
            "threads_fetched": thread_count,
            "comments_fetched": comment_count,
            "prs_with_threads": prs_with_threads,
            "capped": False,  # Set by extraction when limits hit
        }

    def _get_row_counts(self) -> dict[str, int]:
        """Get row counts for key tables (Phase 4 §5: Operational visibility)."""
        counts: dict[str, int] = {}

        # PRs
        try:
            cursor = self.db.execute("SELECT COUNT(*) as cnt FROM pull_requests")
            row = cursor.fetchone()
            counts["pull_requests"] = int(row["cnt"]) if row else 0
        except Exception:
            counts["pull_requests"] = 0

        # Reviewers
        try:
            cursor = self.db.execute("SELECT COUNT(*) as cnt FROM reviewers")
            row = cursor.fetchone()
            counts["reviewers"] = int(row["cnt"]) if row else 0
        except Exception:
            counts["reviewers"] = 0

        # Users
        try:
            cursor = self.db.execute("SELECT COUNT(*) as cnt FROM users")
            row = cursor.fetchone()
            counts["users"] = int(row["cnt"]) if row else 0
        except Exception:
            counts["users"] = 0

        # Repositories
        try:
            cursor = self.db.execute("SELECT COUNT(*) as cnt FROM repositories")
            row = cursor.fetchone()
            counts["repositories"] = int(row["cnt"]) if row else 0
        except Exception:
            counts["repositories"] = 0

        return counts

    def _get_operational_summary(
        self,
        weekly_index: list[dict[str, Any]],
        dist_index: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Generate operational summary for operators (Phase 4 §5).

        Provides immediate insight into dataset health and scale.
        """
        # Calculate total artifact size from indexes
        total_size = sum(item.get("size_bytes", 0) for item in weekly_index)
        total_size += sum(item.get("size_bytes", 0) for item in dist_index)

        # Add dimensions file size if it exists
        dimensions_path = self.output_dir / "aggregates" / "dimensions.json"
        if dimensions_path.exists():
            total_size += dimensions_path.stat().st_size

        # Add predictions/insights sizes if they exist
        for extra_file in [
            self.output_dir / "predictions" / "trends.json",
            self.output_dir / "insights" / "summary.json",
        ]:
            if extra_file.exists():
                total_size += extra_file.stat().st_size

        return {
            "artifact_size_bytes": total_size,
            "weekly_rollup_count": len(weekly_index),
            "distribution_count": len(dist_index),
            "retention_notice": (
                "Data older than 2 years may have reduced detail. "
                "Consider archiving old data periodically."
                if len(dist_index) > 2
                else None
            ),
        }

    def _write_json(self, path: Path, data: dict[str, Any]) -> None:
        """Write JSON file with deterministic formatting."""
        with path.open("w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, sort_keys=True)


class StubGenerationError(Exception):
    """Stub generation failed due to missing ALLOW_ML_STUBS env var."""


class PredictionGenerator:
    """Generate predictions stub data for Phase 3.5.

    Produces deterministic synthetic forecasts using a stable seed.
    Only enabled with --enable-ml-stubs AND ALLOW_ML_STUBS=1 env var.
    """

    METRICS = [
        ("pr_throughput", "count"),
        ("cycle_time_minutes", "minutes"),
        ("review_time_minutes", "minutes"),
    ]
    HORIZON_WEEKS = 4

    def __init__(
        self,
        output_dir: Path,
        seed_base: str = "",
    ) -> None:
        """Initialize the prediction generator.

        Args:
            output_dir: Directory for output files.
            seed_base: Base string for deterministic seeding (e.g., org+project).
        """
        self.output_dir = output_dir
        self.seed_base = seed_base

    def generate(self) -> dict[str, Any] | None:
        """Generate predictions stub file.

        Returns:
            Dict with predictions data if generated, None otherwise.

        Raises:
            StubGenerationError: If ALLOW_ML_STUBS env var not set.
        """
        if not os.environ.get("ALLOW_ML_STUBS") == "1":
            raise StubGenerationError(
                "Stub generation requires ALLOW_ML_STUBS=1 environment variable. "
                "This is a safety gate to prevent accidental use of synthetic data."
            )

        predictions_dir = self.output_dir / "predictions"
        predictions_dir.mkdir(parents=True, exist_ok=True)

        forecasts = []
        today = date.today()
        # Monday-align to start of current week
        start_monday = today - timedelta(days=today.weekday())

        for metric, unit in self.METRICS:
            values = []
            for week_offset in range(self.HORIZON_WEEKS):
                period_start = start_monday + timedelta(weeks=week_offset)

                # Deterministic seed per metric+period
                seed_str = f"{self.seed_base}:{metric}:{period_start.isoformat()}"
                seed = int(hashlib.sha256(seed_str.encode()).hexdigest()[:8], 16)
                rng = random.Random(seed)  # noqa: S311 -- REASON: intentional for deterministic stubs

                # Generate synthetic values based on metric type
                if metric == "pr_throughput":
                    base_value = rng.randint(15, 45)
                    variance = rng.randint(3, 10)
                else:  # time metrics in minutes
                    base_value = rng.randint(120, 480)
                    variance = rng.randint(30, 120)

                values.append(
                    {
                        "period_start": period_start.isoformat(),
                        "predicted": base_value,
                        "lower_bound": max(0, base_value - variance),
                        "upper_bound": base_value + variance,
                    }
                )

            forecasts.append(
                {
                    "metric": metric,
                    "unit": unit,
                    "horizon_weeks": self.HORIZON_WEEKS,
                    "values": values,
                }
            )

        predictions = {
            "schema_version": PREDICTIONS_SCHEMA_VERSION,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "is_stub": True,
            "generated_by": STUB_GENERATOR_ID,
            "forecasts": forecasts,
        }

        # Write file
        file_path = predictions_dir / "trends.json"
        with file_path.open("w", encoding="utf-8") as f:
            json.dump(predictions, f, indent=2, sort_keys=True)

        logger.info("Generated predictions/trends.json (stub data)")
        return predictions


class InsightsGenerator:
    """Generate AI insights stub data for Phase 3.5.

    Produces deterministic synthetic insights using a stable seed.
    Only enabled with --enable-ml-stubs AND ALLOW_ML_STUBS=1 env var.
    """

    # Sample insight templates for stub generation
    INSIGHT_TEMPLATES = [
        {
            "category": "bottleneck",
            "severity": "warning",
            "title": "Code review latency increasing",
            "description": "Average time from PR creation to first review has increased "
            "by 15% over the past 4 weeks. This may indicate reviewer capacity constraints.",
        },
        {
            "category": "trend",
            "severity": "info",
            "title": "PR throughput stable",
            "description": "Weekly PR merge rate has remained consistent at approximately "
            "25-30 PRs per week over the analyzed period.",
        },
        {
            "category": "anomaly",
            "severity": "critical",
            "title": "Unusual cycle time spike detected",
            "description": "P90 cycle time increased significantly in the most recent week, "
            "exceeding the historical 95th percentile threshold.",
        },
    ]

    def __init__(
        self,
        output_dir: Path,
        seed_base: str = "",
    ) -> None:
        """Initialize the insights generator.

        Args:
            output_dir: Directory for output files.
            seed_base: Base string for deterministic seeding.
        """
        self.output_dir = output_dir
        self.seed_base = seed_base

    def generate(self) -> dict[str, Any] | None:
        """Generate insights stub file.

        Returns:
            Dict with insights data if generated, None otherwise.

        Raises:
            StubGenerationError: If ALLOW_ML_STUBS env var not set.
        """
        if not os.environ.get("ALLOW_ML_STUBS") == "1":
            raise StubGenerationError(
                "Stub generation requires ALLOW_ML_STUBS=1 environment variable."
            )

        insights_dir = self.output_dir / "insights"
        insights_dir.mkdir(parents=True, exist_ok=True)

        # Deterministic selection of insights based on seed
        seed_str = f"{self.seed_base}:insights"
        seed = int(hashlib.sha256(seed_str.encode()).hexdigest()[:8], 16)
        rng = random.Random(seed)  # noqa: S311 -- REASON: intentional for deterministic stubs

        # Generate 2-3 insights from templates
        num_insights = rng.randint(2, 3)
        selected_templates = rng.sample(
            self.INSIGHT_TEMPLATES, min(num_insights, len(self.INSIGHT_TEMPLATES))
        )

        insights_list = []
        for i, template in enumerate(selected_templates):
            insight_id = hashlib.sha256(
                f"{self.seed_base}:insight:{i}".encode()
            ).hexdigest()[:12]

            insights_list.append(
                {
                    "id": f"stub-{insight_id}",
                    "category": template["category"],
                    "severity": template["severity"],
                    "title": template["title"],
                    "description": template["description"],
                    "affected_entities": [
                        f"project:{self.seed_base.split(':')[0] if ':' in self.seed_base else 'default'}"
                    ],
                    "evidence_refs": [],
                }
            )

        insights = {
            "schema_version": INSIGHTS_SCHEMA_VERSION,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "is_stub": True,
            "generated_by": STUB_GENERATOR_ID,
            "insights": insights_list,
        }

        # Write file
        file_path = insights_dir / "summary.json"
        with file_path.open("w", encoding="utf-8") as f:
            json.dump(insights, f, indent=2, sort_keys=True)

        logger.info("Generated insights/summary.json (stub data)")
        return insights
