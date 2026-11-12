# CCW-015 / R-04–R-05 — Prevalidación de movimiento desde órdenes registradas

**Fecha:** 12/11/2026. **Dependencia:** PR #88. **Estado:** laboratorio interno, **sin autorización de movimientos**, sin HTTP, sin escritura SQLite y sin reglas de combate completas.

## Objetivo y encaje

Hasta ahora el diario privado de cartas permitía jugar una carta ordinaria y registrar las unidades ordenadas, sin enlazarlas con la geometría y el perfil de movimiento de *Ancients*. Esta iteración incorpora `packages/ancients-rules/staged-movement-preflight.mjs`: una **función pura de consulta** que recibe el estado reconstruido del diario y una ruta de hexágonos, exige que la unidad conste entre las órdenes registradas para el turno activo y delega en `precheckAncientsMovementPath` la evaluación de distancia, adyacencia, obstáculos, líderes, terrenos y perfiles básicos.

Ningún resultado equivale a movimiento legal: incluso `CANDIDATE` conserva `movementAuthorized:false`, `attackAuthorized:false`, `stateChanged:false` y `needsFullLegalityCheck:true`. Tampoco se añade una transición de movimiento al diario, ni se reescribe `matches.private_state` ni se insertan eventos o claves de idempotencia. No hay cambios de esquema ni endpoints.

## Confianza, privacidad y límites

- **Estado de entrada:** debe proceder de un diario privado SQLite que el servidor ya haya sometido a la verificación de replay y de firmas de la PR #87. La función no reemplaza esa verificación de persistencia ni autentica sesiones: el servidor debe derivar `actor` de la sesión como en #88.
- **Órdenes:** se exige `LAB_RESOLUTION_PENDING`, revisión esperada actual, turno/bando coincidente y prueba de orden `orderSnapshot` para la misma unidad y la misma posición que la observada en el tablero. Una unidad inexistente, rival o no ordenada devuelve indistintamente `UNIT_NOT_ORDERED`.
- **Perfiles y terreno:** el contrato exige un objeto **exclusivamente del servidor** `serverContext: {unitTypes,terrain}`. Deben definirse explícitamente perfiles reconocidos para **todas las unidades** del tablero, sin claves extras; faltar datos o incluir perfiles inventados produce un error de configuración. El terreno se suministra desde el escenario confiable. La carta nunca concede una excepción implícita a la regla de movimiento.
- **Resultado:** se devuelve el filtro reglamentario ya existente (candidato, bloqueo o necesidad de excepción), **sin datos de manos, mazo, claves de idempotencia ni historial privado**. No hay efectos secundarios.
- **Límites pendientes:** integración en flujo HTTP privado, turnos reglamentarios completos, consumos de movimiento, grupos/líderes, cartas especiales, retiradas, resolución de combates, victoria y escenarios oficiales. No reutilizar la función como criterio único para autorizar un movimiento.

## Pruebas nativas verificadas

Se recuperaron de GitHub los cinco archivos originales del nuevo incremento y sus dependencias inmediatas; sus blobs Git locales coinciden con los publicados:

- `staged-movement-preflight.mjs`: `f4719e495a5279a7fb69e97baa30d65a508143ae`
- `staged-movement-preflight.test.mjs`: `96031bcc624c826d0510f30ae6feffae73caab3d`
- `movement-path-precheck.mjs`: `c8f6cd35bf0d5f1c2f7a517f1507713b7196df56`
- `movement-profile.mjs`: `2bef541f7da040f7eb1b2b8735fab4939ce1f966`
- `terrain-movement.mjs`: `4e67f3b390dc6ba1f76536a2b34570416591e462`

**10/10 PASS** con Node.js 22.16.0/Linux nativo, sin WSL ni GitHub Actions. Incluyen candidato sin autorización, ausencia de órdenes, identidad indistinguible, rechazo de actor/revisión incorrectos, falta de perfiles confiables, rutas bloqueadas, terreno, órdenes adulteradas, final de turno y ausencia de mutaciones.

Se añadió además una prueba a `sqlite-section-ccwb-bridge.test.mjs` para leer el diario real persistido, comprobar una ruta ordenada y un intento rival, y verificar **bit a bit por comparación de filas** que no se modifican `matches`, `game_events` ni `game_commands`.

**Ejecución combinada real** de la suite nueva, del puente y de la composición de cuentas/invitaciones: **46 PASS, 0 FAIL, 0 SKIP, código de salida 0**. Informe TAP SHA-256: `72cd68388c5f2f4f188c306543d73cbe1f95d652ac827fb7cdfa5eba880fcc21`. Desglose: **10** (preflight nuevo), **25** (puente e integración SQLite) y **11** (identidad/composición CCWB). El blob Git de `sqlite-section-ccwb-bridge.test.mjs` extendido y ensayado es `776a5d4b72c7f901f28d4861483e2155d591dbbc`.

El manifiesto incluye ahora **69 suites**. Estas **tres** suites pasaron juntas, pero la regresión global de 69 suites aún no se ha ejecutado; tampoco se ha verificado en Windows ni con dos navegadores HTTP/SSE.

## Reproducción en Windows 11 sin WSL

```powershell
node --test --test-reporter=tap packages/ancients-rules/staged-movement-preflight.test.mjs packages/ancients-rules/sqlite-section-ccwb-bridge.test.mjs packages/sqlite-store/ancients-section-history.test.mjs
$LASTEXITCODE
.\scripts\test-local.ps1
$LASTEXITCODE
```

**Mantener PR apilada en borrador, sin fusionar ni desplegar** hasta revisar la regresión completa, las sesiones y las reglas oficiales.
