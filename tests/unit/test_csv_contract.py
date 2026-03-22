"""Unit tests for CSV schema contract.

DoD 1.1: Schema Contract Tests
- Column names match exactly
- Column order matches exactly
- CSV headers contain no extras and no missing columns
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pandas as pd
import pytest

from ado_git_repo_insights.persistence.database import DatabaseManager
from ado_git_repo_insights.persistence.models import CSV_SCHEMAS
from ado_git_repo_insights.persistence.repository import PRRepository
from ado_git_repo_insights.transform.csv_generator import CSVGenerator

EXPECTED_AUXILIARY_THREAD_COLUMNS = [
    "thread_id",
    "pull_request_uid",
    "status",
    "thread_context",
    "last_updated",
    "created_at",
    "is_deleted",
]

EXPECTED_AUXILIARY_COMMENT_COLUMNS = [
    "comment_id",
    "thread_id",
    "pull_request_uid",
    "author_id",
    "content",
    "comment_type",
    "created_at",
    "last_updated",
    "is_deleted",
]


@pytest.fixture
def db_with_data() -> tuple[DatabaseManager, Path]:
    """Create a database with sample data for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        db_path = tmp_path / "test.sqlite"
        output_dir = tmp_path / "csv_output"

        manager = DatabaseManager(db_path)
        manager.connect()

        repo = PRRepository(manager)

        # Insert sample data
        repo.upsert_organization("TestOrg")
        repo.upsert_project("TestOrg", "TestProject")
        repo.upsert_repository("repo-1", "MyRepo", "TestProject", "TestOrg")
        repo.upsert_user("user-1", "John Doe", "john@example.com")
        repo.upsert_user("user-2", "Jane Doe", "jane@example.com")

        repo.upsert_pull_request(
            pull_request_uid="repo-1-100",
            pull_request_id=100,
            organization_name="TestOrg",
            project_name="TestProject",
            repository_id="repo-1",
            user_id="user-1",
            title="Test PR",
            status="completed",
            description="Test description",
            creation_date="2024-01-15T10:00:00Z",
            closed_date="2024-01-15T12:00:00Z",
            cycle_time_minutes=120.0,
        )

        repo.upsert_reviewer("repo-1-100", "user-2", 10, "repo-1")

        yield manager, output_dir

        manager.close()


