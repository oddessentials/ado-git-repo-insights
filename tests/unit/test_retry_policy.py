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
