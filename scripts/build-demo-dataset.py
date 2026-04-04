#!/usr/bin/env python3
"""Build the canonical enterprise demo dataset and promote it to docs/data."""

from __future__ import annotations

import argparse
import fnmatch
import os
import shutil
import subprocess
import sys
import time
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import TYPE_CHECKING, TypedDict

if TYPE_CHECKING:
    from ado_git_repo_insights.types import JSONValue

from demo_generation_common import (
    CANONICAL_COMMITTED_DEMO_MODE,
    CANONICAL_COMMITTED_DEMO_SCRIPT,
    VALIDATED_COMMITTED_DEMO_MODE,
    build_generation_provenance,
    load_json_file,
    narrow_int,
    narrow_mapping,
    narrow_sequence,
    require_demo_generation_baseline,
    validate_generation_provenance,
    write_json_file,
)
from demo_shell import render_demo_html_from_path

REPO_ROOT = Path(__file__).resolve().parent.parent
ARTIFACT_ROOT = Path(
    os.environ.get(
        "ADO_DEMO_ARTIFACT_ROOT",
        str(REPO_ROOT / "artifacts" / "demo-enterprise"),
    )
).resolve()
ARTIFACT_DATA_DIR = ARTIFACT_ROOT / "data"
ARTIFACT_REPORT_DIR = ARTIFACT_ROOT / "report"
ARTIFACT_METADATA_DIR = ARTIFACT_ROOT / "metadata"
DOCS_DATA_DIR = REPO_ROOT / "docs" / "data"
DOCS_DIR = REPO_ROOT / "docs"
DOCS_INDEX = REPO_ROOT / "docs" / "index.html"
EXTENSION_INDEX = REPO_ROOT / "extension" / "ui" / "index.html"
PUBLISH_SURFACE_SCRIPT = REPO_ROOT / "scripts" / "publish-demo-surface.py"
EXTENSION_ROOT = REPO_ROOT / "extension"

DEMO_PROFILE_NAME = "enterprise-demo"
DEMO_PROFILE_VERSION = "2.0.0"
GENERATOR_STEPS = [
    "generate-demo-data.py",
    "generate-demo-predictions.py",
    "generate-demo-insights.py",
]
REQUIRED_REVIEWER_FIXTURE_KEYS = {
    "minimum_active_reviewers",
    "minimum_reviewed_prs_per_reviewer",
    "minimum_review_actions_per_reviewer",
    "minimum_multi_repo_reviewers",
    "reviewer_filter_examples",
    "reviewer_constrained_example",
    "reviewer_team_disallowed_example",
}

# Type alias for JSON-originated dictionaries where values are untyped.
_JsonDict = Mapping[str, object]


class _ReviewerContractResult(TypedDict):
    """Evidence returned by validate_reviewer_fixture_contract."""

    fixture_week: str
    active_reviewers: int
    multi_repo_reviewers: int
    reviewer_filter_examples: int
    minimum_active_reviewers: int
    minimum_multi_repo_reviewers: int


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
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Skip generation; validate already-committed docs/data artifacts",
    )
    return parser.parse_args(argv)


