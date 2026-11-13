# LAB-ANC — Instantánea inmutable de escritura de borradores privados

**Fecha:** 13/11/2026 · **Seguimiento:** #97 · **Base:** PR consolidada #108 (`d612100b57988ad3f632b547047ef80d24450093`).

## Motivo

`saveExperimentalSectionMovementDraft` validaba los campos de la petición, pero después **volvía a leer** `sessionToken`, `expectedRevision`, `expectedDraftRevision`, `idempotencyKey` y las acciones del objeto original bajo `BEGIN IMMEDIATE`. Un objeto mutable o un `Proxy` podía cambiar entre el control de forma, la autenticación, la prevalidación y la persistencia del borrador. El mecanismo de idempotencia se calculaba a partir de esas segundas lecturas.

## Cambio

- Se añade `snapshotStagedMovementDraftRequest(request)`, que solo acepta `{sessionToken, expectedRevision, expectedDraftRevision, idempotencyKey, actions}`, todas **propiedades propias enumerables de datos**, sin extras, símbolos ni accessors. El resto del contrato coincide con el de secuencias: acción `{kind,id,path}`, celda `{col,row}`, 1–117 acciones, 1–32 celdas por ruta y geometría 13×9.
- Las revisiones son enteros seguros no negativos, y `idempotencyKey` coincide con `/^[A-Za-z0-9_-]{8,80}$/`.
- La función produce una copia **profundamente inmutable** de los valores relevantes. Devuelve `null` ante cualquier entrada inválida o `Proxy` excepcional. No ejecuta getters ni lee los campos de origen de nuevo después de capturarlos.
- `saveExperimentalSectionMovementDraft` utiliza **solo esa instantánea** para autenticación dentro del lock, control de revisión, replay CCWB, comprobación de idempotencia y persistencia. Se conserva la semántica anterior de `SECTION_LAB_DRAFT_SAVED`, `ALREADY_APPLIED`, conflictos y denegaciones. El contexto `trustedContext` continúa siendo responsabilidad del servidor; nunca debe proceder del cliente.
- El borrador sigue escrito únicamente en `private_state`, sin aumentar `game_revision`, sin modificar el tablero oficial, sin eventos públicos y sin ninguna ruta HTTP/SSE.

## Pruebas nuevas

Se añaden seis casos a las **dos suites existentes** (`staged-movement-preflight.test.mjs` y `ancients-section-history.test.mjs`):

1. Snapshot del borrador con revisiones, idempotencia y rutas conservadas después de mutar el original.
2. Rechazo de campos de autoridad, claves inválidas, arrays dispersos, valores no válidos.
3. Lectura exclusiva de descriptores, sin getters, incluso con `Proxy`.
4. Integración CCWB/SQLite: mutar todos los campos originales durante la resolución de sesión **dentro del lock** y verificar que el borrador persiste los valores capturados, sin cambiar revisión ni lobby.
5. Rechazo de accessors y listas dispersas antes de adquirir el bloqueo de escritura, sin cambios de filas.
6. Integración de `Proxy` con trampas de lectura, sin ejecutar ninguna; persiste únicamente el contenido normalizado.

### Evidencia disponible

- **17/17** casos V8 aislados, ejecutados sobre código real del capturador obtenido de GitHub.
- **7/7** comprobaciones V8 del método real de escritura extraído, con SQLite, sesión, CCWB y propuesta **simulados**.
- Análisis sintáctico V8 de cuatro módulos y suites: **4/4** correctos.

**No se han ejecutado los seis casos nuevos mediante `node:test` ni SQLite real.** La regresión Windows reportada de 1039 pruebas y 80 suites corresponde **solo a la PR #108 anterior**. Esta rama añade seis casos: el total esperado de la regresión, si no se modifica ninguna otra suite, es 1045, pero **no está validado**.

## Bloqueos que permanecen

No hay autorización oficial de movimiento, no se consume ninguna orden ni se registran eventos de movimiento. El futuro reductor debe verificar reglamento, fase, sesión, pertenencia, revisión e idempotencia bajo `BEGIN IMMEDIATE`, actualizar estado/eventos/comandos de forma atómica y asegurar replay; cerrar SEC-001 (#94) antes de cualquier despliegue. Esta rama debe mantenerse en borrador y fuera de `main`.
