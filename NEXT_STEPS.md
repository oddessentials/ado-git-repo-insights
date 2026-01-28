# @oddessentials/repo-standards v7.1.1 Compliance Gap Analysis

**Generated:** 2026-01-27
**Current Version:** 6.0.0
**Target Version:** 7.1.1
**Schema Migration:** v6 → v7

---

## Executive Summary

The repository is **fully compliant** with v7.1.1. All required changes have been implemented.

| Category | Status | Priority |
|----------|--------|----------|
| Package Upgrade | ✅ Complete | **P0** |
| TypeScript Strictness | ✅ Complete | **P1** |
| ESLint Security Plugin | ✅ Complete | **P1** |
| Pre-push CI Parity | ✅ Complete | **P2** |
| Circular Dependency Detection | ✅ Compliant | - |
| Coverage Enforcement (Python) | ✅ Compliant | - |
| Coverage Enforcement (TypeScript) | ✅ Complete | **P1** |
| Environment Variable Protection | ✅ Complete | **P2** |

---

## Required Changes

### P0: Package Upgrade

**File:** `package.json`

```diff
- "@oddessentials/repo-standards": "^6.0.0",
+ "@oddessentials/repo-standards": "^7.1.1",
```

After updating, run:
```bash
npm install
npm run standards:ts  # Verify new requirements
npm run standards:py  # Verify new requirements
```

---

### P1: TypeScript Compiler Strictness

**Files:** `tsconfig.json`, `extension/tsconfig.json`

v7.1.1 requires `noUnusedLocals` for dead code elimination.

**Root `tsconfig.json`:**
```diff
  "compilerOptions": {
      "strict": true,
      "noImplicitAny": true,
      "strictNullChecks": true,
      "noUncheckedIndexedAccess": true,
+     "noUnusedLocals": true,
+     "noUnusedParameters": true,
      ...
  }
```

**`extension/tsconfig.json`:**
```diff
  "compilerOptions": {
      "strict": true,
      "noImplicitAny": true,
      "strictNullChecks": true,
      "noUncheckedIndexedAccess": true,
+     "noUnusedLocals": true,
+     "noUnusedParameters": true,
      ...
  }
```

> **Note:** After enabling, fix any unused variable errors. Use `_` prefix for intentionally unused parameters (e.g., `_event`).

---

### P1: ESLint Security Plugin

**File:** `extension/package.json`

Add the security plugin:
```diff
  "devDependencies": {
+   "eslint-plugin-security": "^3.0.0",
    "@typescript-eslint/eslint-plugin": "^8.20.0",
    ...
  }
```

**File:** `extension/eslint.config.mjs`

```diff
  import eslint from '@eslint/js';
  import tseslint from 'typescript-eslint';
+ import security from 'eslint-plugin-security';

  export default tseslint.config(
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
+     security.configs.recommended,
      {
          languageOptions: {
              ...
          },
          rules: {
+             // Security rules (from eslint-plugin-security)
+             'security/detect-object-injection': 'warn',
+             'security/detect-non-literal-regexp': 'warn',
+             'security/detect-unsafe-regex': 'error',
+             'security/detect-buffer-noassert': 'error',
+             'security/detect-eval-with-expression': 'error',
+             'security/detect-no-csrf-before-method-override': 'error',
+             'security/detect-possible-timing-attacks': 'warn',
              ...
          },
      },
      ...
  );
```

---

### P1: TypeScript Coverage Threshold

**File:** `extension/jest.config.ts`

v7.1.1 requires coverage threshold enforcement to prevent regressions.

```diff
  const config: Config = {
    preset: "ts-jest",
    testEnvironment: "jsdom",
    testMatch: ["**/tests/**/*.test.ts"],
    verbose: true,
    collectCoverageFrom: ["ui/**/*.ts", "!ui/**/*.test.ts"],
    coverageDirectory: "coverage",
    coverageReporters: ["text", "lcov"],
+   coverageThreshold: {
+     global: {
+       branches: 70,
+       functions: 70,
+       lines: 70,
+       statements: 70,
+     },
+   },
    ...
  };
```

---

### P2: Pre-push CI Parity

**File:** `.husky/pre-push`

v7.1.1 requires pre-push hooks to mirror CI checks. Add ESLint verification:

