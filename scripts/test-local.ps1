# Regresion nativa de Command & Colors Web. Windows PowerShell, sin WSL ni Actions.
# El manifiesto unico esta en scripts/check-browser-lab.mjs.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  # Fallar antes de lanzar pruebas si existen suites omitidas, duplicadas o sin archivo.
  & node scripts/check-test-inventory.mjs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  # Node genera rutas validadas. No se construyen comandos PowerShell con texto externo.
  $files = @(& node scripts/list-test-files.mjs)
  if ($LASTEXITCODE -ne 0 -or $files.Count -eq 0) { throw "No se pudo cargar el manifiesto de pruebas" }
  & node --test @files
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
