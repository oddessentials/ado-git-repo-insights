"""Tests for insights dry-run behavior."""

from __future__ import annotations

from pathlib import Path
from typing import Any, cast
from unittest.mock import patch

from ado_git_repo_insights.ml.insights import LLMInsightsGenerator
from ado_git_repo_insights.persistence.database import DatabaseManager


class _FakeCursor:
    def __init__(self, row: dict[str, Any] | None) -> None:
        self._row = row

    def fetchone(self) -> dict[str, Any] | None:
        return self._row


class _FakeDb:
    def execute(self, query: str) -> _FakeCursor:
        if "COUNT(*) as cnt FROM pull_requests WHERE status" in query:
            return _FakeCursor({"cnt": 0})
        if "MIN(closed_date)" in query and "MAX(closed_date)" in query:
            return _FakeCursor({"min_date": None, "max_date": None})
        if "AVG(cycle_time_minutes)" in query:
            return _FakeCursor({"avg_cycle": None})
        if "ORDER BY cycle_time_minutes" in query:
            return _FakeCursor({"cycle_time_minutes": 0})
        if "COUNT(DISTINCT user_id)" in query:
            return _FakeCursor({"cnt": 0})
        if "COUNT(*) as cnt FROM repositories" in query:
            return _FakeCursor({"cnt": 0})
        return _FakeCursor(None)


def test_dry_run_never_calls_openai(tmp_path: Path) -> None:
    db = _FakeDb()
    generator = LLMInsightsGenerator(
        cast(DatabaseManager, db), output_dir=tmp_path, dry_run=True
    )

    with patch.object(
        LLMInsightsGenerator, "_call_openai", side_effect=AssertionError("no api")
    ):
        result = generator.generate()

    assert result is False
    prompt_path = tmp_path / "insights" / "prompt.json"
    assert prompt_path.exists()
