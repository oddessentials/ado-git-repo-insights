"""Tests for the canonical enterprise demo build and promotion pipeline."""

import atexit
import fnmatch
import importlib.util
import json
import os
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
# Per-process scratch root (see #316). Parallel pytest processes must not
# share this path — doing so lets the module-level _SCRATCH_COUNTER in two
# processes converge on the same {prefix}-NNNN name, exposing a TOCTOU
# race in make_scratch_dir() between exists() and mkdir(exist_ok=False).
# Scoping to pid isolates that concern.
#
# Cleanup is a dual mechanism (#327 step 3):
#   1. Module-level atexit (below) — fires on THIS process's normal exit,
#      including subprocess peers that import the module directly (those
#      peers do not load pytest conftest so the session fixture does not
#      reach them). Without this, peer scratch would accumulate for the
#      rest of the boot because R7's mtime-vs-boot-time guard defers
#      same-boot dead-pid scratch.
#   2. Session-scope fixture in tests/demo/conftest.py — runs R7 at
#      session start to reclaim stale CROSS-BOOT scratch that survived
#      a reboot, and removes the parent session's own scratch on
#      normal pytest exit.
# The two mechanisms are complementary: atexit handles peer coverage,
# the fixture handles cross-boot recovery.
TEST_TMP_ROOT = REPO_ROOT / "tmp_test_work" / f"pid-{os.getpid()}"
_SCRATCH_COUNTER = count()


def _cleanup_test_tmp_root() -> None:
    """Best-effort cleanup of THIS process's scratch root on exit.

    Fires for every process that imports this module — including peer
    subprocesses spawned by tests — because atexit registration is
    module-level. See TEST_TMP_ROOT comment above for why the session
    fixture alone is not sufficient.

    Safety: the target path MUST be the pid-scoped subtree for the
    current process. The guard below refuses to touch any other path
    so a mutated TEST_TMP_ROOT cannot accidentally wipe a sibling
    process's scratch or the tmp_test_work parent itself.

    Error handling (per #327 step 3 review): idempotent on
    FileNotFoundError (the scratch may already be gone after a prior
    invocation, a sibling, or the session fixture teardown); any
    other OSError surfaces on stderr so failures are visible rather
    than masked by a blanket ignore_errors=True.
    """
    expected_root = REPO_ROOT / "tmp_test_work" / f"pid-{os.getpid()}"
    if TEST_TMP_ROOT != expected_root:
        sys.stderr.write(
            f"[atexit] refusing to clean unexpected TEST_TMP_ROOT="
            f"{TEST_TMP_ROOT} (expected {expected_root})\n"
        )
        return
    try:
        shutil.rmtree(TEST_TMP_ROOT)
    except FileNotFoundError:
        # Idempotent: path is already gone (prior invocation, sibling,
        # or the session-scope R7 fixture). No further action needed.
        return
    except OSError as exc:
        sys.stderr.write(
            f"[atexit] failed to clean {TEST_TMP_ROOT}: {type(exc).__name__}: {exc}\n"
        )


atexit.register(_cleanup_test_tmp_root)


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


_ROOT = "ARTIFACT_ROOT"
_DATA = "ARTIFACT_DATA"
_REPORT = "ARTIFACT_REPORT"
_METADATA = "ARTIFACT_METADATA"


def _set_artifact_root(root: Path) -> None:
    """Point module-level artifact paths at the provided scratch root."""
    module = sys.modules[__name__]
    setattr(module, _ROOT, root)
    setattr(module, _DATA, root / "data")
    setattr(module, _REPORT, root / "report")
    setattr(module, _METADATA, root / "metadata")


def _fresh_artifact_env() -> dict[str, str]:
    """Allocate a fresh scratch artifact root for each subprocess build run."""
    artifact_root = make_scratch_dir("artifact-root")
    _set_artifact_root(artifact_root)
    env = os.environ.copy()
    env["ADO_DEMO_ARTIFACT_ROOT"] = str(artifact_root)
    return env


