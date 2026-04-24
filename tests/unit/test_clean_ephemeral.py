"""Step 1 validator tests for scripts/clean_ephemeral.py.

Covers registry schema validation (INV-C), containment (INV-D),
gitignore parity (INV-A), tracked-file refusal (INV-B), and the
Step-1 guards G-CWD, G-EXIST, G-ORDER, G-DEDUP. No delete logic
is exercised here; that lives in later steps of issue #327.
"""

from __future__ import annotations

import json
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
        assert registry["schema_version"] == ce.SCHEMA_VERSION
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
