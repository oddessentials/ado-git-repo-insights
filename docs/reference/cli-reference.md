# CLI Command Reference

Complete reference for all `ado-insights` commands and options.

---

## Authority

The flag tables in this reference are generated from `create_parser()` in
`src/ado_git_repo_insights/cli.py` via
`python scripts/generate_cli_reference.py`. `ado-insights <command> --help`
and this file are emitted from the same parser, so they cannot disagree —
drift is gated in CI and on pre-push via the generator's `--check` mode.
Prose sections (intros, examples, behavior notes, PAT scopes, ML narrative)
remain hand-written and sit outside the generated regions.

---

## Global Options

These flags apply to every subcommand but **must appear before the subcommand
token**. They are registered on the top-level parser, so argparse consumes them
before the subcommand is resolved; placing them after the subcommand fails
with an argparse error. `--help` and `--version` are always available on the
top-level parser and every subparser but are not re-listed below.

<!-- BEGIN GENERATED: cli-reference:global-options -->
| Option | Default | Description |
|--------|---------|-------------|
| `--log-format LOG_FORMAT` | `console` | Log format: console (human-readable) or jsonl (structured) |
| `--artifacts-dir ARTIFACTS_DIR` | `./run_artifacts` | Directory for run artifacts (summary, logs) |
<!-- END GENERATED: cli-reference:global-options -->

**Correct:**

```bash
ado-insights --log-format jsonl extract --organization MyOrg --projects P1 --pat $PAT
ado-insights --artifacts-dir ./out build-aggregates --db ./ado-insights.sqlite
```

**Incorrect (argparse error):**

```bash
ado-insights extract --log-format jsonl --organization MyOrg ...   # fails
ado-insights build-aggregates --artifacts-dir ./out --db ...       # fails
```

---

## Subcommand Flag Differences

> `extract` and `stage-artifacts` use **different flag names** for the same
> concepts. Do not mix them.

| Concept | `extract` | `stage-artifacts` |
|---------|-----------|-------------------|
| Organization | `--organization` | `--org` |
| Project | `--projects` (plural, comma-separated) | `--project` (singular) |
| Output path | `--database` (default: `./ado-insights.sqlite`) | `--out` (default: `./run_artifacts`) |

## PAT Scopes

| Command | Required PAT Scope |
|---------|-------------------|
| `extract` | Code (Read) |
| `stage-artifacts` | Build (Read) |
| `build-aggregates` | None (local only) |
| `dashboard` | None (local only) |

---

## extract

Extract Pull Request data from Azure DevOps.

`--pat` is always required. Either `--config` (a YAML file describing the
org/projects) OR `--organization` + `--projects` must be supplied; runtime
enforces this mutual exclusion. Because argparse does not mark the
conditional flags as unconditionally required, they appear under **Optional
Options** below — consult their descriptions for the cross-flag constraint.

<!-- BEGIN GENERATED: cli-reference:extract -->
```bash
ado-insights extract [OPTIONS]
```

### Required Options

| Option | Description |
|--------|-------------|
| `--pat PAT` | Personal Access Token with Code (Read) scope |

### Optional Options

| Option | Default | Description |
|--------|---------|-------------|
| `--organization ORGANIZATION` | `None` | Azure DevOps organization name (alternative to --config; requires --projects when used) |
| `--projects PROJECTS` | `None` | Comma-separated list of project names (required when --organization is used) |
| `--config CONFIG` | `None` | Path to config.yaml file |
| `--database DATABASE` | `./ado-insights.sqlite` | Path to SQLite database file |
| `--start-date START_DATE` | `None` | Override start date (YYYY-MM-DD); auto-detected from the last-successful-run marker in the database when omitted |
| `--end-date END_DATE` | `None` | Override end date (YYYY-MM-DD); defaults to yesterday (UTC) when omitted |
| `--backfill-days BACKFILL_DAYS` | `None` | Re-extract the last N days (overrides incremental mode to UPSERT over existing records for convergence with late-arriving state changes) |
| `--include-comments` | `false` | Extract PR discussion threads and comments into SQLite for auxiliary analytics outputs (feature-flagged) |
| `--comments-max-prs-per-run COMMENTS_MAX_PRS_PER_RUN` | `100` | Max PRs to fetch comments for per run (rate limit protection) |
| `--comments-max-threads-per-pr COMMENTS_MAX_THREADS_PER_PR` | `50` | Max threads to fetch per PR (optional limit; 0 = unlimited) |
<!-- END GENERATED: cli-reference:extract -->

