#!/usr/bin/env python3
"""Per-file partial-branch ratchet for extension/ui/ TypeScript coverage.

Parses ``extension/coverage/lcov.info``, counts partial-branch lines per source
file, and compares against a committed baseline at
``.coverage-partial-branches-baseline.json``.

A line is "partial" iff at least one BRDA record at that line has ``taken == 0``
(a reachable branch that was never taken) *and* at least one other BRDA at the
same line has ``taken > 0`` (a branch that was taken). This matches Codecov's
per-line partial-branch semantics.

Error categories (mirrors the structured exit-code convention from cross-platform
hardening work):

- ``SETUP``                       — baseline or lcov file missing / malformed.
- ``COVERAGE_REGRESSION``         — a file's partial-branch count exceeds its
                                    committed baseline. This is the new-violations
                                    guard.
- ``BASELINE_COCHANGE_REQUIRED``  — observed count dropped below baseline or a
                                    baseline file is missing from current lcov.
                                    The PR must update the baseline in the same
                                    commit. The script prints the exact JSON
                                    patch to apply.

Any file not in the baseline defaults to an allowed count of zero, so new files
cannot silently grow the partial-branch count.

Usage (invoked by name via ``pnpm --dir extension run test:partial-branches``):

    python scripts/check_partial_branches.py \\
        --lcov extension/coverage/lcov.info \\
        --baseline .coverage-partial-branches-baseline.json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import TypedDict

SCHEMA_VERSION = 1

CATEGORY_SETUP = "SETUP"
CATEGORY_REGRESSION = "COVERAGE_REGRESSION"
CATEGORY_COCHANGE = "BASELINE_COCHANGE_REQUIRED"


class BaselineFile(TypedDict):
    schema_version: int
    generated_from: str
    files: dict[str, int]


def _normalize_source_file(raw: str) -> str:
    """Normalize an lcov ``SF:`` path to an ``extension/``-rooted forward-slash key.

    Handles the three shapes the project's coverage tooling produces across
    operating systems:

    - Relative from ``cwd=extension/`` — ``ui/modules/a.ts`` on Unix or
      ``ui\\modules\\a.ts`` on Windows.
    - Already canonical — ``extension/ui/modules/a.ts``.
    - Absolute — ``/home/runner/work/repo/extension/ui/modules/a.ts`` on
      Linux/macOS or ``C:\\projects\\...\\extension\\ui\\modules\\a.ts`` on
      Windows.

    The normalization anchors on the **first** occurrence of the substring
    ``extension/ui/`` in the path. This is the canonical root of every file
    the gate tracks, so the anchor is a reliable boundary between "outside
    the repo" and "inside extension/ui/" no matter how the coverage tool
    spelled the absolute path.

    If no anchor is found (path does not contain ``extension/ui/``), the
    path is assumed to be relative to the repo root and prefixed with
    ``extension/`` as a defensive fallback. This matches the Jest default
    where ``cwd=extension/`` produces SF records like ``ui/modules/a.ts``.
    """
    sf = raw.replace("\\", "/")
    anchor = "extension/ui/"
    anchor_idx = sf.find(anchor)
    if anchor_idx >= 0:
        return sf[anchor_idx:]
    stripped = sf.lstrip("/")
    # Drop a Windows drive-letter prefix like "C:..." that survived lstrip.
    if len(stripped) >= 2 and stripped[1] == ":":
        stripped = stripped[2:].lstrip("/")
    if stripped.startswith("extension/"):
        return stripped
    return "extension/" + stripped


def parse_lcov_partial_branches(path: Path) -> dict[str, int]:
    """Count partial-branch lines per source file in an lcov.info report.

    A line is counted once if it contains at least one BRDA record with
    ``taken == 0`` and at least one BRDA record with ``taken > 0``. BRDA
    records with ``taken == "-"`` (unreached branch point) are ignored.

    Source-file paths are normalized via :func:`_normalize_source_file` so
    baseline keys are stable across Windows, macOS, and Linux and across
    relative or absolute SF records.

    **Fails closed on malformed input.** Any structurally invalid BRDA
    record (wrong field count, non-integer line number, non-integer/non-``-``
    taken value) or an lcov file with zero ``SF:`` records raises
    ``ValueError``. ``main()`` catches this and exits with the ``SETUP``
    error category — the gate never silently returns an empty observation
    set, which would otherwise be reported as ``BASELINE_COCHANGE_REQUIRED``
    and tempt a maintainer to commit an empty baseline that disables the
    ratchet after a coverage tooling break.
    """
    if not path.exists():
        raise FileNotFoundError(f"LCOV file not found: {path}")

    per_file_line_state: dict[str, dict[int, dict[str, int]]] = defaultdict(
        lambda: defaultdict(lambda: {"missed": 0, "taken": 0})
    )
    current_file: str | None = None
    sf_record_count = 0

    with path.open(encoding="utf-8") as fh:
        for lineno, raw in enumerate(fh, start=1):
            line = raw.strip()
            if line.startswith("SF:"):
                current_file = _normalize_source_file(line[3:])
                sf_record_count += 1
                continue
            if line == "end_of_record":
                current_file = None
                continue
            if not line.startswith("BRDA:"):
                continue
            if current_file is None:
                raise ValueError(
                    f"Malformed lcov {path} at line {lineno}: BRDA record "
                    f"outside any SF block: {line!r}"
                )
            parts = line[5:].split(",")
            if len(parts) < 4:
                raise ValueError(
                    f"Malformed lcov {path} at line {lineno}: BRDA record has "
                    f"fewer than 4 comma-separated fields: {line!r}"
                )
            try:
                brda_line = int(parts[0])
            except ValueError as exc:
                raise ValueError(
                    f"Malformed lcov {path} at line {lineno}: BRDA line number "
                    f"is not an integer: {line!r}"
                ) from exc
            taken_raw = parts[3]
            if taken_raw == "-":
                continue
            try:
                taken = int(taken_raw)
            except ValueError as exc:
                raise ValueError(
                    f"Malformed lcov {path} at line {lineno}: BRDA taken value "
                    f"is neither '-' nor an integer: {line!r}"
                ) from exc
            bucket = per_file_line_state[current_file][brda_line]
            if taken == 0:
                bucket["missed"] += 1
            else:
                bucket["taken"] += 1

    if sf_record_count == 0:
        raise ValueError(
            f"Malformed lcov {path}: no SF records found. The coverage tool "
            f"likely failed to produce a report; re-run "
            f"`pnpm --dir extension run test:coverage` before retrying the gate."
        )
    if current_file is not None:
        # An SF: block was opened but never closed by `end_of_record`. The
        # writer was interrupted (tooling crash, signal, disk full, killed
        # test process). Accepting this as a "clean" parse would let
        # ``compare()`` declare every baseline entry after the truncation
        # point absent-from-lcov and suggest a baseline shrink — effectively
        # ratcheting the gate downward after a tooling failure. Fail SETUP.
        raise ValueError(
            f"Malformed lcov {path}: reached end of file with SF block "
            f"{current_file!r} still open (no `end_of_record` terminator). "
            f"The coverage writer was interrupted mid-report; re-run "
            f"`pnpm --dir extension run test:coverage` before retrying the gate."
        )

    counts: dict[str, int] = {}
    for source_file, lines in per_file_line_state.items():
        partial = sum(
            1 for state in lines.values() if state["missed"] > 0 and state["taken"] > 0
        )
        if partial > 0:
            counts[source_file] = partial
    return counts


def load_baseline(path: Path) -> BaselineFile:
    """Load and schema-validate the partial-branch baseline file."""
    if not path.exists():
        raise FileNotFoundError(f"Baseline file not found: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Baseline file {path} is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"Baseline file {path} must contain a JSON object")
    schema_version = data.get("schema_version")
    if schema_version != SCHEMA_VERSION:
        raise ValueError(
            f"Baseline schema version mismatch: expected {SCHEMA_VERSION}, "
            f"got {schema_version!r}"
        )
    generated_from = data.get("generated_from")
    if not isinstance(generated_from, str):
        raise ValueError("Baseline field 'generated_from' must be a string")
    files = data.get("files")
    if not isinstance(files, dict):
        raise ValueError("Baseline field 'files' must be a JSON object")
    validated_files: dict[str, int] = {}
    for key, value in files.items():
        if not isinstance(key, str):
            raise ValueError(f"Baseline file key must be a string: {key!r}")
        if not isinstance(value, int) or value < 0:
            raise ValueError(
                f"Baseline file count for {key!r} must be a non-negative int, "
                f"got {value!r}"
            )
        validated_files[key] = value
    return BaselineFile(
        schema_version=SCHEMA_VERSION,
        generated_from=generated_from,
        files=validated_files,
    )


def format_baseline_json(baseline: BaselineFile) -> str:
    """Render a baseline to deterministic JSON with trailing newline."""
    payload = {
        "schema_version": baseline["schema_version"],
        "generated_from": baseline["generated_from"],
        "files": {k: baseline["files"][k] for k in sorted(baseline["files"])},
    }
    return json.dumps(payload, indent=2) + "\n"


def compare(
    observed: dict[str, int], baseline: BaselineFile
) -> tuple[list[str], list[str], list[str]]:
    """Compare observed counts against a baseline.

    Returns (regressions, cochange_improvements, cochange_removed_files) as lists
    of human-readable messages. A non-empty list in any position indicates the
    gate must fail.
    """
    regressions: list[str] = []
    improvements: list[str] = []
    removed: list[str] = []

    baseline_files = baseline["files"]
    for source_file in sorted(set(observed) | set(baseline_files)):
        baseline_count = baseline_files.get(source_file, 0)
        observed_count = observed.get(source_file, 0)
        if observed_count > baseline_count:
            regressions.append(
                f"  {source_file}: baseline={baseline_count} "
                f"observed={observed_count} (+{observed_count - baseline_count})"
            )
            continue
        if source_file not in observed and source_file in baseline_files:
            removed.append(
                f"  {source_file}: baseline={baseline_count} (file absent from "
                f"current lcov)"
            )
            continue
        if observed_count < baseline_count:
            improvements.append(
                f"  {source_file}: baseline={baseline_count} "
                f"observed={observed_count} ({observed_count - baseline_count})"
            )

    return regressions, improvements, removed


def build_suggested_baseline(
    observed: dict[str, int], baseline: BaselineFile
) -> BaselineFile:
    """Produce a baseline that matches observed counts, preserving metadata.

    Files absent from ``observed`` (count zero) are dropped entirely so the
    suggested baseline stays minimal.
    """
    return BaselineFile(
        schema_version=baseline["schema_version"],
        generated_from=baseline["generated_from"],
        files={k: v for k, v in sorted(observed.items()) if v > 0},
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Enforce a per-file partial-branch ratchet for the extension/ui/ "
            "TypeScript tree."
        ),
    )
    parser.add_argument(
        "--lcov",
        type=Path,
        default=Path("extension/coverage/lcov.info"),
        help="Path to the lcov.info coverage report (default: "
        "extension/coverage/lcov.info)",
    )
    parser.add_argument(
        "--baseline",
        type=Path,
        default=Path(".coverage-partial-branches-baseline.json"),
        help="Path to the committed baseline JSON file (default: "
        ".coverage-partial-branches-baseline.json)",
    )
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help=(
            "Overwrite the baseline with observed counts. Intended for the "
            "maintainer running after a deliberate coverage improvement. Not "
            "invoked from gate tiers."
        ),
    )
    args = parser.parse_args()

    try:
        observed = parse_lcov_partial_branches(args.lcov)
    except FileNotFoundError as exc:
        print(f"::error category={CATEGORY_SETUP}::{exc}", file=sys.stderr)
        print(
            "  Generate lcov first: cd extension && pnpm run test:coverage",
            file=sys.stderr,
        )
        return 1
    except ValueError as exc:
        print(f"::error category={CATEGORY_SETUP}::{exc}", file=sys.stderr)
        return 1

    if args.update_baseline:
        suggested = build_suggested_baseline(
            observed,
            BaselineFile(
                schema_version=SCHEMA_VERSION,
                generated_from=("manual update via --update-baseline"),
                files={},
            ),
        )
        args.baseline.write_text(format_baseline_json(suggested), encoding="utf-8")
        print(
            f"Wrote baseline with {sum(suggested['files'].values())} partial-branch "
            f"lines across {len(suggested['files'])} files to {args.baseline}",
            file=sys.stderr,
        )
        return 0

    try:
        baseline = load_baseline(args.baseline)
    except FileNotFoundError as exc:
        print(f"::error category={CATEGORY_SETUP}::{exc}", file=sys.stderr)
        return 1
    except ValueError as exc:
        print(f"::error category={CATEGORY_SETUP}::{exc}", file=sys.stderr)
        return 1

    regressions, improvements, removed = compare(observed, baseline)

    total_observed = sum(observed.values())
    total_baseline = sum(baseline["files"].values())
    print(
        f"partial-branch ratchet: observed={total_observed} baseline={total_baseline} "
        f"files_tracked={len(baseline['files'])}",
        file=sys.stderr,
    )

    if regressions:
        print(
            f"::error category={CATEGORY_REGRESSION}::"
            "New partial-branch lines detected. The ratchet does not grow.",
            file=sys.stderr,
        )
        for entry in regressions:
            print(entry, file=sys.stderr)
        print(
            "  Fix: eliminate the partial-branch lines (delete unreachable "
            "branches or add a covering test) before merging.",
            file=sys.stderr,
        )

    if improvements or removed:
        suggested = build_suggested_baseline(observed, baseline)
        print(
            f"::error category={CATEGORY_COCHANGE}::"
            "Baseline co-change required. Commit the updated baseline in the "
            "same PR.",
            file=sys.stderr,
        )
        if improvements:
            print("  Improvements (observed below baseline):", file=sys.stderr)
            for entry in improvements:
                print(entry, file=sys.stderr)
        if removed:
            print(
                "  Files in baseline no longer present in lcov (rename / delete):",
                file=sys.stderr,
            )
            for entry in removed:
                print(entry, file=sys.stderr)
        print(
            f"  Apply this exact baseline (replaces {args.baseline}):",
            file=sys.stderr,
        )
        print(format_baseline_json(suggested), file=sys.stderr)

    if regressions or improvements or removed:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
