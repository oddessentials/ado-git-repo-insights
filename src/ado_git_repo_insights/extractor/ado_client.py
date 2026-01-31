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
from .pagination import add_continuation_token, extract_continuation_token

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

                next_token = extract_continuation_token(response)
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
        base_url = (
            f"{self.base_url}/{project}/_apis/git/pullrequests"
            f"?searchCriteria.status=completed"
            f"&searchCriteria.queryTimeRangeType=closed"
            f"&searchCriteria.minTime={dt}T00:00:00Z"
            f"&searchCriteria.maxTime={dt}T23:59:59Z"
            f"&$top=1000"
            f"&api-version={self.config.version}"
        )

        return add_continuation_token(base_url, token)

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

    # Phase 3.3: Team extraction methods

    def get_teams(self, project: str) -> list[dict[str, Any]]:
        """Fetch all teams for a project.

        §5: Teams are project-scoped, fetched once per run per project.

        Args:
            project: Project name.

        Returns:
            List of team dictionaries.

        Raises:
            ExtractionError: If team fetch fails (allows graceful degradation).
        """
        base_url = (
            f"{self.base_url}/_apis/projects/{project}/teams"
            f"?api-version={self.config.version}"
        )

        all_teams: list[dict[str, Any]] = []
        continuation_token: str | None = None

        while True:
            page_url = add_continuation_token(base_url, continuation_token)

            try:
                response = requests.get(page_url, headers=self.headers, timeout=30)
                response.raise_for_status()

                continuation_token = extract_continuation_token(response)
                data = response.json()
                teams = data.get("value", [])
                all_teams.extend(teams)

                if not continuation_token:
                    break

            except (RequestException, HTTPError) as e:
                raise ExtractionError(
                    f"Failed to fetch teams for {project}: {e}"
                ) from e

            time.sleep(self.config.rate_limit_sleep_seconds)

        logger.info(f"Fetched {len(all_teams)} teams for {project}")
        return all_teams

    def get_team_members(self, project: str, team_id: str) -> list[dict[str, Any]]:
        """Fetch all members of a team.

        §5: Membership fetched once per run per team.

        Args:
            project: Project name.
            team_id: Team identifier.

        Returns:
            List of team member dictionaries.

        Raises:
            ExtractionError: If member fetch fails.
        """
        base_url = (
            f"{self.base_url}/_apis/projects/{project}/teams/{team_id}/members"
            f"?api-version={self.config.version}"
        )

        all_members: list[dict[str, Any]] = []
        continuation_token: str | None = None

        while True:
            page_url = add_continuation_token(base_url, continuation_token)

            try:
                response = requests.get(page_url, headers=self.headers, timeout=30)
                response.raise_for_status()

                continuation_token = extract_continuation_token(response)
                data = response.json()
                members = data.get("value", [])
                all_members.extend(members)

                if not continuation_token:
                    break

            except (RequestException, HTTPError) as e:
                raise ExtractionError(
                    f"Failed to fetch members for team {team_id}: {e}"
                ) from e

            time.sleep(self.config.rate_limit_sleep_seconds)

        logger.debug(f"Fetched {len(all_members)} members for team {team_id}")
        return all_members

    # Phase 3.4: PR Threads/Comments extraction

    def get_pr_threads(
        self,
        project: str,
        repository_id: str,
        pull_request_id: int,
    ) -> list[dict[str, Any]]:
        """Fetch all threads for a pull request.

        §6: Incremental strategy - caller should filter by lastUpdatedDate.

        Args:
            project: Project name.
            repository_id: Repository ID.
            pull_request_id: PR ID.

        Returns:
            List of thread dictionaries.

        Raises:
            ExtractionError: If thread fetch fails.
        """
        base_url = (
            f"{self.base_url}/{project}/_apis/git/repositories/{repository_id}"
            f"/pullRequests/{pull_request_id}/threads"
            f"?api-version={self.config.version}"
        )

        all_threads: list[dict[str, Any]] = []
        continuation_token: str | None = None

        while True:
            page_url = add_continuation_token(base_url, continuation_token)

            try:
                response = requests.get(page_url, headers=self.headers, timeout=30)

                # Handle rate limiting (429) with bounded backoff
                if response.status_code == 429:
                    retry_after = int(response.headers.get("Retry-After", 60))
                    logger.warning(f"Rate limited, waiting {retry_after}s")
                    time.sleep(min(retry_after, 120))  # Cap at 2 minutes
                    continue

                response.raise_for_status()

                continuation_token = extract_continuation_token(response)
                data = response.json()
                threads = data.get("value", [])
                all_threads.extend(threads)

                if not continuation_token:
                    break

            except (RequestException, HTTPError) as e:
                raise ExtractionError(
                    f"Failed to fetch threads for PR {pull_request_id}: {e}"
                ) from e

            time.sleep(self.config.rate_limit_sleep_seconds)

        logger.debug(
            f"Fetched {len(all_threads)} threads for PR {repository_id}/{pull_request_id}"
        )
        return all_threads
