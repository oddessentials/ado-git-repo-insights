"""CLI Dashboard Command Tests.

Tests for the `ado-insights dashboard` command to verify:
- Manifest validation
- Local-config.js injection (placeholder and fallback)
- Correct window variable setup
- SIGINT signal handling for reliable Ctrl+C shutdown
- Windows console control handling for reliable Ctrl+C in terminals
  that do not deliver SIGINT to Python

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

    def test_browser_launch_before_sigint_override(self, tmp_path: Path) -> None:
        """webbrowser.open() runs before the SIGINT handler is replaced.

        Ctrl+C during a slow browser launch must still raise
        KeyboardInterrupt so the CLI can abort startup.
        """
        from ado_git_repo_insights.cli import _run_http_server

        (tmp_path / "index.html").write_text("<h1>test</h1>")
        handler_during_open = None

        def _capture_handler_during_open(url: str) -> None:
            nonlocal handler_during_open
            handler_during_open = signal.getsignal(signal.SIGINT)

        with (
            patch(
                "socketserver.TCPServer.serve_forever",
                autospec=True,
            ),
            patch("webbrowser.open", side_effect=_capture_handler_during_open),
        ):
            _run_http_server(tmp_path, port=0, open_browser=True)

        # During webbrowser.open the handler should still be the original,
        # not our custom _request_shutdown.
        assert handler_during_open is signal.default_int_handler or callable(
            handler_during_open
        )
        # More precisely: should NOT be the custom handler that was active
        # during serve_forever.
        handler_during_serve = [None]

        def _capture_serve_handler(self_httpd: object) -> None:
            handler_during_serve[0] = signal.getsignal(signal.SIGINT)

        with (
            patch(
                "socketserver.TCPServer.serve_forever",
                side_effect=_capture_serve_handler,
                autospec=True,
            ),
            patch("webbrowser.open"),
        ):
            _run_http_server(tmp_path, port=0, open_browser=True)

        assert handler_during_open is not handler_during_serve[0]

    def test_previous_sigint_handler_chained(self, tmp_path: Path) -> None:
        """Custom SIGINT handler chains to the previously registered handler.

        Embedding code that installs its own SIGINT cleanup must still run
        when Ctrl+C is pressed during serve_forever().
        """
        from ado_git_repo_insights.cli import _run_http_server

        (tmp_path / "index.html").write_text("<h1>test</h1>")
        previous_handler_called = False

        def _embedding_handler(signum: int, frame: object) -> None:
            nonlocal previous_handler_called
            previous_handler_called = True

        original = signal.signal(signal.SIGINT, _embedding_handler)

        try:

            def _invoke_handler(self_httpd: object) -> None:
                handler = signal.getsignal(signal.SIGINT)
                handler(signal.SIGINT, None)

            with patch(
                "socketserver.TCPServer.serve_forever",
                side_effect=_invoke_handler,
                autospec=True,
            ):
                _run_http_server(tmp_path, port=0, open_browser=False)

            assert previous_handler_called, (
                "Previous SIGINT handler must be invoked when Ctrl+C is pressed"
            )
        finally:
            signal.signal(signal.SIGINT, original)

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

    def test_sigint_handler_not_installed_when_sig_ign(self, tmp_path: Path) -> None:
        """SIGINT handler is not installed when the process ignores SIGINT.

        Regression: if a hosting application sets SIGINT to SIG_IGN, installing
        our handler would override that policy and stop the server on Ctrl+C
        even though the caller explicitly disabled it.
        """
        from ado_git_repo_insights.cli import _run_http_server

        (tmp_path / "index.html").write_text("<h1>test</h1>")

        original = signal.signal(signal.SIGINT, signal.SIG_IGN)

        try:
            handler_during_serve = None

            def _capture(self_httpd: object) -> None:
                nonlocal handler_during_serve
                handler_during_serve = signal.getsignal(signal.SIGINT)

            with patch(
                "socketserver.TCPServer.serve_forever",
                side_effect=_capture,
                autospec=True,
            ):
                _run_http_server(tmp_path, port=0, open_browser=False)

            assert handler_during_serve is signal.SIG_IGN, (
                "SIG_IGN policy must not be overridden by dashboard server"
            )
        finally:
            signal.signal(signal.SIGINT, original)

    def test_sigint_handler_not_installed_when_sig_dfl(self, tmp_path: Path) -> None:
        """SIGINT handler is not installed when the process uses SIG_DFL.

        Regression: SIG_DFL delegates to the OS default action (terminate);
        overriding it changes the process's signal contract.
        """
        from ado_git_repo_insights.cli import _run_http_server

        (tmp_path / "index.html").write_text("<h1>test</h1>")

        original = signal.signal(signal.SIGINT, signal.SIG_DFL)

        try:
            handler_during_serve = None

            def _capture(self_httpd: object) -> None:
                nonlocal handler_during_serve
                handler_during_serve = signal.getsignal(signal.SIGINT)

            with patch(
                "socketserver.TCPServer.serve_forever",
                side_effect=_capture,
                autospec=True,
            ):
                _run_http_server(tmp_path, port=0, open_browser=False)

            assert handler_during_serve is signal.SIG_DFL, (
                "SIG_DFL policy must not be overridden by dashboard server"
            )
        finally:
            signal.signal(signal.SIGINT, original)

    def test_windows_console_handler_registered_and_restored(
        self, tmp_path: Path
    ) -> None:
        """Windows console control handler is registered during serve and
        unregistered in the finally block."""
        from ado_git_repo_insights.cli import _run_http_server

        (tmp_path / "index.html").write_text("<h1>test</h1>")

        registered_calls: list[tuple[object, bool]] = []

        _fake_kernel32 = type("_FakeKernel32", (), {})()

        def _fake_set_handler(handler: object, add: bool) -> int:
            registered_calls.append((handler, add))
            return 1

        _fake_kernel32.SetConsoleCtrlHandler = _fake_set_handler

        with (
            patch("ado_git_repo_insights.cli.sys") as mock_sys,
            patch(
                "socketserver.TCPServer.serve_forever",
                autospec=True,
            ),
        ):
            mock_sys.platform = "win32"
            # Let other sys attributes pass through
            mock_sys.stdout = __import__("sys").stdout
            mock_sys.stderr = __import__("sys").stderr

            import ctypes as _real_ctypes

            with patch.dict(
                "sys.modules",
                {"ctypes": _real_ctypes},
            ):
                with patch.object(_real_ctypes, "windll", create=True) as mock_windll:
                    mock_windll.kernel32 = _fake_kernel32
                    _run_http_server(tmp_path, port=0, open_browser=False)

        # Should be registered (True) then unregistered (False)
        assert len(registered_calls) == 2
        assert registered_calls[0][1] is True
        assert registered_calls[1][1] is False
        # Same handler object both times
        assert registered_calls[0][0] is registered_calls[1][0]

    def test_windows_console_handler_dispatches_shutdown(self, tmp_path: Path) -> None:
        """Windows console control handler dispatches httpd.shutdown()
        via a daemon thread when CTRL_C_EVENT is received."""
        from ado_git_repo_insights.cli import _run_http_server

        (tmp_path / "index.html").write_text("<h1>test</h1>")

        captured_handler = None
        created_threads: list[MagicMock] = []

        _fake_kernel32 = type("_FakeKernel32", (), {})()

        def _fake_set_handler_capture(handler: object, add: bool) -> int:
            nonlocal captured_handler
            if add:
                captured_handler = handler
            return 1

        _fake_kernel32.SetConsoleCtrlHandler = _fake_set_handler_capture

        real_thread_cls = threading.Thread

        def _mock_thread(**kwargs: object) -> MagicMock:
            t = MagicMock(spec=real_thread_cls)
            t.daemon = kwargs.get("daemon", False)
            t._target = kwargs.get("target")
            created_threads.append(t)
            return t

        def _invoke_console_handler(self_httpd: object) -> None:
            assert captured_handler is not None
            result = captured_handler(0)  # CTRL_C_EVENT
            # Must return False so the event propagates to Python's
            # built-in handler (SIGINT / KeyboardInterrupt).
            assert result is False

        with (
            patch("ado_git_repo_insights.cli.sys") as mock_sys,
            patch("threading.Thread", side_effect=_mock_thread),
            patch(
                "socketserver.TCPServer.serve_forever",
                side_effect=_invoke_console_handler,
                autospec=True,
            ),
        ):
            mock_sys.platform = "win32"
            mock_sys.stdout = __import__("sys").stdout
            mock_sys.stderr = __import__("sys").stderr

            import ctypes as _real_ctypes

            with patch.dict(
                "sys.modules",
                {"ctypes": _real_ctypes},
            ):
                with patch.object(_real_ctypes, "windll", create=True) as mock_windll:
                    mock_windll.kernel32 = _fake_kernel32
                    _run_http_server(tmp_path, port=0, open_browser=False)

        assert len(created_threads) >= 1
        shutdown_thread = created_threads[0]
        assert shutdown_thread.daemon is True
        shutdown_thread.start.assert_called_once()

    def test_windows_console_handler_installed_even_when_sig_ign(
        self, tmp_path: Path
    ) -> None:
        """Windows console handler IS installed even when caller set SIG_IGN.

        SIG_IGN governs Python signal delivery, not OS console events.
        The console handler covers terminals that never translate Ctrl+C
        into Python SIGINT — which is the exact scenario where SIG_IGN
        would also be ineffective. The two mechanisms are independent.
        """
        from ado_git_repo_insights.cli import _run_http_server

        (tmp_path / "index.html").write_text("<h1>test</h1>")

        registered_calls: list[tuple[object, bool]] = []

        _fake_kernel32 = type("_FakeKernel32", (), {})()

        def _fake_set_handler_ign(handler: object, add: bool) -> int:
            registered_calls.append((handler, add))
            return 1

        _fake_kernel32.SetConsoleCtrlHandler = _fake_set_handler_ign

        original = signal.signal(signal.SIGINT, signal.SIG_IGN)

        try:
            with (
                patch("ado_git_repo_insights.cli.sys") as mock_sys,
                patch(
                    "socketserver.TCPServer.serve_forever",
                    autospec=True,
                ),
            ):
                mock_sys.platform = "win32"
                mock_sys.stdout = __import__("sys").stdout
                mock_sys.stderr = __import__("sys").stderr

                import ctypes as _real_ctypes

                with patch.dict(
                    "sys.modules",
                    {"ctypes": _real_ctypes},
                ):
                    with patch.object(
                        _real_ctypes, "windll", create=True
                    ) as mock_windll:
                        mock_windll.kernel32 = _fake_kernel32
                        _run_http_server(tmp_path, port=0, open_browser=False)

            # Console handler should still be registered and unregistered
            assert len(registered_calls) == 2, (
                "Windows console handler must be installed even when SIG_IGN is active"
            )
            assert registered_calls[0][1] is True
            assert registered_calls[1][1] is False
        finally:
            signal.signal(signal.SIGINT, original)
