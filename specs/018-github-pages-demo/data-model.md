# Data Model: GitHub Pages Demo Dashboard

**Feature**: 018-github-pages-demo
**Date**: 2026-01-30

## Overview

This document defines the synthetic data entities generated for the GitHub Pages demo. All entities use deterministic generation (seed=42) with UUID v5 identifiers.

## Entity Definitions

### SyntheticOrganization

Represents a fictional Azure DevOps organization.

| Field | Type | Constraints | Example |
|-------|------|-------------|---------|
| organization_name | string | Unique, lowercase, hyphenated | "acme-corp" |

**Generation Rule**: 3 organizations with names from predefined list:
- "acme-corp"
- "contoso-dev"
- "fabrikam-eng"

---

### SyntheticProject

Represents a project within an organization.

| Field | Type | Constraints | Example |
|-------|------|-------------|---------|
| organization_name | string | FK to SyntheticOrganization | "acme-corp" |
| project_name | string | Unique within org | "platform-services" |

**Generation Rule**: 8 total projects distributed across organizations:
- acme-corp: platform-services, mobile-apps, data-pipeline
- contoso-dev: web-frontend, api-gateway
- fabrikam-eng: analytics-engine, ml-platform, devops-tools

---

### SyntheticRepository

Represents a code repository within a project.

| Field | Type | Constraints | Example |
|-------|------|-------------|---------|
| repository_id | UUID | UUID v5, unique | "a1b2c3d4-..." |
| repository_name | string | Unique within project | "user-service" |
| organization_name | string | FK to SyntheticOrganization | "acme-corp" |
| project_name | string | FK to SyntheticProject | "platform-services" |

**Generation Rule**: 20 total repositories distributed across projects:
- UUID generated as: `uuid5(DNS_NAMESPACE, f"{org}/{project}/{repo}")`
- Names follow common patterns: service-name, feature-lib, component-ui

**Repository Names**:
```
platform-services: user-service, auth-service, notification-service
mobile-apps: ios-app, android-app, shared-core
data-pipeline: etl-jobs, data-warehouse, stream-processor
web-frontend: react-shell, design-system, forms-lib
api-gateway: gateway-core, rate-limiter
analytics-engine: metrics-collector, dashboard-api, report-generator
ml-platform: model-training, inference-service, feature-store
devops-tools: ci-scripts, terraform-modules, monitoring-stack
```

---

### SyntheticUser

Represents a developer with activity in the system.

| Field | Type | Constraints | Example |
|-------|------|-------------|---------|
| user_id | UUID | UUID v5, unique | "u1234567-..." |
| display_name | string | Realistic full name | "Alice Johnson" |

**Generation Rule**: 50 users with names from predefined name lists:
- First names: Alice, Bob, Carol, David, Emma, Frank, Grace, Henry, Iris, Jack, ...
- Last names: Johnson, Smith, Williams, Brown, Jones, Garcia, Miller, Davis, ...
- UUID generated as: `uuid5(DNS_NAMESPACE, f"user/{display_name}")`

---

### WeeklyRollup

Aggregated PR metrics for one ISO week.

| Field | Type | Constraints | Example |
|-------|------|-------------|---------|
| week | string | ISO week format | "2024-W15" |
| start_date | date | Monday of week | "2024-04-08" |
| end_date | date | Sunday of week | "2024-04-14" |
| pr_count | integer | ≥ 0 | 42 |
| cycle_time_p50 | float | Minutes, 3 decimals | 287.543 |
| cycle_time_p90 | float | Minutes, 3 decimals | 1523.876 |
| authors_count | integer | ≥ 0 | 12 |
| reviewers_count | integer | ≥ 0 | 18 |
| by_repository | object | Map of repo metrics | {...} |

**Note**: `by_team` field is **omitted** when teams feature is disabled (not set to null). The rollup schema expects an object type for `by_team`, so omitting the field entirely is the correct approach when teams are not available.

**Generation Rule**: 260 weeks (2021-W01 through 2025-W52)
- pr_count: Base 40 ± seasonal adjustment (±20%) ± random noise (±10%)
- cycle_time: Log-normal(μ=6.0, σ=1.5) sampled per week
- authors_count: ~30% of pr_count
- reviewers_count: ~45% of pr_count

**Seasonal Model**:
```
adjustment = 0.2 * sin(2π * (week_num - 13) / 52)
# Peaks around week 13 (Q1) and 39 (Q3)
# Troughs around week 1 (Q1 start) and 52 (December)
```

---

### YearlyDistribution

Cycle time bucket distribution for one calendar year.

| Field | Type | Constraints | Example |
|-------|------|-------------|---------|
| year | string | 4-digit year | "2024" |
| start_date | date | Jan 1 of year | "2024-01-01" |
| end_date | date | Dec 31 of year | "2024-12-31" |
| total_prs | integer | Sum of all buckets | 2080 |
| cycle_time_buckets | object | 6 bucket counts | {...} |
| prs_by_month | object | 12 month counts | {...} |

