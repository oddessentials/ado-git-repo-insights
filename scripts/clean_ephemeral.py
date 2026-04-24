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
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Literal, TypedDict, cast

SCHEMA_VERSION: Final = 1


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
    if version_raw != SCHEMA_VERSION:
        raise ValidationError(
            f"Registry schema_version {version_raw!r} != expected {SCHEMA_VERSION}."
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
    return {"schema_version": SCHEMA_VERSION, "targets": entries}


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
            # Surfaced to caller elsewhere; Step 2 introduces full error
            # accounting for delete-path I/O.
            continue
    return total


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


def filter_registry(
    registry: Registry,
    *,
    ids: frozenset[str] | None = None,
    categories: frozenset[str] | None = None,
) -> list[RegistryEntry]:
    targets = registry["targets"]
    if ids is None and categories is None:
        return list(targets)
    selected: list[RegistryEntry] = []
    for entry in targets:
        if ids is not None and entry["id"] in ids:
            selected.append(entry)
            continue
        if categories is not None and entry["category"] in categories:
            selected.append(entry)
    return selected


def build_plan(
    registry: Registry,
    *,
    ids: frozenset[str] | None = None,
    categories: frozenset[str] | None = None,
) -> tuple[list[RegistryEntry], list[tuple[str, str]]]:
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


def _entry_to_jsonable(report: EntryReport, repo_root: Path) -> dict[str, object]:
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
    return out


def plan_report_to_json(plan: PlanReport) -> str:
    payload: dict[str, object] = {
        "schema_version": SCHEMA_VERSION,
        "repo_root": plan.repo_root.resolve().as_posix(),
        "registry_path": plan.registry_path.resolve()
        .relative_to(plan.repo_root.resolve())
        .as_posix(),
        "entries": [_entry_to_jsonable(r, plan.repo_root) for r in plan.entries],
        "overlap_resolutions": [
            {"dropped": dropped, "parent": parent}
            for dropped, parent in plan.overlap_resolutions
        ],
        "errors": list(plan.errors),
    }
    return json.dumps(payload, indent=2, sort_keys=True) + "\n"


def plan_report_to_text(plan: PlanReport) -> str:
    lines: list[str] = []
    lines.append(f"Repo root    : {plan.repo_root}")
    lines.append(f"Registry     : {plan.registry_path}")
    lines.append(f"Entries      : {len(plan.entries)}")
    if plan.overlap_resolutions:
        lines.append("Deduped (parent wins):")
        for dropped, parent in plan.overlap_resolutions:
            lines.append(f"  - dropped {dropped!r} (parent {parent!r})")
    lines.append("")
    header = f"{'id':<32}  {'cat':<10}  {'mode':<32}  {'exists':<7}  {'ignored':<7}  {'tracked':<7}  {'bytes':>12}"
    lines.append(header)
    lines.append("-" * len(header))
    for report in plan.entries:
        lines.append(
            f"{report.entry['id']:<32}  "
            f"{report.entry['category']:<10}  "
            f"{report.entry['mode']:<32}  "
            f"{('yes' if report.exists else 'no'):<7}  "
            f"{('yes' if report.gitignored else 'NO'):<7}  "
            f"{('NO' if report.tracked_files else 'ok'):<7}  "
            f"{report.size_bytes:>12,}"
        )
    if plan.errors:
        lines.append("")
        lines.append("ERRORS:")
        for err in plan.errors:
            lines.append(f"  - {err}")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# CLI.


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Validate the ephemeral-cleanup registry and report each "
            "entry's invariants. Delete logic is introduced in later "
            "steps of issue #327."
        ),
    )
    parser.add_argument(
        "--id",
        action="append",
        default=[],
        help="Limit the plan to the given registry id(s). Repeatable.",
    )
    parser.add_argument(
        "--category",
        action="append",
        default=[],
        choices=sorted(_VALID_CATEGORIES),
        help="Limit the plan to the given category(ies). Repeatable.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit a machine-readable JSON summary.",
    )
    return parser.parse_args(argv)


def _default_registry_path(repo_root: Path) -> Path:
    return repo_root / "scripts" / "ephemeral_registry.json"


def run(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        repo_root = discover_repo_root()
    except SetupError as exc:
        print(f"[SETUP] {exc}", file=sys.stderr)
        return EXIT_SETUP
    registry_path = _default_registry_path(repo_root)
    try:
        registry = load_registry(registry_path)
    except SetupError as exc:
        print(f"[SETUP] {exc}", file=sys.stderr)
        return EXIT_SETUP
    except ValidationError as exc:
        print(f"[VALIDATION] {exc}", file=sys.stderr)
        return EXIT_VALIDATION
    ids = frozenset(args.id) if args.id else None
    categories = frozenset(args.category) if args.category else None
    try:
        plan, resolutions = build_plan(registry, ids=ids, categories=categories)
    except ValidationError as exc:
        print(f"[VALIDATION] {exc}", file=sys.stderr)
        return EXIT_VALIDATION
    reports, errors = validate_plan(repo_root, plan)
    plan_report = PlanReport(
        repo_root=repo_root,
        registry_path=registry_path,
        entries=tuple(reports),
        overlap_resolutions=tuple(resolutions),
        errors=tuple(errors),
    )
    if args.json:
        sys.stdout.write(plan_report_to_json(plan_report))
    else:
        sys.stdout.write(plan_report_to_text(plan_report))
    return EXIT_VALIDATION if errors else EXIT_OK


def main() -> int:
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
