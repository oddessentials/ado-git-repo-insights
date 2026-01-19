# CSV Schema Reference

PowerBI-compatible CSV output format specification.

---

## Overview

The CSV output is a **hard contract** designed for PowerBI compatibility. Schema changes require explicit version bumps and migration plans (Invariant 2).

**Guarantees:**
- Exact column names and order
- Deterministic sorting for diff-friendly comparison
- UTF-8 encoding with Unix line endings
- Stable null/empty-string handling
- Stable datetime and number formatting

---

## organizations.csv

Organization records.

| Column | Type | Description |
|--------|------|-------------|
| `organization_name` | string | Azure DevOps organization name (PK) |

**Example:**
```csv
organization_name
MyOrg
```

---

## projects.csv

Project records.

| Column | Type | Description |
|--------|------|-------------|
| `organization_name` | string | Parent organization (FK) |
| `project_name` | string | Project name (PK with org) |

**Example:**
```csv
organization_name,project_name
MyOrg,Project1
MyOrg,Project2
```

---

## repositories.csv

Repository records.

| Column | Type | Description |
|--------|------|-------------|
| `repository_id` | string | Repository GUID (PK) |
| `repository_name` | string | Repository name |
| `project_name` | string | Parent project (FK) |
| `organization_name` | string | Parent organization (FK) |

**Example:**
```csv
repository_id,repository_name,project_name,organization_name
abc123,my-repo,Project1,MyOrg
```

---

## pull_requests.csv

Pull request records with cycle time metrics.

| Column | Type | Description |
|--------|------|-------------|
| `pull_request_uid` | string | Unique ID: `{repo_id}-{pr_id}` (PK) |
| `pull_request_id` | integer | PR number within repository |
| `organization_name` | string | Organization (FK) |
| `project_name` | string | Project (FK) |
| `repository_id` | string | Repository GUID (FK) |
| `user_id` | string | Author user ID (FK) |
| `title` | string | PR title |
| `status` | string | Always "completed" (merged PRs only) |
| `description` | string | PR description (may be empty) |
| `creation_date` | datetime | When PR was created (ISO 8601) |
| `closed_date` | datetime | When PR was merged (ISO 8601) |
| `cycle_time_minutes` | float | Time from creation to merge in minutes |

**Example:**
```csv
pull_request_uid,pull_request_id,organization_name,project_name,repository_id,user_id,title,status,description,creation_date,closed_date,cycle_time_minutes
abc123-42,42,MyOrg,Project1,abc123,user1,Fix bug,completed,Fixes issue #123,2026-01-15T10:00:00Z,2026-01-16T14:30:00Z,1710.0
```

---

## users.csv

User records for authors and reviewers.

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | string | User GUID (PK) |
| `display_name` | string | User's display name |
| `email` | string | User's email (may be empty) |

**Example:**
```csv
user_id,display_name,email
user1,Jane Doe,jane@example.com
user2,John Smith,john@example.com
```

---

## reviewers.csv

PR reviewer votes.

| Column | Type | Description |
|--------|------|-------------|
| `pull_request_uid` | string | PR unique ID (FK) |
| `user_id` | string | Reviewer user ID (FK) |
| `vote` | integer | Vote value (see below) |
| `repository_id` | string | Repository GUID (FK) |

**Vote values:**
| Value | Meaning |
|-------|---------|
| `10` | Approved |
| `5` | Approved with suggestions |
| `0` | No vote / Reset |
| `-5` | Waiting for author |
| `-10` | Rejected |

**Example:**
```csv
pull_request_uid,user_id,vote,repository_id
abc123-42,user2,10,abc123
abc123-42,user3,5,abc123
```

---

## Data Model Relationships

```
organizations (1) ──< projects (N)
projects (1) ──< repositories (N)
repositories (1) ──< pull_requests (N)
users (1) ──< pull_requests (N) [as author]
users (1) ──< reviewers (N)
pull_requests (1) ──< reviewers (N)
```

---

## Sorting Order

All CSVs are sorted deterministically:

| File | Sort Keys |
|------|-----------|
| `organizations.csv` | `organization_name` ASC |
| `projects.csv` | `organization_name` ASC, `project_name` ASC |
| `repositories.csv` | `organization_name` ASC, `project_name` ASC, `repository_id` ASC |
| `pull_requests.csv` | `organization_name` ASC, `project_name` ASC, `closed_date` ASC, `pull_request_uid` ASC |
| `users.csv` | `user_id` ASC |
| `reviewers.csv` | `pull_request_uid` ASC, `user_id` ASC |

---

## Encoding and Format

| Property | Value |
|----------|-------|
| Encoding | UTF-8 |
| Line endings | LF (Unix) |
| Quoting | RFC 4180 (quoted when needed) |
| Null handling | Empty string |
| Datetime format | ISO 8601 (`YYYY-MM-DDTHH:MM:SSZ`) |

---

## Validation

To validate CSV contract:

```bash
# Check column headers
head -1 csv_output/pull_requests.csv
# Expected: pull_request_uid,pull_request_id,organization_name,project_name,repository_id,user_id,title,status,description,creation_date,closed_date,cycle_time_minutes
```

---

## See Also

- [Dataset Contract](dataset-contract.md) — Dashboard aggregate format
- [Architecture](architecture.md) — Data flow diagrams
