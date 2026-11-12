# LAB-ANC — Vincular las claves de idempotencia al diario privado de cartas

**Fecha:** 11/11/2026. **Base:** PR #86. **Alcance:** adaptador de laboratorio CCWB para cartas de sección de *Ancients*. Sin HTTP nuevo, migraciones, efectos de combate ni cambios en partidas oficiales.

## Problema

El puente `sqlite-section-ccwb-bridge.mjs` cotejaba el orden de eventos, los actores, las revisiones y las firmas de los comandos. Sin embargo, la tabla `game_commands` almacenaba `idem_key` mientras el historial privado `matches.private_state.ancientsSectionHistoryLab.commands` **no conservaba esa clave**. Sustituir `idem_key` en una fila sin cambiar el comando o la revisión podía dejar una asociación errónea y escapar al cotejo anterior.

## Solución incremental

1. El nuevo módulo puro `lab-idempotency-binding.mjs` añade la clave de idempotencia **solo a la entrada privada del diario** y reconstruye el comando original sin la clave para conservar exactamente su firma semántica.
2. `sqlite-section-ccwb-bridge.mjs` consulta también `game_commands.idem_key` y exige que coincida con la clave persistida en el diario, para entradas que tengan ese campo. La comprobación se realiza durante el mismo replay ya exigido antes de leer o escribir una partida experimental.
3. Los comandos históricos del laboratorio sin `idempotencyKey` siguen pudiendo reconstruirse. Para **esas entradas antiguas**, la asociación de claves sigue sin estar auditada: es una limitación deliberadamente explícita, no una prueba retroactiva.
4. No se añaden claves a eventos públicos, vistas de manos ni al comando semántico firmado. Las claves de idempotencia no son credenciales de sesión, pero permanecen en la zona privada.

### Propiedades y limitaciones

- Se rechazan claves mal formadas o incorporadas por el llamante al propio comando que se intenta sellar.
- El comprobador no atribuye autoridad para jugar cartas, mover unidades o combatir.
- La detección protege contra **alteraciones parciales y errores de coherencia**. No hay firma criptográfica externa; alguien que controle todas las tablas y el diario privado aún podría falsear de manera coordinada su contenido. La posibilidad de compatibilidad con registros antiguos tampoco proporciona una prueba retrospectiva de esos registros.
- Se mantiene `CCWB v1` con seis tablas y el modo experimental aislado de los endpoints HTTP.

## Evidencias

Se ejecutó en Linux nativo, Node.js **22.16.0**, sin WSL ni GitHub Actions:

```sh
node --test --test-reporter=tap packages/ancients-rules/lab-idempotency-binding.test.mjs
```

Resultado del nuevo módulo: **8 PASS, 0 FAIL, 0 SKIP**. Los hashes Git locales de los dos archivos realmente ejecutados coinciden con GitHub:

- `lab-idempotency-binding.mjs`: `3ca405f395eb0953d4b859b198005ac4bdc6bbf7`.
- `lab-idempotency-binding.test.mjs`: `850f34d9a45b84958ef7d0c14a5ec3a5de550a58`.

Se escribieron **3 pruebas adicionales** en `sqlite-section-ccwb-bridge.test.mjs`: manipulación de `idem_key` en SQLite, continuidad de un diario legacy sin clave y privacidad en proyecciones públicas. **Aún no se han ejecutado** en un checkout completo y no deben contarse entre los 8 PASS. La batería de composición de la PR #86 también permanece pendiente.

El manifiesto local registra **64 suites** (63 anteriores + la nueva suite pura); no significa que se hayan ejecutado conjuntamente.

## Validación y siguiente paso

En Windows 11 sin WSL, desde la rama completa:

```powershell
node --test --test-reporter=tap packages/ancients-rules/lab-idempotency-binding.test.mjs packages/ancients-rules/sqlite-section-ccwb-bridge.test.mjs packages/sqlite-store/ancients-section-history.test.mjs
$LASTEXITCODE
.\scripts\test-local.ps1
$LASTEXITCODE
```

Quedan pendientes la regresión de 64 suites, privacidad real por dos sesiones, pruebas HTTP/SSE, Windows y la validación reglamentaria. Mantener la PR en **borrador** hasta disponer de esa evidencia. No fusionar ni desplegar.


## Endurecimiento posterior: firma versionada v2 (11/11/2026)

Tras revisar el contrato anterior se detectó un **caso de degradación silenciosa**: si se borraba la propiedad privada `idempotencyKey` de un comando nuevo, `readLabJournalIdempotency` lo interpretaba como un registro `legacy` y el `verify` anterior dejaba de comprobar esa clave. El resto del diario podía seguir siendo válido. Este problema invalida la pretensión de que toda eliminación aislada de una clave nueva quedaba siempre detectada en la implementación inicial.

