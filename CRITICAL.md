## Implementation Plan (Final) — Dogfood First, No Shortcuts

### Non-negotiable outcomes

- Local dashboard **must** work using **real pipeline artifacts** staged into `./run_artifacts/` in the **default nested layout** produced by artifact download (including `aggregates/aggregates/...` when that happens).
- UI bundle in `src/ado_git_repo_insights/ui_bundle/` must contain **browser-executable JS** (no TS, no ESM `import/export`).
- Tests + CI must prevent regressions.

---

## Step 1 — Dogfood: Add “stage pipeline artifacts → ./run_artifacts/” (FIRST, BLOCKING)

### 1.1 Add CLI command (Python)

**Add:** `ado-insights stage-artifacts` (or `download-artifacts` if that name already exists)

**Behavior**

- Locates the latest successful run (or a specified run) for the configured pipeline.
- Downloads the **aggregates artifact** exactly as published.
- Extracts it into `./run_artifacts/` **preserving nested paths** (do not flatten).
- Writes a small `./run_artifacts/STAGED.json` containing:
    - timestamp
    - org/project/pipeline/run identifiers
    - artifact name
    - resolved “dataset root candidates” it found (see 1.2)

**Command shape**

- `ado-insights stage-artifacts --org ... --project ... --pipeline-id ... --artifact aggregates --out ./run_artifacts`
- Optional: `--run-id` to pin an exact run.

### 1.2 Implement deterministic dataset root discovery

**Add:** a single function used by both `stage-artifacts` and `dashboard`:

`find_dataset_roots(run_artifacts_dir) -> list[Path]`

It must return candidates in priority order, e.g.:

- `run_artifacts/` (if `dataset-manifest.json` exists here)
- `run_artifacts/aggregates/`
- `run_artifacts/aggregates/aggregates/`
- (and any other common nesting you’ve observed)

**Acceptance criteria**

- After running `stage-artifacts`, at least one candidate root contains:
    - `dataset-manifest.json`
    - `aggregates/` directory (or whatever your manifest expects)

- If none found: fail with a single error explaining:
    - what was downloaded
    - what paths were searched
    - what files were expected

### 1.3 Update `dashboard` command to use staged artifacts

**Update:** `ado-insights dashboard`

- Default behavior: if `--dataset` not provided, use `./run_artifacts/`.
- It must call `find_dataset_roots()` and choose the first valid root.
- It must log the selected dataset root path.

**DoD for Step 1**

- One command stages artifacts into `./run_artifacts/` (nested preserved).
- `ado-insights dashboard` can point at `./run_artifacts` and successfully finds the dataset root (even when nested).

---

## Step 2 — Make DatasetLoader tolerant to nested artifact layouts (BLOCKING)

### 2.1 Add base-path resolution (one-time, not per-file hacks)

**Update (TS):** `DatasetLoader` (or the place that forms URLs/paths)

**Requirement**

- When constructing fetch paths, the loader must support both layouts:
    - “expected” layout
    - “nested” artifact layout (e.g., `aggregates/aggregates/...`)

**Implementation approach**

- At initialization, determine the “effective dataset root” once:
    - attempt to fetch `dataset-manifest.json` from candidate roots (relative to provided base)
    - choose the first that succeeds

- All subsequent fetches are relative to the effective root.

### 2.2 Add integration tests (Jest/JSDOM)

**Add tests**

- “loads dataset when manifest lives under `aggregates/aggregates/`”
- “loads dataset when manifest lives at root”
- Ensure these tests go through `DatasetLoader` APIs (not direct normalizer calls).

**DoD for Step 2**

- Same staged artifacts work whether nested or not.
- Tests cover both layouts and fail if either breaks.

---

## Step 3 — Fix browser execution: bundle TS to IIFE JS (BLOCKING)

### 3.1 Add esbuild bundling for browser runtime

**Add:** `extension/scripts/bundle-ui.mjs`

- Entry points: `ui/dashboard.ts`, `ui/settings.ts` (and any other UI entrypoints)
- `bundle: true`
- `format: 'iife'`
- `target: 'es2020'`
- Output: `extension/dist/ui/*.js`
- Export a stable global surface (example): `window.PRInsights = {...}`
  (Whatever the HTML expects must be true after bundling.)

### 3.2 Keep `tsc --noEmit` as the typecheck gate

**Do not remove tsc typechecking.**

- `build:check` = `tsc --noEmit`
- `build:ui` = esbuild bundling

### 3.3 Update UI bundle sync to copy compiled JS

**Update:** `scripts/sync_ui_bundle.py`

- Copy from `extension/dist/ui/` (compiled JS output), not from `extension/ui/` source.
- Sync target: `src/ado_git_repo_insights/ui_bundle/`

**DoD for Step 3**

- `ui_bundle/` contains JS that runs in the browser via classic `<script>` tags.
- No ESM `import/export` is present in the shipped `ui_bundle` JS.

---

## Step 4 — Lock regression dataset using dogfooded artifacts (REQUIRED)

### 4.1 Add a standard “dogfood dataset” workflow

- Run `ado-insights stage-artifacts ... --out ./run_artifacts`
- Commit **a small representative** staged dataset into the repo (or store it as a test artifact if repo size matters), then:
    - point integration tests to it
    - ensure it includes the nested path case

**DoD for Step 4**

- The regression dataset is produced by your own staging command and is used by tests.

---

## Step 5 — CI + Hook Guards (MANDATORY)

### 5.1 CI: fail if `ui_bundle/` contains TS

- Check for any `*.ts` under `src/ado_git_repo_insights/ui_bundle/` → fail.

### 5.2 CI: fail if bundled JS contains ESM syntax

- Check shipped JS for ESM tokens:
    - `^\s*import\s`
    - `^\s*export\s`

- Run against `src/ado_git_repo_insights/ui_bundle/*.js` → fail on match.

### 5.3 CI: enforce UI bundle sync

- Run your bundle+sync command in CI.
- Then verify `extension/ui` (sources) correspond to the built+synced outputs (your existing sync check).

### 5.4 Add/keep Jest + pytest gates

- Full suite runs, no skipped tests.
- Test-count minimums must still pass (update thresholds only if required by policy, not casually).

**DoD for Step 5**

- CI blocks any PR that reintroduces TS/ESM into `ui_bundle` or breaks staging/path tolerance.

---

## Step 6 — Packaging + Validation (MANDATORY)

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
