# Next Phase: ML Features Enhancement

**Feature**: Predictions & AI Insights Dashboard Tabs
**Status**: Backend complete, frontend needs enhancement
**Goal**: Make ML features useful, awesome, and impressive

---

## Executive Summary

The ML features (Prophet predictions and OpenAI insights) are **fully implemented** in the backend but underutilized because:

1. The dashboard shows "Coming Soon" placeholders instead of engaging previews
2. Visual presentation is basic (tables instead of charts)
3. Setup barriers exist without clear guidance
4. No fallback when Prophet isn't available

This plan transforms these tabs from hidden gems into showcase features.

---

## Current State Assessment

### What's Already Built

| Component                 | Status           | Location                                          |
| ------------------------- | ---------------- | ------------------------------------------------- |
| Prophet Forecaster        | Production-ready | `src/ado_git_repo_insights/ml/forecaster.py`      |
| OpenAI Insights Generator | Production-ready | `src/ado_git_repo_insights/ml/insights.py`        |
| Dashboard Rendering       | Functional       | `extension/ui/modules/ml.ts`                      |
| CLI Flags                 | Complete         | `--enable-predictions`, `--enable-insights`       |
| Data Contracts            | Locked           | Schema v1, backward compatible                    |
| Test Coverage             | 50+ tests        | `tests/integration/test_phase5_ml_integration.py` |

### Current User Experience Problems

1. **Predictions Tab**: Shows plain table with Week/Predicted/Range columns - functional but not visually impressive
2. **AI Insights Tab**: Basic cards grouped by severity - no inline visualizations or actionable links
3. **Empty State**: "Coming Soon" message with no preview of what features look like
4. **Setup Barrier**: Prophet requires C++ compiler; OpenAI requires API key configuration
5. **No Fallback**: If Prophet isn't installed, predictions are completely unavailable

---

## Design Principles

1. **Zero-Config Default**: Predictions work out-of-the-box with fallback forecasting (no Prophet required)
2. **Progressive Enhancement**: Prophet improves accuracy when available; OpenAI adds AI insights as opt-in
3. **Visual First**: Charts > Tables, Sparklines > Numbers, Interactive > Static
4. **Dev Mode Preview**: Synthetic data only in dev mode (localhost or `?devMode` parameter)
5. **Actionable Insights**: Every insight includes a concrete recommendation
6. **Parallel Development**: Architecture supports multiple agents working on independent components

### Extras:

1. **Add explicit guardrails to the fallback forecaster.**
   Define minimum data requirements (e.g., ≥ N weeks), basic outlier clipping, and flat-trend detection so linear forecasts and confidence bands are only produced when statistically reasonable. When thresholds aren’t met, degrade gracefully (shorter horizon, wider bounds, or a “low confidence” flag) to keep visuals honest while still zero-config.

2. **Harden dev-mode synthetic data with an explicit production lock.**
   Gate synthetic previews behind a build-time or manifest flag in addition to `localhost/?devMode`, so preview data is impossible to surface in real Azure DevOps usage. Treat this as a non-negotiable invariant and add a test asserting synthetic data is rejected in production mode.

3. **Define a clear UI testing and performance measurement strategy up front.**
   Standardize on data-to-render model tests (config + datasets → render props) instead of brittle canvas snapshots, and explicitly document how the `<100ms` target is measured (dataset size, device class, cold vs warm). This keeps the 80% coverage goal achievable without slowing delivery.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ML Feature Pipeline                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │   Fallback   │    │   Prophet    │    │   OpenAI Insights    │  │
│  │  Forecaster  │    │  Forecaster  │    │     Generator        │  │
│  │  (Default)   │    │  (Enhanced)  │    │     (Opt-in)         │  │
│  └──────┬───────┘    └──────┬───────┘    └──────────┬───────────┘  │
│         │                   │                        │              │
│         └─────────┬─────────┘                        │              │
│                   │                                  │              │
│                   ▼                                  ▼              │
│         ┌─────────────────┐              ┌─────────────────────┐   │
│         │ predictions/    │              │ insights/           │   │
│         │ trends.json     │              │ summary.json        │   │
│         └────────┬────────┘              └──────────┬──────────┘   │
│                  │                                  │              │
│                  └──────────────┬───────────────────┘              │
│                                 │                                   │
│                                 ▼                                   │
│                    ┌────────────────────────┐                      │
│                    │  Dashboard UI Renderer │                      │
│                    │  (Charts + Cards)      │                      │
│                    └────────────────────────┘                      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Feature Specifications

