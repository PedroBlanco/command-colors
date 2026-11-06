# CCW-004 — Evaluación técnica y resultados provisionales

Fecha: 2026-11-06. Estado: **investigación; ADR pendiente de aprobación**.

## Experimento implementado

Ruta: `spikes/004/`. Protocolo HTTP+SSE, dos vistas diferentes de un estado simulado y comando con revisión e idempotencia. No se ha utilizado reglamento o escenario de GMT. La geometría pura de tablero se desarrolla en `packages/hex-grid/`, sin dependencias de navegador.

Resultado local: diez pruebas pasan con Node.js 22.16.0. Incluyen geometría, aislamiento de información, control de turno, revisiones, reintentos y concurrencia real mediante HTTP. No se ha probado en hosting ni en móvil físico. No hay persistencia; su diseño requiere una implementación transaccional posterior.

## Alternativas para la arquitectura final

| Pila | Ventajas | Costes y riesgos |
| --- | --- | --- |
| TypeScript cliente + servidor Node.js | Lenguaje compartido, contratos comunes, motor puro, buena compatibilidad SSE | Necesita decisiones de framework, validación y construcción; gestionar ecosistema npm |
| TypeScript cliente + FastAPI/Python | Buen tipado opcional y validación, servidor familiar en entornos Python | Contratos duplicados entre lenguajes o generación de esquemas; más componentes |
| TypeScript cliente + PHP/Symfony | Madurez backend, permisos y persistencia; experiencia existente con Symfony | SSE de larga duración puede requerir proceso especializado; dos lenguajes |

**Recomendación provisional:** TypeScript para núcleo, cliente y servidor Node.js; separar el motor del framework. SVG para tablero. PostgreSQL para transacciones. HTTP con comandos y notificaciones SSE; estudiar WebSocket si las pruebas de dos jugadores lo requieren. Esta recomendación **no sustituye la decisión formal de la issue #4**. Las primeras pruebas usan JavaScript ESM deliberadamente para evitar dependencias y validar el protocolo antes de escoger framework.

Node.js 26.x es LTS desde octubre de 2026, y 24.x sigue con soporte. Antes de configurar el entorno definitivo, fijar versión por política de seguridad y dependencias, en lugar de copiar la versión 22.x del laboratorio de pruebas. Referencia: https://github.com/nodejs/Release .

## Observaciones y riesgos

1. SSE funciona con streaming HTTP; el navegador usa `fetch()` para adjuntar una cabecera **solo de demostración**; en aplicación final se usarán sesiones autentificadas y controles CSRF adecuados, no este mecanismo.
2. Una proyección filtrada por jugador debe aplicarse a todos los endpoints, notificaciones, errores y registros; pruebas de ausencia de cartas contrarias y del mazo futuro.
3. Un control de revisión en memoria no resuelve transacciones tras reiniciar; implementar bloqueo/compare-and-swap en PostgreSQL para I2.
4. La geometría de 13×9 y vecinos no decide a qué sector pertenece una casilla cortada por la línea de puntos; ese dato se verificará con las ediciones del reglamento. Se dispone de un mecanismo de asignaciones múltiples, sin delimitar fronteras oficiales.
5. El ejemplo solo cambia un turno ficticio: no simula fases, cartas reales, reglas de movimiento ni combate.
6. Las diez pruebas no suponen validación visual ni de seguridad. Requiere revisión funcional con ambos navegadores y equipos móviles.

## Decisión pendiente

Mantener CCW-004 abierta hasta aprobar ADR sobre framework, versiones y persistencia; completar prueba manual en dos navegadores y especificar pruebas de recuperación persistida. El código del experimento no debe integrarse en producción por accidente.
