# Implementation Plan: GitHub Pages Demo Dashboard

**Branch**: `018-github-pages-demo` | **Date**: 2026-01-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/018-github-pages-demo/spec.md`

## Summary

Create a GitHub Pages-hosted live demo of the PR Insights Dashboard with 5 years of deterministic synthetic data. The demo will showcase all dashboard features (metrics, charts, predictions, AI insights) using static JSON files served from the repository's `/docs` folder. All generation is fully deterministic (seed=42), rule-based (no LLM calls), and enforced by non-bypassable CI checks.

## Technical Context

**Language/Version**: Python 3.11 (data generation, pinned), Node 22 (dashboard build, pinned)
**Primary Dependencies**: esbuild 0.27.0 (bundler), pnpm 9.15.0 (package manager), vss-web-extension-sdk 5.141.0
**Storage**: Static JSON files in `./docs/data/` (no database for demo)
**Testing**: pytest (Python synthetic data), Jest (TypeScript dashboard), CI regeneration diff check
**Target Platform**: GitHub Pages (static hosting from `/docs` folder)
**Project Type**: Hybrid - Python script for data generation, TypeScript for dashboard UI adaptation
**Performance Goals**: < 3 second page load, < 50 MB total docs/ size
**Constraints**: Byte-identical regeneration, no external API calls, no LLM calls, relative base paths
**Scale/Scope**: 260 ISO weeks, 3 orgs, 8 projects, 20 repos, 50 users, 5 distributions, 12-week forecasts

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| III. Deterministic Output | ✅ PASS | FR-001, FR-017 mandate byte-identical JSON with canonical formatting |
| VII. No Publish on Failure | ✅ PASS | FR-016 fails build if size cap violated; SC-009 fails on regeneration diff |
| XII. No Silent Data Loss | ✅ PASS | CI validation ensures all data files present and schema-valid |
| XXIII. Automated Contract Validation | ✅ PASS | FR-014 mandates schema validation; SC-004 enforces 100% pass rate |
| XXIV. E2E Testability | ✅ PASS | SC-010 validates base-path correctness with zero 404s |

**Constitution Compliance**: This feature is additive (new demo capability) and does not modify any existing extraction, CSV generation, or persistence logic. It uses existing JSON schemas as contracts without changes.

## Project Structure

### Documentation (this feature)

```text
specs/018-github-pages-demo/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (JSON schema references)
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
scripts/
└── generate-demo-data.py    # NEW: Deterministic synthetic data generator

docs/                        # NEW: GitHub Pages deployment directory
├── index.html              # Dashboard entry point with local mode config
├── dashboard.js            # IIFE bundle (from extension build)
├── dataset-loader.js       # Data loading bundle
├── artifact-client.js      # Auth-free client variant
├── error-types.js          # Error handling bundle
├── error-codes.js          # Error codes bundle
├── styles.css              # Dashboard styling
├── VSS.SDK.min.js          # Azure DevOps SDK (bundled)
└── data/                   # Synthetic dataset
    ├── dataset-manifest.json
    ├── aggregates/
    │   ├── dimensions.json
    │   ├── weekly_rollups/
    │   │   ├── 2021-W01.json
    │   │   ├── ...
    │   │   └── 2025-W52.json
    │   └── distributions/
    │       ├── 2021.json
    │       ├── 2022.json
    │       ├── 2023.json
    │       ├── 2024.json
    │       └── 2025.json
    ├── predictions/
    │   └── trends.json
    └── insights/
        └── summary.json

extension/ui/
├── index.html              # MODIFY: Add synthetic data banner
└── modules/
    └── sdk.ts              # EXISTING: Local mode support already present

.github/workflows/
└── demo.yml                # NEW: CI workflow for demo validation

tests/
└── demo/                   # NEW: Demo-specific tests
    ├── test_synthetic_data.py
    ├── test_regeneration.py
    └── test_base_path.py
