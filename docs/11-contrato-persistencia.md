# CCW-008 — Contrato inicial de persistencia y concurrencia

**Estado: prototipo experimental, no producción.** Este incremento es independiente de la PR #27 y no cambia el servidor HTTP ni el tablero. Solo gestiona una partida sintética con dos identidades ficticias.

## Invariantes implementadas en el prototipo

1. El almacenamiento privado incluye estado, cartas ocultas, orden de mazo, eventos y claves de idempotencia; las proyecciones por jugador excluyen cartas de otro y mazo futuro.
2. Un comando tiene actor, tipo, revisión esperada y clave de idempotencia; solo se acepta al actor al que le toca actuar.
3. La aplicación serializa solicitudes concurrentes **dentro de un único proceso**. Una acción aceptada aumenta la revisión una vez, registra evento público y conserva el resultado de idempotencia.
4. El nuevo estado es visible solo después de completar el guardado. Un fallo de I/O no altera el estado anterior en memoria.
5. Se puede abrir de nuevo el archivo tras cerrar el proceso y continuar con revisión, turno, historial e idempotencia intactos. Una entrada corrupta se rechaza sin sobrescribirla.

## Límites importantes

`packages/match-store/store.mjs` es una **prueba local** sin autenticación real, sin partidas múltiples, sin transacciones entre procesos, sin bloqueo entre instancias, sin migraciones, sin motor de reglas y sin sincronización con SSE. No debe conectarse al servidor de prueba expuesto en la red ni utilizarse para partidas reales. Aunque se escribe un archivo temporal con `mode 0600` y se renombra tras sincronizarlo, no se ofrecen garantías de durabilidad o confidencialidad equivalentes a una base de datos. En Windows, los permisos del sistema de archivos no se rigen íntegramente por los bits POSIX. No guardar datos sensibles reales.

## Contrato previsto para PostgreSQL

`database/postgresql/001_match_contract.sql` es una **propuesta de esquema no ejecutada**, no una migración aprobada. Separa la partida, los participantes, los eventos y las solicitudes idempotentes. El estado completo se conserva en una columna privada accesible solamente al backend. Cada comando exige:

1. Comprobar identidad autenticada y autorización sobre la partida.
2. Iniciar transacción y bloquear la fila de la partida (`SELECT ... FOR UPDATE`).
3. Comprobar idempotencia y revisión esperada con el estado actual.
4. Validar fase y acción con el motor del reglamento versionado.
5. Actualizar estado y revisión, insertar eventos y clave de idempotencia en la **misma transacción**.
6. Confirmar transacción y, **después**, notificar revisión a ambos navegadores (sin revelar información secreta).

No exponer `state_private` ni `payload_private` directamente mediante API, SSE, logs, errores ni respaldos sin cifrar. No habilitar acceso de administradores a secretos sin un diseño explícito de auditoría. Revisar permisos, backups, migraciones y manejo de errores antes de producción.

## Pruebas locales

Desde PowerShell, raíz del repositorio, Node.js >= 22 y sin dependencias de npm:

```powershell
node --test packages/match-store/store.test.mjs
```

Las pruebas cubren privacidad, mutaciones de vistas, actor autorizado, concurrencia, idempotencia, fallo de escritura, recuperación y rechazo de JSON corrupto. La aceptación de CCW-008 seguirá abierta hasta validar una base de datos transaccional real y reconexión del servidor tras reinicio.

## Dependencias y decisiones

CCW-004: arquitectura aún pendiente de aprobación formal. CCW-007: identidad y sesiones reales pendientes. CCW-009: proyecciones seguras y aislamiento por partida necesitan pruebas HTTP con autenticación real. El ejemplo de fichero puede desecharse sin afectar al contrato de PostgreSQL.
