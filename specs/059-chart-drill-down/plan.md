# Implementation Plan: Chart drill-down — Phase 1

**Branch**: `059-chart-drill-down` | **Date**: 2026-04-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/059-chart-drill-down/spec.md`

## Summary

Introduce a single shared right-side detail panel to the extension dashboard that answers "why did this happen?" for the four primary charts (throughput, cycle-time trend, reviewer activity, summary-card sparklines). Phase 1 consumes only aggregate data already present in weekly rollups; per-PR detail, bucket exploration, drag-zoom, and comparison-mode drill-down are deferred to issue #300. Implementation is front-end only: no pipeline, schema, or Python changes. The panel establishes the extension's first focus-trap + keyboard-activation pattern and defines an extensible section-type model so Phase 2 can add new section types without rewriting Phase 1 consumers.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (extension UI), Jest 30.x test runner, jsdom 28.x test environment.
**Primary Dependencies**: No new runtime dependencies. Reuses `extension/ui/modules/shared/{render,security,chart-layout,host-resize,svg-path}.ts` (shared primitives), `extension/ui/modules/tooltip-manager.ts` (overlay lifecycle pattern reference), `extension/ui/modules/typeahead-dropdown.ts` (combobox/listbox a11y pattern reference), `extension/ui/modules/charts/{throughput,cycle-time,reviewer-activity,summary-cards}.ts` (click target hosts).
**Storage**: N/A. Panel state is ephemeral per session view; nothing persists across reloads (FR-009). URL / localStorage are NOT touched by drill-down code.
**Testing**: Jest unit + behavioral tests under `extension/tests/`; render-equivalence parity test (`extension/tests/parity/render-equivalence.test.ts`, Layer A starts line 104) extended to cover DetailPanel idempotency; prod-shape edge cases (`extension/tests/parity/prod-shape-edge-cases.test.ts`) extended with empty-breakdown throughput week; partial-branches baseline co-change (`.coverage-partial-branches-baseline.json`); test-count floor bump in `.test-floor-contract.json` same commit.
**Target Platform**: Browser runtime (VS Code extension webview via `azure-devops-extension-sdk` SDK context, plus the same bundle served under CLI demo via `src/ado_git_repo_insights/ui_bundle/` sync and under `docs/` GitHub Pages demo). All three surfaces consume the one esbuild-bundled IIFE from `extension/dist/ui/`.
**Project Type**: Front-end feature inside a monorepo. No backend surface.
**Performance Goals**: Panel open must show contextual content within 1 s on desktop (SC-001). Existing dashboard render budget (QG-28: 156 weeks in < 1000 ms) MUST NOT regress; panel is on-demand, so initial dashboard load time is unaffected.
**Constraints**: 4-surface byte-identical parity for identical data inputs (SC-005); keyboard-only operable (SC-006); no pre-existing interaction regressions (SC-004); zero quality-floor drift at merge (SC-007); aggregate-data-only (SC-008); cross-OS — Windows, macOS, Linux (QG-39).
**Scale/Scope**: 1 shared panel + 4 chart consumers + 1 comparison-mode advisory. ~10 new source files in `extension/ui/`, corresponding Jest files, no Python code.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

**Pre-Phase-0 review** (covers constitution v1.5.0, 2026-04-16):

| Gate | Applicability | Compliance plan |
|------|---------------|-----------------|
| QG-17 / QG-18 / QG-19 / QG-20 (lint / type / tests / coverage) | Applies | New code lands through `pnpm --dir extension test:ci`; no weaker local modes. |
| QG-28 (156-week render < 1000 ms) | Applies — must not regress | Panel is on-demand; initial render path untouched. Add behavioral test that panel open on a 156-week dataset responds within 1 s. |
| QG-29 (MAX_*_POINTS caps enforced) | Applies | Panel consumes existing aggregate breakdowns only; no per-PR list rendering, no uncapped iteration. |
| QG-30 (shared UI bundle contract) | Applies | Drill-down code lives in `extension/ui/` and bundles via esbuild; propagates to `src/.../ui_bundle/` and `docs/data/` through existing sync paths. |
| QG-31 – QG-34 (demo parity) | Applies | `docs/` demo consumes the same bundle; demo parity tests are rerun in `pnpm test:ci` and preflight. |
| QG-35 – QG-38 (local / CI parity) | Applies | All new tests live in the existing `pnpm --dir extension test:ci` entry point, so local and CI invocations are identical by construction. No `--no-verify`. |
| QG-39 (cross-OS) | Applies | No OS-specific code; pure browser DOM + event APIs. |
| QG-40 (no `typing.Any`) | Applies to Python; N/A to this feature. TypeScript equivalent (`any`) is already banned project-wide. | Panel contract uses precise unions and discriminated types. |
| QG-41 (zero suppressions) | Applies | No `// eslint-disable`, `// @ts-ignore`, or `// type:ignore` introduced. |
| QG-42 (enterprise test coverage) | Applies | Spec-mapped Jest coverage per FR + SC (see Phase 1 contracts). |
| QG-43 – QG-46 (test-count floor, cross-OS parity, collection-stable) | Applies | Same-commit bump of `.test-floor-contract.json` `extension.min_collected` by exactly N. No platform-conditional Jest (extension tests are uniform). |
| QG-47 – QG-49 (entry-point alignment) | Applies | No new gate is introduced; all new tests flow through the existing authoritative `test:ci` script. |
| QG-50 – QG-52 (change acknowledgement, version guard, coverage delta) | Applies conditionally | Phase 1 does NOT bump any `SUPPORTED_*_VERSION` or `task.json` field; no `[version-override-acknowledged]` marker anticipated. Coverage delta stays within the 2% envelope by adding tests in the same commit as new code. |
| QG-53 – QG-55 (build architecture, Prettier) | Applies | `tsconfig.build.json` unchanged; `dist/ui/` remains esbuild-exclusive; Prettier invoked only via `format:check`. |
| QG-56 (gitleaks) | Applies | No new secrets; preflight runs gitleaks unchanged. |

