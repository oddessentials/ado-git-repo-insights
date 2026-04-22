#!/usr/bin/env python3
"""PrRecord cross-surface schema parity gate (Feature 310 scaffolding).

STUB — Phase 1 scaffolding only. The four PrRecord schema surfaces
(Python TypedDict, TypeScript interface, `PR_RECORD_REQUIRED_FIELDS`
array, and the 310 sibling contract §1 table) will be parsed and
cross-checked by the body landed in T011 (Phase 2). This stub exists
so every QG-49 entry point (pre-commit, pre-push preflight, CI step,
`pnpm test:ci`) can be wired in Phase 1 against a no-op command that
returns 0 cleanly on every OS.

Contract: ``specs/310-comments-visualization/contracts/schema-parity-gate.md``.

Usage (identical across all four entry points per QG-49):

    python scripts/check_pr_record_schema_parity.py

Exit status: ``0`` — parity held / stub no-op.
               non-zero — drift detected (body pending T011).

Cross-OS: no OS-specific constructs; argparse + pathlib + sys only.
"""

from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    """Entry point. Phase 1 stub — returns 0 unconditionally.

    Phase 2 (T011) replaces the body with:
      1. Parse ``src/ado_git_repo_insights/types.py`` via ``ast``.
      2. Parse ``extension/ui/schemas/rollup.schema.ts`` via Python regex
         against tightly-locked source shapes (Python-only; no node /
         TypeScript runtime dependency — stays green in the Python test
         matrix under ``pre-commit run --all-files``).
      3. Parse the ``## §1 Canonical field declaration`` section in
         ``specs/310-comments-visualization/contracts/pr-record-comments-fields.md``.
      4. Assert identical field-name set + presence-specific type parity
         across all four surfaces per ``contracts/schema-parity-gate.md``.
    """
    parser = argparse.ArgumentParser(
        description=(
            "PrRecord cross-surface schema parity gate "
            "(Phase 1 stub — body pending T011)."
        ),
    )
    # No arguments accepted yet. argparse still raises SystemExit(2) on
    # unknown flags so callers that pass options before T011 lands see a
    # clear error instead of a silent pass.
    parser.parse_args(argv)
    return 0


if __name__ == "__main__":
    sys.exit(main())
