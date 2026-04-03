"""Shared type definitions for ado-git-repo-insights.

Canonical type aliases and TypedDicts used across the package.
Local redefinitions of these types are forbidden (FR-013).
"""

from __future__ import annotations

from typing import NotRequired, TypedDict

# ---------------------------------------------------------------------------
# Foundational type aliases
# ---------------------------------------------------------------------------

type JSONValue = (
    str | int | float | bool | None | list[JSONValue] | dict[str, JSONValue]
)
"""Recursive JSON-compatible value type.

Used by: _redact_dict (logging_config), _write_json (aggregators),
emit log entry (logging_config), to_dict (run_summary).
"""

type SqliteParam = str | int | float | bytes | None
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


# ---------------------------------------------------------------------------
# Dimension entity record types (P5a — aggregators.py Dimensions dataclass)
# ---------------------------------------------------------------------------


class RepositoryRecord(TypedDict):
    """Repository dimension record from ``SELECT ... FROM repositories``."""

    repository_id: str
    repository_name: str
    project_name: str
    organization_name: str


class UserRecord(TypedDict):
    """User dimension record from ``SELECT ... FROM users JOIN pull_requests``."""

    user_id: str
    display_name: str


class AuthorRecord(TypedDict):
    """Author dimension record (renamed user fields for UI)."""

    author_id: str
    author_name: str


class ReviewerRecord(TypedDict):
    """Reviewer dimension record from ``SELECT ... FROM reviewers JOIN users``."""

    reviewer_id: str
    reviewer_name: str


class ProjectRecord(TypedDict):
    """Project dimension record from ``SELECT ... FROM projects``."""

    organization_name: str
    project_name: str


class TeamRecord(TypedDict):
    """Team dimension record with aggregated member count."""

    team_id: str
    team_name: str
    project_name: str
    organization_name: str
    member_count: int


# ---------------------------------------------------------------------------
# Weekly rollup / dimension slice types (P5b — aggregators.py slice methods)
# ---------------------------------------------------------------------------


class SliceMetrics(TypedDict):
    """Common metrics shape for author/repo/team dimension slices."""

    pr_count: int
    cycle_time_p50: float | None
    cycle_time_p90: float | None
    authors_count: int
    reviewers_count: int


class ReviewerSliceMetrics(TypedDict):
    """Reviewer-specific activity metrics (different shape from SliceMetrics)."""

    reviewed_prs: int
    reviews_count: int
    approval_rate: float
    authors_count: int
    repositories_count: int


class WeeklyRollupIndexEntry(TypedDict):
    """Index entry for a weekly rollup file in aggregate_index."""

    week: str
    path: str
    start_date: str
    end_date: str
    size_bytes: int


class DistributionIndexEntry(TypedDict):
    """Index entry for a yearly distribution file in aggregate_index."""

    year: str
    path: str
    start_date: str
    end_date: str
    size_bytes: int


# ---------------------------------------------------------------------------
# Manifest sub-structure types (P5c — aggregators.py DatasetManifest)
# ---------------------------------------------------------------------------


class CommentsCoverage(TypedDict):
    """Comments extraction coverage statistics for dataset manifest."""

    status: str
    threads_fetched: int
    comments_fetched: int
    prs_with_threads: int
    capped: bool


class ManifestCoverage(TypedDict):
    """Dataset manifest coverage section."""

    total_prs: int
    date_range: dict[str, str]
    teams_count: int
    comments: CommentsCoverage
    row_counts: dict[str, int]


class OperationalSummary(TypedDict):
    """Operational summary for dataset manifest (Phase 4 §5)."""

    artifact_size_bytes: int
    weekly_rollup_count: int
    distribution_count: int
    retention_notice: str | None
