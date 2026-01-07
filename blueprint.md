# Repository Blueprint: _ado-git-repo-insights_

This Python codebase extracts Azure DevOps (ADO) pull request data into a database and produces CSVs for reporting. The **primary contract** is the set of CSV files written under `csv_output/` (used by downstream PowerBI dashboards). Any refactor must **preserve the exact CSV schema and ordering** for these files.

## Current High-Level Flow

1.  **Extraction** (`extractors/ado_pr_extractor.py`): Connects to a local MongoDB and pulls completed PRs from ADO, storing raw PR documents in Mongo collections per project. It iterates over a date range (currently _hardcoded_ from Oct 31 to Nov 30 of the given year) and calls the ADO REST API for each day. Each PR is upserted by its `pullRequestId` into a collection named `{org}_{project}_pull_requests`[\[1\]](https://github.com/oddessentials/ado-pull-request-metrics/blob/52f090be007a0f7d0048775b57d641b183119ba5/extractors/ado_pr_extractor.py#L131-L140)[\[2\]](https://github.com/oddessentials/ado-pull-request-metrics/blob/52f090be007a0f7d0048775b57d641b183119ba5/extractors/ado_pr_extractor.py#L155-L158). The extractor also writes a summary CSV (`{org}_{project}_summary_{year}.csv`) listing each date and count of PRs closed that day[\[3\]](https://github.com/oddessentials/ado-pull-request-metrics/blob/52f090be007a0f7d0048775b57d641b183119ba5/extractors/ado_pr_extractor.py#L75-L81). For example, the README shows running:

- python ado_pr_extractor.py --organization MyOrg --project ProjectOne --personal_access_token <PAT> --year 2025

  which populates MongoDB with all PRs for that project/year[\[4\]](https://github.com/oddessentials/ado-pull-request-metrics/blob/52f090be007a0f7d0048775b57d641b183119ba5/README.md#L105-L113).

2.  **Transformation & CSV Export** (`generate_raw_data.py`): Reads PR documents from MongoDB (all projects/orgs) and “normalizes” them into relational tables (organizations, projects, repositories, pull_requests, users, reviewers). It computes a `pull_request_uid = {repository_id}-{pull_request_id}` to join tables, and calculates `cycle_time_minutes = max(1, difference between closed and creation times)`. Finally it writes out several CSVs in `csv_output/` with fixed schemas:

3.  `organizations.csv` (`organization_name`)

4.  `projects.csv` (`organization_name`, `project_name`)

5.  `repositories.csv` (`repository_id`, `repository_name`, `project_name`, `organization_name`)

6.  `pull_requests.csv` (`pull_request_uid`, `pull_request_id`, `organization_name`, `project_name`, `repository_id`, `user_id`, `title`, `status`, `description`, `creation_date`, `closed_date`, `cycle_time_minutes`)

7.  `users.csv` (`user_id`, `display_name`, `email`)

8.  `reviewers.csv` (`pull_request_uid`, `user_id`, `vote`, `repository_id`)

These CSVs form the **PowerBI data contract** and must remain unchanged in schema/order.

1.  **Reporting** (`generate_report.py` and `pdf_creator.py`): Generates visual reports (CSV summaries and PDFs) from the Mongo data. (This uses helper modules like `get_pull_request_metrics.py` and is _not_ part of the PowerBI CSV contract, but is legacy functionality.)

## Supporting Code

- **MongoDB Schema**: A database `pull_requests_db` with one collection per ADO project: named by `{org}_{project}_pull_requests` after lowercasing and replacing spaces/hyphens with underscores[\[5\]](https://github.com/oddessentials/ado-pull-request-metrics/blob/52f090be007a0f7d0048775b57d641b183119ba5/extractors/ado_pr_extractor.py#L22-L29). Each document is a raw ADO PullRequest JSON (fields like `pullRequestId`, `createdBy`, `reviewers`, `repository`, `creationDate`, `closedDate`, etc).

- **Helper Functions**: The `helper_functions/get_pull_requests.py` module scans all `_pull_requests` collections, filters by date/author/etc., and groups results by org/project. The `get_pull_request_metrics.py` module aggregates stats for reporting.

- **Dependencies**: `requests` for ADO API calls, `pymongo` for MongoDB. MongoDB must be running (default `mongodb://localhost:27017`) when extraction or reporting scripts run (the extractor exits on connect failure[\[6\]](https://github.com/oddessentials/ado-pull-request-metrics/blob/52f090be007a0f7d0048775b57d641b183119ba5/extractors/ado_pr_extractor.py#L36-L45)). Other Python packages include `pandas`, `matplotlib`, `prophet` (see `requirements.txt`).

- **Project Layout**:

- `extractors/ado_pr_extractor.py` – entry point for data extraction.

- `generate_raw_data.py` – entry point for CSV export (PowerBI).

- `generate_report.py` / `pdf_creator.py` – entry point for PDF reports.

- `helper_functions/` – shared utilities (data access, querying).

- `tests/` – (currently minimal or placeholder tests).

## Refactor & Optimization Plan

To convert this into an Azure DevOps–native solution (with no external DB) while preserving outputs, we recommend the following changes:

- **Replace MongoDB with SQLite (or equivalent file DB)**: Store PR data in a local SQLite database (e.g. `ado_pull_requests.sqlite`). SQLite easily supports large data (up to \~~281 TB\~~[\[7\]](https://sqlite.org/limits.html#:~:text=gives%20a%20maximum%20database%20size,large%20as%20about%20281%20terabytes)), so a few hundred MB of PR data is trivial. Using a file-based DB eliminates the need to run and manage a Mongo service. We can define tables for projects, repos, users, PRs, reviewers (mirroring the CSV tables) and insert records as we fetch them. _Alternatively_, if a cloud option is acceptable, Azure Table Storage or Cosmos DB (free tier) could be used, but for _“near 0 cost”_ and simplicity, SQLite is ideal.

- **Unified, Configurable Data Model**: Rather than one Mongo collection per project, use a single SQLite database at the **organization level**. Include columns `organization_name`, `project_name`, etc., in each table so data from multiple projects is stored together. Maintain the same normalization: unique tables for organizations, projects, repositories, pull_requests (with foreign keys or fields linking to org/project), users, and reviewers. This lets us run queries analogous to the old Python transforms. By indexing on dates or IDs, queries remain fast even as data grows.

- **Maintain CSV Schema & Ordering**: The output CSV files (`csv_output/*.csv`) must keep the exact column names and order as today. In practice, ensure the `SELECT` or data-collection logic produces columns in the same sequence. Any new columns must be added _after_ existing ones, and column names should not change. For example, keep `pull_requests.csv` fields in the same order: `pull_request_uid`, `pull_request_id`, `organization_name`, …, `cycle_time_minutes`.

- **Configurable Projects and Date Ranges**: Replace the hardcoded date loop (Oct 31–Nov 30) with parameters. We should support:

- A **configuration file** (e.g. YAML/JSON) listing the target organization and projects to process. For instance:

<!-- -->

- organization: MyOrg
  projects: - ProjectOne - Project Two - AnotherProject

<!-- -->

- CLI arguments or config for date range: allow running for arbitrary start/end dates, and support incremental updates. For daily runs, the script could default to processing “yesterday’s” date, or accept a `--since YYYY-MM-DD` parameter. Also track the last-run date (e.g. in a metadata table in SQLite) so each scheduled run only fetches new PRs.

- This ensures the extractor can be run for **multiple projects in one invocation** (unlike today’s one-project-per-script model) and for _any_ date range, not just November.

- **Incremental Extraction for Real-Time Updates**: Since the goal is to run daily, we should fetch only new/updated PRs each day rather than re-pulling historical data every time. A typical pattern:

- On first run (or on demand), fetch all PRs since a given date (e.g. start of year) and populate the DB.

- On each subsequent run, fetch PRs that were closed **since the last extract date**. (Azure DevOps API supports filtering by closed date.)

- Use UPSERT logic in SQLite (e.g. `INSERT OR REPLACE`) keyed by `(organization, project, repository_id, pullRequestId)` to update any changed records. This avoids re-processing old records and keeps data near real-time.

- **Azure DevOps Extension / Pipeline Integration**: To meet the “ADO extension only” requirement and avoid external infrastructure:

- Package the scripts as an Azure DevOps **Pipeline Task** or use the Azure DevOps CLI extension. The task/CLI can be published as an ADO extension. Users can then add it to pipelines or run it manually.

- Use **Scheduled Pipelines**: Azure DevOps Pipelines support cron-style schedules[\[8\]](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/scheduled-triggers?view=azure-devops#:~:text=Configure%20schedules%20to%20run%20pipelines,on%20using%20scheduled%20triggers). Create a YAML pipeline that triggers daily (or at whatever cadence) and runs our extractor and CSV-generation steps. This achieves automation without needing separate servers.

- The pipeline task would require a **PAT** (Personal Access Token) with “Code (Read)” scope; it can be stored securely in ADO variable groups or Key Vault and passed to the script.

- By running in a pipeline, the scripts execute on Microsoft-hosted agents, so no on-premises machine is needed.

- **Local Storage / Container Option**: If using a pipeline task is not feasible, we could containerize the app. A Docker container (with Python and SQLite) could run on a schedule. Options include:

- **Azure Container Instances/Apps** with a timer (though those have some cost).

- A GitHub Action (if code moved to GitHub) using the Ubuntu runner (free for public repos).

- On a single small VM or any always-on machine in the org (most costly option). However, the pipeline approach or ADO extension is more “frictionless” and cost-free.

- **Preserving Performance and Scale**: With ~600 MB of data today, SQLite is fast and lightweight. We should create indexes on columns we query frequently (e.g. `closed_date`, `pull_request_uid`, `user_id`). Also, storing normalized tables (users, repos) avoids duplication. If data grows (more projects or years), consider strategies like partitioning (e.g. by year) or archiving very old data, but 600 MB over 2 years is not large (SQLite handles TBs[\[7\]](https://sqlite.org/limits.html#:~:text=gives%20a%20maximum%20database%20size,large%20as%20about%20281%20terabytes)).

- **Modular Code Refactoring**:

- Move shared logic (DB connection, org/project name normalization, date filters) into a central module.

- Abstract the current Mongo-based data access into a layer that can be re-implemented with SQLite. For example, a function `get_pull_requests(organization, project, start_date, end_date)` could either query Mongo or SQLite depending on implementation.

- Eliminate hardcoded values (dates, Mongo URI) by using arguments or config.

- Use the same transformation logic, but have it read from SQLite tables instead of JSON/Mongo. (The existing `transform_json()` logic can be adapted to SQL queries.)

- **CSV Output Consistency**: Ensure that `json_to_csv()` or equivalent code writes rows in a deterministic order. For example, always sort by a stable key (like PR creation date or UID) so that CSV diffs are cleaner and PowerBI ingestion is consistent. However, the schema and headers must match exactly the current files for backward compatibility.

- **Testing & Validation**: Enhance automated tests (currently minimal) to cover:

- The extractor with a mock ADO API and sample data.

- The transform and CSV generation functions to ensure schema/order correctness.

- A conversion test: run the old and new scripts on the same sample data and diff the CSVs to confirm they match.

- **Other Considerations**:

- **Rate Limiting**: The current extractor sleeps 1 second per day loop iteration (to avoid API rate limits). With a daily incremental fetch (likely just one API call per project per run), this may not be needed, but it should be configurable. ADO’s REST limits could be handled by retry logic or longer sleeps if needed.

- **Error Handling**: Add robust error checks (e.g. skip incomplete PR data, retry on transient API failures).

- **Logging/Monitoring**: In an automated pipeline, log success/failure clearly. Consider outputting the summary (dates and counts) to pipeline logs.

## Summary of Changes

- **Data Store**: Move from MongoDB to a local SQLite database file for persistence. SQLite easily handles the data volume (hundreds of MB up to terabytes[\[7\]](https://sqlite.org/limits.html#:~:text=gives%20a%20maximum%20database%20size,large%20as%20about%20281%20terabytes)) with no external service cost.
- **Organization-Level DB**: Consolidate all projects in one DB (with columns for org/project) to simplify querying.
- **Dynamic Configuration**: Use a config file or CLI args for organization, project list, and date range (support multiple projects per run). Remove the hardcoded Oct31–Nov30 date loop[\[1\]](https://github.com/oddessentials/ado-pull-request-metrics/blob/52f090be007a0f7d0048775b57d641b183119ba5/extractors/ado_pr_extractor.py#L131-L140).
- **Daily Scheduling**: Run the extractor/transform on a daily schedule (via Azure Pipelines or a hosted run task), fetching only the new PRs since the last run.
- **ADO Integration**: Package scripts as an Azure DevOps extension/task or pipeline step, so users can invoke it within ADO (no new servers needed).
- **Maintain CSV Contract**: Keep the `csv_output/*.csv` schema and column order exactly as today for PowerBI compatibility.
- **Cost**: By using SQLite and built-in ADO pipeline runners (free with most ADO accounts) or lightweight containers, added cost is negligible. No paid cloud database is required.

These optimizations ensure the system continues to meet current requirements (same CSV outputs) while supporting real-time updates and easier maintenance. All existing reports and PowerBI dashboards should work unchanged, because the CSV files they consume remain identical in schema and location.

**Sources:** The above summary is based on analysis of the existing scripts (e.g. `ado_pr_extractor.py`[\[3\]](https://github.com/oddessentials/ado-pull-request-metrics/blob/52f090be007a0f7d0048775b57d641b183119ba5/extractors/ado_pr_extractor.py#L75-L81)[\[1\]](https://github.com/oddessentials/ado-pull-request-metrics/blob/52f090be007a0f7d0048775b57d641b183119ba5/extractors/ado_pr_extractor.py#L131-L140)[\[2\]](https://github.com/oddessentials/ado-pull-request-metrics/blob/52f090be007a0f7d0048775b57d641b183119ba5/extractors/ado_pr_extractor.py#L155-L158)) and documentation. SQLite’s capabilities (terabyte-scale DB) are documented on the SQLite website[\[7\]](https://sqlite.org/limits.html#:~:text=gives%20a%20maximum%20database%20size,large%20as%20about%20281%20terabytes). The Azure DevOps usage is as per the project’s README example[\[4\]](https://github.com/oddessentials/ado-pull-request-metrics/blob/52f090be007a0f7d0048775b57d641b183119ba5/README.md#L105-L113).

---

[\[1\]](https://github.com/oddessentials/ado-pull-request-metrics/blob/52f090be007a0f7d0048775b57d641b183119ba5/extractors/ado_pr_extractor.py#L131-L140) [\[2\]](https://github.com/oddessentials/ado-pull-request-metrics/blob/52f090be007a0f7d0048775b57d641b183119ba5/extractors/ado_pr_extractor.py#L155-L158) [\[3\]](https://github.com/oddessentials/ado-pull-request-metrics/blob/52f090be007a0f7d0048775b57d641b183119ba5/extractors/ado_pr_extractor.py#L75-L81) [\[5\]](https://github.com/oddessentials/ado-pull-request-metrics/blob/52f090be007a0f7d0048775b57d641b183119ba5/extractors/ado_pr_extractor.py#L22-L29) [\[6\]](https://github.com/oddessentials/ado-pull-request-metrics/blob/52f090be007a0f7d0048775b57d641b183119ba5/extractors/ado_pr_extractor.py#L36-L45) ado_pr_extractor.py

<https://github.com/oddessentials/ado-pull-request-metrics/blob/52f090be007a0f7d0048775b57d641b183119ba5/extractors/ado_pr_extractor.py>

[\[4\]](https://github.com/oddessentials/ado-pull-request-metrics/blob/52f090be007a0f7d0048775b57d641b183119ba5/README.md#L105-L113) README.md

<https://github.com/oddessentials/ado-pull-request-metrics/blob/52f090be007a0f7d0048775b57d641b183119ba5/README.md>

[\[7\]](https://sqlite.org/limits.html#:~:text=gives%20a%20maximum%20database%20size,large%20as%20about%20281%20terabytes) Implementation Limits For SQLite

<https://sqlite.org/limits.html>

[\[8\]](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/scheduled-triggers?view=azure-devops#:~:text=Configure%20schedules%20to%20run%20pipelines,on%20using%20scheduled%20triggers) Configure schedules to run pipelines - Azure Pipelines

<https://learn.microsoft.com/en-us/azure/devops/pipelines/process/scheduled-triggers?view=azure-devops>
