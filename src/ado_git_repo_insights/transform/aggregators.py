"""Chunked aggregate generator for Phase 3 UI.

Generates JSON aggregates from SQLite for scale-safe UI rendering:
- weekly_rollups/YYYY-Www.json - Weekly PR metrics
- distributions/YYYY.json - Yearly distribution data
- dimensions.json - Filter dimensions (repos, users, reviewers, teams)
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
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, cast

import numpy as np
import pandas as pd

from ..extraction.vote_events import is_vote_event
from ..types import (
    AuthorRecord,
    CommentsCoverage,
    DistributionIndexEntry,
    JSONValue,
    OperationalSummary,
    ProjectRecord,
    PrRecord,
    RepositoryRecord,
    ReviewerRecord,
    ReviewerSliceMetrics,
    SliceMetrics,
    TeamRecord,
    UserRecord,
    WeeklyRollupIndexEntry,
)
from .constants import FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL
from .schema_versions import (
    AGGREGATES_SCHEMA_VERSION,
    DATASET_SCHEMA_VERSION,
    INSIGHTS_SCHEMA_VERSION,
    MANIFEST_CAPABILITY_KEYS,
    MANIFEST_SCHEMA_VERSION,
    PREDICTIONS_SCHEMA_VERSION,
)

if TYPE_CHECKING:
    from ..persistence.database import DatabaseManager

logger = logging.getLogger(__name__)


class _NumpySafeEncoder(json.JSONEncoder):
    """JSON encoder that converts numpy types to native Python types.

    Pandas quantile/nunique return numpy.float64/numpy.int64 which are
    technically JSON-serializable (subclasses of float/int) but can carry
    NaN/Inf values that violate the JSON spec. This encoder converts them
    to native Python types so allow_nan=False can reject invalid values.
    """

    def default(self, o: object) -> object:
        if isinstance(o, np.integer):
            return int(o)
        if isinstance(o, np.floating):
            return float(o)
        if isinstance(o, np.ndarray):
            return o.tolist()
        return super().default(o)


# Stub generator identifier
STUB_GENERATOR_ID = "phase3.5-stub-v1"

# Feature 060 (FR-002): cap for per-week PR-level detail arrays. Locked at 500
# by the spec; expanding requires a fresh scoping round.
_PR_DETAIL_CAP = 500

# Feature 336 (T016 / FR-1-12 / CL-15): pr_comments.author_id structural
# invariants enforced by ``_compute_weekly_by_reviewer_comments``.  The
# persisted schema's ``users.user_id`` / ``pr_comments.author_id`` columns
# are TEXT NOT NULL with a FK relationship — the aggregator validates
# only what the schema actually guarantees:
#   * ``commenter_or_sentinel`` is non-NULL.
#   * ``commenter_or_sentinel`` is non-empty (an empty string would imply
#     extractor corruption AND a matching empty-string ``users.user_id``;
#     it is never a valid commenter identity).
# An earlier draft of the aggregator additionally enforced UUID-shape on
# the value, but that gate was stricter than the persisted contract and
# rejected legitimate non-UUID stable IDs in datasets that pre-dated the
# UUID convention.  PR review removed the UUID gate; UUID-shape lives
# on in the demo synthesizer (deterministic demo generation only) but is
# NOT a production aggregation invariant.  The sentinel literal is the
# by-design exception per CL-03 / INV-4-12 and passes through unchanged.


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
    review_time_p50: float | None = None
    review_time_p90: float | None = None
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

    repositories: list[RepositoryRecord] = field(default_factory=list)
    users: list[UserRecord] = field(default_factory=list)
    authors: list[AuthorRecord] = field(default_factory=list)
    reviewers: list[ReviewerRecord] = field(default_factory=list)
    projects: list[ProjectRecord] = field(default_factory=list)
    teams: list[TeamRecord] = field(default_factory=list)  # Phase 3.3
    date_range: dict[str, str] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Per-entity DataFrame → typed record conversion functions (FR-014)
# ---------------------------------------------------------------------------


def _df_to_repository_records(df: pd.DataFrame) -> list[RepositoryRecord]:
    """Narrow repositories DataFrame to typed records."""
    return [
        RepositoryRecord(
            repository_id=r["repository_id"],
            repository_name=r["repository_name"],
            project_name=r["project_name"],
            organization_name=r["organization_name"],
        )
        for r in df.to_dict(orient="records")
    ]


def _df_to_user_records(df: pd.DataFrame) -> list[UserRecord]:
    """Narrow users DataFrame to typed records."""
    return [
        UserRecord(user_id=r["user_id"], display_name=r["display_name"])
        for r in df.to_dict(orient="records")
    ]


def _df_to_author_records(df: pd.DataFrame) -> list[AuthorRecord]:
    """Narrow users DataFrame to author records (renamed fields)."""
    return [
        AuthorRecord(author_id=r["user_id"], author_name=r["display_name"])
        for r in df.to_dict(orient="records")
    ]


def _df_to_reviewer_records(df: pd.DataFrame) -> list[ReviewerRecord]:
    """Narrow reviewers DataFrame to typed records."""
    return [
        ReviewerRecord(reviewer_id=r["reviewer_id"], reviewer_name=r["reviewer_name"])
        for r in df.to_dict(orient="records")
    ]


def _df_to_project_records(df: pd.DataFrame) -> list[ProjectRecord]:
    """Narrow projects DataFrame to typed records."""
    return [
        ProjectRecord(
            organization_name=r["organization_name"], project_name=r["project_name"]
        )
        for r in df.to_dict(orient="records")
    ]


def _df_to_team_records(df: pd.DataFrame) -> list[TeamRecord]:
    """Narrow teams DataFrame to typed records."""
    return [
        TeamRecord(
            team_id=r["team_id"],
            team_name=r["team_name"],
            project_name=r["project_name"],
            organization_name=r["organization_name"],
            member_count=r["member_count"],
        )
        for r in df.to_dict(orient="records")
    ]


@dataclass
class AggregateIndex:
    """Index of available aggregate files."""

    weekly_rollups: list[WeeklyRollupIndexEntry] = field(default_factory=list)
    distributions: list[DistributionIndexEntry] = field(default_factory=list)


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
    defaults: dict[str, int] = field(default_factory=dict)
    limits: dict[str, int] = field(default_factory=dict)
    features: dict[str, bool] = field(default_factory=dict)
    capabilities: dict[str, str | bool] = field(default_factory=dict)
    coverage: dict[str, JSONValue] = field(default_factory=dict)


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
        self.run_id = run_id or datetime.now(UTC).strftime("%Y%m%d%H%M%S")
        self.enable_ml_stubs = enable_ml_stubs
        self.seed_base = seed_base or self.run_id
        # Phase 5
        self.enable_predictions = enable_predictions
        self.enable_insights = enable_insights
        self.insights_max_tokens = insights_max_tokens
        self.insights_cache_ttl_hours = insights_cache_ttl_hours
        self.insights_dry_run = insights_dry_run
        self.stub_mode = stub_mode
        self._any_rollup_has_cross_dim: bool = False

    def generate_all(self) -> DatasetManifest:
        """Generate all aggregate files and manifest.

        Returns:
            DatasetManifest with generated file index.

        Raises:
            AggregationError: If generation fails.
            StubGenerationError: If stubs requested without ALLOW_ML_STUBS env var.
        """
        import warnings as py_warnings

        # Reset per-run state to prevent leakage across reuse
        self._any_rollup_has_cross_dim = False

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
                generated_at=datetime.now(UTC).isoformat(),
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
                    "cross_dimensional": self._any_rollup_has_cross_dim,
                    "comments": self._has_comments(),  # Phase 3.4: dynamic
                    "predictions": predictions_generated,  # Phase 3.5/5: file-gated
                    "ai_insights": insights_generated,  # Phase 3.5/5: file-gated
                },
                capabilities=self._get_capabilities(),
                coverage=cast(
                    dict[str, JSONValue],
                    {
                        "total_prs": self._get_pr_count(),
                        "date_range": dimensions.date_range,
                        "teams_count": len(dimensions.teams),  # Phase 3.3
                        "comments": self._get_comments_coverage(),  # Phase 3.4
                        # Phase 4 §5: Operational visibility
                        "row_counts": self._get_row_counts(),
                    },
                ),
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
        authors_df = users_df.copy()

        # Reviewers (distinct reviewers only)
        reviewers_df = pd.read_sql_query(
            """
            SELECT DISTINCT
                rv.user_id as reviewer_id,
                u.display_name as reviewer_name
            FROM reviewers rv
            INNER JOIN users u ON rv.user_id = u.user_id
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

        # Convert DataFrames to typed entity records (FR-014)
        repos_records = _df_to_repository_records(repos_df)
        users_records = _df_to_user_records(users_df)
        author_records = _df_to_author_records(authors_df)
        reviewers_records = _df_to_reviewer_records(reviewers_df)
        projects_records = _df_to_project_records(projects_df)
        teams_records = _df_to_team_records(teams_df) if not teams_df.empty else []
        return Dimensions(
            repositories=repos_records,
            users=users_records,
            authors=author_records,
            reviewers=reviewers_records,
            projects=projects_records,
            teams=teams_records,
            date_range=date_range,
        )

    def _generate_weekly_rollups(self) -> list[WeeklyRollupIndexEntry]:
        """Generate weekly rollup files, one per ISO week."""
        # Query PRs with closed dates and repository info for dimension slicing
        # plus PR-level identifiers for feature 060 PR-detail arrays.
        df = pd.read_sql_query(
            """
            SELECT
                pr.closed_date,
                pr.cycle_time_minutes,
                CASE WHEN pr.comments_extracted_at IS NOT NULL
                     THEN pr.review_time_minutes
                END AS review_time_minutes,
                pr.user_id,
                pr.pull_request_uid,
                pr.pull_request_id,
                pr.title,
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
                rv.user_id as reviewer_id,
                rv.vote
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

        index: list[WeeklyRollupIndexEntry] = []
        any_rollup_has_cross_dim = False
        # Track cross-dim availability for features flag (set on self after loop)

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
            by_author = self._generate_author_slice(group, week_reviewers)
            by_author_and_repo = self._generate_author_repo_slice(group, week_reviewers)
            by_team = self._generate_team_slice(group, week_reviewers, team_members_df)
            by_reviewer = self._generate_reviewer_slice(group, week_reviewers)
            by_team_and_repo = self._generate_team_repo_slice(
                group, week_reviewers, team_members_df
            )

            rollup = WeeklyRollup(
                week=week_str,
                start_date=start_date.isoformat(),
                end_date=end_date.isoformat(),
                pr_count=len(group),
                cycle_time_p50=group["cycle_time_minutes"].quantile(0.5)
                if group["cycle_time_minutes"].notna().sum() >= self._ROLLUP_MIN_SAMPLE
                else None,
                cycle_time_p90=group["cycle_time_minutes"].quantile(0.9)
                if group["cycle_time_minutes"].notna().sum() >= self._ROLLUP_MIN_SAMPLE
                else None,
                review_time_p50=group["review_time_minutes"].quantile(0.5)
                if group["review_time_minutes"].notna().sum() >= self._ROLLUP_MIN_SAMPLE
                else None,
                review_time_p90=group["review_time_minutes"].quantile(0.9)
                if group["review_time_minutes"].notna().sum() >= self._ROLLUP_MIN_SAMPLE
                else None,
                authors_count=group["user_id"].nunique(),
                reviewers_count=reviewers_count,
            )

            # Build rollup dict with dimension slices
            rollup_dict = asdict(rollup)

            # Feature 333: weekly comments aggregate (FR-2-06).  Capability-on
            # emits the four-field ``comments`` sub-object on the rollup root;
            # capability-off omits the key entirely (FR-3-03 + INV-1-08
            # atomicity).  The ``_compute_weekly_comments_aggregate`` helper
            # encapsulates ``_has_comments()`` gating and the extracted-subset
            # filter (FR-2-03) so this call site stays a one-liner.
            weekly_comments = self._compute_weekly_comments_aggregate(week_pr_uids)
            if weekly_comments is not None:
                rollup_dict["comments"] = weekly_comments

            # Feature 334: per-(week, author) comments-density emission
            # (FR-1-01..FR-1-08).  Capability-on emits the
            # ``by_author_comments`` outer dict on the rollup root, keyed
            # by author_id (or the reserved sentinel literal when the
            # author is absent from ``users``).  Capability-off omits the
            # key entirely (FR-3-03 + INV-2-08 atomicity).  Empty outer
            # dict (no PRs in the canonical set) is also omitted.
            weekly_by_author_comments = self._compute_weekly_by_author_comments(
                week_pr_uids
            )
            if weekly_by_author_comments:
                rollup_dict["by_author_comments"] = weekly_by_author_comments

            # Feature 335: per-(week, repo) comments-density emission
            # (FR-1-01..FR-1-10).  Capability-on emits the
            # ``by_repository_comments`` outer dict on the rollup root,
            # keyed by ``repository_id`` directly — NO sentinel concept
            # (CL-03 / FR-1-03 / INV-3-12; the FK constraint at
            # models.py:88 makes unknown-to-``repositories`` IDs
            # impossible in well-formed production data).  Capability-off
            # omits the key entirely (FR-3-03 + INV-3-09 atomicity).
            # Empty outer dict (no PRs in the canonical set OR no buckets
            # emitted) is also omitted (FR-1-10).
            weekly_by_repository_comments = self._compute_weekly_by_repository_comments(
                week_pr_uids
            )
            if weekly_by_repository_comments:
                rollup_dict["by_repository_comments"] = weekly_by_repository_comments

            # Feature 336: per-(week, reviewer) comments-density emission
            # (FR-1-01..FR-1-12).  Capability-on emits the
            # ``by_reviewer_comments`` outer dict on the rollup root,
            # keyed by commenter ``user_id`` (or the SENTINEL literal
            # when commenter is absent from ``users`` per CL-03 /
            # INV-4-12 — divergence from 335 which is FK-protected).
            # Iteration unit is ``pr_comments`` rows (CL-13 / INV-4-13);
            # self-comment exclusion enforced by SQL WHERE filter
            # (``pc.author_id != pr.user_id`` per CL-04).  Capability-off
            # omits the key entirely (FR-3-03 + INV-4-09 atomicity).
            # Empty outer dict (no eligible-reviewer-comment rows in
            # W's extracted-subset) is also omitted (FR-1-11).
            weekly_by_reviewer_comments = self._compute_weekly_by_reviewer_comments(
                week_pr_uids
            )
            if weekly_by_reviewer_comments:
                rollup_dict["by_reviewer_comments"] = weekly_by_reviewer_comments

            if by_repository:
                rollup_dict["by_repository"] = by_repository
            if by_author:
                rollup_dict["by_author"] = by_author
            if by_author_and_repo:
                is_truncated = by_author_and_repo.get("_truncated", False)
                if not is_truncated and by_author:
                    for author_id, repo_entries in by_author_and_repo.items():
                        if author_id.startswith("_"):
                            continue
                        if not isinstance(repo_entries, dict):
                            continue
                        cross_dim_pr_sum = sum(
                            entry["pr_count"] for entry in repo_entries.values()
                        )
                        author_entry = by_author.get(author_id)
                        author_pr_count = (
                            author_entry["pr_count"] if author_entry is not None else 0
                        )
                        if cross_dim_pr_sum != author_pr_count:
                            logger.warning(
                                "Author x repo pr_count consistency mismatch for "
                                "author %r in week %s: cross_dim_sum=%d != "
                                "author_total=%d",
                                author_id,
                                week_str,
                                cross_dim_pr_sum,
                                author_pr_count,
                            )
                rollup_dict["by_author_and_repo"] = by_author_and_repo
            if by_team:
                rollup_dict["by_team"] = by_team
            if by_reviewer:
                rollup_dict["by_reviewer"] = by_reviewer
            if by_team_and_repo:
                # Consistency assertion (pr_count only): for each team,
                # sum of cross-dim pr_counts must equal team total.
                # Relaxed when truncation has occurred (_truncated flag).
                is_truncated = by_team_and_repo.get("_truncated", False)
                if not is_truncated and by_team:
                    for team_name, repo_entries in by_team_and_repo.items():
                        if team_name.startswith("_"):
                            continue  # skip metadata keys like _truncated
                        if not isinstance(repo_entries, dict):
                            continue
                        cross_dim_pr_sum = sum(
                            entry["pr_count"] for entry in repo_entries.values()
                        )
                        team_entry = by_team.get(team_name)
                        team_pr_count = (
                            team_entry["pr_count"] if team_entry is not None else 0
                        )
                        if cross_dim_pr_sum != team_pr_count:
                            logger.warning(
                                "Cross-dim pr_count consistency mismatch for "
                                "team %r in week %s: cross_dim_sum=%d != "
                                "team_total=%d",
                                team_name,
                                week_str,
                                cross_dim_pr_sum,
                                team_pr_count,
                            )
                rollup_dict["by_team_and_repo"] = by_team_and_repo
                any_rollup_has_cross_dim = True

            # Feature 060 (FR-001, FR-002, FR-003, FR-025): PR-level detail.
            # Build the qualified PR set (non-null, finite cycle_time_minutes),
            # sort by (-cycle_time, id), truncate to `_PR_DETAIL_CAP`, serialize
            # to `PrRecord` dicts. Public/demo artifacts have these three
            # fields stripped by the `promote_data` gate — this emission is
            # for private tenant artifacts only.
            #
            # `pd.to_numeric(errors="coerce")` hardens against mixed-dtype
            # columns: SQLite can return some NaN bit patterns as None, which
            # leaves the column `object` dtype and makes `np.isfinite` raise
            # "ufunc not supported for the input types". The coerce step
            # collapses every non-numeric value to NaN, then `notna &
            # isfinite` filters to finite floats for the sort + emit pass.
            cycle_numeric = pd.to_numeric(group["cycle_time_minutes"], errors="coerce")
            qualified = group[cycle_numeric.notna() & np.isfinite(cycle_numeric)]
            if not qualified.empty:
                qualified = qualified.sort_values(
                    by=["cycle_time_minutes", "pull_request_id"],
                    ascending=[False, True],
                    kind="stable",
                )
                total_qualified = len(qualified)
                prs_truncated = total_qualified > _PR_DETAIL_CAP
                if prs_truncated:
                    qualified = qualified.head(_PR_DETAIL_CAP)

                # Feature 310 — per-PR comments-metrics fields, gated on
                # capabilities.comments_metrics.  The join runs strictly AFTER
                # the qualified+sorted+capped(500) slice is built (R-05 /
                # INV-02); no counts are computed for PRs outside the top-500
                # slice.  Python-side atomicity: the by_uid map carries a
                # (thread_count, comment_count, active_thread_count) triplet
                # per uid — either all three integer when covered
                # (comments_extracted_at IS NOT NULL) or all three None when
                # partial (comments_extracted_at IS NULL) per INV-10.  When
                # self._has_comments() is False (legacy DB without pr_threads
                # or capability off upstream), the emission path is skipped
                # entirely and every PrRecord keeps its 5-field 060 shape
                # (INV-01 / FR-3-06 / SC-03).
                emit_comments_metrics = self._has_comments()
                by_uid: dict[str, tuple[int | None, int | None, int | None]] = {}
                if emit_comments_metrics:
                    slice_uids = [
                        uid_value
                        for uid_value in qualified["pull_request_uid"].tolist()
                        if isinstance(uid_value, str) and uid_value
                    ]
                    if slice_uids:
                        # Stage the capped-slice uids in a per-connection temp
                        # table and INNER-JOIN it into the main query.  This
                        # keeps the INV-02 top-500 scope without an f-string
                        # ``IN (?, ?, ...)`` (which would flag S608 in ruff
                        # for no safety benefit — placeholder count is bounded
                        # by _PR_DETAIL_CAP=500 but the heuristic cannot see
                        # that, and the zero-suppressions policy forbids
                        # blanket lint suppressions).  C1 inclusion rules
                        # encoded in the two
                        # LEFT-JOIN subqueries: pr_threads.is_deleted=0
                        # excluded; status='unknown' counted in thread_count
                        # and naturally excluded from active_thread_count
                        # (status='active' predicate); pr_comments.is_deleted=0
                        # excluded; comment_type='system' counted by default
                        # (no filter); author-missing rows counted naturally
                        # (no JOIN to users).
                        self.db.execute(
                            "CREATE TEMP TABLE IF NOT EXISTS "
                            "_aggr_pr_slice (pull_request_uid TEXT PRIMARY KEY)"
                        )
                        self.db.execute("DELETE FROM _aggr_pr_slice")
                        self.db.executemany(
                            "INSERT INTO _aggr_pr_slice (pull_request_uid) VALUES (?)",
                            [(uid_value,) for uid_value in slice_uids],
                        )
                        cursor = self.db.execute(
                            "SELECT "
                            "  pr.pull_request_uid AS pull_request_uid, "
                            "  pr.comments_extracted_at AS comments_extracted_at, "
                            "  COALESCE(t.thread_count, 0) AS thread_count, "
                            "  COALESCE(t.active_thread_count, 0) AS active_thread_count, "
                            "  COALESCE(c.comment_count, 0) AS comment_count "
                            "FROM pull_requests pr "
                            "INNER JOIN _aggr_pr_slice s "
                            "  ON s.pull_request_uid = pr.pull_request_uid "
                            "LEFT JOIN ( "
                            "  SELECT pull_request_uid, "
                            "         COUNT(*) AS thread_count, "
                            "         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) "
                            "           AS active_thread_count "
                            "  FROM pr_threads "
                            "  WHERE is_deleted = 0 "
                            "  GROUP BY pull_request_uid "
                            ") t ON t.pull_request_uid = pr.pull_request_uid "
                            "LEFT JOIN ( "
                            "  SELECT pull_request_uid, COUNT(*) AS comment_count "
                            "  FROM pr_comments "
                            "  WHERE is_deleted = 0 "
                            "  GROUP BY pull_request_uid "
                            ") c ON c.pull_request_uid = pr.pull_request_uid"
                        )
                        for db_row in cursor.fetchall():
                            row_uid = str(db_row["pull_request_uid"])
                            if db_row["comments_extracted_at"] is None:
                                by_uid[row_uid] = (None, None, None)
                            else:
                                by_uid[row_uid] = (
                                    int(db_row["thread_count"]),
                                    int(db_row["comment_count"]),
                                    int(db_row["active_thread_count"]),
                                )

                prs: list[PrRecord] = []
                for row in qualified.itertuples(index=False):
                    pr_id = getattr(row, "pull_request_id", None)
                    title = getattr(row, "title", None)
                    user_id = getattr(row, "user_id", None)
                    repository_id = getattr(row, "repository_id", None)
                    cycle_time = getattr(row, "cycle_time_minutes", None)
                    # Defensive: require well-typed fields. Partial rows are
                    # logged and excluded from the `prs` array; the aggregate
                    # `pr_count` attribution is unaffected (the PR still counts
                    # in the slice totals).
                    if (
                        not isinstance(title, str)
                        or not isinstance(user_id, str)
                        or not isinstance(repository_id, str)
                        or not isinstance(pr_id, (int, float))
                        or not isinstance(cycle_time, (int, float))
                    ):
                        logger.warning(
                            "PR-level detail: skipping PR with incomplete "
                            "fields in week %s (pull_request_id=%r)",
                            week_str,
                            pr_id,
                        )
                        continue
                    pr_record: PrRecord = {
                        "id": int(pr_id),
                        "title": title,
                        "author_id": user_id,
                        "repository_id": repository_id,
                        "cycle_time": float(cycle_time),
                    }
                    if emit_comments_metrics:
                        # Feature 310 INV-08: attach all three fields together
                        # or none.  The triplet is sourced from a single
                        # by_uid lookup so per-PR coverage-partial is atomic
                        # (INV-10).  If the row's pull_request_uid is missing
                        # or not a string (defensive; should not occur given
                        # the pr_id validation above), emit the partial
                        # sentinel rather than inventing numeric zeros.
                        attach_uid = getattr(row, "pull_request_uid", None)
                        if isinstance(attach_uid, str) and attach_uid:
                            counts = by_uid.get(attach_uid, (None, None, None))
                        else:
                            counts = (None, None, None)
                        pr_record["thread_count"] = counts[0]
                        pr_record["comment_count"] = counts[1]
                        pr_record["active_thread_count"] = counts[2]
                    prs.append(pr_record)

                rollup_dict["prs"] = prs
                rollup_dict["_prs_truncated"] = prs_truncated
                rollup_dict["_prs_cap"] = _PR_DETAIL_CAP

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

        # Store cross-dim availability for features flag in generate_all()
        self._any_rollup_has_cross_dim = any_rollup_has_cross_dim

        return index

    def _register_vote_event_function(self) -> None:
        """Idempotently register the shared ``is_vote_event`` SQLite UDF.

        Called at the top of each of the four rollup-level comments-aggregate
        helpers that emit ``vote_event_count`` so the registration tracks
        whatever connection ``self.db`` exposes at call time (fresh, replaced
        after a reconnect, etc.).  ``sqlite3.Connection.create_function``
        accepts repeated registrations of the same name on the same
        connection without error — the second call simply replaces the
        binding with the same Python callable.  The ``deterministic=True``
        flag matches the helper's mathematical purity (same input always
        yields the same output) and lets SQLite use the call inside
        indexed expressions if a future schema adds one.

        Authoritative contract: ``extraction/vote_events.py`` owns the
        regex; ``tests/unit/test_vote_events.py`` proves the Python and
        SQLite paths classify identical fixture strings identically.
        """
        self.db.connection.create_function(
            "is_vote_event", 1, is_vote_event, deterministic=True
        )

    def _compute_weekly_comments_aggregate(
        self, week_pr_uids: set[str]
    ) -> dict[str, int | bool] | None:
        """Compute the weekly ``comments`` aggregate (FR-2-06) for one week.

        Returns ``None`` when ``_has_comments()`` is False so callers can omit
        the ``comments`` key from the rollup entirely (FR-3-03 / INV-1-08
        atomicity — the key MUST be absent under capability-off, NOT
        ``None``-valued, NOT ``{}``-valued, NOT partial).

        When capability-on, returns a four-field dict whose three numeric
        fields are sums over W's EXTRACTED-SUBSET (PRs in ``week_pr_uids``
        whose ``comments_extracted_at IS NOT NULL``) per FR-2-03.  PRs in
        the canonical set that are unextracted contribute zero to the sums
        but flip ``coverage_partial`` to ``True``.

        C1 inclusion rules (per
        ``specs/310-comments-visualization/spec.md`` lines 75-87) are
        encoded in the SQL: ``pr_threads.is_deleted = 0`` excluded;
        ``status = 'active'`` predicate isolates active threads;
        ``pr_comments.is_deleted = 0`` excluded.  Same temp-table staging
        pattern as the per-PR query in ``_generate_weekly_rollups`` at the
        310 PR-level emission, scoped to W's canonical PR set rather than
        the top-500 cycle-time slice.  The dynamic-SQL avoidance follows
        ``reference_s608_refactor_pattern.md`` (no f-string ``IN`` clause).

        Spec anchors: FR-2-06, FR-2-03, FR-3-03, INV-1-06, INV-1-07,
        INV-1-08.
        """
        if not self._has_comments():
            return None

        if not week_pr_uids:
            # Defensive: empty canonical set yields the all-zero aggregate.
            # Should not occur in practice (caller iterates per-week groups
            # of length >= 1) but keeps the contract well-defined.
            return {
                "thread_count": 0,
                "comment_count": 0,
                "active_thread_count": 0,
                "vote_event_count": 0,
                "coverage_partial": False,
            }

        self._register_vote_event_function()
        self.db.execute(
            "CREATE TEMP TABLE IF NOT EXISTS "
            "_aggr_week_comments_slice (pull_request_uid TEXT PRIMARY KEY)"
        )
        self.db.execute("DELETE FROM _aggr_week_comments_slice")
        self.db.executemany(
            "INSERT INTO _aggr_week_comments_slice (pull_request_uid) VALUES (?)",
            [(uid,) for uid in week_pr_uids],
        )

        cursor = self.db.execute(
            "SELECT "
            "  COALESCE(SUM(CASE WHEN pr.comments_extracted_at IS NOT NULL "
            "                    THEN t.thread_count ELSE 0 END), 0) "
            "    AS thread_count, "
            "  COALESCE(SUM(CASE WHEN pr.comments_extracted_at IS NOT NULL "
            "                    THEN c.comment_count ELSE 0 END), 0) "
            "    AS comment_count, "
            "  COALESCE(SUM(CASE WHEN pr.comments_extracted_at IS NOT NULL "
            "                    THEN t.active_thread_count ELSE 0 END), 0) "
            "    AS active_thread_count, "
            "  COALESCE(SUM(CASE WHEN pr.comments_extracted_at IS NOT NULL "
            "                    THEN c.vote_event_count ELSE 0 END), 0) "
            "    AS vote_event_count, "
            "  MAX(CASE WHEN pr.comments_extracted_at IS NULL THEN 1 ELSE 0 END) "
            "    AS coverage_partial "
            "FROM pull_requests pr "
            "INNER JOIN _aggr_week_comments_slice s "
            "  ON s.pull_request_uid = pr.pull_request_uid "
            "LEFT JOIN ( "
            "  SELECT pull_request_uid, "
            "         COUNT(*) AS thread_count, "
            "         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) "
            "           AS active_thread_count "
            "  FROM pr_threads "
            "  WHERE is_deleted = 0 "
            "  GROUP BY pull_request_uid "
            ") t ON t.pull_request_uid = pr.pull_request_uid "
            "LEFT JOIN ( "
            "  SELECT pull_request_uid, "
            "         COUNT(*) AS comment_count, "
            "         SUM(CASE WHEN comment_type = 'system' "
            "                       AND is_vote_event(content) = 1 "
            "                  THEN 1 ELSE 0 END) "
            "           AS vote_event_count "
            "  FROM pr_comments "
            "  WHERE is_deleted = 0 "
            "  GROUP BY pull_request_uid "
            ") c ON c.pull_request_uid = pr.pull_request_uid"
        )
        row = cursor.fetchone()
        if row is None:
            # Defensive: SELECT with aggregates always returns one row, but
            # if the cursor is empty for some driver-specific reason, fall
            # back to the all-zero aggregate.
            return {
                "thread_count": 0,
                "comment_count": 0,
                "active_thread_count": 0,
                "vote_event_count": 0,
                "coverage_partial": False,
            }

        coverage_raw = row["coverage_partial"]
        coverage_partial = coverage_raw is not None and int(coverage_raw) > 0
        return {
            "thread_count": int(row["thread_count"]),
            "comment_count": int(row["comment_count"]),
            "active_thread_count": int(row["active_thread_count"]),
            "vote_event_count": int(row["vote_event_count"] or 0),
            "coverage_partial": coverage_partial,
        }

    def _compute_weekly_by_author_comments(
        self, week_pr_uids: set[str]
    ) -> dict[str, dict[str, int | bool]] | None:
        """Compute per-(week, author) ``by_author_comments`` emission for one week.

        Returns ``None`` when ``_has_comments()`` is False or when
        ``week_pr_uids`` is empty so callers can omit the
        ``by_author_comments`` key entirely (FR-3-03 + INV-2-08
        atomicity — the key MUST be absent under capability-off, NOT
        ``None``-valued, NOT ``{}``-valued, NOT partial).

        When capability-on with a non-empty canonical set, returns an
        outer dict keyed by ``author_id`` (or the reserved sentinel
        literal ``FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL`` when the
        author is absent from the ``users`` table per CL-03 + FR-1-03).
        Each inner dict carries the four atomic fields:

          - ``thread_count``: SUM over the bucket's extracted-subset
            (PRs with ``comments_extracted_at IS NOT NULL``) of the
            per-PR active-or-closed thread count, after C1 inclusion
            (``pr_threads.is_deleted = 0``).  PRs in the canonical
            set with ``comments_extracted_at IS NULL`` contribute zero
            to this sum (FR-1-05).
          - ``comment_count``: SUM over the same extracted-subset of
            per-PR comment count after C1 (``pr_comments.is_deleted = 0``).
          - ``active_thread_count``: SUM over the same extracted-subset
            of per-PR active-thread count (threads with
            ``status = 'active'`` after C1).
          - ``coverage_partial``: ``True`` iff at least one PR in W's
            canonical throughput PR set keyed under the same bucket
            has ``comments_extracted_at IS NULL`` (FR-1-06).  Each
            bucket's flag is independent of every other bucket's flag.

        Outer dict key order is ascending by author key (the stable
        identity string, including the sentinel literal which sorts
        between digit-starting and letter-starting UUIDs in ASCII)
        per QG-05 + plan.md directive 3.  Display name is NOT used
        for producer-side ordering — that's renderer-side tie-breaking
        per FR-4-05.

        SQL pattern mirrors ``_compute_weekly_comments_aggregate`` but
        adds a ``LEFT JOIN users`` for sentinel detection and a
        ``GROUP BY author_or_sentinel``.  Sentinel literal is bound
        via parameter (not f-string interpolation) — S608 compliance
        per ``reference_s608_refactor_pattern.md``.

        Spec anchors: FR-1-01..FR-1-08, FR-3-03, INV-2-07, INV-2-08,
        ADR T005, ADR T006, CL-03, CL-07.  C1 contract authority:
        ``specs/310-comments-visualization/spec.md`` "Shared
        inclusion-rule contract (C1)".
        """
        if not self._has_comments():
            return None

        if not week_pr_uids:
            # Defensive: empty canonical set yields no bucket emission.
            # Callers see ``None`` and omit the ``by_author_comments``
            # key (consistent with FR-3-03 omission contract).
            return None

        self._register_vote_event_function()
        self.db.execute(
            "CREATE TEMP TABLE IF NOT EXISTS "
            "_aggr_week_by_author_comments_slice "
            "(pull_request_uid TEXT PRIMARY KEY)"
        )
        self.db.execute("DELETE FROM _aggr_week_by_author_comments_slice")
        self.db.executemany(
            "INSERT INTO _aggr_week_by_author_comments_slice "
            "(pull_request_uid) VALUES (?)",
            [(uid,) for uid in week_pr_uids],
        )

        cursor = self.db.execute(
            "SELECT "
            "  CASE WHEN u.user_id IS NULL THEN ? ELSE pr.user_id END "
            "    AS author_or_sentinel, "
            "  COALESCE(SUM(CASE WHEN pr.comments_extracted_at IS NOT NULL "
            "                    THEN t.thread_count ELSE 0 END), 0) "
            "    AS thread_count, "
            "  COALESCE(SUM(CASE WHEN pr.comments_extracted_at IS NOT NULL "
            "                    THEN c.comment_count ELSE 0 END), 0) "
            "    AS comment_count, "
            "  COALESCE(SUM(CASE WHEN pr.comments_extracted_at IS NOT NULL "
            "                    THEN t.active_thread_count ELSE 0 END), 0) "
            "    AS active_thread_count, "
            "  COALESCE(SUM(CASE WHEN pr.comments_extracted_at IS NOT NULL "
            "                    THEN c.vote_event_count ELSE 0 END), 0) "
            "    AS vote_event_count, "
            "  MAX(CASE WHEN pr.comments_extracted_at IS NULL "
            "          THEN 1 ELSE 0 END) "
            "    AS coverage_partial "
            "FROM pull_requests pr "
            "INNER JOIN _aggr_week_by_author_comments_slice s "
            "  ON s.pull_request_uid = pr.pull_request_uid "
            "LEFT JOIN users u ON u.user_id = pr.user_id "
            "LEFT JOIN ( "
            "  SELECT pull_request_uid, "
            "         COUNT(*) AS thread_count, "
            "         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) "
            "           AS active_thread_count "
            "  FROM pr_threads "
            "  WHERE is_deleted = 0 "
            "  GROUP BY pull_request_uid "
            ") t ON t.pull_request_uid = pr.pull_request_uid "
            "LEFT JOIN ( "
            "  SELECT pull_request_uid, "
            "         COUNT(*) AS comment_count, "
            "         SUM(CASE WHEN comment_type = 'system' "
            "                       AND is_vote_event(content) = 1 "
            "                  THEN 1 ELSE 0 END) "
            "           AS vote_event_count "
            "  FROM pr_comments "
            "  WHERE is_deleted = 0 "
            "  GROUP BY pull_request_uid "
            ") c ON c.pull_request_uid = pr.pull_request_uid "
            "GROUP BY author_or_sentinel "
            "ORDER BY author_or_sentinel ASC",
            (FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL,),
        )

        buckets: dict[str, dict[str, int | bool]] = {}
        for row in cursor.fetchall():
            key_raw = row["author_or_sentinel"]
            if key_raw is None:
                # Defensive: a NULL author_id with no users-row would
                # have been mapped to the sentinel by the CASE; a NULL
                # author key here means an unexpected schema state.
                # Skip rather than emit a NULL key into the JSON.
                continue
            key = str(key_raw)
            coverage_raw = row["coverage_partial"]
            coverage_partial = coverage_raw is not None and int(coverage_raw) > 0
            buckets[key] = {
                "thread_count": int(row["thread_count"]),
                "comment_count": int(row["comment_count"]),
                "active_thread_count": int(row["active_thread_count"]),
                "vote_event_count": int(row["vote_event_count"] or 0),
                "coverage_partial": coverage_partial,
            }

        if not buckets:
            return None
        return buckets

    def _compute_weekly_by_repository_comments(
        self, week_pr_uids: set[str]
    ) -> dict[str, dict[str, int | bool]] | None:
        """Compute per-(week, repo) ``by_repository_comments`` emission for one week.

        Returns ``None`` when ``_has_comments()`` is False or when
        ``week_pr_uids`` is empty so callers can omit the
        ``by_repository_comments`` key entirely (FR-3-03 + INV-3-09 +
        FR-1-10 — the key MUST be absent under capability-off, NOT
        ``None``-valued, NOT ``{}``-valued, NOT partial).

        When capability-on with a non-empty canonical set, returns an
        outer dict keyed by ``pull_requests.repository_id`` directly
        (NO sentinel literal per Feature 335 CL-03 / FR-1-03 / INV-3-12;
        the FK constraint at ``models.py:88``
        (``pull_requests.repository_id REFERENCES
        repositories(repository_id)``) guarantees every emitted
        ``repository_id`` corresponds to a row in ``repositories`` for
        well-formed production data).  Each inner dict carries the four
        atomic fields:

          - ``thread_count``: SUM over the bucket's extracted-subset
            (PRs with ``comments_extracted_at IS NOT NULL``) of the
            per-PR active-or-closed thread count, after C1 inclusion
            (``pr_threads.is_deleted = 0``).  PRs in the canonical
            set with ``comments_extracted_at IS NULL`` contribute zero
            to this sum (FR-1-05).
          - ``comment_count``: SUM over the same extracted-subset of
            per-PR comment count after C1 (``pr_comments.is_deleted = 0``).
          - ``active_thread_count``: SUM over the same extracted-subset
            of per-PR active-thread count (threads with
            ``status = 'active'`` after C1).
          - ``coverage_partial``: ``True`` iff at least one PR in W's
            canonical throughput PR set keyed under the same bucket
            has ``comments_extracted_at IS NULL`` (FR-1-06).  Each
            bucket's flag is independent of every other bucket's flag.

        Outer dict key order is ascending by ``repository_id`` per
        contracts/per-repo-comments-density.md §2 Determinism +
        QG-05.  Display name is NOT used for producer-side ordering —
        that's renderer-side tie-breaking per FR-4-05.

        FK-violation FAIL-LOUD (CL-03 / FR-1-03): a pre-flight LEFT
        JOIN query identifies any PR in the canonical set whose
        ``repository_id`` is missing from the ``repositories`` table
        and raises ``RuntimeError`` with the offending PR's identity.
        Should be impossible in well-formed production data per the
        FK constraint at ``models.py:88``; this guard surfaces the
        edge case where FK enforcement was disabled during a migration
        or the database is otherwise corrupted, preventing the
        aggregator from silently coercing such rows into the emission.

        SQL pattern mirrors ``_compute_weekly_by_author_comments`` but
        groups by ``pr.repository_id`` directly (no LEFT JOIN to a
        sentinel-bucket-resolution table).  S608 compliance — no
        dynamic SQL strings; the ``week_pr_uids`` slice is materialized
        in a temp table and joined.

        Spec anchors: FR-1-01..FR-1-10, FR-3-03, INV-3-07, INV-3-08,
        INV-3-09, INV-3-10, INV-3-12, CL-03, CL-04, CL-09.  C1 contract
        authority: ``specs/310-comments-visualization/spec.md`` "Shared
        inclusion-rule contract (C1)".
        """
        if not self._has_comments():
            return None

        if not week_pr_uids:
            # Defensive: empty canonical set yields no bucket emission.
            # Callers see ``None`` and omit the ``by_repository_comments``
            # key (FR-1-10 + FR-3-03 omission contract).
            return None

        self._register_vote_event_function()
        self.db.execute(
            "CREATE TEMP TABLE IF NOT EXISTS "
            "_aggr_week_by_repository_comments_slice "
            "(pull_request_uid TEXT PRIMARY KEY)"
        )
        self.db.execute("DELETE FROM _aggr_week_by_repository_comments_slice")
        self.db.executemany(
            "INSERT INTO _aggr_week_by_repository_comments_slice "
            "(pull_request_uid) VALUES (?)",
            [(uid,) for uid in week_pr_uids],
        )

        # Pre-flight FK-violation FAIL-LOUD per CL-03 / FR-1-03 /
        # INV-3-12.  In well-formed production data this query returns
        # zero rows (FK constraint at models.py:88 makes orphan
        # repository_ids impossible).  If the query returns a row,
        # database integrity has been violated — raise so the caller
        # can investigate rather than silently coercing.
        orphan_cursor = self.db.execute(
            "SELECT pr.pull_request_uid AS pull_request_uid, "
            "       pr.repository_id AS repository_id "
            "FROM pull_requests pr "
            "INNER JOIN _aggr_week_by_repository_comments_slice s "
            "  ON s.pull_request_uid = pr.pull_request_uid "
            "LEFT JOIN repositories r ON r.repository_id = pr.repository_id "
            "WHERE r.repository_id IS NULL "
            "LIMIT 1"
        )
        orphan_row = orphan_cursor.fetchone()
        if orphan_row is not None:
            offending_uid = orphan_row["pull_request_uid"]
            offending_repo_id = orphan_row["repository_id"]
            raise RuntimeError(
                "Feature 335 FR-1-03 / CL-03 FK-violation FAIL-LOUD: "
                f"pull_request_uid={offending_uid!r} carries "
                f"repository_id={offending_repo_id!r} which is missing "
                "from the repositories table.  This violates the FK "
                "constraint at models.py:88 (pull_requests.repository_id "
                "REFERENCES repositories(repository_id)) and should be "
                "impossible in well-formed production data — investigate "
                "database integrity (e.g., FK enforcement disabled during "
                "a migration?) before re-running the aggregator."
            )

        cursor = self.db.execute(
            "SELECT "
            "  pr.repository_id AS repository_id, "
            "  COALESCE(SUM(CASE WHEN pr.comments_extracted_at IS NOT NULL "
            "                    THEN t.thread_count ELSE 0 END), 0) "
            "    AS thread_count, "
            "  COALESCE(SUM(CASE WHEN pr.comments_extracted_at IS NOT NULL "
            "                    THEN c.comment_count ELSE 0 END), 0) "
            "    AS comment_count, "
            "  COALESCE(SUM(CASE WHEN pr.comments_extracted_at IS NOT NULL "
            "                    THEN t.active_thread_count ELSE 0 END), 0) "
            "    AS active_thread_count, "
            "  COALESCE(SUM(CASE WHEN pr.comments_extracted_at IS NOT NULL "
            "                    THEN c.vote_event_count ELSE 0 END), 0) "
            "    AS vote_event_count, "
            "  MAX(CASE WHEN pr.comments_extracted_at IS NULL "
            "          THEN 1 ELSE 0 END) "
            "    AS coverage_partial "
            "FROM pull_requests pr "
            "INNER JOIN _aggr_week_by_repository_comments_slice s "
            "  ON s.pull_request_uid = pr.pull_request_uid "
            "LEFT JOIN ( "
            "  SELECT pull_request_uid, "
            "         COUNT(*) AS thread_count, "
            "         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) "
            "           AS active_thread_count "
            "  FROM pr_threads "
            "  WHERE is_deleted = 0 "
            "  GROUP BY pull_request_uid "
            ") t ON t.pull_request_uid = pr.pull_request_uid "
            "LEFT JOIN ( "
            "  SELECT pull_request_uid, "
            "         COUNT(*) AS comment_count, "
            "         SUM(CASE WHEN comment_type = 'system' "
            "                       AND is_vote_event(content) = 1 "
            "                  THEN 1 ELSE 0 END) "
            "           AS vote_event_count "
            "  FROM pr_comments "
            "  WHERE is_deleted = 0 "
            "  GROUP BY pull_request_uid "
            ") c ON c.pull_request_uid = pr.pull_request_uid "
            "GROUP BY pr.repository_id "
            "ORDER BY pr.repository_id ASC"
        )

        buckets: dict[str, dict[str, int | bool]] = {}
        for row in cursor.fetchall():
            key_raw = row["repository_id"]
            if key_raw is None:
                # Defensive: repository_id is NOT NULL per models.py:77
                # so a NULL key here means an unexpected schema state.
                # Skip rather than emit a NULL key into the JSON.
                continue
            key = str(key_raw)
            coverage_raw = row["coverage_partial"]
            coverage_partial = coverage_raw is not None and int(coverage_raw) > 0
            buckets[key] = {
                "thread_count": int(row["thread_count"]),
                "comment_count": int(row["comment_count"]),
                "active_thread_count": int(row["active_thread_count"]),
                "vote_event_count": int(row["vote_event_count"] or 0),
                "coverage_partial": coverage_partial,
            }

        if not buckets:
            return None
        return buckets

    def _compute_weekly_by_reviewer_comments(
        self, week_pr_uids: set[str]
    ) -> dict[str, dict[str, int | bool]] | None:
        """Compute per-(week, reviewer) ``by_reviewer_comments`` emission for one week.

        Feature 336 / T016.  Iteration unit is ``pr_comments`` rows
        (NOT ``pull_requests`` rows — divergence from
        ``_compute_weekly_by_author_comments`` and
        ``_compute_weekly_by_repository_comments`` per CL-13 / INV-4-13;
        the per-reviewer dimension's aggregator is the only one that
        groups by commenter ``author_id``).

        Returns ``None`` when ``_has_comments()`` is False, when
        ``week_pr_uids`` is empty, or when no eligible-reviewer-comment
        rows exist after C1 + CL-04 filtering — callers omit the
        ``by_reviewer_comments`` key entirely (FR-3-03 + FR-1-11
        atomicity — the key MUST be absent under capability-off / empty,
        NOT ``None``-valued, NOT ``{}``-valued, NOT partial).

        When capability-on with eligible-reviewer-comment rows present,
        returns an outer dict keyed by ``commenter_or_sentinel`` (per
        CL-03 / INV-4-12 — sentinel APPLIES, divergence from per-repo
        which is FK-protected); each inner dict carries the four atomic
        fields:

          - ``thread_count``: COUNT(DISTINCT ``pr_comments.thread_id``)
            per commenter (FR-1-05 — divergence from #334 / #335 raw
            row count).  Distinct eligible threads with at least one
            non-self comment by R.
          - ``comment_count``: raw COUNT(*) of ``pr_comments`` rows
            where ``author_id = R``, ``pull_request_uid`` ∈ W's
            extracted-subset, ``author_id != pull_requests.user_id``
            (CL-04 self-comment exclusion), ``is_deleted = 0`` (C1).
          - ``active_thread_count``: COUNT(DISTINCT thread_id) where R
            commented AND ``pr_threads.status = 'active'`` (FR-1-05).
            The active subset of ``thread_count``.
          - ``coverage_partial``: same-W flag per CL-10.  Computed once
            via a separate query and applied uniformly to ALL emitted
            buckets.  ``True`` iff at least one PR in W's canonical
            throughput PR set has ``comments_extracted_at IS NULL``.
            Bucket-specific definition is degenerate for per-reviewer
            because R's commenter relationship to a PR is invisible
            until extraction (an unextracted PR's commenter set is
            unknowable).

        Outer dict key order is ascending by commenter key (the stable
        identity string, including the sentinel literal which sorts
        deterministically among UUID-shaped real keys at the leading-
        ``__`` position) per QG-05 + contracts/per-reviewer-comments-density.md
        §2 Determinism.  Display name is NOT used for producer-side
        ordering — that's renderer-side tie-breaking per FR-4-05.

        SQL pattern (per contract §2): INNER JOIN ``pull_requests`` for
        the ``pc.author_id != pr.user_id`` self-comment-exclusion filter
        + the ``comments_extracted_at`` extracted-subset filter; LEFT
        JOIN ``users`` for sentinel detection (CASE WHEN u.user_id IS
        NULL THEN sentinel ELSE pc.author_id); LEFT JOIN ``pr_threads``
        for the ``active_thread_count`` filter on ``pr_threads.status =
        'active'``.  Sentinel literal bound via parameter (NOT f-string
        interpolation) per S608 compliance / ``reference_s608_refactor_pattern.md``.

        FAIL-LOUD per FR-1-12 / CL-15 (post PR review):
          * Pre-flight: raise ``RuntimeError`` if any ``users.user_id``
            collides with the reserved sentinel literal — without the
            collision check, a real user with that exact id would be
            routed through the LEFT JOIN's matched branch (the CASE
            returns ``pc.author_id`` = sentinel literal) and the
            renderer would mislabel real comments as the sentinel.
            Per CL-03 / FR-1-03 / INV-4-12: the literal is reserved.
          * Iteration guard: raise ``RuntimeError`` if the cursor
            returns a row with NULL or empty-string
            ``commenter_or_sentinel`` — extractor or writer corruption.
        UUID-shape is NOT enforced; the persisted schema's TEXT
        identifier columns accept stable non-UUID IDs.

        Spec anchors: FR-1-01..FR-1-12, FR-3-03, INV-4-07, INV-4-08,
        INV-4-09, INV-4-10, INV-4-12, INV-4-13, CL-03, CL-04, CL-10,
        CL-13, CL-15.  C1 contract authority:
        ``specs/310-comments-visualization/spec.md`` "Shared
        inclusion-rule contract (C1)".  C2 reviewer-semantics
        authority: same file under "Reviewer activity (C2)".
        """
        if not self._has_comments():
            return None

        if not week_pr_uids:
            # FR-1-11 + FR-3-03 omission contract: empty canonical set
            # → no buckets; caller omits the key entirely.
            return None

        # Sentinel-collision pre-flight (CL-03 / FR-1-03 / INV-4-12):
        # ensure no ``users.user_id`` row collides with the reserved
        # sentinel literal.  The persisted schema's TEXT identifier
        # column does not constrain format, so without this check
        # nothing would prevent a literal collision; if such a row
        # existed, the LEFT JOIN below would route real comments
        # through the matched branch (CASE returns pc.author_id =
        # sentinel literal) and the renderer would mislabel real-user
        # comments as "Former / unavailable author".  PR review
        # introduced this guard after removing the prior UUID-shape
        # gate that incidentally prevented the collision.
        collision_row = self.db.execute(
            "SELECT 1 FROM users WHERE user_id = ? LIMIT 1",
            (FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL,),
        ).fetchone()
        if collision_row is not None:
            raise RuntimeError(
                "_compute_weekly_by_reviewer_comments: users table "
                "contains a row whose user_id collides with the "
                "reserved sentinel literal "
                f"{FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL!r}.  This "
                "would corrupt the per-reviewer breakdown's display "
                "labels (real-user comments would render as 'Former / "
                "unavailable author').  See spec CL-03 / FR-1-03 / "
                "INV-4-12."
            )

        # Sentinel-collision pre-flight on raw pr_comments.author_id
        # (CL-03 / FR-1-03 / INV-4-12).  With FK enforcement disabled
        # (test edges, migration windows), a comment row could carry
        # the reserved sentinel literal as its author_id without any
        # matching users row — the LEFT JOIN would not match
        # (u.user_id IS NULL) and the existing CASE would return the
        # sentinel marker via the absent-user branch, silently
        # bucketing the corrupted comment under the reserved key.
        # Pre-flight rejects the raw collision before aggregation.
        comment_collision_row = self.db.execute(
            "SELECT 1 FROM pr_comments WHERE author_id = ? LIMIT 1",
            (FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL,),
        ).fetchone()
        if comment_collision_row is not None:
            raise RuntimeError(
                "_compute_weekly_by_reviewer_comments: pr_comments "
                "table contains a row whose author_id collides with "
                "the reserved sentinel literal "
                f"{FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL!r}.  This "
                "indicates extractor or writer corruption (the "
                "literal is reserved for the absent-user fallback "
                "branch and cannot be a real commenter identity).  "
                "See spec CL-03 / FR-1-03 / INV-4-12."
            )

        self._register_vote_event_function()
        self.db.execute(
            "CREATE TEMP TABLE IF NOT EXISTS "
            "_aggr_week_by_reviewer_comments_slice "
            "(pull_request_uid TEXT PRIMARY KEY)"
        )
        self.db.execute("DELETE FROM _aggr_week_by_reviewer_comments_slice")
        self.db.executemany(
            "INSERT INTO _aggr_week_by_reviewer_comments_slice "
            "(pull_request_uid) VALUES (?)",
            [(uid,) for uid in week_pr_uids],
        )

        # Step 1: compute the same-W coverage_partial flag per CL-10.
        # One boolean for the entire week, applied uniformly to every
        # emitted bucket.  Defined as "any PR in W's canonical throughput
        # PR set has ``comments_extracted_at IS NULL``" (NOT bucket-
        # specific because the per-reviewer dimension's bucket-vs-PR
        # relationship is invisible until extraction).
        coverage_cursor = self.db.execute(
            "SELECT MAX(CASE WHEN pr.comments_extracted_at IS NULL "
            "             THEN 1 ELSE 0 END) AS coverage_partial "
            "FROM pull_requests pr "
            "INNER JOIN _aggr_week_by_reviewer_comments_slice s "
            "  ON s.pull_request_uid = pr.pull_request_uid"
        )
        coverage_row = coverage_cursor.fetchone()
        coverage_raw = (
            coverage_row["coverage_partial"] if coverage_row is not None else None
        )
        same_w_coverage_partial = coverage_raw is not None and int(coverage_raw) > 0

        # Step 2: per-(week, reviewer) aggregation.  Iterate
        # ``pr_comments`` rows (CL-13 / INV-4-13); apply C1
        # (``is_deleted = 0``) + CL-04 self-comment exclusion + extracted-
        # subset filter; group by ``commenter_or_sentinel``; compute
        # COUNT(DISTINCT (uid, thread_id)) for thread_count +
        # active_thread_count (FR-1-05 — divergence from #334 / #335 raw
        # row count).
        #
        # Two correctness gaps fixed post-Codex stop-time review on
        # commit 182b41f1:
        #
        # (1) ``pr_comments.thread_id`` is PR-scoped per ``models.py:141``
        #     ("ADO thread IDs are PR-scoped (small integers starting from
        #     1 per PR)").  ``COUNT(DISTINCT pc.thread_id)`` collapses
        #     cross-PR collisions: thread_id="1" on PR-A and PR-B count
        #     as ONE distinct value when they're TWO distinct threads.
        #     Fix: ``COUNT(DISTINCT pc.pull_request_uid || '|' || pc.thread_id)``
        #     uses the composite (uid, thread_id) tuple per the schema's
        #     primary key shape (``models.py:151`` /
        #     ``models.py:169``).  ``|`` as the separator never appears
        #     in UUID-format pull_request_uid values (UUIDs use only hex
        #     chars + hyphens) so the concatenation is collision-safe.
        #
        # (2) Per the C1 inclusion-rule contract at
        #     ``specs/310-comments-visualization/spec.md`` line 81: "Rows
        #     where pr_threads.is_deleted = 1 MUST be excluded from every
        #     thread count."  The pre-fix COUNT(DISTINCT) without
        #     ``t.is_deleted = 0`` filter would count threads that have
        #     non-deleted comments but are themselves marked deleted — a
        #     C1 violation.  Fix: filter ``t.is_deleted = 0`` inside the
        #     CASE expression for thread_count + active_thread_count
        #     while LEAVING the WHERE clause untouched (so comment_count
        #     still includes non-deleted comments on deleted threads,
        #     matching FR-2-03's INDEPENDENT count which doesn't filter
        #     thread state — sum-coherence preserved).
        cursor = self.db.execute(
            "SELECT "
            # Raw commenter-ID corruption (NULL or empty pc.author_id)
            # MUST be detected BEFORE the LEFT JOIN sentinel branch.
            # A row with pc.author_id = '' (or NULL) and no matching
            # users.user_id = '' would otherwise route through
            # u.user_id IS NULL → sentinel literal, silently bucketing
            # extractor corruption as the sentinel.  The outer CASE
            # returns '' for both NULL and empty raw values so the
            # iteration guard fires (FR-1-12 / CL-15).
            "  CASE "
            "    WHEN pc.author_id IS NULL OR pc.author_id = '' THEN '' "
            "    WHEN u.user_id IS NULL THEN ? "
            "    ELSE pc.author_id "
            "  END "
            "    AS commenter_or_sentinel, "
            "  COUNT(*) AS comment_count, "
            "  COUNT(DISTINCT CASE WHEN t.is_deleted = 0 "
            "                      THEN pc.pull_request_uid || '|' || pc.thread_id "
            "                      ELSE NULL END) "
            "    AS thread_count, "
            "  COUNT(DISTINCT CASE WHEN t.is_deleted = 0 "
            "                       AND t.status = 'active' "
            "                      THEN pc.pull_request_uid || '|' || pc.thread_id "
            "                      ELSE NULL END) "
            "    AS active_thread_count, "
            # vote_event_count: raw row count restricted to system rows whose
            # content matches the shared vote-event regex (see
            # ``extraction/vote_events.py``).  Sum-coherent subset of
            # ``comment_count`` per bucket: ``vote_event_count <=
            # comment_count`` because the CASE predicate is a subset of the
            # outer COUNT(*) population (same self-comment exclusion +
            # is_deleted=0 filters apply).
            "  SUM(CASE WHEN pc.comment_type = 'system' "
            "                AND is_vote_event(pc.content) = 1 "
            "           THEN 1 ELSE 0 END) "
            "    AS vote_event_count "
            "FROM pr_comments pc "
            "INNER JOIN _aggr_week_by_reviewer_comments_slice s "
            "  ON s.pull_request_uid = pc.pull_request_uid "
            "INNER JOIN pull_requests pr "
            "  ON pr.pull_request_uid = pc.pull_request_uid "
            "LEFT JOIN users u "
            "  ON u.user_id = pc.author_id "
            "LEFT JOIN pr_threads t "
            "  ON t.pull_request_uid = pc.pull_request_uid "
            "  AND t.thread_id = pc.thread_id "
            "WHERE pr.comments_extracted_at IS NOT NULL "
            "  AND pc.is_deleted = 0 "
            "  AND pc.author_id != pr.user_id "
            "GROUP BY commenter_or_sentinel "
            "ORDER BY commenter_or_sentinel ASC",
            (FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL,),
        )

        buckets: dict[str, dict[str, int | bool]] = {}
        for row in cursor.fetchall():
            key_raw = row["commenter_or_sentinel"]
            # FR-1-12 / CL-15 FAIL-LOUD on shape corruption.  NULL is
            # structurally unreachable here (the CASE expression maps
            # absent-from-users rows to the sentinel literal, and
            # pr_comments.author_id NOT NULL prevents NULL at INSERT) —
            # the defensive raise is retained for forward-compat against
            # a hypothetical future SQL refactor.
            if key_raw is None:
                raise RuntimeError(
                    "_compute_weekly_by_reviewer_comments: cursor "
                    "returned a row with NULL commenter_or_sentinel.  "
                    "This is structurally unreachable through the "
                    "production SQL path (CASE maps absent-user to "
                    "sentinel literal; pr_comments.author_id NOT NULL "
                    "at models.py:160 prevents NULL at INSERT) — "
                    "reaching this branch indicates either schema "
                    "corruption OR a future SQL refactor regressed the "
                    "CASE expression.  See spec FR-1-12 + CL-15."
                )
            key = str(key_raw)
            # Empty-string check fires when the value is not the
            # by-design sentinel literal AND has zero length.  The
            # schema's TEXT NOT NULL constraint allows the empty
            # string, but an empty author_id is structurally
            # meaningless — it can never be a valid user identity nor
            # the sentinel literal (which is non-empty by
            # construction).  Reaching this branch implies extractor
            # corruption (or a non-extractor writer bypassing data
            # validation); fail loud rather than emit a bucket keyed
            # on the empty string.  Per CL-15 / FR-1-12 (revised by PR
            # review): UUID-shape is NOT enforced — non-UUID stable
            # IDs are accepted because the persisted schema does not
            # constrain identifier format.
            if key != FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL and key == "":
                raise RuntimeError(
                    "_compute_weekly_by_reviewer_comments: cursor "
                    "returned a row with empty-string "
                    "commenter_or_sentinel.  An empty author_id is "
                    "structurally meaningless (it can never be a valid "
                    "user identity nor the sentinel literal "
                    f"{FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL!r}) and "
                    "indicates extractor or writer corruption — "
                    "investigate before re-running the aggregator.  "
                    "See spec FR-1-12 + CL-15."
                )
            buckets[key] = {
                "thread_count": int(row["thread_count"]),
                "comment_count": int(row["comment_count"]),
                "active_thread_count": int(row["active_thread_count"]),
                "vote_event_count": int(row["vote_event_count"] or 0),
                "coverage_partial": same_w_coverage_partial,
            }

        if not buckets:
            return None
        return buckets

    def _generate_author_slice(
        self, week_group: pd.DataFrame, week_reviewers: pd.DataFrame
    ) -> dict[str, SliceMetrics]:
        """Generate per-author metrics slice for a week keyed by canonical user_id."""
        author_metrics = week_group.groupby("user_id").agg(
            pr_count=("pull_request_uid", "size"),
            cycle_time_valid_count=("cycle_time_minutes", "count"),
            cycle_time_p50=("cycle_time_minutes", lambda s: s.quantile(0.5)),
            cycle_time_p90=("cycle_time_minutes", lambda s: s.quantile(0.9)),
            review_time_valid_count=("review_time_minutes", "count"),
            review_time_p50=("review_time_minutes", lambda s: s.quantile(0.5)),
            review_time_p90=("review_time_minutes", lambda s: s.quantile(0.9)),
        )
        author_reviewer_counts = (
            week_group[["user_id", "pull_request_uid"]]
            .drop_duplicates()
            .merge(
                week_reviewers[["pull_request_uid", "reviewer_id"]],
                on="pull_request_uid",
                how="left",
            )
            .groupby("user_id")["reviewer_id"]
            .nunique()
        )
        author_metrics["reviewers_count"] = author_reviewer_counts.reindex(
            author_metrics.index,
            fill_value=0,
        )

        by_author: dict[str, SliceMetrics] = {}
        for author_id, row in author_metrics.iterrows():
            if not isinstance(author_id, str):
                continue

            cycle_time_valid_count = int(row["cycle_time_valid_count"])
            review_time_valid_count = int(row["review_time_valid_count"])
            by_author[str(author_id)] = {
                "pr_count": int(row["pr_count"]),
                "cycle_time_p50": row["cycle_time_p50"]
                if cycle_time_valid_count >= self._ROLLUP_MIN_SAMPLE
                and not pd.isna(row["cycle_time_p50"])
                else None,
                "cycle_time_p90": row["cycle_time_p90"]
                if cycle_time_valid_count >= self._ROLLUP_MIN_SAMPLE
                and not pd.isna(row["cycle_time_p90"])
                else None,
                "review_time_p50": row["review_time_p50"]
                if review_time_valid_count >= self._ROLLUP_MIN_SAMPLE
                and not pd.isna(row["review_time_p50"])
                else None,
                "review_time_p90": row["review_time_p90"]
                if review_time_valid_count >= self._ROLLUP_MIN_SAMPLE
                and not pd.isna(row["review_time_p90"])
                else None,
                "authors_count": 1,
                "reviewers_count": int(row["reviewers_count"]),
            }

        return by_author

    def _generate_author_repo_slice(
        self, week_group: pd.DataFrame, week_reviewers: pd.DataFrame
    ) -> dict[str, dict[str, SliceMetrics] | bool]:
        """Generate per-author-per-repository metrics slice for a week."""
        entries: dict[str, dict[str, SliceMetrics]] = {}
        grouped_metrics = week_group.groupby(["user_id", "repository_name"]).agg(
            pr_count=("pull_request_uid", "size"),
            cycle_time_valid_count=("cycle_time_minutes", "count"),
            cycle_time_p50=("cycle_time_minutes", lambda s: s.quantile(0.5)),
            cycle_time_p90=("cycle_time_minutes", lambda s: s.quantile(0.9)),
            review_time_valid_count=("review_time_minutes", "count"),
            review_time_p50=("review_time_minutes", lambda s: s.quantile(0.5)),
            review_time_p90=("review_time_minutes", lambda s: s.quantile(0.9)),
        )
        reviewer_counts = (
            week_group[["user_id", "repository_name", "pull_request_uid"]]
            .drop_duplicates()
            .merge(
                week_reviewers[["pull_request_uid", "reviewer_id"]],
                on="pull_request_uid",
                how="left",
            )
            .groupby(["user_id", "repository_name"])["reviewer_id"]
            .nunique()
        )
        grouped_metrics["reviewers_count"] = reviewer_counts.reindex(
            grouped_metrics.index,
            fill_value=0,
        )

        all_entries: list[tuple[str, str, SliceMetrics]] = []
        for key, row in grouped_metrics.iterrows():
            author_id, repo_name = cast(tuple[str, str], key)
            if not isinstance(author_id, str) or not isinstance(repo_name, str):
                continue

            cycle_time_valid_count = int(row["cycle_time_valid_count"])
            review_time_valid_count = int(row["review_time_valid_count"])
            all_entries.append(
                (
                    author_id,
                    repo_name,
                    {
                        "pr_count": int(row["pr_count"]),
                        "cycle_time_p50": row["cycle_time_p50"]
                        if cycle_time_valid_count >= self._ROLLUP_MIN_SAMPLE
                        and not pd.isna(row["cycle_time_p50"])
                        else None,
                        "cycle_time_p90": row["cycle_time_p90"]
                        if cycle_time_valid_count >= self._ROLLUP_MIN_SAMPLE
                        and not pd.isna(row["cycle_time_p90"])
                        else None,
                        "review_time_p50": row["review_time_p50"]
                        if review_time_valid_count >= self._ROLLUP_MIN_SAMPLE
                        and not pd.isna(row["review_time_p50"])
                        else None,
                        "review_time_p90": row["review_time_p90"]
                        if review_time_valid_count >= self._ROLLUP_MIN_SAMPLE
                        and not pd.isna(row["review_time_p90"])
                        else None,
                        "authors_count": 1,
                        "reviewers_count": int(row["reviewers_count"]),
                    },
                )
            )

        truncated = False
        if len(all_entries) > self._CROSS_DIM_MAX_ENTRIES:
            all_entries = sorted(
                all_entries,
                key=lambda item: (
                    -int(item[2]["pr_count"]),
                    item[0],
                    item[1],
                ),
            )[: self._CROSS_DIM_MAX_ENTRIES]
            truncated = True
            logger.warning(
                "Author x repository entries truncated to %d for week "
                "(least-significant intersections removed)",
                len(all_entries),
            )

        for author_id, repo_name, entry in all_entries:
            if author_id not in entries:
                entries[author_id] = {}
            entries[author_id][repo_name] = entry

        by_author_and_repo = cast(dict[str, dict[str, SliceMetrics] | bool], entries)
        if truncated:
            by_author_and_repo["_truncated"] = True

        return by_author_and_repo

    def _generate_repo_slice(
        self, week_group: pd.DataFrame, week_reviewers: pd.DataFrame
    ) -> dict[str, SliceMetrics]:
        """Generate per-repository metrics slice for a week.

        Args:
            week_group: DataFrame of PRs for the week
            week_reviewers: DataFrame of reviewers for PRs in this week

        Returns:
            Dict mapping repository_name to metrics
        """
        grouped_metrics = week_group.groupby("repository_name").agg(
            pr_count=("pull_request_uid", "size"),
            cycle_time_valid_count=("cycle_time_minutes", "count"),
            cycle_time_p50=("cycle_time_minutes", lambda s: s.quantile(0.5)),
            cycle_time_p90=("cycle_time_minutes", lambda s: s.quantile(0.9)),
            review_time_valid_count=("review_time_minutes", "count"),
            review_time_p50=("review_time_minutes", lambda s: s.quantile(0.5)),
            review_time_p90=("review_time_minutes", lambda s: s.quantile(0.9)),
            authors_count=("user_id", "nunique"),
        )
        reviewer_counts = (
            week_group[["repository_name", "pull_request_uid"]]
            .drop_duplicates()
            .merge(
                week_reviewers[["pull_request_uid", "reviewer_id"]],
                on="pull_request_uid",
                how="left",
            )
            .groupby("repository_name")["reviewer_id"]
            .nunique()
        )
        grouped_metrics["reviewers_count"] = reviewer_counts.reindex(
            grouped_metrics.index,
            fill_value=0,
        )

        by_repository: dict[str, SliceMetrics] = {}
        for repo_name, row in grouped_metrics.iterrows():
            if not isinstance(repo_name, str):
                continue

            cycle_time_valid_count = int(row["cycle_time_valid_count"])
            review_time_valid_count = int(row["review_time_valid_count"])
            by_repository[str(repo_name)] = {
                "pr_count": int(row["pr_count"]),
                "cycle_time_p50": row["cycle_time_p50"]
                if cycle_time_valid_count >= self._ROLLUP_MIN_SAMPLE
                and not pd.isna(row["cycle_time_p50"])
                else None,
                "cycle_time_p90": row["cycle_time_p90"]
                if cycle_time_valid_count >= self._ROLLUP_MIN_SAMPLE
                and not pd.isna(row["cycle_time_p90"])
                else None,
                "review_time_p50": row["review_time_p50"]
                if review_time_valid_count >= self._ROLLUP_MIN_SAMPLE
                and not pd.isna(row["review_time_p50"])
                else None,
                "review_time_p90": row["review_time_p90"]
                if review_time_valid_count >= self._ROLLUP_MIN_SAMPLE
                and not pd.isna(row["review_time_p90"])
                else None,
                "authors_count": int(row["authors_count"]),
                "reviewers_count": int(row["reviewers_count"]),
            }

        return by_repository

    def _generate_team_slice(
        self,
        week_group: pd.DataFrame,
        week_reviewers: pd.DataFrame,
        team_members_df: pd.DataFrame,
    ) -> dict[str, SliceMetrics]:
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

        deduped_members = team_members_df[["user_id", "team_name"]].drop_duplicates()
        deduped_members = deduped_members.dropna(subset=["user_id", "team_name"])
        tagged = week_group.merge(deduped_members, on="user_id", how="inner")
        if tagged.empty:
            return {}

        grouped_metrics = tagged.groupby("team_name").agg(
            pr_count=("pull_request_uid", "size"),
            cycle_time_valid_count=("cycle_time_minutes", "count"),
            cycle_time_p50=("cycle_time_minutes", lambda s: s.quantile(0.5)),
            cycle_time_p90=("cycle_time_minutes", lambda s: s.quantile(0.9)),
            review_time_valid_count=("review_time_minutes", "count"),
            review_time_p50=("review_time_minutes", lambda s: s.quantile(0.5)),
            review_time_p90=("review_time_minutes", lambda s: s.quantile(0.9)),
            authors_count=("user_id", "nunique"),
        )
        reviewer_counts = (
            tagged[["team_name", "pull_request_uid"]]
            .drop_duplicates()
            .merge(
                week_reviewers[["pull_request_uid", "reviewer_id"]],
                on="pull_request_uid",
                how="left",
            )
            .groupby("team_name")["reviewer_id"]
            .nunique()
        )
        grouped_metrics["reviewers_count"] = reviewer_counts.reindex(
            grouped_metrics.index,
            fill_value=0,
        )

        by_team: dict[str, SliceMetrics] = {}
        for team_name, row in grouped_metrics.iterrows():
            if not isinstance(team_name, str):
                continue

            cycle_time_valid_count = int(row["cycle_time_valid_count"])
            review_time_valid_count = int(row["review_time_valid_count"])
            by_team[str(team_name)] = {
                "pr_count": int(row["pr_count"]),
                "cycle_time_p50": row["cycle_time_p50"]
                if cycle_time_valid_count >= self._ROLLUP_MIN_SAMPLE
                and not pd.isna(row["cycle_time_p50"])
                else None,
                "cycle_time_p90": row["cycle_time_p90"]
                if cycle_time_valid_count >= self._ROLLUP_MIN_SAMPLE
                and not pd.isna(row["cycle_time_p90"])
                else None,
                "review_time_p50": row["review_time_p50"]
                if review_time_valid_count >= self._ROLLUP_MIN_SAMPLE
                and not pd.isna(row["review_time_p50"])
                else None,
                "review_time_p90": row["review_time_p90"]
                if review_time_valid_count >= self._ROLLUP_MIN_SAMPLE
                and not pd.isna(row["review_time_p90"])
                else None,
                "authors_count": int(row["authors_count"]),
                "reviewers_count": int(row["reviewers_count"]),
            }

        return by_team

    def _generate_reviewer_slice(
        self,
        week_group: pd.DataFrame,
        week_reviewers: pd.DataFrame,
    ) -> dict[str, ReviewerSliceMetrics]:
        """Generate per-reviewer activity metrics for a week.

        Reviewer slices are keyed by stable reviewer_id rather than display
        name. This avoids ambiguity when multiple users share a display name
        and lets the UI use dimensions metadata for labels.

        Phase 1 reviewer metrics intentionally exclude cycle-time and
        review-latency fields. Those require a richer persisted review event
        model than the current reviewers table provides.
        """
        if week_reviewers.empty:
            return {}

        reviewer_prs = week_reviewers.merge(
            week_group[
                ["pull_request_uid", "user_id", "repository_name"]
            ].drop_duplicates(subset=["pull_request_uid"]),
            on="pull_request_uid",
            how="inner",
        )

        if reviewer_prs.empty:
            return {}

        by_reviewer: dict[str, ReviewerSliceMetrics] = {}

        for reviewer_id, reviewer_group in reviewer_prs.groupby("reviewer_id"):
            if pd.isna(reviewer_id):
                continue

            # Phase 1 reviewer activity only counts stored review outcomes.
            # Requested-but-pending reviewer rows use vote=0 and must not
            # contribute to reviewed PRs or approval rate.
            outcome_group = reviewer_group[
                reviewer_group["vote"].notna() & (reviewer_group["vote"] != 0)
            ]

            reviewed_prs = int(outcome_group["pull_request_uid"].nunique())
            if reviewed_prs == 0:
                continue

            approved_prs = int(
                outcome_group.loc[
                    outcome_group["vote"] == 10, "pull_request_uid"
                ].nunique()
            )

            by_reviewer[str(reviewer_id)] = {
                "reviewed_prs": reviewed_prs,
                "reviews_count": int(len(outcome_group)),
                "approval_rate": approved_prs / reviewed_prs,
                "authors_count": int(outcome_group["user_id"].nunique()),
                "repositories_count": int(
                    outcome_group["repository_name"].dropna().nunique()
                ),
            }

        return by_reviewer

    # Maximum cross-dimensional entries per week before truncation (FR-017)
    _CROSS_DIM_MAX_ENTRIES = 5000
    # Minimum sample size for cycle time percentiles in cross-dim slices (FR-019)
    _CROSS_DIM_MIN_SAMPLE = 5
    # Minimum sample size for cycle time percentiles in rollup/dimension slices
    _ROLLUP_MIN_SAMPLE = 2

    def _generate_team_repo_slice(
        self,
        week_group: pd.DataFrame,
        week_reviewers: pd.DataFrame,
        team_members_df: pd.DataFrame,
    ) -> dict[str, dict[str, SliceMetrics] | bool]:
        """Generate per-team-per-repository metrics slice for a week.

        Joins week PRs against team_members_df to tag each PR with its team
        membership(s), then groups by (team_name, repository_name) in a single
        pass. This is O(PRs * avg_teams_per_author + unique_pairs) rather than
        O(teams * repos), matching the groupby pattern in _generate_repo_slice().

        Authors in multiple teams will have their PRs counted in each team's
        slice — consistent with _generate_team_slice() semantics.

        Args:
            week_group: DataFrame of PRs for the week (must have user_id,
                repository_name, pull_request_uid, cycle_time_minutes columns).
            week_reviewers: DataFrame of reviewers for PRs in this week
                (must have pull_request_uid, reviewer_id columns).
            team_members_df: DataFrame with team_name and user_id columns.

        Returns:
            Sparse nested dict {team_name: {repo_name: {metrics...}}}.
            Empty dict if no team data or no intersections found.
            Includes '_truncated': True at top level if entries exceed the
            5,000 entry cap and were truncated.
        """
        if team_members_df.empty:
            return {}

        # Deduplicate team memberships on (user_id, team_name) to prevent
        # PR row inflation when the same team_name appears under multiple
        # team_ids (e.g., same-named teams across projects).
        deduped_members = team_members_df[["user_id", "team_name"]].drop_duplicates()
        deduped_members = deduped_members.dropna(subset=["user_id", "team_name"])

        # Join PRs with team memberships to tag each PR with its team(s).
        # A multi-team author produces one row per team membership.
        tagged = week_group.merge(
            deduped_members,
            on="user_id",
            how="inner",
        )

        if tagged.empty:
            return {}

        entries: dict[str, dict[str, SliceMetrics]] = {}
        # Compute team-repo metrics in one pass rather than filtering reviewers
        # per intersection. This keeps the enterprise stress path bounded by a
        # few groupby/merge operations per week instead of N repeated isin scans.
        grouped_metrics = tagged.groupby(["team_name", "repository_name"]).agg(
            pr_count=("pull_request_uid", "size"),
            cycle_time_valid_count=("cycle_time_minutes", "count"),
            cycle_time_p50=("cycle_time_minutes", lambda s: s.quantile(0.5)),
            cycle_time_p90=("cycle_time_minutes", lambda s: s.quantile(0.9)),
            review_time_valid_count=("review_time_minutes", "count"),
            review_time_p50=("review_time_minutes", lambda s: s.quantile(0.5)),
            review_time_p90=("review_time_minutes", lambda s: s.quantile(0.9)),
            authors_count=("user_id", "nunique"),
        )

        tagged_pr_pairs = tagged[
            ["team_name", "repository_name", "pull_request_uid"]
        ].drop_duplicates()
        reviewers_by_intersection = (
            tagged_pr_pairs.merge(
                week_reviewers[["pull_request_uid", "reviewer_id"]],
                on="pull_request_uid",
                how="left",
            )
            .groupby(["team_name", "repository_name"])["reviewer_id"]
            .nunique()
        )
        grouped_metrics["reviewers_count"] = reviewers_by_intersection.reindex(
            grouped_metrics.index,
            fill_value=0,
        )

        # Collect all entries with their pr_count for potential truncation
        all_entries: list[tuple[str, str, SliceMetrics]] = []

        for key, row in grouped_metrics.iterrows():
            team_name, repo_name = cast(tuple[str, str], key)
            if not isinstance(team_name, str) or not isinstance(repo_name, str):
                continue

            cycle_time_valid_count = int(row["cycle_time_valid_count"])
            cycle_time_p50 = (
                None
                if cycle_time_valid_count < self._CROSS_DIM_MIN_SAMPLE
                or pd.isna(row["cycle_time_p50"])
                else row["cycle_time_p50"]
            )
            cycle_time_p90 = (
                None
                if cycle_time_valid_count < self._CROSS_DIM_MIN_SAMPLE
                or pd.isna(row["cycle_time_p90"])
                else row["cycle_time_p90"]
            )
            review_time_valid_count = int(row["review_time_valid_count"])
            review_time_p50 = (
                None
                if review_time_valid_count < self._CROSS_DIM_MIN_SAMPLE
                or pd.isna(row["review_time_p50"])
                else row["review_time_p50"]
            )
            review_time_p90 = (
                None
                if review_time_valid_count < self._CROSS_DIM_MIN_SAMPLE
                or pd.isna(row["review_time_p90"])
                else row["review_time_p90"]
            )

            all_entries.append(
                (
                    team_name,
                    repo_name,
                    {
                        "pr_count": int(row["pr_count"]),
                        "cycle_time_p50": cycle_time_p50,
                        "cycle_time_p90": cycle_time_p90,
                        "review_time_p50": review_time_p50,
                        "review_time_p90": review_time_p90,
                        "authors_count": int(row["authors_count"]),
                        "reviewers_count": int(row["reviewers_count"]),
                    },
                )
            )

        entry_count = len(all_entries)

        # Truncation: if entries exceed cap, keep the most significant
        # intersections by descending pr_count rather than whole teams.
        truncated = False
        if entry_count > self._CROSS_DIM_MAX_ENTRIES:
            all_entries = sorted(
                all_entries,
                key=lambda item: (
                    -int(item[2]["pr_count"]),
                    item[0],
                    item[1],
                ),
            )
            all_entries = all_entries[: self._CROSS_DIM_MAX_ENTRIES]
            truncated = True
            logger.warning(
                "Cross-dimensional entries truncated from %d to %d for week "
                "(least-significant intersections removed)",
                entry_count,
                len(all_entries),
            )

        # Build nested dict from (possibly truncated) entries
        for team_name, repo_name, entry in all_entries:
            if team_name not in entries:
                entries[team_name] = {}
            entries[team_name][repo_name] = entry

        by_team_and_repo = cast(dict[str, dict[str, SliceMetrics] | bool], entries)
        if truncated:
            # NOTE: Mixed-type key — bool value alongside dict values.
            # Consumers must skip "_"-prefixed keys when iterating entries.
            by_team_and_repo["_truncated"] = True

        return by_team_and_repo

    def _generate_distributions(self) -> list[DistributionIndexEntry]:
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

        index: list[DistributionIndexEntry] = []

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

    def _get_capabilities(self) -> dict[str, str | bool]:
        """Get additive capability metadata for loader normalization."""
        capabilities: dict[str, str | bool] = {
            "author_filters": True,
            "author_repo_exact": True,
            "comments_metrics": self._has_comments(),
            "reviewer_repository_mode": "constrained",
            "reviewer_team_mode": "disallowed",
            "cross_dimensional_available": self._any_rollup_has_cross_dim,
        }

        # Guard against accidental drift in emitted capability fields.
        return {
            key: capabilities[key]
            for key in MANIFEST_CAPABILITY_KEYS
            if key in capabilities
        }

    def _get_comments_coverage(self) -> CommentsCoverage:
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
            # Legacy DB may not have comments tables at all.
            thread_count = 0
            comment_count = 0
            prs_with_threads = 0

        # Metadata query is separate: a corrupted or missing metadata
        # table must not zero out thread/comment counts (which determine
        # has_content below).
        try:
            metadata_cursor = self.db.execute(
                """
                SELECT prs_processed, capped
                FROM comments_extraction_metadata
                WHERE id = 1
                """
            )
            metadata_row = metadata_cursor.fetchone()
        except Exception:
            metadata_row = None

        # Coverage is derived from per-PR markers (comments_extracted_at),
        # NOT from the batch-scoped comments_extraction_metadata.prs_processed
        # which only records the most recent --include-comments run.
        #
        # Status rules:
        #   full    = every completed PR has comments_extracted_at set
        #   partial = at least one completed PR lacks comments_extracted_at
        #   disabled = no evidence that comment extraction ever ran
        has_content = thread_count > 0 or comment_count > 0
        extraction_ran = (
            metadata_row is not None and int(metadata_row["prs_processed"]) > 0
        )

        try:
            total_row = self.db.execute(
                "SELECT COUNT(*) AS cnt FROM pull_requests WHERE status = 'completed'"
            ).fetchone()
            total_completed = int(total_row["cnt"]) if total_row else 0
        except Exception:
            total_completed = 0

        # Count completed PRs that have been processed by comment extraction.
        # comments_extracted_at is set per-PR during extraction and survives
        # across incremental runs — it is monotonic (never regresses).
        try:
            covered_row = self.db.execute(
                "SELECT COUNT(*) AS cnt FROM pull_requests "
                "WHERE status = 'completed' AND comments_extracted_at IS NOT NULL"
            ).fetchone()
            covered_count = int(covered_row["cnt"]) if covered_row else 0
        except Exception:
            # Legacy DB may not have comments_extracted_at column yet.
            # Fall back to extraction_ran heuristic.
            covered_count = -1

        if covered_count >= 0:
            # Per-PR marker available — authoritative coverage signal.
            if covered_count == 0 and not extraction_ran and not has_content:
                status = "disabled"
            elif total_completed > 0 and covered_count >= total_completed:
                status = "full"
            else:
                status = "partial"
        elif extraction_ran and bool(metadata_row["capped"]):
            # Legacy DB without per-PR marker, batch was capped.
            status = "partial"
        elif extraction_ran or has_content:
            status = "partial"
        else:
            status = "disabled"

        return {
            "status": status,
            "threads_fetched": thread_count,
            "comments_fetched": comment_count,
            "prs_with_threads": prs_with_threads,
            "capped": bool(metadata_row["capped"])
            if metadata_row is not None
            else False,
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
        weekly_index: list[WeeklyRollupIndexEntry],
        dist_index: list[DistributionIndexEntry],
    ) -> OperationalSummary:
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

    def _write_json(self, path: Path, data: dict[str, JSONValue]) -> None:
        """Write JSON file with deterministic formatting.

        Uses allow_nan=False to reject NaN/Infinity values that would
        produce invalid JSON (not part of the JSON spec per RFC 7159).
        """
        with path.open("w", encoding="utf-8") as f:
            json.dump(
                data,
                f,
                indent=2,
                sort_keys=True,
                allow_nan=False,
                cls=_NumpySafeEncoder,
            )


class DeterministicRNG(random.Random):
    """Non-cryptographic seeded RNG for deterministic synthetic data.

    NOT for security-sensitive operations. Used only for reproducible
    stub generation behind the ALLOW_ML_STUBS=1 safety gate.
    """


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

    def generate(self) -> dict[str, JSONValue] | None:
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
                rng = DeterministicRNG(seed)

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
            "generated_at": datetime.now(UTC).isoformat(),
            "is_stub": True,
            "generated_by": STUB_GENERATOR_ID,
            "forecasts": forecasts,
        }

        # Write file
        file_path = predictions_dir / "trends.json"
        with file_path.open("w", encoding="utf-8") as f:
            json.dump(predictions, f, indent=2, sort_keys=True)

        logger.info("Generated predictions/trends.json (stub data)")
        return cast(dict[str, JSONValue], predictions)


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

    def generate(self) -> dict[str, JSONValue] | None:
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
        rng = DeterministicRNG(seed)

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
            "generated_at": datetime.now(UTC).isoformat(),
            "is_stub": True,
            "generated_by": STUB_GENERATOR_ID,
            "insights": insights_list,
        }

        # Write file
        file_path = insights_dir / "summary.json"
        with file_path.open("w", encoding="utf-8") as f:
            json.dump(insights, f, indent=2, sort_keys=True)

        logger.info("Generated insights/summary.json (stub data)")
        return cast(dict[str, JSONValue], insights)
