param(
    [ValidateSet('start','stop','restart','status','mcpConfig')][string]$Action = 'status',
    [string]$DataDir = (Join-Path $env:USERPROFILE '.dsh/storages/workbench'),
    [string]$PythonPath = 'python',
    [string]$ProjectDir
)
$workbenchArgs = @($Action, '--data-dir', $DataDir, '--python', $PythonPath)
if ($ProjectDir) { $workbenchArgs += @('--project-dir', $ProjectDir) }
& node (Join-Path $PSScriptRoot 'control.mjs') @workbenchArgs
exit $LASTEXITCODE
