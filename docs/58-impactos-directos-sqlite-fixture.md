# CCW-015 — Aplicación atómica de impactos exclusivamente en fixtures CCRL

**Fecha:** 11/11/2026. **Base:** PR #70. **Estado:** laboratorio de pruebas; no se ha autorizado ningún combate reglamentario de Ancients ni se ha conectado con HTTP, partidas reales o base principal CCWB.

## Propósito y separación de seguridad

Esta etapa prueba una operación que antes no existía: descontar bloques del tablero SQLite de prueba tras una tirada ya registrada, manteniendo unidos el tablero, la revisión, el evento y la clave de idempotencia en una sola transacción. Se realiza **solo en CCRL, un fichero de laboratorio independiente de tres tablas**. No se altera el esquema de tablas ni se añade ruta HTTP.

**Doble puerta explícita:** la construcción de la conexión exige allowTestFixtureMutation=true, y el estado de partida persistido exige labFixtureOnly=true. La operación no puede aplicar resultados del juego real, aunque se importe por error el módulo. El adaptador de integración requiere a su vez enableUnsafeFixtureMutation=true; nunca incorporarlo a la API pública.

La entrada de la operación incluye exclusivamente matchId, sessionUserId (que debe derivarse de una autenticación fiable), reservationId, expectedRevision e idempotencyKey. Rechaza cualquier propiedad adicional, incluidos bloques, objetivos, impactos y etiquetas de autorización aportadas por un cliente.

## Implementación

- **lab-direct-hit-effect.mjs:** transforma una copia del tablero, sin tocar el original. Vuelve a calcular el resultado completo con previewBaseAncientsRangedBlockLoss y exige coincidencia exacta para rechazar resúmenes alterados. Verifica el tipo de unidad, los bloques actuales, la correspondencia del líder por posición, los identificadores duplicados y las casillas ocupadas.
- Si hay impactos, descuenta como máximo los bloques existentes. Cuando una unidad pierde su último bloque se elimina exclusivamente esa unidad de la colección de fixtures; un líder asociado **permanece** para la comprobación o evasión reglamentaria que todavía falta ejecutar.
- En un disparo sin impactos, el tablero permanece igual y se conserva la posibilidad de resolver las banderas. No se otorgan estandartes, se retiran líderes ni se ejecutan desplazamientos.
- **sqlite-lab-direct-hit-commit.mjs:** abre **solo** una base CCRL v1 que tenga las tres tablas y definiciones exactas. Exige la marca RANGED_DICE_STAGED_OFFICIAL_PREVIEW, el actor correcto, la revisión y la huella SHA-256 del tablero. Lee los datos con BEGIN IMMEDIATE y obtiene los impactos a través de una función confiable inyectada desde código interno.
- Confirma de una vez board_json, turn_json, revision, evento público mínimo y la fila de idempotencia. Un fallo de INSERT o UPDATE revierte todas esas modificaciones. Un segundo intento con la misma clave recupera el resumen almacenado, sin volver a eliminar bloques; una clave distinta no puede repetir la transición.
- La marca pasa a LAB_DIRECT_HITS_APPLIED_FIXTURE con un resumen del siguiente paso **pendiente** (comprobación de líder, decisión moral o finalización todavía no autorizada). En el estado queda registrado unverifiedFullRules=true. El evento público solo contiene bando y cantidad de bloques, no los resultados individuales de dados ni el identificador de la unidad.
- **sqlite-lab-direct-hit-adapter.mjs:** conecta este sumidero con deriveStagedAncientsRangedBlockLoss de la PR #69, evitando depender de contadores suministrados por el navegador.
- **sqlite-reservation-lab.mjs:** un reintento exacto de la orden original de dados puede devolver el resultado inicial incluso después de la transición de fixtures, sin tirar de nuevo.

La huella SHA-256 identifica cambios accidentales en los bytes de board_json, **no** autentica escrituras de alguien con acceso directo al fichero. La barrera de seguridad real sigue siendo no exponer la API de pruebas y mantener acceso estricto al almacenamiento.

## Evidencia obtenida

**Node.js v22.16.0, Linux nativo, sin WSL ni GitHub Actions.**

Comando ejecutado:

    node --test --test-reporter=tap packages/ancients-rules/lab-direct-hit-effect.test.mjs packages/ancients-rules/sqlite-lab-direct-hit-commit.test.mjs

**39/39 PASS, 0 FAIL, 0 SKIP**, en cinco ejecuciones consecutivas correctas. Son 17 casos de efectos puros y 22 casos de SQLite real con un callback de interpretación de prueba (no el verificador completo del repositorio). Las pruebas comprueban especialmente:
- límites de bloques, impactos sobrantes, banderas y eliminación de unidades;
- asociación de líderes, errores de duplicidad, rechazo de datos alterados y ausencia de autorización;
- persistencia atómica de revisión/tablero/eventos/claves, recuperación desde otra conexión, idempotencia y comprobaciones de privacidad;
- rollback de toda la transacción al fallar el INSERT del evento o del registro de comando;
- rechazo de ficheros ajenos, esquema diferente, versión obsoleta y estados sin las dos marcas de laboratorio.

**Seis casos adicionales** escritos en sqlite-lab-direct-hit-adapter.test.mjs prueban el enlace con la reserva y la tirada de Ancients **del repositorio completo**. Su sintaxis se ha comprobado, pero **no se han ejecutado** porque faltan dependencias locales de la rama completa. Estas pruebas incluyen reintento de dados originales tras confirmar bloques y rollback tras una avería.

Hashes Git blob exactos entre los archivos locales ejecutados y la rama:
- lab-direct-hit-effect.mjs: 3d3f752169cb102f01e78353999378f99f1f3f02
- lab-direct-hit-effect.test.mjs: 05c11eb1d7c156d2be7c6b40ea63909a4499f5d6
- sqlite-lab-direct-hit-commit.mjs: 7fb5e7fb903952b35b2cb3d93502f27626d6351a
- sqlite-lab-direct-hit-commit.test.mjs: 92f11d8c42fbfd224328a855e24e245427ef7dd6
- sqlite-lab-direct-hit-adapter.mjs: fc37bb4bdc561d1529d1e6025e8eeeffe549d338
- sqlite-lab-direct-hit-adapter.test.mjs: 005978bf2a42a1b0234f92fdebf45cecce260332

SHA-256 del TAP local de la quinta ejecución: 57bdccc0c7d6da748b4cc1186c4265e79e0436b6f74b292f5558cd7d2687fe74.

El manifiesto general registra **60 suites**. La regresión de las 60 suites, las 6 pruebas de integración con las dependencias reales, Windows nativo, el navegador HTTP/SSE con dos jugadores y la concurrencia multiproceso real siguen pendientes.

## Puertas para acercarse al juego real

1. Construir autorización reglamentaria completa con carta, órdenes, excepciones de escenario y secuencia de combate. El permiso de fixture **no puede sustituir** esa autorización.
2. Validar de extremo a extremo los seis casos de integración y la regresión completa sobre un checkout exacto.
3. Incorporar la comprobación real del líder, la elección de moral del defensor, el cálculo de retirada/evasión y sus pérdidas; no conceder victoria antes de resolver todos los efectos.
4. Desarrollar un servicio HTTP autenticado con protección CSRF, proyecciones privadas de mano/cartas y permisos de participantes.
5. Revisar la cadena de PR y ejecutar pruebas Windows y multiproceso antes de la fusión y despliegue.

**Conclusión:** ya existe una escritura transaccional comprobada de impactos en el laboratorio de prueba. No es todavía la aplicación autorizada de los impactos en una partida de Ancients.
