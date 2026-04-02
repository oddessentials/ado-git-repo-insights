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
import fnmatch
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TypedDict

# =============================================================================
# Type Definitions (per data-model.md schema)
# =============================================================================


class SuppressionBaseline(TypedDict):
    """Schema for .suppression-baseline.json per data-model.md.

    v2 adds scope_policy for two-phase gating (FR-019).
    """

    version: int
    generated_at: str
    total: int
    scope_policy: dict[str, str]  # v2: "blocking" or "advisory" per scope
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

# Schema version (v2 adds scope_policy for two-phase gating)
SCHEMA_VERSION = 2

# Scope configuration — single source of truth for all scope-dependent behavior.
# scan_file(), build_baseline(), cmd_check_justifications(), and cmd_check_coverage()
# MUST derive scope behavior from this structure. No hardcoded fallbacks. (FR-028)


class ScopeConfig(TypedDict):
    """Configuration for a single audit scope."""

    dir: str
    pattern: str
    language: str  # "python" or "typescript"


SCOPES: dict[str, ScopeConfig] = {
    # Python scopes
    "python-backend": {"dir": "src/", "pattern": "*.py", "language": "python"},
    "python-scripts": {"dir": "scripts/", "pattern": "*.py", "language": "python"},
    "python-tests": {"dir": "tests/", "pattern": "*.py", "language": "python"},
    "python-ci-scripts": {
        "dir": ".github/scripts/",
        "pattern": "*.py",
        "language": "python",
    },
    # TypeScript scopes
    "typescript-extension": {
        "dir": "extension/ui/",
        "pattern": "*.ts",
        "language": "typescript",
    },
    "typescript-tests": {
        "dir": "extension/tests/",
        "pattern": "*.ts",
        "language": "typescript",
    },
    "typescript-tasks": {
        "dir": "extension/tasks/",
        "pattern": "*.ts",
        "language": "typescript",
    },
    "typescript-extension-scripts": {
        "dir": "extension/scripts/",
        "pattern": "*.ts",
        "language": "typescript",
    },
    "typescript-extension-config": {
        "dir": "extension/",
        "pattern": "*.ts",
        "language": "typescript",
    },
    "typescript-root-scripts": {
        "dir": "scripts/",
        "pattern": "*.ts",
        "language": "typescript",
    },
    "typescript-spec-contracts": {
        "dir": "specs/",
        "pattern": "*.ts",
        "language": "typescript",
    },
}

# Derived — kept for backward compatibility with scan_codebase() iteration
FILE_PATTERNS: dict[str, str] = {name: cfg["pattern"] for name, cfg in SCOPES.items()}