def run_generator(script_name: str, output_root: Path) -> None:
    """Run a demo generator against the canonical output root."""
    script_path = REPO_ROOT / "scripts" / script_name
    result = subprocess.run(
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


def run_repo_command(command: list[str], *, cwd: Path = REPO_ROOT) -> None:
    """Run a repo-managed command and raise a detailed error on failure."""
    result = subprocess.run(
        command,
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Command failed with exit code {result.returncode}: {' '.join(command)}\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )


def _remove_tree(path: Path) -> None:
    """Remove a directory tree if present."""
    if not path.exists():
        return

    attempts = 3 if os.name == "nt" else 1
    last_error: BaseException | None = None
    for attempt in range(1, attempts + 1):
        try:
            shutil.rmtree(path, ignore_errors=False)
            return
        except FileNotFoundError:
            return
        except OSError as exc:
            last_error = exc
            if os.name != "nt" or attempt == attempts:
                break
            time.sleep(0.1 * attempt)

    raise RuntimeError(
        f"Failed to clean canonical artifact directory `{path}` after {attempts} "
        "attempts. This may indicate a leaked file handle or another process "
        "holding the directory open."
    ) from last_error


def reset_canonical_artifact_root() -> None:
    """Ensure the canonical artifact root starts clean for each build mode."""
    _remove_tree(ARTIFACT_DATA_DIR)
    _remove_tree(ARTIFACT_REPORT_DIR)
    _remove_tree(ARTIFACT_METADATA_DIR)
    ARTIFACT_DATA_DIR.mkdir(parents=True, exist_ok=True)
    ARTIFACT_REPORT_DIR.mkdir(parents=True, exist_ok=True)
    ARTIFACT_METADATA_DIR.mkdir(parents=True, exist_ok=True)


def _resolve_pnpm() -> str:
    """Resolve pnpm from PATH for canonical demo surface publication."""
    for candidate in ("pnpm.cmd", "pnpm"):
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise RuntimeError(
        "pnpm is required to build the canonical demo surface but was not found on PATH"
    )


def ensure_canonical_demo_surface() -> None:
    """Build and publish the full docs demo surface from the canonical script."""
    pnpm = _resolve_pnpm()
    run_repo_command([pnpm, "run", "build:ui"], cwd=EXTENSION_ROOT)
    run_repo_command(
        [
            sys.executable,
            str(PUBLISH_SURFACE_SCRIPT),
            "--sync-broken-fixture",
        ]
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


def collect_canonical_artifact_scope(
    root: Path = ARTIFACT_ROOT,
) -> dict[str, list[str]]:
    """Collect the canonical file inventory used for deterministic demo verification."""
    return {
        "data_files": list_relative_files(root / "data")
        if (root / "data").exists()
        else [],
        "report_files": list_relative_files(root / "report")
        if (root / "report").exists()
        else [],
        "metadata_files": list_relative_files(root / "metadata")
        if (root / "metadata").exists()
        else [],
    }


def collect_nonindexed_direct_files(manifest: _JsonDict) -> set[str]:
    """Collect published files that must be declared outside aggregate_index."""
    direct_paths: set[str] = {"dataset-manifest.json", "aggregates/dimensions.json"}
    features_raw = manifest.get("features")
    if features_raw is not None:
        if not isinstance(features_raw, dict):
            raise TypeError(
                f"features expected dict, got {type(features_raw).__name__}"
            )
        if features_raw.get("predictions"):
            direct_paths.add("predictions/trends.json")
        if features_raw.get("ai_insights"):
            direct_paths.add("insights/summary.json")

    return direct_paths


def validate_manifest_addressability(data_dir: Path) -> None:
    """Fail if any published demo file is not declared by the manifest."""
    manifest = load_json_file(data_dir / "dataset-manifest.json")
    published_files = narrow_mapping(manifest.get("published_files", {}))
    declared_direct: set[str] = {
        str(v) for v in narrow_sequence(published_files.get("direct", []))
    }
    declared_globs: list[str] = [
        str(v) for v in narrow_sequence(published_files.get("globs", []))
    ]
    inferred_direct = collect_nonindexed_direct_files(manifest)

    if declared_direct != inferred_direct:
        raise RuntimeError(
            "dataset-manifest.json published_files.direct does not match the "
            "canonical non-indexed file inventory.\n"
            f"declared={sorted(declared_direct)}\n"
            f"inferred={sorted(inferred_direct)}"
        )

    indexed_files = set()
    agg_index = narrow_mapping(manifest.get("aggregate_index", {}))
    for rollup in narrow_sequence(agg_index.get("weekly_rollups", [])):
        indexed_files.add(narrow_mapping(rollup)["path"])
    for distribution in narrow_sequence(agg_index.get("distributions", [])):
        indexed_files.add(narrow_mapping(distribution)["path"])

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


def stamp_canonical_manifest_provenance(data_dir: Path) -> None:
    """Stamp the manifest with the canonical committed-demo provenance contract."""
    manifest_path = data_dir / "dataset-manifest.json"
    manifest = load_json_file(manifest_path)
    prov: dict[str, JSONValue] = dict(
        build_generation_provenance(
            generator_script=CANONICAL_COMMITTED_DEMO_SCRIPT,
            generation_mode=CANONICAL_COMMITTED_DEMO_MODE,
        )
    )
    manifest["generation_provenance"] = prov
    write_json_file(manifest_path, manifest)


def ensure_demo_data_complete(data_dir: Path, *, max_retries: int = 5) -> None:
    """Wait for the generated aggregate surface to be fully materialized on disk."""
    manifest_path = data_dir / "dataset-manifest.json"
    dimensions_path = data_dir / "aggregates" / "dimensions.json"
    last_missing: list[str] = []
    for attempt in range(max_retries):
        if not manifest_path.exists() or not dimensions_path.exists():
            last_missing = [
                str(path.relative_to(data_dir)).replace("\\", "/")
                for path in (manifest_path, dimensions_path)
                if not path.exists()
            ]
        else:
            manifest = load_json_file(manifest_path)
            agg_idx = narrow_mapping(manifest.get("aggregate_index", {}))
            expected_paths = [dimensions_path]
            expected_paths.extend(
                data_dir / str(narrow_mapping(entry)["path"])
                for entry in narrow_sequence(agg_idx.get("weekly_rollups", []))
            )
            expected_paths.extend(
                data_dir / str(narrow_mapping(entry)["path"])
                for entry in narrow_sequence(agg_idx.get("distributions", []))
            )
            missing = [path for path in expected_paths if not path.exists()]
            if not missing:
                return
            last_missing = [
                str(path.relative_to(data_dir)).replace("\\", "/") for path in missing
            ]

        if attempt < max_retries - 1:
            time.sleep(0.1 * (attempt + 1))

    raise RuntimeError(
        "Canonical demo data generator did not fully materialize all indexed files. "
        f"Missing after {max_retries} attempts: {last_missing}"
    )


def restamp_final_artifact_provenance(
    data_dir: Path,
    profile_path: Path,
    *,
    generation_mode: str,
) -> None:
    """Normalize final artifact provenance under the canonical builder contract."""
    stamp_canonical_manifest_provenance(data_dir)
    profile = load_json_file(profile_path)
    prov: dict[str, JSONValue] = dict(
        build_generation_provenance(
            generator_script=CANONICAL_COMMITTED_DEMO_SCRIPT,
            generation_mode=generation_mode,
        )
    )
    profile["generation_provenance"] = prov
    write_json_file(profile_path, profile)


def validate_canonical_provenance(
    data_dir: Path,
    profile_path: Path,
    *,
    active_mode: str,
) -> None:
    """Validate provenance on the manifest (always canonical) and profile (active mode)."""
    validate_generation_provenance(
        load_json_file(data_dir / "dataset-manifest.json"),
        expected_generator_script=CANONICAL_COMMITTED_DEMO_SCRIPT,
        expected_generation_mode=CANONICAL_COMMITTED_DEMO_MODE,
        location="dataset-manifest.json",
    )
    validate_generation_provenance(
        load_json_file(profile_path),
        expected_generator_script=CANONICAL_COMMITTED_DEMO_SCRIPT,
        expected_generation_mode=active_mode,
        location="demo-profile.json",
    )


def _load_rollup_index(data_dir: Path, manifest: _JsonDict) -> dict[str, _JsonDict]:
    """Load all indexed weekly rollups keyed by week."""
    agg_index = manifest["aggregate_index"]
    if not isinstance(agg_index, dict):
        raise TypeError(
            f"aggregate_index expected dict, got {type(agg_index).__name__}"
        )
    rollups_list = agg_index["weekly_rollups"]
    if not isinstance(rollups_list, list):
        raise TypeError(
            f"aggregate_index.weekly_rollups expected list, "
            f"got {type(rollups_list).__name__}"
        )
    for idx, entry in enumerate(rollups_list):
        if not isinstance(entry, dict):
            raise TypeError(
                f"aggregate_index.weekly_rollups[{idx}] expected dict, "
                f"got {type(entry).__name__}"
            )
    return {
        entry["week"]: load_json_file(data_dir / entry["path"])
        for entry in rollups_list
    }


def _load_reviewer_fixture_metadata(
    manifest: _JsonDict,
) -> _JsonDict:
    """Load reviewer fixtures and validate the required top-level metadata."""
    reviewer_fixtures = manifest.get("reviewer_fixtures")
    if not isinstance(reviewer_fixtures, dict):
        raise RuntimeError(
            "Missing reviewer_fixtures metadata in dataset-manifest.json"
        )

    missing_keys = sorted(REQUIRED_REVIEWER_FIXTURE_KEYS - set(reviewer_fixtures))
    if missing_keys:
        raise RuntimeError(
            "Missing reviewer fixture metadata fields in dataset-manifest.json: "
            f"{missing_keys}"
        )
    return reviewer_fixtures


def _collect_reviewer_fixture_thresholds(
    reviewer_fixtures: _JsonDict,
) -> dict[str, int]:
    """Normalize integer thresholds for reviewer fixture validation."""

    def _int(key: str) -> int:
        val = reviewer_fixtures[key]
        assert isinstance(val, (int, float))
        return int(val)

    return {
        "minimum_active_reviewers": _int("minimum_active_reviewers"),
        "minimum_reviewed_prs": _int("minimum_reviewed_prs_per_reviewer"),
        "minimum_review_actions": _int("minimum_review_actions_per_reviewer"),
        "minimum_multi_repo_reviewers": _int("minimum_multi_repo_reviewers"),
    }


def _collect_eligible_reviewer_ids(
    fixture_by_reviewer: Mapping[str, _JsonDict],
    *,
    minimum_reviewed_prs: int,
    minimum_review_actions: int,
) -> list[str]:
    """Return reviewer ids that satisfy the declared reviewer activity floor."""
    result: list[str] = []
    for reviewer_id, entry in fixture_by_reviewer.items():
        reviewed = entry.get("reviewed_prs", 0)
        reviews = entry.get("reviews_count", 0)
        if (
            isinstance(reviewed, (int, float))
            and reviewed >= minimum_reviewed_prs
            and isinstance(reviews, (int, float))
            and reviews >= minimum_review_actions
        ):
            result.append(reviewer_id)
    return result


def _resolve_fixture_week_rollup(
    weekly_rollups: Mapping[str, _JsonDict],
    fixture_week: str,
) -> tuple[_JsonDict, Mapping[str, _JsonDict]]:
    """Resolve the canonical fixture rollup and its reviewer slices."""
    fixture_rollup = weekly_rollups.get(fixture_week)
    if fixture_rollup is None:
        raise RuntimeError(
            f"Reviewer fixture week '{fixture_week}' was not found in weekly rollups"
        )

    by_rev = fixture_rollup.get("by_reviewer")
    if not isinstance(by_rev, dict) or not by_rev:
        raise RuntimeError(
            f"Reviewer fixture week '{fixture_week}' is missing by_reviewer data"
        )
    fixture_by_reviewer: Mapping[str, _JsonDict] = by_rev
    if not fixture_by_reviewer:
        raise RuntimeError(
            f"Reviewer fixture week '{fixture_week}' is missing by_reviewer data"
        )
    return fixture_rollup, fixture_by_reviewer


def _validate_reviewer_filter_examples(
    *,
    filter_examples: Sequence[_JsonDict],
    weekly_rollups: Mapping[str, _JsonDict],
    reviewer_lookup: dict[str, str],
    minimum_reviewed_prs: int,
    minimum_review_actions: int,
) -> None:
    """Validate manifest-backed reviewer filter examples against rollup data."""
    for example in filter_examples:
        reviewer_id = str(example["reviewer_id"])
        example_week = str(example["week"])
        example_rollup = weekly_rollups.get(example_week)
        if example_rollup is None:
            raise RuntimeError(
                f"Reviewer filter fixture references unknown week '{example_week}'"
            )
        by_rev_raw = example_rollup.get("by_reviewer")
        if not isinstance(by_rev_raw, dict):
            raise TypeError(
                f"by_reviewer in week '{example_week}' expected dict, "
                f"got {type(by_rev_raw).__name__}"
            )
        by_reviewer_map = narrow_mapping(by_rev_raw)
        reviewer_entry = by_reviewer_map.get(reviewer_id)
        if reviewer_entry is None:
            raise RuntimeError(
                f"Reviewer filter fixture references reviewer '{reviewer_id}' "
                f"missing from week '{example_week}'"
            )
        if reviewer_lookup.get(reviewer_id) != example["reviewer_name"]:
            raise RuntimeError(
                f"Reviewer filter fixture name mismatch for reviewer '{reviewer_id}'"
            )
        reviewer_data = narrow_mapping(reviewer_entry)
        reviewed_prs = narrow_int(reviewer_data.get("reviewed_prs", 0))
        if reviewed_prs < minimum_reviewed_prs:
            raise RuntimeError(
                f"Reviewer filter fixture reviewer '{reviewer_id}' does not meet "
                "minimum reviewed PR threshold"
            )
        reviews_count = narrow_int(reviewer_data.get("reviews_count", 0))
        if reviews_count < minimum_review_actions:
            raise RuntimeError(
                f"Reviewer filter fixture reviewer '{reviewer_id}' does not meet "
                "minimum review-action threshold"
            )


def _validate_constrained_reviewer_example(
    *,
    constrained: _JsonDict,
    weekly_rollups: Mapping[str, _JsonDict],
) -> None:
    """Validate the canonical reviewer+repository constrained example."""
    constrained_rollup = weekly_rollups.get(str(constrained["week"]))
    if constrained_rollup is None:
        raise RuntimeError("reviewer_constrained_example references an unknown week")
    by_rev = constrained_rollup.get("by_reviewer")
    if not isinstance(by_rev, dict):
        raise TypeError(f"by_reviewer expected dict, got {type(by_rev).__name__}")
    if str(constrained["reviewer_id"]) not in by_rev:
        raise RuntimeError(
            "reviewer_constrained_example references a reviewer absent from the "
            "specified rollup"
        )
    by_repo = constrained_rollup.get("by_repository")
    if not isinstance(by_repo, dict):
        raise TypeError(f"by_repository expected dict, got {type(by_repo).__name__}")
    if constrained["repository_name"] not in by_repo:
        raise RuntimeError(
            "reviewer_constrained_example references a repository absent from the "
            "specified rollup"
        )


def _validate_disallowed_reviewer_team_example(
    *,
    disallowed: _JsonDict,
    weekly_rollups: Mapping[str, _JsonDict],
    team_names: set[str],
) -> None:
    """Validate the canonical disallowed reviewer+team example."""
    disallowed_rollup = weekly_rollups.get(str(disallowed["week"]))
    if disallowed_rollup is None:
        raise RuntimeError(
            "reviewer_team_disallowed_example references an unknown week"
        )
    by_rev = disallowed_rollup.get("by_reviewer")
    if not isinstance(by_rev, dict):
        raise TypeError(f"by_reviewer expected dict, got {type(by_rev).__name__}")
    if str(disallowed["reviewer_id"]) not in by_rev:
        raise RuntimeError(
            "reviewer_team_disallowed_example references a reviewer absent from the "
            "specified rollup"
        )
    if str(disallowed["team_name"]) not in team_names:
        raise RuntimeError(
            "reviewer_team_disallowed_example references an unknown team name"
        )


def validate_reviewer_fixture_contract(
    data_dir: Path,
) -> _ReviewerContractResult:
    """Validate canonical reviewer fixtures and return evidence for reporting."""
    manifest = load_json_file(data_dir / "dataset-manifest.json")
    dimensions = load_json_file(data_dir / "aggregates" / "dimensions.json")
    reviewer_fixtures = _load_reviewer_fixture_metadata(manifest)

    reviewer_lookup: dict[str, str] = {
        str(narrow_mapping(entry)["reviewer_id"]): str(
            narrow_mapping(entry)["reviewer_name"]
        )
        for entry in narrow_sequence(dimensions.get("reviewers", []))
    }
    team_names: set[str] = {
        str(narrow_mapping(entry)["team_name"])
        for entry in narrow_sequence(dimensions.get("teams", []))
    }
    weekly_rollups = _load_rollup_index(data_dir, manifest)
    thresholds = _collect_reviewer_fixture_thresholds(reviewer_fixtures)

    filter_examples_raw = reviewer_fixtures["reviewer_filter_examples"]
    if not isinstance(filter_examples_raw, list) or not filter_examples_raw:
        raise RuntimeError("reviewer_filter_examples must contain at least one fixture")
    for idx, ex in enumerate(filter_examples_raw):
        if not isinstance(ex, dict):
            raise TypeError(
                f"reviewer_filter_examples[{idx}] expected dict, "
                f"got {type(ex).__name__}"
            )
    filter_examples: list[_JsonDict] = list(filter_examples_raw)

    fixture_week = str(filter_examples[0]["week"])
    _, fixture_by_reviewer = _resolve_fixture_week_rollup(weekly_rollups, fixture_week)

    eligible_reviewer_ids = set(
        _collect_eligible_reviewer_ids(
            fixture_by_reviewer,
            minimum_reviewed_prs=thresholds["minimum_reviewed_prs"],
            minimum_review_actions=thresholds["minimum_review_actions"],
        )
    )
    multi_repo_reviewers: list[str] = []
    for reviewer_id, entry in fixture_by_reviewer.items():
        if reviewer_id not in eligible_reviewer_ids:
            continue
        repos_count = entry.get("repositories_count", 0)
        if isinstance(repos_count, (int, float)) and repos_count >= 2:
            multi_repo_reviewers.append(reviewer_id)

    if len(eligible_reviewer_ids) < thresholds["minimum_active_reviewers"]:
        raise RuntimeError(
            "Reviewer fixture contract failed: not enough active reviewers in "
            f"fixture week {fixture_week} ({len(eligible_reviewer_ids)} < "
            f"{thresholds['minimum_active_reviewers']})"
        )
    if len(multi_repo_reviewers) < thresholds["minimum_multi_repo_reviewers"]:
        raise RuntimeError(
            "Reviewer fixture contract failed: not enough multi-repository reviewers "
            f"in fixture week {fixture_week} ({len(multi_repo_reviewers)} < "
            f"{thresholds['minimum_multi_repo_reviewers']})"
        )

    _validate_reviewer_filter_examples(
        filter_examples=filter_examples,
        weekly_rollups=weekly_rollups,
        reviewer_lookup=reviewer_lookup,
        minimum_reviewed_prs=thresholds["minimum_reviewed_prs"],
        minimum_review_actions=thresholds["minimum_review_actions"],
    )
    constrained_raw = reviewer_fixtures["reviewer_constrained_example"]
    if not isinstance(constrained_raw, dict):
        raise TypeError(
            f"reviewer_constrained_example expected dict, "
            f"got {type(constrained_raw).__name__}"
        )
    _validate_constrained_reviewer_example(
        constrained=constrained_raw,
        weekly_rollups=weekly_rollups,
    )
    disallowed_raw = reviewer_fixtures["reviewer_team_disallowed_example"]
    if not isinstance(disallowed_raw, dict):
        raise TypeError(
            f"reviewer_team_disallowed_example expected dict, "
            f"got {type(disallowed_raw).__name__}"
        )
    _validate_disallowed_reviewer_team_example(
        disallowed=disallowed_raw,
        weekly_rollups=weekly_rollups,
        team_names=team_names,
    )

    return _ReviewerContractResult(
        fixture_week=fixture_week,
        active_reviewers=len(eligible_reviewer_ids),
        multi_repo_reviewers=len(multi_repo_reviewers),
        reviewer_filter_examples=len(filter_examples),
        minimum_active_reviewers=thresholds["minimum_active_reviewers"],
        minimum_multi_repo_reviewers=thresholds["minimum_multi_repo_reviewers"],
    )


def _remove_promoted_file(path: Path) -> None:
    """Remove a promoted file with a read-only-safe fallback for Windows."""
    try:
        path.unlink()
    except PermissionError:
        path.chmod(0o666)
        path.unlink()


def _remove_promoted_dir(path: Path) -> None:
    """Remove an empty promoted directory with a writable fallback."""
    try:
        path.rmdir()
    except PermissionError:
        path.chmod(0o777)
        path.rmdir()


def build_capability_matrix(data_dir: Path) -> dict[str, object]:
    """Generate a machine-readable capability coverage report."""
    manifest = load_json_file(data_dir / "dataset-manifest.json")
    dimensions = load_json_file(data_dir / "aggregates" / "dimensions.json")
    reviewer_contract = validate_reviewer_fixture_contract(data_dir)
    m_agg_index = narrow_mapping(manifest["aggregate_index"])
    m_weekly_rollups = narrow_sequence(m_agg_index["weekly_rollups"])
    first_rollup = load_json_file(
        data_dir / str(narrow_mapping(m_weekly_rollups[0])["path"])
    )
    m_capabilities = narrow_mapping(manifest.get("capabilities", {}))
    m_features = narrow_mapping(manifest.get("features", {}))
    m_coverage = narrow_mapping(manifest.get("coverage", {}))
    m_comments = narrow_mapping(m_coverage.get("comments", {}))
    d_users = narrow_sequence(dimensions["users"])
    d_authors = narrow_sequence(dimensions.get("authors", []))
    d_reviewers = narrow_sequence(dimensions.get("reviewers", []))
    fr_by_author = narrow_mapping(first_rollup.get("by_author", {}))
    fr_by_author_and_repo = narrow_mapping(first_rollup.get("by_author_and_repo", {}))
    fr_by_reviewer = narrow_mapping(first_rollup.get("by_reviewer", {}))
    fr_by_team_and_repo = narrow_mapping(first_rollup.get("by_team_and_repo", {}))
    capabilities: list[dict[str, object]] = [
        {
            "id": "long-history",
            "status": len(m_weekly_rollups) >= 156,
            "evidence": {"weekly_rollup_count": len(m_weekly_rollups)},
        },
        {
            "id": "large-user-population",
            "status": len(d_users) >= 200,
            "evidence": {"user_count": len(d_users)},
        },
        {
            "id": "author-filtering",
            "status": bool(first_rollup.get("by_author"))
            and len(d_authors) >= 50
            and m_capabilities.get("author_filters") is True,
            "evidence": {
                "authors_in_sample_week": len(fr_by_author),
                "author_dimension_count": len(d_authors),
            },
        },
        {
            "id": "author-repo-exact",
            "status": bool(first_rollup.get("by_author_and_repo"))
            and m_capabilities.get("author_repo_exact") is True,
            "evidence": {
                "authors_with_repo_entries": len(fr_by_author_and_repo),
            },
        },
        {
            "id": "reviewer-filtering",
            "status": bool(first_rollup.get("by_reviewer"))
            and len(d_reviewers) >= 50
            and reviewer_contract["active_reviewers"]
            >= reviewer_contract["minimum_active_reviewers"],
            "evidence": {
                "reviewers_in_sample_week": len(fr_by_reviewer),
                "reviewer_dimension_count": len(d_reviewers),
                "fixture_week": reviewer_contract["fixture_week"],
                "fixture_active_reviewers": reviewer_contract["active_reviewers"],
            },
        },
        {
            "id": "comments-partial-coverage",
            "status": m_comments.get("status") == "partial",
            "evidence": m_comments,
        },
        {
            "id": "reviewer-repository-constrained",
            "status": m_capabilities.get("reviewer_repository_mode") == "constrained"
            and reviewer_contract["reviewer_filter_examples"] >= 1,
            "evidence": {
                "reviewer_repository_mode": m_capabilities.get(
                    "reviewer_repository_mode"
                ),
                "fixture_week": reviewer_contract["fixture_week"],
            },
        },
        {
            "id": "reviewer-team-disallowed",
            "status": m_capabilities.get("reviewer_team_mode") == "disallowed"
            and reviewer_contract["multi_repo_reviewers"]
            >= reviewer_contract["minimum_multi_repo_reviewers"],
            "evidence": {
                "reviewer_team_mode": m_capabilities.get("reviewer_team_mode"),
                "fixture_multi_repo_reviewers": reviewer_contract[
                    "multi_repo_reviewers"
                ],
            },
        },
        {
            "id": "team-cross-dimensional",
            "status": bool(first_rollup.get("by_team_and_repo"))
            and m_features.get("cross_dimensional") is True,
            "evidence": {
                "teams_with_cross_dim": len(fr_by_team_and_repo),
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
    ]
    capability_matrix: dict[str, object] = {
        "profile": {
            "name": DEMO_PROFILE_NAME,
            "version": DEMO_PROFILE_VERSION,
        },
        "capabilities": capabilities,
    }
    capability_matrix["all_passed"] = all(cap["status"] for cap in capabilities)
    return capability_matrix


def build_startup_parity_report() -> dict[str, object]:
    """Generate normalized startup parity expectations for docs and CLI surfaces."""
    docs_html = DOCS_INDEX.read_text(encoding="utf-8")
    expected_docs_html = render_demo_html_from_path(EXTENSION_INDEX)
    docs_controls: dict[str, bool] = {
        "repo_filter_present": 'id="repo-filter-group"' in docs_html,
        "team_filter_present": 'id="team-filter-group"' in docs_html,
        "reviewer_filter_present": 'id="reviewer-filter-group"' in docs_html,
        "reviewer_notice_present": 'id="reviewer-filter-notice"' in docs_html,
        "author_filter_present": 'id="author-filter-group"' in docs_html,
        "author_notice_present": 'id="author-filter-notice"' in docs_html,
        "comments_coverage_banner_present": 'id="comments-coverage-banner"'
        in docs_html,
    }
    shell_parity = docs_html == expected_docs_html
    parity_passed: bool = (
        shell_parity
        and all(docs_controls.values())
        and "window.LOCAL_DASHBOARD_MODE = true;" in docs_html
    )
    return {
        "parity_passed": parity_passed,
        "docs": {
            "local_dashboard_mode": "window.LOCAL_DASHBOARD_MODE = true;" in docs_html,
            "dataset_path": "./data",
            "dataset_path_role": "relative-dataset-root",
            "shell_parity": shell_parity,
            "controls": docs_controls,
            "source": "docs/index.html",
            "expected_source": "extension/ui/index.html + demo_shell.render_demo_html",
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


def write_reports(data_dir: Path, *, generation_mode: str) -> dict[str, object]:
    """Write machine-readable artifact reports and return startup parity."""
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
        "artifact_scope": collect_canonical_artifact_scope(),
        "generation_provenance": build_generation_provenance(
            generator_script=CANONICAL_COMMITTED_DEMO_SCRIPT,
            generation_mode=generation_mode,
        ),
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
    return startup_parity


def promote_data(source_dir: Path, destination_dir: Path) -> None:
    """Replace docs/data atomically from the canonical artifact root."""
    destination_dir.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source_dir, destination_dir, dirs_exist_ok=True)

    source_files = set(list_relative_files(source_dir))
    destination_files = set(list_relative_files(destination_dir))

    stale_files = sorted(destination_files - source_files)
    for rel_path in stale_files:
        target = destination_dir / rel_path
        _remove_promoted_file(target)

    source_dirs = set(list_relative_dirs(source_dir))
    destination_dirs = sorted(
        rel_path
        for rel_path in list_relative_dirs(destination_dir)
        if rel_path not in source_dirs
    )
    for rel_path in reversed(destination_dirs):
        target = destination_dir / rel_path
        if target.exists():
            _remove_promoted_dir(target)

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
    if args.validate_only and not args.no_promote:
        raise RuntimeError(
            "--validate-only cannot be used with promotion; rerun with --no-promote"
        )
    reset_canonical_artifact_root()

    if args.validate_only:
        print("[demo-build] validate-only: using committed docs/data")
        shutil.copytree(DOCS_DATA_DIR, ARTIFACT_DATA_DIR, dirs_exist_ok=True)
        active_mode = VALIDATED_COMMITTED_DEMO_MODE
    else:
        require_demo_generation_baseline(CANONICAL_COMMITTED_DEMO_SCRIPT)
        for script_name in GENERATOR_STEPS:
            print(f"[demo-build] running {script_name}")
            run_generator(script_name, ARTIFACT_DATA_DIR)
            if script_name == "generate-demo-data.py":
                ensure_demo_data_complete(ARTIFACT_DATA_DIR)
        stamp_canonical_manifest_provenance(ARTIFACT_DATA_DIR)
        active_mode = CANONICAL_COMMITTED_DEMO_MODE

    validate_manifest_addressability(ARTIFACT_DATA_DIR)
    startup_parity = write_reports(ARTIFACT_DATA_DIR, generation_mode=active_mode)
    restamp_final_artifact_provenance(
        ARTIFACT_DATA_DIR,
        ARTIFACT_METADATA_DIR / "demo-profile.json",
        generation_mode=active_mode,
    )
    validate_canonical_provenance(
        ARTIFACT_DATA_DIR,
        ARTIFACT_METADATA_DIR / "demo-profile.json",
        active_mode=active_mode,
    )

    if not args.no_promote:
        promote_dir = args.promote_dir.resolve()
        if promote_dir == DOCS_DATA_DIR.resolve():
            print("[demo-build] refreshing canonical docs surface")
            ensure_canonical_demo_surface()
        print(f"[demo-build] promoting {ARTIFACT_DATA_DIR} -> {promote_dir}")
        promote_data(ARTIFACT_DATA_DIR, promote_dir)
        if (
            promote_dir == DOCS_DATA_DIR.resolve()
            and not startup_parity["parity_passed"]
        ):
            raise RuntimeError(
                "Published docs shell is out of parity with extension/ui/index.html. "
                "Run `pnpm --dir extension run build:ui` and "
                "`python scripts/publish-demo-surface.py` before promoting docs/data."
            )

    print("[demo-build] complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
