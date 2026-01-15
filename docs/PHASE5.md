## Phase 5 — Advanced Analytics & ML (Production)

### Objective

Replace Phase 3.5 stub generators with:

* **Prophet-based forecasts** → `predictions/trends.json`
* **OpenAI-based insights** → `insights/summary.json`

**Hard constraints (do not violate):**

* Output paths are **exactly**:

  * `predictions/trends.json`
  * `insights/summary.json`
* `schema_version` **must be integer 1**
* `is_stub` **must be present** and **false** for real ML
* `generated_by` must reflect actual generator IDs
* Metric/category/severity enums must match contract exactly
* `dataset-manifest.json` feature flags must reflect “file exists” behavior

---

## Decisions Locked In (from user)

* Insights auth: **env-var only** (`OPENAI_API_KEY`)
* Provider: **OpenAI only** (no Azure)
* Default model: **gpt-5-nano**
* Model override: **OPENAI_MODEL** env var
* Cost controls: **token cap + caching + dry-run**
* Cache TTL: **24h**
* Predictions: Prophet optional; if missing/fails → **warn + skip**
* Insights: missing key → **hard fail early**
* Insights calls: **one call total**

---

## Implementation Steps (Ordered PR slices)

### PR1 — Plumbing & Feature Flags (no ML logic yet)

**Goal:** Add flags + wiring + early validation without breaking base install.

1. **CLI flags**
   Add to `src/ado_git_repo_insights/cli.py`:

* `--enable-predictions`
* `--enable-insights`
* `--insights-max-tokens` (default `1000`)
* `--insights-cache-ttl-hours` (default `24`)
* `--insights-dry-run` (default `false`)

2. **Early validation (hard fail)**
   If `--enable-insights` is set:

* If `OPENAI_API_KEY` missing → exit non-zero with clear message:

  * “OPENAI_API_KEY is required for --enable-insights. Install ML extras: pip install -e '.[ml]'”
* If `openai` package missing (ImportError) → exit non-zero with clear message:

  * “OpenAI SDK not installed. Install ML extras: pip install -e '.[ml]'”

3. **Aggregator integration stubs**
   In `src/ado_git_repo_insights/transform/aggregators.py` inside `AggregateGenerator.generate_all()`:

* If `--enable-predictions`:

  * attempt lazy import `ProphetForecaster`
  * on ImportError → warn “pip install -e '.[ml]'” and set `predictions_generated=False`
* If `--enable-insights`:

  * validation already ensures env var exists
  * attempt lazy import `LLMInsightsGenerator`
  * on ImportError → hard fail (since user explicitly requested insights)

4. **Feature flags in manifest**
   Keep existing behavior:

```python
"features": {
  "predictions": predictions_generated,   # True only if file exists / written
  "ai_insights": insights_generated
}
```

**Acceptance for PR1**

* Base install still runs without `[ml]`
* Flags appear and don’t crash unless insights was explicitly enabled without key/deps
* No output contract changes yet

---

### PR2 — Optional Dependencies (`.[ml]`)

**Goal:** Add ML extras cleanly.

Modify `pyproject.toml`:

```toml
[project.optional-dependencies]
ml = [
  "prophet>=1.1.0",
  "openai>=1.0.0",
]
```

**Acceptance**

* `pip install -e .` still works
* `pip install -e ".[ml]"` works where Prophet is supported; failures are acceptable as long as runtime skip behavior is correct

---

### PR3 — Predictions (ProphetForecaster) producing `predictions/trends.json`

**Goal:** Write **exact contract-compliant** forecasts.

**Add files**

* `src/ado_git_repo_insights/ml/__init__.py`
* `src/ado_git_repo_insights/ml/forecaster.py`

**ProphetForecaster requirements**

* Output path: `{output_dir}/predictions/trends.json`
* JSON shape:

  * `schema_version: 1`
  * `generated_at` ISO-8601 datetime string
  * `is_stub: false`
  * `generated_by: "prophet-v1.0"`
  * `forecasts: []` allowed (empty ok)
* Forecast objects:

  * `metric` ∈ {`pr_throughput`, `cycle_time_minutes`, `review_time_minutes`}
  * `unit`:

    * throughput → `count`
    * time metrics → `minutes`
  * `horizon_weeks` required (4)
  * `values[]` must have Monday-aligned `period_start` (YYYY-MM-DD)

    * If computed date isn’t Monday, normalize to Monday consistently (deterministic rule)

**Data sourcing**

* Pull weekly rollups from SQLite (same source Phase 3.5 used; do not invent a new data pipeline)
* Convert to Prophet DataFrame:

  * `ds`: period start date
  * `y`: metric value

**Failure behavior**

* Any Prophet fit error:

  * log warning with exception class only (no stack unless debug mode exists)
  * skip writing file OR write empty `forecasts: []` (choose the one that best preserves “predictions_generated” semantics)
  * IMPORTANT: since features tab is driven by `predictions_generated`, you typically want:

    * **if skip due to failure → do not write the file** so tab stays disabled
    * **if no data but successful run → write empty forecasts** so tab shows “empty state”
  * Implement this distinction:

    * “no data available” → write empty forecasts (valid schema)
    * “prophet unavailable or failed” → no file written

