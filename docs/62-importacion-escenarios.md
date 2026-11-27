# Importación de escenarios de Ancients (formato 1)

## Alcance

Un único formato de datos, con procedencia `OFFICIAL`, `COMMUNITY` u `ORIGINAL`. La etiqueta de procedencia es informativa, no certifica una licencia ni el cumplimiento de todas las reglas. Por ahora la administración importa archivos locales de confianza antes de arrancar; no existe subida desde el navegador ni edición por jugadores. Los escenarios incorporados al repositorio son originales. No se distribuye material gráfico ni texto de los escenarios publicados.

## Uso en PowerShell (laboratorio, no Internet)

Los tres escenarios integrados siguen disponibles sin configurar nada. Para comprobar un archivo externo original en una futura sesión de validación:

```powershell
New-Item -ItemType Directory -Force .local-data/scenarios | Out-Null
Copy-Item scenarios/examples/ford-example-v1.json .local-data/scenarios/
$env:CCW_ANCIENTS_BROWSER_LAB = '1'
$env:CCW_ANCIENTS_SCENARIO_DIR = (Resolve-Path .local-data/scenarios).Path
node scripts/browser-lab.mjs
```

El directorio debe existir. Solo se leen archivos JSON regulares, no enlaces simbólicos, hasta 500 archivos y 256 KiB por archivo. El cargador falla antes de inicializar SQLite si un documento es inválido, contiene un identificador repetido, excede el límite o intenta usar una geometría no soportada. Reiniciar para incorporar cambios. Usar un ID nuevo al editar un escenario ya utilizado. El directorio `.local-data` está excluido de Git.

El propietario de una sala lista selecciona el escenario; el navegador envía únicamente su ID. La instantánea inicial guarda configuración, procedencia y facciones; cambiar o retirar el fichero no invalida una partida existente.

## Contrato JSON v1

Ejemplo completo: [ford-example-v1.json](../scenarios/examples/ford-example-v1.json).

| Campo | Formato |
|---|---|
| schemaVersion | 1 |
| geometry | LAB_ODD_Q_13X9 (diarios antiguos); OFFICIAL_ODD_R_113 (tablero físico, filas alternas) |
| id | identificador único versionado en minúsculas, p. ej. my-battle-v1, máximo 64 caracteres |
| title | nombre, hasta 120 caracteres |
| deckId | ancients-base-2009 |
| provenance | objeto kind (OFFICIAL, COMMUNITY u ORIGINAL) y source (referencia o autor, hasta 500 caracteres) |
| factions | nombres A y B, hasta 80 caracteres cada uno |
| startingSide | A o B |
| handSizes | objeto A/B, enteros de 1 a 20 |
| victoryTargets | objeto A/B, objetivos válidos para el motor |
| units | lista de objetos id, side, col, row, type; al menos una unidad por bando |
| leaders | lista de objetos id, side, col, row |
| terrain | lista de objetos col, row, kind; RAMPART admite la orientación validada por el motor |
| sectorCells | mapa de las 117 o 113 coordenadas col,row (base cero), según geometry, a uno o dos sectores adyacentes LEFT, CENTER, RIGHT; para geometría oficial usar officialSectorCells() |
| objectives | lista opcional de objetos id, side, mode, cells, minUnits, banners; omitir si no hay objetivos especiales |
| specialRules | objeto opcional con listas sacredBand y handGrowth, y leaderLoss opcional; solo excepciones implementadas |

Solo se admiten campos conocidos. Se comprueba la configuración con el inicializador real del diario, incluyendo tipos, coordenadas, ocupación, líderes, sectores, cartas y objetivos. No se admiten funciones, flags de motor, cartas arbitrarias, reglas sin soporte, fuerzas iniciales reducidas ni salidas puntuables. No omitir o simular una regla especial para hacer pasar un escenario oficial como compatible.

## Excepciones declarativas (juego base)

`specialRules` permite identificar unidades de infantería pesada con la capacidad de Banda Sagrada y definir aumentos permanentes de la mano de mando. No depende del nombre de la batalla. Ejemplo de sintaxis original:

```json
{
  "sacredBand": ["elite1"],
  "handGrowth": [
    {"id":"turn1","side":"A","trigger":"OWN_TURN_END","threshold":1,"cards":1},
    {"id":"turn2","side":"A","trigger":"OWN_TURN_END","threshold":2,"cards":1},
    {"id":"reward","side":"B","trigger":"CASUALTY_BANNERS","threshold":3,"cards":2}
  ]
}
```

