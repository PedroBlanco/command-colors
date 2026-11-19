# Diario privado V2 de trayectorias de infantería — Ancients

Integración limpia de las PR históricas #122 y #123, complementando el motor de movimiento puro V2 de la PR #167.

- `auditCoreOpenFootPathReplay`: reproduce las acciones desde estado inicial, política y revisión **independientes** del diario; comprueba estado calculado y cada transición, sin aceptar estados parciales.
- `initializeFootPathJournal`, `proposeFootPathJournalAppend`, `replayFootPathJournal`, `checkFootPathJournalAnchor`: diario inmutable ligado a partida, revisión, reglas, órdenes, ruta completa, eventos **propuestos** y claves de idempotencia privadas. Detecta reintentos idénticos y colisiones, y vuelve a reproducir todo el historial.

Un resultado `PRIVATE_*_CANDIDATE` **no** autentica, autoriza, consume órdenes de partida, escribe una fila SQL ni emite eventos públicos: siempre `movementAuthorized:false`, `canCommit:false` y `dbChanged:false`. Las firmas semánticas no son firmas criptográficas de servidor. El estado inicial y la política deben salir de la sesión, escenario y replay CCWB verificados; **nunca del cliente o de otro campo del propio diario**.

Se añaden dos suites focales al manifiesto (90 → 92). No se ejecutaron todavía las 92 suites sobre esta integración. Pendientes: conexión al CCWB con autenticación y bloqueo escritor, transiciones confirmadas y seguridad SEC-001. No se añaden rutas HTTP ni se modifica SQLite.
