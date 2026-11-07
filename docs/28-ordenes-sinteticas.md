# CCW-013 — Contrato de validación de órdenes sintéticas

**Fecha:** 7 de noviembre de 2026. **Estado:** función pura, aislada, con pruebas. No hay cartas ni límites oficiales de *Ancients*.

## Qué valida

`packages/order-validator/validator.mjs` recibe un estado de partida con fase, actor, revisión y carta activa; una selección de unidades; y un **contexto fiable exclusivamente del servidor** con perfiles de cartas, lista de unidades y pertenencia a sectores. Comprueba:

- Fase `ASSIGN_ORDERS`, jugador activo y revisión esperada.
- Perfil de la instancia de carta activa; una carta desconocida devuelve `UNSUPPORTED_CARD`.
- Máximo de unidades ordenables fijado por ese perfil, no por el cliente.
- Unidades existentes, del propio bando, habilitadas y pertenecientes a algún sector autorizado; los hexágonos compartidos se admiten por pertenencia múltiple.
- Entradas con identificadores válidos y sin duplicados. Para cualquier unidad no elegible, la respuesta es uniforme y no revela información del rival.

Si la comprobación tiene éxito, genera un comando mínimo **sin campos sobrantes** que podrá consumir `transitionCommandSession`. No altera estado, mazo, datos de servidor ni comandos originales.

## Uso de laboratorio

```powershell
node --test packages/order-validator/validator.test.mjs
.\scripts\test-local.ps1
```

Las **11 pruebas aisladas** se ejecutaron en Node.js 22.16.0, con cero fallos, sin WSL ni GitHub Actions. La batería local queda en **27 suites**; su ejecución completa en Windows 11 sigue pendiente.

## Límites y trabajo siguiente

1. Este módulo **no está conectado al servicio SQLite/HTTP**; el viejo comando sintético permanece sin validación de sectores. No se debe afirmar que ya impide movimientos u órdenes reglamentarias.
2. El controlador autorizado debe obtener `actor` de la sesión, localizar la carta activa y cargar perfiles, unidades y sectores desde el estado **confiable del servidor**. Nunca aceptar `cardProfiles`, `units` o `sectorMembership` del navegador.
3. Validación, transición de fase, eventos e idempotencia deben quedar dentro de la misma transacción con una revisión final comprobada.
4. No inventar cartas oficiales, geometría sectorial, despliegues ni excepciones: faltan edición contrastada, fuentes y pruebas por regla. Las issues CCW-013 y CCW-014 siguen abiertas.
5. El tablero SVG de la PR #27 necesita validación visual; no se modifica ni se integra desde este incremento.

**Trazabilidad:** avance técnico preliminar de R-04 y CCW-013. No supone aceptación reglamentaria ni preparación para Internet.
