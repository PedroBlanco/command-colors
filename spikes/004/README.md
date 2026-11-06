# CCW-004 — Experimento vertical de arquitectura (local)

**No es un juego, ni un sistema seguro para Internet.** Tiene dos participantes simulados A/B, un turno ficticio, manos ficticias y una vista diferente por jugador. El escenario de prueba no procede de GMT Games. El servidor usa solo memoria: **no persiste partidas**.

## Uso

Requiere Node.js >=22 (probado localmente con Node.js 22.16.0; para producción se evaluará una línea LTS soportada). Sin instalar dependencias, ejecutar desde la raíz del repositorio:

```sh
node --test packages/hex-grid/hex.test.mjs spikes/004/server.test.mjs
node spikes/004/server.mjs
```

Abrir `http://127.0.0.1:8787` en dos pestañas (una con A y otra B) y pulsar «Finalizar turno ficticio». La otra vista se actualiza cuando llega el aviso SSE. Si existe conflicto, se devuelve HTTP 409 y se muestra el estado actualizado. El servidor **solo escucha en loopback** por diseño. Detener con Ctrl+C.

## Contrato experimental

- `GET /api/state`: cabecera `x-demo-player: A` o `B` (simulación de sesión, **no es autenticación**). Respuesta con revisión, turno, unidades ficticias, mano propia y **solo el número de cartas** ajenas.
- `POST /api/command`: `{ "type": "end_demo_turn", "expectedRevision": 0, "idempotencyKey": "solicitud_123" }` y cabecera `x-demo-player`. Solo el participante cuyo turno está activo puede incrementar la revisión.
- `GET /api/events`: stream SSE solicitado mediante `fetch()` con la cabecera de demostración; evento `{"revision":n}` **sin información oculta**.
- Cliente HTML autocontenido que usa `fetch`, stream SSE y navegador normal sin dependencia de framework.

La idempotencia se guarda solo en memoria. La prueba de concurrencia envía simultáneamente dos comandos con igual revisión y comprueba que únicamente uno es aceptado. Una llamada de un jugador no autorizado o fuera de turno se rechaza.

## Lo que demuestra y lo que NO demuestra

**Demostrado localmente:** separación conceptual entre estado y proyección privada, intercambio HTTP entre pestañas, control de versión, idempotencia y avisos sin cartas privadas; pruebas unitarias y HTTP sin servicios externos.

**Pendiente antes de producción:** base de datos transaccional, usuarios/sesiones reales, autenticación y CSRF, HTTPS, rate limiting, validación completa, reglas, migraciones, estado duradero, SSE con reconexión y cursors, logs seguros, restauración, pruebas de seguridad y clientes móviles reales.

Este spike no aprueba la pila de tecnologías: proporciona evidencia para decidir. No incluye npm, Actions ni WSL.
