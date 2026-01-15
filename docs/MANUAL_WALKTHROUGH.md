# Phase 5: Advanced Analytics & ML - Manual Walkthrough

This guide walks you through verifying that Phase 5 ML features (Prophet forecasting and OpenAI insights) are working correctly.

## Prerequisites

Before starting, ensure you have:
- Python 3.10+ installed
- A working Azure DevOps PAT with PR read access
- An OpenAI API key (for insights generation)

## Installation

### Base Installation (No ML)

```bash
# Clone the repository
git clone <repo-url>
cd ado-git-repo-insights

# Install base package
pip install -e .

# Verify base installation works
ado-insights --help
```

### ML Installation (Full Features)

```bash
# Install with ML extras
pip install -e '.[ml]'

# Verify Prophet installed (requires cmdstan)
python -c "import prophet; print('Prophet OK')"

# Verify OpenAI installed
python -c "import openai; print('OpenAI OK')"
```

**Note**: Prophet requires `cmdstan`. See https://facebook.github.io/prophet/docs/installation.html

## Step 1: Extract Pull Request Data

```bash
# Set your ADO PAT
export ADO_PAT="your-pat-here"

# Extract PRs from your organization
ado-insights extract \
  --organization "your-org" \
  --project "your-project" \
  --repository "your-repo" \
  --database "./test-insights.db"
```

**Expected Output**: SQLite database created with PR data

**Verify**:
```bash
sqlite3 test-insights.db "SELECT COUNT(*) FROM pull_requests;"
```

## Step 2: Generate Aggregates (Without ML)

```bash
# Generate base aggregates only
ado-insights generate-aggregates \
  --database "./test-insights.db" \
  --output "./output-base"
```

**Expected Files**:
- `output-base/dataset-manifest.json` - Feature flags show predictions/ai_insights as `false`
- `output-base/summary/*.csv` - Core aggregates
- NO `output-base/predictions/` directory
- NO `output-base/insights/` directory

**Verify Manifest**:
```bash
cat output-base/dataset-manifest.json | grep -E '"predictions"|"ai_insights"'
```

Should show:
```json
"predictions": false,
"ai_insights": false
```

## Step 3: Generate Predictions (Prophet)

```bash
# Generate with predictions enabled
ado-insights generate-aggregates \
  --database "./test-insights.db" \
  --output "./output-ml" \
  --enable-predictions
```

**Expected Files**:
- `output-ml/predictions/trends.json` - Prophet forecasts for 4 weeks ahead
- `output-ml/dataset-manifest.json` - `"predictions": true`

**Verify Predictions Schema**:
```bash
cat output-ml/predictions/trends.json | python -m json.tool | head -20
```

Should show:
```json
{
    "schema_version": 1,
    "generated_at": "2026-01-15T...",
    "is_stub": false,
    "generated_by": "prophet-v1.0",
    "forecasts": [...]
}
```

**Validate Monday Alignment**:
```python
import json
from datetime import datetime

with open('output-ml/predictions/trends.json') as f:
    data = json.load(f)

for forecast in data['forecasts']:
    for value in forecast['values']:
        date = datetime.fromisoformat(value['period_start'])
        assert date.weekday() == 0, f"Not Monday: {value['period_start']}"

print("✓ All period_start dates are Monday-aligned")
```

## Step 4: Generate AI Insights (OpenAI)

```bash
# Set OpenAI API key
export OPENAI_API_KEY="sk-..."

# Generate with insights enabled
ado-insights generate-aggregates \
  --database "./test-insights.db" \
  --output "./output-insights" \
  --enable-insights
```

**Expected Files**:
- `output-insights/insights/summary.json` - LLM-generated insights
- `output-insights/insights/cache.json` - 24-hour cache
- `output-insights/dataset-manifest.json` - `"ai_insights": true`

**Verify Insights Schema**:
```bash
cat output-insights/insights/summary.json | python -m json.tool | head -30
```

