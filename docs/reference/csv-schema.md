# CSV Schema Reference

PowerBI-compatible CSV output format specification.

---

## Overview

The CSV output is a **hard contract** designed for PowerBI compatibility. Schema changes require explicit version bumps and migration plans (No breaking CSV changes without version bump — see `agents/INVARIANTS.md`).

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

## Auxiliary Comments CSVs

Additive CSVs emitted only when PR comment extraction has run at least
once (`--include-comments` on `extract`, or the one-time
`backfill-comments` drain). These live **outside** the PowerBI contract
root under `auxiliary/comments/` and are **not** covered by the
stable-column guarantee at the top of this file.

### auxiliary/comments/pr_threads.csv

PR discussion thread records.

| Column | Type | Description |
|--------|------|-------------|
| `thread_id` | integer | Thread ID within the PR |
| `pull_request_uid` | string | PR unique ID (FK) |
| `status` | string | ADO thread status (e.g., `active`, `fixed`, `closed`) |
| `thread_context` | string | Serialized thread context payload |
| `last_updated` | datetime | Last thread update (ISO 8601) |
| `created_at` | datetime | Thread creation (ISO 8601) |
| `is_deleted` | integer | `1` if the thread was deleted upstream, else `0` |

Sorted by `pull_request_uid` ASC, `thread_id` ASC.

### auxiliary/comments/pr_comments.csv

Individual comment records within threads.

| Column | Type | Description |
|--------|------|-------------|
| `comment_id` | integer | Comment ID |
| `thread_id` | integer | Parent thread (FK) |
| `pull_request_uid` | string | PR unique ID (FK) |
| `author_id` | string | Comment author user ID (FK) |
| `content` | string | Comment text |
| `comment_type` | string | ADO comment type (e.g., `text`, `codeChange`) |
| `created_at` | datetime | Comment creation (ISO 8601) |
| `last_updated` | datetime | Last comment update (ISO 8601) |
| `is_deleted` | integer | `1` if the comment was deleted upstream, else `0` |

Sorted by `pull_request_uid` ASC, `thread_id` ASC, `comment_id` ASC.

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
