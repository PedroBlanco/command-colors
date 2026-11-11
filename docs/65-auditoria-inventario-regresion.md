# Validación del inventario de pruebas antes de la regresión integral

**Fecha:** 11/11/2026. **Base:** PR #78. **Estado:** corrección de herramientas locales, sin cambios de reglas ni en SQLite. La regresión integral aún no se ha ejecutado.

## Problema identificado

`scripts/check-browser-lab.test.mjs` seguía exigiendo **43 suites**, una cifra heredada de una fase anterior. El manifiesto de la rama dependiente de la PR #78 contiene **68 suites**, por lo que esta aserción hubiera fallado aunque todos los archivos existieran.

La aserción ahora utiliza la lista canónica `LOCAL_TEST_FILES.length`, sin número obsoleto, y una segunda prueba comprueba realmente que el árbol contiene exactamente los archivos enumerados. La nueva suite de inventario aumenta el manifiesto a **69 suites**.

## Nuevo inventario verificable

`scripts/check-test-inventory.mjs` inspecciona, en modo **solo lectura**, los archivos `*.test.mjs` de `packages/`, `scripts/` y `spikes/`. Compara lo existente con `LOCAL_TEST_FILES` en `scripts/check-browser-lab.mjs`, y devuelve errores precisos si:

- Falta un archivo que figura en el manifiesto.
- Existe una prueba sin registrar en el manifiesto.
- Aparece una entrada duplicada o una ruta inválida con escape del directorio.
- Una prueba es un enlace simbólico (no se siguen enlaces) o falta una carpeta de búsqueda.

El resultado contiene `ok`, `expected`, `actual`, `missing`, `unlisted`, `duplicates`, `invalid`, `links` y `missingRoots`. No abre SQLite, no escribe ficheros, no usa red ni ejecuta comandos arbitrarios.

`scripts/run-test-suite.mjs` verifica **automáticamente el inventario completo antes de ejecutar todas las suites**. Si hay discrepancias, termina con código **2**, sin lanzar una regresión incompleta. La ejecución selectiva `--only` permanece disponible para diagnosticar casos concretos, sin presentar una selección como regresión integral.

## Uso local en Windows, sin WSL

Desde PowerShell con Node.js 22.16 o posterior:

```powershell
node scripts/check-test-inventory.mjs
.\scripts\test-local.ps1
```

Para conservar evidencia del resultado en un fichero nuevo (que el corredor nunca sobrescribe):

```powershell
.\scripts\test-local.ps1 -Log ".local-data\regression-20261111.tap"
```

El ejecutor ya registra código de salida, hora y SHA-256 del informe. No utiliza GitHub Actions, Docker, WSL ni una instalación en VPS.

## Evidencia disponible y limitaciones

Se han ejecutado **9/9 pruebas unitarias nuevas** de `scripts/check-test-inventory.test.mjs`, con Node.js **22.16.0**, sin fallos ni saltos, en un directorio temporal de prueba. Cubren inventario exacto, archivo ausente, archivo adicional no registrado, duplicado, rutas inseguras, enlaces simbólicos, carpeta ausente, raíces duplicadas y manifiesto inválido. Los módulos y tests publicados son los mismos que se probaron localmente, verificados mediante hashes Git:

- `scripts/check-test-inventory.mjs`: `f234c323d600a9cd8a0fea195a4bf28f9320f802`.
- `scripts/check-test-inventory.test.mjs`: `e4819d622887fb672ac149b97c44b1a3755e5391`.

**Estos nueve casos no prueban el motor de juego ni sustituyen la regresión integral.** La prueba de inventario aplicada a todo el checkout está incorporada, pero su ejecución **con un checkout íntegro** permanece pendiente en el entorno actual. El inventario de GitHub se coteja por separado con su árbol Git de la rama.

La terminal utilizada no puede acceder a GitHub por red, aunque la conexión GitHub permite inspeccionar y publicar archivos. Por ello, no se declara la ejecución de las 69 suites completas ni de Windows nativo, dos navegadores, HTTP/SSE o carreras multiproceso.

## Criterio de integración

Mantener esta PR **en borrador** y no fusionar ni desplegar la cadena experimental hasta que:

1. `node scripts/check-test-inventory.mjs` sea correcto en el checkout íntegro.
2. `.\scripts\test-local.ps1` supere **las 69 suites**, incluido el flujo integrado de reserva, dados, impactos y líderes, sin fallos ni saltos no justificados.
3. Se revisen las garantías de fixtures, la privacidad y las reglas pendientes antes de exponer rutas reales.

**Este incremento cierra una fuente concreta de fallos por desactualización del manifiesto y hace fallar el proceso ante nuevas omisiones.**
