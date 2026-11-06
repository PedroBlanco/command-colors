# Pruebas locales de contratos experimentales; Windows PowerShell/PowerShell 7, sin WSL.
# No despliega servidores ni requiere GitHub Actions.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
$files = @(
  "packages/hex-grid/hex.test.mjs",
  "spikes/004/server.test.mjs",
  "packages/access-control/access.test.mjs",
  "packages/match-store/store.test.mjs",
  "packages/local-api/gateway.test.mjs",
  "packages/local-api/compose.test.mjs",
  "packages/sqlite-store/sqlite.test.mjs",
  "packages/local-api/sqlite-compose.test.mjs",
  "packages/sqlite-store/lifecycle.test.mjs",
  "packages/local-api/browser-session.test.mjs",
  "packages/local-api/browser-gateway.test.mjs"
)
& node --test @files
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
