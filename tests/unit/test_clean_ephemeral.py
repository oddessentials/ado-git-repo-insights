"""Validator + delete-engine tests for scripts/clean_ephemeral.py.

Step 1 coverage: registry schema validation (INV-C), containment
(INV-D), gitignore parity (INV-A), tracked-file refusal (INV-B), and
guards G-CWD, G-EXIST, G-ORDER, G-DEDUP.

Step 2 coverage: rmtree_resilient (retry + read-only handling),
execute_plan (dry-run, --yes, partial-failure aggregation), run()
exit-code semantics (empty plan vs work pending vs idempotent), and
the JSON report schema lock (v1 for validate-only, v2 for action).
"""

from __future__ import annotations

import argparse
import errno
import io
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    # Match the conftest pattern: reference the top-level name under
    # mypy_path=["scripts"] so mypy doesn't see "source file found
    # twice" when both import forms resolve the same module.
    import clean_ephemeral as ce
else:
    from scripts import clean_ephemeral as ce


REPO_ROOT: Path = Path(__file__).resolve().parents[2]
REAL_REGISTRY_PATH: Path = REPO_ROOT / "scripts" / "ephemeral_registry.json"


# ---------------------------------------------------------------------------
# Helpers


def _write_registry(tmp_path: Path, payload: object) -> Path:
    target = tmp_path / "registry.json"
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return target


def _minimal_entry(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "id": "sample",
        "path": "sample-dir",
        "mode": "subtree",
        "category": "root",
        "owner": "test",
        "purpose": "test",
    }
    base.update(overrides)
    return base


def _wrap(*entries: dict[str, object], schema_version: int = 1) -> dict[str, object]:
    return {"schema_version": schema_version, "targets": list(entries)}


# ---------------------------------------------------------------------------
# G-CWD: repo-root discovery.


class TestDiscoverRepoRoot:
    def test_finds_root_from_script_location(self) -> None:
        found = ce.discover_repo_root()
        assert found.resolve() == REPO_ROOT.resolve()

    def test_finds_root_from_arbitrary_cwd(self, tmp_path: Path) -> None:
        # Simulate invocation from a completely unrelated directory by
        # passing `start` explicitly to show the function is not
        # Path.cwd()-sensitive.
        from_here = REPO_ROOT / "tests" / "unit"
        found = ce.discover_repo_root(start=from_here)
        assert found.resolve() == REPO_ROOT.resolve()

    def test_raises_outside_git_repo(self, tmp_path: Path) -> None:
        with pytest.raises(ce.SetupError) as exc_info:
            ce.discover_repo_root(start=tmp_path)
        assert "Not inside a git repository" in str(exc_info.value)


# ---------------------------------------------------------------------------
# Committed-registry invariants.


class TestCommittedRegistry:
    def test_registry_file_exists(self) -> None:
        assert REAL_REGISTRY_PATH.is_file(), REAL_REGISTRY_PATH

    def test_registry_loads_without_error(self) -> None:
        registry = ce.load_registry(REAL_REGISTRY_PATH)
        assert registry["schema_version"] == ce.REGISTRY_SCHEMA_VERSION
        assert registry["targets"], "Registry has no targets"

    def test_all_entries_pass_inv_c_shape(self) -> None:
        # load_registry runs shape validation; a successful load proves INV-C
        # for the full committed registry. This test also asserts the shape
        # assumptions we depend on downstream.
        registry = ce.load_registry(REAL_REGISTRY_PATH)
        for entry in registry["targets"]:
            path = entry["path"]
            assert path, entry
            assert "\\" not in path, entry
            assert not path.startswith("/"), entry
            assert ".." not in path.split("/"), entry

    def test_all_entries_pass_inv_d_containment(self) -> None:
        registry = ce.load_registry(REAL_REGISTRY_PATH)
        repo_root = ce.discover_repo_root()
        for entry in registry["targets"]:
            abs_path = (repo_root / entry["path"]).resolve()
            # resolve().relative_to() raises if not contained
            abs_path.relative_to(repo_root.resolve())

    def test_all_entries_are_gitignored_inv_a(self) -> None:
        registry = ce.load_registry(REAL_REGISTRY_PATH)
        repo_root = ce.discover_repo_root()
        for entry in registry["targets"]:
            assert ce.check_gitignored(repo_root, entry), (
                f"INV-A violation: {entry['id']} at {entry['path']} is not gitignored"
            )

    def test_no_tracked_files_in_any_entry_inv_b(self) -> None:
        registry = ce.load_registry(REAL_REGISTRY_PATH)
        repo_root = ce.discover_repo_root()
        for entry in registry["targets"]:
            tracked = ce.tracked_files_under(repo_root, entry)
            assert tracked == (), (
                f"INV-B violation: {entry['id']} at {entry['path']} "
                f"contains tracked files: {tracked[:3]}"
            )


# ---------------------------------------------------------------------------
# INV-C: schema rejection.


