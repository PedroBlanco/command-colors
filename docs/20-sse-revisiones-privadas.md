# CCW-010 — Sincronización SSE por revisiones privadas (laboratorio I2)

**Estado:** incremento experimental para dos jugadores, exclusivamente en `127.0.0.1` y con cuentas/partidas sintéticas. No es una aplicación lista para Internet ni implementa aún el reglamento de *Ancients*.

## Contrato del canal

Una sesión válida que participa en una partida puede abrir:

```text
GET /api/matches/:matchId/updates
Accept: text/event-stream
Cookie: ccw_lab_session=...
```

La autenticación se toma de la cookie `HttpOnly`, se rechazan terceros con `404`, y el servidor comprueba la sesión y pertenencia en cada intervalo de sondeo. No se admite el modo Bearer antiguo para SSE. La sala todavía no aceptada puede ser observada por el anfitrión, pero no por el invitado hasta que ocupe la plaza B.

Los avisos SSE contienen **solo números de revisión**, no cartas, manos, mazo, dados, historial de combate, estados privados, usuarios ni tokens:

```text
id: 1:2
event: revision
data: {"lobbyRevision":1,"gameRevision":2}
```

En sala de espera, `gameRevision` es `null`. Cuando la plaza B se ocupa, cambia `lobbyRevision`. Cada comando confirmado incrementa `gameRevision`. El servidor **no reenvía comandos** ni retransmite eventos históricos; después de reconectar, el primer aviso refleja la **revisión actual**, y el navegador solicita su estado privado con un GET autorizado. Por ello las interrupciones no duplican acciones. El cliente deduplica notificaciones por par de revisiones y evita refrescar mientras la pestaña está oculta, reanudándolo cuando vuelve a mostrarse.

## Seguridad y límites de recursos

- En modo web se aplica la comprobación de `Host` y el origen configurado antes de abrir el canal, además de la pertenencia a la partida.
- Sesión caducada, revocada o retirada de la partida: la conexión se cierra en el siguiente sondeo.
- Límite de **16 conexiones SSE simultáneas por instancia**, con respuesta HTTP `429` si se supera.
- Sondeo de laboratorio cada 1 segundo por defecto (configurable para tests); no es un sistema de notificaciones interproceso ni push desde la transacción.
- No se aceptan parámetros de consulta y se excluyen secretos del encabezado, ID SSE y cuerpo.
- Los avisos de revisión pueden exponer metadatos mínimos de actividad a quien **ya está autorizado** en esa partida. El canal es transportado por HTTP solo en loopback, no por una red externa.

**Pendientes:** notificación eficiente desde la base de datos para varios procesos, backpressure, heartbeat, estrategias de saturación, límites por usuario, revisión de amenazas CSRF/SSE con proxy TLS, autorización centralizada y prueba de conexión entre dos dispositivos. El servidor todavía no está preparado para Internet.

## Pruebas

Desde la rama que contiene este incremento, con Node.js >= 22.16.0 en PowerShell (sin WSL, npm ni Actions):

```powershell
node --test packages/local-api/revision-stream.test.mjs packages/local-api/browser-ui.test.mjs
.\scripts\test-local.ps1
```

Las seis pruebas nuevas verifican: notificación al aceptar invitación y cambiar turno, ausencia de cartas en SSE, reconexión desde la revisión actual, caducidad de sesión en stream, límite de conexiones, reacción de la interfaz sin repetición y limpieza de suscripciones en cambios de partida o pestaña oculta. Se han ejecutado **las 17 suites juntas: 99 pruebas superadas, cero fallos** en Node.js 22.16.0.

Las pruebas de UI utilizan DOM y `EventSource` simulados; las pruebas SSE usan **HTTP real y SQLite real**, pero el navegador gráfico está pendiente de validación. La PR #27 del tablero SVG sigue separada: este incremento mejora solo la página de laboratorio de sesiones, no sustituye su interfaz.

## Estrategia de integración

PR apilada sobre **#35**, que a su vez se apila sobre #34 → #33 → #32 → #31. Mantener todas las ramas en borrador hasta revisión y evitar fusionar dos veces los cambios de #28–#30. `main` no se modifica con estas pruebas.
