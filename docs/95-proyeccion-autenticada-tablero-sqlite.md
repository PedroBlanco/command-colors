# LAB-ANC — Proyección de tablero autenticada en CCWB/SQLite, solo lectura

**Fecha:** 13/11/2026. **Incidencia:** [#97](https://github.com/PedroBlanco/command-colors/issues/97).  
**Rama:** `feat/ancients-authenticated-staged-board-preview`, apilada sobre [PR #107](https://github.com/PedroBlanco/command-colors/pull/107). `main` intacta.

## Objetivo

La PR #107 añadió `projectStagedAncientsBoard`, cálculo puro de un tablero provisional de unidades y líderes. Esta rama lo conecta **exclusivamente a la interfaz interna** de CCWB/SQLite: una sesión debe estar viva y pertenecer a la partida; la fase, las órdenes y el tablero proceden del diario privado reconstituido por replay íntegro dentro de la **misma lectura WAL**. El resultado sigue siendo una proyección, nunca movimiento confirmado.

## Contrato de petición normalizada

`snapshotStagedSequenceRequest` normaliza `{sessionToken, expectedRevision, actions}`, donde cada acción incluye solo `{kind,id,path}` y cada hexágono solo `{col,row}`. Comprueba:

- Registros ordinarios con claves exactas, enumerables y **descriptores propios de datos**; rechaza getters/setters, símbolos, prototipos extraños y campos añadidos.
- Arrays densos de 1 a 117 acciones y rutas de 1 a 32 hexágonos por acción; rechaza huecos, propiedades accesorias o extras y valores fuera de 13×9.
- Tipos `UNIT`/`LEADER`, identidades válidas y revisión entera no negativa.
- Una única captura inmutable de valores, sin consultar de nuevo getters de origen después de validar. Devuelve `null` ante datos corruptos, proxies excepcionales o cambios incoherentes.

Esta función **no autentica**: incluso si devuelve una petición congelada, la sesión se valida dentro del `readSnapshot` SQLite. La credencial jamás se incluye en la respuesta. La instantánea de descriptores no acredita la autenticidad de un `Proxy` malicioso.

## Composición privada

**`sqlite-store/sqlite.mjs`:** nuevo `precheckExperimentalSectionBoardProjection(request, trustedContext)`. Primero captura la petición de forma estable y deniega formato inválido con `400 INVALID_SECTION_LAB_BOARD_REQUEST`. Después abre una lectura de SQLite en WAL mediante `readSnapshot`; resuelve la sesión, comprueba pertenencia y modo laboratorio, y llama a la pasarela de replay con un bando obtenido del servidor. Revocación → 401; no miembro → 404; laboratorio no inicializado → 409.

**`sqlite-section-ccwb-bridge.mjs`:** `previewBoardProjection(actor, request, trustedContext)` llama a `verify(resultRow())`, que verifica el diario CCWB antes de pasar `snapshot` a `projectStagedAncientsBoard`. Retorna `SECTION_LAB_BOARD_PROJECTION` con una proyección de solo campos públicos y las banderas `movementAuthorized:false`, `attackAuthorized:false`, `boardChanged:false`, `canCommit:false`. No se devuelve el estado privado o las cartas.

**Reutilización del guardia:** `precheckExperimentalSectionMovementSequence` y `precheckExperimentalSectionMovementEvidence` pasan a usar la misma captura inmutable. Se elimina el anterior validador que podía comprobar campos antes de autenticación y volver a leer el objeto original después. Sus códigos de error ordinarios siguen siendo los mismos; objetos hostiles antes aceptados sintácticamente pasan a ser rechazados.

**Frontera:** los métodos siguen siendo internos. No hay ruta en el gateway HTTP/SSE, acción de navegador, escritura en `matches`, `game_events`, `game_commands` ni alteración de revisión. El contexto de reglas/terreno sigue siendo responsabilidad del servidor.

## Pruebas nuevas

Se añaden **nueve casos** a suites existentes, sin registrar ningún archivo nuevo en el manifiesto de 80 suites:

- **Tres** pruebas puras de instantánea: inmutabilidad, descarte de campos/prototipos/accesores/arrays dispersos y ausencia de lecturas de propiedades mediante trampas `get`.
- **Cuatro** pruebas de composición CCWB/SQLite: proyección reproducible tras reapertura, ausencia de escrituras y datos privados, revocación de sesión/pertenencia, solicitudes ilegales/segundas acciones y Proxy de petición.
- **Dos** regresiones para las consultas anteriores de secuencia/evidencia: captura de valores anteriores a una mutación de petición y rechazo de accesores antes de abrir WAL.

### Verificación disponible, no nativa

- **11/11** escenarios V8 con el código exacto de `staged-sequence-request-snapshot.mjs`: formas válidas, mutación, símbolos, huecos, getters y proxies.
- **8/8** escenarios V8 de extracción de métodos de capa SQLite/bridge con dependencias simuladas: autorización, 401/404/409, rechazo 400 previo a WAL y replay invocado solamente con bando permitido.
- **15/15** comprobaciones V8 de los tres métodos de consulta privados reales, mediante sesiones, WAL y puente **simulados**; incluye consistencia de instantáneas, revocación y campos indebidos.

**Límite importante:** estas verificaciones no ejecutaron el proceso `node:test`, las nueve nuevas pruebas ni la composición real SQLite/CCWB/HTTP/SSE. No hay regresión nativa de la rama. El usuario ha suspendido las pruebas locales; no solicitarlas ahora. No emplear WSL, Docker ni Actions.

## Pendiente para movimiento confirmado

No existe aún autoridad reglamentaria completa de *Ancients* básico para todos los casos de cartas, terreno, líder y edición; no se consumen órdenes ni se registra movimiento confirmado. Antes de cualquier escritura pública son imprescindibles verificación reglamentaria, **revalidación tras `BEGIN IMMEDIATE`**, control de idempotencia/revisiones, inserción atómica de eventos y comandos, replay y cierre de SEC-001 (#94). Mantener PR en borrador, no fusionar en `main` ni desplegar.
