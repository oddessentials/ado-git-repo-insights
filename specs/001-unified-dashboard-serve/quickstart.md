# Quickstart: Unified Dashboard Launch

## Prerequisites

- Python 3.10+ with `ado-git-repo-insights` installed
- SQLite database with extracted PR data (from `ado-insights extract`)

## One-Command Dashboard Launch

Build aggregates and immediately view the dashboard:

```bash
ado-insights build-aggregates \
  --db ./ado-insights.sqlite \
  --out ./dataset \
  --serve \
  --open
```

This command:
1. Generates aggregates from your SQLite database to `./dataset`
2. Starts a local HTTP server on port 8080
3. Opens your default browser to `http://localhost:8080`

Press `Ctrl+C` to stop the server when finished.

## Custom Port

Use a different port with `--port`:

```bash
ado-insights build-aggregates \
  --db ./ado-insights.sqlite \
  --out ./dataset \
  --serve \
  --port 3000
```

## Without Browser Auto-Open

Start the server without opening a browser:

```bash
ado-insights build-aggregates \
  --db ./ado-insights.sqlite \
  --out ./dataset \
  --serve
```

Then manually navigate to `http://localhost:8080` in your browser.

## Two-Step Workflow (Original Method)

The original two-step workflow still works:

```bash
# Step 1: Build aggregates
ado-insights build-aggregates \
  --db ./ado-insights.sqlite \
  --out ./dataset

# Step 2: Serve dashboard (separate command)
ado-insights dashboard \
  --dataset ./dataset \
  --open
```

## Flag Requirements

| Flag | Requires |
|------|----------|
| `--serve` | None (standalone) |
| `--open` | `--serve` |
| `--port` | `--serve` |

Using `--open` or `--port` without `--serve` results in an error:

```bash
# ERROR: --open requires --serve
ado-insights build-aggregates --db ./db.sqlite --out ./dataset --open
```

## Verification

After the server starts, you should see:

```
Dashboard running at http://localhost:8080
Press Ctrl+C to stop
```

The dashboard should display your PR metrics visualizations.
