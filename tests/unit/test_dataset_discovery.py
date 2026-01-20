"""Unit tests for dataset_discovery module."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ado_git_repo_insights.utils.dataset_discovery import (
    CANDIDATE_PATHS,
    find_dataset_roots,
    get_best_dataset_root,
    validate_dataset_root,
)


@pytest.fixture
def temp_artifacts_dir(tmp_path: Path) -> Path:
    """Create a temporary run_artifacts directory."""
    return tmp_path / "run_artifacts"


def create_manifest(path: Path, schema_version: str = "1.0") -> None:
    """Create a valid dataset-manifest.json file."""
    path.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schema_version": schema_version,
        "aggregate_index": {
            "weekly_rollups": ["aggregates/weekly_rollup_2024-W01.json"],
            "distributions": [],
        },
    }
    (path / "dataset-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


class TestFindDatasetRoots:
    """Tests for find_dataset_roots function."""

    def test_returns_empty_list_when_dir_not_exists(self, tmp_path: Path) -> None:
        """Returns empty list when run_artifacts directory doesn't exist."""
        nonexistent = tmp_path / "nonexistent"
        result = find_dataset_roots(nonexistent)
        assert result == []

    def test_finds_manifest_at_root(self, temp_artifacts_dir: Path) -> None:
        """Finds manifest when located directly in run_artifacts/."""
        create_manifest(temp_artifacts_dir)

        result = find_dataset_roots(temp_artifacts_dir)

        assert len(result) == 1
        assert result[0] == temp_artifacts_dir.resolve()

    def test_finds_manifest_nested_once(self, temp_artifacts_dir: Path) -> None:
        """Finds manifest when located in run_artifacts/aggregates/."""
        temp_artifacts_dir.mkdir(parents=True)
        create_manifest(temp_artifacts_dir / "aggregates")

        result = find_dataset_roots(temp_artifacts_dir)

        assert len(result) == 1
        assert result[0] == (temp_artifacts_dir / "aggregates").resolve()

    def test_finds_manifest_nested_twice(self, temp_artifacts_dir: Path) -> None:
        """Finds manifest when located in run_artifacts/aggregates/aggregates/."""
        temp_artifacts_dir.mkdir(parents=True)
        create_manifest(temp_artifacts_dir / "aggregates" / "aggregates")

        result = find_dataset_roots(temp_artifacts_dir)

        assert len(result) == 1
        assert result[0] == (temp_artifacts_dir / "aggregates" / "aggregates").resolve()

    def test_finds_manifest_in_dataset_subdir(self, temp_artifacts_dir: Path) -> None:
        """Finds manifest when located in run_artifacts/dataset/."""
        temp_artifacts_dir.mkdir(parents=True)
        create_manifest(temp_artifacts_dir / "dataset")

        result = find_dataset_roots(temp_artifacts_dir)

        assert len(result) == 1
        assert result[0] == (temp_artifacts_dir / "dataset").resolve()

    def test_returns_multiple_if_manifests_in_multiple_locations(
        self, temp_artifacts_dir: Path
    ) -> None:
        """Returns all valid roots if manifests exist in multiple candidate paths."""
        temp_artifacts_dir.mkdir(parents=True)
        create_manifest(temp_artifacts_dir)
        create_manifest(temp_artifacts_dir / "aggregates")

        result = find_dataset_roots(temp_artifacts_dir)

        # Both should be found, root first (priority order)
        assert len(result) == 2
        assert result[0] == temp_artifacts_dir.resolve()
        assert result[1] == (temp_artifacts_dir / "aggregates").resolve()

    def test_skips_invalid_json_manifests(self, temp_artifacts_dir: Path) -> None:
        """Skips manifests that are not valid JSON."""
        temp_artifacts_dir.mkdir(parents=True)
        (temp_artifacts_dir / "dataset-manifest.json").write_text(
            "not valid json{", encoding="utf-8"
        )
        create_manifest(temp_artifacts_dir / "aggregates")

        result = find_dataset_roots(temp_artifacts_dir)

        # Only the valid one should be returned
        assert len(result) == 1
        assert result[0] == (temp_artifacts_dir / "aggregates").resolve()

    def test_candidate_paths_includes_expected_values(self) -> None:
        """Verifies CANDIDATE_PATHS contains the expected search paths."""
        assert "." in CANDIDATE_PATHS
        assert "aggregates" in CANDIDATE_PATHS
        assert "aggregates/aggregates" in CANDIDATE_PATHS
        assert "dataset" in CANDIDATE_PATHS


