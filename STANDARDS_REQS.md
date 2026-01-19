# Enterprise TypeScript Conversion & Standards Alignment Plan

## Goals

- Convert all JavaScript sources (application, scripts, tests) to TypeScript.
- Enable TypeScript `strict` mode across the codebase.
- Align tooling with enterprise-grade standards and enforce consistency.

## Scope

- **Extension UI**: `extension/ui/**/*.js`
- **Extension tests**: `extension/tests/**/*.js`
- **Extension tasks/scripts**: `extension/tasks/**/*.js`, `extension/scripts/**/*.js`
- **Root scripts**: `scripts/**/*.js`
- **UI bundle sources**: `src/ado_git_repo_insights/ui_bundle/**/*.js` (confirm if these are generated artifacts; if generated, convert the source-of-truth and adjust the build pipeline to emit TS-compiled JS bundles).

## Implementation Phases

1. **Tooling Baseline**
    - Introduce TypeScript configuration with `strict: true`.
    - Establish a single root `tsconfig.json` and project references where needed (e.g., `extension/`, `scripts/`).
    - Add shared type definitions for global SDKs (e.g., `VSS`) using `types/` declarations.

2. **Incremental Conversion Strategy**
    - Convert leaf modules first (utility files) to TypeScript.
    - Migrate UI modules next, adding explicit types for DOM access, SDK calls, and API responses.
    - Convert tests to `*.test.ts` and update Jest configuration to support TS (e.g., `ts-jest` or Babel).
    - Convert task scripts and root automation scripts to `*.ts`, updating runtime invocation to use compiled outputs.

3. **Strictness & Quality Gates**
    - Enable `noImplicitAny`, `strictNullChecks`, and `noUncheckedIndexedAccess`.
    - Add linting for TypeScript (ESLint + `@typescript-eslint`) with zero-warning policy.
    - Add `tsc --noEmit` to CI to enforce type safety.

4. **Build & Packaging Alignment**
    - Ensure the extension build pipeline compiles TS to JS bundles expected by Azure DevOps.
    - If `src/ado_git_repo_insights/ui_bundle` is generated, update its generator to emit from TS sources.

5. **Repository Standards Verification**
    - Install and execute `@oddessentials/repo-standards` checks.
    - Track compliance gaps and remediate within the same iteration.

## Current Blockers

1. **Install and run `@oddessentials/repo-standards`**
    - **Reason**: The npm registry call to fetch `@oddessentials/repo-standards` failed with `403 Forbidden` in this environment, indicating policy/registry access restrictions.
    - **Impact**: Unable to confirm the latest package version or execute the repo standards checks.
    - **Next Step**: Re-run `npm view @oddessentials/repo-standards version` and `npm install -D @oddessentials/repo-standards@latest` with registry access, then execute the package’s compliance commands.

2. **Full JS → TS refactor and strict type enforcement**
    - **Reason**: The repository currently lacks TypeScript tooling (tsconfig, build pipeline, and test transformers). Attempts to install `typescript` and `@types/node` failed with `403 Forbidden` due to restricted registry access. A complete conversion requires coordinated build updates and test configuration changes that should be validated in CI to avoid breaking the extension packaging flow.
    - **Impact**: Source files remain JavaScript until tooling and pipelines are prepared for strict TypeScript compilation.
    - **Next Step**: Execute the plan in this document, starting with tooling setup and incremental migration under strict mode.

## Acceptance Criteria

- All JavaScript sources are replaced with TypeScript counterparts.
- `tsc --noEmit` passes under `strict` settings.
- Linting passes with TypeScript rules enabled.
- Repo standards checks complete successfully.

## Deliverables

- TypeScript configuration and type declaration files.
- Migrated TypeScript codebase.
- CI checks for type safety and linting.
- Standards compliance report/logs.
