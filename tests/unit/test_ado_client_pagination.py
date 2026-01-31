"""Unit tests for ADO client pagination.

DoD 3.1: Pagination Completeness
- ADO extractor must fetch all pages using continuation tokens
- A test simulates >1 page results and confirms completeness
"""

from __future__ import annotations

from datetime import date
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from ado_git_repo_insights.config import APIConfig
from ado_git_repo_insights.extractor.ado_client import ADOClient, ExtractionError


@pytest.fixture
def api_config() -> APIConfig:
    """Create a test API config with fast retries."""
    return APIConfig(
        base_url="https://dev.azure.com",
        version="7.1-preview.1",
        rate_limit_sleep_seconds=0,  # No delay in tests
        max_retries=2,
        retry_delay_seconds=0,  # No delay in tests
        retry_backoff_multiplier=1.0,
    )


@pytest.fixture
def client(api_config: APIConfig) -> ADOClient:
    """Create a test ADO client."""
    return ADOClient(
        organization="TestOrg",
        pat="test-pat",
        config=api_config,
    )


def make_mock_response(
    prs: list[dict[str, Any]],
    continuation_token: str | None = None,
) -> MagicMock:
    """Create a mock requests.Response with PR data."""
    response = MagicMock()
    response.json.return_value = {"value": prs}
    response.headers = {}
    if continuation_token:
        response.headers["x-ms-continuationtoken"] = continuation_token
    response.raise_for_status = MagicMock()
    return response


class TestPaginationCompleteness:
    """Test that pagination fetches all pages (DoD 3.1)."""

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_single_page_no_continuation(
        self, mock_get: MagicMock, client: ADOClient
    ) -> None:
        """Single page without continuation token."""
        prs = [
            {"pullRequestId": 1, "title": "PR 1"},
            {"pullRequestId": 2, "title": "PR 2"},
        ]
        mock_get.return_value = make_mock_response(prs)

        result = list(
            client.get_pull_requests("TestProject", date(2024, 1, 1), date(2024, 1, 1))
        )

        assert len(result) == 2
        assert result[0]["pullRequestId"] == 1
        assert result[1]["pullRequestId"] == 2
        assert client.stats.pages_fetched == 1

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_multiple_pages_with_continuation(
        self, mock_get: MagicMock, client: ADOClient
    ) -> None:
        """Multiple pages with continuation tokens (DoD 3.1)."""
        # Page 1: 2 PRs, has continuation token
        page1_prs = [{"pullRequestId": 1}, {"pullRequestId": 2}]
        page1_response = make_mock_response(page1_prs, "token-page-2")

        # Page 2: 2 PRs, has continuation token
        page2_prs = [{"pullRequestId": 3}, {"pullRequestId": 4}]
        page2_response = make_mock_response(page2_prs, "token-page-3")

        # Page 3: 1 PR, no continuation token (last page)
        page3_prs = [{"pullRequestId": 5}]
        page3_response = make_mock_response(page3_prs, None)

        mock_get.side_effect = [page1_response, page2_response, page3_response]

        result = list(
            client.get_pull_requests("TestProject", date(2024, 1, 1), date(2024, 1, 1))
        )

        # Should have fetched all 5 PRs across 3 pages
        assert len(result) == 5
        assert [pr["pullRequestId"] for pr in result] == [1, 2, 3, 4, 5]
        assert client.stats.pages_fetched == 3
        assert client.stats.total_prs == 5

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_continuation_token_passed_in_url(
        self, mock_get: MagicMock, client: ADOClient
    ) -> None:
        """Continuation token is properly passed in subsequent requests."""
        page1_response = make_mock_response([{"pullRequestId": 1}], "my-token-123")
        page2_response = make_mock_response([{"pullRequestId": 2}], None)
        mock_get.side_effect = [page1_response, page2_response]

        list(
            client.get_pull_requests("TestProject", date(2024, 1, 1), date(2024, 1, 1))
        )

        # Verify second call included continuation token
        calls = mock_get.call_args_list
        assert len(calls) == 2
        second_call_url = calls[1][0][0]  # First positional arg of second call
        assert "continuationToken=my-token-123" in second_call_url

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_empty_response_no_continuation(
        self, mock_get: MagicMock, client: ADOClient
    ) -> None:
        """Empty response with no continuation token."""
        mock_get.return_value = make_mock_response([], None)

        result = list(
            client.get_pull_requests("TestProject", date(2024, 1, 1), date(2024, 1, 1))
        )

        assert len(result) == 0
        assert client.stats.pages_fetched == 1

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_multi_day_range_fetches_each_day(
        self, mock_get: MagicMock, client: ADOClient
    ) -> None:
        """Multi-day range fetches each day separately."""
        # Day 1: 1 PR
        day1_response = make_mock_response([{"pullRequestId": 1}], None)
        # Day 2: 2 PRs
        day2_response = make_mock_response(
            [{"pullRequestId": 2}, {"pullRequestId": 3}], None
        )
        # Day 3: 1 PR
        day3_response = make_mock_response([{"pullRequestId": 4}], None)

        mock_get.side_effect = [day1_response, day2_response, day3_response]

        result = list(
            client.get_pull_requests("TestProject", date(2024, 1, 1), date(2024, 1, 3))
        )

        # Should fetch 3 days, 4 PRs total
        assert len(result) == 4
        assert client.stats.pages_fetched == 3


