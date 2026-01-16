# Application Flow Diagram

This document visualizes the complete data flow and architecture of ado-git-repo-insights.

## High-Level Data Flow

```mermaid
flowchart TB
    subgraph Input["Input Sources"]
        CLI["CLI Arguments"]
        CONFIG["config.yaml"]
        ENV["Environment (PAT)"]
    end

    subgraph Core["Core Application"]
        PARSER["Configuration Parser<br/>config.py"]
        EXTRACTOR["PR Extractor<br/>pr_extractor.py"]
        CLIENT["ADO Client<br/>ado_client.py"]
        REPO["Repository Layer<br/>repository.py"]
        GENERATOR["CSV Generator<br/>csv_generator.py"]
    end

    subgraph Persistence["Persistence Layer"]
        SQLITE[("SQLite Database<br/>ado-insights.sqlite")]
        ARTIFACTS["Run Artifacts<br/>run_summary.json<br/>logs.jsonl"]
    end

    subgraph Output["Output Artifacts"]
        CSV_ORG["organizations.csv"]
        CSV_PROJ["projects.csv"]
        CSV_REPO["repositories.csv"]
        CSV_PR["pull_requests.csv"]
        CSV_USER["users.csv"]
        CSV_REV["reviewers.csv"]
    end

    subgraph External["External Systems"]
        ADO_API["Azure DevOps<br/>REST API"]
        POWERBI["PowerBI<br/>Dashboards"]
    end

    CLI --> PARSER
    CONFIG --> PARSER
    ENV --> PARSER

    PARSER --> EXTRACTOR
    EXTRACTOR --> CLIENT
    CLIENT <--> ADO_API
    CLIENT --> REPO
    REPO --> SQLITE

    SQLITE --> GENERATOR
    GENERATOR --> CSV_ORG
    GENERATOR --> CSV_PROJ
    GENERATOR --> CSV_REPO
    GENERATOR --> CSV_PR
    GENERATOR --> CSV_USER
    GENERATOR --> CSV_REV

    CSV_ORG --> POWERBI
    CSV_PROJ --> POWERBI
    CSV_REPO --> POWERBI
    CSV_PR --> POWERBI
    CSV_USER --> POWERBI
    CSV_REV --> POWERBI

    EXTRACTOR --> ARTIFACTS
```

## Extraction Pipeline Detail

```mermaid
sequenceDiagram
    participant CLI as CLI Entry
    participant Config as Configuration
    participant Extractor as PRExtractor
    participant Client as ADOClient
    participant ADO as Azure DevOps API
    participant Repo as Repository
    participant DB as SQLite

    CLI->>Config: load_config()
    Config-->>CLI: Config object
    CLI->>Extractor: extract_all(backfill_days?)

    loop For each project
        Extractor->>Extractor: _determine_start_date()
        Extractor->>Extractor: _determine_end_date()

        loop For each date in range
            Extractor->>Client: get_pull_requests(project, start, end)

            loop Until no continuation token
                Client->>ADO: GET /pullrequests?status=completed&queryTimeRangeType=closed
                ADO-->>Client: PRs + continuation token
            end

            Client-->>Extractor: PR data iterator

            loop For each PR
                Extractor->>Repo: upsert_pr_with_related(pr_data)
                Repo->>DB: UPSERT organizations
                Repo->>DB: UPSERT projects
                Repo->>DB: UPSERT repositories
                Repo->>DB: UPSERT users
                Repo->>DB: UPSERT pull_requests
                Repo->>DB: UPSERT reviewers
            end
        end

        Extractor->>Repo: update_extraction_metadata()
    end

    Extractor-->>CLI: ExtractionSummary
```

## PR Status Filtering Logic

> **Critical Distinction: "Completed" vs "Closed"**

```mermaid
flowchart LR
    subgraph ADO_States["Azure DevOps PR States"]
        ACTIVE["active<br/>(open, in progress)"]
        COMPLETED["completed<br/>(merged successfully)"]
        ABANDONED["abandoned<br/>(rejected/cancelled)"]
    end

    subgraph Query_Params["API Query Parameters"]
        STATUS["searchCriteria.status=completed"]
        TIME_RANGE["searchCriteria.queryTimeRangeType=closed"]
        DATE_FILTER["minTime/maxTime filters"]
    end

    subgraph Result["Extracted PRs"]
        MERGED["Only Successfully<br/>Merged PRs"]
    end

    STATUS --> MERGED
    TIME_RANGE --> MERGED
    COMPLETED --> STATUS
```

### Terminology Clarification

| Term | Meaning in Azure DevOps | Usage in This Tool |
|------|------------------------|-------------------|
| **status=completed** | PR was successfully merged into the target branch | ✅ **Primary filter** - Only fetches merged PRs |
| **status=abandoned** | PR was closed without merging | ❌ Not extracted |
| **status=active** | PR is still open | ❌ Not extracted |
| **queryTimeRangeType=closed** | Use `closedDate` field for date filtering | ✅ **Date range filter** - Queries by when PR was closed |
| **closedDate** | Timestamp when PR reached a terminal state (completed OR abandoned) | ✅ Used for date range and cycle time calculation |

