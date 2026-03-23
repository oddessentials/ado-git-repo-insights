# Quickstart: Dashboard UX Polish

**Branch**: `036-dashboard-ux-polish`

## Setup

```bash
git checkout 036-dashboard-ux-polish
pip install -e .[dev]
cd extension && pnpm install && cd ..
```

## Key Files to Edit

### CSS (single file)
- `extension/ui/styles.css` — All styling changes: filter-hint rules, touch targets, mobile breakpoint, print styles, button states, truncation indicator restyle, tab animation

### TypeScript (chart rendering)
- `extension/ui/modules/charts/throughput.ts` — Label thinning algorithm, `MAX_VISIBLE_LABELS` constant
- `extension/ui/modules/charts.ts` — Tooltip tap/click handler, `SCROLL_CANCEL_THRESHOLD` constant
- `extension/ui/modules/charts/predictions.ts` — Truncation badge for predictions
- `extension/ui/modules/ml.ts` — Truncation badge for sparklines

### TypeScript (dashboard integration)
- `extension/ui/dashboard.ts` — Filter hint warning class toggle, contextual empty-state messages

### HTML (minimal changes)
- `extension/ui/index.html` — ARIA attributes on tab buttons (role="tab", aria-selected, aria-controls)

### Tests (new + modified)
- `extension/tests/unit/css-contract.test.ts` — New: stylesheet rule existence assertions
- `extension/tests/modules/charts/throughput.test.ts` — Modified: label thinning assertions
- `extension/tests/modules/charts/tooltip.test.ts` — New: tap/click tooltip behavior
- `extension/tests/unit/touch-target-contract.test.ts` — New: touch target size constants
- `extension/tests/unit/ux-polish-rendering.test.ts` — New: filter hint, empty states, truncation

## Build & Test

```bash
# Extension build
cd extension && pnpm build:ui && cd ..

# Extension tests
cd extension && pnpm test && cd ..

# Sync UI bundle to CLI
python -c "from ado_git_repo_insights.utils.ui_sync import sync_ui_bundle; sync_ui_bundle()"

# Demo parity verification
python scripts/build-demo-dataset.py
pytest tests/demo/ -v

# Full preflight
python scripts/run_pr_preflight.py
```

## Verification Checklist

1. `pnpm test` — all extension tests pass (including new CSS contract tests)
2. `pytest tests/demo/ -v` — demo parity pipeline passes
3. `python scripts/build-demo-dataset.py` — demo regeneration is byte-identical
4. Load `docs/index.html` in browser at 375px width — no horizontal overflow
5. Load `docs/index.html` with 104-week dataset — labels are thinned, truncation prominent
6. Print preview — interactive chrome hidden, analytical context preserved