class TestRetryAndBackoff:
    """Test retry policy and backoff (DoD 3.2, Invariant 13)."""

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_retry_on_transient_failure(
        self, mock_get: MagicMock, client: ADOClient
    ) -> None:
        """Retries on transient failures and succeeds."""
        import requests

        # First call fails, second succeeds
        mock_get.side_effect = [
            requests.RequestException("Connection error"),
            make_mock_response([{"pullRequestId": 1}], None),
        ]

        result = list(
            client.get_pull_requests("TestProject", date(2024, 1, 1), date(2024, 1, 1))
        )

        assert len(result) == 1
        assert client.stats.retries_used == 1
        assert mock_get.call_count == 2

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_fails_after_max_retries(
        self, mock_get: MagicMock, client: ADOClient
    ) -> None:
        """Fails deterministically after max retries (Adjustment 4)."""
        import requests

        # All calls fail
        mock_get.side_effect = requests.RequestException("Persistent failure")

        with pytest.raises(ExtractionError) as exc_info:
            list(
                client.get_pull_requests(
                    "TestProject", date(2024, 1, 1), date(2024, 1, 1)
                )
            )

        assert "Max retries" in str(exc_info.value)
        assert client.stats.retries_used == 2  # max_retries from config

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_partial_failure_fails_entire_run(
        self, mock_get: MagicMock, client: ADOClient
    ) -> None:
        """Day 2 failure fails the entire run (Adjustment 4)."""
        import requests

        # Day 1 succeeds, Day 2 fails
        day1_response = make_mock_response([{"pullRequestId": 1}], None)
        mock_get.side_effect = [
            day1_response,
            requests.RequestException("Day 2 failed"),
            requests.RequestException("Day 2 failed"),  # Retry also fails
        ]

        with pytest.raises(ExtractionError) as exc_info:
            list(
                client.get_pull_requests(
                    "TestProject", date(2024, 1, 1), date(2024, 1, 2)
                )
            )

        # The error should mention the specific date
        assert "2024-01-02" in str(exc_info.value)

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_retry_on_json_decode_error(
        self, mock_get: MagicMock, client: ADOClient
    ) -> None:
        """HTTP 200 with invalid JSON triggers retry and logs error.

        Regression test: JSONDecodeError was not caught, bypassing retry logic.
        """
        import json

        # Create mock response that returns 200 but invalid JSON
        invalid_response = MagicMock()
        invalid_response.status_code = 200
        invalid_response.text = "<!DOCTYPE html><html>Error page</html>"
        invalid_response.headers = {"Content-Type": "text/html"}
        invalid_response.raise_for_status = MagicMock()  # No exception
        invalid_response.json.side_effect = json.JSONDecodeError(
            "Expecting value", "<!DOCTYPE", 0
        )

        # Second call succeeds
        valid_response = make_mock_response([{"pullRequestId": 1}], None)

        mock_get.side_effect = [invalid_response, valid_response]

        result = list(
            client.get_pull_requests("TestProject", date(2024, 1, 1), date(2024, 1, 1))
        )

        # Should succeed after retry
        assert len(result) == 1
        assert client.stats.retries_used == 1
        assert mock_get.call_count == 2

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_json_decode_error_fails_after_max_retries(
        self, mock_get: MagicMock, client: ADOClient
    ) -> None:
        """Persistent invalid JSON fails after max retries."""
        import json

        # All calls return invalid JSON
        invalid_response = MagicMock()
        invalid_response.status_code = 200
        invalid_response.text = "<html>Error</html>"
        invalid_response.headers = {}
        invalid_response.raise_for_status = MagicMock()
        invalid_response.json.side_effect = json.JSONDecodeError(
            "Expecting value", "<html>", 0
        )

        mock_get.return_value = invalid_response

        with pytest.raises(ExtractionError) as exc_info:
            list(
                client.get_pull_requests(
                    "TestProject", date(2024, 1, 1), date(2024, 1, 1)
                )
            )

        assert "Max retries" in str(exc_info.value)
        assert client.stats.retries_used == 2  # max_retries from config