**When to use backfill:** Incremental extraction (the default) only fetches
PRs closed since the last run. Late-arriving changes (review votes, state
updates after initial close) can cause drift. `--backfill-days N` overrides
incremental mode and re-fetches the last N days, UPSERTing over existing
records to converge state.

### Examples

**Basic extraction:**
```bash
ado-insights extract \
  --organization MyOrg \
  --projects "Project1,Project2" \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite
```

**With configuration file:**
```bash
ado-insights extract --config config.yaml --pat $ADO_PAT
```

**Backfill last 60 days:**
```bash
ado-insights extract \
  --organization MyOrg \
  --projects "Project1" \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite \
  --backfill-days 60
```

**Specific date range:**
```bash
ado-insights extract \
  --organization MyOrg \
  --projects "Project1" \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite \
  --start-date 2024-01-01 \
  --end-date 2024-12-31
```

**Comments-enabled extraction with explicit caps:**
```bash
ado-insights extract \
  --organization MyOrg \
  --projects "Project1" \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite \
  --include-comments \
  --comments-max-prs-per-run 100 \
  --comments-max-threads-per-pr 50
```

**Include today:**
```bash
ado-insights extract \
  --organization MyOrg \
  --projects "Project1" \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite \
  --end-date $(date +%Y-%m-%d)
```

---

## backfill-comments

Drain PR thread coverage for historical completed PRs whose
`comments_extracted_at` marker is NULL. Oldest-by-`closed_date` first.

Use this after flipping `--include-comments` on in your extract flow: extract
only fetches comments for the most recent `--comments-max-prs-per-run` PRs, so
historical PRs need this one-time catch-up. Extract and backfill are intentionally
disjoint CLI paths — backfill has no `--config`, no start/end date range (it
uses `--since` / `--until` against the already-populated `pull_requests`
table), and never re-fetches PR metadata.

<!-- BEGIN GENERATED: cli-reference:backfill-comments -->
```bash
ado-insights backfill-comments [OPTIONS]
```

### Required Options

| Option | Description |
|--------|-------------|
| `--organization ORGANIZATION` | Azure DevOps organization name (required). Must match the organization the target pull requests belong to; used to construct the upstream thread-fetch URL. |
| `--pat PAT` | Personal Access Token with Code (Read) scope (required). The token MUST have read access to every repository whose pull requests fall within the run's selection scope; pull requests in repositories the token cannot read will surface as per-pull-request failures in the run-summary artifact. |

### Optional Options