**Core Principles I–XXVI**: drill-down is pure UI and does not touch CSV contract, persistence, extraction, or identity pathways. Principle XXVI (collection-stable tests) applies to Python, N/A for Jest.

**Verdict**: PASS — no violations, no complexity-tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/059-chart-drill-down/
├── plan.md                                 # This file (/speckit.plan)
├── research.md                             # Phase 0 decisions
├── data-model.md                           # Phase 1 entity + state model
├── quickstart.md                           # Phase 1 implementation walkthrough
├── contracts/
│   ├── detail-panel-api.md                 # DetailPanel module public TS contract
│   ├── drilldown-integration.md            # Per-chart onDataPointClick wiring contract
│   └── lifecycle-signals.md                # Cross-cutting filter / tab / comparison signals
├── checklists/
│   └── requirements.md                     # Already created by /speckit.specify
├── spec.md                                 # Feature specification (already written)
└── tasks.md                                # Phase 2 output (/speckit.tasks — NOT this command)
```

### Source code (repository root — concrete paths for this feature)

```text
extension/ui/
├── modules/
│   ├── shared/
│   │   ├── detail-panel.ts                 # NEW — shared right-side panel component
│   │   ├── focus-trap.ts                   # NEW — reusable keyboard focus trap
│   │   └── index.ts                        # MODIFIED — export new barrel entries
│   ├── drilldown/                          # NEW directory
│   │   ├── index.ts                        # NEW — barrel
│   │   ├── lifecycle-signals.ts            # NEW — emits filter / tab / comparison events
│   │   ├── comparison-advisory.ts          # NEW — disabled-mode UX cue
│   │   ├── throughput-drilldown.ts         # NEW — click wiring for .bar-container
│   │   ├── cycle-time-drilldown.ts         # NEW — click wiring for .line-chart-dot
│   │   ├── reviewer-drilldown.ts           # NEW — click wiring for .h-bar-row
│   │   └── sparkline-navigator.ts          # NEW — anchor-scroll + highlight
│   ├── charts/
│   │   ├── throughput.ts                   # MODIFIED — surface click-target data attributes
│   │   ├── cycle-time.ts                   # MODIFIED — surface click-target data attributes
│   │   ├── reviewer-activity.ts            # MODIFIED — add data attributes to .h-bar-row AND export computeApprovalRate for reuse by reviewer-drilldown.ts
│   │   └── summary-cards.ts                # MODIFIED — wrap each sparkline SVG in a <button class="sparkline-trigger"> for keyboard activation
│   └── charts.ts                           # UNCHANGED — utility module, not a router
├── dashboard.ts                            # MODIFIED — install drilldown wirers; emit lifecycle signals
├── styles.css                              # MODIFIED — panel / advisory / highlight rules
├── settings.ts                             # UNCHANGED (no chart rendering)
├── dataset-loader.ts                       # UNCHANGED
└── artifact-client.ts                      # UNCHANGED

extension/tests/
├── modules/
│   ├── shared/
│   │   ├── detail-panel.test.ts            # NEW — unit + a11y + parity coverage
│   │   └── focus-trap.test.ts              # NEW
│   └── drilldown/
│       ├── lifecycle-signals.test.ts       # NEW
│       ├── comparison-advisory.test.ts     # NEW
│       ├── throughput-drilldown.test.ts    # NEW
│       ├── cycle-time-drilldown.test.ts    # NEW
│       ├── reviewer-drilldown.test.ts      # NEW
│       └── sparkline-navigator.test.ts     # NEW
├── parity/
│   ├── render-equivalence.test.ts          # MODIFIED — add DetailPanel idempotency cases
│   └── prod-shape-edge-cases.test.ts       # MODIFIED — empty-breakdown + comparison edge

