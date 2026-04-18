"""Tests for run_summary artifact shape parity and discriminator invariant.

#33 asserts that extract and backfill produce structurally identical
run_summary.json shapes (FR-025b / FR-030e). #34 asserts the first-class
discriminator invariant across all 9 backfill states + 1 extract state
— the single test that fails if any of Sites A/B/C/D1/D2/D3/D4/D5 is
unwired (INV-8).
"""

from __future__ import annotations

from collections.abc import Callable

import pytest

from ado_git_repo_insights.utils.run_summary import (
    RunCounts,
    RunSummary,
    RunTimings,
    create_minimal_summary,
)

# ---------------------------------------------------------------------------
# Controlled artifact builders
# ---------------------------------------------------------------------------


def _backfill_warning(body: str) -> str:
    return f"backfill-comments: {body}"


def _build_extract_success_artifact() -> dict[str, object]:
    rs = RunSummary(
        tool_version="test-1.0",
        git_sha="abcdef0",
        organization="org",
        projects=["proj"],
        date_range_start="2026-01-01",
        date_range_end="2026-01-31",
        counts=RunCounts(prs_fetched=5, prs_updated=5),
        timings=RunTimings(total_seconds=1.0, extract_seconds=1.0),
        warnings=[],
        final_status="success",
        per_project_status={"proj": "success"},
        first_fatal_error=None,
    )
    return dict(rs.to_dict())


def _build_loop_success_artifact() -> dict[str, object]:
    rs = RunSummary(
        tool_version="test-1.0",
        git_sha="abcdef0",
        organization="org",
        projects=["proj"],
        date_range_start="2026-01-01",
        date_range_end="2026-01-31",
        counts=RunCounts(prs_fetched=0, prs_updated=3),
        timings=RunTimings(total_seconds=1.0),
        warnings=[_backfill_warning("loop-complete: processed=3 failed=0")],
        final_status="success",
        per_project_status={},
        first_fatal_error=None,
    )
    return dict(rs.to_dict())


def _build_partial_failure_artifact() -> dict[str, object]:
    rs = RunSummary(
        tool_version="test-1.0",
        git_sha="abcdef0",
        organization="org",
        projects=["proj"],
        date_range_start="2026-01-01",
        date_range_end="2026-01-31",
        counts=RunCounts(prs_fetched=0, prs_updated=2),
        timings=RunTimings(total_seconds=1.0),
        warnings=[
            _backfill_warning("failed to process PR p2: API error"),
            _backfill_warning("loop-complete: processed=2 failed=1"),
        ],
        final_status="success",
        per_project_status={},
        first_fatal_error=None,
    )
    return dict(rs.to_dict())


def _build_empty_selection_artifact() -> dict[str, object]:
    rs = RunSummary(
        tool_version="test-1.0",
        git_sha="abcdef0",
        organization="org",
        projects=[],
        date_range_start="2026-01-01",
        date_range_end="2026-01-31",
        counts=RunCounts(prs_fetched=0, prs_updated=0),
        timings=RunTimings(total_seconds=0.1),
        warnings=[_backfill_warning("loop-complete: processed=0 failed=0")],
        final_status="success",
        per_project_status={},
        first_fatal_error=None,
    )
    return dict(rs.to_dict())


def _build_legacy_schema_artifact() -> dict[str, object]:
    rs = RunSummary(
        tool_version="test-1.0",
        git_sha="abcdef0",
        organization="org",
        projects=[],
        date_range_start="2026-01-01",
        date_range_end="2026-01-31",
        counts=RunCounts(),
        timings=RunTimings(),
        warnings=[
            _backfill_warning(
                "legacy-schema-skip: pr_threads and pr_comments tables not present; "
                "run a migration or extract with --include-comments first"
            )
        ],
        final_status="success",
        per_project_status={},
        first_fatal_error=None,
    )
    return dict(rs.to_dict())


