"""Tests for run_summary module."""

import json
import tempfile
from pathlib import Path

from ado_git_repo_insights.utils.run_summary import (
    RunCounts,
    RunSummary,
    RunTimings,
    create_minimal_summary,
    get_git_sha,
    get_tool_version,
    normalize_error_message,
)


class TestNormalizeErrorMessage:
    """Tests for error message normalization."""

    def test_strips_url_with_query_params(self) -> None:
        error = "Failed at https://dev.azure.com/org?token=secret&other=val"
        result = normalize_error_message(error)
        assert "[URL_WITH_PARAMS]" in result
        assert "token=secret" not in result

    def test_strips_plain_url(self) -> None:
        error = "Failed at https://dev.azure.com/org/project"
        result = normalize_error_message(error)
        assert "[URL]" in result
        assert "dev.azure.com" not in result

    def test_truncates_long_messages(self) -> None:
        error = "x" * 600
        result = normalize_error_message(error, max_length=500)
        assert len(result) <= 520  # 500 + truncation marker
        assert "...[truncated]" in result

    def test_short_message_unchanged(self) -> None:
        error = "Simple error"
        result = normalize_error_message(error)
        assert result == error


class TestRunCounts:
    """Tests for RunCounts dataclass."""

    def test_defaults(self) -> None:
        counts = RunCounts()
        assert counts.prs_fetched == 0
        assert counts.prs_updated == 0
        assert counts.rows_per_csv == {}


class TestRunTimings:
    """Tests for RunTimings dataclass."""

    def test_defaults(self) -> None:
        timings = RunTimings()
        assert timings.total_seconds == 0.0
        assert timings.extract_seconds == 0.0


class TestRunSummary:
    """Tests for RunSummary dataclass."""

    def test_to_dict(self) -> None:
        summary = RunSummary(
            tool_version="1.0.0",
            git_sha="abc123",
            organization="TestOrg",
            projects=["ProjectA"],
            date_range_start="2024-01-01",
            date_range_end="2024-01-31",
            counts=RunCounts(prs_fetched=10),
            timings=RunTimings(total_seconds=5.0),
            warnings=["warn1"],
            final_status="success",
            per_project_status={"ProjectA": "success"},
            first_fatal_error=None,
        )
        d = summary.to_dict()
        assert d["tool_version"] == "1.0.0"
        assert d["organization"] == "TestOrg"
        assert d["counts"]["prs_fetched"] == 10
        assert d["final_status"] == "success"

    def test_write(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "summary.json"
            summary = RunSummary(
                tool_version="1.0.0",
                git_sha=None,
                organization="Org",
                projects=[],
                date_range_start="2024-01-01",
                date_range_end="2024-01-01",
                counts=RunCounts(),
                timings=RunTimings(),
                warnings=[],
                final_status="success",
            )
            summary.write(path)
            assert path.exists()
            data = json.loads(path.read_text())
            assert data["final_status"] == "success"

    def test_normalizes_error_on_init(self) -> None:
        summary = RunSummary(
            tool_version="1.0.0",
            git_sha=None,
            organization="Org",
            projects=[],
            date_range_start="2024-01-01",
            date_range_end="2024-01-01",
            counts=RunCounts(),
            timings=RunTimings(),
            warnings=[],
            final_status="failed",
            first_fatal_error="Error at https://example.com?token=secret",
        )
        assert "[URL_WITH_PARAMS]" in summary.first_fatal_error
        assert "token=secret" not in summary.first_fatal_error


class TestHelperFunctions:
    """Tests for helper functions."""

    def test_get_tool_version_returns_string(self) -> None:
        version = get_tool_version()
        assert isinstance(version, str)

    def test_get_git_sha_returns_string_or_none(self) -> None:
        sha = get_git_sha()
        assert sha is None or isinstance(sha, str)

    def test_create_minimal_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            summary = create_minimal_summary("test error", Path(tmpdir))
            assert summary.final_status == "failed"
            assert "test error" in (summary.first_fatal_error or "")


class TestRunSummaryOutput:
    """Tests for RunSummary output methods."""

    def test_print_final_line_success(self, capsys) -> None:
        summary = RunSummary(
            tool_version="1.0.0",
            git_sha=None,
            organization="Org",
            projects=[],
            date_range_start="2024-01-01",
            date_range_end="2024-01-01",
            counts=RunCounts(prs_fetched=5),
            timings=RunTimings(total_seconds=2.5),
            warnings=[],
            final_status="success",
        )
        summary.print_final_line()
        captured = capsys.readouterr()
        assert "SUCCESS" in captured.out
        assert "5 PRs" in captured.out

    def test_print_final_line_failed(self, capsys) -> None:
        summary = RunSummary(
            tool_version="1.0.0",
            git_sha=None,
            organization="Org",
            projects=[],
            date_range_start="2024-01-01",
            date_range_end="2024-01-01",
            counts=RunCounts(),
            timings=RunTimings(),
            warnings=[],
            final_status="failed",
        )
        summary.print_final_line()
        captured = capsys.readouterr()
        assert "FAILED" in captured.out

    def test_emit_ado_commands_not_in_ado(self, monkeypatch, capsys) -> None:
        monkeypatch.delenv("TF_BUILD", raising=False)
        summary = RunSummary(
            tool_version="1.0.0",
            git_sha=None,
            organization="Org",
            projects=[],
            date_range_start="2024-01-01",
            date_range_end="2024-01-01",
            counts=RunCounts(),
            timings=RunTimings(),
            warnings=["warn1"],
            final_status="success",
        )
        summary.emit_ado_commands()
        captured = capsys.readouterr()
        assert "##vso" not in captured.out

    def test_emit_ado_commands_in_ado_failure(self, monkeypatch, capsys) -> None:
        monkeypatch.setenv("TF_BUILD", "true")
        summary = RunSummary(
            tool_version="1.0.0",
            git_sha=None,
            organization="Org",
            projects=[],
            date_range_start="2024-01-01",
            date_range_end="2024-01-01",
            counts=RunCounts(),
            timings=RunTimings(),
            warnings=[],
            final_status="failed",
            first_fatal_error="Test error",
        )
        summary.emit_ado_commands()
        captured = capsys.readouterr()
        assert "##vso[task.logissue type=error]" in captured.out
        assert "##vso[task.complete result=Failed]" in captured.out

    def test_emit_ado_commands_in_ado_warnings(self, monkeypatch, capsys) -> None:
        monkeypatch.setenv("TF_BUILD", "true")
        summary = RunSummary(
            tool_version="1.0.0",
            git_sha=None,
            organization="Org",
            projects=[],
            date_range_start="2024-01-01",
            date_range_end="2024-01-01",
            counts=RunCounts(),
            timings=RunTimings(),
            warnings=["Warning 1", "Warning 2"],
            final_status="success",
        )
        summary.emit_ado_commands()
        captured = capsys.readouterr()
        assert "##vso[task.logissue type=warning]Warning 1" in captured.out