### F1: Fallback Forecasting (Zero-Config Default)

**Goal**: Predictions work without Prophet installation

**Implementation**:

- New `FallbackForecaster` class using numpy-only linear regression
- Automatic detection: Use Prophet if available, fallback otherwise
- Output format identical to Prophet (same JSON schema)
- Clearly indicate forecasting method in manifest: `"forecaster": "linear"` vs `"forecaster": "prophet"`

**Accuracy Trade-offs**:
| Method | Seasonality | Confidence Bounds | Holiday Effects | Accuracy |
|--------|-------------|-------------------|-----------------|----------|
| Linear (fallback) | No | Basic (std dev) | No | Good for stable trends |
| Prophet (enhanced) | Yes | Bayesian | Yes | Better for complex patterns |

**Files to Create/Modify**:

- `src/ado_git_repo_insights/ml/fallback_forecaster.py` (NEW)
- `src/ado_git_repo_insights/ml/forecaster.py` (modify to use fallback)
- `src/ado_git_repo_insights/ml/__init__.py` (export fallback)

**Contract**:

```python
class FallbackForecaster:
    """Linear regression forecaster requiring only numpy."""

    def __init__(self, db_path: Path, output_dir: Path):
        ...

    def generate(self) -> bool:
        """Generate predictions/trends.json with linear forecasts."""
        ...
```

---

### F2: Visual Predictions Tab (Charts)

**Goal**: Replace tables with interactive Chart.js visualizations

**Design**:

```
┌─────────────────────────────────────────────────────────────────────┐
│  PR Throughput Forecast                                    [4 weeks]│
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  40 ┤                                    ╭─────────────────╮        │
│     │                              ╭─────│  Forecast Zone  │        │
│  30 ┤         ╭──────╮      ╭─────╯     │  (confidence)   │        │
│     │    ╭────╯      ╰──────╯           ╰─────────────────╯        │
│  20 ┤────╯                                                          │
│     │    ▪ Historical ─── Predicted ░░░ Confidence Band            │
│  10 ┼────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────        │
│        W1   W2   W3   W4   W5   W6   W7   W8   W9  W10  W11        │
│                              ↑                                       │
│                           Today                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Components**:

1. **Throughput Forecast Chart** - PRs per week with confidence bands
2. **Cycle Time Forecast Chart** - P50 cycle time trend with bounds
3. **Review Time Forecast Chart** - Time to first review projection
4. **Summary Cards** - Key predictions with trend indicators

**Summary Card Design**:

```
┌─────────────────────────┐  ┌─────────────────────────┐
│  Next Week Throughput   │  │  Cycle Time Trend       │
│                         │  │                         │
│     28 PRs  ↑12%       │  │     4.2h  ↓8%          │
│     (24-32 range)       │  │     (3.8-4.6h range)    │
│                         │  │                         │
│  [▁▂▃▄▅▆▇] trending up  │  │  [▇▆▅▄▃▂▁] improving   │
└─────────────────────────┘  └─────────────────────────┘
```

**Files to Create/Modify**:

- `extension/ui/modules/ml.ts` (major rewrite for charts)
- `extension/ui/modules/charts/predictions.ts` (NEW)
- `extension/ui/styles.css` (prediction chart styles)

---

### F3: Enhanced AI Insights Tab

**Goal**: Rich, actionable insight cards with inline visualizations

**Insight Card Design**:

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🟡 WARNING                                         Category: Trend  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Review Latency Increasing                                          │
│  ══════════════════════════                                         │
│                                                                      │
│  Average time-to-first-review has increased by 23% over the past    │
│  4 weeks, from 2.1 hours to 2.6 hours.                              │
│                                                                      │
│  ┌────────────────────────────────────────┐                         │
│  │  [▁▂▃▅▇]  2.1h → 2.6h  (+23%)         │  Inline sparkline       │
│  └────────────────────────────────────────┘                         │
│                                                                      │
│  Affected: Backend Team (8 reviewers)                               │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 💡 Recommendation                                            │   │
│  │                                                              │   │
│  │ Consider adding reviewers to the Backend team or reducing   │   │
│  │ PR size to improve review turnaround time.                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  [View Team Details]                                                │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Enhanced Insight Schema**:

```json
{
    "id": "trend-abc123",
    "category": "trend",
    "severity": "warning",
    "title": "Review Latency Increasing",
    "description": "Average time-to-first-review has increased by 23%...",
    "data": {
        "metric": "review_time_minutes",
        "current_value": 156,
        "previous_value": 126,
        "change_percent": 23,
        "trend_direction": "up",
        "sparkline": [126, 132, 140, 148, 156]
    },
    "affected_entities": [
        { "type": "team", "name": "Backend Team", "member_count": 8 }
    ],
    "recommendation": {
        "action": "Consider adding reviewers or reducing PR size",
        "priority": "medium",
        "effort": "low"
    }
}
```

**Files to Create/Modify**:

- `src/ado_git_repo_insights/ml/insights.py` (enhanced prompt + schema)
- `extension/ui/modules/ml.ts` (rich card rendering)
- `extension/ui/types.ts` (extended InsightItem type)

---

### F4: Enhanced LLM Prompt Engineering

**Goal**: Generate richer, more actionable insights

**Current Prompt** (simplified):

```
Analyze PR metrics and identify bottlenecks, trends, anomalies.
```

**Enhanced Prompt**:

```
You are a DevOps metrics analyst reviewing Pull Request data for {organization}/{project}.