class TestRegistrySchemaRejection:
    def test_rejects_glob_in_path(self, tmp_path: Path) -> None:
        bad = _write_registry(tmp_path, _wrap(_minimal_entry(path="a/*/b")))
        with pytest.raises(ce.ValidationError, match="glob"):
            ce.load_registry(bad)

    def test_rejects_absolute_path_posix(self, tmp_path: Path) -> None:
        bad = _write_registry(tmp_path, _wrap(_minimal_entry(path="/etc/foo")))
        with pytest.raises(ce.ValidationError, match="relative"):
            ce.load_registry(bad)

    def test_rejects_absolute_path_windows(self, tmp_path: Path) -> None:
        bad = _write_registry(tmp_path, _wrap(_minimal_entry(path="C:/foo")))
        with pytest.raises(ce.ValidationError, match="relative"):
            ce.load_registry(bad)

    def test_rejects_parent_traversal(self, tmp_path: Path) -> None:
        bad = _write_registry(tmp_path, _wrap(_minimal_entry(path="a/../b")))
        with pytest.raises(ce.ValidationError, match=r"\.\."):
            ce.load_registry(bad)

    def test_rejects_backslash_path(self, tmp_path: Path) -> None:
        bad = _write_registry(tmp_path, _wrap(_minimal_entry(path=r"a\b")))
        with pytest.raises(ce.ValidationError, match="POSIX-form"):
            ce.load_registry(bad)

    def test_rejects_double_slash(self, tmp_path: Path) -> None:
        bad = _write_registry(tmp_path, _wrap(_minimal_entry(path="a//b")))
        with pytest.raises(ce.ValidationError, match="empty"):
            ce.load_registry(bad)

    def test_rejects_empty_path(self, tmp_path: Path) -> None:
        bad = _write_registry(tmp_path, _wrap(_minimal_entry(path="")))
        with pytest.raises(ce.ValidationError, match="non-empty"):
            ce.load_registry(bad)

    def test_rejects_unknown_mode(self, tmp_path: Path) -> None:
        bad = _write_registry(tmp_path, _wrap(_minimal_entry(mode="rmrf")))
        with pytest.raises(ce.ValidationError, match="mode"):
            ce.load_registry(bad)

    def test_rejects_unknown_category(self, tmp_path: Path) -> None:
        bad = _write_registry(tmp_path, _wrap(_minimal_entry(category="other")))
        with pytest.raises(ce.ValidationError, match="category"):
            ce.load_registry(bad)

    def test_rejects_duplicate_id(self, tmp_path: Path) -> None:
        bad = _write_registry(
            tmp_path,
            _wrap(
                _minimal_entry(id="dup", path="a"),
                _minimal_entry(id="dup", path="b"),
            ),
        )
        with pytest.raises(ce.ValidationError, match="Duplicate registry id"):
            ce.load_registry(bad)

    def test_rejects_duplicate_path(self, tmp_path: Path) -> None:
        bad = _write_registry(
            tmp_path,
            _wrap(
                _minimal_entry(id="a", path="same"),
                _minimal_entry(id="b", path="same"),
            ),
        )
        with pytest.raises(ce.ValidationError, match="Duplicate registry path"):
            ce.load_registry(bad)

    def test_rejects_wrong_schema_version(self, tmp_path: Path) -> None:
        bad = _write_registry(tmp_path, _wrap(_minimal_entry(), schema_version=999))
        with pytest.raises(ce.ValidationError, match="schema_version"):
            ce.load_registry(bad)

    def test_rejects_missing_pid_pattern_on_pid_mode(self, tmp_path: Path) -> None:
        bad = _write_registry(
            tmp_path,
            _wrap(_minimal_entry(mode="subtree-with-live-pid-guard")),
        )
        with pytest.raises(ce.ValidationError, match="pid_child_pattern"):
            ce.load_registry(bad)

    def test_rejects_pid_pattern_on_non_pid_mode(self, tmp_path: Path) -> None:
        bad = _write_registry(
            tmp_path,
            _wrap(_minimal_entry(mode="subtree", pid_child_pattern="pid-*")),
        )
        with pytest.raises(ce.ValidationError, match="only valid for"):
            ce.load_registry(bad)

    def test_rejects_unknown_field(self, tmp_path: Path) -> None:
        bad = _write_registry(tmp_path, _wrap(_minimal_entry(extra="forbidden")))
        with pytest.raises(ce.ValidationError, match="unexpected keys"):
            ce.load_registry(bad)

    def test_rejects_non_dict_toplevel(self, tmp_path: Path) -> None:
        target = tmp_path / "registry.json"
        target.write_text(json.dumps([1, 2, 3]), encoding="utf-8")
        with pytest.raises(ce.ValidationError, match="top-level"):
            ce.load_registry(target)

    def test_rejects_empty_targets(self, tmp_path: Path) -> None:
        bad = _write_registry(tmp_path, {"schema_version": 1, "targets": []})
        with pytest.raises(ce.ValidationError, match="non-empty"):
            ce.load_registry(bad)

    def test_rejects_missing_registry_file_as_setup(self, tmp_path: Path) -> None:
        missing = tmp_path / "absent.json"
        with pytest.raises(ce.SetupError, match="not found"):
            ce.load_registry(missing)

    def test_rejects_invalid_json(self, tmp_path: Path) -> None:
        target = tmp_path / "registry.json"
        target.write_text("{ not json", encoding="utf-8")
        with pytest.raises(ce.ValidationError, match="valid JSON"):
            ce.load_registry(target)

    def test_rejects_unsorted_ids_at_load_time(self, tmp_path: Path) -> None:
        # Authoring guard: registry MUST be sorted by id ascending so
        # hand-edits cannot silently produce nondeterministic plan
        # output. Sorting at emission time is not enough — the file
        # itself must reflect the canonical order.
        bad = _write_registry(
            tmp_path,
            _wrap(
                _minimal_entry(id="zebra", path="z"),
                _minimal_entry(id="alpha", path="a"),
            ),
        )
        with pytest.raises(ce.ValidationError, match="sorted by id ascending"):
            ce.load_registry(bad)

    def test_committed_registry_is_id_sorted(self) -> None:
        # Proves the committed file itself follows the authoring rule.
        raw = json.loads(REAL_REGISTRY_PATH.read_text(encoding="utf-8"))
        assert isinstance(raw, dict)
        targets = raw["targets"]
        assert isinstance(targets, list)
        ids = [t["id"] for t in targets]
        assert ids == sorted(ids), f"Committed registry is not id-sorted: got {ids}"


# ---------------------------------------------------------------------------
# G-DEDUP.


