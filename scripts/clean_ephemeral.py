#!/usr/bin/env python3
"""Authoritative cleaner for ephemeral directories across the repo.

Step 1 of issue #327: load + validate the registry, report each entry's
invariants (gitignored, contained in repo root, no tracked files), and
fail fast if any invariant is violated. No delete logic yet.

Invariants enforced at validation time:
  INV-A  Every registered path is gitignored (`git check-ignore`).
  INV-B  No registered path contains tracked files (`git ls-files`).
  INV-C  Registry paths are literal: no glob chars, absolute paths, or
         `..` components.
  INV-D  Every resolved path is contained within the repository root.

Operational guards implemented at Step 1:
  G-EXIST  Missing paths are a clean no-op (reported as `exists=False`,
           never an error).
  G-ORDER  Entries are emitted in a stable order (sorted by `id`).
  G-DEDUP  When one registered path is a strict parent of another, the
           parent wins; the descendant is dropped. Determinism is
           independent of registry order.
  G-CWD    Repository root is discovered by walking up from this file
           toward a `.git` directory. `Path.cwd()` is never consulted;
           the script may be invoked from any directory.
"""

from __future__ import annotations

import argparse
import errno
import fnmatch
import json
import os
import shutil
import stat
import subprocess
import sys
import time
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Final, Literal, TextIO, TypedDict, cast

# G-PSUTIL: psutil is required for R7 conjunctive sweep (Step 3). If the
# dev extra is missing, fail hard at import with an actionable message;
# do NOT fall back to silent skip or degraded stdlib-only behaviour.
# The R7 rule depends on `psutil.pid_exists` (cross-OS liveness) and
# `psutil.boot_time` (pid-reuse discriminator), both of which have no
# portable pure-stdlib equivalents.
try:
    import psutil
except ImportError as _psutil_exc:  # pragma: no cover - exercised by missing-dep tests
    raise ImportError(
        "psutil is required for clean_ephemeral.py (R7 pid-lifecycle "
        "sweep added in issue #327 step 3). Install via "
        "`uv sync --extra dev` or `pip install -e .[dev]` and retry. "
        f"Original ImportError: {_psutil_exc}"
    ) from _psutil_exc

# REGISTRY_SCHEMA_VERSION pins the shape of scripts/ephemeral_registry.json.
# Bump when registry field names/types change; unrelated to the JSON
# report emitted by this script.
REGISTRY_SCHEMA_VERSION: Final = 1

# REPORT_SCHEMA_V1 / REPORT_SCHEMA_V2 pin the shape of this script's JSON
# emission. v1 is the Step-1 validate-only format. v2 is emitted ONLY when
# --dry-run or --yes produces action fields (per-entry `action`, `retries`,
# `bytes_freed`, `delete_error`, `note` + top-level `summary`). Validate-only
# runs continue to emit v1 so Step-1 consumers are not broken by schema drift.
# Lock tests in the test suite fail if either shape gains a field without
# bumping the corresponding constant.
REPORT_SCHEMA_V1: Final = 1
REPORT_SCHEMA_V2: Final = 2

MAX_DELETE_RETRIES: Final = 5
DELETE_BACKOFF_SECONDS: Final = (0.1, 0.2, 0.4, 0.8, 1.6)


Mode = Literal["subtree", "subtree-with-live-pid-guard", "file"]
Category = Literal["root", "cli", "demo", "extension"]

_VALID_MODES: frozenset[str] = frozenset(
    ("subtree", "subtree-with-live-pid-guard", "file")
)
_VALID_CATEGORIES: frozenset[str] = frozenset(("root", "cli", "demo", "extension"))
_GLOB_CHARS: frozenset[str] = frozenset("*?[]")


class RegistryEntry(TypedDict, total=False):
    id: str
    path: str
    mode: Mode
    category: Category
    owner: str
    purpose: str
    # Only set when mode == "subtree-with-live-pid-guard"
    pid_child_pattern: str


class Registry(TypedDict):
    schema_version: int
    targets: list[RegistryEntry]


@dataclass(frozen=True)
class EntryReport:
    """Per-entry validation result emitted in human and JSON views."""

    entry: RegistryEntry
    absolute_path: Path
    exists: bool
    gitignored: bool
    tracked_files: tuple[str, ...]
    size_bytes: int


@dataclass(frozen=True)
class PlanReport:
    """Full validation result for a filtered plan."""

    repo_root: Path
    registry_path: Path
    entries: tuple[EntryReport, ...]
    overlap_resolutions: tuple[tuple[str, str], ...]
    errors: tuple[str, ...]


# --- Exit codes -------------------------------------------------------------
# 0: all checks passed
# 1: validation failure (schema, gitignore, tracked files, containment)
# 2: setup failure (not in git repo, registry missing, registry unreadable)
EXIT_OK: Final = 0
EXIT_VALIDATION: Final = 1
EXIT_SETUP: Final = 2


class ValidationError(Exception):
    """Raised when the registry or an entry violates an invariant."""


class SetupError(Exception):
    """Raised when prerequisites (git root, registry file) are missing."""


# ---------------------------------------------------------------------------
# G-CWD: repository root discovery independent of Path.cwd().


def discover_repo_root(start: Path | None = None) -> Path:
    """Walk up from `start` until a `.git` directory or file is found.

    `start` defaults to the directory containing this module, which is
    cwd-independent. A `.git` file (git worktree marker) counts.
    """
    origin = (start if start is not None else Path(__file__).resolve().parent).resolve()
    candidate = origin
    while True:
        if (candidate / ".git").exists():
            return candidate
        if candidate.parent == candidate:
            raise SetupError(
                f"Not inside a git repository (walked up from {origin} "
                "without finding .git). clean_ephemeral.py must run from "
                "within the ado-git-repo-insights repo."
            )
        candidate = candidate.parent


# ---------------------------------------------------------------------------
# INV-C / INV-D: registry schema + path-shape validation.