## Context
- Time period: {start_date} to {end_date}
- Total PRs: {pr_count}
- Unique contributors: {author_count}
- Unique reviewers: {reviewer_count}

## Metrics Summary
{metrics_json}

## Your Task
Generate exactly 3 insights that are:

1. **Actionable** - Include a specific, implementable recommendation
2. **Quantified** - Cite exact numbers, percentages, and comparisons
3. **Targeted** - Name specific teams/repositories when patterns are localized
4. **Comparative** - Reference the previous period or industry benchmarks when relevant

## Output Format
Return a JSON array with exactly 3 objects, each containing:
- title: Punchy headline (max 10 words)
- category: One of "bottleneck", "trend", "anomaly", "achievement"
- severity: One of "critical", "warning", "info"
- description: One paragraph with specific data points
- data: Object with metric, current_value, previous_value, change_percent, trend_direction, sparkline (5 values)
- affected_entities: Array of {type, name} for teams/repos affected
- recommendation: Object with action (specific step), priority (high/medium/low), effort (high/medium/low)

## Quality Guidelines
- Avoid generic observations ("PRs are being merged")
- Focus on changes, not steady states
- Highlight both problems AND achievements
- Be specific: "Backend Team" not "some teams"
- Include numbers: "23% increase" not "significant increase"
```

---

### F5: Dev Mode Preview with Synthetic Data

**Goal**: Show feature preview in dev mode when ML data unavailable

**Detection**:

```typescript
const isDevMode =
    window.location.hostname === "localhost" ||
    new URLSearchParams(window.location.search).has("devMode");
```

**Behavior**:

- **Production Mode**: Show "Enable predictions in your pipeline" message with setup link
- **Dev Mode**: Show synthetic preview with "PREVIEW - Demo Data" watermark

**Synthetic Data Generator**:

```typescript
function generateSyntheticPredictions(): PredictionsRenderData {
    const baseValue = 25;
    const weeks = 4;
    return {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        is_stub: true, // Marks as synthetic
        generated_by: "synthetic-preview",
        forecasts: [
            {
                metric: "pr_throughput",
                unit: "count",
                horizon_weeks: weeks,
                values: Array.from({ length: weeks }, (_, i) => ({
                    period_start: getNextMonday(i),
                    predicted: Math.round(baseValue * (1 + i * 0.05)),
                    lower_bound: Math.round(baseValue * (1 + i * 0.05) * 0.85),
                    upper_bound: Math.round(baseValue * (1 + i * 0.05) * 1.15),
                })),
            },
            // ... cycle_time and review_time forecasts
        ],
    };
}
```

**Files to Create/Modify**:

- `extension/ui/modules/ml/synthetic.ts` (NEW)
- `extension/ui/modules/ml.ts` (integrate synthetic fallback)
- `extension/ui/dashboard.ts` (dev mode detection)

---

### F6: Seamless Setup Documentation

**Goal**: Crystal-clear setup instructions embedded in UI and docs

**In-Dashboard Setup Guide** (when features not enabled):

```
┌─────────────────────────────────────────────────────────────────────┐
│  🔮 Enable Predictions                                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Add this to your pipeline YAML:                                    │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  - task: ExtractPullRequests@2                              │   │
│  │    inputs:                                                   │   │
│  │      enablePredictions: true  # <-- Add this line           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  That's it! Predictions use built-in forecasting by default.        │
│                                                                      │
│  ───────────────────────────────────────────────────────────────    │
│                                                                      │
│  Optional: Enhanced Accuracy with Prophet                           │
│                                                                      │
│  For more accurate forecasts with seasonality detection:            │
│  pip install prophet                                                │
│                                                                      │
│  Prophet is automatically used when available.                      │
│                                                                      │
│  [Copy YAML]  [View Documentation]                                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**AI Insights Setup** (separate, clearly optional):

