"""Chunked aggregate generator for Phase 3 UI.

Generates JSON aggregates from SQLite for scale-safe UI rendering:
- weekly_rollups/YYYY-Www.json - Weekly PR metrics
- distributions/YYYY.json - Yearly distribution data
- dimensions.json - Filter dimensions (repos, users, teams)
- dataset-manifest.json - Discovery metadata with schema versions
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
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
    generated_at: str = ""
    run_id: str = ""
    aggregate_index: AggregateIndex = field(default_factory=AggregateIndex)
    defaults: dict[str, Any] = field(default_factory=dict)
    limits: dict[str, Any] = field(default_factory=dict)
    features: dict[str, bool] = field(default_factory=dict)
    coverage: dict[str, Any] = field(default_factory=dict)


class AggregateGenerator:
    """Generate chunked JSON aggregates from SQLite.

    Phase 3: Produces weekly rollups and distributions for lazy UI loading.
    """

    def __init__(
        self,
        db: DatabaseManager,
        output_dir: Path,
        run_id: str = "",
    ) -> None:
        """Initialize the aggregate generator.

        Args:
            db: Database manager instance.
            output_dir: Directory for aggregate output.
            run_id: Pipeline run ID for manifest.
        """
        self.db = db
        self.output_dir = output_dir
        self.run_id = run_id or datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")

    def generate_all(self) -> DatasetManifest:
        """Generate all aggregate files and manifest.

        Returns:
            DatasetManifest with generated file index.

        Raises:
            AggregationError: If generation fails.
        """
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

            # Build manifest
            manifest = DatasetManifest(
                generated_at=datetime.now(timezone.utc).isoformat(),
                run_id=self.run_id,
                aggregate_index=AggregateIndex(
                    weekly_rollups=weekly_index,
                    distributions=dist_index,
                ),
                defaults={"default_date_range_days": 90},
                limits={"max_date_range_days_soft": 730},
                features={
                    "teams": False,  # Phase 3.3
                    "comments": False,  # Phase 3.4
                    "ml": False,  # Phase 3.5
                    "ai_insights": False,  # Phase 3.5
                },
                coverage={
                    "total_prs": self._get_pr_count(),
                    "date_range": dimensions.date_range,
                },
            )

            # Write manifest
            self._write_json(
                self.output_dir / "dataset-manifest.json",
                asdict(manifest),
            )
            logger.info("Generated dataset-manifest.json")

            return manifest

        except Exception as e:
            raise AggregationError(f"Failed to generate aggregates: {e}") from e

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

        return Dimensions(
            repositories=list(repos_df.to_dict(orient="records")),  # type: ignore[arg-type]
            users=list(users_df.to_dict(orient="records")),  # type: ignore[arg-type]
            projects=list(projects_df.to_dict(orient="records")),  # type: ignore[arg-type]
            date_range=date_range,
        )

    def _generate_weekly_rollups(self) -> list[dict[str, Any]]:
        """Generate weekly rollup files, one per ISO week."""
        # Query PRs with closed dates
        df = pd.read_sql_query(
            """
            SELECT
                closed_date,
                cycle_time_minutes,
                user_id,
                pull_request_uid
            FROM pull_requests
            WHERE closed_date IS NOT NULL AND status = 'completed'
            ORDER BY closed_date
            """,
            self.db.connection,
        )

        if df.empty:
            return []

        # Convert to datetime and extract ISO week
        df["closed_dt"] = pd.to_datetime(df["closed_date"])
        df["iso_year"] = df["closed_dt"].dt.isocalendar().year
        df["iso_week"] = df["closed_dt"].dt.isocalendar().week

        index: list[dict[str, Any]] = []

        # Group by ISO year-week
        for (iso_year, iso_week), group in df.groupby(["iso_year", "iso_week"]):
            week_str = f"{iso_year}-W{iso_week:02d}"

            # Calculate week boundaries (iso_year/iso_week are UInt32 from pandas)
            year_int = int(iso_year)  # type: ignore[call-overload]
            week_int = int(iso_week)  # type: ignore[call-overload]
            start_date = date.fromisocalendar(year_int, week_int, 1)
            end_date = date.fromisocalendar(year_int, week_int, 7)

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
                reviewers_count=0,  # TODO: Add reviewer counting
            )

            # Write file
            file_path = (
                self.output_dir / "aggregates" / "weekly_rollups" / f"{week_str}.json"
            )
            self._write_json(file_path, asdict(rollup))

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

    def _write_json(self, path: Path, data: dict[str, Any]) -> None:
        """Write JSON file with deterministic formatting."""
        with path.open("w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, sort_keys=True)
