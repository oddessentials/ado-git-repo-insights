param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

function Test-WriteProbe {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathToCheck
    )

    if (-not (Test-Path -LiteralPath $PathToCheck)) {
        return $null
    }

    $probePath = Join-Path $PathToCheck ".codex-acl-probe.tmp"
    try {
        Set-Content -LiteralPath $probePath -Value "probe" -Encoding ascii -NoNewline
        Remove-Item -LiteralPath $probePath -Force
        return $null
    }
    catch {
        if (Test-Path -LiteralPath $probePath) {
            Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
        }
        return $_.Exception.Message
    }
}

$pathsToCheck = @(
    (Join-Path $RepoRoot ".git")
)

$pathsToCheck += Get-ChildItem -LiteralPath $RepoRoot -Force -Directory -Filter ".pytest-tmp*" -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty FullName

$failures = @()
foreach ($path in $pathsToCheck) {
    $probeError = Test-WriteProbe -PathToCheck $path
    if ($null -ne $probeError) {
        $failures += [PSCustomObject]@{
            Path = $path
            Issue = $probeError
        }
    }
}

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "[acl-health] ❌ Filesystem probe failed" -ForegroundColor Red
    foreach ($failure in $failures) {
        Write-Host ("  - {0}: {1}" -f $failure.Path, $failure.Issue)
    }
    Write-Host ""
    Write-Host "[acl-health] Repair permissions on the failing path before retrying."
    exit 1
}

Write-Host "[acl-health] ✅ Filesystem probe passed"