```
┌─────────────────────────────────────────────────────────────────────┐
│  🤖 Enable AI Insights                                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  AI Insights requires an OpenAI API key.                            │
│                                                                      │
│  Step 1: Get an API Key                                             │
│  ─────────────────────                                              │
│  1. Go to platform.openai.com                                       │
│  2. Create an API key                                               │
│  3. Note: ~$0.001-0.01 per pipeline run                            │
│                                                                      │
│  Step 2: Store as Secret                                            │
│  ────────────────────────                                           │
│  1. Pipelines → Library → Variable Groups                           │
│  2. Create group "OpenAI Secrets"                                   │
│  3. Add variable: OPENAI_API_KEY = sk-...                          │
│  4. Mark as secret ✓                                                │
│                                                                      │
│  Step 3: Update Pipeline                                            │
│  ───────────────────────                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  variables:                                                  │   │
│  │    - group: OpenAI Secrets                                   │   │
│  │                                                              │   │
│  │  - task: ExtractPullRequests@2                              │   │
│  │    inputs:                                                   │   │
│  │      enableInsights: true                                    │   │
│  │      openaiApiKey: $(OPENAI_API_KEY)                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  [Copy YAML]  [View Full Guide]                                     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Files to Create/Modify**:

- `extension/ui/modules/ml/setup-guides.ts` (NEW)
- `extension/ui/index.html` (setup guide containers)
- `docs/internal/enable-ml-features.md` (update with new flow)

---

## Implementation Tasks

### Phase 1: Foundation (Parallel-Safe)

| Task ID | Description                           | Files                                    | Parallelizable       |
| ------- | ------------------------------------- | ---------------------------------------- | -------------------- |
| T001    | Create FallbackForecaster class       | `ml/fallback_forecaster.py`              | Yes                  |
| T002    | Unit tests for FallbackForecaster     | `tests/unit/test_fallback_forecaster.py` | Yes                  |
| T003    | Integrate fallback into forecaster.py | `ml/forecaster.py`                       | No (depends on T001) |
| T004    | Update CLI to use auto-detection      | `cli.py`                                 | No (depends on T003) |
| T005    | Create synthetic data generator       | `ui/modules/ml/synthetic.ts`             | Yes                  |
| T006    | Dev mode detection utility            | `ui/modules/ml/dev-mode.ts`              | Yes                  |

### Phase 2: Visual Predictions (Parallel-Safe)

| Task ID | Description                               | Files                                | Parallelizable |
| ------- | ----------------------------------------- | ------------------------------------ | -------------- |
| T007    | Create predictions chart module           | `ui/modules/charts/predictions.ts`   | Yes            |
| T008    | Forecast line chart with confidence bands | (part of T007)                       | -              |
| T009    | Summary cards with sparklines             | `ui/modules/ml.ts`                   | Yes            |
| T010    | Trend indicators (↑↓→)                    | (part of T009)                       | -              |
| T011    | Prediction chart CSS styles               | `ui/styles.css`                      | Yes            |
| T012    | Integration tests for chart rendering     | `tests/ui/test_predictions_chart.ts` | Yes            |

### Phase 3: Enhanced Insights (Parallel-Safe)

| Task ID | Description                                        | Files                                  | Parallelizable       |
| ------- | -------------------------------------------------- | -------------------------------------- | -------------------- |
| T013    | Enhanced insight schema (add data, recommendation) | `ml/insights.py`, `ui/types.ts`        | Yes                  |
| T014    | Improved LLM prompt                                | `ml/insights.py`                       | No (depends on T013) |
| T015    | Rich insight card rendering                        | `ui/modules/ml.ts`                     | Yes                  |
| T016    | Inline sparklines in insight cards                 | (part of T015)                         | -                    |
| T017    | Recommendation section styling                     | `ui/styles.css`                        | Yes                  |
| T018    | Unit tests for enhanced insights                   | `tests/unit/test_insights_enhanced.py` | Yes                  |

### Phase 4: Setup & Documentation (Parallel-Safe)

| Task ID | Description                        | Files                                 | Parallelizable |
| ------- | ---------------------------------- | ------------------------------------- | -------------- |
| T019    | In-dashboard setup guide component | `ui/modules/ml/setup-guides.ts`       | Yes            |
| T020    | Predictions setup guide content    | (part of T019)                        | -              |
| T021    | AI Insights setup guide content    | (part of T019)                        | -              |
| T022    | Update enable-ml-features.md       | `docs/internal/enable-ml-features.md` | Yes            |
| T023    | Add ML section to CLI reference    | `docs/reference/cli-reference.md`     | Yes            |
| T024    | Cost estimation helper             | `ui/modules/ml/cost-calculator.ts`    | Yes            |

### Phase 5: Integration & Polish

| Task ID | Description                                        | Files                | Parallelizable |
| ------- | -------------------------------------------------- | -------------------- | -------------- |
| T025    | End-to-end integration test (fallback → dashboard) | `tests/integration/` | No             |
| T026    | End-to-end integration test (prophet → dashboard)  | `tests/integration/` | No             |
| T027    | End-to-end integration test (insights → dashboard) | `tests/integration/` | No             |
| T028    | Performance profiling (chart rendering)            | -                    | Yes            |
| T029    | Accessibility audit (charts, cards)                | -                    | Yes            |
| T030    | Final documentation review                         | All docs             | No             |

---

## Parallel Development Strategy

### Agent Assignment

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Parallel Development Tracks                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Agent A: Backend/Python                                            │
│  ─────────────────────                                              │
│  T001 → T002 → T003 → T004                                         │
│  T013 → T014 → T018                                                 │
│  T025, T026, T027                                                   │
│                                                                      │
│  Agent B: Frontend/TypeScript                                        │
│  ───────────────────────────                                        │
│  T005, T006 (parallel)                                              │
│  T007 → T008 → T012                                                 │
│  T009 → T010                                                        │
│  T015 → T016                                                        │
│                                                                      │
│  Agent C: Styling/Docs                                               │
│  ────────────────────                                               │
│  T011, T017 (parallel with frontend)                                │
│  T019 → T020 → T021                                                 │
│  T022, T023, T024 (parallel)                                        │
│  T029, T030                                                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Dependency Graph

```
T001 ──┬── T002
       └── T003 ── T004
                      │
