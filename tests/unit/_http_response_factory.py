"""Shared test helper: build real ``requests.Response`` objects.

Used across unit tests that stub ``requests.get`` — constructs a real
``requests.Response`` instead of a ``MagicMock`` so tests exercise the
actual requests-library semantics that ``ADOClient._get_or_raise``
depends on (status-code integer comparison for the 3xx branch,
header access, ``raise_for_status`` 4xx/5xx behavior).

Centralized here so tests cannot drift into ad-hoc ``MagicMock()``
patterns that accidentally skip the helper's real contract.

Filename leads with ``_`` so pytest collection (default ``test_*``
pattern) does not pick it up as a test file.
"""

from __future__ import annotations

import json as _json

import requests


def make_response(
    status: int = 200,
    location: str | None = None,
    content: bytes = b"{}",
    json_body: object = None,
    url: str = "https://example.com/api",
) -> requests.Response:
    """Build a minimal real ``requests.Response``.

    Args:
        status: HTTP status code.
        location: If set, added as the ``Location`` response header
            (used by the redirect branch in ``_get_or_raise``).
        content: Raw bytes for ``response.content`` (and ``.json()``).
            Defaults to an empty JSON object so ``.json()`` succeeds
            without the caller having to pass JSON every time.
            Ignored when ``json_body`` is provided.
        json_body: Python object to JSON-serialize as the response body.
            Overrides ``content`` when provided.  Convenience for tests
            that would otherwise have to write
            ``content=json.dumps({...}).encode()``.
        url: Request URL recorded on the response.

    Returns:
        A real ``requests.Response`` with just enough state for the
        helper's redirect-check / ``raise_for_status`` paths.
    """
    r = requests.Response()
    r.status_code = status
    if json_body is not None:
        r._content = _json.dumps(json_body).encode()
    else:
        r._content = content
    r.url = url
    if location is not None:
        r.headers["Location"] = location
    return r
