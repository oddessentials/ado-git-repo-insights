"""Tests for scripts/check-version-unchanged.py.

Validates the VERSION-BUMP-APPROVED bypass mechanism and the
direct-push protection, following the same patterns used for
SUPPRESSION-INCREASE-APPROVED in test_audit_suppressions.py.

These tests are fully portable (no bash/jq dependency).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
SCRIPT = REPO_ROOT / "scripts" / "check-version-unchanged.py"


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

    @staticmethod
    def _write_event_file(tmp_path: Path, pr_body: str) -> Path:
        """Create a GitHub Actions event JSON file with the given PR body."""
        event_file = tmp_path / "event.json"
        event_file.write_text(
            json.dumps({"pull_request": {"body": pr_body}}),
            encoding="utf-8",
        )
        return event_file

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
        # Compare against HEAD — versions are identical to themselves
        result = self._run_guard("HEAD")
        assert result.returncode == 0, (
            f"Expected pass:\nstdout: {result.stdout}\nstderr: {result.stderr}"
        )
        assert "unchanged" in result.stdout.lower() or "[OK]" in result.stdout

    def test_fails_when_versions_changed(self) -> None:
        """Should fail when version files differ from base."""
        # Compare against origin/main — we have 99.0.0, main has 5.33.2
        result = self._run_guard("origin/main")
        assert result.returncode == 1, f"Expected fail:\n{result.stdout}"
        assert "VERSION-BUMP-APPROVED" in result.stdout

    def test_bypass_active_with_marker_in_pr_body(self, tmp_path: Path) -> None:
        """Should pass when PR description contains VERSION-BUMP-APPROVED."""
        event_file = self._write_event_file(
            tmp_path,
            "This PR has VERSION-BUMP-APPROVED for marketplace recovery.",
        )
        env = self._clean_env()
        env["GITHUB_EVENT_PATH"] = str(event_file)

        result = self._run_guard("origin/main", env=env)
        assert result.returncode == 0, (
            f"Expected bypass:\nstdout: {result.stdout}\nstderr: {result.stderr}"
        )
        assert "approved" in result.stdout.lower()

    def test_bypass_inactive_without_marker(self, tmp_path: Path) -> None:
        """Should still fail when PR description does NOT contain the marker."""
        event_file = self._write_event_file(
            tmp_path, "Just a normal PR, no special markers here."
        )
        env = self._clean_env()
        env["GITHUB_EVENT_PATH"] = str(event_file)

        result = self._run_guard("origin/main", env=env)
        assert result.returncode == 1, f"Expected fail:\n{result.stdout}"
        assert "VERSION-BUMP-APPROVED" in result.stdout

    def test_direct_push_to_main_never_bypassed(self, tmp_path: Path) -> None:
        """Direct push to main must ALWAYS fail, even with marker."""
        event_file = self._write_event_file(tmp_path, "VERSION-BUMP-APPROVED")
        env = self._clean_env()
        env["GITHUB_EVENT_PATH"] = str(event_file)
        env["GITHUB_EVENT_NAME"] = "push"
        env["GITHUB_REF"] = "refs/heads/main"

        result = self._run_guard("origin/main", env=env)
        assert result.returncode == 1, f"Expected fail on direct push:\n{result.stdout}"
        assert "direct push" in result.stdout.lower()

    def test_missing_event_file_no_bypass(self) -> None:
        """Should fail when GITHUB_EVENT_PATH is unset (no bypass possible)."""
        env = self._clean_env()
        env.pop("GITHUB_EVENT_PATH", None)

        result = self._run_guard("origin/main", env=env)
        assert result.returncode == 1, f"Expected fail:\n{result.stdout}"

    def test_invalid_event_file_no_bypass(self, tmp_path: Path) -> None:
        """Should fail when GITHUB_EVENT_PATH points to invalid JSON."""
        event_file = tmp_path / "bad.json"
        event_file.write_text("not valid json{{{", encoding="utf-8")
        env = self._clean_env()
        env["GITHUB_EVENT_PATH"] = str(event_file)

        result = self._run_guard("origin/main", env=env)
        assert result.returncode == 1, f"Expected fail:\n{result.stdout}"

    def test_empty_pr_body_no_bypass(self, tmp_path: Path) -> None:
        """Should fail when PR body is empty (null in JSON)."""
        event_file = tmp_path / "event.json"
        event_file.write_text(
            json.dumps({"pull_request": {"body": None}}),
            encoding="utf-8",
        )
        env = self._clean_env()
        env["GITHUB_EVENT_PATH"] = str(event_file)

        result = self._run_guard("origin/main", env=env)
        assert result.returncode == 1, f"Expected fail:\n{result.stdout}"

    def test_oversized_event_file_no_bypass(self, tmp_path: Path) -> None:
        """Should fail when event file exceeds size limit."""
        event_file = tmp_path / "huge.json"
        # Write > 1 MB of padding
        event_file.write_text(
            json.dumps(
                {
                    "pull_request": {"body": "VERSION-BUMP-APPROVED"},
                    "padding": "x" * (1_048_577),
                }
            ),
            encoding="utf-8",
        )
        env = self._clean_env()
        env["GITHUB_EVENT_PATH"] = str(event_file)

        result = self._run_guard("origin/main", env=env)
        assert result.returncode == 1, (
            f"Expected fail on oversized file:\n{result.stdout}"
        )