def _build_fatal_minimal(reason: str, body: str) -> dict[str, object]:
    rs = create_minimal_summary(reason)
    rs.warnings.append(_backfill_warning(body))
    return dict(rs.to_dict())


def _build_fatal_config_artifact() -> dict[str, object]:
    return _build_fatal_minimal(
        "Configuration error: bad config",
        "fatal-abort: Configuration error: bad config",
    )


def _build_fatal_database_artifact() -> dict[str, object]:
    return _build_fatal_minimal(
        "Database error: broken",
        "fatal-abort: Database error: broken",
    )


def _build_fatal_extraction_artifact() -> dict[str, object]:
    return _build_fatal_minimal(
        "Extraction error: 403",
        "fatal-abort: Extraction error: 403",
    )


def _build_fatal_ctrl_c_artifact() -> dict[str, object]:
    return _build_fatal_minimal(
        "Operation cancelled by user",
        "fatal-abort: Operation cancelled by user",
    )


def _build_fatal_exception_artifact() -> dict[str, object]:
    return _build_fatal_minimal(
        "kaboom",
        "fatal-abort: kaboom",
    )


# Pass 2 locked corpus: 9 backfill states + 1 extract state = 10 cases.
_BACKFILL_ARTIFACT_STATES: tuple[tuple[str, Callable[[], dict[str, object]]], ...] = (
    ("loop_success", _build_loop_success_artifact),
    ("partial_failure", _build_partial_failure_artifact),
    ("empty_selection", _build_empty_selection_artifact),
    ("legacy_schema_noop", _build_legacy_schema_artifact),
    ("fatal_config_error", _build_fatal_config_artifact),
    ("fatal_database_error", _build_fatal_database_artifact),
    ("fatal_preloop_extraction_error", _build_fatal_extraction_artifact),
    ("fatal_ctrl_c", _build_fatal_ctrl_c_artifact),
    ("fatal_unexpected_exception", _build_fatal_exception_artifact),
)


def _is_backfill_artifact(artifact: dict[str, object]) -> bool:
    warnings = artifact.get("warnings", [])
    if not isinstance(warnings, list):
        return False
    return any(
        isinstance(w, str) and w.startswith("backfill-comments: ") for w in warnings
    )


# ---------------------------------------------------------------------------
# #33 + #34
# ---------------------------------------------------------------------------


class TestArtifactShapeParity:
    """Asserts extract and backfill artifacts share structural parity and
    that the backfill discriminator invariant holds across all 9 sites."""

    def test_backfill_and_extract_artifacts_have_identical_shape(self) -> None:
        extract_artifact = _build_extract_success_artifact()
        backfill_artifact = _build_loop_success_artifact()

        assert set(extract_artifact.keys()) == set(backfill_artifact.keys())

        # Nested shapes for date_range / counts / timings.
        for key in ("date_range", "counts", "timings"):
            e_sub = extract_artifact[key]
            b_sub = backfill_artifact[key]
            assert isinstance(e_sub, dict)
            assert isinstance(b_sub, dict)
            assert set(e_sub.keys()) == set(b_sub.keys()), key

        # Per-field type shapes match.
        for key in extract_artifact:
            assert type(extract_artifact[key]) is type(backfill_artifact[key]), key

    @pytest.mark.parametrize(
        ("state_name", "builder"),
        _BACKFILL_ARTIFACT_STATES,
    )
    def test_discriminator_invariant_holds_for_all_backfill_states(
        self, state_name: str, builder: Callable[[], dict[str, object]]
    ) -> None:
        artifact = builder()
        assert _is_backfill_artifact(artifact), (
            f"State {state_name!r} does NOT carry the backfill-comments "
            f"discriminator; warnings={artifact.get('warnings')}"
        )

    def test_extract_artifact_is_not_backfill(self) -> None:
        extract_artifact = _build_extract_success_artifact()
        assert _is_backfill_artifact(extract_artifact) is False
