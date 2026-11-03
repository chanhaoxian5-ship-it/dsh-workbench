param(
    [Parameter(Mandatory = $true)][ValidateSet('check', 'backup', 'restore')][string]$Action,
    [Parameter(Mandatory = $true)][string]$Source,
    [string]$Destination = ''
)
$repoRoot = Split-Path $PSScriptRoot -Parent
$previousPythonPath = $env:PYTHONPATH
try {
    $env:PYTHONPATH = Join-Path $repoRoot 'backend'
    $maintenanceArgs = @('-m', 'workbench.maintenance', $Action, $Source)
    if ($Destination) { $maintenanceArgs += $Destination }
    & python @maintenanceArgs
    $maintenanceExitCode = $LASTEXITCODE
} finally {
    $env:PYTHONPATH = $previousPythonPath
}
exit $maintenanceExitCode
