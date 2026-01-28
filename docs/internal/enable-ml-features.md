# Enabling ML Features (Phase 5)

This guide explains how to enable and configure the Phase 5 ML features: **Predictions** (time-series forecasting) and **AI Insights** (OpenAI-powered analysis).

## Overview

Phase 5 adds two new dashboard tabs:

- **Predictions**: Forecasts for PR throughput, cycle time, and review time over the next 4 weeks
- **AI Insights**: AI-generated observations about bottlenecks, trends, and anomalies

Both features are opt-in via pipeline task inputs.

## Prerequisites

### For Predictions

**Zero-Config Option (Fallback Forecaster)**

Predictions work out-of-the-box with **no additional dependencies**. The built-in NumPy-based linear forecaster provides:

- Linear trend extrapolation with confidence bands
- Outlier detection and clipping at 3σ
- Data quality assessment (insufficient/low_confidence/normal)
- Minimum 4 weeks of data required (8+ recommended for best results)

Simply enable predictions - no Prophet installation needed:

```yaml
build-aggregates:
  run-predictions: true
```

**Enhanced Option (Prophet)**

For more sophisticated forecasting with seasonality detection, install Prophet:

**Ubuntu/Debian:**
```bash
sudo apt-get install -y build-essential cmake python3-dev
pip install prophet>=1.1.0
```

**Windows:**
- Install Visual Studio Build Tools with C++ workload
- Or use a hosted agent where Prophet is pre-installed

**macOS:**
```bash
xcode-select --install
pip install prophet>=1.1.0
```

The system automatically detects Prophet and uses it when available, falling back to linear forecasting otherwise.

### For AI Insights (OpenAI)

1. Create an OpenAI account at https://platform.openai.com
2. Generate an API key
3. Store the key as a secret in Azure DevOps:
   - Go to Pipelines > Library > Variable Groups
   - Create a new variable group (e.g., "OpenAI Secrets")
   - Add variable: `OPENAI_API_KEY` = `sk-...` (mark as secret)
   - Link the variable group to your pipeline

## Pipeline Configuration

### Basic Configuration

Add the new inputs to your pipeline YAML:

```yaml
- task: ExtractPullRequests@2
  inputs:
    organization: $(System.CollectionUri)
    projects: |
      ProjectA
      ProjectB
    pat: $(PAT)
    generateAggregates: true
    # Enable ML features
    enablePredictions: true
    enableInsights: true
    openaiApiKey: $(OPENAI_API_KEY)
```

### Full Example

```yaml
trigger:
  - main

schedules:
  - cron: "0 6 * * *"  # Run daily at 6 AM
    displayName: Daily PR Insights
    branches:
      include: [main]
    always: true

variables:
  - group: OpenAI Secrets  # Contains OPENAI_API_KEY

stages:
  - stage: Extract
    jobs:
      - job: ExtractPRs
        pool:
          vmImage: 'ubuntu-latest'
        steps:
          - task: UsePythonVersion@0
            inputs:
              versionSpec: '3.10'
              addToPath: true

          - task: ExtractPullRequests@2
            inputs:
              organization: $(System.CollectionUri)
              projects: |
                MyProject
              pat: $(PAT)
              generateAggregates: true
              enablePredictions: true
              enableInsights: true
              openaiApiKey: $(OPENAI_API_KEY)

          - task: PublishPipelineArtifact@1
            inputs:
              targetPath: '$(Pipeline.Workspace)/aggregates'
              artifact: 'aggregates'
```

## Task Input Reference

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `enablePredictions` | boolean | `false` | Generate ML predictions using Prophet |
| `enableInsights` | boolean | `false` | Generate AI insights using OpenAI |
| `openaiApiKey` | string | - | OpenAI API key (required if `enableInsights` is true) |

## Output Files

When ML features are enabled, additional files are generated:

```
aggregates/
├── dataset-manifest.json    # features.predictions / features.ai_insights = true
├── aggregates/
│   └── ...
├── predictions/
│   └── trends.json          # When enablePredictions=true
└── insights/
    └── summary.json         # When enableInsights=true
```

### predictions/trends.json

Contains 4-week forecasts for key metrics:

```json
{
  "schema_version": 1,
  "generated_at": "2026-01-18T12:00:00Z",
  "is_stub": false,
  "generated_by": "linear-v1.0",
  "forecaster": "linear",
  "data_quality": "normal",
  "forecasts": [
    {
      "metric": "pr_throughput",
      "unit": "PRs/week",
      "values": [
        {
          "period_start": "2026-01-20",
          "predicted": 28,
          "lower_bound": 22,
          "upper_bound": 34
        }
      ]
    }
  ]
}
```

**Forecaster Types:**

| Value | Description |
|-------|-------------|
| `linear` | NumPy-based linear regression (zero-config) |
| `prophet` | Facebook Prophet with seasonality (requires installation) |

**Data Quality Indicators:**

