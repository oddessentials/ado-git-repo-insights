# Research: CI/pnpm Hardening with Test Isolation

**Feature**: 012-ci-pnpm-test-isolation
**Date**: 2026-01-29

## R-001: Current pnpm Setup Pattern

### Question
How is pnpm currently set up across workflows, and what pattern should the composite action follow?

### Investigation
Analyzed all GitHub Actions workflows in `.github/workflows/`:
- `ci.yml` - Contains ui-bundle-sync, build-extension, extension-tests, fresh-clone-verify
- `release.yml` - Contains build-extension for release

### Finding
All jobs use the identical inline pattern:
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

The only variation is `fresh-clone-verify` which omits the cache intentionally.

### Decision
Extract to composite action at `.github/actions/setup-pnpm/action.yml` with configurable inputs for:
- `node-version` (default: '22')
- `cache` (default: 'true', set 'false' for fresh-clone-verify)
- `cache-dependency-path` (default: 'extension/pnpm-lock.yaml')

### Rationale
- DRY principle - single maintenance point
- Version changes propagate automatically
- Reduced workflow YAML complexity
- Easier to audit and update

### Alternatives Considered
1. **Keep inline setup**: Rejected - violates DRY, makes version updates error-prone
2. **Reusable workflow**: Rejected - too heavy for a setup step, composite action is simpler

---

## R-002: Python-Dependent Tests

### Question
Which tests require Python, and how should they be isolated?

### Investigation
Searched for `execSync`, `spawn`, and `exec` calls with 'python' in extension tests:
- `grep -r "execSync.*python" extension/tests/`
- `grep -r "spawn.*python" extension/tests/`

### Finding
**2 files identified**:

1. **`extension/tests/synthetic-fixtures.test.ts`**
   - Lines 81-84: `execSync(\`python "${scriptPath}" ...\`)`
   - Calls `scripts/generate-synthetic-dataset.py`
   - 6 tests generating fixtures with 1k/5k/10k PRs

2. **`extension/tests/performance.test.ts`**
   - Lines 65-68, 103-106, 143-146, 188-191, 364-366: Multiple `execSync` calls
   - Calls same Python script
   - 10 parameterized tests for performance baselines

Both use validated numeric inputs and `resolveInside()` for path safety.

### Decision
Move both files to `extension/tests/python-integration/` directory.

### Rationale
- Physical separation is immediately visible
- Jest's `testPathIgnorePatterns` reliably excludes directories
- No code changes needed in the test files themselves
- Clearer than env flag gating (`RUN_PY_INTEGRATION=1`)

### Alternatives Considered
1. **Environment flag gating**: Rejected - requires code changes in each test, easy to forget
2. **Jest project configuration**: Rejected - adds complexity for minimal benefit
3. **Skip if Python unavailable**: Rejected - silent skips hide problems

---

## R-003: packageManager Field Status

### Question
Does the root package.json already have the `packageManager` field?

### Investigation
Read contents of:
- `package.json` (root)
- `extension/package.json`

### Finding
**Both files already have**: `"packageManager": "pnpm@9.15.0"`

This matches the target version from the specification.

### Decision
No change needed to package.json files. Add CI guard to prevent removal.

### Rationale
Field exists at correct version. Guard prevents regression without requiring changes.

---

## R-004: Current Test Script Configuration

### Question
What test scripts exist and how should they be reorganized?

### Investigation
Read `extension/package.json` scripts section.

### Finding
Current scripts:
```json
{
  "test": "jest",
  "test:watch": "jest --watch",
  "test:coverage": "jest --coverage",
  "test:ci": "jest --ci --reporters=default --reporters=jest-junit --testPathIgnorePatterns=vsix-artifact-inspection",
  "test:vsix": "jest --ci --testPathPatterns vsix-artifact-inspection"
}
```

The default `test` runs all tests including Python-dependent ones.

