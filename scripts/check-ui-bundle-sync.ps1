# check-ui-bundle-sync.ps1
#
# Verifies that extension/ui/ and src/ado_git_repo_insights/ui_bundle/ are synchronized.
# These two locations must stay in sync because:
#   - extension/ui/ is the source of truth for the Azure DevOps extension
#   - ui_bundle/ is a copy for Python pip package (symlinks don't work with setuptools wheels)
#
# Exit codes:
#   0 - Directories are in sync and committed
#   1 - Directories are out of sync or uncommitted changes detected
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/check-ui-bundle-sync.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

$SourceDir = Join-Path $RepoRoot "extension/ui"
$BundleDir = Join-Path $RepoRoot "src/ado_git_repo_insights/ui_bundle"

# Validate directories exist
if (-not (Test-Path $SourceDir -PathType Container)) {
    Write-Error "Source directory not found: extension/ui/"
    exit 1
}

if (-not (Test-Path $BundleDir -PathType Container)) {
    Write-Error "Bundle directory not found: src/ado_git_repo_insights/ui_bundle/"
    exit 1
}

Write-Host "Synchronizing UI bundle from extension/ui..."
python "$RepoRoot/scripts/sync_ui_bundle.py" --source "$SourceDir" --bundle "$BundleDir"
if ($LASTEXITCODE -ne 0) {
    Write-Error "sync_ui_bundle.py failed"
    exit 1
}

Write-Host "Checking UI bundle synchronization..."
Write-Host "  Source: extension/ui/"
Write-Host "  Bundle: src/ado_git_repo_insights/ui_bundle/"
Write-Host ""

# Compare directories (excluding .map, .DS_Store, etc.)
$ExcludePatterns = @("*.map", ".DS_Store", "*.swp", "*~", "*.bak")

function Get-FilteredFiles {
    param ([string]$Path)
    Get-ChildItem -Path $Path -Recurse -File | Where-Object {
        $file = $_.Name
        $exclude = $false
        foreach ($pattern in $ExcludePatterns) {
            if ($file -like $pattern) {
                $exclude = $true
                break
            }
        }
        -not $exclude
    } | ForEach-Object {
        $_.FullName.Substring($Path.Length + 1).Replace("\", "/")
    }
}

$SourceFiles = Get-FilteredFiles -Path $SourceDir | Sort-Object
$BundleFiles = Get-FilteredFiles -Path $BundleDir | Sort-Object

$DiffFound = $false

# Check for files only in source
$OnlyInSource = $SourceFiles | Where-Object { $BundleFiles -notcontains $_ }
if ($OnlyInSource) {
    Write-Host "Files only in source:"
    $OnlyInSource | ForEach-Object { Write-Host "  + $_" }
    $DiffFound = $true
}

# Check for files only in bundle
$OnlyInBundle = $BundleFiles | Where-Object { $SourceFiles -notcontains $_ }
if ($OnlyInBundle) {
    Write-Host "Files only in bundle:"
    $OnlyInBundle | ForEach-Object { Write-Host "  - $_" }
    $DiffFound = $true
}

# Check for content differences
foreach ($file in $SourceFiles) {
    if ($BundleFiles -contains $file) {
        $srcContent = Get-Content -Path (Join-Path $SourceDir $file) -Raw -ErrorAction SilentlyContinue
        $bundleContent = Get-Content -Path (Join-Path $BundleDir $file) -Raw -ErrorAction SilentlyContinue
        if ($srcContent -ne $bundleContent) {
            Write-Host "Content differs: $file"
            $DiffFound = $true
        }
    }
}

if ($DiffFound) {
    Write-Host ""
    Write-Host "================================================================================"
    Write-Host "UI bundle is OUT OF SYNC with extension/ui/"
    Write-Host "================================================================================"
    Write-Host ""
    Write-Host "HOW TO FIX:"
    Write-Host ""
    Write-Host "  Run: python scripts/sync_ui_bundle.py"
    Write-Host ""
    Write-Host "  Then commit both locations together."
    Write-Host ""
    Write-Host "  WHY: The Python pip package requires actual files (not symlinks) because"
    Write-Host "  setuptools wheel builds don't preserve symlinks. See docs/PHASE7.md for details."
    Write-Host "================================================================================"
    exit 1
}

# Check for uncommitted changes in bundle
$gitStatus = git -C $RepoRoot status --porcelain -- $BundleDir 2>$null
if ($gitStatus) {
    Write-Host "UI bundle sync generated uncommitted changes."
    Write-Host ""
    git -C $RepoRoot status --short -- $BundleDir
    Write-Host ""
    Write-Host "Commit the synchronized UI bundle before merging."
    exit 1
}

Write-Host "[OK] UI bundle is in sync with extension/ui/"
exit 0