# Suppression patterns (type_id -> regex pattern)
SUPPRESSION_PATTERNS = {
    # TypeScript/ESLint
    "eslint-disable-block": re.compile(r"/\*\s*eslint-disable"),
    "eslint-disable-next-line": re.compile(r"//\s*eslint-disable-next-line"),
    "eslint-disable-line": re.compile(r"//\s*eslint-disable-line"),
    "ts-ignore": re.compile(r"//\s*@ts-ignore"),
    "ts-expect-error": re.compile(r"//\s*@ts-expect-error"),
    "ts-nocheck": re.compile(r"//\s*@ts-nocheck\b"),
    # Coverage suppressions
    "istanbul-ignore": re.compile(r"/\*\s*istanbul\s+ignore\s+(next|if|else|file)\b"),
    "c8-ignore": re.compile(r"/\*\s*c8\s+ignore\s+(next|start|stop)\b"),
    # Test-runner escapes
    "test-only": re.compile(
        r"(?:^|\W)(?:(?:describe|it|test)\.only(?:\.each)?|fit|fdescribe)\s*\("
    ),
    "test-skip": re.compile(
        r"(?:^|\W)(?:(?:describe|it|test)\.skip(?:\.each)?|xit|xdescribe)\s*\("
    ),
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
    "ts-nocheck": "typescript",
    "istanbul-ignore": "typescript",
    "c8-ignore": "typescript",
    "test-only": "typescript",
    "test-skip": "typescript",
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

# Excluded file patterns (fnmatch-style) — prevent false positives from
# documentation, snapshots, and lockfiles that may contain suppression keywords.
EXCLUDED_FILE_PATTERNS: set[str] = {
    "*.md",
    "*.snap",
    "*.lock",
    "pnpm-lock.yaml",
    "package-lock.json",
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
    # Check excluded directories
    if any(excluded in parts for excluded in EXCLUDED_DIRS):
        return True
    # Check excluded file patterns
    filename = path.name
    if any(fnmatch.fnmatch(filename, pattern) for pattern in EXCLUDED_FILE_PATTERNS):
        return True
    return False


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


def _scan_python_with_tokenize(
    content: str,
    file_path: Path,
    patterns_to_check: list[str],
) -> list[Suppression]:
    """Scan Python content using tokenize to avoid string-literal false positives.

    Only processes COMMENT tokens, so patterns inside strings/docstrings
    are structurally excluded. Uses generate_tokens (not tokenize.tokenize)
    because content is already str, not bytes. (FR-006, FR-022, FR-027)
    """
    import io
    import tokenize

    suppressions: list[Suppression] = []
    try:
        tokens = tokenize.generate_tokens(io.StringIO(content).readline)
        for tok_type, tok_string, start, _end, _line in tokens:
            if tok_type != tokenize.COMMENT:
                continue
            line_num = start[0]
            # SECURITY: Skip extremely long comments to prevent ReDoS
            if len(tok_string) > MAX_LINE_LENGTH:
                continue
            for pattern_name in patterns_to_check:
                pattern = SUPPRESSION_PATTERNS[pattern_name]
                if pattern.search(tok_string):
                    rules = extract_rules(tok_string, pattern_name)
                    suppressions.append(
                        {
                            "type": pattern_name,
                            "line": line_num,
                            "rules": rules,
                            "has_justification": has_justification(tok_string),
                        }
                    )
    except (tokenize.TokenError, IndentationError) as e:
        # FR-027: Tokenizer failures are HARD ERRORS, not silent skips.
        # tokenize.TokenError: unterminated strings, null bytes, EOF issues
        # IndentationError: mixed tabs/spaces, unmatched dedent
        # Identical behavior across pre-commit, preflight, and CI.
        print(
            f"[ERROR] Cannot tokenize {file_path}: {e}",
            file=sys.stderr,
        )
        # Return sentinel that causes callers to fail
        return [
            {
                "type": "__tokenize_error__",
                "line": 0,
                "rules": [],
                "has_justification": False,
            }
        ]
    return suppressions


def _scan_with_regex(
    content: str,
    patterns_to_check: list[str],
) -> list[Suppression]:
    """Scan content using line-by-line regex (for TypeScript files)."""
    suppressions: list[Suppression] = []
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
                "@ts-nocheck",
                "istanbul",
                "c8",
                ".only",
                ".skip",
                "fit(",
                "fdescribe(",
                "xit(",
                "xdescribe(",
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

    # Determine which patterns to check based on scope language (FR-028)
    scope_config = SCOPES.get(scope)
    if scope_config is None:
        print(
            f"[ERROR] Unknown scope '{scope}' — not in SCOPES. "
            "This is a bug in scope routing.",
            file=sys.stderr,
        )
        return suppressions

    language = scope_config["language"]
    if language == "python":
        patterns_to_check = ["type-ignore", "noqa"]
    elif scope == "typescript-tests":
        # TypeScript tests: all TS suppressions including test-runner escapes
        patterns_to_check = [
            "eslint-disable-block",
            "eslint-disable-next-line",
            "eslint-disable-line",
            "ts-ignore",
            "ts-expect-error",
            "ts-nocheck",
            "istanbul-ignore",
            "c8-ignore",
            "test-only",
            "test-skip",
        ]
    else:
        # TypeScript extension: all TS suppressions, no test escapes
        patterns_to_check = [
            "eslint-disable-block",
            "eslint-disable-next-line",
            "eslint-disable-line",
            "ts-ignore",
            "ts-expect-error",
            "ts-nocheck",
            "istanbul-ignore",
            "c8-ignore",
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

    # Use tokenize for Python files to avoid false positives from string literals.
    # TypeScript files keep regex scanning (Python tokenizer can't parse TS).
    if language == "python":
        suppressions = _scan_python_with_tokenize(content, file_path, patterns_to_check)
    else:
        suppressions = _scan_with_regex(content, patterns_to_check)

    return suppressions


def _resolve_scope(file_path: str) -> str | None:
    """Resolve a normalized file path to its scope name using the canonical SCOPES map.

    Matches the longest directory prefix AND file extension to handle:
    - Nested scopes (e.g., 'extension/tests/' before 'extension/')
    - Mixed-language directories (e.g., scripts/ has both .py and .ts scopes)

    Returns the scope name, or None if no scope matches. (FR-028)
    """
    best_match: str | None = None
    best_len = 0
    for scope_name, scope_cfg in SCOPES.items():
        scope_dir = scope_cfg["dir"]
        scope_pattern = scope_cfg["pattern"]
        if not file_path.startswith(scope_dir):
            continue
        # Check file extension matches scope pattern
        ext_match = (scope_pattern == "*.py" and file_path.endswith(".py")) or (
            scope_pattern == "*.ts" and file_path.endswith(".ts")
        )
        if not ext_match:
            continue
        if len(scope_dir) > best_len:
            best_match = scope_name
            best_len = len(scope_dir)
    return best_match


def has_tokenize_errors(scan_results: dict[str, list[Suppression]]) -> bool:
    """Check if any scan results contain tokenize error sentinels."""
    for suppressions in scan_results.values():
        for supp in suppressions:
            if supp["type"] == "__tokenize_error__":
                return True
    return False


def scan_codebase(repo_root: Path) -> dict[str, list[Suppression]]:
    """
    Scan all files in configured scopes.

    Returns dict mapping normalized file paths to their suppressions.
    If any file has a tokenize error, the error sentinel is preserved
    in the results for callers to detect via has_tokenize_errors().
    """
    results: dict[str, list[Suppression]] = {}

    for scope_name, scope_cfg in SCOPES.items():
        scope_path = repo_root / scope_cfg["dir"]
        if not scope_path.exists():
            continue

        pattern = scope_cfg["pattern"]
        for file_path in scope_path.rglob(pattern):
            if is_excluded(file_path):
                continue

            normalized = normalize_path(file_path, repo_root)

            # Only scan under canonical scope (longest prefix match) to prevent
            # parent scopes from overwriting child scope results.  Without this,
            # a file in extension/tests/ would be scanned first under
            # typescript-tests (with test-only patterns) and then rescanned
            # under typescript-extension-config (without them), dropping
            # test-only suppressions. (FR-028)
            canonical_scope = _resolve_scope(normalized)
            if canonical_scope != scope_name:
                continue

            suppressions = scan_file(file_path, scope_name, repo_root)
            if suppressions:
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

        # Determine scope from file path using canonical SCOPES map (FR-028)
        # Match longest prefix first to handle nested directories correctly
        # (e.g., "extension/tests/" before "extension/")
        scope = _resolve_scope(file_path)
        if scope is None:
            print(
                f"[ERROR] File '{file_path}' does not match any scope in SCOPES. "
                "Add a scope for this directory.",
                file=sys.stderr,
            )
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

    # Build scope_policy — default all scopes to "blocking" (FR-019)
    # Callers can override specific scopes to "advisory" for two-phase gating
    scope_policy: dict[str, str] = dict.fromkeys(SCOPES, "blocking")

    # Sort all dictionaries alphabetically for determinism
    baseline: SuppressionBaseline = {
        "version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total": total,
        "scope_policy": dict(sorted(scope_policy.items())),
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

    # Check version — accept v1 (backward compat) or v2 (current)
    version = baseline["version"]
    if version not in (1, 2):
        errors.append(f"Invalid version: {version} (expected 1 or 2)")

    # v2 validation: scope_policy must exist and be valid
    if version >= 2:
        scope_policy = baseline.get("scope_policy")
        if scope_policy is None:
            errors.append("v2 baseline missing required field: scope_policy")
        elif isinstance(scope_policy, dict):
            for scope_name, policy in scope_policy.items():
                if policy not in ("blocking", "advisory"):
                    errors.append(
                        f"Invalid scope_policy for '{scope_name}': '{policy}' "
                        "(must be 'blocking' or 'advisory')"
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
    for key in ["scope_policy", "by_scope", "by_type", "by_file", "by_rule"]:
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


def format_diff_message(diff: SuppressionDiff, *, level: str = "FAIL") -> str:
    """
    Format CI failure message per FR-011.

    Includes: previous count, new count, delta, copy-pastable instruction.
    """
    baseline_total = diff["baseline_total"]
    current_total = diff["current_total"]
    delta = diff["delta"]

    lines = [
        f"[{level}] Suppression count increased: {baseline_total} -> {current_total} (+{delta})",
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
    if has_tokenize_errors(scan_results):
        print(
            "[FAIL] Tokenize errors detected — fix syntax errors before auditing.",
            file=sys.stderr,
        )
        return 1
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
    if has_tokenize_errors(scan_results):
        print(
            "[FAIL] Tokenize errors detected — fix syntax errors before updating baseline.",
            file=sys.stderr,
        )
        return 1
    baseline = build_baseline(scan_results, repo_root)

    # Write with deterministic formatting
    with open(baseline_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(baseline, f, indent=2, ensure_ascii=False)
        f.write("\n")  # Ensure newline at EOF

    print(f"Baseline updated: {baseline_path}")
    print(f"Total suppressions: {baseline['total']}")
    return 0


def cmd_check_staleness(repo_root: Path, baseline_path: Path) -> int:
    """Verify committed baseline matches a fresh regeneration (FR-025).

    JSON-level comparison ignoring the generated_at timestamp.
    Fails if the baseline was hand-edited or is stale after code changes.
    """
    if not baseline_path.exists():
        print(
            f"[FAIL] Baseline not found: {baseline_path}\n"
            "  Run: python scripts/audit-suppressions.py --update-baseline",
            file=sys.stderr,
        )
        return 1

    with open(baseline_path, encoding="utf-8") as f:
        committed = json.load(f)

    scan_results = scan_codebase(repo_root)
    if has_tokenize_errors(scan_results):
        print(
            "[FAIL] Tokenize errors — fix syntax before checking staleness.",
            file=sys.stderr,
        )
        return 1
    fresh = build_baseline(scan_results, repo_root)

    # Compare all fields except generated_at
    committed_cmp = {k: v for k, v in committed.items() if k != "generated_at"}
    fresh_cmp = {k: v for k, v in fresh.items() if k != "generated_at"}

    if committed_cmp != fresh_cmp:
        # Find which keys differ
        diff_keys = [
            k
            for k in set(committed_cmp) | set(fresh_cmp)
            if committed_cmp.get(k) != fresh_cmp.get(k)
        ]
        print(
            f"[FAIL] Baseline is stale or was hand-edited. "
            f"Differing keys: {', '.join(sorted(diff_keys))}\n"
            "  Run: python scripts/audit-suppressions.py --update-baseline"
        )
        return 1

    print("[PASS] Baseline matches fresh regeneration")
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


def cmd_diff(
    repo_root: Path,
    baseline_path: Path,
    *,
    allow_pending_approval: bool = False,
) -> int:
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
    if has_tokenize_errors(scan_results):
        print(
            "[FAIL] Tokenize errors detected — fix syntax errors before diffing.",
            file=sys.stderr,
        )
        return 1
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

    # Build scope_policy lookup — v2 baselines have explicit scope_policy.
    # v1 baselines (no scope_policy) treat all by_scope entries as blocking.
    # Post-transition: a scope present in scan but absent from baseline is a hard error.
    baseline_scope_policy: dict[str, str] = baseline.get("scope_policy", {})
    baseline_scopes: set[str] = set(baseline.get("by_scope", {}).keys())

    def _get_scope_policy(file_path: str) -> str:
        scope = _resolve_scope(file_path)
        if scope is None:
            return "blocking"  # unknown file → strict
        # v2: use explicit scope_policy
        if scope in baseline_scope_policy:
            return baseline_scope_policy[scope]
        # v1: scopes in by_scope are blocking
        if scope in baseline_scopes:
            return "blocking"
        # Scope in scan but absent from baseline → hard error (stale baseline)
        print(
            f"[ERROR] Scope '{scope}' not in baseline — "
            "regenerate with --update-baseline.",
            file=sys.stderr,
        )
        return "blocking"

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

    # Delta > 0: Check scope policies — advisory scopes warn but don't fail
    blocking_increases: dict[str, FileDiffInfo] = {}
    advisory_increases: dict[str, FileDiffInfo] = {}

    for file_path in diff["new_files"]:
        policy = _get_scope_policy(file_path)
        actual_count = current["by_file"].get(file_path, 1)
        target = blocking_increases if policy == "blocking" else advisory_increases
        target[file_path] = {"was": 0, "now": actual_count, "delta": actual_count}

    for file_path, info in diff["increased_files"].items():
        policy = _get_scope_policy(file_path)
        target = blocking_increases if policy == "blocking" else advisory_increases
        target[file_path] = info

    if advisory_increases:
        print(
            f"\n[WARN] {len(advisory_increases)} file(s) with increases in advisory scopes (non-blocking):"
        )
        for fp in sorted(advisory_increases):
            print(f"  {fp}")

    if not blocking_increases:
        print("\n[PASS] All suppression increases are in advisory scopes")
        return 0

    # Blocking increases exist — check for approval
    if is_direct_push_to_main():
        print("\n[FAIL] Direct push to main with suppression increase is not allowed.")
        return 1

    if check_pr_approval():
        print("\n[PASS] Suppression increase approved via PR marker")
        return 0

    # Fail with detailed message for blocking increases only
    blocking_diff: SuppressionDiff = {
        "baseline_total": diff["baseline_total"],
        "current_total": diff["current_total"],
        "delta": sum(info.get("delta", 1) for info in blocking_increases.values()),
        "new_files": [f for f in diff["new_files"] if f in blocking_increases],
        "removed_files": diff["removed_files"],
        "increased_files": {
            f: info
            for f, info in diff["increased_files"].items()
            if f in blocking_increases
        },
        "decreased_files": diff["decreased_files"],
    }
    print()
    print(format_diff_message(blocking_diff))
    if allow_pending_approval:
        print()
        print(
            "[WARN] Pending PR approval allowed for local preflight. "
            "CI will still require the PR description marker."
        )
        return 0
    return 1


def cmd_check_justifications(
    repo_root: Path,
    python_only: bool = False,
    baseline_path: Path | None = None,
) -> int:
    """Check that all suppressions have justification tags per FR-012/FR-017.

    Respects scope_policy from the baseline: only enforces justifications for
    blocking scopes. Advisory scopes are warned but not failed. (FR-019)

    Args:
        repo_root: Repository root directory
        python_only: If True, only check Python files
        baseline_path: Path to baseline file (for scope_policy lookup)

    Returns:
        0 if all suppressions have justifications, 1 otherwise
    """
    scan_results = scan_codebase(repo_root)
    if has_tokenize_errors(scan_results):
        print(
            "[FAIL] Tokenize errors detected — fix syntax errors first.",
            file=sys.stderr,
        )
        return 1

    # Filter to Python only if requested — uses canonical SCOPES map (FR-028)
    if python_only:
        python_dirs = tuple(
            cfg["dir"] for cfg in SCOPES.values() if cfg["language"] == "python"
        )
        scan_results = {
            path: supps
            for path, supps in scan_results.items()
            if path.startswith(python_dirs)
        }

    # Load scope_policy from baseline if available (FR-019)
    scope_policy: dict[str, str] = {}
    if baseline_path and baseline_path.exists():
        try:
            with open(baseline_path, encoding="utf-8") as f:
                baseline_data = json.load(f)
            scope_policy = baseline_data.get("scope_policy", {})
        except (OSError, json.JSONDecodeError):
            pass  # Fall back to treating all scopes as blocking

    # Filter to blocking scopes only — advisory scopes get warnings, not failures
    if scope_policy:
        blocking_results: dict[str, list[Suppression]] = {}
        advisory_results: dict[str, list[Suppression]] = {}
        for path, supps in scan_results.items():
            scope = _resolve_scope(path)
            policy = scope_policy.get(scope, "blocking") if scope else "blocking"
            if policy == "advisory":
                advisory_results[path] = supps
            else:
                blocking_results[path] = supps

        # Warn about advisory scope suppressions
        advisory_unjustified = find_unjustified_suppressions(advisory_results)
        if advisory_unjustified:
            print(
                f"[WARN] {len(advisory_unjustified)} suppressions in advisory scopes "
                "missing justification (non-blocking):"
            )
            for fp, ln, st in advisory_unjustified[:5]:
                print(f"  {fp}:{ln}: {st}")
            if len(advisory_unjustified) > 5:
                print(f"  ... and {len(advisory_unjustified) - 5} more")
            print()

        scan_results = blocking_results

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


def cmd_check_coverage(repo_root: Path) -> int:
    """Verify every tracked .py/.ts file belongs to exactly one scope (FR-018, FR-026).

    Uses `git ls-files` to enumerate only tracked files, avoiding false positives
    from generated files in gitignored directories (.mypy_cache, htmlcov, etc.).
    """
    # Enumerate tracked files via git ls-files (cross-OS safe with list args)
    try:
        result = subprocess.run(
            ["git", "ls-files", "*.py", "*.ts"],
            capture_output=True,
            text=True,
            cwd=repo_root,
        )
        if result.returncode != 0:
            print(f"[ERROR] git ls-files failed: {result.stderr}", file=sys.stderr)
            return 1
    except FileNotFoundError:
        print(
            "[ERROR] git not found — cannot enumerate tracked files.", file=sys.stderr
        )
        return 1

    tracked_files = [
        f.replace("\\", "/") for f in result.stdout.strip().splitlines() if f.strip()
    ]

    uncovered: list[str] = []

    for file_path in tracked_files:
        # Skip excluded directories
        if any(excl in file_path.split("/") for excl in EXCLUDED_DIRS):
            continue

        # Use _resolve_scope for longest-prefix matching (handles nested scopes)
        scope = _resolve_scope(file_path)
        if scope is None:
            uncovered.append(file_path)
            continue

        # Verify file extension matches the resolved scope's pattern
        scope_cfg = SCOPES[scope]
        ext_match = (scope_cfg["pattern"] == "*.py" and file_path.endswith(".py")) or (
            scope_cfg["pattern"] == "*.ts" and file_path.endswith(".ts")
        )
        if not ext_match:
            uncovered.append(file_path)

    if uncovered:
        print(f"[FAIL] {len(uncovered)} file(s) not in any scope:")
        for f in sorted(uncovered):
            print(f"  {f}")
        return 1

    print(f"[PASS] All {len(tracked_files)} tracked files are in exactly one scope")
    return 0


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
        "--check-staleness",
        action="store_true",
        help="Verify committed baseline matches a fresh regeneration (FR-025)",
    )
    parser.add_argument(
        "--check-coverage",
        action="store_true",
        help="Verify every tracked .py/.ts file belongs to exactly one scope",
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
    parser.add_argument(
        "--allow-pending-approval",
        action="store_true",
        help=(
            "Allow --diff to pass locally when the only blocker is a missing "
            "PR approval marker for suppression increases."
        ),
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
        return cmd_diff(
            repo_root,
            baseline_path,
            allow_pending_approval=args.allow_pending_approval,
        )
    elif args.check_staleness:
        return cmd_check_staleness(repo_root, baseline_path)
    elif args.check_coverage:
        return cmd_check_coverage(repo_root)
    elif args.check_justifications:
        return cmd_check_justifications(repo_root, args.python_only, baseline_path)
    else:
        return cmd_count(repo_root)


if __name__ == "__main__":
    sys.exit(main())