def _require_string(entry: object, key: str, entry_index: int) -> str:
    if not isinstance(entry, dict):
        raise ValidationError(
            f"Registry entry #{entry_index} is not a JSON object: {entry!r}"
        )
    value = entry.get(key)
    if not isinstance(value, str) or not value:
        raise ValidationError(
            f"Registry entry #{entry_index} field {key!r} must be a non-empty "
            f"string; got {value!r}"
        )
    return value


def _require_literal(
    value: str, allowed: frozenset[str], *, field: str, eid: str
) -> str:
    if value not in allowed:
        raise ValidationError(
            f"Registry entry {eid!r} field {field!r}={value!r} not in {sorted(allowed)}"
        )
    return value


def _validate_path_shape(raw: str, *, eid: str) -> str:
    """Reject globs, absolute paths, and parent traversal (INV-C)."""
    if not raw:
        raise ValidationError(f"Registry entry {eid!r} has empty path")
    if any(ch in _GLOB_CHARS for ch in raw):
        raise ValidationError(
            f"Registry entry {eid!r} path {raw!r} contains glob "
            f"characters; paths must be literal."
        )
    posix = raw.replace("\\", "/")
    if posix != raw:
        raise ValidationError(
            f"Registry entry {eid!r} path {raw!r} must use POSIX-form "
            "(forward slashes only)."
        )
    if posix.startswith("/") or (len(posix) >= 2 and posix[1] == ":"):
        raise ValidationError(
            f"Registry entry {eid!r} path {raw!r} must be relative; "
            "absolute paths are rejected."
        )
    parts = posix.split("/")
    if any(part == ".." for part in parts):
        raise ValidationError(
            f"Registry entry {eid!r} path {raw!r} contains a '..' "
            "component; parent traversal is rejected."
        )
    if any(part == "" for part in parts[:-1]):
        raise ValidationError(
            f"Registry entry {eid!r} path {raw!r} contains an empty "
            "segment (double slash)."
        )
    return posix


def _resolve_within_repo(repo_root: Path, rel_path: str, *, eid: str) -> Path:
    """INV-D: resolve and assert containment inside `repo_root`."""
    absolute = (repo_root / rel_path).resolve()
    try:
        absolute.relative_to(repo_root.resolve())
    except ValueError as exc:
        raise ValidationError(
            f"Registry entry {eid!r} resolves to {absolute}, which is "
            f"outside the repository root {repo_root}."
        ) from exc
    return absolute


def _validate_entry(raw: object, entry_index: int) -> RegistryEntry:
    if not isinstance(raw, dict):
        raise ValidationError(
            f"Registry entry #{entry_index} is not a JSON object: {raw!r}"
        )
    eid = _require_string(raw, "id", entry_index)
    path = _require_string(raw, "path", entry_index)
    mode = _require_string(raw, "mode", entry_index)
    category = _require_string(raw, "category", entry_index)
    owner = _require_string(raw, "owner", entry_index)
    purpose = _require_string(raw, "purpose", entry_index)
    _require_literal(mode, _VALID_MODES, field="mode", eid=eid)
    _require_literal(category, _VALID_CATEGORIES, field="category", eid=eid)
    _validate_path_shape(path, eid=eid)
    entry: RegistryEntry = {
        "id": eid,
        "path": path,
        "mode": cast(Mode, mode),
        "category": cast(Category, category),
        "owner": owner,
        "purpose": purpose,
    }
    pattern_raw = raw.get("pid_child_pattern")
    if mode == "subtree-with-live-pid-guard":
        if not isinstance(pattern_raw, str) or not pattern_raw:
            raise ValidationError(
                f"Registry entry {eid!r} uses mode "
                "'subtree-with-live-pid-guard' but is missing "
                "'pid_child_pattern' (string)."
            )
        entry["pid_child_pattern"] = pattern_raw
    else:
        if pattern_raw is not None:
            raise ValidationError(
                f"Registry entry {eid!r} sets 'pid_child_pattern' but "
                f"mode is {mode!r}; the field is only valid for "
                "'subtree-with-live-pid-guard'."
            )
    allowed_keys = {
        "id",
        "path",
        "mode",
        "category",
        "owner",
        "purpose",
        "pid_child_pattern",
    }
    unexpected = set(raw.keys()) - allowed_keys
    if unexpected:
        raise ValidationError(
            f"Registry entry {eid!r} has unexpected keys: {sorted(unexpected)}"
        )
    return entry


