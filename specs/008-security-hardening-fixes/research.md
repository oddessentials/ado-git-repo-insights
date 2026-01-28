# Research: Security Hardening Fixes

**Branch**: `008-security-hardening-fixes` | **Date**: 2026-01-28

## Research Tasks

### 1. Safe Filename Handling in Bash

**Decision**: Use `find -print0 | xargs -0 grep` pattern with `--` separators

**Rationale**:
- NUL-delimited output (`-print0`) prevents newline injection (filenames with `\n`)
- NUL-delimited input (`xargs -0`) prevents word splitting (filenames with spaces/tabs)
- `--` separator prevents option injection (filenames starting with `-`)
- This pattern is POSIX-compliant when using GNU coreutils (available in Git Bash)

**Alternatives Considered**:
- `while IFS= read -r -d '' file`: More portable but more verbose; xargs -0 is cleaner
- `grep -rlI pattern dir/`: Simpler but doesn't support NUL-delimited output on all platforms
- `find ... -exec grep {} \;`: Safe but slower (new process per file)

**Implementation Pattern**:
```bash
# Safe: NUL-delimited flow with option injection protection
find /path -type f -print0 | xargs -0 grep -l -- 'pattern'

# For CRLF detection specifically:
find . -name "*.sh" -type f -not -path "./node_modules/*" -print0 | \
    xargs -0 grep -l -- $'\r' 2>/dev/null
```

---

### 2. Bash Error Handling with Pipefail

**Decision**: Use `#!/usr/bin/env bash` shebang with `set -eo pipefail`

**Rationale**:
- `set -e`: Exit on first error (already common)
- `set -o pipefail`: Exit if ANY command in a pipeline fails (bash-specific)
- `#!/usr/bin/env bash`: Explicitly requires bash, makes pipefail work reliably
- Git Bash on Windows provides bash, so this works cross-platform

**Alternatives Considered**:
- `#!/bin/sh` with explicit `|| exit 1`: POSIX-portable but verbose and error-prone
- ERR trap: Useful for cleanup but doesn't replace pipefail for pipeline failures
- `set -u` (nounset): Useful but can cause issues with legitimate unset variables

**Implementation Pattern**:
```bash
#!/usr/bin/env bash
set -eo pipefail

# All pipelines now fail properly:
find . -print0 | xargs -0 grep -l pattern  # If xargs fails, whole line fails
```

---

### 3. Git Executable Validation

**Decision**: Validate via `git --version` output pattern matching

**Rationale**:
- `shutil.which("git")` can return any executable named "git" in PATH
- Running `git --version` validates behavior, not just existence
- Output matches `git version X.Y.Z` pattern on all platforms
- This works regardless of installation method (apt, brew, scoop, chocolatey, etc.)

**Alternatives Considered**:
- Path allowlist: Breaks on non-standard installs (Windows, containers, etc.)
- Binary hash validation: High maintenance, breaks on updates
- Existence check only: Insufficient - doesn't prove it's actually git

**Implementation Pattern**:
```python
import re
import shutil
import subprocess

def validate_git():
    git_path = shutil.which("git")
    if git_path is None:
        sys.exit("ERROR: git not found in PATH")

    result = subprocess.run(
        [git_path, "--version"],
        capture_output=True,
        text=True
    )
    if not re.match(r"git version \d+\.\d+", result.stdout):
        sys.exit(f"ERROR: Invalid git executable at {git_path}")

    return git_path
```

---

### 4. Fail-Closed File Handling in Python

**Decision**: Exit non-zero on ANY file error (FileNotFoundError, PermissionError, UnicodeDecodeError)

**Rationale**:
- Security-critical code should never silently skip unreadable files
- A file that can't be scanned might contain secrets
- Fail-closed prevents false negatives in secret detection
- Clear error messages identify exactly which file failed

**Alternatives Considered**:
- Log and continue: Risk of silent bypass
- Partial scan with warning exit code (2): Complex, still allows CI to pass
- Interactive prompt: Not suitable for automated hooks

**Implementation Pattern**:
```python
def scan_file(filepath: str, secrets: list[str]) -> bool:
    try:
        with open(filepath, encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        sys.exit(f"ERROR: File not found: {filepath}")
    except PermissionError:
        sys.exit(f"ERROR: Permission denied: {filepath}")
    except UnicodeDecodeError:
        sys.exit(f"ERROR: Cannot decode file (binary?): {filepath}")

    # ... scan content ...
```

---

### 5. ESLint Security Rule Governance

**Decision**: Re-enable `detect-object-injection` as error with mandatory `-- SECURITY:` tag for suppressions

**Rationale**:
- Rule was disabled due to false positives, but this loses all protection
- Re-enabling with targeted suppressions maintains coverage
- Mandatory justification tag (`-- SECURITY: <reason>`) prevents suppression creep
- CI can verify all suppressions have tags by comparing grep counts

**Alternatives Considered**:
- Keep rule disabled: Loses security coverage
- Allowlist file: More complex, harder to maintain
- Count cap (max N suppressions): Arbitrary limit, doesn't document reasons

**Implementation Pattern**:
```javascript
// In eslint.config.mjs
import security from 'eslint-plugin-security';

// ... in rules:
'security/detect-object-injection': 'error',

// In code with false positive:
// eslint-disable-next-line security/detect-object-injection -- SECURITY: key is validated string literal from schema
const value = obj[validatedKey];
```

**Verification**:
```bash
# These counts must match:
grep -c "detect-object-injection" extension/ui/*.ts
grep -c "SECURITY:" extension/ui/*.ts
```

---

### 6. Current ESLint Plugin Status

**Finding**: eslint-plugin-security is NOT currently installed

**Action Required**: Install the package before adding rules

```bash
cd extension && npm install --save-dev eslint-plugin-security
```

**Note**: The existing eslint.config.mjs doesn't import or use eslint-plugin-security. This must be added.

---

## Summary of Decisions

| Area | Decision | Key Rationale |
|------|----------|---------------|
| Filename handling | `find -print0 \| xargs -0` + `--` | Prevents option injection, word splitting, newline attacks |
| Shell compatibility | `#!/usr/bin/env bash` + pipefail | Ensures pipeline failures are caught |
| Git validation | `git --version` pattern check | Validates behavior, not location |
| File errors | Fail-closed (exit non-zero) | Security-critical: no silent bypasses |
| ESLint governance | `-- SECURITY:` tag required | Prevents suppression creep |
