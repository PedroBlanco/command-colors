# Command & Colors Web

Aplicación web no comercial de juegos por turnos para **dos jugadores humanos**. Primero *Command & Colors: Ancients* básico; después *Napoleonics* básico y ampliaciones.

**Estado:** desarrollo experimental. Hay prototipos locales de tablero, comunicaciones HTTP y almacenamiento; **no existe todavía un juego funcional, un servicio seguro para usuarios reales ni un motor de reglas completo**.

## Primera prueba local en Windows 11 (rama `main`)

El backend de laboratorio (cuentas ficticias, invitaciones, SQLite, copias y SSE) y la máquina de fases **sintética** ya están integrados en `main`. No existe todavía una partida reglamentaria jugable de *Ancients* ni un servicio seguro para Internet.

Con Git, PowerShell y Node.js **22.16.0 o posterior compatible con `node:sqlite`**, desde una copia del repositorio:

```powershell
git fetch origin
git switch main
git pull --ff-only
node scripts/check-browser-lab.mjs
.\scripts\test-local.ps1
node scripts/browser-lab.mjs
```

El servidor escucha **solo en `http://127.0.0.1:8788/`**. La primera vez crea dos usuarios ficticios (`alice` y `bob`) y muestra contraseñas aleatorias **una sola vez**. Usar dos perfiles de navegador distintos y nunca copiar credenciales o bases SQLite a GitHub. No usar WSL ni es necesario instalar un VPS o ejecutar Actions.

