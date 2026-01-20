# copy-vss-sdk.ps1 - Cross-platform script to copy VSS SDK for local testing
# Copies vss-web-extension-sdk from node_modules to ui/ for browser access

$ErrorActionPreference = "SilentlyContinue"

$srcPath = Join-Path $PSScriptRoot "..\node_modules\vss-web-extension-sdk\lib\VSS.SDK.min.js"
$dstPath = Join-Path $PSScriptRoot "..\ui\VSS.SDK.min.js"

if (Test-Path $srcPath) {
    Copy-Item -Path $srcPath -Destination $dstPath -Force
    Write-Host "✓ Copied VSS.SDK.min.js to ui/"
} else {
    Write-Host "ℹ VSS SDK source not found at $srcPath - skipping"
}