def load_registry(registry_path: Path) -> Registry:
    """Load and validate the registry file.

    Returns a strictly-typed Registry when all entries pass INV-C.
    Raises SetupError if the file is missing or unreadable; ValidationError
    if any entry violates INV-C.
    """
    if not registry_path.exists():
        raise SetupError(f"Registry file not found: {registry_path}")
    try:
        content = registry_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise SetupError(f"Registry file unreadable: {registry_path}: {exc}") from exc
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValidationError(f"Registry is not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ValidationError("Registry top-level must be a JSON object")
    version_raw = parsed.get("schema_version")
    if version_raw != REGISTRY_SCHEMA_VERSION:
        raise ValidationError(
            f"Registry schema_version {version_raw!r} != expected "
            f"{REGISTRY_SCHEMA_VERSION}."
        )
    targets_raw = parsed.get("targets")
    if not isinstance(targets_raw, list) or not targets_raw:
        raise ValidationError("Registry 'targets' must be a non-empty list")
    seen_ids: set[str] = set()
    seen_paths: set[str] = set()
    entries: list[RegistryEntry] = []
    previous_id: str | None = None
    for idx, raw in enumerate(targets_raw):
        entry = _validate_entry(raw, idx)
        if entry["id"] in seen_ids:
            raise ValidationError(f"Duplicate registry id: {entry['id']!r}")
        if entry["path"] in seen_paths:
            raise ValidationError(f"Duplicate registry path: {entry['path']!r}")
        # Load-time sort assertion: registry MUST be authored in ascending id
        # order so that a hand-edit cannot silently produce nondeterministic
        # plan output. Duplicates were caught above, so strict '<' is safe.
        if previous_id is not None and entry["id"] < previous_id:
            raise ValidationError(
                f"Registry entries must be sorted by id ascending. "
                f"Entry #{idx} id={entry['id']!r} follows {previous_id!r}; "
                f"reorder the JSON file."
            )
        seen_ids.add(entry["id"])
        seen_paths.add(entry["path"])
        entries.append(entry)
        previous_id = entry["id"]
    return {"schema_version": REGISTRY_SCHEMA_VERSION, "targets": entries}


# ---------------------------------------------------------------------------
# INV-A / INV-B: git queries.


def _run_git(repo_root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )


def check_gitignored(repo_root: Path, entry: RegistryEntry) -> bool:
    """INV-A: `git check-ignore` returns exit 0 when the path is ignored.

    `.gitignore` patterns that end in `/` only match directories; git
    walks the filesystem to decide. When the directory does not exist
    (G-EXIST), `git check-ignore foo` returns "not ignored" for the
    bare name even though `foo/` is in .gitignore. To stay correct for
    non-existent directory targets, try both the bare form and the
    trailing-slash form for subtree modes; `file` mode only tries bare.
    """
    candidates: list[str] = [entry["path"]]
    if entry["mode"] != "file":
        candidates.append(entry["path"] + "/")
    for candidate in candidates:
        result = _run_git(repo_root, "check-ignore", "-q", "--", candidate)
        if result.returncode == 0:
            return True
        if result.returncode not in (0, 1):
            raise ValidationError(
                f"git check-ignore failed for {entry['id']!r} "
                f"(exit {result.returncode}): "
                f"{result.stderr.strip() or result.stdout.strip()}"
            )
    return False


def tracked_files_under(repo_root: Path, entry: RegistryEntry) -> tuple[str, ...]:
    """INV-B: `git ls-files -- <path>` lists tracked files under the path."""
    result = _run_git(repo_root, "ls-files", "--", entry["path"])
    if result.returncode != 0:
        raise ValidationError(
            f"git ls-files failed for {entry['id']!r} "
            f"(exit {result.returncode}): {result.stderr.strip()}"
        )
    lines = [line for line in result.stdout.splitlines() if line]
    return tuple(lines)


# ---------------------------------------------------------------------------
# G-EXIST / path size.


def _directory_size_bytes(path: Path) -> int:
    total = 0
    if path.is_symlink():
        # Symlinks are never followed for sizing — we delete the link,
        # never the target. Return 0 so a link doesn't look like it's
        # freeing the linked target's bytes.
        return 0
    if path.is_file():
        try:
            return path.stat().st_size
        except OSError:
            return 0
    if not path.is_dir():
        return 0
    for sub in path.rglob("*"):
        if sub.is_symlink():
            continue
        try:
            if sub.is_file():
                total += sub.stat().st_size
        except OSError:
            # Unreadable descendants are reported through the delete
            # path's per-entry error accounting (G-PARTIAL); sizing
            # continues so the summary remains useful.
            continue
    return total


# ---------------------------------------------------------------------------
# Delete primitives: rmtree_resilient + execute_plan.
#
# G-RETRY: Windows file locks and transient permission failures are
# retried up to MAX_DELETE_RETRIES with bounded exponential backoff.
# Per-path retry counts surface in the JSON report.
#
# G-PARTIAL: execute_plan accumulates DeleteResult per entry and never
# early-exits on failure. The caller inspects DeletionReport and chooses
# a single exit code from the aggregate.


class Action(StrEnum):
    """Outcome for a single plan entry under dry-run or --yes.

    StrEnum so the JSON emission is stable and human-readable without
    a separate serialiser branch.
    """

    WOULD_DELETE = "would_delete"
    DELETED = "deleted"
    NOOP_MISSING = "noop_missing"
    DEFERRED = "deferred"
    ERROR = "error"


@dataclass(frozen=True)
class DeleteResult:
    """Per-entry outcome. `retries` is 0 when the first attempt succeeded."""

    path: Path
    action: Action
    retries: int
    bytes_freed: int
    error: str | None
    note: str | None


@dataclass(frozen=True)
class DeletionReport:
    """Aggregate across all plan entries after execute_plan."""

    results: tuple[DeleteResult, ...]

    @property
    def deleted_count(self) -> int:
        return sum(1 for r in self.results if r.action is Action.DELETED)

    @property
    def would_delete_count(self) -> int:
        return sum(1 for r in self.results if r.action is Action.WOULD_DELETE)

    @property
    def noop_missing_count(self) -> int:
        return sum(1 for r in self.results if r.action is Action.NOOP_MISSING)

    @property
    def deferred_count(self) -> int:
        return sum(1 for r in self.results if r.action is Action.DEFERRED)

    @property
    def error_count(self) -> int:
        return sum(1 for r in self.results if r.action is Action.ERROR)

    @property
    def total_bytes_freed(self) -> int:
        return sum(r.bytes_freed for r in self.results)


def _is_transient_delete_error(exc: BaseException) -> bool:
    """True for OS errors worth retrying (locks, sharing violations)."""
    if not isinstance(exc, OSError):
        return False
    if sys.platform == "win32":
        winerror = getattr(exc, "winerror", None)
        # 5 = Access denied, 32 = Sharing violation, 145 = Dir not empty
        # (can be transient during concurrent descends). Keep the set
        # narrow; false positives cause misleading retry counts.
        if winerror in (5, 32, 145):
            return True
    return exc.errno in (errno.EACCES, errno.EBUSY, errno.EPERM)


def _onexc_chmod_retry(func: object, path: object, exc: BaseException) -> None:
    """shutil.rmtree onexc handler: clear read-only bit and retry once.

    Windows marks git pack files, node-gyp artifacts, and Playwright
    browser binaries read-only; a direct unlink then raises
    PermissionError even though the user owns the file. Clearing
    S_IWRITE via chmod(0o200 | existing) and re-invoking `func(path)`
    is the standard remediation.
    """
    if not isinstance(exc, OSError):
        return
    target = Path(path) if isinstance(path, (str, Path)) else None
    if target is None:
        return
    try:
        target.chmod(stat.S_IWRITE | stat.S_IREAD)
    except OSError:
        # chmod itself failed — outer retry loop will surface the original
        # error. We deliberately do NOT swallow it silently; the rmtree
        # call will re-raise.
        return
    if callable(func):
        try:
            func(path)
        except OSError:
            # Re-raise path: let the outer retry loop handle it.
            return


def _delete_one(path: Path) -> None:
    """Delete a single filesystem item.

    Symlinks are unlinked without following. Files get a one-shot
    chmod-retry for the Windows read-only attribute. Directories go
    through shutil.rmtree with the onexc chmod handler so pack files
    and other read-only leaves are unblocked in-tree. May raise
    OSError; the caller owns the retry-budget policy.
    """
    if path.is_symlink():
        path.unlink()
    elif path.is_file():
        try:
            path.unlink()
        except PermissionError:
            # Windows marks git pack files and similar artifacts
            # read-only; clearing S_IWRITE and retrying once inline
            # handles the common case without widening the retry
            # budget.
            path.chmod(stat.S_IWRITE | stat.S_IREAD)
            path.unlink()
    elif path.is_dir():
        shutil.rmtree(path, onexc=_onexc_chmod_retry)
    else:
        # Device nodes, sockets, etc. — unlink is the safest primitive.
        path.unlink()


def rmtree_resilient(path: Path) -> DeleteResult:
    """Delete `path` (symlink, file, or directory tree) with bounded retry.

    G-EXIST: a missing path returns NOOP_MISSING with zero bytes, not
    an error.

    Symlinks are unlinked (never followed); a symlink to a directory
    does NOT recurse into the target.

    Windows read-only attributes are cleared via the onexc handler.
    Transient lock/sharing errors are retried up to
    MAX_DELETE_RETRIES with DELETE_BACKOFF_SECONDS exponential backoff.
    On exhaustion returns an ERROR result carrying the final exception
    message and the retry count actually used.
    """
    if not path.exists() and not path.is_symlink():
        return DeleteResult(
            path=path,
            action=Action.NOOP_MISSING,
            retries=0,
            bytes_freed=0,
            error=None,
            note=None,
        )
    bytes_before = _directory_size_bytes(path)
    last_error: str | None = None
    for attempt in range(MAX_DELETE_RETRIES + 1):
        try:
            _delete_one(path)
        except OSError as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            if attempt < MAX_DELETE_RETRIES and _is_transient_delete_error(exc):
                time.sleep(DELETE_BACKOFF_SECONDS[attempt])
                continue
            return DeleteResult(
                path=path,
                action=Action.ERROR,
                retries=attempt,
                bytes_freed=0,
                error=last_error,
                note=None,
            )
        return DeleteResult(
            path=path,
            action=Action.DELETED,
            retries=attempt,
            bytes_freed=bytes_before,
            error=None,
            note=None,
        )
    # Unreachable: the loop always returns. Kept for type-checker safety.
    return DeleteResult(
        path=path,
        action=Action.ERROR,
        retries=MAX_DELETE_RETRIES,
        bytes_freed=0,
        error=last_error or "exhausted retry budget",
        note=None,
    )


def _parse_pid_from_child_name(child: Path) -> int | None:
    """Parse the trailing integer from a pid-guard child name.

    Names must look like `<prefix>-<integer>` — typically `pid-<N>` —
    and the integer portion must parse. Anything else (symlinks,
    partial writes, files named `pid-xyz`) returns None.
    """
    name = child.name
    # Split on the rightmost '-' so multi-segment prefixes still parse.
    if "-" not in name:
        return None
    _, _, tail = name.rpartition("-")
    if not tail.isdigit():
        return None
    try:
        return int(tail)
    except ValueError:
        return None


def _pid_child_eligible_for_sweep(
    child: Path, *, boot_time: float, self_pid: int
) -> tuple[bool, str]:
    """R7 conjunctive rule: a pid-* child is eligible for sweep iff
    ALL of the following hold:

      1. The pid parses to an integer AND is not the current process.
         Self-preservation protects this session's in-flight scratch.
      2. `psutil.pid_exists(pid)` is False. A live pid means the
         scratch may still be in use by a sibling pytest worker.
      3. The child's mtime predates `psutil.boot_time()`. This
         discriminates between "pid died cleanly last cycle" (safe to
         reclaim) and "pid was reused after a reboot and the scratch
         happens to share a number" (unsafe — scratch is recent).

    Returns `(eligible, reason)` where `reason` is empty when eligible
    and a short human-readable diagnostic when not.
    """
    pid = _parse_pid_from_child_name(child)
    if pid is None:
        return (False, f"name {child.name!r} does not parse to pid-<int>")
    if pid == self_pid:
        return (False, f"pid {pid} is this process (self-preservation)")
    if psutil.pid_exists(pid):
        return (False, f"pid {pid} is alive on the system")
    try:
        mtime = child.stat().st_mtime
    except OSError as exc:
        return (False, f"stat failed: {type(exc).__name__}: {exc}")
    if mtime >= boot_time:
        return (
            False,
            f"mtime {mtime:.1f} >= boot_time {boot_time:.1f} (pid-reuse guard)",
        )
    return (True, "")


def sweep_stale_pid_children(root: Path, *, pid_child_pattern: str) -> list[Path]:
    """R7-sweep pid-* children under `root`. Public API for session-scope
    fixtures that need crash-resilient cleanup without invoking the full
    cleaner CLI.

    Only immediate children whose names match `pid_child_pattern` are
    considered. Each is passed through `_pid_child_eligible_for_sweep`;
    eligible children are removed via `rmtree_resilient`. Ineligible
    children are left untouched. No exception propagates — this function
    is called from fixtures that cannot afford to fail the session.

    Returns the list of child paths that were successfully removed.
    """
    if not root.exists() or not root.is_dir():
        return []
    try:
        children = list(root.iterdir())
    except OSError:
        return []
    self_pid = os.getpid()
    boot_time = psutil.boot_time()
    swept: list[Path] = []
    for child in children:
        if not fnmatch.fnmatch(child.name, pid_child_pattern):
            continue
        eligible, _reason = _pid_child_eligible_for_sweep(
            child, boot_time=boot_time, self_pid=self_pid
        )
        if not eligible:
            continue
        result = rmtree_resilient(child)
        if result.action is Action.DELETED:
            swept.append(child)
    return swept


def _sweep_pid_guarded_subtree(report: EntryReport, *, dry_run: bool) -> DeleteResult:
    """Partial-sweep handler for `subtree-with-live-pid-guard` mode.

    Children are partitioned by the entry's pid_child_pattern:
      * Non-matching children (e.g. `rule-disable-invariants/`,
        `allowlist-orphan/`) are swept normally via rmtree_resilient.
      * Matching children (`pid-*`) go through the R7 conjunctive rule
        in `_pid_child_eligible_for_sweep`. Eligible children are
        swept together with the non-matching set; ineligible children
        are left untouched and surface in the `note` field.

    The parent directory itself is NOT unlinked when ANY pid-* children
    remain (eligible or not, eligible get removed so can't "remain"; we
    mean: when ineligible pid-* children stay behind). Empty roots are
    handled by the separate empty-dir branch above.
    """
    entry = report.entry
    pattern = entry.get("pid_child_pattern")
    if not isinstance(pattern, str) or not pattern:
        # Registry validator catches this; defensive fallback keeps
        # the delete loop from raising on a malformed entry.
        return DeleteResult(
            path=report.absolute_path,
            action=Action.ERROR,
            retries=0,
            bytes_freed=0,
            error="pid_child_pattern missing on subtree-with-live-pid-guard entry",
            note=None,
        )
    if not report.exists:
        return DeleteResult(
            path=report.absolute_path,
            action=Action.NOOP_MISSING,
            retries=0,
            bytes_freed=0,
            error=None,
            note=None,
        )
    try:
        children = sorted(report.absolute_path.iterdir(), key=lambda c: c.name)
    except OSError as exc:
        return DeleteResult(
            path=report.absolute_path,
            action=Action.ERROR,
            retries=0,
            bytes_freed=0,
            error=f"{type(exc).__name__}: {exc}",
            note=None,
        )

    # Empty existing root: no pid-* children to protect and no
    # sweepable children to process. Treat as a normal empty subtree
    # — rmdir under --yes, preview under dry-run. Reporting this as
    # NOOP_MISSING would lie about filesystem state (the directory
    # exists, it is just empty).
    if not children:
        if dry_run:
            return DeleteResult(
                path=report.absolute_path,
                action=Action.WOULD_DELETE,
                retries=0,
                bytes_freed=0,
                error=None,
                note=None,
            )
        try:
            report.absolute_path.rmdir()
        except OSError as exc:
            return DeleteResult(
                path=report.absolute_path,
                action=Action.ERROR,
                retries=0,
                bytes_freed=0,
                error=f"{type(exc).__name__}: {exc}",
                note=None,
            )
        return DeleteResult(
            path=report.absolute_path,
            action=Action.DELETED,
            retries=0,
            bytes_freed=0,
            error=None,
            note=None,
        )

    pid_children: list[Path] = []
    non_pid_children: list[Path] = []
    for child in children:
        if fnmatch.fnmatch(child.name, pattern):
            pid_children.append(child)
        else:
            non_pid_children.append(child)

    # R7 partition: eligible pid-* children join the sweep set;
    # ineligible stay behind and drive the deferred_note.
    self_pid = os.getpid()
    boot_time = psutil.boot_time()
    r7_eligible: list[Path] = []
    r7_ineligible: list[tuple[Path, str]] = []
    for pid_child in pid_children:
        eligible, reason = _pid_child_eligible_for_sweep(
            pid_child, boot_time=boot_time, self_pid=self_pid
        )
        if eligible:
            r7_eligible.append(pid_child)
        else:
            r7_ineligible.append((pid_child, reason))

    deferred_note: str | None = None
    if r7_ineligible:
        shown = "; ".join(
            f"{path.name} ({reason})" for path, reason in r7_ineligible[:3]
        )
        suffix = f" (+{len(r7_ineligible) - 3} more)" if len(r7_ineligible) > 3 else ""
        deferred_note = (
            f"{len(r7_ineligible)} pid-* child(ren) protected by R7: {shown}{suffix}"
        )

    sweep_targets = non_pid_children + r7_eligible

    if dry_run:
        if not sweep_targets:
            return DeleteResult(
                path=report.absolute_path,
                action=Action.DEFERRED if r7_ineligible else Action.NOOP_MISSING,
                retries=0,
                bytes_freed=0,
                error=None,
                note=deferred_note,
            )
        preview_bytes = sum(_directory_size_bytes(c) for c in sweep_targets)
        return DeleteResult(
            path=report.absolute_path,
            action=Action.WOULD_DELETE,
            retries=0,
            bytes_freed=preview_bytes,
            error=None,
            note=deferred_note,
        )

    # --yes path: sweep each eligible child, never short-circuit
    # (G-PARTIAL applies inside a single entry too).
    total_bytes = 0
    max_retries = 0
    error_messages: list[str] = []
    deleted_any = False
    for child in sweep_targets:
        child_result = rmtree_resilient(child)
        max_retries = max(max_retries, child_result.retries)
        if child_result.action is Action.DELETED:
            deleted_any = True
            total_bytes += child_result.bytes_freed
        elif child_result.action is Action.ERROR:
            error_messages.append(
                f"{child.name}: {child_result.error or 'unknown error'}"
            )

    if error_messages:
        combined = "; ".join(error_messages)
        return DeleteResult(
            path=report.absolute_path,
            action=Action.ERROR,
            retries=max_retries,
            bytes_freed=total_bytes,
            error=combined,
            note=deferred_note,
        )
    if deleted_any:
        return DeleteResult(
            path=report.absolute_path,
            action=Action.DELETED,
            retries=max_retries,
            bytes_freed=total_bytes,
            error=None,
            note=deferred_note,
        )
    # Nothing swept: either all pid-* children were ineligible (deferred)
    # or — impossible here because the empty-dir branch caught that case —
    # the directory was empty.
    return DeleteResult(
        path=report.absolute_path,
        action=Action.DEFERRED if r7_ineligible else Action.NOOP_MISSING,
        retries=0,
        bytes_freed=0,
        error=None,
        note=deferred_note,
    )


def execute_plan(
    entry_reports: list[EntryReport],
    *,
    dry_run: bool,
) -> DeletionReport:
    """Apply the plan (or simulate it). G-PARTIAL: collect all, never
    early-exit on failure.

    `subtree-with-live-pid-guard` entries are handled by
    `_sweep_pid_guarded_subtree`, which sweeps non-pid children
    normally and defers pid-* children to Step 3 — the registry
    contract is a per-child distinction, not a whole-subtree defer.
    """
    results: list[DeleteResult] = []
    for report in entry_reports:
        if report.entry["mode"] == "subtree-with-live-pid-guard":
            results.append(_sweep_pid_guarded_subtree(report, dry_run=dry_run))
            continue
        if not report.exists:
            results.append(
                DeleteResult(
                    path=report.absolute_path,
                    action=Action.NOOP_MISSING,
                    retries=0,
                    bytes_freed=0,
                    error=None,
                    note=None,
                )
            )
            continue
        if dry_run:
            results.append(
                DeleteResult(
                    path=report.absolute_path,
                    action=Action.WOULD_DELETE,
                    retries=0,
                    bytes_freed=report.size_bytes,
                    error=None,
                    note=None,
                )
            )
            continue
        results.append(rmtree_resilient(report.absolute_path))
    return DeletionReport(results=tuple(results))


# ---------------------------------------------------------------------------
# G-DEDUP: parent-wins resolution, order-independent.


def dedupe_plan(
    entries: list[RegistryEntry],
) -> tuple[list[RegistryEntry], list[tuple[str, str]]]:
    """Drop any entry whose path is a strict descendant of another entry's.

    Returns (survivors, resolutions). `resolutions` records each drop as
    `(dropped_id, parent_id)`, sorted by dropped_id for stable output.
    Result is independent of input order.
    """
    # Normalize by POSIX path; sort ascending (shortest parents first).
    sorted_entries = sorted(entries, key=lambda e: (e["path"], e["id"]))
    survivors: list[RegistryEntry] = []
    resolutions: list[tuple[str, str]] = []
    for candidate in sorted_entries:
        c_parts = candidate["path"].split("/")
        parent_winner: RegistryEntry | None = None
        for kept in survivors:
            k_parts = kept["path"].split("/")
            if len(k_parts) < len(c_parts) and c_parts[: len(k_parts)] == k_parts:
                parent_winner = kept
                break
        if parent_winner is None:
            survivors.append(candidate)
        else:
            resolutions.append((candidate["id"], parent_winner["id"]))
    resolutions.sort(key=lambda r: r[0])
    return survivors, resolutions


# ---------------------------------------------------------------------------
# G-ORDER: stable sort for emission.


def sort_plan(entries: list[RegistryEntry]) -> list[RegistryEntry]:
    return sorted(entries, key=lambda e: e["id"])


# ---------------------------------------------------------------------------
# Planning + validation pipeline.


def _reject_union_filters(
    ids: frozenset[str] | None, categories: frozenset[str] | None
) -> None:
    """Refuse filter combinations that would broaden cleaner scope.

    A cleaner CLI must never widen its selection beyond what the caller
    explicitly named. Passing `--id X --category extension` would
    produce the UNION (X plus every extension entry), which is strictly
    broader than either filter alone. We refuse the combination at
    both the CLI layer (argparse mutual-exclusion) and the programmatic
    API so indirect callers cannot sidestep the safety rule.
    """
    if ids is not None and categories is not None:
        raise ValidationError(
            "--id and --category are mutually exclusive: combining them "
            "would broaden cleaner scope via union semantics. Pass only "
            "one filter dimension at a time."
        )


def filter_registry(
    registry: Registry,
    *,
    ids: frozenset[str] | None = None,
    categories: frozenset[str] | None = None,
) -> list[RegistryEntry]:
    _reject_union_filters(ids, categories)
    targets = registry["targets"]
    if ids is None and categories is None:
        return list(targets)
    if ids is not None:
        return [entry for entry in targets if entry["id"] in ids]
    # categories is not None (both-None and both-set handled above).
    assert categories is not None
    return [entry for entry in targets if entry["category"] in categories]


def build_plan(
    registry: Registry,
    *,
    ids: frozenset[str] | None = None,
    categories: frozenset[str] | None = None,
) -> tuple[list[RegistryEntry], list[tuple[str, str]]]:
    _reject_union_filters(ids, categories)
    selected = filter_registry(registry, ids=ids, categories=categories)
    if ids is not None:
        unknown = ids - {e["id"] for e in registry["targets"]}
        if unknown:
            raise ValidationError(f"Unknown --id value(s): {sorted(unknown)}")
    if categories is not None:
        unknown_cats = categories - _VALID_CATEGORIES
        if unknown_cats:
            raise ValidationError(
                f"Unknown --category value(s): {sorted(unknown_cats)}"
            )
    deduped, resolutions = dedupe_plan(selected)
    ordered = sort_plan(deduped)
    return ordered, resolutions


def _check_mode_filesystem_match(entry: RegistryEntry, abs_path: Path) -> str | None:
    """Return an error string if the on-disk type does not match `mode`.

    G-EXIST: only fires when the path exists. A missing path is a
    clean no-op and does not trip this check.

    `mode=file` requires a regular file; `mode=subtree` and
    `mode=subtree-with-live-pid-guard` require a directory. Symlinks
    are resolved by `is_file()` / `is_dir()` (broken symlinks fail
    both and are reported as mismatch).
    """
    mode = entry["mode"]
    if mode == "file":
        if not abs_path.is_file():
            return (
                f"Mode mismatch: {entry['id']!r} declares mode='file' "
                f"but filesystem entry at {abs_path} is not a regular "
                "file (broken symlink or directory?)."
            )
        return None
    # subtree / subtree-with-live-pid-guard
    if not abs_path.is_dir():
        return (
            f"Mode mismatch: {entry['id']!r} declares mode={mode!r} "
            f"but filesystem entry at {abs_path} is not a directory."
        )
    return None


def validate_plan(
    repo_root: Path, plan: list[RegistryEntry]
) -> tuple[list[EntryReport], list[str]]:
    reports: list[EntryReport] = []
    errors: list[str] = []
    for entry in plan:
        eid = entry["id"]
        try:
            abs_path = _resolve_within_repo(repo_root, entry["path"], eid=eid)
        except ValidationError as exc:
            errors.append(str(exc))
            continue
        exists = abs_path.exists()
        try:
            gitignored = check_gitignored(repo_root, entry)
        except ValidationError as exc:
            errors.append(str(exc))
            gitignored = False
        if not gitignored:
            errors.append(
                f"INV-A: {eid!r} path {entry['path']!r} is NOT gitignored. "
                "Every registered path must be ignored."
            )
        try:
            tracked = tracked_files_under(repo_root, entry)
        except ValidationError as exc:
            errors.append(str(exc))
            tracked = ()
        if tracked:
            preview = tracked[:5]
            more = f" (+{len(tracked) - 5} more)" if len(tracked) > 5 else ""
            errors.append(
                f"INV-B: {eid!r} contains tracked files: {list(preview)}{more}"
            )
        if exists:
            mode_error = _check_mode_filesystem_match(entry, abs_path)
            if mode_error is not None:
                errors.append(mode_error)
        size = _directory_size_bytes(abs_path) if exists else 0
        reports.append(
            EntryReport(
                entry=entry,
                absolute_path=abs_path,
                exists=exists,
                gitignored=gitignored,
                tracked_files=tracked,
                size_bytes=size,
            )
        )
    return reports, errors


# ---------------------------------------------------------------------------
# Emission: human + JSON.


def _entry_to_jsonable(
    report: EntryReport,
    repo_root: Path,
    delete_result: DeleteResult | None,
) -> dict[str, object]:
    try:
        rel = report.absolute_path.resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        rel = report.entry["path"]
    out: dict[str, object] = {
        "id": report.entry["id"],
        "path": rel,
        "mode": report.entry["mode"],
        "category": report.entry["category"],
        "exists": report.exists,
        "gitignored": report.gitignored,
        "tracked_files_found": list(report.tracked_files),
        "size_bytes": report.size_bytes,
    }
    if "pid_child_pattern" in report.entry:
        out["pid_child_pattern"] = report.entry["pid_child_pattern"]
    if delete_result is not None:
        out["action"] = delete_result.action.value
        out["retries"] = delete_result.retries
        out["bytes_freed"] = delete_result.bytes_freed
        out["delete_error"] = delete_result.error
        out["note"] = delete_result.note
    return out


def _summary_block(delete_report: DeletionReport) -> dict[str, object]:
    return {
        "deleted_count": delete_report.deleted_count,
        "would_delete_count": delete_report.would_delete_count,
        "noop_missing_count": delete_report.noop_missing_count,
        "deferred_count": delete_report.deferred_count,
        "error_count": delete_report.error_count,
        "total_bytes_freed": delete_report.total_bytes_freed,
    }


def plan_report_to_json(
    plan: PlanReport, delete_report: DeletionReport | None = None
) -> str:
    delete_by_id: dict[str, DeleteResult] = {}
    if delete_report is not None:
        # Exactly one DeleteResult per plan entry; zip with strict=True
        # so a length mismatch surfaces immediately.
        for entry_report, result in zip(
            plan.entries, delete_report.results, strict=True
        ):
            delete_by_id[entry_report.entry["id"]] = result
    payload: dict[str, object] = {
        "schema_version": (
            REPORT_SCHEMA_V1 if delete_report is None else REPORT_SCHEMA_V2
        ),
        "repo_root": plan.repo_root.resolve().as_posix(),
        "registry_path": plan.registry_path.resolve()
        .relative_to(plan.repo_root.resolve())
        .as_posix(),
        "entries": [
            _entry_to_jsonable(r, plan.repo_root, delete_by_id.get(r.entry["id"]))
            for r in plan.entries
        ],
        "overlap_resolutions": [
            {"dropped": dropped, "parent": parent}
            for dropped, parent in plan.overlap_resolutions
        ],
        "errors": list(plan.errors),
    }
    if delete_report is not None:
        payload["summary"] = _summary_block(delete_report)
    return json.dumps(payload, indent=2, sort_keys=True) + "\n"


def plan_report_to_text(
    plan: PlanReport, delete_report: DeletionReport | None = None
) -> str:
    delete_by_id: dict[str, DeleteResult] = {}
    if delete_report is not None:
        for entry_report, result in zip(
            plan.entries, delete_report.results, strict=True
        ):
            delete_by_id[entry_report.entry["id"]] = result
    lines: list[str] = []
    lines.append(f"Repo root    : {plan.repo_root}")
    lines.append(f"Registry     : {plan.registry_path}")
    lines.append(f"Entries      : {len(plan.entries)}")
    if plan.overlap_resolutions:
        lines.append("Deduped (parent wins):")
        for dropped, parent in plan.overlap_resolutions:
            lines.append(f"  - dropped {dropped!r} (parent {parent!r})")
    lines.append("")
    if delete_report is None:
        header = (
            f"{'id':<32}  {'cat':<10}  {'mode':<32}  "
            f"{'exists':<7}  {'ignored':<7}  {'tracked':<7}  {'bytes':>12}"
        )
    else:
        header = (
            f"{'id':<32}  {'cat':<10}  {'action':<15}  "
            f"{'retries':>7}  {'bytes_freed':>12}"
        )
    lines.append(header)
    lines.append("-" * len(header))
    for report in plan.entries:
        if delete_report is None:
            lines.append(
                f"{report.entry['id']:<32}  "
                f"{report.entry['category']:<10}  "
                f"{report.entry['mode']:<32}  "
                f"{('yes' if report.exists else 'no'):<7}  "
                f"{('yes' if report.gitignored else 'NO'):<7}  "
                f"{('NO' if report.tracked_files else 'ok'):<7}  "
                f"{report.size_bytes:>12,}"
            )
        else:
            result = delete_by_id[report.entry["id"]]
            lines.append(
                f"{report.entry['id']:<32}  "
                f"{report.entry['category']:<10}  "
                f"{result.action.value:<15}  "
                f"{result.retries:>7}  "
                f"{result.bytes_freed:>12,}"
            )
    if plan.errors:
        lines.append("")
        lines.append("ERRORS:")
        for err in plan.errors:
            lines.append(f"  - {err}")
    if delete_report is not None:
        lines.append("")
        summary = _summary_block(delete_report)
        lines.append(
            "Summary: "
            f"deleted={summary['deleted_count']}, "
            f"would_delete={summary['would_delete_count']}, "
            f"noop_missing={summary['noop_missing_count']}, "
            f"deferred={summary['deferred_count']}, "
            f"errors={summary['error_count']}, "
            f"bytes_freed={summary['total_bytes_freed']:,}"
        )
        # Surface per-entry delete errors beneath the table for human
        # readers. JSON carries them in the entry's `delete_error` key.
        for result in delete_report.results:
            if result.action is Action.ERROR and result.error is not None:
                lines.append(f"  ERROR {result.path}: {result.error}")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# CLI.


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Validate and (optionally) clean ephemeral directories "
            "registered in scripts/ephemeral_registry.json. Default "
            "run is validate-only; --dry-run previews deletes; --yes "
            "applies them."
        ),
    )
    # --id and --category are mutually exclusive: combining them would
    # widen cleaner scope via union semantics. Within one dimension the
    # flag is repeatable (explicit enumeration is always safe).
    filter_group = parser.add_mutually_exclusive_group()
    filter_group.add_argument(
        "--id",
        action="append",
        default=[],
        help=(
            "Limit the plan to the given registry id(s). Repeatable. "
            "Mutually exclusive with --category."
        ),
    )
    filter_group.add_argument(
        "--category",
        action="append",
        default=[],
        choices=sorted(_VALID_CATEGORIES),
        help=(
            "Limit the plan to the given category(ies). Repeatable. "
            "Mutually exclusive with --id."
        ),
    )
    # --dry-run and --yes are mutually exclusive: one previews, the
    # other applies. Without either, the script runs validate-only.
    action_group = parser.add_mutually_exclusive_group()
    action_group.add_argument(
        "--dry-run",
        action="store_true",
        help=(
            "Preview deletes without touching the filesystem. Exits 2 "
            "if any entry would be deleted; 0 if the effective plan "
            "is empty."
        ),
    )
    action_group.add_argument(
        "--yes",
        action="store_true",
        help=(
            "Apply deletes. Idempotent: a second run after success "
            "exits 0 with zero deleted and zero bytes freed."
        ),
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit a machine-readable JSON summary.",
    )
    parser.add_argument(
        "--registry",
        type=Path,
        default=None,
        help=(
            "Override the registry file (diagnostic/test use). Defaults "
            "to scripts/ephemeral_registry.json under the detected "
            "repository root."
        ),
    )
    return parser.parse_args(argv)


