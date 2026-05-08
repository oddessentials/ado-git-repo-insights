# Enabling ML Features

Two opt-in dashboard tabs:

- **Predictions** — 4-week forecasts for PR throughput, cycle time, and review time. Zero-config (NumPy linear forecaster) by default; Prophet upgrades the model with seasonality detection when installed.
- **AI Insights** — OpenAI-generated observations on bottlenecks, trends, and anomalies. Requires an OpenAI API key.

Enable per pipeline run via task inputs.

---

## Predictions

Works with **no extra dependencies** — the built-in NumPy linear forecaster handles trend extrapolation, 3σ outlier clipping, and a data-quality assessment (`insufficient` / `low_confidence` / `normal`). Minimum 4 weeks of data; 8+ recommended.

```yaml
- task: ExtractPullRequests@3
  inputs:
    generateAggregates: true
    enablePredictions: true
```

For seasonality-aware forecasts, install Prophet (requires a C++ compiler — platform-specific instructions: [Prophet Installation](https://facebook.github.io/prophet/docs/installation.html)). The system automatically detects Prophet and uses it when present, falling back to the linear forecaster otherwise.

---

## AI Insights

1. Create an OpenAI account, generate an API key.
2. In ADO: **Pipelines** → **Library** → create variable group `OpenAI Secrets` → add variable `OPENAI_API_KEY` (mark as secret) → link to the pipeline.
3. Enable on the task:

```yaml
- task: ExtractPullRequests@3
  inputs:
    generateAggregates: true
    enableInsights: true
    openaiApiKey: $(OPENAI_API_KEY)
```

---

## Task inputs

| Input | Type | Default | Description |
|---|---|---|---|
| `enablePredictions` | bool | `false` | Generate forecasts |
| `enableInsights` | bool | `false` | Generate AI insights |
| `openaiApiKey` | string | — | Required when `enableInsights: true` |

---

## Output files

```
aggregates/
├── dataset-manifest.json    # features.predictions / features.ai_insights = true
├── predictions/trends.json  # when enablePredictions=true
└── insights/summary.json    # when enableInsights=true
```

### `predictions/trends.json`

4-week forecasts per metric (`pr_throughput`, `cycle_time_minutes`, `review_time_minutes`). Each forecast value carries `predicted`, `lower_bound`, `upper_bound`, and `period_start`. Top-level `forecaster` is `linear` or `prophet`; `data_quality` is `normal` (8+ weeks), `low_confidence` (4–7 weeks), or `insufficient` (<4 weeks → no forecasts emitted).

### `insights/summary.json`

Each insight has `id`, `category` (`bottleneck` / `trend` / `anomaly`), `severity` (`critical` / `warning` / `info`), `title`, `description`, `affected_entities`, `data` (with metric, current/previous values, sparkline), and `recommendation` (action + priority + effort). Insights are sorted deterministically: severity, then category, then id — for stable display.

---

## Cost

| Surface | Cost | Runtime overhead | Caching |
|---|---|---|---|
| Linear forecaster | free | <1 s | — |
| Prophet | free | +10–30 s; CPU-intensive during model fit | — |
| OpenAI Insights | ~$0.001–0.01 per run, depends on PR count | +5–15 s | 12 h on identical inputs (delete `insights/cache.json` to force regeneration) |

---

## Dev preview

To preview the tabs against synthetic data without running the pipeline: append `?devMode=true` to the dashboard URL. Works only on `localhost` or `file://`; never available on `dev.azure.com`. Shows a "PREVIEW — Demo Data" banner.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Insufficient Data" on Predictions | Need 4+ weeks of completed PRs. `sqlite3 data.db "SELECT MIN(closed_date), MAX(closed_date), COUNT(*) FROM pull_requests WHERE status='completed'"` to check coverage. |
| "Using linear forecaster instead of Prophet" | Expected when Prophet isn't installed. Install with `pip install "ado-git-repo-insights[ml]"` if you want Prophet. |
| AI Insights enabled but OPENAI key missing | `openaiApiKey` input must be set AND the variable group containing `OPENAI_API_KEY` must be linked to the pipeline. |
| OpenAI rate limit | Wait for window reset, or upgrade OpenAI plan. Insights cache for 12 h on identical inputs. |
| "Low Confidence" data quality | 4–7 weeks of data; accumulate 8+ weeks for higher-confidence forecasts. |
| Prophet install fails | Skip it — the linear fallback is fine for most use. Prophet's platform-specific build issues are documented at https://facebook.github.io/prophet/docs/installation.html. |

---

## Security

- PAT and OpenAI key are passed via environment / variable group; never logged.
- AI Insights sends PR metadata (titles, cycle times, counts) to OpenAI. If you have data residency requirements, route through Azure OpenAI Service instead.
- Full security posture: [`docs/SECURITY.md`](../SECURITY.md).
</content>