T005 ──────────────┐  │
T006 ──────────────┤  │
                   │  │
T007 ── T008 ── T012  │
T009 ── T010 ─────────┼── T025 (integration)
T011 ─────────────────┤
                      │
T013 ── T014 ── T018  │
T015 ── T016 ─────────┼── T027 (integration)
T017 ─────────────────┤
                      │
T019 ── T020          │
     └─ T021          │
T022, T023, T024 ─────┴── T030 (final review)
```

---

## Success Criteria

### Functional Requirements

- [ ] Predictions tab renders forecast charts when `enablePredictions: true`
- [ ] Predictions work without Prophet (fallback forecasting)
- [ ] AI Insights tab renders rich cards when `enableInsights: true`
- [ ] Insights include actionable recommendations
- [ ] Dev mode shows synthetic preview data
- [ ] Production mode shows clear setup instructions

### Non-Functional Requirements

- [ ] Chart rendering < 100ms for 12 weeks of data
- [ ] Fallback forecaster accuracy within 20% of Prophet for stable trends
- [ ] No new npm dependencies (use existing Chart.js)
- [ ] WCAG 2.1 AA accessibility compliance for new components
- [ ] 80%+ test coverage for new code

### User Experience Goals

- [ ] Zero-config predictions (just add `enablePredictions: true`)
- [ ] Clear visual distinction between historical and forecast data
- [ ] Actionable insights with specific recommendations
- [ ] Setup guides embedded in dashboard (no external docs required)

---

## Risk Assessment

| Risk                                 | Impact | Likelihood | Mitigation                                                            |
| ------------------------------------ | ------ | ---------- | --------------------------------------------------------------------- |
| Fallback accuracy insufficient       | Medium | Low        | Clearly label forecaster type; recommend Prophet for complex patterns |
| OpenAI prompt produces poor insights | High   | Medium     | Extensive prompt testing; fallback to simpler analysis                |
| Chart performance on large datasets  | Medium | Low        | Aggregate to weekly; limit to 52 weeks max                            |
| Breaking changes to insight schema   | High   | Low        | Version schema; maintain backward compatibility                       |

---

## Timeline Estimate

| Phase                       | Tasks     | Estimated Effort |
| --------------------------- | --------- | ---------------- |
| Phase 1: Foundation         | T001-T006 | 2-3 days         |
| Phase 2: Visual Predictions | T007-T012 | 3-4 days         |
| Phase 3: Enhanced Insights  | T013-T018 | 3-4 days         |
| Phase 4: Setup & Docs       | T019-T024 | 2-3 days         |
| Phase 5: Integration        | T025-T030 | 2-3 days         |
| **Total**                   | 30 tasks  | **12-17 days**   |

With parallel development (3 agents): **5-7 days**

---

## Next Steps

1. **Review this plan** and confirm priorities
2. **Create feature spec** in `.specify/` using `/speckit.specify`
3. **Generate implementation plan** using `/speckit.plan`
4. **Generate tasks** using `/speckit.tasks`
5. **Begin implementation** using `/speckit.implement`

---

## Appendix A: File Inventory

### New Files to Create

```
src/ado_git_repo_insights/ml/
├── fallback_forecaster.py      # Linear regression forecaster

