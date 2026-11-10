# CCW-014 · Terreno básico: bosques, colinas y terreno accidentado (R-05 parcial)

**Fecha:** 10/11/2026. **Estado:** laboratorio sin conexión con la API, SQLite ni motor de partidas. Rama dependiente de PR #54 y anteriores.

## Fuente normativa

GMT Games, *Command & Colors: Ancients*, tercera edición (2009), apartado 16, [reglamento oficial](https://www.gmtgames.com/living_rules/CC_Rules_2009.pdf). Contraste con [recopilación del terreno del juego básico](https://www.commandsandcolors.net/ancients/the-game/main/16-terrain.html).

El comprobador `packages/ancients-rules/terrain-precheck.mjs` solo trata **PLAIN** (implícito), **FOREST**, **HILL** y **BROKEN_GROUND**. Unidades montadas: caballerías ligera, media y pesada, elefantes y carros pesados. Las máquinas de guerra pesadas se tratan separadamente.

| Terreno | Movimiento ordinario | Combate tras entrar |
| --- | --- | --- |
| Llanura | Sin restricción añadida | Según perfil de unidad |
| Bosque | Toda unidad se detiene al entrar | Posible para infantería ligera, ligera con honda, ligera con arco, auxiliar y guerrera; para las demás, no |
| Colina | Sin restricción añadida | Según perfil; las modificaciones de dados/visibilidad **no se calculan** |
| Accidentado | Máquina de guerra no entra; unidad montada debe detenerse; unidades a pie restantes sin restricción adicional | Unidad montada no combate tras entrar; infantería según perfil |

La salida contiene `status` (`CANDIDATE`, `BLOCKED`, `REQUIRES_RULE_EXCEPTION`), `reason`, `step`, `battle`, `profile` y siempre `needsFullLegalityCheck:true`. Una carta o regla de escenario que altere las restricciones requiere tratamiento separado. El comprobador **no concede** excepciones, ni ejecuta combate, ni modifica estado.

### Contrato y límites

```js
precheckAncientsTerrainMovement({
  unitType: 'LIGHT_INFANTRY',
  path: [{col:5,row:4}], // sin origen
  terrain: [{col:5,row:4,type:'FOREST'}] // mapa disperso, llanura implícita
})
```

El mapa y la ruta **deben provenir de estado confiable** y pasar antes por comprobaciones de identidad, geometría, órdenes y ocupación. Se rechazan coordenadas fuera de 13×9, entradas repetidas, terrenos no admitidos, tipos de unidades de expansiones y rutas vacías o excesivas. Las casillas de terreno ausentes se interpretan como llanura **solo cuando el escenario tiene su mapa de terreno completo y validado**.

No se calcula la línea de visión, los modificadores de dados de combate, la retirada, la evasión, el avance por ímpetu, las colinas de diferente nivel, los ríos ni los terrenos de escenarios y expansiones. **No** debe usarse como motor autoritativo de R-05. Se mantienen separados los contratos de PR #53 (perfiles), PR #54 (trayectoria/ocupación) y este de terreno.

## Evidencia y requisitos pendientes

- **16/16 pruebas en V8 aislado**, sin fallos, cargando exactamente el código publicado en GitHub, con sustitución de imports y aserciones equivalentes. **No son pruebas nativas de Node.js ni HTTP**.
- Objetos Git del módulo y pruebas: `c86c0caf8bc8640013e03e8256c776407b5fc260` y `3e9c41af01ba3e91daec01df96a339dded3967e6`.
- Se registra la suite de terreno como **41.ª** en el manifiesto de pruebas local. La regresión integral de 41 suites **no está ejecutada**.

**Para avanzar a integración:** ejecutar la suite nueva y las 41 suites con Node.js nativo; verificar interpretación de reglas y erratas; introducir terreno en el estado persistido del escenario; combinar de forma autoritativa órdenes, recorrido, terreno y líderes; resolver efectos de cartas; comprobar seguridad HTTP/SSE y visualización PC/móvil. Hasta entonces, mantener PR en borrador.
