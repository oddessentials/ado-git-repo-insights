#!/usr/bin/env python3
"""Build the canonical enterprise demo dataset and promote it to docs/data."""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import shutil
import subprocess
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import TYPE_CHECKING, Final, TypedDict

if TYPE_CHECKING:
    from ado_git_repo_insights.types import JSONValue

from demo_generation_common import (
    CANONICAL_COMMITTED_DEMO_MODE,
    CANONICAL_COMMITTED_DEMO_SCRIPT,
    VALIDATED_COMMITTED_DEMO_MODE,
    assert_safe_output_root,
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
from strip_pr_arrays import (
    SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME,
    strip_nested_reviewer_prs_from_rollups,
    strip_pr_arrays_from_rollups,
)

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

# Feature 310 (R-08): capability-off demo-variant artifact root.  The
# canonical capability-on artifact lives at ``ARTIFACT_ROOT`` above;
# this sibling root hosts the same generated data with the three
# comments-metrics keys stripped at the serialization layer.  Both
# variants are byte-identical except for the five gated keys —
# ``tests/integration/test_demo_variants_byte_identity.py`` enforces
# the contract.
VARIANT_OFF_ARTIFACT_ROOT = Path(
    os.environ.get(
        "ADO_DEMO_VARIANT_OFF_ARTIFACT_ROOT",
        str(REPO_ROOT / "artifacts" / "demo-enterprise-comments-off"),
    )
).resolve()
VARIANT_OFF_DATA_DIR = VARIANT_OFF_ARTIFACT_ROOT / "data"
DOCS_DATA_DIR = REPO_ROOT / "docs" / "data"
DOCS_DIR = REPO_ROOT / "docs"
DOCS_INDEX = REPO_ROOT / "docs" / "index.html"
EXTENSION_INDEX = REPO_ROOT / "extension" / "ui" / "index.html"
PUBLISH_SURFACE_SCRIPT = REPO_ROOT / "scripts" / "publish-demo-surface.py"
EXTENSION_ROOT = REPO_ROOT / "extension"

DEMO_PROFILE_NAME = "enterprise-demo"
DEMO_PROFILE_VERSION = "2.1.0"
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
    parser.add_argument(
        "--allow-dirty-inputs",
        action="store_true",
        help=(
            "Local-dev only: skip the staged-vs-worktree guard on demo-build "
            "inputs. MUST NOT be combined with promotion; the script aborts "
            "if --allow-dirty-inputs is set without --no-promote."
        ),
    )
    parser.add_argument(
        "--commit-canonical",
        action="store_true",
        help=(
            "Permit writes to committed canonical demo paths "
            "(docs/data, artifacts/demo-enterprise, "
            "artifacts/demo-enterprise-comments-off). Reserved for the "
            "CI demo-regeneration workflow."
        ),
    )
    return parser.parse_args(argv)


DEMO_BUILD_INPUTS: Final[list[Path]] = [
    Path("scripts/build-demo-dataset.py"),
    Path("scripts/generate-demo-data.py"),
    Path("scripts/generate-demo-insights.py"),
    Path("scripts/generate-demo-predictions.py"),
    Path("scripts/demo_generation_common.py"),
    Path("scripts/strip_pr_arrays.py"),
    Path("scripts/demo-distributions/title-tokens.json"),
    Path("scripts/demo-distributions/cycle-time-per-repo-size.json"),
    Path("scripts/demo-distributions/author-concentration.json"),
    Path("scripts/demo-distributions/pr-count-per-week-per-repo.json"),
    Path("scripts/demo-distributions/truncation-exercise-week.json"),
]


class UncommittedInputsError(RuntimeError):
    """Raised when demo-build inputs have unstaged or staged-but-not-in-HEAD changes.

    The guard rejects any combination of staged + worktree
    state that cannot be reproduced from a single git commit, ensuring the
    promotion step operates on a reviewable snapshot only.
    """


def _run_git_input_diff(repo_root: Path, flag: str, inputs: list[Path]) -> str:
    """Invoke ``git diff {flag} --name-only -- <inputs>`` and return stdout."""
    argv: list[str] = ["git", "diff"]
    if flag:
        argv.append(flag)
    argv.extend(["--name-only", "--"])
    argv.extend(p.as_posix() for p in inputs)
    git_result = subprocess.run(
        argv,
        cwd=str(repo_root),
        capture_output=True,
        text=True,
        check=True,
    )
    return git_result.stdout.strip()


def assert_inputs_clean(
    repo_root: Path,
    inputs: list[Path],
    *,
    allow_dirty: bool = False,
) -> None:
    """Verify every path in ``inputs`` is byte-identical to HEAD, staged and worktree.

    Raises :class:`UncommittedInputsError` with distinct messages for staged
    vs. unstaged drift. Set ``allow_dirty=True`` for local-only iteration
    where the resulting build will NOT be promoted.
    """
    if allow_dirty:
        return
    staged = _run_git_input_diff(repo_root, "--cached", inputs)
    if staged:
        raise UncommittedInputsError(f"[demo-build] staged changes in inputs: {staged}")
    unstaged = _run_git_input_diff(repo_root, "", inputs)
    if unstaged:
        raise UncommittedInputsError(
            f"[demo-build] unstaged changes in inputs: {unstaged}"
        )


def run_generator(
    script_name: str,
    output_root: Path,
    *,
    extra_args: Sequence[str] = (),
) -> None:
    """Run a demo generator against the canonical output root.

    Feature 310 extends the signature with ``extra_args`` so
    ``build-demo-dataset.py`` can pass ``--comments-metrics=false`` to
    ``generate-demo-data.py`` when producing the capability-off variant
    (R-08).  Default keeps the canonical path unchanged.
    """
    script_path = REPO_ROOT / "scripts" / script_name
    command: list[str] = [
        sys.executable,
        str(script_path),
        "--output-root",
        str(output_root),
    ]
    if script_name == "generate-demo-data.py":
        command.append("--commit-canonical")
    command.extend(extra_args)
    gen_result = subprocess.run(
        command,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if gen_result.returncode != 0:
        raise RuntimeError(
            f"{script_name} failed with exit code {gen_result.returncode}\n"
            f"STDOUT:\n{gen_result.stdout}\nSTDERR:\n{gen_result.stderr}"
        )


def build_variant_off_artifact() -> None:
    """Produce ``artifacts/demo-enterprise-comments-off/`` (Feature 310 R-08).

    Runs the canonical generator steps against
    ``VARIANT_OFF_DATA_DIR`` with ``--comments-metrics=false`` passed
    only to ``generate-demo-data.py`` (the other generators don't know
    the flag and don't emit any of the five gated keys).  Does NOT
    promote or stamp this variant onto ``docs/data/`` — the variant-
    off tree exists exclusively for the SC-03 DOM baseline test and
    for the R-08 byte-identity integration test; the canonical
    variant-on artifact remains the docs/data/ source of truth.
    """
    print(f"[demo-build] building variant-off artifact at {VARIANT_OFF_ARTIFACT_ROOT}")
    _remove_tree(VARIANT_OFF_DATA_DIR)
    VARIANT_OFF_DATA_DIR.mkdir(parents=True, exist_ok=True)
    for script_name in GENERATOR_STEPS:
        print(f"[demo-build] running {script_name} (variant-off)")
        if script_name == "generate-demo-data.py":
            run_generator(
                script_name,
                VARIANT_OFF_DATA_DIR,
                extra_args=("--comments-metrics", "false"),
            )
            ensure_demo_data_complete(VARIANT_OFF_DATA_DIR)
        else:
            run_generator(script_name, VARIANT_OFF_DATA_DIR)
    stamp_canonical_manifest_provenance(VARIANT_OFF_DATA_DIR)


def run_repo_command(command: list[str], *, cwd: Path = REPO_ROOT) -> None:
    """Run a repo-managed command and raise a detailed error on failure."""
    repo_result = subprocess.run(
        command,
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )
    if repo_result.returncode != 0:
        raise RuntimeError(
            f"Command failed with exit code {repo_result.returncode}: {' '.join(command)}\n"
            f"STDOUT:\n{repo_result.stdout}\nSTDERR:\n{repo_result.stderr}"
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


def prepare_validate_only_artifact_root() -> None:
    """Prepare an isolated validate-only artifact root from committed docs/data.

    Validate-only mode treats ``docs/data`` as the committed source of truth and
    rebuilds the artifact surface from that snapshot. The copy step must exclude
    gitignored files such as local ``*.sqlite`` extraction remnants, otherwise
    manifest addressability checks would fail on files that are not part of the
    canonical published demo surface.
    """
    _remove_tree(ARTIFACT_DATA_DIR)
    _remove_tree(ARTIFACT_REPORT_DIR)
    _remove_tree(ARTIFACT_METADATA_DIR)
    shutil.copytree(
        DOCS_DATA_DIR,
        ARTIFACT_DATA_DIR,
        ignore=_gitignored_copytree_ignore(DOCS_DATA_DIR),
    )
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


def _gitignored_copytree_ignore(
    source_root: Path,
) -> Callable[[str, list[str]], set[str]]:
    """Return a ``shutil.copytree`` *ignore* callback that skips gitignored files.

    Queries ``git check-ignore`` once per directory visited by copytree.
    """

    def _ignore(directory: str, contents: list[str]) -> set[str]:
        dir_path = Path(directory)
        children = [str(dir_path / name) for name in contents]
        if not children:
            return set()
        input_bytes = "\n".join(children).encode("utf-8")
        result = subprocess.run(
            ["git", "check-ignore", "--stdin"],
            input=input_bytes,
            capture_output=True,
            cwd=str(source_root),
        )
        if result.returncode not in (0, 1):
            return set()
        # Git quotes and double-escapes backslashes on Windows.
        # Normalize via Path() to get consistent OS-native separators.
        ignored_abs: set[Path] = set()
        for raw_line in result.stdout.decode("utf-8", errors="replace").splitlines():
            cleaned = raw_line.strip().strip('"').replace("\\\\", "\\")
            if cleaned:
                ignored_abs.add(Path(cleaned))
        return {name for name in contents if (dir_path / name) in ignored_abs}

    return _ignore


def _filter_gitignored(root: Path, paths: list[str]) -> list[str]:
    """Remove gitignored paths from *paths* (relative to *root*).

    Uses ``git check-ignore --stdin`` so that untracked artifacts left by
    other pipelines (e.g. an ``.sqlite`` from a real extraction run) do
    not trip the manifest addressability validator.

    If *root* itself is inside a gitignored directory (e.g. a temp
    directory used in tests), filtering is skipped entirely — otherwise
    every file would be classified as ignored.

    Uses bytes-mode stdin to avoid Windows text-mode ``\\r\\n`` corruption
    that silently breaks newline-separated batch input.
    """
    if not paths:
        return paths
    # If the root dir itself is gitignored, all children would be too.
    # Skip filtering so the validator still checks actual files.
    root_check = subprocess.run(
        ["git", "check-ignore", "-q", str(root.resolve())],
        capture_output=True,
    )
    if root_check.returncode == 0:
        # root is gitignored — skip filtering
        return paths
    input_bytes = "\n".join(paths).encode("utf-8")
    result = subprocess.run(
        ["git", "check-ignore", "--stdin"],
        input=input_bytes,
        capture_output=True,
        cwd=str(root),
    )
    if result.returncode not in (0, 1):
        # 0 = some ignored, 1 = none ignored; anything else is an error.
        return paths
    ignored_rel: set[str] = set()
    for raw_line in result.stdout.decode("utf-8", errors="replace").splitlines():
        cleaned = raw_line.strip().strip('"').replace("\\", "/")
        if cleaned:
            ignored_rel.add(cleaned)
    if not ignored_rel:
        return paths
    return [f for f in paths if f not in ignored_rel]


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

    actual_files = _filter_gitignored(data_dir, list_relative_files(data_dir))
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
        if not isinstance(val, (int, float)):
            raise TypeError(
                f"reviewer_fixtures[{key!r}] expected numeric, got {type(val).__name__}"
            )
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
        if not isinstance(reviewed, (int, float)):
            raise TypeError(
                f"reviewer '{reviewer_id}' has non-numeric reviewed_prs: "
                f"{type(reviewed).__name__} (value={reviewed!r})"
            )
        if not isinstance(reviews, (int, float)):
            raise TypeError(
                f"reviewer '{reviewer_id}' has non-numeric reviews_count: "
                f"{type(reviews).__name__} (value={reviews!r})"
            )
        if reviewed >= minimum_reviewed_prs and reviews >= minimum_review_actions:
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
        if not isinstance(repos_count, (int, float)):
            raise TypeError(
                f"reviewer '{reviewer_id}' has non-numeric repositories_count: "
                f"{type(repos_count).__name__} (value={repos_count!r})"
            )
        if repos_count >= 2:
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


class SyntheticShapeError(RuntimeError):
    """Raised when a sentinel-present source violates the synthetic PR-record shape.

    The fail-closed gate on the sentinel-present branch of ``promote_data``
    raises this before any destination mutation occurs, preserving atomicity.
    """


_SYNTHETIC_PR_CAP: Final[int] = 500


def _synthetic_shape_violations(rollup_path: Path) -> list[str]:
    """Return the rule violations (if any) for a single weekly rollup.

    Rules (contract §3):
        * ``_prs_cap`` MUST equal 500 everywhere it appears.
        * ``pr_count == 0`` rollups MUST have none of ``prs`` / ``_prs_truncated``
          / ``_prs_cap`` OR have them all with ``len(prs) == 0`` and
          ``_prs_truncated == False`` and ``_prs_cap == 500``.
        * ``pr_count > 0`` rollups MUST have all three keys; ``len(prs)`` MUST
          be ``<= _prs_cap``; ``prs`` MUST be sorted by ``(-cycle_time, id)``.
    """
    violations: list[str] = []
    with rollup_path.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    if not isinstance(payload, dict):
        return [f"{rollup_path.name}: rollup JSON must be an object"]

    has_prs = "prs" in payload
    has_trunc = "_prs_truncated" in payload
    has_cap = "_prs_cap" in payload
    pr_count_raw = payload.get("pr_count", 0)
    pr_count = int(pr_count_raw) if isinstance(pr_count_raw, (int, float)) else 0

    if has_cap and payload["_prs_cap"] != _SYNTHETIC_PR_CAP:
        violations.append(
            f"{rollup_path.name}: _prs_cap must be {_SYNTHETIC_PR_CAP} everywhere, "
            f"found {payload['_prs_cap']!r}"
        )

    if pr_count == 0:
        if has_prs or has_trunc or has_cap:
            if not (has_prs and has_trunc and has_cap):
                violations.append(
                    f"{rollup_path.name}: pr_count=0 requires either all three "
                    "PR-level keys absent or all three present with empty prs"
                )
            else:
                prs_val = payload["prs"]
                if (
                    not isinstance(prs_val, list)
                    or prs_val
                    or payload["_prs_truncated"] is not False
                ):
                    violations.append(
                        f"{rollup_path.name}: pr_count=0 with keys present must have "
                        "len(prs)==0 and _prs_truncated==False"
                    )
        return violations

    if not (has_prs and has_trunc and has_cap):
        missing = [k for k in ("prs", "_prs_truncated", "_prs_cap") if k not in payload]
        violations.append(
            f"{rollup_path.name}: pr_count>0 requires all three PR-level keys; "
            f"missing {missing}"
        )
        return violations

    prs = payload["prs"]
    if not isinstance(prs, list):
        violations.append(f"{rollup_path.name}: prs must be a list")
        return violations

    cap = payload["_prs_cap"] if isinstance(payload["_prs_cap"], int) else 0
    if len(prs) > cap:
        violations.append(
            f"{rollup_path.name}: len(prs)={len(prs)} exceeds _prs_cap={cap}"
        )

    for record in prs:
        if not isinstance(record, dict):
            violations.append(f"{rollup_path.name}: every prs entry must be an object")
            return violations
        missing_fields = [
            k
            for k in ("id", "title", "author_id", "repository_id", "cycle_time")
            if k not in record
        ]
        if missing_fields:
            violations.append(
                f"{rollup_path.name}: PR record missing fields {missing_fields}"
            )
            return violations

    expected_order = sorted(prs, key=lambda r: (-float(r["cycle_time"]), int(r["id"])))
    if prs != expected_order:
        violations.append(
            f"{rollup_path.name}: prs must be sorted by (-cycle_time, id)"
        )

    return violations


def assert_synthetic_shape(aggregates_dir: Path) -> None:
    """Verify every weekly rollup under ``aggregates_dir`` matches the synthetic contract.

    Raises :class:`SyntheticShapeError` listing every offending rollup if any
    rule is violated.
    """
    rollup_dir = aggregates_dir / "weekly_rollups"
    if not rollup_dir.is_dir():
        raise SyntheticShapeError(
            f"Expected weekly_rollups directory under {aggregates_dir}"
        )
    all_violations: list[str] = []
    for rollup_path in sorted(rollup_dir.glob("*.json")):
        all_violations.extend(_synthetic_shape_violations(rollup_path))
    if all_violations:
        raise SyntheticShapeError(
            "Synthetic-shape violations on sentinel-present source:\n  "
            + "\n  ".join(all_violations)
        )


def promote_data(source_dir: Path, destination_dir: Path) -> None:
    """Replace the destination atomically from the canonical artifact root.

    When ``destination_dir`` is the public demo surface (``DOCS_DATA_DIR``),
    behavior branches on the presence of the synthetic-authorization sentinel
    (``scripts/strip_pr_arrays.SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME``) at
    ``source_dir / 'aggregates' /`` — feature-309 binary gate.

        * Sentinel PRESENT: ``assert_synthetic_shape`` fails closed on any
          shape violation; otherwise ``sentinel.unlink()`` runs FIRST (before
          any destination mutation), the rollup-root PR trio survives the
          copytree (the #309 / #315 binary gate), and the Feature-362
          nested ``by_reviewer[*]`` PR trio is stripped on the
          DESTINATION aggregates tree AFTER ``copytree`` via
          ``strip_nested_reviewer_prs_from_rollups`` so the public synthetic
          surface stays free of per-(reviewer, week) detail (FR-028).  The
          source aggregates tree is byte-preserved across the call — it
          remains the canonical private tenant artifact carrying both
          rollup-root PR detail and ``by_reviewer[*]`` nested detail.
        * Sentinel ABSENT: the legacy feature-060 strip helper
          (``strip_pr_arrays_from_rollups``) runs; PR-level fields at BOTH
          depths are stripped from the source tree before copytree.

    Every other destination (private tenant artifacts, non-promotion scratch
    paths) preserves the existing non-gated behavior.

    On ANY pre-copytree failure (shape violation, unlink OSError, sentinel-
    absent strip residue, mkdir error, copytree error) the destination
    directory is byte-identical to its pre-call state.  Post-copytree
    mutations on the destination run in the following ORDER (the order is
    a tested contract — see
    ``test_sentinel_present_promotion_skips_stale_destination_rollups``):

      1. stale-file cleanup (``destination_files - source_files``);
      2. stale-directory cleanup;
      3. sentinel-present depth-2 strip on
         ``destination_dir / 'aggregates'``.

    The strip is LAST so the walker never sees rollups left from a previous
    build whose schema or shape would fail closed inside ``_load_rollup``.
    A mid-mutation OSError in any of these post-copytree steps leaves the
    destination partially mutated, mirroring the existing post-copytree
    atomicity envelope.  See
    ``tests/unit/test_promote_data_unlink_ordering.py`` and
    ``tests/demo/test_demo_parity_pipeline.py::TestPromoteDataStripGateAtomicity``.
    """
    sentinel_was_present_for_promotion = False
    if destination_dir.resolve() == DOCS_DATA_DIR.resolve():
        aggregates = source_dir / "aggregates"
        sentinel = aggregates / SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME
        if sentinel.exists():
            assert_synthetic_shape(aggregates)
            sentinel.unlink()
            # The sentinel-present depth-2 strip is HOISTED to AFTER
            # copytree so the source aggregates tree is byte-preserved
            # across this call.  The canonical private tenant artifact
            # at ``source_dir`` retains its full producer-emitted shape
            # (rollup-root PR trio AND nested ``by_reviewer[*]`` trio);
            # only the destination (``docs/data``) is stripped of the
            # nested per-(reviewer, week) detail.
            sentinel_was_present_for_promotion = True
        else:
            assert not sentinel.exists(), (
                "Sentinel path toggled between exists() check and else-branch "
                "reached — destination identity check must remain monotonic."
            )
            strip_pr_arrays_from_rollups(aggregates)

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

    if sentinel_was_present_for_promotion:
        # Strip nested reviewer PR detail on the DESTINATION aggregates only
        # (FR-028 + Codex P1 against an earlier in-place-on-source revision
        # of this branch).  Runs AFTER the stale-file cleanup above so the
        # strip walker never sees rollups from a previous build that aren't
        # in the current source — those would be malformed against the
        # current schema and the strip's ``_load_rollup`` would fail closed.
        # Source is never touched (the canonical private tenant artifact is
        # byte-preserved across this call).
        strip_nested_reviewer_prs_from_rollups(destination_dir / "aggregates")

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
    if args.allow_dirty_inputs and not args.no_promote:
        raise RuntimeError(
            "--allow-dirty-inputs must be combined with --no-promote; promotion "
            "onto docs/data/ requires a staged snapshot (contract: byte-determinism-regen.md §11)."
        )
    if not args.validate_only:
        assert_safe_output_root(
            ARTIFACT_DATA_DIR, commit_canonical=args.commit_canonical
        )
        assert_safe_output_root(
            VARIANT_OFF_DATA_DIR, commit_canonical=args.commit_canonical
        )
        if not args.no_promote:
            assert_safe_output_root(
                args.promote_dir, commit_canonical=args.commit_canonical
            )
    assert_inputs_clean(
        REPO_ROOT,
        DEMO_BUILD_INPUTS,
        allow_dirty=args.allow_dirty_inputs,
    )

    if args.validate_only:
        prepare_validate_only_artifact_root()
        print("[demo-build] validate-only: using committed docs/data")
        active_mode = VALIDATED_COMMITTED_DEMO_MODE
    else:
        reset_canonical_artifact_root()
        require_demo_generation_baseline(CANONICAL_COMMITTED_DEMO_SCRIPT)
        for script_name in GENERATOR_STEPS:
            print(f"[demo-build] running {script_name}")
            run_generator(script_name, ARTIFACT_DATA_DIR)
            if script_name == "generate-demo-data.py":
                ensure_demo_data_complete(ARTIFACT_DATA_DIR)
        stamp_canonical_manifest_provenance(ARTIFACT_DATA_DIR)
        # Feature 310 R-08: produce the capability-off demo variant
        # immediately after the canonical capability-on build so both
        # trees are regenerated in the same invocation with matching
        # seed state.  This variant never promotes to docs/data/; it
        # exists only as a fixture for the SC-03 baseline DOM test and
        # the R-08 byte-identity integration test.
        build_variant_off_artifact()
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
        # Feature 309 binary gate: write the synthetic-authorization sentinel
        # between generator completion and promote_data. The gate consumes +
        # unlinks it atomically (contract: demo-strip-gate-v2.md §1;
        # synthetic-authorization-signal.md §3). exist_ok=False fails loudly
        # on a stale sentinel from an aborted prior run.
        sentinel_path = (
            ARTIFACT_DATA_DIR / "aggregates" / SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME
        )
        sentinel_path.touch(exist_ok=False)
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
