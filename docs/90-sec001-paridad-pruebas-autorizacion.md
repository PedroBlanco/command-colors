# SEC-001 — restauración de cobertura y auditoría del manifiesto

**Fecha:** 13/11/2026  
**Rama de trabajo:** `test/sec001-parity-revocation-branches`, basada exactamente en `fix/ui-landscape-lobby-refresh-layout@598f8225ef85b5f454428db75d36ee83f81e340e`, sin modificar `main`.  
**Motivo:** recuperar verificaciones de seguridad de la PR #93 que faltaban en la cadena experimental ya probada por el usuario, conservando los módulos de producción de la rama #102.

## Antecedentes y evidencia del usuario

La validación anterior de `fix/ui-landscape-lobby-refresh-layout` quedó confirmada por el usuario: las suites locales y la regresión completa corregida en Windows terminaron correctamente. Se corrigieron cuatro errores de tests antiguos (637, 638, 690, 697), no defectos constatados del motor. En esta confirmación no se facilitó el archivo TAP, número final de tests ni el SHA de checkout local. El usuario ha decidido **interrumpir temporalmente las pruebas**: esta rama no requiere ninguna ejecución por su parte ahora.

## Auditoría diferencial de SEC-001

Se compararon **los nombres de casos de las suites** modificadas en la rama independiente [PR #93](https://github.com/PedroBlanco/command-colors/pull/93) contra los de la rama principal de trabajo PR #102. Los contratos `viewForSession`, `publicEventsForSession`, `dispatchForSession`, `initializeCommandDeckForSession`, el guardia tras `BEGIN IMMEDIATE` y la exclusión `LAB_ONLY` estaban ya integrados, pero faltaban **doce regresiones**:

| Suite | Recuperadas | Riesgo que comprueban |
|---|---:|---|
| `sqlite-store/ancients-section-history.test.mjs` | 9 | Vistas públicas de manos, WAL entre conexiones, sesión revocada, expulsión, bloqueo escritor, operación de mazo |
| `local-api/section-history-http-isolation.test.mjs` | 2 | GET/eventos/comandos contra vista privada y prioridad de 401 ante revocación entre preflight y escritura |
| `local-api/revision-stream-lab-isolation.test.mjs` | 1 | Cierre de SSE al recibir el sentinel privado desde la lectura antigua por actor |

**Resultado:** nombres de pruebas SEC-001 de #93 recuperados en esas tres suites; módulos públicos intactos. No se fusiona #93 ni se presume que todos sus demás cambios de infraestructura sean portables.

## Blindaje del ejecutor

Se recupera de #93 `auditLocalTestManifest` y `requireCompleteTestManifest` en `scripts/run-test-suite.mjs`. Se verificó por comparación de contenido que el ejecutor anterior **solo** difería de la versión nueva en los imports de directorio, las dos funciones auditoras y su invocación en `main`: el lanzamiento nativo, firmas TAP, opciones CLI, escritura de informes e invocación sin shell se mantienen iguales.

Antes de `--list`, `--only` o una regresión completa, el CLI compara el manifiesto con todos los `*.test.mjs` reales bajo `packages/`, `scripts/` y `spikes/`:

- Una ruta ausente o una prueba nueva no listada causa `TEST_MANIFEST_DRIFT` y salida 2, **sin comenzar la ejecución**.
- No se siguen enlaces simbólicos; se ignora `node_modules`. Los paths del manifiesto no permiten escapes mediante `..`.
- La auditoría es de solo lectura. No crea bases, directorios ni archivos TAP.
- La selección `--only` continúa limitada al manifiesto: no ejecuta órdenes arbitrarias.
- Se reponen dos pruebas heredadas del auditor (archivos omitidos y enlaces) y una prueba de que el lanzador de Windows utiliza la selección de seguridad esperada.

## Prioridad de las suites Windows

`scripts/validate-ccwb-http.ps1` pasa de **6 a 12 suites** en la etapa prioritaria. Incluye accesos HTTP/SSE, comando de mazo, `sqlite.test.mjs`, historial privado y contratos de sesión/WAL de dos procesos. Las doce rutas están en el manifiesto y la etapa `-FullRegression` solo comienza si la etapa prioritaria termina en 0. Se conserva PowerShell nativo; no se instala ni se invoca WSL, Docker ni Actions.

La PR #93 contiene además un lanzador Node portable diferente (`validate-ccwb-http.mjs`) y su suite. **No se han copiado automáticamente a esta rama**, porque aquí existe un wrapper PowerShell en uso y hacerlo supondría sustituir otro contrato y añadir una suite sin validación. Queda como revisión separada; no atribuirle cobertura o ejecución inexistente.

## Comprobaciones realizadas en esta iteración

- Se han cotejado **blobs Git reales** de las tres suites de SEC-001 y del ejecutor. Las tres suites incorporan 9+2+1 = **12 pruebas recuperadas**, sin nombres duplicados.
- Se han añadido **2 pruebas de auditoría** y **1 prueba del lanzador Windows**, todas en `scripts/check-browser-lab.test.mjs`. En total: **15 casos nuevos** frente a la PR #102, distribuidos entre **cuatro suites existentes**.
- El manifiesto conserva **80 rutas diferentes**. Los **doce** archivos prioritarios están incluidos.
- Sintaxis JavaScript de los archivos editados: correcta mediante análisis V8 aislado.
- **7/7 comprobaciones V8 aisladas** del código real del auditor con árbol de archivos y `fs` simulados: manifiesto completo, missing, unregistered, fail closed, symlinks, 12 prioritarias y 80 únicas.

**Límite importante:** esas siete comprobaciones **no** son pruebas nativas Node, ni HTTP/SQLite reales. Las doce regresiones recuperadas y los tres tests del auditor/lanzador **aún no se han ejecutado en el árbol exacto del proyecto**. No declarar SEC-001 resuelta hasta contar con esa evidencia y revisión completa.

## Estado y siguientes pasos

1. Mantener esta PR **en borrador**, como hija de [PR #102](https://github.com/PedroBlanco/command-colors/pull/102). No fusionar a `main`.
2. Cuando el usuario decida retomar pruebas, ejecutar primero las doce suites prioritarias con el wrapper actual, después las 80 suites completas; comprobar el SHA de ejecución y conservar el TAP. No pedir ahora esas pruebas.
3. Revisar la equivalencia restante entre #93 y esta cadena, especialmente el lanzador portátil independiente y cualquier comportamiento de lector WAL que no esté cubierto.
4. Mantener bloqueado el movimiento reglamentario confirmado de [issue #97](https://github.com/PedroBlanco/command-colors/issues/97) hasta resolver SEC-001, reglamento y commit transaccional. Ninguna simulación experimental se convierte en jugada oficial por estas pruebas.
