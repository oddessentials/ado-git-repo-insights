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

        # Verify feature flags (all disabled when no stubs/ML generated)
        assert manifest.features["teams"] is False
        assert manifest.features["comments"] is False
        assert manifest.features["predictions"] is False  # Phase 3.5
        assert manifest.features["ai_insights"] is False  # Phase 3.5

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


class TestStubGeneration:
    """Tests for Phase 3.5 stub generation gating and determinism."""

    def test_enable_ml_stubs_without_env_var_raises(
        self,
        sample_db: tuple[DatabaseManager, Path],
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """--enable-ml-stubs without ALLOW_ML_STUBS=1 raises StubGenerationError."""
        from ado_git_repo_insights.transform.aggregators import (
            AggregationError,
            StubGenerationError,
        )

        # Ensure env var is not set
        monkeypatch.delenv("ALLOW_ML_STUBS", raising=False)

        db, _ = sample_db
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir, enable_ml_stubs=True)

        with pytest.raises(AggregationError) as exc_info:
            generator.generate_all()

        # Verify the cause is StubGenerationError
        assert isinstance(exc_info.value.__cause__, StubGenerationError)
        assert "ALLOW_ML_STUBS" in str(exc_info.value)

    def test_enable_ml_stubs_with_env_var_generates_files(
        self,
        sample_db: tuple[DatabaseManager, Path],
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """--enable-ml-stubs with ALLOW_ML_STUBS=1 generates predictions and insights."""
        monkeypatch.setenv("ALLOW_ML_STUBS", "1")

        db, _ = sample_db
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(
            db, output_dir, enable_ml_stubs=True, seed_base="test-seed"
        )
        manifest = generator.generate_all()

        # Check files were created
        predictions_file = output_dir / "predictions" / "trends.json"
        insights_file = output_dir / "insights" / "summary.json"

        assert predictions_file.exists(), "predictions/trends.json should exist"
        assert insights_file.exists(), "insights/summary.json should exist"

        # Check feature flags enabled
        assert manifest.features["predictions"] is True
        assert manifest.features["ai_insights"] is True

    def test_stub_output_is_deterministic(
        self,
        sample_db: tuple[DatabaseManager, Path],
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Same seed produces identical JSON output across runs."""
        monkeypatch.setenv("ALLOW_ML_STUBS", "1")

        db, _ = sample_db

        # Run 1
        output_dir1 = tmp_path / "output1"
        generator1 = AggregateGenerator(
            db, output_dir1, enable_ml_stubs=True, seed_base="deterministic-seed"
        )
        generator1.generate_all()

        # Run 2 with same seed
        output_dir2 = tmp_path / "output2"
        generator2 = AggregateGenerator(
            db, output_dir2, enable_ml_stubs=True, seed_base="deterministic-seed"
        )
        generator2.generate_all()

        # Compare predictions (excluding generated_at which varies)
        with (output_dir1 / "predictions" / "trends.json").open() as f1:
            pred1 = json.load(f1)
        with (output_dir2 / "predictions" / "trends.json").open() as f2:
            pred2 = json.load(f2)

        # Remove timestamp for comparison
        del pred1["generated_at"]
        del pred2["generated_at"]

        assert pred1 == pred2, "Predictions should be identical with same seed"

        # Compare insights
        with (output_dir1 / "insights" / "summary.json").open() as f1:
            ins1 = json.load(f1)
        with (output_dir2 / "insights" / "summary.json").open() as f2:
            ins2 = json.load(f2)

        del ins1["generated_at"]
        del ins2["generated_at"]

        assert ins1 == ins2, "Insights should be identical with same seed"

    def test_non_stub_run_does_not_generate_files(
        self, sample_db: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Without --enable-ml-stubs, predictions/insights files are not generated."""
        db, _ = sample_db
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir, enable_ml_stubs=False)
        generator.generate_all()

        predictions_file = output_dir / "predictions" / "trends.json"
        insights_file = output_dir / "insights" / "summary.json"

        assert not predictions_file.exists(), (
            "predictions should not exist without stubs"
        )
        assert not insights_file.exists(), "insights should not exist without stubs"

    def test_non_stub_run_sets_predictions_false(
        self, sample_db: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Without stubs, features.predictions should be False."""
        db, _ = sample_db
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir, enable_ml_stubs=False)
        manifest = generator.generate_all()

        assert manifest.features["predictions"] is False

    def test_non_stub_run_sets_ai_insights_false(
        self, sample_db: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Without stubs, features.ai_insights should be False."""
        db, _ = sample_db
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir, enable_ml_stubs=False)
        manifest = generator.generate_all()

        assert manifest.features["ai_insights"] is False

    def test_stub_output_includes_is_stub_true(
        self,
        sample_db: tuple[DatabaseManager, Path],
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Stub output files must include is_stub: true."""
        monkeypatch.setenv("ALLOW_ML_STUBS", "1")

        db, _ = sample_db
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(
            db, output_dir, enable_ml_stubs=True, seed_base="test"
        )
        generator.generate_all()

        with (output_dir / "predictions" / "trends.json").open() as f:
            predictions = json.load(f)
        with (output_dir / "insights" / "summary.json").open() as f:
            insights = json.load(f)

        assert predictions.get("is_stub") is True, "predictions must have is_stub: true"
        assert insights.get("is_stub") is True, "insights must have is_stub: true"

    def test_stub_output_includes_generated_by(
        self,
        sample_db: tuple[DatabaseManager, Path],
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Stub output files must include generated_by: 'phase3.5-stub-v1'."""
        monkeypatch.setenv("ALLOW_ML_STUBS", "1")

        db, _ = sample_db
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(
            db, output_dir, enable_ml_stubs=True, seed_base="test"
        )
        generator.generate_all()

        with (output_dir / "predictions" / "trends.json").open() as f:
            predictions = json.load(f)
        with (output_dir / "insights" / "summary.json").open() as f:
            insights = json.load(f)

        expected_generator = "phase3.5-stub-v1"
        assert predictions.get("generated_by") == expected_generator
        assert insights.get("generated_by") == expected_generator

    def test_manifest_includes_stub_warning(
        self,
        sample_db: tuple[DatabaseManager, Path],
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Manifest must include warnings: ['STUB DATA - NOT PRODUCTION'] when stubs enabled."""
        monkeypatch.setenv("ALLOW_ML_STUBS", "1")

        db, _ = sample_db
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(
            db, output_dir, enable_ml_stubs=True, seed_base="test"
        )
        manifest = generator.generate_all()

        # Use substring matching to handle message variations
        assert any("STUB DATA - NOT PRODUCTION" in w for w in manifest.warnings)

    def test_manifest_no_warning_without_stubs(
        self, sample_db: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Manifest should not include stub warning when stubs are disabled."""
        db, _ = sample_db
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir, enable_ml_stubs=False)
        manifest = generator.generate_all()

        # Use substring matching to handle message variations
        assert not any("STUB DATA - NOT PRODUCTION" in w for w in manifest.warnings)


class TestReviewerAggregation:
    """Tests for reviewer count aggregation and dimension slicing."""

    @pytest.fixture
    def db_with_reviewers(self, tmp_path: Path) -> tuple[DatabaseManager, Path]:
        """Create a sample database with PRs and reviewers."""
        db_path = tmp_path / "test_reviewers.sqlite"
        db = DatabaseManager(db_path)
        db.connect()

        # Insert entities
        db.execute(
            "INSERT INTO organizations (organization_name) VALUES (?)", ("org1",)
        )
        db.execute(
            "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
            ("org1", "proj1"),
        )
        db.execute(
            "INSERT INTO repositories (repository_id, repository_name, project_name, organization_name) VALUES (?, ?, ?, ?)",
            ("repo1", "Main Repo", "proj1", "org1"),
        )
        db.execute(
            "INSERT INTO repositories (repository_id, repository_name, project_name, organization_name) VALUES (?, ?, ?, ?)",
            ("repo2", "Secondary Repo", "proj1", "org1"),
        )

        # Insert users (authors and reviewers)
        for i in range(1, 6):
            db.execute(
                "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
                (f"user{i}", f"User {i}", f"user{i}@example.com"),
            )

        # Insert PRs - Week 2 of 2026
        prs = [
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
                "2026-01-03",
                "2026-01-06",
                100.0,
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
                "2026-01-04",
                "2026-01-07",
                200.0,
            ),
            (
                "repo2-1",
                1,
                "org1",
                "proj1",
                "repo2",
                "user3",
                "PR 3",
                "completed",
                None,
                "2026-01-05",
                "2026-01-08",
                300.0,
            ),
        ]
        for pr in prs:
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

        # Insert reviewers
        reviewers = [
            # PR 1 reviewed by user2 and user3
            ("repo1-1", "user2", 10, "repo1"),
            ("repo1-1", "user3", 10, "repo1"),
            # PR 2 reviewed by user1 and user4
            ("repo1-2", "user1", 10, "repo1"),
            ("repo1-2", "user4", 10, "repo1"),
            # PR 3 reviewed by user1 and user5
            ("repo2-1", "user1", 10, "repo2"),
            ("repo2-1", "user5", 10, "repo2"),
        ]
        for reviewer in reviewers:
            db.execute(
                "INSERT INTO reviewers (pull_request_uid, user_id, vote, repository_id) VALUES (?, ?, ?, ?)",
                reviewer,
            )

        db.connection.commit()

        yield db, db_path

        db.close()

    def test_counts_unique_reviewers_per_week(
        self, db_with_reviewers: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Test that reviewers_count reflects unique reviewers in that week."""
        db, _ = db_with_reviewers
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir)
        generator.generate_all()

        # Read the weekly rollup
        week_file = output_dir / "aggregates" / "weekly_rollups" / "2026-W02.json"
        assert week_file.exists()

        with week_file.open() as f:
            week_data = json.load(f)

        # Should have 5 unique reviewers: user1 (reviewed 2 PRs), user2, user3, user4, user5
        assert week_data["reviewers_count"] == 5
        assert week_data["pr_count"] == 3

    def test_generates_by_repository_slices(
        self, db_with_reviewers: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Test that weekly rollups include by_repository dimension slices."""
        db, _ = db_with_reviewers
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir)
        generator.generate_all()

        week_file = output_dir / "aggregates" / "weekly_rollups" / "2026-W02.json"
        with week_file.open() as f:
            week_data = json.load(f)

        # Should have by_repository field
        assert "by_repository" in week_data

        # Check Main Repo slice
        main_repo = week_data["by_repository"].get("Main Repo")
        assert main_repo is not None
        assert main_repo["pr_count"] == 2
        assert main_repo["authors_count"] == 2  # user1 and user2
        assert main_repo["reviewers_count"] == 4  # user1, user2, user3, user4

        # Check Secondary Repo slice
        secondary_repo = week_data["by_repository"].get("Secondary Repo")
        assert secondary_repo is not None
        assert secondary_repo["pr_count"] == 1
        assert secondary_repo["authors_count"] == 1  # user3
        assert secondary_repo["reviewers_count"] == 2  # user1 and user5

    def test_reviewer_count_zero_when_no_reviewers(self, tmp_path: Path) -> None:
        """Test that reviewers_count is 0 when PRs have no reviewers."""
        db_path = tmp_path / "no_reviewers.sqlite"
        db = DatabaseManager(db_path)
        db.connect()

        # Insert minimal entities
        db.execute(
            "INSERT INTO organizations (organization_name) VALUES (?)", ("org1",)
        )
        db.execute(
            "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
            ("org1", "proj1"),
        )
        db.execute(
            "INSERT INTO repositories (repository_id, repository_name, project_name, organization_name) VALUES (?, ?, ?, ?)",
            ("repo1", "Repo One", "proj1", "org1"),
        )
        db.execute(
            "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
            ("user1", "User 1", "user1@test.com"),
        )

        # Insert PR without any reviewers
        db.execute(
            """
            INSERT INTO pull_requests (
                pull_request_uid, pull_request_id, organization_name, project_name,
                repository_id, user_id, title, status, description,
                creation_date, closed_date, cycle_time_minutes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
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
                "2026-01-03",
                "2026-01-06",
                100.0,
            ),
        )
        db.connection.commit()

        output_dir = tmp_path / "output"
        generator = AggregateGenerator(db, output_dir)
        generator.generate_all()

        week_file = output_dir / "aggregates" / "weekly_rollups" / "2026-W02.json"
        with week_file.open() as f:
            week_data = json.load(f)

        assert week_data["reviewers_count"] == 0
        assert week_data["by_repository"]["Repo One"]["reviewers_count"] == 0

        db.close()

    def test_by_repository_includes_cycle_times(
        self, db_with_reviewers: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Test that by_repository slices include cycle time metrics."""
        db, _ = db_with_reviewers
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir)
        generator.generate_all()

        week_file = output_dir / "aggregates" / "weekly_rollups" / "2026-W02.json"
        with week_file.open() as f:
            week_data = json.load(f)

        main_repo = week_data["by_repository"]["Main Repo"]
        assert "cycle_time_p50" in main_repo
        assert "cycle_time_p90" in main_repo
        # Main repo has PRs with cycle times 100 and 200, so p50 should be 150
        assert main_repo["cycle_time_p50"] == 150.0


class TestTeamAggregation:
    """Tests for team-based aggregation (Phase 7.2).

    Tests verify that by_team slices are generated correctly, including:
    - Authors in exactly one team
    - Authors in multiple teams (counted in each team's slice)
    - Authors not in any team (excluded from team slices)
    """

    @pytest.fixture
    def db_with_teams(self, tmp_path: Path) -> tuple[DatabaseManager, Path]:
        """Create a sample database with teams, team_members, and PRs.

        Fixture data:
        - 2 teams: Backend Team, Frontend Team
        - 4 users:
          - user1: Backend Team only
          - user2: Frontend Team only
          - user3: Both teams (multi-membership)
          - user4: No team
        - 6 PRs across 2 repos in Week 2 of 2026
        """
        db_path = tmp_path / "test_teams.sqlite"
        db = DatabaseManager(db_path)
        db.connect()

        # 1. Organizations
        db.execute(
            "INSERT INTO organizations (organization_name) VALUES (?)", ("org1",)
        )

        # 2. Projects
        db.execute(
            "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
            ("org1", "proj1"),
        )

        # 3. Repositories
        db.execute(
            "INSERT INTO repositories (repository_id, repository_name, project_name, organization_name) VALUES (?, ?, ?, ?)",
            ("repo1", "API Repo", "proj1", "org1"),
        )
        db.execute(
            "INSERT INTO repositories (repository_id, repository_name, project_name, organization_name) VALUES (?, ?, ?, ?)",
            ("repo2", "Web Repo", "proj1", "org1"),
        )

        # 4. Users
        for i in range(1, 5):
            db.execute(
                "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
                (f"user{i}", f"User {i}", f"user{i}@example.com"),
            )

        # 5. Teams (last_updated is NOT NULL per schema)
        db.execute(
            "INSERT INTO teams (team_id, team_name, project_name, organization_name, last_updated) VALUES (?, ?, ?, ?, ?)",
            ("team-backend", "Backend Team", "proj1", "org1", "2026-01-01T00:00:00Z"),
        )
        db.execute(
            "INSERT INTO teams (team_id, team_name, project_name, organization_name, last_updated) VALUES (?, ?, ?, ?, ?)",
            ("team-frontend", "Frontend Team", "proj1", "org1", "2026-01-01T00:00:00Z"),
        )

        # 6. Team members
        # user1: Backend only
        db.execute(
            "INSERT INTO team_members (team_id, user_id) VALUES (?, ?)",
            ("team-backend", "user1"),
        )
        # user2: Frontend only
        db.execute(
            "INSERT INTO team_members (team_id, user_id) VALUES (?, ?)",
            ("team-frontend", "user2"),
        )
        # user3: Both teams (multi-membership)
        db.execute(
            "INSERT INTO team_members (team_id, user_id) VALUES (?, ?)",
            ("team-backend", "user3"),
        )
        db.execute(
            "INSERT INTO team_members (team_id, user_id) VALUES (?, ?)",
            ("team-frontend", "user3"),
        )
        # user4: No team membership

        # 7. Pull Requests - Week 2 of 2026 (Jan 5-11)
        prs = [
            # user1 (Backend only): 2 PRs
            (
                "repo1-1",
                1,
                "org1",
                "proj1",
                "repo1",
                "user1",
                "Backend fix 1",
                "completed",
                None,
                "2026-01-03",
                "2026-01-06",
                120.0,
            ),
            (
                "repo1-2",
                2,
                "org1",
                "proj1",
                "repo1",
                "user1",
                "Backend fix 2",
                "completed",
                None,
                "2026-01-04",
                "2026-01-07",
                180.0,
            ),
            # user2 (Frontend only): 1 PR
            (
                "repo2-1",
                1,
                "org1",
                "proj1",
                "repo2",
                "user2",
                "Frontend fix",
                "completed",
                None,
                "2026-01-05",
                "2026-01-08",
                240.0,
            ),
            # user3 (Both teams): 2 PRs - should appear in BOTH team slices
            (
                "repo1-3",
                3,
                "org1",
                "proj1",
                "repo1",
                "user3",
                "Cross-team 1",
                "completed",
                None,
                "2026-01-05",
                "2026-01-09",
                300.0,
            ),
            (
                "repo2-2",
                2,
                "org1",
                "proj1",
                "repo2",
                "user3",
                "Cross-team 2",
                "completed",
                None,
                "2026-01-06",
                "2026-01-10",
                360.0,
            ),
            # user4 (No team): 1 PR - should NOT appear in any team slice
            (
                "repo2-3",
                3,
                "org1",
                "proj1",
                "repo2",
                "user4",
                "No team PR",
                "completed",
                None,
                "2026-01-07",
                "2026-01-11",
                420.0,
            ),
        ]
        for pr in prs:
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

        # 8. Reviewers (for completeness)
        reviewers = [
            ("repo1-1", "user2", 10, "repo1"),
            ("repo1-2", "user3", 10, "repo1"),
            ("repo2-1", "user1", 10, "repo2"),
        ]
        for reviewer in reviewers:
            db.execute(
                "INSERT INTO reviewers (pull_request_uid, user_id, vote, repository_id) VALUES (?, ?, ?, ?)",
                reviewer,
            )

        db.connection.commit()

        yield db, db_path

        db.close()

    def test_generates_by_team_slices(
        self, db_with_teams: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Test that weekly rollups include by_team dimension slices."""
        db, _ = db_with_teams
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir)
        generator.generate_all()

        week_file = output_dir / "aggregates" / "weekly_rollups" / "2026-W02.json"
        with week_file.open() as f:
            week_data = json.load(f)

        # Should have by_team field
        assert "by_team" in week_data

        # Should have both teams
        assert "Backend Team" in week_data["by_team"]
        assert "Frontend Team" in week_data["by_team"]

    def test_team_slice_metrics_single_membership(
        self, db_with_teams: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Test metrics for teams with single-membership authors."""
        db, _ = db_with_teams
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir)
        generator.generate_all()

        week_file = output_dir / "aggregates" / "weekly_rollups" / "2026-W02.json"
        with week_file.open() as f:
            week_data = json.load(f)

        # Backend Team: user1 (2 PRs) + user3 (2 PRs) = 4 PRs total
        backend = week_data["by_team"]["Backend Team"]
        assert backend["pr_count"] == 4
        assert backend["authors_count"] == 2  # user1 and user3

        # Frontend Team: user2 (1 PR) + user3 (2 PRs) = 3 PRs total
        frontend = week_data["by_team"]["Frontend Team"]
        assert frontend["pr_count"] == 3
        assert frontend["authors_count"] == 2  # user2 and user3

    def test_multi_team_membership_duplicates_prs(
        self, db_with_teams: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Test that PRs from multi-team members appear in all their teams' slices.

        user3 is in both Backend and Frontend teams, so their 2 PRs should
        appear in BOTH team slices. This is intentional: "show me PRs for team X"
        means any PR authored by someone who is a member of team X.
        """
        db, _ = db_with_teams
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir)
        generator.generate_all()

        week_file = output_dir / "aggregates" / "weekly_rollups" / "2026-W02.json"
        with week_file.open() as f:
            week_data = json.load(f)

        # user3's 2 PRs should be counted in BOTH teams
        backend = week_data["by_team"]["Backend Team"]
        frontend = week_data["by_team"]["Frontend Team"]

        # Backend: 2 (user1) + 2 (user3) = 4
        # Frontend: 1 (user2) + 2 (user3) = 3
        # Total across teams: 7, but global total is 6 (no double-counting in base rollup)
        assert backend["pr_count"] + frontend["pr_count"] == 7

        # Verify global total is NOT the sum of team slices (avoids double-counting)
        assert week_data["pr_count"] == 6

    def test_authors_not_in_team_excluded_from_slices(
        self, db_with_teams: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Test that PRs from authors not in any team are excluded from team slices."""
        db, _ = db_with_teams
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir)
        generator.generate_all()

        week_file = output_dir / "aggregates" / "weekly_rollups" / "2026-W02.json"
        with week_file.open() as f:
            week_data = json.load(f)

        # user4's PR (no team) should not be in any team slice
        # Total PRs in team slices: 4 (Backend) + 3 (Frontend) = 7
        # (includes user3's 2 PRs counted twice due to multi-membership)
        # But user4's 1 PR is not counted in any team slice
        backend_prs = week_data["by_team"]["Backend Team"]["pr_count"]
        frontend_prs = week_data["by_team"]["Frontend Team"]["pr_count"]

        # Verify user4's PR is included in global but not in any team slice
        # Global: 6 PRs total
        # Teams: 4 + 3 = 7 (includes duplication from user3)
        # Without user4: would be 5 unique PRs
        assert week_data["pr_count"] == 6

        # The fact that sum of team slices (7) > global (6) confirms:
        # 1. Multi-membership duplication is working (user3's 2 PRs counted twice)
        # 2. user4's PR is in global but not in teams
        assert backend_prs + frontend_prs > week_data["pr_count"]

    def test_team_slice_includes_cycle_times(
        self, db_with_teams: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Test that by_team slices include cycle time metrics."""
        db, _ = db_with_teams
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir)
        generator.generate_all()

        week_file = output_dir / "aggregates" / "weekly_rollups" / "2026-W02.json"
        with week_file.open() as f:
            week_data = json.load(f)

        backend = week_data["by_team"]["Backend Team"]
        assert "cycle_time_p50" in backend
        assert "cycle_time_p90" in backend
        assert backend["cycle_time_p50"] is not None

    def test_team_slice_includes_reviewer_count(
        self, db_with_teams: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Test that by_team slices include reviewer counts."""
        db, _ = db_with_teams
        output_dir = tmp_path / "output"

        generator = AggregateGenerator(db, output_dir)
        generator.generate_all()

        week_file = output_dir / "aggregates" / "weekly_rollups" / "2026-W02.json"
        with week_file.open() as f:
            week_data = json.load(f)

        backend = week_data["by_team"]["Backend Team"]
        assert "reviewers_count" in backend

    def test_no_team_data_returns_empty_by_team(self, tmp_path: Path) -> None:
        """Test that by_team is empty when no team data exists (legacy DB)."""
        db_path = tmp_path / "no_teams.sqlite"
        db = DatabaseManager(db_path)
        db.connect()

        # Create minimal DB without teams
        db.execute(
            "INSERT INTO organizations (organization_name) VALUES (?)", ("org1",)
        )
        db.execute(
            "INSERT INTO projects (organization_name, project_name) VALUES (?, ?)",
            ("org1", "proj1"),
        )
        db.execute(
            "INSERT INTO repositories (repository_id, repository_name, project_name, organization_name) VALUES (?, ?, ?, ?)",
            ("repo1", "Repo", "proj1", "org1"),
        )
        db.execute(
            "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
            ("user1", "User 1", "user1@test.com"),
        )
        db.execute(
            """
            INSERT INTO pull_requests (
                pull_request_uid, pull_request_id, organization_name, project_name,
                repository_id, user_id, title, status, description,
                creation_date, closed_date, cycle_time_minutes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
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
                "2026-01-03",
                "2026-01-06",
                100.0,
            ),
        )
        db.connection.commit()

        output_dir = tmp_path / "output"
        generator = AggregateGenerator(db, output_dir)
        generator.generate_all()

        week_file = output_dir / "aggregates" / "weekly_rollups" / "2026-W02.json"
        with week_file.open() as f:
            week_data = json.load(f)

        # by_team should not be present when empty
        assert "by_team" not in week_data

        db.close()

    def test_empty_team_no_prs(
        self, db_with_teams: tuple[DatabaseManager, Path], tmp_path: Path
    ) -> None:
        """Test that teams with no PRs from their members don't appear in by_team."""
        db, _ = db_with_teams

        # Add a team with no members who have PRs
        db.execute(
            "INSERT INTO teams (team_id, team_name, project_name, organization_name, last_updated) VALUES (?, ?, ?, ?, ?)",
            ("team-empty", "Empty Team", "proj1", "org1", "2026-01-01T00:00:00Z"),
        )
        # Add a user who is in the empty team but has no PRs
        db.execute(
            "INSERT INTO users (user_id, display_name, email) VALUES (?, ?, ?)",
            ("user5", "User 5", "user5@example.com"),
        )
        db.execute(
            "INSERT INTO team_members (team_id, user_id) VALUES (?, ?)",
            ("team-empty", "user5"),
        )
        db.connection.commit()

        output_dir = tmp_path / "output"
        generator = AggregateGenerator(db, output_dir)
        generator.generate_all()

        week_file = output_dir / "aggregates" / "weekly_rollups" / "2026-W02.json"
        with week_file.open() as f:
            week_data = json.load(f)

        # Empty Team should not appear (no PRs from its members)
        assert "Empty Team" not in week_data["by_team"]