def _default_registry_path(repo_root: Path) -> Path:
    return repo_root / "scripts" / "ephemeral_registry.json"


def run_with_resolved_inputs(
    repo_root: Path,
    registry_path: Path,
    args: argparse.Namespace,
    *,
    stdout: TextIO | None = None,
    stderr: TextIO | None = None,
) -> int:
    """Testable core: callers supply resolved repo_root + registry_path.

    `stdout` / `stderr` default to `sys.stdout` / `sys.stderr`. Tests
    inject `io.StringIO()` to capture emission without a subprocess.
    """
    out: TextIO = stdout if stdout is not None else sys.stdout
    err: TextIO = stderr if stderr is not None else sys.stderr

    def _emit_err(prefix: str, message: str) -> None:
        print(f"[{prefix}] {message}", file=err)

    try:
        registry = load_registry(registry_path)
    except SetupError as exc:
        _emit_err("SETUP", str(exc))
        return EXIT_SETUP
    except ValidationError as exc:
        _emit_err("VALIDATION", str(exc))
        return EXIT_VALIDATION

    ids = frozenset(args.id) if args.id else None
    categories = frozenset(args.category) if args.category else None
    try:
        plan, resolutions = build_plan(registry, ids=ids, categories=categories)
    except ValidationError as exc:
        _emit_err("VALIDATION", str(exc))
        return EXIT_VALIDATION

    entry_reports, validation_errors = validate_plan(repo_root, plan)
    plan_report = PlanReport(
        repo_root=repo_root,
        registry_path=registry_path,
        entries=tuple(entry_reports),
        overlap_resolutions=tuple(resolutions),
        errors=tuple(validation_errors),
    )

    delete_report: DeletionReport | None = None
    action_requested = bool(args.dry_run or args.yes)
    # Only run delete/simulate when registry is clean. A broken registry
    # must never produce a plan that then acts; surface validation
    # errors and exit so humans can fix the contract first.
    if action_requested and not validation_errors:
        delete_report = execute_plan(entry_reports, dry_run=bool(args.dry_run))

    text: str
    if args.json:
        text = plan_report_to_json(plan_report, delete_report)
    else:
        text = plan_report_to_text(plan_report, delete_report)
    out.write(text)

    # Exit-code semantics (G-EXIST + idempotency preserved):
    # - validation errors: always EXIT_VALIDATION
    # - validate-only (no action): EXIT_OK
    # - --dry-run: EXIT_OK when nothing would delete; EXIT_SETUP (2)
    #   when at least one entry would be deleted
    # - --yes: EXIT_OK on full success including idempotent no-op;
    #   EXIT_VALIDATION if any entry failed to delete
    if validation_errors:
        return EXIT_VALIDATION
    if delete_report is None:
        return EXIT_OK
    if args.dry_run:
        return EXIT_SETUP if delete_report.would_delete_count > 0 else EXIT_OK
    # args.yes
    return EXIT_VALIDATION if delete_report.error_count > 0 else EXIT_OK


def run(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        repo_root = discover_repo_root()
    except SetupError as exc:
        print(f"[SETUP] {exc}", file=sys.stderr)
        return EXIT_SETUP
    registry_path: Path = args.registry or _default_registry_path(repo_root)
    return run_with_resolved_inputs(repo_root, registry_path, args)


def main() -> int:
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
