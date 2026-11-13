# Wrapper for the same native Node.js CCWB security validation on Windows 11.
# One canonical list of 12 suites lives in validate-ccwb-http.mjs.
# No WSL, Docker, GitHub Actions, server startup or deployment.
[CmdletBinding()]
param(
  [switch]$FullRegression
)
$ErrorActionPreference = 'Stop'
$validator = Join-Path $PSScriptRoot 'validate-ccwb-http.mjs'
try {
  if ($FullRegression) {
    & node $validator '--full'
  } else {
    & node $validator
  }
  $code = $LASTEXITCODE
  if ($code -ne 0) { exit $code }
} catch {
  Write-Error $_
  exit 2
}