### Decision
Reorganize to:
- `test` → `pnpm run test:unit` (default safe behavior)
- `test:unit` → excludes `python-integration` and `vsix-artifact-inspection`
- `test:all` → excludes only `vsix-artifact-inspection` (runs Python tests)
- `test:ci` → same as `test:all` with JUnit reporters

### Rationale
- Default behavior should work without Python
- Explicit scripts for each use case
- `test:ci` remains the CI entry point with proper reporters

### Alternatives Considered
1. **Keep test as-is, add test:unit**: Rejected - default should be safe
2. **Use Jest projects**: Rejected - overkill for 2 files

---

## R-005: fresh-clone-verify Job Analysis

### Question
Why does fresh-clone-verify install Python, and can it be removed?

### Investigation
Read `fresh-clone-verify` job definition (lines 646-693 in ci.yml).

### Finding
Job purpose: "proves deterministic builds without cache" (FR-034 comment)

Current steps:
1. Checkout with fetch-depth: 0
2. **Setup Python 3.11**
3. **Install Python dependencies** (`pip install -e .[dev]`)
4. Setup pnpm (no cache)
5. Install extension dependencies
6. Build extension
7. Run `pnpm test` (all tests)
8. Verify lockfile unchanged

The Python setup exists because `pnpm test` runs all tests including Python-dependent ones.

### Decision
- Remove Python setup steps
- Change `pnpm test` to `pnpm test:unit`
- Job focus remains "fresh clone works" not "all tests pass"

### Rationale
- `extension-tests` job already runs full test suite with Python
- `fresh-clone-verify` should verify the minimal path works
- Reduces job runtime and dependencies
- Enforces test isolation by having a job that cannot run Python tests

### Alternatives Considered
1. **Keep Python but run test:unit**: Rejected - unnecessary Python install
2. **Remove tests entirely**: Rejected - we still want to verify tests run from fresh clone

---

## R-006: Composite Action Best Practices

### Question
What are best practices for GitHub Actions composite actions?

### Investigation
Reviewed GitHub Actions documentation and existing patterns.

### Finding
Best practices for composite actions:
1. Use `using: 'composite'` in action.yml
2. Specify `shell:` for all run steps
3. Use inputs with defaults for flexibility
4. Keep actions focused and single-purpose
5. Document inputs and outputs clearly

### Decision
Create `.github/actions/setup-pnpm/action.yml` with:
- Three configurable inputs (node-version, cache, cache-dependency-path)
- Sensible defaults matching current usage
- `shell: bash` on all run steps

### Rationale
Follows GitHub best practices, maintains flexibility for edge cases (like cache-disabled fresh-clone-verify).

---

## R-007: Regression Guard Implementation

### Question
How should regression guards be implemented to prevent configuration drift?

### Investigation
Reviewed existing CI guard patterns in the repository (pnpm-lockfile-guard, line-ending-guard).

### Finding
Existing guards use shell scripts with clear error messages:
```yaml
- name: Check for npm lockfile
  run: |
    if [ -f "extension/package-lock.json" ]; then
      echo "::error::package-lock.json found..."
      exit 1
    fi
```

### Decision
Create `.github/scripts/validate-ci-guards.sh` with two checks:
1. `packageManager` field exists in root package.json
2. No direct `pnpm/action-setup` usage in workflows

Add new `ci-guards` job to run this script.

### Rationale
- Consistent with existing guard patterns
- Clear error messages with `::error::` annotation
- Runs early in CI to fail fast
- Script can be extended with future guards

---

## Summary

| Research Item | Decision | Confidence |
|--------------|----------|------------|
| R-001: pnpm setup | Composite action | High |
| R-002: Python tests | Separate directory | High |
| R-003: packageManager | Already exists, add guard | High |
| R-004: Test scripts | Reorganize with test:unit default | High |
| R-005: fresh-clone-verify | Remove Python, use test:unit | High |
| R-006: Composite action | Follow best practices | High |
| R-007: Regression guards | Shell script + CI job | High |

All research items resolved with high confidence. Ready for implementation.