**Bucket Definitions**:
| Bucket | Range | Expected % |
|--------|-------|------------|
| 0-1h | 0-60 min | ~15% |
| 1-4h | 60-240 min | ~25% |
| 4-24h | 240-1440 min | ~30% |
| 1-3d | 1440-4320 min | ~15% |
| 3-7d | 4320-10080 min | ~10% |
| 7d+ | >10080 min | ~5% |

**Generation Rule**: 5 distributions (2021-2025)
- total_prs: Sum of 52 weekly pr_counts
- Bucket counts derived from log-normal samples
- Monthly counts derived from weekly rollups

---

### Prediction

ML forecast for a metric over future weeks.

| Field | Type | Constraints | Example |
|-------|------|-------------|---------|
| metric | enum | pr_throughput, cycle_time_minutes, review_time_minutes | "pr_throughput" |
| unit | enum | count, minutes | "count" |
| horizon_weeks | integer | 12 | 12 |
| values | array | 12 forecast objects | [...] |

**Forecast Value Object**:
| Field | Type | Example |
|-------|------|---------|
| period_start | date | "2026-01-06" |
| predicted | float | 42.5 |
| lower_bound | float | 35.2 |
| upper_bound | float | 49.8 |

**Generation Rule**: 3 metrics × 12 weeks = 36 forecast points
- predicted: Linear trend continuation from last 8 weeks
- Confidence interval: ±15% widening by 1% per week

---

### RuleBasedInsight

Deterministic insight generated from aggregate analysis.

| Field | Type | Constraints | Example |
|-------|------|-------------|---------|
| id | string | Unique identifier | "insight-bottleneck-001" |
| category | enum | bottleneck, trend, anomaly | "bottleneck" |
| severity | enum | info, warning, critical | "warning" |
| title | string | Short headline | "Slow Reviews in api-gateway" |
| description | string | Detailed explanation | "The api-gateway repository..." |
| affected_entities | array | Entity references | ["repo:api-gateway"] |

**Insight Templates** (8 total):

| ID | Category | Severity | Trigger Condition |
|----|----------|----------|-------------------|
| bottleneck-001 | bottleneck | warning | P90 > 3x P50 in any repo |
| bottleneck-002 | bottleneck | critical | P90 > 5 days in any repo |
| trend-001 | trend | info | Throughput up 20%+ over 4 weeks |
| trend-002 | trend | info | Cycle time down 15%+ over 4 weeks |
| trend-003 | trend | warning | Throughput down 20%+ over 4 weeks |
| anomaly-001 | anomaly | info | PR count 2σ above rolling avg |
| anomaly-002 | anomaly | warning | PR count 2σ below rolling avg |
| anomaly-003 | anomaly | critical | No PRs merged in 2+ weeks |

---

## Entity Relationships

```
SyntheticOrganization (1) ──────< (N) SyntheticProject
                                        │
SyntheticProject (1) ──────────< (N) SyntheticRepository
                                        │
SyntheticRepository (1) ────────< (N) WeeklyRollup.by_repository entries

SyntheticUser (N) ──────────────< (N) WeeklyRollup (via authors_count, reviewers_count)

WeeklyRollup (N) ───────────────> (1) YearlyDistribution (aggregation)

WeeklyRollup (N) ───────────────> (N) Prediction (trend extrapolation)

WeeklyRollup (N) ───────────────> (N) RuleBasedInsight (threshold analysis)
```

---

## Canonical JSON Format

All generated JSON must follow these formatting rules:

| Rule | Implementation |
|------|----------------|
| Key ordering | `json.dumps(data, sort_keys=True)` |
| Float precision | Round to 3 decimals before serialization |
| Timestamps | ISO 8601 with Z suffix: `2024-01-15T12:00:00Z` |
| Dates | ISO 8601 date only: `2024-01-15` |
| Newlines | Unix LF (`\n`), not CRLF |
| Indentation | 2 spaces |
| Trailing newline | Single `\n` at end of file |

---

## File Output Structure

```
docs/data/
├── dataset-manifest.json          # Root discovery file
├── aggregates/
│   ├── dimensions.json            # All entities (orgs, projects, repos, users)
│   ├── weekly_rollups/
│   │   ├── 2021-W01.json
│   │   ├── 2021-W02.json
│   │   ├── ...
│   │   └── 2025-W52.json          # 260 files total
│   └── distributions/
│       ├── 2021.json
│       ├── 2022.json
│       ├── 2023.json
│       ├── 2024.json
│       └── 2025.json              # 5 files total
├── predictions/
│   └── trends.json                # All 3 metric forecasts
└── insights/
    └── summary.json               # All generated insights
```

**Estimated Total Size**: ~800 KB (well under 50 MB cap)
