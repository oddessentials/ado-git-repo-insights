"""Integration tests for golden outputs.

Victory Gate 1.3: SQLite → CSV Determinism
- CSV schemas match exactly
- Output hashes are stable across runs
- Golden fixture produces expected outputs
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
def golden_db() -> tuple[DatabaseManager, Path, Path]:
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
