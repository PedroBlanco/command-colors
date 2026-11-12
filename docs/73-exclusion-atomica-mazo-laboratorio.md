# CCW-015 — Exclusión atómica entre mazo sintético y diario de Ancients

**12/11/2026.** Rama de corrección derivada de `feat/i4-ancients-section-history-journal` (PR #84). Cambios internos de laboratorio; no hay rutas HTTP nuevas, ni reglas oficiales, ni migraciones.

## Problema

En `openSqliteComposition().getStore(matchId).initializeCommandDeck(actor)`, el modo `ancientsSectionHistoryLab` ya se comprobaba **antes** de llamar a `createSqliteCommandDeckStore.initialize`, pero esa precomprobación ocurría **fuera** de la transacción `BEGIN IMMEDIATE`.

Una segunda conexión SQLite podía activar el diario experimental entre esa precomprobación y el bloqueo de escritura. `sqlite-game.mjs` volvía a leer la fila dentro de su transacción, pero solo exigía `game_revision===0` y ausencia de `commandSession`. Tras inicializar el laboratorio ambos requisitos se cumplían, con lo que podía añadir `commandSession` sobre un registro de laboratorio y romper la exclusión de modos. La nueva comprobación debe ocurrir **sobre la fila leída dentro del bloqueo**.

## Correcciones

- **Inicialización de mazo:** bajo `BEGIN IMMEDIATE`, antes de generar cartas, añadir `movedUnitIds` o actualizar `matches`, rechazar con `409 SECTION_LAB_MODE_ACTIVE` si el estado incluye `ancientsSectionHistoryLab`. No hay escrituras ni generación de cartas tras el rechazo.
- **Comandos del mazo:** dentro de la transacción, rechazar un registro anómalo con ambos modos con `409 SECTION_LAB_INTERNAL_ONLY`, antes de consultar idempotencia o aplicar un comando.
- **Vista privada del mazo:** rechazar con `COMMAND_DECK_LAB_MODE_CONFLICT` un registro mixto, en lugar de mostrar una mano perteneciente al modo equivocado.
- El diario Ancients ya rechaza `commandSession` al inicializar y al verificar el replay. Estos controles ahora proporcionan el cierre complementario desde el mazo sintético. Las partidas ordinarias conservan su secuencia habitual.

## Pruebas

Se agregan **4 casos nativos SQLite** en dos suites existentes, sin crear una suite nueva ni incrementar el manifiesto de **71 suites**:

1. Composición CCWB con dos conexiones: activar el diario real desde otra conexión exactamente antes del `BEGIN IMMEDIATE` del mazo; debe devolver 409, no añadir `commandSession` ni eventos/comandos y mantener ambas vistas experimentales disponibles.
2. Composición CCWB: el mazo ordinario no puede inicializarse con un laboratorio ya activo; la fila sigue idéntica.
3. Adaptador SQLite del mazo: reproducir la misma ventana entre preflight y bloqueo mediante segunda conexión; no debe persistir el mazo.
4. Adaptador SQLite del mazo: crear intencionadamente una fila mixta para comprobar que ni `dispatch` ni `view` permiten utilizar ese estado, sin escrituras.

**Validación disponible antes de la prueba nativa:** se ejecutaron **5/5 comprobaciones aisladas** sobre el código íntegro de `sqlite-game.mjs` obtenido de GitHub (blob `4b28dbdfb1f57ed26be942cf2a10ca4dc6fb8a60`), con dependencias y `atomic` simulados: carrera bloqueada, laboratorio ya activo bloqueado, inicialización ordinaria conservada, comando mixto rechazado y proyección mixta denegada. **No equivalen a ejecutar los cuatro casos de integración real con SQLite**, que permanecen pendientes para esta rama.

La regresión completa de la PR #91 superada por el usuario en Windows corresponde al **árbol anterior a esta corrección**. No debe atribuirse a los archivos nuevos.

## Validación nativa — Windows 11 sin WSL

Desde un nuevo worktree independiente de esta PR:

```powershell
git fetch origin
git worktree add ..\command-colors-deck-92 origin/fix/i4-ccwb-deck-lab-atomic-exclusion
Set-Location ..\command-colors-deck-92

node --test --test-reporter=tap packages/command-deck/sqlite-game.test.mjs packages/sqlite-store/ancients-section-history.test.mjs
$LASTEXITCODE
```

El validador `scripts/validate-ccwb-http.ps1` incluye ahora **seis suites prioritarias**, incorporando las pruebas del mazo. `-FullRegression` realiza después la regresión completa únicamente si las prioritarias pasan y guarda informes TAP con SHA-256.

No es necesario arrancar el servidor de navegador ni cambiar `main`. **Mantener la PR en borrador hasta ejecutar las nuevas pruebas nativas.**
