#!/usr/bin/env python3
"""Verify badge JSON is accessible at the raw GitHub URL.

Retries up to 12 times (60 seconds) to allow for GitHub raw content propagation.

Usage:
    BADGE_URL=https://raw.githubusercontent.com/... python verify-badge-url.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse


def validate_url(url: str) -> bool:
    """Validate URL is HTTPS to raw.githubusercontent.com.

    Args:
        url: URL to validate

    Returns:
        True if URL is safe to open, False otherwise
    """
    try:
        parsed = urlparse(url)
        # Only allow HTTPS scheme
        if parsed.scheme != "https":
            print(
                f"::error::URL scheme must be https, got: {parsed.scheme}",
                file=sys.stderr,
            )
            return False
        # Only allow raw.githubusercontent.com host
        if parsed.netloc != "raw.githubusercontent.com":
            print(
                f"::error::URL host must be raw.githubusercontent.com, got: {parsed.netloc}",
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

    for i in range(1, 13):
        try:
            # Safe: URL validated above to be https://raw.githubusercontent.com only
            with urllib.request.urlopen(url, timeout=10) as response:  # noqa: S310
                data = json.load(response)
                if "python" in data and "coverage" in data["python"]:
                    print("[OK] Badge JSON accessible and valid")
                    print(json.dumps(data, indent=2))
                    return 0
                else:
                    print(f"Invalid JSON structure: {data}")
        except urllib.error.HTTPError as e:
            print(f"HTTP {e.code}: {e.reason}")
        except urllib.error.URLError as e:
            print(f"URL error: {e.reason}")
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
