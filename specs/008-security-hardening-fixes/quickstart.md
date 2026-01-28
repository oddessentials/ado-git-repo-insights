# Quickstart: Security Hardening Fixes

**Branch**: `008-security-hardening-fixes` | **Date**: 2026-01-28

## Overview

This feature hardens the pre-push hook against shell injection vulnerabilities, creates a fail-closed environment guard script, and re-enables ESLint security rules with governance.

## Prerequisites

- Git Bash (Windows) or bash (macOS/Linux)
- Python 3.10+
- Node.js 22+
- npm

## Step-by-Step Implementation

### Step 1: Update Pre-push Hook Shebang and Error Handling

Edit `.husky/pre-push`:

```bash
#!/usr/bin/env bash
# Pre-push hook: Run all checks before pushing to prevent CI failures
# Requires bash for pipefail support

set -eo pipefail  # Exit on error, including pipeline failures
```

### Step 2: Convert CRLF Guard to NUL-Delimited Handling

Replace the existing `grep -rlI` patterns with safe alternatives:

```bash
# BEFORE (unsafe):
if grep -rlI $'\r' .husky/ 2>/dev/null; then

# AFTER (safe with NUL-delimited handling):
if find .husky/ -type f -print0 2>/dev/null | xargs -0 grep -l -- $'\r' 2>/dev/null; then
```

Apply to all CRLF checks:
- `.husky/`
- `*.sh` files
- `.github/scripts/`
- `scripts/`
- `extension/scripts/`
- `extension/ui/`

### Step 3: Create env_guard.py

Create `scripts/env_guard.py`:

```python
#!/usr/bin/env python3
"""
Environment variable guard - prevents committing secret values.
Fail-closed: exits non-zero if ANY file cannot be scanned.
"""

import re
import shutil
import subprocess
import sys
from pathlib import Path

PROTECTED_VARS = ["ADO_PAT", "AZURE_PAT", "GITHUB_TOKEN", "NPM_TOKEN"]


def validate_git() -> str:
    """Validate git executable via behavior check."""
    git_path = shutil.which("git")
    if git_path is None:
        sys.exit("ERROR: git not found in PATH")

    result = subprocess.run(
        [git_path, "--version"],
        capture_output=True,
        text=True,
        check=False,
    )
    if not re.match(r"git version \d+\.\d+", result.stdout):
        sys.exit(f"ERROR: Invalid git executable at {git_path}")

    return git_path


def get_staged_files(git_path: str) -> list[str]:
    """Get list of staged files."""
    result = subprocess.run(
        [git_path, "diff", "--cached", "--name-only", "-z"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        sys.exit(f"ERROR: git diff failed: {result.stderr}")

    return [f for f in result.stdout.split("\0") if f]


def scan_file(filepath: str, secrets: dict[str, str]) -> list[str]:
    """Scan file for secret values. Fail-closed on any error."""
    violations = []
    try:
        with open(filepath, encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        sys.exit(f"ERROR: File not found (deleted?): {filepath}")
    except PermissionError:
        sys.exit(f"ERROR: Permission denied: {filepath}")
    except UnicodeDecodeError:
        sys.exit(f"ERROR: Cannot decode file (binary?): {filepath}")

    for var_name, var_value in secrets.items():
        if var_value and var_value in content:
            violations.append(f"{filepath}: contains {var_name} value")

    return violations


def main() -> int:
    """Main entry point."""
    import os

    # Collect protected secrets from environment
    secrets = {}
    for var in PROTECTED_VARS:
        value = os.environ.get(var)
        if value:
            secrets[var] = value

    if not secrets:
        # No protected vars set - nothing to check
        return 0

    git_path = validate_git()
    staged_files = get_staged_files(git_path)

    if not staged_files:
        return 0

    all_violations = []
    for filepath in staged_files:
        if Path(filepath).exists():
            violations = scan_file(filepath, secrets)
            all_violations.extend(violations)

    if all_violations:
        print("ERROR: Secret values detected in staged files:")
        for v in all_violations:
            print(f"  - {v}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### Step 4: Install eslint-plugin-security

```bash
cd extension
npm install --save-dev eslint-plugin-security
```

### Step 5: Update ESLint Configuration

Edit `extension/eslint.config.mjs`:

```javascript
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        plugins: {
            security,
        },
        rules: {
            // ... existing rules ...

            // Security rules
            'security/detect-object-injection': 'error',
        },
    },
    // ... rest of config ...
);
```

### Step 6: Add Suppressions with SECURITY Tags

For each false positive, add:

```typescript
// eslint-disable-next-line security/detect-object-injection -- SECURITY: key is validated enum value
const value = config[validatedKey];
```

### Step 7: Document .ai-review.yml trusted_only Setting

Add comment to `.ai-review.yml`:

```yaml
version: 1
# SECURITY: trusted_only ensures AI review only runs on code from trusted contributors
# This prevents prompt injection attacks via malicious PR content
trusted_only: true
```

### Step 8: Verify Changes

```bash
# Test pre-push hook
git push --dry-run

# Test ESLint
cd extension && npm run lint

# Verify suppression governance
grep -c "detect-object-injection" extension/ui/*.ts
grep -c "SECURITY:" extension/ui/*.ts
# ^ These counts must match
```

## Verification Checklist

- [ ] Pre-push hook uses `#!/usr/bin/env bash`
- [ ] Pre-push hook has `set -eo pipefail`
- [ ] All `find` commands use `-print0`
- [ ] All `xargs` commands use `-0` and `--`
- [ ] env_guard.py validates git via `--version`
- [ ] env_guard.py exits non-zero on file errors
- [ ] detect-object-injection is 'error' in ESLint
- [ ] All suppressions have `-- SECURITY:` tags
- [ ] .ai-review.yml has documentation comment
- [ ] `npm run lint` passes with zero warnings
