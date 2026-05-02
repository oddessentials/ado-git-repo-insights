#!/usr/bin/env python3
"""Compensating guardrails for globally disabled ruff rules (FR-014, FR-021).

When a lint rule is disabled globally (added to ruff ignore), this script
provides the compensating safety check. It detects patterns that the disabled
rule would have caught, ensuring future code cannot silently inherit the
weakened configuration.

Entry points:
  --check-subprocess  Detect unsafe subprocess patterns (compensates S603/S607)
  --check-random      Detect unsafe random patterns (compensates S311)
  --check-syspath     Detect sys.path.insert/append (enforces importlib-only)
  --verify-artifacts  Verify proof artifacts and subprocess allowlist match codebase
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
from collections.abc import Callable
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Files that contain guardrail detection patterns as string literals (not violations).
# These ARE the guardrail — exclude them from self-scanning.
GUARDRAIL_EXCLUSIONS = frozenset(
    {
        "scripts/check_rule_disable_invariants.py",
        "tests/unit/test_rule_disable_invariants.py",
        # The auto-fix test file builds synthetic source content (literal
        # ``subprocess.run(`` substrings inside string fixtures) that the
        # scanner cannot distinguish from real call sites — same exclusion
        # pattern as test_rule_disable_invariants.py.
        "tests/unit/test_subprocess_allowlist_autofix.py",
    }
)

# Approved exceptions for non-literal subprocess commands.
# Each entry is a (file, line) pair where a reviewed, safe non-literal
# subprocess call exists. This is a committed allowlist — adding entries
# requires the same PR review process as any code change. No inline
# self-service bypass comments. (Replaces guardrail-safe mechanism.)
SUBPROCESS_ALLOWLIST_PATH = (
    Path(__file__).resolve().parent.parent / ".subprocess-allowlist.json"
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

# Patterns that detect sys.path manipulation (importlib-only enforcement)
SYS_PATH_PATTERN = re.compile(r"\bsys\.path\.(?:insert|append)\b")


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


def _normalize_allowlist_code(code: str | int) -> str:
    """Canonical code-field normalization for allowlist matching.

    Both the detection path (check_subprocess_safety, _match_allowlist) and
    the regen path (cmd_regenerate_allowlist) MUST funnel through this
    function so a whitespace-variant entry cannot be misclassified as an
    orphan and silently deleted. See issue #274.
    """
    return str(code).strip()


def _load_subprocess_allowlist() -> set[tuple[str, int, str]]:
    """Load the committed subprocess allowlist — (file, line, code) triples.

    Each entry maps to exactly one reviewed call site. All three fields must
    match to suppress a violation — no blanket bypasses by file+code alone.

    When a formatter shifts line numbers, entries stop matching and the
    guardrail flags them. Run --regenerate-allowlist to update line numbers.

    Returns an empty set if the file does not exist (no exceptions approved).
    """
    if not SUBPROCESS_ALLOWLIST_PATH.exists():
        return set()
    try:
        with open(SUBPROCESS_ALLOWLIST_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return {
            (
                entry["file"],
                int(entry["line"]),
                _normalize_allowlist_code(entry["code"]),
            )
            for entry in data.get("entries", [])
        }
    except (OSError, json.JSONDecodeError, KeyError, ValueError):
        return set()


def _match_allowlist(
    violation: dict[str, str | int],
    allowlist: set[tuple[str, int, str]],
) -> bool:
    """Check if a violation matches an allowlist entry by (file, line, code).

    This is the single matching function used by both the CLI enforcement path
    and the pre-commit guard, ensuring consistent behavior.
    """
    return (
        str(violation["file"]),
        int(violation["line"]),
        _normalize_allowlist_code(violation["code"]),
    ) in allowlist


SUBPROCESS_CALL_PATTERN = re.compile(
    r"\bsubprocess\.(?:run|Popen|call|check_call|check_output)\s*\("
)

# Regex to strip single-line string literals (both quote styles) from a line,
# used to distinguish keyword arguments from string content.
_STRING_LITERAL_RE = re.compile(
    r""""[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'"""
)


