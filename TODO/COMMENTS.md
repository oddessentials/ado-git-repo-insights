# PR Comment Collection Feature - Implementation Status

> Last reviewed: 2026-02-05
> Comment dashboard blocker decision (B-11) is resolved in `specs/032-roadmap-blocker-resolution/`.

## Current State: Experimental / Backend-Complete

The PR comment extraction feature has a **complete backend implementation** but is **disabled by default** and **not surfaced in any dashboard**.

---

## What's Implemented ✅

### Database Schema
- **File:** `src/ado_git_repo_insights/persistence/models.py:127-159`
- Tables: `pr_threads`, `pr_comments` with proper foreign keys and indexes
- Supports incremental sync via `last_updated` timestamps

### API Client
- **File:** `src/ado_git_repo_insights/extractor/ado_client.py:457-525`
- Method: `get_pr_threads()`
- Full pagination with continuation tokens
- Rate limit handling (429) with bounded exponential backoff (max 120s)

### Data Access Layer
- **File:** `src/ado_git_repo_insights/persistence/repository.py:507-662`
- `upsert_thread()` - UPSERT with incremental sync support
- `upsert_comment()` - UPSERT with deletion tracking
- `get_thread_last_updated()` - For incremental sync
- `get_thread_count()`, `get_comment_count()` - Statistics

### Extraction Logic
- **File:** `src/ado_git_repo_insights/cli.py:406-538`
- Function: `_extract_comments()`
- Rate limiting via `--comments-max-prs-per-run` (default 100)
- Per-PR limiting via `--comments-max-threads-per-pr` (default 50)
- Skips unchanged threads using `last_updated` (incremental sync)

### CLI Integration
- **File:** `src/ado_git_repo_insights/cli.py:118-136`
- `--include-comments` flag (disabled by default)
- `--comments-max-prs-per-run` (default 100)
- `--comments-max-threads-per-pr` (default 50)

---

## What's Missing ❌

### 1. CSV Export
- **Location:** `src/ado_git_repo_insights/transform/csv_generator.py`
- **Issue:** `pr_threads` and `pr_comments` tables are NOT in `CSV_SCHEMAS`
- **Impact:** PowerBI users cannot access comment data
- **Fix:** Add schemas for both tables to `CSV_SCHEMAS` dict

### 2. JSON Aggregate Output
- **Location:** `src/ado_git_repo_insights/transform/aggregators.py`
- **Issue:** Only metadata is exposed (`features.comments: bool`, coverage stats)
- **Impact:** Actual comment content not available in JSON exports
- **Fix:** Add comment aggregations (e.g., comments per PR, thread resolution rates)

### 3. Dashboard Visualization
- **Location:** `extension/ui/`
- **Issue:** No UI components consume comment data
- **Impact:** Extracted data provides no user-facing value
- **Fix:** Implement a metrics-first comment panel in dashboard (summary cards, weekly trend, repository breakdown, coverage/capped status)

### 4. Documentation
- **Location:** `docs/reference/cli-reference.md`
- **Issue:** `--include-comments` flags are undocumented
- **Impact:** Users don't know the feature exists
- **Fix:** Document all three comment-related CLI flags

### 5. Coverage Tracking
- **Location:** `src/ado_git_repo_insights/transform/aggregators.py:810`
- **Issue:** Doesn't track when rate limits truncated data
- **Impact:** Can't tell if extraction was complete or capped
- **Fix:** Track and expose "capped" state in manifest

---

## How to Enable (Current State)

```bash
# Extract with comments enabled
python -m ado_git_repo_insights extract \
  --include-comments \
  --comments-max-prs-per-run 100 \
  --comments-max-threads-per-pr 50
```

Data will be stored in SQLite (`pr_threads`, `pr_comments` tables) but not exported or visualized.

---

## Suggested Implementation Plan

### Phase 1: Complete Data Pipeline
- [ ] Add `pr_threads` and `pr_comments` to `CSV_SCHEMAS`
- [ ] Add comment aggregations to JSON manifest output
- [ ] Document CLI flags in reference docs

### Phase 2: Dashboard Integration
- [ ] Define TypeScript types for comment data (`extension/ui/types.ts`)
- [ ] Create comment metrics aggregation endpoint
- [ ] Implement comment stats panel (threads per PR, resolution rates, etc.)

### Phase 3: Advanced Analytics
- [ ] Comment sentiment analysis
- [ ] Review velocity metrics (time to first comment, resolution time)
- [ ] Reviewer engagement scoring based on comment activity

---

## Test Coverage

Existing tests:
- `tests/unit/test_comments_extraction.py` - API client, rate limiting, incremental sync
- `tests/unit/test_comments_cli.py` - CLI flag parsing, integration

Tests needed:
- [ ] CSV export tests for comment tables
- [ ] JSON aggregate tests for comment metrics
- [ ] Dashboard component tests

---

## References

- Original implementation: Phase 3.4 (see CHANGELOG.md)
- Database schema: `src/ado_git_repo_insights/persistence/models.py`
- Dataset contract: `docs/reference/dataset-contract.md` (line 68 - features.comments)
