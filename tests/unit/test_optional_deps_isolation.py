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
        result = subprocess.run(  # noqa: S603
            [sys.executable, "-m", "ado_git_repo_insights.cli", "--help"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, f"CLI help failed: {result.stderr}"
        assert "usage:" in result.stdout.lower() or "ado-insights" in result.stdout

    def test_cli_version_works(self) -> None:
        """CLI version command works without optional deps."""
        result = subprocess.run(  # noqa: S603
            [sys.executable, "-m", "ado_git_repo_insights.cli", "version"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        # Version command should succeed or show help (not ImportError)
        assert "ImportError" not in result.stderr
        assert "ModuleNotFoundError" not in result.stderr

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
            import ado_git_repo_insights.cli  # noqa: F401

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
            import ado_git_repo_insights.ml.forecaster  # noqa: F401

        modules_after = set(sys.modules.keys())
        new_modules = modules_after - modules_before

        # prophet should NOT be in new modules (lazy import)
        assert "prophet" not in new_modules, "prophet was imported at module load time"