class TestSpecialCharacterTokens:
    """Security regression tests for continuation tokens with special characters (T046)."""

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_token_with_ampersand_encoded(
        self, mock_get: MagicMock, client: ADOClient
    ) -> None:
        """Token with & character is URL-encoded, not interpreted as param separator.

        Regression test (SC-008): Ensures tokens like 'foo&admin=true' don't
        cause parameter injection vulnerabilities.
        """
        # Page 1 returns a token with special characters
        malicious_token = "page2&admin=true&delete=all"  # noqa: S105
        page1_response = make_mock_response([{"pullRequestId": 1}], malicious_token)
        page2_response = make_mock_response([{"pullRequestId": 2}], None)
        mock_get.side_effect = [page1_response, page2_response]

        list(
            client.get_pull_requests("TestProject", date(2024, 1, 1), date(2024, 1, 1))
        )

        # Verify second call has properly encoded token
        calls = mock_get.call_args_list
        second_call_url = calls[1][0][0]

        # The & should be encoded as %26, not treated as param separator
        assert (
            "continuationToken=page2%26admin%3Dtrue%26delete%3Dall" in second_call_url
        )
        # Should NOT have these as separate parameters
        assert "&admin=" not in second_call_url
        assert "&delete=" not in second_call_url

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_token_with_equals_encoded(
        self, mock_get: MagicMock, client: ADOClient
    ) -> None:
        """Token with = character is URL-encoded.

        Ensures tokens containing = don't corrupt query string parsing.
        """
        token_with_equals = "key=value=extra"  # noqa: S105
        page1_response = make_mock_response([{"pullRequestId": 1}], token_with_equals)
        page2_response = make_mock_response([{"pullRequestId": 2}], None)
        mock_get.side_effect = [page1_response, page2_response]

        list(
            client.get_pull_requests("TestProject", date(2024, 1, 1), date(2024, 1, 1))
        )

        calls = mock_get.call_args_list
        second_call_url = calls[1][0][0]

        # = should be encoded as %3D
        assert "continuationToken=key%3Dvalue%3Dextra" in second_call_url

    @patch("ado_git_repo_insights.extractor.ado_client.requests.get")
    def test_token_with_plus_and_space_encoded(
        self, mock_get: MagicMock, client: ADOClient
    ) -> None:
        """Token with + and space characters is properly encoded.

        In URL encoding, spaces become + and literal + becomes %2B.
        """
        token_with_special = "a+b c"  # noqa: S105 - continuation token, not password
        page1_response = make_mock_response([{"pullRequestId": 1}], token_with_special)
        page2_response = make_mock_response([{"pullRequestId": 2}], None)
        mock_get.side_effect = [page1_response, page2_response]

        list(
            client.get_pull_requests("TestProject", date(2024, 1, 1), date(2024, 1, 1))
        )

        calls = mock_get.call_args_list
        second_call_url = calls[1][0][0]

        # + should be %2B, space should be +
        assert "continuationToken=a%2Bb+c" in second_call_url