```diff
  # After TypeScript type check section, before TypeScript Tests:

+ # =============================================================================
+ # ESLint Check (mirrors CI extension-tests job)
+ # =============================================================================
+ echo ""
+ echo "[pre-push] Running ESLint..."
+ npm run lint
+ if [ $? -ne 0 ]; then
+     echo ""
+     echo "[pre-push] ❌ Push blocked: ESLint check failed"
+     exit 1
+ fi
+ echo "[pre-push] ✅ ESLint check passed"

  # =============================================================================
  # TypeScript Tests
  # =============================================================================
```

---

### P2: Environment Variable Protection (env-guard)

v7.1.1 introduces env-guard policy for preventing accidental secret exposure.

**Option A: Create `.env.example` manifest**

**File:** `.env.example` (new)
```ini
# Required environment variables for local development
# Copy to .env and fill in values

# Azure DevOps
ADO_PAT=<your-personal-access-token>
ADO_ORG=<your-organization>

# Optional: ML features
OPENAI_API_KEY=<optional-for-insights>
```

**Option B: Add env validation to pre-commit**

**File:** `.pre-commit-config.yaml`
```diff
  repos:
+   - repo: local
+     hooks:
+       - id: env-guard
+         name: Environment Variable Guard
+         entry: python scripts/env_guard.py
+         language: python
+         pass_filenames: false
+         always_run: true
```

**File:** `scripts/env_guard.py` (new)
```python
#!/usr/bin/env python3
"""Prevent committing files containing environment variable values."""
import os
import sys
import subprocess

PROTECTED_VARS = ['ADO_PAT', 'OPENAI_API_KEY', 'AZURE_DEVOPS_TOKEN']

def main() -> int:
    for var in PROTECTED_VARS:
        value = os.environ.get(var)
        if not value or len(value) < 8:
            continue
        # Check staged files for leaked values
        result = subprocess.run(
            ['git', 'diff', '--cached', '--name-only'],
            capture_output=True, text=True
        )
        for file in result.stdout.strip().split('\n'):
            if not file or not os.path.isfile(file):
                continue
            try:
                with open(file, 'r', encoding='utf-8', errors='ignore') as f:
                    if value in f.read():
                        print(f"::error::{var} value found in {file}")
                        return 1
            except Exception:
                pass
    return 0

if __name__ == '__main__':
    sys.exit(main())
```

---

## Already Compliant

### Circular Dependency Detection ✅

**File:** `extension/.dependency-cruiser.cjs`

The `no-circular` rule is already configured with severity `error`.

### Python Coverage Threshold ✅

**File:** `pyproject.toml`

Coverage threshold is enforced at 70%:
```toml
[tool.coverage.report]
fail_under = 70
```

### Pre-commit Hooks ✅

**File:** `.pre-commit-config.yaml`

- Ruff linting and formatting
- Trailing whitespace removal
- YAML validation
- Secret detection (gitleaks)

### Git Attributes ✅

**File:** `.gitattributes`

LF line endings enforced for code files.

### CI/CD Workflows ✅

**File:** `.github/workflows/ci.yml`

Comprehensive CI pipeline with:
- Secret scanning
- Line ending guards
- Python/TypeScript tests
- Coverage reporting
- VSIX packaging

---

## Verification Steps

After implementing changes:

1. **Run standards check:**
   ```bash
   npm run standards:ts
   npm run standards:py
   ```

2. **Verify TypeScript compiles:**
   ```bash
   npx tsc --noEmit
   cd extension && npx tsc --noEmit
   ```

3. **Run ESLint with security plugin:**
   ```bash
   cd extension && npm run lint
   ```

4. **Verify coverage thresholds:**
   ```bash
   # Python
   pytest --cov --cov-fail-under=70

   # TypeScript
   cd extension && npm run test:coverage
   ```

5. **Test pre-push hook:**
   ```bash
   .husky/pre-push
   ```

---

## Migration Checklist

- [x] Update `@oddessentials/repo-standards` to ^7.1.1
- [x] Add `noUnusedLocals` and `noUnusedParameters` to tsconfig files
- [x] Install and configure `eslint-plugin-security`
- [x] Add `coverageThreshold` to Jest config
- [x] Add ESLint check to pre-push hook
- [x] Create env-guard policy (optional but recommended)
- [x] Run full test suite to verify no regressions
- [x] Update CLAUDE.md if needed (auto-generated from specs)

---

## References

- [repo-standards v7.0.0 Release Notes](https://github.com/oddessentials/repo-standards/releases/tag/v7.0.0)
- [repo-standards v7.1.1 Release Notes](https://github.com/oddessentials/repo-standards/releases/tag/v7.1.1)
- [Schema v7 Migration Guide](https://github.com/oddessentials/repo-standards#schema-version)
