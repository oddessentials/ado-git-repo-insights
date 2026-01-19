# CLI Command Reference

Complete reference for all `ado-insights` commands and options.

---

## Global Options

| Option | Description |
|--------|-------------|
| `--version` | Show version and exit |
| `--help` | Show help message and exit |

---

## extract

Extract Pull Request data from Azure DevOps.

```bash
ado-insights extract [OPTIONS]
```

### Required Options (one of)

| Option | Description |
|--------|-------------|
| `--config FILE` | Path to YAML configuration file |
| `--organization ORG` | Azure DevOps organization name |

If using `--organization`, also required:
| Option | Description |
|--------|-------------|
| `--projects PROJECTS` | Comma-separated project names |
| `--pat PAT` | Personal Access Token with Code (Read) scope |

### Optional Options

| Option | Default | Description |
|--------|---------|-------------|
| `--database FILE` | `./ado-insights.sqlite` | SQLite database path |
| `--start-date DATE` | Auto-detected | Start date (YYYY-MM-DD) |
| `--end-date DATE` | Yesterday | End date (YYYY-MM-DD) |
| `--backfill-days N` | None | Re-extract last N days |
| `--log-format FORMAT` | `text` | `text` or `jsonl` |
| `--artifacts-dir DIR` | `./run_artifacts` | Output directory for logs/summary |

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

## generate-csv

Generate PowerBI-compatible CSV files from the database.

```bash
ado-insights generate-csv [OPTIONS]
```

### Required Options

| Option | Description |
|--------|-------------|
| `--database FILE` | Path to SQLite database |
| `--output DIR` | Output directory for CSV files |

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
| `--out DIR` | Output directory for aggregates |

### Optional Options

| Option | Default | Description |
|--------|---------|-------------|
| `--enable-predictions` | `false` | Generate ML predictions (requires `[ml]` extra) |
| `--enable-insights` | `false` | Generate AI insights (requires `[ml]` extra) |

### Examples

```bash
ado-insights build-aggregates \
  --db ./ado-insights.sqlite \
  --out ./dataset
```

**With ML features:**
```bash
pip install ado-git-repo-insights[ml]

ado-insights build-aggregates \
  --db ./ado-insights.sqlite \
  --out ./dataset \
  --enable-predictions \
  --enable-insights
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

## dashboard

Serve the PR Insights dashboard locally.

```bash
ado-insights dashboard [OPTIONS]
```

### Required Options

| Option | Description |
|--------|-------------|
| `--dataset DIR` | Path to aggregates directory |

### Optional Options

| Option | Default | Description |
|--------|---------|-------------|
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

---

## See Also

- [CLI User Guide](../user-guide/local-cli.md) — Getting started with the CLI
- [CSV Schema](csv-schema.md) — Output file format details
- [Troubleshooting](../user-guide/troubleshooting.md) — Common issues
