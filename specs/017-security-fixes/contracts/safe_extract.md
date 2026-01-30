# Contract: safe_extract module

**Module**: `src/ado_git_repo_insights/utils/safe_extract.py`
**Feature**: 017-security-fixes

## Functions

### `is_symlink_entry(zip_info: ZipInfo) -> bool`

Determine if a ZIP entry is a symlink based on Unix mode bits.

**Parameters**:
- `zip_info`: A `zipfile.ZipInfo` object

**Returns**: `True` if entry is definitively a symlink, `False` otherwise

**Behavior**:
- Extracts Unix mode from `(external_attr >> 16) & 0o170000`
- Returns `True` only if mode equals `0o120000` (S_IFLNK)
- Returns `False` for missing/ambiguous metadata (Windows ZIPs)

---

### `validate_entry_path(entry_name: str, out_dir: Path) -> tuple[bool, str]`

Validate that a ZIP entry path is safe for extraction.

**Parameters**:
- `entry_name`: The path stored in the ZIP entry
- `out_dir`: The target extraction directory

**Returns**: Tuple of `(is_valid, error_message)`

**Validation Checks** (in order):
1. Reject absolute paths (starts with `/` or `\`)
2. Reject path traversal sequences (contains `..`)
3. Reject if resolved path escapes `out_dir`

**Error Messages**:
- `"Absolute path not allowed: {entry_name}"`
- `"Path traversal sequence detected: {entry_name}"`
- `"Path escapes output directory: {entry_name} -> {resolved_path}"`

---

### `safe_extract_zip(zip_path: Path, out_dir: Path) -> None`

Extract a ZIP file safely with Zip Slip protection.

**Parameters**:
- `zip_path`: Path to the ZIP file
- `out_dir`: Final output directory

**Raises**:
- `ZipSlipError`: If any entry fails validation (symlink, traversal, escape)
- `ExtractionError`: If extraction or directory swap fails

**Algorithm**:
1. Create empty temp directory: `out_dir.parent / f".tmp.{uuid4().hex}"`
2. Scan all entries for symlinks → reject if found
3. Validate all entry paths against temp directory
4. Extract valid entries to temp directory
5. Backup existing `out_dir` to `out_dir.bak.<timestamp>` if exists
6. Rename temp directory to `out_dir`
7. Delete backup on success; restore backup on failure

**Guarantees**:
- No files written to `out_dir` if any entry is invalid
- Previous `out_dir` restored if swap fails
- Temp directory cleaned up on success or failure

---

### Exception Classes

```python
class ZipSlipError(Exception):
    """Raised when a ZIP entry fails security validation."""
    def __init__(self, entry_name: str, reason: str):
        self.entry_name = entry_name
        self.reason = reason
        super().__init__(f"Zip Slip attack detected: {reason}")

class ExtractionError(Exception):
    """Raised when extraction or directory swap fails."""
    pass
```

## Usage Example

```python
from pathlib import Path
from ado_git_repo_insights.utils.safe_extract import safe_extract_zip, ZipSlipError

try:
    safe_extract_zip(Path("artifact.zip"), Path("./output"))
except ZipSlipError as e:
    print(f"Security violation in entry '{e.entry_name}': {e.reason}")
except ExtractionError as e:
    print(f"Extraction failed: {e}")
```
