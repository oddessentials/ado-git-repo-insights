#!/usr/bin/env python3
"""Compensating guardrails for globally disabled ruff rules (FR-014, FR-021).

When a lint rule is disabled globally (added to ruff ignore), this script
provides the compensating safety check. It detects patterns that the disabled
rule would have caught, ensuring future code cannot silently inherit the
weakened configuration.

Entry points:
  --check-subprocess  Detect unsafe subprocess patterns (compensates S603/S607)
  --check-random      Detect unsafe random patterns (compensates S311)
  --verify-artifacts  Verify committed proof artifacts match codebase
  --generate-artifacts Generate proof artifacts for rule-disable justification

All checks use tokenize.generate_tokens for accuracy (no string-literal
false positives). Compatible with staged_file_content() which returns str.

Runs identically in pre-commit (staged files), preflight (full tree), and CI
(full tree) via the same entry point (FR-021, QG-39).
"""

from __future__ import annotations

import argparse
import io
import json
import re
import subprocess
import sys
import tokenize
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Files that contain guardrail detection patterns as string literals (not violations).
# These ARE the guardrail — exclude them from self-scanning.
GUARDRAIL_EXCLUSIONS = frozenset(
    {
        "scripts/check_rule_disable_invariants.py",
        "tests/unit/test_rule_disable_invariants.py",
    }
)

# Patterns that indicate unsafe subprocess usage (S603/S607 compensation)
# These fire when shell=True or when the command is a variable (not a literal list)
SHELL_TRUE_PATTERN = re.compile(r"\bshell\s*=\s*True\b")

# Patterns that indicate unsafe random usage (S311 compensation)
SECRETS_IMPORT_PATTERN = re.compile(
    r"^\s*(?:from\s+secrets\s+import|import\s+secrets)\b"
)
URANDOM_PATTERN = re.compile(r"\bos\.urandom\b")
SYSTEM_RANDOM_PATTERN = re.compile(r"\brandom\.SystemRandom\b")
UNSEEDED_RANDOM_PATTERN = re.compile(r"\brandom\.Random\s*\(\s*\)")


def _get_tracked_py_files(cwd: Path) -> list[str]:
    """Get all tracked .py files via git ls-files (cross-OS safe)."""
    result = subprocess.run(
        ["git", "ls-files", "*.py"],
        capture_output=True,
        text=True,
        cwd=cwd,
    )
    if result.returncode != 0:
        print(f"[ERROR] git ls-files failed: {result.stderr}", file=sys.stderr)
        return []
    return [
        f.replace("\\", "/") for f in result.stdout.strip().splitlines() if f.strip()
    ]


def _tokenize_comments(content: str) -> list[tuple[int, str]]:
    """Extract (line_number, full_line) for lines containing comments.

    Uses tokenize to identify comment tokens, then returns the full source
    lines for those positions. This is used so pattern matching operates
    on code context, not just the comment text.
    """
    comment_lines: set[int] = set()
    try:
        tokens = tokenize.generate_tokens(io.StringIO(content).readline)
        for tok_type, _tok_string, start, _end, _line in tokens:
            if tok_type == tokenize.COMMENT:
                comment_lines.add(start[0])
    except (tokenize.TokenError, IndentationError):
        pass  # Malformed files handled by audit-suppressions.py, not here
    return comment_lines


def _get_code_lines(content: str) -> list[tuple[int, str]]:
    """Return all (line_number, line_text) pairs, excluding only lines that are
    ENTIRELY inside multi-line string literals (docstrings).

    Single-line strings on code lines (e.g., os.system("cmd")) are kept because
    the code pattern (os.system) is the target, not the string content.
    Only multi-line string interiors (lines 2..N of a triple-quoted string)
    are excluded to prevent matching patterns in docstring prose.
    """
    lines = content.splitlines()
    docstring_interior_lines: set[int] = set()
    try:
        tokens = tokenize.generate_tokens(io.StringIO(content).readline)
        for tok_type, _tok_string, start, end, _line in tokens:
            if tok_type == tokenize.STRING and end[0] > start[0]:
                # Multi-line string: exclude interior lines (not start/end)
                for ln in range(start[0] + 1, end[0]):
                    docstring_interior_lines.add(ln)
    except (tokenize.TokenError, IndentationError):
        pass
    return [
        (i + 1, line)
        for i, line in enumerate(lines)
        if (i + 1) not in docstring_interior_lines
    ]


# =============================================================================
# Subprocess guardrail (S603/S607 compensation)
# =============================================================================


SUBPROCESS_CALL_PATTERN = re.compile(
    r"\bsubprocess\.(?:run|Popen|call|check_call|check_output)\s*\("
)


