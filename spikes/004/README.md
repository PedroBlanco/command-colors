# CCW-004 / CCW-006 — Demostración web local de dos jugadores

**No es un juego ni un sistema seguro para Internet.** Dos identidades **ficticias** A/B, turno simulado y manos ficticias; el servidor funciona solo en memoria. No hay persistencia ni reglas; el tablero se representa como 117 hexágonos SVG con dos unidades de ejemplo. Se sirve exclusivamente en `127.0.0.1`.

## Requisitos y prueba en Windows 11

Node.js >=22. Desde PowerShell en la raíz del repositorio, sin dependencias de npm ni WSL:

```powershell
node --test packages/hex-grid/hex.test.mjs spikes/004/*.test.mjs
node spikes/004/server.mjs
```

Abrir `http://127.0.0.1:8787` en dos pestañas, asignar A y B, elegir hexágonos, acercar/alejar y arrastrar. Finalizar un turno ficticio en A y observar en B el aviso SSE y cambio de turno. Repetir en sentido contrario. Una misma partida de demostración se comparte entre pestañas mientras el proceso continúe ejecutándose.

La prueba sobre un teléfono físico requiere un paso posterior: la versión **no escucha en la red local**, y no debe modificarse a `0.0.0.0` con identidades sin autenticar. La responsividad puede examinarse en las herramientas de desarrollo del navegador, aunque no sustituye a la prueba real.

## Diseño del prototipo

- `index.html`: estructura adaptable y estilos, sin dependencias.
- `board-client.mjs`: refresco HTTP, notificaciones SSE, manejo de identidad ficticia, mano privada y zoom/desplazamiento.
- `board-view.mjs`: proyección visual **solo** de unidades públicas y selección por clic/teclado, usando `packages/hex-grid`.
- `server.mjs`: rutas explícitas para los módulos estáticos, sin ofrecer acceso general al sistema de archivos.
- `board-view.test.mjs` y `board-http.test.mjs`: topología de vista, accesibilidad básica, rechazados y rutas HTTP.

El cliente no puede mover unidades ni dictar cartas o resultados al servidor. El botón «Finalizar turno ficticio» es la única acción del servidor de ejemplo y sigue comprobando actor, revisión e idempotencia. Los resultados de cartas y el tablero real todavía no están implementados.

## Límites conocidos

Sin login real, invitaciones, TLS, datos persistidos, validación de reglas, sectores oficiales, escenarios oficiales, notificaciones persistentes ni garantías de compatibilidad con dispositivos físicos. Las etiquetas A/B pueden falsificarse en HTTP: **jamás publicar este ejemplo en Internet o red no confiable**. La sincronización SSE no reconecta automáticamente si se corta; permite actualizar manualmente. Las pruebas de vista se ejecutan con DOM simulado, no equivalen a pruebas de navegador real.
