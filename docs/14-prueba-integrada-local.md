# I2 — Integración local de contratos (CCW-007, CCW-008, CCW-009)

**Estado:** integración funcional **solo en memoria**, con usuarios, invitaciones y estados sintéticos. No se ha implantado todavía una aplicación con registro web ni una base de datos duradera. No exponer a Internet ni a la LAN.

## Qué se integra

El módulo `packages/local-api/compose.mjs` utiliza **las implementaciones reales** de:
- `packages/access-control/identity.mjs` y `invitations.mjs` (PR #29).
- `packages/match-store/store.mjs` (PR #28).
- `packages/local-api/gateway.mjs` (PR #30).

El módulo no inicia por su cuenta un servidor ni tiene ruta administrativa pública. Las pruebas aprovisionan cuentas sintéticas en el proceso, levantan un HTTP efímero solo sobre `127.0.0.1`, ejecutan el ciclo real de invitación y apagan el servidor. No se crea una contraseña por defecto en la aplicación.

## Cobertura añadida (5 pruebas de integración reales)

1. Dos cuentas se autentican, una crea una partida, invita a la otra y las vistas mantienen privada la mano y el mazo; un tercero recibe 404.
2. Se ignora un `actor` falso aportado por el cliente; las revisiones, errores de conflicto e idempotencia se respetan y no se filtran cartas.
3. Dos comandos simultáneos sobre la misma revisión producen un único cambio de estado.
4. Dos partidas distintas mantienen revisiones y eventos independientes, incluso cuando los participantes son los mismos.
5. La expiración de sesión impide consultar una partida anteriormente autorizada.

Cada comando del sistema de prueba es `pass_demo_turn`: no valida movimientos ni resuelve combates de Ancients. La falta de autenticación real en navegador y de almacenamiento persistente sigue siendo un bloqueo para producción.

## Pruebas locales sin WSL ni Actions

Con Node.js 22 o posterior y PowerShell, desde la raíz del repositorio:

```powershell
.\scripts\test-local.ps1
```

El script ejecuta las pruebas de geometría, servidor ficticio, acceso, almacenamiento, pasarela HTTP y composición, sin instalar dependencias. Requiere que todas las fuentes de las PR #28, #29 y #30 estén presentes, razón por la que se ha creado una **rama consolidada de laboratorio**, independiente de `main`. La PR #27 del tablero continúa separada.

## Fronteras de seguridad y persistencia

- La composición **no** guarda usuarios, sesiones, invitaciones ni estados entre reinicios.
- El `getStore(matchId)` genera un almacén diferente por UUID y asocia su identificador; es de un solo proceso.
- La API sigue usando tokens bearer solo en las pruebas HTTP de loopback; faltan HTTPS, cookies seguras, CSRF, limitación de intentos y prevención del abuso.
- Queda pendiente una transacción de base de datos que abarque creación de partida, plaza B, orden, revisión, estado y eventos.
- Las pruebas no equivalen a una revisión de seguridad ni a una aceptación en navegador o móvil.
- La carpeta `database/postgresql/` contiene únicamente una propuesta de esquema **no ejecutada**.

## Estrategia de integración en GitHub

Se conservan sin fusionar las PR #27, #28, #29 y #30. La rama consolidada de esta prueba es una **candidata para revisión**, que reutiliza sus blobs tal como fueron publicados. Cuando se autorice la integración habrá que evitar fusiones duplicadas (elegir consolidación o PR individuales, revisar diferencias finales y cerrar correctamente las redundantes). `main` no se altera en este trabajo.

## Próximas tareas

Priorizar persistencia transaccional real, pruebas de reinicio y aislamiento entre procesos; luego sesiones HTTPS seguras e invitaciones accesibles por navegador. La validación visual de #27 se realizará cuando el propietario disponga de tiempo.