def _shell_true_in_code(line: str) -> bool:
    """Return True if shell=True appears as code, not inside a string literal."""
    stripped = _STRING_LITERAL_RE.sub("", line)
    return bool(SHELL_TRUE_PATTERN.search(stripped))


def _is_near_subprocess_call(
    code_lines: list[tuple[int, str]], idx: int, lookback: int = 5
) -> bool:
    """Return True if a subprocess call pattern exists on or within *lookback*
    lines above *idx*.  Covers multi-line calls like:

        subprocess.run(
            cmd,
            shell=True,
        )
    """
    for offset in range(0, lookback + 1):
        check_idx = idx - offset
        if check_idx < 0:
            break
        _, check_line = code_lines[check_idx]
        if SUBPROCESS_CALL_PATTERN.search(check_line):
            return True
    return False


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
        if _shell_true_in_code(line) and _is_near_subprocess_call(code_lines, idx):
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
        # Unsafe: subprocess.run(cmd) or subprocess.run(get_args())
        # Allowlisted: (file, line) pairs in .subprocess-allowlist.json
        elif SUBPROCESS_CALL_PATTERN.search(line):
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
        if RANDOM_MODULE_FUNC_PATTERN.search(line):
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
# sys.path guardrail (importlib-only enforcement)
# =============================================================================


