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
from datetime import UTC, date, datetime, timedelta
from email.utils import parsedate_to_datetime

import requests
from requests.exceptions import HTTPError, RequestException

from ..config import APIConfig
from ..types import AdoPullRequest, AdoTeam, AdoTeamMember, AdoThread
from .pagination import add_continuation_token, extract_continuation_token


def _get_current_time() -> datetime:
    """Get current UTC time. Extracted for testability."""
    return datetime.now(UTC)


def parse_retry_after(
    header_value: str | None,
    default: int = 60,
    max_seconds: int | None = None,
) -> int:
    """Parse Retry-After header value (seconds or HTTP-date).

    RFC 7231 allows Retry-After to be:
    - An integer number of seconds: "120" (must be non-negative)
    - An HTTP-date: "Wed, 21 Oct 2026 07:28:00 GMT"

    Args:
        header_value: Raw header value, or None if missing.
        default: Default seconds if header is missing or unparseable.
        max_seconds: Optional upper bound on returned value (must be non-negative).

    Returns:
        Number of seconds to wait, capped by max_seconds if specified.

    Raises:
        ValueError: If max_seconds is negative.
    """
    if max_seconds is not None and max_seconds < 0:
        raise ValueError("max_seconds must be non-negative")

    if not header_value:
        result = default
    else:
        result = _parse_retry_after_value(header_value, default)

    if max_seconds is not None:
        result = min(result, max_seconds)

    return result


def _parse_retry_after_value(header_value: str, default: int) -> int:
    """Parse the actual Retry-After value (internal helper)."""
    # Try integer seconds first (most common)
    try:
        seconds = int(header_value)
        # RFC 7231: Retry-After must be non-negative
        if seconds >= 0:
            return seconds
        # Negative value is invalid per RFC - fall through to warning
    except ValueError:
        pass

    # Try HTTP-date format (RFC 7231 Section 7.1.3)
    # Note: HTTP-dates are always in GMT (equivalent to UTC) per RFC 7231,
    # so no timezone conversion is needed - parsedate_to_datetime returns
    # a timezone-aware datetime in the original timezone (GMT).
    try:
        retry_dt = parsedate_to_datetime(header_value)
        if retry_dt is None:
            raise ValueError("parsedate_to_datetime returned None")
        now = _get_current_time()
        delta = (retry_dt - now).total_seconds()
        # Return at least 1 second, even if date is in the past
        return max(1, int(delta))
    except (ValueError, TypeError):
        pass

    # Unparseable - use default
    # Sanitize header value in log to prevent information disclosure
    # and avoid log injection (truncate to 100 chars, escape control chars)
    safe_value = header_value[:100].encode("unicode_escape").decode("ascii")
    logger.warning(f"Could not parse Retry-After header: {safe_value!r}, using default")
    return default


logger = logging.getLogger(__name__)

