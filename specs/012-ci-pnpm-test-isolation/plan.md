# Implementation Plan: CI/pnpm Hardening with Test Isolation

**Branch**: `012-ci-pnpm-test-isolation` | **Date**: 2026-01-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/012-ci-pnpm-test-isolation/spec.md`

## Summary

This plan hardens CI infrastructure by: (1) creating a shared composite action for deterministic pnpm setup, (2) isolating Python-dependent tests into a separate test path, (3) adding regression guards to prevent configuration drift. The goal is structural CI stability where failures are deterministic rather than incidental.

## Technical Context

**Language/Version**: YAML (GitHub Actions), TypeScript 5.7.3 (test configuration), JSON (package.json)
**Primary Dependencies**: pnpm@9.15.0, Node.js 22, Python 3.11 (for integration tests only)
**Storage**: N/A (configuration changes only)
**Testing**: Jest 30.0.0 (extension tests), pytest (Python tests - unaffected)
**Target Platform**: GitHub Actions (ubuntu-latest runners)
**Project Type**: CI/CD infrastructure hardening
**Performance Goals**: N/A (no runtime performance requirements)
**Constraints**: Must not break existing CI workflows during transition
**Scale/Scope**: 4 workflows affected (ui-bundle-sync, build-extension, extension-tests, fresh-clone-verify)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Relevance | Status |
|-----------|-----------|--------|
| XVII. Cross-Agent Compatibility | High - CI changes must work on hosted agents | ✅ Using standard GitHub-hosted Ubuntu runners |
| XVIII. Actionable Failure Logs | High - Regression guards must provide clear errors | ✅ All guards include descriptive error messages |
| QG-17 | High - Lint + format checks must still pass | ✅ No changes to lint/format configuration |
| QG-18 | High - Type checking must still pass | ✅ No changes to TypeScript configuration |
| QG-19 | High - Unit + integration tests must still pass | ✅ Test isolation maintains test coverage |
| VR-04 | Medium - Unit tests must pass | ✅ test:unit will run same tests minus Python deps |
| VR-11 | Medium - Clean pipeline run | ✅ Shared action simplifies pipeline setup |

**No violations.** All changes align with constitution principles.

## Project Structure

### Documentation (this feature)

```text
specs/012-ci-pnpm-test-isolation/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # N/A - no data model
├── quickstart.md        # Phase 1 output
├── contracts/           # N/A - no API contracts
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
# Affected files
.github/
├── actions/
│   └── setup-pnpm/
│       └── action.yml           # NEW: Shared composite action
├── workflows/
│   └── ci.yml                   # MODIFY: Use composite action, update test commands
└── scripts/
    └── validate-ci-guards.sh    # NEW: Regression tripwire script

extension/
├── package.json                 # MODIFY: Add test:unit, test:all scripts
├── jest.config.ts               # MODIFY: Add testPathIgnorePatterns for integration
└── tests/
    ├── README.md                # NEW: Test documentation
    └── python-integration/      # NEW: Directory for Python-dependent tests
        ├── synthetic-fixtures.test.ts   # MOVE from tests/
        └── performance.test.ts          # MOVE from tests/

package.json                     # VERIFY: packageManager field exists
```

**Structure Decision**: Infrastructure configuration changes only. No new application code directories.

## Complexity Tracking

> No Constitution Check violations - section not applicable.

---

## Phase 0: Research

### Research Completed

The following research was conducted during planning:

#### R-001: Current pnpm Setup Pattern

**Finding**: All 4 target workflows use the same inline pattern:
```yaml
- uses: pnpm/action-setup@v4
- uses: actions/setup-node@v4
  with:
    node-version: '22'
    cache: 'pnpm'
    cache-dependency-path: extension/pnpm-lock.yaml
- name: Enable Corepack
  run: corepack enable
