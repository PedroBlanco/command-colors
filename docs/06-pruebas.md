# Estrategia de verificación

El motor debe poder probarse sin navegador ni servidor, con resultados de azar inyectados. Cada error corregido genera un test de regresión. No se aceptarán afirmaciones de compatibilidad de reglas sin casos y fuentes.

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| T-001 | Vecinos desde esquina/borde | Sin hexágonos inexistentes |
| T-002 | Hexágonos en límites de sector | Pertenencia correcta, incluidas zonas compartidas |
| T-003 | Atacar durante fase de movimiento | Rechazo sin modificar revisión |
| T-004 | Abrir segundo combate con uno pendiente | Rechazo |
| T-005 | Mover unidad sin orden | Rechazo |
| T-006 | Solicitar mano ajena o mazo | Sin información privada |
| T-007 | URL de partida con usuario no invitado | Denegación sin metadatos secretos |
| T-008 | Dos comandos con misma revisión | Solo uno se confirma |
| T-009 | Reenviar misma idempotencyKey | Mismo resultado, ningún efecto duplicado |
| T-010 | Reiniciar con decisión defensiva pendiente | La partida y actor se recuperan |
| T-011 | Azar digital inyectado | Tirada y efectos reproducibles |
| T-012 | Dados manuales con caras/cantidad inválidas | Rechazo |
| T-013 | Dados manuales válidos | Mismos efectos que tirada digital equivalente |
| T-014 | Deshacer no aleatorio y no revelador | Reversión permitida y registrada |
| T-015 | Deshacer tras azar/revelación | No unilateral; petición de acuerdo |
| T-016 | Ancho 360 px y teclado | Selección y zoom usables |
| T-017 | Notificación SSE de otro jugador | No hay información oculta |
| T-018 | Recuperación desde copia | Estado íntegro y sesiones gestionadas |
| T-019 | Regla especial por carta/unidad/terreno | Cobertura positiva y negativa |
| T-020 | Añadir Napoleonics | Suite Ancients sin regresiones |

## Criterio de I0

Requisitos y riesgos revisados, fuentes y ediciones localizadas (identificar cajas pendiente), ADR propuestos y pruebas definidas. No confundir una maqueta con la aceptación del motor.

## Criterio de Ancients básico

Matriz de reglas verificada; escenarios autorizados y contrastados; dos personas completan partidas por navegador PC/móvil, con recuperación, privacidad y rectificación. Copias/restauración probadas.

## Verificación aislada del contrato de dados (I5, CCW-015/016)

`node --test packages/dice-roller/dice.test.mjs` superó **12/12 pruebas** con Node.js 22.16.0: T-011 con inyección determinista, T-012 para caras/cantidades físicas inválidas y T-013 para equivalencia de resultados digitales y declarados. Esta prueba **no** cubre autorización HTTP, transacciones, decisión física del rival ni efectos de combate de Ancients. El script general contiene 26 suites; su regresión conjunta sigue pendiente.
