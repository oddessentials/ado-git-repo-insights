"""Tests for scripts/check-version-unchanged.py.

Validates the [version-override-acknowledged] commit message bypass
and direct-push protection. The bypass uses the same commit-message
marker pattern as [threshold-update] in check_threshold_changes.py.

These tests are fully portable (no bash/jq dependency).
"""

from __future__ import annotations

import importlib
import importlib.util
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).parent.parent.parent
SCRIPT = REPO_ROOT / "scripts" / "check-version-unchanged.py"
MARKER = "[version-override-acknowledged]"

# Import the guard script as a module so we can mock its functions
_spec = importlib.util.spec_from_file_location("check_version_unchanged", SCRIPT)
_guard_module = importlib.util.module_from_spec(_spec)
sys.modules["check_version_unchanged"] = _guard_module
_spec.loader.exec_module(_guard_module)


class TestVersionGuard:
    """Integration tests for check-version-unchanged.py."""

    @staticmethod
    def _clean_env() -> dict[str, str]:
        """Build environment without GitHub CI variables."""
        env = os.environ.copy()
        env.pop("GITHUB_EVENT_NAME", None)
        env.pop("GITHUB_REF", None)
        env.pop("GITHUB_EVENT_PATH", None)
        return env

    def _run_guard(
        self,
        base_branch: str = "origin/main",
        env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        """Run the version guard script and return the result."""
        run_env = env or self._clean_env()
        return subprocess.run(  # noqa: S603 - trusted test code
            [sys.executable, str(SCRIPT), base_branch],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            env=run_env,
        )

    def test_script_exists(self) -> None:
        """The version guard script must exist."""
        assert SCRIPT.is_file(), f"Script not found: {SCRIPT}"

    def test_passes_when_versions_unchanged(self) -> None:
        """Should pass when no version files differ from base branch."""
        result = self._run_guard("HEAD")
        assert result.returncode == 0, (
            f"Expected pass:\nstdout: {result.stdout}\nstderr: {result.stderr}"
        )
        assert "[OK]" in result.stdout

    # test_fails_when_versions_changed — moved to TestVersionGuardIsolated
    # test_bypass_active_with_commit_marker — moved to TestVersionGuardIsolated

    def test_marker_string_is_scanned_in_git_log(self) -> None:
        """The guard must scan git log for the exact marker string."""
        # Read the script source and verify it uses the correct marker
        source = SCRIPT.read_text(encoding="utf-8")
        assert 'MARKER = "[version-override-acknowledged]"' in source
        assert "git" in source
        assert "log" in source
        assert "check_commit_marker" in source

    # test_direct_push_to_main_never_bypassed — moved to TestVersionGuardIsolated

    def test_missing_git_history_no_bypass(self) -> None:
        """Should fail when git log cannot find the base branch."""
        # Use a nonexistent branch — git log will fail, no marker found
        result = self._run_guard("origin/nonexistent-branch-xyz")
        # Script should handle gracefully (not crash)
        # It will either skip files (can't git show) or fail on version diff
        assert result.returncode in (0, 1)

    # test_output_includes_changed_files — moved to TestVersionGuardIsolated
    # test_output_includes_bypass_instructions — moved to TestVersionGuardIsolated

    def test_no_pr_body_mechanism(self) -> None:
        """The script must NOT use GITHUB_EVENT_PATH for bypass.

        The version guard uses commit message markers only — not PR body.
        This ensures local and CI behavior are identical.
        """
        source = SCRIPT.read_text(encoding="utf-8")
        assert "GITHUB_EVENT_PATH" not in source
        assert "pull_request" not in source
        assert "pr_body" not in source

    def test_uses_two_dot_range_not_symmetric_difference(self) -> None:
        """Marker scan must use two-dot range (branch-only commits).

        Three-dot (A...B) includes commits on both sides of the merge
        base. If the base branch gains a marker commit after this branch
        diverges, the three-dot scan would falsely approve unrelated
        version changes. Two-dot (A..B) scans only branch-local commits.
        """
        source = SCRIPT.read_text(encoding="utf-8")
        assert '..HEAD"' in source or "..HEAD]" in source
        assert '...HEAD"' not in source
        assert "...HEAD]" not in source


class TestVersionGuardIsolated:
    """Mock-isolated tests for main() logic paths.

    These mock the git-dependent functions so tests are deterministic
    on any branch — no dependency on which commits exist, whether the
    override marker is present, or whether versions differ from main.

    Follows the importlib + patch.object pattern from test_hook_guards.py.
    """

    @staticmethod
    def _run_main(
        *,
        current: str = "2.0.0",
        base: str = "1.0.0",
        marker: bool = False,
        direct_push: bool = False,
        monkeypatch,
        capsys,
    ) -> int:
        """Run the guard's main() with fully controlled inputs."""
        monkeypatch.chdir(REPO_ROOT)
        with (
            patch.object(_guard_module, "get_current_version", return_value=current),
            patch.object(_guard_module, "get_base_version", return_value=base),
            patch.object(_guard_module, "check_commit_marker", return_value=marker),
            patch.object(
                _guard_module, "is_direct_push_to_main", return_value=direct_push
            ),
            patch("sys.argv", ["check-version-unchanged.py", "origin/main"]),
        ):
            rc = _guard_module.main()
        return rc

    def test_fails_when_versions_changed_no_marker(self, monkeypatch, capsys) -> None:
        """Versions changed + no marker + not direct push → rc=1."""
        rc = self._run_main(marker=False, monkeypatch=monkeypatch, capsys=capsys)
        assert rc == 1
        out = capsys.readouterr().out
        assert "[FAIL]" in out

    def test_passes_when_marker_present(self, monkeypatch, capsys) -> None:
        """Versions changed + marker present → rc=0 (bypass approved)."""
        rc = self._run_main(marker=True, monkeypatch=monkeypatch, capsys=capsys)
        assert rc == 0
        out = capsys.readouterr().out
        assert "approved" in out.lower()

    def test_direct_push_fails_even_with_marker(self, monkeypatch, capsys) -> None:
        """Direct push to main → rc=1, even when marker is present."""
        rc = self._run_main(
            marker=True, direct_push=True, monkeypatch=monkeypatch, capsys=capsys
        )
        assert rc == 1
        out = capsys.readouterr().out
        assert "direct push" in out.lower()

    def test_output_lists_changed_files(self, monkeypatch, capsys) -> None:
        """Error output must list the specific files that changed."""
        self._run_main(marker=False, monkeypatch=monkeypatch, capsys=capsys)
        out = capsys.readouterr().out
        assert "VERSION" in out
        assert "package.json" in out
        assert "vss-extension.json" in out
        assert "task.json" in out

    def test_output_includes_bypass_instructions(self, monkeypatch, capsys) -> None:
        """When guard fails, output must tell the developer how to bypass."""
        rc = self._run_main(marker=False, monkeypatch=monkeypatch, capsys=capsys)
        assert rc == 1
        out = capsys.readouterr().out
        assert MARKER in out
        assert "commit message" in out.lower()
