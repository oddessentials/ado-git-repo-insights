# Research: Security Hardening - Zip Slip Protection & Token Encoding

**Feature**: 017-security-fixes
**Date**: 2026-01-30

## Research Topics

### 1. Python `zipfile` Symlink Detection

**Question**: How to detect symlink entries in ZIP files using Python's `zipfile` module?

**Decision**: Use Unix mode bits from `ZipInfo.external_attr`

**Rationale**: Python's `zipfile` module doesn't expose a first-class `is_symlink()` method. However, Unix ZIP creators store file mode in the upper 16 bits of `external_attr`. Symlinks have mode `0o120000` (S_IFLNK).

**Implementation**:
```python
def is_symlink(zip_info: zipfile.ZipInfo) -> bool:
    """Check if ZIP entry is a symlink via Unix mode bits."""
    # Unix mode is stored in upper 16 bits of external_attr
    unix_mode = (zip_info.external_attr >> 16) & 0o170000
    return unix_mode == 0o120000  # S_IFLNK
```

**Alternatives Considered**:
- `zip_info.is_symlink()` - Does not exist in stdlib
- Check filename patterns - Unreliable, symlinks have no naming convention
- Third-party library (e.g., `patool`) - Adds dependency, overkill for detection

**Limitations**:
- Windows-created ZIPs may not preserve Unix mode bits
- Per spec clarification: treat ambiguous/missing metadata as regular files and validate via path containment

### 2. Cross-Platform Directory Rename Semantics

**Question**: How to atomically swap directories on both Linux and Windows?

**Decision**: Use `shutil.move()` with backup-then-swap pattern

**Rationale**:
- `os.rename()` fails on Windows if destination exists
- `os.replace()` works for files but not directories on Windows
- `shutil.move()` handles cross-platform semantics consistently

**Implementation Pattern**:
```python
import shutil
import time
from pathlib import Path

def safe_swap(temp_dir: Path, out_dir: Path) -> None:
    """Atomically swap temp_dir to out_dir with backup recovery."""
    backup_dir = None

    if out_dir.exists():
        timestamp = int(time.time())
        backup_dir = out_dir.parent / f"{out_dir.name}.bak.{timestamp}"
        shutil.move(str(out_dir), str(backup_dir))

    try:
        shutil.move(str(temp_dir), str(out_dir))
    except Exception:
        # Restore backup on failure
        if backup_dir and backup_dir.exists():
            shutil.move(str(backup_dir), str(out_dir))
        raise

    # Clean up backup only after successful swap
    if backup_dir and backup_dir.exists():
        shutil.rmtree(backup_dir)
```

**Alternatives Considered**:
- `os.rename()` only - Fails if `out_dir` exists on Windows
- Delete-then-rename - Loses data if rename fails (rejected per spec)
- `pathlib.Path.replace()` - Only works for files, not directories

### 3. URL Encoding for Continuation Tokens

**Question**: Which URL encoding function to use for query string parameters?

**Decision**: Use `urllib.parse.quote_plus()`

**Rationale**:
- `quote_plus()` encodes spaces as `+` (standard for query strings per RFC 3986)
- `quote()` encodes spaces as `%20` (correct for path segments, not query params)
- Azure DevOps APIs expect standard query string encoding

**Implementation**:
```python
from urllib.parse import quote_plus, urlencode

def build_paginated_url(base_url: str, continuation_token: str | None) -> str:
    """Build URL with properly encoded continuation token."""
    if not continuation_token:
        return base_url

    # Use quote_plus for query string parameter encoding
    encoded_token = quote_plus(continuation_token)
    separator = "&" if "?" in base_url else "?"
    return f"{base_url}{separator}continuationToken={encoded_token}"
```

**Alternative Approach** (recommended for multiple params):
```python
from urllib.parse import urlencode, urlparse, parse_qs, urlunparse

def add_continuation_token(url: str, token: str | None) -> str:
    """Add continuation token to URL using urlencode for safety."""
    if not token:
        return url

    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    params["continuationToken"] = [token]
    new_query = urlencode(params, doseq=True)
    return urlunparse(parsed._replace(query=new_query))
```

**Alternatives Considered**:
- `quote()` - Wrong encoding for query strings (encodes space as `%20` not `+`)
- Manual string concatenation - Current approach, vulnerable to special chars
- Third-party `yarl` or `furl` - Adds dependency, stdlib sufficient

