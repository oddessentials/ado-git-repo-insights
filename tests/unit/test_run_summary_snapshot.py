"""Golden-snapshot tests for RunSummary producer helpers (FR-025c).

#35 locks RunSummary.to_dict() byte-shape via a committed golden.
#36 locks create_minimal_summary() byte-shape (including the
warnings=[] default that drives Sites D1-D5's caller-side mutation).
#37 locks normalize_error_message() outputs across a corpus.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ado_git_repo_insights.utils import run_summary as rs_mod
from ado_git_repo_insights.utils.run_summary import (
    RunCounts,
    RunSummary,
    RunTimings,
    create_minimal_summary,
    normalize_error_message,
)

_GOLDENS_DIR = Path(__file__).parent / "goldens"


def _load_golden(name: str) -> dict[str, object]:
    with (_GOLDENS_DIR / name).open() as f:
        return json.load(f)


def _patch_providers(monkeypatch: pytest.MonkeyPatch) -> None:
    from datetime import date as real_date

    class _FixedDate(real_date):
        @classmethod
        def today(cls) -> _FixedDate:
            return cls(2026, 4, 16)

    monkeypatch.setattr(rs_mod, "get_tool_version", lambda: "test-1.0")
    monkeypatch.setattr(rs_mod, "get_git_sha", lambda: "abcdef0")
    monkeypatch.setattr(rs_mod, "date", _FixedDate)


_NORMALIZE_CORPUS: tuple[tuple[str, str], ...] = (
    ("https://dev.azure.com/org/_apis/git?x=1", "[URL_WITH_PARAMS]"),
    ("https://dev.azure.com/org/_apis/git", "[URL]"),
    ("a" * 1000, "a" * 500 + "...[truncated]"),
    ("short", "short"),
    (
        "prefix https://dev.azure.com/org x=1 suffix",
        "prefix [URL] x=1 suffix",
    ),
)


class TestExtractProducerGoldenSnapshot:
    """Golden-snapshot tests for stable RunSummary producers."""

    def test_run_summary_to_dict_matches_golden(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch_providers(monkeypatch)
        rs = RunSummary(
            tool_version=rs_mod.get_tool_version(),
            git_sha=rs_mod.get_git_sha(),
            organization="org",
            projects=["proj"],
            date_range_start="2026-01-01",
            date_range_end="2026-01-31",
            counts=RunCounts(prs_fetched=3, prs_updated=3),
            timings=RunTimings(total_seconds=1.5, extract_seconds=1.0),
            warnings=["w1"],
            final_status="success",
            per_project_status={"proj": "success"},
            first_fatal_error=None,
        )
        actual = rs.to_dict()
        golden = _load_golden("run_summary_to_dict.json")
        assert json.dumps(actual, sort_keys=True, indent=2) == json.dumps(
            golden, sort_keys=True, indent=2
        )

    def test_create_minimal_summary_matches_golden(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch_providers(monkeypatch)
        rs = create_minimal_summary("test fatal error", Path("run_artifacts"))
        # Lock: warnings=[] is the default return; callers mutate.
        assert rs.warnings == []
        actual = rs.to_dict()
        golden = _load_golden("create_minimal_summary.json")
        assert json.dumps(actual, sort_keys=True, indent=2) == json.dumps(
            golden, sort_keys=True, indent=2
        )

    @pytest.mark.parametrize(("raw", "expected"), _NORMALIZE_CORPUS)
    def test_normalize_error_message_matches_golden(
        self, raw: str, expected: str
    ) -> None:
        assert normalize_error_message(raw) == expected
