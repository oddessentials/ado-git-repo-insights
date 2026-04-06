"""Tests for _extract_comments coverage stamping and truncation behavior.

Covers the stamping logic that determines whether a PR's thread fetch
was complete (stamps comments_extracted_at), truncated-but-stored
(no-op), or truncated-with-hidden-data (clears stamp).

Uses a real SQLite database with a mocked ADO API client.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING
from unittest.mock import MagicMock

from ado_git_repo_insights.persistence.database import DatabaseManager

if TYPE_CHECKING:
    pass


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _create_db_with_pr(tmp_path: Path, pr_uid: str = "r1-1") -> DatabaseManager:
    """Create a v4 database with one completed PR and required FK entities."""
    db = DatabaseManager(tmp_path / "test.db")
    db.connect()
    db.execute("INSERT INTO organizations (organization_name) VALUES ('org')")
    db.execute(
        "INSERT INTO projects (organization_name, project_name) VALUES ('org', 'proj')"
    )
    db.execute(
        "INSERT INTO repositories "
        "(repository_id, repository_name, project_name, organization_name) "
        "VALUES ('r1', 'repo', 'proj', 'org')"
    )
    db.execute("INSERT INTO users (user_id, display_name) VALUES ('u1', 'Alice')")
    db.execute(
        "INSERT INTO pull_requests "
        "(pull_request_uid, pull_request_id, organization_name, project_name, "
        "repository_id, user_id, title, status, creation_date, closed_date) "
        "VALUES (?, 1, 'org', 'proj', 'r1', 'u1', 'PR', 'completed', "
        "'2026-01-15T10:00:00Z', '2026-01-16T10:00:00Z')",
        (pr_uid,),
    )
    db.connection.commit()
    return db


def _make_thread(
    tid: int,
    updated: str = "2026-01-16T00:00:00Z",
    created: str = "2026-01-15T00:00:00Z",
) -> dict[str, object]:
    """Build a minimal ADO thread dict."""
    return {
        "id": tid,
        "lastUpdatedDate": updated,
        "publishedDate": created,
        "status": "active",
        "isDeleted": False,
        "comments": [],
    }


def _mock_client(threads: list[dict[str, object]]) -> MagicMock:
    """Return a MagicMock ADO client whose get_pr_threads returns *threads*."""
    client = MagicMock()
    client.get_pr_threads.return_value = threads
    return client


def _mock_config() -> MagicMock:
    return MagicMock()


def _run_extract(
    db: DatabaseManager,
    threads: list[dict[str, object]],
    max_threads_per_pr: int = 0,
    max_prs: int = 100,
) -> dict[str, int | bool]:
    """Run _extract_comments with a mocked client and return stats."""
    from ado_git_repo_insights.cli import _extract_comments

    client = _mock_client(threads)
    config = _mock_config()
    stats = _extract_comments(client, db, config, max_prs, max_threads_per_pr)
    db.connection.commit()
    return stats


def _get_stamp(db: DatabaseManager, pr_uid: str = "r1-1") -> str | None:
    row = db.execute(
        "SELECT comments_extracted_at FROM pull_requests WHERE pull_request_uid = ?",
        (pr_uid,),
    ).fetchone()
    return row["comments_extracted_at"] if row else None


# ---------------------------------------------------------------------------
# P1: _extract_comments unit tests
# ---------------------------------------------------------------------------


class TestExtractCommentsStamping:
    """Direct tests for the coverage stamp logic inside _extract_comments."""

    def test_full_fetch_stamps_coverage(self, tmp_path: Path) -> None:
        """Untruncated fetch must set comments_extracted_at to a timestamp."""
        db = _create_db_with_pr(tmp_path)
        try:
            assert _get_stamp(db) is None  # Pre-condition

            threads = [_make_thread(1), _make_thread(2)]
            _run_extract(db, threads, max_threads_per_pr=0)  # unlimited

            stamp = _get_stamp(db)
            assert stamp is not None, "Full fetch must stamp comments_extracted_at"
        finally:
            db.close()

    def test_truncated_fetch_first_run_clears_stamp(self, tmp_path: Path) -> None:
        """Truncated fetch on first extraction (no stored threads) must not stamp."""
        db = _create_db_with_pr(tmp_path)
        try:
            threads = [_make_thread(1), _make_thread(2), _make_thread(3)]
            _run_extract(db, threads, max_threads_per_pr=2)

            stamp = _get_stamp(db)
            assert stamp is None, (
                "Truncated first-time fetch must not stamp — dropped thread "
                "3 has no local evidence"
            )
        finally:
            db.close()

    def test_truncated_fetch_preserves_stamp_when_dropped_stored(
        self, tmp_path: Path
    ) -> None:
        """Truncated fetch with all dropped threads already stored must preserve stamp."""
        db = _create_db_with_pr(tmp_path)
        try:
            # First full fetch to store all 3 threads and stamp.
            threads = [_make_thread(1), _make_thread(2), _make_thread(3)]
            _run_extract(db, threads, max_threads_per_pr=0)
            stamp_before = _get_stamp(db)
            assert stamp_before is not None

            # Second run with cap=2.  Thread 3 is dropped but already stored.
            _run_extract(db, threads, max_threads_per_pr=2)
            stamp_after = _get_stamp(db)
            assert stamp_after is not None, (
                "Dropped threads are all stored — stamp must survive"
            )
        finally:
            db.close()

    def test_truncated_fetch_clears_stamp_when_dropped_has_update(
        self, tmp_path: Path
    ) -> None:
        """Truncated fetch where a dropped thread has a newer API version must clear stamp."""
        db = _create_db_with_pr(tmp_path)
        try:
            # First full fetch.
            threads = [_make_thread(1), _make_thread(2), _make_thread(3)]
            _run_extract(db, threads, max_threads_per_pr=0)
            assert _get_stamp(db) is not None

            # Second run: thread 3 now has a newer lastUpdatedDate.
            threads_v2 = [
                _make_thread(1),
                _make_thread(2),
                _make_thread(3, updated="2026-02-01T00:00:00Z"),
            ]
            _run_extract(db, threads_v2, max_threads_per_pr=2)

            assert _get_stamp(db) is None, (
                "Dropped thread 3 has unseen update — stamp must be cleared"
            )
        finally:
            db.close()

    def test_pr_threads_truncated_flag_is_correct(self, tmp_path: Path) -> None:
        """Verify prs_processed counts correctly regardless of truncation."""
        db = _create_db_with_pr(tmp_path)
        try:
            threads = [_make_thread(1), _make_thread(2), _make_thread(3)]

            # Not truncated: cap=0
            stats = _run_extract(db, threads, max_threads_per_pr=0)
            assert stats["prs_processed"] == 1

            # Truncated: cap=2
            stats = _run_extract(db, threads, max_threads_per_pr=2)
            assert stats["prs_processed"] == 1
            # Only 2 threads should be stored/updated, not all 3
            assert int(stats["threads"]) <= 2
        finally:
            db.close()

    def test_zero_threads_stamps_coverage(self, tmp_path: Path) -> None:
        """PR with zero threads from API must stamp (complete, nothing to store)."""
        db = _create_db_with_pr(tmp_path)
        try:
            _run_extract(db, threads=[], max_threads_per_pr=0)

            stamp = _get_stamp(db)
            assert stamp is not None, (
                "Zero-thread PR is a complete fetch — must be stamped"
            )
        finally:
            db.close()


# ---------------------------------------------------------------------------
# P2: End-to-end pipeline test
# ---------------------------------------------------------------------------


class TestExtractBackfillAggregatePipeline:
    """End-to-end: mock extraction → review-time backfill → aggregate rollup.

    Verifies the main user path produces correct review_time in the
    emitted rollup JSON, exercising the full data flow:
    API threads → pr_comments → populate_review_timestamps →
    AggregateGenerator → weekly rollup with review_time_p50/p90.
    """

    def test_pipeline_produces_review_time_in_rollup(self, tmp_path: Path) -> None:
        import json

        db = _create_db_with_pr(tmp_path, pr_uid="r1-1")
        # Add a second PR so we meet the _ROLLUP_MIN_SAMPLE=2 threshold.
        db.execute(
            "INSERT INTO pull_requests "
            "(pull_request_uid, pull_request_id, organization_name, "
            "project_name, repository_id, user_id, title, status, "
            "creation_date, closed_date, cycle_time_minutes) "
            "VALUES ('r1-2', 2, 'org', 'proj', 'r1', 'u1', 'PR2', "
            "'completed', '2026-01-15T10:00:00Z', "
            "'2026-01-16T10:00:00Z', 1440.0)"
        )
        # Set cycle_time_minutes on first PR too.
        db.execute(
            "UPDATE pull_requests SET cycle_time_minutes = 1440.0 "
            "WHERE pull_request_uid = 'r1-1'"
        )
        # Add reviewers for both PRs.
        db.execute(
            "INSERT INTO reviewers (pull_request_uid, user_id, vote, repository_id) "
            "VALUES ('r1-1', 'u1', 10, 'r1')"
        )
        db.execute(
            "INSERT INTO reviewers (pull_request_uid, user_id, vote, repository_id) "
            "VALUES ('r1-2', 'u1', 10, 'r1')"
        )
        db.connection.commit()

        # Step 1: Extract — threads with vote events for both PRs.
        vote_thread_1: dict[str, object] = {
            "id": 1,
            "lastUpdatedDate": "2026-01-15T14:00:00Z",
            "publishedDate": "2026-01-15T14:00:00Z",
            "status": "active",
            "isDeleted": False,
            "comments": [
                {
                    "id": 1,
                    "content": "Alice voted 10",
                    "commentType": "system",
                    "publishedDate": "2026-01-15T14:00:00Z",
                    "isDeleted": False,
                    "author": {"id": "u1", "displayName": "Alice", "uniqueName": "a@e"},
                },
            ],
        }
        vote_thread_2: dict[str, object] = {
            "id": 1,
            "lastUpdatedDate": "2026-01-15T16:00:00Z",
            "publishedDate": "2026-01-15T16:00:00Z",
            "status": "active",
            "isDeleted": False,
            "comments": [
                {
                    "id": 2,
                    "content": "Alice voted 10",
                    "commentType": "system",
                    "publishedDate": "2026-01-15T16:00:00Z",
                    "isDeleted": False,
                    "author": {"id": "u1", "displayName": "Alice", "uniqueName": "a@e"},
                },
            ],
        }

        # Mock client returns different threads per PR.
        from ado_git_repo_insights.cli import _extract_comments

        client = MagicMock()
        client.get_pr_threads.side_effect = [
            [vote_thread_1],  # PR r1-1 (first call, most recent)
            [vote_thread_2],  # PR r1-2 (second call)
        ]
        config = _mock_config()
        _extract_comments(client, db, config, max_prs=100, max_threads_per_pr=0)
        db.connection.commit()

        # Step 2: Backfill review timestamps.
        from ado_git_repo_insights.extraction.review_time import (
            populate_review_timestamps,
        )

        count = populate_review_timestamps(db)
        assert count >= 1, "At least one PR should have review_time_minutes"

        # Step 3: Generate aggregates.
        from ado_git_repo_insights.transform.aggregators import AggregateGenerator

        output_dir = tmp_path / "output"
        gen = AggregateGenerator(db, output_dir)
        try:
            manifest = gen.generate_all()
        finally:
            db.close()

        # Step 4: Read the rollup and verify review_time fields.
        assert len(manifest.aggregate_index.weekly_rollups) >= 1
        rollup_path = output_dir / manifest.aggregate_index.weekly_rollups[0]["path"]
        with rollup_path.open() as f:
            rollup = json.load(f)

        assert rollup["review_time_p50"] is not None, (
            "Pipeline must produce non-null review_time_p50 in rollup"
        )
        assert rollup["review_time_p90"] is not None, (
            "Pipeline must produce non-null review_time_p90 in rollup"
        )
        # review_time must be less than cycle_time (pre-close approvals).
        assert rollup["review_time_p50"] <= rollup["cycle_time_p50"]


# ---------------------------------------------------------------------------
# P3: Legacy coverage fallback
# ---------------------------------------------------------------------------


class TestLegacyCoverageFallback:
    """Legacy DB without comments_extracted_at column uses heuristic fallback."""

    def test_fallback_partial_when_extraction_ran(self, tmp_path: Path) -> None:
        """If the comments_extracted_at column is missing but extraction
        metadata exists, the heuristic fallback reports 'partial'.
        """
        from ado_git_repo_insights.transform.aggregators import AggregateGenerator

        # Build a DB that has comment tables but NO comments_extracted_at
        # column (simulates a pre-v3 DB that skipped migration somehow).
        db = DatabaseManager(tmp_path / "legacy.db")
        db.connect()
        try:
            # Drop the column by rebuilding the table without it.
            db.execute(
                "CREATE TABLE _pr_tmp AS SELECT "
                "pull_request_uid, pull_request_id, organization_name, "
                "project_name, repository_id, user_id, title, status, "
                "description, creation_date, closed_date, cycle_time_minutes, "
                "review_time_minutes, raw_json "
                "FROM pull_requests"
            )
            db.execute("DROP TABLE pull_requests")
            db.execute("ALTER TABLE _pr_tmp RENAME TO pull_requests")

            # Seed data.
            db.execute("INSERT INTO organizations (organization_name) VALUES ('org')")
            db.execute(
                "INSERT INTO projects (organization_name, project_name) "
                "VALUES ('org', 'proj')"
            )
            db.execute(
                "INSERT INTO repositories "
                "(repository_id, repository_name, project_name, "
                "organization_name) VALUES ('r1', 'repo', 'proj', 'org')"
            )
            db.execute(
                "INSERT INTO users (user_id, display_name) VALUES ('u1', 'Alice')"
            )
            db.execute(
                "INSERT INTO pull_requests "
                "(pull_request_uid, pull_request_id, organization_name, "
                "project_name, repository_id, user_id, title, status, "
                "creation_date) "
                "VALUES ('r1-1', 1, 'org', 'proj', 'r1', 'u1', 'PR', "
                "'completed', '2026-01-15T10:00:00Z')"
            )
            db.execute(
                "INSERT INTO comments_extraction_metadata "
                "(id, last_run_timestamp, prs_processed, threads_fetched, "
                "comments_fetched, capped) "
                "VALUES (1, '2026-01-20T00:00:00Z', 1, 1, 0, 0)"
            )
            db.connection.commit()

            output = tmp_path / "output"
            gen = AggregateGenerator(db, output)
            coverage = gen._get_comments_coverage()

            # Fallback path: covered_count = -1, extraction_ran = True
            # → status = "partial"
            assert coverage["status"] == "partial"
        finally:
            db.close()


# ---------------------------------------------------------------------------
# P3d: prs_comment_failures counter + coverage invariant
# ---------------------------------------------------------------------------


class TestPrsCommentFailuresCounter:
    """Failed PR extractions must increment counter and not stamp coverage."""

    def test_api_failure_increments_counter(self, tmp_path: Path) -> None:
        """ExtractionError on get_pr_threads increments counter, other PRs work."""
        from ado_git_repo_insights.cli import _extract_comments
        from ado_git_repo_insights.extractor.ado_client import ExtractionError

        db = _create_db_with_pr(tmp_path, pr_uid="r1-1")
        # Add a second PR.
        db.execute(
            "INSERT INTO pull_requests "
            "(pull_request_uid, pull_request_id, organization_name, project_name, "
            "repository_id, user_id, title, status, creation_date, closed_date) "
            "VALUES ('r1-2', 2, 'org', 'proj', 'r1', 'u1', 'PR2', 'completed', "
            "'2026-01-17T10:00:00Z', '2026-01-18T10:00:00Z')"
        )
        db.connection.commit()

        client = MagicMock()
        call_count = 0

        def _side_effect(*args: object, **kwargs: object) -> list[dict[str, object]]:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise ExtractionError("API timeout")
            return [_make_thread(1)]

        client.get_pr_threads.side_effect = _side_effect
        try:
            stats = _extract_comments(client, db, _mock_config(), 100, 0)
            db.connection.commit()
            assert int(stats["prs_comment_failures"]) == 1
            # prs_processed only counts successful extractions.
            assert int(stats["prs_processed"]) == 1
        finally:
            db.close()

    def test_multiple_failures_accumulate(self, tmp_path: Path) -> None:
        """Two failing PRs → counter == 2."""
        from ado_git_repo_insights.cli import _extract_comments
        from ado_git_repo_insights.extractor.ado_client import ExtractionError

        db = _create_db_with_pr(tmp_path, pr_uid="r1-1")
        db.execute(
            "INSERT INTO pull_requests "
            "(pull_request_uid, pull_request_id, organization_name, project_name, "
            "repository_id, user_id, title, status, creation_date, closed_date) "
            "VALUES ('r1-2', 2, 'org', 'proj', 'r1', 'u1', 'PR2', 'completed', "
            "'2026-01-17T10:00:00Z', '2026-01-18T10:00:00Z')"
        )
        db.connection.commit()

        client = MagicMock()
        client.get_pr_threads.side_effect = ExtractionError("fail")
        try:
            stats = _extract_comments(client, db, _mock_config(), 100, 0)
            db.connection.commit()
            assert int(stats["prs_comment_failures"]) == 2
        finally:
            db.close()

    def test_failed_pr_not_stamped(self, tmp_path: Path) -> None:
        """Failing PR does NOT get comments_extracted_at set."""
        from ado_git_repo_insights.cli import _extract_comments
        from ado_git_repo_insights.extractor.ado_client import ExtractionError

        db = _create_db_with_pr(tmp_path, pr_uid="r1-1")
        db.connection.commit()

        client = MagicMock()
        client.get_pr_threads.side_effect = ExtractionError("fail")
        try:
            _extract_comments(client, db, _mock_config(), 100, 0)
            db.connection.commit()
            assert _get_stamp(db, "r1-1") is None, (
                "Failed PR must NOT get comments_extracted_at stamped"
            )
        finally:
            db.close()

    def test_previously_covered_pr_retains_stamp_on_failure(
        self, tmp_path: Path
    ) -> None:
        """A prior-success stamp survives a later ExtractionError.

        Semantics decision: a failed refresh does not invalidate data from
        a prior successful extraction.  Clearing the stamp on transient
        errors (timeouts, rate-limits) would cause coverage to flap between
        "full" and "partial", which is noisier than reporting the still-valid
        prior state.  Aggregation gates review_time_minutes on
        comments_extracted_at IS NOT NULL, so stale-but-stamped PRs remain
        consistent with the dashboard contract.
        """
        from ado_git_repo_insights.cli import _extract_comments
        from ado_git_repo_insights.extractor.ado_client import ExtractionError

        db = _create_db_with_pr(tmp_path, pr_uid="r1-1")
        # Simulate a prior successful extraction.
        prior_stamp = "2026-01-20T00:00:00Z"
        db.execute(
            "UPDATE pull_requests SET comments_extracted_at = ? "
            "WHERE pull_request_uid = ?",
            (prior_stamp, "r1-1"),
        )
        db.connection.commit()

        client = MagicMock()
        client.get_pr_threads.side_effect = ExtractionError("API timeout")
        try:
            _extract_comments(client, db, _mock_config(), 100, 0)
            db.connection.commit()
            assert _get_stamp(db, "r1-1") == prior_stamp, (
                "Prior-success stamp must survive a later ExtractionError"
            )
        finally:
            db.close()


# ---------------------------------------------------------------------------
# P3e: _get_comments_coverage exception fallback tests
# ---------------------------------------------------------------------------


class TestCoverageFallbackExceptionPaths:
    """Tests for the except Exception blocks in _get_comments_coverage.

    In v4+ databases these paths should be unreachable in practice
    (all tables/columns exist by schema guarantee), but they guard
    against manual DB corruption or partial schema states.
    """

    def test_no_comments_tables_returns_disabled(self, tmp_path: Path) -> None:
        """DB without pr_threads/pr_comments → line 1469 except → disabled."""
        from ado_git_repo_insights.transform.aggregators import AggregateGenerator

        db = DatabaseManager(tmp_path / "no_comments.db")
        db.connect()
        try:
            # Drop the comment-related tables.
            db.execute("DROP TABLE IF EXISTS pr_comments")
            db.execute("DROP TABLE IF EXISTS pr_threads")
            db.execute("DROP TABLE IF EXISTS comments_extraction_metadata")
            db.connection.commit()

            gen = AggregateGenerator(db, tmp_path / "out")
            coverage = gen._get_comments_coverage()
            assert coverage["status"] == "disabled"
            assert coverage["threads_fetched"] == 0
            assert coverage["comments_fetched"] == 0
        finally:
            db.close()

    def test_no_pull_requests_returns_partial_when_data_exists(
        self, tmp_path: Path
    ) -> None:
        """Comment tables have data but pull_requests absent → partial."""
        from ado_git_repo_insights.transform.aggregators import AggregateGenerator

        db = DatabaseManager(tmp_path / "no_prs.db")
        db.connect()
        try:
            # Disable FK enforcement to insert thread without parent PR.
            db.execute("PRAGMA foreign_keys = OFF")
            db.execute(
                "INSERT INTO pr_threads "
                "(thread_id, pull_request_uid, status, last_updated, created_at) "
                "VALUES ('1', 'r1-1', 'active', '2026-01-16T00:00:00Z', "
                "'2026-01-16T00:00:00Z')"
            )
            db.execute(
                "INSERT INTO comments_extraction_metadata "
                "(id, last_run_timestamp, prs_processed, threads_fetched, "
                "comments_fetched, capped) "
                "VALUES (1, '2026-01-20T00:00:00Z', 1, 1, 0, 0)"
            )
            # Drop pull_requests to trigger line 1494 except.
            db.execute("DROP TABLE pull_requests")
            db.connection.commit()

            gen = AggregateGenerator(db, tmp_path / "out")
            coverage = gen._get_comments_coverage()
            # has_content=True → "partial" (not "disabled")
            assert coverage["status"] == "partial"
        finally:
            db.close()


# ---------------------------------------------------------------------------
# P3f: Corrupted metadata tests
# ---------------------------------------------------------------------------


class TestCorruptedMetadata:
    """Corrupted comments_extraction_metadata should not crash coverage."""

    def test_corrupted_metadata_with_thread_data_returns_partial(
        self, tmp_path: Path
    ) -> None:
        """Wrong metadata schema + existing thread data → partial."""
        from ado_git_repo_insights.transform.aggregators import AggregateGenerator

        db = DatabaseManager(tmp_path / "corrupt_meta.db")
        db.connect()
        try:
            # Disable FK enforcement to insert thread without parent PR.
            db.execute("PRAGMA foreign_keys = OFF")
            db.execute(
                "INSERT INTO pr_threads "
                "(thread_id, pull_request_uid, status, last_updated, created_at) "
                "VALUES ('1', 'r1-1', 'active', '2026-01-16T00:00:00Z', "
                "'2026-01-16T00:00:00Z')"
            )
            # Replace metadata table with wrong schema.
            db.execute("DROP TABLE comments_extraction_metadata")
            db.execute(
                "CREATE TABLE comments_extraction_metadata "
                "(id INTEGER PRIMARY KEY, junk TEXT)"
            )
            db.execute("INSERT INTO comments_extraction_metadata VALUES (1, 'bad')")
            db.connection.commit()

            gen = AggregateGenerator(db, tmp_path / "out")
            coverage = gen._get_comments_coverage()
            # Thread data exists → "partial", not "disabled"
            assert coverage["status"] == "partial"
        finally:
            db.close()

    def test_corrupted_metadata_no_data_returns_disabled(self, tmp_path: Path) -> None:
        """Wrong metadata schema + no thread/comment data → disabled."""
        from ado_git_repo_insights.transform.aggregators import AggregateGenerator

        db = DatabaseManager(tmp_path / "corrupt_empty.db")
        db.connect()
        try:
            db.execute("DROP TABLE comments_extraction_metadata")
            db.execute(
                "CREATE TABLE comments_extraction_metadata "
                "(id INTEGER PRIMARY KEY, junk TEXT)"
            )
            db.execute("INSERT INTO comments_extraction_metadata VALUES (1, 'bad')")
            db.connection.commit()

            gen = AggregateGenerator(db, tmp_path / "out")
            coverage = gen._get_comments_coverage()
            assert coverage["status"] == "disabled"
        finally:
            db.close()