class TestDedup:
    def _entry(self, eid: str, path: str) -> ce.RegistryEntry:
        return {
            "id": eid,
            "path": path,
            "mode": "subtree",
            "category": "extension",
            "owner": "t",
            "purpose": "t",
        }

    def test_parent_wins_real_overlap(self) -> None:
        parent = self._entry("extension-dist", "extension/dist")
        child = self._entry("extension-dist-ui", "extension/dist/ui")
        survivors, resolutions = ce.dedupe_plan([parent, child])
        assert [s["id"] for s in survivors] == ["extension-dist"]
        assert resolutions == [("extension-dist-ui", "extension-dist")]

    def test_deterministic_input_order_agnostic(self) -> None:
        parent = self._entry("extension-dist", "extension/dist")
        child = self._entry("extension-dist-ui", "extension/dist/ui")
        forward = ce.dedupe_plan([parent, child])
        reverse = ce.dedupe_plan([child, parent])
        assert forward == reverse

    def test_no_change_when_no_overlap(self) -> None:
        a = self._entry("a", "alpha")
        b = self._entry("b", "bravo")
        c = self._entry("c", "charlie/delta")
        survivors, resolutions = ce.dedupe_plan([a, b, c])
        assert {s["id"] for s in survivors} == {"a", "b", "c"}
        assert resolutions == []

    def test_chain_of_descendants_dropped_to_single_root(self) -> None:
        root = self._entry("r", "x")
        mid = self._entry("m", "x/y")
        leaf = self._entry("l", "x/y/z")
        survivors, resolutions = ce.dedupe_plan([leaf, mid, root])
        assert [s["id"] for s in survivors] == ["r"]
        dropped = {dropped_id for dropped_id, _ in resolutions}
        assert dropped == {"m", "l"}


# ---------------------------------------------------------------------------
# Planning: filter + sort.


class TestBuildPlan:
    def test_id_filter_selects_named_entries(self) -> None:
        registry = ce.load_registry(REAL_REGISTRY_PATH)
        plan, _ = ce.build_plan(registry, ids=frozenset({"run-artifacts"}))
        assert [e["id"] for e in plan] == ["run-artifacts"]

    def test_category_filter_selects_by_category(self) -> None:
        registry = ce.load_registry(REAL_REGISTRY_PATH)
        plan, _ = ce.build_plan(registry, categories=frozenset({"cli"}))
        assert all(e["category"] == "cli" for e in plan)
        assert plan, "cli category should have at least one entry"

    def test_unknown_id_raises(self) -> None:
        registry = ce.load_registry(REAL_REGISTRY_PATH)
        with pytest.raises(ce.ValidationError, match="Unknown --id"):
            ce.build_plan(registry, ids=frozenset({"does-not-exist"}))

    def test_refuses_union_of_id_and_category(self) -> None:
        # Programmatic safety guard: passing both dimensions is a scope
        # broadener via union semantics. The function-level API must
        # refuse it even if a caller bypasses argparse.
        registry = ce.load_registry(REAL_REGISTRY_PATH)
        with pytest.raises(ce.ValidationError, match="mutually exclusive"):
            ce.build_plan(
                registry,
                ids=frozenset({"run-artifacts"}),
                categories=frozenset({"extension"}),
            )

    def test_filter_registry_refuses_union_directly(self) -> None:
        # Same guard at filter_registry to prevent indirect callers
        # (e.g. future helpers) from constructing broadened plans.
        registry = ce.load_registry(REAL_REGISTRY_PATH)
        with pytest.raises(ce.ValidationError, match="mutually exclusive"):
            ce.filter_registry(
                registry,
                ids=frozenset({"run-artifacts"}),
                categories=frozenset({"extension"}),
            )

    def test_sort_plan_sorts_by_id_ascending(self) -> None:
        entries: list[ce.RegistryEntry] = [
            {
                "id": "zebra",
                "path": "z",
                "mode": "subtree",
                "category": "root",
                "owner": "t",
                "purpose": "t",
            },
            {
                "id": "alpha",
                "path": "a",
                "mode": "subtree",
                "category": "root",
                "owner": "t",
                "purpose": "t",
            },
            {
                "id": "mango",
                "path": "m",
                "mode": "subtree",
                "category": "root",
                "owner": "t",
                "purpose": "t",
            },
        ]
        ordered = ce.sort_plan(entries)
        assert [e["id"] for e in ordered] == ["alpha", "mango", "zebra"]

    def test_unfiltered_plan_includes_all_entries(self) -> None:
        registry = ce.load_registry(REAL_REGISTRY_PATH)
        plan, _ = ce.build_plan(registry)
        # Dedup drops extension-dist-ui under extension-dist.
        assert len(plan) == len(registry["targets"]) - 1


# ---------------------------------------------------------------------------
# G-EXIST.


class TestExistenceIsNoop:
    def test_missing_path_reports_exists_false_not_error(self, tmp_path: Path) -> None:
        # Use a path guaranteed absent in the repo, but still under repo root.
        entry: ce.RegistryEntry = {
            "id": "ephemeral-test-probe",
            "path": "tmp_test_work/__step1_probe_absent__",
            "mode": "subtree",
            "category": "root",
            "owner": "t",
            "purpose": "t",
        }
        registry: ce.Registry = {
            "schema_version": 1,
            "targets": [entry],
        }
        repo_root = ce.discover_repo_root()
        plan, _ = ce.build_plan(registry)
        reports, errors = ce.validate_plan(repo_root, plan)
        assert len(reports) == 1
        assert reports[0].exists is False
        # G-EXIST: missing path is not itself an error. INV-A still runs:
        # the probe path is under an ignored parent, so gitignore passes.
        assert all("INV-A" not in e for e in errors), errors


