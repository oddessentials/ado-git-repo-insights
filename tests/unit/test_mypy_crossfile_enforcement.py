"""Tests that mypy cross-file type enforcement is active for scripts/.

These tests guard against regressions where demo_generation_common exports
silently become Any — either from ignore_missing_imports being re-added
or from mypy_path misconfiguration.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


class TestMypyScriptsConfig:
    """Guard the mypy configuration that enables cross-file checking."""

    def test_demo_generation_common_not_in_ignore_missing_imports(self) -> None:
        """demo_generation_common must not be exempted from import resolution."""
        import tomllib

        config = tomllib.loads(
            (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        )
        overrides = config.get("tool", {}).get("mypy", {}).get("overrides", [])
        for override in overrides:
            if override.get("ignore_missing_imports"):
                ignored = override.get("module", [])
                if isinstance(ignored, str):
                    ignored = [ignored]
                assert "demo_generation_common" not in ignored, (
                    "demo_generation_common must not be in ignore_missing_imports — "
                    "this would silently make all its exports Any for callers"
                )
                assert "demo_shell" not in ignored, (
                    "demo_shell must not be in ignore_missing_imports"
                )

    def test_mypy_path_includes_scripts(self) -> None:
        """mypy_path must include 'scripts' so bare imports resolve."""
        import tomllib

        config = tomllib.loads(
            (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        )
        mypy_path = config.get("tool", {}).get("mypy", {}).get("mypy_path", [])
        assert "scripts" in mypy_path, (
            "mypy_path must include 'scripts' so that "
            "'from demo_generation_common import ...' resolves for mypy"
        )

    def test_scripts_override_covers_all_valid_modules(self) -> None:
        """Every valid-identifier script module must appear in the relaxed override.

        Without scripts/__init__.py, 'scripts.*' no longer matches.
        This test fails when a new script is added but not listed.
        """
        import tomllib

        config = tomllib.loads(
            (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        )
        overrides = config.get("tool", {}).get("mypy", {}).get("overrides", [])

        # Find the override that lists script modules (has disallow_any_generics)
        override_modules: set[str] = set()
        for override in overrides:
            modules = override.get("module", [])
            if isinstance(modules, str):
                modules = [modules]
            if override.get("disallow_any_generics") is False and any(
                m in modules for m in ("demo_generation_common", "run_repo_hook")
            ):
                override_modules.update(modules)

        # Scan scripts/ for valid-identifier .py files
        scripts_dir = REPO_ROOT / "scripts"
        expected: set[str] = set()
        for f in scripts_dir.glob("*.py"):
            name = f.stem
            if name == "__init__":
                continue
            if name.isidentifier():
                expected.add(name)

        missing = expected - override_modules
        assert not missing, (
            f"Script modules missing from mypy override: {sorted(missing)}. "
            "Add them to the [[tool.mypy.overrides]] block in pyproject.toml."
        )

    def test_scripts_init_py_does_not_exist(self) -> None:
        """scripts/__init__.py must not exist — it conflicts with mypy_path resolution."""
        init_path = REPO_ROOT / "scripts" / "__init__.py"
        assert not init_path.exists(), (
            "scripts/__init__.py must not exist. It creates a dual-name conflict "
            "with mypy_path=['scripts'] (modules resolve as both scripts.X and X). "
            "The mypy override lists modules explicitly instead."
        )