Should show:
```json
{
    "schema_version": 1,
    "generated_at": "2026-01-15T...",
    "is_stub": false,
    "generated_by": "openai-v1.0",
    "insights": [
        {
            "id": "bottleneck-...",
            "category": "bottleneck",
            "severity": "warning",
            "title": "...",
            "description": "...",
            "affected_entities": [...]
        }
    ]
}
```

**Validate Deterministic IDs**:
```python
import json

with open('output-insights/insights/summary.json') as f:
    data = json.load(f)

for insight in data['insights']:
    # IDs should follow pattern: {category}-{hash}
    category = insight['category']
    id_val = insight['id']
    assert id_val.startswith(category + '-'), f"ID doesn't match pattern: {id_val}"

print("✓ All insight IDs follow deterministic pattern")
```

## Step 5: Test Dry-Run Mode

```bash
# Generate insights in dry-run (no API calls)
ado-insights generate-aggregates \
  --database "./test-insights.db" \
  --output "./output-dryrun" \
  --enable-insights \
  --insights-dry-run
```

**Expected Behavior**:
- NO OpenAI API calls made (verify no API charges)
- `output-dryrun/insights/prompt.json` created (prompt artifact)
- NO `summary.json` generated (dry-run doesn't produce insights)
- Manifest shows `"ai_insights": false`

## Step 6: Test Cache Behavior

```bash
# First run (fresh)
time ado-insights generate-aggregates \
  --database "./test-insights.db" \
  --output "./output-cache" \
  --enable-insights

# Second run (should use cache)
time ado-insights generate-aggregates \
  --database "./test-insights.db" \
  --output "./output-cache" \
  --enable-insights
```

**Expected Behavior**:
- First run: Makes OpenAI API call (slower)
- Second run: Uses cache (much faster, ~instant)
- Check `output-cache/insights/cache.json` for cache key

**Verify Cache Hit**:
```bash
# Should see cache metadata
cat output-cache/insights/cache.json | python -m json.tool
```

## Step 7: Test Model Override

```bash
# Override default model (gpt-5-nano -> gpt-4)
export OPENAI_MODEL="gpt-4"

ado-insights generate-aggregates \
  --database "./test-insights.db" \
  --output "./output-gpt4" \
  --enable-insights
```

**Expected Behavior**:
- Uses specified model (check OpenAI API logs)
- Different cache key (model included in cache key)

## Troubleshooting

### Prophet Not Installed

**Error**: `Prophet not installed. Install ML extras: pip install -e '.[ml]'`

**Solution**:
1. Install cmdstan: https://mc-stan.org/cmdstanpy/installation.html
2. Install Prophet: `pip install prophet`
3. Or install all ML extras: `pip install -e '.[ml]'`

### OpenAI API Key Missing

**Error**: `OPENAI_API_KEY environment variable required`

**Solution**:
```bash
export OPENAI_API_KEY="sk-your-key-here"
```

Or use dry-run mode to test without API key:
```bash
ado-insights generate-aggregates ... --insights-dry-run
```

### Empty Forecasts

If `predictions/trends.json` has empty `forecasts` array:
- Check if you have sufficient PR data (need historical data for Prophet)
- Minimum ~4 weeks of PR history recommended
- Check logs for Prophet fitting errors

### Stale Cache

To force fresh insights (bypass cache):
```bash
# Delete cache file
rm output-*/insights/cache.json

# Or change prompt version in code (busts all caches)
```

## Validation Checklist

After running this walkthrough, verify:

- [ ] Base installation works without ML dependencies
- [ ] Predictions generate with Monday-aligned dates
- [ ] Predictions use `schema_version: 1` and `is_stub: false`
- [ ] Insights generate with deterministic IDs (`{category}-{hash}`)
- [ ] Insights use `schema_version: 1` and `generated_by: openai-v1.0`
- [ ] Dry-run mode works without API key
- [ ] Cache reuses insights across runs (faster second run)
- [ ] Model override via `OPENAI_MODEL` works
- [ ] Manifest correctly reflects feature availability

## Next Steps

- Load datasets into ADO Extension UI for visualization
- Monitor OpenAI API costs via OpenAI dashboard
- Adjust `--insights-max-tokens` for cost control
- Customize `--insights-cache-ttl-hours` for your workflow
