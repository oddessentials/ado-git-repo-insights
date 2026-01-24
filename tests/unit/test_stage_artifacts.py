"""Unit tests for stage-artifacts command.

Tests cover:
1. Deterministic build selection by finishTime
2. Accept succeeded and partiallySucceeded builds
3. Layout normalization (nested → flat)
4. Contract validation (fail-fast on violations)
5. Required artifact enforcement
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from ado_git_repo_insights.cli import (
    _normalize_artifact_layout,
    _validate_staged_artifacts,
)

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def staged_fixture(tmp_path: Path) -> Path:
    """Copy the valid staged_artifacts fixture to a temp directory."""
    fixture_src = Path(__file__).parent.parent / "fixtures" / "staged_artifacts"
    dest = tmp_path / "staged"
    shutil.copytree(fixture_src, dest)
    return dest


@pytest.fixture
def nested_fixture(tmp_path: Path) -> Path:
    """Copy the nested_artifacts fixture to a temp directory."""
    fixture_src = Path(__file__).parent.parent / "fixtures" / "nested_artifacts"
    dest = tmp_path / "nested"
    shutil.copytree(fixture_src, dest)
    return dest


# =============================================================================
# Build Selection Tests
# =============================================================================


class TestBuildSelection:
    """Tests for deterministic build selection logic."""

    def test_selects_most_recent_by_finish_time(self) -> None:
        """Always select build with latest finishTime, not API order."""
        # Simulate builds returned in arbitrary API order
        builds = [
            {"id": 100, "result": "succeeded", "finishTime": "2026-01-20T10:00:00Z"},
            {"id": 102, "result": "succeeded", "finishTime": "2026-01-22T10:00:00Z"},
            {"id": 101, "result": "succeeded", "finishTime": "2026-01-21T10:00:00Z"},
        ]

        # Apply the same logic as cmd_stage_artifacts
        eligible_results = ("succeeded", "partiallySucceeded")
        eligible = [b for b in builds if b.get("result") in eligible_results]
        eligible.sort(key=lambda b: b.get("finishTime", ""), reverse=True)

        selected = eligible[0]

        # Must select build 102 (most recent by finishTime)
        assert selected["id"] == 102
        assert selected["finishTime"] == "2026-01-22T10:00:00Z"

    def test_accepts_partially_succeeded_builds(self) -> None:
        """partiallySucceeded builds are eligible for staging."""
        builds = [
            {
                "id": 100,
                "result": "partiallySucceeded",
                "finishTime": "2026-01-22T10:00:00Z",
            },
            {"id": 99, "result": "succeeded", "finishTime": "2026-01-21T10:00:00Z"},
        ]

        eligible_results = ("succeeded", "partiallySucceeded")
        eligible = [b for b in builds if b.get("result") in eligible_results]
        eligible.sort(key=lambda b: b.get("finishTime", ""), reverse=True)

        selected = eligible[0]

        # partiallySucceeded build should be selected (most recent)
        assert selected["id"] == 100
        assert selected["result"] == "partiallySucceeded"

    def test_rejects_failed_and_canceled_builds(self) -> None:
        """failed and canceled builds are not eligible."""
        builds = [
            {"id": 103, "result": "failed", "finishTime": "2026-01-23T10:00:00Z"},
            {"id": 102, "result": "canceled", "finishTime": "2026-01-22T10:00:00Z"},
            {"id": 101, "result": "succeeded", "finishTime": "2026-01-21T10:00:00Z"},
        ]

        eligible_results = ("succeeded", "partiallySucceeded")
        eligible = [b for b in builds if b.get("result") in eligible_results]

        # Only the succeeded build should be eligible
        assert len(eligible) == 1
        assert eligible[0]["id"] == 101

    def test_deterministic_with_same_finish_time(self) -> None:
        """Selection is deterministic even if finishTime is identical."""
        builds = [
            {"id": 102, "result": "succeeded", "finishTime": "2026-01-22T10:00:00Z"},
            {"id": 101, "result": "succeeded", "finishTime": "2026-01-22T10:00:00Z"},
        ]

        eligible_results = ("succeeded", "partiallySucceeded")
        eligible = [b for b in builds if b.get("result") in eligible_results]
        eligible.sort(key=lambda b: b.get("finishTime", ""), reverse=True)

        # Result should be consistent across runs (stable sort)
        selected1 = eligible[0]

        # Run again
        eligible2 = [b for b in builds if b.get("result") in eligible_results]
        eligible2.sort(key=lambda b: b.get("finishTime", ""), reverse=True)
        selected2 = eligible2[0]

        assert selected1["id"] == selected2["id"]


# =============================================================================
# Layout Normalization Tests
# =============================================================================


class TestLayoutNormalization:
    """Tests for artifact layout normalization."""

    def test_flattens_nested_layout(self, nested_fixture: Path) -> None:
        """Transforms aggregates/aggregates → aggregates at root."""
        # Before: nested structure
        assert (nested_fixture / "aggregates" / "dataset-manifest.json").exists()
        assert (nested_fixture / "aggregates" / "aggregates").exists()

        # Normalize
        was_normalized = _normalize_artifact_layout(nested_fixture)

        # After: flat structure
        assert was_normalized is True
        assert (nested_fixture / "dataset-manifest.json").exists()
        assert (
            nested_fixture / "aggregates" / "weekly_rollups" / "2026-W01.json"
        ).exists()
        assert not (nested_fixture / "aggregates" / "aggregates").exists()

    def test_moves_manifest_to_root(self, nested_fixture: Path) -> None:
        """Manifest moved from aggregates/ to root."""
        _normalize_artifact_layout(nested_fixture)

        # Manifest should be at root
        root_manifest = nested_fixture / "dataset-manifest.json"
        assert root_manifest.exists()

        # Should be valid JSON
        manifest = json.loads(root_manifest.read_text())
        assert manifest["manifest_schema_version"] == 1

        # Should not be in aggregates folder
        assert not (nested_fixture / "aggregates" / "dataset-manifest.json").exists()

    def test_preserves_flat_layout(self, staged_fixture: Path) -> None:
        """Already-flat layout is unchanged."""
        # Record original state
        original_files = list(staged_fixture.rglob("*"))

        # Normalize (should be no-op)
        was_normalized = _normalize_artifact_layout(staged_fixture)

        # Should return False (no changes made)
        assert was_normalized is False

        # Files should be unchanged
        current_files = list(staged_fixture.rglob("*"))
        assert len(original_files) == len(current_files)

    def test_removes_empty_double_nested_folder(self, nested_fixture: Path) -> None:
        """Empty aggregates/aggregates folder is removed after flattening."""
        _normalize_artifact_layout(nested_fixture)

        # Double-nested folder should not exist
        double_nested = nested_fixture / "aggregates" / "aggregates"
        assert not double_nested.exists()


# =============================================================================
# Contract Validation Tests
# =============================================================================


class TestContractValidation:
    """Tests for CONTRACT.md enforcement."""

    def test_valid_layout_passes(self, staged_fixture: Path) -> None:
        """Valid flat layout passes validation."""
        is_valid, error, schema_version = _validate_staged_artifacts(staged_fixture)

        assert is_valid is True
        assert error == ""
        assert schema_version == 1

    def test_returns_schema_version(self, staged_fixture: Path) -> None:
        """Validation returns manifest schema version for auditing."""
        is_valid, error, schema_version = _validate_staged_artifacts(staged_fixture)

        assert schema_version == 1

    def test_missing_manifest_fails(self, tmp_path: Path) -> None:
        """Missing dataset-manifest.json fails fast."""
        # Create empty directory
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()

        is_valid, error, schema_version = _validate_staged_artifacts(empty_dir)

        assert is_valid is False
        assert "dataset-manifest.json not found" in error
        assert schema_version == 0

    def test_invalid_json_fails(self, tmp_path: Path) -> None:
        """Malformed manifest JSON fails fast."""
        bad_dir = tmp_path / "bad_json"
        bad_dir.mkdir()
        manifest = bad_dir / "dataset-manifest.json"
        manifest.write_text("{ invalid json }")

        is_valid, error, schema_version = _validate_staged_artifacts(bad_dir)

        assert is_valid is False
        assert "Invalid JSON" in error

    def test_unsupported_schema_version_fails(self, tmp_path: Path) -> None:
        """Unsupported manifest schema version fails fast."""
        bad_dir = tmp_path / "unsupported_version"
        bad_dir.mkdir()
        manifest = bad_dir / "dataset-manifest.json"
        manifest.write_text(
            json.dumps(
                {
                    "manifest_schema_version": 99,  # Unsupported version
                    "aggregate_index": {"weekly_rollups": [], "distributions": []},
                }
            )
        )

        is_valid, error, schema_version = _validate_staged_artifacts(bad_dir)

        assert is_valid is False
        assert "Unsupported manifest_schema_version" in error
        assert "99" in error
        assert schema_version == 99

    def test_missing_required_fields_fails(self, tmp_path: Path) -> None:
        """Manifest without required fields fails."""
        bad_dir = tmp_path / "missing_fields"
        bad_dir.mkdir()
        manifest = bad_dir / "dataset-manifest.json"
        manifest.write_text('{"manifest_schema_version": 1}')

        is_valid, error, schema_version = _validate_staged_artifacts(bad_dir)

        assert is_valid is False
        assert "aggregate_index" in error.lower()

    def test_missing_indexed_files_fails(self, tmp_path: Path) -> None:
        """Files referenced in manifest must exist."""
        bad_dir = tmp_path / "missing_files"
        bad_dir.mkdir()
        manifest = bad_dir / "dataset-manifest.json"
        manifest.write_text(
            json.dumps(
                {
                    "manifest_schema_version": 1,
                    "aggregate_index": {
                        "weekly_rollups": [
                            {"path": "aggregates/weekly_rollups/missing.json"}
                        ],
                        "distributions": [],
                    },
                }
            )
        )

        is_valid, error, schema_version = _validate_staged_artifacts(bad_dir)

        assert is_valid is False
        assert "Missing indexed files" in error
        assert "missing.json" in error

    def test_deprecated_double_nested_manifest_fails(self, tmp_path: Path) -> None:
        """aggregates/aggregates/dataset-manifest.json is hard error."""
        deprecated_dir = tmp_path / "deprecated"
        deprecated_dir.mkdir()

        # Create deprecated layout
        nested = deprecated_dir / "aggregates" / "aggregates"
        nested.mkdir(parents=True)
        (deprecated_dir / "dataset-manifest.json").write_text(
            '{"manifest_schema_version": 1, "aggregate_index": {"weekly_rollups": [], "distributions": []}}'
        )
        (nested / "dataset-manifest.json").write_text('{"manifest_schema_version": 1}')

        is_valid, error, schema_version = _validate_staged_artifacts(deprecated_dir)

        assert is_valid is False
        assert "DEPRECATED" in error
        assert "Double-nested" in error


# =============================================================================
# Mutation Tests - Layout Enforcement
# =============================================================================


class TestLayoutMutationProtection:
    """Tests that verify validation rejects re-introduced nested layouts.

    These tests intentionally MUTATE a valid layout to reintroduce nesting
    and verify that validation still hard-fails. This prevents future
    refactors from accidentally allowing nested layouts.
    """

    def test_reintroduced_nested_folder_fails(self, staged_fixture: Path) -> None:
        """Validation fails if aggregates/aggregates/ is reintroduced after staging."""
        # First, verify the fixture is valid
        is_valid, error, _ = _validate_staged_artifacts(staged_fixture)
        assert is_valid is True, f"Fixture should be valid: {error}"

        # MUTATION: Reintroduce nested aggregates/aggregates folder
        nested = staged_fixture / "aggregates" / "aggregates"
        nested.mkdir(parents=True)
        (nested / "dummy.json").write_text("{}")

        # Validation must now FAIL
        is_valid, error, _ = _validate_staged_artifacts(staged_fixture)

        assert is_valid is False
        assert "aggregates/aggregates" in error.lower() or "INVALID" in error

    def test_reintroduced_nested_manifest_fails(self, staged_fixture: Path) -> None:
        """Validation fails if aggregates/aggregates/dataset-manifest.json is reintroduced."""
        # First, verify the fixture is valid
        is_valid, error, _ = _validate_staged_artifacts(staged_fixture)
        assert is_valid is True, f"Fixture should be valid: {error}"

        # MUTATION: Reintroduce deprecated nested manifest
        nested = staged_fixture / "aggregates" / "aggregates"
        nested.mkdir(parents=True)
        (nested / "dataset-manifest.json").write_text('{"manifest_schema_version": 1}')

        # Validation must now FAIL
        is_valid, error, _ = _validate_staged_artifacts(staged_fixture)

        assert is_valid is False
        assert "DEPRECATED" in error or "Double-nested" in error

    def test_normalization_removes_nested_completely(
        self, nested_fixture: Path
    ) -> None:
        """Normalization must not leave any nested aggregates/aggregates structure."""
        # Normalize the nested layout
        was_normalized = _normalize_artifact_layout(nested_fixture)
        assert was_normalized is True

        # After normalization, there should be NO aggregates/aggregates
        nested = nested_fixture / "aggregates" / "aggregates"
        assert not nested.exists(), "Normalization must remove nested folder completely"

        # Validate must pass (no nested structure)
        is_valid, error, _ = _validate_staged_artifacts(nested_fixture)
        assert is_valid is True, f"Post-normalization validation failed: {error}"


# =============================================================================
# Integration Flow Tests
# =============================================================================


class TestStageToValidationFlow:
    """Tests for complete stage → validate flow using fixtures."""

    def test_normalized_nested_fixture_passes_validation(
        self, nested_fixture: Path
    ) -> None:
        """After normalization, nested fixture passes validation."""
        # Normalize the nested layout
        was_normalized = _normalize_artifact_layout(nested_fixture)
        assert was_normalized is True

        # Validate should now pass
        is_valid, error, schema_version = _validate_staged_artifacts(nested_fixture)

        assert is_valid is True, f"Validation failed: {error}"
        assert schema_version == 1

    def test_valid_fixture_ready_for_dashboard(self, staged_fixture: Path) -> None:
        """Valid fixture can be used directly for dashboard."""
        from ado_git_repo_insights.utils.dataset_discovery import (
            find_dataset_roots,
            validate_manifest_paths,
        )

        # Validation passes
        is_valid, error, _ = _validate_staged_artifacts(staged_fixture)
        assert is_valid is True, f"Validation failed: {error}"

        # Find dataset roots (only flat layout now)
        roots = find_dataset_roots(staged_fixture)
        assert len(roots) == 1
        assert roots[0] == staged_fixture.resolve()

        # Validate manifest paths
        valid, missing = validate_manifest_paths(staged_fixture)
        assert valid is True, f"Missing paths: {missing}"

    def test_no_fallback_to_aggregates_folder(self, tmp_path: Path) -> None:
        """Dataset discovery does NOT fallback to aggregates/ folder."""
        from ado_git_repo_insights.utils.dataset_discovery import find_dataset_roots

        # Create layout with manifest in aggregates/ (OLD style)
        old_style = tmp_path / "old_style"
        old_style.mkdir()
        agg = old_style / "aggregates"
        agg.mkdir()
        (agg / "dataset-manifest.json").write_text('{"manifest_schema_version": 1}')

        # find_dataset_roots should NOT find this (no fallback)
        roots = find_dataset_roots(old_style)

        # Must be empty - no fallback to aggregates/
        assert len(roots) == 0, "Legacy fallback to aggregates/ must not exist"
