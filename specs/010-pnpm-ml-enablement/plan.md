# Implementation Plan: Enable ML Features & Migrate to pnpm

**Branch**: `010-pnpm-ml-enablement` | **Date**: 2026-01-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/010-pnpm-ml-enablement/spec.md`

## Summary

This feature enables the already-implemented Predictions and AI Insights dashboard tabs (currently hidden behind CSS and feature flags) while simultaneously migrating the project from npm to pnpm as the enforced package manager. The ML features require implementing a 5-state gating contract for artifact validation, while the pnpm migration requires CI enforcement with Corepack and frozen-lockfile policies.

## Technical Context

**Language/Version**: TypeScript 5.7.3 (extension), Python 3.10+ (backend)
**Primary Dependencies**: Jest 30.0.0, esbuild 0.27.0, vss-web-extension-sdk 5.141.0, pnpm 9.x
**Storage**: JSON artifacts (`predictions/trends.json`, `ai_insights/summary.json`) from pipeline
**Testing**: Jest (TypeScript), pytest (Python)
**Target Platform**: Azure DevOps Extension (browser), GitHub Actions CI
**Project Type**: Hybrid (TypeScript extension + Python backend)
**Performance Goals**: Dashboard renders ML tabs in <100ms, state resolution in <10ms
**Constraints**: No npm artifacts in repo, CI must enforce pnpm-only, OpenAI data never logged
**Scale/Scope**: Single extension package, ~50 TypeScript files affected

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| XIX. PAT Secrecy | ✅ COMPLIANT | Extends to OpenAI keys per FR-021/FR-022 |
| XVIII. Actionable Failure Logs | ✅ COMPLIANT | 5-state error system with specific messages (FR-010) |
| XVII. Cross-Agent Compatibility | ✅ COMPLIANT | pnpm + Corepack supported on hosted/self-hosted agents |
| XXIII. Automated Contract Validation | ✅ COMPLIANT | Schema version validation added (FR-012) |
| XXIV. E2E Testability | ✅ COMPLIANT | Integration tests for artifact paths (FR-036/FR-037) |
| QG-16. Secrets Never Logged | ✅ COMPLIANT | Extended to OpenAI keys/bodies (FR-021/FR-022) |
| QG-17. Lint/Format Checks | ⚠️ UPDATE NEEDED | CI must update npm → pnpm commands |
| QG-19. Tests Pass | ⚠️ UPDATE NEEDED | CI must use pnpm test commands |

**Gate Status**: PASS with required CI updates

## Project Structure

### Documentation (this feature)

```text
specs/010-pnpm-ml-enablement/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
extension/
├── ui/
│   ├── dashboard.ts         # UPDATE: Remove hidden class, add state machine
│   ├── index.html           # UPDATE: Remove hidden class from phase5-tabs
│   ├── modules/
│   │   ├── ml.ts            # UPDATE: State machine implementation
│   │   ├── ml/
│   │   │   ├── state-machine.ts    # NEW: Artifact gating state machine
│   │   │   ├── setup-guides.ts     # EXISTS: YAML snippets
│   │   │   └── types.ts            # EXISTS: ML type definitions
│   │   └── charts/
│   │       └── predictions.ts      # EXISTS: Chart rendering
│   ├── schemas/
│   │   ├── predictions.schema.ts   # EXISTS: Schema validation
│   │   └── insights.schema.ts      # NEW: Insights schema validation
│   └── types.ts             # UPDATE: Add state machine types
├── tests/
│   ├── schema/
│   │   ├── predictions.test.ts     # EXISTS: Add unsupported version tests
│   │   └── insights.test.ts        # NEW: Insights schema tests
│   ├── fixtures/
│   │   ├── predictions-invalid.json        # NEW: Malformed fixture
│   │   ├── predictions-unsupported-v.json  # NEW: Wrong version fixture
│   │   └── insights-invalid.json           # NEW: Malformed fixture
│   └── modules/
│       └── ml-state-machine.test.ts        # NEW: State machine tests
├── package.json         # UPDATE: Add packageManager field
└── pnpm-lock.yaml       # NEW: Replace package-lock.json

.github/workflows/
├── ci.yml               # UPDATE: npm → pnpm migration
└── release.yml          # UPDATE: npm → pnpm migration

