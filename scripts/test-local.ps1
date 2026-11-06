# Comando único de regresión de Command & Colors Web I2, Windows PowerShell.
# Ejecuta pruebas locales Node.js; no despliega servicios ni usa WSL/Actions.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
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
    "packages/local-api/browser-gateway.test.mjs",
    "packages/local-api/browser-sqlite-smoke.test.mjs",
    "scripts/check-browser-lab.test.mjs"
  )
  & node --test @files
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
