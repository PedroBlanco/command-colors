# Regresión incremental de pasarela y composición HTTP — 36 pruebas

**Fecha:** 8 de noviembre de 2026  
**Rama:** `feat/i4-manual-browser-movement` (PR #48 apilada sobre PR #47, #46 y #45).

## Resultado ejecutado

Se han ejecutado **juntas** las cuatro suites originales del repositorio recuperadas de GitHub y cotejadas por SHA Git:

```powershell
node --test packages/access-control/access.test.mjs packages/sqlite-store/lifecycle.test.mjs packages/local-api/gateway.test.mjs packages/local-api/compose.test.mjs
```

**Node.js v22.16.0** (entorno aislado Linux x64, sin WSL, VPS ni GitHub Actions); **36 pruebas, 36 PASS, 0 FAIL, 0 SKIPPED, exit code 0**.

| Suite | Pruebas | Resultado |
| --- | ---: | --- |
| `packages/access-control/access.test.mjs` | 11 | PASS |
| `packages/sqlite-store/lifecycle.test.mjs` | 12 | PASS |
| `packages/local-api/gateway.test.mjs` | 8 | PASS |
| `packages/local-api/compose.test.mjs` | 5 | PASS |
| **Total** | **36** | **PASS** |

Se verificaron por su SHA de objeto Git los archivos **exactos** de las cuatro suites y sus dependencias. Entre ellos:

| Archivo | SHA Git |
| --- | --- |
| `packages/local-api/gateway.mjs` | `8c00ca9f69c56516b154d0ff3abdd17b565bf70f` |
| `packages/local-api/gateway.test.mjs` | `b363ae6f27f45a41ef873fac4f59aec5629424ce` |
| `packages/local-api/browser-session.mjs` | `0d23fc813d515bc3a618752426f4f0f0064852b9` |
| `packages/local-api/revision-stream.mjs` | `1f18134d3919faacae8ff9797d90c092604168da` |
| `packages/local-api/compose.mjs` | `8d02ddbfc7c2bf02577aa281cad7a481bb56fb3c` |
| `packages/local-api/compose.test.mjs` | `da132cc7b0febd7913b1e93b0972d36366737bd5` |
| `packages/match-store/store.mjs` | `f92a687bcf6741d80a98f0f451d11fcd71df0503` |

Los hashes adicionales de acceso, respaldo y SQLite se enumeran en el [informe anterior](36-regresion-acceso-backup-23.md), con el cual esta ejecución es consistente.

## Cobertura adicional

- **Pasarela HTTP (8 tests):** inicio de sesión, configuración de caché, autorización y privacidad de los dos jugadores, rechazo de un tercero, identidad del actor derivada de sesión frente a falsificaciones, aislamiento entre partidas, límites de tamaño, errores genéricos y revocación de sesión.
- **Composición de servicios (5 tests):** dos participantes autenticados, invitaciones, asignación de bandos, revisión e idempotencia, rechazo de movimientos de turno concurrentes, aislamiento de dos partidas y caducidad de sesión.
- **Respaldo SQLite (12 tests):** copia consistente de WAL, integridad de esquema y SHA-256, restauración verificable en otro proceso y ausencia de sobrescrituras.
- **Control de acceso (11 tests):** altas de cuentas sintéticas, invitaciones de un uso, expiración, revocación y exclusión de terceros.

## Estado de la regresión total

En la iteración anterior se habían ejecutado conjuntamente **22 de 33 suites, 178 pruebas**. Esta ronda ha ejecutado **cuatro suites adicionales distintas (36 pruebas)** y deja **26 de 33 suites con ejecución documentada**. No se ha realizado todavía una única ejecución conjunta de las 26 ni de las 33: **no debe comunicarse la suma como si procediera de una batería única**.

**Siete suites todavía pendientes:**

```text
packages/sqlite-store/sqlite.test.mjs
packages/local-api/sqlite-compose.test.mjs
packages/sqlite-store/schema-integrity.test.mjs
packages/local-api/browser-gateway.test.mjs
packages/local-api/browser-sqlite-smoke.test.mjs
scripts/browser-lab.launcher.test.mjs
packages/local-api/command-deck-http.test.mjs
```

Falta también la ejecución completa del script en Windows PowerShell y la comprobación visual PC/móvil, especialmente la PR #27 (tablero SVG). Esta evidencia no acredita reglas oficiales de *Ancients* ni seguridad para desplegar el prototipo en Internet. Las PR #45–#48 deben permanecer en borrador hasta completar los requisitos de verificación.
