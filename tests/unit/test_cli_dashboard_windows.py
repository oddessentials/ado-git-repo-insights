"""Windows-only CLI dashboard tests.

Tests for Windows console control handler (SetConsoleCtrlHandler).
This file is excluded from collection on non-Windows platforms via
conftest.py collect_ignore_glob, so these tests are never counted
as skipped and do not violate the zero-skip CI policy.
"""

from __future__ import annotations

import signal
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch


class TestWindowsConsoleHandler:
    """Tests for Windows SetConsoleCtrlHandler in _run_http_server."""

    def test_console_handler_registered_and_restored(self, tmp_path: Path) -> None:
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

        assert len(registered_calls) == 2
        assert registered_calls[0][1] is True
        assert registered_calls[1][1] is False
        assert registered_calls[0][0] is registered_calls[1][0]

    def test_console_handler_dispatches_shutdown(self, tmp_path: Path) -> None:
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

    def test_console_handler_installed_even_when_sig_ign(self, tmp_path: Path) -> None:
        """Windows console handler IS installed even when caller set SIG_IGN."""
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

            assert len(registered_calls) == 2, (
                "Windows console handler must be installed even when SIG_IGN is active"
            )
            assert registered_calls[0][1] is True
            assert registered_calls[1][1] is False
        finally:
            signal.signal(signal.SIGINT, original)