# Substrings that identify an ADO-family sign-in redirect target.  Used by
# :meth:`ADOClient._get_or_raise` only to choose the error-message hint;
# the 3xx classification is absolute (every 3xx raises) and does NOT branch
# on these markers.  Assumption: ADO sign-in redirects land on one of
# ``_signin`` paths or ``login.microsoftonline.com`` as of 2026-04.  If ADO
# changes redirect domains, the unknown-Location branch still raises and
# surfaces the Location verbatim, so the regression is loud, not silent.
_SIGNIN_LOCATION_MARKERS: tuple[str, ...] = (
    "_signin",
    "login.microsoftonline.com",
)


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
    ) -> Iterator[AdoPullRequest]:
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
    ) -> list[AdoPullRequest]:
        """Fetch all PRs for a single date, handling continuation tokens.

        Invariant 12: Complete pagination via continuation tokens.

        Args:
            project: Project name.
            dt: Date to fetch.

        Returns:
            List of all PRs for the date.
        """
        all_prs: list[AdoPullRequest] = []
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
    ) -> tuple[list[AdoPullRequest], str | None]:
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
            response: requests.Response | None = None
            try:
                response = self._get_or_raise(
                    url, timeout=30, context=f"{self.organization}/{project}"
                )
                next_token = extract_continuation_token(response)
                data = response.json()
                return data.get("value", []), next_token

            except (ExtractionError, json.JSONDecodeError) as e:
                # Retry classification is preserved from the pre-refactor
                # contract by unwrapping ``e.__cause__`` for ExtractionError
                # originating in ``_get_or_raise``: RequestException and
                # HTTPError still drive the retry/backoff loop exactly as
                # before.  A 3xx raised by the helper has no ``__cause__``
                # (classified entirely by the helper) and is retried
                # identically — a bad PAT will exhaust retries and surface
                # as ``Max retries exhausted`` with the helper's auth-hint
                # message in ``last_error``.
                cause = e.__cause__ if isinstance(e, ExtractionError) else None
                classified: BaseException = cause if cause is not None else e
                last_error = classified
                self.stats.retries_used += 1

                # Safe logging for JSON decode errors (Invariant 19: no auth headers)
                if isinstance(e, json.JSONDecodeError) and response is not None:
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

    def _get_or_raise(
        self,
        url: str,
        *,
        timeout: float = 30,
        context: str | None = None,
    ) -> requests.Response:
        """Single HTTP-GET surface for ADOClient; redirect-aware + PAT-aware.

        Every HTTP GET in this client MUST route through this helper — the
        invariant is AST-enforced by
        :class:`tests.unit.test_retry_policy.TestAdoClientHttpHardening`.

        Why: Azure DevOps answers unauthenticated REST calls with HTTP 302
        to a sign-in page (resolving to 203 HTML under default redirect
        follow).  ``raise_for_status`` only raises on 4xx/5xx, so a bare
        ``requests.get`` would silently return a "successful" HTML page for
        an invalid PAT.  This helper:

        1. Calls ``requests.get`` with ``allow_redirects=False``.
        2. Treats ANY 3xx as a failure and raises ``ExtractionError``.
           The ``Location`` header is surfaced verbatim in the message.
           Sign-in markers (see :data:`_SIGNIN_LOCATION_MARKERS`) affect
           only the message's hint; classification of 3xx as an error is
           absolute and does not branch on auth vs non-auth.
        3. Calls ``raise_for_status`` for 4xx/5xx, wrapping the resulting
           ``HTTPError`` in ``ExtractionError`` with ``__cause__`` preserved.
        4. Wraps ``RequestException`` (network / DNS / timeout) in
           ``ExtractionError`` with ``__cause__`` preserved so callers
           (notably :meth:`_fetch_page`'s retry loop) can classify failures
           by inspecting ``e.__cause__``.

        Args:
            url: Full URL to GET.
            timeout: Per-request timeout in seconds (default 30 matches
                pagination methods; probes call with ``timeout=10``).
            context: Identity string embedded in error messages, e.g.
                ``"organization TestOrg"`` or ``"TestOrg/TestProject"``.
                Defaults to ``"organization {self.organization}"``.

        Returns:
            The successful ``requests.Response`` — callers consume
            ``.json()`` / iterate pages / etc.

        Raises:
            ExtractionError: on any of the four failure paths above.
                ``__cause__`` is set to the originating
                ``RequestException`` / ``HTTPError`` where applicable
                (not set for the 3xx branch; 3xx is classified entirely by
                this helper).
        """
        ctx = context or f"organization {self.organization}"
        try:
            response = requests.get(
                url,
                headers=self.headers,
                timeout=timeout,
                allow_redirects=False,
            )
            if 300 <= response.status_code < 400:
                location = response.headers.get("Location", "<no Location>")
                if any(marker in location for marker in _SIGNIN_LOCATION_MARKERS):
                    hint = "likely invalid or expired PAT"
                else:
                    hint = (
                        "redirect target is not a known sign-in endpoint; "
                        "PAT may be valid but endpoint may have moved"
                    )
                raise ExtractionError(
                    f"Failed to connect to {ctx}: "
                    f"unexpected HTTP {response.status_code} redirect to "
                    f"{location} ({hint})"
                )
            response.raise_for_status()
            return response
        except (RequestException, HTTPError) as e:
            raise ExtractionError(f"Failed to connect to {ctx}: {e}") from e

    def test_connection(self, project: str) -> bool:
        """Test project-scoped connectivity to ADO API.

        Delegates to :meth:`_get_or_raise` so redirect-blindness protection
        applies uniformly with all other HTTP call sites.

        Args:
            project: Project name to test.

        Returns:
            True if connection successful.

        Raises:
            ExtractionError: If connection fails — network error, HTTP
                4xx/5xx, or an unexpected 3xx indicating invalid/expired PAT.
        """
        url = f"{self.base_url}/{project}/_apis/git/repositories?api-version={self.config.version}"
        self._get_or_raise(
            url,
            timeout=10,
            context=f"{self.organization}/{project}",
        )
        logger.info(f"Successfully connected to {self.organization}/{project}")
        return True

    def test_organization_connection(self) -> bool:
        """Test organization-scoped connectivity to ADO API.

        This probe intentionally avoids project enumeration so callers can
        fail fast on invalid organization/PAT combinations without depending
        on row-0 project scope or permissions unrelated to the actual
        repository/thread-fetch path.

        Delegates to :meth:`_get_or_raise`, which enforces the
        ``allow_redirects=False`` + 3xx-is-failure contract uniformly
        across every ADOClient HTTP GET.

        Returns:
            True if connection successful.

        Raises:
            ExtractionError: If connection fails — network error, HTTP
                4xx/5xx, or an unexpected 3xx indicating invalid/expired PAT.
        """
        url = f"{self.base_url}/_apis/connectionData?api-version={self.config.version}"
        self._get_or_raise(
            url,
            timeout=10,
            context=f"organization {self.organization}",
        )
        logger.info(f"Successfully connected to organization {self.organization}")
        return True

    # Phase 3.3: Team extraction methods

    def get_teams(self, project: str) -> list[AdoTeam]:
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

        all_teams: list[AdoTeam] = []
        continuation_token: str | None = None

        while True:
            page_url = add_continuation_token(base_url, continuation_token)

            try:
                response = self._get_or_raise(
                    page_url,
                    timeout=30,
                    context=f"{self.organization}/{project}",
                )
                continuation_token = extract_continuation_token(response)
                data = response.json()
                teams = data.get("value", [])
                all_teams.extend(teams)

                if not continuation_token:
                    break

            except (ExtractionError, json.JSONDecodeError) as e:
                raise ExtractionError(
                    f"Failed to fetch teams for {project}: {e}"
                ) from e

            time.sleep(self.config.rate_limit_sleep_seconds)

        logger.info(f"Fetched {len(all_teams)} teams for {project}")
        return all_teams

    def get_team_members(self, project: str, team_id: str) -> list[AdoTeamMember]:
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

        all_members: list[AdoTeamMember] = []
        continuation_token: str | None = None

        while True:
            page_url = add_continuation_token(base_url, continuation_token)

            try:
                response = self._get_or_raise(
                    page_url,
                    timeout=30,
                    context=f"{self.organization}/{project}",
                )
                continuation_token = extract_continuation_token(response)
                data = response.json()
                members = data.get("value", [])
                all_members.extend(members)

                if not continuation_token:
                    break

            except (ExtractionError, json.JSONDecodeError) as e:
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
    ) -> list[AdoThread]:
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

        all_threads: list[AdoThread] = []
        continuation_token: str | None = None

        while True:
            page_url = add_continuation_token(base_url, continuation_token)

            try:
                response = self._get_or_raise(
                    page_url,
                    timeout=30,
                    context=f"{self.organization}/{project}",
                )
                continuation_token = extract_continuation_token(response)
                data = response.json()
                threads = data.get("value", [])
                all_threads.extend(threads)

                if not continuation_token:
                    break

            except (ExtractionError, json.JSONDecodeError) as e:
                # Rate-limit (429) handling: route through the shared helper
                # but preserve the original bounded-backoff + continue loop.
                # The helper wraps HTTPError (including 429) in ExtractionError
                # with ``__cause__`` set; unwrap and branch on the status.
                cause = e.__cause__ if isinstance(e, ExtractionError) else None
                if (
                    isinstance(cause, HTTPError)
                    and cause.response is not None
                    and cause.response.status_code == 429
                ):
                    retry_after = parse_retry_after(
                        cause.response.headers.get("Retry-After"),
                        max_seconds=120,  # Cap at 2 minutes
                    )
                    logger.warning(f"Rate limited, waiting {retry_after}s")
                    time.sleep(retry_after)
                    continue
                raise ExtractionError(
                    f"Failed to fetch threads for PR {pull_request_id}: {e}"
                ) from e

            time.sleep(self.config.rate_limit_sleep_seconds)

        logger.debug(
            f"Fetched {len(all_threads)} threads for PR {repository_id}/{pull_request_id}"
        )
        return all_threads
