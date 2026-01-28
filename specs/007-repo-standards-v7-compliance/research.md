# Research: Repository Standards v7.1.1 Compliance

**Date**: 2026-01-28
**Feature**: 007-repo-standards-v7-compliance

## Research Tasks Completed

### 1. Current Package Version Analysis

**Question**: What version of @oddessentials/repo-standards is currently installed?

**Findings**:
- Current version: 6.0.0
- Target version: 7.1.1
- Schema migration: v6 → v7

**Decision**: Upgrade package to ^7.1.1
**Rationale**: Direct upgrade path exists, no intermediate versions required

### 2. TypeScript Strictness Compatibility

**Question**: Will enabling `noUnusedLocals` and `noUnusedParameters` cause compilation errors?

**Findings**:
- Ran `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` in extension directory
- Result: **No errors** - clean compilation
- The codebase already follows best practices for unused parameters (uses `_` prefix convention)

**Decision**: Enable both flags in all tsconfig files
**Rationale**: No code changes required, immediate compliance
**Alternatives Considered**: None needed - clean path

### 3. ESLint Security Plugin Compatibility

**Question**: Is eslint-plugin-security compatible with ESLint v9 flat config?

**Findings**:
- Current ESLint version: 9.18.0
- Current config format: Flat config (eslint.config.mjs)
- eslint-plugin-security v3.x supports flat config via `security.configs.recommended`
- Plugin not currently installed

**Decision**: Install eslint-plugin-security@^3.0.0
**Rationale**: Full compatibility with existing ESLint setup
**Alternatives Considered**:
- @eslint/security: Not mature enough
- Custom rules: Unnecessary when standard plugin available

### 4. Coverage Threshold Analysis

**Question**: What is the current TypeScript test coverage?

**Findings**:
| Metric | Current Value |
|--------|---------------|
| Statements | 42.47% |
| Branches | 36.22% |
| Functions | 47.03% |
| Lines | 43.21% |

**Gap to 70% Threshold**:
- Would require adding ~600+ lines of new test code
- Significant effort that should not block compliance upgrade

**Decision**: Implement coverage threshold with current levels initially (~40%)
**Rationale**:
- Prevents blocking the compliance upgrade
- Creates foundation for incremental improvement
- Establishes enforcement mechanism
**Alternatives Considered**:
- 70% immediately: Too risky, blocks compliance
- No threshold: Violates v7.1.1 requirements

### 5. Pre-push Hook Structure

**Question**: Where should ESLint check be added in pre-push hook?

**Findings**:
- Current pre-push order:
  1. Baseline integrity check
  2. Python tests
  3. TypeScript type check
  4. Extension tests
- CI runs ESLint in `extension-tests` job

**Decision**: Add ESLint after TypeScript type check, before extension tests
**Rationale**: Mirrors CI ordering, fails fast on lint errors before slower test run
**Alternatives Considered**:
- Before type check: Type check is faster, should run first
- After tests: Would waste time running tests if lint fails

### 6. Environment Guard Implementation

**Question**: How should env-guard detect secret values?

**Findings**:
- Repository already has gitleaks for pattern-based secret detection
- Env-guard adds value by detecting actual environment variable values in staged files
- Protected variables: `ADO_PAT`, `OPENAI_API_KEY`, `AZURE_DEVOPS_TOKEN`

**Decision**: Implement as pre-commit hook in Python
**Rationale**:
- Python already in dev toolchain
- Simple implementation (~30 lines)
- Complements gitleaks (value-based vs pattern-based)
**Alternatives Considered**:
- Node.js script: Would add dependency in Python-primary project
- Shell script: Less portable across platforms

## Resolved Clarifications

| Item | Resolution |
|------|------------|
| Coverage threshold level | Start at 40%, document plan to increase to 70% |
| ESLint security rule severities | `error` for dangerous (eval, CSRF), `warn` for risky (object injection) |
| Env-guard protected variables | ADO_PAT, OPENAI_API_KEY, AZURE_DEVOPS_TOKEN |
| Pre-push hook ordering | After tsc, before tests |

## Dependencies Confirmed

| Dependency | Version | Purpose | Status |
|------------|---------|---------|--------|
| @oddessentials/repo-standards | ^7.1.1 | Standards schema | To upgrade |
| eslint-plugin-security | ^3.0.0 | Security linting | To install |
| TypeScript | 5.7.3 | Compiler | Existing |
| ESLint | 9.18.0 | Linting | Existing |
| Jest | 30.0.0 | Testing | Existing |

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Coverage threshold blocks CI | Medium | High | Start with current level |
| ESLint security false positives | Low | Low | Use warn for ambiguous patterns |
| Env-guard false positives | Low | Medium | Only check protected variables |
| TypeScript unused var errors | Low | Low | Already verified clean |
