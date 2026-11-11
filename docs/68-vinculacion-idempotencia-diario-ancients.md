# CCW-015 — Vincular las claves de idempotencia al diario privado de cartas

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