| Value | Meaning | Recommendation |
|-------|---------|----------------|
| `normal` | 8+ weeks of data | High confidence forecasts |
| `low_confidence` | 4-7 weeks of data | Forecasts may be less accurate |
| `insufficient` | <4 weeks of data | Predictions not generated |

### insights/summary.json

Contains AI-generated insights with actionable recommendations (v2 schema):

```json
{
  "schema_version": 1,
  "generated_at": "2026-01-18T12:00:00Z",
  "is_stub": false,
  "generated_by": "openai-v1.0",
  "insights": [
    {
      "id": "bottleneck-abc123",
      "category": "bottleneck",
      "severity": "warning",
      "title": "Review latency increasing",
      "description": "Average time to first review has increased by 15%.",
      "affected_entities": [
        {"type": "team", "name": "Backend Team", "member_count": 5}
      ],
      "data": {
        "metric": "review_time_minutes",
        "current_value": 180,
        "previous_value": 157,
        "change_percent": 14.6,
        "trend_direction": "up",
        "sparkline": [140, 150, 157, 165, 180]
      },
      "recommendation": {
        "action": "Consider adding more code reviewers or implementing automated review checks",
        "priority": "high",
        "effort": "medium"
      }
    }
  ]
}
```

**Insight Categories:**

| Category | Description |
|----------|-------------|
| `bottleneck` | Process friction or capacity constraints |
| `trend` | Directional changes in metrics over time |
| `anomaly` | Unusual patterns or outliers |

**Severity Levels:**

| Severity | Description | Dashboard Display |
|----------|-------------|-------------------|
| `critical` | Immediate attention required | 🔴 Red indicator |
| `warning` | Should be addressed soon | 🟡 Yellow indicator |
| `info` | Informational observation | 🔵 Blue indicator |

**Insight Ordering:**

Insights are sorted deterministically for consistent display:
1. Severity (critical → warning → info)
2. Category (alphabetical)
3. ID (alphabetical)

## Dashboard Display

Once ML features are enabled and data is generated:

1. **Predictions tab**: Shows forecast charts with confidence intervals
2. **AI Insights tab**: Shows categorized insight cards grouped by severity

If no data is available, the tabs show "Coming Soon" state with instructions to enable the features in the pipeline.

## Troubleshooting

### "Predictions show 'Insufficient Data'"

Predictions require a minimum of 4 weeks of PR data. Check your data coverage:
```bash
sqlite3 data.db "SELECT MIN(closed_date), MAX(closed_date), COUNT(*) FROM pull_requests WHERE status='completed'"
```

### "Using linear forecaster instead of Prophet"

This is expected behavior. The system automatically uses Prophet when installed, otherwise falls back to the linear forecaster. To use Prophet:
```bash
pip install "ado-git-repo-insights[ml]"
# Or directly:
pip install prophet>=1.1.0
```

### "AI Insights enabled but OpenAI API Key not provided"

Ensure `openaiApiKey` input is set and the variable group is linked to your pipeline.

### Prophet installation fails

Prophet requires additional build tools. See [Prophet Installation](https://facebook.github.io/prophet/docs/installation.html) for platform-specific instructions.

The linear fallback forecaster provides good results without Prophet - consider using it if Prophet installation is problematic.

### OpenAI rate limits

The insights generator caches results for 12 hours to minimize API calls. If you hit rate limits:
1. Wait for the rate limit window to reset
2. Consider using a higher-tier OpenAI plan
3. Delete `insights/cache.json` to force regeneration

### "Low Confidence" data quality warning

This indicates 4-7 weeks of data. Forecasts are generated but may be less accurate. For best results, accumulate 8+ weeks of data before relying on predictions.

## Cost Considerations

### Linear Forecaster (Predictions - Zero Config)
- **Cost**: Free (runs locally)
- **Runtime**: <1 second per pipeline run
- **Dependencies**: NumPy only (included with base install)

### Prophet (Predictions - Enhanced)
- **Cost**: Free (runs locally)
- **Runtime**: +10-30 seconds per pipeline run
- **Resource**: CPU-intensive during model fitting
- **Dependencies**: Requires C++ compiler for installation

### OpenAI (AI Insights)
- **Cost**: ~$0.001-0.01 per run (depends on PR count)
- **Runtime**: +5-15 seconds per pipeline run
- **Caching**: Results cached for 12 hours (same data = no API call)

## Dev Mode Preview

For local development and testing, synthetic preview data is available:

1. **Requirements:**
   - Must be running on localhost or file:// protocol
   - Add `?devMode=true` to the URL

2. **Behavior:**
   - Shows synthetic predictions and insights
   - Displays prominent "PREVIEW - Demo Data" banner
   - Never available in production (dev.azure.com)

3. **Use Cases:**
   - Testing dashboard UI without real data
   - Demonstrating features to stakeholders
   - Development and debugging

## Security

- **PAT**: Never logged, passed securely to Python process
- **OpenAI API Key**: Passed via environment variable, never logged
- **Data**: PR metadata is sent to OpenAI for analysis (titles, cycle times, counts)

If your organization has data residency requirements, consider using Azure OpenAI Service instead.
