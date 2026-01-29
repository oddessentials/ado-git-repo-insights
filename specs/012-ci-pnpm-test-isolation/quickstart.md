# Quickstart: CI/pnpm Hardening with Test Isolation

**Feature**: 012-ci-pnpm-test-isolation
**Purpose**: Harden CI infrastructure with deterministic pnpm setup and test isolation

## Overview

This feature makes CI structural rather than incidental by:
1. Centralizing pnpm setup in a shared composite action
2. Isolating Python-dependent tests from unit tests
3. Adding guards to prevent configuration drift

## Key Changes

### For Developers

**Running tests locally**:
```bash
# Default: unit tests only (no Python required)
cd extension
pnpm test

# With Python installed: all tests
pnpm test:all
```

**Test commands summary**:
| Command | Python Required | Use Case |
|---------|-----------------|----------|
| `pnpm test` | No | Quick local feedback |
| `pnpm test:unit` | No | Explicit unit tests |
| `pnpm test:all` | Yes | Full test suite |
| `pnpm test:ci` | Yes | CI with JUnit output |

### For CI Maintainers

**Using the shared pnpm action**:
```yaml
# Standard usage (with cache)
- uses: ./.github/actions/setup-pnpm

# Without cache (for fresh-clone-verify)
- uses: ./.github/actions/setup-pnpm
  with:
    cache: 'false'
```

**Never use directly in workflows**:
```yaml
# WRONG - will fail CI guards
- uses: pnpm/action-setup@v4

# RIGHT - use composite action
- uses: ./.github/actions/setup-pnpm
```

## File Locations

| File | Purpose |
|------|---------|
| `.github/actions/setup-pnpm/action.yml` | Shared pnpm setup |
| `.github/scripts/validate-ci-guards.sh` | Regression guards |
| `extension/tests/README.md` | Test documentation |
| `extension/tests/python-integration/` | Python-dependent tests |

## CI Job Responsibilities

| Job | Python | Tests | Purpose |
|-----|--------|-------|---------|
| `extension-tests` | Yes | `test:ci` (all) | Full test coverage |
| `fresh-clone-verify` | No | `test:unit` | Fresh clone works |
| `build-extension` | No | `test:vsix` | VSIX artifact inspection |

## Verification

After implementation, verify these conditions:

```bash
# No direct pnpm/action-setup in workflows
git grep "pnpm/action-setup" .github/workflows/
# Should return nothing

# Unit tests pass without Python
cd extension
pnpm test:unit
# Should pass

# All tests pass with Python
pnpm test:all
# Should pass (requires Python + pandas)
```

## Troubleshooting

**"Direct pnpm/action-setup usage found"**
- A workflow is using `pnpm/action-setup` directly
- Change to `uses: ./.github/actions/setup-pnpm`

**"Missing packageManager field"**
- The root `package.json` is missing `"packageManager": "pnpm@9.15.0"`
- Add the field back

**Unit tests fail with "python: command not found"**
- A test in `tests/` (not `python-integration/`) is calling Python
- Move the test to `extension/tests/python-integration/`

**Fresh-clone-verify fails**
- Check that the job runs `pnpm test:unit` not `pnpm test`
- Ensure Python is not installed in that job
