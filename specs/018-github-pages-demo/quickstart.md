# Quickstart: GitHub Pages Demo Dashboard

**Feature**: 018-github-pages-demo
**Date**: 2026-01-30

## Overview

This guide explains how to build, test, and deploy the GitHub Pages demo dashboard with synthetic data.

## Prerequisites

- Python 3.11+ (for data generation)
- Node.js 22+ (for dashboard build)
- pnpm 9.15.0 (enforced via packageManager)

## Quick Commands

### Generate Synthetic Data

```bash
# Generate all demo data (deterministic, seed=42)
python scripts/generate-demo-data.py
python scripts/generate-demo-predictions.py
python scripts/generate-demo-insights.py

# Verify byte-identical output (run all three again)
python scripts/generate-demo-data.py && \
python scripts/generate-demo-predictions.py && \
python scripts/generate-demo-insights.py && \
git diff --exit-code docs/data/
```

### Build Dashboard

```bash
# Build extension UI bundles
cd extension && pnpm install && pnpm build

# Build demo (copies bundles + injects config)
./scripts/build-demo.sh
```

### Local Preview

```bash
# Serve docs/ on local server
cd docs && python -m http.server 8080

# Open browser
open http://localhost:8080
```

### Validate

```bash
# Run all demo tests (schema validation, entity counts, regeneration)
pytest tests/demo/ -v --no-cov

# Check size cap (should be < 50 MB)
du -sh docs/
# Current: ~1.6 MB
```

## Directory Structure

After running all commands:

```
docs/
├── index.html              # Dashboard with local mode config + banner
├── dashboard.js            # Main IIFE bundle
├── dataset-loader.js       # Data loading bundle
├── artifact-client.js      # Client bundle (auth-free mode)
├── error-types.js          # Error types bundle
├── error-codes.js          # Error codes bundle
├── styles.css              # Dashboard styling
├── VSS.SDK.min.js          # Azure DevOps SDK
└── data/                   # Synthetic dataset
    ├── dataset-manifest.json
    ├── aggregates/
    │   ├── dimensions.json
    │   ├── weekly_rollups/  # 260 files
    │   └── distributions/   # 5 files
    ├── predictions/
    │   └── trends.json
    └── insights/
        └── summary.json
```

## CI Workflow

The `.github/workflows/demo.yml` workflow runs on every PR that touches:
- `scripts/generate-*`
- `extension/ui/**`
- `docs/**`

### Jobs

1. **regenerate**: Runs all three generators (data, predictions, insights)
2. **diff-check**: Verifies git diff is empty after regeneration (non-bypassable)
3. **size-check**: Verifies docs/ directory < 50 MB
4. **base-path-serve**: Serves docs/, curls all assets, verifies 200 status
5. **pytest**: Runs tests/demo/ test suite

### Local CI Simulation

```bash
# Run the full regeneration and verification
python scripts/generate-demo-data.py && \
python scripts/generate-demo-predictions.py && \
python scripts/generate-demo-insights.py && \
git diff --exit-code docs/data/

# Run tests
pytest tests/demo/ -v --no-cov
```

## Troubleshooting

### "git diff not empty after regeneration"

Possible causes:
- Python version mismatch (must be 3.11)
- Different random seed
- Float precision differences

Fix: Ensure Python 3.11 and run `python scripts/generate-demo-data.py` to regenerate.

### "JSON schema validation failed"

Check the error output for which file/field failed. Common issues:
- Missing required field
- Wrong data type
- Enum value not in allowed set

### "404 errors in serve test"

Check that all asset paths in index.html are relative. Verify `<base href="./">` is present.

### "Size cap exceeded"

Weekly rollups are the largest component. If >50MB:
- Check for duplicate data
- Verify only aggregates are included (no raw PR data)

## Development Workflow

1. **Modify data generation**: Edit `scripts/generate-demo-data.py`
2. **Regenerate**: `python scripts/generate-demo-data.py`
3. **Test locally**: `cd docs && python -m http.server 8080`
4. **Run tests**: `pytest tests/demo/`
5. **Commit**: Data files are tracked in git (committed to docs/data/)

## Deployment

GitHub Pages is configured to serve from `/docs` on `main` branch.

1. Merge PR to main
2. GitHub Actions builds and validates
3. GitHub Pages automatically deploys from docs/
4. Demo available at `https://<org>.github.io/<repo>/`

## Configuration

### Synthetic Data Parameters

Located in `scripts/generate-demo-data.py`:

| Parameter | Default | Description |
|-----------|---------|-------------|
| SEED | 42 | Random seed for determinism |
| START_WEEK | 2021-W01 | First week of data |
| END_WEEK | 2025-W52 | Last week of data |
| NUM_ORGS | 3 | Organization count |
| NUM_PROJECTS | 8 | Project count |
| NUM_REPOS | 20 | Repository count |
| NUM_USERS | 50 | User count |

### Dashboard Local Mode

Injected into `docs/index.html`:

```html
<script>
  window.LOCAL_DASHBOARD_MODE = true;
  window.DATASET_PATH = "./data";
</script>
```

## Related Documentation

- [Feature Spec](./spec.md) - Requirements and success criteria
- [Implementation Plan](./plan.md) - Technical approach
- [Data Model](./data-model.md) - Entity definitions
- [Contracts](./contracts/README.md) - JSON schema references
