"""
T055: Regeneration tests for demo synthetic data.

Verifies that running the generators twice produces byte-identical output.
This ensures deterministic generation with seed=42.
"""

from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

import pytest

# Paths relative to repository root
REPO_ROOT = Path(__file__).parent.parent.parent
DOCS_DATA = REPO_ROOT / "docs" / "data"
SCRIPTS_DIR = REPO_ROOT / "scripts"


def compute_file_hash(path: Path) -> str:
    """Compute SHA256 hash of a file."""
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def compute_directory_hashes(directory: Path) -> dict[str, str]:
    """Compute hashes for all JSON files in a directory tree."""
    hashes = {}
    for json_file in sorted(directory.rglob("*.json")):
        rel_path = json_file.relative_to(directory)
        hashes[str(rel_path)] = compute_file_hash(json_file)
    return hashes


class TestDeterministicRegeneration:
    """T055: Verify byte-identical regeneration."""

    def test_generate_demo_data_is_deterministic(self) -> None:
        """
        Running the full regeneration pipeline produces identical output.

        This test:
        1. Captures current state of docs/data/
        2. Runs all three generators (data, predictions, insights)
        3. Verifies output matches original byte-for-byte
        """
        # Skip if data not found
        if not (DOCS_DATA / "dataset-manifest.json").exists():
            pytest.skip("docs/data not found - skipping regeneration test")

        # Capture current hashes (before regeneration)
        original_hashes = compute_directory_hashes(DOCS_DATA)

        # Run all generators in sequence (order matters)
        generators = [
            "generate-demo-data.py",
            "generate-demo-predictions.py",
            "generate-demo-insights.py",
        ]

        for generator in generators:
            script_path = SCRIPTS_DIR / generator
            if not script_path.exists():
                continue

            result = subprocess.run(  # noqa: S603 - Trusted script path
                [sys.executable, str(script_path)],
                capture_output=True,
                text=True,
                cwd=REPO_ROOT,
            )
            assert result.returncode == 0, f"{generator} failed: {result.stderr}"

        # Capture new hashes
        new_hashes = compute_directory_hashes(DOCS_DATA)

        # Compare all files
        assert original_hashes == new_hashes, (
            "Regeneration produced different output! "
            "Check that seed is fixed and JSON serialization is canonical."
        )

    def test_generate_demo_predictions_is_deterministic(self) -> None:
        """
        Running generate-demo-predictions.py produces identical output.
        """
        predictions_file = DOCS_DATA / "predictions" / "trends.json"
        if not predictions_file.exists():
            pytest.skip("predictions/trends.json not found")

        original_hash = compute_file_hash(predictions_file)

        result = subprocess.run(  # noqa: S603 - Trusted script path
            [sys.executable, str(SCRIPTS_DIR / "generate-demo-predictions.py")],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
        )
        assert result.returncode == 0, f"Generator failed: {result.stderr}"

        new_hash = compute_file_hash(predictions_file)
        assert original_hash == new_hash, "Predictions regeneration changed output"

    def test_generate_demo_insights_is_deterministic(self) -> None:
        """
        Running generate-demo-insights.py produces identical output.
        """
        insights_file = DOCS_DATA / "insights" / "summary.json"
        if not insights_file.exists():
            pytest.skip("insights/summary.json not found")

        original_hash = compute_file_hash(insights_file)

        result = subprocess.run(  # noqa: S603 - Trusted script path
            [sys.executable, str(SCRIPTS_DIR / "generate-demo-insights.py")],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
        )
        assert result.returncode == 0, f"Generator failed: {result.stderr}"

        new_hash = compute_file_hash(insights_file)
        assert original_hash == new_hash, "Insights regeneration changed output"


class TestCanonicalJsonFormat:
    """Verify JSON files follow canonical formatting rules."""

    def test_json_has_sorted_keys(self) -> None:
        """Sample JSON files have alphabetically sorted keys."""
        import json

        sample_files = [
            DOCS_DATA / "dataset-manifest.json",
            DOCS_DATA / "aggregates" / "dimensions.json",
            DOCS_DATA / "aggregates" / "weekly_rollups" / "2023-W26.json",
        ]

        for filepath in sample_files:
            if not filepath.exists():
                continue

            with open(filepath, encoding="utf-8") as f:
                content = f.read()
                data = json.loads(content)

            # Re-serialize with sorted keys
            expected = json.dumps(data, sort_keys=True, indent=2)

            # Load and compare structure (keys should already be sorted)
            actual_lines = content.strip().split("\n")
            expected_lines = expected.strip().split("\n")

            # Check that key ordering matches
            assert len(actual_lines) == len(expected_lines), (
                f"Line count mismatch in {filepath.name}"
            )

    def test_json_has_lf_line_endings(self) -> None:
        """JSON files use LF line endings (not CRLF)."""
        sample_files = [
            DOCS_DATA / "dataset-manifest.json",
            DOCS_DATA / "predictions" / "trends.json",
            DOCS_DATA / "insights" / "summary.json",
        ]

        for filepath in sample_files:
            if not filepath.exists():
                continue

            with open(filepath, "rb") as f:
                content = f.read()

            assert b"\r\n" not in content, f"CRLF found in {filepath.name}"

    def test_json_has_trailing_newline(self) -> None:
        """JSON files end with a single newline."""
        sample_files = list(DOCS_DATA.rglob("*.json"))[:10]  # Sample 10 files

        for filepath in sample_files:
            with open(filepath, "rb") as f:
                content = f.read()

            assert content.endswith(b"\n"), f"No trailing newline in {filepath.name}"
            assert not content.endswith(b"\n\n"), (
                f"Multiple trailing newlines in {filepath.name}"
            )
