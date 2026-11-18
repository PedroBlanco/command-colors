# Regresion nativa de Command & Colors Web. Windows PowerShell, sin WSL ni Actions.
# El manifiesto unico esta en scripts/check-browser-lab.mjs.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
<<<<<<< HEAD
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
    "packages/sqlite-store/schema-integrity.test.mjs",
    "packages/local-api/browser-session.test.mjs",
    "packages/local-api/browser-gateway.test.mjs",
    "packages/local-api/browser-sqlite-smoke.test.mjs",
    "scripts/check-browser-lab.test.mjs",
    "scripts/browser-lab.launcher.test.mjs",
    "packages/local-api/revision-stream.test.mjs",
    "packages/local-api/browser-ui.test.mjs",
    "packages/turn-phase/phase.test.mjs",
    "packages/command-deck/deck.test.mjs",
    "packages/command-deck/sqlite-game.test.mjs",
    "packages/local-api/command-deck-http.test.mjs",
    "packages/local-api/command-deck-cookie.test.mjs",
    "packages/local-api/deck-controls.test.mjs",
    "packages/local-api/browser-deck-ui.test.mjs",
    "packages/local-api/command-deck-sse.test.mjs",
    "packages/dice-roller/dice.test.mjs",
    "packages/order-validator/validator.test.mjs",
    "packages/order-validator/server-context.test.mjs"
  )
=======
  # Fallar antes de lanzar pruebas si existen suites omitidas, duplicadas o sin archivo.
  & node scripts/check-test-inventory.mjs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  # Node genera rutas validadas. No se construyen comandos PowerShell con texto externo.
  $files = @(& node scripts/list-test-files.mjs)
  if ($LASTEXITCODE -ne 0 -or $files.Count -eq 0) { throw "No se pudo cargar el manifiesto de pruebas" }
>>>>>>> origin/main
  & node --test @files
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
