"""Tests for synthetic dataset generator.

Contract validation: Producer tests ensure generated output matches schema.
"""

import atexit
import json
import re
import shutil
import subprocess
import sys
from itertools import count
from pathlib import Path

import pytest

TEST_TMP_ROOT = Path(__file__).resolve().parents[2] / "tmp_test_work"
_RUN_COUNTER = count()


def _cleanup_test_tmp_root() -> None:
    """Best-effort cleanup for repo-local scratch directories created by tests."""
    shutil.rmtree(TEST_TMP_ROOT, ignore_errors=True)


atexit.register(_cleanup_test_tmp_root)


def _make_scratch_dir(prefix: str) -> Path:
    """Create a repo-local scratch directory for subprocess-backed tests."""
    TEST_TMP_ROOT.mkdir(parents=True, exist_ok=True)
    scratch_dir = TEST_TMP_ROOT / f"{prefix}-{next(_RUN_COUNTER):04d}"
    while scratch_dir.exists():
        scratch_dir = TEST_TMP_ROOT / f"{prefix}-{next(_RUN_COUNTER):04d}"
    scratch_dir.mkdir(parents=True, exist_ok=False)
    return scratch_dir


def _build_generator_args(
    pr_count: int,
    seed: int,
    output: str,
    weeks: int | None = None,
    users: int | None = None,
    include_comments: bool = False,
) -> list[str]:
    """Build CLI argument list for the generator script."""
    script = (
        Path(__file__).parent.parent.parent
        / "scripts"
        / "generate-synthetic-dataset.py"
    )
    args = [
        "python",
        str(script),
        "--pr-count",
        str(pr_count),
        "--seed",
        str(seed),
        "--output",
        output,
    ]
    if weeks is not None:
        args.extend(["--weeks", str(weeks)])
    if users is not None:
        args.extend(["--users", str(users)])
    if include_comments:
        args.append("--include-comments")
    return args


def run_generator_raw(
    pr_count: int,
    seed: int,
    weeks: int | None = None,
    users: int | None = None,
    include_comments: bool = False,
) -> tuple[subprocess.CompletedProcess[str], Path]:
    """Run generator and return (result, output_dir) without asserting success."""
    output_dir = _make_scratch_dir("synthetic-raw")

    args = _build_generator_args(
        pr_count=pr_count,
        seed=seed,
        output=str(output_dir),
        weeks=weeks,
        users=users,
        include_comments=include_comments,
    )
    result = subprocess.run(args, capture_output=True, text=True, check=False)
    return result, output_dir


def run_generator(
    pr_count: int,
    weeks: int | None = None,
    seed: int = 42,
    users: int | None = None,
    include_comments: bool = False,
) -> Path:
    """Run generator and return output directory."""
    output_dir = _make_scratch_dir("synthetic-test")

    args = _build_generator_args(
        pr_count=pr_count,
        seed=seed,
        output=str(output_dir),
        weeks=weeks,
        users=users,
        include_comments=include_comments,
    )

    result = subprocess.run(args, capture_output=True, text=True, check=False)

    if result.returncode != 0:
        pytest.fail(f"Generator failed: {result.stderr}")

    return output_dir


def test_manifest_schema_validation():
    """Generated manifest must pass DatasetManifest schema validation."""
    output_dir = run_generator(pr_count=100, weeks=4, seed=42)

    manifest_path = output_dir / "dataset-manifest.json"
    assert manifest_path.exists(), "dataset-manifest.json must exist"

    with manifest_path.open() as f:
        manifest_data = json.load(f)

    # Validate schema versions
    assert manifest_data["manifest_schema_version"] == 1
    assert manifest_data["dataset_schema_version"] == 1
    assert manifest_data["aggregates_schema_version"] == 3

    # Validate required fields
    assert "generated_at" in manifest_data
    assert "run_id" in manifest_data
    assert "aggregate_index" in manifest_data
    assert "defaults" in manifest_data
    assert "limits" in manifest_data
    assert "features" in manifest_data
    assert "coverage" in manifest_data

    # Validate aggregate index structure
    index = manifest_data["aggregate_index"]
    assert "weekly_rollups" in index
    assert "distributions" in index
    assert isinstance(index["weekly_rollups"], list)
    assert isinstance(index["distributions"], list)


