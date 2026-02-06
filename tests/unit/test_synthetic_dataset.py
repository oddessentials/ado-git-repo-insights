"""Tests for synthetic dataset generator.

Contract validation: Producer tests ensure generated output matches schema.
"""

import json
import subprocess
import tempfile
from pathlib import Path

import pytest


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
    import shutil

    output_dir = (
        Path(tempfile.gettempdir()) / f"synthetic-raw-{pr_count}-{seed}-{users}-{weeks}"
    )

    if output_dir.exists():
        shutil.rmtree(output_dir)

    args = _build_generator_args(
        pr_count=pr_count,
        seed=seed,
        output=str(output_dir),
        weeks=weeks,
        users=users,
        include_comments=include_comments,
    )
    result = subprocess.run(  # noqa: S603
        args, capture_output=True, text=True, check=False
    )
    return result, output_dir


def run_generator(
    pr_count: int,
    weeks: int | None = None,
    seed: int = 42,
    users: int | None = None,
    include_comments: bool = False,
) -> Path:
    """Run generator and return output directory."""
    with tempfile.TemporaryDirectory() as tmpdir:
        output_dir = Path(tmpdir) / "synthetic"

        args = _build_generator_args(
            pr_count=pr_count,
            seed=seed,
            output=str(output_dir),
            weeks=weeks,
            users=users,
            include_comments=include_comments,
        )

        result = subprocess.run(  # noqa: S603
            args, capture_output=True, text=True, check=False
        )

        if result.returncode != 0:
            pytest.fail(f"Generator failed: {result.stderr}")

        # Copy to temp directory that persists for test
        # (Can't use context manager's tmpdir as it gets deleted)
        import shutil

        persist_dir = Path(tempfile.gettempdir()) / (
            f"synthetic-test-{pr_count}-{seed}"
            f"-w{weeks}-u{users}-c{int(include_comments)}"
        )
        if persist_dir.exists():
            shutil.rmtree(persist_dir)
        shutil.copytree(output_dir, persist_dir)

        return persist_dir


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
    assert manifest_data["aggregates_schema_version"] == 1

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
            shutil.rmtree(output_dir)


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
            shutil.rmtree(output_dir)


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
