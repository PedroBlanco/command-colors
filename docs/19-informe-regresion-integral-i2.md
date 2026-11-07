# Informe de regresión integral I2 — 7 de noviembre de 2026

**Rama ensayada:** `test/i2-first-validation` (PR #35, sobre PR #34). **Entorno:** Node.js **22.16.0** en Linux de laboratorio local, sin WSL, sin despliegue, sin PostgreSQL y sin GitHub Actions. La ejecución sobre Windows 11 y la comprobación visual siguen siendo validaciones independientes.

## Resultado

**93 pruebas superadas, 0 fallos, 0 omitidas**, ejecutando **las 15 suites juntas** en un único comando `node --test`, equivalente a la lista de archivos del script `scripts/test-local.ps1`. Duración observada en este entorno: aproximadamente 9 segundos (no es una referencia de rendimiento ni una promesa para otros equipos).

| Suite | Pruebas |
| --- | ---: |
| `packages/hex-grid/hex.test.mjs` | 6 |
| `spikes/004/server.test.mjs` | 5 |
| `packages/access-control/access.test.mjs` | 11 |
| `packages/match-store/store.test.mjs` | 7 |
| `packages/local-api/gateway.test.mjs` | 8 |
| `packages/local-api/compose.test.mjs` | 5 |
| `packages/sqlite-store/sqlite.test.mjs` | 10 |
| `packages/local-api/sqlite-compose.test.mjs` | 3 |
| `packages/sqlite-store/lifecycle.test.mjs` | 12 |
| `packages/sqlite-store/schema-integrity.test.mjs` | 5 |
| `packages/local-api/browser-session.test.mjs` | 7 |
| `packages/local-api/browser-gateway.test.mjs` | 8 |
| `packages/local-api/browser-sqlite-smoke.test.mjs` | 2 |
| `scripts/check-browser-lab.test.mjs` | 2 |
| `scripts/browser-lab.launcher.test.mjs` | 2 |
| **Total** | **93** |

## Procedimiento reproducible en Windows 11

Desde la raíz de la rama `test/i2-first-validation`, con Node.js >=22.16.0 compatible con `node:sqlite`, ejecutar en PowerShell (sin WSL):

```powershell
node scripts/check-browser-lab.mjs
.\scripts\test-local.ps1
```

El script `.ps1` **no se ejecutó directamente** en el entorno de laboratorio: se ejecutó con éxito su lista exacta de 15 suites mediante el ejecutor nativo `node --test`. No se instaló PowerShell en este contenedor.

## Comprobación de correspondencia de fuentes

Se recuperaron las fuentes originales de las PR y se compararon mediante **SHA de objeto Git** `git hash-object` con los blobs publicados en la rama de GitHub. Se cotejaron **32 archivos de código y pruebas** relevantes para la ejecución: **32 coincidencias exactas**. Las fuentes de la corrección del validador de esquema SQLite también coinciden con las publicadas.

El informe registra la ejecución local y el estado observado; no representa un sello externo de certificación de seguridad.

## Incidencia reproducida y corregida

**CCW-008 / PR #35:** `inspectSchema` aceptaba erróneamente una base SQLite de seis tablas con los nombres/columnas esperados, pero sin claves primarias, restricciones `UNIQUE`, referencias o reglas `CHECK`. La regresión reprodujo el defecto con una base artificial.

**Corrección:** se centralizó el DDL canónico en `schema-version.mjs`, y la apertura, adopción de una base antigua y verificación de copias ahora exigen correspondencia exacta de tablas, índices y restricciones, sin triggers o vistas inesperadas. La comparación conserva literales SQL. Se añadieron cinco pruebas de rechazo/aceptación. La batería total pasa después de la corrección.

## Qué NO valida este resultado

- El navegador Chromium disponible arranca, pero bloquea visitar URLs del laboratorio con `ERR_BLOCKED_BY_ADMINISTRATOR`; **no se ha superado una prueba visual real de navegador**. La validación del tablero SVG de PR #27 está pendiente.
- No se ha ejecutado directamente el archivo PowerShell en Windows, ni una instalación HTTPS, PostgreSQL o una prueba en VPS.
- No hay reglas de movimiento o combate oficiales implantadas, ni una partida jugable de *Ancients*.
- Las cuentas, cartas y escenarios utilizados por las pruebas son sintéticos. El backend continúa experimental; faltan auditoría de seguridad, límites de intentos, protección de datos y autorización completa para producción.
- El script del laboratorio no debe exponerse fuera de `127.0.0.1`.

## Estado de integración

Se mantienen en borrador las PR apiladas **#31 → #32 → #33 → #34 → #35**. La PR **#27** del tablero sigue independiente y a la espera de validación manual. Las PR #28–#30 están representadas en la consolidación #31: evitar fusionarlas de manera duplicada. **No se ha modificado ni fusionado `main`.**
