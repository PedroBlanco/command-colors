# LAB-ANC / R-04 — contrato propuesto para movimientos confirmados

**Estado (12/11/2026): diseño, NO implementado.** La PR #96 solo genera trazas `CANDIDATE_EVIDENCE`. Este documento fija la frontera de autorización que deberá respetar la siguiente fase, sin habilitarla ni exponer nuevas rutas.

## Separación obligatoria de artefactos

| Artefacto | Procedencia | Puede mutar la partida |
|---|---|---|
| `ancientsSectionMovementDraft` | Borrador privado editable por su propietario | **No** |
| `CANDIDATE_EVIDENCE` | Preflight de órdenes y trayectorias, con SHA-256 | **No** |
| `ANCIENTS_MOVEMENT_COMMITTED_V1` (reservado) | Futuro reductor reglamentario servidor, tras revalidar dentro de transacción | **Sí, solo una vez implementado y probado** |

No implementar una conversión `candidate -> committed`, ni una función que acepte una traza candidata como permiso. Su cadena SHA-256 prueba consistencia con un contexto reconstruido, **no autoridad reglamentaria ni autenticación**. El cliente solo podrá enviar intención de acción y su clave de idempotencia; nunca `actor`, tablero, mano, perfiles, terreno, `contextDigest`, resúmenes, órdenes o resultado ya autorizado.

## Contrato de entrada reservado

La futura operación interna recibirá una intención mínima de movimiento (pieza y ruta), revisión esperada, clave de idempotencia y credencial de sesión. La autoridad debe derivar de **un único almacén servidor**: usuario y bando activos, partida, escenario, reglas, órdenes vigentes, historial de movimientos anteriores, fase, posiciones y terreno. Se utilizará el reductor reglamentario definitivo para *Ancients* básico, no los filtros `CANDIDATE`/`CANDIDATE_SEQUENCE` como fuente de legalidad.

Las excepciones (cartas, movimiento especial, combate, retirada, evasión, líder asociado y restricciones de terreno) se modelarán explícitamente. Una regla no implementada ha de producir un rechazo controlado; no se permiten estimaciones ni permisos por defecto.

## Transacción e historial

1. Abrir `BEGIN IMMEDIATE` en la misma base SQLite/WAL que las sesiones y la partida; sin confiar en autenticaciones o preflights previos al bloqueo.
2. Revalidar sesión/no caducidad, pertenencia/bando, fase, turno, revisión, órdenes emitidas y no consumidas, situación exacta del tablero y movimientos ya efectuados.
3. Ejecutar el reductor oficial sobre **copia del estado**, comprobando cada submovimiento (incluida la secuencia líder–unidad) y todas las reglas pertinentes. No escribir nada tras un resultado parcial.
4. Para éxito autorizado, actualizar tablero y revisión, consumo de órdenes/marcadores y diario privado, más `game_commands` con firma/idempotencia y `game_events` con **proyección pública mínima**, todo en **la misma transacción**. El diario debe permitir replay determinista.
5. Si falla alguna precondición, deshacer toda la transacción. Un reintento idéntico y ya confirmado devuelve el resultado anterior; una clave reutilizada con payload diferente se rechaza.
6. La vista de los dos jugadores debe provenir de una única instantánea y jamás revelar mano rival, borradores privados o evidencia experimental. El despliegue público depende además de SEC-001 (#93).

Un futuro evento confirmado debe tener identidad y revisión inequívocas, versión de regla/escenario y origen reglamentario servidor. Su contenido público no incluirá la mano ni los datos internos del historial. Esta forma todavía **no es un esquema ejecutable** y el identificador reservado no debe emitirse hasta superar las verificaciones.

## Matriz mínima de pruebas futuras

- **Reglas:** trayectos legales e ilegales por tipo, distancias, entrada/atravesamiento, colisiones, terreno, líder solo o asociado, separación y reunión; cartas ordinarias y excepciones separadas.
- **Órdenes y concurrencia:** pieza no ordenada, acción duplicada, líder ya movido, revisión obsoleta, dos conexiones concurrentes, logout/revocación confirmados antes de bloquear, carrera de reintento idempotente.
- **Integridad:** cambio de tipo, escenario, terreno o tablero, trazas `CANDIDATE_EVIDENCE` manipuladas, intentos de enviar un `ANCIENTS_MOVEMENT_COMMITTED_V1` fabricado y comandos con campos extra.
- **Atomicidad y replay:** rollback ante fallo en cada punto de escritura, coherencia entre `matches`, `game_events` y `game_commands`, replay de estado y proyección pública/redacción de manos.
- **Integración:** SQLite real con WAL, seguridad HTTP/SSE de SEC-001, dos sesiones reales, manifiesto completo y regresión nativa del SHA exacto; sin WSL, Docker ni Actions.

**Condición de salida:** la futura PR de movimientos confirmados debe distinguir, con pruebas reproducibles, rechazo, preflight, autorización reglamentaria y confirmación transaccional. Mientras tanto, todas las consultas `LAB-ANC` siguen siendo privadas y **`movementAuthorized:false`**.