Para las nuevas operaciones, `lab-command-signature.mjs` genera una firma semántica privada **`CCW_SECTION_COMMAND_V2:` + JSON de `{command,idempotencyKey}`**. El replay distingue por el contenido realmente persistido en `game_commands.signature`:

- Una firma **v2** requiere que la entrada del diario **conserve la clave**, que esta coincida con `game_commands.idem_key`, y que la firma completa corresponda exactamente al comando y la clave. Borrar solo el campo del diario deja de pasar por la ruta de compatibilidad.
- Una firma **anterior sin prefijo** sigue comprobándose como `JSON.stringify(command)`; el reintento con la misma clave y operación continúa devolviendo `ALREADY_APPLIED`. La asociación de claves de los registros históricos es **más débil** y no se presenta como una garantía v2.
- El nuevo formato se escribe solamente en `game_commands.signature`, y la clave sigue exclusivamente en SQLite y el diario privado; el evento público contiene únicamente el resultado sanitizado.
- No hay migraciones de las seis tablas CCWB, ni cambios HTTP, autorizaciones de combate o reglas oficiales.

**Límite explícito:** no hay anclaje criptográfico externo de integridad. Quien pueda reescribir de manera coordinada el historial y las firmas de la propia base podría falsificar una historia coherente, incluida su versión. Esta mejora detecta cambios aislados y degradaciones puntuales, no compromisos completos de SQLite.

### Validación real y pendientes

Ejecutadas **11/11 pruebas nativas PASS** de `packages/ancients-rules/lab-command-signature.test.mjs`, con Node.js **22.16.0/Linux nativo**, sin WSL ni GitHub Actions. Hashes Git cotejados con los bytes probados:

- `lab-command-signature.mjs`: `e0f1d08f6e4a9bdac96253fc06f141da1f76fbe8`
- `lab-command-signature.test.mjs`: `566007608618604c8c3983636796806e2f51ff99`

Las pruebas puras contemplan firma v2, eliminación de clave privada, sustitución de clave SQL, cambios de comando, lectura legacy, reintentos de ambos formatos e entradas inválidas. Se han preparado **4 pruebas de integración SQLite adicionales** y adaptado el escenario de compatibilidad legacy de la PR #87 para que represente una fila realmente antigua (firma y diario en formato anterior), no una alteración fraudulenta de una fila v2. **No se han ejecutado todavía esas pruebas SQLite** desde el checkout completo.

El inventario crece a **65 suites registradas** (antes 64). **No representa una regresión total ejecutada**. Se conserva el bloqueo de fusiones y despliegue. Los resultados anteriores de 8/8 del helper inicial siguen siendo históricos y no equivalen a la validación integral de este endurecimiento.


### Entrada maliciosa: nombres heredados de `Object.prototype`

En la revisión final se corrigió un fallo adicional en `sqlite-section-ccwb-bridge.mjs`: `TYPES[request.type]` accedía a propiedades heredadas, y la expansión de una de ellas como lista de campos podía provocar una excepción antes de validar el tipo. La búsqueda de campos se hace ahora **solo tras verificar que el tipo es una propiedad propia** de la tabla de comandos. `__proto__`, `constructor` y `toString` deben responder `400 INVALID_SECTION_LAB_COMMAND` y no alterar SQLite. Estos casos se han añadido a la suite de integración **pendiente de ejecución**.


### Ejecución conjunta de los módulos puros

Se han ejecutado además **ambas suites puras juntas**, no solo por separado:

```sh
node --test --test-reporter=tap packages/ancients-rules/lab-idempotency-binding.test.mjs packages/ancients-rules/lab-command-signature.test.mjs
```

**19 PASS, 0 FAIL, 0 SKIP**, Node.js 22.16.0/Linux nativo. SHA-256 del TAP conjunto: `7170cce0fd02bee3652905dc1d72f7dfac73cc24ca8defd9b9480a966fc76386`. Los hashes Git locales de los cuatro archivos coincidieron con los publicados:

- `lab-idempotency-binding.mjs`: `3ca405f395eb0953d4b859b198005ac4bdc6bbf7`
- `lab-idempotency-binding.test.mjs`: `850f34d9a45b84958ef7d0c14a5ec3a5de550a58`
- `lab-command-signature.mjs`: `e0f1d08f6e4a9bdac96253fc06f141da1f76fbe8`
- `lab-command-signature.test.mjs`: `566007608618604c8c3983636796806e2f51ff99`

Esta comprobación no ejecuta el puente SQLite ni ninguna otra de las 63 suites restantes del inventario total de 65.


> **Clasificación de seguimiento (12/11/2026):** se corrige el identificador inicial de esta documentación, que vinculaba incorrectamente esta fase a `CCW-015` (reservado para dados digitales). El trabajo histórico y sus PR conservan sus números originales; este documento se clasifica ahora como `LAB-ANC` (laboratorio privado de cartas, órdenes o movimiento de *Ancients*).
