param(
    [ValidateSet('start','stop','restart','status','mcpConfig')][string]$Action = 'status',
    [string]$DataDir = (Join-Path $env:USERPROFILE '.dsh/storages/workbench'),
    [string]$PythonPath = 'python'
)
& node (Join-Path $PSScriptRoot 'control.mjs') $Action --data-dir $DataDir --python $PythonPath
exit $LASTEXITCODE
