"""Unit tests for retry policy.

DoD 3.2: Bounded Retry + Backoff
- Retries are bounded and configurable
- Backoff is applied and does not loop indefinitely
- Failures propagate as failed runs (no silent success)
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock, patch

import pytest
import requests

from ado_git_repo_insights.config import APIConfig
from ado_git_repo_insights.extractor.ado_client import ADOClient, ExtractionError
from tests.unit._http_response_factory import make_response


class TestBoundedRetry:
    """Test that retries are bounded per DoD 3.2."""

    def test_max_retries_configurable(self) -> None:
        """Retry count is configurable."""
        config1 = APIConfig(max_retries=1)
        config5 = APIConfig(max_retries=5)

        assert config1.max_retries == 1
        assert config5.max_retries == 5

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_exactly_n_retries(self, mock_get: MagicMock) -> None:
        """Exactly max_retries attempts are made before failure."""
        config = APIConfig(
            max_retries=3,
            retry_delay_seconds=0,
            retry_backoff_multiplier=1.0,
        )
        client = ADOClient("TestOrg", "test-pat", config)

        mock_get.side_effect = requests.RequestException("Fail")

        with pytest.raises(ExtractionError):
            list(
                client.get_pull_requests(
                    "TestProject", date(2024, 1, 1), date(2024, 1, 1)
                )
            )

        assert mock_get.call_count == 3  # Exactly max_retries attempts

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_no_infinite_loop(self, mock_get: MagicMock) -> None:
        """Retries do not loop indefinitely (Invariant 13)."""
        config = APIConfig(
            max_retries=100,  # Even with high retry count
            retry_delay_seconds=0,
            retry_backoff_multiplier=1.0,
        )
        client = ADOClient("TestOrg", "test-pat", config)

        mock_get.side_effect = requests.RequestException("Always fails")

        with pytest.raises(ExtractionError):
            # This should complete in finite time
            list(
                client.get_pull_requests(
                    "TestProject", date(2024, 1, 1), date(2024, 1, 1)
                )
            )

        # Should have stopped at max_retries, not infinite
        assert mock_get.call_count == 100


class TestBackoffBehavior:
    """Test exponential backoff (Invariant 13)."""

    def test_backoff_multiplier_configurable(self) -> None:
        """Backoff multiplier is configurable."""
        config = APIConfig(retry_backoff_multiplier=2.5)
        assert config.retry_backoff_multiplier == 2.5

    def test_initial_delay_configurable(self) -> None:
        """Initial retry delay is configurable."""
        config = APIConfig(retry_delay_seconds=10.0)
        assert config.retry_delay_seconds == 10.0

    @patch("ado_git_repo_insights.extractor.ado_client.time.sleep")
    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_backoff_applies_between_retries(
        self, mock_get: MagicMock, mock_sleep: MagicMock
    ) -> None:
        """Sleep is called between retries with increasing delays."""
        config = APIConfig(
            max_retries=3,
            retry_delay_seconds=1.0,
            retry_backoff_multiplier=2.0,
            rate_limit_sleep_seconds=0,
        )
        client = ADOClient("TestOrg", "test-pat", config)

        mock_get.side_effect = requests.RequestException("Fail")

        with pytest.raises(ExtractionError):
            list(
                client.get_pull_requests(
                    "TestProject", date(2024, 1, 1), date(2024, 1, 1)
                )
            )

        # Should have slept between retries with exponential backoff
        # Retry 1 fails -> sleep(1.0), Retry 2 fails -> sleep(2.0), Retry 3 fails
        sleep_calls = [call[0][0] for call in mock_sleep.call_args_list]

        # First sleep should be initial delay (1.0)
        assert sleep_calls[0] == 1.0
        # Second sleep should be doubled (2.0)
        assert sleep_calls[1] == 2.0


class TestFailurePropagation:
    """Test that failures propagate and don't result in silent success (DoD 3.2)."""

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_failure_raises_extraction_error(self, mock_get: MagicMock) -> None:
        """Failures raise ExtractionError, not silent return."""
        config = APIConfig(max_retries=1, retry_delay_seconds=0)
        client = ADOClient("TestOrg", "test-pat", config)

        mock_get.side_effect = requests.RequestException("Connection failed")

        with pytest.raises(ExtractionError) as exc_info:
            list(
                client.get_pull_requests(
                    "TestProject", date(2024, 1, 1), date(2024, 1, 1)
                )
            )

        assert "Max retries" in str(exc_info.value)
        assert "Connection failed" in str(exc_info.value)

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_http_error_also_fails(self, mock_get: MagicMock) -> None:
        """HTTP errors (4xx, 5xx) also trigger failure."""
        config = APIConfig(max_retries=1, retry_delay_seconds=0)
        client = ADOClient("TestOrg", "test-pat", config)

        mock_get.return_value = make_response(status=401)

        with pytest.raises(ExtractionError):
            list(
                client.get_pull_requests(
                    "TestProject", date(2024, 1, 1), date(2024, 1, 1)
                )
            )

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_error_includes_context(self, mock_get: MagicMock) -> None:
        """Error message includes helpful context (project, date)."""
        config = APIConfig(max_retries=1, retry_delay_seconds=0)
        client = ADOClient("TestOrg", "test-pat", config)

        mock_get.side_effect = requests.RequestException("Timeout")

        with pytest.raises(ExtractionError) as exc_info:
            list(
                client.get_pull_requests(
                    "MyProject", date(2024, 6, 15), date(2024, 6, 15)
                )
            )

        error_msg = str(exc_info.value)
        assert "MyProject" in error_msg
        assert "2024-06-15" in error_msg


