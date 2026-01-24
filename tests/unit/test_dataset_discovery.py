"""Unit tests for dataset_discovery module."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ado_git_repo_insights.utils.dataset_discovery import (
    CANDIDATE_PATHS,
    DEPRECATED_LAYOUT_ERROR,
    check_deprecated_layout,
    find_dataset_roots,
    get_best_dataset_root,
    validate_dataset_root,
    validate_manifest_paths,
)


@pytest.fixture
def temp_artifacts_dir(tmp_path: Path) -> Path:
    """Create a temporary run_artifacts directory."""
    return tmp_path / "run_artifacts"


def create_manifest(
    path: Path, manifest_schema_version: int = 1, weekly_rollups: list | None = None
) -> None:
    """Create a valid dataset-manifest.json file."""
    path.mkdir(parents=True, exist_ok=True)
    manifest = {
        "manifest_schema_version": manifest_schema_version,
        "aggregate_index": {
            "weekly_rollups": weekly_rollups
            if weekly_rollups is not None
            else [{"path": "aggregates/weekly_rollups/2024-W01.json"}],
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

    def test_nested_manifest_not_found_in_aggregates(
        self, temp_artifacts_dir: Path
    ) -> None:
        """Manifest in aggregates/ is NOT found (legacy fallback removed)."""
        temp_artifacts_dir.mkdir(parents=True)
        create_manifest(temp_artifacts_dir / "aggregates")

        result = find_dataset_roots(temp_artifacts_dir)

        # Legacy fallback removed - aggregates/ is NOT a candidate path
        assert len(result) == 0

    def test_deprecated_layout_not_supported(self, temp_artifacts_dir: Path) -> None:
        """Verifies deprecated aggregates/aggregates layout is NOT found."""
        temp_artifacts_dir.mkdir(parents=True)
        create_manifest(temp_artifacts_dir / "aggregates" / "aggregates")

        result = find_dataset_roots(temp_artifacts_dir)

        # Deprecated layout should NOT be found
        assert len(result) == 0

    def test_only_finds_root_manifest_not_aggregates(
        self, temp_artifacts_dir: Path
    ) -> None:
        """Only returns root manifest, ignores aggregates/ (no legacy fallback)."""
        temp_artifacts_dir.mkdir(parents=True)
        create_manifest(temp_artifacts_dir)
        create_manifest(temp_artifacts_dir / "aggregates")

        result = find_dataset_roots(temp_artifacts_dir)

        # Only root is found - aggregates fallback removed
        assert len(result) == 1
        assert result[0] == temp_artifacts_dir.resolve()

    def test_skips_invalid_json_manifests(self, temp_artifacts_dir: Path) -> None:
        """Skips manifests that are not valid JSON."""
        temp_artifacts_dir.mkdir(parents=True)
        (temp_artifacts_dir / "dataset-manifest.json").write_text(
            "not valid json{", encoding="utf-8"
        )
        # Create valid manifest in aggregates/ but it won't be found (no fallback)
        create_manifest(temp_artifacts_dir / "aggregates")

        result = find_dataset_roots(temp_artifacts_dir)

        # Invalid root JSON is skipped, aggregates/ is not a candidate
        assert len(result) == 0

    def test_candidate_paths_only_includes_strict_root(self) -> None:
        """Verifies CANDIDATE_PATHS contains ONLY root (strict flat layout)."""
        assert "." in CANDIDATE_PATHS
        # Legacy fallback removed
        assert "aggregates" not in CANDIDATE_PATHS
        # Deprecated paths should NOT be in CANDIDATE_PATHS
        assert "aggregates/aggregates" not in CANDIDATE_PATHS
        assert "dataset" not in CANDIDATE_PATHS
        # Only 1 path supported (strict flat layout)
        assert len(CANDIDATE_PATHS) == 1


class TestCheckDeprecatedLayout:
    """Tests for check_deprecated_layout function."""

    def test_returns_none_when_no_deprecated_layout(
        self, temp_artifacts_dir: Path
    ) -> None:
        """Returns None when deprecated layout not present."""
        temp_artifacts_dir.mkdir(parents=True)
        create_manifest(temp_artifacts_dir)

        result = check_deprecated_layout(temp_artifacts_dir)

        assert result is None

    def test_returns_error_when_deprecated_layout_exists(
        self, temp_artifacts_dir: Path
    ) -> None:
        """Returns error message when aggregates/aggregates layout exists."""
        temp_artifacts_dir.mkdir(parents=True)
        create_manifest(temp_artifacts_dir / "aggregates" / "aggregates")

        result = check_deprecated_layout(temp_artifacts_dir)

        assert result == DEPRECATED_LAYOUT_ERROR


class TestValidateManifestPaths:
    """Tests for validate_manifest_paths function."""

    def test_returns_true_when_all_paths_exist(self, temp_artifacts_dir: Path) -> None:
        """Returns True when all indexed paths exist."""
        temp_artifacts_dir.mkdir(parents=True)
        # Create manifest with rollups
        create_manifest(temp_artifacts_dir)
        # Create the referenced file
        rollup_dir = temp_artifacts_dir / "aggregates" / "weekly_rollups"
        rollup_dir.mkdir(parents=True)
        (rollup_dir / "2024-W01.json").write_text("{}", encoding="utf-8")

        is_valid, missing = validate_manifest_paths(temp_artifacts_dir)

        assert is_valid is True
        assert missing == []

    def test_returns_false_when_paths_missing(self, temp_artifacts_dir: Path) -> None:
        """Returns False with list of missing paths."""
        temp_artifacts_dir.mkdir(parents=True)
        create_manifest(temp_artifacts_dir)  # References non-existent rollup file

        is_valid, missing = validate_manifest_paths(temp_artifacts_dir)

        assert is_valid is False
        assert len(missing) == 1
        assert "aggregates/weekly_rollups/2024-W01.json" in missing[0]

    def test_handles_missing_manifest(self, temp_artifacts_dir: Path) -> None:
        """Returns False when manifest itself doesn't exist."""
        temp_artifacts_dir.mkdir(parents=True)

        is_valid, missing = validate_manifest_paths(temp_artifacts_dir)

        assert is_valid is False
        assert "not found" in missing[0]


