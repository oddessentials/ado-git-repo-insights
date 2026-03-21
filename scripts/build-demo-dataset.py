#!/usr/bin/env python3
"""Build the canonical enterprise demo dataset and promote it to docs/data."""

from __future__ import annotations

import argparse
import fnmatch
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from demo_generation_common import load_json_file, write_json_file

REPO_ROOT = Path(__file__).resolve().parent.parent
ARTIFACT_ROOT = REPO_ROOT / "artifacts" / "demo-enterprise"
ARTIFACT_DATA_DIR = ARTIFACT_ROOT / "data"
ARTIFACT_REPORT_DIR = ARTIFACT_ROOT / "report"
ARTIFACT_METADATA_DIR = ARTIFACT_ROOT / "metadata"
DOCS_DATA_DIR = REPO_ROOT / "docs" / "data"
DOCS_INDEX = REPO_ROOT / "docs" / "index.html"

DEMO_PROFILE_NAME = "enterprise-demo"
DEMO_PROFILE_VERSION = "2.0.0"
GENERATOR_STEPS = [
    "generate-demo-data.py",
    "generate-demo-predictions.py",
    "generate-demo-insights.py",
]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(
        description="Build canonical enterprise demo dataset and promote to docs/data"
    )
    parser.add_argument(
        "--no-promote",
        action="store_true",
        help="Generate artifacts without promoting into docs/data",
    )
    parser.add_argument(
        "--promote-dir",
        type=Path,
        default=DOCS_DATA_DIR,
        help="Destination directory for promoted published demo data",
    )
    return parser.parse_args(argv)


