# Research: Address Review Feedback for Unified Dashboard Serve

**Feature Branch**: `002-serve-review-fixes`
**Created**: 2026-01-26

## Research Summary

This document captures technical research and decisions for Flight 20260126B review fixes. All research items were resolved through code inspection - no external research was required.

---

## R1: PowerShell Warning Output Strategy

**Question**: How should warnings be output in PowerShell scripts for maximum visibility?

**Decision**: Use `Write-Warning` with `[specify]` prefix

**Rationale**:
- `Write-Warning` outputs to the warning stream, which is visible by default
- The `[specify]` prefix provides context and matches existing patterns (see common.ps1 line 78)
- Warning stream is separate from stdout, preserving JSON output integrity when `-Json` flag is used
- Users can suppress with `-WarningAction SilentlyContinue` if needed

**Alternatives Considered**:
| Alternative | Why Rejected |
|------------|--------------|
| Write-Host | Mixes with stdout, can interfere with script output |
| Write-Verbose | Hidden by default, requires -Verbose to see |
| Write-Error | Too severe for non-fatal situations |
| stderr via [Console]::Error | Inconsistent with PowerShell conventions |

---

## R2: Branch Collision Detection and Resolution

**Question**: How should the system handle branch name collisions after truncation?

**Decision**: Check local and remote branches; append 6-char hash suffix on collision

**Rationale**:
- 6-character hash provides sufficient uniqueness (16 million combinations)
- Hash derived from full original branch name ensures deterministic collision resolution
- Same input always produces same hash, preventing duplicate suffixes
- Format: `NNN-truncated-name-abc123` is human-readable

**Implementation Details**:
```powershell
function Get-ShortHash {
    param([string]$Input)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Input)
    $hash = $sha256.ComputeHash($bytes)
    return ([System.BitConverter]::ToString($hash) -replace '-','').Substring(0,6).ToLower()
}

function Test-BranchExists {
    param([string]$BranchName)
    # Check local branches
    $localMatch = git branch --list $BranchName 2>$null
    if ($localMatch) { return $true }

    # Check remote branches
    $remoteMatch = git branch -r --list "*/$BranchName" 2>$null
    if ($remoteMatch) { return $true }

    return $false
}
```

**Alternatives Considered**:
| Alternative | Why Rejected |
|------------|--------------|
| Increment suffix (-1, -2) | Requires state tracking, not deterministic |
| Fail and prompt user | Poor automation experience |
| Use UUID suffix | Too long, reduces readable portion |
| Use timestamp | Time-dependent, not reproducible |

---

## R3: PowerShell Regex Escaping Requirements

**Question**: Which values need regex escaping in template replacement?

**Decision**: Escape all user-provided values used in `-replace` operations

**Rationale**:
- PowerShell `-replace` treats both pattern AND replacement as regex
- User input may contain: `$`, `\`, `^`, `.`, `*`, `+`, `?`, `[`, `]`, `(`, `)`, `{`, `}`
- `[Regex]::Escape()` handles all special characters properly

**Affected Code Locations** (update-agent-context.ps1):
| Line | Variable | Risk |
|------|----------|------|
| 225 | $content -replace '\[PROJECT NAME\]',$ProjectName | Project name may contain special chars |
| 238 | $techStackForTemplate | Contains user description text |
| 241 | $escapedStructure | Already uses Escape - KEEP |
| 244 | $commands | Generated, lower risk but escape anyway |
| 256 | $recentChangesForTemplate | Contains branch name |
| 279-285 | $escapedTechStack, $escapedDB | Already escaped - GOOD |
| 291-292 | $newChangeEntry | Contains branch name, tech stack |

**Fix Pattern**:
```powershell
# Before (vulnerable)
$content = $content -replace '\[PROJECT NAME\]',$ProjectName

