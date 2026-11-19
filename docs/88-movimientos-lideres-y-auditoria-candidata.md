# Integración de movimientos de líderes y auditoría candidata — Etapa 12

Origen: PR históricas #95 y #96. Base limpia: `main@c993f942c0763d67e27b636b751a2815ab287141` (seguridad SEC-001).

## Funcionalidad

- **Líder ordenado por separado**: pantalla previa de desplazamiento de hasta tres hexágonos adyacentes, detención por bosque o terreno accidentado, ocupación, paso por piezas amigas y unión/separación de unidades.
- **Secuencias líder–unidad**: proyección simulada sobre copia del tablero. Impide mover dos veces, separar posteriormente al líder transportado y mover después a la unidad a la que ya se unió un líder.
- **Traza auditable no ejecutable**: SHA-256 encadenado desde contexto de escenario, revisión, bando, órdenes, terreno y movimientos. Se verifica por regeneración desde datos del servidor, no mediante confianza en la traza enviada.
- **Integración interna CCWB**: puente privado con replay verificado y lectura WAL consistente de sesión, pertenencia, orden y tablero. No se abren rutas HTTP/SSE nuevas.

## Invariantes

`CANDIDATE` y `CANDIDATE_SEQUENCE` nunca autorizan una operación. Mantener siempre `movementAuthorized:false`, `attackAuthorized:false`, `stateChanged:false` y `needsFullLegalityCheck:true`. No se modifican el tablero persistido, la revisión, órdenes gastadas, eventos ni esquema; sin reglas finales oficiales de movimiento ni combate.

La cadena SHA-256 no es una firma digital. No tratar `game_events` como almacenamiento de movimientos provisionales. SEC-001 (#94) sigue abierto. El borrador privado persistente de la rama histórica #95 se tratará en un bloque posterior separado y con auditoría transaccional; no cerrar todavía esa PR como sustituida.

## Evidencia pendiente

Se recuperan pruebas del motor y composición SQLite en Node, conservando pruebas SEC-001. Inventario previsto: **84 suites** (81 actuales + 3 nuevas). No se ha ejecutado aún la regresión completa de 84 suites en el nuevo árbol. No desplegar a usuarios reales.
