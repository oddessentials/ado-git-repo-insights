**Recommendation**

* **Phase 5A (fast win): local HTML dashboard** (static site + tiny local server)
* **Phase 5B (optional): TUI “ops console”** for quick summaries + health checks

---

## Phase 5 — Local Dashboard Experience (Short Plan)

### 5.1 Local “serve dashboard” command (HTML)

* Add a CLI command, e.g.:

  * `ado-insights dashboard --db path/to/ado-insights.sqlite`
  * `ado-insights dashboard --dataset path/to/dataset-manifest.json`
* Command starts a small local server (or opens a static bundle) that:

  * loads `dataset-manifest.json`
  * loads aggregates (chunked) and renders the same 3 tabs:

    * Metrics / Predictions / AI Insights
  * supports the same filter model and URL persistence

**DoD**

* Works offline on a laptop using only local files
* Fast initial render (loads dimensions + default date range chunks only)
* Identical aggregate schemas as extension UI (no forked formats)

### 5.2 “Build dataset locally” convenience

* Add:

  * `ado-insights build-aggregates --db ado-insights.sqlite --out ./dataset/`
* This creates the same folder structure as pipeline artifacts:

  * manifest + aggregates + optional copied sqlite

**DoD**

* Deterministic outputs (same inputs → same files)
* Easy to zip/share a dataset folder

### 5.3 Optional: Local extraction + dashboard in one flow

* `ado-insights run --org X --projects ... --include-comments` (existing)
* followed by:

  * auto-build aggregates
  * launch dashboard automatically if `--open` is passed

### 5.4 Testing requirements (keep it tight)

* Python tests:

  * manifest + aggregate schema validation (producer contract)
  * chunk indexing correctness
* UI tests (minimal):

  * load dataset folder
  * change date range → fetch additional chunks
  * render empty/error states cleanly
