# Primera prueba funcional en Windows y regresión SQLite

**Fecha:** 10/11/2026. **Origen:** primera validación manual de la rama `feat/i4-ancients-standard-path-precheck` y registro TAP de `scripts/test-local.ps1`.

## Resultados confirmados

La persona que realiza la prueba informa de que ha jugado **varios turnos alternando entre `alice` y `bob`**, ha desplazado sus unidades hasta que estaban adyacentes y ha accedido a la fase de combate **sin mensajes de error visibles**. Esto acredita un recorrido manual básico en Windows de la interfaz, las cuentas de laboratorio, fases y movimiento sintético. **No acredita** un combate reglamentario, las reglas de *Ancients*, la seguridad de Internet, la prueba en móvil ni la privacidad/escenarios fuera de lo expresamente observado.

Se adjuntó un informe TAP creado en Windows:

| Dato | Resultado |
| --- | --- |
| Sistema | Windows; PowerShell; laboratorio local |
| Versión Node | v26.13.0 |
| Total de pruebas | 366 |
| Correctas | **360** |
| Fallidas | **6** |
| Canceladas/omitidas | 0 / 0 |
| Suites configuradas (archivos) | 40 |
| Código de salida | 1 |
| Duración | 27,72 s |
| SHA-256 del TAP recibido | `7bb3b174643c729bb6b18e82f1e6242d26b0ff3816c5c7ff6b27190df471c290` |

El registro TAP **no se incorpora a un repositorio público**, por contener rutas locales de Windows. Los seis fallos se concentran en `packages/sqlite-store/lifecycle.test.mjs`:

1. Pruebas 313–317: `EBUSY` durante la limpieza de archivos temporales SQLite (`.sqlite`, `-wal` y `-shm`). El registro señala específicamente `unlink` durante la retirada del fixture; no permite concluir que haya fallado el algoritmo de copia/restauración original. Sin embargo, el borrado de temporales podía **ocultar una aserción previa**, por lo que se necesita repetir la prueba.
2. Prueba 319: fallo específico de Windows, `Cannot find module` por ruta `T:\\T:\\...`. La prueba invocaba al script CLI a través de `URL.pathname`, válido accidentalmente en Unix, pero no como ruta de archivo de Windows.

## Corrección provisional, solo del arnés

La rama `fix/i4-windows-sqlite-lifecycle-tests` (PR #55, apilada sobre #54):

- Añade reintentos limitados a `rm(...,{recursive:true,force:true,maxRetries:20,retryDelay:100})`, sin tocar las bases reales. Los reintentos permiten que Windows libere manejadores WAL/SHM cuando el fichero de prueba ya se ha cerrado.
- Conserva la **primera excepción** de la prueba cuando el borrado del directorio temporal también falla, para evitar falsos diagnósticos por `EBUSY`.
- Convierte URLs de archivo con `fileURLToPath(new URL(..., import.meta.url))` y las pasa directamente a `spawnSync`. Se aplica tanto al caso end-to-end como al caso de fuente inexistente.
- **No cambia** `backup.mjs`, `sqlite.mjs`, los esquemas, el navegador, las reglas de juego ni los datos persistidos.

## Comprobación pendiente y criterios de éxito

El arreglo está publicado, pero **todavía no se ha ejecutado en Windows**. Verificar primero solo la suite afectada desde una copia de esta nueva rama:

```powershell
git fetch origin
git switch fix/i4-windows-sqlite-lifecycle-tests
node --test --test-reporter=tap packages/sqlite-store/lifecycle.test.mjs
```

Si esa suite pasa, ejecutar el conjunto completo y guardar un informe nuevo:

```powershell
.\\scripts\\test-local.ps1 -Log ".local-data\\regression\\segunda-prueba-windows.tap"
```

La regresión se considerará superada solo si obtiene **366/366 PASS, 0 FAIL y código 0** (salvo que aparezcan tests nuevos posteriores) y persiste el funcionamiento manual. Si aparece una aserción distinta al `EBUSY`, investigar la causa en lugar de ocultarla con más reintentos.

**Mantener en borrador** PR #45–#55, sin fusión a `main` ni despliegue en Internet mientras se completa la validación.
