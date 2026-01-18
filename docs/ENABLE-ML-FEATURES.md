# Enabling ML Features (Phase 5)

This guide explains how to enable and configure the Phase 5 ML features: **Predictions** (Prophet time-series forecasting) and **AI Insights** (OpenAI-powered analysis).

## Overview

Phase 5 adds two new dashboard tabs:

- **Predictions**: Forecasts for PR throughput, cycle time, and review time over the next 4 weeks
- **AI Insights**: AI-generated observations about bottlenecks, trends, and anomalies

Both features are opt-in via pipeline task inputs and require additional dependencies.

## Prerequisites

### For Predictions (Prophet)

Prophet requires a working C++ compiler and CMake. On hosted agents, this is typically available. For self-hosted agents:

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
  "generated_by": "prophet-v1.0",
  "forecasts": [
    {
      "metric": "pr_throughput",
      "unit": "count",
      "horizon_weeks": 4,
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

### insights/summary.json

Contains AI-generated insights:

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
      "affected_entities": ["team:Backend Team"]
    }
  ]
}
```

## Dashboard Display

Once ML features are enabled and data is generated:

1. **Predictions tab**: Shows forecast charts with confidence intervals
2. **AI Insights tab**: Shows categorized insight cards grouped by severity

If no data is available, the tabs show "Coming Soon" state with instructions to enable the features in the pipeline.

## Troubleshooting

### "Predictions skipped: Prophet not installed"

Install Prophet with ML extras:
```bash
pip install "ado-git-repo-insights[ml]"
```

Or install Prophet directly:
```bash
pip install prophet>=1.1.0
```

### "AI Insights enabled but OpenAI API Key not provided"

Ensure `openaiApiKey` input is set and the variable group is linked to your pipeline.

### Prophet installation fails

Prophet requires additional build tools. See [Prophet Installation](https://facebook.github.io/prophet/docs/installation.html) for platform-specific instructions.

### OpenAI rate limits

The insights generator caches results for 24 hours to minimize API calls. If you hit rate limits:
1. Wait for the rate limit window to reset
2. Consider using a higher-tier OpenAI plan

## Cost Considerations

### Prophet (Predictions)
- **Cost**: Free (runs locally)
- **Runtime**: +10-30 seconds per pipeline run
- **Resource**: CPU-intensive during model fitting

### OpenAI (AI Insights)
- **Cost**: ~$0.001-0.01 per run (depends on PR count)
- **Runtime**: +5-15 seconds per pipeline run
- **Caching**: Results cached for 24 hours (same data = no API call)

## Security

- **PAT**: Never logged, passed securely to Python process
- **OpenAI API Key**: Passed via environment variable, never logged
- **Data**: PR metadata is sent to OpenAI for analysis (titles, cycle times, counts)

If your organization has data residency requirements, consider using Azure OpenAI Service instead.
