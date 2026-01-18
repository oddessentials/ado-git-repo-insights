# Deferred Work: Phase 5 (Predictions & AI Insights)

This document outlines the work required to enable Phase 5 features (Predictions and AI Insights tabs) in the PR Insights dashboard. These features are currently disabled via feature flag.

---

## Current State

- **Feature Flag**: `ENABLE_PHASE5_FEATURES = false` in `extension/ui/dashboard.js`
- **Tabs**: Hidden by default, showing "Coming Soon" state when manually revealed
- **ML Code**: Exists in `src/ado_git_repo_insights/ml/` but not integrated with pipeline task
- **Pipeline Task**: Does not expose `enablePredictions` or `enableInsights` inputs

---

## Prerequisites for Enablement

### 1. Python Dependencies

The ML features require additional Python packages not currently in the base requirements:

```python
# Forecaster (predictions/trends.json)
prophet>=1.1.0  # Facebook Prophet for time series forecasting

# AI Insights (insights/summary.json)
openai>=1.0.0   # OpenAI API client (optional, for AI-powered insights)
```

**Files to update**:
- `setup.py` - Add optional extras_require for ML features
- `pyproject.toml` - Add optional dependency group

### 2. Pipeline Task Inputs

The `ExtractPullRequests@2` task needs new inputs to enable ML features:

```yaml
# Proposed new inputs for extension/tasks/extract-prs/task.json
{
  "name": "enablePredictions",
  "type": "boolean",
  "label": "Generate ML Predictions",
  "defaultValue": "false",
  "required": false,
  "helpMarkDown": "Generate time series forecasts for cycle time and throughput"
},
{
  "name": "enableInsights",
  "type": "boolean",
  "label": "Generate AI Insights",
  "defaultValue": "false",
  "required": false,
  "helpMarkDown": "Generate AI-powered analysis (requires OpenAI API key)"
},
{
  "name": "openaiApiKey",
  "type": "string",
  "label": "OpenAI API Key",
  "required": false,
  "helpMarkDown": "API key for AI insights generation (required if enableInsights is true)"
}
```

**Files to update**:
- `extension/tasks/extract-prs/task.json` - Add input definitions
- `extension/tasks/extract-prs/index.js` - Pass inputs to Python CLI
- CLI command builder to include `--enable-predictions` and `--enable-insights` flags

### 3. CLI Integration

The CLI already has flags for predictions/insights but they need to be wired through:

```bash
# Current CLI flags (cli.py)
--enable-predictions    # Generate predictions/trends.json
--enable-insights       # Generate insights/summary.json
```

**Files to verify**:
- `src/ado_git_repo_insights/cli.py` - Flags exist at lines 612-613
- `src/ado_git_repo_insights/ml/forecaster.py` - Prophet-based forecasting
- `src/ado_git_repo_insights/ml/insights.py` - AI insights generation

### 4. Dataset Contract Updates

The aggregates output needs to include predictions and insights when enabled:

```
aggregates/
├── dataset-manifest.json     # Must include predictions/insights flags
├── weekly_rollups/
├── distributions/
├── predictions/              # NEW: when enablePredictions=true
│   └── trends.json
└── insights/                 # NEW: when enableInsights=true
    └── summary.json
```

**Files to update**:
- `docs/dataset-contract.md` - Document predictions/insights schema
- Aggregator code to conditionally generate these files

---

## Implementation Tasks

### Phase 5.1: Dependencies & CLI Wiring

1. [ ] Add Prophet to optional dependencies in setup.py/pyproject.toml
2. [ ] Add OpenAI to optional dependencies
3. [ ] Verify CLI flags work end-to-end locally
4. [ ] Add integration tests for predictions generation
5. [ ] Add integration tests for insights generation

### Phase 5.2: Pipeline Task Integration

1. [ ] Add `enablePredictions` input to task.json
2. [ ] Add `enableInsights` input to task.json
3. [ ] Add `openaiApiKey` input to task.json
4. [ ] Update index.js to pass new inputs to CLI
5. [ ] Test in hosted agent environment (Prophet installation)
6. [ ] Document agent requirements (Prophet needs C++ compiler)

### Phase 5.3: Dashboard Integration

1. [ ] Verify `loadPredictions()` in dataset-loader.js works with real data
2. [ ] Verify `loadInsights()` in dataset-loader.js works with real data
3. [ ] Update `renderPredictions()` for production data format
4. [ ] Update `renderInsights()` for production data format
5. [ ] Add loading states for async prediction/insight loading

### Phase 5.4: Documentation & Enablement

1. [ ] Create "Enable ML Features" documentation page
2. [ ] Document OpenAI API key setup
3. [ ] Document Prophet installation requirements
4. [ ] Update INSTALLATION.md with ML features section
5. [x] Set `ENABLE_PHASE5_FEATURES = true` in dashboard.js
6. [x] Update tests to expect tabs visible by default

---

## Key Files Reference

### Python ML Code
- `src/ado_git_repo_insights/ml/__init__.py` - ML module exports
- `src/ado_git_repo_insights/ml/forecaster.py` - Prophet-based cycle time forecasting
- `src/ado_git_repo_insights/ml/insights.py` - AI-powered insights generation
- `src/ado_git_repo_insights/ml/date_utils.py` - Date utilities for forecasting

### Pipeline Task
- `extension/tasks/extract-prs/task.json` - Task input definitions
- `extension/tasks/extract-prs/index.js` - Task execution wrapper

### Dashboard
- `extension/ui/dashboard.js` - Feature flag and initialization
- `extension/ui/dataset-loader.js` - Data loading for predictions/insights
- `extension/ui/index.html` - Tab HTML structure

### Tests
- `extension/tests/production-issues.test.js` - Feature flag tests
- Need to add: ML integration tests

---

## Risks & Considerations

### Prophet Installation
- Prophet requires C++ compiler and additional build tools
- May fail on some self-hosted agents without proper toolchain
- Consider: Pre-built wheel distribution or Docker-based execution

### OpenAI API Costs
- AI insights require OpenAI API calls (paid service)
- Need rate limiting and cost estimation in documentation
- Consider: Local LLM alternative for privacy-conscious users

### Data Volume
- Forecasting on large datasets (10k+ PRs) may be slow
- Consider: Caching, incremental updates, time limits

---

## Current Status

Phase 5 feature flag is now **ENABLED**. The Predictions and AI Insights tabs are visible
in the dashboard and show "Coming Soon" state until the backend generates data.

```javascript
// extension/ui/dashboard.js line 34
const ENABLE_PHASE5_FEATURES = true;
```

### Remaining work for full functionality:
1. Complete Phase 5.1-5.3 tasks (dependencies, pipeline integration, dashboard rendering)
2. Complete Phase 5.4 tasks 1-4 (documentation)
3. Integration tests pass in CI
4. At least one production user has tested successfully

---

## Contact

For questions about Phase 5 implementation, see:
- `docs/phase5-contract-notes.md` - Original design notes
- `agents/INVARIANTS.md` - System invariants to preserve
- GitHub Issues - For tracking specific tasks
