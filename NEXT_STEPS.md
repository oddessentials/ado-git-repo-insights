# Next Steps

Outstanding work items for the PR Insights dashboard.

---

## Task 1: Enable Predictions & Insights Features (Priority: High)

**Goal:** Make the Predictions and AI Insights tabs usable for end users.

### Current State

| Component | Status | Notes |
|-----------|--------|-------|
| UI Implementation | Complete | Charts, cards, schemas, validation all working |
| Feature Flag | Enabled | `ENABLE_PHASE5_FEATURES = true` in `dashboard.ts:90` |
| Tab Visibility | Hidden | CSS class `hidden` on `.phase5-tab` buttons |
| Backend Data Generation | Not configured | Pipeline doesn't output artifacts by default |

### Problem

The tabs show "Coming Soon" placeholders because:

1. **CSS Hidden Class** - Tabs have `hidden` class in `extension/ui/index.html:161-162`:
   ```html
   <button class="tab phase5-tab hidden" data-tab="predictions">Predictions</button>
   <button class="tab phase5-tab hidden" data-tab="ai-insights">AI Insights</button>
   ```

2. **No Data Artifacts** - Even when tabs are visible, without `predictions/trends.json` or `ai_insights/summary.json`, the placeholder is shown.

### Gap Analysis

| Gap Type | Severity | Details |
|----------|----------|---------|
| Documentation Gap | High | No user-facing docs explaining how to enable these features |
| Implementation Gap | Medium | Backend pipeline must be configured to output prediction/insights artifacts |
| UX Gap | Medium | "Coming Soon" doesn't tell users *how* to enable features |

### Required Backend Configuration

Per embedded setup guides in `extension/ui/modules/ml/setup-guides.ts`:

**For Predictions:**
```yaml
build-aggregates:
  run-predictions: true
```

**For AI Insights:**
```yaml
build-aggregates:
  run-insights: true
  openai-api-key: $(OPENAI_API_KEY)
```

### Key Files Reference

| File | Purpose |
|------|---------|
| `extension/ui/dashboard.ts:90` | Feature flag `ENABLE_PHASE5_FEATURES` |
| `extension/ui/dashboard.ts:692-701` | Tab initialization logic |
| `extension/ui/dashboard.ts:953-980` | Data loading for predictions/insights |
| `extension/ui/index.html:161-162` | Tab buttons with hidden class |
| `extension/ui/index.html:240-272` | "Coming Soon" placeholder sections |
| `extension/ui/modules/ml/setup-guides.ts` | YAML snippets for setup |
| `extension/ui/modules/charts/predictions.ts` | Predictions chart rendering |
| `extension/ui/schemas/predictions.schema.ts` | Predictions data validation |
| `specs/004-ml-features-enhancement/spec.md` | Feature specification |

### Acceptance Criteria

- [ ] User documentation added explaining how to enable predictions/insights
- [ ] "Coming Soon" message updated to "Available - Setup Required" with setup link
- [ ] Pipeline templates include commented-out prediction/insights options
- [ ] End-to-end test confirms features work when configured

---

## Task 2: Verify Backend Predictions Pipeline (Priority: Medium)

**Blocked by:** Task 1 documentation

**Goal:** Ensure the backend actually generates valid `predictions/trends.json` when configured.

### Questions to Investigate

1. Does the backend code exist to generate predictions?
2. Is linear regression fallback implemented (per FR-001 in spec)?
3. Does Prophet auto-detection work (per FR-002 in spec)?
4. What's the minimum data required for forecasting?

### Expected Outputs

When `run-predictions: true`:
- `predictions/trends.json` with schema version, forecasts array
- Forecaster type indicator ("linear" or "prophet")
- Data quality indicator ("normal", "low_confidence", "insufficient")

### Acceptance Criteria

- [ ] Backend generates valid predictions with linear regression
- [ ] Prophet auto-detection works when library available
- [ ] Output validates against `predictions.schema.ts`
- [ ] Data quality warnings appear for insufficient history

---

## Task 3: Verify Backend Insights Pipeline (Priority: Low)

**Blocked by:** Task 2

**Goal:** Ensure the backend generates valid `ai_insights/summary.json` when configured.

### Questions to Investigate

1. Does the backend code exist to generate AI insights?
2. How is the OpenAI API called?
3. Is the 12-hour caching implemented (per spec)?
4. What data is sent to OpenAI?

### Expected Outputs

When `run-insights: true`:
- `ai_insights/summary.json` with insights array
- Each insight has: category, severity, title, description
- Optional: data, affected_entities, recommendation

### Acceptance Criteria

- [ ] Backend generates valid insights via OpenAI
- [ ] Caching prevents excessive API calls
- [ ] Output validates against insights schema in `types.ts`
- [ ] Graceful degradation when API unavailable

---

## Execution Order

```
[Task 1: Documentation] ──blocks──> [Task 2: Predictions Backend] ──blocks──> [Task 3: Insights Backend]
```

Documentation first to understand intended behavior, then verify backend implementation matches spec.
