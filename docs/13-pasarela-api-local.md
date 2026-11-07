# CCW-009 — Pasarela HTTP local (contrato experimental)

**Estado:** prueba de transporte y permisos. No es una aplicación operativa ni segura para Internet.

## Objetivo y composición

El módulo `packages/local-api/gateway.mjs` implementa un servidor HTTP mediante Node.js (sin dependencias externas), que recibe tres servicios **inyectados**:

- `identity`: `logIn`, `resolveSession` y `logOut` (contrato de PR #29).
- `invitations`: `createMatch`, `issueInvitation`, `acceptInvitation`, `rejectInvitation` y `getMatch` (contrato de PR #29).
- `getStore(matchId)`: obtiene un almacén **aislado por partida**, que implementa `view(side)`, `publicEvents(side)` y `dispatch(command)` (contrato de PR #28).

Este módulo por sí mismo **no arranca un servidor**, **no aprovisiona usuarios**, no crea el almacén real y no modifica las PR #27, #28 o #29. Las pruebas inyectan dobles sintéticos que siguen estos contratos. Cuando se aprueben los módulos, habrá que realizar una prueba integral con sus implementaciones reales y un mismo esquema transaccional.

## Endpoints de prueba

| Método y ruta | Función | Permisos |
|---|---|---|
| GET `/health` | Comprobación mínima de proceso | Sin autenticación |
| POST `/api/session` | Inicio de sesión; devuelve token efímero | Credenciales |
| DELETE `/api/session` | Cerrar sesión | Token del usuario |
| POST `/api/matches` | Crear partida privada | Sesión válida |
| GET `/api/matches/:uuid` | Sala de espera o estado privado filtrado | Participante de partida |
| POST `/api/matches/:uuid/invitations` | Invitar a jugador B | Creador |
| POST `/api/invitations/accept` | Aceptar invitación | Destinatario |
| POST `/api/invitations/reject` | Rechazar invitación | Destinatario |
| GET `/api/matches/:uuid/events` | Eventos públicos | Participante |
| POST `/api/matches/:uuid/commands` | Solicitar acción (solo ejemplo) | Participante y turno permitido |

Las peticiones autenticadas usan `Authorization: Bearer ...`. El servidor deriva del token el usuario y obtiene el lado A/B exclusivamente de la pertenencia autorizada a la partida. **Se ignora cualquier actor declarado en el JSON**. Las vistas privadas incluyen únicamente la mano del solicitante y el recuento público de cartas contrarias. Durante las invitaciones pendientes no se revela el tablero ni la mano.

Cada vista del almacén debe indicar el `matchId` correcto. Si no coincide con la partida solicitada, la API falla sin mostrar datos. Los errores son genéricos y nunca devuelven rutas internas, contraseñas, datos del adversario ni detalles del almacenamiento.

## Ejecutar pruebas automáticas

Con Node.js 22 o superior, en PowerShell desde la raíz:

```powershell
node --test packages/local-api/gateway.test.mjs
```

Prueban HTTP de extremo a extremo **usando dobles de los servicios**: login, sala de espera, aceptación de invitación, visibilidad de manos, rechazo a terceros, actor falsificado, revisión obsoleta, JSON erróneo, revocación, fallos internos y almacén equivocado.

No requieren WSL, PostgreSQL, npm, Actions ni navegador. No se incluyen credenciales reales. El comando solo ejecuta pruebas efímeras ligadas a `127.0.0.1`.

## Limitaciones y tareas pendientes

1. **Seguridad de sesión:** los bearer tokens sobre HTTP son solo para loopback; faltan HTTPS, cookies seguras para navegador, protección de origen/CSRF, controles antibruteforce, registro y recuperación de credenciales.
2. **Persistencia:** `getStore` es inyectado; no existe todavía un registro duradero de cuentas, invitaciones y partidas en una sola base de datos. No se garantiza recuperación total después de reiniciar.
3. **Atomicidad:** crear la sala, asociarla a su almacén y aceptar invitaciones deben formar transacciones coherentes en la implementación definitiva.
4. **Separación de secretos:** el adaptador confía en las proyecciones autorizadas devueltas por el almacén; es necesario probar con implementaciones reales que ningún evento o error transporte cartas ocultas.
5. **Estado de juego:** solo comandos sintéticos, sin cartas ni reglas oficiales. Tampoco hay SSE en esta pasarela, ni interfaz de usuario conectada.
6. **Despliegue:** **no exponer el servidor a la LAN ni a Internet**. La API no contiene `listen()`: si se crea un lanzador de prueba, deberá enlazarse solo a `127.0.0.1`.

La PR puede revisarse de forma independiente; para completar CCW-009 faltan autorización real sobre almacenamiento transaccional, pruebas de seguridad y funcionamiento integrado con sesiones persistidas.
