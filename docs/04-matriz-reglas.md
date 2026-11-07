# Matriz de cobertura — Ancients básico

Estado: inventario preliminar. **Ninguna regla figura como implementada.** Fijar edición y erratas antes de aprobar interpretación normativa.

| ID | Familia | Iteración objetivo |
| --- | --- | --- |
| R-01 | Topología 13×9, distancia, adyacencia y sectores compartidos | 1 |
| R-02 | Escenarios, despliegue, iniciativa, tamaño de mano y victoria | 2 / 7 |
| R-03 | Mazo y cartas de mando: robar, descartar, efectos y agotamiento | 3 / 6 |
| R-04 | Órdenes y elegibilidad de unidades/líderes | 3 / 4 |
| R-05 | Movimiento por unidad, líderes, ocupación y terreno | 4 / 6 |
| R-06 | Combate a distancia, alcance, línea de visión y resultados | 5 / 6 |
| R-07 | Cuerpo a cuerpo, dados, golpes y efectos | 5 / 6 |
| R-08 | Retiradas, evasión, banderas y decisiones del defensor | 6 |
| R-09 | Líderes: vinculación, bonificaciones y bajas | 6 |
| R-10 | Elefantes, carros y casos particulares | 6 |
| R-11 | Terrenos, obstáculos y modificadores | 6 |
| R-12 | Avances, combates adicionales y excepciones | 6 |
| R-13 | Orden de resolución y subprocesos de combate | 5 / 6 |
| R-14 | Victoria y reglas especiales de escenario | 7 |
| R-15 | Todas las cartas del juego básico | 6 / 7 |
| R-16 | Erratas y clarificaciones adoptadas | 7 |

Inventario de escenarios de referencia: Akragas, Crimissos River, Bagradas, Ticinus River, Trebbia, Lake Trasimenus, Cannae, Dertosa (Ebro), 2nd Beneventum, Castulo, Baecula, Metaurus, Ilipa, Great Plains y Zama.

La lista identifica títulos, pero **no** contiene mapas, despliegues ni textos de escenarios. Su incorporación requiere revisar permisos y edición.

## Ficha obligatoria para cualquier regla

Identificador, fuente/edición/página, precondiciones, comando, acciones legales, resultado, excepciones, tests positivos y negativos. Para azar, casos reproducibles con generador inyectado; para dados físicos, validar caras y cantidad. Nunca aceptar acciones sin validación porque falta implementar un tipo de unidad o carta.

## Cobertura técnica I3 — contrato de cartas opacas (CCW-012)

El módulo `packages/command-deck/deck.mjs` implementa únicamente un **contrato técnico con cartas sintéticas**: barajar con RNG criptográfico del servidor, repartir manos con cantidades explícitas, validar ejemplares únicos, conservar todas las cartas y ocultar la mano rival y el orden del mazo. Integra las transiciones de la máquina **sintética** CCW-011, incluida la respuesta pendiente del defensor.

| ID | Componente comprobado | Prueba automatizada | Cobertura reglamentaria |
| --- | --- | --- | --- |
| R-02 | Tamaños de mano configurables y reparto | `deck.test.mjs` — tamaños inválidos y conservación | Pendiente de escenarios oficiales |
| R-03 | Jugar, descartar y robar del mazo oculto | `deck.test.mjs` — cartas, privacidad, no filtración y agotamiento sin remezclar | **No implementado**: efectos, cantidades y agotamiento reales |
| R-13 | Decisión pendiente del defensor sin cambiar el atacante | `deck.test.mjs` — decisión, serialización y retorno al turno | **No implementado**: combate y resoluciones normativas |

En la fecha del incremento se superaron **21 pruebas nuevas**, contra el módulo de fases de `main` (blob SHA contrastado). Los tests acreditan la integridad de un prototipo, **no** una regla de *Ancients* ni el cumplimiento íntegro de R-02/R-03/R-13. Continúan pendientes verificación de edición/erratas, integración transaccional, seguridad del servidor y pruebas visuales. Véase [contrato técnico del mazo](23-mazo-mando-opaco-i3.md).

**No se altera** el inventario inicial: ninguna regla del juego básico se da por implementada hasta fijar su fuente, comprobar excepciones y completar pruebas positivas y negativas.
