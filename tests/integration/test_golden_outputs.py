"""Integration tests for golden outputs.

Victory Gate 1.3: SQLite → CSV Determinism
- CSV schemas match exactly
- Output hashes are stable across runs
- Golden fixture produces expected outputs
"""

from __future__ import annotations

import hashlib
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

from ado_git_repo_insights.persistence.database import DatabaseManager
from ado_git_repo_insights.persistence.models import CSV_SCHEMAS
from ado_git_repo_insights.persistence.repository import PRRepository
from ado_git_repo_insights.transform.aggregators import AggregateGenerator
from ado_git_repo_insights.transform.csv_generator import CSVGenerator


def hash_file(path: Path) -> str:
    """Calculate SHA-256 hash of a file."""
    sha256 = hashlib.sha256()
    with path.open("rb") as f:
        sha256.update(f.read())
    return sha256.hexdigest()


def create_golden_database(db: DatabaseManager) -> None:
    """Populate a database with a known, reproducible set of data.

    This creates the "golden" fixture that all determinism tests compare against.
    """
    repo = PRRepository(db)

    # Organizations
    for org in ["Acme Corp", "Beta Inc"]:
        repo.upsert_organization(org)

    # Projects
    repo.upsert_project("Acme Corp", "Frontend")
    repo.upsert_project("Acme Corp", "Backend")
    repo.upsert_project("Beta Inc", "Mobile")

    # Repositories
    repo.upsert_repository("repo-001", "web-app", "Frontend", "Acme Corp")
    repo.upsert_repository("repo-002", "api-server", "Backend", "Acme Corp")
    repo.upsert_repository("repo-003", "ios-app", "Mobile", "Beta Inc")

    # Users
    repo.upsert_user("user-alice", "Alice Smith", "alice@acme.com")
    repo.upsert_user("user-bob", "Bob Jones", "bob@acme.com")
    repo.upsert_user("user-carol", "Carol White", "carol@beta.com")

    # Pull Requests (in random order to test sorting)
    repo.upsert_pull_request(
        pull_request_uid="repo-002-50",
        pull_request_id=50,
        organization_name="Acme Corp",
        project_name="Backend",
        repository_id="repo-002",
        user_id="user-bob",
        title="Add API endpoint",
        status="completed",
        description="New endpoint for users",
        creation_date="2024-02-15T09:00:00Z",
        closed_date="2024-02-15T14:30:00Z",
        cycle_time_minutes=330.0,
    )

    repo.upsert_pull_request(
        pull_request_uid="repo-001-100",
        pull_request_id=100,
        organization_name="Acme Corp",
        project_name="Frontend",
        repository_id="repo-001",
        user_id="user-alice",
        title="Fix login bug",
        status="completed",
        description="Fixed the login issue",
        creation_date="2024-01-10T10:00:00Z",
        closed_date="2024-01-10T12:00:00Z",
        cycle_time_minutes=120.0,
    )

    repo.upsert_pull_request(
        pull_request_uid="repo-003-25",
        pull_request_id=25,
        organization_name="Beta Inc",
        project_name="Mobile",
        repository_id="repo-003",
        user_id="user-carol",
        title="Update splash screen",
        status="completed",
        description=None,
        creation_date="2024-03-01T08:00:00Z",
        closed_date="2024-03-01T16:00:00Z",
        cycle_time_minutes=480.0,
    )

    # Reviewers
    repo.upsert_reviewer("repo-001-100", "user-bob", 10, "repo-001")
    repo.upsert_reviewer("repo-002-50", "user-alice", 10, "repo-002")
    repo.upsert_reviewer("repo-002-50", "user-carol", 5, "repo-002")
    repo.upsert_reviewer("repo-003-25", "user-alice", 10, "repo-003")