.test-floor-contract.json                   # MODIFIED — extension.min_collected bump (same commit as new tests)
.coverage-partial-branches-baseline.json    # CONDITIONALLY MODIFIED — co-change if partials shift
```

**No Python paths modified.** The Python-packaged `src/ado_git_repo_insights/ui_bundle/` copy is updated automatically by the pre-commit `sync_ui_bundle.py` step after esbuild produces new `extension/dist/ui/` artifacts. `docs/data/` demo-surface parity is refreshed via the existing `publish-demo-surface.py` path — no manual intervention.

**Structure Decision**: Front-end-only feature. New components land in two new namespaces under `extension/ui/modules/`: `shared/` gets the reusable `detail-panel.ts` + `focus-trap.ts`; a new `drilldown/` directory holds the per-chart glue (click-handler wiring, comparison advisory, lifecycle signals, sparkline navigator). Chart modules in `extension/ui/modules/charts/` are modified minimally — only to surface the data attributes the drill-down glue reads. `dashboard.ts` changes are limited to installing the drill-down wirers (after the existing render block at dashboard.ts:970-974), exporting `comparisonMode` state via `publishComparisonToggled` (in the two toggle helpers at dashboard.ts:1911/1930), and emitting lifecycle signals; no render logic moves. Chart render functions are imported into `dashboard.ts` with a local `*Module` alias convention — drill-down does not change that import shape and does not call the render functions directly (it attaches listeners to the already-rendered DOM).

## Complexity Tracking

> No violations found; section intentionally empty.

## Phases (executed by this command)

### Phase 0 — Research

See `research.md`. Five themes resolved:

- **R-01 Lifecycle signals**: introduce `extension/ui/modules/drilldown/lifecycle-signals.ts` to publish typed `CustomEvent`s — `drilldown:filters-changed`, `drilldown:tab-changed`, `drilldown:comparison-toggled` (canonical names per `contracts/lifecycle-signals.md`) — emitted from hooks inserted in `dashboard.ts`. Panel subscribes at open and unsubscribes on dismiss.
- **R-02 Click-target wiring**: reuse existing `.bar-container` and `.line-chart-dot` attributes; add `data-drilldown-*` attributes to `.h-bar-row`; introduce a keyboard-activatable wrapper around summary-card sparklines.
- **R-03 Focus management**: extract a `focus-trap.ts` helper built on existing `AbortController` idioms; on open, capture trigger element; on dismiss, restore focus.
- **R-04 Panel rendering contract**: single DOM root appended to `document.body`; content-section contract is a discriminated union (`{type: "breakdown-table"}`, `{type: "stat-row"}`) with an explicit extension point for future `pr-list` / `mini-chart` types.
- **R-05 Comparison-mode UX**: a per-surface disabled-indicator treatment on clickable chart elements (grayed interaction affordance + cursor change) plus an inline advisory rendered once inside a named comparison-banner region when comparison is first activated, explaining that drill-down is unavailable.

### Phase 1 — Design & Contracts

See `data-model.md`, `contracts/detail-panel-api.md`, `contracts/drilldown-integration.md`, `contracts/lifecycle-signals.md`, and `quickstart.md`.

**Entities documented in `data-model.md`**:
- `PanelContent` (title, subtitle?, sections: `PanelSection[]`)
- `PanelSection` discriminated union (`BreakdownTableSection`, `StatRowSection`, plus sealed-for-extension marker)
- `DrillDownContext` (sourceChart, focusedDataPoint metadata, triggerElement)
- `ComparisonModeAdvisoryState` (visible, copy variant)
- State diagrams for panel open → targeted → dismissed; comparison enable → drill-down disabled → comparison exit → drill-down restored.

**Contracts documented in `contracts/`**:
- `detail-panel-api.md` — public TS signatures for `openDetailPanel(context)`, `dismissDetailPanel(reason)`, `isDetailPanelOpen()`, and section builders.
- `drilldown-integration.md` — per-chart wiring obligations: required data attributes, click listener pattern, comparison-mode check, empty-state rendering.
- `lifecycle-signals.md` — emit-from-dashboard-only event contract; listener responsibilities; `AbortController` cleanup pattern.

**Post-design Constitution re-check**: no new violations introduced; the contracts enforce existing invariants (render-equivalence idempotency in `detail-panel-api.md`; single-authoritative `test:ci` entry point unchanged).

### Agent context update

After writing the plan artifacts, run `.specify/scripts/powershell/update-agent-context.ps1 -AgentType claude` to keep CLAUDE.md / agent context synchronized with Phase 1 additions.

## Output summary

- `research.md` — five decision records with rationale and alternatives.
- `data-model.md` — panel entity model + state diagrams.
- `contracts/detail-panel-api.md` — DetailPanel public TS contract.
- `contracts/drilldown-integration.md` — per-chart wiring contract.
- `contracts/lifecycle-signals.md` — dashboard → drill-down event contract.
- `quickstart.md` — implementation-walkthrough ordering, intended as the input to `/speckit.tasks`.
- `plan.md` — this file.

Constitution check: PASS (pre- and post-design). No complexity justifications required.

## References

- Feature spec: `specs/059-chart-drill-down/spec.md`
- Constitution: `.specify/memory/constitution.md` v1.5.0
- Parent issue: #205
- Deferred follow-up: #300
