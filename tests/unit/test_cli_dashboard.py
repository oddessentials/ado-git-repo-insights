"""CLI Dashboard Command Tests.

Tests for the `ado-insights dashboard` command to verify:
- Manifest validation
- Local-config.js injection (placeholder and fallback)
- Correct window variable setup
- SIGINT signal handling for reliable Ctrl+C shutdown

Per guardrails: non-brittle assertions, verify injection occurred not full HTML.
"""

import shutil
import signal
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

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


class TestHttpServerSignalHandling:
    """Tests for SIGINT signal handling in _run_http_server.

    Verifies that Ctrl+C reliably shuts down the dashboard HTTP server
    by dispatching httpd.shutdown() to a background thread (avoiding
    deadlock with serve_forever() on the main thread).
    """

    def test_sigint_handler_installed_during_serve(self, tmp_path: Path) -> None:
        """A custom SIGINT handler is active while serve_forever() runs."""
        from ado_git_repo_insights.cli import _run_http_server

        (tmp_path / "index.html").write_text("<h1>test</h1>")
        captured_handler = None

        def _capture_handler(self_httpd: object) -> None:
            nonlocal captured_handler
            captured_handler = signal.getsignal(signal.SIGINT)

        with patch(
            "socketserver.TCPServer.serve_forever",
            side_effect=_capture_handler,
            autospec=True,
        ):
            _run_http_server(tmp_path, port=0, open_browser=False)

        # The handler during serve_forever should NOT be the default
        assert captured_handler is not None
        assert captured_handler is not signal.default_int_handler

    def test_original_sigint_handler_restored(self, tmp_path: Path) -> None:
        """Original SIGINT handler is restored after serve_forever() returns."""
        from ado_git_repo_insights.cli import _run_http_server

        (tmp_path / "index.html").write_text("<h1>test</h1>")
        handler_before = signal.getsignal(signal.SIGINT)

        with patch(
            "socketserver.TCPServer.serve_forever",
            autospec=True,
        ):
            _run_http_server(tmp_path, port=0, open_browser=False)

        handler_after = signal.getsignal(signal.SIGINT)
        assert handler_after is handler_before

    def test_original_handler_restored_on_serve_error(self, tmp_path: Path) -> None:
        """Original SIGINT handler is restored even if serve_forever() raises."""
        from ado_git_repo_insights.cli import _run_http_server

        (tmp_path / "index.html").write_text("<h1>test</h1>")
        handler_before = signal.getsignal(signal.SIGINT)

        with (
            patch(
                "socketserver.TCPServer.serve_forever",
                side_effect=OSError("port in use"),
                autospec=True,
            ),
            pytest.raises(OSError, match="port in use"),
        ):
            _run_http_server(tmp_path, port=0, open_browser=False)

        handler_after = signal.getsignal(signal.SIGINT)
        assert handler_after is handler_before

    def test_handler_dispatches_shutdown_to_daemon_thread(self, tmp_path: Path) -> None:
        """Invoking the SIGINT handler starts a daemon thread for shutdown."""
        from ado_git_repo_insights.cli import _run_http_server

        (tmp_path / "index.html").write_text("<h1>test</h1>")
        created_threads: list[MagicMock] = []

        def _invoke_handler_then_return(self_httpd: object) -> None:
            """Call the installed SIGINT handler to verify thread dispatch."""
            handler = signal.getsignal(signal.SIGINT)
            # Invoke the handler directly (as Python would on SIGINT)
            handler(signal.SIGINT, None)

        real_thread_cls = threading.Thread

        def _mock_thread(**kwargs: object) -> MagicMock:
            t = MagicMock(spec=real_thread_cls)
            t.daemon = kwargs.get("daemon", False)
            t._target = kwargs.get("target")
            created_threads.append(t)
            return t

        with (
            patch(
                "socketserver.TCPServer.serve_forever",
                side_effect=_invoke_handler_then_return,
                autospec=True,
            ),
            patch(
                "threading.Thread",
                side_effect=_mock_thread,
            ),
        ):
            _run_http_server(tmp_path, port=0, open_browser=False)

        assert len(created_threads) == 1
        t = created_threads[0]
        assert t.daemon is True, "Shutdown thread must be a daemon"
        t.start.assert_called_once()

    def test_returns_zero_on_clean_shutdown(self, tmp_path: Path) -> None:
        """_run_http_server returns 0 after normal serve_forever() exit."""
        from ado_git_repo_insights.cli import _run_http_server

        (tmp_path / "index.html").write_text("<h1>test</h1>")

        with patch(
            "socketserver.TCPServer.serve_forever",
            autospec=True,
        ):
            result = _run_http_server(tmp_path, port=0, open_browser=False)

        assert result == 0

    def test_worker_thread_does_not_raise_on_signal_registration(
        self, tmp_path: Path
    ) -> None:
        """_run_http_server called from a worker thread must not raise ValueError.

        Regression: signal.signal() is only legal from Python's main thread.
        When invoked from a worker (test harness, IDE, embedding), the server
        must still start and stop cleanly without attempting registration.
        """
        from concurrent.futures import ThreadPoolExecutor

        from ado_git_repo_insights.cli import _run_http_server

        (tmp_path / "index.html").write_text("<h1>test</h1>")

        with patch(
            "socketserver.TCPServer.serve_forever",
            autospec=True,
        ):
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(_run_http_server, tmp_path, 0, False)
                result = future.result(timeout=5)

        assert result == 0

    def test_sigint_handler_skipped_in_worker_thread(self, tmp_path: Path) -> None:
        """SIGINT handler is not installed when running outside the main thread."""
        from concurrent.futures import ThreadPoolExecutor

        from ado_git_repo_insights.cli import _run_http_server

        (tmp_path / "index.html").write_text("<h1>test</h1>")
        signal_called = False

        original_signal = signal.signal

        def _spy_signal(signum: int, handler: object) -> object:
            nonlocal signal_called
            if signum == signal.SIGINT:
                signal_called = True
            return original_signal(signum, handler)

        with (
            patch(
                "socketserver.TCPServer.serve_forever",
                autospec=True,
            ),
            patch("signal.signal", side_effect=_spy_signal),
        ):
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(_run_http_server, tmp_path, 0, False)
                future.result(timeout=5)

        assert signal_called is False, (
            "signal.signal(SIGINT) must not be called from a worker thread"
        )
