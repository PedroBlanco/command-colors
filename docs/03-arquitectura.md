# Arquitectura — propuestas pendientes de validación

## Capas

1. Cliente responsive: tablero SVG, selección táctil, mano propia, panel de decisión y estado de conexión. No es fuente de autoridad.
2. Servicio HTTP: cuentas, invitaciones, autorización, comandos y proyección de vistas privadas.
3. Motor de juego puro: coordenadas hexagonales, fases, eventos y transiciones.
4. Rulesets: Ancients básico, después Napoleonics básico, ampliaciones versionadas.
5. Persistencia: estado actual y registro ordenado de eventos en transacción.
6. Sincronización: HTTP para comandos y recuperación, SSE para aviso de cambios. WebSocket solo si se justifica.

## ADR preliminares

| ADR | Estado | Decisión |
| --- | --- | --- |
| 001 | Requisito confirmado | Dos jugadores, manos privadas, modos síncrono/asíncrono |
| 002 | Propuesta | Motor independiente de red y DB |
| 003 | Propuesta | Estado autoritativo, proyección por jugador |
| 004 | Propuesta | Estado + eventos, revisiones e idempotencia |
| 005 | Propuesta | HTTP + SSE con reconexión |
| 006 | Propuesta | PostgreSQL |
| 007 | Propuesta | Monorepo y pruebas locales primero |
| 008 | Pendiente | Elegir tecnologías y versiones tras pequeña prueba |

## Pila a evaluar

- Primera candidata: TypeScript en cliente y motor; Node/Fastify en servidor, React/Vite o Svelte para web, PostgreSQL, Vitest y Playwright.
- Alternativa: Python/FastAPI en servidor y TypeScript en cliente.
- Alternativa: PHP/Symfony en servidor y TypeScript en cliente.

No considerar la primera candidata aprobada. El experimento de arquitectura de la iteración 0 comparará ergonomía móvil, interfaces del motor, transacciones, privacidad de eventos y despliegue local reproducible.

## Seguridad

Autorización en cada solicitud, separación de datos públicos/privados antes de serializar, sesiones seguras, protección contra enumeración, invitaciones no adivinables, métricas sin secretos, revisión de dependencias y copias verificadas.

## Operación

Servidor propio o VPS por seleccionar. Antes de producción: TLS, migraciones, backups, prueba de restauración, monitorización básica y procedimiento de actualización/rollback. Priorizar pruebas en local frente a CI remota costosa.

## Documentación de decisiones

Cambios que alteren contratos entre capas deben registrarse mediante ADR y comprobarse con pruebas de regresión de juegos ya soportados.
