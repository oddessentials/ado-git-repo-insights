"""Safety-bounded auto-fix for the subprocess allowlist (#362 dev-ex audit).

The pre-commit subprocess guard keys allowlist entries on ``(file, line,
code)``.  A legitimate edit that shifts lines (e.g. adding an import
line) used to force the developer to manually rewrite line numbers in
``.subprocess-allowlist.json``.  ``auto_fix_subprocess_allowlist_line_shifts``
removes that DX gap by applying line-shift updates ONLY when the shift
is unambiguous, while preserving every other safety property of the
existing gate.

These tests lock the safety contract:

  - line-shift updates the entry's ``line`` and only the ``line`` (file,
    code, reason preserved verbatim);
  - uniform multi-entry shift within the same ``(file, code)`` bucket
    works (the actual #362 incident scenario);
  - non-uniform shift inside a bucket fails closed (no allowlist write);
  - new unallowlisted subprocess call fails closed (count mismatch);
  - changed code (different normalized shape) fails closed (no match);
  - refactored-away entry is preserved unchanged (no silent removal).

Cross-OS (QG-39): pathlib + UTF-8 only; no shell.  Identical assertions
on Windows / Linux / macOS.

Typing (QG-40): full annotations; no ``typing.Any``.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType
from typing import Final

import pytest

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
GUARD_SCRIPT: Final[Path] = REPO_ROOT / "scripts" / "check_rule_disable_invariants.py"


def _load_guard_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "check_rule_disable_invariants_for_test", GUARD_SCRIPT
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["check_rule_disable_invariants_for_test"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def guard_mod() -> ModuleType:
    return _load_guard_module()


def _setup_repo(
    tmp_path: Path, files: dict[str, str], allowlist_entries: list[dict[str, object]]
) -> Path:
    """Materialize a synthetic repo at ``tmp_path``.

    ``files`` maps relative path to file content (each gets written under
    ``tmp_path``).  ``allowlist_entries`` is the list of allowlist dicts
    written to ``tmp_path/.subprocess-allowlist.json``.
    """
    for rel, content in files.items():
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    allowlist_path = tmp_path / ".subprocess-allowlist.json"
    allowlist_path.write_text(
        json.dumps(
            {"description": "test", "entries": allowlist_entries},
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return tmp_path


def _patch_guard_paths(
    guard_mod: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    repo_root: Path,
    tracked: list[str],
) -> None:
    """Redirect the guard's allowlist path and tracked-file lookup at ``repo_root``."""
    monkeypatch.setattr(
        guard_mod, "SUBPROCESS_ALLOWLIST_PATH", repo_root / ".subprocess-allowlist.json"
    )
    monkeypatch.setattr(guard_mod, "_get_tracked_py_files", lambda _cwd: list(tracked))


def _read_allowlist(repo_root: Path) -> list[dict[str, object]]:
    raw = (repo_root / ".subprocess-allowlist.json").read_text(encoding="utf-8")
    parsed = json.loads(raw)
    entries = parsed["entries"]
    assert isinstance(entries, list)
    return entries


def _make_subprocess_call(line_count_before: int) -> str:
    """Generate a single allowlisted-shape subprocess call site.

    The body is intentionally non-trivial so check_subprocess_safety
    flags the (file, line, code) triple as a non-literal-arg violation.
    """
    return (
        "\n" * line_count_before
        + "argv = build_argv()\n"
        + "result = subprocess.run(\n"
        + "    argv,\n"
        + "    cwd=str(REPO_ROOT),\n"
        + "    capture_output=True,\n"
        + "    text=True,\n"
        + "    check=True,\n"
        + ")\n"
    )