class TestModeFilesystemMatch:
    """Guard 2: when a registered path exists, its filesystem type must
    match the declared mode. G-EXIST is preserved — the check only
    fires when `exists=True`.
    """

    def _probe_entry(self, eid: str, rel: str, mode: ce.Mode) -> ce.RegistryEntry:
        entry: ce.RegistryEntry = {
            "id": eid,
            "path": rel,
            "mode": mode,
            "category": "root",
            "owner": "t",
            "purpose": "t",
        }
        return entry

    def test_file_mode_rejects_directory_at_path(self) -> None:
        # .tmp/ is a real directory in the repo. Pointing a file-mode
        # entry at it must be flagged.
        entry = self._probe_entry("probe-file-at-dir", ".tmp", "file")
        repo_root = ce.discover_repo_root()
        reports, errors = ce.validate_plan(repo_root, [entry])
        assert len(reports) == 1
        assert reports[0].exists is True
        assert any(
            "Mode mismatch" in e
            and "probe-file-at-dir" in e
            and "not a regular file" in e
            for e in errors
        ), errors

    def test_subtree_mode_rejects_file_at_path(self) -> None:
        # extension/test-results.xml is a real file. Pointing a subtree
        # entry at it must be flagged.
        entry = self._probe_entry(
            "probe-subtree-at-file", "extension/test-results.xml", "subtree"
        )
        repo_root = ce.discover_repo_root()
        reports, errors = ce.validate_plan(repo_root, [entry])
        assert len(reports) == 1
        assert reports[0].exists is True
        assert any(
            "Mode mismatch" in e
            and "probe-subtree-at-file" in e
            and "not a directory" in e
            for e in errors
        ), errors

    def test_pid_guard_mode_rejects_file_at_path(self) -> None:
        # Same invariant holds for subtree-with-live-pid-guard.
        entry: ce.RegistryEntry = {
            "id": "probe-pid-guard-at-file",
            "path": "extension/test-results.xml",
            "mode": "subtree-with-live-pid-guard",
            "category": "root",
            "owner": "t",
            "purpose": "t",
            "pid_child_pattern": "pid-*",
        }
        repo_root = ce.discover_repo_root()
        reports, errors = ce.validate_plan(repo_root, [entry])
        assert any(
            "Mode mismatch" in e and "probe-pid-guard-at-file" in e for e in errors
        ), errors

    def test_mode_check_skipped_when_path_missing(self) -> None:
        # G-EXIST interaction: a missing path must not trigger a mode
        # mismatch — the check is simply not evaluated.
        entry = self._probe_entry(
            "probe-absent",
            "tmp_test_work/__step1_mode_probe_absent__",
            "file",  # intentional: would mismatch if the dir existed
        )
        repo_root = ce.discover_repo_root()
        reports, errors = ce.validate_plan(repo_root, [entry])
        assert reports[0].exists is False
        assert all("Mode mismatch" not in e for e in errors), errors

    def test_committed_registry_has_no_mode_mismatch(self) -> None:
        # Positive path: every existing registered entry matches its mode.
        registry = ce.load_registry(REAL_REGISTRY_PATH)
        repo_root = ce.discover_repo_root()
        plan, _ = ce.build_plan(registry)
        _, errors = ce.validate_plan(repo_root, plan)
        assert not any("Mode mismatch" in e for e in errors), errors


# ---------------------------------------------------------------------------
# G-ORDER: JSON output is byte-stable.


class TestJsonOutputDeterminism:
    def test_json_output_byte_stable_across_two_runs(self) -> None:
        registry = ce.load_registry(REAL_REGISTRY_PATH)
        repo_root = ce.discover_repo_root()
        plan, resolutions = ce.build_plan(registry)
        reports, errors = ce.validate_plan(repo_root, plan)
        first = ce.plan_report_to_json(
            ce.PlanReport(
                repo_root=repo_root,
                registry_path=REAL_REGISTRY_PATH,
                entries=tuple(reports),
                overlap_resolutions=tuple(resolutions),
                errors=tuple(errors),
            )
        )
        reports2, errors2 = ce.validate_plan(repo_root, plan)
        second = ce.plan_report_to_json(
            ce.PlanReport(
                repo_root=repo_root,
                registry_path=REAL_REGISTRY_PATH,
                entries=tuple(reports2),
                overlap_resolutions=tuple(resolutions),
                errors=tuple(errors2),
            )
        )

        # Size may drift between runs on a live worktree; compare the
        # shape-defining fields only.
        def _strip_size(blob: str) -> list[object]:
            parsed = json.loads(blob)
            entries_list = parsed["entries"]
            assert isinstance(entries_list, list)
            stripped: list[object] = []
            for item in entries_list:
                assert isinstance(item, dict)
                item.pop("size_bytes", None)
                stripped.append(item)
            parsed["entries"] = stripped
            return [parsed]

        assert _strip_size(first) == _strip_size(second)

    def test_json_keys_are_sorted(self) -> None:
        registry = ce.load_registry(REAL_REGISTRY_PATH)
        repo_root = ce.discover_repo_root()
        plan, resolutions = ce.build_plan(registry)
        reports, errors = ce.validate_plan(repo_root, plan)
        blob = ce.plan_report_to_json(
            ce.PlanReport(
                repo_root=repo_root,
                registry_path=REAL_REGISTRY_PATH,
                entries=tuple(reports),
                overlap_resolutions=tuple(resolutions),
                errors=tuple(errors),
            )
        )
        parsed = json.loads(blob)
        # Reserialize with sort_keys=True and verify the script's emission
        # used the same key order.
        resorted = json.dumps(parsed, indent=2, sort_keys=True) + "\n"
        assert blob == resorted


# ---------------------------------------------------------------------------
# CLI behavior (subprocess — exercises discover_repo_root against real cwd).


