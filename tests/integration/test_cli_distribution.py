"""Integration tests for CLI distribution hardening.

These tests validate end-to-end behavior of setup-path and doctor commands.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


class TestSetupPathIntegration:
    """Integration tests for setup-path command."""

    def test_setup_path_print_only_outputs_command(self) -> None:
        """--print-only outputs the PATH command without modifying files."""
        result = subprocess.run(  # noqa: S603
            [
                sys.executable,
                "-m",
                "ado_git_repo_insights.cli",
                "setup-path",
                "--print-only",
            ],
            capture_output=True,
            text=True,
            check=False,
        )

        # Should succeed or fail with pipx/uv message
        if "not needed for" in result.stderr:
            # Running in pipx/uv environment, expected refusal
            assert result.returncode == 1
        else:
            # Running in pip environment, should output command
            assert result.returncode == 0
            # Output should be a shell command
            assert "PATH" in result.stdout or "path" in result.stdout.lower()

    def test_setup_path_modifies_temp_config(self, tmp_path: Path) -> None:
        """setup-path modifies shell config file in temp directory.

        Note: This test creates a temporary shell config and tests the
        file mutation logic. It doesn't actually execute shell commands.
        """
        # Create a fake shell config
        config_path = tmp_path / ".bashrc"
        config_path.write_text("# Existing config\n")

        # We can't easily test the full command without mocking shell detection,
        # so we test the internal functions directly instead
        from ado_git_repo_insights.commands.setup_path import (
            SENTINEL_END,
            SENTINEL_START,
            _format_path_block,
            _has_existing_config,
            _remove_existing_config,
        )

        # Test adding config
        scripts_dir = tmp_path / "bin"
        block = _format_path_block(scripts_dir, "bash")

        # Append to config
        new_content = config_path.read_text() + block
        config_path.write_text(new_content)

        # Verify config was added
        content = config_path.read_text()
        assert SENTINEL_START in content
        assert str(scripts_dir) in content
        assert _has_existing_config(content)

        # Test removing config
        removed_content = _remove_existing_config(content)
        config_path.write_text(removed_content)

        # Verify config was removed
        final_content = config_path.read_text()
        assert SENTINEL_START not in final_content
        assert SENTINEL_END not in final_content
        assert "# Existing config" in final_content


class TestDoctorIntegration:
    """Integration tests for doctor command."""

    def test_doctor_runs_without_error(self) -> None:
        """Doctor command runs without crashing."""
        result = subprocess.run(  # noqa: S603
            [sys.executable, "-m", "ado_git_repo_insights.cli", "doctor"],
            capture_output=True,
            text=True,
            check=False,
        )

        # Should complete (either 0 or 1 depending on environment)
        assert result.returncode in (0, 1)

        # Should output structured report
        assert "ado-insights doctor" in result.stdout
        assert "Executable:" in result.stdout
        assert "Status:" in result.stdout

    def test_doctor_output_format_is_stable(self) -> None:
        """Doctor output format is stable and parseable."""
        result = subprocess.run(  # noqa: S603
            [sys.executable, "-m", "ado_git_repo_insights.cli", "doctor"],
            capture_output=True,
            text=True,
            check=False,
        )

        # Output should be line-oriented (no ANSI codes)
        assert "\x1b[" not in result.stdout
        assert "\033[" not in result.stdout

        # Check required fields are present
        lines = result.stdout.split("\n")
        field_prefixes = [
            "Executable:",
            "Version:",
            "Python:",
            "Installation Method:",
            "Scripts Directory:",
            "On PATH:",
            "Status:",
        ]

        for prefix in field_prefixes:
            assert any(prefix in line for line in lines), f"Missing field: {prefix}"

    def test_doctor_status_matches_exit_code(self) -> None:
        """Doctor Status: line matches exit code."""
        result = subprocess.run(  # noqa: S603
            [sys.executable, "-m", "ado_git_repo_insights.cli", "doctor"],
            capture_output=True,
            text=True,
            check=False,
        )

        if result.returncode == 0:
            assert "Status: OK" in result.stdout
        else:
            assert "Status: ISSUES_DETECTED" in result.stdout


class TestPrintOnlyIntegration:
    """Integration tests for --print-only flag."""

    def test_print_only_outputs_to_stdout(self) -> None:
        """--print-only outputs the command to stdout without errors."""
        result = subprocess.run(  # noqa: S603
            [
                sys.executable,
                "-m",
                "ado_git_repo_insights.cli",
                "setup-path",
                "--print-only",
            ],
            capture_output=True,
            text=True,
            check=False,
        )

        # Should succeed or fail with pipx/uv message (no shell config modified)
        if "not needed for" in result.stderr:
            # Running in pipx/uv environment, expected refusal
            assert result.returncode == 1
        else:
            # Running in pip environment
            assert result.returncode == 0
            # Should output a PATH command
            assert "PATH" in result.stdout or "path" in result.stdout.lower()


class TestSetupPathRemoveIntegration:
    """Integration tests for setup-path --remove flag."""

    def test_remove_cleans_sentinel_block(self, tmp_path: Path) -> None:
        """--remove cleans up the sentinel-marked block."""
        from ado_git_repo_insights.commands.setup_path import (
            SENTINEL_START,
            _format_path_block,
            _remove_existing_config,
        )

        # Create a config file with our block
        config_path = tmp_path / ".bashrc"
        scripts_dir = tmp_path / "bin"

        original_content = "# User config\nexport FOO=bar\n"
        block = _format_path_block(scripts_dir, "bash")
        full_content = original_content + block + "# More config\n"

        config_path.write_text(full_content)

        # Remove the block
        cleaned = _remove_existing_config(config_path.read_text())
        config_path.write_text(cleaned)

        # Verify
        final_content = config_path.read_text()
        assert "# User config" in final_content
        assert "export FOO=bar" in final_content
        assert "# More config" in final_content
        assert SENTINEL_START not in final_content
        assert str(scripts_dir) not in final_content


class TestPathGuidanceAtStartup:
    """Integration tests for PATH guidance at CLI startup (FR-005/T018)."""

    def test_setup_path_command_skips_path_warning(self) -> None:
        """setup-path command should NOT emit duplicate PATH guidance."""
        result = subprocess.run(  # noqa: S603
            [
                sys.executable,
                "-m",
                "ado_git_repo_insights.cli",
                "setup-path",
                "--print-only",
            ],
            capture_output=True,
            text=True,
            check=False,
        )

        # Count occurrences of "PATH" or path guidance phrases
        # setup-path --print-only outputs the command, but shouldn't have
        # the T018 guidance BEFORE it (which would say "not on your PATH")
        guidance_phrase = "not on your PATH"
        guidance_count = result.stderr.count(guidance_phrase)

        # Should be at most 0 or 1 (from setup-path's own error handling, not T018)
        # T018 explicitly skips for setup-path command
        assert guidance_count <= 1, (
            f"T018 guidance should be skipped for setup-path: {result.stderr}"
        )

    def test_doctor_command_skips_path_warning(self) -> None:
        """doctor command should NOT emit duplicate PATH guidance."""
        result = subprocess.run(  # noqa: S603
            [sys.executable, "-m", "ado_git_repo_insights.cli", "doctor"],
            capture_output=True,
            text=True,
            check=False,
        )

        # T018 should skip PATH guidance for doctor command
        guidance_phrase = "not on your PATH"
        guidance_in_stderr = guidance_phrase in result.stderr

        # Doctor reports PATH status in stdout, but T018 shouldn't add to stderr
        assert not guidance_in_stderr, (
            f"T018 guidance should be skipped for doctor: {result.stderr}"
        )

    def test_path_guidance_format_is_actionable(self) -> None:
        """PATH guidance should include actionable instructions."""
        from ado_git_repo_insights.utils.path_utils import format_path_guidance
        from ado_git_repo_insights.utils.shell_detection import detect_shell

        shell = detect_shell()
        guidance = format_path_guidance(Path("/fake/scripts"), shell)

        # Must contain key actionable elements (case-insensitive for path phrase)
        guidance_lower = guidance.lower()
        assert "not on" in guidance_lower
        assert "path" in guidance_lower
        # Check for the scripts dir (handle Windows path separator)
        assert "fake" in guidance
        assert "scripts" in guidance
        assert "setup-path" in guidance  # Reference to automatic fix
