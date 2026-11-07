# Estado de integración y preparación de la primera validación (7-11-2026)

## Ramas y decisiones de integración

- **Fusionadas en `main`**: PR #31 (backend consolidado), #32 (SQLite), #33 (esquema/copias), #34 (sesiones web), #35 (regresión y diagnósticos), #36 (SSE) y #37 (máquina de fases sintética). Se utilizaron commits de fusión, preservando la historia de cada incremento.
- **Cerradas sin fusionar**: PR #28, #29 y #30. Sus módulos están incorporados en la PR #31; fusionarlas individualmente duplicaría trabajo.
- **Abierta**: PR #27 del tablero SVG. No fue fusionada porque la validación visual sigue pendiente; tampoco se ha integrado esa interfaz con las sesiones web.

## Ejecutar desde Windows 11 y `main`

Requiere Git, PowerShell y Node.js 22.16.0 o posterior compatible con `node:sqlite`. No requiere WSL, VPS, Docker, npm o GitHub Actions.

```powershell
git fetch origin
git switch main
git pull --ff-only
node scripts/check-browser-lab.mjs
.\scripts\test-local.ps1
node scripts/browser-lab.mjs
```

El diagnóstico es de solo lectura. El laboratorio crea al primer arranque cuentas **sintéticas** `alice` y `bob`, con contraseñas aleatorias mostradas una sola vez, y solo escucha en **127.0.0.1:8788**. Abrir `http://127.0.0.1:8788/` en dos perfiles de navegador distintos; no usar contraseñas personales ni compartir tokens, archivos SQLite o capturas con credenciales.

La guía detallada es [docs/18-guia-primera-validacion.md](18-guia-primera-validacion.md). La PR #27 del tablero se debe comprobar **por separado**, preferiblemente en otra copia del repositorio.

## Evidencia automática y limitaciones

- En la PR #35 se ejecutaron las 15 suites entonces existentes: **93/93** pruebas superadas.
- En la PR #36 se ejecutaron **17 suites juntas: 99/99** pruebas superadas, incluida sincronización SSE con SQLite real y dobles de navegador.
- El módulo independiente de fases de la PR #37 superó **15/15** pruebas sintéticas.
- Después de las fusiones, se verificaron **nueve archivos críticos** del árbol Git de `main` contra sus hashes de las versiones probadas, con nueve coincidencias.
- El script `test-local.ps1` contiene ahora **18 suites** (incluida la máquina de fases) y el diagnóstico comprueba su presencia. **No se afirma que las 18 suites se hayan ejecutado juntas tras la fusión**, ni que PowerShell haya sido probado en Windows 11.

## Sin cobertura de producción

- El servidor sigue siendo un laboratorio local y **no debe exponerse a Internet**; faltan HTTPS real, antiabuso, seguridad de sesiones tras proxy, administración de cuentas y endurecimiento operativo.
- La persistencia SQLite de laboratorio no implica que PostgreSQL o las copias cifradas de producción estén implantadas.
- **No hay juego reglamentario de Ancients**: solo órdenes/turnos ficticios, una máquina de fases sintética y prototipos de UI. No se distribuyen materiales oficiales.
- Faltan aceptación visual con ratón/teclado/móvil, actualización automática comprobada con dos navegadores reales y validación de la PR #27.

## Próxima secuencia recomendada

Primero ejecutar la batería de 18 suites desde PowerShell y la aceptación A1–A10 en dos perfiles del mismo equipo; registrar solo errores y resultados, sin secretos. Validar por separado la PR #27 (tablero). Después decidir su integración visual, seleccionar un subconjunto reglamentario verificado de Ancients e incorporar comandos reales y persistencia coherente con el contrato de fases.