class TestOrganizationPreflight:
    """Backfill preflight must stay org-scoped without project-list permissions."""

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_organization_connection_uses_connection_data_endpoint(
        self, mock_get: MagicMock
    ) -> None:
        config = APIConfig(max_retries=1, retry_delay_seconds=0)
        client = ADOClient("TestOrg", "test-pat", config)

        response = MagicMock()
        response.status_code = 200
        response.raise_for_status.return_value = None
        mock_get.return_value = response

        assert client.test_organization_connection() is True
        mock_get.assert_called_once()
        called_url = str(mock_get.call_args.args[0])
        assert "/_apis/connectionData" in called_url
        assert "/_apis/projects" not in called_url

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_organization_connection_failure_reports_org_context(
        self, mock_get: MagicMock
    ) -> None:
        config = APIConfig(max_retries=1, retry_delay_seconds=0)
        client = ADOClient("TestOrg", "test-pat", config)

        mock_get.side_effect = requests.RequestException("401 Unauthorized")

        with pytest.raises(ExtractionError) as exc_info:
            client.test_organization_connection()

        error_msg = str(exc_info.value)
        assert "organization TestOrg" in error_msg
        assert "401 Unauthorized" in error_msg

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_organization_connection_rejects_302_redirect_as_invalid_pat(
        self, mock_get: MagicMock
    ) -> None:
        """Azure DevOps returns HTTP 302 (redirect to sign-in page) for
        invalid/expired PATs.  Because 3xx is not 4xx, ``raise_for_status``
        would not raise — the probe must classify this explicitly as an
        auth failure, otherwise bad-PAT runs silently pass the probe and
        then fail downstream in the per-PR loop (which is not the
        pre-loop-fatal contract §5 promises).
        """
        config = APIConfig(max_retries=1, retry_delay_seconds=0)
        client = ADOClient("TestOrg", "test-pat", config)

        response = MagicMock()
        response.status_code = 302
        response.headers = {
            "Location": "https://spsprodcus6.vssps.visualstudio.com/_signin"
        }
        # raise_for_status() must NOT be relied on here — it does not raise on 3xx.
        response.raise_for_status.return_value = None
        mock_get.return_value = response

        with pytest.raises(ExtractionError) as exc_info:
            client.test_organization_connection()

        error_msg = str(exc_info.value)
        assert "organization TestOrg" in error_msg
        assert "302" in error_msg
        assert (
            "invalid" in error_msg.lower()
            or "expired" in error_msg.lower()
            or "pat" in error_msg.lower()
        ), error_msg

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_organization_connection_disables_redirect_follow(
        self, mock_get: MagicMock
    ) -> None:
        """Structural lock: probe MUST pass ``allow_redirects=False`` so a
        302-to-signin on bad PAT does not silently resolve to a 203 HTML
        page that ``raise_for_status`` accepts.
        """
        config = APIConfig(max_retries=1, retry_delay_seconds=0)
        client = ADOClient("TestOrg", "test-pat", config)

        response = MagicMock()
        response.status_code = 200
        response.raise_for_status.return_value = None
        mock_get.return_value = response

        client.test_organization_connection()
        mock_get.assert_called_once()
        assert mock_get.call_args.kwargs.get("allow_redirects") is False, (
            f"probe must pass allow_redirects=False; got kwargs={mock_get.call_args.kwargs}"
        )


