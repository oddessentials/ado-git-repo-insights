# Quickstart: 042-test-strict-alignment

## Prerequisites

- Node.js 24+ with pnpm 9+
- Python 3.10+ (for pre-commit hooks and preflight)
- Git hooks installed (`pnpm install` in repo root triggers Husky setup)

## Verify Current State (Before Migration)

```bash
cd extension

# Confirm current test config has strict overrides
cat tsconfig.test.json
# Should show: strict: false, noImplicitAny: false, etc.

# Confirm tests pass under loose config
npx jest --json --outputFile=../specs/042-test-strict-alignment/baseline-snapshot.json

# Count strict-mode errors (expected: ~574)
cat > tsconfig-strict-test-tmp.json << 'EOF'
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": true, "declaration": false, "sourceMap": false },
  "include": ["tests/**/*.ts", "ui/**/*.ts", "../types/vss.d.ts"],
  "exclude": ["node_modules", "dist"]
}
EOF
npx tsc --noEmit --project tsconfig-strict-test-tmp.json 2>&1 | grep "error TS" | wc -l
rm tsconfig-strict-test-tmp.json
```

## Development Workflow

### Fix a test file

1. Pick the next file from the fix order (helpers first, then leaf tests by error count)
2. Fix all type errors in that file
3. Verify the file compiles: `npx tsc --noEmit --project tsconfig-strict-test-tmp.json 2>&1 | grep <filename>`
4. Verify tests still pass: `npx jest --testPathPattern=<filename>`
5. Repeat for next file

### Verify After All Fixes

```bash
cd extension

# Type check must pass
npx tsc --noEmit --project tsconfig.test.json

# All tests must pass
npx jest

# Config parity must pass (after script is created)
node scripts/check-test-config-parity.mjs

# Behavioral equivalence
npx jest --json --outputFile=../specs/042-test-strict-alignment/post-snapshot.json
# Diff baseline-snapshot.json vs post-snapshot.json (same pass/fail/skip per test)

# Full preflight
cd ..
python scripts/run_pr_preflight.py
```

## Key Constraints

- **Fix order**: Shared helpers (`mocks/ado-sdk.ts`, `harness/vss-sdk-mock.ts`) before leaf test files
- **No suppression comments**: Zero `@ts-ignore`, `@ts-expect-error`, or type-checker suppression directives
- **No behavior changes**: Only type annotations, null guards, and type assertions — no changes to test logic
- **Semantic errors**: TS2345, TS2322, TS2769, TS2488 errors require individual review, not mechanical casts