**Acceptance**

* File written exactly at `predictions/trends.json`
* Passes the UI schema validation rules you captured
* `is_stub: false`
* Monday-aligned periods

---

### PR4 — Insights (OpenAI) producing `insights/summary.json` with dry-run + caching + token cap

**Goal:** Write **contract-compliant** insights safely and cheaply.

**Add file**

* `src/ado_git_repo_insights/ml/insights.py`

**Output contract**

* Output path: `{output_dir}/insights/summary.json`
* JSON shape:

  * `schema_version: 1`
  * `generated_at`
  * `is_stub: false`
  * `generated_by: "openai-v1.0"`
  * `insights: []` allowed

**One call total**
Prompt for JSON output containing an array with up to 3 insights, one per category:

* `bottleneck`
* `trend`
* `anomaly`

**Required insight fields**
Each insight object must include:

* `id` (unique string, deterministic if possible)
* `category` enum
* `severity` enum {`info`,`warning`,`critical`}
* `title`
* `description`
* `affected_entities` (array of strings, can be empty)
* `evidence_refs` optional

**Model selection**

* Use `OPENAI_MODEL` if set; else default `gpt-5-nano`

**Token cap**

* Use `--insights-max-tokens` (default 1000) in the request

**Dry-run**
If `--insights-dry-run`:

* Do not call OpenAI
* Write a prompt artifact file (deterministic location):

  * `{output_dir}/insights/prompt.json`
* Set `insights_generated=False` (no summary.json written) OR write summary.json with empty insights?

  * Prefer: **do not write summary.json** so “AI Insights tab” stays disabled unless real insights exist.
  * (Dry-run is debugging; shouldn’t flip feature flag.)

**Caching**

* Cache file location:

  * `{output_dir}/insights/cache.json` (or `.cache.json`), plus the final `summary.json`
* Cache TTL: 24h
* Cache key inputs (minimum):

  * model name
  * prompt version string (e.g., `"phase5-openai-prompt-v1"`)
  * org/projects selection + date range
  * a DB freshness marker (e.g., max PR updated_at pulled during aggregation; if not available, use db file mtime)
* Behavior:

  * If cache key matches and age < TTL: write `summary.json` from cache without API call

**Error handling**

* API call failure:

  * warn and do not write summary.json (feature flag stays false)
* Response parsing:

  * If response isn’t valid JSON matching expected structure → warn and skip writing file

**Acceptance**

* File written exactly at `insights/summary.json`
* Passes UI validation rules
* No secrets logged
* Dry-run produces prompts but no insights file
* Cache prevents repeated billing

---

### PR5 — Deprecate stubs cleanly (minimal confusion)

**Goal:** Keep stubs for testing only, without mixing behavior.

In `aggregators.py`:

* Keep `PredictionGenerator` and `InsightsGenerator` but:

  * Add `warnings.warn("...deprecated...")` only when explicitly invoked via hidden flag
* Add hidden CLI flag (not in help):

  * `--stub-mode`
* Rules:

  * If `--stub-mode` is set, stubs run and set `is_stub: true`
  * Otherwise, stubs are not used at all

**Acceptance**

* Normal users never see stub warnings
* Stub mode still works for deterministic testing if needed

---

## Test Plan (CI-safe)

### Base CI (no `[ml]`)

Must pass:

* CLI parsing tests
* Aggregator runs with no ML deps installed
* `--enable-predictions` warns+skips (no crash)
* `--enable-insights` fails early if key missing

### ML tests (mocked, no real Prophet fit, no real API)

Add unit tests:

* `tests/unit/test_forecaster_contract.py`

  * mock Prophet; verify exact JSON structure and enums
  * verify Monday-alignment
  * verify no-data vs failure behavior (empty forecasts vs no file)
* `tests/unit/test_insights_contract.py`

  * mock OpenAI client; verify parsing to exact schema
  * dry-run writes prompt artifact only
  * caching hit avoids API call
  * token cap passed through
* `tests/unit/test_manifest_feature_flags.py`

  * ensures manifest features flip only when the files are written

---

## Performance/Telemetry (tiny, required)

Add timing logs (already consistent with your monitoring direction):

* Prophet: per metric fit time + total
* Insights: api call time OR cache hit OR dry-run mode

No extra infra. Just log durations.

---

## Final Definition of Done

* Predictions: when enabled and possible, generates `predictions/trends.json` with `is_stub:false`, schema_version 1, correct metric enums, Monday periods
* Insights: when enabled with key, generates `insights/summary.json` with `is_stub:false`, schema_version 1, correct enums
* Insights supports:

  * `--insights-dry-run` (no call)
  * `--insights-max-tokens`
  * 24h caching by dataset hash marker
* Feature flags in `dataset-manifest.json` correctly reflect file existence
* Base CI passes without `[ml]`
* ML tests run using mocks and validate exact JSON contracts