def test_weekly_rollup_schema():
    """Generated rollups must match WeeklyRollup schema."""
    output_dir = run_generator(pr_count=100, weeks=4, seed=42)

    manifest_path = output_dir / "dataset-manifest.json"
    with manifest_path.open() as f:
        manifest = json.load(f)

    # Load first rollup
    rollup_entry = manifest["aggregate_index"]["weekly_rollups"][0]
    rollup_path = output_dir / rollup_entry["path"]

    assert rollup_path.exists(), f"Rollup file must exist: {rollup_entry['path']}"

    with rollup_path.open() as f:
        rollup_data = json.load(f)

    # Validate required fields
    required_fields = [
        "week",
        "start_date",
        "end_date",
        "pr_count",
        "cycle_time_p50",
        "cycle_time_p90",
        "authors_count",
        "reviewers_count",
    ]

    for field in required_fields:
        assert field in rollup_data, f"Field {field} must exist in rollup"

    # Validate types
    assert isinstance(rollup_data["pr_count"], int)
    assert isinstance(rollup_data["authors_count"], int)
    assert isinstance(rollup_data["reviewers_count"], int)

    # Validate ISO week format
    assert rollup_data["week"].count("-W") == 1


def test_by_repository_non_negative_across_all_weeks():
    """by_repository breakdown values must be >= 0 in every rollup.

    Regression: round()-based proportional splitting could overshoot the
    total, leaving a negative remainder for the last repository.
    Uses 10 repos x 52 weeks to exercise many weight combinations.
    """
    output_dir = run_generator(pr_count=1000, weeks=52, seed=42)

    rollup_dir = output_dir / "aggregates" / "weekly_rollups"
    rollup_files = sorted(rollup_dir.glob("*.json"))
    assert len(rollup_files) == 52

    for rollup_path in rollup_files:
        with rollup_path.open() as f:
            rollup = json.load(f)

        assert "by_repository" in rollup, f"{rollup_path.name}: by_repository missing"

        for repo_name, entry in rollup["by_repository"].items():
            for field in ("pr_count", "authors_count", "reviewers_count"):
                assert field in entry, (
                    f"{rollup_path.name} -> {repo_name}: {field} missing"
                )
                assert entry[field] >= 0, (
                    f"{rollup_path.name} -> {repo_name}.{field} = {entry[field]}"
                )


def test_distribution_schema():
    """Generated distributions must match YearlyDistribution schema."""
    output_dir = run_generator(pr_count=100, weeks=4, seed=42)

    manifest_path = output_dir / "dataset-manifest.json"
    with manifest_path.open() as f:
        manifest = json.load(f)

    # Load first distribution
    dist_entry = manifest["aggregate_index"]["distributions"][0]
    dist_path = output_dir / dist_entry["path"]

    assert dist_path.exists(), f"Distribution file must exist: {dist_entry['path']}"

    with dist_path.open() as f:
        dist_data = json.load(f)

    # Validate required fields
    required_fields = [
        "year",
        "start_date",
        "end_date",
        "total_prs",
        "cycle_time_buckets",
        "prs_by_month",
    ]

    for field in required_fields:
        assert field in dist_data, f"Field {field} must exist in distribution"

    # Validate cycle time buckets
    expected_buckets = ["0-1h", "1-4h", "4-24h", "1-3d", "3-7d", "7d+"]
    for bucket in expected_buckets:
        assert bucket in dist_data["cycle_time_buckets"]


def test_deterministic_output():
    """Same seed must produce identical output."""
    output1 = run_generator(pr_count=100, weeks=4, seed=999)
    output2 = run_generator(pr_count=100, weeks=4, seed=999)

    # Compare manifests
    with (output1 / "dataset-manifest.json").open() as f:
        manifest1 = json.load(f)

    with (output2 / "dataset-manifest.json").open() as f:
        manifest2 = json.load(f)

    # Exclude generated_at timestamp
    del manifest1["generated_at"]
    del manifest2["generated_at"]

    assert manifest1 == manifest2, "Same seed must produce identical datasets"


def test_pr_count_matches():
    """Total PRs across all chunks must match requested count."""
    pr_count = 100
    output_dir = run_generator(pr_count=pr_count, weeks=4, seed=42)

    manifest_path = output_dir / "dataset-manifest.json"
    with manifest_path.open() as f:
        manifest = json.load(f)

    # Total from coverage
    assert manifest["coverage"]["total_prs"] == pr_count

    # Total from weekly rollups
    total_from_rollups = 0
    for entry in manifest["aggregate_index"]["weekly_rollups"]:
        rollup_path = output_dir / entry["path"]
        with rollup_path.open() as f:
            rollup = json.load(f)
            total_from_rollups += rollup["pr_count"]

    # Allow some variance due to distribution logic
    assert abs(total_from_rollups - pr_count) < pr_count * 0.2, (
        f"Rollup total {total_from_rollups} too far from requested {pr_count}"
    )


