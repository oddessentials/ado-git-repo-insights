* **Lock the Phase 3.5 contract (no drift):** Update `dataset-contract.md` to define *fixed* file locations (`predictions/trends.json`, `insights/summary.json`), manifest flags (`features.predictions`, `features.ai_insights`), and UI state rules (`missing` → “Not generated yet”, `invalid` → “Unable to display…”, `empty` → “No data yet”). Include `schema_version` on both JSON roots, plus required `generated_at`, and for stubs required `is_stub` + `generated_by`.

* **Define the Predictions JSON (extensible + deterministic):** Use `period_start: "YYYY-MM-DD"` (Monday-aligned). Support multiple metrics via an enum (`pr_throughput`, `cycle_time_minutes`, `review_time_minutes`), multiple horizons per metric, and include a `unit` field per metric (even if redundant) to prevent future UI labeling drift. Require bounds fields (`predicted`, `lower_bound`, `upper_bound`) and allow forward-compatible unknown fields.

* **Define the Insights JSON (descriptive-only, future-ready):** Keep insights descriptive (no recommendations). Require fields: `id`, `category`, `severity`, `title`, `description`, `affected_entities[]`. Add optional `evidence_refs[]` (strings) for future traceability without forcing it now.

* **Implement aggregator output gating (presence drives flags):** In `aggregators.py`, write predictions/insights files only when generated; set `features.predictions=true` if and only if `predictions/trends.json` is written; set `features.ai_insights=true` if and only if `insights/summary.json` is written. If neither exists, flags must be false.

* **Add stub generator (safe + reproducible, $0):** Add `PredictionGenerator` (and `InsightsGenerator`) that produces *deterministic* synthetic data using a stable seed (e.g., hash of `org+project+metric+horizon+period_start`). Gate stub generation behind `--enable-ml-stubs` *and* `ALLOW_ML_STUBS=1`; if flag is passed without env var, hard-fail with a clear error. When stubs are produced, set root fields `is_stub: true`, `generated_by: "phase3.5-stub-v1"` and add a manifest banner field like `warnings: ["STUB DATA - NOT PRODUCTION"]`.

* **CLI wiring:** In `cli.py`, add `--enable-ml-stubs` to `generate-aggregates`. Ensure non-stub runs never require `ALLOW_ML_STUBS`; only the stub path is gated.

* **Dataset loader foundation (ADO artifact, no unzip requirement in UI):** Extend `dataset-loader.js` to load JSON via ADO Build Artifacts REST endpoints (authenticated via extension SDK) without relying on a local `./dataset/` filesystem. Implement a single abstraction: `fetchDatasetFile(relPath)` where `relPath` is the conventional path (e.g., `predictions/trends.json`). The implementation should resolve the artifact download URL for the dataset artifact and fetch the specific file content via supported ADO artifact APIs (or the artifact file listing endpoints) without downloading and extracting a zip in the browser.

* **UI wiring + rendering (null-safe, minimal deps):** In `dashboard.js`, update `updateFeatureTabs()` to:

  * Show Predictions tab if `features.predictions===true`, else hide.
  * Show AI Insights tab if `features.ai_insights===true`, else hide.
  * For each enabled tab, attempt load → validate schema → render; on missing show “Not generated yet”; on invalid show “Unable to display…” and log details to console with a non-sensitive diagnostic code.
    Implement `renderPredictions()` as a simple table + lightweight trend indicators (no chart libs this phase). Implement `renderAIInsights()` as cards grouped by `severity/category`.

* **Schema validation (shared, strict, forward-compatible):** Add a small JSON schema validator module used by both Python tests and JS (or mirror logic): required fields enforced; unknown fields allowed; explicit unit/metric enums enforced. Invalid should not throw uncaught errors—always return a typed error.

* **Tests (cover the real risks, still $0):**

  * `[NEW] tests/unit/test_predictions_schema.py`: validate predictions JSON against contract (including units, period_start format, horizons).
  * `[NEW] tests/unit/test_insights_schema.py`: validate insights JSON against contract.
  * `[MODIFY] tests/unit/test_aggregators.py`: verify flags are set only when files exist; verify stub outputs deterministic across runs; verify stub gating via `ALLOW_ML_STUBS`.
  * `[NEW] extension tests (jsdom)`: test tab behavior + placeholders for missing/invalid/empty states; test render functions never throw on null/partial data.

* **CI prerequisites (pinned + low-noise):** Add GitHub CI secret scan using **gitleaks** with pinned versions and an allowlist file. Start warn-only but restrict output to avoid leaking secrets in logs; scope to PR diff for PRs and full scan on main.

* **Verification checklist (must pass before merge):**

  * `generate-aggregates` without stubs produces no predictions/insights files and flags remain false.
  * `generate-aggregates --enable-ml-stubs` fails unless `ALLOW_ML_STUBS=1`; with env var, produces deterministic stub files + manifest warnings.
  * Extension can load predictions/insights from the ADO build artifact via REST and render: present, missing, invalid, and empty cases with correct messaging and no console exceptions.
