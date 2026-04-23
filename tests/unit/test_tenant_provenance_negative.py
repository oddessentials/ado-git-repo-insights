"""Guard invariant: only `scripts/strip_pr_arrays.py` may define the sentinel literal.

Feature 309 (`309-demo-pr-drilldown`), slice 2b. Enforces contract
`specs/309-demo-pr-drilldown/contracts/synthetic-authorization-signal.md` §2:
the string `.synthetic-prs-authorized` must appear in exactly one committed
file under `src/` or `scripts/` — the constant-definition site. Every other
file MUST import the name instead of re-inventing the literal, so the demo
orchestrator remains the single authorized writer and the constant stays
single-sourced.

Enforcement surfaces:
    * Real-repo check: runs ``git ls-files --cached src/ scripts/`` and
      greps each tracked file for the literal, failing on any site other
      than the allowlisted constant-definition file.
    * Negative-fixture check: constructs a synthetic file under tmp_path
      with the literal and asserts the grep helper reports it — proving
      the detection surface catches violations without mutating the real
      index.

Cross-OS (QG-39): pathlib + UTF-8; no shell. `git ls-files` is cross-platform.
Typing  (QG-40): full annotations; no `typing.Any`.
"""

from __future__ import annotations

import subprocess
from collections.abc import Iterable
from pathlib import Path
from typing import Final

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]

SENTINEL_LITERAL: Final[str] = ".synthetic-prs-authorized"
"""The sentinel string. Must not appear outside the allowlisted file below."""

ALLOWED_CONSTANT_FILE: Final[Path] = REPO_ROOT / "scripts" / "strip_pr_arrays.py"
"""Single source of truth for the sentinel name constant (contract §2)."""


def _cached_files(prefixes: Iterable[str]) -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", *prefixes],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    return [REPO_ROOT / Path(line) for line in result.stdout.splitlines() if line]


def _violators(paths: Iterable[Path]) -> list[Path]:
    """Return paths whose contents contain the sentinel literal outside the allowlist."""
    allowed = ALLOWED_CONSTANT_FILE.resolve()
    found: list[Path] = []
    for path in paths:
        if not path.exists():
            continue
        if path.resolve() == allowed:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if SENTINEL_LITERAL in text:
            found.append(path)
    return found


def test_sentinel_literal_only_appears_in_allowlisted_constant_file() -> None:
    tracked = _cached_files(["src/", "scripts/"])
    leaked = _violators(tracked)
    assert leaked == [], (
        f"Sentinel literal {SENTINEL_LITERAL!r} leaked outside "
        f"{ALLOWED_CONSTANT_FILE.relative_to(REPO_ROOT).as_posix()}: "
        f"{[p.relative_to(REPO_ROOT).as_posix() for p in leaked]}. "
        "Import SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME from strip_pr_arrays "
        "rather than re-writing the literal."
    )


def test_violator_detection_catches_synthetic_leak(tmp_path: Path) -> None:
    leak_file = tmp_path / "src" / "leak.py"
    leak_file.parent.mkdir(parents=True)
    leak_file.write_text(
        f'SOME_CONSTANT = "{SENTINEL_LITERAL}"\n',
        encoding="utf-8",
    )
    detected = _violators([leak_file])
    assert detected == [leak_file], (
        f"Detection helper failed to flag synthetic violator {leak_file}; "
        "the real-repo gate would pass vacuously on this failure mode."
    )