# After (safe)
$escapedProjectName = [Regex]::Escape($ProjectName)
$content = $content -replace '\[PROJECT NAME\]',$escapedProjectName
```

**Note**: The pattern side (left of -replace) uses literal regex, which is safe since we control those strings.

---

## R4: Template Placeholder Validation Strategy

**Question**: How should the system handle missing placeholders in templates?

**Decision**: Validate required placeholders, warn on missing optional ones, continue execution

**Rationale**:
- Templates may be customized by users; not all placeholders are required
- Hard failure on missing placeholder is too strict for optional fields
- Validation should distinguish required vs optional placeholders
- Warning provides visibility without blocking workflow

**Required Placeholders** (must exist):
- `[PROJECT NAME]` - Core identity
- `[DATE]` - Timestamp

**Optional Placeholders** (warn if missing):
- `[EXTRACTED FROM ALL PLAN.MD FILES]`
- `[ACTUAL STRUCTURE FROM PLANS]`
- `[ONLY COMMANDS FOR ACTIVE TECHNOLOGIES]`
- `[LANGUAGE-SPECIFIC, ONLY FOR LANGUAGES IN USE]`
- `[LAST 3 FEATURES AND WHAT THEY ADDED]`

**Implementation**:
```powershell
function Test-RequiredPlaceholders {
    param([string]$Content, [string[]]$Required)
    $missing = @()
    foreach ($placeholder in $Required) {
        if ($Content -notmatch [Regex]::Escape($placeholder)) {
            $missing += $placeholder
        }
    }
    return $missing
}
```

---

## R5: Python Function Decomposition Strategy

**Question**: How should `_serve_dashboard` be decomposed?

**Decision**: Three focused functions with clear single responsibilities

**Current Function Analysis** (lines 1298-1449, ~150 lines):

| Responsibility | Lines | Complexity |
|----------------|-------|------------|
| Dev mode UI sync | 1343-1364 | Medium (file I/O, validation) |
| Serve directory prep | 1370-1408 | Medium (temp dir, file copy) |
| HTTP server execution | 1414-1448 | Low (server loop) |

**Proposed Decomposition**:

```python
def _sync_ui_bundle_if_needed(ui_source: Path) -> Optional[str]:
    """Sync UI bundle from extension/dist/ui in dev mode.

    Returns error message if sync fails, None on success.
    """
    ...

def _prepare_serve_directory(
    ui_source: Path,
    dataset_path: Path
) -> ContextManager[Path]:
    """Create and populate temporary serve directory.

    Returns context manager yielding serve directory path.
    """
    ...

def _run_http_server(
    serve_dir: Path,
    port: int,
    open_browser: bool
) -> int:
    """Run HTTP server and handle keyboard interrupt.

    Returns exit code.
    """
    ...
```

**Benefits**:
- Each function is independently testable
- Clear separation of concerns
- Easier to modify one aspect without affecting others
- Better error handling isolation

---

## R6: Shared Flag Validation Design

**Question**: How should the shared validation function be structured?

**Decision**: Single validation function returning Optional[int] (exit code or None)

**Current Duplication**:
- `cmd_build_aggregates` lines 803-815
- `cmd_stage_artifacts` lines 1104-1116
- Identical logic, identical error messages

**Proposed Function**:
```python
def _validate_serve_flags(args: Namespace) -> Optional[int]:
    """Validate --serve related flags.

    Args:
        args: Parsed command line arguments

    Returns:
        1 if validation fails (exit code), None if valid
    """
    serve = getattr(args, "serve", False)
    open_browser = getattr(args, "open", False)
    port = getattr(args, "port", 8080)

    if not serve and (open_browser or port != 8080):
        invalid_flags = []
        if open_browser:
            invalid_flags.append("--open")
        if port != 8080:
            invalid_flags.append("--port")
        logger.error(f"{', '.join(invalid_flags)} requires --serve")
        return 1

    return None
```

**Usage**:
```python
def cmd_build_aggregates(args: Namespace) -> int:
    if (exit_code := _validate_serve_flags(args)) is not None:
        return exit_code
    # ... rest of function
```

---

## R7: Technology Patterns Configuration (P3 - Deferred)

**Question**: Should technology patterns be externalized?

**Decision**: Defer to future flight

**Rationale**:
- Current patterns in speckit.implement.md work for most use cases
- Externalization adds complexity (YAML parsing, validation, defaults)
- Low priority compared to other fixes
- Can be addressed when specific user feedback requests it

**Future Implementation Notes** (for reference):
- Config file: `.specify/config/technology-patterns.yaml`
- Schema should include: pattern name, extensions, ignore patterns
- Must provide sensible defaults when config missing
- Should merge user patterns with defaults, not replace

---

## Conclusion

All research items resolved. Technical approach validated through code inspection. Ready to proceed to task generation.
