# Quickstart: ML Features Enhancement

**Date**: 2026-01-26
**Feature**: 004-ml-features-enhancement

## Prerequisites

- Python 3.10+
- Node.js 18+ (for extension build)
- Existing ado-git-repo-insights installation

## Quick Validation

### 1. Test Fallback Forecaster (P1)

```bash
# Run unit tests for fallback forecaster
pytest tests/unit/test_fallback_forecaster.py -v

# Expected: All tests pass, no Prophet import errors
```

### 2. Test Enhanced Insights (P2)

```bash
# Run unit tests for enhanced insight schema
pytest tests/unit/test_insights_enhanced.py -v

# Expected: Ordering tests pass (severity → category → ID)
```

### 3. Test Dev Mode Preview (P3)

```bash
# Start local server
ado-insights build-aggregates --serve --port 8080

# Open browser to http://localhost:8080?devMode=true
# Expected: Synthetic preview data with "PREVIEW - Demo Data" banner
```

### 4. Test Production Lock (P3)

```bash
# Run production lock test
pytest tests/integration/test_production_lock.py -v

# Expected: Synthetic data rejected in production environment
```

### 5. Verify Chart Rendering Performance (NFR-001)

```bash
# Run performance benchmark
pytest tests/performance/test_chart_render.py -v

# Expected: Render time < 100ms for 12 weeks of data
```

## End-to-End Test Scenarios

### Scenario A: Zero-Config Predictions

1. Ensure Prophet is NOT installed: `pip uninstall prophet`
2. Run extraction with predictions enabled:
   ```bash
   ado-insights extract --enable-predictions
   ```
3. Verify `predictions/trends.json` contains:
   - `"forecaster": "linear"`
   - `"generated_by": "linear-v1.0"`
   - Valid forecast values

### Scenario B: Prophet Enhancement

1. Install Prophet: `pip install prophet`
2. Run extraction with predictions:
   ```bash
   ado-insights extract --enable-predictions
   ```
3. Verify `predictions/trends.json` contains:
   - `"forecaster": "prophet"`
   - `"generated_by": "prophet-v1.0"`

### Scenario C: AI Insights with Cache

1. Set OpenAI API key: `export OPENAI_API_KEY=sk-...`
2. First run:
   ```bash
   ado-insights extract --enable-insights
   ```
3. Verify `insights/summary.json` contains 3 insights with recommendations
4. Verify `insights/cache.json` created
5. Second run (within 12 hours): should return cached insights

### Scenario D: Dashboard Parity

1. Start local server: `ado-insights build-aggregates --serve`
2. Open three views:
   - Extension (deploy to test org)
   - Local prod: `http://localhost:8080`
   - Local dev: `http://localhost:8080?devMode=true`
3. Verify identical rendering for same input data

## Acceptance Criteria Checklist

| Criteria | Command | Pass Condition |
|----------|---------|----------------|
| SC-001 | Enable predictions | Charts visible with zero additional setup |
| SC-002 | Check insights | All 3 cards have recommendations |
| SC-003 | Open localhost | Preview renders correctly |
| SC-004 | Run prod lock test | Test asserts rejection |
| SC-005 | Run perf benchmark | < 100ms for 12 weeks |
| SC-006 | Check API logs | < $0.02 per run |
| SC-007 | Run coverage | ≥ 80% for new modules |
| SC-008 | Compare dashboards | Identical rendering |

## Troubleshooting

### "No predictions generated"

- Check data volume: minimum 4 weeks required
- Verify SQLite has PR data: `sqlite3 data.db "SELECT COUNT(*) FROM pull_requests"`

### "Insights empty"

- Check OpenAI API key: `echo $OPENAI_API_KEY`
- Check cache: `cat insights/cache.json | jq .expires_at`
- Force regeneration: delete `insights/cache.json`

### "Charts not rendering"

- Check browser console for errors
- Verify Chart.js loaded: `typeof Chart !== 'undefined'`
- Check data format matches schema

### "Dev mode not working"

- Must be localhost OR have `?devMode=true`
- Check production lock not triggered
- Verify synthetic data generator runs
