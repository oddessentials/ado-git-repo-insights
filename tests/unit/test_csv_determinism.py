"""Unit tests for CSV determinism.

DoD 1.2: Deterministic Output Tests
- Given the same SQLite DB contents, generating CSVs twice produces identical outputs
- Deterministic row ordering is validated (stable primary + secondary sort keys)
"""

from __future__ import annotations

import hashlib
import tempfile
from pathlib import Path

import pytest

from ado_git_repo_insights.persistence.database import DatabaseManager
from ado_git_repo_insights.persistence.models import CSV_SCHEMAS
from ado_git_repo_insights.persistence.repository import PRRepository
from ado_git_repo_insights.transform.csv_generator import CSVGenerator


def hash_file(path: Path) -> str:
    """Calculate SHA-256 hash of a file."""
    sha256 = hashlib.sha256()
    with path.open("rb") as f:
        sha256.update(f.read())
    return sha256.hexdigest()


@pytest.fixture
def db_with_varied_data() -> tuple[DatabaseManager, Path, Path]:
    """Create a database with varied data to test determinism."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        db_path = tmp_path / "test.sqlite"
        output_dir1 = tmp_path / "csv_output_1"
        output_dir2 = tmp_path / "csv_output_2"

        manager = DatabaseManager(db_path)
        manager.connect()

        repo = PRRepository(manager)

        # Insert data in non-sorted order to test sorting
        repo.upsert_organization("ZetaOrg")
        repo.upsert_organization("AlphaOrg")
        repo.upsert_organization("BetaOrg")

        repo.upsert_project("ZetaOrg", "ZProject")
        repo.upsert_project("AlphaOrg", "AProject")
        repo.upsert_project("BetaOrg", "BProject")

        repo.upsert_repository("repo-zzz", "ZRepo", "ZProject", "ZetaOrg")
        repo.upsert_repository("repo-aaa", "ARepo", "AProject", "AlphaOrg")
        repo.upsert_repository("repo-bbb", "BRepo", "BProject", "BetaOrg")

        repo.upsert_user("user-3", "Zoe", "zoe@example.com")
        repo.upsert_user("user-1", "Alice", "alice@example.com")
        repo.upsert_user("user-2", "Bob", "bob@example.com")

        # PRs inserted out of order
        repo.upsert_pull_request(
            pull_request_uid="repo-zzz-300",
            pull_request_id=300,
            organization_name="ZetaOrg",
            project_name="ZProject",
            repository_id="repo-zzz",
            user_id="user-3",
            title="Third PR",
            status="completed",
            description=None,
            creation_date="2024-03-01T10:00:00Z",
            closed_date="2024-03-01T12:00:00Z",
            cycle_time_minutes=120.0,
        )

        repo.upsert_pull_request(
            pull_request_uid="repo-aaa-100",
            pull_request_id=100,
            organization_name="AlphaOrg",
            project_name="AProject",
            repository_id="repo-aaa",
            user_id="user-1",
            title="First PR",
            status="completed",
            description="Description",
            creation_date="2024-01-01T10:00:00Z",
            closed_date="2024-01-01T12:00:00Z",
            cycle_time_minutes=120.0,
        )

        repo.upsert_pull_request(
            pull_request_uid="repo-bbb-200",
            pull_request_id=200,
            organization_name="BetaOrg",
            project_name="BProject",
            repository_id="repo-bbb",
            user_id="user-2",
            title="Second PR",
            status="completed",
            description=None,
            creation_date="2024-02-01T10:00:00Z",
            closed_date="2024-02-01T12:00:00Z",
            cycle_time_minutes=120.0,
        )

        # Reviewers inserted out of order
        repo.upsert_reviewer("repo-zzz-300", "user-1", 10, "repo-zzz")
        repo.upsert_reviewer("repo-aaa-100", "user-2", 5, "repo-aaa")
        repo.upsert_reviewer("repo-aaa-100", "user-3", 10, "repo-aaa")

        yield manager, output_dir1, output_dir2

        manager.close()


class TestDeterministicOutput:
    """Test that CSV generation is deterministic (DoD 1.2, Invariant 3)."""

    def test_same_db_produces_identical_csvs(
        self, db_with_varied_data: tuple[DatabaseManager, Path, Path]
    ) -> None:
        """Generating CSVs twice from same DB produces identical files."""
        db, output_dir1, output_dir2 = db_with_varied_data

        # Generate twice
        generator1 = CSVGenerator(db, output_dir1)
        generator1.generate_all()

        generator2 = CSVGenerator(db, output_dir2)
        generator2.generate_all()

        # Compare hashes
        for table_name in CSV_SCHEMAS:
            path1 = output_dir1 / f"{table_name}.csv"
            path2 = output_dir2 / f"{table_name}.csv"

            hash1 = hash_file(path1)
            hash2 = hash_file(path2)

            assert hash1 == hash2, (
                f"{table_name}.csv not deterministic:\n"
                f"  Run 1: {hash1}\n"
                f"  Run 2: {hash2}"
            )

    def test_byte_for_byte_equality(
        self, db_with_varied_data: tuple[DatabaseManager, Path, Path]
    ) -> None:
        """CSV files are byte-for-byte identical across runs."""
        db, output_dir1, output_dir2 = db_with_varied_data

        generator1 = CSVGenerator(db, output_dir1)
        generator1.generate_all()

        generator2 = CSVGenerator(db, output_dir2)
        generator2.generate_all()

        for table_name in CSV_SCHEMAS:
            path1 = output_dir1 / f"{table_name}.csv"
            path2 = output_dir2 / f"{table_name}.csv"

            content1 = path1.read_bytes()
            content2 = path2.read_bytes()

            assert content1 == content2, f"{table_name}.csv differs between runs"


class TestDeterministicRowOrdering:
    """Test stable row ordering (Adjustment 3)."""

    def test_organizations_sorted_by_name(
        self, db_with_varied_data: tuple[DatabaseManager, Path, Path]
    ) -> None:
        """Organizations are sorted alphabetically by organization_name."""
        db, output_dir1, _ = db_with_varied_data

        generator = CSVGenerator(db, output_dir1)
        generator.generate_all()

        import pandas as pd

        df = pd.read_csv(output_dir1 / "organizations.csv")
        org_names = list(df["organization_name"])

        assert org_names == ["AlphaOrg", "BetaOrg", "ZetaOrg"]

    def test_pull_requests_sorted_by_uid(
        self, db_with_varied_data: tuple[DatabaseManager, Path, Path]
    ) -> None:
        """Pull requests are sorted by pull_request_uid."""
        db, output_dir1, _ = db_with_varied_data

        generator = CSVGenerator(db, output_dir1)
        generator.generate_all()

        import pandas as pd

        df = pd.read_csv(output_dir1 / "pull_requests.csv")
        pr_uids = list(df["pull_request_uid"])

        # Should be sorted alphabetically by UID
        assert pr_uids == ["repo-aaa-100", "repo-bbb-200", "repo-zzz-300"]

    def test_users_sorted_by_id(
        self, db_with_varied_data: tuple[DatabaseManager, Path, Path]
    ) -> None:
        """Users are sorted by user_id."""
        db, output_dir1, _ = db_with_varied_data

        generator = CSVGenerator(db, output_dir1)
        generator.generate_all()

        import pandas as pd

        df = pd.read_csv(output_dir1 / "users.csv")
        user_ids = list(df["user_id"])

        assert user_ids == ["user-1", "user-2", "user-3"]

    def test_reviewers_sorted_by_pr_uid_then_user_id(
        self, db_with_varied_data: tuple[DatabaseManager, Path, Path]
    ) -> None:
        """Reviewers are sorted by pull_request_uid, then user_id."""
        db, output_dir1, _ = db_with_varied_data

        generator = CSVGenerator(db, output_dir1)
        generator.generate_all()

        import pandas as pd

        df = pd.read_csv(output_dir1 / "reviewers.csv")

        # First row: repo-aaa-100 with user-2
        # Second row: repo-aaa-100 with user-3
        # Third row: repo-zzz-300 with user-1
        expected_order = [
            ("repo-aaa-100", "user-2"),
            ("repo-aaa-100", "user-3"),
            ("repo-zzz-300", "user-1"),
        ]

        actual_order = list(zip(df["pull_request_uid"], df["user_id"], strict=True))
        assert actual_order == expected_order
