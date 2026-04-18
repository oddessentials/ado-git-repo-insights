# CLI Command Reference

Complete reference for all `ado-insights` commands and options.

---

## Authority

`ado-insights <command> --help` is the authoritative source for flags and
defaults. This reference is a curated overview; if it disagrees with `--help`,
the CLI wins and this file is stale.

---

## Global Options

These flags apply to every subcommand but **must appear before the subcommand
token**. They are registered on the top-level parser, so argparse consumes them
before the subcommand is resolved; placing them after the subcommand fails
with an argparse error.

| Option | Default | Description |
|--------|---------|-------------|
| `--version` | — | Show version and exit |
| `--help` | — | Show help message and exit |
| `--log-format FORMAT` | `console` | `console` or `jsonl` |
| `--artifacts-dir DIR` | `run_artifacts` | Output directory for logs/summary |

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

```bash
ado-insights extract [OPTIONS]
```

### Required Options

`--pat` is always required. Provide either `--config` (a YAML file describing
the org/projects) or `--organization` + `--projects`; runtime enforces the
mutual exclusion.

| Option | Description |
|--------|-------------|
| `--pat PAT` | Personal Access Token with Code (Read) scope |
| `--config FILE` | Path to YAML configuration file |
| `--organization ORG` | Azure DevOps organization name (alternative to `--config`) |
| `--projects PROJECTS` | Comma-separated project names (required when using `--organization`) |

### Optional Options

| Option | Default | Description |
|--------|---------|-------------|
| `--database FILE` | `./ado-insights.sqlite` | SQLite database path |
| `--start-date DATE` | Auto-detected | Start date (YYYY-MM-DD) |
| `--end-date DATE` | Yesterday | End date (YYYY-MM-DD) |
| `--backfill-days N` | None | Re-extract last N days |
| `--include-comments` | `false` | Extract PR discussion threads and comments into SQLite for auxiliary analytics outputs |
| `--comments-max-prs-per-run N` | `100` | Cap how many PRs are scanned for comments in one extraction run |
| `--comments-max-threads-per-pr N` | `50` | Cap how many discussion threads are fetched per PR |

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

```bash
ado-insights backfill-comments [OPTIONS]
```

### Required Options

| Option | Description |
|--------|-------------|
| `--organization ORG` | Azure DevOps organization name |
| `--pat PAT` | Personal Access Token with Code (Read) scope |
| `--database FILE` | Path to SQLite database |

### Optional Options

| Option | Default | Description |
|--------|---------|-------------|
| `--projects PROJECTS` | None (all projects) | Comma-separated project names; empty means every uncovered project is eligible |
| `--since YYYY-MM-DD` | None | Only backfill PRs closed on or after this date (strict `YYYY-MM-DD`) |
| `--until YYYY-MM-DD` | None | Only backfill PRs closed strictly before this date (exclusive) |
| `--limit N` | `0` (no limit) | Maximum PRs processed this run. Throughput is approximately ~1 PR/sec in measured runs (empirical, not a guarantee); size accordingly for your pipeline's timeout. |
| `--comments-max-threads-per-pr N` | `50` | Cap on threads fetched per PR; `0` = unlimited |

### Behavior notes

- **Selection predicate** — `status = 'completed' AND comments_extracted_at IS NULL`, optionally narrowed by `--projects` / `--since` / `--until`, ordered by `closed_date ASC`, capped by `--limit`.
- **Resumability** — re-runs pick up exactly where the last run left off. An empty selection (everything already covered) exits in under a second with zero upstream API calls.
- **Per-PR atomicity** — each PR's thread upserts + marker update are wrapped in an explicit `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`. A mid-PR failure leaves that PR unchanged and the run continues; the failed PR is reselected on the next invocation.
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

```bash
ado-insights generate-csv [OPTIONS]
```

### Required Options

| Option | Description |
|--------|-------------|
| `--database FILE` | Path to SQLite database |

