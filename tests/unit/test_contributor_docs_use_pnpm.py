"""Contributor-facing workflow docs must invoke pnpm, not npm.

The repo pins ``pnpm`` as the canonical package manager via the
``packageManager`` field in ``package.json`` and enforces a
no-``npm ci``/``npm install`` policy at pre-commit/CI for workflow and
script files (``scripts.run_repo_hook.run_npm_command_guard``). The
workflow-file guard intentionally does not scan markdown, so docs that
teach which commands to run can drift out of compliance silently — which
is exactly what happened when the legacy ``extension/COVERAGE_RATCHET.md``
verification block (pre-ratchets.md consolidation) kept
``npm test -- --coverage`` lines that predated the pnpm pin.

This test is the codified version of the lesson: contributor-facing
workflow docs must not instruct contributors to run npm commands that
the rest of the toolchain rejects. Lock the subset of docs that teach
the ratchet/test/coverage workflow; widening the scope later is a
deliberate choice, not an accident.
"""

from __future__ import annotations

import re
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# Docs that teach contributor workflow for ratchets, tests, coverage, and
# contribution procedure. Expanding this list is a policy decision, not a
# mechanical one — when adding a new contributor-facing doc with workflow
# commands, append its path here explicitly.
_LOCKED_DOCS: tuple[Path, ...] = (
    _REPO_ROOT / "CONTRIBUTING.md",
    _REPO_ROOT / "docs" / "development" / "ratchets.md",
    _REPO_ROOT / "docs" / "development" / "testing.md",
)

# Forbid the `npm` verbs that have a `pnpm` equivalent in this repo's
# toolchain. `npm install -g tfx-cli` stays allowlisted because it is
# the documented installer for a task-only tool and the existing
# workflow-file guard uses the same carve-out
# (scripts/run_repo_hook.py::run_npm_command_guard).
_FORBIDDEN_NPM = re.compile(r"\bnpm\s+(?:ci|install|test|run|exec)\b")
_ALLOWLIST = re.compile(r"npm install -g tfx-cli")


def test_contributor_docs_use_pnpm_not_npm() -> None:
    """Flag any `npm <subcommand>` invocation in locked contributor docs.

    The allowlist is applied as a *substring scrub*, not a whole-line
    exemption. A line like ``npm install -g tfx-cli && npm test`` would
    otherwise bypass the forbidden-pattern check entirely: the allowlist
    matches the ``npm install -g tfx-cli`` token and a whole-line
    ``continue`` would accept the trailing ``npm test`` without inspection.
    Removing every allowlisted occurrence from the line first, then
    scanning the residual, preserves the carve-out for the sanctioned
    tfx-cli installer without creating an easy bypass for mixed lines.
    """
    offenders: list[str] = []
    for doc in _LOCKED_DOCS:
        assert doc.exists(), f"locked doc missing: {doc.relative_to(_REPO_ROOT)}"
        text = doc.read_text(encoding="utf-8")
        for line_no, line in enumerate(text.splitlines(), start=1):
            residual = _ALLOWLIST.sub("", line)
            if _FORBIDDEN_NPM.search(residual):
                rel = doc.relative_to(_REPO_ROOT).as_posix()
                offenders.append(f"  {rel}:{line_no}: {line.strip()}")
    assert not offenders, (
        "Contributor docs must use pnpm for workflow commands.\n"
        "This repo pins pnpm via packageManager in package.json and the\n"
        "workflow-file guard (scripts/run_repo_hook.py::run_npm_command_guard)\n"
        "rejects `npm ci` / `npm install` in .github/workflows/ and scripts/.\n"
        "Docs that teach contributors to run `npm test` / `npm run` / `npm exec`\n"
        "ship a copy-paste that the rest of the toolchain refuses.\n\n"
        "Offending lines:\n" + "\n".join(offenders)
    )
