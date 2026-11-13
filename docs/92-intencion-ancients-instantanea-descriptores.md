# LAB-ANC — instantánea de entrada para la intención futura de movimiento

**Fecha:** 13/11/2026  
**Rama:** `fix/ancients-intent-immutable-descriptor-snapshot` (base: PR #104, `cab4bea39b2767e383974cb7b8f779ad77ffb268`).  
**Incidencia:** [#97](https://github.com/PedroBlanco/command-colors/issues/97), movimiento confirmado de *Ancients* básico.  
**Alcance:** seguridad de datos de entrada **exclusivamente**; no incorpora una ruta HTTP, no escribe en SQLite, no modifica el tablero y no concede legalidad ni autorización.

## Fallo de contrato evitado

`screenAncientsMovementCommitIntent` verificaba con descriptores que la petición tuviese exactamente los campos aceptados y no contuviera accesores, pero **después volvía a leer los valores por sus propiedades originales**, incluso las coordenadas, la longitud y los elementos del array. Si la entrada fuese un `Proxy` o cambiase durante el cribado, la segunda lectura podría diferir del valor comprobado. Una petición no fiable no debe poder alterar la intención que se normaliza entre dos fases de la misma función.

La pantalla de formato acepta una petición con: `sessionToken`, `expectedRevision`, `idempotencyKey`, `kind`, `pieceId` y `path`. No acepta `actor`, `matchId`, `board`, `terrain`, `hands`, `unitTypes`, `contextDigest`, eventos, órdenes, ni un supuesto resultado ya autorizado. La credencial se comprueba de forma **solo sintáctica** y no se incluye en el resultado.

## Corrección aplicada

Se reemplazan las lecturas posteriores del objeto por una **captura única de descriptores propios de datos**:

1. Se verifica que la petición sea un registro ordinario, con claves exactas, propias y enumerables. Cada valor se toma una sola vez del descriptor `value`, sin invocar `request[clave]`.
2. La ruta exige array denso ordinario, de 1 a 32 celdas. Su longitud procede del descriptor propio `length`, no de `array.length`.
3. Cada celda debe ser otro registro ordinario con **solo** `col` y `row`, enteros seguros y dentro de la rejilla canónica de 13 × 9. Se genera una copia congelada por celda y del array completo.
4. `kind`, identificador de pieza, revisión y clave de idempotencia se validan y copian desde el registro capturado. Ante un error, descriptor incoherente, array disperso, campo adicional, propiedad accesora o excepción de un `Proxy`, se rechaza sin estado parcial.
5. La respuesta continua siendo **`INTENT_SHAPE_VALID` con `movementAuthorized:false`, `attackAuthorized:false`, `stateChanged:false`, `needsFullLegalityCheck:true`**; ni la validación correcta ni los parámetros congelados constituyen una orden ejecutable.

Un `Proxy` aún puede mentir desde sus propias trampas de descriptores: el contrato **no garantiza** que el objeto originario sea auténtico; garantiza que solo se normalizan los valores de datos capturados y validados, sin invocar lecturas `get` posteriores. La autoridad deberá proceder de la sesión y del escenario servidor bajo la transacción definitiva, no de esta función.

## Encaje con las reglas

La interpretación adoptada sigue siendo la del juego básico descrito en `ANCIENTS_RULESET = 'ancients-base-3e-2009'`. Como referencia documental externa se ha consultado el capítulo [08. Movement de Commands and Colors: Ancients](https://www.commandsandcolors.net/ancients/the-game/main/08-movement.html), publicado inicialmente en 2009 y actualizado en su sitio en 2026. Describe órdenes secuenciales, movimientos por clase, restricciones de ocupación, diferencias para líderes y excepciones de determinadas cartas y terreno.

**Pendiente de autoridad reglamentaria:** cartas especiales y su efecto sobre unidades ordenadas; excepciones de tránsito por unidades amigas; líderes asociados y separación según carta; efectos de terreno; carga obligatoria de guerreros; escenarios oficiales y edición concreta. El cribado de formato no decide nada de ello. Tampoco consume órdenes ni emite `ANCIENTS_MOVEMENT_COMMITTED_V1`. La matriz de reglas de [docs/04-matriz-reglas.md](04-matriz-reglas.md) sigue siendo el inventario de desarrollo, no un certificado de legalidad.

## Pruebas y límites

En `movement-commit-intent-screen.test.mjs` se conservan los trece casos anteriores y se añaden **cuatro nuevos**:

- Un `Proxy` del objeto raíz cuya trampa `get` falsifica `kind`, revisión o identificador, o lanza una excepción al consultar la sesión, no activa ninguna lectura `get` y se normaliza exclusivamente a partir de los descriptores propios capturados.
- Un `Proxy` para la ruta y otro para una celda que alteran `length` y coordenadas al leerse por propiedad no pueden modificar la trayectoria resultante; no se llama al método `map` del objeto original.
- Mutar la petición original después del cribado no altera la intención profundamente congelada.
- Una mutación provocada al consultar el descriptor de `path` no puede retroactivamente modificar el identificador de pieza ya capturado.

**Verificación disponible:** los **17/17** casos existentes y nuevos de la suite se ejecutaron con los blobs exactos de `hex.mjs` y del filtro real en un ejecutor V8 aislado, sustituyendo `node:test` y `structuredClone` por equivalentes de prueba. **No es una ejecución nativa de Node de la rama completa**, ni verificación HTTP/SQLite. No se solicita prueba al usuario mientras dure su pausa.

### Siguientes hitos

- Definir y verificar frente a reglas oficiales el reductor autoritativo de *Ancients* básico y sus excepciones, sin adivinar datos de escenarios o cartas no disponibles.
- Autorizar sesión/bando/órdenes/revisión **dentro** de `BEGIN IMMEDIATE`, ejecutar reglas sobre copia, consumir las órdenes y escribir estado, historial y eventos mínimos de forma atómica con idempotencia.
- Probar posteriormente integración real con dos conexiones WAL, revocación, replay, HTTP/SSE y regresión completa cuando puedan retomarse las validaciones.
- **No** exponer la entrada de cribado como un endpoint de movimiento confirmado ni fusionar ninguna de estas PR experimentales a `main` antes de ese trabajo.
