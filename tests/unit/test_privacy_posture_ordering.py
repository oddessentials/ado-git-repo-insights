"""FR-014: privacy-posture ordering gate for PR-level detail (feature 060).

Enforces that the public-surface stripping rules are documented in
``docs/reference/dataset-contract.md`` **before** any producer code emits
``prs`` / ``_prs_truncated`` / ``_prs_cap`` into rollup outputs.

If producer code lands without the privacy-posture anchor present in the
dataset contract, this test fails at pre-commit / CI — blocking the merge
until the contract documents the strip rule.

The anchor string is deliberately stable and machine-greppable. Do not
rename it without updating both the contract doc and this test in the
same commit.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Final

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
CONTRACT_DOC: Final[Path] = REPO_ROOT / "docs" / "reference" / "dataset-contract.md"
AGGREGATORS_PY: Final[Path] = (
    REPO_ROOT / "src" / "ado_git_repo_insights" / "transform" / "aggregators.py"
)
TYPES_PY: Final[Path] = REPO_ROOT / "src" / "ado_git_repo_insights" / "types.py"

PRIVACY_POSTURE_ANCHOR: Final[str] = (
    "<!-- anchor: privacy-posture-tenant-sensitive-fields -->"
)

_AGGREGATOR_PRS_EMISSION_RE: Final[re.Pattern[str]] = re.compile(r'"prs"\s*:')
_TYPES_PR_RECORD_CLASS_RE: Final[re.Pattern[str]] = re.compile(r"\bclass\s+PrRecord\b")
_TYPES_PR_RECORD_FUNCTIONAL_RE: Final[re.Pattern[str]] = re.compile(
    r"\bPrRecord\s*=\s*TypedDict\b"
)


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def _has_producer_code() -> bool:
    """Return True when aggregator emits ``prs`` or ``types.py`` defines ``PrRecord``."""
    aggregator_text = _read_text(AGGREGATORS_PY)
    types_text = _read_text(TYPES_PY)
    return bool(
        _AGGREGATOR_PRS_EMISSION_RE.search(aggregator_text)
        or _TYPES_PR_RECORD_CLASS_RE.search(types_text)
        or _TYPES_PR_RECORD_FUNCTIONAL_RE.search(types_text)
    )


def _has_privacy_anchor() -> bool:
    return PRIVACY_POSTURE_ANCHOR in _read_text(CONTRACT_DOC)


def test_privacy_posture_doc_lands_before_producer_code() -> None:
    """FR-014 ordering gate: producer code without privacy anchor MUST fail."""
    producer_present = _has_producer_code()
    anchor_present = _has_privacy_anchor()
    if producer_present:
        assert anchor_present, (
            "FR-014 violation: aggregator 'prs' emission or PrRecord TypedDict "
            "is present in the worktree, but the privacy-posture anchor "
            f"({PRIVACY_POSTURE_ANCHOR!r}) is absent from "
            f"{CONTRACT_DOC.relative_to(REPO_ROOT)}. Land the "
            "'Tenant-Sensitive Fields and Public-Surface Stripping' section "
            "in the dataset contract first (feature 060, FR-014)."
        )