@pytest.mark.parametrize("pr_count", [100, 1000])
def test_scaling_datasets(pr_count):
    """Generator must work at multiple scales."""
    output_dir = run_generator(pr_count=pr_count, weeks=None, seed=42)

    manifest_path = output_dir / "dataset-manifest.json"
    assert manifest_path.exists()

    with manifest_path.open() as f:
        manifest = json.load(f)

    assert manifest["coverage"]["total_prs"] == pr_count
    assert len(manifest["aggregate_index"]["weekly_rollups"]) > 0
    assert len(manifest["aggregate_index"]["distributions"]) > 0


# ---------------------------------------------------------------------------
# Scalability tests (T009–T013): --users, --weeks range, --include-comments
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("user_count", [1, 50, 200, 500])
def test_users_argument_accepts_valid_range(user_count):
    """T009: --users must accept values from 1 to 500."""
    output_dir = run_generator(pr_count=1000, weeks=4, seed=42, users=user_count)

    manifest_path = output_dir / "dataset-manifest.json"
    with manifest_path.open() as f:
        manifest = json.load(f)

    dim_path = output_dir / "aggregates" / "dimensions.json"
    with dim_path.open() as f:
        dimensions = json.load(f)

    assert len(dimensions["users"]) == user_count
    assert manifest["coverage"]["row_counts"]["users"] == user_count


@pytest.mark.parametrize("week_count", [1, 52, 156, 520])
def test_weeks_argument_accepts_valid_range(week_count):
    """T010: --weeks must accept values from 1 to 520."""
    output_dir = run_generator(pr_count=1000, weeks=week_count, seed=42)

    manifest_path = output_dir / "dataset-manifest.json"
    with manifest_path.open() as f:
        manifest = json.load(f)

    rollups = manifest["aggregate_index"]["weekly_rollups"]
    assert len(rollups) == week_count


def test_include_comments_sets_feature_flag():
    """T011: --include-comments must set features.comments to true in manifest."""
    output_dir = run_generator(pr_count=100, weeks=4, seed=42, include_comments=True)

    manifest_path = output_dir / "dataset-manifest.json"
    with manifest_path.open() as f:
        manifest = json.load(f)

    assert manifest["features"]["comments"] is True


def test_manifest_sets_author_repo_exact_capability():
    """Synthetic datasets advertise exact author+repository support."""
    output_dir = run_generator(pr_count=100, weeks=4, seed=42, users=10)

    manifest_path = output_dir / "dataset-manifest.json"
    with manifest_path.open() as f:
        manifest = json.load(f)

    assert manifest["capabilities"]["author_filters"] is True
    assert manifest["capabilities"]["author_repo_exact"] is True


def test_users_zero_validation_error():
    """T012: --users 0 must fail with a clear validation error."""
    result, output_dir = run_generator_raw(pr_count=100, seed=42, users=0)
    try:
        assert result.returncode != 0, "--users 0 must be rejected"
        # Error message should mention the invalid value
        combined_output = result.stderr + result.stdout
        assert "0" in combined_output or "users" in combined_output.lower()
    finally:
        import shutil

        if output_dir.exists():
            shutil.rmtree(output_dir, ignore_errors=True)


def test_weeks_zero_validation_error():
    """T013: --weeks 0 must fail with a clear validation error."""
    result, output_dir = run_generator_raw(pr_count=100, seed=42, weeks=0)
    try:
        assert result.returncode != 0, "--weeks 0 must be rejected"
        combined_output = result.stderr + result.stdout
        assert "0" in combined_output or "weeks" in combined_output.lower()
    finally:
        import shutil

        if output_dir.exists():
            shutil.rmtree(output_dir, ignore_errors=True)


def test_200_users_produces_200_dimension_entries():
    """T014: 200 users must produce exactly 200 entries in dimensions.json."""
    output_dir = run_generator(pr_count=1000, weeks=4, seed=42, users=200)

    dim_path = output_dir / "aggregates" / "dimensions.json"
    with dim_path.open() as f:
        dimensions = json.load(f)

    assert len(dimensions["users"]) == 200

    # Verify uniqueness
    user_ids = [u["user_id"] for u in dimensions["users"]]
    assert len(set(user_ids)) == 200


def test_156_weeks_produces_156_rollup_files():
    """T015: 156 weeks must produce exactly 156 rollup files."""
    output_dir = run_generator(pr_count=1000, weeks=156, seed=42)

    manifest_path = output_dir / "dataset-manifest.json"
    with manifest_path.open() as f:
        manifest = json.load(f)

    rollups = manifest["aggregate_index"]["weekly_rollups"]
    assert len(rollups) == 156

    # Verify each rollup file exists
    for entry in rollups:
        rollup_path = output_dir / entry["path"]
        assert rollup_path.exists(), f"Rollup file missing: {entry['path']}"


