"""Tests for the canonical enterprise demo build and promotion pipeline."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
BUILD_SCRIPT = REPO_ROOT / "scripts" / "build-demo-dataset.py"
ARTIFACT_ROOT = REPO_ROOT / "artifacts" / "demo-enterprise"
ARTIFACT_DATA = ARTIFACT_ROOT / "data"
ARTIFACT_REPORT = ARTIFACT_ROOT / "report"
ARTIFACT_METADATA = ARTIFACT_ROOT / "metadata"


def run_demo_build(*, promote_dir: Path | None = None, promote: bool = False) -> None:
    """Run the canonical enterprise demo build."""
    args = [sys.executable, str(BUILD_SCRIPT)]
    if promote:
        if promote_dir is None:
            raise AssertionError("promote_dir is required when promote=True")
        args.extend(["--promote-dir", str(promote_dir)])
    else:
        args.append("--no-promote")
    result = subprocess.run(  # noqa: S603
        args,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, (
        f"build-demo-dataset.py failed: {result.stderr or result.stdout}"
    )


class TestCanonicalArtifactRoot:
    """Canonical build output is generated under artifacts/demo-enterprise."""

    def test_build_creates_canonical_artifacts(self) -> None:
        run_demo_build()

        assert (ARTIFACT_DATA / "dataset-manifest.json").exists()
        assert (ARTIFACT_REPORT / "capability-matrix.json").exists()
        assert (ARTIFACT_REPORT / "startup-parity.json").exists()
        assert (ARTIFACT_METADATA / "demo-profile.json").exists()

    def test_docs_promotion_matches_canonical_bytes(self, tmp_path: Path) -> None:
        promoted_dir = tmp_path / "published-demo"
        run_demo_build(promote=True, promote_dir=promoted_dir)

        canonical_files = sorted(
            path.relative_to(ARTIFACT_DATA)
            for path in ARTIFACT_DATA.rglob("*")
            if path.is_file()
        )
        promoted_files = sorted(
            path.relative_to(promoted_dir)
            for path in promoted_dir.rglob("*")
            if path.is_file()
        )

        assert canonical_files == promoted_files
        for rel_path in canonical_files:
            assert (ARTIFACT_DATA / rel_path).read_bytes() == (
                promoted_dir / rel_path
            ).read_bytes()

    def test_promotion_cleans_stale_files(self, tmp_path: Path) -> None:
        promoted_dir = tmp_path / "published-demo"
        promoted_dir.mkdir(parents=True, exist_ok=True)
        stale_path = promoted_dir / "stale-demo-file.json"
        stale_path.write_text('{"stale": true}\n', encoding="utf-8", newline="\n")
        stale_nested_dir = promoted_dir / "stale-dir" / "nested"
        stale_nested_dir.mkdir(parents=True, exist_ok=True)
        (stale_nested_dir / "stale.json").write_text(
            '{"stale": true}\n',
            encoding="utf-8",
            newline="\n",
        )
        assert stale_path.exists()

        run_demo_build(promote=True, promote_dir=promoted_dir)

        assert not stale_path.exists(), "docs/data promotion must remove stale files"
        assert not (promoted_dir / "stale-dir").exists(), (
            "docs/data promotion must remove stale directories"
        )


class TestCapabilityAndParityReports:
    """Capability matrix and startup parity reports are machine-readable."""

    def test_capability_matrix_passes(self) -> None:
        run_demo_build()
        matrix = json.loads(
            (ARTIFACT_REPORT / "capability-matrix.json").read_text(encoding="utf-8")
        )

        assert matrix["profile"]["name"] == "enterprise-demo"
        assert matrix["all_passed"] is True
        failed = [
            item["id"]
            for item in matrix["capabilities"]
            if item.get("status") is not True
        ]
        assert not failed, f"Capability matrix failures: {failed}"

    def test_startup_parity_report_passes(self) -> None:
        run_demo_build()
        report = json.loads(
            (ARTIFACT_REPORT / "startup-parity.json").read_text(encoding="utf-8")
        )

        assert report["parity_passed"] is True
        assert report["docs"]["local_dashboard_mode"] is True
        assert report["docs"]["dataset_path_role"] == "relative-dataset-root"
        assert report["cli"]["dataset_path_role"] == "relative-dataset-root"
        assert report["normalized"]["local_dashboard_mode"] is True

    def test_manifest_declares_all_published_files(self) -> None:
        run_demo_build()
        manifest = json.loads(
            (ARTIFACT_DATA / "dataset-manifest.json").read_text(encoding="utf-8")
        )

        declared_direct = set(manifest["published_files"]["direct"])
        declared_globs = manifest["published_files"]["globs"]
        indexed_files = {
            entry["path"] for entry in manifest["aggregate_index"]["weekly_rollups"]
        } | {entry["path"] for entry in manifest["aggregate_index"]["distributions"]}
        actual_files = {
            str(path.relative_to(ARTIFACT_DATA)).replace("\\", "/")
            for path in ARTIFACT_DATA.rglob("*")
            if path.is_file()
        }

        assert "dataset-manifest.json" in declared_direct
        unmatched = sorted(
            rel_path
            for rel_path in actual_files
            if rel_path not in declared_direct
            and rel_path not in indexed_files
            and not any(Path(rel_path).match(pattern) for pattern in declared_globs)
        )
        assert not unmatched, f"Unmanifested published files: {unmatched}"
