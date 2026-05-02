"""Strip PR-level detail fields from weekly-rollup JSON before public publish.

Feature 060 (FR-023) public-surface strip gate. This helper is flow-neutral:
given a directory, it either leaves every rollup JSON free of the three
tenant-sensitive PR-level fields — ``prs``, ``_prs_truncated``, ``_prs_cap``
— or it raises :class:`PrArrayResidueError`. Flow safety comes from WHERE
the helper is invoked (as the first step inside ``promote_data`` in
``scripts/build-demo-dataset.py``), NOT from anything this helper does.

Contract: ``specs/060-throughput-pr-drilldown/contracts/demo-strip-gate.md``.

Cross-OS (QG-39): ``pathlib`` only, no shell tools. UTF-8 explicit.
Typing (QG-40): full annotations, no ``typing.Any``.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

logger = logging.getLogger(__name__)

PR_LEVEL_FIELDS: Final[tuple[str, str, str]] = ("prs", "_prs_truncated", "_prs_cap")
"""Top-level rollup keys covered by the FR-023 privacy posture."""

ROLLUPS_GLOB: Final[str] = "weekly_rollups/*.json"
"""Glob relative to ``rollup_dir``; matches every weekly rollup artifact."""

SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME: Final[str] = ".synthetic-prs-authorized"
"""Sentinel-file basename for feature-309's provenance-based binary gate.