@pytest.fixture
def golden_db() -> Iterator[tuple[DatabaseManager, Path, Path]]:
    """Create a golden database and output directories."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        db_path = tmp_path / "golden.sqlite"
        output_dir = tmp_path / "csv_output"

        manager = DatabaseManager(db_path)
        manager.connect()
        create_golden_database(manager)

        yield manager, output_dir, tmp_path

        manager.close()


class TestGoldenOutputs:
    """Integration test for golden fixture → CSV determinism (Victory Gate 1.3)."""

    def test_all_csvs_generated_from_golden(
        self, golden_db: tuple[DatabaseManager, Path, Path]
    ) -> None:
        """Golden database produces all expected CSV files."""
        db, output_dir, _ = golden_db
        generator = CSVGenerator(db, output_dir)
        results = generator.generate_all()

        # All tables should have data
        assert results["organizations"] == 2
        assert results["projects"] == 3
        assert results["repositories"] == 3
        assert results["users"] == 3
        assert results["pull_requests"] == 3
        assert results["reviewers"] == 4

    def test_golden_schema_validation(
        self, golden_db: tuple[DatabaseManager, Path, Path]
    ) -> None:
        """Golden CSVs pass schema validation."""
        db, output_dir, _ = golden_db
        generator = CSVGenerator(db, output_dir)
        generator.generate_all()

        assert generator.validate_schemas()

    def test_golden_output_deterministic(
        self, golden_db: tuple[DatabaseManager, Path, Path]
    ) -> None:
        """Multiple runs produce identical CSVs from golden database."""
        db, _, tmp_path = golden_db

        output1 = tmp_path / "run1"
        output2 = tmp_path / "run2"

        # Generate twice
        gen1 = CSVGenerator(db, output1)
        gen1.generate_all()

        gen2 = CSVGenerator(db, output2)
        gen2.generate_all()

        # Compare all files byte-for-byte
        for table_name in CSV_SCHEMAS:
            hash1 = hash_file(output1 / f"{table_name}.csv")
            hash2 = hash_file(output2 / f"{table_name}.csv")
            assert hash1 == hash2, f"{table_name}.csv differs between runs"

    def test_golden_weekly_rollups_deterministic_with_pr_records(
        self, golden_db: tuple[DatabaseManager, Path, Path]
    ) -> None:
        """Feature 060: weekly rollup JSON is byte-identical across runs and
        includes the PR-level detail fields (`prs`, `_prs_truncated`,
        `_prs_cap`). Producer-side determinism guard for FR-012 / SC-005.
        """
        db, _, tmp_path = golden_db

        output1 = tmp_path / "rollup_run1"
        output2 = tmp_path / "rollup_run2"

        AggregateGenerator(db, output1, run_id="golden-det-1").generate_all()
        AggregateGenerator(db, output2, run_id="golden-det-1").generate_all()

        rollup_dir1 = output1 / "aggregates" / "weekly_rollups"
        rollup_dir2 = output2 / "aggregates" / "weekly_rollups"
        rollup_files1 = sorted(rollup_dir1.glob("*.json"))
        rollup_files2 = sorted(rollup_dir2.glob("*.json"))

        assert rollup_files1, "no rollup files produced"
        assert [p.name for p in rollup_files1] == [p.name for p in rollup_files2]

        saw_pr_detail = False
        for f1, f2 in zip(rollup_files1, rollup_files2, strict=True):
            h1 = hash_file(f1)
            h2 = hash_file(f2)
            assert h1 == h2, f"{f1.name} differs between rollup runs"

            import json as _json

            payload = _json.loads(f1.read_text(encoding="utf-8"))
            if "prs" in payload:
                saw_pr_detail = True
                assert isinstance(payload["prs"], list)
                assert payload["_prs_cap"] == 500
                assert isinstance(payload["_prs_truncated"], bool)

        assert saw_pr_detail, (
            "Golden fixture must produce at least one rollup with PR-level "
            "detail — otherwise the determinism guard has no coverage of the "
            "feature 060 fields."
        )

    def test_cycle_time_tied_prs_sort_stably_across_runs(
        self, golden_db: tuple[DatabaseManager, Path, Path]
    ) -> None:
        """Feature 060 FR-025 / SC-014: tie-break determinism under cycle-time
        ties. When two PRs in the same week share cycle_time_minutes, the
        secondary sort key ``pull_request_id asc`` MUST produce byte-identical
        rollup output across repeated aggregator runs against the same DB.

        Uses the golden fixture plus two additional same-week PRs with
        identical cycle_time so the tie-break path is exercised in practice,
        not just in unit tests.
        """
        import json

        db, _, tmp_path = golden_db
        repo = PRRepository(db)

        # Two PRs in ISO week 2024-W03 with IDENTICAL cycle_time_minutes
        # but different pull_request_id — forces the id-asc tiebreak.
        repo.upsert_pull_request(
            pull_request_uid="repo-001-500",
            pull_request_id=500,
            organization_name="Acme Corp",
            project_name="Frontend",
            repository_id="repo-001",
            user_id="user-alice",
            title="Tie-break PR B",
            status="completed",
            description=None,
            creation_date="2024-01-15T10:00:00Z",
            closed_date="2024-01-15T14:00:00Z",
            cycle_time_minutes=240.0,
        )
        repo.upsert_pull_request(
            pull_request_uid="repo-001-400",
            pull_request_id=400,
            organization_name="Acme Corp",
            project_name="Frontend",
            repository_id="repo-001",
            user_id="user-alice",
            title="Tie-break PR A",
            status="completed",
            description=None,
            creation_date="2024-01-15T09:00:00Z",
            closed_date="2024-01-15T13:00:00Z",
            cycle_time_minutes=240.0,
        )

        output1 = tmp_path / "tied_run1"
        output2 = tmp_path / "tied_run2"
        AggregateGenerator(db, output1, run_id="tied-det-1").generate_all()
        AggregateGenerator(db, output2, run_id="tied-det-1").generate_all()

        rollup_files1 = sorted(
            (output1 / "aggregates" / "weekly_rollups").glob("*.json"),
        )
        rollup_files2 = sorted(
            (output2 / "aggregates" / "weekly_rollups").glob("*.json"),
        )
        assert [p.name for p in rollup_files1] == [p.name for p in rollup_files2]

        saw_tied_week = False
        for f1, f2 in zip(rollup_files1, rollup_files2, strict=True):
            assert hash_file(f1) == hash_file(f2), (
                f"Tie-break determinism violation: {f1.name} differs "
                "between runs. Sort comparator must be stable under ties."
            )
            payload = json.loads(f1.read_text(encoding="utf-8"))
            prs = payload.get("prs")
            if not isinstance(prs, list):
                continue
            # Under the fixture the two tied PRs (id 400, 500) share week
            # 2024-W03; their order inside `prs` MUST be id-asc (400 then 500).
            tied_ids = [
                row["id"]
                for row in prs
                if isinstance(row, dict)
                and row.get("cycle_time") == 240.0
                and row.get("id") in {400, 500}
            ]
            if tied_ids:
                assert tied_ids == [400, 500], (
                    "Tie-break order violation: expected id-asc (400, 500), "
                    f"got {tied_ids}. Sort key '(-cycle_time, id)' must be "
                    "honored in practice."
                )
                saw_tied_week = True

        assert saw_tied_week, (
            "Test setup bug: tied-cycle-time fixture did not surface in "
            "the rollup PR arrays; adjust the fixture dates/week assignment."
        )

    def test_golden_weekly_rollups_deterministic_with_comments_metrics(
        self, golden_db: tuple[DatabaseManager, Path, Path]
    ) -> None:
        """Feature 310: weekly rollup JSON stays byte-identical across runs
        after the comments-metrics extension, and the three new fields
        (``thread_count``, ``comment_count``, ``active_thread_count``) land
        on every emitted PR record when ``_has_comments()`` is True.

        Seeds ``pr_threads`` + ``pr_comments`` + ``comments_extracted_at``
        on the golden PRs to exercise the Feature 310 producer branch
        (aggregators.py per-week join on the capped slice).  Verifies:

        1. Byte-identity of each rollup file across two fresh aggregator
           runs over the same DB state.
        2. Every PR record carries all three new keys together (INV-08).
        3. For PRs with ``comments_extracted_at IS NOT NULL`` the triplet
           is all-integer; for ``IS NULL`` the triplet is all-``null``
           (INV-10).
        4. Per-record ``active_thread_count <= thread_count`` (INV-09).
        """
        import json as _json

        db, _, tmp_path = golden_db

        # Mark two of the three golden PRs comment-extracted; leave one
        # without an extracted_at stamp to exercise the partial branch.
        db.execute(
            "UPDATE pull_requests SET comments_extracted_at = ? "
            "WHERE pull_request_uid = ?",
            ("2024-01-12T00:00:00Z", "repo-001-100"),
        )
        db.execute(
            "UPDATE pull_requests SET comments_extracted_at = ? "
            "WHERE pull_request_uid = ?",
            ("2024-02-16T00:00:00Z", "repo-002-50"),
        )
        # repo-003-25 left with NULL → all three fields emit as null.

        # pr_threads + pr_comments seed on repo-001-100:
        #   - 1 active thread + 1 fixed thread + 1 deleted thread
        #   - 2 non-deleted comments across the kept threads
        #   - 1 deleted comment (excluded)
        #   Expected: thread_count=2, active_thread_count=1, comment_count=2
        thread_rows = (
            ("t1", "repo-001-100", "active", 0),
            ("t2", "repo-001-100", "fixed", 0),
            ("t3", "repo-001-100", "active", 1),  # deleted thread
            ("t1", "repo-002-50", "active", 0),
        )
        for thread_id, uid, status, deleted in thread_rows:
            db.execute(
                "INSERT INTO pr_threads "
                "(thread_id, pull_request_uid, status, thread_context, "
                "last_updated, created_at, is_deleted) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    thread_id,
                    uid,
                    status,
                    None,
                    "2024-01-12T00:00:00Z",
                    "2024-01-12T00:00:00Z",
                    deleted,
                ),
            )
        comment_rows = (
            ("c1", "t1", "repo-001-100", "user-bob", "text", 0),
            ("c2", "t2", "repo-001-100", "user-bob", "system", 0),
            ("c3", "t2", "repo-001-100", "user-bob", "text", 1),  # deleted
        )
        for comment_id, thread_id, uid, author, ctype, deleted in comment_rows:
            db.execute(
                "INSERT INTO pr_comments "
                "(comment_id, thread_id, pull_request_uid, author_id, "
                "content, comment_type, created_at, last_updated, is_deleted) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    comment_id,
                    thread_id,
                    uid,
                    author,
                    "body",
                    ctype,
                    "2024-01-12T00:00:00Z",
                    "2024-01-12T00:00:00Z",
                    deleted,
                ),
            )
        db.connection.commit()

        output1 = tmp_path / "rollup_comments_1"
        output2 = tmp_path / "rollup_comments_2"
        AggregateGenerator(db, output1, run_id="comments-det-1").generate_all()
        AggregateGenerator(db, output2, run_id="comments-det-1").generate_all()

        rollup_files1 = sorted(
            (output1 / "aggregates" / "weekly_rollups").glob("*.json")
        )
        rollup_files2 = sorted(
            (output2 / "aggregates" / "weekly_rollups").glob("*.json")
        )
        assert rollup_files1, "no rollup files produced"
        assert [p.name for p in rollup_files1] == [p.name for p in rollup_files2]

        saw_covered_with_counts = False
        saw_partial_triplet_null = False
        for f1, f2 in zip(rollup_files1, rollup_files2, strict=True):
            # (1) Byte-identity across runs.
            assert hash_file(f1) == hash_file(f2), (
                f"{f1.name} differs between runs after comments-metrics extension; "
                "byte-stable emission broke."
            )
            payload = _json.loads(f1.read_text(encoding="utf-8"))
            prs = payload.get("prs")
            if not isinstance(prs, list):
                continue
            for record in prs:
                assert isinstance(record, dict)
                # (2) INV-08 atomicity: triplet keys present together.
                assert "thread_count" in record
                assert "comment_count" in record
                assert "active_thread_count" in record
                triplet = (
                    record["thread_count"],
                    record["comment_count"],
                    record["active_thread_count"],
                )
                # (3) INV-10 consistency: all-None or all-int, never mixed.
                all_none = all(value is None for value in triplet)
                all_int = all(isinstance(value, int) for value in triplet)
                assert all_none or all_int, (
                    f"INV-10 violation on PR {record.get('id')!r}: mixed "
                    f"null/numeric triplet {triplet!r}"
                )
                if all_none:
                    saw_partial_triplet_null = True
                if all_int:
                    thread_count = record["thread_count"]
                    active_thread_count = record["active_thread_count"]
                    assert isinstance(thread_count, int)
                    assert isinstance(active_thread_count, int)
                    # (4) INV-09 ordering.
                    assert 0 <= active_thread_count <= thread_count, (
                        f"INV-09 violation on PR {record.get('id')!r}: "
                        f"active={active_thread_count} total={thread_count}"
                    )
                    if thread_count > 0:
                        saw_covered_with_counts = True
                    # Spot-check the specific expected counts on repo-001-100.
                    if record.get("id") == 100:
                        assert thread_count == 2
                        assert active_thread_count == 1
                        assert record["comment_count"] == 2
        assert saw_covered_with_counts, (
            "Determinism guard saw no covered PR with non-zero counts; the "
            "comments-metrics fixture did not surface in the rollup."
        )
        assert saw_partial_triplet_null, (
            "Determinism guard saw no partial-state PR; the fixture must "
            "include at least one covered PR with comments_extracted_at IS NULL."
        )

    def test_golden_pull_requests_sorted_correctly(
        self, golden_db: tuple[DatabaseManager, Path, Path]
    ) -> None:
        """Pull requests in golden output are sorted by UID."""
        import pandas as pd

        db, output_dir, _ = golden_db
        generator = CSVGenerator(db, output_dir)
        generator.generate_all()

        df = pd.read_csv(output_dir / "pull_requests.csv")
        uids = list(df["pull_request_uid"])

        # Should be alphabetically sorted by UID
        assert uids == ["repo-001-100", "repo-002-50", "repo-003-25"]

    def test_golden_organizations_sorted_correctly(
        self, golden_db: tuple[DatabaseManager, Path, Path]
    ) -> None:
        """Organizations in golden output are sorted alphabetically."""
        import pandas as pd

        db, output_dir, _ = golden_db
        generator = CSVGenerator(db, output_dir)
        generator.generate_all()

        df = pd.read_csv(output_dir / "organizations.csv")
        orgs = list(df["organization_name"])

        assert orgs == ["Acme Corp", "Beta Inc"]

    def test_golden_reviewers_multi_column_sort(
        self, golden_db: tuple[DatabaseManager, Path, Path]
    ) -> None:
        """Reviewers sorted by PR UID then user ID."""
        import pandas as pd

        db, output_dir, _ = golden_db
        generator = CSVGenerator(db, output_dir)
        generator.generate_all()

        df = pd.read_csv(output_dir / "reviewers.csv")

        expected = [
            ("repo-001-100", "user-bob"),
            ("repo-002-50", "user-alice"),
            ("repo-002-50", "user-carol"),
            ("repo-003-25", "user-alice"),
        ]

        actual = list(zip(df["pull_request_uid"], df["user_id"], strict=True))
        assert actual == expected
