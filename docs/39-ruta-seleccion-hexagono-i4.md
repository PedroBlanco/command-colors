# CCW-014 — Preparación de rutas seleccionadas en tablero SVG

**Fecha:** 9 de noviembre de 2026. **Rama:** `feat/i4-svg-movement-path-draft`, apilada sobre PR #48 y sus dependencias #47, #46 y #45.

## Objetivo y alcance

Preparar un contrato **puro y aislado** para que, cuando se apruebe la vista SVG de la PR #27, el navegador pueda seleccionar una unidad propia, encadenar hexágonos y corregir localmente la ruta **sin enviar órdenes parciales al servidor**.

El módulo nuevo `packages/local-api/hex-selection.mjs` reutiliza la geometría *odd-q* de `packages/hex-grid/hex.mjs` y las acciones disponibles del controlador de cartas `deck-controls.mjs`. Ofrece:

- `beginMovementDraft(view, unitId)`: comienza desde una unidad propia, visible y todavía no movida; solo durante el turno/fase habilitados.
- `appendMovementHex(view, draft, destination)`: añade un hexágono contiguo, dentro del tablero y sin ocupar; no permite ciclos y limita el borrador a 32 pasos.
- `undoMovementHex(view, draft)`: retira el último paso en el navegador sin tocar la partida ni su revisión.
- `movementDraftFields(view, draft)`: devuelve **solo** `unitId` y `path`, copiados y sin campos de autoridad. Esos datos se pasan después al `deckCommand()` existente, que añade revisión e idempotencia.

**Seguridad y límites:** el cliente utiliza únicamente la vista autorizada; rechaza unidades enemigas o ya movidas, tableros duplicados, información incompleta y borradores caducados tras una nueva revisión. No incluye actor en la orden. La comprobación es una ayuda visual: el servidor **siempre** decide órdenes, fase, distancia, terreno, idempotencia y aceptación definitiva. Los dos hexágonos ficticios de movimiento de laboratorio no son reglas oficiales de *Ancients*.

## Verificación ejecutada

En un directorio aislado se ejecutaron los **archivos exactos** publicados, junto con los dos módulos existentes de dependencia. Node.js **22.16.0**, Linux x64, sin WSL, GitHub Actions, VPS ni servidor web:

```sh
node --check packages/local-api/hex-selection.mjs
node --check packages/local-api/hex-selection.test.mjs
node --test packages/local-api/hex-selection.test.mjs
```

**11/11 pruebas correctas, 0 fallos**, con cobertura de selección propia, cambio de turno/fase, movimiento previo, revisión obsoleta, geometría de bordes, celdas ocupadas, saltos, retornos, eliminación local, máximo de 32 pasos, saneamiento de los datos y compatibilidad con `deckCommand()`.

Comprobación cruzada de SHA de objeto Git (`git hash-object` local = GitHub):

| Archivo | SHA Git |
| --- | --- |
| `packages/local-api/hex-selection.mjs` | `5d75efc729562ae7f4dac9fc886dd496a682b553` |
| `packages/local-api/hex-selection.test.mjs` | `8158cdb1937cdcb2ed12f2cde57a3fa75072ea37` |
| `packages/hex-grid/hex.mjs` | `ae0e4526b8e91c4c0d5d94aebc52077b60f410da` |
| `packages/local-api/deck-controls.mjs` | `254dcb1cb148c771dfce82853b4c7cf9f8337228` |

El manifiesto local incorpora una suite adicional (**34 en esta rama**); el contador del diagnóstico se actualiza a 34. **No se han ejecutado aquí las otras 33 suites**, ni las siete pendientes de la PR #48, ni validación visual real.

## Integración pendiente

1. Mantener esta PR en **borrador** apilada sobre #48; no fusionar hasta validar y consolidar antes #45–#48.
2. Ejecutar la batería de 34 suites localmente en Windows 11 PowerShell y resolver los siete casos de suite pendientes de la rama anterior.
3. Validar visual, táctil y por teclado el tablero SVG de PR #27, con dos sesiones autenticadas.
4. En un incremento posterior, conectar eventos del SVG a este borrador, presentar la ruta y confirmar la acción mediante el `deckCommand()` ya existente. No copiar la identidad ficticia A/B del prototipo #27 al servidor autenticado.
5. Continuar manteniendo las reglas sintéticas separadas de una edición oficial del reglamento y sus autorizaciones.

No hay despliegue ni cambios en `main`.
