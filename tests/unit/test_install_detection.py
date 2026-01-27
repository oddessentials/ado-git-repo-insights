"""Unit tests for installation detection utilities."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

from ado_git_repo_insights.utils.install_detection import (
    detect_installation_method,
    detect_installation_method_for_path,
    find_all_installations,
    get_uninstall_command,
)


class TestDetectInstallationMethod:
    """Tests for detect_installation_method() function."""

    def test_detects_pipx_installation(self) -> None:
        """Detects pipx installation from executable path."""
        pipx_path = Path(
            "/home/user/.local/pipx/venvs/ado-git-repo-insights/bin/python"
        )
        with patch.object(sys, "executable", str(pipx_path)):
            with patch.object(Path, "resolve", return_value=pipx_path):
                # Mock sys.executable directly
                _result = detect_installation_method()  # noqa: F841 - verifies no crash
                # The result depends on actual sys.executable, so we test the helper
                assert detect_installation_method_for_path(pipx_path) == "pipx"

    def test_detects_uv_installation(self) -> None:
        """Detects uv tool installation from executable path."""
        uv_path = Path(
            "/home/user/.local/share/uv/tools/ado-git-repo-insights/bin/python"
        )
        result = detect_installation_method_for_path(uv_path)
        assert result == "uv"

    def test_detects_pip_installation(self) -> None:
        """Detects pip installation from executable path."""
        pip_path = Path("/home/user/.local/bin/python")
        result = detect_installation_method_for_path(pip_path)
        assert result == "pip"

    def test_returns_unknown_for_unrecognized_path(self) -> None:
        """Returns 'unknown' for unrecognized installation paths."""
        unknown_path = Path("/opt/custom/python")
        result = detect_installation_method_for_path(unknown_path)
        assert result == "unknown"


class TestDetectInstallationMethodForPath:
    """Tests for detect_installation_method_for_path() function."""

    def test_pipx_path_linux(self) -> None:
        """Detects pipx on Linux."""
        path = Path("/home/user/.local/pipx/venvs/pkg/bin/ado-insights")
        assert detect_installation_method_for_path(path) == "pipx"

    def test_pipx_path_windows(self) -> None:
        """Detects pipx on Windows."""
        path = Path("C:/Users/user/.local/pipx/venvs/pkg/Scripts/ado-insights.exe")
        assert detect_installation_method_for_path(path) == "pipx"

    def test_uv_path_linux(self) -> None:
        """Detects uv on Linux."""
        path = Path("/home/user/.local/share/uv/tools/pkg/bin/ado-insights")
        assert detect_installation_method_for_path(path) == "uv"

    def test_uv_path_windows(self) -> None:
        """Detects uv on Windows."""
        path = Path("C:/Users/user/.local/share/uv/tools/pkg/Scripts/ado-insights.exe")
        assert detect_installation_method_for_path(path) == "uv"

    def test_pip_user_path_linux(self) -> None:
        """Detects pip user install on Linux."""
        path = Path("/home/user/.local/bin/ado-insights")
        assert detect_installation_method_for_path(path) == "pip"

    def test_pip_scripts_path_windows(self) -> None:
        """Detects pip install on Windows Scripts folder."""
        path = Path(
            "C:/Users/user/AppData/Roaming/Python/Python312/Scripts/ado-insights.exe"
        )
        assert detect_installation_method_for_path(path) == "pip"


class TestFindAllInstallations:
    """Tests for find_all_installations() function."""

    def test_returns_list(self) -> None:
        """Returns a list."""
        result = find_all_installations()
        assert isinstance(result, list)

    def test_returns_tuples_of_path_and_method(self, tmp_path: Path) -> None:
        """Each result is a tuple of (Path, str)."""
        # Create a fake ado-insights executable
        exe_name = "ado-insights.exe" if sys.platform == "win32" else "ado-insights"
        fake_exe = tmp_path / exe_name
        fake_exe.touch()
        if sys.platform != "win32":
            fake_exe.chmod(0o755)

        with patch.dict(os.environ, {"PATH": str(tmp_path)}):
            result = find_all_installations()

        for item in result:
            assert isinstance(item, tuple)
            assert len(item) == 2
            assert isinstance(item[0], Path)
            assert isinstance(item[1], str)

    def test_deduplicates_by_resolved_path(self, tmp_path: Path) -> None:
        """Deduplicates installations by resolved path."""
        # Create a fake executable
        exe_name = "ado-insights.exe" if sys.platform == "win32" else "ado-insights"
        real_dir = tmp_path / "real"
        real_dir.mkdir()
        fake_exe = real_dir / exe_name
        fake_exe.touch()
        if sys.platform != "win32":
            fake_exe.chmod(0o755)

        # Add the same directory twice to PATH
        path_with_duplicates = f"{real_dir}{os.pathsep}{real_dir}"

        with patch.dict(os.environ, {"PATH": path_with_duplicates}):
            result = find_all_installations()

        # Should only appear once
        paths = [p for p, _ in result]
        resolved_fake = fake_exe.resolve()
        assert paths.count(resolved_fake) <= 1

    def test_handles_empty_path(self) -> None:
        """Handles empty PATH gracefully."""
        with patch.dict(os.environ, {"PATH": ""}):
            result = find_all_installations()
            assert result == []

    def test_handles_nonexistent_path_entries(self) -> None:
        """Handles nonexistent directories in PATH gracefully."""
        with patch.dict(os.environ, {"PATH": "/nonexistent/path/12345"}):
            result = find_all_installations()
            # Should not raise, may return empty list
            assert isinstance(result, list)


class TestGetUninstallCommand:
    """Tests for get_uninstall_command() function."""

    def test_pipx_uninstall_command(self) -> None:
        """Returns pipx uninstall command."""
        cmd = get_uninstall_command("pipx")
        assert cmd == "pipx uninstall ado-git-repo-insights"

    def test_uv_uninstall_command(self) -> None:
        """Returns uv uninstall command."""
        cmd = get_uninstall_command("uv")
        assert cmd == "uv tool uninstall ado-git-repo-insights"

    def test_pip_uninstall_command(self) -> None:
        """Returns pip uninstall command."""
        cmd = get_uninstall_command("pip")
        assert cmd == "pip uninstall ado-git-repo-insights"

    def test_unknown_uninstall_command(self) -> None:
        """Returns comment for unknown method."""
        cmd = get_uninstall_command("unknown")
        assert cmd.startswith("#")
        assert "Unable to determine" in cmd
