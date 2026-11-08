# Regresión única de Command & Colors Web. Windows PowerShell, sin WSL ni Actions.
# La lista canónica de suites se mantiene en scripts/check-browser-lab.mjs.
param(
  [string]$Only = "",
  [string]$Log = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $arguments = @("scripts/run-test-suite.mjs")
  if ($Only) { $arguments += "--only=$Only" }
  if ($Log) { $arguments += "--log=$Log" }
  & node @arguments
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
