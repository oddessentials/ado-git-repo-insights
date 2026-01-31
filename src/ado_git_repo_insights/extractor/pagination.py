"""Centralized pagination token handling for Azure DevOps APIs.

This module provides safe URL encoding for continuation tokens to ensure
reliable pagination across all ADO API endpoints (PRs, teams, team members,
PR threads).
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING
from urllib.parse import quote_plus, urlparse

if TYPE_CHECKING:
    import requests

logger = logging.getLogger(__name__)

__all__ = [
    "PaginationError",
    "add_continuation_token",
    "extract_continuation_token",
]


class PaginationError(Exception):
    """Raised when pagination fails or exceeds limits."""

    pass


def add_continuation_token(url: str, token: str | None) -> str:
    """Add a continuation token to a URL with proper encoding.

    Args:
        url: Base URL (may or may not have existing query parameters).
        token: Raw continuation token from ADO API response, or None.

    Returns:
        URL with encoded continuation token appended, or original URL
        if token is None or empty.

    Example:
        >>> add_continuation_token("https://example.com/api", "abc+def")
        'https://example.com/api?continuationToken=abc%2Bdef'

        >>> add_continuation_token("https://example.com/api?v=1", "foo&bar")
        'https://example.com/api?v=1&continuationToken=foo%26bar'
    """
    if not token:
        return url

    # URL-encode the token to handle special characters safely
    encoded_token = quote_plus(token)

    # Determine separator based on existing query string
    parsed = urlparse(url)
    separator = "&" if parsed.query else "?"

    return f"{url}{separator}continuationToken={encoded_token}"


def extract_continuation_token(response: requests.Response) -> str | None:
    """Extract continuation token from ADO API response.

    Checks both header and JSON body for the token. Header takes precedence
    if both are present.

    Args:
        response: A requests.Response object from ADO API call.

    Returns:
        Raw token string, or None if no token present.

    Token Sources (checked in order):
        1. Response header 'x-ms-continuationtoken'
        2. Response JSON field 'continuationToken'
    """
    # Check header first (takes precedence)
    header_token = response.headers.get("x-ms-continuationtoken", "")
    if header_token:
        return header_token

    # Check JSON body
    try:
        body = response.json()
        body_token: str = body.get("continuationToken", "")
        if body_token:
            return body_token
    except (json.JSONDecodeError, ValueError) as e:
        # Response may not be JSON, or may be malformed
        logger.debug("Could not parse JSON for token extraction: %s", e)

    return None
