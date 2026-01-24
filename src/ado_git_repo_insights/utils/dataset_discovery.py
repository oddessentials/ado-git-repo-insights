"""Dataset discovery utilities for local dashboard mode."""

from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# STRICT: Only the flat layout is supported (manifest at root).
# Legacy nested layouts (aggregates/) are NO LONGER accepted.
# Use 'ado-insights stage-artifacts' to normalize legacy artifacts.
# See docs/CONTRACT.md for the authoritative layout specification.
CANDIDATE_PATHS = [
    ".",  # Root of provided directory (ONLY valid location)
]


# Error message for deprecated layout
DEPRECATED_LAYOUT_ERROR = (
    "Deprecated dataset layout detected (aggregates/aggregates nesting). "
    "This layout is no longer supported. Please re-run the pipeline with the "
    "updated YAML configuration and re-stage artifacts using 'ado-insights stage-artifacts'."
)


def find_dataset_roots(run_artifacts_dir: Path) -> list[Path]:
    """Find valid dataset root directories containing dataset-manifest.json.

    Searches the run_artifacts directory for dataset-manifest.json in common
    locations, supporting nested artifact layouts from Azure DevOps downloads.

    Args:
        run_artifacts_dir: Path to the run_artifacts directory.

    Returns:
        List of valid dataset root paths, ordered by priority.
        Each path contains a valid dataset-manifest.json file.
    """
    if not run_artifacts_dir.exists():
        logger.warning(f"Run artifacts directory does not exist: {run_artifacts_dir}")
        return []

    valid_roots: list[Path] = []

    for candidate in CANDIDATE_PATHS:
        candidate_path = run_artifacts_dir / candidate
        manifest_path = candidate_path / "dataset-manifest.json"

        if manifest_path.exists():
            # Validate it's a valid JSON file
            try:
                with manifest_path.open("r", encoding="utf-8") as f:
                    json.load(f)
                valid_roots.append(candidate_path.resolve())
                logger.debug(f"Found valid dataset root: {candidate_path}")
            except (json.JSONDecodeError, OSError) as e:
                logger.warning(
                    f"Found manifest at {manifest_path} but failed to parse: {e}"
                )

    return valid_roots


def get_best_dataset_root(run_artifacts_dir: Path) -> Path | None:
    """Get the best (first priority) dataset root from run_artifacts directory.

    Args:
        run_artifacts_dir: Path to the run_artifacts directory.

    Returns:
        The best matching dataset root path, or None if none found.
    """
    roots = find_dataset_roots(run_artifacts_dir)
    return roots[0] if roots else None


def validate_dataset_root(dataset_path: Path) -> tuple[bool, str | None]:
    """Validate that a dataset root contains required files.

    Args:
        dataset_path: Path to the dataset root directory.

    Returns:
        Tuple of (is_valid, error_message).
        If valid, error_message is None.
    """
    manifest_path = dataset_path / "dataset-manifest.json"

    if not dataset_path.exists():
        return False, f"Dataset path does not exist: {dataset_path}"

    if not manifest_path.exists():
        return False, f"dataset-manifest.json not found in {dataset_path}"

    try:
        with manifest_path.open("r", encoding="utf-8") as f:
            manifest = json.load(f)

        # Check for required manifest fields
        if "manifest_schema_version" not in manifest:
            return False, "Manifest missing required field: manifest_schema_version"

        # Check for aggregates directory or index
        agg_index = manifest.get("aggregate_index", {})
        if not agg_index:
            return False, "Manifest missing aggregate_index"

        return True, None

    except json.JSONDecodeError as e:
        return False, f"Invalid JSON in manifest: {e}"
    except OSError as e:
        return False, f"Error reading manifest: {e}"


def check_deprecated_layout(run_artifacts_dir: Path) -> str | None:
    """Check if a deprecated double-nested layout exists.

    Args:
        run_artifacts_dir: Path to the run_artifacts directory.

    Returns:
        DEPRECATED_LAYOUT_ERROR message if deprecated layout found, None otherwise.
    """
    deprecated_path = (
        run_artifacts_dir / "aggregates" / "aggregates" / "dataset-manifest.json"
    )
    if deprecated_path.exists():
        logger.error(DEPRECATED_LAYOUT_ERROR)
        return DEPRECATED_LAYOUT_ERROR
    return None


def validate_manifest_paths(dataset_root: Path) -> tuple[bool, list[str]]:
    """Validate that all paths in the manifest's aggregate_index exist.

    This is a critical invariant: every path referenced in the manifest
    must resolve to an existing file relative to the dataset root.

    Args:
        dataset_root: Path to the dataset root (where dataset-manifest.json lives).

    Returns:
        Tuple of (all_valid, list_of_missing_paths).
        If all_valid is True, the list will be empty.
    """
    manifest_path = dataset_root / "dataset-manifest.json"

    if not manifest_path.exists():
        return False, ["dataset-manifest.json not found"]

    try:
        with manifest_path.open("r", encoding="utf-8") as f:
            manifest = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        return False, [f"Failed to read manifest: {e}"]

    agg_index = manifest.get("aggregate_index", {})
    missing_paths: list[str] = []

    # Check weekly_rollups paths
    for rollup in agg_index.get("weekly_rollups", []):
        path_str = rollup.get("path", "")
        if path_str:
            full_path = dataset_root / path_str
            if not full_path.exists():
                missing_paths.append(path_str)

    # Check distributions paths
    for dist in agg_index.get("distributions", []):
        path_str = dist.get("path", "")
        if path_str:
            full_path = dataset_root / path_str
            if not full_path.exists():
                missing_paths.append(path_str)

    if missing_paths:
        logger.warning(f"Manifest references {len(missing_paths)} missing paths")
        for path in missing_paths[:5]:  # Log first 5
            logger.warning(f"  Missing: {path}")

    return len(missing_paths) == 0, missing_paths
