# Persistencia duradera de laboratorio: SQLite (CCW-008 / I2)

**Estado:** prueba de desarrollo local. SQLite es una etapa de verificación, **no la decisión de motor de base de datos de producción**. La propuesta PostgreSQL continúa abierta y debe evaluarse antes de desplegar en VPS.

## Qué se ha comprobado

`packages/sqlite-store/sqlite.mjs` utiliza la API **experimental** `node:sqlite` de Node.js 22.16.0, sin npm ni servicios externos. En un archivo real SQLite guarda:

- cuentas de prueba, contraseñas derivadas con sal independiente y `scrypt`;
- sesiones con tokens aleatorios, cuyos valores completos no se guardan (solo SHA-256);
- invitaciones privadas de un solo uso, sus caducidades y destinatarios;
- correspondencia entre una partida y sus dos participantes;
- estado privado con mazo y manos, revisiones, eventos e idempotencia por jugador.

`packages/local-api/sqlite-compose.mjs` conecta estos servicios con la **pasarela HTTP existente** de CCW-009 sin añadir un servidor escuchando de forma automática. Las pruebas de HTTP escuchan únicamente en `127.0.0.1`, usan contraseñas y unidades **sintéticas**, y cierran el servidor tras cada caso. No se proporcionan usuarios predeterminados ni rutas de alta pública.

## Garantías del experimento

1. Los comandos se ejecutan en `BEGIN IMMEDIATE`, comprobando revisión y clave idempotente dentro de la misma transacción. Estado, historial y registro de la solicitud se confirman conjuntamente.
2. El motor SQLite bloquea otros escritores: dos conexiones al mismo archivo no pueden aceptar dos acciones incompatibles de la misma revisión.
3. Un error forzado antes de insertar un evento revierte el estado, la revisión y el comando.
4. Una instancia recién abierta, e incluso un **proceso Node.js nuevo**, recupera el turno, las revisiones y los eventos.
5. La invitación se acepta de forma atómica: como máximo un usuario ocupa la plaza B, incluso ante peticiones concurrentes.
6. Ninguna proyección HTTP muestra la mano ajena ni cartas futuras; un tercero no puede consultar la partida.
7. Las sesiones y las invitaciones no pierden su validez por reiniciar, siempre dentro de su caducidad.

El archivo usa `journal_mode=WAL` y `synchronous=FULL`. Se usan consultas parametrizadas. Estas propiedades no reemplazan una política de copias de seguridad, migraciones, protección del sistema de archivos ni revisión de seguridad.

## Ejecutar en Windows 11

Node.js 22.16.0 o posterior de una rama compatible con `node:sqlite` (todavía experimental en la versión probada). Desde PowerShell y la raíz de la **rama de laboratorio**:

```powershell
node --test packages/sqlite-store/sqlite.test.mjs packages/local-api/sqlite-compose.test.mjs
```

O ejecutar toda la batería de laboratorio mediante `scripts/test-local.ps1` cuando esta rama esté integrada con su base. Las pruebas crean SQLite en un directorio temporal y eliminan los archivos al terminar; **no guardan datos personales del usuario**. No necesitan WSL, Docker, PostgreSQL ni GitHub Actions.

## Límites y riesgos que bloquean la puesta en producción

- `node:sqlite` es experimental en Node.js 22.16.0, por lo que debe revisarse su estabilidad y soporte antes de adoptarlo definitivamente.
- La API existente usa tokens Bearer sobre HTTP **solo en loopback**; faltan cookies `HttpOnly`/`Secure`/`SameSite`, CSRF, TLS y límites de intentos.
- SQLite conserva los datos de prueba **sin cifrar en reposo**. No guardar contraseñas en claro, ni manos de partidas reales, ni datos personales reales. El respaldo seguro, la restauración, las migraciones, la limpieza de sesiones y la gestión de secretos están pendientes.
- La política de autorización se comprueba en la capa HTTP y debe complementarse con identidad real y comprobaciones de pertenencia en cada operación de base de datos.
- El esquema y el comando `pass_demo_turn` son sintéticos; **no hay** cartas de mando, escenarios ni motor de reglas de Ancients.
- Sin soporte todavía para sesiones de navegador, reconexión SSE autorizada, comunicaciones entre dispositivos ni funcionamiento público.
- La adaptación a PostgreSQL y la definición definitiva de transacciones, control de acceso y migraciones siguen siendo tareas abiertas.

**Relación con GitHub:** esta rama se apila sobre la PR #31 y utiliza módulos de las PR #28/#29/#30 sin fusionarlos dos veces. La PR #27, de tablero, sigue pendiente de validación visual.
