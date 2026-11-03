$repoRoot = Split-Path $PSScriptRoot -Parent
$previousPythonPath = $env:PYTHONPATH
try {
    $env:PYTHONPATH = Join-Path $repoRoot 'backend'
    & python -m unittest discover -s (Join-Path $repoRoot 'tests') -v
    if ($LASTEXITCODE -ne 0) { throw "Tests failed with exit code $LASTEXITCODE" }
} finally {
    $env:PYTHONPATH = $previousPythonPath
}