class TestCliExitCodes:
    def test_cli_exit_zero_on_clean_registry(self) -> None:
        result = subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / "clean_ephemeral.py")],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, (
            f"stdout: {result.stdout!r}\nstderr: {result.stderr!r}"
        )

    def test_cli_exit_zero_invoked_from_subdirectory(self) -> None:
        # G-CWD: script must resolve repo root independent of cwd.
        subdir = REPO_ROOT / "tests" / "unit"
        result = subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / "clean_ephemeral.py")],
            cwd=subdir,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, (
            f"stdout: {result.stdout!r}\nstderr: {result.stderr!r}"
        )

    def test_cli_json_mode_parses(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(REPO_ROOT / "scripts" / "clean_ephemeral.py"),
                "--json",
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr
        payload = json.loads(result.stdout)
        assert payload["schema_version"] == 1
        assert isinstance(payload["entries"], list)

    def test_cli_rejects_both_id_and_category(self) -> None:
        # argparse mutual-exclusion layer: the CLI must refuse the
        # combination before any validation runs. Exit 2 is argparse's
        # standard for usage errors.
        result = subprocess.run(
            [
                sys.executable,
                str(REPO_ROOT / "scripts" / "clean_ephemeral.py"),
                "--id",
                "run-artifacts",
                "--category",
                "extension",
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode != 0, (
            f"CLI must refuse --id + --category union; got stdout "
            f"{result.stdout!r} stderr {result.stderr!r}"
        )
        assert "not allowed" in result.stderr or "argument" in result.stderr


# ---------------------------------------------------------------------------
# Step 2: rmtree_resilient (G-RETRY, Windows read-only handling, G-EXIST).


class TestRmtreeResilient:
    def test_deletes_single_file(self, tmp_path: Path) -> None:
        target = tmp_path / "file.txt"
        target.write_text("hello", encoding="utf-8")
        result = ce.rmtree_resilient(target)
        assert result.action is ce.Action.DELETED
        assert result.retries == 0
        assert result.bytes_freed == len(b"hello")
        assert result.error is None
        assert not target.exists()

    def test_deletes_nested_directory_tree(self, tmp_path: Path) -> None:
        target = tmp_path / "scratch"
        (target / "a" / "b" / "c").mkdir(parents=True)
        (target / "a" / "leaf.txt").write_text("leaf", encoding="utf-8")
        (target / "a" / "b" / "other.txt").write_text("x" * 100, encoding="utf-8")
        result = ce.rmtree_resilient(target)
        assert result.action is ce.Action.DELETED
        assert result.bytes_freed == 104  # 4 + 100
        assert not target.exists()

    def test_missing_path_returns_noop_missing(self, tmp_path: Path) -> None:
        # G-EXIST at the delete layer: missing path is a clean no-op,
        # not an error. bytes_freed stays 0, retries 0.
        target = tmp_path / "never-existed"
        result = ce.rmtree_resilient(target)
        assert result.action is ce.Action.NOOP_MISSING
        assert result.retries == 0
        assert result.bytes_freed == 0
        assert result.error is None

    def test_symlink_branch_unlinks_without_following_target(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Proves rmtree_resilient's symlink branch calls `unlink` and
        # never descends into `shutil.rmtree`. On POSIX and Windows
        # with developer mode, the branch is exercised against a real
        # symlink; otherwise it is exercised via monkey-patched Path
        # methods so the test runs unconditionally on every OS
        # (`--max-skips=0` forbids runtime skips).
        real_dir = tmp_path / "outside"
        real_dir.mkdir()
        preserved = real_dir / "preserved.txt"
        preserved.write_text("keep me", encoding="utf-8")

        link = tmp_path / "link_to_outside"
        real_symlink_created = False
        try:
            link.symlink_to(real_dir, target_is_directory=True)
            real_symlink_created = link.is_symlink()
        except (OSError, NotImplementedError):
            real_symlink_created = False

        if real_symlink_created:
            result = ce.rmtree_resilient(link)
            assert result.action is ce.Action.DELETED
            assert not link.exists()
            assert preserved.read_text(encoding="utf-8") == "keep me"
            return

        # Fallback path: prove the branch via a method-level
        # monkey-patch. rmtree_resilient must call `unlink()` on a
        # symlink-typed Path and must NOT call `shutil.rmtree`.
        shutil_called = {"count": 0}
        unlink_called = {"count": 0}
        fake_link = tmp_path / "fake_link"
        fake_link.touch()  # give it an inode so exists() is True

        def fake_is_symlink(self: Path) -> bool:
            return self == fake_link

        def fake_is_file(self: Path) -> bool:
            return False

        def fake_is_dir(self: Path) -> bool:
            return False

        def fake_unlink(self: Path, missing_ok: bool = False) -> None:
            unlink_called["count"] += 1
            # Delegate to real os.unlink so the file actually goes away.
            os.unlink(self)

        def fake_rmtree(path: object, onexc: object = None) -> None:
            shutil_called["count"] += 1

        monkeypatch.setattr(Path, "is_symlink", fake_is_symlink)
        monkeypatch.setattr(Path, "is_file", fake_is_file)
        monkeypatch.setattr(Path, "is_dir", fake_is_dir)
        monkeypatch.setattr(Path, "unlink", fake_unlink)
        monkeypatch.setattr(shutil, "rmtree", fake_rmtree)
        result = ce.rmtree_resilient(fake_link)
        assert result.action is ce.Action.DELETED
        assert unlink_called["count"] == 1
        assert shutil_called["count"] == 0
        assert preserved.read_text(encoding="utf-8") == "keep me"

    def test_deletes_read_only_file_via_chmod_handler(self, tmp_path: Path) -> None:
        # Reproduces the Windows git-pack-files / read-only scenario
        # cross-OS: chmod the file to 0o400 (no write), then delete.
        # The rmtree onexc handler / direct-unlink path must succeed.
        target = tmp_path / "readonly.txt"
        target.write_text("locked", encoding="utf-8")
        os.chmod(target, 0o400)
        try:
            result = ce.rmtree_resilient(target)
        finally:
            # Restore perms in case the test fails; otherwise tmp_path
            # cleanup can fail on Windows too.
            if target.exists():
                os.chmod(target, 0o700)
        assert result.action is ce.Action.DELETED, result
        assert not target.exists()

    def test_retries_on_transient_permission_error(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        # Monkeypatch shutil.rmtree in the module's namespace to raise
        # EACCES twice, then delegate to the real rmtree on the third
        # call. rmtree_resilient must surface retries=2 and succeed.
        target = tmp_path / "scratch"
        target.mkdir()
        (target / "a.txt").write_text("x", encoding="utf-8")

        original_rmtree = shutil.rmtree
        call_counter = {"n": 0}

        def flaky_rmtree(path: str | Path, onexc: object = None) -> None:
            call_counter["n"] += 1
            if call_counter["n"] <= 2:
                raise OSError(errno.EACCES, "simulated transient lock")
            # Third call: do the real delete. Use default onexc None
            # (real rmtree accepts a callable or None).
            original_rmtree(path)

        monkeypatch.setattr(shutil, "rmtree", flaky_rmtree)
        result = ce.rmtree_resilient(target)
        assert result.action is ce.Action.DELETED
        assert result.retries == 2
        assert call_counter["n"] == 3
        assert not target.exists()

    def test_gives_up_after_max_retries(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        target = tmp_path / "scratch"
        target.mkdir()
        (target / "a.txt").write_text("x", encoding="utf-8")

        def always_fail(path: str | Path, onexc: object = None) -> None:
            raise OSError(errno.EACCES, "simulated persistent lock")

        monkeypatch.setattr(shutil, "rmtree", always_fail)
        result = ce.rmtree_resilient(target)
        assert result.action is ce.Action.ERROR
        assert result.retries == ce.MAX_DELETE_RETRIES
        assert result.bytes_freed == 0
        assert result.error is not None
        assert "simulated persistent lock" in result.error


# ---------------------------------------------------------------------------
# Step 2: execute_plan (G-PARTIAL aggregation, dry-run vs --yes, deferred).


def _synthetic_entry_report(
    tmp_path: Path,
    *,
    eid: str,
    rel: str,
    mode: ce.Mode = "subtree",
    exists: bool | None = None,
    size_bytes: int = 0,
    create: bool = True,
) -> ce.EntryReport:
    abs_path = tmp_path / rel
    if create:
        if mode == "file":
            abs_path.parent.mkdir(parents=True, exist_ok=True)
            abs_path.write_text("x" * max(size_bytes, 1), encoding="utf-8")
        else:
            abs_path.mkdir(parents=True, exist_ok=True)
            if size_bytes > 0:
                (abs_path / "payload.bin").write_bytes(b"0" * size_bytes)
    entry: ce.RegistryEntry = {
        "id": eid,
        "path": rel,
        "mode": mode,
        "category": "root",
        "owner": "test",
        "purpose": "test",
    }
    if mode == "subtree-with-live-pid-guard":
        entry["pid_child_pattern"] = "pid-*"
    if exists is None:
        exists = abs_path.exists()
    actual_size = ce._directory_size_bytes(abs_path) if exists else 0
    return ce.EntryReport(
        entry=entry,
        absolute_path=abs_path,
        exists=exists,
        gitignored=True,
        tracked_files=(),
        size_bytes=actual_size,
    )


class TestExecutePlan:
    def test_dry_run_marks_existing_as_would_delete(self, tmp_path: Path) -> None:
        report = _synthetic_entry_report(
            tmp_path, eid="x", rel="scratch", size_bytes=10
        )
        result = ce.execute_plan([report], dry_run=True)
        assert len(result.results) == 1
        entry = result.results[0]
        assert entry.action is ce.Action.WOULD_DELETE
        assert entry.bytes_freed > 0
        # Critical: dry-run MUST NOT touch the filesystem.
        assert report.absolute_path.exists()

    def test_dry_run_marks_missing_as_noop(self, tmp_path: Path) -> None:
        report = _synthetic_entry_report(tmp_path, eid="x", rel="scratch", create=False)
        result = ce.execute_plan([report], dry_run=True)
        assert result.results[0].action is ce.Action.NOOP_MISSING
        assert result.would_delete_count == 0

    def test_yes_actually_deletes(self, tmp_path: Path) -> None:
        report = _synthetic_entry_report(
            tmp_path, eid="x", rel="scratch", size_bytes=50
        )
        result = ce.execute_plan([report], dry_run=False)
        assert result.results[0].action is ce.Action.DELETED
        assert result.results[0].bytes_freed > 0
        assert not report.absolute_path.exists()

    def test_pid_guard_mode_deferred(self, tmp_path: Path) -> None:
        # subtree-with-live-pid-guard entries must be DEFERRED at Step 2
        # (R7 sweep lives in Step 3). They must not delete children, must
        # not contribute bytes_freed, and must not tip dry-run into
        # exit-2 "would delete" territory.
        report = _synthetic_entry_report(
            tmp_path,
            eid="pid-parent",
            rel="scratch",
            mode="subtree-with-live-pid-guard",
            size_bytes=99,
        )
        yes_result = ce.execute_plan([report], dry_run=False)
        assert yes_result.results[0].action is ce.Action.DEFERRED
        assert yes_result.results[0].bytes_freed == 0
        assert yes_result.results[0].note is not None
        # Path must be untouched.
        assert report.absolute_path.exists()
        dry_result = ce.execute_plan([report], dry_run=True)
        assert dry_result.would_delete_count == 0
        assert dry_result.deferred_count == 1

    def test_aggregates_partial_failure_without_early_exit(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        # G-PARTIAL: one target fails, the other succeeds; the report
        # aggregates both outcomes and the sweep never short-circuits.
        good = _synthetic_entry_report(
            tmp_path, eid="good", rel="good_dir", size_bytes=1
        )
        bad = _synthetic_entry_report(tmp_path, eid="bad", rel="bad_dir", size_bytes=1)

        original_rmtree = shutil.rmtree

        def selective_failing_rmtree(path: str | Path, onexc: object = None) -> None:
            if str(path) == str(bad.absolute_path):
                raise OSError(errno.EACCES, "simulated persistent lock on bad")
            original_rmtree(path)

        monkeypatch.setattr(shutil, "rmtree", selective_failing_rmtree)
        result = ce.execute_plan([good, bad], dry_run=False)
        assert result.deleted_count == 1
        assert result.error_count == 1
        assert not good.absolute_path.exists()
        assert bad.absolute_path.exists()  # still there because rmtree failed


# ---------------------------------------------------------------------------
# Step 2: run_with_resolved_inputs — dry-run/--yes/idempotency exit codes.


def _fake_repo(tmp_path: Path) -> Path:
    """Initialize a minimal git repo with .gitignore rules for tests."""
    subprocess.run(
        ["git", "init", "--quiet", "--initial-branch=main"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
    )
    (tmp_path / ".gitignore").write_text(
        "scratch/\nscratch_file\nsynthetic/\n",
        encoding="utf-8",
    )
    return tmp_path


def _write_test_registry(registry_path: Path, *entries: dict[str, object]) -> None:
    payload = {"schema_version": 1, "targets": list(entries)}
    registry_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _argv_namespace(
    *,
    dry_run: bool = False,
    yes: bool = False,
    json_mode: bool = False,
    ids: list[str] | None = None,
    categories: list[str] | None = None,
) -> argparse.Namespace:
    return argparse.Namespace(
        id=ids or [],
        category=categories or [],
        dry_run=dry_run,
        yes=yes,
        json=json_mode,
        registry=None,
    )


class TestRunExitCodes:
    def test_dry_run_empty_plan_exits_zero(self, tmp_path: Path) -> None:
        # Requirement: --dry-run exits 0 when the effective plan is empty.
        repo = _fake_repo(tmp_path)
        registry_path = repo / "registry.json"
        _write_test_registry(
            registry_path,
            {
                "id": "scratch",
                "path": "scratch",
                "mode": "subtree",
                "category": "root",
                "owner": "t",
                "purpose": "t",
            },
        )
        # No scratch/ exists, so effective plan is empty.
        stdout = io.StringIO()
        rc = ce.run_with_resolved_inputs(
            repo, registry_path, _argv_namespace(dry_run=True), stdout=stdout
        )
        assert rc == 0, stdout.getvalue()

    def test_dry_run_with_work_exits_two(self, tmp_path: Path) -> None:
        # Requirement: --dry-run exits 2 only when it would delete.
        repo = _fake_repo(tmp_path)
        (repo / "scratch").mkdir()
        (repo / "scratch" / "leaf.txt").write_text("keep", encoding="utf-8")
        registry_path = repo / "registry.json"
        _write_test_registry(
            registry_path,
            {
                "id": "scratch",
                "path": "scratch",
                "mode": "subtree",
                "category": "root",
                "owner": "t",
                "purpose": "t",
            },
        )
        stdout = io.StringIO()
        rc = ce.run_with_resolved_inputs(
            repo, registry_path, _argv_namespace(dry_run=True), stdout=stdout
        )
        assert rc == 2, stdout.getvalue()
        # G-EXIST: dry-run does not touch the filesystem.
        assert (repo / "scratch" / "leaf.txt").exists()

    def test_yes_deletes_and_exits_zero(self, tmp_path: Path) -> None:
        repo = _fake_repo(tmp_path)
        (repo / "scratch").mkdir()
        (repo / "scratch" / "leaf.txt").write_text("bye", encoding="utf-8")
        registry_path = repo / "registry.json"
        _write_test_registry(
            registry_path,
            {
                "id": "scratch",
                "path": "scratch",
                "mode": "subtree",
                "category": "root",
                "owner": "t",
                "purpose": "t",
            },
        )
        stdout = io.StringIO()
        rc = ce.run_with_resolved_inputs(
            repo, registry_path, _argv_namespace(yes=True), stdout=stdout
        )
        assert rc == 0, stdout.getvalue()
        assert not (repo / "scratch").exists()

    def test_yes_is_idempotent_on_second_run(self, tmp_path: Path) -> None:
        # Requirement: second --yes run after deletion exits 0 with
        # zero deleted and zero bytes freed.
        repo = _fake_repo(tmp_path)
        (repo / "scratch").mkdir()
        (repo / "scratch" / "leaf.txt").write_text("bye", encoding="utf-8")
        registry_path = repo / "registry.json"
        _write_test_registry(
            registry_path,
            {
                "id": "scratch",
                "path": "scratch",
                "mode": "subtree",
                "category": "root",
                "owner": "t",
                "purpose": "t",
            },
        )
        # First run deletes.
        first_out = io.StringIO()
        rc1 = ce.run_with_resolved_inputs(
            repo,
            registry_path,
            _argv_namespace(yes=True, json_mode=True),
            stdout=first_out,
        )
        first_payload = json.loads(first_out.getvalue())
        assert rc1 == 0
        assert first_payload["summary"]["deleted_count"] == 1
        assert first_payload["summary"]["total_bytes_freed"] > 0
        # Second run finds nothing to do.
        second_out = io.StringIO()
        rc2 = ce.run_with_resolved_inputs(
            repo,
            registry_path,
            _argv_namespace(yes=True, json_mode=True),
            stdout=second_out,
        )
        second_payload = json.loads(second_out.getvalue())
        assert rc2 == 0
        assert second_payload["summary"]["deleted_count"] == 0
        assert second_payload["summary"]["total_bytes_freed"] == 0
        assert second_payload["summary"]["noop_missing_count"] == 1

    def test_yes_refuses_when_tracked_files_present(self, tmp_path: Path) -> None:
        # INV-B safety under delete: a registered target containing
        # tracked files must refuse and NOT touch the filesystem.
        repo = _fake_repo(tmp_path)
        # Override gitignore: stop ignoring 'scratch' so git can
        # actually track a file in it.
        (repo / ".gitignore").write_text("", encoding="utf-8")
        (repo / "scratch").mkdir()
        tracked_file = repo / "scratch" / "tracked.txt"
        tracked_file.write_text("keep", encoding="utf-8")
        subprocess.run(
            ["git", "-c", "user.email=t@t", "-c", "user.name=t", "add", "scratch"],
            cwd=repo,
            check=True,
            capture_output=True,
        )
        subprocess.run(
            [
                "git",
                "-c",
                "user.email=t@t",
                "-c",
                "user.name=t",
                "commit",
                "-q",
                "-m",
                "seed",
            ],
            cwd=repo,
            check=True,
            capture_output=True,
        )
        registry_path = repo / "registry.json"
        _write_test_registry(
            registry_path,
            {
                "id": "scratch",
                "path": "scratch",
                "mode": "subtree",
                "category": "root",
                "owner": "t",
                "purpose": "t",
            },
        )
        stdout = io.StringIO()
        rc = ce.run_with_resolved_inputs(
            repo, registry_path, _argv_namespace(yes=True), stdout=stdout
        )
        assert rc == 1, stdout.getvalue()  # EXIT_VALIDATION
        # File must still exist; INV-B blocked the delete.
        assert tracked_file.exists()


class TestCliMutualExclusionDryRunYes:
    def test_dry_run_and_yes_mutually_exclusive(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(REPO_ROOT / "scripts" / "clean_ephemeral.py"),
                "--dry-run",
                "--yes",
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode != 0
        assert "not allowed" in result.stderr or "argument" in result.stderr


# ---------------------------------------------------------------------------
# Step 2: JSON report schema lock (v1 validate-only, v2 action).


class TestReportSchemaLock:
    # Locked key sets. Adding or removing any field here without bumping
    # the corresponding REPORT_SCHEMA constant is the contract break the
    # stop-hook should catch.
    _V1_TOP_LEVEL: frozenset[str] = frozenset(
        {
            "schema_version",
            "repo_root",
            "registry_path",
            "entries",
            "overlap_resolutions",
            "errors",
        }
    )
    _V1_ENTRY_KEYS: frozenset[str] = frozenset(
        {
            "id",
            "path",
            "mode",
            "category",
            "exists",
            "gitignored",
            "tracked_files_found",
            "size_bytes",
        }
    )
    _V2_TOP_LEVEL: frozenset[str] = _V1_TOP_LEVEL | {"summary"}
    _V2_ENTRY_ACTION_KEYS: frozenset[str] = _V1_ENTRY_KEYS | {
        "action",
        "retries",
        "bytes_freed",
        "delete_error",
        "note",
    }
    _V2_SUMMARY_KEYS: frozenset[str] = frozenset(
        {
            "deleted_count",
            "would_delete_count",
            "noop_missing_count",
            "deferred_count",
            "error_count",
            "total_bytes_freed",
        }
    )

    def _run_and_parse(
        self, *, dry_run: bool = False, yes: bool = False
    ) -> dict[str, object]:
        repo = REPO_ROOT
        registry_path = repo / "scripts" / "ephemeral_registry.json"
        stdout = io.StringIO()
        args = _argv_namespace(
            dry_run=dry_run, yes=yes, json_mode=True, ids=["run-artifacts"]
        )
        rc = ce.run_with_resolved_inputs(repo, registry_path, args, stdout=stdout)
        # Not asserting rc here; caller decides based on mode.
        _ = rc
        payload = json.loads(stdout.getvalue())
        assert isinstance(payload, dict)
        return payload

    def _entries_of(self, payload: dict[str, object]) -> list[dict[str, object]]:
        entries = payload["entries"]
        assert isinstance(entries, list)
        narrowed: list[dict[str, object]] = []
        for entry in entries:
            assert isinstance(entry, dict)
            narrowed.append(entry)
        return narrowed

    def test_validate_only_emits_schema_v1(self) -> None:
        payload = self._run_and_parse()
        assert payload["schema_version"] == ce.REPORT_SCHEMA_V1
        assert "summary" not in payload
        for entry in self._entries_of(payload):
            assert "action" not in entry
            assert "retries" not in entry
            assert "bytes_freed" not in entry
            assert "delete_error" not in entry
            assert "note" not in entry

    def test_dry_run_emits_schema_v2(self) -> None:
        payload = self._run_and_parse(dry_run=True)
        assert payload["schema_version"] == ce.REPORT_SCHEMA_V2

    def test_v1_top_level_keys_locked(self) -> None:
        payload = self._run_and_parse()
        assert set(payload.keys()) == self._V1_TOP_LEVEL, (
            "REPORT_SCHEMA_V1 top-level keys drifted; bump "
            "REPORT_SCHEMA_V1 and update the lock."
        )

    def test_v1_entry_keys_locked(self) -> None:
        payload = self._run_and_parse()
        for entry in self._entries_of(payload):
            assert set(entry.keys()) == self._V1_ENTRY_KEYS, (
                f"REPORT_SCHEMA_V1 entry keys drifted on {entry.get('id')!r}"
            )

    def test_v2_top_level_keys_locked(self) -> None:
        payload = self._run_and_parse(dry_run=True)
        assert set(payload.keys()) == self._V2_TOP_LEVEL, (
            "REPORT_SCHEMA_V2 top-level keys drifted; bump "
            "REPORT_SCHEMA_V2 and update the lock."
        )

    def test_v2_entry_action_keys_locked(self) -> None:
        payload = self._run_and_parse(dry_run=True)
        for entry in self._entries_of(payload):
            assert set(entry.keys()) == self._V2_ENTRY_ACTION_KEYS, (
                f"REPORT_SCHEMA_V2 entry keys drifted on {entry.get('id')!r}"
            )

    def test_v2_summary_keys_locked(self) -> None:
        payload = self._run_and_parse(dry_run=True)
        summary = payload["summary"]
        assert isinstance(summary, dict)
        assert set(summary.keys()) == self._V2_SUMMARY_KEYS, (
            "REPORT_SCHEMA_V2 summary keys drifted; bump "
            "REPORT_SCHEMA_V2 and update the lock."
        )

    def test_action_enum_values_locked(self) -> None:
        # Each action string is a public contract — JSON consumers
        # match on these exact values.
        assert {a.value for a in ce.Action} == {
            "would_delete",
            "deleted",
            "noop_missing",
            "deferred",
            "error",
        }