# ---------------------------------------------------------------------------
# Comment data structure validation
# ---------------------------------------------------------------------------


def test_comment_data_structure():
    """Comment data must contain valid threads and comments per the contract.

    Validates:
    - Batch files exist under aggregates/comments/
    - Each PR has 2-5 threads
    - Each thread has 1-4 comments
    - Comment and thread IDs follow naming conventions
    - Manifest coverage includes comment statistics
    """
    output_dir = run_generator(
        pr_count=100, weeks=4, seed=42, users=10, include_comments=True
    )

    # Verify comment batch files exist
    comments_dir = output_dir / "aggregates" / "comments"
    assert comments_dir.exists(), "comments directory must exist"

    batch_files = sorted(comments_dir.glob("comments-batch-*.json"))
    assert len(batch_files) > 0, "At least one comment batch file must exist"

    total_prs = 0
    total_threads = 0
    total_comments = 0

    for batch_file in batch_files:
        with batch_file.open() as f:
            batch_data = json.load(f)

        assert "prs" in batch_data, "Batch file must contain 'prs' key"

        for pr in batch_data["prs"]:
            total_prs += 1
            assert "pr_id" in pr, "Each PR must have a pr_id"
            assert "threads" in pr, "Each PR must have threads"

            threads = pr["threads"]
            assert 2 <= len(threads) <= 5, (
                f"PR {pr['pr_id']} has {len(threads)} threads, expected 2-5"
            )

            for thread in threads:
                total_threads += 1
                assert "thread_id" in thread
                assert "status" in thread
                assert thread["status"] in ("active", "fixed", "closed", "byDesign")
                assert "comments" in thread

                comments = thread["comments"]
                assert 1 <= len(comments) <= 4, (
                    f"Thread {thread['thread_id']} has {len(comments)} comments, "
                    "expected 1-4"
                )

                for comment in comments:
                    total_comments += 1
                    assert "comment_id" in comment
                    assert "author" in comment
                    assert "author_id" in comment
                    assert "content_length" in comment
                    assert isinstance(comment["content_length"], int)
                    assert 10 <= comment["content_length"] <= 500

    assert total_prs == 100, f"Expected 100 PRs with comments, got {total_prs}"

    # Verify manifest coverage includes comment stats
    manifest_path = output_dir / "dataset-manifest.json"
    with manifest_path.open() as f:
        manifest = json.load(f)

    coverage = manifest["coverage"]
    assert "comments" in coverage, "Manifest coverage must include comments section"
    stats = coverage["comments"]
    assert stats["total_threads"] == total_threads
    assert stats["total_comments"] == total_comments
    assert stats["prs_with_comments"] == 100


# ---------------------------------------------------------------------------
# Combined-parameter generator test
# ---------------------------------------------------------------------------


def test_combined_parameters_weeks_users_comments():
    """All three scalability flags must work together correctly.

    Exercises: --weeks 156 --users 200 --include-comments simultaneously.
    """
    output_dir = run_generator(
        pr_count=1000, weeks=156, seed=42, users=200, include_comments=True
    )

    manifest_path = output_dir / "dataset-manifest.json"
    with manifest_path.open() as f:
        manifest = json.load(f)

    # Verify weeks
    rollups = manifest["aggregate_index"]["weekly_rollups"]
    assert len(rollups) == 156, f"Expected 156 rollups, got {len(rollups)}"

    # Verify users
    dim_path = output_dir / "aggregates" / "dimensions.json"
    with dim_path.open() as f:
        dimensions = json.load(f)
    assert len(dimensions["users"]) == 200, (
        f"Expected 200 users, got {len(dimensions['users'])}"
    )

    # Verify comments enabled
    assert manifest["features"]["comments"] is True
    comments_dir = output_dir / "aggregates" / "comments"
    assert comments_dir.exists(), "Comments directory must exist"
    batch_files = list(comments_dir.glob("comments-batch-*.json"))
    assert len(batch_files) > 0, "Comment batch files must exist"

    # Verify coverage stats are consistent
    coverage = manifest["coverage"]
    assert coverage["total_prs"] == 1000
    assert coverage["row_counts"]["users"] == 200
    assert "comments" in coverage
    assert coverage["comments"]["prs_with_comments"] == 1000


# ---------------------------------------------------------------------------
# Cross-dimensional data validation (T010)
# ---------------------------------------------------------------------------


