# CCW-014 · Primer contrato de perfiles de movimiento de Ancients (juego básico)

**Fecha:** 2026-11-09. **Estado:** PR experimental apilada sobre la PR #52, sin integración con partidas ni despliegue. **Referencia de reglas:** *Command & Colors: Ancients*, 3.ª edición (GMT Games, 20-10-2009).

## Fuentes y alcance

- Edición de referencia en la [biblioteca oficial de reglas de GMT Games](https://www.gmtgames.com/t-GMTLivingRules.aspx) y [PDF del reglamento de 2009](https://www.gmtgames.com/living_rules/CC_Rules_2009.pdf).
- Contraste de distancias, movimiento condicionado de guerreros y capacidad de combate en el [apartado de movimiento](https://www.commandsandcolors.net/ancients/the-game/main/08-movement.html) y delimitación de unidades añadidas por expansiones en el [índice de expansiones](https://www.commandsandcolors.net/ancients/the-game/main/expansion-rules-index.html).
- No copiar imágenes, material gráfico, cartas, escenarios ni textos protegidos. Son **valores mecánicos y código propio** para investigación y prueba privada; la política de GMT limita la utilización de su material original a usos personales no comerciales, con las condiciones publicadas por la editorial.
- La lista contempla **13 tipos del juego básico**: infantería ligera, honderos, arqueros, auxilia, guerreros, infantería media y pesada, máquina de guerra pesada, caballería ligera/media/pesada, elefantes y carros pesados. No acepta unidades de expansiones, ni líderes (tienen reglas propias). Unidades como caballería ligera con arco, camellos, carros bárbaros ligeros o catafractos **quedan expresamente aplazadas**.

## Nuevo contrato puro

`packages/ancients-rules/movement-profile.mjs` exporta `ANCIENTS_RULESET`, `BASE_MOVEMENT_PROFILES` y `assessBaseMovement({unitType,steps})`.

El resultado expone una comprobación **parcial** de distancias para una ruta ya computada: `WITHIN_PROFILE`, `EXCEEDS_STANDARD_PROFILE` o `CONDITIONAL_CHARGE`, además de la opción de combate `POSSIBLE`, `UNAVAILABLE` o `MANDATORY_CLOSE_COMBAT`. Por ejemplo, una unidad auxiliar que avanza dos hexágonos pierde su posibilidad ordinaria de combatir; la carga de dos hexágonos del guerrero requiere resolución específica de combate cercano, **no se autoriza automáticamente**.

**Invariante:** siempre se devuelve `needsFullLegalityCheck: true`. Ni siquiera `WITHIN_PROFILE` significa que la acción sea legal: faltan órdenes, fases, obstáculos, ocupación, terreno, líderes, excepciones de cartas y escenarios, además de combate y secuencias obligatorias. `EXCEEDS_STANDARD_PROFILE` tampoco invalida por sí solo una acción que pudiera permitir una carta especial o regla de escenario; esa validación queda pendiente de un contrato superior.

La longitud `steps` es el número de aristas de la trayectoria propuesta, no la distancia mínima entre origen y destino. Los tipos desconocidos, los valores que no sean enteros seguros y los pasos negativos fallan con errores explícitos. Las tablas y decisiones se congelan.

El módulo **no se conecta a la API ni a SQLite** y no modifica el validador sintético de la PR #46. Se reserva la integración real de R-05 para cuando se disponga de referencias y casos de prueba de órdenes, ocupación, terreno y excepciones.

## Evidencia contrastada

Ejecutadas **17/17 pruebas nativas, 0 fallos, 0 omisiones**, con `node --test --test-reporter=tap packages/ancients-rules/movement-profile.test.mjs`, **Node.js v22.16.0**, sin WSL, VPS ni GitHub Actions. Se cotejan los objetos Git exactos publicados en esta rama:

| Archivo | SHA Git del contenido probado y publicado |
| --- | --- |
| `movement-profile.mjs` | `2bef541f7da040f7eb1b2b8735fab4939ce1f966` |
| `movement-profile.test.mjs` | `31df5ba8debd6a493e450dcbcf160353c8485617` |

La nueva suite está registrada en el manifiesto de pruebas de la rama: **39 suites** previstas. Los 17 casos aislados **no son** una regresión integral de esas 39 suites ni una validación del reglamento en una partida.

## Pendientes para fusionar

1. Ejecutar la batería completa de **39 suites** con evidencia TAP (incluye las 38 preexistentes), más pruebas de privacidad y HTTP/SSE con dos usuarios reales.
2. Incorporar reglas de órdenes, líderes, terreno, ocupación, cartas y escenarios con sus excepciones; definir pruebas que distingan límites normales de los modificados por cartas.
3. Revisar la clasificación de tipos frente al escenario inicial oficial elegido y las erratas aplicables, antes de activar este perfil en el motor autoritativo.
4. Validar en PC y móvil la interfaz del tablero (PR #27/#50), sin solicitar todavía pruebas al usuario.

**La PR permanece en borrador. No fusionar ni desplegar basándose únicamente en la prueba aislada.**