class TestGetBestDatasetRoot:
    """Tests for get_best_dataset_root function."""

    def test_returns_none_when_no_roots(self, temp_artifacts_dir: Path) -> None:
        """Returns None when no valid roots found."""
        temp_artifacts_dir.mkdir(parents=True)

        result = get_best_dataset_root(temp_artifacts_dir)

        assert result is None

    def test_returns_first_priority_root(self, temp_artifacts_dir: Path) -> None:
        """Returns the first (highest priority) root when multiple exist."""
        temp_artifacts_dir.mkdir(parents=True)
        create_manifest(temp_artifacts_dir)
        create_manifest(temp_artifacts_dir / "aggregates")

        result = get_best_dataset_root(temp_artifacts_dir)

        # Root has higher priority than aggregates/
        assert result == temp_artifacts_dir.resolve()


class TestValidateDatasetRoot:
    """Tests for validate_dataset_root function."""

    def test_returns_invalid_when_path_not_exists(self, tmp_path: Path) -> None:
        """Returns invalid when path doesn't exist."""
        nonexistent = tmp_path / "nonexistent"

        is_valid, error = validate_dataset_root(nonexistent)

        assert is_valid is False
        assert "does not exist" in error

    def test_returns_invalid_when_manifest_missing(self, tmp_path: Path) -> None:
        """Returns invalid when dataset-manifest.json is missing."""
        dataset_dir = tmp_path / "dataset"
        dataset_dir.mkdir()

        is_valid, error = validate_dataset_root(dataset_dir)

        assert is_valid is False
        assert "dataset-manifest.json not found" in error

    def test_returns_invalid_when_manifest_invalid_json(self, tmp_path: Path) -> None:
        """Returns invalid when manifest is not valid JSON."""
        dataset_dir = tmp_path / "dataset"
        dataset_dir.mkdir()
        (dataset_dir / "dataset-manifest.json").write_text("not json", encoding="utf-8")

        is_valid, error = validate_dataset_root(dataset_dir)

        assert is_valid is False
        assert "Invalid JSON" in error

    def test_returns_invalid_when_schema_version_missing(self, tmp_path: Path) -> None:
        """Returns invalid when manifest lacks schema_version."""
        dataset_dir = tmp_path / "dataset"
        dataset_dir.mkdir()
        (dataset_dir / "dataset-manifest.json").write_text(
            '{"aggregate_index": {}}', encoding="utf-8"
        )

        is_valid, error = validate_dataset_root(dataset_dir)

        assert is_valid is False
        assert "schema_version" in error

    def test_returns_invalid_when_aggregate_index_missing(self, tmp_path: Path) -> None:
        """Returns invalid when manifest lacks aggregate_index."""
        dataset_dir = tmp_path / "dataset"
        dataset_dir.mkdir()
        (dataset_dir / "dataset-manifest.json").write_text(
            '{"schema_version": "1.0"}', encoding="utf-8"
        )

        is_valid, error = validate_dataset_root(dataset_dir)

        assert is_valid is False
        assert "aggregate_index" in error

    def test_returns_valid_for_valid_manifest(self, tmp_path: Path) -> None:
        """Returns valid for a properly structured manifest."""
        dataset_dir = tmp_path / "dataset"
        create_manifest(dataset_dir)

        is_valid, error = validate_dataset_root(dataset_dir)

        assert is_valid is True
        assert error is None
