# Quickstart: Testing Security Hardening

**Feature**: 017-security-fixes
**Date**: 2026-01-30

## Prerequisites

```bash
# Install dev dependencies
pip install -e ".[dev]"
```

## Running Tests

### All Security Tests

```bash
# Run all new security-related tests
pytest tests/unit/test_safe_extract.py tests/unit/test_pagination_helper.py -v
```

### Zip Slip Tests Only

```bash
pytest tests/unit/test_safe_extract.py -v
```

Expected test cases:
- `test_valid_zip_extracts_successfully` - Normal ZIP works
- `test_symlink_entry_rejected` - ZIP with symlink fails before extraction
- `test_traversal_path_rejected` - ZIP with `../../evil.txt` fails
- `test_absolute_path_rejected` - ZIP with `/etc/passwd` fails
- `test_backup_restored_on_swap_failure` - Recovery works
- `test_ambiguous_entry_validated_via_path` - Non-Unix ZIP falls back to path check

### Pagination Tests Only

```bash
pytest tests/unit/test_pagination_helper.py -v
```

Expected test cases:
- `test_token_with_special_chars_encoded` - `&`, `=`, `+`, space encoded
- `test_token_as_single_parameter` - `&foo=bar` stays single value
- `test_none_token_unchanged` - No token = no modification
- `test_existing_params_preserved` - URL with `?api-version=7.0` works

### Integration Tests

```bash
pytest tests/integration/test_stage_artifacts.py -v -k security
```

## Manual Testing

### Create Test ZIP with Symlink (Linux/macOS)

```bash
# Create a symlink-containing ZIP for testing
mkdir -p /tmp/test_zip
cd /tmp/test_zip
echo "safe content" > safe.txt
ln -s /etc/passwd evil_link
zip -y malicious_symlink.zip safe.txt evil_link
```

### Create Test ZIP with Path Traversal

```bash
# Using Python to create traversal ZIP
python3 -c "
import zipfile
with zipfile.ZipFile('malicious_traversal.zip', 'w') as zf:
    zf.writestr('safe.txt', 'safe content')
    zf.writestr('../../evil.txt', 'malicious content')
"
```

### Test Extraction Manually

```python
from pathlib import Path
from ado_git_repo_insights.utils.safe_extract import safe_extract_zip, ZipSlipError

# Should succeed
safe_extract_zip(Path("safe.zip"), Path("./output"))

# Should fail with ZipSlipError
try:
    safe_extract_zip(Path("malicious_traversal.zip"), Path("./output"))
except ZipSlipError as e:
    print(f"Blocked: {e.entry_name} - {e.reason}")
```

### Test Token Encoding Manually

```python
from ado_git_repo_insights.extractor.pagination import add_continuation_token

# Test special characters
url = "https://dev.azure.com/org/_apis/teams"
token = "abc&foo=bar+space here"
result = add_continuation_token(url, token)
print(result)
# Expected: ...?continuationToken=abc%26foo%3Dbar%2Bspace+here
```

## CI Guard Verification

```bash
# Simulate CI guard locally
rg -l 'continuationToken' \
    --glob '!**/pagination.py' \
    --glob '!**/test_pagination_helper.py' \
    --glob '!**/test_ado_client_pagination.py' \
    --glob '!tests/fixtures/**' \
    --glob '!specs/**' \
    src/ tests/

# If this returns matches, those files need to use the pagination helper
```

## Coverage Check

```bash
# Ensure 75% coverage floor maintained
pytest --cov=ado_git_repo_insights --cov-fail-under=75
```

## Checklist Before PR

- [ ] All `test_safe_extract.py` tests pass
- [ ] All `test_pagination_helper.py` tests pass
- [ ] CI guard finds no violations
- [ ] Coverage >= 75%
- [ ] No ruff lint errors
- [ ] mypy passes (if enabled)