def check_syspath_safety(file_path: str, content: str) -> list[dict[str, str | int]]:
    """Detect sys.path.insert/append calls in a file.

    Scripts must use importlib.util.spec_from_file_location() instead of
    sys.path manipulation. conftest.py files are exempt (pytest needs them).

    Returns list of violations with file, line, pattern, code.
    """
    if file_path.replace("\\", "/").endswith("conftest.py"):
        return []

    violations: list[dict[str, str | int]] = []
    code_lines = _get_code_lines(content)

    for line_num, line in code_lines:
        if SYS_PATH_PATTERN.search(line):
            violations.append(
                {
                    "file": file_path,
                    "line": line_num,
                    "pattern": "sys.path manipulation",
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
        if file_path in GUARDRAIL_EXCLUSIONS:
            continue
        full_path = repo_root / file_path
        if not full_path.exists():
            continue
        try:
            content = full_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue

        code_lines = _get_code_lines(content)
        for idx, (line_num, line) in enumerate(code_lines):
            if subprocess_pattern.search(line):
                has_shell_true = bool(SHELL_TRUE_PATTERN.search(line))
                is_literal_list = _is_subprocess_arg_literal_list(code_lines, idx)
                if has_shell_true:
                    safety = "unsafe-shell-true"
                elif not is_literal_list:
                    safety = "unsafe-non-literal-command"
                else:
                    safety = "safe-literal-list"
                call_sites.append(
                    {
                        "file": file_path,
                        "line": line_num,
                        "code": line.strip()[:200],
                        "shell_true": has_shell_true,
                        "literal_list": is_literal_list,
                        "safety": safety,
                    }
                )

    return {
        "rule": "S603",
        "total_call_sites": len(call_sites),
        "unsafe_count": sum(
            1 for s in call_sites if s["safety"] != "safe-literal-list"
        ),
        "call_sites": call_sites,
    }


def generate_random_artifact(repo_root: Path) -> dict[str, object]:
    """Generate machine-readable audit of all random module usages."""
    tracked = _get_tracked_py_files(repo_root)
    usages: list[dict[str, str | int]] = []

    random_pattern = re.compile(r"\brandom\.\w+\s*\(")

    for file_path in tracked:
        if file_path in GUARDRAIL_EXCLUSIONS:
            continue
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
                is_seeded = bool(
                    re.search(r"\brandom\.seed\s*\(", line)
                    or re.search(r"Random\s*\(\s*\w", line)
                )
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
        "total_usages": len(usages),
        "usages": usages,
    }


def _normalize_entries(
    entries: list[dict[str, object]],
) -> list[tuple[str, str, str]]:
    """Normalize artifact entries for semantic comparison.

    Line numbers are intentionally excluded so formatting-only churn does not
    force artifact regeneration. Classification is retained so safety changes
    still fail verification.
    """
    return sorted(
        (
            str(entry.get("file", "")),
            str(entry.get("code", "")),
            str(entry.get("safety", entry.get("purpose", ""))),
        )
        for entry in entries
    )


def verify_subprocess_allowlist_entries(
    repo_root: Path,
) -> list[dict[str, str | int]]:
    """Verify each .subprocess-allowlist.json entry points at a live unsafe call.

    Returns a list of orphan descriptors, one per stale entry.  Three categories:
      file-removed        — target file no longer exists
      line-shifted        — file exists but code snippet is not on the expected line
      refactored-to-safe  — code is on the line but check_subprocess_safety() no
                            longer classifies it as unsafe
    """
    allowlist_path = repo_root / ".subprocess-allowlist.json"
    if not allowlist_path.exists():
        return []

    # Let parse errors propagate — the caller in verify_artifacts() catches
    # them and reports [FAIL].  Swallowing here would be fail-open: a corrupt
    # allowlist silently passes verification.
    with open(allowlist_path, encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, dict):
        raise ValueError(
            f"top-level value must be an object, got {type(data).__name__}"
        )

    entries = data.get("entries")
    if not isinstance(entries, list):
        raise ValueError(f"'entries' must be a list, got {type(entries).__name__}")
    if not entries:
        return []

    # Cache per-file content and violations to avoid redundant I/O + scanning
    file_cache: dict[str, tuple[list[str], list[dict[str, str | int]]]] = {}
    orphans: list[dict[str, str | int]] = []

    for i, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise ValueError(
                f"entries[{i}] must be an object, got {type(entry).__name__}"
            )
        file_key = str(entry["file"])
        line_num = int(entry["line"])
        code_key = _normalize_allowlist_code(entry["code"])
        reason = str(entry.get("reason", ""))
        full_path = repo_root / file_key

        # Category 1: file removed
        if not full_path.exists():
            orphans.append(
                {
                    "file": file_key,
                    "line": line_num,
                    "code": code_key,
                    "reason": reason,
                    "category": "file-removed",
                }
            )
            continue

        # Load and cache file lines + violations
        if file_key not in file_cache:
            try:
                content = full_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                orphans.append(
                    {
                        "file": file_key,
                        "line": line_num,
                        "code": code_key,
                        "reason": reason,
                        "category": "file-removed",
                    }
                )
                continue
            file_cache[file_key] = (
                content.splitlines(),
                check_subprocess_safety(file_key, content),
            )

        lines, violations = file_cache[file_key]

        # Category 2: line shifted (code snippet not on expected line)
        if (
            line_num < 1
            or line_num > len(lines)
            or code_key not in lines[line_num - 1].strip()
        ):
            orphans.append(
                {
                    "file": file_key,
                    "line": line_num,
                    "code": code_key,
                    "reason": reason,
                    "category": "line-shifted",
                }
            )
            continue

        # Category 3: refactored to safe (code present but no matching violation)
        has_matching_violation = any(
            int(v["line"]) == line_num
            and _normalize_allowlist_code(v["code"]) == code_key
            for v in violations
        )
        if not has_matching_violation:
            orphans.append(
                {
                    "file": file_key,
                    "line": line_num,
                    "code": code_key,
                    "reason": reason,
                    "category": "refactored-to-safe",
                }
            )

    return orphans


def verify_artifacts(repo_root: Path) -> int:
    """Verify committed proof artifacts match current codebase (FR-020).

    Verification is exact for artifact metadata and semantic entry content,
    while tolerating line-number-only churn from formatting or nearby edits.
    Also verifies that every .subprocess-allowlist.json entry still corresponds
    to a live unsafe call site (issue #273).
    """
    exit_code = 0
    artifact_configs: list[tuple[str, Callable[[Path], dict[str, object]], str]] = [
        ("S603", generate_subprocess_artifact, "call_sites"),
        ("S311", generate_random_artifact, "usages"),
    ]
    for rule, generator, entries_key in artifact_configs:
        artifact_path = repo_root / f".rule-disable-audit-{rule}.json"
        if not artifact_path.exists():
            print(f"[FAIL] Missing proof artifact for {rule}: {artifact_path}")
            print(
                "  Run: python scripts/check_rule_disable_invariants.py "
                "--generate-artifacts"
            )
            exit_code = 1
            continue

        with open(artifact_path, encoding="utf-8") as f:
            committed = json.load(f)

        fresh = generator(repo_root)
        committed_raw = committed.get(entries_key, [])
        fresh_raw = fresh.get(entries_key, [])
        assert isinstance(committed_raw, list)
        assert isinstance(fresh_raw, list)
        committed_meta = {k: v for k, v in committed.items() if k != entries_key}
        fresh_meta = {k: v for k, v in fresh.items() if k != entries_key}
        committed_entries = _normalize_entries(committed_raw)
        fresh_entries = _normalize_entries(fresh_raw)

        if committed_meta != fresh_meta or committed_entries != fresh_entries:
            print(
                f"[FAIL] {rule} artifact stale: "
                f"committed={len(committed_raw)}, current={len(fresh_raw)}"
            )
            if committed_meta != fresh_meta:
                print("  Artifact metadata differs:")
                print(f"    committed: {committed_meta}")
                print(f"    current:   {fresh_meta}")
            if committed_entries != fresh_entries:
                print(
                    "  Comparison semantics: normalized semantic entries "
                    "(file, code, safety/purpose); line numbers are ignored."
                )
                missing_entries = sorted(set(committed_entries) - set(fresh_entries))
                extra_entries = sorted(set(fresh_entries) - set(committed_entries))
                if missing_entries:
                    print("  Missing normalized entries from regenerated artifact:")
                    for entry in missing_entries:
                        print(f"    {entry}")
                if extra_entries:
                    print("  Extra normalized entries in regenerated artifact:")
                    for entry in extra_entries:
                        print(f"    {entry}")
            print(
                "  Run: python scripts/check_rule_disable_invariants.py "
                "--generate-artifacts"
            )
            exit_code = 1
        else:
            print(
                f"[PASS] {rule} artifact matches codebase "
                f"({len(fresh_raw)} entries, semantic match)"
            )

    # Verify subprocess allowlist entries (issue #273).
    # verify_subprocess_allowlist_entries() intentionally does NOT swallow parse
    # errors — catch them here so a corrupt allowlist produces [FAIL], not a
    # traceback.  The entry-access path (KeyError/ValueError) is also caught so
    # malformed entries fail closed rather than crash.
    allowlist_path = repo_root / ".subprocess-allowlist.json"
    if allowlist_path.exists():
        try:
            orphans = verify_subprocess_allowlist_entries(repo_root)
        except (OSError, json.JSONDecodeError, KeyError, ValueError, TypeError) as exc:
            print(f"[FAIL] .subprocess-allowlist.json is malformed: {exc}")
            exit_code = 1
        else:
            if orphans:
                print(f"[FAIL] {len(orphans)} orphan(s) in .subprocess-allowlist.json:")
                for o in orphans:
                    print(f"  {o['file']}:{o['line']}: {o['category']}")
                    print(f"    code: {o['code']}")
                    print(f"    reason: {o['reason']}")
                print(
                    "  Run: python scripts/check_rule_disable_invariants.py "
                    "--regenerate-allowlist"
                )
                exit_code = 1
            else:
                with open(allowlist_path, encoding="utf-8") as f:
                    count = len(json.load(f).get("entries", []))
                print(
                    f"[PASS] Subprocess allowlist verified ({count} entries, all live)"
                )

    return exit_code


def auto_fix_subprocess_allowlist_line_shifts(
    repo_root: Path,
) -> list[tuple[str, int, int]]:
    """Best-effort auto-fix for legitimate line-shifts in the subprocess allowlist.

    Returns a list of ``(file, old_line, new_line)`` tuples for applied updates.
    Returns ``[]`` (empty list) when no safe updates could be applied — either
    nothing needed to change, or the source state cannot be unambiguously
    resolved to a pure line-shift.

    Safety contract (per the dev-ex audit constraints — see commit history):
      - Updates ONLY the ``line`` field of existing entries; ``file`` /
        ``code`` / ``reason`` are never touched.
      - Never adds entries — a NEW unallowlisted subprocess call must fail
        closed at the existing gate, not be auto-approved here.
      - Never removes entries — a refactored-away call site (no matching
        source violation) is left intact for explicit manual review via
        ``--regenerate-allowlist``.
      - Within a ``(file, normalized_code)`` bucket: only applies updates when
        ``len(entries) == len(violations)`` AND, after sorting both by line,
        every pairwise delta is identical.  Non-uniform deltas mean the
        relative ordering of call sites changed (or unrelated edits
        happened) — the resolution is ambiguous and the bucket is left
        unchanged.
      - After all bucket-level updates have been computed, the function
        re-validates that EVERY current source violation matches an updated
        entry by ``(file, line, normalized_code)``.  If any violation is
        unmatched (e.g. a new unallowlisted call elsewhere in the codebase),
        all in-memory changes are reverted and the function returns ``[]``
        — the caller's failure path stays intact.

    The ``reason`` field is NOT used in matching; it stays attached to its
    original entry by index.  The combination of "preserve entry order
    within bucket via sorted-by-line pairing" and "uniform-delta-only"
    means each entry keeps its original ``reason`` paired with the
    new line that corresponds to the same call site after the shift.
    """
    if not SUBPROCESS_ALLOWLIST_PATH.exists():
        return []

    with open(SUBPROCESS_ALLOWLIST_PATH, encoding="utf-8") as f:
        data = json.load(f)

    entries = data.get("entries", [])
    if not entries:
        return []

    # Snapshot original lines so we can revert on validation failure.
    original_lines: list[int] = [int(entry["line"]) for entry in entries]

    # Build current-source violations index by file -> list of violations.
    # Mirrors cmd_regenerate_allowlist's scan to keep matching logic
    # consistent (same check_subprocess_safety, same _normalize_allowlist_code).
    tracked = _get_tracked_py_files(repo_root)
    violations_by_file: dict[str, list[dict[str, str | int]]] = {}
    for file_path in tracked:
        if file_path in GUARDRAIL_EXCLUSIONS:
            continue
        full_path = repo_root / file_path
        if not full_path.exists():
            continue
        try:
            content = full_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        file_viols = check_subprocess_safety(file_path, content)
        if file_viols:
            violations_by_file[file_path] = file_viols

    # Group entries by (file, normalized_code), preserving entry indices so
    # we can mutate ``entries[i]`` directly.
    bucket_entries: dict[tuple[str, str], list[int]] = {}
    for i, entry in enumerate(entries):
        key = (str(entry["file"]), _normalize_allowlist_code(entry["code"]))
        bucket_entries.setdefault(key, []).append(i)

    # Group violations by (file, normalized_code).
    bucket_violations: dict[tuple[str, str], list[dict[str, str | int]]] = {}
    for file_path, file_viols in violations_by_file.items():
        for viol in file_viols:
            key = (file_path, _normalize_allowlist_code(viol["code"]))
            bucket_violations.setdefault(key, []).append(viol)

    # Process each bucket.
    updates: list[tuple[str, int, int]] = []
    for key, entry_indices in bucket_entries.items():
        viols = bucket_violations.get(key, [])
        if len(viols) != len(entry_indices):
            # Count mismatch: new call, removed call, or refactored shape
            # change.  Don't auto-fix — fall through to manual review path.
            continue
        if not viols:
            continue  # vacuously OK (both sides empty)
        # Pair entries to violations by sorted line order — preserves
        # within-bucket relative identity under uniform shifts.
        sorted_indices = sorted(entry_indices, key=lambda i: int(entries[i]["line"]))
        sorted_viols = sorted(viols, key=lambda v: int(v["line"]))
        deltas = [
            int(v["line"]) - int(entries[i]["line"])
            for i, v in zip(sorted_indices, sorted_viols, strict=True)
        ]
        if not all(d == deltas[0] for d in deltas):
            # Non-uniform delta — relative ordering or content changed.
            # Cannot safely auto-resolve; leave bucket unchanged.
            continue
        if deltas[0] == 0:
            # Already aligned — nothing to update.
            continue
        # Apply updates.
        for i, v in zip(sorted_indices, sorted_viols, strict=True):
            old_line = int(entries[i]["line"])
            new_line = int(v["line"])
            entries[i]["line"] = new_line
            updates.append((str(entries[i]["file"]), old_line, new_line))

    if not updates:
        return []

    # Validate: every current source violation must now match an updated
    # entry.  If a violation is unmatched (unallowlisted new call elsewhere),
    # the auto-fix would mask the real failure — revert and bail.
    updated_allowlist = {
        (
            str(entry["file"]),
            int(entry["line"]),
            _normalize_allowlist_code(entry["code"]),
        )
        for entry in entries
    }
    all_violations: list[dict[str, str | int]] = []
    for file_viols in violations_by_file.values():
        all_violations.extend(file_viols)
    unmatched = [
        v
        for v in all_violations
        if (
            str(v["file"]),
            int(v["line"]),
            _normalize_allowlist_code(v["code"]),
        )
        not in updated_allowlist
    ]
    if unmatched:
        for i, original_line in enumerate(original_lines):
            entries[i]["line"] = original_line
        return []

    # Write the updated allowlist.  newline="\n" (matches the existing
    # cmd_regenerate_allowlist writer) so this auto-fix is byte-stable on
    # Windows / Linux / macOS.
    with open(SUBPROCESS_ALLOWLIST_PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    return updates


def cmd_regenerate_allowlist(repo_root: Path) -> int:
    """Update allowlist line numbers after formatter-induced shifts.

    For each allowlist entry, scans the codebase for non-literal subprocess
    violations matching (file, code). If exactly one match is found, updates
    the line number. If multiple matches exist for the same (file, code),
    fails and requires manual review — the entry is ambiguous.

    Uses the same check_subprocess_safety() function as the enforcement path
    to ensure consistent matching logic.
    """
    if not SUBPROCESS_ALLOWLIST_PATH.exists():
        print("[ERROR] No allowlist file found.", file=sys.stderr)
        return 1

    with open(SUBPROCESS_ALLOWLIST_PATH, encoding="utf-8") as f:
        data = json.load(f)

    entries = data.get("entries", [])
    if not entries:
        print("[PASS] Allowlist is empty — nothing to regenerate.")
        return 0

    # Scan the codebase for all non-literal subprocess violations
    tracked = _get_tracked_py_files(repo_root)
    violations_by_file: dict[str, list[dict[str, str | int]]] = {}
    for file_path in tracked:
        if file_path in GUARDRAIL_EXCLUSIONS:
            continue
        full_path = repo_root / file_path
        if not full_path.exists():
            continue
        try:
            content = full_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        file_violations = check_subprocess_safety(file_path, content)
        if file_violations:
            violations_by_file[file_path] = file_violations

    updated = 0
    ambiguous = 0
    removed = 0
    exit_code = 0

    # Accumulator pattern (issue #274): entries_out collects only the entries
    # that belong in the regenerated file. Orphans are intentionally never
    # appended so they get pruned on write. The ambiguous branch also does
    # not append — combined with the write-branch-scoped data["entries"]
    # assignment below, this defends against any future refactor that might
    # remove the outer "if ambiguous: skip write" guard.
    entries_out: list[dict[str, str | int]] = []

    for entry in entries:
        file_key = entry["file"]
        code_key = _normalize_allowlist_code(entry["code"])

        # Find violations in this file matching this code snippet. Both sides
        # of the comparison MUST funnel through _normalize_allowlist_code so
        # whitespace-variant entries cannot be misclassified as orphans.
        file_viols = violations_by_file.get(file_key, [])
        matches = [
            v for v in file_viols if _normalize_allowlist_code(v["code"]) == code_key
        ]

        old_line = entry.get("line", 0)

        if len(matches) == 0:
            # Entry no longer matches any violation — drop from entries_out.
            print(f"  [REMOVED] {file_key}:{old_line}: no matching violation")
            removed += 1
            continue

        if len(matches) == 1:
            new_line = int(matches[0]["line"])
            if new_line != old_line:
                entry["line"] = new_line
                print(f"  [UPDATED] {file_key}:{old_line} -> {new_line}")
                updated += 1
            entries_out.append(entry)
            continue

        # Multiple violations with same (file, code).
        # Check if the current line number still matches one of them.
        if any(int(m["line"]) == old_line for m in matches):
            # Current line is still valid — preserve as-is.
            entries_out.append(entry)
            continue

        # Line shifted but we can't determine which match is right.
        # Intentionally NOT appended to entries_out: the outer skip-write
        # guard keeps the file untouched today, and this leaves no path
        # for a future refactor to silently write stale data.
        print(
            f"  [AMBIGUOUS] {file_key}:{old_line}: {len(matches)} violations "
            f"match '{code_key[:60]}' — manual review required"
        )
        for m in matches:
            print(f"    line {m['line']}: {str(m['code'])[:80]}")
        ambiguous += 1
        exit_code = 1

    if ambiguous:
        print(
            f"\n[FAIL] {ambiguous} ambiguous entries require manual review. "
            "Split them into entries with unique code snippets."
        )
    else:
        # Only mutate data["entries"] on the write path so the ambiguous
        # branch cannot accidentally leave entries_out dangling in data.
        data["entries"] = entries_out
        with open(SUBPROCESS_ALLOWLIST_PATH, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(
            f"\n[PASS] Allowlist regenerated: {updated} updated, "
            f"{removed} no longer matching, {ambiguous} ambiguous."
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
        "--check-syspath",
        action="store_true",
        help="Check for sys.path.insert/append (importlib-only enforcement)",
    )
    parser.add_argument(
        "--verify-artifacts",
        action="store_true",
        help="Verify proof artifacts and subprocess allowlist match codebase",
    )
    parser.add_argument(
        "--generate-artifacts",
        action="store_true",
        help="Generate proof artifacts for rule-disable justification",
    )
    parser.add_argument(
        "--regenerate-allowlist",
        action="store_true",
        help="Update allowlist line numbers after formatter-induced shifts",
    )
    parser.add_argument(
        "--auto-fix-line-shifts",
        action="store_true",
        help=(
            "Best-effort: only update line numbers for unambiguous uniform "
            "shifts within each (file, code) bucket; never add, remove, or "
            "touch reason/code.  Falls through (no-op) on count mismatch, "
            "non-uniform shift, or unmatched residual violations."
        ),
    )

    args = parser.parse_args()
    repo_root = REPO_ROOT
    exit_code = 0

    if args.regenerate_allowlist:
        return cmd_regenerate_allowlist(repo_root)

    if args.auto_fix_line_shifts:
        updates = auto_fix_subprocess_allowlist_line_shifts(repo_root)
        if updates:
            for file_path, old_line, new_line in updates:
                print(f"[AUTO-FIX] {file_path}:{old_line} -> {new_line}")
            print(f"[PASS] {len(updates)} line-shift(s) applied.")
        else:
            print("[PASS] No line-shift updates applied (none safe / none needed).")
        return 0

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

    if args.check_subprocess or args.check_random or args.check_syspath:
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
            if args.check_syspath:
                all_violations.extend(check_syspath_safety(file_path, content))

        # Filter out allowlisted subprocess exceptions by (file, line, code)
        # Only subprocess-related violations are filtered, not random ones
        subprocess_allowlist = _load_subprocess_allowlist()
        if subprocess_allowlist:
            subprocess_patterns = {
                "subprocess with non-literal command",
                "shell=True",
                "os.system/popen",
            }
            all_violations = [
                v
                for v in all_violations
                if v["pattern"] not in subprocess_patterns
                or not _match_allowlist(v, subprocess_allowlist)
            ]

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
            if args.check_syspath:
                checks.append("syspath")
            print(f"[PASS] No unsafe {'/'.join(checks)} patterns detected")

    if not any(
        [
            args.check_subprocess,
            args.check_random,
            args.check_syspath,
            args.verify_artifacts,
            args.generate_artifacts,
        ]
    ):
        parser.print_help()
        return 1

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