class TestSchemaContract:
    """Test CSV schema contract compliance (DoD 1.1)."""

    def test_organizations_schema(
        self, db_with_data: tuple[DatabaseManager, Path]
    ) -> None:
        """organizations.csv has exact expected columns."""
        db, output_dir = db_with_data
        generator = CSVGenerator(db, output_dir)
        generator.generate_all()

        df = pd.read_csv(output_dir / "organizations.csv")
        assert list(df.columns) == CSV_SCHEMAS["organizations"]

    def test_projects_schema(self, db_with_data: tuple[DatabaseManager, Path]) -> None:
        """projects.csv has exact expected columns."""
        db, output_dir = db_with_data
        generator = CSVGenerator(db, output_dir)
        generator.generate_all()

        df = pd.read_csv(output_dir / "projects.csv")
        assert list(df.columns) == CSV_SCHEMAS["projects"]

    def test_repositories_schema(
        self, db_with_data: tuple[DatabaseManager, Path]
    ) -> None:
        """repositories.csv has exact expected columns."""
        db, output_dir = db_with_data
        generator = CSVGenerator(db, output_dir)
        generator.generate_all()

        df = pd.read_csv(output_dir / "repositories.csv")
        assert list(df.columns) == CSV_SCHEMAS["repositories"]

    def test_pull_requests_schema(
        self, db_with_data: tuple[DatabaseManager, Path]
    ) -> None:
        """pull_requests.csv has exact expected columns."""
        db, output_dir = db_with_data
        generator = CSVGenerator(db, output_dir)
        generator.generate_all()

        df = pd.read_csv(output_dir / "pull_requests.csv")
        assert list(df.columns) == CSV_SCHEMAS["pull_requests"]

    def test_users_schema(self, db_with_data: tuple[DatabaseManager, Path]) -> None:
        """users.csv has exact expected columns."""
        db, output_dir = db_with_data
        generator = CSVGenerator(db, output_dir)
        generator.generate_all()

        df = pd.read_csv(output_dir / "users.csv")
        assert list(df.columns) == CSV_SCHEMAS["users"]

    def test_reviewers_schema(self, db_with_data: tuple[DatabaseManager, Path]) -> None:
        """reviewers.csv has exact expected columns."""
        db, output_dir = db_with_data
        generator = CSVGenerator(db, output_dir)
        generator.generate_all()

        df = pd.read_csv(output_dir / "reviewers.csv")
        assert list(df.columns) == CSV_SCHEMAS["reviewers"]

    def test_all_csvs_generated(
        self, db_with_data: tuple[DatabaseManager, Path]
    ) -> None:
        """All expected CSV files are generated."""
        db, output_dir = db_with_data
        generator = CSVGenerator(db, output_dir)
        generator.generate_all()

        for table_name in CSV_SCHEMAS:
            csv_path = output_dir / f"{table_name}.csv"
            assert csv_path.exists(), f"Missing {csv_path}"

    def test_validate_schemas_passes(
        self, db_with_data: tuple[DatabaseManager, Path]
    ) -> None:
        """Schema validation passes for correct CSVs."""
        db, output_dir = db_with_data
        generator = CSVGenerator(db, output_dir)
        generator.generate_all()

        assert generator.validate_schemas()

    def test_generate_all_writes_only_core_contract_csvs(
        self, db_with_data: tuple[DatabaseManager, Path]
    ) -> None:
        """Core CSV generation does not create additive files in the contract root."""
        db, output_dir = db_with_data
        generator = CSVGenerator(db, output_dir)

        generator.generate_all()

        root_csvs = sorted(path.name for path in output_dir.glob("*.csv"))
        expected_csvs = sorted(f"{table_name}.csv" for table_name in CSV_SCHEMAS)

        assert root_csvs == expected_csvs
        assert not (output_dir / "auxiliary").exists()

    def test_generate_all_writes_auxiliary_comments_csvs_outside_contract_root(
        self, db_with_data: tuple[DatabaseManager, Path]
    ) -> None:
        """Comments CSVs are additive and live only under auxiliary/comments/."""
        db, output_dir = db_with_data
        repo = PRRepository(db)

        repo.upsert_thread(
            thread_id="thread-1",
            pull_request_uid="repo-1-100",
            status="active",
            thread_context='{"filePath":"/src/app.py"}',
            last_updated="2024-01-15T12:30:00Z",
            created_at="2024-01-15T12:10:00Z",
            is_deleted=False,
        )
        repo.upsert_comment(
            comment_id="comment-1",
            thread_id="thread-1",
            pull_request_uid="repo-1-100",
            author_id="user-2",
            content="Looks good",
            comment_type="text",
            created_at="2024-01-15T12:15:00Z",
            last_updated="2024-01-15T12:30:00Z",
            is_deleted=False,
        )
        db.connection.commit()

        generator = CSVGenerator(db, output_dir)
        generator.generate_all()

        root_csvs = sorted(path.name for path in output_dir.glob("*.csv"))
        expected_csvs = sorted(f"{table_name}.csv" for table_name in CSV_SCHEMAS)
        auxiliary_dir = output_dir / "auxiliary" / "comments"

        assert root_csvs == expected_csvs
        assert (auxiliary_dir / "pr_threads.csv").exists()
        assert (auxiliary_dir / "pr_comments.csv").exists()


