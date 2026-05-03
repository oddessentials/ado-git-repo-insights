"""Static structural invariant for the variant-off tenant artifact.

Producer post-#362 (``scripts/generate-demo-data.py:3067-3079``) emits the
per-(reviewer, week) PR trio (``prs`` / ``_prs_truncated`` / ``_prs_cap``)
under every ``by_reviewer[*]`` entry whose ``reviewed_prs > 0``.  The
variant-off tenant artifact at
``artifacts/demo-enterprise-comments-off/data/aggregates/weekly_rollups/``
is tracked, never passes through ``promote_data``, and therefore must
always carry the producer-emitted depth-2 trio.

Without this invariant, a producer-side change to the nested emission
shape (e.g. #362's depth-2 addition, or a future modification) goes
silently unnoticed until someone notices a fresh canonical build dirty
the variant-off tree — exactly the harness gap that prompted the manual
artifact split this branch dealt with.

The check is structural-only (no producer rerun, no subprocess), so it
runs in milliseconds and fits the targeted-gate discipline of
``D / E / F`` harness commits.

Cross-OS (QG-39): pathlib + UTF-8 only; no shell.  Identical assertions
on Windows / Linux / macOS.

Typing (QG-40): full annotations; no ``typing.Any``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Final

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
VARIANT_OFF_ROLLUPS: Final[Path] = (
    REPO_ROOT
    / "artifacts"
    / "demo-enterprise-comments-off"
    / "data"
    / "aggregates"
    / "weekly_rollups"
)
NESTED_PR_TRIO: Final[tuple[str, str, str]] = ("prs", "_prs_truncated", "_prs_cap")


def find_stale_reviewer_entries(
    payload: dict[str, object], *, source: str
) -> list[str]:
    """Return human-readable invariant violations (empty list = passes).

    Each ``by_reviewer[*]`` entry with ``reviewed_prs > 0`` MUST have all
    three keys in :data:`NESTED_PR_TRIO`.  An entry with ``reviewed_prs
    == 0`` or with no ``by_reviewer`` map is vacuously OK — the producer
    only emits the trio when it has data to emit.
    """
    violations: list[str] = []
    by_reviewer = payload.get("by_reviewer")
    if not isinstance(by_reviewer, dict):
        return violations
    for reviewer_id, entry in by_reviewer.items():
        if not isinstance(entry, dict):
            continue
        reviewed_prs = entry.get("reviewed_prs", 0)
        if not isinstance(reviewed_prs, int) or reviewed_prs <= 0:
            continue
        for key in NESTED_PR_TRIO:
            if key not in entry:
                violations.append(
                    f"{source}: by_reviewer[{reviewer_id}] has "
                    f"reviewed_prs={reviewed_prs} but missing {key!r}"
                )
    return violations


def test_committed_variant_off_artifact_has_fresh_nested_pr_trio() -> None:
    """Every committed variant-off rollup must carry the producer's depth-2 trio.

    Failure means the tracked tenant artifact is stale relative to the
    producer at HEAD.  Fix per the harness contract: regenerate via the
    canonical build (``python scripts/build-demo-dataset.py``) and commit
    the intentional artifact delta — never edit JSON manually.
    """
    files = sorted(VARIANT_OFF_ROLLUPS.glob("*.json"))
    assert files, (
        f"no committed rollups under {VARIANT_OFF_ROLLUPS}; "
        "the variant-off artifact tree is missing or path drifted"
    )

    all_violations: list[str] = []
    for path in files:
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert isinstance(payload, dict), (
            f"committed rollup is not a JSON object: {path.name}"
        )
        all_violations.extend(find_stale_reviewer_entries(payload, source=path.name))

    assert not all_violations, (
        f"variant-off tenant artifact is stale relative to producer at HEAD "
        f"({len(all_violations)} invariant violation(s)).  Regenerate via:\n"
        f"  python scripts/build-demo-dataset.py\n"
        f"and commit the intentional delta.  First 5 violations:\n  "
        + "\n  ".join(all_violations[:5])
    )


def test_invariant_rejects_synthetic_stale_payload() -> None:
    """Regression lock against the invariant drifting to no-op.

    Builds a synthetic stale payload (``by_reviewer[reviewer-1]`` with
    ``reviewed_prs > 0`` but no nested trio) and asserts the helper
    returns one violation per missing trio key.  If the helper ever
    drifts to "always returns []" the regression is caught here, not
    silently.
    """
    stale_payload: dict[str, object] = {
        "week": "2025-W10",
        "pr_count": 2,
        "by_reviewer": {
            "reviewer-1": {
                "reviews_count": 2,
                "reviewed_prs": 2,
                "approval_rate": 1.0,
                # NESTED_PR_TRIO intentionally absent — stale shape.
            },
        },
    }
    violations = find_stale_reviewer_entries(stale_payload, source="<test>")
    assert len(violations) == 3, (
        f"expected one violation per missing key in NESTED_PR_TRIO, "
        f"got {len(violations)}: {violations}"
    )
    # Each violation must reference a different missing key — locks the
    # helper against collapsing the per-key reporting.
    referenced_keys = {
        key for key in NESTED_PR_TRIO if any(key in v for v in violations)
    }
    assert referenced_keys == set(NESTED_PR_TRIO), (
        f"violations did not reference every NESTED_PR_TRIO key; "
        f"referenced={referenced_keys}, expected={set(NESTED_PR_TRIO)}"
    )


def test_invariant_passes_for_fresh_synthetic_payload() -> None:
    """Positive control: a synthetic fresh payload (with the trio) must pass.

    Mirror of the stale test: builds a payload with all three keys
    present and asserts the helper returns no violations.  This pins the
    helper's positive direction so a future change to "always return one
    violation" or similar would also be caught.
    """
    fresh_payload: dict[str, object] = {
        "week": "2025-W10",
        "pr_count": 2,
        "by_reviewer": {
            "reviewer-1": {
                "reviews_count": 2,
                "reviewed_prs": 2,
                "approval_rate": 1.0,
                "prs": [],
                "_prs_truncated": False,
                "_prs_cap": 500,
            },
        },
    }
    violations = find_stale_reviewer_entries(fresh_payload, source="<test>")
    assert violations == [], (
        f"expected no violations for fresh payload; got {violations}"
    )
