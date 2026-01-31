# Research: GitHub Pages Demo Dashboard

**Feature**: 018-github-pages-demo
**Date**: 2026-01-30

## Research Topics

### R1: Local Mode Capability

**Question**: How does the existing dashboard support local/offline mode?

**Findings**:
- Dashboard has existing local mode via `window.LOCAL_DASHBOARD_MODE` global (sdk.ts:1-8)
- `window.DATASET_PATH` controls data directory location (sdk.ts:10-12)
- When in local mode, dashboard bypasses SDK initialization (dashboard.ts:563-581)
- Raw data download button is hidden in local mode (dashboard.ts:574-577)
- Configuration can be injected via HTML script tag before dashboard.js loads

**Decision**: Use existing `window.LOCAL_DASHBOARD_MODE` and `window.DATASET_PATH` globals
**Rationale**: Dashboard already supports local mode; no modification needed to core logic
**Alternatives Rejected**:
- Query parameter injection (`?dataset=...`) - requires URL manipulation, less clean for static hosting
- New build target with embedded config - unnecessary complexity when globals work

---

### R2: Deterministic GUID Generation

**Question**: How to generate stable, reproducible GUIDs for synthetic entities?

**Findings**:
- Python `uuid.uuid5(namespace, name)` produces deterministic UUIDs
- DNS namespace `6ba7b810-9dad-11d1-80b4-00c04fd430c8` is standard
- Same namespace+name always produces same UUID across Python versions
- ADO uses standard UUID format for repository_id, user_id

**Decision**: Use UUID v5 with DNS namespace and deterministic name strings
**Rationale**: UUID v5 is deterministic given same namespace+name; cross-platform stable
**Alternatives Rejected**:
- UUID v4 (random) - not deterministic, fails FR-001
- Sequential integers - not realistic for ADO entity IDs
- Hash-based IDs - less recognizable as UUIDs in debugging

---

### R3: Cycle Time Distribution Model

**Question**: What statistical model produces realistic PR cycle time data?

**Findings**:
- Real-world PR cycle times follow log-normal distribution
- Empirical studies show P50 ≈ 4-8 hours, P90 ≈ 24-72 hours
- Log-normal with μ=6.0 (log-minutes), σ=1.5 yields:
  - P50 ≈ 400 minutes (6.7 hours)
  - P90 ≈ 3000 minutes (50 hours)
- Python `random.lognormvariate(mu, sigma)` is seeded deterministically

**Decision**: Log-normal distribution with μ=6.0, σ=1.5
**Rationale**: Matches empirical PR merge time distributions; no negative values
**Alternatives Rejected**:
- Normal distribution - produces negative values, unrealistic
- Uniform distribution - lacks realistic long-tail behavior
- Exponential distribution - doesn't match bimodal quick/slow pattern

---

### R4: Seasonal Variation Model

**Question**: How to create believable weekly PR count variation?

**Findings**:
- Real teams show ~20-30% lower activity in December, higher in Q1/Q3
- Sinusoidal wave with period=52 weeks models annual cycle
- Phase shift aligns trough with week 52 (late December)
- Additional weekly noise (±10%) adds realism

**Decision**: Sinusoidal adjustment with period=52 weeks, amplitude=±20%, phase shift for December trough
**Rationale**: Simple, deterministic, produces believable weekly variation
**Alternatives Rejected**:
- Random walk - not deterministic across runs
- Empirical historical data - breaks synthetic-only requirement
- Flat baseline - unrealistic, fails to demonstrate trend capabilities

---

### R5: Rule-Based Insights Templates

**Question**: How to generate AI-style insights without LLM calls?

**Findings**:
- Insights schema requires: id, category (bottleneck/trend/anomaly), severity, title, description
- Rules can be threshold-based on aggregate metrics:
  - Bottleneck: P90 cycle time > 2x P50 for specific repo
  - Trend: Week-over-week throughput change > 20%
  - Anomaly: PR count > 2 std dev from rolling average
- Template strings with metric interpolation produce natural descriptions

**Decision**: 8 insight templates covering bottleneck (2), trend (3), anomaly (3) categories
**Rationale**: Templates with threshold-based triggering are fully deterministic
**Alternatives Rejected**:
- LLM generation - explicitly forbidden by FR-008
- Static hardcoded insights - doesn't demonstrate dynamic feature
- Random selection - non-deterministic

---

### R6: Base Path Configuration

**Question**: How to ensure assets load correctly when served from /docs/?

**Findings**:
- GitHub Pages serves repo `/docs` folder at `https://<user>.github.io/<repo>/`
- All asset paths must be relative or use `<base href>`
- `<base href="./">` makes all relative URLs resolve from current directory
- DatasetLoader already uses relative paths (`./data/`)

**Decision**: Inject `<base href="./">` in index.html; all asset paths relative
**Rationale**: HTML `<base>` element provides cleanest solution for subpath serving
**Alternatives Rejected**:
- Absolute paths - breaks on different hosting domains
- Build-time path rewriting - adds complexity to existing build
- Query parameter for base path - fragile, requires URL parsing

---

### R7: CI Validation Approach

**Question**: How to enforce deterministic regeneration in CI?

**Findings**:
- `git diff --exit-code` returns non-zero if any changes detected
- GitHub Actions can run Python scripts with pinned versions
- Parallel jobs allow regenerate + validate + serve to run efficiently
- Path filters prevent unnecessary runs on unrelated changes

**Decision**: GitHub Actions workflow with three jobs: regenerate, diff-check, base-path-serve
**Rationale**: Separate jobs allow parallel execution and clear failure attribution
**Alternatives Rejected**:
- Single monolithic job - harder to diagnose failures
- Pre-commit hook only - doesn't catch CI environment differences
- Manual verification - violates SC-009 non-bypassable requirement

---

### R8: Tooling Version Pinning Strategy

**Question**: Which versions to pin for cross-platform reproducibility?

**Findings**:
- Python 3.11 is stable, widely available, matches CI matrix
- pnpm 9.15.0 already enforced via packageManager field
- Node 22 is current LTS, matches CI
- esbuild 0.27.0 already pinned in devDependencies
- Float formatting differences exist between Python versions (3.10 vs 3.11)

**Decision**: Pin Python 3.11, Node 22, pnpm 9.15.0, esbuild 0.27.0
**Rationale**: Matches existing CI environment; minimizes compatibility issues
**Alternatives Rejected**:
- Latest versions - risk of breaking changes
- Multiple version support - increases test matrix complexity
- No pinning - violates FR-021

---

## Summary

All NEEDS CLARIFICATION items from Technical Context are now resolved. Key decisions:

1. **Local Mode**: Use existing dashboard globals, no core changes needed
2. **Determinism**: UUID v5, log-normal with seed=42, canonical JSON
3. **Insights**: 8 rule-based templates, no LLM calls
4. **Hosting**: `<base href="./">`, relative paths throughout
5. **CI**: Non-bypassable three-job workflow with pinned tooling
