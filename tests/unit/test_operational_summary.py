"""Unit tests for operational summary (Phase 4 §5)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ado_git_repo_insights.persistence.database import DatabaseManager
from ado_git_repo_insights.transform.aggregators import AggregateGenerator


@pytest.fixture
def sample_db_for_ops(tmp_path: Path) -> tuple[DatabaseManager, Path]:
    """Create a sample database with test PR data for operational tests.

    Follows the same pattern as test_aggregators.sample_db.
    """
    db_path = tmp_path / "test.sqlite"
    db = DatabaseManager(db_path)
    db.connect()

    # Insert entities in order respecting foreign keys
    # 1. Organizations first
    db.execute("INSERT INTO organizations (organization_name) VALUES (?)", ("org1",))

    # 2. Projects
    db.execute(
        "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
        ("org1", "proj1"),
    )

    # 3. Repositories
    db.execute(
        "INSERT INTO repositories (repository_id, repository_name, project_name, organization_name) VALUES (?, ?, ?, ?)",
        ("repo1", "Repository 1", "proj1", "org1"),
    )

    # 4. Users
    db.execute(
        "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
        ("user1", "User One", "user1@example.com"),
    )
    db.execute(
        "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
        ("user2", "User Two", "user2@example.com"),
    )

    # 5. Pull Requests (10 PRs)
    for i in range(10):
        db.execute(
            """
            INSERT INTO pull_requests (
                pull_request_uid, pull_request_id, organization_name, project_name,
                repository_id, user_id, title, status, description,
                creation_date, closed_date, cycle_time_minutes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"repo1-{i}",
                i + 1,
                "org1",
                "proj1",
                "repo1",
                "user1",
                f"PR {i + 1}",
                "completed",
                None,
                f"2026-01-{i + 1:02d}T10:00:00Z",
                f"2026-01-{i + 1:02d}T14:00:00Z",
                240.0 + i * 60,
            ),
        )

    # 6. Reviewers (one per PR)
    for i in range(10):
        db.execute(
            """
            INSERT INTO reviewers (
                pull_request_uid, user_id, vote, repository_id
            ) VALUES (?, ?, ?, ?)
            """,
            (f"repo1-{i}", "user2", 10, "repo1"),
        )

    db.connection.commit()

    yield db, tmp_path

    db.close()


class TestOperationalSummary:
    """Tests for Phase 4 §5 operational visibility."""

    def test_manifest_includes_operational_section(
        self, sample_db_for_ops: tuple[DatabaseManager, Path]
    ) -> None:
        """Manifest should include operational metadata."""
        db, tmp_path = sample_db_for_ops
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir, run_id="test-run")
        generator.generate_all()

        manifest_path = output_dir / "dataset-manifest.json"
        assert manifest_path.exists()

        with manifest_path.open() as f:
            manifest = json.load(f)

        assert "operational" in manifest
        assert "artifact_size_bytes" in manifest["operational"]
        assert manifest["operational"]["artifact_size_bytes"] > 0

    def test_manifest_includes_row_counts(
        self, sample_db_for_ops: tuple[DatabaseManager, Path]
    ) -> None:
        """Manifest should include row counts in coverage."""
        db, tmp_path = sample_db_for_ops
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir, run_id="test-run")
        generator.generate_all()

        manifest_path = output_dir / "dataset-manifest.json"
        with manifest_path.open() as f:
            manifest = json.load(f)

        assert "row_counts" in manifest["coverage"]
        row_counts = manifest["coverage"]["row_counts"]

        assert row_counts["pull_requests"] == 10
        assert row_counts["reviewers"] == 10
        assert row_counts["users"] == 2
        assert row_counts["repositories"] == 1

    def test_operational_weekly_rollup_count(
        self, sample_db_for_ops: tuple[DatabaseManager, Path]
    ) -> None:
        """Operational summary should include weekly rollup count."""
        db, tmp_path = sample_db_for_ops
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir, run_id="test-run")
        generator.generate_all()

        manifest_path = output_dir / "dataset-manifest.json"
        with manifest_path.open() as f:
            manifest = json.load(f)

        assert manifest["operational"]["weekly_rollup_count"] >= 1

    def test_operational_distribution_count(
        self, sample_db_for_ops: tuple[DatabaseManager, Path]
    ) -> None:
        """Operational summary should include distribution count."""
        db, tmp_path = sample_db_for_ops
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir, run_id="test-run")
        generator.generate_all()

        manifest_path = output_dir / "dataset-manifest.json"
        with manifest_path.open() as f:
            manifest = json.load(f)

        assert manifest["operational"]["distribution_count"] >= 1

    def test_retention_notice_absent_for_small_datasets(
        self, sample_db_for_ops: tuple[DatabaseManager, Path]
    ) -> None:
        """Retention notice should be None for datasets spanning 2 or fewer years."""
        db, tmp_path = sample_db_for_ops
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir, run_id="test-run")
        generator.generate_all()

        manifest_path = output_dir / "dataset-manifest.json"
        with manifest_path.open() as f:
            manifest = json.load(f)

        # Our sample data spans only 2026, so retention notice should be None
        assert manifest["operational"]["retention_notice"] is None
