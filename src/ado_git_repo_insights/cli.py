"""CLI entry point for ado-git-repo-insights."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import TYPE_CHECKING

from .config import ConfigurationError, load_config
from .extractor.ado_client import ADOClient, ExtractionError
from .extractor.pr_extractor import PRExtractor
from .persistence.database import DatabaseError, DatabaseManager
from .transform.csv_generator import CSVGenerationError, CSVGenerator

if TYPE_CHECKING:
    from argparse import Namespace

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def create_parser() -> argparse.ArgumentParser:  # pragma: no cover
    """Create the argument parser for the CLI."""
    parser = argparse.ArgumentParser(
        prog="ado-insights",
        description="Extract Azure DevOps PR metrics and generate PowerBI-compatible CSVs.",
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

    return parser


def cmd_extract(args: Namespace) -> int:
    """Execute the extract command."""
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

            if not summary.success:
                logger.error("Extraction failed")
                return 1

            logger.info(f"Extraction complete: {summary.total_prs} PRs")
            return 0

        finally:
            db.close()

    except ConfigurationError as e:
        logger.error(f"Configuration error: {e}")
        return 1
    except DatabaseError as e:
        logger.error(f"Database error: {e}")
        return 1
    except ExtractionError as e:
        logger.error(f"Extraction error: {e}")
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


def main() -> int:
    """Main entry point for the CLI."""
    parser = create_parser()
    args = parser.parse_args()

    try:
        if args.command == "extract":
            return cmd_extract(args)
        elif args.command == "generate-csv":
            return cmd_generate_csv(args)
        else:
            parser.print_help()
            return 1
    except KeyboardInterrupt:
        logger.info("Operation cancelled by user")
        return 130
    except Exception as e:
        logger.exception(f"Unexpected error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