extension/ui/modules/
├── ml/
│   ├── synthetic.ts            # Synthetic data generator
│   ├── dev-mode.ts             # Dev mode detection
│   ├── setup-guides.ts         # In-dashboard setup guides
│   └── cost-calculator.ts      # OpenAI cost estimator
└── charts/
    └── predictions.ts          # Forecast chart rendering

tests/
├── unit/
│   ├── test_fallback_forecaster.py
│   └── test_insights_enhanced.py
└── ui/
    └── test_predictions_chart.ts
```

### Files to Modify

```
src/ado_git_repo_insights/
├── ml/
│   ├── forecaster.py           # Add fallback integration
│   ├── insights.py             # Enhanced prompt + schema
│   └── __init__.py             # Export fallback
└── cli.py                      # Auto-detection logic

extension/ui/
├── modules/
│   └── ml.ts                   # Chart rendering, rich cards
├── types.ts                    # Extended schemas
├── index.html                  # Setup guide containers
└── styles.css                  # New component styles

docs/
├── internal/enable-ml-features.md
└── reference/cli-reference.md
```

---

## Appendix B: Schema Changes

### Enhanced Insight Item (v2)

```typescript
interface InsightItemV2 {
    // Existing fields (v1)
    id: string;
    category: "bottleneck" | "trend" | "anomaly" | "achievement";
    severity: "critical" | "warning" | "info";
    title: string;
    description: string;
    affected_entities: Array<{ type: string; name: string }>;

    // New fields (v2)
    data?: {
        metric: string;
        current_value: number;
        previous_value?: number;
        change_percent?: number;
        trend_direction: "up" | "down" | "stable";
        sparkline?: number[]; // 5 values for mini chart
    };
    recommendation?: {
        action: string;
        priority: "high" | "medium" | "low";
        effort: "high" | "medium" | "low";
    };
}
```

### Predictions Manifest Extension

```json
{
  "features": {
    "predictions": true,
    "ai_insights": true
  },
  "ml_metadata": {
    "forecaster": "linear" | "prophet",
    "prophet_version": "1.1.0",  // only if prophet used
    "insights_model": "gpt-4o-mini",
    "insights_cached": true,
    "cache_age_hours": 12
  }
}
```
