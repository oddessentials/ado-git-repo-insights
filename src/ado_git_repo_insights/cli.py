"""CLI entry point for ado-git-repo-insights."""

from __future__ import annotations

import argparse
import logging
import sys
import time
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING

from .config import ConfigurationError, load_config
from .extractor.ado_client import ADOClient, ExtractionError
from .extractor.pr_extractor import PRExtractor
from .persistence.database import DatabaseError, DatabaseManager
from .transform.aggregators import AggregateGenerator, AggregationError
from .transform.csv_generator import CSVGenerationError, CSVGenerator
from .utils.logging_config import LoggingConfig, setup_logging
from .utils.run_summary import (
    RunCounts,
    RunSummary,
    RunTimings,
    create_minimal_summary,
    get_git_sha,
    get_tool_version,
)

if TYPE_CHECKING:
    from argparse import Namespace

logger = logging.getLogger(__name__)


def create_parser() -> argparse.ArgumentParser:  # pragma: no cover
    """Create the argument parser for the CLI."""
    parser = argparse.ArgumentParser(
        prog="ado-insights",
        description="Extract Azure DevOps PR metrics and generate PowerBI-compatible CSVs.",
    )

    # Global options
    parser.add_argument(
        "--log-format",
        type=str,
        choices=["console", "jsonl"],
        default="console",
        help="Log format: console (human-readable) or jsonl (structured)",
    )
    parser.add_argument(
        "--artifacts-dir",
        type=Path,
        default=Path("run_artifacts"),
        help="Directory for run artifacts (summary, logs)",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    # Extract command
    extract_parser = subparsers.add_parser(
        "extract",
        help="Extract PR data from Azure DevOps",
    )
    extract_parser.add_argument(
        "--organization",
        type=str,
        help="Azure DevOps organization name",
    )
    extract_parser.add_argument(
        "--projects",
        type=str,
        help="Comma-separated list of project names",
    )
    extract_parser.add_argument(
        "--pat",
        type=str,
        required=True,
        help="Personal Access Token with Code (Read) scope",
    )
    extract_parser.add_argument(
        "--config",
        type=Path,
        help="Path to config.yaml file",
    )
    extract_parser.add_argument(
        "--database",
        type=Path,
        default=Path("ado-insights.sqlite"),
        help="Path to SQLite database file",
    )
    extract_parser.add_argument(
        "--start-date",
        type=str,
        help="Override start date (YYYY-MM-DD)",
    )
    extract_parser.add_argument(
        "--end-date",
        type=str,
        help="Override end date (YYYY-MM-DD)",
    )
    extract_parser.add_argument(
        "--backfill-days",
        type=int,
        help="Number of days to backfill for convergence",
    )

    # Generate CSV command
    csv_parser = subparsers.add_parser(
        "generate-csv",
        help="Generate CSV files from SQLite database",
    )
    csv_parser.add_argument(
        "--database",
        type=Path,
        required=True,
        help="Path to SQLite database file",
    )
    csv_parser.add_argument(
        "--output",
        type=Path,
        default=Path("csv_output"),
        help="Output directory for CSV files",
    )

    # Generate Aggregates command (Phase 3)
    agg_parser = subparsers.add_parser(
        "generate-aggregates",
        help="Generate chunked JSON aggregates for UI (Phase 3)",
    )
    agg_parser.add_argument(
        "--database",
        type=Path,
        required=True,
        help="Path to SQLite database file",
    )
    agg_parser.add_argument(
        "--output",
        type=Path,
        default=Path("aggregates_output"),
        help="Output directory for aggregate files",
    )
    agg_parser.add_argument(
        "--run-id",
        type=str,
        default="",
        help="Pipeline run ID for manifest metadata",
    )

    return parser


def cmd_extract(args: Namespace) -> int:
    """Execute the extract command."""
    start_time = time.perf_counter()
    timing = RunTimings()
    counts = RunCounts()
    warnings_list: list[str] = []
    per_project_status: dict[str, str] = {}
    first_fatal_error: str | None = None

    try:
        # Load and validate configuration
        config = load_config(
            config_path=args.config,
            organization=args.organization,
            projects=args.projects,
            pat=args.pat,
            database=args.database,
            start_date=args.start_date,
            end_date=args.end_date,
            backfill_days=args.backfill_days,
        )
        config.log_summary()

        # Connect to database
        extract_start = time.perf_counter()
        db = DatabaseManager(config.database)
        db.connect()

        try:
            # Create ADO client
            client = ADOClient(
                organization=config.organization,
                pat=config.pat,  # Invariant 19: PAT handled securely
                config=config.api,
            )

            # Test connection
            client.test_connection(config.projects[0])

            # Run extraction
            extractor = PRExtractor(client, db, config)
            summary = extractor.extract_all(backfill_days=args.backfill_days)

            # Collect timing
            timing.extract_seconds = time.perf_counter() - extract_start

            # Collect counts and warnings
            counts.prs_fetched = summary.total_prs
            if hasattr(summary, "warnings"):
                warnings_list.extend(summary.warnings)

            # Collect per-project status
            for project_result in summary.projects:
                status = "success" if project_result.success else "failed"
                per_project_status[project_result.project] = status

                # Capture first fatal error
                if not project_result.success and first_fatal_error is None:
                    first_fatal_error = (
                        project_result.error
                        or f"Extraction failed for project: {project_result.project}"
                    )

            # Fail-fast: any project failure = exit 1
            if not summary.success:
                logger.error("Extraction failed")
                timing.total_seconds = time.perf_counter() - start_time

                # Write failure summary
                run_summary = RunSummary(
                    tool_version=get_tool_version(),
                    git_sha=get_git_sha(),
                    organization=config.organization,
                    projects=config.projects,
                    date_range_start=str(config.date_range.start or date.today()),
                    date_range_end=str(config.date_range.end or date.today()),
                    counts=counts,
                    timings=timing,
                    warnings=warnings_list,
                    final_status="failed",
                    per_project_status=per_project_status,
                    first_fatal_error=first_fatal_error,
                )
                run_summary.write(args.artifacts_dir / "run_summary.json")
                run_summary.print_final_line()
                run_summary.emit_ado_commands()
                return 1

            logger.info(f"Extraction complete: {summary.total_prs} PRs")
            timing.total_seconds = time.perf_counter() - start_time

            # Write success summary
            run_summary = RunSummary(
                tool_version=get_tool_version(),
                git_sha=get_git_sha(),
                organization=config.organization,
                projects=config.projects,
                date_range_start=str(config.date_range.start or date.today()),
                date_range_end=str(config.date_range.end or date.today()),
                counts=counts,
                timings=timing,
                warnings=warnings_list,
                final_status="success",
                per_project_status=per_project_status,
                first_fatal_error=None,
            )
            run_summary.write(args.artifacts_dir / "run_summary.json")
            run_summary.print_final_line()
            run_summary.emit_ado_commands()
            return 0

        finally:
            db.close()

    except ConfigurationError as e:
        logger.error(f"Configuration error: {e}")
        # P2 Fix: Write minimal summary for caught errors
        minimal_summary = create_minimal_summary(
            f"Configuration error: {e}", args.artifacts_dir
        )
        minimal_summary.write(args.artifacts_dir / "run_summary.json")
        return 1
    except DatabaseError as e:
        logger.error(f"Database error: {e}")
        # P2 Fix: Write minimal summary for caught errors
        minimal_summary = create_minimal_summary(
            f"Database error: {e}", args.artifacts_dir
        )
        minimal_summary.write(args.artifacts_dir / "run_summary.json")
        return 1
    except ExtractionError as e:
        logger.error(f"Extraction error: {e}")
        # P2 Fix: Write minimal summary for caught errors
        minimal_summary = create_minimal_summary(
            f"Extraction error: {e}", args.artifacts_dir
        )
        minimal_summary.write(args.artifacts_dir / "run_summary.json")
        return 1


def cmd_generate_csv(args: Namespace) -> int:
    """Execute the generate-csv command."""
    logger.info("Generating CSV files...")
    logger.info(f"Database: {args.database}")
    logger.info(f"Output: {args.output}")

    if not args.database.exists():
        logger.error(f"Database not found: {args.database}")
        return 1

    try:
        db = DatabaseManager(args.database)
        db.connect()

        try:
            generator = CSVGenerator(db, args.output)
            results = generator.generate_all()

            # Validate schemas (Invariant 1)
            generator.validate_schemas()

            logger.info("CSV generation complete:")
            for table, count in results.items():
                logger.info(f"  {table}: {count} rows")

            return 0

        finally:
            db.close()

    except DatabaseError as e:
        logger.error(f"Database error: {e}")
        return 1
    except CSVGenerationError as e:
        logger.error(f"CSV generation error: {e}")
        return 1


def cmd_generate_aggregates(args: Namespace) -> int:
    """Execute the generate-aggregates command (Phase 3)."""
    logger.info("Generating JSON aggregates...")
    logger.info(f"Database: {args.database}")
    logger.info(f"Output: {args.output}")

    if not args.database.exists():
        logger.error(f"Database not found: {args.database}")
        return 1

    try:
        db = DatabaseManager(args.database)
        db.connect()

        try:
            generator = AggregateGenerator(
                db=db,
                output_dir=args.output,
                run_id=args.run_id,
            )
            manifest = generator.generate_all()

            logger.info("Aggregate generation complete:")
            logger.info(
                f"  Weekly rollups: {len(manifest.aggregate_index.weekly_rollups)}"
            )
            logger.info(
                f"  Distributions: {len(manifest.aggregate_index.distributions)}"
            )
            logger.info(f"  Manifest: {args.output / 'dataset-manifest.json'}")

            return 0

        finally:
            db.close()

    except DatabaseError as e:
        logger.error(f"Database error: {e}")
        return 1
    except AggregationError as e:
        logger.error(f"Aggregation error: {e}")
        return 1


def main() -> int:
    """Main entry point for the CLI."""
    parser = create_parser()
    args = parser.parse_args()

    # Setup logging early
    log_config = LoggingConfig(
        format=getattr(args, "log_format", "console"),
        artifacts_dir=getattr(args, "artifacts_dir", Path("run_artifacts")),
    )
    setup_logging(log_config)

    # Ensure artifacts directory exists
    artifacts_dir = getattr(args, "artifacts_dir", Path("run_artifacts"))
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    summary_path = artifacts_dir / "run_summary.json"

    try:
        if args.command == "extract":
            return cmd_extract(args)
        elif args.command == "generate-csv":
            return cmd_generate_csv(args)
        elif args.command == "generate-aggregates":
            return cmd_generate_aggregates(args)
        else:
            parser.print_help()
            return 1
    except KeyboardInterrupt:
        logger.info("Operation cancelled by user")

        # Write minimal failure summary if success summary doesn't exist
        if not summary_path.exists():
            minimal_summary = create_minimal_summary(
                "Operation cancelled by user", artifacts_dir
            )
            minimal_summary.write(summary_path)

        return 130
    except Exception as e:
        logger.exception(f"Unexpected error: {e}")

        # Write minimal failure summary if success summary doesn't exist
        if not summary_path.exists():
            minimal_summary = create_minimal_summary(str(e), artifacts_dir)
            minimal_summary.write(summary_path)

        return 1


if __name__ == "__main__":
    sys.exit(main())
