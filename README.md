# Command & Colors Web

Aplicación web no comercial de juegos por turnos para **dos jugadores humanos**. Primero *Command & Colors: Ancients* básico; después *Napoleonics* básico y ampliaciones.

**Estado:** iteración 0, definición y diseño. No existe todavía un motor de reglas, servidor, ni partida multijugador.

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

## Probar el tablero experimental (Windows 11)

Con Node.js 22 o posterior, desde la raíz del repositorio:

```powershell
node --test packages/hex-grid/hex.test.mjs spikes/004/*.test.mjs
node spikes/004/server.mjs
```

Abrir `http://127.0.0.1:8787` en dos pestañas. Identidades ficticias A/B, tablero SVG, cartas sintéticas y turnos simulados. **Solo local; no exponer a redes ni Internet.** Más información: [incremento I1](docs/10-incremento-tablero-svg.md) y [guía de prueba](spikes/004/README.md).
