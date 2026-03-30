# Implementation Plan: Migrate from vss-web-extension-sdk to azure-devops-extension-sdk

**Branch**: `046-migrate-ado-sdk` | **Date**: 2026-03-30 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/046-migrate-ado-sdk/spec.md`

## Summary

Replace the deprecated `vss-web-extension-sdk` (v5.141.0) with `azure-devops-extension-sdk` + `azure-devops-extension-api`. The migration involves three breaking API changes (data service indirection, token format, callback→Promise pattern), an AMD→ESM module loading shift, and removal of the script-tag SDK loading pattern in favor of bundled imports. The `sdk.ts` abstraction layer absorbs most breaking changes, limiting consumer-side edits.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (extension), Python 3.14 (backend — not affected)
**Primary Dependencies**: `azure-devops-extension-sdk` (host handshake, auth, context), `azure-devops-extension-api` (REST clients, service IDs, data types), esbuild 0.27.4 (bundler)
**Storage**: Azure DevOps Extension Data Service (key/value + document collections, hosted by Microsoft)
**Testing**: Jest 30.3 + ts-jest 29.4 + jsdom, Playwright 1.58 (e2e)
**Target Platform**: Azure DevOps Services (cloud) — on-premises Server is out of scope
**Project Type**: Azure DevOps Extension (dashboard widget + settings page + pipeline task)
**Performance Goals**: Dashboard render < 1000ms (existing baseline)
**Constraints**: Zero new lint suppressions, zero new type assertions, strict TS mode, `--max-warnings=0`
**Scale/Scope**: ~13 files changed (5 production, 8 test/infrastructure)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

This migration affects the extension UI layer only. CSV, SQLite, PowerBI, persistence, extraction, and pipeline artifact gates are **not affected**.

| Gate | Requirement | Status | Evidence |
|------|-------------|--------|----------|
| QG-17 | Lint + format checks pass | MUST MAINTAIN | ESLint `--max-warnings=0`, ruff |
| QG-18 | Type checking passes | MUST MAINTAIN | `tsc --noEmit` with strict mode |
| QG-19 | Unit + integration tests pass | MUST MAINTAIN | Jest full suite, pytest |
| QG-20 | Coverage threshold enforced | MUST MAINTAIN | Tiered coverage thresholds in jest.config.ts |
| QG-22 | VSIX extension builds | MUST MAINTAIN | esbuild bundle + VSIX packaging |
| QG-35 | Every CI gate has local equivalent | MUST MAINTAIN | Pre-commit hooks |
| QG-36 | No weaker local mode | MUST MAINTAIN | Hook parity enforcement |
| QG-38 | `--no-verify` forbidden | MUST MAINTAIN | Project policy |

**All gates SATISFIED**: No violations. Migration does not introduce new architectural patterns or complexity beyond the SDK swap.

## Project Structure

### Documentation (this feature)

```text
specs/046-migrate-ado-sdk/
├── plan.md              # This file
├── research.md          # Phase 0: API mapping, breaking changes, decisions
├── data-model.md        # Phase 1: SDK abstraction type surface
├── quickstart.md        # Phase 1: Developer onboarding
├── contracts/           # Phase 1: SDK abstraction public interface contract
│   └── sdk-abstraction.md
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (files to modify)

```text
extension/
├── ui/
│   ├── modules/
│   │   └── sdk.ts              # REWRITE: Core SDK abstraction layer
│   ├── dashboard.ts            # UPDATE: 5 VSS call sites → use sdk.ts exports
│   ├── settings.ts             # UPDATE: 10 VSS call sites, replace VSS.require AMD pattern
│   ├── artifact-client.ts      # UPDATE: 2 VSS call sites (token format change)
│   ├── index.html              # UPDATE: Remove VSS.SDK.min.js script tag
│   └── settings.html           # UPDATE: Remove VSS.SDK.min.js script tag
├── tests/
│   ├── harness/
│   │   ├── vss-sdk-mock.ts     # REWRITE: New mock harness for replacement SDK
│   │   └── vss-sdk-mock.test.ts # REWRITE: Mock harness tests
│   ├── auth-pattern.test.ts    # UPDATE: Token format assertions
│   ├── sdk-bundling.test.ts    # REWRITE: Bundle verification assertions
│   └── modules/
│       └── sdk.test.ts         # UPDATE: Init/ready sequence assertions
├── scripts/
│   ├── copy-vss-sdk.mjs        # DELETE: No longer needed
│   └── bundle-ui.mjs           # UPDATE: Remove VSS.SDK.min.js from static files
├── package.json                # UPDATE: Swap dependencies
└── pnpm-lock.yaml              # REGENERATE
types/
└── vss.d.ts                    # DELETE: Replaced by SDK-provided types
```

**Structure Decision**: No new directories or files beyond what exists. The migration replaces in-place. The only new file is the contracts doc.

## Constitution Check — Post-Design Re-evaluation

After completing Phase 0 research and Phase 1 design, re-evaluating all applicable gates:

| Gate | Requirement | Post-Design Status | Evidence |
|------|-------------|-------------------|----------|
| QG-17 | Lint + format checks pass | SATISFIED | No new suppressions. ESM imports comply with `consistent-type-imports` rule. `no-explicit-any` satisfied — new SDK provides typed interfaces. |
| QG-18 | Type checking passes | SATISFIED | `types/vss.d.ts` deleted. Replacement types from `azure-devops-extension-sdk` and `azure-devops-extension-api` cover all usage. `IExtensionDataManager` provides typed `getValue<T>`/`setValue<T>`. |
| QG-19 | Unit + integration tests pass | SATISFIED | Mock harness rewrite covers all 6 SDK functions + data manager chain. Existing test scenarios preserved with updated internals. |
| QG-20 | Coverage threshold enforced | SATISFIED | No coverage reduction — same code paths, different SDK calls. `sdk.ts` rewrite maintains same branch count. |
| QG-22 | VSIX extension builds | SATISFIED | esbuild bundles new SDK imports into existing IIFE format. No format/target changes. `globalName` exports preserved. |
| QG-35 | Every CI gate has local equivalent | SATISFIED | No new CI checks added. Existing pre-commit hooks (tsc, ESLint, test) cover all changes. |
| QG-36 | No weaker local mode | SATISFIED | No enforcement level changes. |
| QG-38 | `--no-verify` forbidden | SATISFIED | Policy unchanged. |

**No violations. No complexity justifications needed.**

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `IWebContext` shape differs from old `WebContext` | Medium | High — breaks all context consumers | `sdk.ts` composes from `getHost()`/`getUser()`/`getTeamContext()` as fallback (R-08) |
| Data service two-step pattern introduces latency | Low | Medium — slower settings load | Both steps are local host-frame RPCs, not network calls. Monitor in smoke test. |
| esbuild tree-shaking fails for new SDK | Low | Low — larger bundle | Verify bundle size delta. New SDK is small (~15KB). |
| `ts-jest` incompatibility with new SDK types | Low | Medium — test failures | SDK types are standard TypeScript interfaces. No compiler API dependency. |
| `getClient()` import path differs from documented | Medium | Medium — build failure | Verify exact import at implementation; `azure-devops-extension-api` barrel export vs subpath. |