**Key Insight**: The API URL in `ado_client.py` line 245-252 uses:
```
?searchCriteria.status=completed
&searchCriteria.queryTimeRangeType=closed
&searchCriteria.minTime={date}T00:00:00Z
&searchCriteria.maxTime={date}T23:59:59Z
```

This means:
1. **status=completed** → Only PRs that were merged (not abandoned)
2. **queryTimeRangeType=closed** → Filter by the `closedDate` timestamp
3. Combined: **Only merged PRs, filtered by their closure date**

## Date Range Defaults

```mermaid
flowchart TD
    subgraph StartDate["Start Date Logic"]
        CONFIG_START{"Explicit --start-date?"}
        BACKFILL{"Backfill mode?"}
        METADATA{"Has extraction metadata?"}

        CONFIG_START -->|Yes| USE_CONFIG["Use configured start"]
        CONFIG_START -->|No| BACKFILL
        BACKFILL -->|Yes| CALC_BACKFILL["today - backfill_days"]
        BACKFILL -->|No| METADATA
        METADATA -->|Yes| LAST_PLUS_1["last_extraction_date + 1"]
        METADATA -->|No| JAN_1["Jan 1 of current year"]
    end

    subgraph EndDate["End Date Logic"]
        CONFIG_END{"Explicit --end-date?"}
        CONFIG_END -->|Yes| USE_CONFIG_END["Use configured end"]
        CONFIG_END -->|No| YESTERDAY["Yesterday<br/>(avoids incomplete data)"]
    end
```

## Data Model (SQLite → CSV)

```mermaid
erDiagram
    organizations ||--o{ projects : contains
    projects ||--o{ repositories : contains
    repositories ||--o{ pull_requests : contains
    users ||--o{ pull_requests : authored
    users ||--o{ reviewers : "reviewed as"
    pull_requests ||--o{ reviewers : "reviewed by"

    organizations {
        TEXT organization_name PK
    }

    projects {
        TEXT organization_name FK
        TEXT project_name PK
    }

    repositories {
        TEXT repository_id PK
        TEXT repository_name
        TEXT project_name FK
        TEXT organization_name FK
    }

    users {
        TEXT user_id PK
        TEXT display_name
        TEXT email
    }

    pull_requests {
        TEXT pull_request_uid PK "repo_id-pr_id"
        INT pull_request_id
        TEXT organization_name FK
        TEXT project_name FK
        TEXT repository_id FK
        TEXT user_id FK
        TEXT title
        TEXT status "always 'completed'"
        TEXT description
        TEXT creation_date
        TEXT closed_date
        REAL cycle_time_minutes
    }

    reviewers {
        TEXT pull_request_uid FK
        TEXT user_id FK
        INT vote
        TEXT repository_id
    }
```

## Retry and Error Handling

```mermaid
flowchart TD
    subgraph RetryLogic["Bounded Retry with Backoff"]
        ATTEMPT["API Request Attempt"]
        SUCCESS{"Success?"}
        RETRY_COUNT{"Retries < max?"}
        SLEEP["Sleep with backoff<br/>delay × multiplier"]
        FAIL["ExtractionError<br/>(fail the run)"]

        ATTEMPT --> SUCCESS
        SUCCESS -->|Yes| RETURN["Return data"]
        SUCCESS -->|No| RETRY_COUNT
        RETRY_COUNT -->|Yes| SLEEP
        SLEEP --> ATTEMPT
        RETRY_COUNT -->|No| FAIL
    end

    subgraph FailFast["Fail-Fast Behavior"]
        PROJECT_FAIL["Any project fails"]
        ABORT["Abort entire extraction"]
        NO_PUBLISH["No artifact published"]
        EXIT_1["Exit code 1"]

        PROJECT_FAIL --> ABORT
        ABORT --> NO_PUBLISH
        NO_PUBLISH --> EXIT_1
    end
```

## Pipeline Integration

```mermaid
flowchart LR
    subgraph Pipeline["Azure DevOps Pipeline"]
        DOWNLOAD["Download Previous<br/>SQLite Artifact"]
        EXTRACT["Run ado-insights extract"]
        GEN_CSV["Run ado-insights generate-csv"]
        PUBLISH["Publish Artifacts"]
    end

    subgraph Conditions["Publish Conditions"]
        SUCCESS_ONLY["Only on success<br/>(Invariant 7)"]
    end

    DOWNLOAD --> EXTRACT
    EXTRACT --> GEN_CSV
    GEN_CSV --> SUCCESS_ONLY
    SUCCESS_ONLY -->|Pass| PUBLISH
    SUCCESS_ONLY -->|Fail| ABORT["Abort - No Publish"]
```

---

## Summary

This tool extracts **only successfully merged (completed) Pull Requests** from Azure DevOps, filtered by their **closure date**. The distinction between "completed" and "closed" is crucial:

- **Completed** = PR status (merged successfully) → This is what we filter for
- **Closed** = Temporal filter type (use closedDate for date range) → This is how we filter by date

The combination ensures we capture all merged PRs within a date range, enabling accurate cycle time calculations and PowerBI analytics.