El campo `sacredBand` contiene identificadores de unidades de infantería pesada presentes al inicio. Suma aciertos por símbolo de líder en cuerpo a cuerpo aunque no haya líder próximo y permite ignorar una bandera adicional. El rasgo se muestra en el tablero y persiste hasta la eliminación. No se aplica al fuego a distancia. Para el segundo caso, OWN_TURN_END cuenta turnos propios terminados y roba las cartas extra tras el robo ordinario; CASUALTY_BANNERS cuenta medallas por bajas de unidades o líderes y concede la recompensa al confirmar la resolución que alcanza el umbral. No incluye medallas territoriales. No se roba si la partida ya terminó. Cada recompensa se registra una sola vez. Los eventos públicos solo revelan la cantidad, nunca la identidad de las cartas nuevas. Se conserva el máximo de 20 cartas por bando y se reserva al menos una carta fuera de las manos. Las partidas anteriores no adquieren excepciones retroactivamente.

Fuentes de requisitos: [Crimissos](https://www.commandsandcolors.net/ancients/scenario-list/sicilian-wars-600-265-bc/002-crimissos-river-341-bc.html), [Lago Trasimeno](https://www.commandsandcolors.net/ancients/scenario-list/second-punic-war-218-202-bc/006-lake-trasimenus-217-bc.html), [Beneventum II](https://www.commandsandcolors.net/ancients/scenario-list/second-punic-war-218-202-bc/009-2nd-beneventum-214-bc.html). Para Trasimeno se admiten LAKE y STEEP_HILL: ambos infranqueables; el lago no bloquea la línea de visión, conforme a la regla de costa; la colina escarpada la bloquea (interpretación conservadora de elevación, a validar). Para Trebbia sigue pendiente la reserva fuera del tablero y la entrada autorizada por carta de liderazgo. No se certifica una batalla solo por disponer de una excepción.

### Victoria por pérdida de un líder designado

El objeto `specialRules` admite adicionalmente `leaderLoss`, una lista de objetos `{leaderId,winner,mode}`. El líder debe estar presente al comenzar la partida y pertenecer al adversario del vencedor configurado. ELIMINATED exige una baja registrada; REMOVED considera también la evasión fuera del tablero. Al cumplirse la condición, termina inmediatamente la partida con motivo DESIGNATED_LEADER_LOST, sin modificar artificialmente las medallas. Si dos condiciones decisivas se cumplen simultáneamente, el resultado es empate. La interfaz indica el motivo de victoria. La ausencia de este campo conserva las reglas antiguas. Fuente: [Castulo](https://www.commandsandcolors.net/ancients/scenario-list/second-punic-war-218-202-bc/010-castulo-211-bc.html), que establece victoria cartaginesa si se pierde Escipión. Interpretar "perdido" como REMOVED (también evacuación sin baja) es una decisión provisional; contrastar con una aclaración específica. No se ha habilitado aún el escenario: falta el mecanismo de salida puntuable de unidades desde el borde enemigo en centro o derecha romana.

## Tablero físico: geometría versionada

La página 2 del [libro oficial de escenarios de GMT (2006)](https://www.gmtgames.com/cca/CCScenarioBook0906.pdf) muestra el tablero real: nueve filas alternas de 13 y 12 celdas, 113 hexágonos, orientación de filas desplazadas. El laboratorio usa odd-q (columnas desplazadas), 13 × 9 = 117 celdas. La diferencia afecta a vecinos, distancias, LOS, retiradas, posiciones de borde, sectores y representación. No basta con copiar las coordenadas del mapa. Se ha añadido la geometría versionada OFFICIAL_ODD_R_113 y propagado por el diario, movimiento, combate, retirada, LOS, sectores y SVG. Los diarios anteriores siguen usando odd-q. Se rechazan geometrías desconocidas y documentos marcados OFFICIAL con topología antigua; la configuración debe incluir el mapa de sectores exacto. En filas pares (base cero), los hexágonos de columnas 4 y 8 pertenecen a dos sectores. En filas impares, las fronteras coinciden con aristas, de modo que las columnas 0–3 son LEFT, 4–7 CENTER, 8–11 RIGHT. Fuente: página 2 del [libro de escenarios de GMT, 2.ª edición](https://www.gmtgames.com/living_rules/CC%20Scenario2ndEd-201.pdf). Falta regresión nativa y validación de una partida oficial completa.

## Inventario oficial base

Fuentes: [índice de escenarios básicos](https://www.commandsandcolors.net/ancients/the-game/main/base-game-official-scenarios.html) y libro de GMT, 2.ª edición, [parte 1](https://www.gmtgames.com/living_rules/CC%20Scenario2ndEd-201.pdf) [parte 2](https://www.gmtgames.com/living_rules/CC%20Scenario2ndEd-202.pdf) y [parte 3](https://www.gmtgames.com/living_rules/CC%20Scenario2ndEd-203.pdf). Los despliegues oficiales se preparan como datos locales del propietario, sin publicar mapas, ilustraciones ni textos de escenarios en GitHub. El ZIP actualizado de entrega al propietario contiene trece documentos JSON v1; no se instala automáticamente en el servidor.

| N.º | Batalla | Estado |
|---|---|---|
| 001 | Akragas (406 a. C.) | JSON local, 24 unidades/4 líderes, inicialización aislada correcta |
| 002 | Crimissos River (341 a. C.) | JSON local, 22/3, cinco vados y Banda Sagrada, inicialización correcta |
| 003 | Bagradas (253 a. C.) | JSON local, 37/5, incluye elefantes, inicialización correcta |
| 004 | Ticinus River (218 a. C.) | JSON local, 24/4, río infranqueable, inicialización correcta |
| 005 | Trebbia (218 a. C.) | Falta emboscada y entrada de reservas |
| 006 | Lake Trasimenus (217 a. C.) | JSON local, 35/5, lago y colinas escarpadas, mano romana 2→3→4, inicialización correcta |
| 007 | Cannae (216 a. C.) | JSON local, 32/6, inicialización correcta |
| 008 | Dertosa (215 a. C.) | JSON local, 29/3, inicialización correcta |
| 009 | 2nd Beneventum (214 a. C.) | JSON local, 29/4, mano romana +2 al alcanzar tres medallas, inicialización correcta |
| 010 | Castulo (211 a. C.) | Victoria inmediata por líder designado disponible; falta salida puntuable por sectores |
| 011 | Baecula (208 a. C.) | JSON local, 31/4, tres campamentos CAPTURE, inicialización correcta |
| 012 | Metaurus (207 a. C.) | JSON local, 32/4, dos cursos vadeables, colinas y terreno accidentado, inicialización correcta |
| 013 | Ilipa (206 a. C.) | JSON local, 37/3, inicialización correcta |
| 014 | Great Plains (203 a. C.) | JSON local, 28/6, inicialización correcta |
| 015 | Zama (202 a. C.) | JSON local, 40/5, inicialización correcta |

Los primeros ocho documentos se transcribieron visualmente a coordenadas oficiales; se validaron conjuntamente con los tres escenarios originales (11 entradas). Cada configuración se inicializó con el motor, verificando conservación de las 60 cartas, manos, primer turno, piezas, terrenos y replay vacío. Se comprobó coincidencia de las huellas FNV-1a de ID, turno, manos, objetivos, posiciones/tipos de unidades, posiciones de líderes, terrenos y excepciones con el paquete de entrega:

```text
akragas-v1        f6d45a5c
crimissos-v1      8ee5ec9e
bagradas-v1       7072d7ec
ticinus-v1        97de6396
trasimeno-v1      ec5d2cc8
cannae-v1         ffb611b2
dertosa-v1        1d88f402
beneventum-ii-v1  a9696fde
```

Huellas no criptográficas de los datos de juego, no de todo el fichero. La comprobación de inicialización no equivale a certificar la exactitud de todos los despliegues ni una partida completa: se recomienda cotejar con el ejemplar físico en la futura validación. En particular, confirmar los cinco vados de Crimissos, los líderes sin nombre impreso y las variantes de edición. La mano de Cartago en Trasimeno sigue la 2.ª edición (6 cartas). No se requiere acción inmediata del propietario.

Los cinco documentos nuevos se transcribieron de la tercera parte, páginas 1–5. Se comprobaron en el inicializador aislado y como catálogo conjunto con los tres originales. El paquete conserva byte a byte los ocho JSON previos. Huellas FNV-1a del ID, manos, objetivo ordinario, posiciones/tipos de unidades, identificadores/posiciones de líderes, terrenos y objetivos territoriales (distinto conjunto de campos que las ocho huellas anteriores):

```text
baecula-v1        1ad9db61
metaurus-v1       494cad5e
ilipa-v1          87c54f28
great-plains-v1    cd35cdb3
zama-v1           cf40c5b0
```

Próximos pasos: salida puntuable de unidades de Castulo; reservas de Trebbia; validar nativamente el conjunto de trece (más dos cuando estén listos), SQLite/HTTP y navegador. Escenarios comunitarios y expansiones posteriores emplearán el mismo formato.
