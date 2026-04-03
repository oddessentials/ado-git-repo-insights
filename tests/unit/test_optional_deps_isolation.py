"""Verify CLI entrypoints work without optional dependencies.

This test enforces the safety invariant that optional dependencies
(openai, prophet) must not be imported on default code paths.
"""

from __future__ import annotations

import subprocess
import sys


class TestOptionalDepsIsolation:
    """Ensure CLI works without optional ML dependencies."""

    def test_cli_help_without_optional_deps(self) -> None:
        """Main CLI --help works in minimal environment."""
        # Run CLI help in a subprocess to test import behavior
        result = subprocess.run(
            [sys.executable, "-m", "ado_git_repo_insights.cli", "--help"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, f"CLI help failed: {result.stderr}"
        assert "usage:" in result.stdout.lower() or "ado-insights" in result.stdout

    def test_cli_version_flag_works(self) -> None:
        """--version flag works without optional deps (T-16, FR-030)."""
        result = subprocess.run(
            [sys.executable, "-m", "ado_git_repo_insights", "--version"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, f"--version failed: {result.stderr}"
        assert "ado-insights" in result.stdout
        assert "0.0.0" not in result.stdout

    def test_version_not_zero(self) -> None:
        """__version__ is not '0.0.0' in editable install (T-05, FR-005, SC-006)."""
        from ado_git_repo_insights import __version__

        assert __version__ != "0.0.0", (
            "__version__ must not be the stale 0.0.0 sentinel"
        )
        assert "0.0.0" not in __version__

    def test_version_resolves_in_editable_install(self) -> None:
        """Version resolves to real value in editable install (T-06, FR-006, SC-007)."""
        from ado_git_repo_insights import __version__

        assert __version__ != "unknown (dev)", (
            "Version should resolve via importlib.metadata in editable install"
        )

    def test_cli_import_does_not_load_heavy_deps(self) -> None:
        """cli.py import does NOT load pandas, requests, or yaml (T-07, FR-012, SC-009)."""
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "from ado_git_repo_insights.cli import create_parser; "
                "import sys; "
                "heavy = [m for m in ('pandas', 'requests', 'yaml') if m in sys.modules]; "
                "print(','.join(heavy) if heavy else 'CLEAN')",
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, f"Import check failed: {result.stderr}"
        assert result.stdout.strip() == "CLEAN", (
            f"Heavy deps loaded at import time: {result.stdout.strip()}"
        )

    def test_openai_import_is_lazy(self) -> None:
        """openai is not imported at module load time."""
        # Import the CLI module and check sys.modules
        import importlib

        # Clear any cached imports
        modules_before = set(sys.modules.keys())

        # Import the main CLI module
        if "ado_git_repo_insights.cli" in sys.modules:
            importlib.reload(sys.modules["ado_git_repo_insights.cli"])
        else:
            importlib.import_module("ado_git_repo_insights.cli")

        modules_after = set(sys.modules.keys())
        new_modules = modules_after - modules_before

        # openai should NOT be in new modules (lazy import)
        assert "openai" not in new_modules, "openai was imported at module load time"

    def test_prophet_import_is_lazy(self) -> None:
        """prophet is not imported at module load time."""
        import importlib

        modules_before = set(sys.modules.keys())

        if "ado_git_repo_insights.ml.forecaster" in sys.modules:
            importlib.reload(sys.modules["ado_git_repo_insights.ml.forecaster"])
        else:
            importlib.import_module("ado_git_repo_insights.ml.forecaster")

        modules_after = set(sys.modules.keys())
        new_modules = modules_after - modules_before

        # prophet should NOT be in new modules (lazy import)
        assert "prophet" not in new_modules, "prophet was imported at module load time"