class TestColumnOrder:
    """Test exact column ordering (DoD 1.1, Invariant 1)."""

    def test_pull_requests_column_order_exact(
        self, db_with_data: tuple[DatabaseManager, Path]
    ) -> None:
        """pull_requests.csv columns are in exact contract order."""
        db, output_dir = db_with_data
        generator = CSVGenerator(db, output_dir)
        generator.generate_all()

        df = pd.read_csv(output_dir / "pull_requests.csv")

        expected_order = [
            "pull_request_uid",
            "pull_request_id",
            "organization_name",
            "project_name",
            "repository_id",
            "user_id",
            "title",
            "status",
            "description",
            "creation_date",
            "closed_date",
            "cycle_time_minutes",
        ]

        assert list(df.columns) == expected_order

    def test_auxiliary_pr_threads_column_order_exact(
        self, db_with_data: tuple[DatabaseManager, Path]
    ) -> None:
        """Auxiliary pr_threads.csv columns are in exact export order."""
        db, output_dir = db_with_data
        repo = PRRepository(db)

        repo.upsert_thread(
            thread_id="thread-1",
            pull_request_uid="repo-1-100",
            status="active",
            thread_context='{"filePath":"/src/app.py"}',
            last_updated="2024-01-15T12:30:00Z",
            created_at="2024-01-15T12:10:00Z",
            is_deleted=False,
        )
        db.connection.commit()

        generator = CSVGenerator(db, output_dir)
        generator.generate_all()

        df = pd.read_csv(output_dir / "auxiliary" / "comments" / "pr_threads.csv")

        assert list(df.columns) == EXPECTED_AUXILIARY_THREAD_COLUMNS

    def test_auxiliary_pr_comments_column_order_exact(
        self, db_with_data: tuple[DatabaseManager, Path]
    ) -> None:
        """Auxiliary pr_comments.csv columns are in exact export order."""
        db, output_dir = db_with_data
        repo = PRRepository(db)

        repo.upsert_thread(
            thread_id="thread-1",
            pull_request_uid="repo-1-100",
            status="active",
            thread_context='{"filePath":"/src/app.py"}',
            last_updated="2024-01-15T12:30:00Z",
            created_at="2024-01-15T12:10:00Z",
            is_deleted=False,
        )
        repo.upsert_comment(
            comment_id="comment-1",
            thread_id="thread-1",
            pull_request_uid="repo-1-100",
            author_id="user-2",
            content="Looks good",
            comment_type="text",
            created_at="2024-01-15T12:15:00Z",
            last_updated="2024-01-15T12:30:00Z",
            is_deleted=False,
        )
        db.connection.commit()

        generator = CSVGenerator(db, output_dir)
        generator.generate_all()

        df = pd.read_csv(output_dir / "auxiliary" / "comments" / "pr_comments.csv")

        assert list(df.columns) == EXPECTED_AUXILIARY_COMMENT_COLUMNS

    def test_no_extra_columns(self, db_with_data: tuple[DatabaseManager, Path]) -> None:
        """No extra columns in any CSV."""
        db, output_dir = db_with_data
        generator = CSVGenerator(db, output_dir)
        generator.generate_all()

        for table_name, expected_columns in CSV_SCHEMAS.items():
            df = pd.read_csv(output_dir / f"{table_name}.csv")
            actual_columns = list(df.columns)
            extra = set(actual_columns) - set(expected_columns)
            assert not extra, f"Extra columns in {table_name}: {extra}"

    def test_no_missing_columns(
        self, db_with_data: tuple[DatabaseManager, Path]
    ) -> None:
        """No missing columns in any CSV."""
        db, output_dir = db_with_data
        generator = CSVGenerator(db, output_dir)
        generator.generate_all()

        for table_name, expected_columns in CSV_SCHEMAS.items():
            df = pd.read_csv(output_dir / f"{table_name}.csv")
            actual_columns = list(df.columns)
            missing = set(expected_columns) - set(actual_columns)
            assert not missing, f"Missing columns in {table_name}: {missing}"


class TestAuxiliaryCommentsSchemaParity:
    """Validate auxiliary comments exports against the live SQLite schema."""

    @staticmethod
    def _table_columns(db: DatabaseManager, table_name: str) -> list[str]:
        cursor = db.execute(f"PRAGMA table_info({table_name})")
        rows = cursor.fetchall()
        return [str(row["name"]) for row in rows]

    def test_auxiliary_pr_threads_columns_exist_in_sqlite_schema(
        self, db_with_data: tuple[DatabaseManager, Path]
    ) -> None:
        """Auxiliary pr_threads export columns must exist in the live schema."""
        db, _ = db_with_data
        table_columns = self._table_columns(db, "pr_threads")

        assert table_columns, "Expected pr_threads table to exist in schema"
        missing = [
            column
            for column in EXPECTED_AUXILIARY_THREAD_COLUMNS
            if column not in table_columns
        ]
        assert not missing, f"Missing pr_threads export columns in schema: {missing}"

    def test_auxiliary_pr_comments_columns_exist_in_sqlite_schema(
        self, db_with_data: tuple[DatabaseManager, Path]
    ) -> None:
        """Auxiliary pr_comments export columns must exist in the live schema."""
        db, _ = db_with_data
        table_columns = self._table_columns(db, "pr_comments")

        assert table_columns, "Expected pr_comments table to exist in schema"
        missing = [
            column
            for column in EXPECTED_AUXILIARY_COMMENT_COLUMNS
            if column not in table_columns
        ]
        assert not missing, f"Missing pr_comments export columns in schema: {missing}"