@pytest.fixture(autouse=True)
def isolate_artifact_root(monkeypatch: pytest.MonkeyPatch) -> None:
    """Give each test a fresh canonical artifact root to avoid cross-test collisions."""
    artifact_root = make_scratch_dir("artifact-root")
    monkeypatch.setenv("ADO_DEMO_ARTIFACT_ROOT", str(artifact_root))
    _set_artifact_root(artifact_root)


def load_build_module():
    """Load build-demo-dataset.py as a Python module for direct contract testing."""
    demo_generation_common_spec = importlib.util.spec_from_file_location(
        "demo_generation_common", REPO_ROOT / "scripts" / "demo_generation_common.py"
    )
    if (
        demo_generation_common_spec is None
        or demo_generation_common_spec.loader is None
    ):
        raise RuntimeError(
            f"Unable to load helper module: {REPO_ROOT / 'scripts' / 'demo_generation_common.py'}"
        )
    demo_generation_common = importlib.util.module_from_spec(
        demo_generation_common_spec
    )

    sys.modules["demo_generation_common"] = demo_generation_common
    demo_generation_common_spec.loader.exec_module(demo_generation_common)

    demo_shell_spec = importlib.util.spec_from_file_location(
        "demo_shell", REPO_ROOT / "scripts" / "demo_shell.py"
    )
    if demo_shell_spec is None or demo_shell_spec.loader is None:
        raise RuntimeError(
            f"Unable to load helper module: {REPO_ROOT / 'scripts' / 'demo_shell.py'}"
        )
    demo_shell = importlib.util.module_from_spec(demo_shell_spec)
    sys.modules["demo_shell"] = demo_shell
    demo_shell_spec.loader.exec_module(demo_shell)

    # Feature 060 FR-023: build-demo-dataset.py imports strip_pr_arrays for the
    # promote_data strip gate. Register it in sys.modules so the importlib
    # load path below resolves. Module-name (underscore) must match the
    # import statement in build-demo-dataset.py.
    strip_spec = importlib.util.spec_from_file_location(
        "strip_pr_arrays", REPO_ROOT / "scripts" / "strip_pr_arrays.py"
    )
    if strip_spec is None or strip_spec.loader is None:
        raise RuntimeError(
            f"Unable to load helper module: {REPO_ROOT / 'scripts' / 'strip_pr_arrays.py'}"
        )
    strip_module = importlib.util.module_from_spec(strip_spec)
    sys.modules["strip_pr_arrays"] = strip_module
    strip_spec.loader.exec_module(strip_module)

    spec = importlib.util.spec_from_file_location("build_demo_dataset", BUILD_SCRIPT)
    if spec is None or spec.loader is None:
        raise AssertionError(f"Unable to load build script module: {BUILD_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["build_demo_dataset"] = module
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
    env = _fresh_artifact_env()
    if promote:
        if promote_dir is None:
            raise AssertionError("promote_dir is required when promote=True")
        if not _IS_BASELINE_PYTHON:
            raise AssertionError(
                "run_demo_build() cannot combine off-baseline validate-only mode with promotion"
            )
        build_result = subprocess.run(
            [sys.executable, str(BUILD_SCRIPT), "--promote-dir", str(promote_dir)],
            cwd=REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
    elif not _IS_BASELINE_PYTHON:
        build_result = subprocess.run(
            [sys.executable, str(BUILD_SCRIPT), "--validate-only", "--no-promote"],
            cwd=REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
    else:
        build_result = subprocess.run(
            [sys.executable, str(BUILD_SCRIPT), "--no-promote"],
            cwd=REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
    assert build_result.returncode == 0, (
        f"build-demo-dataset.py failed: {build_result.stderr or build_result.stdout}"
    )


def run_demo_validate_only() -> None:
    """Run validate-only mode explicitly against committed docs/data."""
    env = _fresh_artifact_env()
    validate_result = subprocess.run(
        [sys.executable, str(BUILD_SCRIPT), "--validate-only", "--no-promote"],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert validate_result.returncode == 0, (
        "build-demo-dataset.py --validate-only failed: "
        f"{validate_result.stderr or validate_result.stdout}"
    )


def run_demo_validate_only_with_promote() -> subprocess.CompletedProcess[str]:
    """Run validate-only mode without --no-promote to assert it is rejected."""
    env = _fresh_artifact_env()
    return subprocess.run(
        [sys.executable, str(BUILD_SCRIPT), "--validate-only"],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


class TestScratchRootIsProcessPrivate:
    """Regression for #316: concurrent pytest processes must not share the
    scratch-root namespace.

    The reproduced flake had two independent failure modes, both resolved
    by keeping TEST_TMP_ROOT per-process:
      * TOCTOU race at make_scratch_dir mkdir(exist_ok=False) when two
        processes' module-level _SCRATCH_COUNTERs converged on the same
        {prefix}-NNNN name.
      * atexit rmtree of TEST_TMP_ROOT in one process deleting another
        still-running process's in-flight subtree.

    The assertion here locks the isolation contract, not the specific
    discriminator mechanism — the test passes for any scheme that makes
    TEST_TMP_ROOT unique per process.
    """

    def test_distinct_processes_get_distinct_scratch_roots(self) -> None:
        """Two fresh Python processes loading this module must resolve
        TEST_TMP_ROOT to different paths."""
        emitter = (
            f"import importlib.util\n"
            f"spec = importlib.util.spec_from_file_location("
            f"'tdpp', {str(Path(__file__))!r})\n"
            f"assert spec is not None and spec.loader is not None\n"
            f"mod = importlib.util.module_from_spec(spec)\n"
            f"spec.loader.exec_module(mod)\n"
            f"print(str(mod.TEST_TMP_ROOT))\n"
        )
        roots: list[str] = []
        for _ in range(2):
            result = subprocess.run(
                [sys.executable, "-c", emitter],
                capture_output=True,
                text=True,
                check=False,
            )
            assert result.returncode == 0, (
                f"child failed to load module: rc={result.returncode} "
                f"stderr={result.stderr}"
            )
            roots.append(result.stdout.strip())
        assert len(set(roots)) == len(roots), (
            f"Distinct processes must resolve to distinct TEST_TMP_ROOTs; "
            f"got duplicates in {roots}"
        )
        assert str(TEST_TMP_ROOT) not in roots, (
            f"Child processes must not collide with parent; parent "
            f"{TEST_TMP_ROOT} appeared in child outputs {roots}"
        )

    def test_peer_atexit_cleanup_preserves_this_subtree(self) -> None:
        """Regression for #316 Test 4: a peer process's atexit cleanup
        must not delete this process's scratch subtree.

        The reproduced failure was a mid-sequence write
        (FileNotFoundError on
        ``artifact-root-NNNN/data/aggregates/weekly_rollups/YYYY-WNN.json``)
        caused by a sibling pytest process's
        ``atexit → shutil.rmtree(TEST_TMP_ROOT)`` firing while the in-
        flight demo-build subprocess was still writing to that subtree.
        The static distinct-roots test above locks path resolution at
        module load; this one locks the cleanup lifecycle across
        concurrent processes.
        """
        my_scratch = make_scratch_dir("atexit-isolation")
        canary = my_scratch / "canary.txt"
        canary.write_text("alive", encoding="utf-8")

        emitter = (
            f"import importlib.util\n"
            f"spec = importlib.util.spec_from_file_location("
            f"'tdpp', {str(Path(__file__))!r})\n"
            f"assert spec is not None and spec.loader is not None\n"
            f"mod = importlib.util.module_from_spec(spec)\n"
            f"spec.loader.exec_module(mod)\n"
            # Peer allocates its own scratch dir so its full lifecycle
            # (including atexit rmtree of its TEST_TMP_ROOT) runs.
            f"peer_dir = mod.make_scratch_dir('atexit-isolation-peer')\n"
            f"(peer_dir / 'peer-canary.txt').write_text('peer', encoding='utf-8')\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", emitter],
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, (
            f"peer subprocess failed: rc={result.returncode} stderr={result.stderr}"
        )

        assert canary.exists(), (
            f"Peer process's atexit cleanup deleted parent's scratch "
            f"subtree (regression for #316 Test 4). Peer stderr: "
            f"{result.stderr}"
        )
        assert canary.read_text(encoding="utf-8") == "alive", (
            "Canary file contents were modified by peer process cleanup"
        )

    def test_peer_subprocess_atexit_cleans_own_scratch(self) -> None:
        """Regression for #327 step 3 stop-review: a peer subprocess
        that imports this module must clean its own
        ``tmp_test_work/pid-{peer_pid}/`` on normal exit via the
        module-level ``atexit`` hook AND must not touch any sibling
        subtree (parent's pid-root or another peer's pid-root).

        Peer subprocesses do NOT load pytest conftest, so the
        session-scope fixture in ``tests/demo/conftest.py`` never
        reaches them. And R7's mtime-vs-boot-time guard intentionally
        defers same-boot dead-pid scratch. Without the module-level
        atexit registration, peer scratch would accumulate for the
        rest of the boot.

        The parent creates its own pid-scoped scratch with a canary
        before spawning the peer. After the peer exits, the peer's
        pid-root must be gone AND the parent's scratch must still be
        present with the canary intact.
        """
        # Parent-side sibling canary: proves the peer's atexit only
        # removes its own pid-{peer_pid}/ subtree, never the parent's.
        parent_scratch = make_scratch_dir("peer-atexit-sibling-guard")
        parent_canary = parent_scratch / "canary.txt"
        parent_canary.write_text("parent-alive", encoding="utf-8")

        emitter = (
            "import importlib.util\n"
            "spec = importlib.util.spec_from_file_location("
            f"'tdpp', {str(Path(__file__))!r})\n"
            "assert spec is not None and spec.loader is not None\n"
            "mod = importlib.util.module_from_spec(spec)\n"
            "spec.loader.exec_module(mod)\n"
            "peer_dir = mod.make_scratch_dir('peer-atexit-cleans-own')\n"
            "(peer_dir / 'payload.txt').write_text('ephemeral', encoding='utf-8')\n"
            # Emit the peer's TEST_TMP_ROOT so the parent can check it.
            "print(str(mod.TEST_TMP_ROOT))\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", emitter],
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, (
            f"peer subprocess failed: rc={result.returncode} stderr={result.stderr}"
        )
        peer_tmp_root = Path(result.stdout.strip())
        assert peer_tmp_root != TEST_TMP_ROOT, (
            "Peer TEST_TMP_ROOT must differ from parent's (pid scoping)"
        )
        # atexit should have fired on peer exit and removed the whole
        # pid-{peer_pid}/ tree. If it did not, same-boot peer scratch
        # has leaked — exactly the regression #327 step 3 stop-review
        # caught.
        assert not peer_tmp_root.exists(), (
            f"Peer subprocess scratch {peer_tmp_root} leaked after exit. "
            "Module-level atexit hook is missing or failed."
        )
        # Sibling-intact assertion (per #327 step 3 review): the peer
        # must only delete its OWN pid-* subtree. Parent's scratch and
        # canary must be intact.
        assert parent_scratch.exists(), (
            f"Peer atexit deleted parent's sibling scratch: {parent_scratch}"
        )
        assert parent_canary.read_text(encoding="utf-8") == "parent-alive", (
            "Parent's canary contents mutated by peer atexit"
        )

    def test_two_concurrent_peers_clean_only_their_own(self) -> None:
        """Regression for #327 step 3 review: two peer subprocesses
        spawned concurrently must each clean ONLY their own pid-*
        scratch. Neither peer's atexit may touch the other peer's
        subtree or the parent's scratch. Locks the per-pid isolation
        contract across simultaneously running peers, not just
        sequential ones.
        """
        parent_scratch = make_scratch_dir("parent-concurrent-peers")
        parent_canary = parent_scratch / "canary.txt"
        parent_canary.write_text("parent-alive", encoding="utf-8")

        emitter = (
            "import importlib.util\n"
            "spec = importlib.util.spec_from_file_location("
            f"'tdpp', {str(Path(__file__))!r})\n"
            "assert spec is not None and spec.loader is not None\n"
            "mod = importlib.util.module_from_spec(spec)\n"
            "spec.loader.exec_module(mod)\n"
            "peer_dir = mod.make_scratch_dir('concurrent-peer')\n"
            "(peer_dir / 'payload.txt').write_text('ephemeral', encoding='utf-8')\n"
            "print(str(mod.TEST_TMP_ROOT))\n"
        )
        # Spawn both peers and let them run in parallel. Popen.communicate()
        # waits for each to exit — atexit must have fired by the time we
        # inspect the filesystem below.
        proc_a = subprocess.Popen(
            [sys.executable, "-c", emitter],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        proc_b = subprocess.Popen(
            [sys.executable, "-c", emitter],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        out_a, err_a = proc_a.communicate(timeout=30)
        out_b, err_b = proc_b.communicate(timeout=30)
        assert proc_a.returncode == 0, f"peer A failed: {err_a}"
        assert proc_b.returncode == 0, f"peer B failed: {err_b}"
        peer_a_root = Path(out_a.strip())
        peer_b_root = Path(out_b.strip())
        assert peer_a_root != peer_b_root, (
            f"distinct pids must resolve to distinct roots; got "
            f"{peer_a_root} and {peer_b_root}"
        )
        assert peer_a_root != TEST_TMP_ROOT
        assert peer_b_root != TEST_TMP_ROOT
        # Each peer cleaned only its own pid-scoped scratch.
        assert not peer_a_root.exists(), (
            f"peer A scratch leaked after exit: {peer_a_root}"
        )
        assert not peer_b_root.exists(), (
            f"peer B scratch leaked after exit: {peer_b_root}"
        )
        # Parent's sibling scratch remains untouched despite both
        # peers having fired atexit in parallel.
        assert parent_scratch.exists(), (
            f"concurrent peers deleted parent scratch: {parent_scratch}"
        )
        assert parent_canary.read_text(encoding="utf-8") == "parent-alive"


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

    def test_docs_promotion_matches_canonical_bytes(self) -> None:
        # Keep collection identical across Python versions without introducing
        # skips. Baseline Python exercises the real promotion path; non-baseline
        # interpreters must still assert that validate-only rebuilds the
        # committed published dataset byte-for-byte into the isolated artifact
        # root.
        if not _IS_BASELINE_PYTHON:
            run_demo_build()

            committed_data_root = REPO_ROOT / "docs" / "data"
            manifest = json.loads(
                (committed_data_root / "dataset-manifest.json").read_text(
                    encoding="utf-8"
                )
            )
            declared_direct = set(manifest["published_files"]["direct"])
            declared_globs = manifest["published_files"]["globs"]
            indexed_files = {
                entry["path"] for entry in manifest["aggregate_index"]["weekly_rollups"]
            } | {
                entry["path"] for entry in manifest["aggregate_index"]["distributions"]
            }

            committed_files = sorted(
                path.relative_to(committed_data_root)
                for path in committed_data_root.rglob("*")
                if path.is_file()
                and (
                    str(path.relative_to(committed_data_root)).replace("\\", "/")
                    in declared_direct
                    or str(path.relative_to(committed_data_root)).replace("\\", "/")
                    in indexed_files
                    or any(
                        fnmatch.fnmatch(
                            str(path.relative_to(committed_data_root)).replace(
                                "\\", "/"
                            ),
                            pattern,
                        )
                        for pattern in declared_globs
                    )
                )
            )
            rebuilt_files = sorted(
                path.relative_to(ARTIFACT_DATA)
                for path in ARTIFACT_DATA.rglob("*")
                if path.is_file()
            )

            assert committed_files == rebuilt_files
            for rel_path in committed_files:
                assert (committed_data_root / rel_path).read_bytes() == (
                    ARTIFACT_DATA / rel_path
                ).read_bytes()
            return

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

    def test_validate_only_uses_fresh_artifact_root_without_stale_leakage(self) -> None:
        stale_root = ARTIFACT_ROOT
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

        assert ARTIFACT_ROOT != stale_root
        assert (ARTIFACT_DATA / "dataset-manifest.json").exists()
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


# =============================================================================
# Feature 060 FR-023 — promote_data atomic-failure proof at the real write
# boundary. T047 per tasks.md. Separate from the helper-level unit tests in
# tests/unit/test_strip_pr_arrays.py; these assertions lock the integration
# between the strip gate and the shutil.copytree publishing step.
# =============================================================================


def _write_rollup_json(rollup_dir: Path, name: str, payload: dict[str, object]) -> Path:
    (rollup_dir / "weekly_rollups").mkdir(parents=True, exist_ok=True)
    path = rollup_dir / "weekly_rollups" / name
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    return path


def _hash_tree(root: Path) -> dict[str, str]:
    """Deterministic digest of every file under ``root`` for byte-identity proofs."""
    import hashlib

    tree: dict[str, str] = {}
    if not root.exists():
        return tree
    for path in sorted(root.rglob("*")):
        if path.is_file():
            rel = path.relative_to(root).as_posix()
            tree[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
    return tree


class TestPromoteDataStripGateAtomicity:
    """Feature 060 FR-023: the strip gate fires INSIDE ``promote_data``.

    On residue, ``promote_data`` raises ``PrArrayResidueError`` BEFORE the
    ``mkdir`` / ``copytree`` steps, so the destination directory is
    byte-identical to its pre-call state.
    """

    def test_promote_data_strips_pr_level_fields_when_destination_is_docs_data_dir(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        build_module = load_build_module()

        # Source: a canonical artifact root with one rollup carrying PR-level
        # fields. `aggregates/weekly_rollups/*.json` is what promote_data
        # passes to the strip helper as `source_dir / "aggregates"`.
        source_root = make_scratch_dir("promote-source-clean")
        aggregates = source_root / "aggregates"
        _write_rollup_json(
            aggregates,
            "2025-W10.json",
            {
                "week": "2025-W10",
                "pr_count": 1,
                "prs": [
                    {
                        "id": 1,
                        "title": "a",
                        "author_id": "u",
                        "repository_id": "r",
                        "cycle_time": 30.0,
                    }
                ],
                "_prs_truncated": False,
                "_prs_cap": 500,
            },
        )

        # Retarget DOCS_DATA_DIR to a scratch location so the gate's
        # `destination == DOCS_DATA_DIR` check fires without touching the
        # real docs/data/ tree.
        fake_docs = make_scratch_dir("fake-docs-data")
        monkeypatch.setattr(build_module, "DOCS_DATA_DIR", fake_docs)

        build_module.promote_data(source_root, fake_docs)

        promoted_rollup = fake_docs / "aggregates" / "weekly_rollups" / "2025-W10.json"
        assert promoted_rollup.exists()
        payload = json.loads(promoted_rollup.read_text(encoding="utf-8"))
        assert "prs" not in payload
        assert "_prs_truncated" not in payload
        assert "_prs_cap" not in payload

    def test_promote_data_raises_and_leaves_destination_byte_identical_on_residue(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        build_module = load_build_module()
        strip_pr_arrays_module = sys.modules["strip_pr_arrays"]
        residue_error_type = strip_pr_arrays_module.PrArrayResidueError

        # Source with residue that the strip helper's re-verify sweep MUST
        # catch. We sabotage the helper so the mutation step is a no-op —
        # proving the atomic-failure chain runs from re-verify all the way
        # back up to docs/data/ being untouched.
        source_root = make_scratch_dir("promote-source-residue")
        aggregates = source_root / "aggregates"
        _write_rollup_json(
            aggregates,
            "2025-W11.json",
            {
                "week": "2025-W11",
                "pr_count": 1,
                "prs": [
                    {
                        "id": 2,
                        "title": "leak",
                        "author_id": "u",
                        "repository_id": "r",
                        "cycle_time": 45.0,
                    }
                ],
                "_prs_truncated": False,
                "_prs_cap": 500,
            },
        )

        fake_docs = make_scratch_dir("fake-docs-data-residue")
        # Seed the destination with a pre-existing sentinel file. If
        # promote_data proceeds past the strip gate, shutil.copytree would
        # overwrite OR add files — in either case the hash tree diverges.
        sentinel = fake_docs / "__pre-existing__.marker"
        sentinel.write_bytes(b"baseline\n")
        pre_tree = _hash_tree(fake_docs)

        monkeypatch.setattr(build_module, "DOCS_DATA_DIR", fake_docs)

        # Sabotage the strip step so the re-verify sweep catches residue.
        def _sabotaged_strip(path: Path, fields_removed: dict[str, int]) -> bool:
            return False

        monkeypatch.setattr(strip_pr_arrays_module, "_strip_one", _sabotaged_strip)

        with pytest.raises(residue_error_type):
            build_module.promote_data(source_root, fake_docs)

        # Atomic-failure proof: fake_docs is byte-identical to its pre-call
        # state. No mkdir, no copytree, no partial writes.
        assert _hash_tree(fake_docs) == pre_tree

    def test_sentinel_present_synthetic_preserves_prs(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Feature 309 binary gate: sentinel-present + valid shape keeps PR fields."""
        build_module = load_build_module()
        fixture_root = (
            Path(__file__).parent
            / "fixtures"
            / "strip_gate"
            / "sentinel-present-synthetic-shaped"
        )
        source_root = tmp_path / "source"
        shutil.copytree(fixture_root, source_root)

        fake_docs = make_scratch_dir("fake-docs-synthetic-preserve")
        monkeypatch.setattr(build_module, "DOCS_DATA_DIR", fake_docs)

        build_module.promote_data(source_root, fake_docs)

        promoted_rollup = fake_docs / "aggregates" / "weekly_rollups" / "2025-W10.json"
        assert promoted_rollup.exists()
        payload = json.loads(promoted_rollup.read_text(encoding="utf-8"))
        assert "prs" in payload
        assert "_prs_truncated" in payload
        assert payload.get("_prs_cap") == 500
        # Sentinel must not be copied to the destination.
        assert not (
            fake_docs
            / "aggregates"
            / build_module.SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME
        ).exists()

    def test_sentinel_present_tenant_raises_atomic(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Sentinel-present + shape violation raises SyntheticShapeError atomically."""
        build_module = load_build_module()
        fixture_root = (
            Path(__file__).parent
            / "fixtures"
            / "strip_gate"
            / "sentinel-present-tenant-shaped"
        )
        source_root = tmp_path / "source"
        shutil.copytree(fixture_root, source_root)

        fake_docs = make_scratch_dir("fake-docs-tenant-reject")
        fake_docs.mkdir(exist_ok=True)
        (fake_docs / "__pre-existing__.marker").write_bytes(b"baseline\n")
        pre_tree = _hash_tree(fake_docs)

        monkeypatch.setattr(build_module, "DOCS_DATA_DIR", fake_docs)

        with pytest.raises(build_module.SyntheticShapeError):
            build_module.promote_data(source_root, fake_docs)

        # Atomic-failure proof: destination byte-identical to pre-call state.
        assert _hash_tree(fake_docs) == pre_tree
        # Source sentinel MUST remain present (contract §7 retry semantics).
        assert (
            source_root
            / "aggregates"
            / build_module.SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME
        ).exists()
