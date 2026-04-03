"""Shared type definitions for ado-git-repo-insights.

Canonical type aliases and TypedDicts used across the package.
Local redefinitions of these types are forbidden (FR-013).
"""

from __future__ import annotations

from typing import NotRequired, TypeAlias, TypedDict

# ---------------------------------------------------------------------------
# Foundational type aliases
# ---------------------------------------------------------------------------

JSONValue: TypeAlias = (
    "str | int | float | bool | None | list[JSONValue] | dict[str, JSONValue]"
)
"""Recursive JSON-compatible value type.

Used by: _redact_dict (logging_config), _write_json (aggregators),
emit log entry (logging_config), to_dict (run_summary).
"""

SqliteParam: TypeAlias = "str | int | float | bytes | None"
"""Allowed sqlite3 bind-parameter types (matches typeshed _SqliteData)."""


# ---------------------------------------------------------------------------
# Run summary types
# ---------------------------------------------------------------------------


class RunCountsDict(TypedDict):
    """Serialized run counts."""

    prs_fetched: int
    prs_updated: int
    rows_per_csv: dict[str, int]


class RunTimingsDict(TypedDict):
    """Serialized run timings."""

    total_seconds: float
    extract_seconds: float
    persist_seconds: float
    export_seconds: float


class RunSummaryDict(TypedDict):
    """Serialized run summary for JSON output."""

    tool_version: str
    git_sha: str | None
    organization: str
    projects: list[str]
    date_range: dict[str, str]
    counts: RunCountsDict
    timings: RunTimingsDict
    warnings: list[str]
    final_status: str
    per_project_status: dict[str, str]
    first_fatal_error: str | None


# ---------------------------------------------------------------------------
# Azure DevOps REST API response types (P2 — ado_client.py)
# ---------------------------------------------------------------------------


class AdoRepository(TypedDict):
    """Repository reference within a PR response."""

    id: str
    name: str


class AdoCreatedBy(TypedDict):
    """User identity in PR createdBy / comment author fields."""

    id: str
    displayName: str
    uniqueName: str


class AdoReviewer(TypedDict):
    """Reviewer entry in a PR response."""

    id: str
    displayName: str
    uniqueName: str
    vote: int


class AdoPullRequest(TypedDict):
    """Azure DevOps Pull Request response object."""

    pullRequestId: int
    title: str
    status: str
    description: NotRequired[str | None]
    creationDate: str
    closedDate: NotRequired[str | None]
    repository: AdoRepository
    createdBy: AdoCreatedBy
    reviewers: list[AdoReviewer]


class AdoTeam(TypedDict):
    """Azure DevOps Team response object."""

    id: str
    name: str
    description: NotRequired[str | None]


class AdoIdentity(TypedDict):
    """Identity sub-object within team member responses."""

    id: str
    displayName: str


class AdoTeamMember(TypedDict):
    """Azure DevOps Team Member response object."""

    identity: AdoIdentity
    isTeamAdmin: bool


class AdoComment(TypedDict):
    """Comment entry within a thread response."""

    id: int
    content: NotRequired[str | None]
    commentType: str
    publishedDate: str
    lastUpdatedDate: NotRequired[str | None]
    isDeleted: bool
    author: AdoCreatedBy


class AdoThread(TypedDict):
    """Azure DevOps PR Thread response object."""

    id: int
    status: str
    lastUpdatedDate: str
    publishedDate: str
    threadContext: NotRequired[JSONValue | None]
    isDeleted: bool
    comments: list[AdoComment]


# ---------------------------------------------------------------------------
# Database row types (P4 — repository.py)
# ---------------------------------------------------------------------------


class TeamRow(TypedDict):
    """Row shape from ``SELECT ... FROM teams``."""

    team_id: str
    team_name: str
    description: str | None
    last_updated: str


class TeamMemberRow(TypedDict):
    """Row shape from ``SELECT ... FROM team_members JOIN users``."""

    user_id: str
    display_name: str | None
    email: str | None
    is_team_admin: int


# ---------------------------------------------------------------------------
# Forecast types (P3 — forecaster.py, fallback_forecaster.py) — FR-006
# ---------------------------------------------------------------------------


class ForecastValue(TypedDict):
    """Single-period forecast value (shared by both forecasters).

    ``constraints_applied`` is optional — present in fallback forecaster output,
    absent in Prophet forecaster output.
    """

    period_start: str
    predicted: float
    lower_bound: float
    upper_bound: float
    constraints_applied: NotRequired[list[str]]


class MetricForecastDict(TypedDict):
    """Serialized forecast for a single metric (JSON output shape)."""

    metric: str
    unit: str
    horizon_weeks: int
    values: list[ForecastValue]
