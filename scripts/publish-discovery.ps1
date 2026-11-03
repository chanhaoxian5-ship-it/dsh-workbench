param(
    [Parameter(Mandatory = $true)][string]$Payload,
    [int]$Port = 8765,
    [string]$DataDir = (Join-Path $PSScriptRoot '../data'),
    [int]$Attempts = 3,
    [int]$Timeout = 10
)
$repoRoot = Split-Path $PSScriptRoot -Parent
$previousPythonPath = $env:PYTHONPATH
try {
    $env:PYTHONPATH = Join-Path $repoRoot 'backend'
    & python -m workbench.publish $Payload --port $Port --data-dir $DataDir --attempts $Attempts --timeout $Timeout
    $publishExitCode = $LASTEXITCODE
} finally {
    $env:PYTHONPATH = $previousPythonPath
}
exit $publishExitCode