```

**Decision**: Extract to composite action at `.github/actions/setup-pnpm/action.yml`
**Rationale**: DRY principle, single point of version control, easier maintenance

#### R-002: Python-Dependent Tests Identified

**Finding**: 2 test files spawn Python processes:
- `extension/tests/synthetic-fixtures.test.ts` - generates synthetic datasets
- `extension/tests/performance.test.ts` - performance baseline tests

Both call `scripts/generate-synthetic-dataset.py` via `execSync`.

**Decision**: Move to `extension/tests/python-integration/` directory
**Rationale**: Physical separation is clearer than env flag gating; Jest's `testPathIgnorePatterns` provides reliable exclusion

#### R-003: packageManager Field Status

**Finding**: Both root `package.json` and `extension/package.json` already have `"packageManager": "pnpm@9.15.0"`

**Decision**: No change needed; add CI guard to prevent removal
**Rationale**: Field exists; guard prevents regression

#### R-004: Current Test Script Configuration

**Finding**: Current scripts in `extension/package.json`:
- `"test": "jest"` - runs all tests
- `"test:ci": "jest --ci --reporters=default --reporters=jest-junit --testPathIgnorePatterns=vsix-artifact-inspection"`

**Decision**: Add `test:unit` and `test:all`, remap `test` to `test:unit`
**Rationale**: Default behavior should be safe for Python-less environments

#### R-005: fresh-clone-verify Python Dependency

**Finding**: `fresh-clone-verify` currently installs Python and runs `pnpm test` (all tests)

**Decision**: Remove Python setup, change to `pnpm test:unit`
**Rationale**: Job purpose is "fresh clone works" not "all tests pass" - that's extension-tests' job

---

## Phase 1: Design

### Component 1: Shared pnpm Setup Action

**File**: `.github/actions/setup-pnpm/action.yml`

```yaml
name: 'Setup pnpm'
description: 'Shared pnpm setup with Node.js and corepack'
inputs:
  node-version:
    description: 'Node.js version'
    default: '22'
  cache:
    description: 'Enable pnpm cache'
    default: 'true'
  cache-dependency-path:
    description: 'Path to pnpm-lock.yaml for caching'
    default: 'extension/pnpm-lock.yaml'
runs:
  using: 'composite'
  steps:
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}
        cache: ${{ inputs.cache == 'true' && 'pnpm' || '' }}
        cache-dependency-path: ${{ inputs.cache-dependency-path }}
    - name: Enable Corepack
      shell: bash
      run: corepack enable
```

**Usage in workflows**:
```yaml
- uses: ./.github/actions/setup-pnpm
# or with options:
- uses: ./.github/actions/setup-pnpm
  with:
    cache: 'false'  # for fresh-clone-verify
```

### Component 2: Test Script Configuration

**File**: `extension/package.json` (scripts section)

```json
{
  "scripts": {
    "test": "pnpm run test:unit",
    "test:unit": "jest --testPathIgnorePatterns=python-integration --testPathIgnorePatterns=vsix-artifact-inspection",
    "test:all": "jest --testPathIgnorePatterns=vsix-artifact-inspection",
    "test:ci": "jest --ci --reporters=default --reporters=jest-junit --testPathIgnorePatterns=vsix-artifact-inspection",
    "test:watch": "jest --watch --testPathIgnorePatterns=python-integration",
    "test:coverage": "jest --coverage --testPathIgnorePatterns=python-integration"
  }
}
```

**Mapping**:
- `test` → runs unit tests only (default safe behavior)
- `test:unit` → explicit unit tests (no Python)
- `test:all` → unit + Python integration (for CI with Python)
- `test:ci` → same as test:all but with JUnit output

### Component 3: Test Directory Reorganization

**Move operations**:
```
extension/tests/synthetic-fixtures.test.ts → extension/tests/python-integration/synthetic-fixtures.test.ts
extension/tests/performance.test.ts → extension/tests/python-integration/performance.test.ts
```

**New file**: `extension/tests/python-integration/README.md`
```markdown
# Python Integration Tests

Tests in this directory require Python 3.11+ with the following dependencies:
- pandas (via `pip install -e .[dev]` from repo root)

## Running These Tests

These tests are **not** included in the default `pnpm test` command.