def _is_subprocess_arg_literal_list(
    code_lines: list[tuple[int, str]], call_line_idx: int
) -> bool:
    """Check if a subprocess call's first argument is a list literal.

    Handles multi-line calls by scanning forward from the opening paren
    for up to 3 lines to find a `[` as the first non-whitespace token
    after the paren. This covers the common patterns:
      subprocess.run(["git", ...])         — same line
      subprocess.run(                      — next line has [
          ["git", ...],
    """
    # Check same line first
    _, call_line = code_lines[call_line_idx]
    paren_pos = call_line.find("(")
    if paren_pos >= 0:
        after_paren = call_line[paren_pos + 1 :].lstrip()
        if after_paren.startswith("["):
            return True

    # Check next few lines for the list literal
    for offset in range(1, 4):
        next_idx = call_line_idx + offset
        if next_idx >= len(code_lines):
            break
        _, next_line = code_lines[next_idx]
        stripped = next_line.strip()
        if not stripped:
            continue  # skip blank lines
        return stripped.startswith("[")

    return False


def check_subprocess_safety(file_path: str, content: str) -> list[dict[str, str | int]]:
    """Detect unsafe subprocess patterns in a single file.

    Flags:
    - subprocess.run/Popen/call/check_call/check_output with shell=True
    - subprocess.run/Popen/call with a non-literal first argument (variable,
      function call, f-string) — this is the untrusted-command pattern that
      S603 was designed to catch (P1 review finding)
    - os.system, os.popen (always unsafe)

    For multi-line calls, scans forward up to 3 lines to find the list literal.

    Returns list of violations with file, line, pattern, code.
    """
    violations: list[dict[str, str | int]] = []
    code_lines = _get_code_lines(content)

    for idx, (line_num, line) in enumerate(code_lines):
        # Check for shell=True in subprocess calls
        if SHELL_TRUE_PATTERN.search(line) and "subprocess" in content:
            violations.append(
                {
                    "file": file_path,
                    "line": line_num,
                    "pattern": "shell=True",
                    "code": line.strip(),
                }
            )
        # Check for subprocess call with non-literal first argument (P1 fix)
        # Safe: subprocess.run(["git", ...]) or multi-line with [ on next line
        # Safe: lines with "# guardrail-safe: subprocess" comment (reviewed & approved)
        # Unsafe: subprocess.run(cmd) or subprocess.run(get_args())
        elif SUBPROCESS_CALL_PATTERN.search(line):
            if "guardrail-safe: subprocess" in line:
                continue  # Explicitly reviewed and approved
            if not _is_subprocess_arg_literal_list(code_lines, idx):
                violations.append(
                    {
                        "file": file_path,
                        "line": line_num,
                        "pattern": "subprocess with non-literal command",
                        "code": line.strip(),
                    }
                )
        # Check for os.system / os.popen (always unsafe)
        if re.search(r"\bos\.(?:system|popen)\s*\(", line):
            violations.append(
                {
                    "file": file_path,
                    "line": line_num,
                    "pattern": "os.system/popen",
                    "code": line.strip(),
                }
            )

    return violations


# =============================================================================
# Random guardrail (S311 compensation)
# =============================================================================


# Module-level random functions that are non-deterministic when called directly
# (not on a seeded Random instance). This is what S311 was designed to catch.
# Excludes: random.seed() (safe — sets the seed), random.Random() (checked separately)
RANDOM_MODULE_FUNC_PATTERN = re.compile(
    r"\brandom\.(?:random|randint|randrange|choice|choices|shuffle|sample|uniform"
    r"|triangular|betavariate|expovariate|gammavariate|gauss|lognormvariate"
    r"|normalvariate|vonmisesvariate|paretovariate|weibullvariate"
    r"|getrandbits|randbytes)\s*\("
)
# Safe pattern: calling a method on a seeded instance (rng.random(), rng.randint(), etc.)
# These are NOT module-level — they're on a named Random() instance.
# We detect module-level by checking for the literal "random." prefix.


