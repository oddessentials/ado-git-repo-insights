"""CLI entry point for ado-git-repo-insights."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from argparse import Namespace

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def create_parser() -> argparse.ArgumentParser:
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
    logger.info("Starting PR extraction...")
    logger.info(f"Organization: {args.organization}")
    logger.info(f"Database: {args.database}")

    if args.backfill_days:
        logger.info(f"Backfill mode: {args.backfill_days} days")

    # TODO: Implement extraction logic in Phase 3
    logger.warning("Extraction not yet implemented - Phase 3")
    return 0


def cmd_generate_csv(args: Namespace) -> int:
    """Execute the generate-csv command."""
    logger.info("Generating CSV files...")
    logger.info(f"Database: {args.database}")
    logger.info(f"Output: {args.output}")

    if not args.database.exists():
        logger.error(f"Database not found: {args.database}")
        return 1

    # TODO: Implement CSV generation in Phase 4
    logger.warning("CSV generation not yet implemented - Phase 4")
    return 0


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
