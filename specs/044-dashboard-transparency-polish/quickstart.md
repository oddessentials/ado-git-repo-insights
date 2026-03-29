# Quickstart: 044 Dashboard Transparency Polish

**Date**: 2026-03-29
**Branch**: `044-dashboard-transparency-polish`

## Prerequisites

- Node.js 18+ with pnpm
- Python 3.10+ (for backend tests)
- Git hooks installed (`pnpm run prepare` in extension/)

## Development Workflow

```bash
# Switch to feature branch
git checkout 044-dashboard-transparency-polish

# Install dependencies
cd extension && pnpm install

# Run tests (watch mode)
pnpm run test -- --watch

# Run full CI check locally
pnpm run test:ci

# Build UI bundle
pnpm run build

# Lint TypeScript
pnpm run lint:tests
```

## Key Files to Modify

### Phase 1: Data Transparency (AC1-4)

| File | Change |
|------|--------|
| `extension/ui/modules/metrics.ts` | Add reviewTimeP50/P90 to CalculatedMetrics + extractSparklineData |
| `extension/ui/modules/charts.ts` | Add SPARKLINE_LOOKBACK_WEEKS constant + getLookbackWeekCount() |
| `extension/ui/modules/charts/summary-cards.ts` | Add sample size subtitle, sparkline labels, review time metrics, METRIC_EXPLANATIONS entries |
| `extension/ui/modules/charts/reviewer-activity.ts` | Add approval_rate rendering when reviewerFilterActive |
| `extension/ui/index.html` | Add review time metric card containers (if needed) |
| `extension/ui/styles.css` | Add .metric-sample-size, .sparkline-label styles |

### Phase 2: Visual Polish (AC5-7)

| File | Change |
|------|--------|
| `extension/ui/modules/charts/cycle-time.ts` | Add BUCKET_COLOR_MAP, apply bucket-fast/moderate/slow classes |
| `extension/ui/styles.css` | Add bucket color rules, update .dimmed opacity to 0.55, restyle .truncation-indicator |
| `extension/ui/modules/charts/throughput.ts` | Add .truncation-badge class to indicator |
| `extension/ui/modules/charts/reviewer-activity.ts` | Add .truncation-badge class to indicator |

### Phase 3: Component Extraction (AC8)

| File | Change |
|------|--------|
| `extension/ui/modules/shared/horizontal-bar.ts` | NEW — extracted bar rendering |
| `extension/ui/modules/shared/svg-path.ts` | NEW — extracted SVG path generation |
| `extension/ui/modules/shared/label-decimator.ts` | NEW — extracted label thinning |
| `extension/ui/modules/shared/constants.ts` | NEW — MOBILE_BREAKPOINT and other shared constants |

### Tests

| File | Change |
|------|--------|
| `extension/tests/modules/metrics.test.ts` | Add reviewTimeP50/P90 calculation tests |
| `extension/tests/modules/charts/summary-cards.test.ts` | Add sample size, sparkline labels, review time tests |
| `extension/tests/modules/charts/reviewer-activity.test.ts` | Add approval_rate conditional rendering tests |
| `extension/tests/modules/charts/cycle-time.test.ts` | Add bucket color class tests |
| `extension/tests/parity/render-equivalence.test.ts` | Extend with new component parity tests |
| `extension/tests/unit/ux-polish-rendering.test.ts` | Extend truncation badge, opacity tests |

## Validation Commands

```bash
# All tests
cd extension && pnpm run test

# Specific test file
pnpm run test -- --testNamePattern="summary-cards"

# Type checking
pnpm run test:types

# Full CI gate
pnpm run test:ci

# Python backend tests (from repo root)
cd src && pytest && ruff check .
```