# ---------------------------------------------------------------------------
# Shared HTTP helper: _get_or_raise
# ---------------------------------------------------------------------------
# ``make_response`` lives in tests/unit/_http_response_factory.py so all
# unit tests that stub ``requests.get`` use a single, consistent real-
# Response construction — no ad-hoc MagicMock drift.


class TestGetOrRaise:
    """Behavioral contract for ADOClient._get_or_raise.

    This helper is the single HTTP-GET surface for ADOClient.  Every
    call site — probes, pagination, per-PR thread fetches — routes
    through it so redirect-blindness (HTTP 302 to sign-in when PAT is
    invalid) cannot silently resolve to a 2xx HTML page anywhere.
    """

    def _client(self) -> ADOClient:
        config = APIConfig(max_retries=1, retry_delay_seconds=0)
        return ADOClient("TestOrg", "test-pat", config)

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_returns_response_on_200(self, mock_get: MagicMock) -> None:
        mock_get.return_value = make_response(status=200)
        client = self._client()
        result = client._get_or_raise("https://example.com/api")
        assert result.status_code == 200

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_raises_on_302_with_signin_location_uses_auth_hint(
        self, mock_get: MagicMock
    ) -> None:
        """302 whose Location matches a known sign-in marker surfaces
        the ``likely invalid or expired PAT`` hint.
        """
        mock_get.return_value = make_response(
            status=302,
            location="https://spsprodcus6.vssps.visualstudio.com/_signin?realm=dev.azure.com",
        )
        client = self._client()
        with pytest.raises(ExtractionError) as exc_info:
            client._get_or_raise("https://example.com/api")
        error_msg = str(exc_info.value)
        assert "302" in error_msg
        assert "likely invalid or expired PAT" in error_msg

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_raises_on_302_with_unknown_location_uses_neutral_hint(
        self, mock_get: MagicMock
    ) -> None:
        """302 whose Location does NOT match a sign-in marker surfaces
        a neutral "not a known sign-in endpoint" hint with the Location
        verbatim so operators can diagnose.  All 3xx still raise —
        Location pattern affects the message only, not the control flow.
        """
        mock_get.return_value = make_response(
            status=302,
            location="https://example.com/moved",
        )
        client = self._client()
        with pytest.raises(ExtractionError) as exc_info:
            client._get_or_raise("https://example.com/api")
        error_msg = str(exc_info.value)
        assert "302" in error_msg
        assert "likely invalid or expired PAT" not in error_msg
        assert "sign-in" in error_msg.lower() or "endpoint" in error_msg.lower()
        assert "https://example.com/moved" in error_msg  # Location verbatim

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_snapshot_auth_redirect_error_message_exact(
        self, mock_get: MagicMock
    ) -> None:
        """Exact-string snapshot of the auth-case error message.
        CLI expectations and commit 113ed2fa's shape depend on this
        format staying stable; this test locks it.
        """
        mock_get.return_value = make_response(
            status=302,
            location="https://login.microsoftonline.com/signin/redirect",
        )
        client = self._client()
        with pytest.raises(ExtractionError) as exc_info:
            client._get_or_raise(
                "https://example.com/api", context="TestOrg/TestProject"
            )
        assert str(exc_info.value) == (
            "Failed to connect to TestOrg/TestProject: "
            "unexpected HTTP 302 redirect to "
            "https://login.microsoftonline.com/signin/redirect "
            "(likely invalid or expired PAT)"
        )

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_snapshot_unknown_redirect_error_message_exact(
        self, mock_get: MagicMock
    ) -> None:
        """Exact-string snapshot of the non-signin-Location error message."""
        mock_get.return_value = make_response(
            status=302,
            location="https://example.com/moved",
        )
        client = self._client()
        with pytest.raises(ExtractionError) as exc_info:
            client._get_or_raise(
                "https://example.com/api", context="organization TestOrg"
            )
        assert str(exc_info.value) == (
            "Failed to connect to organization TestOrg: "
            "unexpected HTTP 302 redirect to https://example.com/moved "
            "(redirect target is not a known sign-in endpoint; "
            "PAT may be valid but endpoint may have moved)"
        )

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_disables_redirect_follow(self, mock_get: MagicMock) -> None:
        """Structural lock: helper MUST pass allow_redirects=False."""
        mock_get.return_value = make_response(status=200)
        client = self._client()
        client._get_or_raise("https://example.com/api")
        mock_get.assert_called_once()
        assert mock_get.call_args.kwargs.get("allow_redirects") is False, (
            f"_get_or_raise must pass allow_redirects=False; "
            f"got kwargs={mock_get.call_args.kwargs}"
        )

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_4xx_raises_via_raise_for_status(self, mock_get: MagicMock) -> None:
        """Standard HTTPError path still wraps into ExtractionError
        with __cause__ preserved so callers can inspect it (contract
        the _fetch_page retry loop relies on).
        """
        mock_get.return_value = make_response(status=404)
        client = self._client()
        with pytest.raises(ExtractionError) as exc_info:
            client._get_or_raise(
                "https://example.com/api", context="TestOrg/TestProject"
            )
        assert "TestOrg/TestProject" in str(exc_info.value)
        assert isinstance(exc_info.value.__cause__, requests.HTTPError)

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_request_exception_wrapped_with_context_and_cause(
        self, mock_get: MagicMock
    ) -> None:
        """RequestException is wrapped with context; __cause__ is
        preserved so _fetch_page's retry classification works.
        """
        mock_get.side_effect = requests.RequestException("Connection timed out")
        client = self._client()
        with pytest.raises(ExtractionError) as exc_info:
            client._get_or_raise(
                "https://example.com/api", context="organization TestOrg"
            )
        assert "organization TestOrg" in str(exc_info.value)
        assert "Connection timed out" in str(exc_info.value)
        assert isinstance(exc_info.value.__cause__, requests.RequestException)


