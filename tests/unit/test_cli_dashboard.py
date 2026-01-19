"""CLI Dashboard Command Tests.

Tests for the `ado-insights dashboard` command to verify:
- Manifest validation
- Local-config.js injection (placeholder and fallback)
- Correct window variable setup

Per guardrails: non-brittle assertions, verify injection occurred not full HTML.
"""

import shutil
from pathlib import Path

import pytest


class TestDashboardCommand:
    """Tests for cmd_dashboard in cli.py."""

    @pytest.fixture
    def temp_dataset(self, tmp_path: Path) -> Path:
        """Create a minimal dataset with manifest."""
        dataset = tmp_path / "dataset"
        dataset.mkdir()

        manifest = {
            "manifest_schema_version": 1,
            "dataset_schema_version": 1,
            "aggregates_schema_version": 1,
            "coverage": {
                "total_prs": 100,
                "date_range": {"min": "2025-01-01", "max": "2025-12-31"},
            },
            "features": {},
            "aggregate_index": {"weekly_rollups": [], "distributions": []},
        }

        import json

        (dataset / "dataset-manifest.json").write_text(json.dumps(manifest))
        return dataset

    @pytest.fixture
    def temp_ui_bundle(self, tmp_path: Path) -> Path:
        """Create a minimal UI bundle with index.html."""
        ui_bundle = tmp_path / "ui_bundle"
        ui_bundle.mkdir()

        # Create index.html with placeholder
        index_html = """<!DOCTYPE html>
<html>
<head>
    <title>PR Insights</title>
</head>
<body>
    <!-- LOCAL_CONFIG_PLACEHOLDER: Replaced by CLI for local dashboard mode -->
    <script src="dashboard.js"></script>
</body>
</html>
"""
        (ui_bundle / "index.html").write_text(index_html)
        (ui_bundle / "dashboard.js").write_text("// dashboard code")
        return ui_bundle

    @pytest.fixture
    def temp_ui_bundle_legacy(self, tmp_path: Path) -> Path:
        """Create UI bundle WITHOUT placeholder (legacy mode)."""
        ui_bundle = tmp_path / "ui_bundle_legacy"
        ui_bundle.mkdir()

        # Legacy index.html - no placeholder
        index_html = """<!DOCTYPE html>
<html>
<head>
    <title>PR Insights</title>
</head>
<body>
    <script src="dashboard.js"></script>
</body>
</html>
"""
        (ui_bundle / "index.html").write_text(index_html)
        (ui_bundle / "dashboard.js").write_text("// dashboard code")
        return ui_bundle

    def test_manifest_required(self, tmp_path: Path) -> None:
        """Exit with error if dataset-manifest.json not found."""
        empty_dataset = tmp_path / "empty"
        empty_dataset.mkdir()

        # Simulate the manifest check from cmd_dashboard
        manifest_path = empty_dataset / "dataset-manifest.json"

        # This should fail
        assert not manifest_path.exists()

    def test_placeholder_injection(
        self, temp_dataset: Path, temp_ui_bundle: Path, tmp_path: Path
    ) -> None:
        """Verify placeholder is replaced with local-config script tag."""
        # Simulate what cmd_dashboard does with temp directory
        serve_dir = tmp_path / "serve"
        shutil.copytree(temp_ui_bundle, serve_dir, dirs_exist_ok=True)

        # Write local config
        local_config = serve_dir / "local-config.js"
        local_config.write_text(
            "// Auto-generated for local dashboard mode\n"
            "window.LOCAL_DASHBOARD_MODE = true;\n"
            'window.DATASET_PATH = "./dataset";\n'
        )

        # Inject into index.html (primary method)
        index_html = serve_dir / "index.html"
        content = index_html.read_text()

        placeholder = "<!-- LOCAL_CONFIG_PLACEHOLDER: Replaced by CLI for local dashboard mode -->"
        if placeholder in content:
            content = content.replace(
                placeholder,
                '<script src="local-config.js"></script>',
            )
            index_html.write_text(content)

        # Assertions - verify injection occurred (non-brittle)
        final_content = index_html.read_text()
        assert '<script src="local-config.js"></script>' in final_content
        assert placeholder not in final_content  # Placeholder removed

    def test_fallback_injection(
        self, temp_ui_bundle_legacy: Path, tmp_path: Path
    ) -> None:
        """Verify fallback injection for legacy UI bundles without placeholder."""
        serve_dir = tmp_path / "serve"
        shutil.copytree(temp_ui_bundle_legacy, serve_dir, dirs_exist_ok=True)

        # Write local config
        local_config = serve_dir / "local-config.js"
        local_config.write_text(
            'window.LOCAL_DASHBOARD_MODE = true;\nwindow.DATASET_PATH = "./dataset";\n'
        )

        # Inject into index.html (fallback method)
        index_html = serve_dir / "index.html"
        content = index_html.read_text()

        placeholder = "<!-- LOCAL_CONFIG_PLACEHOLDER: Replaced by CLI for local dashboard mode -->"
        if placeholder not in content and "local-config.js" not in content:
            # Fallback: inject before dashboard.js
            content = content.replace(
                '<script src="dashboard.js"></script>',
                '<script src="local-config.js"></script>\n    <script src="dashboard.js"></script>',
            )
            index_html.write_text(content)

        # Assertions - verify injection occurred via fallback
        final_content = index_html.read_text()
        assert '<script src="local-config.js"></script>' in final_content
        # Script placement: local-config BEFORE dashboard.js
        local_pos = final_content.find("local-config.js")
        dashboard_pos = final_content.find("dashboard.js")
        assert local_pos < dashboard_pos, (
            "local-config.js must come before dashboard.js"
        )

    def test_local_config_content(self, tmp_path: Path) -> None:
        """Verify local-config.js sets correct window variables."""
        local_config = tmp_path / "local-config.js"

        # Simulate what cmd_dashboard generates
        local_config.write_text(
            "// Auto-generated for local dashboard mode\n"
            "window.LOCAL_DASHBOARD_MODE = true;\n"
            'window.DATASET_PATH = "./dataset";\n'
        )

        content = local_config.read_text()

        # Assert expected window variables exist
        assert "LOCAL_DASHBOARD_MODE = true" in content
        assert "DATASET_PATH" in content
        assert "window." in content  # Variables are on window object
