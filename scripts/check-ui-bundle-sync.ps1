$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

if (Get-Command py -ErrorAction SilentlyContinue) {
    $Python = @("py", "-3")
}
elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $Python = @("python")
}
elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
    $Python = @("python3")
}
else {
    Write-Error "Python is required to verify generated UI artifacts."
    exit 1
}

Push-Location $RepoRoot
if ($Python.Length -gt 1) {
    & $Python[0] @($Python[1..($Python.Length - 1)]) "scripts/manage_generated_artifacts.py" "verify" "--scope" "ui"
}
else {
    & $Python[0] "scripts/manage_generated_artifacts.py" "verify" "--scope" "ui"
}
$ExitCode = $LASTEXITCODE
Pop-Location
exit $ExitCode
