# Regresión incremental — acceso e integridad SQLite

**Fecha de ejecución:** 8 de noviembre de 2026  
**Rama inspeccionada:** `feat/i4-manual-browser-movement` (PR #48, apilada sobre #47, #46 y #45).

## Resultado

Se recuperaron directamente desde GitHub los **siete archivos originales** (módulos, pruebas y utilidad de mantenimiento) de los paquetes de acceso y ciclo de vida SQLite. Se reconstruyeron en un directorio de trabajo aislado y se comprobó que cada archivo tiene **el mismo SHA de objeto Git** que la versión publicada en la rama.

Las dos suites originales se ejecutaron **juntas** con Node.js v22.16.0 (Linux x64, sin WSL, GitHub Actions ni VPS):

```powershell
node --test packages/access-control/access.test.mjs packages/sqlite-store/lifecycle.test.mjs
```

**Resultado:** `23 tests; 23 pass; 0 fail; 0 skipped; exit code 0`.

| Suite | Tests | Resultado |
| --- | ---: | --- |
| `packages/access-control/access.test.mjs` | 11 | PASS |
| `packages/sqlite-store/lifecycle.test.mjs` | 12 | PASS |
| **Total** | **23** | **PASS** |

Se verificó, entre otros aspectos:

- alta administrativa de cuentas sintéticas y contraseñas, concurrencia de creación, inicio y caducidad de sesiones;
- invitaciones privadas de un solo uso, caducidad/revocación, ausencia de enumeración de cuentas y prohibición de incorporar un tercer jugador;
- control de versiones y esquema SQLite, rechazo de esquemas desconocidos o futuros y mantenimiento de registros existentes;
- copia de una base SQLite viva con WAL, verificación SHA-256 y del esquema, rechazo de datos manipulados y de referencias ajenas;
- restauración a una ubicación nueva, lectura desde otro proceso Node y rechazo de sobrescrituras;
- ejecución real de `scripts/sqlite-maintenance.mjs backup|verify|restore`, incluida la negativa a crear una base si no existe el origen.

## Identidad de los archivos probados

| Archivo | SHA Git (`git hash-object`) |
| --- | --- |
| `packages/access-control/identity.mjs` | `7570a3b1a80c026a0d8fb573ee750d0da2572326` |
| `packages/access-control/invitations.mjs` | `f2aee3de8928e2af4bca156747821d4fb3e91aad` |
| `packages/access-control/access.test.mjs` | `ea99bb4fdd21b3b0d3902139c3107ccdf57c3db3` |
| `packages/sqlite-store/schema-version.mjs` | `5a0afc39b9199fe2ff278f8aa8eabd1a602eeb42` |
| `packages/sqlite-store/backup.mjs` | `10a8d07c3eb7705e3858001765238027437de7a0` |
| `packages/sqlite-store/lifecycle.test.mjs` | `1abbd196567e594d359299a0681b294aefdaf1e6` |
| `scripts/sqlite-maintenance.mjs` | `b9d85f67c7c38ecec3b578ed65819f6573e5d07b` |

## Estado acumulado de regresión

El [informe anterior](35-regresion-22-suites-178.md) acredita **22 suites verificadas conjuntamente y 178 pruebas correctas**. Esta iteración añade **dos suites distintas**, con **23 pruebas correctas en una ejecución conjunta propia**.

Por tanto, hay **24 de las 33 suites con ejecución documentada**, pero **no se ha ejecutado una única batería combinada de las 24 ni de las 33 suites**. No deben presentarse las cifras parciales como una ejecución integral.

**Nueve suites generales aún pendientes:**

```text
packages/local-api/gateway.test.mjs
packages/local-api/compose.test.mjs
packages/sqlite-store/sqlite.test.mjs
packages/local-api/sqlite-compose.test.mjs
packages/sqlite-store/schema-integrity.test.mjs
packages/local-api/browser-gateway.test.mjs
packages/local-api/browser-sqlite-smoke.test.mjs
scripts/browser-lab.launcher.test.mjs
packages/local-api/command-deck-http.test.mjs
```

También sigue pendiente la ejecución completa de `.\\scripts\\test-local.ps1` en Windows 11 y la validación visual PC/móvil del tablero SVG en PR #27. Las pruebas no acreditan reglas oficiales de *Ancients* ni seguridad para Internet. **Mantener en borrador las PR #45–#48 hasta que estas comprobaciones estén resueltas.**
