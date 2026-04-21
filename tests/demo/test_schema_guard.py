"""Schema completeness guard tests (Contract 1, SC-005).

Reads field names from the canonical TypeScript schema (rollup.schema.ts)
and verifies that generated demo data contains all non-deprecated fields.
No duplicate field list is maintained — this test reads from the single
source of truth per Contract 1.

TestAggregatesVersionParity (added in 052-review-time-pipeline) ensures
the Python AGGREGATES_SCHEMA_VERSION constant matches the TS validators
in both dataset-loader.ts and artifact-client.ts.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from ado_git_repo_insights.transform.schema_versions import AGGREGATES_SCHEMA_VERSION

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
DEPRECATED_FIELDS: set[str] = set()
# review_time_p50 and review_time_p90 removed — now produced by demo
# generators as of 052-review-time-pipeline.
OPTIONAL_ROOT_FIELDS = {"by_reviewer"}
# Feature 309 (#315): these PR-level detail fields are emitted by the
# synthetic demo via the provenance-based binary gate in `promote_data`
# (docs/reference/dataset-contract.md + specs/309-demo-pr-drilldown/
# contracts/demo-strip-gate-v2.md). On non-empty weeks they MUST be
# PRESENT (synthetic records preserved through promotion). The schema-
# guard completeness check excludes them because their presence is
# enforced by test_synthetic_demo_has_prs below instead.
DEMO_REQUIRED_ROOT_FIELDS = {"prs", "_prs_truncated", "_prs_cap"}


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
        expected = (
            known_root
            - DEPRECATED_FIELDS
            - OPTIONAL_ROOT_FIELDS
            - DEMO_REQUIRED_ROOT_FIELDS
        )
        actual = set(sample_rollup.keys())

        missing = expected - actual
        assert not missing, (
            f"Missing root fields in demo rollup: {sorted(missing)}. "
            f"Expected: {sorted(expected)}, Got: {sorted(actual)}"
        )

    def test_synthetic_demo_has_prs(self, sample_rollup):
        """Feature 309 provenance-based gate: PR-level detail fields MUST be
        PRESENT on any non-empty-week rollup after promotion. The synthetic
        generator emits them; the binary gate preserves them through
        promote_data on sentinel-present source; sentinel-absent source
        falls back to the legacy strip helper (for tenant data). See
        `specs/309-demo-pr-drilldown/contracts/demo-strip-gate-v2.md`.
        """
        pr_count = sample_rollup.get("pr_count", 0)
        keys = set(sample_rollup.keys())
        if pr_count > 0:
            missing = DEMO_REQUIRED_ROOT_FIELDS - keys
            assert not missing, (
                "Synthetic PR-level detail missing from non-empty demo rollup: "
                f"{sorted(missing)}. If this fails, the promote_data binary "
                "gate or the generator emission loop regressed."
            )
            assert sample_rollup["_prs_cap"] == 500, (
                f"_prs_cap must be 500; got {sample_rollup['_prs_cap']!r}"
            )
            prs = sample_rollup["prs"]
            assert isinstance(prs, list), "prs must be a list"
            assert prs, "prs must be non-empty on non-empty weeks"
        # Empty-week weeks MAY have the keys absent OR present with len(prs)==0;
        # the shape helper (assert_synthetic_shape) enforces the union contract.


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


REPO_ROOT = Path(__file__).parent.parent.parent
DATASET_LOADER_TS = REPO_ROOT / "extension" / "ui" / "dataset-loader.ts"
ARTIFACT_CLIENT_TS = REPO_ROOT / "extension" / "ui" / "artifact-client.ts"


def _extract_ts_supported_version(ts_path: Path) -> int:
    """Extract SUPPORTED_AGGREGATES_VERSION from a TypeScript source file."""
    source = ts_path.read_text(encoding="utf-8")
    match = re.search(r"SUPPORTED_AGGREGATES_VERSION\s*=\s*(\d+)", source)
    assert match, f"SUPPORTED_AGGREGATES_VERSION not found in {ts_path.name}"
    return int(match.group(1))


class TestAggregatesVersionParity:
    """Backend AGGREGATES_SCHEMA_VERSION must match extension validators.

    Prevents drift where Python emits a version that the extension rejects.
    """

    def test_dataset_loader_accepts_current_version(self) -> None:
        ts_version = _extract_ts_supported_version(DATASET_LOADER_TS)
        assert ts_version >= AGGREGATES_SCHEMA_VERSION, (
            f"dataset-loader.ts SUPPORTED_AGGREGATES_VERSION={ts_version} "
            f"< Python AGGREGATES_SCHEMA_VERSION={AGGREGATES_SCHEMA_VERSION}. "
            f"Extension will reject newly generated manifests."
        )

    def test_artifact_client_accepts_current_version(self) -> None:
        ts_version = _extract_ts_supported_version(ARTIFACT_CLIENT_TS)
        assert ts_version >= AGGREGATES_SCHEMA_VERSION, (
            f"artifact-client.ts SUPPORTED_AGGREGATES_VERSION={ts_version} "
            f"< Python AGGREGATES_SCHEMA_VERSION={AGGREGATES_SCHEMA_VERSION}. "
            f"Extension will reject newly generated manifests."
        )
