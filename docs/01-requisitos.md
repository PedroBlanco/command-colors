# Requisitos funcionales — versión 0.1

Fecha de referencia: 2026-11-06. Estado: especificación inicial; los requisitos están acordados, no implementados.

## Alcance y actores

Partida de exactamente dos personas registradas e invitadas. Actores: jugador creador, jugador invitado, administrador operativo y servidor autoritativo. El segundo jugador puede ser llamado a actuar como defensor aunque no tenga el turno.

## Matriz de requisitos

| ID | Requisito | Criterio verificable |
| --- | --- | --- |
| RF-01 | Dos personas por partida | Un tercero no puede ocupar plaza |
| RF-02 | Navegador PC y móvil | Tablero usable a ancho 360 px, zoom y toque |
| RF-03 | Registro e invitación privada | Acceso denegado a usuarios ajenos |
| RF-04 | Modalidad síncrona/asíncrona | La desconexión no cancela decisiones |
| RF-05 | Persistencia | Recuperar estado, turno y decisión tras reinicio |
| RF-06 | Prohibir acciones ilegales | Autoridad y validación siempre en el servidor |
| RF-07 | Mano y mazo privados | API, SSE e historial no filtran secretos ajenos |
| RF-08 | Dados digitales | Generación y registro en servidor |
| RF-09 | Dados físicos | Indicar cantidad, registrar caras declaradas y efectos |
| RF-10 | Respuesta defensiva | Puede actuar el defensor sin cambiar de turno |
| RF-11 | Deshacer seguro | Sin azar, revelaciones ni acciones dependientes |
| RF-12 | Rectificaciones consensuadas | Registro de petición, aceptación y corrección |
| RF-13 | Escenarios Ancients básico | Importación oficial solamente con permiso y verificación |
| RF-14 | Ancients básico completo | Matriz de cobertura y pruebas por regla/carta/unidad |
| RF-15 | Napoleonics básico | Módulo propio y no regresión de Ancients |
| RF-16 | Historial reproducible | Secuencia de eventos autorizada por espectador |
| RF-17 | Estado de acción | Identificar actor habilitado y siguiente decisión |
| RF-18 | Invitaciones | Crear, aceptar, rechazar, caducar y revocar |
| RF-19 | Reconexión | Revisiones e idempotencia; cambiar de dispositivo |
| RF-20 | Victoria y cierre | Condición de victoria aplicada por servidor |

## Requisitos no funcionales propuestos

- RNF-01: HTTPS, sesiones seguras, controles CSRF, autorización por partida y límites de tasa.
- RNF-02: transacciones de estado y evento, revisiones monotónicas e idempotencia de comandos.
- RNF-03: copias automáticas y restauración ensayada antes de acceso a invitados.
- RNF-04: teclado, contraste, controles táctiles, zoom y desplazamiento accesibles.
- RNF-05: compatibilidad con navegadores modernos; mínimos concretos pendientes.
- RNF-06: motor de reglas puro, determinista salvo azar inyectado, independiente de HTTP.
- RNF-07: fijar versiones de reglamento, escenarios y esquema por partida.
- RNF-08: minimizar datos personales; política de retención y borrado pendiente.
- RNF-09: observabilidad sin registrar manos ajenas, cartas futuras, secretos ni credenciales.
- RNF-10: medir y definir objetivos de rendimiento antes de despliegue real.

## Fuera de alcance inicial

Sin IA, torneos, chat, espectadores públicos, editor, campañas, partidas de más de dos jugadores ni expansiones hasta cerrar ambos básicos. No suponer que estos límites sean permanentes.

## Reglas de negocio

El jugador propietario del turno y el actor facultado para contestar una petición pueden ser distintos. El resultado declarado de dados físicos no puede verificarse físicamente; se atribuye al usuario autenticado y se registra. Cambios de modalidad de dados requieren acuerdo. Acciones rechazadas no deben modificar estado ni revisión.
