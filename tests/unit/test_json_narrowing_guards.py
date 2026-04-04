"""CI guards: enforce JSONValue narrowing discipline in caller scripts.

Guard 1: No direct chained access from load_json_file() — callers must
          narrow before accessing .get() or subscripting.

Guard 2: No raw isinstance(x, dict) narrowing in caller scripts — must
          use the shared narrow_mapping/narrow_sequence helpers to avoid
          the implicit dict[str, Any] that raw isinstance produces.

These guards are scoped to the 3 known caller scripts that consume
load_json_file output.  The helper module (demo_generation_common) and
validation code (fail-fast loops with explicit TypeError) are exempt.
"""

from __future__ import annotations

import re
import tokenize
from io import BytesIO
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"

# Scripts that consume load_json_file and must use narrowing discipline
CALLER_SCRIPTS = [
    SCRIPTS_DIR / "build-demo-dataset.py",
    SCRIPTS_DIR / "generate-demo-insights.py",
    SCRIPTS_DIR / "generate-demo-predictions.py",
]

# The helper module is exempt — it defines the narrowing functions
HELPER_MODULE = SCRIPTS_DIR / "demo_generation_common.py"


def _get_code_lines(path: Path) -> list[tuple[int, str]]:
    """Return (line_number, line_text) excluding comments and docstrings."""
    content = path.read_bytes()
    try:
        tokens = list(tokenize.tokenize(BytesIO(content).readline))
    except tokenize.TokenError:
        return []

    # Collect line numbers that are inside docstrings or comments
    skip_lines: set[int] = set()
    for tok in tokens:
        if tok.type == tokenize.COMMENT:
            skip_lines.add(tok.start[0])
        if tok.type == tokenize.STRING and tok.string.startswith(('"""', "'''")):
            for ln in range(tok.start[0], tok.end[0] + 1):
                skip_lines.add(ln)

    lines = content.decode("utf-8", errors="replace").splitlines()
    return [(i + 1, line) for i, line in enumerate(lines) if (i + 1) not in skip_lines]


# -----------------------------------------------------------------------
# Guard 1: No direct chained access from load_json_file()
# -----------------------------------------------------------------------

# Matches load_json_file(...).get( or load_json_file(...)[
_CHAINED_ACCESS = re.compile(r"load_json_file\s*\([^)]*\)\s*(\.\s*get\s*\(|\[)")


class TestNoDirectChainedJsonAccess:
    """load_json_file() returns dict[str, JSONValue] — callers must narrow first."""

    def test_no_chained_get_or_subscript_on_load_json_file(self) -> None:
        violations: list[str] = []
        for script in CALLER_SCRIPTS:
            for line_num, line in _get_code_lines(script):
                if _CHAINED_ACCESS.search(line):
                    violations.append(f"  {script.name}:{line_num}: {line.strip()}")

        assert not violations, (
            "Direct chained access on load_json_file() bypasses narrowing.\n"
            "Assign the result to a variable first, then narrow with "
            "narrow_mapping() before accessing nested values.\n" + "\n".join(violations)
        )


# -----------------------------------------------------------------------
# Guard 2: No raw isinstance(x, dict) narrowing in caller scripts
# -----------------------------------------------------------------------

# Matches isinstance(something, dict) — the raw narrowing pattern
_RAW_ISINSTANCE_DICT = re.compile(r"isinstance\s*\([^,]+,\s*dict\s*\)")

# Patterns that are EXEMPT from the guard:
# - Fail-fast validation: isinstance check followed by raise (any exception type)
# - The narrowing helpers themselves (in demo_generation_common.py)
_VALIDATION_RAISE = re.compile(r"raise\s+\w+Error")


class TestNoRawIsinstanceDictNarrowing:
    """Raw isinstance(x, dict) leaks implicit Any — use narrow_mapping() instead."""

    def test_no_raw_isinstance_dict_in_caller_scripts(self) -> None:
        violations: list[str] = []
        for script in CALLER_SCRIPTS:
            code_lines = _get_code_lines(script)
            for idx, (line_num, line) in enumerate(code_lines):
                if not _RAW_ISINSTANCE_DICT.search(line):
                    continue

                # Exempt: fail-fast validation patterns (isinstance + raise TypeError)
                # Check the next 3 lines for a raise
                is_validation = False
                for lookahead in range(1, 4):
                    if idx + lookahead < len(code_lines):
                        _, next_line = code_lines[idx + lookahead]
                        if _VALIDATION_RAISE.search(next_line):
                            is_validation = True
                            break

                if is_validation:
                    continue

                violations.append(f"  {script.name}:{line_num}: {line.strip()}")

        assert not violations, (
            "Raw isinstance(x, dict) narrows to dict[str, Any] in mypy, "
            "leaking implicit Any.\n"
            "Use narrow_mapping(val) from demo_generation_common instead, "
            "or convert to a fail-fast validation (isinstance + raise TypeError).\n"
            + "\n".join(violations)
        )
