# Regresión adicional: cuatro suites previamente pendientes

**Fecha:** 8 de noviembre de 2026. **Rama:** `feat/i4-manual-browser-movement` (PR #48), basada sucesivamente en #47, #46 y #45.

## Ejecución verificable

Se recuperaron directamente desde el repositorio en GitHub los módulos y tests de cuatro suites no incluidas en el informe de 151 pruebas:

| Suite | Pruebas | Resultado |
| --- | ---: | --- |
| `packages/local-api/browser-session.test.mjs` | 7 | PASS |
| `packages/match-store/store.test.mjs` | 7 | PASS |
| `spikes/004/server.test.mjs` | 5 | PASS |
| `scripts/check-browser-lab.test.mjs` | 2 | PASS |
| **Total** | **21** | **21 PASS / 0 FAIL** |

Comando ejecutado con Node.js **22.16.0**, sin WSL, VPS ni GitHub Actions:

```powershell
node --test packages/local-api/browser-session.test.mjs packages/match-store/store.test.mjs spikes/004/server.test.mjs scripts/check-browser-lab.test.mjs
```

Las cuatro suites se ejecutaron **juntas** en un entorno aislado Linux x64, con una reconstrucción de los ocho archivos exactos obtenidos de GitHub; los ocho SHA de blob coincidieron con `git hash-object` de los archivos ejecutados:

| Archivo | SHA Git verificado |
| --- | --- |
| `packages/local-api/browser-session.mjs` | `0d23fc813d515bc3a618752426f4f0f0064852b9` |
| `packages/local-api/browser-session.test.mjs` | `a31542cddd8f2dc5a6d188664e9f4b9806609970` |
| `packages/match-store/store.mjs` | `f92a687bcf6741d80a98f0f451d11fcd71df0503` |
| `packages/match-store/store.test.mjs` | `954cb2a0489322820f72d61aec859820af508ff4` |
| `spikes/004/server.mjs` | `9963bbd4c3b681e4b8f4f3e91a56defe39bdd160` |
| `spikes/004/server.test.mjs` | `639fb73cd1583b17e5708851a3714314a6081587` |
| `scripts/check-browser-lab.mjs` | `f4c07cc1649ac738aae3f6150382387196d2812d` |
| `scripts/check-browser-lab.test.mjs` | `baa142e22d0d50fe504124d9ddc1235dc4a3ea5d` |

El almacenamiento en fichero verifica serialización de comandos concurrentes, proyecciones privadas, idempotencia, recuperación y fallo de escritura. El servidor inicial de laboratorio verifica dos jugadores, rechazo de no participantes, ausencia de filtración de manos y SSE real. Los tests de sesión cubren HTTPS, cookies, CSRF, Host y acceso `127.0.0.1`. El preflight verifica que no modifica datos y que detecta puertos no aptos.

## Estado del conjunto

Este avance completa otras **4 de las 17 suites** que estaban pendientes de ejecutar. Sumado a las 16 suites del informe [33](33-regresion-integrada-150.md), hay pruebas documentadas de **20 de las 33 suites** del repositorio. **Esos 20 conjuntos no han sido ejecutados todavía todos juntos en una única invocación**.

Las **13 suites restantes** por ejecutar son:

```text
packages/access-control/access.test.mjs
packages/local-api/gateway.test.mjs
packages/local-api/compose.test.mjs
packages/sqlite-store/sqlite.test.mjs
packages/local-api/sqlite-compose.test.mjs
packages/sqlite-store/lifecycle.test.mjs
packages/sqlite-store/schema-integrity.test.mjs
packages/local-api/browser-gateway.test.mjs
packages/local-api/browser-sqlite-smoke.test.mjs
scripts/browser-lab.launcher.test.mjs
packages/local-api/revision-stream.test.mjs
packages/local-api/browser-ui.test.mjs
packages/local-api/command-deck-http.test.mjs
```

## Bloqueos para fusionar

- Ejecutar las 13 suites restantes y posteriormente **las 33 juntas** con `./scripts/test-local.ps1` desde PowerShell de Windows 11 (sin WSL). Documentar fallos y corregirlos antes de fusionar las PR #45–#48.
- Probar visualmente dos sesiones de navegador en PC/móvil y evaluar por separado la PR #27 de tablero SVG.
- Revisar el carácter experimental de seguridad y sustituir perfiles ficticios por reglas de la edición física antes de llamar «jugable» al proyecto.

**No se ha modificado `main`; las cuatro PR permanecen en borrador y apiladas.**