El tablero SVG de la [PR #27](https://github.com/PedroBlanco/command-colors/pull/27) continúa **separado, pendiente de validación visual**. La [guía de primera validación](docs/18-guia-primera-validacion.md) explica cómo probarlo sin mezclar ramas. La batería local contempla ahora **18 suites**; en incrementos anteriores pasaron 99 pruebas de I2 y 15 del módulo sintético de fases por separado. **La batería conjunta de 18 suites y la interfaz visual deben verificarse en Windows.**

## Decisiones confirmadas

- Navegadores de escritorio y móviles, partidas síncronas y asíncronas.
- Servidor autoritativo con estado persistente, validación estricta y turnos recuperables.
- Cada jugador ve únicamente su mano, información pública y el número de cartas del contrario.
- Tiradas digitales calculadas por el servidor o dados físicos cuyos resultados introducen los jugadores.
- Deshacer acciones no aleatorias sin información revelada; rectificaciones irreversibles por acuerdo.
- Usuarios registrados e invitaciones privadas; instalación en servidor propio o VPS.
- Uso no comercial, con acceso restringido; el propietario posee cajas físicas de ambos juegos.

## Documentación

- [Estado integrado y procedimiento de prueba en `main`](docs/22-estado-integracion-main.md)
- [Requisitos](docs/01-requisitos.md)
- [Modelo de dominio y estados](docs/02-dominio-y-estados.md)
- [Arquitectura y decisiones](docs/03-arquitectura.md)
- [Matriz de reglas Ancients](docs/04-matriz-reglas.md)
- [Plan iterativo](docs/05-plan-iterativo.md)
- [Pruebas](docs/06-pruebas.md)
- [Fuentes y derechos](docs/07-fuentes-y-derechos.md)
- [Decisiones pendientes](docs/08-decisiones-pendientes.md)
- [Backlog de tareas](backlog.csv)
- [Maqueta HTML de tablero](prototipo/tablero.html) — abrir localmente en el navegador; interactiva, **sin reglas ni servidor**

Diagramas PlantUML en diagrams/ y escenario de ejemplo **sintético** en scenarios/.

## Límites

No incluir imágenes, cartas, mapas, PDF o transcripciones de materiales originales sin permiso aplicable. El uso no comercial y la posesión de juegos físicos no conceden por sí solos una licencia de redistribución. Proyecto independiente, no afiliado a GMT Games.

La rama principal se modifica tras revisión mediante PR. Las pruebas deben poder ejecutarse localmente; no introducir dependencias de GitHub Actions hasta justificarlas.

## Laboratorio de integración I2

La [PR #31](https://github.com/PedroBlanco/command-colors/pull/31), ya fusionada en `main`, consolidó los contratos experimentales de persistencia (#28), identidad e invitaciones (#29) y API (#30), junto con las pruebas de integración HTTP. Las PR individuales #28–#30 se cerraron sin volver a fusionarlas para evitar duplicaciones.

Ejecutar desde PowerShell, con Node.js 22 o posterior (sin WSL ni Actions):

```powershell
.\scripts\test-local.ps1
```

La [guía de integración](docs/14-prueba-integrada-local.md) explica el alcance y las limitaciones. La persistencia SQLite y las sesiones web de laboratorio ya están en `main`. Faltan una solución de producción, una revisión de seguridad y el motor reglamentario. **No utilizar este laboratorio con jugadores ni en redes externas.**

## Persistencia de laboratorio con SQLite (I2)

Se ha añadido una prueba de persistencia **en archivo SQLite real**, usando `node:sqlite` (experimental en Node.js 22.16.0). Conserva usuarios ficticios, sesiones, invitaciones, estado privado, eventos e idempotencia tras cerrar/reabrir la base de datos. Incluye pruebas con un proceso nuevo, concurrencia entre conexiones, rollback y tres flujos HTTP contra la base de datos.

```powershell
node --test packages/sqlite-store/sqlite.test.mjs packages/local-api/sqlite-compose.test.mjs
```

También se ejecutan desde `.\scripts\test-local.ps1`. Consulta [guía SQLite local](docs/15-sqlite-desarrollo-local.md). **No es un despliegue ni sustituye PostgreSQL como opción prevista.** No usar con partidas o datos reales; faltan HTTPS, cookies seguras, CSRF, límites de intentos, backups y migraciones.


## Copia y restauración SQLite (solo laboratorio)

La [guía de versión de esquema y copias](docs/16-versionado-copias-sqlite-local.md) introduce una marca de esquema v1, una copia coherente de SQLite en WAL y restauración verificada mediante integridad + SHA-256. La copia se publica en formato autónomo (sin archivos `-wal/-shm`). Para probarlo en Windows 11 con Node.js >=22.16.0:

```powershell
node --test packages/sqlite-store/lifecycle.test.mjs
node scripts/sqlite-maintenance.mjs backup .\datos\prueba.sqlite .\copias\prueba-copia.sqlite
node scripts/sqlite-maintenance.mjs verify .\copias\prueba-copia.sqlite
node scripts/sqlite-maintenance.mjs restore .\copias\prueba-copia.sqlite .\datos\prueba-restaurada.sqlite
```

**No utilizar con datos reales**, no exponer el laboratorio en la red ni considerar estas copias como respaldo de producción. La herramienta exige destinos inexistentes; la restauración requiere parada de la aplicación.

## Sesiones de navegador (nuevo laboratorio I2)

La versión integrada en `main` incorpora un modo **solo local** de acceso a partidas sintéticas por navegador con cookie `HttpOnly`, `SameSite=Strict` y comprobación de origen para las operaciones de escritura. En HTTP se activa expresamente un modo inseguro que solo admite `127.0.0.1`; **nunca se debe exponer a una red**.

Con Node.js 22.16.0 o posterior compatible con `node:sqlite`, ejecutar desde PowerShell en `main`:

```powershell
node --test packages/local-api/browser-session.test.mjs packages/local-api/browser-gateway.test.mjs
node scripts/browser-lab.mjs
```

El primer arranque crea cuentas de prueba `alice` y `bob` con contraseñas aleatorias (mostradas una sola vez). Abrir `http://127.0.0.1:8788` en **dos perfiles de navegador diferentes** (normal/privado); las pestañas del mismo perfil comparten sesión. Consultar la [guía de uso y seguridad](docs/17-sesiones-navegador-laboratorio.md).

Esta interfaz mínima **no sustituye** a la del tablero SVG de la PR #27, pendiente de validación. No incorpora reglas de movimiento ni datos oficiales.

## Primera validación guiada (laboratorio I2)

La rama `main` contiene la [guía de aceptación](docs/18-guia-primera-validacion.md), un diagnóstico **de solo lectura** y una nueva prueba HTTP de dos usuarios contra SQLite real.

En Windows 11, con Node.js 22.16.0 o posterior compatible:

```powershell
node scripts/check-browser-lab.mjs
.\scripts\test-local.ps1
node scripts/browser-lab.mjs
```

El diagnóstico no modifica la base ni crea cuentas. El servidor experimental solo escucha en `127.0.0.1:8788`. La [PR #27 del tablero](https://github.com/PedroBlanco/command-colors/pull/27) se comprueba **por separado**. La aplicación todavía no implementa las reglas de Ancients, ni está preparada para Internet.

## Regresión integral del laboratorio I2

La [revisión de regresión completa](docs/19-informe-regresion-integral-i2.md) ejecutó **93 pruebas automatizadas con 0 fallos**, usando Node.js 22.16.0 y la lista de 15 suites disponible en aquel momento; el script actual incluye 18 suites tras incorporar SSE y fases sintéticas. Incluye una corrección en el verificador de SQLite que impide registrar bases sin sus restricciones. Se compararon 32 archivos de código y pruebas mediante hashes Git contra los publicados en la rama.

**Importante:** el script PowerShell todavía debe ejecutarse en Windows, y la aceptación visual en navegador sigue pendiente; el entorno de prueba bloqueó la navegación con Chromium. Las PR #31–#37 se fusionaron posteriormente en `main`; el informe enlazado documenta el estado de las pruebas en su fecha.

## Sincronización automática por revisiones (CCW-010)

La nueva página de laboratorio se mantiene actualizada con **SSE** sin exponer cartas privadas. El servidor publica solo las revisiones de sala y partida; el cliente obtiene los datos autorizados mediante HTTP, con reconexión y deduplicación.

Con la incorporación de SSE se superaron **99 pruebas de 17 suites** en Node.js 22.16.0; la suite sintética de fases superó otras 15 pruebas por separado. El script actual reúne 18 suites, todavía pendientes de ejecución conjunta en Windows. Instrucciones técnicas en [sincronización SSE privada](docs/20-sse-revisiones-privadas.md).

```powershell
node --test packages/local-api/revision-stream.test.mjs packages/local-api/browser-ui.test.mjs
.\scripts\test-local.ps1
```

Este canal SSE usa sondeo de laboratorio, limitado a `127.0.0.1` y 16 conexiones. No hay sincronización interproceso ni servidor seguro de producción. La página de laboratorio sigue siendo **distinta** del tablero SVG de la PR #27; la validación visual en navegador permanece pendiente.

## Iteración 3 — Contrato sintético de fases del turno

El paquete `packages/turn-phase/` contiene un **prototipo puro y sin reglas oficiales** que permite comprobar la secuencia de fases, la autorización del actor y las decisiones pendientes del defensor sin avanzar el turno del atacante. Incluye 15 pruebas locales:

```powershell
node --test packages/turn-phase/phase.test.mjs
```

Consultar [el contrato y sus limitaciones](docs/21-maquina-fases-sintetica.md). **No implementa cartas, movimientos ni combates reales, y no debe confundirse con una versión jugable de Ancients.** El módulo ya está en `main`, pero continúa sin conectarse al estado reglamentario o al tablero SVG pendiente de revisión.

## Iteración 3 — Mazo de mando y manos ocultas (CCW-012)

El módulo `packages/command-deck/` introduce un **mazo de ejemplares opacos** y una interfaz de estado privado por jugador. Reparte manos con tamaños configurables, mezcla mediante `crypto.randomInt`, valida que no se pierdan ni dupliquen cartas, y procesa juego, descarte y robo en coordinación con las **fases sintéticas** de la iteración 3. El servidor conservará el estado completo; cada jugador recibirá exclusivamente su mano y el recuento público de cartas del contrario.

```powershell
node --test packages/command-deck/deck.test.mjs
.\scripts\test-local.ps1
```

**21/21 pruebas del módulo superadas localmente** con el reducer real de fases de `main`. El script y el diagnóstico contemplan ahora **19 suites**; no se ha ejecutado todavía su conjunto completo sobre Windows. Véanse el [contrato del mazo opaco](docs/23-mazo-mando-opaco-i3.md) y la [matriz de reglas](docs/04-matriz-reglas.md).

**Limitaciones:** no incluye cartas oficiales, efectos, reglas de agotamiento, movimientos, combates ni persistencia de estas manos en la base de datos. No es una partida jugable y no debe exponerse por Internet.

## Iteración 3 — Persistencia del mazo y API de laboratorio

La rama `feat/i3-durable-command-deck-api` conecta el mazo **sintético** de CCW-012 con el estado privado de SQLite, las transacciones existentes y la API autenticada: el propietario de una sala `READY` puede inicializar un mazo de prueba y los dos participantes actúan por el endpoint de comandos, con el actor determinado exclusivamente por la sesión.

El servidor conserva las manos y el orden oculto del mazo; `GET /api/matches/:uuid` proyecta únicamente la mano del jugador y la información pública. `game_revision`, eventos e idempotencia se confirman juntos, y sobreviven a un reinicio. El esquema SQLite v1 **no ha cambiado**.

```powershell
node --test packages/command-deck/deck.test.mjs packages/command-deck/sqlite-game.test.mjs
node --test packages/local-api/command-deck-http.test.mjs
.\scripts\test-local.ps1
```

**39 pruebas del mazo y su adaptador SQLite superadas**. Las **4 pruebas HTTP originales ya han pasado** con SQLite y backend reales. Se añadieron **2 pruebas con cookies** (protección de origen, privacidad y fases) también superadas; las tres suites de SQLite y HTTP acumulan **24/24 pruebas en una ejecución conjunta**. El procedimiento general enumera **22 suites**, pendiente de regresión conjunta. Lee el [contrato de persistencia y rutas API](docs/24-mazo-persistente-api-i3.md).

Se mantienen datos y comandos ficticios. **No** hay integración reglamentaria, cartas oficiales, interfaz de juego completa, seguridad de producción ni permisos de distribución de materiales. La PR #27 del tablero sigue pendiente de aceptación visual.

## Iteración 3 — Controles del mazo sintético en navegador

La nueva página de laboratorio añade un panel para inicializar un mazo **ficticio**, jugar una carta de la propia mano, asignar y deshacer órdenes sintéticas, avanzar las fases y registrar una decisión del defensor. El servidor sigue siendo la autoridad y obtiene el jugador de la sesión, **no del JSON del navegador**. Al cambiar de cuenta o partida se borra la vista privada anterior.

Las pruebas añadidas a la batería son:

```powershell
node --test packages/local-api/deck-controls.test.mjs packages/local-api/browser-deck-ui.test.mjs
```

**13/13 pruebas nuevas superadas**, más dos pruebas reproducidas de compatibilidad SSE en la ejecución local. La batería general comprende ahora **24 suites**; todavía no se ha probado íntegramente en Windows y ya se han ejecutado las seis pruebas HTTP+SQLite con cookies y Bearer de la PR #40. Consultar la [guía de aceptación del mazo](docs/25-interfaz-mazo-sintetico-i3.md).

Esta interfaz no utiliza todavía el tablero SVG (PR #27), no implementa *Ancients* reglamentario y **no debe exponerse fuera de 127.0.0.1**.

## Revisión SSE de mazo con dos sesiones reales

Se añadió una suite de laboratorio que comprueba los avisos SSE en **dos sesiones HTTP autenticadas**, los cambios del mazo persistente, la reconexión y la revocación de cookies. **Ocho suites afectadas ejecutadas juntas: 49/49 pruebas superadas**, Node.js 22.16.0.

La [guía de verificación](docs/26-sse-mazo-dos-sesiones.md) documenta el alcance y los límites; el script general y el diagnóstico enumeran ahora **25 suites**. La ejecución completa en PowerShell/Windows 11, el uso visual en dos perfiles y la PR #27 del tablero continúan pendientes. Ningún servicio está preparado para Internet.

## Núcleo de dados digitales y físicos (CCW-015/016)

Se ha añadido un **contrato técnico independiente**, sin reglas de combate, en `packages/dice-roller/`. Permite obtener resultados digitales mediante azar criptográfico del servidor o **registrar**, sin considerarlos verificados, los valores comunicados de dados físicos. El número de dados y las caras válidas deben proceder de un reglamento aprobado y no del cliente.

```powershell
node --test packages/dice-roller/dice.test.mjs
```

**12/12 pruebas aisladas superadas** con Node.js 22.16.0; la batería local enumera **26 suites**, pendientes de ejecución conjunta en Windows. La [ficha técnica](docs/27-contrato-dados-sinteticos.md) detalla límites, trazabilidad y riesgos. **No hay resolución de combates ni integración HTTP** y las issues CCW-015/016 permanecen abiertas.

## Contrato de órdenes sintéticas con unidades y sectores (CCW-013)

Se añadió `packages/order-validator/`: contrato puro de validación de límite de órdenes, bando, pertenencia a sectores (incluidos hexágonos compartidos), fase y revisión. Usa perfiles de cartas y un inventario de unidades **suministrados por el servidor**, nunca por el navegador. Rechaza cartas desconocidas y comandos adulterados.

```powershell
node --test packages/order-validator/validator.test.mjs
```

**11/11 pruebas locales superadas** con Node.js 22.16.0; el script general contempla ahora **27 suites**, sin regresión conjunta en Windows todavía. No hay cartas oficiales, ni integración de esta validación con el HTTP/SQLite, ni órdenes reglamentarias jugables. Véase [contrato de órdenes sintéticas](docs/28-ordenes-sinteticas.md).

## SQLite/HTTP: comprobación real de órdenes sintéticas (CCW-013)

En el laboratorio local, el procesador de `assign_synthetic_orders` valida ahora dentro de la transacción SQLite las unidades seleccionadas frente al tablero privado persistido en el servidor y una política ficticia de cartas. Rechaza identificadores inexistentes, ajenos, duplicados, órdenes excesivas y acciones fuera de fase/revisión sin crear eventos ni avanzar el estado. Las peticiones web **no pueden** suministrar perfiles de cartas, sectores o unidades de confianza. En el ejemplo: `synthetic-a` es la unidad de A y `synthetic-b` la de B; máximo ficticio de dos unidades por orden y sectores artificiales que se solapan en columnas 4 y 8. **No son reglas de Ancients**.

Las 6 pruebas nuevas del generador del contexto y 11 anteriores del validador pasaron juntas localmente con Node.js 22.16.0; la nueva prueba HTTP/SQLite del flujo completo está incluida en la suite existente **sin ejecución confirmada todavía**. El conjunto general incorpora ahora **28 suites**, aún sin regresión completa en Windows. Ver [incremento SQLite de órdenes](docs/29-ordenes-sqlite-transaccion.md).

## Iteración 4 — validación de movimiento hexagonal sintético (CCW-014)

`packages/movement/` añade un **reductor puro** para recorrer hexágonos contiguos del tablero 13×9, comprobar unidades ordenadas y propias, topes de movimiento por unidad (configuración ficticia), ocupación, celdas bloqueadas, turno/revisión y movimiento único por unidad. La entrada no puede alterar directamente el estado del servidor, y la salida contiene el tablero siguiente y un evento sin secretos. No son reglas oficiales ni movimientos jugables todavía.

```powershell
node --test packages/movement/movement.test.mjs
```

**17/17 pruebas de movimiento y 34/34 junto con las de validación de órdenes** ejecutadas correctamente con Node.js 22.16.0, sin WSL ni Actions. La batería total de la rama apilada enumera **29 suites**, pendiente de ejecución conjunta. Este módulo **no está conectado a SQLite/HTTP**. [Contrato y límites](docs/30-movimiento-sintetico-i4.md). Depende de la [PR #45](https://github.com/PedroBlanco/command-colors/pull/45), todavía en revisión.