```

**Structure Decision**: The demo is self-contained in `docs/` for GitHub Pages compatibility. Data generation is a standalone Python script in `scripts/` that outputs to `docs/data/`. Dashboard UI files are copied from `extension/dist/ui/` with local mode configuration injected.

## Complexity Tracking

No constitution violations requiring justification. This feature:
- Uses existing JSON schema contracts (no new contracts needed)
- Uses existing dashboard build system (no new bundler)
- Uses existing local mode capability (no SDK modification)
- Adds only: synthetic data generator, CI validation, docs/ output directory

## Phase 0: Research Summary

### R1: Local Mode Capability

**Decision**: Use existing `window.LOCAL_DASHBOARD_MODE` and `window.DATASET_PATH` globals
**Rationale**: Dashboard already supports local mode (lines 563-581 of dashboard.ts); no modification needed to core dashboard logic
**Alternatives Rejected**:
- Query parameter injection (`?dataset=...`) - less clean for static hosting
- New build target - unnecessary complexity when globals work

### R2: Deterministic GUID Generation

**Decision**: Use UUID v5 with namespace `6ba7b810-9dad-11d1-80b4-00c04fd430c8` (DNS namespace) and deterministic name strings
**Rationale**: UUID v5 is deterministic given same namespace+name; Python's `uuid.uuid5()` is cross-platform stable
**Alternatives Rejected**:
- UUID v4 (random) - not deterministic
- Sequential integers - not realistic for ADO entity IDs

### R3: Cycle Time Distribution Model

**Decision**: Log-normal distribution with μ=6.0 (log-minutes), σ=1.5 for realistic cycle times
**Rationale**: Log-normal matches empirical PR merge time distributions; parameterized for P50≈400min (6.7h), P90≈3000min (50h)
**Alternatives Rejected**:
- Normal distribution - produces negative values, unrealistic
- Uniform distribution - lacks realistic long-tail behavior

### R4: Seasonal Variation Model

**Decision**: Sinusoidal adjustment with period=52 weeks, amplitude=±20%, phase shift for December trough
**Rationale**: Simple, deterministic, produces believable weekly variation with holiday patterns
**Alternatives Rejected**:
- Random walk - not deterministic
- Empirical historical data - breaks synthetic-only requirement

### R5: Rule-Based Insights Templates

**Decision**: 8 insight templates covering bottleneck (2), trend (3), anomaly (3) categories
**Rationale**: Templates with threshold-based triggering are fully deterministic; parameterized by aggregate metrics
**Alternatives Rejected**:
- LLM generation - explicitly forbidden by FR-008
- Static hardcoded insights - less realistic, doesn't demonstrate feature

### R6: Base Path Configuration

**Decision**: Inject `<base href="./">` in index.html; all asset paths relative
**Rationale**: HTML `<base>` element provides cleanest solution for subpath serving
**Alternatives Rejected**:
- Absolute paths - breaks on different hosting domains
- Build-time path rewriting - adds complexity to existing build

### R7: CI Validation Approach

**Decision**: GitHub Actions workflow with three jobs: regenerate, diff-check, base-path-serve
**Rationale**: Separate jobs allow parallel execution and clear failure attribution
**Alternatives Rejected**:
- Single monolithic job - harder to diagnose failures
- Pre-commit hook only - doesn't catch CI environment differences

## Phase 1: Design Artifacts

See:
- [data-model.md](./data-model.md) - Synthetic entity structures
- [contracts/](./contracts/) - JSON schema references
- [quickstart.md](./quickstart.md) - Developer setup guide

## Implementation Phases

### Phase 1: Synthetic Data Generator (P1 Priority)

1. Create `scripts/generate-demo-data.py`:
   - Deterministic random with `random.seed(42)`
   - UUID v5 generation for all entity IDs
   - Organization/project/repository/user generation
   - Weekly rollup generation for 260 weeks (2021-W01 to 2025-W52)
   - Distribution generation for 5 years
   - Canonical JSON output (sorted keys, 3-decimal floats, UTC timestamps)

2. Create `scripts/generate-demo-predictions.py`:
   - 12-week forecast for 3 metrics
   - Deterministic trend continuation with confidence intervals
   - Schema-compliant output

3. Create `scripts/generate-demo-insights.py`:
   - Rule-based insight generation from aggregates
   - Template-based descriptions
   - 5+ diverse insights across categories

### Phase 2: Dashboard Adaptation (P1 Priority)

1. Create `scripts/build-demo.sh`:
   - Run `pnpm build` in extension/
   - Copy dist/ui/* to docs/
   - Inject local mode configuration into docs/index.html
   - Add synthetic data banner HTML/CSS

2. Modify `extension/ui/index.html`:
   - Add banner component for synthetic data notice
   - CSS for banner styling (dismissible, non-intrusive)

### Phase 3: CI Workflow (P1 Priority)

1. Create `.github/workflows/demo.yml`:
   - Job 1: Regenerate docs/data/ from scripts
   - Job 2: Diff check (fail if git diff non-empty)
   - Job 3: Serve docs/ from subpath, curl all assets, verify zero 404s
   - Trigger: PRs touching scripts/generate-*, extension/ui/*, docs/**

2. Add size cap check:
   - Calculate docs/ directory size
   - Fail if > 50 MB

### Phase 4: Tests (P2 Priority)

1. Create `tests/demo/test_synthetic_data.py`:
   - Schema validation for all generated JSON
   - Date range coverage verification
   - Entity count verification

2. Create `tests/demo/test_regeneration.py`:
   - Generate twice, assert byte-identical output
   - Cross-platform determinism check (CI matrix)

3. Create `tests/demo/test_base_path.py`:
   - Start local HTTP server
   - Fetch all assets, verify 200 status
   - Verify no console errors in headless browser

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Float precision differences across platforms | Round to 3 decimals; use Decimal for intermediate calculations |
| JSON key ordering differences | Use `json.dumps(sort_keys=True)` exclusively |
| Timestamp timezone issues | Generate all timestamps as UTC with Z suffix |
| Large file size from 260 weekly rollups | Estimate: 260 × 2KB ≈ 520KB; well under 50MB cap |
| Dashboard SDK errors in local mode | Existing local mode code handles this; VSS.SDK bundled locally |

## Acceptance Verification

Before PR merge:
- [ ] `python scripts/generate-demo-data.py && git diff --exit-code docs/data/` passes
- [ ] All JSON files pass schema validation
- [ ] docs/ size < 50 MB
- [ ] Local server test: zero 404s for all assets
- [ ] Dashboard renders with charts and data in browser
- [ ] Synthetic data banner visible
- [ ] Predictions and AI Insights tabs functional