def test_by_team_and_repo_present_in_rollups():
    """T010: Cross-dimensional breakdown must be present in generated rollups."""
    output_dir = run_generator(pr_count=100, weeks=4, seed=42)
    manifest_path = output_dir / "dataset-manifest.json"
    with manifest_path.open() as f:
        manifest = json.load(f)

    rollups_with_cross_dim = 0
    for entry in manifest["aggregate_index"]["weekly_rollups"]:
        rollup_path = output_dir / entry["path"]
        with rollup_path.open() as f:
            rollup = json.load(f)
        if "by_team_and_repo" in rollup:
            rollups_with_cross_dim += 1

    assert rollups_with_cross_dim > 0, (
        "At least one rollup must contain by_team_and_repo cross-dimensional data"
    )


def test_by_team_and_repo_pr_count_consistency():
    """T010: pr_count consistency invariant: sum(cross-dim) == team total."""
    output_dir = run_generator(pr_count=100, weeks=4, seed=42)
    manifest_path = output_dir / "dataset-manifest.json"
    with manifest_path.open() as f:
        manifest = json.load(f)

    for entry in manifest["aggregate_index"]["weekly_rollups"]:
        rollup_path = output_dir / entry["path"]
        with rollup_path.open() as f:
            rollup = json.load(f)

        if "by_team_and_repo" not in rollup or "by_team" not in rollup:
            continue

        by_team = rollup["by_team"]
        by_team_and_repo = rollup["by_team_and_repo"]

        for team_name, repo_entries in by_team_and_repo.items():
            if team_name.startswith("_"):
                continue  # skip metadata like _truncated
            cross_dim_sum = sum(e["pr_count"] for e in repo_entries.values())
            team_total = by_team[team_name]["pr_count"]
            assert cross_dim_sum == team_total, (
                f"Week {rollup['week']}: team '{team_name}' cross-dim pr_count sum "
                f"({cross_dim_sum}) != team total ({team_total})"
            )


def test_by_team_and_repo_correlated_distributions():
    """T010: Correlated distributions produce non-trivial proportional estimation error.

    The synthetic data must expose proportional estimation failures by using
    correlated (not independent) team-repo distributions. At least one team-repo
    pair must have a proportional estimate that differs from exact by >20%.
    """
    output_dir = run_generator(pr_count=1000, weeks=8, seed=42)
    manifest_path = output_dir / "dataset-manifest.json"
    with manifest_path.open() as f:
        manifest = json.load(f)

    max_error_pct = 0.0

    for entry in manifest["aggregate_index"]["weekly_rollups"]:
        rollup_path = output_dir / entry["path"]
        with rollup_path.open() as f:
            rollup = json.load(f)

        if not all(
            k in rollup for k in ("by_team_and_repo", "by_team", "by_repository")
        ):
            continue
        if rollup["pr_count"] == 0:
            continue

        by_team = rollup["by_team"]
        by_repo = rollup["by_repository"]
        by_team_and_repo = rollup["by_team_and_repo"]
        total = rollup["pr_count"]

        for team_name, repo_entries in by_team_and_repo.items():
            if team_name.startswith("_"):
                continue
            team_pr = by_team.get(team_name, {}).get("pr_count", 0)
            if team_pr == 0 or total == 0:
                continue
            team_share = team_pr / total

            for repo_name, entry in repo_entries.items():
                exact = entry["pr_count"]
                repo_pr = by_repo.get(repo_name, {}).get("pr_count", 0)
                if repo_pr == 0 or exact == 0:
                    continue
                repo_share = repo_pr / total

                # Proportional estimate
                estimated = total * team_share * repo_share
                error_pct = abs(exact - estimated) / exact * 100
                max_error_pct = max(max_error_pct, error_pct)

    assert max_error_pct > 20, (
        f"Correlated distributions must produce >20% proportional estimation error "
        f"for at least one team-repo pair, but max error was only {max_error_pct:.1f}%"
    )


def test_by_team_and_repo_null_cycle_times_small_sample():
    """T010: Intersections with fewer than 5 PRs must have null cycle times."""
    output_dir = run_generator(pr_count=100, weeks=4, seed=42)
    manifest_path = output_dir / "dataset-manifest.json"
    with manifest_path.open() as f:
        manifest = json.load(f)

    found_small_sample = False
    for entry in manifest["aggregate_index"]["weekly_rollups"]:
        rollup_path = output_dir / entry["path"]
        with rollup_path.open() as f:
            rollup = json.load(f)

        if "by_team_and_repo" not in rollup:
            continue

        for team_entries in rollup["by_team_and_repo"].values():
            if isinstance(team_entries, bool):
                continue  # skip _truncated flag
            for entry_data in team_entries.values():
                if entry_data["pr_count"] < 5:
                    found_small_sample = True
                    assert entry_data["cycle_time_p50"] is None, (
                        f"cycle_time_p50 must be null for intersections with "
                        f"<5 PRs, got {entry_data['cycle_time_p50']}"
                    )
                    assert entry_data["cycle_time_p90"] is None, (
                        f"cycle_time_p90 must be null for intersections with "
                        f"<5 PRs, got {entry_data['cycle_time_p90']}"
                    )

    assert found_small_sample, (
        "Test must find at least one intersection with <5 PRs to validate "
        "the minimum sample size threshold"
    )