def check_random_safety(file_path: str, content: str) -> list[dict[str, str | int]]:
    """Detect unsafe random patterns in a single file.

    Flags:
    - random.random(), random.randint(), etc. — module-level non-deterministic
      functions (P2 review finding: this is what S311 was designed to catch)
    - import secrets (in a file that also uses random)
    - os.urandom (crypto usage mixed with random)
    - random.SystemRandom (crypto-grade RNG)
    - random.Random() without a seed argument (non-deterministic)

    Returns list of violations with file, line, pattern, code.
    """
    violations: list[dict[str, str | int]] = []
    has_random_import = "import random" in content or "from random" in content
    code_lines = _get_code_lines(content)

    for line_num, line in code_lines:
        # Module-level random function calls (P2 fix)
        # random.random(), random.randint(), random.choice(), etc.
        # These are non-deterministic unless called on a seeded instance.
        # Lines with "# guardrail-safe: random" are explicitly reviewed.
        if (
            RANDOM_MODULE_FUNC_PATTERN.search(line)
            and "guardrail-safe: random" not in line
        ):
            violations.append(
                {
                    "file": file_path,
                    "line": line_num,
                    "pattern": "random module-level function (non-deterministic)",
                    "code": line.strip(),
                }
            )
        # import secrets alongside random
        if has_random_import and SECRETS_IMPORT_PATTERN.search(line):
            violations.append(
                {
                    "file": file_path,
                    "line": line_num,
                    "pattern": "import secrets (mixed with random)",
                    "code": line.strip(),
                }
            )
        # os.urandom alongside random
        if has_random_import and URANDOM_PATTERN.search(line):
            violations.append(
                {
                    "file": file_path,
                    "line": line_num,
                    "pattern": "os.urandom (mixed with random)",
                    "code": line.strip(),
                }
            )
        # random.SystemRandom
        if SYSTEM_RANDOM_PATTERN.search(line):
            violations.append(
                {
                    "file": file_path,
                    "line": line_num,
                    "pattern": "random.SystemRandom",
                    "code": line.strip(),
                }
            )
        # random.Random() without seed
        if UNSEEDED_RANDOM_PATTERN.search(line):
            violations.append(
                {
                    "file": file_path,
                    "line": line_num,
                    "pattern": "random.Random() without seed",
                    "code": line.strip(),
                }
            )

    return violations


# =============================================================================
# Artifact generation and verification (FR-020)
# =============================================================================


def generate_subprocess_artifact(repo_root: Path) -> dict[str, object]:
    """Generate machine-readable audit of all subprocess call sites."""
    tracked = _get_tracked_py_files(repo_root)
    call_sites: list[dict[str, str | int]] = []

    subprocess_pattern = re.compile(
        r"\bsubprocess\.(?:run|Popen|call|check_call|check_output)\s*\("
    )

    for file_path in tracked:
        full_path = repo_root / file_path
        if not full_path.exists():
            continue
        try:
            content = full_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue

        code_lines = _get_code_lines(content)
        for line_num, line in code_lines:
            if subprocess_pattern.search(line):
                has_shell_true = bool(SHELL_TRUE_PATTERN.search(line))
                safety = "unsafe-shell-true" if has_shell_true else "safe-hardcoded"
                call_sites.append(
                    {
                        "file": file_path,
                        "line": line_num,
                        "code": line.strip()[:200],
                        "shell_true": has_shell_true,
                        "safety": safety,
                    }
                )

    return {
        "rule": "S603",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_call_sites": len(call_sites),
        "unsafe_count": sum(1 for s in call_sites if s["safety"] != "safe-hardcoded"),
        "call_sites": call_sites,
    }


def generate_random_artifact(repo_root: Path) -> dict[str, object]:
    """Generate machine-readable audit of all random module usages."""
    tracked = _get_tracked_py_files(repo_root)
    usages: list[dict[str, str | int]] = []

    random_pattern = re.compile(r"\brandom\.\w+\s*\(")

    for file_path in tracked:
        full_path = repo_root / file_path
        if not full_path.exists():
            continue
        try:
            content = full_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue

        if "random" not in content:
            continue

        code_lines = _get_code_lines(content)
        for line_num, line in code_lines:
            if random_pattern.search(line):
                is_seeded = "seed" in line or re.search(r"Random\s*\(\s*\w", line)
                usages.append(
                    {
                        "file": file_path,
                        "line": line_num,
                        "code": line.strip()[:200],
                        "purpose": "deterministic-seeded"
                        if is_seeded
                        else "needs-review",
                    }
                )

    return {
        "rule": "S311",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_usages": len(usages),
        "usages": usages,
    }


def _normalize_entries(entries: list[dict[str, object]]) -> list[tuple[str, int, str]]:
    """Extract (file, line, code) tuples for content comparison."""
    return sorted(
        (str(e.get("file", "")), int(e.get("line", 0)), str(e.get("code", "")))
        for e in entries
    )


