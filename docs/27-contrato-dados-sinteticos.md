# Contrato de captura de dados, sin reglamento oficial (CCW-015/016)

**Fecha:** 7 de noviembre de 2026. **Estado:** núcleo aislado de dominio, no conectado al servidor HTTP ni al combate reglamentario.

## Alcance

El módulo `packages/dice-roller/dice.mjs` implementa dos funciones sin dependencia de una edición física:

- `generateDigitalRoll(spec, randomIndex?)`: una elección uniforme por **posición** de cada cara, con `node:crypto.randomInt` por defecto; generador inyectable únicamente para pruebas. Las caras repetidas son posiciones distintas y permiten representar frecuencias desiguales.
- `recordPhysicalRoll(spec, declaredFaces)`: registra las caras introducidas por el jugador, tras comprobar cantidad y pertenencia al conjunto permitido. **No verifica que coincidan con los dados físicos**, y registra la procedencia `PLAYER_DECLARED`.

El contrato de `spec` incluye `rollId`, `actor` (`A`/`B`), `diceCount` (1–32) y `dieFaces` (2–16 posiciones, identificadores simbólicos en mayúsculas). **El servidor y el reglamento aprobado deben suministrar esta especificación**, nunca el navegador. El evento lleva `source`, `results`, `verification`, `rollId` y `actor`; no lleva semilla de azar.

Para validar con Node.js 22.16.0 en Windows PowerShell:

```powershell
node --test packages/dice-roller/dice.test.mjs
.\scripts\test-local.ps1
```

Las **12 pruebas nuevas** han pasado en Node.js 22.16.0: azar inyectado, selección con `crypto.randomInt`, caras repetidas, equivalencia de resultados físicos/digitales, trazabilidad, rechazo de cuentas/caras/cantidades ilegales e inmutabilidad de entrada. El script general registra ahora **26 suites**, pero la batería conjunta completa y la ejecución en Windows están **pendientes**.

## Frontera de confianza y siguientes pasos

1. La sesión HTTP debe fijar quién puede tirar, el modo acordado y una `rollId` única. El cliente solo debe enviar las caras declaradas cuando proceda; no selecciona actor, cantidad ni caras permitidas.
2. Un servicio transaccional posterior deberá comprobar fase y revisión, idempotencia por tirada, y persistir estado y evento en la misma transacción con el resto del combate.
3. La declaración de dados físicos requiere una decisión separada sobre confirmación por el adversario (D-04). **No** se confunde `PLAYER_DECLARED` con una tirada verificada.
4. Edición, símbolos reales, cantidades por combate, modificadores, repetición de dados, efectos, dados especiales y condiciones de victoria siguen sin fijarse ni implementarse. Nunca usar este contrato para afirmar que el motor ejecuta *Ancients*.
5. No integrar con una interfaz pública ni desplegar: continúan pendientes HTTPS, mitigación de abuso, reglas verificadas y pruebas reales de dos perfiles.

**Trazabilidad:** T-011 (reproducibilidad), T-012 (rechazo físico), T-013 (equivalencia de caras); cobertura técnica preliminar de CCW-015 y CCW-016. Ambas issues deben permanecer abiertas hasta conectar el servicio autorizado y resolver combates reales.
