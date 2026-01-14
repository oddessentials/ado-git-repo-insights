## Phase 4 — Extension Test & Ops Hardening (Short Plan)

### 1) Extension-side Test Harness (highest value)

* Add a small **UI test harness** that mocks Azure DevOps REST calls used by the extension:

  * “latest successful run” discovery
  * artifact download URLs
  * permission denied / 404 / no runs / transient failures
* Implement a few **golden JSON fixtures** (manifest + aggregates) and run UI tests against them.
* DoD: UI tests can run in CI without needing a real pipeline run.

### 2) Contract Tests Between Python Outputs and UI Inputs

* Define explicit JSON schemas for:

  * `dataset-manifest.json`
  * `dimensions.json`
  * `weekly_rollups/*.json`
  * `distributions/*.json`
* Add:

  * Python-side schema validation tests (producer)
  * UI-side schema validation tests (consumer)
* DoD: schema breaking changes fail CI immediately.

### 3) Permission & Recovery UX Hardening

* In the UI, explicitly detect and message:

  * missing Build Read
  * pipeline/project not found
  * artifacts missing
  * dataset version mismatch
* Add “Retry” and “Open pipeline run” links where possible.
* DoD: no “blank screen” failure modes.

### 4) Performance Guardrails for Large Orgs

* Add chunk-fetch limits and progressive rendering behavior:

  * warn on very large date ranges
  * cache chunks, avoid re-fetch
  * cap concurrent fetches to avoid browser thrash
* Add a lightweight perf test using large synthetic aggregate fixtures.
* DoD: UI remains responsive with “big fixture” datasets.

### 5) Operational Checks (low effort, prevents silent failure)

* Add a startup check/report in pipeline output that prints:

  * artifact size, row counts
  * comment/team coverage flags
  * retention guidance reminder
* DoD: operators can detect drift and scaling issues from logs/manifest alone.
