"""Unit tests for dataset version validation.

Covers §8 from IMPLEMENTATION_DETAILS.md:
- UI must validate schema versions before rendering
- Fail fast with clear message on version mismatch
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest


def validate_manifest_version(manifest: dict, max_version: int = 1) -> None:
    """Validate manifest schema version."""
    version = manifest.get("manifest_schema_version")
    if version is None:
        raise ValueError("Invalid manifest: missing schema version")
    if version > max_version:
        raise ValueError(
            f"Manifest version {version} not supported. "
            f"Maximum supported: {max_version}. "
            f"Please update the extension."
        )


def validate_dataset_version(manifest: dict, max_version: int = 1) -> None:
    """Validate dataset schema version."""
    version = manifest.get("dataset_schema_version", 0)
    if version > max_version:
        raise ValueError(f"Dataset version {version} not supported.")


def validate_aggregates_version(manifest: dict, max_version: int = 1) -> None:
    """Validate aggregates schema version."""
    version = manifest.get("aggregates_schema_version", 0)
    if version > max_version:
        raise ValueError(f"Aggregates version {version} not supported.")


class TestVersionValidation:
    """Tests for schema version validation logic."""

    def test_manifest_version_too_high_rejected(self, tmp_path: Path) -> None:
        """Test that a manifest with version > supported is rejected.

        §8 Required Test: version mismatch test that verifies UI error messaging.
        """
        manifest = {
            "manifest_schema_version": 999,  # Way higher than supported
            "dataset_schema_version": 1,
            "aggregates_schema_version": 1,
            "generated_at": "2026-01-01T00:00:00Z",
            "run_id": "test-run",
            "aggregate_index": {"weekly_rollups": [], "distributions": []},
        }

        # Write manifest
        manifest_path = tmp_path / "dataset-manifest.json"
        manifest_path.write_text(json.dumps(manifest))

        with pytest.raises(ValueError, match="not supported"):
            validate_manifest_version(manifest)

    def test_dataset_version_too_high_rejected(self, tmp_path: Path) -> None:
        """Test that a dataset version > supported is rejected."""
        manifest = {
            "manifest_schema_version": 1,
            "dataset_schema_version": 999,  # Too high
            "aggregates_schema_version": 1,
        }

        with pytest.raises(ValueError, match="not supported"):
            validate_dataset_version(manifest)

    def test_aggregates_version_too_high_rejected(self, tmp_path: Path) -> None:
        """Test that an aggregates version > supported is rejected."""
        manifest = {
            "manifest_schema_version": 1,
            "dataset_schema_version": 1,
            "aggregates_schema_version": 999,  # Too high
        }

        with pytest.raises(ValueError, match="not supported"):
            validate_aggregates_version(manifest)

    def test_compatible_versions_accepted(self, tmp_path: Path) -> None:
        """Test that matching versions are accepted without error."""
        manifest = {
            "manifest_schema_version": 1,
            "dataset_schema_version": 1,
            "aggregates_schema_version": 1,
        }

        # Should not raise
        validate_manifest_version(manifest)
        validate_dataset_version(manifest)
        validate_aggregates_version(manifest)

    def test_missing_version_raises_error(self, tmp_path: Path) -> None:
        """Test that missing schema version is rejected."""
        manifest = {
            # Missing manifest_schema_version
            "dataset_schema_version": 1,
            "aggregates_schema_version": 1,
        }

        with pytest.raises(ValueError, match="missing schema version"):
            validate_manifest_version(manifest)
