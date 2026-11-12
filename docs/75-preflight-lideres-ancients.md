# LAB-ANC / R-04–R-05 — Movimiento candidato de líderes ordenados

**Fecha:** 12/11/2026. **Base:** rama experimental `feat/i4-ancients-section-card-order-screen` (PR #83). **Estado:** consulta privada, de solo lectura, **no autoriza movimiento ni combate**.

## Alcance y fuente de reglas

Se extiende la investigación de *Command & Colors: Ancients* (juego básico, tercera edición, 2009) a los **líderes ordenados expresamente**. Las reglas de movimiento normal permiten a un líder moverse por separado de una unidad y recorrer entre uno y tres hexágonos, atravesar unidades y líderes amigos, sin terminar en un hexágono ocupado por otro líder. Las unidades o líderes enemigos bloquean el movimiento ordinario: evasión y escape son sistemas independientes. El terreno del bosque y el terreno accidentado obligan a detenerse al entrar; las colinas no introducen este impedimento general.

Fuentes de consulta:
- [Reglas de movimiento y movimiento de líderes](https://www.commandsandcolors.net/ancients/the-game/main/08-movement.html)
- [Órdenes a unidades y líderes](https://www.commandsandcolors.net/ancients/the-game/main/07-order-units-and-leaders.html)
- [Terrenos del juego básico](https://www.commandsandcolors.net/ancients/the-game/main/16-terrain.html)

No se publican textos completos de cartas, imágenes protegidas ni contenido de escenarios.

## Módulos y contratos

1. `packages/ancients-rules/leader-movement-preflight.mjs` introduce `precheckAncientsLeaderPath({units,leaders,leaderId,path,terrain})`. El tablero y el terreno deben ser datos confiables del servidor; la ruta excluye el origen. Se comprueban límites, adyacencia, hexágonos repetidos, ocupación por enemigos, llegada a otro líder, longitud máxima de tres pasos y parada por bosque/terreno accidentado. Se permite atravesar posiciones amigas. El resultado favorable es `CANDIDATE`, **no un permiso de movimiento**.
2. `packages/ancients-rules/staged-movement-preflight.mjs` añade `precheckStagedAncientsLeaderMovement`, que exige turno, revisión, fase `LAB_RESOLUTION_PENDING` y orden explícita del líder en el diario, con identidad y posición coincidentes. Un líder enemigo, desconocido o no ordenado devuelve el mismo código `LEADER_NOT_ORDERED`.
3. `packages/ancients-rules/sqlite-section-ccwb-bridge.mjs` verifica el replay completo de cartas, eventos y claves de idempotencia antes de calcular la consulta privada.
4. `packages/sqlite-store/sqlite.mjs` expone **solo al código interno**, `precheckExperimentalSectionLeaderMovement(request,trustedContext)`, con exactamente cuatro campos en `request`: `sessionToken`, `expectedRevision`, `leaderId` y `path`. La sesión y pertenencia se derivan dentro de la **misma instantánea de lectura WAL** que el historial y la vista. El contexto de escenario `{terrain}` es argumento separado, proporcionado por el servidor.

El resultado no devuelve manos, mazo ni historial privado y mantiene expresamente `movementAuthorized:false`, `attackAuthorized:false`, `stateChanged:false`, `needsFullLegalityCheck:true`. No hay movimiento persistido, comando nuevo, ruta HTTP, tablas adicionales, cambio de esquema, procesamiento de retiradas, evasión, escape ni excepción automática de cartas.

## Casos y límites

- **8 casos nuevos** en `leader-movement-preflight.test.mjs`: desenganche y enganche, paso a través de amigos, bloqueo de enemigos y de líder amigo al terminar, longitud/geometría, terreno, datos de escenario y tablero inválidos.
- **5 casos nuevos** en `staged-movement-preflight.test.mjs`: orden y fase, bando/revisión, identidad no distinguible, contexto de terreno y cero mutaciones.
- **3 casos nuevos** en `sqlite-store/ancients-section-history.test.mjs`: lectura autenticada real, revocación cruzada y ausencia de escrituras, peticiones inyectadas.

**Evidencia ejecutada:** los 8 casos puros nuevos y los 15 casos del archivo staged (10 anteriores + 5 nuevos) se evaluaron correctamente en **V8 aislado** a partir de los blobs recuperados de GitHub, con dependencias puras reconstruidas e instrumento de aserciones. **No constituye ejecución nativa de `node:test`**, no cubre SQLite real ni valida los tres casos nuevos de composición. Las **72 suites** del manifiesto de esta rama están pendientes de regresión real.

**Pendientes para autorizar movimiento reglamentario:** validar interacción temporal de líder y unidad ya movidos, terreno y escenario oficial completo, movilidad de líderes asociados, excepciones de carta, efectos de combate y sincronización de estado. Este filtro no puede sustituir el motor reglamentario. **No fusionar sobre `main` ni desplegar** sin validación integrada, revisión de seguridad y pruebas de dos jugadores.

## Reproducción, cuando haya pruebas nativas disponibles

```powershell
# Windows 11, Node.js nativo >= 22.16.0, sin WSL
node --test packages/ancients-rules/leader-movement-preflight.test.mjs packages/ancients-rules/staged-movement-preflight.test.mjs packages/sqlite-store/ancients-section-history.test.mjs
.\scripts\test-local.ps1
```

Las rutas internas del nuevo laboratorio no se exponen desde `packages/local-api/gateway.mjs`, y los modos públicos siguen requiriendo el aislamiento separado de SEC-001 (PR #93).


## Continuación: secuencia líder–unidad (12/11/2026)

La [secuencia temporal simulada](76-secuencia-temporal-lider-unidades-ancients.md)
incorpora las interacciones que no podían deducirse de una sola trayectoria:
orden de separación, desplazamiento conjunto de unidad y líder, imposibilidad
de separar después de mover juntos, y prohibición de mover posteriormente
una unidad que acaba de recibir un líder. El laboratorio reconstruye una
serie de movimientos **hipotéticos sobre una copia**, sin aplicarla al tablero
ni crear un diario de movimientos persistidos. La función de secuencia se
consulta bajo sesión/partida y snapshot SQLite/WAL, exclusivamente desde
código interno.

Se añaden 18 casos nuevos, de los cuales 15 son de código puro/staged y 3
requieren SQLite. En conjunto la PR #95 prepara **34 casos nuevos**;
las evaluaciones V8 aisladas de preflight puro + secuencia + staged acumulan
**38/38 correctas** (incluyen diez pruebas staged preexistentes). **No
sustituyen Node.js/SQLite real ni regresión completa**, y la rama pasa a
**73 suites** por la nueva suite temporal. El cierre funcional de CCW-014
sigue pendiente.
