# Quickstart: Enterprise Coverage Upgrade

**Branch**: `feat/optimize-quality` | **Date**: 2026-01-28

## Overview

This feature increases test coverage to 70% enterprise-grade standards, enforces strict typing, and adds separate Codecov badges for Python and TypeScript.

## Prerequisites

- Python 3.10+ with pytest-cov
- Node.js 22+ with Jest
- Codecov account (free tier)
- GitHub Actions CI

## Step-by-Step Implementation

### Phase 1: Verify Current State

#### Step 1.1: Check Python Coverage

```bash
pytest --cov=src/ado_git_repo_insights --cov-report=term-missing
```

Document current coverage. If >= 70%, proceed. If < 70%, note gaps.

#### Step 1.2: Check TypeScript Coverage

```bash
cd extension
npm run test:coverage
```

Document current coverage (expected ~42%). Note modules with lowest coverage.

#### Step 1.3: Verify Strict Typing

```bash
# TypeScript - check tsconfig.json has strict: true
grep -A5 '"compilerOptions"' extension/tsconfig.json | grep -E "strict|noImplicitAny"

# ESLint - check no-explicit-any is error
grep "no-explicit-any" extension/eslint.config.mjs

# Python - check mypy strict mode
grep "strict" pyproject.toml
```

---

### Phase 2: Write TypeScript Tests (Major Effort)

#### Step 2.1: Identify Coverage Gaps

Run Jest with coverage report:
```bash
cd extension
npm run test:coverage -- --coverageReporters=text-summary --coverageReporters=html
```

Open `coverage/index.html` to identify files with lowest coverage.

#### Step 2.2: Test Priority Order

1. **Error handling modules** (`error-codes.ts`, `error-types.ts`)
2. **Data loading** (`dataset-loader.ts`)
3. **API client** (`artifact-client.ts`)
4. **Chart rendering** (DOM manipulation paths)

#### Step 2.3: Test Template

```typescript
// tests/ui/module-name.test.ts
import { functionUnderTest } from '../../ui/module-name';

describe('ModuleName', () => {
  describe('functionUnderTest', () => {
    // Happy path
    it('should return expected result for valid input', () => {
      const result = functionUnderTest(validInput);
      expect(result).toEqual(expectedOutput);
    });

    // Edge cases
    it('should handle empty input', () => {
      const result = functionUnderTest('');
      expect(result).toEqual(emptyResult);
    });

    it('should handle null/undefined', () => {
      expect(() => functionUnderTest(null)).toThrow();
    });

    // Error paths
    it('should throw on invalid input', () => {
      expect(() => functionUnderTest(invalidInput)).toThrow(ExpectedError);
    });
  });
});
```

---

### Phase 3: Update Coverage Thresholds

#### Step 3.1: Update Jest Config

Edit `extension/jest.config.ts`:

```typescript
const config: Config = {
  // ... existing config ...
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
};
```

#### Step 3.2: Verify Python Threshold

Check `pyproject.toml`:
```toml
[tool.coverage.report]
fail_under = 70
```

---

### Phase 4: Configure Codecov Flags

#### Step 4.1: Update CI Workflow

Edit `.github/workflows/ci.yml`:

```yaml
- name: Upload Python coverage to Codecov
  uses: codecov/codecov-action@v4
  with:
    files: coverage.xml
    flags: python
    name: python-coverage
    token: ${{ secrets.CODECOV_TOKEN }}

- name: Upload TypeScript coverage to Codecov
  uses: codecov/codecov-action@v4
  with:
    files: extension/coverage/lcov.info
    flags: typescript
    name: typescript-coverage
    token: ${{ secrets.CODECOV_TOKEN }}
```

#### Step 4.2: Create codecov.yml (if not exists)

```yaml
# codecov.yml
coverage:
  status:
    project:
      default:
        target: 70%
    patch:
      default:
        target: 70%

flags:
  python:
    paths:
      - src/
    carryforward: true
  typescript:
    paths:
      - extension/ui/
    carryforward: true
```

---

### Phase 5: Update README Badges

Edit `README.md`:

```markdown
<!-- Coverage Badges -->
[![Python Coverage](https://codecov.io/gh/oddessentials/ado-git-repo-insights/branch/main/graph/badge.svg?flag=python)](https://codecov.io/gh/oddessentials/ado-git-repo-insights)
[![TypeScript Coverage](https://codecov.io/gh/oddessentials/ado-git-repo-insights/branch/main/graph/badge.svg?flag=typescript)](https://codecov.io/gh/oddessentials/ado-git-repo-insights)
```

---

### Phase 6: Verify Local/CI Parity

#### Step 6.1: Test Local Enforcement

```bash
# Should fail if coverage < 70%
cd extension && npm run test:ci

# Python
pytest --cov-fail-under=70
```

#### Step 6.2: Verify Pre-push Hook

Ensure `.husky/pre-push` runs coverage-enforced tests:
```bash
npm run test:ci  # In extension directory
```

---

## Verification Checklist

- [ ] Python coverage >= 70% (`pytest --cov`)
- [ ] TypeScript coverage >= 70% (`npm run test:coverage`)
- [ ] `jest.config.ts` has `coverageThreshold` at 70%
- [ ] `pyproject.toml` has `fail_under = 70`
- [ ] CI uploads Python coverage with `--flag python`
- [ ] CI uploads TypeScript coverage with `--flag typescript`
- [ ] README has separate Python and TypeScript badges
- [ ] Badges display correct coverage after CI run
- [ ] Pre-push hook enforces coverage thresholds
- [ ] No `any` types in TypeScript (ESLint passes)
- [ ] mypy strict mode passes for Python
