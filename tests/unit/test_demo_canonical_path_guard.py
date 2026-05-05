"""Hard-guard contract for committed canonical demo paths."""

from __future__ import annotations

import atexit
import importlib.util
import os
import shutil
import subprocess
import sys
from itertools import count
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SCRIPTS_DIR = _REPO_ROOT / "scripts"
_BUILD_SCRIPT = _SCRIPTS_DIR / "build-demo-dataset.py"

# Repo-local scratch root mirrors tests/unit/test_synthetic_dataset.py:
# build-demo-dataset.py calls ARTIFACT_ROOT.relative_to(REPO_ROOT) in
# write_reports, so any subprocess-backed test that points
# ADO_DEMO_*_ARTIFACT_ROOT at scratch MUST root that scratch under
# REPO_ROOT. tmp_path lands under the OS temp dir and raises ValueError.
TEST_TMP_ROOT = _REPO_ROOT / "tmp_test_work"
_SCRATCH_COUNTER = count()


def _cleanup_test_tmp_root() -> None:
    """Best-effort cleanup for repo-local scratch directories created by tests."""
    shutil.rmtree(TEST_TMP_ROOT, ignore_errors=True)


atexit.register(_cleanup_test_tmp_root)


def _make_scratch_dir(prefix: str) -> Path:
    """Create a repo-local scratch directory for subprocess-backed tests."""
    TEST_TMP_ROOT.mkdir(parents=True, exist_ok=True)
    scratch_dir = TEST_TMP_ROOT / f"{prefix}-{next(_SCRATCH_COUNTER):04d}"
    while scratch_dir.exists():
        scratch_dir = TEST_TMP_ROOT / f"{prefix}-{next(_SCRATCH_COUNTER):04d}"
    scratch_dir.mkdir(parents=True, exist_ok=False)
    return scratch_dir


_spec = importlib.util.spec_from_file_location(
    "demo_generation_common",
    _SCRIPTS_DIR / "demo_generation_common.py",
)
assert _spec is not None
assert _spec.loader is not None
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
assert_safe_output_root = _module.assert_safe_output_root


@pytest.mark.parametrize(
    "canonical_subpath",
    [
        "docs/data",
        "artifacts/demo-enterprise/data",
        "artifacts/demo-enterprise-comments-off/data",
    ],
)
def test_rejects_committed_path_without_override(canonical_subpath: str) -> None:
    target = _REPO_ROOT / canonical_subpath
    with pytest.raises(RuntimeError, match="Refusing to write demo artifacts"):
        assert_safe_output_root(target, commit_canonical=False)


@pytest.mark.parametrize(
    "canonical_subpath",
    [
        "docs/data",
        "artifacts/demo-enterprise/data",
        "artifacts/demo-enterprise-comments-off/data",
    ],
)
def test_allows_committed_path_with_override(canonical_subpath: str) -> None:
    target = _REPO_ROOT / canonical_subpath
    assert_safe_output_root(target, commit_canonical=True)


def test_allows_path_outside_canonical_roots(tmp_path: Path) -> None:
    target = tmp_path / "scratch_output"
    assert_safe_output_root(target, commit_canonical=False)


def test_validate_only_default_root_rejected() -> None:
    """`--validate-only --no-promote` with default canonical roots must fail.

    Regression for the Codex P2 catch on hotfix/packaged-cli-dashboard-ui.
    Validate-only previously skipped ``assert_safe_output_root`` and then
    ``prepare_validate_only_artifact_root()`` deleted+recreated
    ``ARTIFACT_DATA_DIR`` (default: ``artifacts/demo-enterprise/data``),
    mutating the canonical artifact tree without ``--commit-canonical``.
    The fix lifts the guard out of the ``if not args.validate_only:``
    block; this test exercises the import-time env-var resolution in a
    fresh subprocess to confirm the guard fires before any setup.
    """
    env = os.environ.copy()
    env.pop("ADO_DEMO_ARTIFACT_ROOT", None)
    env.pop("ADO_DEMO_VARIANT_OFF_ARTIFACT_ROOT", None)
    result = subprocess.run(
        [sys.executable, str(_BUILD_SCRIPT), "--validate-only", "--no-promote"],
        cwd=str(_REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0, (
        "validate-only --no-promote with default canonical artifact root must "
        "fail; the safety guard did not trigger.\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
    combined = (result.stdout or "") + (result.stderr or "")
    assert "Refusing to write demo artifacts" in combined, (
        "Expected the canonical-path refusal message in output but did not find "
        "it; the script likely failed at a later step before the guard ran.\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )


def test_validate_only_scratch_roots_pass() -> None:
    """`--validate-only --no-promote` succeeds when both artifact roots are scratch.

    Uses repo-local scratch (see TEST_TMP_ROOT comment above) because
    ``write_reports`` calls ``ARTIFACT_ROOT.relative_to(REPO_ROOT)``.

    Adds ``--allow-dirty-inputs`` so the test is hermetic against
    in-development edits to ``DEMO_BUILD_INPUTS`` (which includes
    ``scripts/build-demo-dataset.py`` itself); the canonical-path guard
    under test runs BEFORE ``assert_inputs_clean`` and is unaffected by
    that flag.
    """
    artifact_root = _make_scratch_dir("guard-artifact")
    variant_off_root = _make_scratch_dir("guard-variant-off")
    env = os.environ.copy()
    env["ADO_DEMO_ARTIFACT_ROOT"] = str(artifact_root)
    env["ADO_DEMO_VARIANT_OFF_ARTIFACT_ROOT"] = str(variant_off_root)
    result = subprocess.run(
        [
            sys.executable,
            str(_BUILD_SCRIPT),
            "--validate-only",
            "--no-promote",
            "--allow-dirty-inputs",
        ],
        cwd=str(_REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, (
        "validate-only --no-promote with scratch artifact roots must pass the "
        f"safety guard and succeed; exit={result.returncode}.\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
    combined = (result.stdout or "") + (result.stderr or "")
    assert "Refusing to write demo artifacts" not in combined, (
        "Scratch artifact roots must not trigger the canonical-path refusal.\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )


def test_validate_only_default_variant_off_allowed() -> None:
    """`--validate-only` must not reject default ``VARIANT_OFF_ARTIFACT_ROOT``.

    ``build_variant_off_artifact()`` only runs on the generator path; the
    variant-off guard is scoped to that path so customers running
    ``--validate-only --no-promote`` with only ``ADO_DEMO_ARTIFACT_ROOT``
    overridden must succeed even though the variant-off env var resolves
    to its canonical default. Locks the Codex stop-hook catch.
    """
    artifact_root = _make_scratch_dir("guard-artifact-only")
    env = os.environ.copy()
    env["ADO_DEMO_ARTIFACT_ROOT"] = str(artifact_root)
    env.pop("ADO_DEMO_VARIANT_OFF_ARTIFACT_ROOT", None)
    result = subprocess.run(
        [
            sys.executable,
            str(_BUILD_SCRIPT),
            "--validate-only",
            "--no-promote",
            "--allow-dirty-inputs",
        ],
        cwd=str(_REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, (
        "validate-only must succeed when only ADO_DEMO_ARTIFACT_ROOT is "
        f"overridden (variant-off path is not written here); exit={result.returncode}.\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
    combined = (result.stdout or "") + (result.stderr or "")
    assert "Refusing to write demo artifacts" not in combined, (
        "Default VARIANT_OFF_ARTIFACT_ROOT must not trigger refusal in "
        "validate-only mode (the path is not written there).\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
