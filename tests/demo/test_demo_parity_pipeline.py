"""Tests for the canonical enterprise demo build and promotion pipeline."""

import atexit
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from itertools import count
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
BUILD_SCRIPT = REPO_ROOT / "scripts" / "build-demo-dataset.py"
ARTIFACT_ROOT = REPO_ROOT / "artifacts" / "demo-enterprise"
ARTIFACT_DATA = ARTIFACT_ROOT / "data"
ARTIFACT_REPORT = ARTIFACT_ROOT / "report"
ARTIFACT_METADATA = ARTIFACT_ROOT / "metadata"
TEST_TMP_ROOT = REPO_ROOT / "tmp_test_work"
_SCRATCH_COUNTER = count()


def _load_demo_generation_common():
    script_path = REPO_ROOT / "scripts" / "demo_generation_common.py"
    spec = importlib.util.spec_from_file_location("demo_generation_common", script_path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"Unable to load shared demo module: {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_DEMO_GENERATION_COMMON = _load_demo_generation_common()
CANONICAL_COMMITTED_DEMO_MODE = _DEMO_GENERATION_COMMON.CANONICAL_COMMITTED_DEMO_MODE
VALIDATED_COMMITTED_DEMO_MODE = _DEMO_GENERATION_COMMON.VALIDATED_COMMITTED_DEMO_MODE
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


def _cleanup_test_tmp_root() -> None:
    """Best-effort cleanup for repo-local scratch directories created by tests."""
    shutil.rmtree(TEST_TMP_ROOT, ignore_errors=True)


atexit.register(_cleanup_test_tmp_root)


@pytest.fixture(autouse=True)
def isolate_artifact_root(monkeypatch: pytest.MonkeyPatch) -> None:
    """Give each test a fresh canonical artifact root to avoid cross-test collisions."""
    artifact_root = make_scratch_dir("artifact-root")
    monkeypatch.setenv("ADO_DEMO_ARTIFACT_ROOT", str(artifact_root))
    module = sys.modules[__name__]
    monkeypatch.setattr(module, "ARTIFACT_ROOT", artifact_root)
    monkeypatch.setattr(module, "ARTIFACT_DATA", artifact_root / "data")
    monkeypatch.setattr(module, "ARTIFACT_REPORT", artifact_root / "report")
    monkeypatch.setattr(module, "ARTIFACT_METADATA", artifact_root / "metadata")


def load_build_module():
    """Load build-demo-dataset.py as a Python module for direct contract testing."""
    script_dir = str(BUILD_SCRIPT.parent)
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)
    spec = importlib.util.spec_from_file_location("build_demo_dataset", BUILD_SCRIPT)
    if spec is None or spec.loader is None:
        raise AssertionError(f"Unable to load build script module: {BUILD_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def make_scratch_dir(prefix: str) -> Path:
    """Create a repo-local scratch directory for promotion and mutation tests."""
    TEST_TMP_ROOT.mkdir(parents=True, exist_ok=True)
    scratch_dir = TEST_TMP_ROOT / f"{prefix}-{next(_SCRATCH_COUNTER):04d}"
    while scratch_dir.exists():
        scratch_dir = TEST_TMP_ROOT / f"{prefix}-{next(_SCRATCH_COUNTER):04d}"
    scratch_dir.mkdir(parents=True, exist_ok=False)
    return scratch_dir


def make_scratch_path(prefix: str) -> Path:
    """Reserve a unique repo-local scratch path without creating it."""
    TEST_TMP_ROOT.mkdir(parents=True, exist_ok=True)
    scratch_path = TEST_TMP_ROOT / f"{prefix}-{next(_SCRATCH_COUNTER):04d}"
    while scratch_path.exists():
        scratch_path = TEST_TMP_ROOT / f"{prefix}-{next(_SCRATCH_COUNTER):04d}"
    return scratch_path


def run_demo_build(*, promote_dir: Path | None = None, promote: bool = False) -> None:
    """Run the canonical enterprise demo build."""
    if promote and not _IS_BASELINE_PYTHON:
        raise AssertionError(
            "run_demo_build() cannot combine off-baseline validate-only mode with promotion"
        )
    args = [sys.executable, str(BUILD_SCRIPT)]
    if not _IS_BASELINE_PYTHON:
        args.append("--validate-only")
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


def run_demo_validate_only() -> None:
    """Run validate-only mode explicitly against committed docs/data."""
    args = [sys.executable, str(BUILD_SCRIPT), "--validate-only", "--no-promote"]
    result = subprocess.run(  # noqa: S603
        args,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, (
        f"build-demo-dataset.py --validate-only failed: {result.stderr or result.stdout}"
    )


def run_demo_validate_only_with_promote() -> subprocess.CompletedProcess[str]:
    """Run validate-only mode without --no-promote to assert it is rejected."""
    return subprocess.run(  # noqa: S603
        [sys.executable, str(BUILD_SCRIPT), "--validate-only"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


class TestCanonicalArtifactRoot:
    """Canonical build output is generated under artifacts/demo-enterprise."""

    def test_build_uses_isolated_scratch_artifact_root(self) -> None:
        assert ARTIFACT_ROOT.parent == TEST_TMP_ROOT
        assert ARTIFACT_ROOT != REPO_ROOT / "artifacts" / "demo-enterprise"

    def test_build_creates_canonical_artifacts(self) -> None:
        run_demo_build()

        assert (ARTIFACT_DATA / "dataset-manifest.json").exists()
        assert (ARTIFACT_REPORT / "capability-matrix.json").exists()
        assert (ARTIFACT_REPORT / "startup-parity.json").exists()
        assert (ARTIFACT_METADATA / "demo-profile.json").exists()

    if _IS_BASELINE_PYTHON:

        def test_docs_promotion_matches_canonical_bytes(self) -> None:
            # Promotion exercises the canonical publishing path and is covered
            # only on the approved baseline interpreter. Non-baseline jobs
            # validate the non-promoting artifact boundary instead.
            promoted_dir = make_scratch_dir("published-demo")
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

    def test_promotion_cleans_stale_files(self) -> None:
        run_demo_build()
        build_module = load_build_module()
        promoted_dir = make_scratch_dir("published-demo-stale")
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

        removed_files: set[str] = set()
        removed_dirs: set[str] = set()
        original_list_relative_files = build_module.list_relative_files
        original_list_relative_dirs = build_module.list_relative_dirs

        def remove_file(path: Path) -> None:
            removed_files.add(str(path.relative_to(promoted_dir)).replace("\\", "/"))

        def remove_dir(path: Path) -> None:
            removed_dirs.add(str(path.relative_to(promoted_dir)).replace("\\", "/"))

        def list_relative_files(root: Path) -> list[str]:
            paths = original_list_relative_files(root)
            if root == promoted_dir:
                return [path for path in paths if path not in removed_files]
            return paths

        def list_relative_dirs(root: Path) -> list[str]:
            paths = original_list_relative_dirs(root)
            if root == promoted_dir:
                return [path for path in paths if path not in removed_dirs]
            return paths

        build_module._remove_promoted_file = remove_file
        build_module._remove_promoted_dir = remove_dir
        build_module.list_relative_files = list_relative_files
        build_module.list_relative_dirs = list_relative_dirs
        build_module.promote_data(ARTIFACT_DATA, promoted_dir)

        assert "stale-demo-file.json" in removed_files
        assert "stale-dir/nested" in removed_dirs
        assert "stale-dir" in removed_dirs

    def test_validate_only_cleans_stale_canonical_artifacts(self) -> None:
        ARTIFACT_DATA.mkdir(parents=True, exist_ok=True)
        ARTIFACT_REPORT.mkdir(parents=True, exist_ok=True)
        ARTIFACT_METADATA.mkdir(parents=True, exist_ok=True)
        (ARTIFACT_DATA / "stale.json").write_text(
            '{"stale": true}\n',
            encoding="utf-8",
            newline="\n",
        )
        (ARTIFACT_REPORT / "stale.json").write_text(
            '{"stale": true}\n',
            encoding="utf-8",
            newline="\n",
        )
        (ARTIFACT_METADATA / "stale.json").write_text(
            '{"stale": true}\n',
            encoding="utf-8",
            newline="\n",
        )

        run_demo_validate_only()

        assert not (ARTIFACT_DATA / "stale.json").exists()
        assert not (ARTIFACT_REPORT / "stale.json").exists()
        assert not (ARTIFACT_METADATA / "stale.json").exists()

    def test_validate_only_rejects_promotion(self) -> None:
        result = run_demo_validate_only_with_promote()
        assert result.returncode != 0
        assert (
            "--validate-only cannot be used with promotion; rerun with --no-promote"
            in (result.stderr or result.stdout)
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
        assert report["docs"]["shell_parity"] is True
        assert report["docs"]["controls"]["reviewer_filter_present"] is True
        assert report["docs"]["controls"]["author_filter_present"] is True
        assert report["docs"]["controls"]["comments_coverage_banner_present"] is True
        assert report["cli"]["dataset_path_role"] == "relative-dataset-root"
        assert report["normalized"]["local_dashboard_mode"] is True

    def test_docs_shell_includes_new_filter_surface(self) -> None:
        run_demo_build()
        docs_html = (REPO_ROOT / "docs" / "index.html").read_text(encoding="utf-8")

        assert 'id="reviewer-filter-group"' in docs_html
        assert 'id="author-filter-group"' in docs_html
        assert 'id="reviewer-filter-notice"' in docs_html
        assert 'id="comments-coverage-banner"' in docs_html
        assert 'data-testid="filter-author"' in docs_html

    def test_demo_dimensions_include_author_and_reviewer_lookups(self) -> None:
        run_demo_build()
        dimensions = json.loads(
            (ARTIFACT_DATA / "aggregates" / "dimensions.json").read_text(
                encoding="utf-8"
            )
        )

        assert len(dimensions.get("authors", [])) >= 50
        assert len(dimensions.get("reviewers", [])) >= 50

    def test_demo_user_display_names_are_unique_and_number_free(self) -> None:
        run_demo_build()
        dimensions = json.loads(
            (ARTIFACT_DATA / "aggregates" / "dimensions.json").read_text(
                encoding="utf-8"
            )
        )
        display_names = [entry["display_name"] for entry in dimensions["users"]]

        assert len(display_names) >= 200
        assert len(set(display_names)) == len(display_names)
        assert all(not re.search(r"\d", name) for name in display_names), (
            "Synthetic display names must not contain numeric suffixes"
        )

    def test_demo_rollups_include_reviewer_breakdowns(self) -> None:
        run_demo_build()
        sample_rollup = json.loads(
            (
                ARTIFACT_DATA / "aggregates" / "weekly_rollups" / "2025-W52.json"
            ).read_text(encoding="utf-8")
        )

        assert len(sample_rollup.get("by_author", {})) > 0
        assert len(sample_rollup.get("by_author_and_repo", {})) > 0
        assert len(sample_rollup.get("by_reviewer", {})) > 0

    def test_manifest_declares_reviewer_fixture_metadata(self) -> None:
        run_demo_build()
        manifest = json.loads(
            (ARTIFACT_DATA / "dataset-manifest.json").read_text(encoding="utf-8")
        )

        fixtures = manifest.get("reviewer_fixtures")
        assert isinstance(fixtures, dict)
        assert fixtures["minimum_active_reviewers"] >= 5
        assert fixtures["minimum_reviewed_prs_per_reviewer"] >= 3
        assert fixtures["minimum_review_actions_per_reviewer"] >= 3
        assert fixtures["minimum_multi_repo_reviewers"] >= 1
        assert len(fixtures["reviewer_filter_examples"]) >= 1
        assert fixtures["reviewer_constrained_example"]["mode"] == "constrained"
        assert fixtures["reviewer_team_disallowed_example"]["mode"] == "disallowed"

    def test_manifest_declares_canonical_generation_provenance(self) -> None:
        run_demo_build()
        manifest = json.loads(
            (ARTIFACT_DATA / "dataset-manifest.json").read_text(encoding="utf-8")
        )

        assert manifest["generation_provenance"] == {
            "python_version": COMMITTED_DEMO_BASELINE_PYTHON_VERSION,
            "python_major_minor": COMMITTED_DEMO_BASELINE_PYTHON_MAJOR_MINOR,
            "generator_script": CANONICAL_COMMITTED_DEMO_SCRIPT,
            "generation_mode": CANONICAL_COMMITTED_DEMO_MODE,
        }

    def test_demo_profile_declares_canonical_generation_provenance(self) -> None:
        run_demo_build()
        profile = json.loads(
            (ARTIFACT_METADATA / "demo-profile.json").read_text(encoding="utf-8")
        )

        expected_mode = (
            CANONICAL_COMMITTED_DEMO_MODE
            if _IS_BASELINE_PYTHON
            else VALIDATED_COMMITTED_DEMO_MODE
        )
        assert profile["generation_provenance"] == {
            "python_version": COMMITTED_DEMO_BASELINE_PYTHON_VERSION,
            "python_major_minor": COMMITTED_DEMO_BASELINE_PYTHON_MAJOR_MINOR,
            "generator_script": CANONICAL_COMMITTED_DEMO_SCRIPT,
            "generation_mode": expected_mode,
        }

    def test_reviewer_fixture_examples_resolve_to_canonical_rollups(self) -> None:
        run_demo_build()
        manifest = json.loads(
            (ARTIFACT_DATA / "dataset-manifest.json").read_text(encoding="utf-8")
        )
        fixtures = manifest["reviewer_fixtures"]
        weekly_rollups = {
            entry["week"]: json.loads(
                (ARTIFACT_DATA / entry["path"]).read_text(encoding="utf-8")
            )
            for entry in manifest["aggregate_index"]["weekly_rollups"]
        }

        for example in fixtures["reviewer_filter_examples"]:
            rollup = weekly_rollups[example["week"]]
            reviewer_entry = rollup["by_reviewer"][example["reviewer_id"]]
            assert (
                reviewer_entry["reviewed_prs"]
                >= fixtures["minimum_reviewed_prs_per_reviewer"]
            )
            assert (
                reviewer_entry["reviews_count"]
                >= fixtures["minimum_review_actions_per_reviewer"]
            )

        constrained = fixtures["reviewer_constrained_example"]
        constrained_rollup = weekly_rollups[constrained["week"]]
        assert constrained["reviewer_id"] in constrained_rollup["by_reviewer"]
        assert constrained["repository_name"] in constrained_rollup["by_repository"]

        disallowed = fixtures["reviewer_team_disallowed_example"]
        disallowed_rollup = weekly_rollups[disallowed["week"]]
        assert disallowed["reviewer_id"] in disallowed_rollup["by_reviewer"]
        assert disallowed["team_name"] in disallowed_rollup["by_team"]

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

    def test_reviewer_fixture_validation_fails_when_metadata_missing(self) -> None:
        run_demo_build()
        build_module = load_build_module()
        mutated_dir = make_scratch_path("artifact-data-missing")
        shutil.copytree(ARTIFACT_DATA, mutated_dir)
        manifest_path = mutated_dir / "dataset-manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest.pop("reviewer_fixtures", None)
        manifest_path.write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
            newline="\n",
        )

        with pytest.raises(RuntimeError, match="reviewer_fixtures"):
            build_module.validate_reviewer_fixture_contract(mutated_dir)

    def test_reviewer_fixture_validation_fails_when_rollup_breakdown_missing(
        self,
    ) -> None:
        run_demo_build()
        build_module = load_build_module()
        mutated_dir = make_scratch_path("artifact-data-rollup")
        shutil.copytree(ARTIFACT_DATA, mutated_dir)
        manifest = json.loads(
            (mutated_dir / "dataset-manifest.json").read_text(encoding="utf-8")
        )
        fixture_week = manifest["reviewer_fixtures"]["reviewer_filter_examples"][0][
            "week"
        ]
        rollup_entry = next(
            entry
            for entry in manifest["aggregate_index"]["weekly_rollups"]
            if entry["week"] == fixture_week
        )
        rollup_path = mutated_dir / rollup_entry["path"]
        rollup = json.loads(rollup_path.read_text(encoding="utf-8"))
        rollup["by_reviewer"] = {}
        rollup_path.write_text(
            json.dumps(rollup, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
            newline="\n",
        )

        with pytest.raises(RuntimeError, match="by_reviewer"):
            build_module.validate_reviewer_fixture_contract(mutated_dir)
