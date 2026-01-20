"""Dataset discovery utilities for local dashboard mode."""

from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Priority order of candidate paths to search for dataset-manifest.json
CANDIDATE_PATHS = [
    ".",  # Root of provided directory
    "aggregates",  # Single nesting (common)
    "aggregates/aggregates",  # Double nesting (ADO artifact download quirk)
    "dataset",  # Alternative naming
]


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
        if "schema_version" not in manifest:
            return False, "Manifest missing required field: schema_version"

        # Check for aggregates directory or index
        agg_index = manifest.get("aggregate_index", {})
        if not agg_index:
            return False, "Manifest missing aggregate_index"

        return True, None

    except json.JSONDecodeError as e:
        return False, f"Invalid JSON in manifest: {e}"
    except OSError as e:
        return False, f"Error reading manifest: {e}"
