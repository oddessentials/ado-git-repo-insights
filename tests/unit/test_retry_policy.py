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

        response = MagicMock()
        response.raise_for_status.side_effect = requests.HTTPError("401 Unauthorized")
        mock_get.return_value = response

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
