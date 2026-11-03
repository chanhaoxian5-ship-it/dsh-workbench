param(
    [Parameter(Mandatory = $true)][string]$Collection,
    [Parameter(Mandatory = $true)][string]$Payload,
    [string]$Workspace = '',
    [int]$Port = 8765,
    [string]$DataDir = (Join-Path $PSScriptRoot '../data'),
    [int]$Attempts = 3
)
$repoRoot = Split-Path $PSScriptRoot -Parent
$previousPythonPath = $env:PYTHONPATH
try {
    $env:PYTHONPATH = Join-Path $repoRoot 'backend'
    $projectArgs = @('-m', 'workbench.project_publish', $Collection, $Payload, '--port', "$Port", '--data-dir', $DataDir, '--attempts', "$Attempts")
    if ($Workspace) { $projectArgs += @('--workspace', $Workspace) }
    & python @projectArgs
    $publishExitCode = $LASTEXITCODE
} finally {
    $env:PYTHONPATH = $previousPythonPath
}
exit $publishExitCode
