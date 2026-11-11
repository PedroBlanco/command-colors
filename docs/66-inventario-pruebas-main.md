# Inventario único de pruebas locales en la rama principal

**Fecha:** 11/11/2026. **Rama de trabajo:** `fix/main-native-test-inventory`, nacida directamente de `main`. Esta corrección **no incorpora el motor de combate experimental** de las PR #64–#79.

## Cambio

En `main` se mantenían dos listas independientes de las 27 suites locales: el prediagnóstico Node y el lanzador PowerShell. Una prueba del prediagnóstico exigía literalmente `result.tests===27`, por lo que un nuevo test obligaría a cambiarla manualmente. Esto puede producir falsos fallos u omitir pruebas al ampliar el proyecto.

Esta rama:

1. Exporta una única lista inmutable `LOCAL_TEST_FILES` desde `scripts/check-browser-lab.mjs`. Su valor actual son **28 suites**, incluida la nueva suite de auditoría.
2. Añade `scripts/check-test-inventory.mjs`, de **solo lectura**, que compara esa lista con todos los archivos `*.test.mjs` de `packages/`, `scripts/` y `spikes/`. Detecta omisiones, archivos nuevos no registrados, duplicados, rutas inseguras, enlaces simbólicos y raíces inexistentes; retorna salida **2** ante errores.
3. Añade `scripts/list-test-files.mjs`, que imprime exclusivamente las rutas de la lista canónica, una por línea.
4. Actualiza `scripts/test-local.ps1`: invoca primero la auditoría y **solo si es correcta** obtiene las rutas mediante el script Node y ejecuta `node --test`. No construye ni evalúa comandos PowerShell con texto de ficheros externos. No usa WSL ni GitHub Actions.
5. Sustituye la aserción fija de 27 por `LOCAL_TEST_FILES.length` y añade comprobación del inventario completo en `scripts/check-browser-lab.test.mjs`.
6. Incorpora `scripts/check-test-inventory.test.mjs` con pruebas unitarias del auditor, del listado Node y del enlace con PowerShell.

## Ejecución

En Windows 11, desde una copia del repositorio y usando PowerShell nativo, Node.js 22.16.0 o posterior:

```powershell
node scripts/check-test-inventory.mjs
.\scripts\test-local.ps1
```

El segundo comando ejecuta el primero automáticamente y, después, las 28 suites; el primer comando por separado es opcional si se desea conocer solo el inventario.

```powershell
node scripts/list-test-files.mjs
```

Muestra las rutas canónicas sin ejecutar ninguna suite. Para esta herramienta no hace falta instalar dependencias ni disponer de servidor web.

## Evidencia disponible

- Con **Node.js 22.16.0 en Linux nativo**, sin WSL ni Actions, se han ejecutado **11/11 pruebas PASS, 0 FAIL, 0 SKIP** en `scripts/check-test-inventory.test.mjs`, usando directorios de prueba temporales. Comprobaron el caso correcto, ausentes, no registrados, duplicados, rutas inseguras, enlaces, carpetas ausentes, argumentos inválidos, salida del enumerador Node y estructura del lanzador PowerShell.
- Los archivos probados se cotejaron por hashes Git exactos con los publicados:
  - `scripts/check-test-inventory.mjs`: `f234c323d600a9cd8a0fea195a4bf28f9320f802`.
  - `scripts/check-test-inventory.test.mjs`: `66785402e27e9122b23cd11deb0c64c658f072cf`.
  - `scripts/list-test-files.mjs`: `5ef73d93694ce5f7ab817075364e5d3398f03073`.
  - `scripts/test-local.ps1`: `05d8131f0da14d85fad8ce4709e7fc59bb6c537d`.
- El inventario real de GitHub debe cotejarse con su árbol y las 28 entradas del manifiesto antes de fusionar.

**Límites:** las 11 pruebas se ejecutaron en una copia mínima de los módulos, no en un checkout completo de `main`. La regresión conjunta de las **28 suites** y el PowerShell real en Windows 11 **no se han ejecutado** en esta sesión. La comprobación estática del lanzador no equivale a ejecutar PowerShell.

## Fusión y despliegue

Es un cambio autocontenido de mantenimiento y un candidato mejor para fusión independiente que la cadena de combate experimental. Antes de fusionar conviene ejecutar las **28 suites completas** y el lanzador Windows. Ninguna parte requiere desplegar un servidor; el proyecto permanece experimental.

**No hay ningún cambio de reglas de Ancients ni de la persistencia de partidas.**


## Incidencia de validación en Windows: SQLite WAL y rutas del CLI

**Detectada al ejecutar el paso de regresión de la PR #80 en Windows con Node.js v26.13.0**. Fallaron varios casos de `packages/sqlite-store/lifecycle.test.mjs` al intentar borrar los archivos temporales `live.sqlite-wal` o `live.sqlite-shm`: error `EBUSY`. Un caso adicional construía una ruta incorrecta `T:\\T:\\Github\\...\\scripts\\sqlite-maintenance.mjs` por utilizar `new URL(...).pathname` como argumento de Node en Windows.

Correcciones realizadas en la **rama de la misma PR #80**, sin tocar `main`:

1. El bloque `withTemp()` reintenta exclusivamente la eliminación de su carpeta temporal `ccw-lifecycle-*` con `rm({recursive:true,force:true,maxRetries:12,retryDelay:100})`. Un bloqueo persistente **no queda silenciado**: el error se comunica.
2. Los dos subprocesos de pruebas del CLI utilizan `fileURLToPath(tool)` de `node:url` en lugar de `tool.pathname`, evitando la duplicación de la letra de unidad `T:`.
3. No se modificaron las operaciones de backup/restore ni la lógica del motor; se corrigieron únicamente las pruebas y su limpieza.

**Puerta de aceptación Windows pendiente tras el parche:**

```powershell
# Dentro del worktree ya actualizado de la PR #80
node --test --test-reporter=tap packages/sqlite-store/lifecycle.test.mjs
$LASTEXITCODE
.\scripts\test-local.ps1
$LASTEXITCODE
```

El primer comando comprueba la suite corregida antes de volver a ejecutar las **28 suites**. Si el resultado `EBUSY` persiste en Node 26, repetir la suite por separado con Node **22 LTS compatible (22.16 o posterior)** permite distinguir comportamiento dependiente de versión; documentar ambas versiones y resultados, **sin borrar archivos SQLite manualmente**.

El parche solo se ha contrastado contra el código fuente publicado y las reglas de conversión de URLs a rutas nativas en Node; **la ejecución Windows posterior al cambio sigue pendiente de la respuesta del equipo de pruebas**. No fusionar todavía.
