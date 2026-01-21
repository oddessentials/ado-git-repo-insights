## Dataset Layout Fix + Regression Validation (Optimized Execution Plan)

**Branch:** `feat/standards-upgrade`
**Rule:** Each phase below is **one commit**. Do not mix phases.

---

# Target Contract (Must Match Exactly)

```
artifact-root/
├── dataset-manifest.json
└── aggregates/
    ├── dimensions.json
    ├── weekly_rollups/...
    └── distributions/...
```

**Invariant:** `dataset-manifest.json` is at artifact root. All paths in `aggregate_index` resolve relative to that root.

---

## Phase 1 Commit — Atomic Generator + Pipeline + Discovery + Loader Cutover

**Commit message:** `fix(aggregates): move manifest to artifact root and cut over discovery`

### 1. Generator output contract

- [MODIFY] `aggregators.py`
    - Write `dataset-manifest.json` to `output_dir/` (artifact root)
    - Keep all data under `output_dir/aggregates/...`
    - Ensure manifest `aggregate_index.*.path` remains relative to manifest root (e.g., `aggregates/weekly_rollups/...`)

### 2. Pipeline publish path (remove nesting)

- [MODIFY] `pr-insights-pipeline.yml`
    - Change `PublishPipelineArtifact@1.targetPath` from `$(Pipeline.Workspace)/run_artifacts/aggregates` **to** `$(Pipeline.Workspace)/run_artifacts`
    - Keep artifact name as `aggregates`

### 3. Template alignment (no drift)

- [MODIFY] all extension pipeline templates (`sample-pipeline.yml`, `extension-verification-test.yml`, etc.)
    - Same publish behavior as above

### 4. Unified dataset root resolution (clean break)

- [MODIFY] `dataset_discovery.py`
    - `CANDIDATE_PATHS = ['.', 'aggregates']` only
    - Add `validate_manifest_paths(root)` that asserts every `aggregate_index` referenced file exists
    - Add **hard error** if deprecated layout detected (`root/aggregates/aggregates/dataset-manifest.json`)

- [MODIFY] `cli.py` (`cmd_stage_artifacts`, `cmd_dashboard`)
    - Call only the unified `find_dataset_roots()` + `validate_manifest_paths()` path
    - No alternate discovery logic in commands

- [MODIFY] `dataset-loader.ts`
    - `DATASET_CANDIDATE_PATHS = ['', 'aggregates']` only
    - Remove any `aggregates/aggregates` logic

**Phase 1 DoD**

- Generator writes new layout locally.
- Pipeline YAML publishes new layout (no nesting).
- CLI + extension both resolve dataset root using only `['.', 'aggregates']`.
- Deprecated layout triggers the required hard error message.

---

## Phase 2 Commit — Invariant Tests + Fixture Alignment (Python + Extension)

**Commit message:** `test(regression): enforce manifest paths invariant and align fixtures`

### 1. Python invariant test

- [NEW] `tests/unit/test_manifest_paths_invariant.py`
    - Validate every `aggregate_index.weekly_rollups[*].path` and `aggregate_index.distributions[*].path` exists under fixture root

### 2. Extension invariant test

- [NEW] `extension/tests/manifest-paths-invariant.test.ts`
    - Same invariant for extension fixtures

### 3. Update fixtures to match contract

- [DELETE] any nested-layout fixtures (`extension/tests/fixtures/nested-layout/`)
- [MODIFY] `extension/tests/fixtures/**`
    - Ensure `dataset-manifest.json` is at fixture root
    - Ensure all referenced paths exist and match relative paths

### 4. Synthetic generator alignment

- [MODIFY] `scripts/generate-synthetic-dataset.py`
    - Output only the new flat manifest-at-root layout
    - Remove `--layout nested` concept (delete flag + docs + tests referencing it)

**Phase 2 DoD**

- `pytest` passes including manifest invariant test.
- `npm test` passes including TS invariant test.
- No repo references to `aggregates/aggregates` remain in tests/fixtures.

---

## Phase 3 Commit — CLI + UI Labeling (Dev vs Production)

**Commit message:** `feat(cli): label local-db aggregates as DEV mode and stage-artifacts as recommended`

### 1. CLI help text clarity

- [MODIFY] `cli.py` help text
    - `stage-artifacts`: “Download pipeline artifacts for local dashboard (RECOMMENDED)”
    - `build-aggregates`: “Generate aggregates from local database (DEV/SECONDARY)”

### 2. Explicit runtime warnings

- [MODIFY] `cmd_build_aggregates`
    - Log warnings:
        - “=== DEV MODE: Generating from local database ===”
        - “For production, use 'ado-insights stage-artifacts' instead.”

### 3. Dashboard banner for local DB source

- [MODIFY] `local-config.js` / dashboard header behavior
    - If `LOCAL_DASHBOARD_MODE=true` and source indicates local build: show banner
      `⚠️ DEV MODE: Data from local database, not pipeline`

**Phase 3 DoD**

- Running `build-aggregates` is unmistakably “DEV/secondary”.
- Staged pipeline artifacts remain the clearly recommended path.

---

## Phase 4 Commit — Docs Update + Breaking Change Notice

**Commit message:** `docs: update dataset artifact structure and staging guidance`

### 1. Update docs to new contract

- [MODIFY] artifact structure docs and user guides
    - Show the new target contract structure
    - Include the hard error message guidance: “republish pipeline and re-stage artifacts”

### 2. Explicit breaking change section

- Add a “Breaking Change” note:
    - Old layout will hard-fail
    - Required action: republish pipeline after upgrading

**Phase 4 DoD**

- Docs match reality and point users to `stage-artifacts` workflow.

---

# Mandatory Validation Gates (Run in this order)

1. `pytest` → all pass (includes invariant)
2. `cd extension && npm run build:check` → pass
3. `cd extension && npm test` → all pass
4. **Manual dogfood (required before merge):**
    - Run pipeline with updated version
    - `ado-insights stage-artifacts ... --out ./run_artifacts`
    - Confirm `./run_artifacts/dataset-manifest.json` exists at root
    - `ado-insights dashboard` loads real data (no JS errors, data renders)

---

# Absolute Rules During Implementation

- Do not add or keep any `aggregates/aggregates` fallback logic.
- Do not merge phases together—**one commit per phase**.
- Do not treat synthetic fixtures as “dashboard UX validation.” Real UX validation uses staged pipeline artifacts derived from pipeline SQLite.

## Follow-Up Phase — Packaging + Validation (MANDATORY)

### 6.1 Build VSIX

- `tfx extension create --manifest-globs vss-extension.json` must succeed.

### 6.2 Validate on ADO

- Deploy to the agreed sandbox project.
- Verify dashboard loads and renders using staged artifacts.

### 6.3 Validate local dashboard end-to-end

- `ado-insights stage-artifacts ...`
- `ado-insights dashboard` (default `./run_artifacts`)
- Confirm: loads, no JS syntax error, data renders.

---

## Commit Slice Order (Do not reorder) [branch: feat/standards-upgrade]

1. **feat(cli): stage pipeline artifacts to ./run_artifacts + dataset root discovery**
2. **feat(ui): DatasetLoader root resolution + tests for nested layouts**
3. **feat(ui-build): esbuild IIFE bundling + sync_ui_bundle copies dist JS**
4. **test(regression): lock dogfooded staged dataset + integration coverage**
5. **feat(ci): guards for no TS/ESM in ui_bundle + sync enforcement**
6. **chore(release): vsix build + validation checklist**
