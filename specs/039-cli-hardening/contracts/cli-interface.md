# CLI Interface Contract: Changes in 039-cli-hardening

**Feature**: 039-cli-hardening | **Date**: 2026-03-26

## New Behaviors (Additive)

### `--version` flag

```
$ ado-insights --version
ado-insights 5.27.2.dev89+g3bf5b3ba7
```

- Exits with code 0
- No subcommand required
- Processed before subcommand validation
- Version string comes from `importlib.metadata.version("ado-git-repo-insights")`
- Fallback: `ado-insights unknown (dev)` (with logged WARNING)

### `python -m ado_git_repo_insights`

```
$ python -m ado_git_repo_insights --version
ado-insights 5.27.2.dev89+g3bf5b3ba7

$ python -m ado_git_repo_insights --help
usage: ado-insights [-h] [--version] ...

$ python -m ado_git_repo_insights
usage: ado-insights [-h] [--version] ...
ado-insights: error: the following arguments are required: command
```

- Exit codes propagate correctly via `sys.exit(main())`
- Equivalent to `ado-insights` entry point in all respects

## Changed Behaviors

### `extract` without `--organization`/`--projects`

**Before**:
```
$ ado-insights extract --pat xxx
ERROR ... Configuration error: organization is required
(exit code 1, after logging setup and directory creation)
```

**After**:
```
$ ado-insights extract --pat xxx
usage: ado-insights extract [-h] ...
ado-insights extract: error: --organization and --projects are required when --config is not provided
(exit code 2, zero side effects)
```

### `doctor` in activated virtualenv

**Before**: May show false "PATH Issue Detected" warning.
**After**: No PATH warning when `sys.prefix != sys.base_prefix`.

### Version string in `run_summary.json`

**Before**: `tool_version` reads from VERSION file → `"5.28.1"` (or `"unknown"` in wheel install).
**After**: `tool_version` uses `importlib.metadata` → matches `--version` output.

## Unchanged Behaviors

- All subcommand help text
- All subcommand argument names and defaults
- `--log-format` and `--artifacts-dir` global options
- All extraction, CSV, aggregation, staging, and dashboard logic
- Security: PAT handling, path traversal checks, safe ZIP extraction
- `setup-path` command behavior
- `doctor` output format (stable, line-oriented, no ANSI)

## Forbidden Outputs

The string `"0.0.0"` MUST NOT appear in:
- `--version` output
- `__version__` attribute
- `doctor` "Version:" line
- `run_summary.json` `tool_version` field
