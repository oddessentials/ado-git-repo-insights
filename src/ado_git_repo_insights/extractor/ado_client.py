"""Azure DevOps REST API client.

Implements pagination (continuation tokens), bounded retry with exponential backoff,
and fail-fast on partial failures per Invariants 12-13 and Adjustment 4.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

import requests
from requests.exceptions import HTTPError, RequestException

from ..config import APIConfig

logger = logging.getLogger(__name__)


class ExtractionError(Exception):
    """Extraction failed - causes run to fail (Invariant 7, Adjustment 4)."""


@dataclass
class ExtractionStats:
    """Statistics for an extraction run."""

    total_prs: int = 0
    pages_fetched: int = 0
    retries_used: int = 0


class ADOClient:
    """Azure DevOps REST API client with pagination, retry, and rate limiting.

    Invariant 12: Pagination must be complete (continuation tokens).
    Invariant 13: Retries must be bounded and predictable.
    Adjustment 4: Partial failures fail the run.
    """

    def __init__(self, organization: str, pat: str, config: APIConfig) -> None:
        """Initialize the ADO client.

        Args:
            organization: Azure DevOps organization name.
            pat: Personal Access Token with Code (Read) scope.
            config: API configuration settings.
        """
        self.organization = organization
        self.base_url = f"{config.base_url}/{organization}"
        self.config = config
        self.headers = self._build_auth_headers(pat)
        self.stats = ExtractionStats()

    def _build_auth_headers(self, pat: str) -> dict[str, str]:
        """Build authorization headers for ADO API.

        Args:
            pat: Personal Access Token.

        Returns:
            Headers dict with Basic auth.
        """
        # Invariant 19: PAT is never logged
        encoded = base64.b64encode(f":{pat}".encode()).decode()
        return {
            "Authorization": f"Basic {encoded}",
            "Content-Type": "application/json",
        }

    def _log_invalid_response(
        self, response: requests.Response, error: json.JSONDecodeError
    ) -> None:
        """Log details of invalid JSON response for debugging.

        Invariant 19: Never log auth headers or sensitive data.
        Truncates body to avoid log bloat.
        """
        max_body_len = 2048  # Safe truncation limit

        # Safely get response body
        try:
            body = response.text[:max_body_len] if response.text else "<empty>"
        except Exception:
            body = "<unable to decode response body>"

        # Sanitize headers (remove auth)
        safe_headers = {
            k: v
            for k, v in response.headers.items()
            if k.lower() not in ("authorization", "x-ms-pat", "cookie")
        }

        logger.warning(
            f"Invalid JSON response - Status: {response.status_code}, "
            f"Headers: {safe_headers}, "
            f"Body (truncated): {body!r}, "
            f"Parse error: {error}"
        )

    def get_pull_requests(
        self,
        project: str,
        start_date: date,
        end_date: date,
    ) -> Iterator[dict[str, Any]]:
        """Fetch completed PRs for a date range with automatic pagination.

        Adjustment 4: Handles continuation tokens, bounded retries with backoff.
        Raises on partial failures (deterministic failure over silent partial success).

        Args:
            project: Project name.
            start_date: Start of date range (inclusive).
            end_date: End of date range (inclusive).

        Yields:
            PR data dictionaries.

        Raises:
            ExtractionError: If extraction fails for any date.
        """
        current_date = start_date
        while current_date <= end_date:
            try:
                prs = self._fetch_prs_for_date_paginated(project, current_date)
                yield from prs
            except ExtractionError as e:
                # Fail the entire run on any date failure (Adjustment 4)
                raise ExtractionError(
                    f"Failed extracting {project} on {current_date}: {e}"
                ) from e

            time.sleep(self.config.rate_limit_sleep_seconds)
            current_date += timedelta(days=1)

    def _fetch_prs_for_date_paginated(
        self, project: str, dt: date
    ) -> list[dict[str, Any]]:
        """Fetch all PRs for a single date, handling continuation tokens.

        Invariant 12: Complete pagination via continuation tokens.

        Args:
            project: Project name.
            dt: Date to fetch.

        Returns:
            List of all PRs for the date.
        """
        all_prs: list[dict[str, Any]] = []
        continuation_token: str | None = None

        while True:
            prs, continuation_token = self._fetch_page(project, dt, continuation_token)
            all_prs.extend(prs)
            self.stats.pages_fetched += 1

            if not continuation_token:
                break

            logger.debug(f"Fetching next page for {project}/{dt}")

        self.stats.total_prs += len(all_prs)
        if all_prs:
            logger.debug(f"Fetched {len(all_prs)} PRs for {project}/{dt}")

        return all_prs

    def _fetch_page(
        self,
        project: str,
        dt: date,
        token: str | None,
    ) -> tuple[list[dict[str, Any]], str | None]:
        """Fetch a single page of PRs with retry logic.

        Invariant 13: Bounded retries with exponential backoff.

        Args:
            project: Project name.
            dt: Date to fetch.
            token: Continuation token from previous page.

        Returns:
            Tuple of (PR list, next continuation token or None).

        Raises:
            ExtractionError: After max retries exhausted.
        """
        url = self._build_pr_url(project, dt, token)

        last_error: Exception | None = None
        delay = self.config.retry_delay_seconds

        for attempt in range(1, self.config.max_retries + 1):
            try:
                response = requests.get(url, headers=self.headers, timeout=30)
                response.raise_for_status()

                next_token = response.headers.get("x-ms-continuationtoken")
                data = response.json()
                return data.get("value", []), next_token

            except (RequestException, HTTPError, json.JSONDecodeError) as e:
                last_error = e
                self.stats.retries_used += 1

                # Safe logging for JSON decode errors (Invariant 19: no auth headers)
                if isinstance(e, json.JSONDecodeError):
                    self._log_invalid_response(response, e)

                logger.warning(
                    f"Attempt {attempt}/{self.config.max_retries} failed: {e}"
                )

                if attempt < self.config.max_retries:
                    logger.info(f"Retrying in {delay:.1f}s...")
                    time.sleep(delay)
                    delay *= self.config.retry_backoff_multiplier

        # All retries exhausted - fail the run (Adjustment 4)
        raise ExtractionError(
            f"Max retries ({self.config.max_retries}) exhausted for {project}/{dt}: "
            f"{last_error}"
        )

    def _build_pr_url(self, project: str, dt: date, token: str | None) -> str:
        """Build the ADO API URL for fetching PRs.

        Args:
            project: Project name.
            dt: Date to query.
            token: Optional continuation token.

        Returns:
            Fully constructed URL.
        """
        url = (
            f"{self.base_url}/{project}/_apis/git/pullrequests"
            f"?searchCriteria.status=completed"
            f"&searchCriteria.queryTimeRangeType=closed"
            f"&searchCriteria.minTime={dt}T00:00:00Z"
            f"&searchCriteria.maxTime={dt}T23:59:59Z"
            f"&$top=1000"
            f"&api-version={self.config.version}"
        )

        if token:
            url += f"&continuationToken={token}"

        return url

    def test_connection(self, project: str) -> bool:
        """Test connectivity to ADO API.

        Args:
            project: Project name to test.

        Returns:
            True if connection successful.

        Raises:
            ExtractionError: If connection fails.
        """
        url = f"{self.base_url}/{project}/_apis/git/repositories?api-version={self.config.version}"

        try:
            response = requests.get(url, headers=self.headers, timeout=10)
            response.raise_for_status()
            logger.info(f"Successfully connected to {self.organization}/{project}")
            return True
        except (RequestException, HTTPError) as e:
            raise ExtractionError(
                f"Failed to connect to {self.organization}/{project}: {e}"
            ) from e
