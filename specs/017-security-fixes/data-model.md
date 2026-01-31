# Data Model: Security Hardening - Zip Slip Protection & Token Encoding

**Feature**: 017-security-fixes
**Date**: 2026-01-30

## Overview

This feature does not introduce new persistent data entities. It modifies the behavior of existing extraction and pagination flows with validation logic.

## Validation Entities (Runtime Only)

### ZipEntryValidation

Represents the validation state of a single ZIP archive entry during extraction.

| Attribute | Type | Description |
|-----------|------|-------------|
| `entry_name` | `str` | Original path from ZIP archive |
| `is_symlink` | `bool` | True if Unix mode bits indicate symlink |
| `target_path` | `Path` | Resolved absolute path after joining to output dir |
| `is_valid` | `bool` | True if entry passes all validation checks |
| `error_message` | `str` | Reason for rejection if invalid |

**Validation Rules**:
1. Symlink entries (detectable via `external_attr`) → REJECT
2. Absolute paths (`/` or `\` prefix) → REJECT
3. Path traversal sequences (`..`) → REJECT
4. Resolved path outside output directory → REJECT
5. All other entries → VALID (extract normally)

**State Transitions**:
```
PENDING → SCANNED → VALID | REJECTED
```

### ExtractionContext

Represents the state of a ZIP extraction operation.

| Attribute | Type | Description |
|-----------|------|-------------|
| `zip_path` | `Path` | Source ZIP file path |
| `out_dir` | `Path` | Final output directory |
| `temp_dir` | `Path` | Temporary extraction directory |
| `backup_dir` | `Path | None` | Backup of existing `out_dir` if it existed |
| `state` | `ExtractionState` | Current operation state |

**State Transitions**:
```
INIT → SCANNING → EXTRACTING → SWAPPING → COMPLETE
                     ↓            ↓
                  FAILED ← ← ← FAILED (restore backup)
```

### ContinuationToken

Represents a pagination token from Azure DevOps API.

| Attribute | Type | Description |
|-----------|------|-------------|
| `raw_value` | `str | None` | Token value from API response (raw, never pre-encoded) |
| `source` | `TokenSource` | Where token was extracted from |

**TokenSource Enum**:
- `HEADER` - From `x-ms-continuationtoken` response header
- `BODY` - From JSON response `continuationToken` field

**Invariants**:
- Tokens are always stored as raw values
- Encoding happens exactly once at URL construction time
- Empty/null tokens indicate final page

## Relationships

```
ZipFile 1──* ZipEntryValidation
    │
    └── ExtractionContext 1──1 temp_dir
                          1──? backup_dir

ADOResponse 1──? ContinuationToken
    │
    └── PaginatedRequest *──1 ContinuationToken (encoded at URL construction)
```

## No Schema Changes

This feature does not modify:
- SQLite database schema
- CSV output columns
- Pipeline artifact structure
- PowerBI data model

All changes are internal validation logic with no external contract impact.
