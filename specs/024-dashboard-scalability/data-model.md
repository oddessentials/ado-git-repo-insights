# Data Model: Dashboard Scalability

**Feature**: 024-dashboard-scalability
**Date**: 2026-02-05

## Overview

This feature extends existing data models rather than creating new ones. The primary changes are:
1. Generator CLI argument handling
2. Comment data generation (matching existing schema)
3. Chart rendering constants

---

## Entity: Generator Configuration

**Purpose**: CLI arguments for synthetic data generation

### Fields

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `pr_count` | integer | Required, choices: [100, 1000, 5000, 10000, 20000] | Number of PRs to simulate |
| `weeks` | integer | Optional, 1-520 | Number of weeks to span |
| `users` | integer | Optional, 1-500 | Number of users/reviewers to generate |
| `include_comments` | boolean | Optional, default: False | Enable comment data generation |
| `seed` | integer | Optional, default: 42 | Random seed for deterministic output |
| `output` | path | Required | Output directory |

### Validation Rules

1. If `--users 0` → Error: "Users must be at least 1"
2. If `--weeks 0` → Error: "Weeks must be at least 1"
3. If `--weeks > 520` → Error: "Weeks cannot exceed 520 (10 years)"
4. If `--users > 500` → Error: "Users cannot exceed 500"

### Default Calculations

When not provided:
- `weeks = min(156, max(4, pr_count // 20))`
- `users = min(200, max(10, pr_count // 10))`

---

## Entity: Synthetic Thread

**Purpose**: PR review thread for comment generation

### Fields

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `thread_id` | string | Primary key, UUID format | Unique thread identifier |
| `pull_request_uid` | string | Foreign key to PRs | Associated pull request |
| `status` | string | Enum: active, fixed, closed | Thread resolution status |
| `thread_context` | string | JSON, nullable | File path and line range |
| `created_at` | string | ISO 8601 datetime | Thread creation time |
| `last_updated` | string | ISO 8601 datetime | Last modification time |
| `is_deleted` | integer | 0 or 1 | Soft delete flag |

### Generation Rules

- Threads per PR: Random uniform [2, 5]
- Status distribution: 60% active, 25% fixed, 15% closed
- Created within PR's date range
- Last updated >= created_at

---

## Entity: Synthetic Comment

**Purpose**: Individual comment within a thread

### Fields

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `comment_id` | string | Primary key, UUID format | Unique comment identifier |
| `thread_id` | string | Foreign key to threads | Parent thread |
| `pull_request_uid` | string | Foreign key to PRs | Associated pull request |
| `author_id` | string | Foreign key to users | Comment author |
| `content` | string | Non-empty | Comment text content |
| `comment_type` | string | Enum: text, codeChange, system | Type of comment |
| `created_at` | string | ISO 8601 datetime | Comment creation time |
| `last_updated` | string | ISO 8601 datetime, nullable | Last edit time |
| `is_deleted` | integer | 0 or 1 | Soft delete flag |

### Generation Rules

- Comments per thread: Random uniform [1, 4]
- Type distribution: 85% text, 10% codeChange, 5% system
- Author: Random selection from user pool
- Content: "Synthetic comment #{sequence_number}"
- Created after thread creation, within PR date range

---

## Entity: Chart Rendering Constants

**Purpose**: Data point limits for chart visualizations

### Constants

| Constant | Value | File | Purpose |
|----------|-------|------|---------|
| `MAX_THROUGHPUT_POINTS` | 104 | `throughput.ts` | Limit throughput chart bars |
| `MAX_CYCLE_TIME_POINTS` | 104 | `cycle-time.ts` | Limit cycle time trend points |
| `MAX_CHART_POINTS` | 200 | `predictions.ts` | Limit forecast chart points (existing) |
| `MAX_SPARKLINE_POINTS` | 200 | `ml.ts` | Limit ML sparkline points (existing) |

### Truncation Behavior

When `rollups.length > MAX_*_POINTS`:
1. Apply `.slice(-MAX_*_POINTS)` to keep most recent data
2. Set `truncated = true`
3. Render truncation indicator with weeks shown

---

## Entity: Test Profile

**Purpose**: Named configuration for scalability testing

### Profiles

| Profile | PR Count | Weeks | Users | Comments | Purpose |
|---------|----------|-------|-------|----------|---------|
| Baseline | 1,000 | 52 | 50 | No | Typical usage |
| Target | 10,000 | 156 | 200 | Yes | Enterprise scale |
| Stress | 20,000 | 260 | 300 | Yes | Upper bound |
| Comments-Heavy | 5,000 | 104 | 100 | Yes (10/PR) | Comment load test |

### CLI Commands

```bash
# Baseline
python scripts/generate-synthetic-dataset.py --pr-count 1000 --output test-data/baseline

# Target (Primary)
python scripts/generate-synthetic-dataset.py \
  --pr-count 10000 --weeks 156 --users 200 --include-comments \
  --seed 42 --output test-data/scalability

# Stress
python scripts/generate-synthetic-dataset.py \
  --pr-count 20000 --weeks 260 --users 300 --include-comments \
  --seed 42 --output test-data/stress
```

---

## Manifest Updates

When `--include-comments` is specified, the manifest includes:

```json
{
  "features": {
    "teams": true,
    "comments": true,
    "predictions": false,
    "ai_insights": false
  },
  "coverage": {
    "total_prs": 10000,
    "comments": {
      "status": "enabled",
      "threads_count": 35000,
      "comments_count": 87500,
      "avg_threads_per_pr": 3.5,
      "avg_comments_per_thread": 2.5
    }
  }
}
```

---

## Relationships

```
Generator Configuration
    ├── produces → Weekly Rollups (existing)
    ├── produces → Dimensions (existing)
    ├── produces → Distributions (existing)
    └── produces → Synthetic Threads
                       └── contains → Synthetic Comments

Chart Rendering Constants
    └── limits → Weekly Rollups (at render time)
```

---

## State Transitions

### Thread Status

```
[Created] ──────────────────────┐
    │                           │
    ▼                           ▼
 active ──────────────────→ fixed
    │                           │
    └────────────────────────→ closed
```

### Chart Data Flow

```
Weekly Rollups (N items)
    │
    ▼
Check: N > MAX_*_POINTS?
    │
    ├── Yes → slice(-MAX_*_POINTS) + truncation indicator
    │
    └── No → render all data
    │
    ▼
DOM Elements (≤ MAX_*_POINTS)
```
