# Primera validación local — Command & Colors Web

**Estado:** laboratorio de pruebas con datos sintéticos. No es todavía el juego *Ancients*, no incorpora reglamento, cartas ni escenarios oficiales, y no se puede utilizar con jugadores reales por Internet.

**Objetivo:** realizar en Windows 11 una primera validación reproducible sin VPS, WSL ni GitHub Actions, separando la interfaz de tablero SVG (#27) del acceso privado a partidas (PR de laboratorio #34 y siguientes).

## 1. Preparación sin modificar datos

Instalar Node.js 22.16.0 o una versión compatible posterior con `node:sqlite` y Git. No hacen falta contenedores, npm ni servicios adicionales. Desde PowerShell, en una copia local del repositorio:

```powershell
git fetch origin
git switch test/i2-first-validation
node scripts/check-browser-lab.mjs
```

El diagnóstico **no crea ni modifica ninguna base de datos**. Comprueba versión de Node, existencia de suites, disponibilidad del puerto `127.0.0.1:8788` y si ya existe una base local de prueba. Si falta algún archivo, comprobar la rama activa; no mezclar los archivos de `main` con los del laboratorio apilado.

Para cambiar el puerto de forma temporal:

```powershell
$env:CCW_LAB_PORT = '8789'
node scripts/check-browser-lab.mjs
```

## 2. Pruebas automáticas

```powershell
.\scripts\test-local.ps1
```

La batería cubre geometría, servidor experimental, identidades, invitaciones, almacenamiento, API, SQLite, restauración, cookies, rechazo de orígenes y una prueba **HTTP con base SQLite real**. Si alguna prueba falla, conservar el informe de PowerShell (sin compartir contraseñas ni tokens) y detener la validación manual.

## 3. Abrir el laboratorio

```powershell
node scripts/browser-lab.mjs
```

La primera ejecución crea los usuarios **ficticios** `alice` y `bob` y muestra una contraseña aleatoria distinta para cada uno. Se presentan **una sola vez**. Guardarlas temporalmente en un medio privado; no copiarlas al chat, issues, capturas ni repositorio. En nuevos arranques, se recuperan los mismos usuarios, pero no sus contraseñas.

Abrir `http://127.0.0.1:8788/` en dos perfiles separados de navegador, por ejemplo uno normal y otro privado. **Dos pestañas del mismo perfil comparten la misma cookie**, por lo que no representan dos jugadores distintos.

## 4. Guion de aceptación manual

| Paso | Acción | Resultado esperado |
|---|---|---|
| A1 | Iniciar sesión como `alice` en perfil 1 y como `bob` en perfil 2 | Cada uno muestra su identificador de sesión y no el del otro |
| A2 | `alice` crea partida | Se genera identificador UUID y aparece sala `INVITING` |
| A3 | `alice` invita a `bob` | Se muestra token de invitación solo para compartirlo con `bob` |
| A4 | Antes de aceptar, intentar consultar desde `bob` | No permite ver la sala o el estado ajeno |
| A5 | `bob` pega el token y acepta | Sala `READY` con dos participantes |
| A6 | Ambos consultan la misma partida | Cada uno ve su propia mano; del otro solo número de cartas |
| A7 | `bob` intenta finalizar el primer turno ficticio | Es rechazado: inicialmente le toca a `alice` |
| A8 | `alice` finaliza el turno y ambos actualizan | Incrementa revisión y pasa turno ficticio a `bob` |
| A9 | Salir con Ctrl+C, volver a iniciar y consultar | Se conserva la partida, sesión (si no ha caducado) y revisión |
| A10 | Cerrar sesión en perfil 2 e intentar consultar | Debe pedir autenticación y no revelar información privada |

La interfaz puede presentar una sola partida activa cada vez; el token de invitación es **ficticio** y no se envía por correo. Los movimientos y combates aún no existen.

## 5. Comprobar aparte el tablero de la PR #27

La [PR #27](https://github.com/PedroBlanco/command-colors/pull/27) sigue independiente de la interfaz de usuarios. Se puede probar en una **segunda copia del repositorio** (o worktree) para evitar mezclar versiones:

```powershell
git clone https://github.com/PedroBlanco/command-colors.git command-colors-tablero
cd command-colors-tablero
git switch feat/i1-tablero-svg
node --test packages/hex-grid/hex.test.mjs spikes/004/server.test.mjs spikes/004/board-view.test.mjs spikes/004/board-http.test.mjs
node spikes/004/server.mjs
```

Abrir `http://127.0.0.1:8787/`, seleccionar hexágonos con ratón y teclado, acercar, alejar y desplazar. Si el equipo dispone de emulación móvil, revisar a 360 px de ancho; no equivale a una prueba táctil física.

## 6. Qué registrar cuando se haga la validación

- Fecha, versión de Node y navegador utilizados; rama y SHA del commit de cada prueba.
- Prueba automática superada o error concreto, sin datos de autenticación.
- Pasos A1–A10: correcto, incidencia o no probado.
- Observaciones del tablero: uso de ratón, teclado, zoom, arrastre y visualización estrecha.
- Incidencias con el mensaje de error y acción que las provoca, nunca cookies, tokens, contraseñas, nombres personales ni copias SQLite.

**No publicar** bases de datos, ficheros WAL, manifiestos, capturas con credenciales ni tokens de invitación. Los archivos `.local-data/` están ignorados por Git, pero eso no cifra sus contenidos.

## 7. Condiciones de salida

La primera validación puede dar por verificadas **solo** la interfaz local y la sincronización de acciones ficticias. No cierra las issues #7, #8 ni #9, ni implica que el juego sea seguro para Internet. Antes de desplegar quedan pendientes HTTPS, protección contra abuso, cookies `Secure`, copias cifradas, migraciones, motor reglamentario y pruebas de aceptación completas.