| Option | Default | Description |
|--------|---------|-------------|
| `--database DATABASE` | `./ado-insights.sqlite` | Path to the SQLite database file to operate on (default: 'ado-insights.sqlite'). The database MUST already exist and MUST contain the pull_requests, pr_threads, and pr_comments tables. Databases that lack pr_threads and pr_comments (legacy schema) trigger a successful no-op with a legacy-schema-skip warning. |
| `--projects PROJECTS` | `None` | Comma-separated list of project names to restrict the run to (default: no filter — all projects are eligible). Entries are trimmed of surrounding whitespace, empty entries are dropped, and input order is preserved; the match against each pull request's stored project_name is case-sensitive and exact. Parsing is behaviorally identical to the project-list input accepted by 'extract'; invalid entries do not raise — they simply match zero pull requests. |
| `--since SINCE` | `None` | Inclusive closed-date lower bound, in YYYY-MM-DD form (default: no lower bound). Pull requests with closed_date strictly less than this value are excluded from the selection. Combines with --until to form the half-open interval [since, until). Date-shape validation is behaviorally identical to 'extract --start-date'; malformed values (e.g., 2024-13-99 or not-a-date) are rejected before any database or network work begins. |
| `--until UNTIL` | `None` | Exclusive closed-date upper bound, in YYYY-MM-DD form (default: no upper bound). Pull requests with closed_date greater than or equal to this value are excluded from the selection. Combines with --since to form the half-open interval [since, until); '--since X --until X' matches zero pull requests (valid but empty filter, not an error). Date-shape validation is behaviorally identical to 'extract --end-date'; malformed values are rejected before any database or network work begins. |
| `--limit LIMIT` | `0` | Maximum number of pull requests to process in this run (default: 0, which means unbounded — every uncovered pull request matching the filters is processed). Negative values are rejected. The limit is applied after the --projects / --since / --until filters, so '--limit N' bounds the count of processed pull requests, not the count of candidate pull requests before filtering. Use a finite --limit to bound a single invocation's API budget; re-invoke with the same arguments to continue draining from where the last run stopped. |
| `--comments-max-threads-per-pr COMMENTS_MAX_THREADS_PER_PR` | `50` | Maximum number of threads to fetch per pull request (default: 50, matching the extract flow's default; 0 means unlimited). When a pull request's thread count exceeds this cap, the earliest threads returned by the upstream API are persisted and the dropped remainder is inspected against local storage to decide whether the pull request's coverage marker can be set (when every dropped thread is already stored and current) or MUST be left unchanged (when any dropped thread is missing or stale locally). Negative values are rejected. |
<!-- END GENERATED: cli-reference:backfill-comments -->

### Behavior notes

- **Selection predicate** — `status = 'completed' AND comments_extracted_at IS NULL`, optionally narrowed by `--projects` / `--since` / `--until`, ordered by `closed_date ASC`, capped by `--limit`.
- **Resumability** — re-runs pick up exactly where the last run left off. An empty selection (everything already covered) exits in under a second with zero upstream API calls.
- **Per-PR atomicity** — each PR's thread upserts + marker update are wrapped in an explicit `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`. A mid-PR failure leaves that PR unchanged and the run continues; the failed PR is reselected on the next invocation.
- **Throughput** — approximately ~1 PR/sec in measured runs (empirical, not a guarantee); size `--limit` accordingly for your pipeline's timeout.
- **Exit codes** — `0` when the loop ran to completion (regardless of per-PR failure rate) and for the legacy both-missing schema no-op, `1` for fatal pre-loop errors (invalid PAT, unreachable org, invalid database, partial schema), `130` for SIGINT.

### Examples

**Drain the entire backlog (small org):**
```bash
ado-insights backfill-comments \
  --organization MyOrg \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite
```

**Capped daily run on a large backlog:**
```bash
ado-insights backfill-comments \
  --organization MyOrg \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite \
  --limit 2500
```

**Scope to one project + date window:**
```bash
ado-insights backfill-comments \
  --organization MyOrg \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite \
  --projects ProjectA \
  --since 2024-01-01 --until 2025-01-01 \
  --limit 1000
```

### When to use this over `extract --include-comments`

- `extract --include-comments` — covers the most recent `--comments-max-prs-per-run` PRs by `closed_date DESC`. Designed for steady-state incremental runs.
- `backfill-comments` — covers uncovered PRs oldest-first with explicit per-PR atomicity. Designed for one-time backlog drains and resumable catch-up runs.

The two paths never duplicate work: `extract`'s selection does not filter on coverage, while `backfill`'s filters strictly on `comments_extracted_at IS NULL`.

---

## generate-csv

Generate PowerBI-compatible CSV files from the database.

<!-- BEGIN GENERATED: cli-reference:generate-csv -->
```bash
ado-insights generate-csv [OPTIONS]
```

### Required Options

| Option | Description |
|--------|-------------|
| `--database DATABASE` | Path to SQLite database file |

### Optional Options

| Option | Default | Description |
|--------|---------|-------------|
| `--output OUTPUT` | `./csv_output` | Output directory for CSV files |
<!-- END GENERATED: cli-reference:generate-csv -->

### Examples

```bash
ado-insights generate-csv \
  --database ./ado-insights.sqlite \
  --output ./csv_output
```

### Output Files

| File | Description |
|------|-------------|
| `organizations.csv` | Organization records |
| `projects.csv` | Project records |
| `repositories.csv` | Repository records |
| `pull_requests.csv` | PR details with cycle time |
| `users.csv` | User records |
| `reviewers.csv` | PR reviewer votes |

Auxiliary comment CSVs, when comments have been extracted, are written only under:

`csv-output/auxiliary/comments/`

- `pr_threads.csv`
- `pr_comments.csv`

These files are additive and are not part of the core PowerBI CSV contract.

---

## generate-aggregates

Generate the chunked JSON aggregates the dashboard UI reads. This is the
pipeline command; `build-aggregates` below is a local convenience wrapper
that calls the same code path.

<!-- BEGIN GENERATED: cli-reference:generate-aggregates -->
```bash
ado-insights generate-aggregates [OPTIONS]
```

### Required Options

| Option | Description |
|--------|-------------|
| `--database DATABASE` | Path to SQLite database file |

### Optional Options

| Option | Default | Description |
|--------|---------|-------------|
| `--output OUTPUT` | `./aggregates_output` | Output directory for aggregate files |
| `--run-id RUN_ID` | `""` | Pipeline run ID for manifest metadata |
| `--enable-ml-stubs` | `false` | Generate stub predictions/insights (requires ALLOW_ML_STUBS=1 env var) |
| `--seed-base SEED_BASE` | `""` | Base string for deterministic stub seeding |
| `--enable-predictions` | `false` | Enable Prophet-based trend forecasting (requires prophet package) |
| `--enable-insights` | `false` | Enable OpenAI-based insights (requires openai package and OPENAI_API_KEY) |
| `--insights-max-tokens INSIGHTS_MAX_TOKENS` | `1000` | Maximum tokens for OpenAI insights response (default: 1000) |
| `--insights-cache-ttl-hours INSIGHTS_CACHE_TTL_HOURS` | `24` | Cache TTL for insights in hours (default: 24) |
| `--insights-dry-run` | `false` | Generate prompt artifact without calling OpenAI API |
<!-- END GENERATED: cli-reference:generate-aggregates -->

### Examples

```bash
ado-insights generate-aggregates \
  --database ./ado-insights.sqlite \
  --output ./aggregates_output \
  --run-id $BUILD_BUILDID
```

---

## build-aggregates

Generate dashboard-compatible aggregate files.

<!-- BEGIN GENERATED: cli-reference:build-aggregates -->
```bash
ado-insights build-aggregates [OPTIONS]
```

### Required Options

| Option | Description |
|--------|-------------|
| `--db DB` | Path to SQLite database file |

### Optional Options

| Option | Default | Description |
|--------|---------|-------------|
| `--out OUT` | `./dataset` | Output directory for dataset files (default: ./dataset) |
| `--run-id RUN_ID` | `local` | Run ID for manifest metadata (default: local) |
| `--enable-predictions` | `false` | Generate ML predictions (Prophet if installed, else NumPy linear regression fallback) |
| `--enable-insights` | `false` | Enable OpenAI-based insights (requires openai package and OPENAI_API_KEY) |
| `--insights-max-tokens INSIGHTS_MAX_TOKENS` | `1000` | Maximum tokens for OpenAI insights response (default: 1000) |
| `--insights-cache-ttl-hours INSIGHTS_CACHE_TTL_HOURS` | `24` | Cache TTL for insights in hours (default: 24) |
| `--insights-dry-run` | `false` | Generate prompt artifact without calling OpenAI API |
| `--serve` | `false` | Start local dashboard server after building aggregates |
| `--open` | `false` | Open browser automatically (requires --serve) |
| `--port PORT` | `8080` | Local server port (requires --serve, default: 8080) |
<!-- END GENERATED: cli-reference:build-aggregates -->

### Examples

```bash
ado-insights build-aggregates \
  --db ./ado-insights.sqlite \
  --out ./dataset
```

**Build and immediately view dashboard (one command):**
```bash
ado-insights build-aggregates \
  --db ./ado-insights.sqlite \
  --out ./dataset \
  --serve \
  --open
```

**Build and serve on custom port:**
```bash
ado-insights build-aggregates \
  --db ./ado-insights.sqlite \
  --out ./dataset \
  --serve \
  --port 3000
```

**With predictions (zero-config):**
```bash
# Works out of the box - no additional dependencies
ado-insights build-aggregates \
  --db ./ado-insights.sqlite \
  --out ./dataset \
  --enable-predictions
```

**With predictions (Prophet enhanced):**
```bash
# Install Prophet for enhanced forecasting
pip install prophet>=1.1.0

ado-insights build-aggregates \
  --db ./ado-insights.sqlite \
  --out ./dataset \
  --enable-predictions
```

**With AI insights:**
```bash
export OPENAI_API_KEY=sk-...

ado-insights build-aggregates \
  --db ./ado-insights.sqlite \
  --out ./dataset \
  --enable-insights
```

**Full ML features:**
```bash
export OPENAI_API_KEY=sk-...

ado-insights build-aggregates \
  --db ./ado-insights.sqlite \
  --out ./dataset \
  --enable-predictions \
  --enable-insights \
  --serve \
  --open
```

### Output Files

| File | Description |
|------|-------------|
| `dataset-manifest.json` | Discovery entry point |
| `aggregates/dimensions.json` | Filter dimensions |
| `aggregates/weekly_rollups/YYYY-Www.json` | Weekly metrics |
| `aggregates/distributions/YYYY.json` | Yearly distributions |
| `predictions/trends.json` | ML forecasts (optional) |
| `insights/summary.json` | AI insights (optional) |

---

## stage-artifacts

Download pipeline artifacts from Azure DevOps to local directory. **This is the recommended workflow for viewing production data.**

<!-- BEGIN GENERATED: cli-reference:stage-artifacts -->
```bash
ado-insights stage-artifacts [OPTIONS]
```

### Required Options

| Option | Description |
|--------|-------------|
| `--org ORG` | Azure DevOps organization name |
| `--project PROJECT` | Azure DevOps project name |
| `--pipeline-id PIPELINE_ID` | Pipeline definition ID. Selects most recent completed build (succeeded or partiallySucceeded) by finish time. |
| `--pat PAT` | Personal Access Token with Build (Read) scope |

### Optional Options

| Option | Default | Description |
|--------|---------|-------------|
| `--artifact ARTIFACT` | `aggregates` | Artifact name to download (default: aggregates) |
| `--out OUT` | `./run_artifacts` | Output directory (default: ./run_artifacts) |
| `--run-id RUN_ID` | `None` | Specific pipeline run ID (default: latest successful) |
| `--serve` | `false` | Start local dashboard server after staging artifacts |
| `--open` | `false` | Open browser automatically (requires --serve) |
| `--port PORT` | `8080` | Local server port (requires --serve, default: 8080) |
<!-- END GENERATED: cli-reference:stage-artifacts -->

### Examples

**Download and view dashboard (single command):**
```bash
ado-insights stage-artifacts \
  --org oddessentials \
  --project oddessentials \
  --pipeline-id 123 \
  --pat $ADO_PAT \
  --serve --open
```

**Download only (two-step workflow):**
```bash
ado-insights stage-artifacts \
  --org oddessentials \
  --project oddessentials \
  --pipeline-id 123 \
  --pat $ADO_PAT

# Then view separately
ado-insights dashboard --dataset ./run_artifacts --open
```

**Custom port:**
```bash
ado-insights stage-artifacts \
  --org oddessentials \
  --project oddessentials \
  --pipeline-id 123 \
  --pat $ADO_PAT \
  --serve --port 3000
```

---

## dashboard

Serve the PR Insights dashboard locally.

<!-- BEGIN GENERATED: cli-reference:dashboard -->
```bash
ado-insights dashboard [OPTIONS]
```

### Optional Options

| Option | Default | Description |
|--------|---------|-------------|
| `--dataset DATASET` | `./run_artifacts` | Path to dataset folder or run_artifacts dir (default: ./run_artifacts) |
| `--port PORT` | `8080` | Local server port (default: 8080) |
| `--open` | `false` | Open browser automatically |
<!-- END GENERATED: cli-reference:dashboard -->

### Examples

```bash
# Basic usage
ado-insights dashboard --dataset ./dataset

# Custom port with auto-open
ado-insights dashboard --dataset ./dataset --port 3000 --open
```

### Notes

- The local dashboard provides the same visualizations as the ADO extension hub
- "Download Raw Data (ZIP)" export is unavailable in local mode (no pipeline artifacts)

---

## setup-path

Configure the shell `PATH` so `ado-insights` is callable after a `pip install`
into a user site-packages directory. Not needed for `pipx` or `uv tool
install`, which manage `PATH` themselves.

<!-- BEGIN GENERATED: cli-reference:setup-path -->
```bash
ado-insights setup-path [OPTIONS]
```

### Optional Options

| Option | Default | Description |
|--------|---------|-------------|
| `--print-only` | `false` | Output the PATH command without modifying any files |
| `--remove` | `false` | Remove previously added PATH configuration |
<!-- END GENERATED: cli-reference:setup-path -->

### Examples

```bash
# Print the command that would be added (preview)
ado-insights setup-path --print-only

# Apply the PATH change to the current shell's config file
ado-insights setup-path

# Undo a previous setup
ado-insights setup-path --remove
```

---

## doctor

Diagnose installation problems (multiple installations, broken `PATH`,
mismatched Python interpreter, etc.). Takes no arguments.

<!-- BEGIN GENERATED: cli-reference:doctor -->
```bash
ado-insights doctor [OPTIONS]
```
<!-- END GENERATED: cli-reference:doctor -->

### Examples

```bash
# Run diagnostics
ado-insights doctor
```

Use this when `ado-insights` behaves unexpectedly or when upgrading from
a previous install method (pip → pipx/uv migration).

---

## Configuration File

YAML configuration file format:

```yaml
# Required
organization: MyOrg

# Required (list)
projects:
  - ProjectOne
  - ProjectTwo
  - Project%20With%20Spaces  # URL-encoded names supported

# Optional: API settings
api:
  base_url: https://dev.azure.com  # Default
  version: 7.1-preview.1            # Default
  rate_limit_sleep_seconds: 0.5     # Delay between API calls
  max_retries: 3                    # Retry attempts on failure
  retry_delay_seconds: 5            # Initial retry delay
  retry_backoff_multiplier: 2.0     # Exponential backoff factor

# Optional: Backfill settings
backfill:
  enabled: true
  window_days: 60
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Extraction or generation failed |
| `2` | Invalid arguments or configuration |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PYTHONLOGLEVEL` | Set to `DEBUG` for verbose logging |
| `ALLOW_ML_STUBS` | Set to `1` to permit `generate-aggregates --enable-ml-stubs`; the flag errors out without it |

---

## ML Features

The CLI includes machine learning features for predictive analytics and AI-powered insights.

### Predictions

Generate time-series forecasts for PR metrics.

**Zero-Config Mode (Default):**
```bash
ado-insights build-aggregates --db data.db --out ./dataset --enable-predictions
```

Uses NumPy-based linear regression. No additional dependencies required.

**Prophet Mode (Enhanced):**
```bash
pip install prophet>=1.1.0
ado-insights build-aggregates --db data.db --out ./dataset --enable-predictions
```

Automatically detected when Prophet is installed. Provides seasonality analysis and more accurate forecasts.

**Output:** `predictions/trends.json`

| Field | Description |
|-------|-------------|
| `forecaster` | `linear` or `prophet` |
| `data_quality` | `normal`, `low_confidence`, or `insufficient` |
| `forecasts` | Array of metric forecasts with confidence bands |

**Data Requirements:**

| Data Quality | Weeks Required | Recommendation |
|--------------|----------------|----------------|
| `insufficient` | <4 | Cannot generate predictions |
| `low_confidence` | 4-7 | Predictions available, accuracy limited |
| `normal` | 8+ | Full confidence predictions |

### AI Insights

Generate actionable insights using OpenAI.

```bash
export OPENAI_API_KEY=sk-...
ado-insights build-aggregates --db data.db --out ./dataset --enable-insights
```

**Output:** `insights/summary.json`

| Field | Description |
|-------|-------------|
| `insights` | Array of insight objects |
| `insights[].category` | `bottleneck`, `trend`, or `anomaly` |
| `insights[].severity` | `critical`, `warning`, or `info` |
| `insights[].recommendation` | Actionable recommendation with priority/effort |

**Caching:**
- Results cached for 12 hours
- Cache key includes data freshness markers
- Delete `insights/cache.json` to force regeneration

**Cost:**
- ~$0.001-0.01 per pipeline run
- Caching minimizes API calls

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key (required for `--enable-insights`) |
| `OPENAI_MODEL` | Model override (default: `gpt-5-nano`) |

---

## See Also

- [CLI User Guide](../user-guide/local-cli.md) — Getting started with the CLI
- [CSV Schema](csv-schema.md) — Output file format details
- [Troubleshooting](../user-guide/troubleshooting.md) — Common issues
- [Enable ML Features](../internal/enable-ml-features.md) — Detailed ML setup guide
- [Manual Testing Walkthrough](../internal/manual-walkthrough.md) — End-to-end CLI scenarios
