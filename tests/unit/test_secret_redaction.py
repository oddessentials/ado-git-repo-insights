"""Unit tests for secret redaction.

DoD 5.2: Secrets Never Logged
- PAT is never printed, even in debug logs
"""

from __future__ import annotations

import logging
from unittest.mock import patch

import pytest

from ado_git_repo_insights.config import APIConfig, Config


class TestSecretRedaction:
    """Test that secrets are never logged (Invariant 19)."""

    def test_config_log_summary_masks_pat(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Config.log_summary() does not log the full PAT."""
        config = Config(
            organization="TestOrg",
            projects=["TestProject"],
            pat="ghp_1234567890abcdefABCDEF1234567890abc",  # Fake token
        )

        with caplog.at_level(logging.INFO):
            config.log_summary()

        # PAT should not appear in any log message
        full_log = caplog.text
        assert "ghp_1234567890abcdefABCDEF1234567890abc" not in full_log

        # Should show masked version
        assert "****" in full_log or "***" in full_log

    def test_config_repr_masks_pat(self) -> None:
        """Config repr/str does not expose the PAT."""
        config = Config(
            organization="TestOrg",
            projects=["TestProject"],
            pat="secret_token_value_here",
        )

        repr_str = repr(config)
        str_str = str(config)

        assert "secret_token_value_here" not in repr_str
        assert "secret_token_value_here" not in str_str

    def test_ado_client_does_not_log_auth_header(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """ADO client does not log Authorization header."""
        from ado_git_repo_insights.extractor.ado_client import ADOClient

        api_config = APIConfig()

        with caplog.at_level(logging.DEBUG):
            client = ADOClient(
                organization="TestOrg",
                pat="my_secret_pat_value",
                config=api_config,
            )

        # Check the auth header was built but not logged
        assert "Authorization" in client.headers
        assert "my_secret_pat_value" not in caplog.text
        assert "Basic" not in caplog.text  # Base64 encoded value

    def test_pat_not_in_exception_messages(self) -> None:
        """PAT is not exposed in exception messages."""
        from ado_git_repo_insights.extractor.ado_client import (
            ADOClient,
            ExtractionError,
        )

        api_config = APIConfig(max_retries=1, retry_delay_seconds=0)

        with patch(
            "ado_git_repo_insights.extractor.ado_client.requests.get"
        ) as mock_get:
            import requests

            mock_get.side_effect = requests.RequestException("Connection failed")

            client = ADOClient(
                organization="TestOrg",
                pat="super_secret_token_123",
                config=api_config,
            )

            with pytest.raises(ExtractionError) as exc_info:
                client.test_connection("TestProject")

            # PAT should not be in the error message
            assert "super_secret_token_123" not in str(exc_info.value)

    def test_error_handler_does_not_log_pat(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Error handling does not accidentally log the PAT."""
        from ado_git_repo_insights.extractor.ado_client import ADOClient

        api_config = APIConfig(max_retries=1, retry_delay_seconds=0)

        with patch(
            "ado_git_repo_insights.extractor.ado_client.requests.get"
        ) as mock_get:
            import requests

            mock_get.side_effect = requests.RequestException("Auth failed")

            with caplog.at_level(logging.WARNING):
                client = ADOClient(
                    organization="TestOrg",
                    pat="token_should_not_appear",
                    config=api_config,
                )

                try:
                    client.test_connection("TestProject")
                except Exception:  # noqa: S110
                    pass  # Intentional: testing that errors don't leak secrets

            assert "token_should_not_appear" not in caplog.text