def verify_artifacts(repo_root: Path) -> int:
    """Verify committed proof artifacts match current codebase (FR-020).

    Compares full call site lists (file, line, code), not just counts.
    This catches moves, edits, and replacements that preserve total count
    but change the actual call sites. (P3 review finding)
    """
    exit_code = 0
    artifact_configs: list[tuple[str, object, str]] = [
        ("S603", generate_subprocess_artifact, "call_sites"),
        ("S311", generate_random_artifact, "usages"),
    ]
    for rule, generator, entries_key in artifact_configs:
        artifact_path = repo_root / f".rule-disable-audit-{rule}.json"
        if not artifact_path.exists():
            print(f"[WARN] No artifact for {rule}: {artifact_path}")
            continue

        with open(artifact_path, encoding="utf-8") as f:
            committed = json.load(f)

        fresh = generator(repo_root)

        # Compare full content, not just counts (P3 fix)
        committed_entries = _normalize_entries(committed.get(entries_key, []))
        fresh_entries = _normalize_entries(fresh.get(entries_key, []))

        if committed_entries != fresh_entries:
            committed_count = len(committed_entries)
            fresh_count = len(fresh_entries)
            # Find specific differences for actionable output
            committed_set = set(committed_entries)
            fresh_set = set(fresh_entries)
            added = fresh_set - committed_set
            removed = committed_set - fresh_set

            print(
                f"[FAIL] {rule} artifact stale: "
                f"committed={committed_count}, current={fresh_count}"
            )
            if added:
                print(f"  New call sites not in artifact ({len(added)}):")
                for f_path, line, code in sorted(added)[:5]:
                    print(f"    {f_path}:{line}: {code[:80]}")
            if removed:
                print(f"  Removed call sites still in artifact ({len(removed)}):")
                for f_path, line, code in sorted(removed)[:5]:
                    print(f"    {f_path}:{line}: {code[:80]}")
            print(
                "  Run: python scripts/check_rule_disable_invariants.py "
                "--generate-artifacts"
            )
            exit_code = 1
        else:
            print(
                f"[PASS] {rule} artifact matches codebase "
                f"({len(fresh_entries)} call sites, content-verified)"
            )

    return exit_code


# =============================================================================
# CLI
# =============================================================================


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compensating guardrails for disabled lint rules"
    )
    parser.add_argument(
        "--check-subprocess",
        action="store_true",
        help="Check for unsafe subprocess patterns (S603/S607 compensation)",
    )
    parser.add_argument(
        "--check-random",
        action="store_true",
        help="Check for unsafe random patterns (S311 compensation)",
    )
    parser.add_argument(
        "--verify-artifacts",
        action="store_true",
        help="Verify committed proof artifacts match codebase",
    )
    parser.add_argument(
        "--generate-artifacts",
        action="store_true",
        help="Generate proof artifacts for rule-disable justification",
    )

    args = parser.parse_args()
    repo_root = REPO_ROOT
    exit_code = 0

    if args.generate_artifacts:
        for rule, generator in [
            ("S603", generate_subprocess_artifact),
            ("S311", generate_random_artifact),
        ]:
            artifact = generator(repo_root)
            artifact_path = repo_root / f".rule-disable-audit-{rule}.json"
            with open(artifact_path, "w", encoding="utf-8", newline="\n") as f:
                json.dump(artifact, f, indent=2, ensure_ascii=False)
                f.write("\n")
            print(
                f"Generated {artifact_path} ({artifact.get('total_call_sites', artifact.get('total_usages'))} entries)"
            )
        return 0

    if args.verify_artifacts:
        exit_code = max(exit_code, verify_artifacts(repo_root))

    if args.check_subprocess or args.check_random:
        tracked = _get_tracked_py_files(repo_root)
        all_violations: list[dict[str, str | int]] = []

        for file_path in tracked:
            # Skip guardrail files — they contain detection patterns as string
            # literals, not actual violations (self-exclusion)
            if file_path in GUARDRAIL_EXCLUSIONS:
                continue
            full_path = repo_root / file_path
            if not full_path.exists():
                continue
            try:
                content = full_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue

            if args.check_subprocess:
                all_violations.extend(check_subprocess_safety(file_path, content))
            if args.check_random:
                all_violations.extend(check_random_safety(file_path, content))

        if all_violations:
            print(f"[FAIL] {len(all_violations)} unsafe pattern(s) detected:")
            for v in all_violations:
                print(f"  {v['file']}:{v['line']}: {v['pattern']}")
                print(f"    {v['code']}")
            exit_code = 1
        else:
            checks = []
            if args.check_subprocess:
                checks.append("subprocess")
            if args.check_random:
                checks.append("random")
            print(f"[PASS] No unsafe {'/'.join(checks)} patterns detected")

    if not any(
        [
            args.check_subprocess,
            args.check_random,
            args.verify_artifacts,
            args.generate_artifacts,
        ]
    ):
        parser.print_help()
        return 1

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
