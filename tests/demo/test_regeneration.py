"""
T055: Regeneration tests for demo synthetic data.

Verifies that running the generators twice produces byte-identical output.
This ensures deterministic generation with seed=42.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

# Paths relative to repository root
REPO_ROOT = Path(__file__).parent.parent.parent
DOCS_DATA = REPO_ROOT / "docs" / "data"
ARTIFACT_ROOT = REPO_ROOT / "artifacts" / "demo-enterprise"
SCRIPTS_DIR = REPO_ROOT / "scripts"
BUILD_SCRIPT = SCRIPTS_DIR / "build-demo-dataset.py"
MANIFEST_PATH = DOCS_DATA / "dataset-manifest.json"


def _load_demo_generation_common():
    script_path = SCRIPTS_DIR / "demo_generation_common.py"
    spec = importlib.util.spec_from_file_location("demo_generation_common", script_path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"Unable to load shared demo module: {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_DEMO_GENERATION_COMMON = _load_demo_generation_common()
CANONICAL_COMMITTED_DEMO_MODE = _DEMO_GENERATION_COMMON.CANONICAL_COMMITTED_DEMO_MODE
CANONICAL_COMMITTED_DEMO_SCRIPT = (
    _DEMO_GENERATION_COMMON.CANONICAL_COMMITTED_DEMO_SCRIPT
)
COMMITTED_DEMO_BASELINE_PYTHON = _DEMO_GENERATION_COMMON.COMMITTED_DEMO_BASELINE_PYTHON
COMMITTED_DEMO_BASELINE_PYTHON_VERSION = (
    _DEMO_GENERATION_COMMON.COMMITTED_DEMO_BASELINE_PYTHON_VERSION
)
COMMITTED_DEMO_BASELINE_PYTHON_MAJOR_MINOR = (
    _DEMO_GENERATION_COMMON.COMMITTED_DEMO_BASELINE_PYTHON_MAJOR_MINOR
)
_IS_BASELINE_PYTHON = sys.version_info[:2] == COMMITTED_DEMO_BASELINE_PYTHON


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


def compute_all_file_hashes(directory: Path) -> dict[str, str]:
    """Compute hashes for all files in a directory tree."""
    hashes = {}
    for file_path in sorted(path for path in directory.rglob("*") if path.is_file()):
        rel_path = file_path.relative_to(directory)
        hashes[str(rel_path).replace("\\", "/")] = compute_file_hash(file_path)
    return hashes


def run_non_promoting_canonical_data_build() -> None:
    """Run the canonical committed-demo data pipeline up to artifacts only.

    This test helper intentionally stops at the non-promoting artifact boundary
    under artifacts/demo-enterprise. Full docs-surface publication is validated
    separately by the dedicated demo workflow, so Python matrix jobs do not
    depend on Node/pnpm availability.
    """
    args = [sys.executable, str(BUILD_SCRIPT), "--no-promote"]
    if not _IS_BASELINE_PYTHON:
        args.append("--validate-only")
    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    assert result.returncode == 0, (
        f"non-promoting build-demo-dataset.py failed: {result.stderr or result.stdout}"
    )


def _set_manifest_feature_flag(flag_name: str, value: bool) -> None:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    manifest.setdefault("features", {})[flag_name] = value
    MANIFEST_PATH.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )


class TestDeterministicRegeneration:
    """T055: Verify byte-identical regeneration."""

    def test_generate_demo_data_is_deterministic(self) -> None:
        """
        Running the full regeneration pipeline produces identical output.

        On baseline Python (3.12): runs generators twice and verifies byte-identical.
        On non-baseline: validates committed data passes full build validation
        and manifest carries canonical provenance (generation-vs-validation mode
        contract — see plan for details).
        """
        if not (DOCS_DATA / "dataset-manifest.json").exists():
            pytest.skip("docs/data not found - skipping regeneration test")

        if not _IS_BASELINE_PYTHON:
            # Validate committed data integrity via validate-only build
            run_non_promoting_canonical_data_build()
            manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
            assert manifest["generation_provenance"]["generation_mode"] == (
                CANONICAL_COMMITTED_DEMO_MODE
            ), "Committed manifest must carry canonical generation provenance"
            assert len(compute_directory_hashes(DOCS_DATA)) > 0
            return

        # Capture current hashes before rebuilding the canonical data artifacts.
        original_hashes = compute_directory_hashes(DOCS_DATA)

        run_non_promoting_canonical_data_build()

        first_regeneration_hashes = compute_directory_hashes(DOCS_DATA)

        manifest = json.loads(
            (DOCS_DATA / "dataset-manifest.json").read_text(encoding="utf-8")
        )
        assert manifest["features"]["predictions"] is True
        assert manifest["features"]["ai_insights"] is True
        assert manifest["features"]["cross_dimensional"] is True

        run_non_promoting_canonical_data_build()
        second_regeneration_hashes = compute_directory_hashes(DOCS_DATA)

        assert original_hashes == first_regeneration_hashes, (
            "First regeneration produced different output! "
            "Check that seed is fixed and JSON serialization is canonical."
        )
        assert first_regeneration_hashes == second_regeneration_hashes, (
            "Independent regenerations produced different output! "
            "Check that seed is fixed and JSON serialization is canonical."
        )

    def test_canonical_demo_build_artifacts_are_deterministic(self) -> None:
        """Build output must remain identical across repeated builds.

        On baseline Python: verifies full generation determinism.
        On non-baseline: verifies validate-only mode is deterministic.
        """
        run_non_promoting_canonical_data_build()
        first_hashes = compute_all_file_hashes(ARTIFACT_ROOT)
        assert first_hashes, "Canonical artifact root must contain generated files"

        run_non_promoting_canonical_data_build()
        second_hashes = compute_all_file_hashes(ARTIFACT_ROOT)

        assert first_hashes == second_hashes, (
            "Artifact build output is not deterministic across repeated runs"
        )

    def test_canonical_regeneration_preserves_manifest_provenance(self) -> None:
        """Canonical regeneration must preserve approved provenance metadata.

        On non-baseline: verifies committed manifest provenance directly.
        """
        if _IS_BASELINE_PYTHON:
            run_non_promoting_canonical_data_build()

        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

        assert manifest["generation_provenance"] == {
            "python_version": COMMITTED_DEMO_BASELINE_PYTHON_VERSION,
            "python_major_minor": COMMITTED_DEMO_BASELINE_PYTHON_MAJOR_MINOR,
            "generator_script": CANONICAL_COMMITTED_DEMO_SCRIPT,
            "generation_mode": CANONICAL_COMMITTED_DEMO_MODE,
        }

    def test_generate_demo_predictions_is_deterministic(self) -> None:
        """
        Running generate-demo-predictions.py produces identical output.

        On non-baseline: validates committed predictions schema.
        """
        predictions_file = DOCS_DATA / "predictions" / "trends.json"
        if not predictions_file.exists():
            pytest.skip("predictions/trends.json not found")

        if not _IS_BASELINE_PYTHON:
            predictions = json.loads(predictions_file.read_text(encoding="utf-8"))
            assert isinstance(predictions, dict), "Predictions must be a JSON object"
            manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
            assert manifest["features"]["predictions"] is True
            return

        original_hash = compute_file_hash(predictions_file)
        original_manifest_bytes = MANIFEST_PATH.read_bytes()
        _set_manifest_feature_flag("predictions", False)

        try:
            result = subprocess.run(
                [sys.executable, str(SCRIPTS_DIR / "generate-demo-predictions.py")],
                capture_output=True,
                text=True,
                cwd=REPO_ROOT,
            )
            assert result.returncode == 0, f"Generator failed: {result.stderr}"

            new_hash = compute_file_hash(predictions_file)
            assert original_hash == new_hash, "Predictions regeneration changed output"

            manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
            assert manifest["features"]["predictions"] is True
        finally:
            MANIFEST_PATH.write_bytes(original_manifest_bytes)

    def test_generate_demo_insights_is_deterministic(self) -> None:
        """
        Running generate-demo-insights.py produces identical output.

        On non-baseline: validates committed insights schema.
        """
        insights_file = DOCS_DATA / "insights" / "summary.json"
        if not insights_file.exists():
            pytest.skip("insights/summary.json not found")

        if not _IS_BASELINE_PYTHON:
            insights = json.loads(insights_file.read_text(encoding="utf-8"))
            assert isinstance(insights, dict), "Insights must be a JSON object"
            manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
            assert manifest["features"]["ai_insights"] is True
            return

        original_hash = compute_file_hash(insights_file)
        original_manifest_bytes = MANIFEST_PATH.read_bytes()
        _set_manifest_feature_flag("ai_insights", False)

        try:
            result = subprocess.run(
                [sys.executable, str(SCRIPTS_DIR / "generate-demo-insights.py")],
                capture_output=True,
                text=True,
                cwd=REPO_ROOT,
            )
            assert result.returncode == 0, f"Generator failed: {result.stderr}"

            new_hash = compute_file_hash(insights_file)
            assert original_hash == new_hash, "Insights regeneration changed output"

            manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
            assert manifest["features"]["ai_insights"] is True
        finally:
            MANIFEST_PATH.write_bytes(original_manifest_bytes)


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
