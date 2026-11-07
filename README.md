# Command & Colors Web

Aplicación web no comercial de juegos por turnos para **dos jugadores humanos**. Primero *Command & Colors: Ancients* básico; después *Napoleonics* básico y ampliaciones.

**Estado:** desarrollo experimental. Hay prototipos locales de tablero, comunicaciones HTTP y almacenamiento; **no existe todavía un juego funcional, un servicio seguro para usuarios reales ni un motor de reglas completo**.

## Decisiones confirmadas

- Navegadores de escritorio y móviles, partidas síncronas y asíncronas.
- Servidor autoritativo con estado persistente, validación estricta y turnos recuperables.
- Cada jugador ve únicamente su mano, información pública y el número de cartas del contrario.
- Tiradas digitales calculadas por el servidor o dados físicos cuyos resultados introducen los jugadores.
- Deshacer acciones no aleatorias sin información revelada; rectificaciones irreversibles por acuerdo.
- Usuarios registrados e invitaciones privadas; instalación en servidor propio o VPS.
- Uso no comercial, con acceso restringido; el propietario posee cajas físicas de ambos juegos.

## Documentación

- [Requisitos](docs/01-requisitos.md)
- [Modelo de dominio y estados](docs/02-dominio-y-estados.md)
- [Arquitectura y decisiones](docs/03-arquitectura.md)
- [Matriz de reglas Ancients](docs/04-matriz-reglas.md)
- [Plan iterativo](docs/05-plan-iterativo.md)
- [Pruebas](docs/06-pruebas.md)
- [Fuentes y derechos](docs/07-fuentes-y-derechos.md)
- [Decisiones pendientes](docs/08-decisiones-pendientes.md)
- [Backlog de tareas](backlog.csv)
- [Maqueta HTML de tablero](prototipo/tablero.html) — abrir localmente en el navegador; interactiva, **sin reglas ni servidor**

Diagramas PlantUML en diagrams/ y escenario de ejemplo **sintético** en scenarios/.

## Límites

No incluir imágenes, cartas, mapas, PDF o transcripciones de materiales originales sin permiso aplicable. El uso no comercial y la posesión de juegos físicos no conceden por sí solos una licencia de redistribución. Proyecto independiente, no afiliado a GMT Games.

La rama principal se modifica tras revisión mediante PR. Las pruebas deben poder ejecutarse localmente; no introducir dependencias de GitHub Actions hasta justificarlas.

## Laboratorio de integración I2

La rama `feat/i2-integration-contracts` reúne, **sin fusionarlas en main**, las implementaciones experimentales de [persistencia (#28)](https://github.com/PedroBlanco/command-colors/pull/28), [identidad e invitaciones (#29)](https://github.com/PedroBlanco/command-colors/pull/29) y [API (#30)](https://github.com/PedroBlanco/command-colors/pull/30), y añade una composición de los **servicios reales**, junto con pruebas de flujo HTTP de dos jugadores.

Ejecutar desde PowerShell, con Node.js 22 o posterior (sin WSL ni Actions):

```powershell
.\scripts\test-local.ps1
```

La [guía de integración](docs/14-prueba-integrada-local.md) explica el alcance y las limitaciones. La base de datos duradera se estudia en el siguiente incremento con SQLite **solo para desarrollo local**. Faltan base de datos y sesiones validadas para producción, login web y motor reglamentario. **No utilizar este laboratorio con jugadores ni en redes externas.**

## Persistencia de laboratorio con SQLite (I2)

Se ha añadido una prueba de persistencia **en archivo SQLite real**, usando `node:sqlite` (experimental en Node.js 22.16.0). Conserva usuarios ficticios, sesiones, invitaciones, estado privado, eventos e idempotencia tras cerrar/reabrir la base de datos. Incluye pruebas con un proceso nuevo, concurrencia entre conexiones, rollback y tres flujos HTTP contra la base de datos.

```powershell
node --test packages/sqlite-store/sqlite.test.mjs packages/local-api/sqlite-compose.test.mjs
```

También se ejecutan desde `.\scripts\test-local.ps1`. Consulta [guía SQLite local](docs/15-sqlite-desarrollo-local.md). **No es un despliegue ni sustituye PostgreSQL como opción prevista.** No usar con partidas o datos reales; faltan HTTPS, cookies seguras, CSRF, límites de intentos, backups y migraciones.


## Copia y restauración SQLite (solo laboratorio)

La [guía de versión de esquema y copias](docs/16-versionado-copias-sqlite-local.md) introduce una marca de esquema v1, una copia coherente de SQLite en WAL y restauración verificada mediante integridad + SHA-256. La copia se publica en formato autónomo (sin archivos `-wal/-shm`). Para probarlo en Windows 11 con Node.js >=22.16.0:

```powershell
node --test packages/sqlite-store/lifecycle.test.mjs
node scripts/sqlite-maintenance.mjs backup .\datos\prueba.sqlite .\copias\prueba-copia.sqlite
node scripts/sqlite-maintenance.mjs verify .\copias\prueba-copia.sqlite
node scripts/sqlite-maintenance.mjs restore .\copias\prueba-copia.sqlite .\datos\prueba-restaurada.sqlite
```

**No utilizar con datos reales**, no exponer el laboratorio en la red ni considerar estas copias como respaldo de producción. La herramienta exige destinos inexistentes; la restauración requiere parada de la aplicación.

## Sesiones de navegador (nuevo laboratorio I2)

La rama `feat/i2-browser-sessions-lab` añade un modo **solo local** de acceso a partidas sintéticas por navegador con cookie `HttpOnly`, `SameSite=Strict` y comprobación de origen para las operaciones de escritura. En HTTP se activa expresamente un modo inseguro que solo admite `127.0.0.1`; **nunca se debe exponer a una red**.

Con Node.js 22.16.0 o posterior compatible con `node:sqlite`, ejecutar desde PowerShell en esta rama:

```powershell
node --test packages/local-api/browser-session.test.mjs packages/local-api/browser-gateway.test.mjs
node scripts/browser-lab.mjs
```

El primer arranque crea cuentas de prueba `alice` y `bob` con contraseñas aleatorias (mostradas una sola vez). Abrir `http://127.0.0.1:8788` en **dos perfiles de navegador diferentes** (normal/privado); las pestañas del mismo perfil comparten sesión. Consultar la [guía de uso y seguridad](docs/17-sesiones-navegador-laboratorio.md).

Esta interfaz mínima **no sustituye** a la del tablero SVG de la PR #27, pendiente de validación. No incorpora reglas de movimiento ni datos oficiales.
