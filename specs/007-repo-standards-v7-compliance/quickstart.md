# Quickstart: Repository Standards v7.1.1 Compliance

This guide provides step-by-step instructions to implement v7.1.1 compliance changes.

## Prerequisites

- Node.js 22+ installed
- Python 3.10+ installed
- Repository cloned with `npm install` completed in both root and `extension/`

## Implementation Steps

### Step 1: Upgrade Standards Package

```bash
# In repository root
npm install @oddessentials/repo-standards@^7.1.1

# Verify upgrade
npm run standards:ts
npm run standards:py
```

Expected: Commands output v7 schema without errors.

### Step 2: Enable TypeScript Strictness

Edit `tsconfig.json` (root):
```json
{
  "compilerOptions": {
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

Edit `extension/tsconfig.json`:
```json
{
  "compilerOptions": {
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

Verify:
```bash
cd extension && npx tsc --noEmit
```

Expected: Clean compilation with no errors.

### Step 3: Add ESLint Security Plugin

```bash
cd extension
npm install --save-dev eslint-plugin-security@^3.0.0
```

Edit `extension/eslint.config.mjs`:
```javascript
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    security.configs.recommended,
    {
        rules: {
            // Errors for dangerous patterns
            'security/detect-eval-with-expression': 'error',
            'security/detect-buffer-noassert': 'error',
            'security/detect-no-csrf-before-method-override': 'error',
            'security/detect-unsafe-regex': 'error',
            // Warnings for risky patterns
            'security/detect-object-injection': 'warn',
            'security/detect-non-literal-regexp': 'warn',
            'security/detect-possible-timing-attacks': 'warn',
        },
    },
    // ... existing config
);
```

Verify:
```bash
npm run lint
```

Expected: No errors from security rules.

### Step 4: Add Coverage Threshold

Edit `extension/jest.config.ts`:
```typescript
const config: Config = {
  // ... existing config
  coverageThreshold: {
    global: {
      branches: 36,
      functions: 47,
      lines: 43,
      statements: 42,
    },
  },
};
```

Verify:
```bash
npm run test:coverage
```

Expected: Tests pass with coverage threshold enforcement.

### Step 5: Enhance Pre-push Hook

Edit `.husky/pre-push`, add after TypeScript type check section:

```bash
# =============================================================================
# ESLint Check (mirrors CI extension-tests job)
# =============================================================================
echo ""
echo "[pre-push] Running ESLint..."
npm run lint
if [ $? -ne 0 ]; then
    echo ""
    echo "[pre-push] ❌ Push blocked: ESLint check failed"
    exit 1
fi
echo "[pre-push] ✅ ESLint check passed"
```

Verify:
```bash
# Introduce a deliberate lint error, then:
git push  # Should be blocked
```

### Step 6: Add Environment Guard

Create `scripts/env_guard.py`:
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

Edit `.pre-commit-config.yaml`:
```yaml
repos:
  - repo: local
    hooks:
      - id: env-guard
        name: Environment Variable Guard
        entry: python scripts/env_guard.py
        language: python
        pass_filenames: false
        always_run: true
```

Verify:
```bash
# Set a test variable and create a file with its value
export TEST_VAR="secret123"
# Add TEST_VAR to PROTECTED_VARS temporarily
# Stage a file containing "secret123"
git add testfile.txt
pre-commit run env-guard  # Should fail
```

## Verification Checklist

After completing all steps:

- [ ] `npm run standards:ts` shows v7 schema
- [ ] `npm run standards:py` shows v7 schema
- [ ] `cd extension && npx tsc --noEmit` passes
- [ ] `cd extension && npm run lint` passes
- [ ] `cd extension && npm run test:coverage` passes with thresholds
- [ ] Pre-push hook blocks on lint errors
- [ ] All CI checks pass

## Troubleshooting

### TypeScript unused variable errors
Prefix intentionally unused parameters with `_`:
```typescript
// Before
function handler(event, context) { ... }

// After
function handler(_event, context) { ... }
```

### ESLint security false positives
If a security rule triggers on safe code, disable for that line:
```typescript
// eslint-disable-next-line security/detect-object-injection
const value = obj[key];
```

### Coverage threshold failures
If coverage drops below threshold, either:
1. Add tests to restore coverage
2. Temporarily lower threshold (with documented plan to restore)
