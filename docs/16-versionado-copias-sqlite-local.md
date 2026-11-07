# I2 — Esquema versionado, copia y restauración de laboratorio SQLite

**Alcance:** desarrollo local, exclusivamente con datos sintéticos. No es una política de continuidad ni un respaldo de producción. Mantener fuera de redes externas; la base de datos y sus copias contienen información privada (manos, mazo y sesiones) en texto sin cifrar o tokens derivados. No subir archivos SQLite a GitHub.

## Objetivo y cambios

1. `packages/sqlite-store/schema-version.mjs` establece la **versión base 1** del esquema local y una identificación de aplicación (`PRAGMA application_id`). En cada apertura inspecciona las seis tablas y sus columnas; rechaza esquemas de otra aplicación, estructuras desconocidas y versiones posteriores.
2. Si la base anterior es exactamente el esquema del laboratorio sin `PRAGMA user_version`, se admite **una única migración de metadatos 0→1**, sin alterar las filas. No hay migraciones de estructura a versiones 2+ ni soporte de downgrade. Es necesaria una copia antes de modificar una base de trabajo y una futura revisión de índices/constraints antes de producción.
3. `packages/sqlite-store/backup.mjs` crea un respaldo consistente con la API de copia de seguridad de SQLite, compatible con **WAL**. Después convierte **solo la copia** al modo de diario DELETE para obtener un archivo autónomo, sin `-wal` ni `-shm` residuales; la base original sigue en WAL. No se copian directamente archivos `.sqlite` activos.
4. Cada respaldo viene con `*.manifest.json` (tamaño y SHA-256). La verificación comprueba contenido, identificación de aplicación, versión del esquema, `PRAGMA integrity_check` y `PRAGMA foreign_key_check`.
5. La restauración **solo acepta un destino inexistente**, verifica el original y la copia y no sobreescribe bases existentes. Realizarla con todas las conexiones de la aplicación cerradas; iniciar después el servidor local sobre la nueva ruta.
6. Estos controles detectan daños **accidentales**; SHA-256 en un manifiesto no autentica frente a un atacante que pueda modificar tanto la copia como su manifiesto. En un despliegue real se requerirán cifrado, control de acceso, política de retención, copias externas y restauraciones periódicas.

## Ejecutar en Windows 11 (PowerShell)

Requiere **Node.js 22.16.0 o superior** que incluya `node:sqlite` (experimental en la línea probada). Desde la raíz del repositorio y con el servidor del laboratorio detenido:

```powershell
# 1. Copia coherente del archivo existente; ambos destinos deben ser nuevos
node scripts/sqlite-maintenance.mjs backup .\datos\laboratorio.sqlite .\copias\laboratorio-2026-11-06.sqlite

# 2. Verificar archivo y manifiesto; ninguno debe haberse modificado
node scripts/sqlite-maintenance.mjs verify .\copias\laboratorio-2026-11-06.sqlite

# 3. Restaurar en ruta NUEVA, sin sustituir el archivo original
node scripts/sqlite-maintenance.mjs restore .\copias\laboratorio-2026-11-06.sqlite .\datos\restaurado.sqlite
```

Nunca copiar una base en WAL con `Copy-Item` mientras esté activa; usar el subcomando `backup`. La copia podrá realizarse con la base abierta si el módulo de mantenimiento puede acceder a ella, pero **para restaurar se exige parada**. El comando falla sin sobreescribir si el destino existe (incluidos restos `-wal`/`-shm` en la restauración).

Tras restaurar, verificar con la aplicación en **otro proceso** que se conservan partidas, revisiones, cartas privadas y eventos, y que las autorizaciones funcionan como antes. No se incluye aún automatización periódica, recuperación de contraseñas ni copia de la configuración externa del servidor.

## Pruebas automatizadas

```powershell
node --test packages/sqlite-store/lifecycle.test.mjs
# O ejecutar todo el laboratorio si ya se han incorporado las PR dependientes:
.\scripts\test-local.ps1
```

Las pruebas crean bases y copias **sintéticas** en el directorio temporal de cada ejecución, limpian sus restos y no utilizan servicios remotos. Casos: esquema nuevo, adopción de la versión previa, rechazo de DB desconocida/futura, backup WAL, no sobreescritura, alteración del archivo, integridad referencial, restauración desde un proceso nuevo y flujo CLI completo.

## Estado y decisiones posteriores

- La PR de este incremento se **apila sobre #32**, que depende a su vez de #31. No fusionar de manera duplicada las PR #28–#31.
- El proyecto no ha adoptado SQLite como almacenamiento de producción. PostgreSQL sigue siendo alternativa pendiente de valoración; estas herramientas son específicas del laboratorio SQLite.
- Mantener CCW-008 abierta: faltan migraciones y recuperación de la plataforma definitiva, respaldos seguros externos, pruebas de restauración de todo el servicio, gestión de sesiones e invitaciones reales y monitorización.
- La PR #27 de la interfaz gráfica sigue a la espera de validación humana, según lo indicado por el propietario.

## Verificación estructural estricta de la versión v1 (revisión de regresión)

Durante la auditoría se detectó que una base con seis tablas de nombres y columnas correctos, pero **sin restricciones**, podía registrarse como esquema v1. Esa verificación era insuficiente para garantizar que las transacciones conservasen la integridad esperada.

Se ha corregido centralizando el DDL canónico en `packages/sqlite-store/schema-version.mjs`. Al abrir una base, adoptar la estructura antigua o verificar un respaldo se comprueban ahora las definiciones completas de tablas e índices, incluidas claves primarias, relaciones, unicidad y expresiones `CHECK`. Se rechazan índices ausentes, vistas o disparadores no previstos y cambios semánticos en literales SQL. La comparación de texto SQL es **deliberadamente estricta** para este esquema v1 de laboratorio; cambios legítimos futuros requerirán una migración versionada y aprobada.

Se añadieron cinco pruebas de regresión en `packages/sqlite-store/schema-integrity.test.mjs`. Una base incompatible **no se repara ni se migra automáticamente**: debe analizarse su origen y utilizarse una copia verificada o una migración específica. Esta comprobación mejora la integridad; no constituye autenticación criptográfica de una base manipulada por un atacante.
