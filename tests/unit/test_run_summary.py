"""Tests for run_summary module."""

import json
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

from ado_git_repo_insights.utils.run_summary import (
    RunCounts,
    RunSummary,
    RunTimings,
    _find_git_dir,
    _resolve_ref,
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

    def test_get_git_sha_works_from_subdirectory(self) -> None:
        """git SHA must resolve when CWD is a subdirectory of the repo."""
        repo_root = Path(__file__).parent.parent.parent
        sub_dir = repo_root / "src"
        assert sub_dir.is_dir(), "src/ must exist for this test"
        saved = os.getcwd()
        try:
            os.chdir(sub_dir)
            sha = get_git_sha()
            assert sha is not None, "get_git_sha() returned None from src/"
            assert len(sha) == 7
        finally:
            os.chdir(saved)

    def test_find_git_dir_from_nested_subdir(self) -> None:
        """_find_git_dir must discover .git from deeply nested paths."""
        git_dir = _find_git_dir(start=Path(__file__).parent)
        assert git_dir is not None, "_find_git_dir returned None from tests/unit/"
        assert (git_dir / "HEAD").is_file()

    def test_find_git_dir_worktree_layout(self, tmp_path: Path) -> None:
        """_find_git_dir must follow a .git file (worktree pointer)."""
        real_git = tmp_path / "real_git_dir"
        real_git.mkdir()
        (real_git / "HEAD").write_text("ref: refs/heads/main\n")
        worktree = tmp_path / "worktree"
        worktree.mkdir()
        (worktree / ".git").write_text(f"gitdir: {real_git}\n")
        result = _find_git_dir(start=worktree)
        assert result == real_git

    def test_resolve_ref_packed_refs(self, tmp_path: Path) -> None:
        """_resolve_ref must find a SHA in packed-refs when loose ref is absent."""
        git_dir = tmp_path / "git_dir"
        git_dir.mkdir()
        sha = "abc1234def5678901234567890abcdef12345678"
        (git_dir / "packed-refs").write_text(
            f"# pack-refs with: peeled fully-peeled sorted\n{sha} refs/heads/main\n"
        )
        result = _resolve_ref(git_dir, "refs/heads/main")
        assert result == sha

    def test_resolve_ref_loose_preferred_over_packed(self, tmp_path: Path) -> None:
        """Loose ref file takes precedence over packed-refs."""
        git_dir = tmp_path / "git_dir"
        git_dir.mkdir()
        refs_dir = git_dir / "refs" / "heads"
        refs_dir.mkdir(parents=True)
        loose_sha = "1111111222222233333334444444555555566666"
        packed_sha = "aaaaaaa000000011111112222222333333344444"
        (refs_dir / "main").write_text(f"{loose_sha}\n")
        (git_dir / "packed-refs").write_text(f"{packed_sha} refs/heads/main\n")
        result = _resolve_ref(git_dir, "refs/heads/main")
        assert result == loose_sha

    def test_get_git_sha_linked_worktree_loose_ref(self, tmp_path: Path) -> None:
        """get_git_sha must resolve a branch ref via commondir loose ref."""
        sha = "aabbccdd11223344556677889900aabbccddeeff"
        # Common git dir with the loose ref
        common = tmp_path / "common_git"
        common.mkdir()
        refs_dir = common / "refs" / "heads"
        refs_dir.mkdir(parents=True)
        (refs_dir / "feature").write_text(f"{sha}\n")
        # Per-worktree admin dir with HEAD and commondir
        admin = common / "worktrees" / "wt1"
        admin.mkdir(parents=True)
        (admin / "HEAD").write_text("ref: refs/heads/feature\n")
        (admin / "commondir").write_text("../..\n")
        # Worktree checkout with .git file pointing to admin dir
        checkout = tmp_path / "worktree_checkout"
        checkout.mkdir()
        (checkout / ".git").write_text(f"gitdir: {admin}\n")
        saved = os.getcwd()
        try:
            os.chdir(checkout)
            result = get_git_sha()
            assert result is not None, (
                "get_git_sha() returned None in linked-worktree with loose ref"
            )
            assert result == sha[:7]
        finally:
            os.chdir(saved)

    def test_get_git_sha_linked_worktree_packed_ref(self, tmp_path: Path) -> None:
        """get_git_sha must resolve a branch ref via commondir packed-refs."""
        sha = "1122334455667788990011223344556677889900"
        # Common git dir with packed-refs only (no loose ref)
        common = tmp_path / "common_git"
        common.mkdir()
        (common / "packed-refs").write_text(
            f"# pack-refs with: peeled fully-peeled sorted\n{sha} refs/heads/feature\n"
        )
        # Per-worktree admin dir
        admin = common / "worktrees" / "wt1"
        admin.mkdir(parents=True)
        (admin / "HEAD").write_text("ref: refs/heads/feature\n")
        (admin / "commondir").write_text("../..\n")
        # Worktree checkout
        checkout = tmp_path / "worktree_checkout"
        checkout.mkdir()
        (checkout / ".git").write_text(f"gitdir: {admin}\n")
        saved = os.getcwd()
        try:
            os.chdir(checkout)
            result = get_git_sha()
            assert result is not None, (
                "get_git_sha() returned None in linked-worktree with packed ref"
            )
            assert result == sha[:7]
        finally:
            os.chdir(saved)

    def test_resolve_ref_checks_common_dir(self, tmp_path: Path) -> None:
        """_resolve_ref must search common_git_dir after git_dir."""
        worktree_sha = "aaaaaaa000000011111112222222333333344444"
        common_sha = "bbbbbbb000000011111112222222333333344444"
        # Per-worktree dir: no refs at all
        wt_dir = tmp_path / "wt_admin"
        wt_dir.mkdir()
        # Common dir: has the loose ref
        common_dir = tmp_path / "common"
        common_dir.mkdir()
        refs_dir = common_dir / "refs" / "heads"
        refs_dir.mkdir(parents=True)
        (refs_dir / "main").write_text(f"{common_sha}\n")
        # Without common_git_dir: returns None (ref not in wt_dir)
        assert _resolve_ref(wt_dir, "refs/heads/main") is None
        # With common_git_dir: finds the ref
        result = _resolve_ref(wt_dir, "refs/heads/main", common_dir)
        assert result == common_sha
        # Per-worktree ref takes precedence when both exist
        wt_refs = wt_dir / "refs" / "heads"
        wt_refs.mkdir(parents=True)
        (wt_refs / "main").write_text(f"{worktree_sha}\n")
        result = _resolve_ref(wt_dir, "refs/heads/main", common_dir)
        assert result == worktree_sha

    def test_get_git_sha_returns_none_outside_repo(self, tmp_path: Path) -> None:
        """get_git_sha must return None in a directory with no .git ancestor."""
        saved = os.getcwd()
        try:
            os.chdir(tmp_path)
            assert get_git_sha() is None
        finally:
            os.chdir(saved)

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


class TestGetGitShaErrorHandling:
    """Tests for get_git_sha error handling when .git/HEAD is unreadable."""

    @patch(
        "ado_git_repo_insights.utils.run_summary.Path.read_text",
        side_effect=FileNotFoundError,
    )
    def test_file_not_found_returns_none(self, mock_read) -> None:
        """Returns None when .git/HEAD does not exist."""
        assert get_git_sha() is None

    @patch(
        "ado_git_repo_insights.utils.run_summary.Path.read_text",
        return_value="not-a-valid-ref\n",
    )
    def test_malformed_head_returns_short_hash(self, mock_read) -> None:
        """Returns first 7 chars of raw content when HEAD is not a ref pointer."""
        result = get_git_sha()
        assert result == "not-a-v"

    @patch(
        "ado_git_repo_insights.utils.run_summary.Path.read_text",
        side_effect=PermissionError("access denied"),
    )
    def test_generic_error_returns_none(self, mock_read) -> None:
        """Returns None on generic OS errors (e.g., PermissionError)."""
        assert get_git_sha() is None