### 4. CI Guard Implementation

**Question**: How to implement a CI check that fails if `continuationToken` appears outside allowlisted paths?

**Decision**: Use `ripgrep` (`rg`) with exit code check in GitHub Actions

**Rationale**:
- `rg` is fast and available in GitHub Actions runners
- Simple pattern matching sufficient (no AST parsing needed)
- Exit code 0 = matches found (fail CI), exit code 1 = no matches (pass CI)

**Implementation**:
```yaml
# .github/workflows/ci.yml
- name: Guard continuationToken usage
  run: |
    # Find continuationToken outside allowed paths
    # Allowed: pagination.py, test_pagination_helper.py, fixtures/
    if rg -l 'continuationToken' \
        --glob '!**/pagination.py' \
        --glob '!**/test_pagination_helper.py' \
        --glob '!**/test_ado_client_pagination.py' \
        --glob '!tests/fixtures/**' \
        --glob '!specs/**' \
        src/ tests/; then
      echo "ERROR: continuationToken found outside allowed paths"
      echo "Use the pagination helper instead of direct token handling"
      exit 1
    fi
```

**Alternatives Considered**:
- Custom pylint plugin - More complex, requires plugin maintenance
- Pre-commit hook - Only catches local commits, not all CI scenarios
- `grep` - Slower, less flexible glob support

### 5. Path Containment Validation

**Question**: How to correctly validate that a ZIP entry path stays within the output directory?

**Decision**: Use `Path.resolve()` and `Path.is_relative_to()` (Python 3.9+)

**Rationale**:
- `resolve()` canonicalizes the path, following symlinks and resolving `..`
- `is_relative_to()` (3.9+) is the clean way to check containment
- Must validate the resolved path, not just string patterns

**Implementation**:
```python
from pathlib import Path

def validate_zip_entry_path(entry_name: str, out_dir: Path) -> tuple[bool, str]:
    """
    Validate that ZIP entry path is safe for extraction.

    Returns (is_valid, error_message).
    """
    # Reject absolute paths
    if entry_name.startswith('/') or entry_name.startswith('\\'):
        return False, f"Absolute path not allowed: {entry_name}"

    # Reject explicit traversal sequences (defense in depth)
    if '..' in entry_name:
        return False, f"Path traversal sequence detected: {entry_name}"

    # Resolve the full target path
    target_path = (out_dir / entry_name).resolve()
    out_dir_resolved = out_dir.resolve()

    # Verify containment
    try:
        target_path.relative_to(out_dir_resolved)
    except ValueError:
        return False, f"Path escapes output directory: {entry_name} -> {target_path}"

    return True, ""
```

**Alternatives Considered**:
- String prefix check (`str(path).startswith(str(out_dir))`) - Fails with symlinks
- Only check for `..` - Insufficient, symlinks can bypass
- `os.path.commonpath()` - More complex, `is_relative_to()` is cleaner

### 6. Token Source Audit Results

**Question**: Do any existing code paths pass pre-encoded continuation tokens?

**Audit Findings**:

Searched all 4 paginated endpoints in `ado_client.py`:

1. **Pull Requests** (line 256): Token comes from response header `x-ms-continuationtoken`
2. **Teams** (line 311): Token comes from response JSON `continuationToken` field
3. **Team Members** (line 361): Token comes from response JSON `continuationToken` field
4. **PR Threads** (line 420): Token comes from response JSON `continuationToken` field

**Decision**: All tokens originate as raw values from ADO API responses. No pre-encoded tokens exist in current codebase.

**Rationale**: Enforce hard rule - reject pre-encoded tokens. No compatibility path needed.

## Summary

| Topic | Decision | Key Insight |
|-------|----------|-------------|
| Symlink detection | Unix mode bits `(external_attr >> 16) & 0o170000 == 0o120000` | Ambiguous entries treated as regular files |
| Directory swap | `shutil.move()` with backup-then-restore | Cross-platform safe, recoverable on failure |
| Token encoding | `urllib.parse.quote_plus()` | Encodes spaces as `+` per query string convention |
| CI guard | `rg` with glob exclusions | Fast, simple, no AST parsing needed |
| Path validation | `Path.resolve()` + `is_relative_to()` | Must use resolved paths, not string matching |
| Token source audit | All raw from API responses | Enforce hard rule, no compatibility path |
