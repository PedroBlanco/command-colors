# I2 — Sesiones de navegador para laboratorio local (CCW-007 y CCW-009)

**Incremento de pruebas, no aplicación de producción.** La pasarela puede funcionar en dos modalidades: la interfaz antigua de pruebas HTTP con `Authorization: Bearer` (sin cambios), y una nueva modalidad **solo de navegador** con cookies HttpOnly y comprobaciones de origen. No se ha fusionado la PR del tablero SVG ni se ha implementado el reglamento de *Ancients*.

## Primera prueba autónoma en Windows 11

Requiere Node.js 22.16.0 o posterior compatible con el módulo experimental `node:sqlite`. Desde PowerShell, situarse en la rama de laboratorio que contiene esta documentación:

```powershell
node --test packages/local-api/browser-session.test.mjs packages/local-api/browser-gateway.test.mjs
node scripts/browser-lab.mjs
```

La **primera ejecución**, si no existe `.local-data/browser-lab.sqlite`, crea **solamente dos cuentas ficticias** (`alice` y `bob`) con contraseñas aleatorias que aparecen una sola vez en PowerShell. Deben guardarse para futuras pruebas. No se crean cuentas desde la web, no se usan datos personales ni credenciales reales, y la base se guarda exclusivamente en `.local-data/`, ignorada por Git.

Abrir `http://127.0.0.1:8788` en dos **perfiles de navegador diferentes**, por ejemplo una ventana normal y otra privada. Dos pestañas de un mismo perfil **comparten la misma cookie** y por tanto no representan dos jugadores diferentes.

1. Iniciar sesión con `alice` en el primer perfil y `bob` en el segundo.
2. `alice` crea una partida y copia el identificador; invita al identificador `bob` y comparte el token de invitación de prueba.
3. `bob` pega el token, acepta y consulta la partida. `alice` puede actualizarla con su identificador.
4. Comparar las manos privadas y los números de cartas. El botón de turno es **ficticio** y no aplica reglas de juego.
5. Cerrar sesión y comprobar que el acceso privado queda denegado. Detener el proceso con `Ctrl+C`.

Si se pierden las credenciales, detener el proceso y eliminar **únicamente la base sintética de pruebas** y sus archivos auxiliares para reinicializar las cuentas. No borrar jamás bases de datos con información real.

## Protección implementada en este experimento

- En modalidad web, las credenciales se almacenan exclusivamente en una cookie `HttpOnly`, `SameSite=Strict`, `Path=/`, con caducidad acotada en base de datos. El token no aparece en el JSON de la respuesta ni se almacena en `localStorage`.
- El inicio de sesión, cierre de sesión y todos los cambios requieren cabecera `Origin` exactamente igual al origen autorizado y `X-CCW-Request: 1`. Se rechaza `Sec-Fetch-Site: cross-site`; no se habilita CORS para terceros.
- En **HTTPS** el nombre es `__Host-ccw_session` y la cookie lleva `Secure`. En **HTTP para laboratorio**, el nombre cambia a `ccw_lab_session` y **no lleva Secure**. Esta excepción requiere la opción explícita `insecureLoopback:true`, origen `http://127.0.0.1:PUERTO` y peticiones desde loopback; **nunca debe utilizarse en una red pública**.
- Una petición en modo navegador no acepta `Authorization: Bearer`; la identidad procede de la sesión del servidor. La API continúa derivando el actor A/B de los participantes registrados y no del JSON del cliente.
- Las respuestas API llevan `Cache-Control: no-store`. La página tiene CSP y se sirven solamente los archivos de interfaz previstos.
- Login administrativo por consola en el primer arranque; no existe endpoint público para dar de alta cuentas.

## Pruebas automáticas

```powershell
node --test packages/local-api/browser-session.test.mjs packages/local-api/browser-gateway.test.mjs
.\scripts\test-local.ps1
```

La nueva batería de 13 pruebas comprueba cookies, rechazo de origen y CSRF, protección contra suplantación, aislamiento de manos, acceso de terceros y cierre de sesión; las pruebas HTTP usan servicios sintéticos simulados para controlar las respuestas y se ejecutan solo en `127.0.0.1`.

**Pendiente:** repetir la prueba completa sobre navegador físico y con SQLite real en esta rama; efectuar análisis de amenazas, auditoría de dependencias, protección contra intentos de acceso, cookies HTTPS reales, expiración/rotación, registro y recuperación de cuentas, uso de PostgreSQL si procede, pruebas de accesibilidad y control de errores de la interfaz.

## Límites

Este lanzamiento HTTP local usa **cookies sin Secure**, por lo que es inseguro si se expone fuera de este equipo. No utilizar contraseñas personales ni jugadores reales. El sistema no es todavía un servicio web multijugador de producción y sigue sin lógica de escenarios, cartas oficiales, movimientos ni combates. La interfaz SVG de la PR #27 se validará de manera independiente cuando el propietario pueda probarla.
