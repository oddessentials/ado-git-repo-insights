#!/usr/bin/env python3
"""Verify badge JSON is accessible at the raw GitHub URL.

Retries up to 12 times (60 seconds) to allow for GitHub raw content propagation.

Usage:
    BADGE_URL=https://raw.githubusercontent.com/... python verify-badge-url.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from urllib.parse import urlparse

import requests

# Timeout configuration (seconds)
# Note: urllib.request.urlopen uses a single timeout for the entire operation
# (connect + read). For finer control, consider using requests library.
URL_TIMEOUT_SECONDS = 10

# Allowed URL pattern: raw GitHub content for badges branch
# Format: https://raw.githubusercontent.com/{owner}/{repo}/badges/status.json
ALLOWED_HOST = "raw.githubusercontent.com"
ALLOWED_PATH_PATTERN = re.compile(
    r"^/[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+/badges/status\.json$"
)


def validate_url(url: str) -> bool:
    """Validate URL against strict allowlist for badge JSON.

    Security checks:
    1. HTTPS scheme only (no HTTP, file://, etc.)
    2. Host must be exactly raw.githubusercontent.com
    3. Path must match /{owner}/{repo}/badges/status.json
    4. No query strings allowed (prevents cache bypass attacks)
    5. No URL fragments allowed

    Args:
        url: URL to validate

    Returns:
        True if URL passes all security checks, False otherwise
    """
    try:
        parsed = urlparse(url)

        # Check 1: HTTPS only
        if parsed.scheme != "https":
            print(
                f"::error::URL scheme must be https, got: {parsed.scheme}",
                file=sys.stderr,
            )
            return False

        # Check 2: Exact host match
        if parsed.netloc != ALLOWED_HOST:
            print(
                f"::error::URL host must be {ALLOWED_HOST}, got: {parsed.netloc}",
                file=sys.stderr,
            )
            return False

        # Check 3: Path pattern validation
        if not ALLOWED_PATH_PATTERN.match(parsed.path):
            print(
                f"::error::URL path must match /{{owner}}/{{repo}}/badges/status.json, "
                f"got: {parsed.path}",
                file=sys.stderr,
            )
            return False

        # Check 4: No query strings
        if parsed.query:
            print(
                f"::error::URL must not contain query string, got: ?{parsed.query}",
                file=sys.stderr,
            )
            return False

        # Check 5: No fragments
        if parsed.fragment:
            print(
                f"::error::URL must not contain fragment, got: #{parsed.fragment}",
                file=sys.stderr,
            )
            return False

        return True

    except Exception as e:
        print(f"::error::Failed to parse URL: {e}", file=sys.stderr)
        return False


def main() -> int:
    """Verify badge URL is accessible and contains valid JSON."""
    url = os.environ.get("BADGE_URL")
    if not url:
        print("::error::BADGE_URL environment variable not set", file=sys.stderr)
        return 1

    # Validate URL before opening (S310 - audit URL open for permitted schemes)
    if not validate_url(url):
        return 1

    print(f"Verifying badge JSON at: {url}")
    print(f"Timeout: {URL_TIMEOUT_SECONDS}s per attempt")

    for i in range(1, 13):
        try:
            response = requests.get(url, timeout=URL_TIMEOUT_SECONDS)
            response.raise_for_status()
            data = response.json()
            if "python" in data and "coverage" in data["python"]:
                print("[OK] Badge JSON accessible and valid")
                print(json.dumps(data, indent=2))
                return 0
            else:
                print(f"Invalid JSON structure: {data}")
        except requests.HTTPError as e:
            print(f"HTTP {e.response.status_code}: {e.response.reason}")
        except requests.ConnectionError as e:
            print(f"Connection error: {e}")
        except requests.Timeout:
            print(f"Request timed out after {URL_TIMEOUT_SECONDS}s")
        except json.JSONDecodeError as e:
            print(f"JSON decode error: {e}")
        except Exception as e:
            print(f"Error: {e}")

        print(f"Waiting for raw content propagation... ({i}/12)")
        time.sleep(5)

    print("::error::Badge JSON not accessible after 60s", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