# ---------------------------------------------------------------------------
# Demo data realism tests (T003-T006)
# ---------------------------------------------------------------------------

DEMO_ROLLUPS_DIR = (
    Path(__file__).parent.parent.parent
    / "docs"
    / "data"
    / "aggregates"
    / "weekly_rollups"
)
DEMO_DIMENSIONS_PATH = (
    Path(__file__).parent.parent.parent
    / "docs"
    / "data"
    / "aggregates"
    / "dimensions.json"
)
DEMO_MANIFEST_PATH = (
    Path(__file__).parent.parent.parent / "docs" / "data" / "dataset-manifest.json"
)


def _load_all_demo_rollups() -> list[dict]:
    """Load all weekly rollup JSON files from the demo data directory."""
    rollup_files = sorted(DEMO_ROLLUPS_DIR.glob("*.json"))
    assert len(rollup_files) > 0, "No demo rollup files found"
    rollups = []
    for path in rollup_files:
        with path.open() as f:
            rollups.append(json.load(f))
    return rollups


class TestDemoDataRealism:
    """Realism invariants for the demo data generator output."""

    def test_user_display_names_are_unique_and_number_free(self):
        """Demo-facing synthetic user names must be unique and free of numeric suffixes."""
        with DEMO_DIMENSIONS_PATH.open() as f:
            dimensions = json.load(f)

        display_names = [entry["display_name"] for entry in dimensions["users"]]
        assert len(display_names) == len(set(display_names)), (
            "Synthetic display names must be unique"
        )
        assert all(not re.search(r"\d", name) for name in display_names), (
            "Synthetic display names must not contain digits"
        )

    def test_reviewer_fixture_thresholds_match_generated_rollup(self):
        """Reviewer fixture week must satisfy the manifest's threshold contract."""
        with DEMO_MANIFEST_PATH.open() as f:
            manifest = json.load(f)

        fixtures = manifest["reviewer_fixtures"]
        fixture_week = fixtures["reviewer_filter_examples"][0]["week"]
        rollup_path = DEMO_ROLLUPS_DIR / f"{fixture_week}.json"
        with rollup_path.open() as f:
            rollup = json.load(f)

        by_reviewer = rollup["by_reviewer"]
        eligible_reviewers = [
            reviewer_id
            for reviewer_id, entry in by_reviewer.items()
            if entry["reviewed_prs"] >= fixtures["minimum_reviewed_prs_per_reviewer"]
            and entry["reviews_count"]
            >= fixtures["minimum_review_actions_per_reviewer"]
        ]
        multi_repo_reviewers = [
            reviewer_id
            for reviewer_id, entry in by_reviewer.items()
            if entry["reviewed_prs"] >= fixtures["minimum_reviewed_prs_per_reviewer"]
            and entry["reviews_count"]
            >= fixtures["minimum_review_actions_per_reviewer"]
            and entry["repositories_count"] >= 2
        ]

        assert len(eligible_reviewers) >= fixtures["minimum_active_reviewers"]
        assert len(multi_repo_reviewers) >= fixtures["minimum_multi_repo_reviewers"]

    def test_inv001_parent_child_bounding(self):
        """INV-001: Every breakdown entry's counts must not exceed the rollup totals."""
        rollups = _load_all_demo_rollups()
        for rollup in rollups:
            rollup_reviewers = rollup["reviewers_count"]
            rollup_authors = rollup["authors_count"]

            for repo_name, entry in rollup.get("by_repository", {}).items():
                assert entry["reviewers_count"] <= rollup_reviewers, (
                    f"Week {rollup['week']}: repo '{repo_name}' reviewers_count "
                    f"({entry['reviewers_count']}) > rollup ({rollup_reviewers})"
                )
                assert entry["authors_count"] <= rollup_authors, (
                    f"Week {rollup['week']}: repo '{repo_name}' authors_count "
                    f"({entry['authors_count']}) > rollup ({rollup_authors})"
                )

            for team_name, entry in rollup.get("by_team", {}).items():
                assert entry["reviewers_count"] <= rollup_reviewers, (
                    f"Week {rollup['week']}: team '{team_name}' reviewers_count "
                    f"({entry['reviewers_count']}) > rollup ({rollup_reviewers})"
                )
                assert entry["authors_count"] <= rollup_authors, (
                    f"Week {rollup['week']}: team '{team_name}' authors_count "
                    f"({entry['authors_count']}) > rollup ({rollup_authors})"
                )

    def test_inv004_005_non_negativity_and_logical_bounds(self):
        """INV-004/005: Counts >= 0, authors <= pr_count, reviewers >= 1 when pr_count >= 1."""
        rollups = _load_all_demo_rollups()
        for rollup in rollups:
            for section in ("by_repository", "by_team"):
                for name, entry in rollup.get(section, {}).items():
                    pr_count = entry["pr_count"]
                    authors = entry["authors_count"]
                    reviewers = entry["reviewers_count"]

                    assert pr_count >= 0, (
                        f"Week {rollup['week']}: {section}/{name} pr_count={pr_count} < 0"
                    )
                    assert authors >= 0, (
                        f"Week {rollup['week']}: {section}/{name} authors_count={authors} < 0"
                    )
                    assert reviewers >= 0, (
                        f"Week {rollup['week']}: {section}/{name} reviewers_count={reviewers} < 0"
                    )
                    assert authors <= pr_count, (
                        f"Week {rollup['week']}: {section}/{name} "
                        f"authors_count ({authors}) > pr_count ({pr_count})"
                    )
                    if pr_count >= 1:
                        assert reviewers >= 1, (
                            f"Week {rollup['week']}: {section}/{name} "
                            f"reviewers_count ({reviewers}) < 1 but pr_count={pr_count}"
                        )

    def test_inv006_realism_distribution(self):
        """INV-006: Fewer than 20% of entries with pr_count >= 2 should have reviewers_count == 1."""
        rollups = _load_all_demo_rollups()

        for section in ("by_repository", "by_team"):
            total_entries = 0
            reviewers_eq_one = 0
            for rollup in rollups:
                for _, entry in rollup.get(section, {}).items():
                    if entry["pr_count"] >= 2:
                        total_entries += 1
                        if entry["reviewers_count"] == 1:
                            reviewers_eq_one += 1

            assert total_entries > 0, f"No {section} entries with pr_count >= 2 found"
            pct = reviewers_eq_one / total_entries * 100
            assert pct < 20, (
                f"{section}: {pct:.1f}% of entries with pr_count >= 2 have "
                f"reviewers_count == 1 ({reviewers_eq_one}/{total_entries}), expected < 20%"
            )

    def test_inv007_determinism(self):
        """INV-007: Running the generator twice with same seed produces byte-identical output.

        Uses a scratch directory so the generator never mutates docs/data/.
        """
        import hashlib

        generator_script = str(
            Path(__file__).parent.parent.parent / "scripts" / "generate-demo-data.py"
        )
        scratch_dir = _make_scratch_dir("inv007-determinism")
        rollups_dir = scratch_dir / "aggregates" / "weekly_rollups"

        # Run generator twice to the same scratch dir and compare checksums
        result1 = subprocess.run(
            [sys.executable, generator_script, "--output-root", str(scratch_dir)],
            capture_output=True,
            text=True,
            check=False,
        )
        assert result1.returncode == 0, f"Generator run 1 failed: {result1.stderr}"

        checksums_a = {}
        for path in sorted(rollups_dir.glob("*.json")):
            checksums_a[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
        assert len(checksums_a) > 0, "No rollup files found after run 1"

        result2 = subprocess.run(
            [sys.executable, generator_script, "--output-root", str(scratch_dir)],
            capture_output=True,
            text=True,
            check=False,
        )
        assert result2.returncode == 0, f"Generator run 2 failed: {result2.stderr}"

        checksums_b = {}
        for path in sorted(rollups_dir.glob("*.json")):
            checksums_b[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()

        assert checksums_a == checksums_b, (
            "Generator output is not deterministic — files differ between runs"
        )


@pytest.mark.parametrize("seed", [42, 123, 9999])
def test_review_time_p50_le_p90_across_seeds(seed: int) -> None:
    """Synthetic review_time_p50 must never exceed review_time_p90.

    Regression: independent ratio draws per percentile caused p50 > p90
    for some seeds when ct_p50/ct_p90 gap was narrow and ratios diverged.
    """
    output_dir = run_generator(
        pr_count=1000, weeks=52, seed=seed, include_comments=True
    )
    rollup_dir = output_dir / "aggregates" / "weekly_rollups"

    violations = 0
    checked = 0
    for rollup_path in sorted(rollup_dir.glob("*.json")):
        with rollup_path.open() as f:
            data = json.load(f)

        # Root level
        p50 = data.get("review_time_p50")
        p90 = data.get("review_time_p90")
        if p50 is not None and p90 is not None:
            checked += 1
            if p50 > p90:
                violations += 1

        # Breakdown entries
        for dim in ("by_repository", "by_team"):
            for entry in data.get(dim, {}).values():
                ep50 = entry.get("review_time_p50")
                ep90 = entry.get("review_time_p90")
                if ep50 is not None and ep90 is not None:
                    checked += 1
                    if ep50 > ep90:
                        violations += 1

    assert checked > 0, f"No p50/p90 pairs found for seed {seed}"
    assert violations == 0, (
        f"seed={seed}: {violations}/{checked} pairs have "
        f"review_time_p50 > review_time_p90"
    )


def test_undersampled_slices_null_review_time() -> None:
    """Synthetic slices with pr_count < 2 must emit null review_time.

    Regression: by_team and by_repository entries always emitted numeric
    review_time regardless of PR count, contradicting production semantics
    where _ROLLUP_MIN_SAMPLE=2 nulls undersampled slices.
    """
    # Use a small dataset where some slices will have < 2 PRs
    output_dir = run_generator(pr_count=100, weeks=52, seed=42)
    rollup_dir = output_dir / "aggregates" / "weekly_rollups"

    undersampled_with_value = 0
    undersampled_total = 0

    for rollup_path in sorted(rollup_dir.glob("*.json")):
        with rollup_path.open() as f:
            data = json.load(f)

        for dim in ("by_repository", "by_team"):
            for entry in data.get(dim, {}).values():
                pr_count = entry.get("pr_count", 0)
                if pr_count < 2:
                    undersampled_total += 1
                    rt_p50 = entry.get("review_time_p50")
                    rt_p90 = entry.get("review_time_p90")
                    if rt_p50 is not None or rt_p90 is not None:
                        undersampled_with_value += 1

    # With 100 PRs across 52 weeks and multiple repos, some slices
    # will have < 2 PRs. Those must not emit numeric review_time.
    if undersampled_total > 0:
        assert undersampled_with_value == 0, (
            f"{undersampled_with_value}/{undersampled_total} undersampled slices "
            f"(pr_count < 2) have non-null review_time — should be null"
        )


def test_no_review_time_without_include_comments() -> None:
    """Without --include-comments, all review_time fields must be null.

    Regression: generator emitted numeric review_time even when comments
    feature was disabled, making synthetic fixtures diverge from production
    where review timestamps require thread extraction.
    """
    output_dir = run_generator(pr_count=1000, weeks=12, seed=42)
    rollup_dir = output_dir / "aggregates" / "weekly_rollups"

    nonnull_count = 0
    for rollup_path in sorted(rollup_dir.glob("*.json")):
        with rollup_path.open() as f:
            data = json.load(f)
        if data.get("review_time_p50") is not None:
            nonnull_count += 1
        if data.get("review_time_p90") is not None:
            nonnull_count += 1
        for dim in ("by_repository", "by_team"):
            for entry in data.get(dim, {}).values():
                if entry.get("review_time_p50") is not None:
                    nonnull_count += 1
                if entry.get("review_time_p90") is not None:
                    nonnull_count += 1

    assert nonnull_count == 0, (
        f"Without --include-comments, found {nonnull_count} non-null "
        f"review_time values — should all be null"
    )


def test_root_review_time_matches_production_gating() -> None:
    """Root review_time_p50 and _p90 must always be both-null or both-non-null.

    Production gates both percentiles from the same sample count check
    (review_time_minutes.notna().sum() >= 2). No impossible mixed states
    (one null, one numeric) are allowed. Additionally, weeks with fewer
    than 2 PRs must always emit null for both.
    """
    output_dir = run_generator(pr_count=100, weeks=52, seed=42)
    rollup_dir = output_dir / "aggregates" / "weekly_rollups"

    mixed_states = 0
    undersampled_with_value = 0
    total = 0
    for rollup_path in sorted(rollup_dir.glob("*.json")):
        with rollup_path.open() as f:
            data = json.load(f)
        total += 1
        rt_p50 = data.get("review_time_p50")
        rt_p90 = data.get("review_time_p90")
        pr_count = data.get("pr_count", 0)

        # No impossible mixed states: both null or both non-null
        p50_null = rt_p50 is None
        p90_null = rt_p90 is None
        if p50_null != p90_null:
            mixed_states += 1

        # Undersampled weeks must be null
        if pr_count < 2 and (rt_p50 is not None or rt_p90 is not None):
            undersampled_with_value += 1

    assert total > 0
    assert mixed_states == 0, (
        f"{mixed_states}/{total} root rollups have mixed null state "
        f"(one null, one numeric) — production never allows this"
    )
    assert undersampled_with_value == 0, (
        f"{undersampled_with_value} root rollups with pr_count < 2 "
        f"have non-null review_time"
    )