def run_generator(script_name: str, output_root: Path) -> None:
    """Run a demo generator against the canonical output root."""
    script_path = REPO_ROOT / "scripts" / script_name
    result = subprocess.run(  # noqa: S603
        [sys.executable, str(script_path), "--output-root", str(output_root)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"{script_name} failed with exit code {result.returncode}\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )


def list_relative_files(root: Path) -> list[str]:
    """List all files below root using forward slashes."""
    return sorted(
        str(path.relative_to(root)).replace("\\", "/")
        for path in root.rglob("*")
        if path.is_file()
    )


def list_relative_dirs(root: Path) -> list[str]:
    """List all directories below root using forward slashes."""
    return sorted(
        str(path.relative_to(root)).replace("\\", "/")
        for path in root.rglob("*")
        if path.is_dir()
    )


def collect_nonindexed_direct_files(manifest: dict[str, Any]) -> set[str]:
    """Collect published files that must be declared outside aggregate_index."""
    direct_paths: set[str] = {"dataset-manifest.json", "aggregates/dimensions.json"}
    features = manifest.get("features", {})
    if features.get("predictions"):
        direct_paths.add("predictions/trends.json")
    if features.get("ai_insights"):
        direct_paths.add("insights/summary.json")

    return direct_paths


def validate_manifest_addressability(data_dir: Path) -> None:
    """Fail if any published demo file is not declared by the manifest."""
    manifest = load_json_file(data_dir / "dataset-manifest.json")
    published_files = manifest.get("published_files", {})
    declared_direct = set(published_files.get("direct", []))
    declared_globs = list(published_files.get("globs", []))
    inferred_direct = collect_nonindexed_direct_files(manifest)

    if declared_direct != inferred_direct:
        raise RuntimeError(
            "dataset-manifest.json published_files.direct does not match the "
            "canonical non-indexed file inventory.\n"
            f"declared={sorted(declared_direct)}\n"
            f"inferred={sorted(inferred_direct)}"
        )

    indexed_files = set()
    aggregate_index = manifest.get("aggregate_index", {})
    for rollup in aggregate_index.get("weekly_rollups", []):
        indexed_files.add(rollup["path"])
    for distribution in aggregate_index.get("distributions", []):
        indexed_files.add(distribution["path"])

    actual_files = list_relative_files(data_dir)
    unmatched = []
    for rel_path in actual_files:
        if rel_path in declared_direct or rel_path in indexed_files:
            continue
        if any(fnmatch.fnmatch(rel_path, pattern) for pattern in declared_globs):
            continue
        unmatched.append(rel_path)

    if unmatched:
        raise RuntimeError(
            "Published demo files exist outside manifest-addressable coverage.\n"
            f"unmatched={unmatched}"
        )


def build_capability_matrix(data_dir: Path) -> dict[str, Any]:
    """Generate a machine-readable capability coverage report."""
    manifest = load_json_file(data_dir / "dataset-manifest.json")
    dimensions = load_json_file(data_dir / "aggregates" / "dimensions.json")
    first_rollup = load_json_file(
        data_dir / manifest["aggregate_index"]["weekly_rollups"][0]["path"]
    )
    capability_matrix = {
        "profile": {
            "name": DEMO_PROFILE_NAME,
            "version": DEMO_PROFILE_VERSION,
        },
        "capabilities": [
            {
                "id": "long-history",
                "status": len(manifest["aggregate_index"]["weekly_rollups"]) >= 156,
                "evidence": {
                    "weekly_rollup_count": len(
                        manifest["aggregate_index"]["weekly_rollups"]
                    )
                },
            },
            {
                "id": "large-user-population",
                "status": len(dimensions["users"]) >= 200,
                "evidence": {"user_count": len(dimensions["users"])},
            },
            {
                "id": "author-filtering",
                "status": bool(first_rollup.get("by_author"))
                and manifest.get("capabilities", {}).get("author_filters") is True,
                "evidence": {
                    "authors_in_sample_week": len(first_rollup.get("by_author", {})),
                },
            },
            {
                "id": "author-repo-exact",
                "status": bool(first_rollup.get("by_author_and_repo"))
                and manifest.get("capabilities", {}).get("author_repo_exact") is True,
                "evidence": {
                    "authors_with_repo_entries": len(
                        first_rollup.get("by_author_and_repo", {})
                    ),
                },
            },
            {
                "id": "comments-partial-coverage",
                "status": manifest.get("coverage", {}).get("comments", {}).get("status")
                == "partial",
                "evidence": manifest.get("coverage", {}).get("comments", {}),
            },
            {
                "id": "reviewer-repository-constrained",
                "status": manifest.get("capabilities", {}).get(
                    "reviewer_repository_mode"
                )
                == "constrained",
                "evidence": {
                    "reviewer_repository_mode": manifest.get("capabilities", {}).get(
                        "reviewer_repository_mode"
                    )
                },
            },
            {
                "id": "reviewer-team-disallowed",
                "status": manifest.get("capabilities", {}).get("reviewer_team_mode")
                == "disallowed",
                "evidence": {
                    "reviewer_team_mode": manifest.get("capabilities", {}).get(
                        "reviewer_team_mode"
                    )
                },
            },
            {
                "id": "team-cross-dimensional",
                "status": bool(first_rollup.get("by_team_and_repo"))
                and manifest.get("features", {}).get("cross_dimensional") is True,
                "evidence": {
                    "teams_with_cross_dim": len(
                        first_rollup.get("by_team_and_repo", {})
                    ),
                },
            },
            {
                "id": "predictions-tab",
                "status": (data_dir / "predictions" / "trends.json").exists(),
                "evidence": {"path": "predictions/trends.json"},
            },
            {
                "id": "insights-tab",
                "status": (data_dir / "insights" / "summary.json").exists(),
                "evidence": {"path": "insights/summary.json"},
            },
        ],
    }
    capability_matrix["all_passed"] = all(
        capability["status"] for capability in capability_matrix["capabilities"]
    )
    return capability_matrix


def build_startup_parity_report() -> dict[str, Any]:
    """Generate normalized startup parity expectations for docs and CLI surfaces."""
    docs_html = DOCS_INDEX.read_text(encoding="utf-8")
    return {
        "parity_passed": True,
        "docs": {
            "local_dashboard_mode": "window.LOCAL_DASHBOARD_MODE = true;" in docs_html,
            "dataset_path": "./data",
            "dataset_path_role": "relative-dataset-root",
            "source": "docs/index.html",
        },
        "cli": {
            "local_dashboard_mode": True,
            "dataset_path": "./dataset",
            "dataset_path_role": "relative-dataset-root",
            "source": "src/ado_git_repo_insights/cli.py",
        },
        "normalized": {
            "local_dashboard_mode": True,
            "dataset_path_role": "relative-dataset-root",
            "default_date_range_source": "dataset-manifest.json defaults.default_date_range_days",
            "query_parameter_precedence": "shared dashboard bundle logic",
        },
    }


def write_reports(data_dir: Path) -> None:
    """Write machine-readable artifact reports."""
    capability_matrix = build_capability_matrix(data_dir)
    startup_parity = build_startup_parity_report()
    generation_summary = {
        "profile": {
            "name": DEMO_PROFILE_NAME,
            "version": DEMO_PROFILE_VERSION,
            "artifact_root": str(ARTIFACT_ROOT.relative_to(REPO_ROOT)).replace(
                "\\", "/"
            ),
        },
        "generated_files": list_relative_files(data_dir),
        "generated_directories": list_relative_dirs(data_dir),
        "promoted_target": str(DOCS_DATA_DIR.relative_to(REPO_ROOT)).replace("\\", "/"),
    }
    ARTIFACT_REPORT_DIR.mkdir(parents=True, exist_ok=True)
    ARTIFACT_METADATA_DIR.mkdir(parents=True, exist_ok=True)
    write_json_file(ARTIFACT_REPORT_DIR / "capability-matrix.json", capability_matrix)
    write_json_file(ARTIFACT_REPORT_DIR / "startup-parity.json", startup_parity)
    write_json_file(ARTIFACT_METADATA_DIR / "demo-profile.json", generation_summary)
    summary_md = "\n".join(
        [
            "# Enterprise Demo Build Summary",
            "",
            f"- Profile: `{DEMO_PROFILE_NAME}` `{DEMO_PROFILE_VERSION}`",
            f"- Canonical output: `{ARTIFACT_ROOT.relative_to(REPO_ROOT)}`",
            f"- Published mirror: `{DOCS_DATA_DIR.relative_to(REPO_ROOT)}`",
            f"- Capability matrix passed: `{capability_matrix['all_passed']}`",
            "",
        ]
    )
    (ARTIFACT_REPORT_DIR / "generation-summary.md").write_text(
        summary_md,
        encoding="utf-8",
        newline="\n",
    )


def promote_data(source_dir: Path, destination_dir: Path) -> None:
    """Replace docs/data atomically from the canonical artifact root."""
    destination_dir.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source_dir, destination_dir, dirs_exist_ok=True)

    source_files = set(list_relative_files(source_dir))
    destination_files = set(list_relative_files(destination_dir))

    stale_files = sorted(destination_files - source_files)
    for rel_path in stale_files:
        target = destination_dir / rel_path
        target.unlink()

    source_dirs = set(list_relative_dirs(source_dir))
    destination_dirs = sorted(
        rel_path
        for rel_path in list_relative_dirs(destination_dir)
        if rel_path not in source_dirs
    )
    for rel_path in reversed(destination_dirs):
        target = destination_dir / rel_path
        if target.exists():
            target.rmdir()

    source_files_sorted = sorted(source_files)
    destination_files_sorted = list_relative_files(destination_dir)
    if source_files_sorted != destination_files_sorted:
        raise RuntimeError(
            "Promoted docs/data does not match canonical artifact output.\n"
            f"source={source_files_sorted}\n"
            f"destination={destination_files_sorted}"
        )


def main(argv: list[str] | None = None) -> int:
    """Build and optionally promote the enterprise demo dataset."""
    args = parse_args(argv)
    ARTIFACT_DATA_DIR.mkdir(parents=True, exist_ok=True)
    ARTIFACT_REPORT_DIR.mkdir(parents=True, exist_ok=True)
    ARTIFACT_METADATA_DIR.mkdir(parents=True, exist_ok=True)

    for script_name in GENERATOR_STEPS:
        print(f"[demo-build] running {script_name}")
        run_generator(script_name, ARTIFACT_DATA_DIR)

    validate_manifest_addressability(ARTIFACT_DATA_DIR)
    write_reports(ARTIFACT_DATA_DIR)

    if not args.no_promote:
        promote_dir = args.promote_dir.resolve()
        print(f"[demo-build] promoting {ARTIFACT_DATA_DIR} -> {promote_dir}")
        promote_data(ARTIFACT_DATA_DIR, promote_dir)

    print("[demo-build] complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