class TestAdoClientHttpHardening:
    """Structural lock: every HTTP GET in ADOClient must go through
    ``_get_or_raise``.  Direct ``requests.get(...)`` calls outside the
    helper are forbidden so redirect-blindness can never re-enter via
    a newly-added method that bypasses the helper.
    """

    def test_all_requests_get_calls_live_in_get_or_raise(self) -> None:
        import ast
        from pathlib import Path

        source = Path("src/ado_git_repo_insights/extractor/ado_client.py").read_text(
            encoding="utf-8"
        )
        tree = ast.parse(source)

        # Map each Call node to its enclosing FunctionDef by walking
        # the AST and recording the parent chain.
        parents: dict[ast.AST, ast.AST] = {}
        for node in ast.walk(tree):
            for child in ast.iter_child_nodes(node):
                parents[child] = node

        def enclosing_function(node: ast.AST) -> str | None:
            cur: ast.AST | None = node
            while cur is not None:
                if isinstance(cur, ast.FunctionDef | ast.AsyncFunctionDef):
                    return cur.name
                cur = parents.get(cur)
            return None

        offending: list[tuple[int, str | None]] = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if (
                isinstance(func, ast.Attribute)
                and func.attr == "get"
                and isinstance(func.value, ast.Name)
                and func.value.id == "requests"
            ):
                fn = enclosing_function(node)
                if fn != "_get_or_raise":
                    offending.append((node.lineno, fn))

        assert offending == [], (
            "Direct requests.get(...) calls outside _get_or_raise are "
            "forbidden.  Every HTTP GET in ADOClient must route through "
            "_get_or_raise to enforce the redirect-blindness fix.  "
            f"Offending sites (line, enclosing_function): {offending}"
        )