- Run with: `pnpm test:all` (requires Python)
- CI job: `extension-tests` (installs Python automatically)

## Why Separate?

These tests call `scripts/generate-synthetic-dataset.py` to generate test fixtures.
Separating them allows developers without Python to run unit tests locally.
```

### Component 4: CI Workflow Updates

**Job: ui-bundle-sync** (lines 114-192)
- Replace inline pnpm setup with composite action
- Keep Python setup (required for sync script)

**Job: build-extension** (lines 460-525)
- Replace inline pnpm setup with composite action
- No Python (already correct)

**Job: extension-tests** (lines 527-628)
- Replace inline pnpm setup with composite action
- Keep Python setup
- Change `pnpm run test:ci` to run all tests (including Python integration)

**Job: fresh-clone-verify** (lines 646-693)
- Replace inline pnpm setup with composite action (cache: 'false')
- **Remove** Python setup
- Change `pnpm test` to `pnpm test:unit`

### Component 5: Regression Guards

**File**: `.github/scripts/validate-ci-guards.sh`

```bash
#!/bin/bash
set -euo pipefail

ERRORS=0

# Guard 1: packageManager field in root package.json
if ! grep -q '"packageManager"' package.json; then
  echo "::error::Missing 'packageManager' field in root package.json"
  ERRORS=$((ERRORS + 1))
fi

# Guard 2: No direct pnpm/action-setup in workflows (only via composite)
DIRECT_USAGE=$(grep -rH "uses: pnpm/action-setup" .github/workflows/ 2>/dev/null || true)
if [[ -n "$DIRECT_USAGE" ]]; then
  echo "::error::Direct pnpm/action-setup usage found in workflows (use .github/actions/setup-pnpm instead):"
  echo "$DIRECT_USAGE"
  ERRORS=$((ERRORS + 1))
fi

if [[ $ERRORS -gt 0 ]]; then
  echo "::error::$ERRORS CI guard(s) failed"
  exit 1
fi

echo "[OK] All CI guards passed"
```

**New CI Job**: `ci-guards`
```yaml
ci-guards:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Validate CI Guards
      run: bash .github/scripts/validate-ci-guards.sh
```

### Component 6: Documentation

**File**: `extension/tests/README.md`

```markdown
# Extension Tests

## Test Suites

| Command | Description | Requires Python |
|---------|-------------|-----------------|
| `pnpm test` | Unit tests (default) | No |
| `pnpm test:unit` | Unit tests (explicit) | No |
| `pnpm test:all` | Unit + integration tests | Yes |
| `pnpm test:ci` | CI mode with JUnit output | Yes |
| `pnpm test:vsix` | VSIX artifact inspection | No (requires built VSIX) |

## Directory Structure

```
tests/
├── python-integration/      # Tests requiring Python
│   ├── synthetic-fixtures.test.ts
│   └── performance.test.ts
├── fixtures/                # Test data
├── harness/                 # Test utilities
└── *.test.ts               # Unit tests (no external deps)
```

## Python Dependencies

Tests in `python-integration/` require:
- Python 3.11+
- `pip install -e .[dev]` from repository root

This installs pandas and other Python dependencies needed for synthetic dataset generation.

## CI Jobs

- **extension-tests**: Runs `test:all` with Python installed
- **fresh-clone-verify**: Runs `test:unit` without Python
- **build-extension**: Runs VSIX tests only
```

---

## Verification Checklist

After implementation, verify:

- [x] `git grep pnpm/action-setup .github/workflows` returns no results
- [ ] CI logs show `pnpm@9.15.0` in all jobs (requires CI run)
- [x] `pnpm test:unit` passes locally without Python (1066 tests)
- [ ] `pnpm test:all` passes locally with Python (requires Python setup)
- [ ] `fresh-clone-verify` job passes without Python steps (requires CI run)
- [ ] `extension-tests` job passes with Python steps (requires CI run)
- [ ] Removing `packageManager` from root package.json fails CI (requires CI run)
- [ ] Adding inline `pnpm/action-setup` to a workflow fails CI (requires CI run)
