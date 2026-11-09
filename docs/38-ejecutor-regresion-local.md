# CCW — Ejecutor local de regresión verificable

**Fecha:** 8 de noviembre de 2026  
**Rama:** `feat/i4-manual-browser-movement` (PR #48, apilada sobre #47, #46 y #45).  
**Ámbito:** infraestructura de pruebas locales; no modifica el motor, las reglas ni los datos de las partidas.

## Cambio implantado

Se ha incorporado `scripts/run-test-suite.mjs`, que toma la lista canónica de pruebas de `LOCAL_TEST_FILES` exportada por `scripts/check-browser-lab.mjs`. El script PowerShell `scripts/test-local.ps1` llama ahora a ese ejecutor; se elimina así la segunda lista de suites que podía quedar desactualizada.

El ejecutor:

- Ejecuta los archivos autorizados mediante `node --test` con concurrencia limitada a 2 procesos, **sin shell** y sin GitHub Actions ni WSL.
- Comprueba la existencia de **todos** los archivos antes de arrancar, devuelve código **2** si falta alguno y no crea un registro ficticio.
- Admite `--list` y una selección `--only=archivo,archivo`, limitada estrictamente a los nombres de la lista oficial. El modo por defecto ejecuta las **33 suites**.
- Conserva códigos de salida reales (0 si las pruebas pasan, distinto de cero si fallan).
- Con `--log=ruta` genera una evidencia TAP con fecha UTC, versión de Node, directorio de trabajo, orden ejecutada, resumen y código de salida, además de mostrar su SHA-256. **No sobrescribe** un registro ya existente; solo admite una ruta dentro del proyecto.
- No crea bases SQLite ni levanta el servidor de producción; las suites seleccionadas pueden crear sus propias bases ficticias y oyentes exclusivamente locales conforme a sus pruebas.

## Ejecución en Windows 11 PowerShell (sin WSL)

Ejecutar desde la raíz del repositorio:

```powershell
# Consultar las suites canónicas
node .\scripts\run-test-suite.mjs --list

# Regresión completa de 33 suites con registro local (no versionado)
.\scripts\test-local.ps1 -Log '.local-data\regression\completa-20261108.tap'

# Selección opcional de las siete suites pendientes
.\scripts\test-local.ps1 -Only 'packages/sqlite-store/sqlite.test.mjs,packages/local-api/sqlite-compose.test.mjs,packages/sqlite-store/schema-integrity.test.mjs,packages/local-api/browser-gateway.test.mjs,packages/local-api/browser-sqlite-smoke.test.mjs,scripts/browser-lab.launcher.test.mjs,packages/local-api/command-deck-http.test.mjs' -Log '.local-data\regression\pendientes-20261108.tap'
```

Los nombres de evidencias deben ser únicos: deliberadamente se rechaza la sobrescritura. El directorio `.local-data/` está excluido de Git por `.gitignore`. La salida TAP no debe contener datos de partidas reales: **usar solamente el laboratorio con cuentas ficticias**.

## Verificación realmente realizada

- **8/8 pruebas** de `scripts/check-browser-lab.test.mjs` superadas en Node.js **v22.16.0**, entorno aislado Linux x64. Son las dos pruebas previas del diagnóstico y seis nuevas para selección segura, argumentos, ficheros ausentes, registro no sobrescribible, fallos con código distinto de cero y rutas manipuladas.
- **8/8 repetidas desde el ejecutor real** mediante `node scripts/run-test-suite.mjs --only=scripts/check-browser-lab.test.mjs --log=.local-data/regression/runner-20261108.tap`, código de salida **0**, SHA-256 del registro: `6ef9292454298d96c29649bfc0984ac82a5e6639c4413591c4a2dd39d8ba0d71`.
- `--list` enumeró exactamente **33 suites**.
- Solicitud de una suite ausente devolvió **2** e indicó su ruta, sin aparentar éxito.
- El código ejecutado y los archivos publicados en la rama coinciden por SHA Git:
  - `scripts/run-test-suite.mjs`: `30d9d1731c14198775a3c28f163bad14442688f8`
  - `scripts/check-browser-lab.mjs`: `d4b230e8dd44bd311396eb6df53d313c38a372e9`
  - `scripts/check-browser-lab.test.mjs`: `9820841583fb4b6c838d50df3272eda2428d23ec`

## Estado de aceptación

**No se ha ejecutado la batería completa de 33 suites** en este incremento: siguen verificadas **26 de 33 suites** en ejecuciones anteriores, faltan las **siete** señaladas arriba. Tampoco se ha ejecutado el script completo en **Windows PowerShell** ni se ha validado visualmente el tablero SVG (PR #27).

La PR #48 y las PR #45–#47 deben permanecer en borrador, sin fusionar a `main`, hasta superar las pruebas pendientes. No declarar este laboratorio un juego *Command & Colors: Ancients* completo ni publicarlo en Internet.

## Endurecimiento del registro de evidencia (8–9 de noviembre de 2026)

El ejecutor añade `validateLogFileTarget()` a `scripts/run-test-suite.mjs`. La función comprueba la ruta de salida de `--log` y resuelve el ancestro existente mediante `realpathSync` para rechazar un enlace simbólico que apunte fuera del repositorio. Su prueba de regresión comprueba rutas válidas, salida ascendente, enlaces simbólicos externos y que no aparezca un registro fuera del proyecto. En Windows, el subcaso del enlace puede marcarse como omitido si faltan permisos para crearlo.

### Rectificación del estado de verificación (9/11/2026)

En una anotación anterior se informaron **9/9 PASS** y un SHA-256 de un supuesto informe TAP del ejecutor. **No está disponible una salida de Node.js ni un archivo TAP contrastable que permita verificar esas afirmaciones.** Por integridad de las evidencias, **no se consideran resultados de pruebas acreditados** y se retira el hash del supuesto informe. Los SHA Git de los archivos publicados acreditan su identidad en el repositorio, **no su ejecución**.

La prueba `scripts/check-browser-lab.test.mjs` sigue escrita, pero su ejecución real mediante Node.js queda **pendiente**, igual que las siete suites que no tienen evidencia de la fase anterior y el conjunto completo. No se debe fusionar basándose en las cifras rectificadas.

### Comprobación pendiente reproducible (Windows 11 PowerShell, sin WSL)

```powershell
node --version
node --check .\scripts\run-test-suite.mjs
node --test .\scripts\check-browser-lab.test.mjs
node .\scripts\run-test-suite.mjs --list
.\scripts\test-local.ps1 -Log '.local-data\regression\completa-20261109.tap'
```

Conservar la salida completa, el código de salida, el SHA-256 del TAP producido **realmente** y el commit de referencia antes de registrar cualquier prueba como superada. El número de suites depende de la rama: 33 en PR #48, 34 en PR #49 y 35 en PR #50.
