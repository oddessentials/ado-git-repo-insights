"""Schema completeness guard tests (Contract 1, SC-005).

Reads field names from the canonical TypeScript schema (rollup.schema.ts)
and verifies that generated demo data contains all non-deprecated fields.
No duplicate field list is maintained — this test reads from the single
source of truth per Contract 1.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

SCHEMA_FILE = (
    Path(__file__).parent.parent.parent
    / "extension"
    / "ui"
    / "schemas"
    / "rollup.schema.ts"
)
ROLLUPS_DIR = (
    Path(__file__).parent.parent.parent
    / "docs"
    / "data"
    / "aggregates"
    / "weekly_rollups"
)
MANIFEST_FILE = (
    Path(__file__).parent.parent.parent / "docs" / "data" / "dataset-manifest.json"
)
DATASET_LOADER_FILE = (
    Path(__file__).parent.parent.parent / "extension" / "ui" / "dataset-loader.ts"
)

# Fields that exist in the schema but are not generated (deprecated/forward-compat)
DEPRECATED_FIELDS = {"review_time_p50", "review_time_p90"}
OPTIONAL_ROOT_FIELDS = {"by_reviewer"}


def _extract_ts_set_fields(ts_source: str, set_name: str) -> set[str]:
    """Extract field names from a TypeScript `new Set([...])` declaration."""
    pattern = rf"{set_name}\s*=\s*new\s+Set\(\[\s*(.*?)\s*\]\)"
    match = re.search(pattern, ts_source, re.DOTALL)
    if not match:
        raise ValueError(f"Could not find {set_name} in schema source")
    fields_str = match.group(1)
    return set(re.findall(r'"(\w+)"', fields_str))


@pytest.fixture(scope="module")
def schema_source():
    """Read the canonical schema file."""
    assert SCHEMA_FILE.exists(), f"Schema file not found: {SCHEMA_FILE}"
    return SCHEMA_FILE.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def sample_rollup():
    """Load a sample rollup with enough data for field coverage."""
    rollup_files = sorted(ROLLUPS_DIR.glob("*.json"))
    assert rollup_files, "No rollup files found"
    # Pick a mid-range rollup (likely to have good coverage)
    mid_idx = len(rollup_files) // 2
    data = json.loads(rollup_files[mid_idx].read_text(encoding="utf-8"))
    return data


class TestRootFieldCompleteness:
    """Every non-deprecated field in KNOWN_ROOT_FIELDS appears in rollup."""

    def test_root_fields_present(self, schema_source, sample_rollup):
        known_root = _extract_ts_set_fields(schema_source, "KNOWN_ROOT_FIELDS")
        expected = known_root - DEPRECATED_FIELDS - OPTIONAL_ROOT_FIELDS
        actual = set(sample_rollup.keys())

        missing = expected - actual
        assert not missing, (
            f"Missing root fields in demo rollup: {sorted(missing)}. "
            f"Expected: {sorted(expected)}, Got: {sorted(actual)}"
        )


class TestBreakdownFieldCompleteness:
    """Every non-deprecated field in KNOWN_BREAKDOWN_FIELDS appears in breakdown entries."""

    def test_by_repository_fields(self, schema_source, sample_rollup):
        known_breakdown = _extract_ts_set_fields(
            schema_source, "KNOWN_BREAKDOWN_FIELDS"
        )
        expected = known_breakdown - DEPRECATED_FIELDS

        by_repo = sample_rollup.get("by_repository", {})
        assert by_repo, "No by_repository entries in sample rollup"

        # Check at least one repo has all fields
        for _repo, entry in by_repo.items():
            actual = set(entry.keys())
            missing = expected - actual
            if not missing:
                return  # Found a complete entry
        # If we get here, no entry had all fields
        # Report missing fields from first entry
        first_entry = next(iter(by_repo.values()))
        missing = expected - set(first_entry.keys())
        pytest.fail(f"Missing breakdown fields in by_repository: {sorted(missing)}")

    def test_by_team_and_repo_fields(self, schema_source, sample_rollup):
        known_breakdown = _extract_ts_set_fields(
            schema_source, "KNOWN_BREAKDOWN_FIELDS"
        )
        expected = known_breakdown - DEPRECATED_FIELDS

        btar = sample_rollup.get("by_team_and_repo", {})
        assert btar, "No by_team_and_repo entries in sample rollup"

        # Check at least one team-repo entry has all fields
        for _team, repos in btar.items():
            for _repo, entry in repos.items():
                actual = set(entry.keys())
                missing = expected - actual
                if not missing:
                    return
        # Report first missing
        first_team = next(iter(btar.values()))
        first_entry = next(iter(first_team.values()))
        missing = expected - set(first_entry.keys())
        pytest.fail(f"Missing breakdown fields in by_team_and_repo: {sorted(missing)}")


class TestManifestSchemaVersion:
    """Manifest aggregates_schema_version matches dashboard expectation."""

    def test_manifest_version(self):
        assert MANIFEST_FILE.exists(), f"Manifest not found: {MANIFEST_FILE}"
        manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
        manifest_version = manifest.get("aggregates_schema_version")

        # Extract SUPPORTED_AGGREGATES_VERSION from dataset-loader.ts
        assert DATASET_LOADER_FILE.exists(), (
            f"Dataset loader not found: {DATASET_LOADER_FILE}"
        )
        loader_source = DATASET_LOADER_FILE.read_text(encoding="utf-8")
        match = re.search(r"SUPPORTED_AGGREGATES_VERSION\s*=\s*(\d+)", loader_source)
        assert match, "Could not find SUPPORTED_AGGREGATES_VERSION in dataset-loader.ts"
        expected_version = int(match.group(1))

        assert manifest_version == expected_version, (
            f"Manifest aggregates_schema_version={manifest_version} "
            f"!= dashboard SUPPORTED_AGGREGATES_VERSION={expected_version}"
        )

    def test_cross_dimensional_feature(self):
        manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
        features = manifest.get("features", {})
        assert features.get("cross_dimensional") is True, (
            f"Manifest features.cross_dimensional should be True, got {features.get('cross_dimensional')}"
        )

    def test_reviewer_fixture_metadata_present(self):
        manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
        fixtures = manifest.get("reviewer_fixtures")

        assert isinstance(fixtures, dict), "Manifest must include reviewer_fixtures"
        required_fields = {
            "minimum_active_reviewers",
            "minimum_reviewed_prs_per_reviewer",
            "minimum_review_actions_per_reviewer",
            "minimum_multi_repo_reviewers",
            "reviewer_filter_examples",
            "reviewer_constrained_example",
            "reviewer_team_disallowed_example",
        }
        missing = required_fields - set(fixtures)
        assert not missing, (
            f"reviewer_fixtures missing required fields: {sorted(missing)}"
        )
