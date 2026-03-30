# Quickstart: Professional Dashboard Loading Feedback

## What This Feature Does

Adds visible loading feedback to the Metrics tab when user interactions (filter changes, date range changes, comparison toggle) trigger data reloads. Previously, the dashboard showed stale data with no indication that anything was updating.

## Key Files

| File | Role |
|------|------|
| `extension/ui/modules/loading-state.ts` | NEW — Refresh cycle state machine + DOM helpers |
| `extension/ui/dashboard.ts` | MODIFY — Wire loading state into refreshMetrics(), add no-op guard |
| `extension/ui/styles.css` | MODIFY — Add loading overlay CSS + reduced-motion styles |
| `extension/ui/index.html` | MODIFY — Add aria-live region element |
| `extension/tests/unit/loading-state.test.ts` | NEW — 5 required behavioral tests |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  User Interaction (filter / date / compare)             │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  No-Op Guard                     │
│  (compare EffectiveState)        │
│  Same? → return, no refresh      │
└──────────────┬───────────────────┘
               │ Changed
               ▼
┌──────────────────────────────────┐
│  RefreshCycle.start()            │
│  - Increment token               │
│  - Set active = true             │
│  - Apply .metrics-loading CSS    │
│  - Set aria-busy="true"          │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  refreshMetrics() [async]        │
│  - getWeeklyRollups()            │
│  - getDistributions()            │
│  - getPreviousPeriod() (compare) │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  Token Check                     │
│  Current token != my token?      │
│  → Discard results, return       │
│  Current token == my token?      │
│  → Render charts                 │
└──────────────┬───────────────────┘
               │ Winning refresh
               ▼
┌──────────────────────────────────┐
│  RefreshCycle.end()              │
│  - Set active = false            │
│  - Remove .metrics-loading CSS   │
│  - Remove aria-busy              │
│  - Announce via aria-live        │
└──────────────────────────────────┘
```

## How to Test

```bash
cd extension
pnpm test                    # All Jest tests including loading-state.test.ts
pnpm run build:check         # TypeScript type checking
pnpm run lint                # ESLint zero-warnings
```

## Key Constraints

- **Security**: All DOM construction uses `createElement()` / `clearElement()` from `render.ts`. No innerHTML with variables.
- **No shared state with bootstrap**: The initial `#loading-state` spinner is untouched. This feature only manages CSS classes on `#tab-metrics` children.
- **Single authority**: One refresh token controls everything — no per-region execution logic.
- **Reduced motion**: `@media (prefers-reduced-motion: reduce)` disables spinner animation, keeps static dimming.