class TestGetBestDatasetRoot:
    """Tests for get_best_dataset_root function."""

    def test_returns_none_when_no_roots(self, temp_artifacts_dir: Path) -> None:
        """Returns None when no valid roots found."""
        temp_artifacts_dir.mkdir(parents=True)

        result = get_best_dataset_root(temp_artifacts_dir)

        assert result is None

    def test_returns_root_when_multiple_exist(self, temp_artifacts_dir: Path) -> None:
        """Returns the root when both root and aggregates have manifests."""
        temp_artifacts_dir.mkdir(parents=True)
        create_manifest(temp_artifacts_dir)
        create_manifest(temp_artifacts_dir / "aggregates")

        result = get_best_dataset_root(temp_artifacts_dir)

        # Only root is found (aggregates not a candidate path)
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

    def test_returns_invalid_when_manifest_schema_version_missing(
        self, tmp_path: Path
    ) -> None:
        """Returns invalid when manifest lacks manifest_schema_version."""
        dataset_dir = tmp_path / "dataset"
        dataset_dir.mkdir()
        (dataset_dir / "dataset-manifest.json").write_text(
            '{"aggregate_index": {}}', encoding="utf-8"
        )

        is_valid, error = validate_dataset_root(dataset_dir)

        assert is_valid is False
        assert "manifest_schema_version" in error

    def test_returns_invalid_when_aggregate_index_missing(self, tmp_path: Path) -> None:
        """Returns invalid when manifest lacks aggregate_index."""
        dataset_dir = tmp_path / "dataset"
        dataset_dir.mkdir()
        (dataset_dir / "dataset-manifest.json").write_text(
            '{"manifest_schema_version": 1}', encoding="utf-8"
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
