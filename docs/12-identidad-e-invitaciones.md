# CCW-007 — Prueba de contrato de identidad e invitaciones

**Estado:** prueba de concepto **en memoria** para Node.js 22; no apta para Internet ni enlazada al servidor HTTP. Referencia: issue #7.

## Alcance

- `packages/access-control/identity.mjs`: aprovisionamiento **administrativo local** de cuentas ficticias; normalización de identificadores; contraseñas derivadas con `scrypt` y sal independiente; autenticación con errores genéricos; sesiones aleatorias de 256 bits, almacenadas solo mediante el hash SHA-256 del token; caducidad y cierre de sesión.
- `packages/access-control/invitations.mjs`: crear partida privada con una plaza A, emitir invitaciones dirigidas a un identificador, aceptar una única plaza B, rechazar o revocar invitaciones, y caducarlas. Las invitaciones emplean tokens aleatorios de 256 bits y se almacenan mediante un resumen. El creador obtiene el token **solo al emitirlo**, para compartirlo fuera de banda durante este prototipo.
- Al emitir invitaciones **no se consulta si el identificador existe**: una misma respuesta evita enumerar cuentas registradas por esta operación. Las invitaciones solo pueden aceptarlas sesiones que correspondan al identificador indicado. Una partida llena invalida invitaciones restantes.
- Acceso a una partida solo para los dos participantes autorizados; para un tercero se devuelve `NOT_FOUND`, igual que para una partida inexistente. El invitado que todavía no ha aceptado no ve el tablero ni la mano del rival.

No se introducen marcas, gráficos, escenarios ni cartas oficiales.

## Ejecutar pruebas en Windows 11 (PowerShell)

Desde la raíz del repositorio, con Node.js >=22:

```powershell
node --test packages/access-control/access.test.mjs
```

Las pruebas comprueban credenciales y sesiones, caducidad, acceso de terceros, emisión sin enumeración, rechazo, revocación, aceptación única y concurrencia de altas. No se instalan paquetes, no se requieren Actions ni WSL.

## Decisiones y riesgos para la implementación real

1. **No publicar estos módulos como servidor de autenticación:** no hay control de intentos, CSRF, cookies `HttpOnly`/`Secure`/`SameSite`, protección de origen, TLS, restablecimiento de contraseñas, verificación de correo, gestión de cuentas, auditoría ni protección frente a abusos.
2. **No persistencia:** las cuentas, las sesiones, las invitaciones y las partidas se pierden al cerrar el proceso. Almacenar solo hashes de tokens y contraseñas en DB, cifrar datos sensibles en reposo según amenazas, diseñar rotación y borrado. El módulo `match-store` de la PR #28 es un experimento distinto y **no** está conectado.
3. **No transporte:** no hay aún endpoints HTTP, envío de correo ni páginas de registro/invitación. El aprovisionamiento se realiza dentro del proceso para pruebas; no se ofrece como API abierta. Para un sistema privado se decidirá quién puede crear cuentas (administrador o invitación).
4. **No condición de victoria ni partidas jugables:** el estado de la invitación pasa de una plaza a dos, pero no modifica el estado reglamentario de Ancients.
5. **Próxima fase:** integrar servicios con DB, identidad real y cookies de sesión; aplicar autorización en toda petición, comando y SSE. Acordar limpieza de invitaciones, reintentos, límites, notificaciones y capacidad de varias instancias. Verificar que datos secretos no aparecen en vistas, errores o logs.

La **issue CCW-007 permanece abierta** hasta disponer de registro y acceso reales por navegador, invitaciones persistidas y revisión de seguridad. No fusionar por suponer que se ha satisfecho la autenticación de producción.
