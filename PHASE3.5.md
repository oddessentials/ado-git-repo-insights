# Phase 3.5 Gap Closure — Final Implementation Plan

**Objective:**
Close all remaining automation, validation, and test gaps so Phase 3.5 ships as a **stable, extensible, enterprise-ready ML dashboard foundation**.
No shortcuts. No deferrals. No ambiguity.

---

## 1. Python JSON Schema Validation (Required)

### Files

* `tests/unit/test_predictions_schema.py` **[NEW]**
* `tests/unit/test_insights_schema.py` **[NEW]**

### Predictions Schema Tests (`test_predictions_schema.py`)

Implement strict validation tests for `predictions/trends.json`:

* Valid schema passes
* Missing required root fields **fail**:

  * `schema_version`
  * `generated_at`
  * `forecasts`
* Each forecast entry must:

  * Use a valid metric enum:
    `pr_throughput | cycle_time_minutes | review_time_minutes`
  * Include a valid `unit` matching the metric
  * Include `period_start` formatted as `YYYY-MM-DD` and **Monday-aligned**
  * Include bounds fields: `predicted`, `lower_bound`, `upper_bound`
* Invalid metric enum **fails**
* Invalid `period_start` format or weekday **fails**
* Unknown fields are **allowed** (forward-compatible)
* Empty `forecasts[]` is **valid** and represents an empty state

### Insights Schema Tests (`test_insights_schema.py`)

Implement strict validation tests for `insights/summary.json`:

* Valid schema passes
* Missing required root fields **fail**:

  * `schema_version`
  * `generated_at`
  * `insights`
* Each insight must include:

  * `id`
  * `category` (`bottleneck | trend | anomaly`)
  * `severity` (`info | warning | critical`)
  * `title`
  * `description`
  * `affected_entities[]`
* Invalid category or severity enum **fails**
* Optional `evidence_refs[]` allowed
* Unknown fields allowed (forward-compatible)

---

## 2. Aggregator Stub Gating & Determinism (Required)

### File

* `tests/unit/test_aggregators.py` **[MODIFY]**

### Add `TestStubGeneration` test class

Implement **all** of the following tests:

* `--enable-ml-stubs` **without** `ALLOW_ML_STUBS=1`
  → raises `StubGenerationError`
* `--enable-ml-stubs` **with** `ALLOW_ML_STUBS=1`
  → generates predictions + insights stub files
* Stub output is **deterministic**:

  * Same seed base produces identical JSON across runs
* Non-stub run:

  * Does **not** generate predictions/insights files
  * Sets `features.predictions=false`
  * Sets `features.ai_insights=false`
* Stub output files must include:

  * `is_stub: true`
  * `generated_by: "phase3.5-stub-v1"`
* Dataset manifest must include:

  * `warnings: ["STUB DATA - NOT PRODUCTION"]`

---

## 3. gitleaks CI Secret Scan (Required)

### Files

* `.gitleaks.toml` **[NEW]**
* `ci.yml` **[MODIFY]**

### gitleaks Configuration

Create `.gitleaks.toml` with allowlists for:

* Test fixtures containing fake tokens
* Documentation/examples

### CI Job (`ci.yml`)

Add job:

```yaml
secret-scan:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0
    - uses: gitleaks/gitleaks-action@v2.3.9
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      with:
        args: --config=.gitleaks.toml
```

Rules:

* Pinned gitleaks version (`v2.3.9`)
* PRs: diff-only scan (default behavior)
* `main`: full history scan
* Warn-only mode (do not block PRs)

---

## 4. Extension Test Infrastructure (Required)

### Files

* `extension/package.json` **[MODIFY]**
* `extension/jest.config.js` **[NEW]**
* `extension/tests/dataset-loader.test.js` **[NEW]**
* `extension/tests/dashboard.test.js` **[NEW]**

### Setup

* Add `jest`, `jsdom`, and required mocks as dev dependencies
* Configure Jest for `jsdom` environment
* Mock `fetch` in all tests (no network access)

---

## 5. Dataset Loader Contract Tests (Required)

### File

* `extension/tests/dataset-loader.test.js`

Implement tests for loader behavior:

* `validatePredictionsSchema()`:

  * Returns `{ valid: true }` for valid input
  * Returns `{ valid: false, error }` for invalid input
* `validateInsightsSchema()`:

  * Returns typed error objects
  * **Never throws**
* `loadPredictions()`:

  * Returns `{ state: "disabled" }` when feature flag is false
  * Returns `{ state: "missing" }` on 404
  * Returns `{ state: "auth" }` on 401/403
  * Returns `{ state: "invalid" }` on schema failure
  * Returns `{ state: "ok", data }` on success

Typed states are mandatory; `null` is not acceptable.

---

## 6. Dashboard Rendering Tests (Required)

### File

* `extension/tests/dashboard.test.js`

Implement tests to guarantee UI stability:

* `renderPredictions()`:

  * Handles `null` / `undefined` safely
  * Renders stub warning when `is_stub=true`
* `renderAIInsights()`:

  * Groups insights by severity correctly
* Error states:

  * Missing → “Not generated yet”
  * Invalid → “Unable to display insights” + diagnostic code
  * Empty → “No data yet”
* Rendering functions **must never throw**

---

## 7. CI Integration for Extension Tests (Required)

### File

* `ci.yml` **[MODIFY]**

Add job:

```yaml
extension-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
    - run: cd extension && npm ci
    - run: cd extension && npm test
```

---

## 8. Required Implementation Order

1. Python schema validation tests
2. Aggregator stub gating + determinism
3. gitleaks CI + allowlist
4. Extension test infrastructure
5. Dataset loader contract tests
6. Dashboard rendering tests
7. CI wiring

---

## 9. Acceptance Criteria (Must Pass)

CI must pass all of the following:

```bash
pytest tests/unit/test_predictions_schema.py -v
pytest tests/unit/test_insights_schema.py -v
pytest tests/unit/test_aggregators.py::TestStubGeneration -v
cd extension && npm test
```

gitleaks runs on every PR.

---

## Explicitly Out of Scope (Not Part of This Work)

* ML model implementation (Phase 4+)
* LLM insight generation
* UI polish beyond correctness and stability

---

**Outcome:**
Phase 3.5 delivers a **credible, extensible ML dashboard foundation** with strict contracts, deterministic behavior, CI enforcement, and UI resilience suitable for enterprise rollout.
