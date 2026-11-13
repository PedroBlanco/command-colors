# CCWB laboratory validation on native Windows 11 PowerShell. No WSL, Actions or deployment.
# Uses the repository's manifest-validated Node runner and immutable TAP reports.
[CmdletBinding()]
param(
  [switch]$FullRegression
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$reports = '.local-test-reports'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$targetLog = "$reports/ccwb-http-$stamp.tap"
$fullLog = "$reports/ccwb-all-$stamp.tap"

# These are exact paths in LOCAL_TEST_FILES, not dynamically supplied commands.
$suites = @(
  'packages/local-api/section-history-http-isolation.test.mjs',
  'packages/local-api/browser-sqlite-smoke.test.mjs',
  'packages/local-api/command-deck-sse.test.mjs',
  'packages/local-api/revision-stream-lab-isolation.test.mjs',
  'packages/sqlite-store/sqlite.test.mjs',
  'packages/sqlite-store/ancients-section-history.test.mjs',
  'packages/sqlite-store/wal-transaction-contract.test.mjs',
  'packages/sqlite-store/wal-cross-process-revocation.test.mjs',
  'packages/sqlite-store/section-mutation-session-guard.test.mjs',
  'packages/command-deck/sqlite-game.test.mjs',
  'packages/ancients-rules/sqlite-section-ccwb-bridge.test.mjs',
  'packages/ancients-rules/staged-movement-preflight.test.mjs'
)
Push-Location $root
try {
  & node -e "const v=process.versions.node.split('.').map(Number); process.exit(v[0]>22 || v[0]===22 && v[1]>=16 ? 0 : 2)"
  if ($LASTEXITCODE -ne 0) {
    throw 'Se requiere Node.js 22.16.0 o superior (node:sqlite).'
  }

  foreach ($file in $suites) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw "Falta la suite $file. Comprueba la rama de trabajo y el manifiesto de pruebas."
    }
  }

  Write-Host "CCWB: ejecutando $($suites.Count) suites prioritarias de seguridad con Node.js nativo."
  & node scripts/run-test-suite.mjs "--only=$($suites -join ',')" "--log=$targetLog"
  $targetCode = $LASTEXITCODE
  Write-Host "Informe prioritario: $targetLog"
  if ($targetCode -ne 0) {
    Write-Warning "Las pruebas prioritarias fallaron ($targetCode). No se ejecuta regresión ampliada."
    exit $targetCode
  }

  if ($FullRegression) {
    Write-Host 'CCWB: iniciando regresión total según el manifiesto del repositorio.'
    & node scripts/run-test-suite.mjs "--log=$fullLog"
    $fullCode = $LASTEXITCODE
    Write-Host "Informe regresión total: $fullLog"
    if ($fullCode -ne 0) { exit $fullCode }
  }
  Write-Host 'CCWB: validación local correcta. No se ha iniciado ni desplegado ningún servidor.'
} catch {
  Write-Error $_
  exit 2
} finally {
  Pop-Location
}
