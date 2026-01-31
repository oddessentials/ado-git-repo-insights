"""
T056: Base path tests for demo dashboard.

Verifies that serving docs/ on a local HTTP server results in zero 404 errors.
All assets and data files must be accessible.
"""

from __future__ import annotations

import contextlib
import http.server
import json
import socket
import socketserver
import threading
import time
import urllib.request
from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest

# Paths relative to repository root
REPO_ROOT = Path(__file__).parent.parent.parent
DOCS_DIR = REPO_ROOT / "docs"
DOCS_DATA = DOCS_DIR / "data"


def find_free_port() -> int:
    """Find an available port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


@contextlib.contextmanager
def serve_directory(directory: Path, port: int) -> Generator[str, None, None]:
    """Context manager to serve a directory via HTTP."""

    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        """HTTP handler that doesn't log to stderr."""

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, directory=str(directory), **kwargs)

        def log_message(self, format: str, *args: Any) -> None:
            pass  # Suppress logging

    with socketserver.TCPServer(("127.0.0.1", port), QuietHandler) as httpd:
        thread = threading.Thread(target=httpd.serve_forever)
        thread.daemon = True
        thread.start()

        # Wait for server to be ready
        time.sleep(0.1)

        try:
            yield f"http://127.0.0.1:{port}"
        finally:
            httpd.shutdown()


def fetch_url(url: str, timeout: float = 5.0) -> tuple[int, bytes]:
    """Fetch a URL and return (status_code, content)."""
    try:
        # noqa: S310 - URL is from test parameters, not user input
        with urllib.request.urlopen(url, timeout=timeout) as response:  # noqa: S310
            return response.status, response.read()
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception:
        return 0, b""


class TestBasePathServing:
    """T056: Verify docs/ serves correctly with zero 404s."""

    @pytest.fixture
    def server_url(self) -> Generator[str, None, None]:
        """Start HTTP server for docs/ directory."""
        if not DOCS_DIR.exists():
            pytest.skip("docs/ directory not found")

        port = find_free_port()
        with serve_directory(DOCS_DIR, port) as url:
            yield url

    def test_index_html_accessible(self, server_url: str) -> None:
        """index.html is accessible at root."""
        status, content = fetch_url(f"{server_url}/")
        assert status == 200, f"Failed to load index.html: status={status}"
        assert b"PR Insights" in content

    def test_all_js_assets_accessible(self, server_url: str) -> None:
        """All JavaScript assets are accessible."""
        js_files = [
            "dashboard.js",
            "dataset-loader.js",
            "artifact-client.js",
            "error-types.js",
            "VSS.SDK.min.js",
        ]

        for js_file in js_files:
            filepath = DOCS_DIR / js_file
            if not filepath.exists():
                continue  # Some files may be optional

            status, _ = fetch_url(f"{server_url}/{js_file}")
            assert status == 200, f"Failed to load {js_file}: status={status}"

    def test_css_accessible(self, server_url: str) -> None:
        """styles.css is accessible."""
        status, _ = fetch_url(f"{server_url}/styles.css")
        assert status == 200, f"Failed to load styles.css: status={status}"

    def test_dataset_manifest_accessible(self, server_url: str) -> None:
        """data/dataset-manifest.json is accessible."""
        status, content = fetch_url(f"{server_url}/data/dataset-manifest.json")
        assert status == 200, f"Failed to load manifest: status={status}"

        # Verify it's valid JSON
        data = json.loads(content)
        assert "aggregate_index" in data

    def test_dimensions_accessible(self, server_url: str) -> None:
        """data/aggregates/dimensions.json is accessible."""
        status, content = fetch_url(f"{server_url}/data/aggregates/dimensions.json")
        assert status == 200, f"Failed to load dimensions: status={status}"

        data = json.loads(content)
        assert "projects" in data  # Organizations are derived from projects

    def test_sample_weekly_rollups_accessible(self, server_url: str) -> None:
        """Sample weekly rollup files are accessible."""
        sample_weeks = ["2021-W01", "2023-W26", "2025-W52"]

        for week in sample_weeks:
            url = f"{server_url}/data/aggregates/weekly_rollups/{week}.json"
            status, content = fetch_url(url)
            assert status == 200, f"Failed to load {week}.json: status={status}"

            data = json.loads(content)
            assert data["week"] == week

    def test_all_distributions_accessible(self, server_url: str) -> None:
        """All distribution files are accessible."""
        for year in range(2021, 2026):
            url = f"{server_url}/data/aggregates/distributions/{year}.json"
            status, content = fetch_url(url)
            assert status == 200, f"Failed to load {year}.json: status={status}"

            data = json.loads(content)
            assert data["year"] == str(year)

    def test_predictions_accessible(self, server_url: str) -> None:
        """data/predictions/trends.json is accessible."""
        status, content = fetch_url(f"{server_url}/data/predictions/trends.json")
        assert status == 200, f"Failed to load predictions: status={status}"

        data = json.loads(content)
        assert "forecasts" in data

    def test_insights_accessible(self, server_url: str) -> None:
        """data/insights/summary.json is accessible."""
        status, content = fetch_url(f"{server_url}/data/insights/summary.json")
        assert status == 200, f"Failed to load insights: status={status}"

        data = json.loads(content)
        assert "insights" in data

    def test_no_404_for_any_data_file(self, server_url: str) -> None:
        """No 404 errors for any file in docs/data/."""
        if not DOCS_DATA.exists():
            pytest.skip("docs/data/ not found")

        errors = []
        for json_file in DOCS_DATA.rglob("*.json"):
            rel_path = json_file.relative_to(DOCS_DIR)
            url = f"{server_url}/{rel_path}".replace("\\", "/")

            status, _ = fetch_url(url)
            if status != 200:
                errors.append(f"{rel_path}: {status}")

        assert not errors, "404 errors found:\n" + "\n".join(errors[:10])


class TestBasePath:
    """Verify base path configuration in index.html."""

    def test_base_href_present(self) -> None:
        """index.html has <base href="./">."""
        index_path = DOCS_DIR / "index.html"
        if not index_path.exists():
            pytest.skip("docs/index.html not found")

        with open(index_path, encoding="utf-8") as f:
            content = f.read()

        assert '<base href="./">' in content, 'Missing <base href="./">'

    def test_local_mode_configured(self) -> None:
        """index.html has LOCAL_DASHBOARD_MODE set."""
        index_path = DOCS_DIR / "index.html"
        if not index_path.exists():
            pytest.skip("docs/index.html not found")

        with open(index_path, encoding="utf-8") as f:
            content = f.read()

        assert "LOCAL_DASHBOARD_MODE" in content
        assert "DATASET_PATH" in content

    def test_synthetic_data_banner_present(self) -> None:
        """index.html has synthetic data disclaimer banner."""
        index_path = DOCS_DIR / "index.html"
        if not index_path.exists():
            pytest.skip("docs/index.html not found")

        with open(index_path, encoding="utf-8") as f:
            content = f.read()

        # Check for banner elements
        assert "demo-banner" in content, "Missing demo banner CSS class"
        assert "synthetic" in content.lower(), "Missing 'synthetic' in banner text"
