"""Unit tests for pagination token handling.

Tests cover:
- URL encoding of continuation tokens with special characters
- Token extraction from headers and JSON body
- Proper handling of None/empty tokens
- Query string construction (? vs &)
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import MagicMock

import pytest

from ado_git_repo_insights.extractor.pagination import (
    PaginationError,
    add_continuation_token,
    extract_continuation_token,
)

if TYPE_CHECKING:
    pass


# ============================================================================
# add_continuation_token() Tests
# ============================================================================


class TestAddContinuationToken:
    """Tests for URL encoding of continuation tokens."""

    def test_none_token_returns_url_unchanged(self) -> None:
        """None token returns original URL."""
        url = "https://dev.azure.com/org/proj/_apis/git/pullrequests"
        result = add_continuation_token(url, None)
        assert result == url

    def test_empty_string_token_returns_url_unchanged(self) -> None:
        """Empty string token returns original URL."""
        url = "https://dev.azure.com/org/proj/_apis/git/pullrequests"
        result = add_continuation_token(url, "")
        assert result == url

    def test_encodes_spaces_as_plus(self) -> None:
        """Spaces are encoded as + (quote_plus behavior)."""
        url = "https://example.com/api"
        result = add_continuation_token(url, "token with space")
        assert "token+with+space" in result

    def test_encodes_ampersand(self) -> None:
        """& is encoded to prevent parameter injection."""
        url = "https://example.com/api"
        result = add_continuation_token(url, "foo&bar=baz")
        # %26 is URL-encoded &
        assert "foo%26bar%3Dbaz" in result
        # Should NOT contain unencoded &bar=
        assert "&bar=" not in result

    def test_encodes_equals(self) -> None:
        """= is encoded to prevent parameter injection."""
        url = "https://example.com/api"
        result = add_continuation_token(url, "key=value")
        # %3D is URL-encoded =
        assert "key%3Dvalue" in result

    def test_encodes_plus_sign(self) -> None:
        """+ is encoded (important for ADO tokens)."""
        url = "https://example.com/api"
        result = add_continuation_token(url, "abc+def")
        # %2B is URL-encoded +
        assert "abc%2Bdef" in result

    def test_special_chars_as_single_param(self) -> None:
        """Token with &foo=bar stays as single continuationToken value."""
        url = "https://example.com/api"
        result = add_continuation_token(url, "&foo=bar")

        # Parse the URL to verify it's a single parameter
        from urllib.parse import parse_qs, urlparse

        parsed = urlparse(result)
        params = parse_qs(parsed.query)

        # Should have exactly one parameter: continuationToken
        assert "continuationToken" in params
        assert len(params) == 1
        # The value should be the original token (decoded)
        assert params["continuationToken"][0] == "&foo=bar"

    def test_appends_question_mark_for_url_without_params(self) -> None:
        """URL without query string gets ?continuationToken=..."""
        url = "https://dev.azure.com/org/_apis/teams"
        result = add_continuation_token(url, "abc")
        assert result == "https://dev.azure.com/org/_apis/teams?continuationToken=abc"

    def test_appends_ampersand_for_url_with_params(self) -> None:
        """URL with existing query params gets &continuationToken=..."""
        url = "https://dev.azure.com/org/_apis/teams?api-version=7.0"
        result = add_continuation_token(url, "abc")
        assert (
            result
            == "https://dev.azure.com/org/_apis/teams?api-version=7.0&continuationToken=abc"
        )

    def test_preserves_existing_params(self) -> None:
        """Existing query parameters are preserved."""
        url = "https://example.com/api?foo=bar&baz=qux"
        result = add_continuation_token(url, "token123")

        from urllib.parse import parse_qs, urlparse

        parsed = urlparse(result)
        params = parse_qs(parsed.query)

        assert params["foo"] == ["bar"]
        assert params["baz"] == ["qux"]
        assert params["continuationToken"] == ["token123"]


# ============================================================================
# extract_continuation_token() Tests
# ============================================================================


class TestExtractContinuationToken:
    """Tests for token extraction from response."""

    def test_extracts_from_header(self) -> None:
        """Token is extracted from x-ms-continuationtoken header."""
        response = MagicMock()
        response.headers = {"x-ms-continuationtoken": "header-token-123"}
        response.json.return_value = {}

        token = extract_continuation_token(response)

        assert token == "header-token-123"  # noqa: S105 - not a password

    def test_extracts_from_json_body(self) -> None:
        """Token is extracted from JSON body when not in header."""
        response = MagicMock()
        response.headers = {}
        response.json.return_value = {"continuationToken": "body-token-456"}

        token = extract_continuation_token(response)

        assert token == "body-token-456"  # noqa: S105 - not a password

    def test_header_takes_precedence_over_body(self) -> None:
        """Header token takes precedence if both exist."""
        response = MagicMock()
        response.headers = {"x-ms-continuationtoken": "header-token"}
        response.json.return_value = {"continuationToken": "body-token"}

        token = extract_continuation_token(response)

        assert token == "header-token"  # noqa: S105 - not a password

    def test_returns_none_when_absent(self) -> None:
        """Returns None when no token in header or body."""
        response = MagicMock()
        response.headers = {}
        response.json.return_value = {"value": []}

        token = extract_continuation_token(response)

        assert token is None

    def test_returns_none_for_empty_header(self) -> None:
        """Empty header value is treated as absent."""
        response = MagicMock()
        response.headers = {"x-ms-continuationtoken": ""}
        response.json.return_value = {}

        token = extract_continuation_token(response)

        assert token is None

    def test_returns_none_for_empty_body_token(self) -> None:
        """Empty body token value is treated as absent."""
        response = MagicMock()
        response.headers = {}
        response.json.return_value = {"continuationToken": ""}

        token = extract_continuation_token(response)

        assert token is None

    def test_handles_json_decode_error(self) -> None:
        """Handles JSON decode error gracefully."""
        import json

        response = MagicMock()
        response.headers = {}
        response.json.side_effect = json.JSONDecodeError("test", "test", 0)

        token = extract_continuation_token(response)

        assert token is None

    def test_json_decode_error_logs_debug_message(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """JSON decode errors are logged at debug level for troubleshooting."""
        import json
        import logging

        response = MagicMock()
        response.headers = {}
        response.json.side_effect = json.JSONDecodeError("Unexpected char", "doc", 5)

        with caplog.at_level(
            logging.DEBUG, logger="ado_git_repo_insights.extractor.pagination"
        ):
            token = extract_continuation_token(response)

        assert token is None
        assert "Could not parse JSON for token extraction" in caplog.text
        assert "Unexpected char" in caplog.text

    def test_preserves_special_chars_in_token(self) -> None:
        """Special characters in token are preserved (not decoded)."""
        response = MagicMock()
        response.headers = {"x-ms-continuationtoken": "abc%2Bdef&foo=bar"}
        response.json.return_value = {}

        token = extract_continuation_token(response)

        # Token should be returned as-is, preserving any encoding
        assert token == "abc%2Bdef&foo=bar"  # noqa: S105 - not a password


# ============================================================================
# PaginationError Tests
# ============================================================================


class TestPaginationError:
    """Tests for PaginationError exception."""

    def test_pagination_error_with_message(self) -> None:
        """PaginationError can be raised with message."""
        error = PaginationError("Max pages exceeded")
        assert "Max pages exceeded" in str(error)

    def test_pagination_error_inheritance(self) -> None:
        """PaginationError inherits from Exception."""
        assert issubclass(PaginationError, Exception)
