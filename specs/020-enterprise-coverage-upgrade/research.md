# Research: Enterprise Coverage Upgrade

**Branch**: `feat/optimize-quality` | **Date**: 2026-01-28

## Research Tasks

### 1. Codecov Flag-Based Coverage Separation

**Decision**: Use Codecov flags to separate Python and TypeScript coverage with distinct badges

**Rationale**:
- Codecov already in use for Python coverage in this repo
- Flags allow uploading multiple coverage reports to same project
- Each flag gets its own badge URL: `codecov.io/gh/org/repo/branch/main/graph/badge.svg?flag=typescript`
- Free tier supports flags

**Alternatives Considered**:
- Separate Codecov projects: Overkill, harder to manage
- Shields.io with coverage file: Requires committing coverage data or gist
- Coveralls: Would require migration from existing Codecov setup

**Implementation Pattern**:
```yaml
# In CI workflow
- name: Upload Python coverage
  uses: codecov/codecov-action@v4
  with:
    files: coverage.xml
    flags: python
    name: python-coverage

- name: Upload TypeScript coverage
  uses: codecov/codecov-action@v4
  with:
    files: extension/coverage/lcov.info
    flags: typescript
    name: typescript-coverage
```

**Badge URLs**:
```markdown
[![Python Coverage](https://codecov.io/gh/oddessentials/ado-git-repo-insights/branch/main/graph/badge.svg?flag=python)](https://codecov.io/gh/oddessentials/ado-git-repo-insights)
[![TypeScript Coverage](https://codecov.io/gh/oddessentials/ado-git-repo-insights/branch/main/graph/badge.svg?flag=typescript)](https://codecov.io/gh/oddessentials/ado-git-repo-insights)
```

---

### 2. TypeScript Coverage Gap Analysis

**Decision**: Focus test efforts on UI modules with lowest coverage

**Current State** (from jest.config.ts context):
- Current thresholds: ~42% (lines: 42, branches: 36, functions: 47, statements: 43)
- Target: 70% across all metrics
- Gap: ~28% increase needed

**Priority Test Areas** (based on typical UI coverage gaps):
1. `ui/dataset-loader.ts` - Data fetching and validation logic
2. `ui/artifact-client.ts` - API client methods
3. `ui/error-codes.ts` - Error handling paths
4. `ui/error-types.ts` - Error type factories
5. Chart rendering modules - DOM manipulation paths

**Rationale**:
- These modules have complex logic with multiple code paths
- Error handling paths are often untested
- API client mocking enables comprehensive testing

---

### 3. Python Coverage Verification

**Decision**: Verify existing coverage meets 70%, add targeted tests if needed

**Current State** (from pyproject.toml):
- `fail_under = 70` already configured
- Coverage likely near threshold based on existing CI passing

**Action**:
1. Run `pytest --cov` to get current coverage report
2. If below 70%, identify gaps
3. If at/above 70%, document as verified

---

### 4. Strict Typing Enforcement

**Decision**: Verify noImplicitAny (compiler) + no-explicit-any (ESLint) both active

**TypeScript** (check tsconfig.json):
```json
{
  "compilerOptions": {
    "strict": true,  // Includes noImplicitAny
    "noImplicitAny": true  // Explicit for clarity
  }
}
```

**ESLint** (check eslint.config.mjs):
```javascript
rules: {
  '@typescript-eslint/no-explicit-any': 'error',
}
```

**Python** (check pyproject.toml):
```toml
[tool.mypy]
strict = true
```

---

### 5. Local/CI Parity Strategy

**Decision**: Single source of truth per language, CI reads from config files

**Python**:
- Source of truth: `pyproject.toml` [tool.coverage.report] `fail_under`
- CI uses: `pytest --cov-fail-under` reads from config
- Local uses: Same pytest command

**TypeScript**:
- Source of truth: `jest.config.ts` `coverageThreshold`
- CI uses: `npm run test:ci` which uses jest.config.ts
- Local uses: Same npm command in pre-push hook

**Skip Symmetry**:
- No environment-specific skips allowed
- Platform-specific tests use `describe.skipIf()` with condition that evaluates same locally and in CI

---

### 6. Coverage Threshold Buffer

**Decision**: Set thresholds at achieved coverage minus 2%

**Rationale**:
- Prevents build breaks from minor refactoring
- Still catches significant coverage drops
- Industry standard practice

**Example**:
- Achieve 72% coverage
- Set threshold to 70%
- Minor fluctuations (71%, 70.5%) still pass
- Major drops (68%) fail

---

## Summary of Decisions

| Area | Decision | Key Rationale |
|------|----------|---------------|
| Badge solution | Codecov flags | Already in use, free, supports separation |
| Coverage target | 70% minimum | Industry standard enterprise threshold |
| TypeScript focus | UI modules | Highest coverage gap, most logic |
| Python | Verify existing | Already near threshold |
| Typing | Compiler + ESLint | Complete any prevention |
| Parity | Config file as source | Single source of truth |
| Buffer | 2% below achieved | Industry standard, prevents friction |
