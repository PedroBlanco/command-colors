# CCW-015 — Revalidación del disparo sobre la instantánea guardada

**Fecha:** 11/11/2026. **Dependencia:** PR #81. **Ámbito:** laboratorio privado SQLite `CCRL`, sin conexión HTTP ni escrituras de bajas.

## Problema identificado

La previsualización de bloques de la PR #69 comprueba el objetivo, dados, revisión y una huella SHA-256 del tablero. La PR #81 añade un plan de aplicación de impactos, pero seguía pendiente de **volver a validar la geometría y condiciones del ataque** antes de proponer el cambio. Un proceso con acceso privilegiado al propio fichero SQLite podría modificar datos y actualizar la huella sin que la derivación preliminar distinguiera si el nuevo tablero incumple alcance, adyacencia, movimiento o límite de dados. La huella detecta cambios fortuitos; **no es una firma criptográfica ni sustituye las reglas**.

## Solución

`preflightStagedAncientsRangedHits`, en `ranged-hit-commit-preflight.mjs`, conserva la derivación original y añade un **segundo examen independiente**:

1. Parte del mismo `turnState` y `board` persistidos que se leyeron bajo la transacción de `preflightDirectHits`, con actor autenticado, reserva y revisión previamente comprobados. **Nunca acepta el tablero enviado por el navegador**.
2. Crea una **copia superficial del turno** con `pendingCombat:null` exclusivamente para ejecutar el contrato anterior de preselección. No altera el estado persistido ni borra la reserva o la tirada originales.
3. Ejecuta `precheckAncientsRangedDeclaration` sobre la misma revisión. Se requiere resultado `CANDIDATE`, comprobación de perfil y línea de visión y `attackAuthorized:false`.
4. Recalcula `createRangedDicePlan({mode:'OFFICIAL_PREVIEW',screening,board,targetId})` y exige coincidencia exacta con el plan oficial previamente persistido, incluido el número de dados.
5. Si falla cualquier paso, devuelve error genérico `PREFLIGHT_UNAVAILABLE`, sin detalles internos de geometría a un usuario no autorizado. **No elimina bloques** y no registra evento.

La respuesta positiva añade `screeningRechecked:true`, `recheckedDiceCount`, `commandCardValidated:false` y `scenarioExceptionsChecked:false`. Conserva `commitPermitted:false`, `attackAuthorized:false` y `fullRulesValidated:false`.

Este reexamen es **defensa en profundidad, no autorización final**. No garantiza que la carta, las órdenes, la trayectoria de movimiento, las excepciones de escenario o los efectos especiales sean legales. El futuro comando de impactos deberá verificarlo todo dentro de su propia transacción antes de actualizar el almacén principal `CCWB`.

## Regresiones preparadas y ejecución aislada

Se añaden seis casos de integración a `packages/ancients-rules/sqlite-block-loss-preview.test.mjs`:

1. Plan almacenado legítimo: preselección repetida y dos dados correctos.
2. Un actor privilegiado modifica el hexágono del objetivo y también recalcula su huella: queda fuera de alcance y el nuevo reexamen rechaza el plan.
3. Un actor privilegiado añade un enemigo adyacente al atacante y recalcula la huella: se rechaza el disparo.
4. Un actor privilegiado introduce bosque bajo el objetivo y recalcula la huella: el límite cambia de dos dados a uno y se rechaza el plan anterior.
5. Un actor privilegiado modifica el número de pasos registrados sin tocar la huella del tablero: el disparo queda invalidado.
6. Dos consultas consecutivas no cambian revisión, datos de tablero y turno, número de eventos ni comandos.

Los casos 2–5 están diseñados para mostrar que la previsualización básica aún puede leer los resultados originales, mientras que la nueva revalidación rechaza un ataque que ha dejado de cumplir el perfil y el plan guardado.

Se incorpora además la nueva suite pura `packages/ancients-rules/ranged-hit-commit-preflight.test.mjs`, con **8 casos**: escenario válido y ausencia de efectos, alcance, enemigo adyacente, bosque y límite de dados, movimiento, terreno inválido, objetivo del mismo bando e idempotencia del cálculo sin mutaciones. La suite está registrada en `scripts/check-browser-lab.mjs`: el total pasa a **58 suites**.

**Verificación realizada:** los **8/8 casos de la nueva suite pura** pasan en un arnés JavaScript V8 aislado, compilando los módulos *tal como fueron recuperados de GitHub* (16 módulos evaluados). Se sustituyeron solo los servicios del ejecutor de pruebas, las aserciones, `structuredClone` y las funciones de tirada de dados no invocadas durante esos casos. **No es una ejecución nativa de `node --test` ni prueba SQLite**, y no permite afirmar que la suite pase bajo Node.js con todas las dependencias.

**Estado pendiente:** los seis casos SQLite añadidos en esta PR todavía **no se han ejecutado nativamente**. Tampoco se ha ejecutado la regresión integral de **58 suites** ni la verificación en Windows. La PR debe mantenerse en borrador, sin fusionar ni desplegar.

## Próximo hito

Autorizar los ataques solamente tras verificar la carta efectivamente jugada, el orden y movimientos de cada unidad y las excepciones reglamentarias del escenario; introducir después el comando de baja transaccional e idempotente con registro de eventos, resolver las bajas de líderes y las retiradas, y verificar la privacidad de dos jugadores.
