#!/usr/bin/env python3
"""
Suppression Audit Script

Counts and tracks suppression comments across the codebase per data-model.md.
Provides deterministic JSON output for CI diff computation.

Usage:
    python scripts/audit-suppressions.py              # Count current suppressions
    python scripts/audit-suppressions.py --diff       # Compare to baseline
    python scripts/audit-suppressions.py --update-baseline  # Generate new baseline
    python scripts/audit-suppressions.py --validate   # Validate baseline format
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TypedDict

# =============================================================================
# Type Definitions (per data-model.md schema)
# =============================================================================


class SuppressionBaseline(TypedDict):
    """Schema for .suppression-baseline.json per data-model.md."""

    version: int
    generated_at: str
    total: int
    by_scope: dict[str, int]
    by_type: dict[str, int]
    by_file: dict[str, int]
    by_rule: dict[str, int]


class Suppression(TypedDict):
    """A single suppression comment."""

    type: str
    line: int
    rules: list[str]
    has_justification: bool


class ScanResult(TypedDict):
    """Result from scanning a single file."""

    file_path: str
    scope: str
    suppressions: list[Suppression]


class FileDiffInfo(TypedDict):
    """Diff info for a single file."""

    was: int
    now: int
    delta: int


class SuppressionDiff(TypedDict):
    """Result of computing diff between baseline and current."""

    baseline_total: int
    current_total: int
    delta: int
    new_files: list[str]
    removed_files: list[str]
    increased_files: dict[str, FileDiffInfo]
    decreased_files: dict[str, FileDiffInfo]


# =============================================================================
# Constants (per data-model.md)
# =============================================================================

# Schema version
SCHEMA_VERSION = 1

# Scan scopes - directories to scan
SCOPES = {
    "python-backend": "src/",
    "typescript-extension": "extension/ui/",
    "typescript-tests": "extension/tests/",
}

# File patterns per scope
FILE_PATTERNS = {
    "python-backend": "*.py",
    "typescript-extension": "*.ts",
    "typescript-tests": "*.ts",
}

# Suppression patterns (type_id -> regex pattern)
SUPPRESSION_PATTERNS = {
    # TypeScript/ESLint
    "eslint-disable-block": re.compile(r"/\*\s*eslint-disable"),
    "eslint-disable-next-line": re.compile(r"//\s*eslint-disable-next-line"),
    "eslint-disable-line": re.compile(r"//\s*eslint-disable-line"),
    "ts-ignore": re.compile(r"//\s*@ts-ignore"),
    "ts-expect-error": re.compile(r"//\s*@ts-expect-error"),
    # Python
    "type-ignore": re.compile(r"#\s*type:\s*ignore"),
    "noqa": re.compile(r"#\s*noqa"),
}

# Type to language mapping
TYPE_LANGUAGES = {
    "eslint-disable-block": "typescript",
    "eslint-disable-next-line": "typescript",
    "eslint-disable-line": "typescript",
    "ts-ignore": "typescript",
    "ts-expect-error": "typescript",
    "type-ignore": "python",
    "noqa": "python",
}

# Justification patterns (for FR-012)
JUSTIFICATION_PATTERN = re.compile(r"--\s*(REASON|SECURITY):\s*.+")

# Rule extraction patterns
ESLINT_RULE_PATTERN = re.compile(
    r"eslint-disable(?:-next)?-line\s+([a-zA-Z0-9@/_-]+(?:,\s*[a-zA-Z0-9@/_-]+)*)"
)
NOQA_RULE_PATTERN = re.compile(r"noqa:\s*([A-Z0-9]+(?:,\s*[A-Z0-9]+)*)")
TYPE_IGNORE_RULE_PATTERN = re.compile(r"type:\s*ignore\[([a-z-]+(?:,\s*[a-z-]+)*)\]")

# Excluded directories
EXCLUDED_DIRS = {
    "node_modules",
    "dist",
    ".venv",
    "venv",
    "build",
    "coverage",
    "__pycache__",
    ".git",
}

# Security limits to prevent ReDoS and resource exhaustion
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_LINE_LENGTH = 10000  # chars


# =============================================================================
# Core Functions
# =============================================================================


def normalize_path(path: Path, repo_root: Path) -> str:
    """
    Normalize path to forward slashes, relative to repo root.

    Per data-model.md determinism requirement:
    - File paths MUST use forward slashes
    - Paths MUST be relative to repo root
    """
    try:
        rel_path = path.relative_to(repo_root)
    except ValueError:
        rel_path = path
    return str(rel_path).replace("\\", "/")


def is_excluded(path: Path) -> bool:
    """Check if path should be excluded from scanning."""
    parts = path.parts
    return any(excluded in parts for excluded in EXCLUDED_DIRS)


def extract_rules(line: str, suppression_type: str) -> list[str]:
    """Extract specific rules being suppressed from a line."""
    rules: list[str] = []

    if suppression_type in ("eslint-disable-next-line", "eslint-disable-line"):
        match = ESLINT_RULE_PATTERN.search(line)
        if match:
            rules = [r.strip() for r in match.group(1).split(",")]
    elif suppression_type == "noqa":
        match = NOQA_RULE_PATTERN.search(line)
        if match:
            rules = [r.strip() for r in match.group(1).split(",")]
    elif suppression_type == "type-ignore":
        match = TYPE_IGNORE_RULE_PATTERN.search(line)
        if match:
            rules = [r.strip() for r in match.group(1).split(",")]

    return rules


def has_justification(line: str) -> bool:
    """Check if a suppression line includes a justification tag per FR-012."""
    return JUSTIFICATION_PATTERN.search(line) is not None


def scan_file(file_path: Path, scope: str, repo_root: Path) -> list[Suppression]:
    """
    Scan a single file for suppression comments.

    Returns list of suppressions with:
    - type: suppression type ID
    - line: line number
    - rules: list of rules being suppressed
    - has_justification: whether justification tag is present
    """
    suppressions: list[Suppression] = []

    # Determine which patterns to check based on scope
    if scope == "python-backend":
        patterns_to_check = ["type-ignore", "noqa"]
    else:
        patterns_to_check = [
            "eslint-disable-block",
            "eslint-disable-next-line",
            "eslint-disable-line",
            "ts-ignore",
            "ts-expect-error",
        ]

    # SECURITY: Check file size before reading to prevent resource exhaustion
    try:
        file_size = file_path.stat().st_size
        if file_size > MAX_FILE_SIZE_BYTES:
            print(
                f"Warning: Skipping {file_path} (size {file_size} exceeds {MAX_FILE_SIZE_BYTES})",
                file=sys.stderr,
            )
            return suppressions
    except OSError as e:
        print(f"Warning: Could not stat {file_path}: {e}", file=sys.stderr)
        return suppressions

    try:
        content = file_path.read_text(encoding="utf-8", errors="replace")
    except (OSError, UnicodeDecodeError) as e:
        print(f"Warning: Could not read {file_path}: {e}", file=sys.stderr)
        return suppressions

    for line_num, line in enumerate(content.splitlines(), start=1):
        # SECURITY: Skip extremely long lines to prevent ReDoS
        if len(line) > MAX_LINE_LENGTH:
            continue

        # SECURITY: Pre-filter by keywords before expensive regex matching
        has_potential_suppression = any(
            kw in line
            for kw in (
                "eslint-disable",
                "@ts-ignore",
                "@ts-expect-error",
                "type:",
                "noqa",
            )
        )
        if not has_potential_suppression:
            continue

        for pattern_name in patterns_to_check:
            pattern = SUPPRESSION_PATTERNS[pattern_name]
            if pattern.search(line):
                rules = extract_rules(line, pattern_name)
                suppressions.append(
                    {
                        "type": pattern_name,
                        "line": line_num,
                        "rules": rules,
                        "has_justification": has_justification(line),
                    }
                )

    return suppressions


def scan_codebase(repo_root: Path) -> dict[str, list[Suppression]]:
    """
    Scan all files in configured scopes.

    Returns dict mapping normalized file paths to their suppressions.
    """
    results: dict[str, list[Suppression]] = {}

    for scope_name, scope_dir in SCOPES.items():
        scope_path = repo_root / scope_dir
        if not scope_path.exists():
            continue

        pattern = FILE_PATTERNS[scope_name]
        for file_path in scope_path.rglob(pattern):
            if is_excluded(file_path):
                continue

            suppressions = scan_file(file_path, scope_name, repo_root)
            if suppressions:
                normalized = normalize_path(file_path, repo_root)
                results[normalized] = suppressions

    return results


def build_baseline(
    scan_results: dict[str, list[Suppression]], repo_root: Path
) -> SuppressionBaseline:
    """
    Build baseline JSON structure from scan results.

    Follows data-model.md schema and determinism requirements:
    - Keys sorted alphabetically
    - Stable sort by scope, rule, kind
    """
    by_scope: dict[str, int] = defaultdict(int)
    by_type: dict[str, int] = defaultdict(int)
    by_file: dict[str, int] = defaultdict(int)
    by_rule: dict[str, int] = defaultdict(int)
    total = 0

    for file_path, suppressions in scan_results.items():
        by_file[file_path] = len(suppressions)
        total += len(suppressions)

        # Determine scope from file path
        if file_path.startswith("src/"):
            scope = "python-backend"
        elif file_path.startswith("extension/tests/"):
            scope = "typescript-tests"
        elif file_path.startswith("extension/ui/"):
            scope = "typescript-extension"
        else:
            scope = "unknown"

        by_scope[scope] += len(suppressions)

        for supp in suppressions:
            by_type[supp["type"]] += 1
            rules: list[str] = supp["rules"]
            for rule in rules:
                by_rule[rule] += 1

    # Ensure all scope keys exist (even if zero)
    for scope_name in SCOPES:
        if scope_name not in by_scope:
            by_scope[scope_name] = 0

    # Ensure all type keys exist (even if zero)
    for type_name in SUPPRESSION_PATTERNS:
        if type_name not in by_type:
            by_type[type_name] = 0

    # Sort all dictionaries alphabetically for determinism
    baseline: SuppressionBaseline = {
        "version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total": total,
        "by_scope": dict(sorted(by_scope.items())),
        "by_type": dict(sorted(by_type.items())),
        "by_file": dict(sorted(by_file.items())),
        "by_rule": dict(sorted(by_rule.items())),
    }

    return baseline


def validate_baseline(baseline: dict[str, Any]) -> list[str]:
    """
    Validate baseline format and ordering per FR-020.

    Returns list of validation errors (empty if valid).
    """
    errors: list[str] = []

    # Check required fields
    required = ["version", "generated_at", "total", "by_scope", "by_type", "by_file"]
    for field in required:
        if field not in baseline:
            errors.append(f"Missing required field: {field}")

    if errors:
        return errors

    # Check version
    if baseline["version"] != SCHEMA_VERSION:
        errors.append(
            f"Invalid version: {baseline['version']} (expected {SCHEMA_VERSION})"
        )

    # Check total consistency
    scope_total = sum(baseline.get("by_scope", {}).values())
    if baseline["total"] != scope_total:
        errors.append(
            f"Total mismatch: total={baseline['total']}, sum(by_scope)={scope_total}"
        )

    file_total = sum(baseline.get("by_file", {}).values())
    if baseline["total"] != file_total:
        errors.append(
            f"Total mismatch: total={baseline['total']}, sum(by_file)={file_total}"
        )

    # Check alphabetical ordering
    for key in ["by_scope", "by_type", "by_file", "by_rule"]:
        if key in baseline and isinstance(baseline[key], dict):
            keys = list(baseline[key].keys())
            if keys != sorted(keys):
                errors.append(f"Keys not sorted alphabetically in {key}")

    # Check path format (forward slashes)
    for path in baseline.get("by_file", {}).keys():
        if "\\" in path:
            errors.append(f"Path uses backslashes: {path}")
        if path.startswith("/"):
            errors.append(f"Path is absolute: {path}")

    return errors


def compute_diff(
    baseline: SuppressionBaseline, current: SuppressionBaseline
) -> SuppressionDiff:
    """
    Compute diff between baseline and current scan.

    Returns diff structure for CI output.
    """
    baseline_total = baseline["total"]
    current_total = current["total"]
    delta = current_total - baseline_total

    # Find changed files
    baseline_files = baseline["by_file"]
    current_files = current["by_file"]

    new_files = [f for f in current_files if f not in baseline_files]
    removed_files = [f for f in baseline_files if f not in current_files]

    increased_files: dict[str, FileDiffInfo] = {}
    decreased_files: dict[str, FileDiffInfo] = {}

    for file_path in set(baseline_files.keys()) & set(current_files.keys()):
        was = baseline_files[file_path]
        now = current_files[file_path]
        if now > was:
            increased_files[file_path] = {"was": was, "now": now, "delta": now - was}
        elif now < was:
            decreased_files[file_path] = {"was": was, "now": now, "delta": now - was}

    return {
        "baseline_total": baseline_total,
        "current_total": current_total,
        "delta": delta,
        "new_files": new_files,
        "removed_files": removed_files,
        "increased_files": increased_files,
        "decreased_files": decreased_files,
    }


def format_failure_message(diff: SuppressionDiff) -> str:
    """
    Format CI failure message per FR-011.

    Includes: previous count, new count, delta, copy-pastable instruction.
    """
    baseline_total = diff["baseline_total"]
    current_total = diff["current_total"]
    delta = diff["delta"]

    lines = [
        f"[FAIL] Suppression count increased: {baseline_total} -> {current_total} (+{delta})",
        "",
        "Changed files:",
    ]

    # Show increased files
    for file_path, info in diff["increased_files"].items():
        lines.append(
            f"  {file_path}: {info['was']} -> {info['now']} (+{info['delta']})"
        )

    # Show new files
    for file_path in diff["new_files"]:
        lines.append(f"  {file_path}: 0 -> new")

    lines.extend(
        [
            "",
            "New suppressions require acknowledgment.",
            "Add 'SUPPRESSION-INCREASE-APPROVED' to PR description to proceed.",
        ]
    )

    return "\n".join(lines)


def check_pr_approval() -> bool:
    """
    Check if PR body contains SUPPRESSION-INCREASE-APPROVED marker.

    Reads from GITHUB_EVENT_PATH for PR body in CI.
    """
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    if not event_path:
        return False

    # SECURITY: Validate path before opening
    event_path_obj = Path(event_path)
    if not event_path_obj.is_file():
        print(
            f"Warning: GITHUB_EVENT_PATH is not a valid file: {event_path}",
            file=sys.stderr,
        )
        return False

    # SECURITY: Check file size to prevent resource exhaustion
    try:
        file_size = event_path_obj.stat().st_size
        if file_size > MAX_FILE_SIZE_BYTES:
            print(f"Warning: Event file too large: {file_size} bytes", file=sys.stderr)
            return False
    except OSError:
        return False

    try:
        with open(event_path, encoding="utf-8") as f:
            event = json.load(f)

        # Check PR body
        pr_body = event.get("pull_request", {}).get("body", "") or ""
        return "SUPPRESSION-INCREASE-APPROVED" in pr_body
    except (OSError, json.JSONDecodeError):
        return False


def is_direct_push_to_main() -> bool:
    """Check if this is a direct push to main (not a PR)."""
    event_name = os.environ.get("GITHUB_EVENT_NAME", "")
    ref = os.environ.get("GITHUB_REF", "")

    return event_name == "push" and ref in ("refs/heads/main", "refs/heads/master")


# =============================================================================
# CLI Commands
# =============================================================================


def cmd_count(repo_root: Path) -> int:
    """Count current suppressions and print summary."""
    scan_results = scan_codebase(repo_root)
    baseline = build_baseline(scan_results, repo_root)

    print(f"Total suppressions: {baseline['total']}")
    print("\nBy scope:")
    for scope, count in baseline["by_scope"].items():
        print(f"  {scope}: {count}")

    print("\nBy type:")
    for type_name, count in baseline["by_type"].items():
        if count > 0:
            print(f"  {type_name}: {count}")

    print("\nBy file:")
    for file_path, count in baseline["by_file"].items():
        print(f"  {file_path}: {count}")

    if baseline.get("by_rule"):
        print("\nBy rule:")
        for rule, count in sorted(baseline["by_rule"].items(), key=lambda x: -x[1])[
            :10
        ]:
            print(f"  {rule}: {count}")

    return 0


def cmd_update_baseline(repo_root: Path, baseline_path: Path) -> int:
    """Generate new baseline file."""
    scan_results = scan_codebase(repo_root)
    baseline = build_baseline(scan_results, repo_root)

    # Write with deterministic formatting
    with open(baseline_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(baseline, f, indent=2, ensure_ascii=False)
        f.write("\n")  # Ensure newline at EOF

    print(f"Baseline updated: {baseline_path}")
    print(f"Total suppressions: {baseline['total']}")
    return 0


def cmd_validate(baseline_path: Path) -> int:
    """Validate baseline format per FR-020."""
    if not baseline_path.exists():
        print(f"Error: Baseline file not found: {baseline_path}", file=sys.stderr)
        return 1

    with open(baseline_path, encoding="utf-8") as f:
        baseline = json.load(f)

    errors = validate_baseline(baseline)

    if errors:
        print("[FAIL] Baseline validation failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    print("[PASS] Baseline validation passed")
    return 0


def find_unjustified_suppressions(
    scan_results: dict[str, list[Suppression]],
) -> list[tuple[str, int, str]]:
    """
    Find suppressions missing justification tags per FR-012.

    Returns list of (file_path, line_number, suppression_type) tuples.
    """
    unjustified: list[tuple[str, int, str]] = []
    for file_path, suppressions in scan_results.items():
        for supp in suppressions:
            if not supp["has_justification"]:
                unjustified.append((file_path, supp["line"], supp["type"]))
    return unjustified


def cmd_diff(repo_root: Path, baseline_path: Path) -> int:
    """Compare current scan to baseline and fail if delta > 0 without approval."""
    if not baseline_path.exists():
        print(f"Error: Baseline file not found: {baseline_path}", file=sys.stderr)
        print("Run with --update-baseline to create initial baseline.")
        return 1

    # Load baseline
    with open(baseline_path, encoding="utf-8") as f:
        baseline = json.load(f)

    # Validate baseline first
    errors = validate_baseline(baseline)
    if errors:
        print("[FAIL] Baseline validation failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    # Scan current codebase
    scan_results = scan_codebase(repo_root)
    current = build_baseline(scan_results, repo_root)

    # Check for unjustified suppressions per FR-012
    unjustified = find_unjustified_suppressions(scan_results)
    if unjustified:
        print(f"[WARN] {len(unjustified)} suppressions missing justification tag:")
        for file_path, line_num, supp_type in unjustified[:10]:
            print(f"  {file_path}:{line_num}: {supp_type}")
        if len(unjustified) > 10:
            print(f"  ... and {len(unjustified) - 10} more")
        print()
        print("Required format: -- REASON: <explanation> or -- SECURITY: <explanation>")
        print()

    # Compute diff
    diff = compute_diff(baseline, current)
    delta = diff["delta"]

    # Print summary
    print(f"Baseline: {diff['baseline_total']} suppressions")
    print(f"Current:  {diff['current_total']} suppressions")
    print(f"Delta:    {delta:+d}")

    if delta == 0:
        print("\n[PASS] No suppression changes")
        return 0

    if delta < 0:
        print(f"\n[PASS] Suppressions reduced by {-delta}")
        return 0

    # Delta > 0: Check for approval
    if is_direct_push_to_main():
        print("\n[FAIL] Direct push to main with suppression increase is not allowed.")
        return 1

    if check_pr_approval():
        print("\n[PASS] Suppression increase approved via PR marker")
        return 0

    # Fail with detailed message
    print()
    print(format_failure_message(diff))
    return 1


def cmd_check_justifications(repo_root: Path, python_only: bool = False) -> int:
    """Check that all suppressions have justification tags per FR-012/FR-017.

    Args:
        repo_root: Repository root directory
        python_only: If True, only check Python files (src/ scope)

    Returns:
        0 if all suppressions have justifications, 1 otherwise
    """
    scan_results = scan_codebase(repo_root)

    # Filter to Python only if requested
    if python_only:
        scan_results = {
            path: supps
            for path, supps in scan_results.items()
            if path.startswith("src/")
        }

    unjustified = find_unjustified_suppressions(scan_results)

    if not unjustified:
        print("[PASS] All suppressions have justification tags")
        return 0

    print(f"[FAIL] {len(unjustified)} suppressions missing justification tag:")
    for file_path, line_num, supp_type in unjustified:
        print(f"  {file_path}:{line_num}: {supp_type}")
    print()
    print("Required format: -- REASON: <explanation> or -- SECURITY: <explanation>")
    return 1


# =============================================================================
# Main
# =============================================================================


def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Audit suppression comments in the codebase"
    )
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="Generate/update the suppression baseline file",
    )
    parser.add_argument(
        "--diff",
        action="store_true",
        help="Compare current scan to baseline and fail on increase",
    )
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Validate baseline file format and ordering",
    )
    parser.add_argument(
        "--baseline",
        type=Path,
        default=Path(".suppression-baseline.json"),
        help="Path to baseline file (default: .suppression-baseline.json)",
    )
    parser.add_argument(
        "--check-justifications",
        action="store_true",
        help="Fail if any suppressions are missing justification tags (for pre-commit)",
    )
    parser.add_argument(
        "--python-only",
        action="store_true",
        help="Only check Python files (src/ scope)",
    )

    args = parser.parse_args()

    # Find repo root (directory containing pyproject.toml or .git)
    repo_root = Path.cwd()
    while repo_root != repo_root.parent:
        if (repo_root / "pyproject.toml").exists() or (repo_root / ".git").exists():
            break
        repo_root = repo_root.parent

    baseline_path = repo_root / args.baseline

    if args.update_baseline:
        return cmd_update_baseline(repo_root, baseline_path)
    elif args.validate:
        return cmd_validate(baseline_path)
    elif args.diff:
        return cmd_diff(repo_root, baseline_path)
    elif args.check_justifications:
        return cmd_check_justifications(repo_root, args.python_only)
    else:
        return cmd_count(repo_root)


if __name__ == "__main__":
    sys.exit(main())
