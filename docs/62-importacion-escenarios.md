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

Solo se admiten campos conocidos. Se comprueba la configuración con el inicializador real del diario, incluyendo tipos, coordenadas, ocupación, líderes, sectores, cartas y objetivos. No se admiten funciones, flags de motor, cartas arbitrarias, reglas sin soporte, fuerzas iniciales reducidas ni salidas puntuables. No omitir o simular una regla especial para hacer pasar un escenario oficial como compatible.

## Tablero físico: geometría versionada

La página 2 del [libro oficial de escenarios de GMT (2006)](https://www.gmtgames.com/cca/CCScenarioBook0906.pdf) muestra el tablero real: nueve filas alternas de 13 y 12 celdas, 113 hexágonos, orientación de filas desplazadas. El laboratorio usa odd-q (columnas desplazadas), 13 × 9 = 117 celdas. La diferencia afecta a vecinos, distancias, LOS, retiradas, posiciones de borde, sectores y representación. No basta con copiar las coordenadas del mapa. Se ha añadido la geometría versionada OFFICIAL_ODD_R_113 y propagado por el diario, movimiento, combate, retirada, LOS, sectores y SVG. Los diarios anteriores siguen usando odd-q. Se rechazan geometrías desconocidas y documentos marcados OFFICIAL con topología antigua; la configuración debe incluir el mapa de sectores exacto. En filas pares (base cero), los hexágonos de columnas 4 y 8 pertenecen a dos sectores. En filas impares, las fronteras coinciden con aristas, de modo que las columnas 0–3 son LEFT, 4–7 CENTER, 8–11 RIGHT. Fuente: página 2 del [libro de escenarios de GMT, 2.ª edición](https://www.gmtgames.com/living_rules/CC%20Scenario2ndEd-201.pdf). Falta regresión nativa y validación de una partida oficial completa.

## Inventario oficial base (pendiente de importación exacta)

Fuente: [índice de escenarios básicos](https://www.commandsandcolors.net/ancients/the-game/main/base-game-official-scenarios.html) y libro oficial de GMT. Este inventario es de referencias, no el catálogo jugable.

| N.º | Batalla | Estado |
|---|---|---|
| 001 | Akragas (406 a. C.) | Primer escenario para importación local: sin terreno ni reglas especiales, Siracusa comienza con 6 cartas, Cartago 5, objetivo 5 medallas; geometría habilitada, despliegue local pendiente de validación integral |
| 002 | Crimissos River (341 a. C.) | Pendiente |
| 003 | Bagradas (253 a. C.) | Pendiente |
| 004 | Ticinus River (218 a. C.) | Pendiente |
| 005 | Trebbia (218 a. C.) | Pendiente |
| 006 | Lake Trasimenus (217 a. C.) | Pendiente |
| 007 | Cannae (216 a. C.) | Pendiente |
| 008 | Dertosa (215 a. C.) | Pendiente |
| 009 | 2nd Beneventum (214 a. C.) | Pendiente; incluye cambio de tamaño de mano al alcanzar una puntuación |
| 010 | Castulo (211 a. C.) | Pendiente |
| 011 | Baecula (208 a. C.) | Pendiente |
| 012 | Metaurus (207 a. C.) | Pendiente |
| 013 | Ilipa (206 a. C.) | Pendiente |
| 014 | Great Plains (203 a. C.) | Pendiente |
| 015 | Zama (202 a. C.) | Pendiente |

Orden de trabajo: geometría y sectores implementados; preparar Akragas a partir de una copia local legítima, validar despliegue y partida completa; importar el resto de escenarios base según sus dependencias. Más adelante, expansiones y escenarios comunitarios con el mismo formato y filtros de catálogo. Un importador directo de formatos de terceros (p. ej. Vassal) será un adaptador separado, nunca un ejecutor de reglas arbitrarias.
