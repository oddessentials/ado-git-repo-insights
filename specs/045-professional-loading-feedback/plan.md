# Implementation Plan: Professional Dashboard Loading Feedback

**Branch**: `045-professional-loading-feedback` | **Date**: 2026-03-29 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/045-professional-loading-feedback/spec.md`

## Summary

Add a single-source-of-truth refresh-cycle loading state to the Metrics tab so that every user-triggered data reload (filter, date range, comparison toggle) produces consistent visual feedback, supersedes stale in-flight requests, and clears deterministically on success or failure. The loading state is one dashboard-level boolean that drives per-region CSS presentation (dimming + optional spinner). A no-op guard prevents false loading flashes when the effective state hasn't changed.

## Technical Context

**Language/Version**: TypeScript 5.x (extension UI)
**Primary Dependencies**: esbuild (IIFE bundler), vanilla DOM (no framework), `renderTrustedHtml` + `escapeHtml` (safe HTML pipeline)
**Storage**: N/A (reads JSON aggregates from dataset-loader/artifact-client, no writes)
**Testing**: Jest 30 (extension tests), ts-jest transformer, Playwright smoke tests
**Target Platform**: Azure DevOps extension webview (VS Code webview compatibility)
**Project Type**: Browser extension UI (embedded dashboard)
**Performance Goals**: Zero layout shift, CSS-only animations (GPU-composited `opacity` + `transform`), no main-thread animation loops
**Constraints**: Security invariants (no innerHTML with variable interpolation), ESLint zero-warnings, tsc strict mode, pre-commit hooks (ui-bundle-sync, tsc, ESLint), pre-push (Jest, smoke, build)
**Scale/Scope**: 5 chart regions (summary cards + 4 chart containers), 7 summary card elements, single Metrics tab scope

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Requirement | Status | Evidence / Plan |
|------|-------------|--------|----------------|
| QG-17 | Lint + format checks pass | WILL SATISFY | All new TS code passes ESLint zero-warnings + tsc strict. Pre-commit hooks enforce. |
| QG-18 | Type checking passes | WILL SATISFY | New module fully typed, no `any`, no `!` assertions. |
| QG-19 | Unit + integration tests pass | WILL SATISFY | 5 required behavioral tests defined in spec. |
| QG-20 | Coverage threshold enforced | WILL SATISFY | New module will have full test coverage for loading state machine. |
| QG-28 | Dashboard renders 156 weeks in < 1000ms | WILL SATISFY | Loading state adds only CSS class toggle + 1 DOM element per region. No computation overhead. |
| QG-29 | Chart data caps enforced | NOT AFFECTED | Loading state does not change chart data or rendering logic. |
| QG-30 | CLI and extension dashboards use one shared UI bundle | WILL SATISFY | Loading module uses shared render.ts utilities. Bundle sync handled by pre-commit hook. |
| QG-35 | Every CI check has local equivalent | NOT AFFECTED | No new CI checks added. |
| QG-36 | No weaker local modes | NOT AFFECTED | Existing gates unchanged. |
| QG-37 | New CI checks require local gate | NOT AFFECTED | No new CI checks. |
| QG-38 | --no-verify forbidden | WILL SATISFY | All commits through hooks. |

**Gate Status: ALL SATISFIED or NOT AFFECTED. No violations.**

## Project Structure

### Documentation (this feature)

```text
specs/045-professional-loading-feedback/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```text
extension/
├── ui/
│   ├── dashboard.ts              # MODIFY: Wire loading state into refreshMetrics(), add no-op guard
│   ├── styles.css                # MODIFY: Add .metrics-loading overlay + reduced-motion styles
│   ├── index.html                # MODIFY: Add aria-live region element
│   └── modules/
│       ├── shared/
│       │   └── render.ts         # NO CHANGE (reuse createElement, clearElement)
│       └── loading-state.ts      # NEW: Refresh cycle state machine + DOM helpers
└── tests/
    └── unit/
        └── loading-state.test.ts # NEW: 5 required behavioral tests
```

**Structure Decision**: Single new module `loading-state.ts` in `modules/` alongside existing module pattern. No new directories. Test file follows existing `extension/tests/unit/` convention.

## Complexity Tracking

No violations to justify. Feature adds one new module with a simple state machine (boolean + counter/token). No new abstractions, patterns, or dependencies.