.npmrc                   # NEW: pnpm enforcement config
```

**Structure Decision**: Extension-only modification with CI pipeline updates. No Python backend changes required (backend already generates artifacts).

## Complexity Tracking

No constitution violations requiring justification. All changes align with existing patterns.

---

## Phase 0: Research

### Research Tasks

1. **pnpm Corepack Integration**: Best practices for enabling Corepack in GitHub Actions and Azure DevOps
2. **State Machine Patterns**: TypeScript state machine patterns for UI component gating
3. **Schema Validation Boundaries**: Where to enforce schema_version validation (loader vs renderer)

### Consolidated Findings

See [research.md](./research.md) for detailed findings.

---

## Phase 1: Design

### State Machine Design

The ML artifact gating follows a strict 5-state machine per FR-001 through FR-004:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Artifact Load Flow                            │
│                                                                  │
│  [Start] ─→ File Exists? ─No─→ [setup-required]                 │
│              │                                                   │
│             Yes                                                  │
│              ↓                                                   │
│         JSON Valid? ─No─→ [invalid-artifact]                    │
│              │                                                   │
│             Yes                                                  │
│              ↓                                                   │
│     Required Fields? ─No─→ [invalid-artifact]                   │
│              │                                                   │
│             Yes                                                  │
│              ↓                                                   │
│  schema_version OK? ─No─→ [unsupported-schema]                  │
│              │                                                   │
│             Yes                                                  │
│              ↓                                                   │
│     Data Non-Empty? ─No─→ [no-data]                             │
│              │                                                   │
│             Yes                                                  │
│              ↓                                                   │
│         [ready] ─→ Render Charts/Cards                          │
└─────────────────────────────────────────────────────────────────┘
```

**Key Invariant**: First match wins. Once a state is resolved, no further checks run.

### CI Migration Design

```yaml
# GitHub Actions pnpm setup pattern
- uses: pnpm/action-setup@v4
  with:
    version: 9
- uses: actions/setup-node@v4
  with:
    node-version: '22'
    cache: 'pnpm'
- run: pnpm install --frozen-lockfile
```

### Artifacts

- [data-model.md](./data-model.md) - Entity definitions for ML artifacts
- [contracts/](./contracts/) - JSON schema contracts for predictions and insights
- [quickstart.md](./quickstart.md) - Developer setup guide for pnpm migration

---

## Constitution Re-Check (Post-Phase 1)

| Principle | Pre-Design | Post-Design | Notes |
|-----------|------------|-------------|-------|
| XIX. PAT Secrecy | ✅ | ✅ | OpenAI key handling documented in data-model |
| XVIII. Actionable Failure Logs | ✅ | ✅ | State machine provides specific error messages |
| XVII. Cross-Agent Compatibility | ✅ | ✅ | quickstart.md documents both GitHub Actions and Azure DevOps |
| XXIII. Automated Contract Validation | ✅ | ✅ | JSON schemas created in contracts/ |
| XXIV. E2E Testability | ✅ | ✅ | Integration test fixtures defined |
| QG-16. Secrets Never Logged | ✅ | ✅ | SEALED constraint in spec |
| QG-17. Lint/Format Checks | ⚠️ | ✅ DESIGNED | CI migration pattern documented |
| QG-19. Tests Pass | ⚠️ | ✅ DESIGNED | pnpm test commands in quickstart |

**Post-Design Gate Status**: PASS - All constitution checks satisfied

---

## Phase 2: Task Generation

Tasks will be generated by `/speckit.tasks` command. This plan is complete through Phase 1.

---

## Generated Artifacts Summary

| Artifact | Path | Status |
|----------|------|--------|
| Implementation Plan | `specs/010-pnpm-ml-enablement/plan.md` | ✅ Complete |
| Research Document | `specs/010-pnpm-ml-enablement/research.md` | ✅ Complete |
| Data Model | `specs/010-pnpm-ml-enablement/data-model.md` | ✅ Complete |
| Predictions Schema | `specs/010-pnpm-ml-enablement/contracts/predictions.schema.json` | ✅ Complete |
| Insights Schema | `specs/010-pnpm-ml-enablement/contracts/insights.schema.json` | ✅ Complete |
| Quickstart Guide | `specs/010-pnpm-ml-enablement/quickstart.md` | ✅ Complete |
| Agent Context | `CLAUDE.md` | ✅ Updated |
| Tasks | `specs/010-pnpm-ml-enablement/tasks.md` | ⏳ Pending `/speckit.tasks` |