### Optional Options

| Option | Default | Description |
|--------|---------|-------------|
| `--output DIR` | `csv_output` | Output directory for CSV files |

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

```bash
ado-insights generate-aggregates [OPTIONS]
```

### Required Options

| Option | Description |
|--------|-------------|
| `--database FILE` | Path to SQLite database |

### Optional Options

| Option | Default | Description |
|--------|---------|-------------|
| `--output DIR` | `aggregates_output` | Output directory for aggregate files |
| `--run-id ID` | `""` | Pipeline run ID written into the dataset manifest |
| `--enable-ml-stubs` | `false` | Generate stub predictions/insights; requires `ALLOW_ML_STUBS=1` in the environment |
| `--seed-base STR` | `""` | Base string for deterministic stub seeding |
| `--enable-predictions` | `false` | Enable Prophet-based trend forecasting (requires `prophet`) |
| `--enable-insights` | `false` | Enable OpenAI-based insights (requires `openai` and `OPENAI_API_KEY`) |
| `--insights-max-tokens N` | `1000` | Max tokens for the OpenAI insights response |
| `--insights-cache-ttl-hours N` | `24` | Cache TTL for insights in hours |
| `--insights-dry-run` | `false` | Produce the prompt artifact without calling OpenAI |

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

```bash
ado-insights build-aggregates [OPTIONS]
```

### Required Options

| Option | Description |
|--------|-------------|
| `--db FILE` | Path to SQLite database |

### Optional Options

| Option | Default | Description |
|--------|---------|-------------|
| `--out DIR` | `dataset` | Output directory for aggregate files |
| `--run-id ID` | `local` | Run identifier written into dataset manifest metadata |
| `--enable-predictions` | `false` | Generate ML predictions (Prophet if installed, else NumPy regression) |
| `--enable-insights` | `false` | Generate AI insights (requires `OPENAI_API_KEY`) |
| `--insights-max-tokens N` | `1000` | Max tokens for the OpenAI insights response |
| `--insights-cache-ttl-hours N` | `24` | Cache TTL for insights in hours |
| `--insights-dry-run` | `false` | Produce the prompt artifact without calling OpenAI |
| `--serve` | `false` | Start local dashboard server after building |
| `--open` | `false` | Open browser automatically (requires `--serve`) |
| `--port PORT` | `8080` | Local server port (requires `--serve`) |

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

```bash
ado-insights stage-artifacts [OPTIONS]
```

### Required Options

| Option | Description |
|--------|-------------|
| `--org ORG` | Azure DevOps organization name |
| `--project PROJECT` | Azure DevOps project name |
| `--pipeline-id ID` | Pipeline definition ID |
| `--pat PAT` | Personal Access Token with Build (Read) scope |

### Optional Options

| Option | Default | Description |
|--------|---------|-------------|
| `--artifact NAME` | `aggregates` | Artifact name to download |
| `--out DIR` | `./run_artifacts` | Output directory |
| `--run-id ID` | Latest | Specific pipeline run ID |
| `--serve` | `false` | Start local dashboard server after staging |
| `--open` | `false` | Open browser automatically (requires `--serve`) |
| `--port PORT` | `8080` | Local server port (requires `--serve`) |

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

```bash
ado-insights dashboard [OPTIONS]
```

### Optional Options

| Option | Default | Description |
|--------|---------|-------------|
| `--dataset DIR` | `./run_artifacts` | Path to aggregates directory |
| `--port PORT` | `8080` | HTTP server port |
| `--open` | `false` | Automatically open browser |

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

```bash
ado-insights setup-path [OPTIONS]
```

### Optional Options

| Option | Default | Description |
|--------|---------|-------------|
| `--print-only` | `false` | Print the PATH command without modifying any shell config file |
| `--remove` | `false` | Remove a previously added PATH configuration |

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

```bash
ado-insights doctor
```

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
