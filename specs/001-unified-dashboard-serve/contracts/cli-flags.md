# CLI Contract: build-aggregates Serve Flags

**Version**: 1.0.0
**Feature**: 001-unified-dashboard-serve

## New Arguments for `build-aggregates` Command

### --serve

| Property | Value |
|----------|-------|
| Type | Boolean flag |
| Default | `false` |
| Required | No |
| Help text | "Start local dashboard server after building aggregates" |

**Behavior**:
- When absent: Command exits after aggregate generation (existing behavior)
- When present: After successful aggregate generation, starts HTTP server

### --open

| Property | Value |
|----------|-------|
| Type | Boolean flag |
| Default | `false` |
| Required | No |
| Depends on | `--serve` |
| Help text | "Open browser automatically (requires --serve)" |

**Behavior**:
- When absent: Server starts without opening browser
- When present with `--serve`: Opens default browser to `http://localhost:{port}`
- When present without `--serve`: **ERROR** - exits with code 1 and message "--open requires --serve"

### --port

| Property | Value |
|----------|-------|
| Type | Integer |
| Default | `8080` |
| Required | No |
| Depends on | `--serve` |
| Help text | "Local server port (requires --serve, default: 8080)" |

**Behavior**:
- When `--serve` present: Server binds to specified port
- When non-default value without `--serve`: **ERROR** - exits with code 1 and message "--port requires --serve"
- When default value (8080) without `--serve`: No error (default is not considered explicit usage)

## Validation Rules

### Rule V1: --open requires --serve

```
IF --open is set AND --serve is NOT set:
    EXIT 1 with message "--open requires --serve"
```

### Rule V2: --port (non-default) requires --serve

```
IF --port != 8080 AND --serve is NOT set:
    EXIT 1 with message "--port requires --serve"
```

### Rule V3: Validation timing

- Validation MUST occur before any aggregate generation begins
- Validation MUST occur after argument parsing completes
- Error messages MUST be logged via `logger.error()`

## Command Usage Examples

### Valid Usage

```bash
# Existing behavior (unchanged)
ado-insights build-aggregates --db ./db.sqlite --out ./dataset

# Build and serve on default port
ado-insights build-aggregates --db ./db.sqlite --out ./dataset --serve

# Build, serve, and open browser
ado-insights build-aggregates --db ./db.sqlite --out ./dataset --serve --open

# Build and serve on custom port
ado-insights build-aggregates --db ./db.sqlite --out ./dataset --serve --port 3000

# Build, serve on custom port, and open browser
ado-insights build-aggregates --db ./db.sqlite --out ./dataset --serve --port 3000 --open
```

### Invalid Usage

```bash
# ERROR: --open requires --serve
ado-insights build-aggregates --db ./db.sqlite --out ./dataset --open

# ERROR: --port requires --serve
ado-insights build-aggregates --db ./db.sqlite --out ./dataset --port 3000

# ERROR: both --open and --port require --serve
ado-insights build-aggregates --db ./db.sqlite --out ./dataset --open --port 3000
```

## Exit Codes

| Code | Condition |
|------|-----------|
| 0 | Success (build completed, server stopped gracefully via Ctrl+C) |
| 1 | Build failed, or invalid flag combination, or server error |
| 130 | Keyboard interrupt during build or serve |

## Backward Compatibility

| Scenario | Before | After |
|----------|--------|-------|
| `build-aggregates --db X --out Y` | Exits after build | Exits after build (unchanged) |
| `build-aggregates --db X --out Y --serve` | Error (unknown flag) | Builds then serves |
| `dashboard --dataset Y` | Serves dataset | Serves dataset (unchanged) |

The existing two-step workflow (`build-aggregates` → `dashboard`) remains fully functional.
