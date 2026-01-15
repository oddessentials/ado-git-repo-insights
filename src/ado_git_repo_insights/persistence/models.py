"""SQLite database schema and models for ado-git-repo-insights.

This module defines the SQLite schema that maps directly to the CSV output contract.
Schema changes must preserve invariants 1-4, 14-16 from INVARIANTS.md.
"""

from __future__ import annotations

# SQL schema that will be executed to create tables
# Mirrors the CSV output contract exactly

SCHEMA_SQL = """
-- Metadata table for incremental extraction state (Invariant 6)
CREATE TABLE IF NOT EXISTS extraction_metadata (
    id INTEGER PRIMARY KEY,
    organization_name TEXT NOT NULL,
    project_name TEXT NOT NULL,
    last_extraction_date TEXT NOT NULL,  -- ISO 8601 (YYYY-MM-DD)
    last_extraction_timestamp TEXT NOT NULL,  -- ISO 8601 with time
    UNIQUE(organization_name, project_name)
);

-- Core entity tables (matching CSV output contract - Invariants 1-4)

-- organizations.csv: organization_name
CREATE TABLE IF NOT EXISTS organizations (
    organization_name TEXT PRIMARY KEY
);

-- projects.csv: organization_name, project_name
CREATE TABLE IF NOT EXISTS projects (
    organization_name TEXT NOT NULL,
    project_name TEXT NOT NULL,
    PRIMARY KEY (organization_name, project_name),
    FOREIGN KEY (organization_name) REFERENCES organizations(organization_name)
);

-- repositories.csv: repository_id, repository_name, project_name, organization_name
-- Invariant 14: repository_id is the stable ADO ID
CREATE TABLE IF NOT EXISTS repositories (
    repository_id TEXT PRIMARY KEY,
    repository_name TEXT NOT NULL,
    project_name TEXT NOT NULL,
    organization_name TEXT NOT NULL,
    FOREIGN KEY (organization_name, project_name)
        REFERENCES projects(organization_name, project_name)
);
CREATE INDEX IF NOT EXISTS idx_repositories_project
    ON repositories(organization_name, project_name);

-- users.csv: user_id, display_name, email
-- Invariant 16: user_id is stable ADO ID, display_name/email are mutable labels
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT
);

-- pull_requests.csv: pull_request_uid, pull_request_id, organization_name, project_name,
--                    repository_id, user_id, title, status, description,
--                    creation_date, closed_date, cycle_time_minutes
-- Invariant 14: pull_request_uid = {repository_id}-{pull_request_id}
CREATE TABLE IF NOT EXISTS pull_requests (
    pull_request_uid TEXT PRIMARY KEY,
    pull_request_id INTEGER NOT NULL,
    organization_name TEXT NOT NULL,
    project_name TEXT NOT NULL,
    repository_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    description TEXT,
    creation_date TEXT NOT NULL,  -- ISO 8601
    closed_date TEXT,             -- ISO 8601
    cycle_time_minutes REAL,
    raw_json TEXT,                -- Original ADO response for auditing
    FOREIGN KEY (repository_id) REFERENCES repositories(repository_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_pull_requests_closed_date
    ON pull_requests(closed_date);
CREATE INDEX IF NOT EXISTS idx_pull_requests_org_project
    ON pull_requests(organization_name, project_name);

-- reviewers.csv: pull_request_uid, user_id, vote, repository_id
CREATE TABLE IF NOT EXISTS reviewers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pull_request_uid TEXT NOT NULL,
    user_id TEXT NOT NULL,
    vote INTEGER NOT NULL,
    repository_id TEXT NOT NULL,
    FOREIGN KEY (pull_request_uid) REFERENCES pull_requests(pull_request_uid),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    UNIQUE(pull_request_uid, user_id)  -- One vote per reviewer per PR
);
CREATE INDEX IF NOT EXISTS idx_reviewers_pr ON reviewers(pull_request_uid);

-- Phase 3.3: Teams (current-state membership)
-- Teams are project-scoped and fetched per run
CREATE TABLE IF NOT EXISTS teams (
    team_id TEXT PRIMARY KEY,
    team_name TEXT NOT NULL,
    project_name TEXT NOT NULL,
    organization_name TEXT NOT NULL,
    description TEXT,
    last_updated TEXT NOT NULL,  -- ISO 8601 timestamp of last fetch
    FOREIGN KEY (organization_name, project_name)
        REFERENCES projects(organization_name, project_name)
);
CREATE INDEX IF NOT EXISTS idx_teams_project
    ON teams(organization_name, project_name);

-- Team membership mapping (team_id ↔ user_id)
-- Represents current membership, not historical snapshots
CREATE TABLE IF NOT EXISTS team_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    is_team_admin INTEGER DEFAULT 0,
    FOREIGN KEY (team_id) REFERENCES teams(team_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    UNIQUE(team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

-- Phase 3.4: PR Threads/Comments (feature-flagged)
-- Normalized tables indexed by PR UID and update time
CREATE TABLE IF NOT EXISTS pr_threads (
    thread_id TEXT PRIMARY KEY,
    pull_request_uid TEXT NOT NULL,
    status TEXT,  -- active, fixed, closed, etc.
    thread_context TEXT,  -- JSON: file path, line range, etc.
    last_updated TEXT NOT NULL,  -- ISO 8601, used for incremental sync
    created_at TEXT NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    FOREIGN KEY (pull_request_uid) REFERENCES pull_requests(pull_request_uid)
);
CREATE INDEX IF NOT EXISTS idx_pr_threads_pr ON pr_threads(pull_request_uid);
CREATE INDEX IF NOT EXISTS idx_pr_threads_updated ON pr_threads(last_updated);

CREATE TABLE IF NOT EXISTS pr_comments (
    comment_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    pull_request_uid TEXT NOT NULL,
    author_id TEXT NOT NULL,
    content TEXT,
    comment_type TEXT,  -- text, codeChange, system
    created_at TEXT NOT NULL,
    last_updated TEXT,
    is_deleted INTEGER DEFAULT 0,
    FOREIGN KEY (thread_id) REFERENCES pr_threads(thread_id),
    FOREIGN KEY (pull_request_uid) REFERENCES pull_requests(pull_request_uid),
    FOREIGN KEY (author_id) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_pr_comments_thread ON pr_comments(thread_id);
CREATE INDEX IF NOT EXISTS idx_pr_comments_pr ON pr_comments(pull_request_uid);
CREATE INDEX IF NOT EXISTS idx_pr_comments_author ON pr_comments(author_id);

-- Schema version for future migrations
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

-- Insert initial schema version
INSERT OR IGNORE INTO schema_version (version, applied_at)
VALUES (1, datetime('now'));
"""

# CSV column order contract (NON-NEGOTIABLE per Invariants 1-4)
CSV_SCHEMAS: dict[str, list[str]] = {
    "organizations": ["organization_name"],
    "projects": ["organization_name", "project_name"],
    "repositories": [
        "repository_id",
        "repository_name",
        "project_name",
        "organization_name",
    ],
    "pull_requests": [
        "pull_request_uid",
        "pull_request_id",
        "organization_name",
        "project_name",
        "repository_id",
        "user_id",
        "title",
        "status",
        "description",
        "creation_date",
        "closed_date",
        "cycle_time_minutes",
    ],
    "users": ["user_id", "display_name", "email"],
    "reviewers": ["pull_request_uid", "user_id", "vote", "repository_id"],
}

# Deterministic row ordering: primary key + tie-breaker (Adjustment 3)
SORT_KEYS: dict[str, list[str]] = {
    "organizations": ["organization_name"],
    "projects": ["organization_name", "project_name"],
    "repositories": ["repository_id"],
    "pull_requests": ["pull_request_uid", "creation_date"],
    "users": ["user_id"],
    "reviewers": ["pull_request_uid", "user_id"],
}
