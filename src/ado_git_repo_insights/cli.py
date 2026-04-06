"""CLI entry point for ado-git-repo-insights."""

from __future__ import annotations

import argparse
import importlib.util
import logging
import shutil
import sys
import time
from datetime import UTC, date, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from .utils.install_detection import detect_installation_method
from .utils.logging_config import LoggingConfig, setup_logging
from .utils.path_security import ensure_safe_filename, safe_join
from .utils.path_utils import format_path_guidance, get_scripts_directory, is_on_path
from .utils.shell_detection import detect_shell

if TYPE_CHECKING:
    from argparse import Namespace

    from .config import Config
    from .extractor.ado_client import ADOClient
    from .persistence.database import DatabaseManager
    from .types import AdoThread

logger = logging.getLogger(__name__)


def _get_runtime_version() -> str:
    """Resolve version via canonical resolver."""
    from .utils.version import resolve_version

    return resolve_version()


def create_parser() -> argparse.ArgumentParser:
    """Create the argument parser for the CLI."""
    parser = argparse.ArgumentParser(
        prog="ado-insights",
        description="Extract Azure DevOps PR metrics and generate PowerBI-compatible CSVs.",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {_get_runtime_version()}",
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
    # Phase 3.4: Comments extraction (§6)
    extract_parser.add_argument(
        "--include-comments",
        action="store_true",
        default=False,
        help="Extract PR threads and comments (feature-flagged)",
    )
    extract_parser.add_argument(
        "--comments-max-prs-per-run",
        type=int,
        default=100,
        help="Max PRs to fetch comments for per run (rate limit protection)",
    )
    extract_parser.add_argument(
        "--comments-max-threads-per-pr",
        type=int,
        default=50,
        help="Max threads to fetch per PR (optional limit)",
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
    # Phase 3.5: Stub generation (requires ALLOW_ML_STUBS=1 env var)
    agg_parser.add_argument(
        "--enable-ml-stubs",
        action="store_true",
        default=False,
        help="Generate stub predictions/insights (requires ALLOW_ML_STUBS=1 env var)",
    )
    agg_parser.add_argument(
        "--seed-base",
        type=str,
        default="",
        help="Base string for deterministic stub seeding",
    )
    # Phase 5: ML feature flags
    agg_parser.add_argument(
        "--enable-predictions",
        action="store_true",
        default=False,
        help="Enable Prophet-based trend forecasting (requires prophet package)",
    )
    agg_parser.add_argument(
        "--enable-insights",
        action="store_true",
        default=False,
        help="Enable OpenAI-based insights (requires openai package and OPENAI_API_KEY)",
    )
    agg_parser.add_argument(
        "--insights-max-tokens",
        type=int,
        default=1000,
        help="Maximum tokens for OpenAI insights response (default: 1000)",
    )
    agg_parser.add_argument(
        "--insights-cache-ttl-hours",
        type=int,
        default=24,
        help="Cache TTL for insights in hours (default: 24)",
    )
    agg_parser.add_argument(
        "--insights-dry-run",
        action="store_true",
        default=False,
        help="Generate prompt artifact without calling OpenAI API",
    )
    # Hidden flag for stub mode (testing only, not in help)
    agg_parser.add_argument(
        "--stub-mode",
        action="store_true",
        default=False,
        help=argparse.SUPPRESS,  # Hidden from help
    )

    # Build Aggregates command (Phase 6 - convenience alias)
    build_parser = subparsers.add_parser(
        "build-aggregates",
        help="Build aggregates from local SQLite DB (DEV/SECONDARY - use stage-artifacts for production)",
    )
    build_parser.add_argument(
        "--db",
        type=Path,
        required=True,
        help="Path to SQLite database file",
    )
    build_parser.add_argument(
        "--out",
        type=Path,
        default=Path("dataset"),
        help="Output directory for dataset files (default: ./dataset)",
    )
    build_parser.add_argument(
        "--run-id",
        type=str,
        default="local",
        help="Run ID for manifest metadata (default: local)",
    )
    # Phase 5 ML flags (same as generate-aggregates)
    build_parser.add_argument(
        "--enable-predictions",
        action="store_true",
        default=False,
        help="Enable Prophet-based trend forecasting",
    )
    build_parser.add_argument(
        "--enable-insights",
        action="store_true",
        default=False,
        help="Enable OpenAI-based insights",
    )
    build_parser.add_argument(
        "--insights-max-tokens",
        type=int,
        default=1000,
        help="Maximum tokens for OpenAI insights response (default: 1000)",
    )
    build_parser.add_argument(
        "--insights-cache-ttl-hours",
        type=int,
        default=24,
        help="Cache TTL for insights in hours (default: 24)",
    )
    build_parser.add_argument(
        "--insights-dry-run",
        action="store_true",
        default=False,
        help="Generate prompt artifact without calling OpenAI API",
    )
    build_parser.add_argument(
        "--stub-mode",
        action="store_true",
        default=False,
        help=argparse.SUPPRESS,  # Hidden from help
    )
    # Unified dashboard serve flags (Flight 260127A)
    build_parser.add_argument(
        "--serve",
        action="store_true",
        default=False,
        help="Start local dashboard server after building aggregates",
    )
    build_parser.add_argument(
        "--open",
        action="store_true",
        default=False,
        help="Open browser automatically (requires --serve)",
    )
    build_parser.add_argument(
        "--port",
        type=int,
        default=8080,
        help="Local server port (requires --serve, default: 8080)",
    )

    # Stage Artifacts command (download pipeline artifacts locally)
    stage_parser = subparsers.add_parser(
        "stage-artifacts",
        help="Download pipeline artifacts to local directory (RECOMMENDED for dashboard)",
    )
    stage_parser.add_argument(
        "--org",
        type=str,
        required=True,
        help="Azure DevOps organization name",
    )
    stage_parser.add_argument(
        "--project",
        type=str,
        required=True,
        help="Azure DevOps project name",
    )
    stage_parser.add_argument(
        "--pipeline-id",
        type=int,
        required=True,
        help="Pipeline definition ID. Selects most recent completed build "
        "(succeeded or partiallySucceeded) by finish time.",
    )

    stage_parser.add_argument(
        "--artifact",
        type=str,
        default="aggregates",
        help="Artifact name to download (default: aggregates)",
    )
    stage_parser.add_argument(
        "--pat",
        type=str,
        required=True,
        help="Personal Access Token with Build (Read) scope",
    )
    stage_parser.add_argument(
        "--out",
        type=Path,
        default=Path("./run_artifacts"),
        help="Output directory (default: ./run_artifacts)",
    )
    stage_parser.add_argument(
        "--run-id",
        type=int,
        help="Specific pipeline run ID (default: latest successful)",
    )
    # Unified dashboard serve flags (Flight 260127A)
    stage_parser.add_argument(
        "--serve",
        action="store_true",
        default=False,
        help="Start local dashboard server after staging artifacts",
    )
    stage_parser.add_argument(
        "--open",
        action="store_true",
        default=False,
        help="Open browser automatically (requires --serve)",
    )
    stage_parser.add_argument(
        "--port",
        type=int,
        default=8080,
        help="Local server port (requires --serve, default: 8080)",
    )

    # Dashboard command (Phase 6)
    dashboard_parser = subparsers.add_parser(
        "dashboard",
        help="Serve the PR Insights dashboard locally",
    )
    dashboard_parser.add_argument(
        "--dataset",
        type=Path,
        default=Path("./run_artifacts"),
        help="Path to dataset folder or run_artifacts dir (default: ./run_artifacts)",
    )
    dashboard_parser.add_argument(
        "--port",
        type=int,
        default=8080,
        help="Local server port (default: 8080)",
    )
    dashboard_parser.add_argument(
        "--open",
        action="store_true",
        default=False,
        help="Open browser automatically",
    )

    # Setup-path command (Flight 003 - CLI Distribution Hardening)
    setup_path_parser = subparsers.add_parser(
        "setup-path",
        help="Configure shell PATH for pip users (not needed for pipx/uv)",
    )
    setup_path_parser.add_argument(
        "--print-only",
        action="store_true",
        default=False,
        help="Output the PATH command without modifying any files",
    )
    setup_path_parser.add_argument(
        "--remove",
        action="store_true",
        default=False,
        help="Remove previously added PATH configuration",
    )

    # Doctor command (Flight 003 - CLI Distribution Hardening)
    subparsers.add_parser(
        "doctor",
        help="Diagnose installation issues and detect conflicts",
    )

    return parser


def _extract_comments(
    client: ADOClient,
    db: DatabaseManager,
    config: Config,
    max_prs: int,
    max_threads_per_pr: int,
) -> dict[str, int | bool]:
    """Extract PR threads and comments with rate limiting.

    §6: Incremental strategy - only fetch for PRs in backfill window.
    Rate limit protection via max_prs and max_threads_per_pr.

    Args:
        client: ADO API client.
        db: Database manager.
        config: Application config.
        max_prs: Maximum PRs to process per run.
        max_threads_per_pr: Maximum threads per PR (0 = unlimited).

    Returns:
        Stats dict with threads, comments, prs_processed, capped.
    """
    import json

    from .extractor.ado_client import ExtractionError
    from .persistence.repository import PRRepository

    repo = PRRepository(db)
    stats: dict[str, int | bool] = {
        "threads": 0,
        "comments": 0,
        "prs_processed": 0,
        "prs_comment_failures": 0,
        "capped": False,
    }

    # Get recently completed PRs to extract comments for
    # Limit by max_prs to avoid rate limiting
    cursor = db.execute(
        """
        SELECT pull_request_uid, pull_request_id, repository_id, project_name
        FROM pull_requests
        WHERE status = 'completed'
        ORDER BY closed_date DESC
        LIMIT ?
        """,
        (max_prs,),
    )
    prs_to_process = cursor.fetchall()

    if len(prs_to_process) >= max_prs:
        stats["capped"] = True

    for pr_row in prs_to_process:
        pr_uid = pr_row["pull_request_uid"]
        pr_id = pr_row["pull_request_id"]
        repo_id = pr_row["repository_id"]
        project_name = pr_row["project_name"]

        # §6: Incremental sync - check last_updated
        last_updated = repo.get_thread_last_updated(pr_uid)

        try:
            # Fetch threads from API
            threads = client.get_pr_threads(
                project=project_name,
                repository_id=repo_id,
                pull_request_id=pr_id,
            )

            # Apply max_threads_per_pr limit.  Keep a reference to the
            # full API response so we can check whether dropped threads
            # have unseen updates (needed for the coverage stamp decision).
            all_threads = threads
            pr_threads_truncated = (
                max_threads_per_pr > 0 and len(all_threads) > max_threads_per_pr
            )
            if pr_threads_truncated:
                threads = all_threads[:max_threads_per_pr]

            for thread in threads:
                thread_id = str(thread.get("id", ""))
                thread_updated = thread.get("lastUpdatedDate", "")
                thread_created = thread.get("publishedDate", thread_updated)
                thread_status = thread.get("status", "unknown")

                # §6: Skip unchanged threads (incremental sync)
                if last_updated and thread_updated <= last_updated:
                    continue

                # Serialize thread context
                thread_context = None
                if "threadContext" in thread:
                    thread_context = json.dumps(thread["threadContext"])

                # Upsert thread
                repo.upsert_thread(
                    thread_id=thread_id,
                    pull_request_uid=pr_uid,
                    status=thread_status,
                    thread_context=thread_context,
                    last_updated=thread_updated,
                    created_at=thread_created,
                    is_deleted=thread.get("isDeleted", False),
                )
                stats["threads"] = int(stats["threads"]) + 1

                # Process comments in thread
                for comment in thread.get("comments", []):
                    comment_id = str(comment.get("id", ""))
                    author = comment.get("author", {})
                    author_id = author.get("id", "unknown")

                    # Upsert author first to avoid FK violation (same as P2 fix)
                    repo.upsert_user(
                        user_id=author_id,
                        display_name=author.get("displayName", "Unknown"),
                        email=author.get("uniqueName"),
                    )

                    repo.upsert_comment(
                        comment_id=comment_id,
                        thread_id=thread_id,
                        pull_request_uid=pr_uid,
                        author_id=author_id,
                        content=comment.get("content"),
                        comment_type=comment.get("commentType", "text"),
                        created_at=comment.get("publishedDate", ""),
                        last_updated=comment.get("lastUpdatedDate"),
                        is_deleted=comment.get("isDeleted", False),
                    )
                    stats["comments"] = int(stats["comments"]) + 1

            stats["prs_processed"] = int(stats["prs_processed"]) + 1

            # Update per-PR coverage marker based on fetch completeness.
            #
            # Three cases:
            #   1. No truncation → stamp with current time (complete fetch).
            #   2. Truncated AND any dropped thread is missing locally or
            #      has a newer API version than stored → clear stamp.
            #   3. Truncated BUT every dropped thread exists locally with
            #      a last_updated ≥ the API lastUpdatedDate → no-op
            #      (local data still complete from prior runs).
            if not pr_threads_truncated:
                db.execute(
                    "UPDATE pull_requests SET comments_extracted_at = ? "
                    "WHERE pull_request_uid = ?",
                    (datetime.now(UTC).isoformat(), pr_uid),
                )
            elif _dropped_threads_all_stored(
                db, pr_uid, all_threads[max_threads_per_pr:]
            ):
                # Every dropped thread is already stored and current.
                # Prior stamp (if any) correctly reflects completeness.
                pass
            else:
                # At least one dropped thread is missing or stale locally.
                db.execute(
                    "UPDATE pull_requests SET comments_extracted_at = NULL "
                    "WHERE pull_request_uid = ?",
                    (pr_uid,),
                )

        except ExtractionError as e:
            from .utils.run_summary import normalize_error_message

            logger.warning(
                "Failed to extract comments for PR %s: %s",
                pr_uid,
                normalize_error_message(str(e)),
            )
            stats["prs_comment_failures"] = int(stats["prs_comment_failures"]) + 1
            # Continue with other PRs - don't fail entire run

    db.connection.commit()
    repo.update_comments_extraction_metadata(
        last_run_timestamp=datetime.now(UTC).isoformat(),
        prs_processed=int(stats["prs_processed"]),
        threads_fetched=int(stats["threads"]),
        comments_fetched=int(stats["comments"]),
        capped=bool(stats["capped"]),
    )
    db.connection.commit()
    return stats


def cmd_extract(args: Namespace) -> int:
    """Execute the extract command."""
    from .config import ConfigurationError, load_config
    from .extractor.ado_client import ADOClient, ExtractionError
    from .extractor.pr_extractor import PRExtractor
    from .persistence.database import DatabaseError, DatabaseManager
    from .utils.run_summary import (
        RunCounts,
        RunSummary,
        RunTimings,
        create_minimal_summary,
        get_git_sha,
        get_tool_version,
    )

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
                        if project_result.error is not None
                        else f"Extraction failed for project: {project_result.project}"
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
                run_summary.write(safe_join(args.artifacts_dir, "run_summary.json"))
                run_summary.print_final_line()
                run_summary.emit_ado_commands()
                return 1

            logger.info(f"Extraction complete: {summary.total_prs} PRs")

            # Phase 3.4: Extract comments if enabled (§6)
            comments_stats = {
                "threads": 0,
                "comments": 0,
                "prs_processed": 0,
                "capped": False,
            }
            if getattr(args, "include_comments", False):
                logger.info("Extracting PR comments (--include-comments enabled)")
                comments_stats = _extract_comments(
                    client=client,
                    db=db,
                    config=config,
                    max_prs=getattr(args, "comments_max_prs_per_run", 100),
                    max_threads_per_pr=getattr(args, "comments_max_threads_per_pr", 50),
                )
                logger.info(
                    f"Comments extraction: {comments_stats['threads']} threads, "
                    f"{comments_stats['comments']} comments from {comments_stats['prs_processed']} PRs"
                )
                if comments_stats["capped"]:
                    warnings_list.append(
                        f"Comments extraction capped at {args.comments_max_prs_per_run} PRs"
                    )

            # Recompute review timestamps whenever stored comment data exists,
            # regardless of whether --include-comments was passed this run.
            # This ensures convergence: creation_date changes, reviewer edits,
            # or comment deletions are reflected without re-fetching threads.
            # Recompute review timestamps from stored comment data.
            _backfill_review_timestamps_if_needed(db)

            # Informational warning when --include-comments is off.
            # Coverage metadata is NOT mutated here — ground-truth
            # coverage is determined at aggregation time by
            # _get_comments_coverage() in aggregators.py.
            include_comments = getattr(args, "include_comments", False)
            if not include_comments:
                comments_table_exists = (
                    db.execute(
                        "SELECT 1 FROM sqlite_master "
                        "WHERE type='table' AND name='pr_comments'"
                    ).fetchone()
                    is not None
                )
                has_any_comments = comments_table_exists and (
                    db.execute("SELECT 1 FROM pr_comments LIMIT 1").fetchone()
                    is not None
                )
                if has_any_comments:
                    logger.warning(
                        "Thread extraction not enabled for this run. "
                        "Newly extracted PRs will not have review time "
                        "data. Use --include-comments to include them."
                    )
                elif not comments_table_exists or not has_any_comments:
                    logger.warning(
                        "Review time metrics unavailable: no thread "
                        "data stored. Use --include-comments to "
                        "extract review timestamps."
                    )

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
            run_summary.write(safe_join(args.artifacts_dir, "run_summary.json"))
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
        minimal_summary.write(safe_join(args.artifacts_dir, "run_summary.json"))
        return 1
    except DatabaseError as e:
        logger.error(f"Database error: {e}")
        # P2 Fix: Write minimal summary for caught errors
        minimal_summary = create_minimal_summary(
            f"Database error: {e}", args.artifacts_dir
        )
        minimal_summary.write(safe_join(args.artifacts_dir, "run_summary.json"))
        return 1
    except ExtractionError as e:
        logger.error(f"Extraction error: {e}")
        # P2 Fix: Write minimal summary for caught errors
        minimal_summary = create_minimal_summary(
            f"Extraction error: {e}", args.artifacts_dir
        )
        minimal_summary.write(safe_join(args.artifacts_dir, "run_summary.json"))
        return 1


def cmd_generate_csv(args: Namespace) -> int:
    """Execute the generate-csv command."""
    from .persistence.database import DatabaseError, DatabaseManager
    from .transform.csv_generator import CSVGenerationError, CSVGenerator

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


def _backfill_review_timestamps_if_needed(db: DatabaseManager) -> None:
    """Run review-time recomputation if stored comment data exists.

    Safe to call from any command path (extract, generate-aggregates, build).
    Guards against legacy DBs without the pr_comments table.
    Idempotent: clear-then-repopulate ensures no double-counting.

    Every intermediate result is validated for concrete scalar types so that
    a ``MagicMock`` passed as *db* in tests fails closed (returns without
    side-effects) instead of flowing into ``populate_review_timestamps``.
    """
    from .extraction.review_time import populate_review_timestamps

    if not hasattr(db, "execute"):
        return

    # Guard 1: pr_comments table must exist.
    # A real fetchone() returns sqlite3.Row / tuple / None.
    # A MagicMock returns another MagicMock which passes truthiness checks.
    # We probe the row with ``[0]`` and require a concrete int back — this
    # rejects mocks whose __getitem__ returns yet another mock.
    table_row = db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pr_comments'"
    ).fetchone()
    if not _is_real_row(table_row):
        return

    # Guard 2: at least one comment row must exist.
    comment_row = db.execute("SELECT 1 FROM pr_comments LIMIT 1").fetchone()
    if not _is_real_row(comment_row):
        return

    count = populate_review_timestamps(db)
    if isinstance(count, int) and count > 0:
        logger.info(f"Review time computed for {count} PRs")


def _dropped_threads_all_stored(
    db: DatabaseManager,
    pr_uid: str,
    dropped_threads: list[AdoThread],
) -> bool:
    """Return True only if every dropped thread exists locally and is current.

    For each thread in *dropped_threads*, checks that a matching row
    exists in ``pr_threads`` with ``last_updated >= lastUpdatedDate``.
    Returns False if ANY thread is missing or stale — meaning truncation
    hid data that is not already stored.
    """
    if not dropped_threads:
        return True

    for thread in dropped_threads:
        tid = str(thread.get("id", ""))
        api_updated: str = thread.get("lastUpdatedDate", "") or ""
        if not tid:
            return False

        row = db.execute(
            "SELECT last_updated FROM pr_threads WHERE thread_id = ?",
            (tid,),
        ).fetchone()

        if row is None:
            # Thread not stored locally at all.
            return False

        local_updated: str = row["last_updated"] or ""
        if api_updated > local_updated:
            # API has a newer version than what we stored.
            return False

    return True


def _is_real_row(row: object) -> bool:
    """Return True only if *row* is a genuine database result row.

    Rejects ``None`` (no match) and ``MagicMock`` (test double).
    A real ``sqlite3.Row`` or tuple supports ``row[0]`` and yields a
    concrete scalar (``int``, ``str``, …) — never another mock.
    """
    if row is None:
        return False
    getter = getattr(row, "__getitem__", None)
    if getter is None:
        return False
    try:
        val: object = getter(0)
    except (TypeError, IndexError, KeyError):
        return False
    return isinstance(val, (int, float, str, bytes))


def cmd_generate_aggregates(args: Namespace) -> int:
    """Execute the generate-aggregates command (Phase 3 + Phase 5 ML)."""
    from .persistence.database import DatabaseError, DatabaseManager
    from .transform.aggregators import (
        AggregateGenerator,
        AggregationError,
        StubGenerationError,
    )

    logger.info("Generating JSON aggregates...")
    logger.info(f"Database: {args.database}")
    logger.info(f"Output: {args.output}")

    if not args.database.exists():
        logger.error(f"Database not found: {args.database}")
        return 1

    # Phase 5: Early validation for insights
    enable_insights = getattr(args, "enable_insights", False)
    insights_dry_run = getattr(args, "insights_dry_run", False)
    if enable_insights:
        # Check for OPENAI_API_KEY only if NOT in dry-run mode
        # Dry-run doesn't call API so shouldn't require a key
        import os

        if not insights_dry_run and not os.environ.get("OPENAI_API_KEY"):
            logger.error(
                "OPENAI_API_KEY is required for --enable-insights. "
                "Set the environment variable, or use --insights-dry-run for prompt iteration."
            )
            return 1

        # Check for openai package only when API will actually be called
        # Dry-run writes prompt.json without importing openai
        if not insights_dry_run:
            try:
                openai_available = (
                    "openai" in sys.modules
                    or importlib.util.find_spec("openai") is not None
                )
            except (ValueError, ModuleNotFoundError):
                openai_available = False
            if not openai_available:
                logger.error(
                    "OpenAI SDK not installed. Install ML extras: pip install -e '.[ml]'"
                )
                return 1

    try:
        db = DatabaseManager(args.database)
        db.connect()

        try:
            # Ensure review timestamps are populated before aggregation.
            # Handles upgrade path: DB has pr_comments from prior extraction
            # but review_time_minutes was never computed (e.g., user ran
            # generate-aggregates without a fresh extract after upgrading).
            _backfill_review_timestamps_if_needed(db)

            generator = AggregateGenerator(
                db=db,
                output_dir=args.output,
                run_id=args.run_id,
                enable_ml_stubs=getattr(args, "enable_ml_stubs", False),
                seed_base=getattr(args, "seed_base", ""),
                # Phase 5: ML parameters
                enable_predictions=getattr(args, "enable_predictions", False),
                enable_insights=enable_insights,
                insights_max_tokens=getattr(args, "insights_max_tokens", 1000),
                insights_cache_ttl_hours=getattr(args, "insights_cache_ttl_hours", 24),
                insights_dry_run=getattr(args, "insights_dry_run", False),
                stub_mode=getattr(args, "stub_mode", False),
            )
            manifest = generator.generate_all()

            logger.info("Aggregate generation complete:")
            logger.info(
                f"  Weekly rollups: {len(manifest.aggregate_index.weekly_rollups)}"
            )
            logger.info(
                f"  Distributions: {len(manifest.aggregate_index.distributions)}"
            )
            logger.info(f"  Predictions: {manifest.features.get('predictions', False)}")
            logger.info(f"  AI Insights: {manifest.features.get('ai_insights', False)}")
            logger.info(f"  Manifest: {args.output / 'dataset-manifest.json'}")

            if manifest.warnings:
                for warning in manifest.warnings:
                    logger.warning(f"  ⚠️ {warning}")

            return 0

        finally:
            db.close()

    except DatabaseError as e:
        logger.error(f"Database error: {e}")
        return 1
    except StubGenerationError as e:
        logger.error(f"Stub generation error: {e}")
        return 1
    except AggregationError as e:
        logger.error(f"Aggregation error: {e}")
        return 1


def _validate_serve_flags(args: Namespace) -> int | None:
    """Validate --serve related flags.

    FR-010: Shared validation logic for both cmd_build_aggregates and cmd_stage_artifacts.

    Args:
        args: Parsed command line arguments

    Returns:
        1 if validation fails (exit code), None if valid
    """
    # Fail fast on missing args: avoids masking config issues in tests/CI.
    missing = [name for name in ("serve", "open", "port") if not hasattr(args, name)]
    if missing:
        raise ValueError(f"Missing required argument(s): {', '.join(missing)}")

    serve = args.serve
    open_browser = args.open
    port = args.port

    if not serve and (open_browser or port != 8080):
        invalid_flags = []
        if open_browser:
            invalid_flags.append("--open")
        if port != 8080:
            invalid_flags.append("--port")
        logger.error(f"{', '.join(invalid_flags)} requires --serve")
        return 1

    return None


def cmd_build_aggregates(args: Namespace) -> int:
    """Execute the build-aggregates command (Phase 6 - alias for generate-aggregates)."""
    from .persistence.database import DatabaseError, DatabaseManager
    from .transform.aggregators import AggregateGenerator, AggregationError

    # FR-010: Use shared flag validation
    validation_result = _validate_serve_flags(args)
    if validation_result is not None:
        return validation_result

    # Extract serve-related flags for use after aggregate generation
    serve = getattr(args, "serve", False)
    open_browser = getattr(args, "open", False)
    port = getattr(args, "port", 8080)

    # DEV MODE WARNING: This command uses local database and is secondary to stage-artifacts
    logger.warning("")
    logger.warning("=" * 60)
    logger.warning("  DEV MODE: Generating aggregates from local database")
    logger.warning("  For production use, prefer 'ado-insights stage-artifacts'")
    logger.warning("  to download production-validated artifacts from pipelines.")
    logger.warning("=" * 60)
    logger.warning("")

    logger.info("Building aggregates locally...")
    logger.info(f"Database: {args.db}")
    logger.info(f"Output: {args.out}")

    if not args.db.exists():
        logger.error(f"Database not found: {args.db}")
        return 1

    # Phase 5: Early validation for insights (same as generate-aggregates)
    enable_insights = args.enable_insights
    insights_dry_run = args.insights_dry_run
    if enable_insights:
        import os

        if not insights_dry_run and not os.environ.get("OPENAI_API_KEY"):
            logger.error(
                "OPENAI_API_KEY is required for --enable-insights. "
                "Set the environment variable, or use --insights-dry-run for prompt iteration."
            )
            return 1

        if not insights_dry_run:
            try:
                openai_available = (
                    "openai" in sys.modules
                    or importlib.util.find_spec("openai") is not None
                )
            except (ValueError, ModuleNotFoundError):
                openai_available = False
            if not openai_available:
                logger.error(
                    "OpenAI SDK not installed. Install ML extras: pip install -e '.[ml]'"
                )
                return 1

    # Clean up stale aggregates from previous runs to prevent data mixing
    aggregates_dir = (args.out / "aggregates").resolve()
    output_dir = args.out.resolve()

    # Safety check: ensure aggregates_dir is within the output directory
    if aggregates_dir.exists():
        try:
            aggregates_dir.relative_to(output_dir)
        except ValueError:
            logger.error(
                f"Security: aggregates_dir {aggregates_dir} is not within {output_dir}"
            )
            return 1
        logger.info(f"Cleaning stale aggregates: {aggregates_dir}")
        shutil.rmtree(aggregates_dir)

    try:
        db = DatabaseManager(args.db)
        db.connect()

        try:
            _backfill_review_timestamps_if_needed(db)

            generator = AggregateGenerator(
                db=db,
                output_dir=args.out,
                run_id=args.run_id,
                enable_predictions=args.enable_predictions,
                enable_insights=enable_insights,
                insights_max_tokens=args.insights_max_tokens,
                insights_cache_ttl_hours=args.insights_cache_ttl_hours,
                insights_dry_run=args.insights_dry_run,
                stub_mode=args.stub_mode,
            )
            manifest = generator.generate_all()

            logger.info("Build complete:")
            logger.info(
                f"  Weekly rollups: {len(manifest.aggregate_index.weekly_rollups)}"
            )
            logger.info(
                f"  Distributions: {len(manifest.aggregate_index.distributions)}"
            )
            logger.info(f"  Output: {args.out / 'dataset-manifest.json'}")

            if manifest.warnings:
                for warning in manifest.warnings:
                    logger.warning(f"  {warning}")

            # If --serve is set, start the dashboard server (FR-001)
            if serve:
                return _serve_dashboard(
                    dataset_path=args.out.resolve(),
                    port=port,
                    open_browser=open_browser,
                )

            return 0

        finally:
            db.close()

    except DatabaseError as e:
        logger.error(f"Database error: {e}")
        return 1
    except AggregationError as e:
        logger.error(f"Aggregation error: {e}")
        return 1


def _normalize_artifact_layout(out_dir: Path) -> bool:
    """Normalize nested aggregates/aggregates layout to flat structure.

    Transforms:
        out_dir/aggregates/dataset-manifest.json
        out_dir/aggregates/aggregates/...

    Into:
        out_dir/dataset-manifest.json
        out_dir/aggregates/...

    Returns:
        True if normalization was performed, False if already flat.
    """
    nested_manifest = out_dir / "aggregates" / "dataset-manifest.json"
    double_nested = out_dir / "aggregates" / "aggregates"

    if nested_manifest.exists() and double_nested.exists():
        logger.info("Normalizing nested artifact layout...")

        try:
            # Move manifest to root
            root_manifest = out_dir / "dataset-manifest.json"
            if root_manifest.exists():
                root_manifest.unlink()
            shutil.move(str(nested_manifest), str(root_manifest))

            # Move double-nested content up one level
            aggregates_dir = out_dir / "aggregates"
            for item in list(double_nested.iterdir()):
                dest = aggregates_dir / item.name
                if dest.exists():
                    if dest.is_dir():
                        shutil.rmtree(dest)
                    else:
                        dest.unlink()
                shutil.move(str(item), str(dest))

            # Remove empty double-nested folder
            if double_nested.exists() and not any(double_nested.iterdir()):
                double_nested.rmdir()

            # Remove empty aggregates folder if manifest was the only thing
            old_aggregates = out_dir / "aggregates"
            if old_aggregates.exists():
                remaining = list(old_aggregates.iterdir())
                # If only dataset-manifest.json remains (shouldn't happen after move)
                if not remaining:
                    old_aggregates.rmdir()

            logger.info("Layout normalized: manifest at root, data in aggregates/")
            return True

        except (PermissionError, OSError) as e:
            logger.error(f"Failed to normalize layout: {e}")
            return False

    return False


def _validate_staged_artifacts(out_dir: Path) -> tuple[bool, str, int]:
    """Validate staged artifacts meet CONTRACT.md requirements.

    Contract version: 1
    Required structure:
        out_dir/dataset-manifest.json
        out_dir/aggregates/weekly_rollups/...
        out_dir/aggregates/distributions/...

    Returns:
        (is_valid, error_message, manifest_schema_version)

    Returns:
        (is_valid, error_message, manifest_schema_version)
    """
    import json

    # Contract constants
    supported_manifest_versions = {1}  # Explicitly supported versions

    manifest_path = out_dir / "dataset-manifest.json"

    # Check manifest exists at root
    if not manifest_path.exists():
        return False, f"dataset-manifest.json not found at {out_dir}", 0

    # Parse and validate
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON in manifest: {e}", 0

    # Check schema version is supported
    schema_version = manifest.get("manifest_schema_version", 0)
    if schema_version not in supported_manifest_versions:
        return (
            False,
            f"Unsupported manifest_schema_version: {schema_version}. "
            f"Supported: {supported_manifest_versions}",
            schema_version,
        )

    if "manifest_schema_version" not in manifest:
        return False, "Manifest missing required field: manifest_schema_version", 0

    if "aggregate_index" not in manifest:
        return False, "Manifest missing required field: aggregate_index", schema_version

    # Check all indexed paths exist and validate against path traversal
    missing: list[str] = []
    agg_index = manifest.get("aggregate_index", {})
    out_dir_resolved = out_dir.resolve()

    def validate_path(path_str: str) -> tuple[bool, str]:
        """Validate path is safe and within output directory."""
        if not path_str:
            return True, ""
        # Check for path traversal sequences
        if ".." in path_str or path_str.startswith("/") or path_str.startswith("\\"):
            return False, f"Path traversal detected: {path_str}"
        full_path = (out_dir / path_str).resolve()
        # Ensure path stays within output directory
        try:
            full_path.relative_to(out_dir_resolved)
        except ValueError:
            return False, f"Path escapes output directory: {path_str}"
        return True, ""

    for rollup in agg_index.get("weekly_rollups", []):
        path_str = rollup.get("path", "")
        valid, err = validate_path(path_str)
        if not valid:
            return False, err, schema_version
        if path_str:
            full_path = out_dir / path_str
            if not full_path.exists():
                missing.append(path_str)

    for dist in agg_index.get("distributions", []):
        path_str = dist.get("path", "")
        valid, err = validate_path(path_str)
        if not valid:
            return False, err, schema_version
        if path_str:
            full_path = out_dir / path_str
            if not full_path.exists():
                missing.append(path_str)

    if missing:
        return False, f"Missing indexed files: {missing[:5]}", schema_version

    # Check for deprecated double-nesting (hard fail)
    deprecated = out_dir / "aggregates" / "aggregates" / "dataset-manifest.json"
    if deprecated.exists():
        return (
            False,
            "DEPRECATED: Double-nested aggregates/aggregates layout detected",
            schema_version,
        )

    # Also check for ANY nested aggregates/aggregates structure (hard fail)
    nested_agg = out_dir / "aggregates" / "aggregates"
    if nested_agg.exists():
        return (
            False,
            "INVALID: Nested aggregates/aggregates folder exists. "
            "This violates the flat layout contract.",
            schema_version,
        )

    return True, "", schema_version


def cmd_stage_artifacts(args: Namespace) -> int:
    """Execute the stage-artifacts command - download pipeline artifacts locally.

    Selects the most recent completed build (succeeded or partiallySucceeded)
    by finishTime. Normalizes nested layouts and validates contract compliance.
    """
    import base64
    import json
    from datetime import datetime

    import requests

    from .utils.safe_extract import ZipSlipError, safe_extract_zip

    # FR-010: Use shared flag validation
    validation_result = _validate_serve_flags(args)
    if validation_result is not None:
        return validation_result

    # Extract serve-related flags for use after artifact staging
    serve = getattr(args, "serve", False)
    open_browser = getattr(args, "open", False)
    port = getattr(args, "port", 8080)

    logger.info("Staging pipeline artifacts...")
    logger.info(f"Organization: {args.org}")
    logger.info(f"Project: {args.project}")
    logger.info(f"Pipeline ID: {args.pipeline_id}")
    logger.info(f"Artifact: {args.artifact}")
    logger.info(f"Output: {args.out}")

    # Build auth headers (Invariant 19: PAT is never logged)
    pat_bytes = f":{args.pat}".encode()
    auth_b64 = base64.b64encode(pat_bytes).decode("ascii")
    headers = {"Authorization": f"Basic {auth_b64}"}

    base_url = f"https://dev.azure.com/{args.org}/{args.project}/_apis"

    try:
        # Step 1: Get the build (deterministic selection or specific run-id)
        if args.run_id:
            build_url = f"{base_url}/build/builds/{args.run_id}?api-version=7.1"
            resp = requests.get(build_url, headers=headers, timeout=30)
            resp.raise_for_status()
            build = resp.json()
            build_id = build["id"]
            build_result = build.get("result", "unknown")
            logger.info(
                f"Using specified build ID: {build_id} (result: {build_result})"
            )
        else:
            # Fetch recent completed builds with BOUNDED LOOKBACK
            # Contract: Maximum 10 builds to prevent performance drift
            # and accidental selection from stale pipelines
            lookback_limit = 10
            builds_url = (
                f"{base_url}/build/builds?"
                f"definitions={args.pipeline_id}&"
                f"statusFilter=completed&"
                f"$top={lookback_limit}&api-version=7.1"
            )
            resp = requests.get(builds_url, headers=headers, timeout=30)
            resp.raise_for_status()
            all_builds = resp.json().get("value", [])

            # Filter for eligible results: succeeded or partiallySucceeded
            eligible_results = ("succeeded", "partiallySucceeded")
            eligible = [b for b in all_builds if b.get("result") in eligible_results]

            if not eligible:
                logger.error(
                    f"No eligible builds found for pipeline {args.pipeline_id}. "
                    f"Builds must have result 'succeeded' or 'partiallySucceeded'."
                )
                return 1

            # Sort by finishTime descending (most recent first) - DETERMINISTIC
            eligible.sort(key=lambda b: b.get("finishTime", ""), reverse=True)

            build = eligible[0]
            build_id = build["id"]
            build_result = build.get("result", "unknown")
            build_finish = build.get("finishTime", "unknown")
            logger.info(
                f"Selected build ID: {build_id} "
                f"(result: {build_result}, finished: {build_finish})"
            )

        # Step 2: Get artifact download URL
        artifact_url = (
            f"{base_url}/build/builds/{build_id}/artifacts?"
            f"artifactName={args.artifact}&api-version=7.1"
        )
        resp = requests.get(artifact_url, headers=headers, timeout=30)
        resp.raise_for_status()
        artifact_info = resp.json()

        download_url = artifact_info.get("resource", {}).get("downloadUrl")
        if not download_url:
            logger.error(
                f"REQUIRED artifact '{args.artifact}' not found in build {build_id}. "
                f"Staging cannot proceed without the aggregates artifact."
            )
            return 1

        # Step 3: Download the artifact ZIP
        logger.info("Downloading artifact...")
        resp = requests.get(download_url, headers=headers, timeout=300, stream=True)
        resp.raise_for_status()

        # Prepare output directory
        out_dir = args.out.resolve()
        if out_dir.exists():
            shutil.rmtree(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)

        # Save and extract ZIP
        artifact_basename = ensure_safe_filename(args.artifact)
        zip_path = safe_join(out_dir, f"{artifact_basename}.zip")
        with zip_path.open("wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)

        logger.info("Extracting artifact...")
        try:
            safe_extract_zip(zip_path, out_dir)
        except ZipSlipError as e:
            logger.error(f"Security: Malicious ZIP detected - {e.reason}")
            logger.error(
                f"Artifact '{args.artifact}' from build {build_id} contains unsafe entry: "
                f"'{e.entry_name}'. This may indicate a compromised pipeline or supply chain attack. "
                "Report this incident to your security team."
            )
            # Clean up ZIP file on security failure
            try:
                zip_path.unlink(missing_ok=True)
            except OSError:
                pass
            return 1
        finally:
            # Always clean up ZIP, even on extraction failure
            try:
                zip_path.unlink(missing_ok=True)
            except OSError:
                pass  # Best effort cleanup

        # Step 4: Normalize layout (flatten nested aggregates/aggregates)
        was_normalized = _normalize_artifact_layout(out_dir)
        if was_normalized:
            logger.info("Nested layout detected and normalized to flat structure")

        # Step 5: Validate contract compliance (fail fast)
        is_valid, error_msg, schema_version = _validate_staged_artifacts(out_dir)
        if not is_valid:
            logger.error(f"Contract validation failed: {error_msg}")
            logger.error(
                "Staged artifacts do not meet CONTRACT.md requirements. "
                "Verify the pipeline publishes artifacts correctly."
            )
            return 1

        # Step 6: Write STAGED.json metadata
        staged_info = {
            "timestamp": datetime.now(UTC).isoformat(),
            "organization": args.org,
            "project": args.project,
            "pipeline_id": args.pipeline_id,
            "build_id": build_id,
            "build_result": build_result,
            "artifact_name": args.artifact,
            "layout_normalized": was_normalized,
            "manifest_schema_version": schema_version,
            "contract_version": 1,  # Current staging contract version
        }
        staged_path = safe_join(out_dir, "STAGED.json")
        with staged_path.open("w", encoding="utf-8") as f:
            json.dump(staged_info, f, indent=2)

        logger.info(f"Artifact staged to: {out_dir}")
        logger.info("Contract validation passed")

        # Emit structured JSON summary for automation parsing
        summary = {
            "status": "success",
            "build_id": build_id,
            "build_result": build_result,
            "manifest_schema_version": schema_version,
            "contract_version": 1,
            "layout_normalized": was_normalized,
            "artifact_root": str(out_dir),
        }
        print(f"STAGE_SUMMARY={json.dumps(summary)}")

        # If --serve is set, start the dashboard server
        if serve:
            logger.info("Starting dashboard server...")
            return _serve_dashboard(
                dataset_path=out_dir,
                port=port,
                open_browser=open_browser,
            )

        logger.info("Stage complete. Run 'ado-insights dashboard' to view.")
        return 0

    except requests.exceptions.HTTPError as e:
        logger.error(f"HTTP error: {e}")
        if e.response is not None and e.response.status_code == 401:
            logger.error(
                "Authentication failed - check your PAT has Build (Read) scope"
            )
        return 1
    except requests.exceptions.RequestException as e:
        logger.error(f"Request failed: {e}")
        return 1


def _sync_ui_bundle_if_needed(ui_source: Path) -> str | None:
    """FR-011: Sync UI bundle from extension/dist/ui in dev mode.

    Args:
        ui_source: Path to the UI bundle destination

    Returns:
        Error message if sync fails, None on success
    """
    from .utils.ui_sync import (
        SyncError,
        is_dev_mode,
        sync_needed,
        sync_ui_bundle,
        validate_dist,
    )

    dev_mode, repo_root = is_dev_mode()
    if dev_mode and repo_root:
        dist_ui = repo_root / "extension" / "dist" / "ui"

        # Validate dist exists and is complete
        try:
            validate_dist(dist_ui)
        except SyncError as e:
            return str(e)

        # Check if sync is needed (content-addressed)
        if sync_needed(dist_ui, ui_source):
            logger.info("UI bundle out of sync, syncing from extension/dist/ui...")
            try:
                manifest = sync_ui_bundle(dist_ui, ui_source)
                logger.info(f"UI bundle synced: {len(manifest)} files")
            except SyncError as e:
                return str(e)
        else:
            logger.debug("UI bundle is up to date")

    return None


def _prepare_serve_directory(
    ui_source: Path,
    dataset_path: Path,
    serve_dir: Path,
) -> None:
    """FR-011: Prepare serve directory with UI bundle and dataset.

    Args:
        ui_source: Path to the UI bundle source
        dataset_path: Path to the dataset
        serve_dir: Path to the temporary serve directory
    """
    import shutil

    # Copy UI files
    shutil.copytree(ui_source, serve_dir, dirs_exist_ok=True)

    # Copy dataset into serve directory
    dataset_dest = serve_dir / "dataset"
    shutil.copytree(dataset_path, dataset_dest, dirs_exist_ok=True)

    # Write local config to enable local mode
    local_config = serve_dir / "local-config.js"
    local_config.write_text(
        "// Auto-generated for local dashboard mode\n"
        "window.LOCAL_DASHBOARD_MODE = true;\n"
        'window.DATASET_PATH = "./dataset";\n'
    )

    # Inject local-config.js into index.html
    index_html = serve_dir / "index.html"
    if index_html.exists():
        content = index_html.read_text(encoding="utf-8")
        # Insert local-config.js before dashboard.js
        if "local-config.js" not in content:
            # Primary method: use the guarded placeholder (robust)
            placeholder = "<!-- LOCAL_CONFIG_PLACEHOLDER: Replaced by CLI for local dashboard mode -->"
            if placeholder in content:
                content = content.replace(
                    placeholder,
                    '<script src="local-config.js"></script>',
                )
            else:
                # Fallback: legacy injection for older UI bundles
                content = content.replace(
                    '<script src="dashboard.js"></script>',
                    '<script src="local-config.js"></script>\n    <script src="dashboard.js"></script>',
                )
            index_html.write_text(content, encoding="utf-8")


def _run_http_server(
    serve_dir: Path,
    port: int,
    open_browser: bool,
) -> int:
    """FR-011: Run HTTP server for the dashboard.

    Args:
        serve_dir: Path to the directory to serve
        port: HTTP server port
        open_browser: Whether to open browser automatically

    Returns:
        Exit code (0 for success)
    """
    import http.server
    import os
    import signal
    import socketserver
    import sys
    import threading
    import types
    import webbrowser

    # Change to serve directory
    original_dir = os.getcwd()
    os.chdir(serve_dir)

    try:
        # Create HTTP handler with CORS headers for local development
        class CORSHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
            def end_headers(self) -> None:
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
                self.send_header("Access-Control-Allow-Origin", "*")
                super().end_headers()

            def log_message(self, format: str, *log_args: object) -> None:
                # Suppress verbose HTTP logs, only show errors
                pass

        # Allow port reuse
        socketserver.TCPServer.allow_reuse_address = True

        with socketserver.TCPServer(("", port), CORSHTTPRequestHandler) as httpd:
            url = f"http://localhost:{port}"
            logger.info(f"Dashboard running at {url}")

            # Detect whether stdin is an interactive TTY — used below
            # to decide whether to offer the stdin shutdown fallback.
            try:
                _stdin_is_tty = hasattr(sys.stdin, "fileno") and os.isatty(
                    sys.stdin.fileno()
                )
            except (OSError, ValueError):
                _stdin_is_tty = False
            if _stdin_is_tty:
                logger.info("Press Ctrl+C or q+Enter to stop")
            else:
                logger.info("Press Ctrl+C to stop")

            if open_browser:
                webbrowser.open(url)

            # Install SIGINT handler to ensure shutdown even in environments
            # where KeyboardInterrupt delivery is unreliable (e.g. some
            # Windows terminals, IDE integrated terminals).
            # Installed after webbrowser.open() so Ctrl+C during a slow
            # browser launch still raises KeyboardInterrupt normally.
            # shutdown() must be called from a different thread than
            # serve_forever() to avoid deadlock.
            # signal.signal() is only legal from the main thread; skip
            # when called from a worker thread (e.g. test harness, IDE).
            # Also respect the caller's signal policy: if SIGINT is set to
            # SIG_IGN or SIG_DFL, the process has intentionally configured
            # that behavior and we must not override it.
            _prev_sigint = (
                signal.getsignal(signal.SIGINT)
                if threading.current_thread() is threading.main_thread()
                else None
            )
            # Only install when the existing handler is a callable Python
            # function.  SIG_IGN / SIG_DFL are ints — respect those as the
            # caller's explicit signal policy.
            if callable(_prev_sigint):
                _orig_handler = _prev_sigint

                def _request_shutdown(
                    signum: int, frame: types.FrameType | None
                ) -> None:
                    threading.Thread(target=httpd.shutdown, daemon=True).start()
                    # Chain to any custom handler so embedding code that
                    # registered its own SIGINT cleanup still runs.
                    # Skip default_int_handler (raises KeyboardInterrupt,
                    # which would abort serve_forever before it can exit
                    # cleanly).
                    if _orig_handler is not signal.default_int_handler:
                        _orig_handler(signum, frame)

                signal.signal(signal.SIGINT, _request_shutdown)

            # Windows: also hook console control events directly because
            # some terminals (Git Bash/MinTTY, some IDE terminals) do not
            # reliably produce a Python-level SIGINT / KeyboardInterrupt
            # when Ctrl+C is pressed.  This callback is purely additive:
            # it requests httpd.shutdown() then returns False so the event
            # propagates to the next handler in the chain (Python's own
            # console handler).  On terminals where Python SIGINT works,
            # both paths fire and the second shutdown() is a harmless
            # no-op.  On broken terminals, this callback is the fallback.
            # CTRL_CLOSE_EVENT is not handled — the OS default (terminate
            # process) is the correct behavior for console window close.
            _restore_console_handler: object = None
            if (
                sys.platform == "win32"
                and threading.current_thread() is threading.main_thread()
                and callable(_prev_sigint)
            ):
                try:
                    import ctypes

                    _windll = getattr(ctypes, "windll", None)
                    if _windll is None:
                        raise AttributeError("ctypes.windll")
                    _kernel32 = _windll.kernel32
                    _ctrl_c = 0
                    _ctrl_break = 1

                    _handler_type = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_uint)

                    def _on_console_ctrl(ctrl_type: int) -> bool:
                        if ctrl_type in (_ctrl_c, _ctrl_break):
                            threading.Thread(target=httpd.shutdown, daemon=True).start()
                        # Always return False so the event propagates to
                        # Python's built-in console handler.  Returning
                        # True would swallow the event and suppress
                        # SIGINT / KeyboardInterrupt on normal consoles.
                        return False

                    _console_ctrl_handler = _handler_type(_on_console_ctrl)

                    if _kernel32.SetConsoleCtrlHandler(_console_ctrl_handler, True):

                        def _unregister() -> None:
                            _kernel32.SetConsoleCtrlHandler(
                                _console_ctrl_handler, False
                            )

                        _restore_console_handler = _unregister
                    else:
                        logger.debug(
                            "Could not install Windows console control handler"
                        )
                except (ImportError, AttributeError, OSError):
                    # ctypes or windll unavailable — non-Windows or restricted env
                    pass

            # Stdin fallback: in terminals without real console support
            # (Git Bash/MinTTY, some IDE terminals), neither Python SIGINT
            # nor SetConsoleCtrlHandler reliably delivers Ctrl+C.  A stdin
            # polling thread lets users type 'q' + Enter to stop the
            # server.  Only enabled when stdin is an interactive TTY.
            _stdin_thread: threading.Thread | None = None
            if _stdin_is_tty:

                def _stdin_shutdown_poll() -> None:
                    try:
                        while True:
                            line = sys.stdin.readline()
                            if not line:
                                # EOF — stdin closed (IDE, pipe, pseudo-terminal).
                                # Exit silently; do NOT shut down the server.
                                break
                            if line.strip().lower() == "q":
                                threading.Thread(
                                    target=httpd.shutdown, daemon=True
                                ).start()
                                break
                    except (OSError, ValueError):
                        # stdin closed or not readable — give up silently
                        pass

                _stdin_thread = threading.Thread(
                    target=_stdin_shutdown_poll, daemon=True
                )
                _stdin_thread.start()

            try:
                httpd.serve_forever()
            finally:
                if callable(_prev_sigint):
                    signal.signal(signal.SIGINT, _prev_sigint)
                if callable(_restore_console_handler):
                    _restore_console_handler()

            logger.info("\nServer stopped")

    finally:
        os.chdir(original_dir)

    return 0


def _serve_dashboard(
    dataset_path: Path,
    port: int = 8080,
    open_browser: bool = False,
) -> int:
    """Serve the PR Insights dashboard from the given dataset path.

    FR-011: Refactored to use decomposed helper functions for improved
    maintainability and testability.

    Args:
        dataset_path: Path to directory containing dataset-manifest.json
        port: HTTP server port (default: 8080)
        open_browser: Whether to open browser automatically

    Returns:
        Exit code (0 for success, 1 for error)
    """
    import tempfile

    from .utils.dataset_discovery import validate_dataset_root

    # Validate the dataset root
    is_valid, error_msg = validate_dataset_root(dataset_path)
    if not is_valid:
        logger.error(f"Invalid dataset: {error_msg}")
        return 1

    # Locate UI bundle (packaged with the module)
    ui_source = Path(__file__).parent / "ui_bundle"

    # Dev mode: sync from extension/dist/ui if available and needed
    sync_error = _sync_ui_bundle_if_needed(ui_source)
    if sync_error:
        logger.error(sync_error)
        return 1

    if not ui_source.exists():
        logger.error(f"UI bundle not found at {ui_source}")
        return 1

    # Create temp directory for serving
    with tempfile.TemporaryDirectory() as tmpdir:
        serve_dir = Path(tmpdir)

        # Prepare serve directory with UI bundle and dataset
        _prepare_serve_directory(ui_source, dataset_path, serve_dir)

        # Run HTTP server
        return _run_http_server(serve_dir, port, open_browser)


def cmd_dashboard(args: Namespace) -> int:
    """Execute the dashboard command (Phase 6 - local HTTP server)."""
    from .utils.dataset_discovery import (
        check_deprecated_layout,
        find_dataset_roots,
    )

    # Resolve dataset path
    input_path = args.dataset.resolve()

    # CRITICAL: Check for deprecated nested layout first
    deprecated_error = check_deprecated_layout(input_path)
    if deprecated_error:
        logger.error(deprecated_error)
        return 1

    # Find dataset roots using only supported candidate paths
    dataset_roots = find_dataset_roots(input_path)

    if dataset_roots:
        dataset_path = dataset_roots[0]
        logger.info(f"Using dataset root: {dataset_path}")
    else:
        # Fall back to direct path if it contains manifest
        manifest_path = input_path / "dataset-manifest.json"
        if manifest_path.exists():
            dataset_path = input_path
            logger.info(f"Using direct dataset path: {dataset_path}")
        else:
            logger.error(f"dataset-manifest.json not found in {input_path}")
            logger.error("Searched paths:")
            for candidate in [".", "aggregates"]:
                logger.error(f"  - {input_path / candidate}")
            logger.error(
                "Run 'ado-insights stage-artifacts' or 'ado-insights build-aggregates' first."
            )
            return 1

    # Delegate to shared server function
    return _serve_dashboard(
        dataset_path=dataset_path,
        port=args.port,
        open_browser=getattr(args, "open", False),
    )


def _check_path_guidance(command: str | None) -> None:
    """Check if PATH guidance should be emitted (FR-005).

    Emits guidance to stderr if:
    - Installation method is pip (not pipx/uv)
    - Scripts directory is NOT on PATH
    - Command is NOT setup-path or doctor (avoid duplicate messaging)

    This is a non-blocking warning; command execution continues.
    """
    # Skip for commands that handle PATH themselves
    if command in ("setup-path", "doctor"):
        return

    # Don't warn inside activated virtualenvs (venv activation handles PATH)
    if sys.prefix != sys.base_prefix:
        return

    # Only emit for pip installs (pipx/uv handle PATH automatically)
    install_method = detect_installation_method()
    if install_method not in ("pip", "unknown"):
        return

    # Check if scripts directory is on PATH
    scripts_dir = get_scripts_directory()
    if is_on_path(scripts_dir):
        return

    # Emit guidance to stderr (non-blocking)
    shell = detect_shell()
    guidance = format_path_guidance(scripts_dir, shell)
    print(guidance, file=sys.stderr)
    print(file=sys.stderr)  # Blank line separator


def main() -> int:
    """Main entry point for the CLI."""
    parser = create_parser()
    args = parser.parse_args()

    # Parse-boundary validation: ZERO side effects before this passes (FR-009..FR-011)
    if args.command == "extract" and not getattr(args, "config", None):
        missing = []
        if not args.organization:
            missing.append("--organization")
        if not args.projects:
            missing.append("--projects")
        if missing:
            parser.error(
                f"{' and '.join(missing)} required when --config is not provided"
            )

    # Side effects begin ONLY after validation passes
    log_config = LoggingConfig(
        format=getattr(args, "log_format", "console"),
        artifacts_dir=getattr(args, "artifacts_dir", Path("run_artifacts")),
    )
    setup_logging(log_config)

    # FR-005 (T018): Emit PATH guidance for pip users if scripts not on PATH
    _check_path_guidance(args.command)

    # Ensure artifacts directory exists
    artifacts_dir = getattr(args, "artifacts_dir", Path("run_artifacts"))
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    summary_path = safe_join(artifacts_dir, "run_summary.json")

    try:
        if args.command == "extract":
            return cmd_extract(args)
        elif args.command == "generate-csv":
            return cmd_generate_csv(args)
        elif args.command == "generate-aggregates":
            return cmd_generate_aggregates(args)
        elif args.command == "build-aggregates":
            return cmd_build_aggregates(args)
        elif args.command == "stage-artifacts":
            return cmd_stage_artifacts(args)
        elif args.command == "dashboard":
            return cmd_dashboard(args)
        elif args.command == "setup-path":
            from .commands.setup_path import cmd_setup_path

            return cmd_setup_path(args)
        elif args.command == "doctor":
            from .commands.doctor import cmd_doctor

            return cmd_doctor(args)
        else:
            parser.print_help()
            return 1
    except KeyboardInterrupt:
        logger.info("Operation cancelled by user")

        # Write minimal failure summary if success summary doesn't exist
        if not summary_path.exists():
            from .utils.run_summary import create_minimal_summary

            minimal_summary = create_minimal_summary(
                "Operation cancelled by user", artifacts_dir
            )
            minimal_summary.write(summary_path)

        return 130
    except Exception as e:
        logger.exception(f"Unexpected error: {e}")

        # Write minimal failure summary if success summary doesn't exist
        if not summary_path.exists():
            from .utils.run_summary import create_minimal_summary

            minimal_summary = create_minimal_summary(str(e), artifacts_dir)
            minimal_summary.write(summary_path)

        return 1


if __name__ == "__main__":
    sys.exit(main())
