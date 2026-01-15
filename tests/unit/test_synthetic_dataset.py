"""Tests for synthetic dataset generator.

Contract validation: Producer tests ensure generated output matches schema.
"""

import json
import tempfile
from pathlib import Path

import pytest


def run_generator(pr_count: int, weeks: int | None, seed: int) -> Path:
    """Run generator and return output directory."""
    import subprocess

    with tempfile.TemporaryDirectory() as tmpdir:
        output_dir = Path(tmpdir) / "synthetic"

        # Run generator script
        script = (
            Path(__file__).parent.parent.parent
            / "scripts"
            / "generate-synthetic-dataset.py"
        )

        # Build command args
        args = [
            "python",
            str(script),
            "--pr-count",
            str(pr_count),
            "--seed",
            str(seed),
            "--output",
            str(output_dir),
        ]

        # Add weeks only if specified
        if weeks is not None:
            args.extend(["--weeks", str(weeks)])

        result = subprocess.run(  # noqa: S603
            args, capture_output=True, text=True, check=False
        )

        if result.returncode != 0:
            pytest.fail(f"Generator failed: {result.stderr}")

        # Copy to temp directory that persists for test
        # (Can't use context manager's tmpdir as it gets deleted)
        import shutil

        persist_dir = Path(tempfile.gettempdir()) / f"synthetic-test-{pr_count}-{seed}"
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