def test_single_entry_line_shift_updates_line(
    guard_mod: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Single matching entry shifted by N → entry's line updated to N+old."""
    # Source has one subprocess call at line 10 (1 leading import + 8 blank
    # lines + the call = first violation on line 10 per the multi-line scan).
    source_content = "import subprocess\n" + _make_subprocess_call(8)
    repo = _setup_repo(
        tmp_path,
        {"scripts/foo.py": source_content},
        [
            {
                "file": "scripts/foo.py",
                "line": 5,
                "code": "result = subprocess.run(",
                "reason": "test reason A",
            }
        ],
    )
    _patch_guard_paths(guard_mod, monkeypatch, repo, ["scripts/foo.py"])

    updates = guard_mod.auto_fix_subprocess_allowlist_line_shifts(repo)

    assert len(updates) == 1
    file_path, old_line, new_line = updates[0]
    assert file_path == "scripts/foo.py"
    assert old_line == 5
    # Entry preserves code AND reason verbatim; only line moves.
    written = _read_allowlist(repo)
    assert len(written) == 1
    assert written[0]["file"] == "scripts/foo.py"
    assert written[0]["line"] == new_line
    assert written[0]["code"] == "result = subprocess.run("
    assert written[0]["reason"] == "test reason A"


def test_uniform_shift_multi_entry_same_code(
    guard_mod: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Three entries with same (file, code) all shifted by +1 → all updated.

    This is the actual #362 incident scenario: adding one import line
    shifted three pre-existing approved entries by +1.  Each entry has a
    DIFFERENT reason — the auto-fix must preserve every reason verbatim
    and pair entries to violations by sorted line order.
    """
    # Source: three call sites with violations on lines 4, 13, 22 (each
    # 9-element block: blank / argv setup / 7-line subprocess.run call).
    source_lines: list[str] = ["import subprocess"]
    for _ in range(3):
        source_lines.extend(["", "argv = build_argv()"])
        source_lines.extend(
            [
                "result = subprocess.run(",
                "    argv,",
                "    cwd=str(REPO_ROOT),",
                "    capture_output=True,",
                "    text=True,",
                "    check=True,",
                ")",
            ]
        )
    source_content = "\n".join(source_lines) + "\n"
    # Allowlist starts at lines [3, 12, 21] — uniform delta of +1 to the
    # actual violation lines [4, 13, 22] simulates the #362 incident
    # (one import line shifts every approved call site down by one).
    repo = _setup_repo(
        tmp_path,
        {"scripts/multi.py": source_content},
        [
            {
                "file": "scripts/multi.py",
                "line": 3,
                "code": "result = subprocess.run(",
                "reason": "reason 1 — first call site",
            },
            {
                "file": "scripts/multi.py",
                "line": 12,
                "code": "result = subprocess.run(",
                "reason": "reason 2 — second call site",
            },
            {
                "file": "scripts/multi.py",
                "line": 21,
                "code": "result = subprocess.run(",
                "reason": "reason 3 — third call site",
            },
        ],
    )
    _patch_guard_paths(guard_mod, monkeypatch, repo, ["scripts/multi.py"])

    updates = guard_mod.auto_fix_subprocess_allowlist_line_shifts(repo)

    assert len(updates) == 3
    written = _read_allowlist(repo)
    # Reasons preserved at original index positions.
    assert written[0]["reason"] == "reason 1 — first call site"
    assert written[1]["reason"] == "reason 2 — second call site"
    assert written[2]["reason"] == "reason 3 — third call site"
    # Every entry shifted by exactly the same delta (the uniform-shift
    # contract — non-uniform deltas would have failed closed instead).
    new_lines: list[int] = []
    for entry in written:
        line_value = entry["line"]
        assert isinstance(line_value, int)
        new_lines.append(line_value)
    deltas = [new - prior for new, prior in zip(new_lines, [3, 12, 21], strict=True)]
    assert deltas[0] == deltas[1] == deltas[2]
    assert deltas[0] != 0


def test_non_uniform_shift_in_same_bucket_fails_closed(
    guard_mod: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two entries in same bucket with different deltas → no allowlist mutation."""
    # Source: two call sites at lines 5 and 100.
    source_content = (
        _make_subprocess_call(3)  # call at ~line 5
        + "\n" * 80
        + _make_subprocess_call(0)  # call at ~line 100
    )
    repo = _setup_repo(
        tmp_path,
        {"scripts/skewed.py": source_content},
        [
            {
                "file": "scripts/skewed.py",
                "line": 4,  # delta +1 to first call
                "code": "result = subprocess.run(",
                "reason": "first",
            },
            {
                "file": "scripts/skewed.py",
                "line": 50,  # delta +50 to second call
                "code": "result = subprocess.run(",
                "reason": "second",
            },
        ],
    )
    _patch_guard_paths(guard_mod, monkeypatch, repo, ["scripts/skewed.py"])
    pre_bytes = (repo / ".subprocess-allowlist.json").read_bytes()

    updates = guard_mod.auto_fix_subprocess_allowlist_line_shifts(repo)

    # No safe update; allowlist file untouched (revert path).
    assert updates == []
    post_bytes = (repo / ".subprocess-allowlist.json").read_bytes()
    assert post_bytes == pre_bytes


def test_new_subprocess_call_rejected(
    guard_mod: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Source has more violations in the bucket than entries → auto-fix bails.

    This guards against the worst-case silent approval: a new
    subprocess call enters the codebase with the same (file, code)
    shape as an existing approved one.  The auto-fix MUST NOT silently
    cover it.
    """
    # Source: TWO call sites with the same code shape.
    source_content = (
        "import subprocess\n"
        + _make_subprocess_call(2)
        + "\n" * 5
        + _make_subprocess_call(0)
    )
    repo = _setup_repo(
        tmp_path,
        {"scripts/twocalls.py": source_content},
        # Allowlist has only ONE entry — the new second call is unallowlisted.
        [
            {
                "file": "scripts/twocalls.py",
                "line": 5,
                "code": "result = subprocess.run(",
                "reason": "old single entry",
            }
        ],
    )
    _patch_guard_paths(guard_mod, monkeypatch, repo, ["scripts/twocalls.py"])
    pre_bytes = (repo / ".subprocess-allowlist.json").read_bytes()

    updates = guard_mod.auto_fix_subprocess_allowlist_line_shifts(repo)

    assert updates == [], (
        "auto-fix must not silently cover a new unallowlisted subprocess call"
    )
    post_bytes = (repo / ".subprocess-allowlist.json").read_bytes()
    assert post_bytes == pre_bytes


def test_code_change_does_not_match_existing_entry(
    guard_mod: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Code shape change → no matching bucket → auto-fix bails.

    The allowlist entry's ``code`` is ``subprocess.run(`` but the source
    was refactored to a slightly different invocation (e.g. inlined with
    different formatting).  The guard's ``check_subprocess_safety``
    detects the new shape but its normalized code differs from the
    entry's.  Auto-fix must not transplant the entry to the new shape;
    the new violation must remain unmatched and fail the gate.
    """
    # Source: subprocess call where the captured code excerpt differs
    # ("subprocess.run(" with no leading "result =" — a different line
    # text, hence different normalized code on the violation).
    source_content = (
        "import subprocess\n\n"
        "argv = build_argv()\n"
        "subprocess.run(\n"
        "    argv,\n"
        "    cwd=str(REPO_ROOT),\n"
        "    capture_output=True,\n"
        "    text=True,\n"
        "    check=True,\n"
        ")\n"
    )
    repo = _setup_repo(
        tmp_path,
        {"scripts/code_changed.py": source_content},
        [
            {
                "file": "scripts/code_changed.py",
                "line": 4,
                "code": "result = subprocess.run(",  # OLD shape
                "reason": "previously approved",
            }
        ],
    )
    _patch_guard_paths(guard_mod, monkeypatch, repo, ["scripts/code_changed.py"])
    pre_bytes = (repo / ".subprocess-allowlist.json").read_bytes()

    updates = guard_mod.auto_fix_subprocess_allowlist_line_shifts(repo)

    assert updates == []
    post_bytes = (repo / ".subprocess-allowlist.json").read_bytes()
    assert post_bytes == pre_bytes


def test_refactored_away_entry_left_alone(
    guard_mod: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Allowlist entry has no matching source violation → entry preserved.

    Conservative behavior: do NOT silently remove entries (that's
    ``--regenerate-allowlist``'s job, gated on explicit human invocation).
    A refactor that eliminates a call site naturally falls through to
    manual review without dropping the historical approval record.
    """
    # Source has zero subprocess calls.
    source_content = "import os\n\nresult = os.path.exists('/tmp')\n"
    repo = _setup_repo(
        tmp_path,
        {"scripts/refactored.py": source_content},
        [
            {
                "file": "scripts/refactored.py",
                "line": 10,
                "code": "result = subprocess.run(",
                "reason": "no longer present",
            }
        ],
    )
    _patch_guard_paths(guard_mod, monkeypatch, repo, ["scripts/refactored.py"])
    pre_bytes = (repo / ".subprocess-allowlist.json").read_bytes()

    updates = guard_mod.auto_fix_subprocess_allowlist_line_shifts(repo)

    # No-op: entry preserved exactly (auto-fix does not remove).
    assert updates == []
    post_bytes = (repo / ".subprocess-allowlist.json").read_bytes()
    assert post_bytes == pre_bytes
    written = _read_allowlist(repo)
    assert len(written) == 1
    assert written[0]["line"] == 10
    assert written[0]["reason"] == "no longer present"
