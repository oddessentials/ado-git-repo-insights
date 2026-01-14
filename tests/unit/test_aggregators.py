"""Unit tests for aggregators module (Phase 3).

Tests the chunked JSON aggregate generation logic.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    pass

from ado_git_repo_insights.persistence.database import DatabaseManager
from ado_git_repo_insights.transform.aggregators import (
    AggregateGenerator,
)


@pytest.fixture
def sample_db(tmp_path: Path) -> tuple[DatabaseManager, Path]:
    """Create a sample database with test PR data."""
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
    db.execute(
        "INSERT INTO repositories (repository_id, repository_name, project_name, organization_name) VALUES (?, ?, ?, ?)",
        ("repo2", "Repository 2", "proj1", "org1"),
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
    db.execute(
        "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
        ("user3", "User Three", "user3@example.com"),
    )

    # 5. Pull Requests (depend on repos and users)
    test_prs = [
        # Week 2 of 2026 (Jan 6-12)
        (
            "repo1-1",
            1,
            "org1",
            "proj1",
            "repo1",
            "user1",
            "PR 1",
            "completed",
            None,
            "2026-01-03T10:00:00Z",
            "2026-01-06T14:00:00Z",
            4080.0,
        ),
        (
            "repo1-2",
            2,
            "org1",
            "proj1",
            "repo1",
            "user2",
            "PR 2",
            "completed",
            None,
            "2026-01-04T08:00:00Z",
            "2026-01-07T12:00:00Z",
            4560.0,
        ),
        # Week 3 of 2026 (Jan 13-19)
        (
            "repo1-3",
            3,
            "org1",
            "proj1",
            "repo1",
            "user1",
            "PR 3",
            "completed",
            None,
            "2026-01-10T09:00:00Z",
            "2026-01-13T10:00:00Z",
            4260.0,
        ),
        (
            "repo2-1",
            1,
            "org1",
            "proj1",
            "repo2",
            "user3",
            "PR 4",
            "completed",
            None,
            "2026-01-12T14:00:00Z",
            "2026-01-14T16:00:00Z",
            3000.0,
        ),
    ]

    for pr in test_prs:
        db.execute(
            """
            INSERT INTO pull_requests (
                pull_request_uid, pull_request_id, organization_name, project_name,
                repository_id, user_id, title, status, description,
                creation_date, closed_date, cycle_time_minutes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            pr,
        )

    db.connection.commit()

    yield db, db_path

    db.close()


class TestAggregateGenerator:
    """Tests for the AggregateGenerator class."""

    def test_generates_manifest(
        self, sample_db: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Test that manifest is generated with correct schema versions."""
        db, _ = sample_db
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir, run_id="test-run-123")
        manifest = generator.generate_all()

        # Verify manifest structure
        assert manifest.manifest_schema_version == 1
        assert manifest.dataset_schema_version == 1
        assert manifest.aggregates_schema_version == 1
        assert manifest.run_id == "test-run-123"

        # Verify manifest file exists
        manifest_path = output_dir / "dataset-manifest.json"
        assert manifest_path.exists()

        with manifest_path.open() as f:
            manifest_json = json.load(f)

        assert manifest_json["manifest_schema_version"] == 1
        assert "aggregate_index" in manifest_json

    def test_generates_weekly_rollups(
        self, sample_db: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Test that weekly rollup files are generated correctly."""
        db, _ = sample_db
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir)
        manifest = generator.generate_all()

        # Should have 2 weeks of data
        assert len(manifest.aggregate_index.weekly_rollups) == 2

        # Check weekly rollup files
        rollups_dir = output_dir / "aggregates" / "weekly_rollups"
        assert rollups_dir.exists()

        week1 = rollups_dir / "2026-W02.json"  # Jan 5-11 is Week 2
        assert week1.exists()

        with week1.open() as f:
            week1_data = json.load(f)

        assert week1_data["pr_count"] == 2
        assert week1_data["authors_count"] == 2  # user1 and user2

    def test_generates_distributions(
        self, sample_db: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Test that yearly distribution files are generated correctly."""
        db, _ = sample_db
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir)
        manifest = generator.generate_all()

        # Should have 1 year of data
        assert len(manifest.aggregate_index.distributions) == 1

        dist_dir = output_dir / "aggregates" / "distributions"
        year_file = dist_dir / "2026.json"
        assert year_file.exists()

        with year_file.open() as f:
            year_data = json.load(f)

        assert year_data["total_prs"] == 4
        assert "cycle_time_buckets" in year_data
        assert "prs_by_month" in year_data

    def test_generates_dimensions(
        self, sample_db: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Test that dimensions file is generated with filter values."""
        db, _ = sample_db
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir)
        generator.generate_all()

        dimensions_path = output_dir / "aggregates" / "dimensions.json"
        assert dimensions_path.exists()

        with dimensions_path.open() as f:
            dims = json.load(f)

        assert len(dims["repositories"]) == 2
        assert len(dims["users"]) == 3
        assert len(dims["projects"]) == 1
        assert "date_range" in dims

    def test_empty_database(self, tmp_path: Path) -> None:
        """Test handling of empty database."""
        db_path = tmp_path / "empty.sqlite"
        db = DatabaseManager(db_path)
        db.connect()

        output_dir = tmp_path / "output"
        generator = AggregateGenerator(db, output_dir)
        manifest = generator.generate_all()

        # Should produce empty aggregates
        assert len(manifest.aggregate_index.weekly_rollups) == 0
        assert len(manifest.aggregate_index.distributions) == 0
        assert manifest.coverage["total_prs"] == 0

        db.close()

    def test_manifest_includes_feature_flags(
        self, sample_db: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Test that manifest includes Phase 3 feature flags."""
        db, _ = sample_db
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir)
        manifest = generator.generate_all()

        # Verify feature flags (all disabled in Phase 3.1)
        assert manifest.features["teams"] is False
        assert manifest.features["comments"] is False
        assert manifest.features["ml"] is False
        assert manifest.features["ai_insights"] is False

    def test_aggregate_index_includes_file_sizes(
        self, sample_db: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Test that aggregate index includes file size information."""
        db, _ = sample_db
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir)
        manifest = generator.generate_all()

        for rollup in manifest.aggregate_index.weekly_rollups:
            assert "size_bytes" in rollup
            assert rollup["size_bytes"] > 0

        for dist in manifest.aggregate_index.distributions:
            assert "size_bytes" in dist
            assert dist["size_bytes"] > 0


class TestChunkSelection:
    """Tests for chunk selection logic (what the UI would do)."""

    def test_chunk_index_contains_date_ranges(
        self, sample_db: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Test that chunk index has date range info for lazy loading."""
        db, _ = sample_db
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir)
        manifest = generator.generate_all()

        for rollup in manifest.aggregate_index.weekly_rollups:
            assert "start_date" in rollup
            assert "end_date" in rollup
            # Dates should be valid ISO format
            date.fromisoformat(rollup["start_date"])
            date.fromisoformat(rollup["end_date"])