The single-source-of-truth for the sentinel name. Lives here (not in
``scripts/build-demo-dataset.py``) because that orchestrator is hyphenated
and cannot be imported by other modules. Contract:
``specs/309-demo-pr-drilldown/contracts/synthetic-authorization-signal.md``.
"""


class PrArrayResidueError(RuntimeError):
    """Raised if any rollup retains a PR-level field after strip-and-re-verify."""


@dataclass(frozen=True)
class StripReport:
    """Informational summary of a strip pass. Callers MUST NOT branch on this.

    The raise-on-residue behavior in :func:`strip_pr_arrays_from_rollups` is
    the authoritative gate; this report is telemetry for the build log only.
    """

    files_scanned: int = 0
    files_modified: int = 0
    fields_removed: dict[str, int] = field(
        default_factory=lambda: dict.fromkeys(PR_LEVEL_FIELDS, 0)
    )


def _load_rollup(path: Path) -> dict[str, object]:
    """Read a weekly-rollup JSON file. Assumes the artifact is a JSON object."""
    with path.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    if not isinstance(payload, dict):
        raise PrArrayResidueError(
            f"Rollup JSON is not an object: {path}. Strip gate expects the "
            "producer to emit a top-level object per the rollup schema."
        )
    return payload


def _write_rollup(path: Path, payload: dict[str, object]) -> None:
    """Rewrite the rollup JSON with the stripped payload.

    Matches the aggregator's byte-shape convention (``json.dump(..., indent=2,
    ensure_ascii=False)``) so demo artifacts remain byte-stable across strip
    and non-strip paths.

    Uses ``Path.write_bytes`` (not text-mode ``open(..., "w")``) so the post-
    strip file is byte-identical across operating systems.  Text-mode writes
    on Windows apply ``\\n`` → ``\\r\\n`` translation, which silently re-
    dirties every rollup ``promote_data`` touches and breaks the "no-op
    canonical build is quiet" contract.  The canonical generator writer in
    ``scripts/demo_generation_common.py::write_json_file`` uses the same
    bytes-mode pattern; this helper mirrors it so a freshly-built source
    that flows through ``copytree`` into ``docs/data/`` lands LF-only on
    every OS.
    """
    encoded = json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=False).encode(
        "utf-8"
    )
    path.write_bytes(encoded + b"\n")


def _strip_one(path: Path, fields_removed: dict[str, int]) -> bool:
    """Remove PR-level fields from a single rollup. Returns True if modified.

    Walks two depths to cover the full PR-level surface introduced across
    Features 060 and 362:

    1. Rollup root (depth 0) — the original Feature 060 surface.  Removes
       the trio (``prs`` / ``_prs_truncated`` / ``_prs_cap``) when present.
    2. Per-(reviewer, week) entries under ``by_reviewer[*]`` (depth 2) —
       the Feature 362 surface (FR-028).  The contract is name-based, not
       depth-based; ``PR_LEVEL_FIELDS`` is reused unchanged because the
       same three field names cover both emission sites.

    The two-site visitor is preferred over a generic recursive walker
    because the producer emits ``prs`` at exactly two well-known depths,
    and a targeted visitor is more auditable (PR review-friendly).
    """
    payload = _load_rollup(path)
    modified = False
    # Depth 0 — Feature 060 rollup-root strip (preserved unchanged).
    for key in PR_LEVEL_FIELDS:
        if key in payload:
            payload.pop(key, None)
            fields_removed[key] += 1
            modified = True
    # Depth 2 — Feature 362 per-(reviewer, week) strip (FR-028).
    by_reviewer = payload.get("by_reviewer")
    if isinstance(by_reviewer, dict):
        for reviewer_entry in by_reviewer.values():
            if not isinstance(reviewer_entry, dict):
                continue
            for key in PR_LEVEL_FIELDS:
                if key in reviewer_entry:
                    reviewer_entry.pop(key, None)
                    fields_removed[key] += 1
                    modified = True
    if modified:
        _write_rollup(path, payload)
    return modified


def _verify_clean(path: Path) -> list[str]:
    """Return the PR-level field names that are still present in ``path``.

    Mirror of :func:`_strip_one`'s coverage: walks the rollup root AND
    every ``by_reviewer[*]`` entry, returning a list of human-readable
    residue paths so a Feature-362 leak (e.g., ``by_reviewer[user-id].prs``)
    surfaces with a path identifying the offending bucket, not just the
    field name.
    """
    payload = _load_rollup(path)
    remaining: list[str] = []
    # Depth 0 — Feature 060.
    for key in PR_LEVEL_FIELDS:
        if key in payload:
            remaining.append(key)
    # Depth 2 — Feature 362.
    by_reviewer = payload.get("by_reviewer")
    if isinstance(by_reviewer, dict):
        for reviewer_id, reviewer_entry in by_reviewer.items():
            if not isinstance(reviewer_entry, dict):
                continue
            for key in PR_LEVEL_FIELDS:
                if key in reviewer_entry:
                    remaining.append(f"by_reviewer[{reviewer_id}].{key}")
    return remaining


def strip_pr_arrays_from_rollups(rollup_dir: Path) -> StripReport:
    """Strip PR-level fields from every weekly rollup under ``rollup_dir``.

    The gate is strip-AND-re-verify: after the mutation pass, every file is
    re-scanned and the helper raises :class:`PrArrayResidueError` if any
    residue remains. A missing ``rollup_dir`` raises ``FileNotFoundError``.
    """
    if not rollup_dir.exists():
        raise FileNotFoundError(
            f"Rollup directory does not exist: {rollup_dir}. Strip gate was "
            "invoked before the producer wrote any rollups."
        )
    if not rollup_dir.is_dir():
        raise FileNotFoundError(f"Rollup path is not a directory: {rollup_dir}.")

    fields_removed: dict[str, int] = dict.fromkeys(PR_LEVEL_FIELDS, 0)
    files = sorted(rollup_dir.glob(ROLLUPS_GLOB))
    files_modified = 0
    for path in files:
        if _strip_one(path, fields_removed):
            files_modified += 1

    residue_report: list[str] = []
    for path in files:
        remaining = _verify_clean(path)
        if remaining:
            residue_report.append(f"{path}: {', '.join(remaining)}")
    if residue_report:
        raise PrArrayResidueError(
            "FR-023 violation: PR-level fields still present after strip pass. "
            "Offending files:\n  " + "\n  ".join(residue_report)
        )

    logger.info(
        "strip_pr_arrays_from_rollups: scanned=%d modified=%d fields=%r",
        len(files),
        files_modified,
        fields_removed,
    )
    return StripReport(
        files_scanned=len(files),
        files_modified=files_modified,
        fields_removed=dict(fields_removed),
    )


def _strip_nested_one(path: Path, fields_removed: dict[str, int]) -> bool:
    """Remove depth-2 ``by_reviewer[*]`` PR-level fields. Returns True if modified.

    Counterpart to :func:`_strip_one` that walks ONLY depth 2; the
    rollup root (depth 0) is preserved because the sentinel-present
    promotion path keeps its synthetic-shaped PR detail under the #309
    binary gate.
    """
    payload = _load_rollup(path)
    modified = False
    by_reviewer = payload.get("by_reviewer")
    if isinstance(by_reviewer, dict):
        for reviewer_entry in by_reviewer.values():
            if not isinstance(reviewer_entry, dict):
                continue
            for key in PR_LEVEL_FIELDS:
                if key in reviewer_entry:
                    reviewer_entry.pop(key, None)
                    fields_removed[key] += 1
                    modified = True
    if modified:
        _write_rollup(path, payload)
    return modified


def _verify_nested_clean(path: Path) -> list[str]:
    """Return the depth-2 PR-level field names that are still present in ``path``.

    Mirror of :func:`_strip_nested_one`: depth 0 (rollup root) is NOT
    inspected because sentinel-present synthetic shape keeps it.
    """
    payload = _load_rollup(path)
    remaining: list[str] = []
    by_reviewer = payload.get("by_reviewer")
    if isinstance(by_reviewer, dict):
        for reviewer_id, reviewer_entry in by_reviewer.items():
            if not isinstance(reviewer_entry, dict):
                continue
            for key in PR_LEVEL_FIELDS:
                if key in reviewer_entry:
                    remaining.append(f"by_reviewer[{reviewer_id}].{key}")
    return remaining


def strip_nested_reviewer_prs_from_rollups(rollup_dir: Path) -> StripReport:
    """Strip depth-2 ``by_reviewer[*].{prs,_prs_truncated,_prs_cap}`` only.

    Sentinel-present promotion path counterpart to
    :func:`strip_pr_arrays_from_rollups`.  Under #309's provenance-based
    binary gate the public synthetic demo at ``docs/data/`` keeps its
    rollup-root PR detail so the throughput / cycle-time PR drill-downs
    work on the demo surface.  Feature 362's nested per-(reviewer, week)
    PR detail (FR-028 / ``per-reviewer-week-prs.md`` § 5), however, is
    too granular for public consumption and MUST be stripped before
    publish — even when the sentinel is present.

    Same strip-and-re-verify envelope as
    :func:`strip_pr_arrays_from_rollups`; same exception type; same
    informational :class:`StripReport`.  A missing ``rollup_dir`` raises
    :class:`FileNotFoundError`.
    """
    if not rollup_dir.exists():
        raise FileNotFoundError(
            f"Rollup directory does not exist: {rollup_dir}. Strip gate was "
            "invoked before the producer wrote any rollups."
        )
    if not rollup_dir.is_dir():
        raise FileNotFoundError(f"Rollup path is not a directory: {rollup_dir}.")

    fields_removed: dict[str, int] = dict.fromkeys(PR_LEVEL_FIELDS, 0)
    files = sorted(rollup_dir.glob(ROLLUPS_GLOB))
    files_modified = 0
    for path in files:
        if _strip_nested_one(path, fields_removed):
            files_modified += 1

    residue_report: list[str] = []
    for path in files:
        remaining = _verify_nested_clean(path)
        if remaining:
            residue_report.append(f"{path}: {', '.join(remaining)}")
    if residue_report:
        raise PrArrayResidueError(
            "FR-028 violation: nested by_reviewer[*] PR-level fields still "
            "present after depth-2 strip pass. Offending files:\n  "
            + "\n  ".join(residue_report)
        )

    logger.info(
        "strip_nested_reviewer_prs_from_rollups: scanned=%d modified=%d fields=%r",
        len(files),
        files_modified,
        fields_removed,
    )
    return StripReport(
        files_scanned=len(files),
        files_modified=files_modified,
        fields_removed=dict(fields_removed),
    )
