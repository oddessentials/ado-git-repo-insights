# Data Model: CLI Hardening

**Feature**: 039-cli-hardening | **Date**: 2026-03-26

## Summary

No data model changes. This feature modifies CLI behavior only — no new entities, no schema changes, no database modifications, no new file formats.

## Affected Data Surfaces

| Surface | Change | Impact |
|---------|--------|--------|
| `run_summary.json` `tool_version` field | Value source changes from VERSION file to `importlib.metadata` | String value may differ (e.g., `"5.28.1"` → `"5.27.2.dev89+g3bf5b3ba7"` in dev) |
| `__version__` module attribute | Value changes from `"0.0.0"` to resolved version or `"unknown (dev)"` | Any code reading `ado_git_repo_insights.__version__` gets a real value |
| `doctor` "Version:" output | Already uses `importlib.metadata` — fallback changes from `"unknown"` to `"unknown (dev)"` | Minor string change |

## No New Entities

This feature does not introduce any new data entities, configuration schemas, or persistent state.
