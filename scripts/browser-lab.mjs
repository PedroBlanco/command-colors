/** Loopback-only browser demonstrator; test accounts and data only. Not for deployment. */
import {existsSync, mkdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {openSqliteComposition} from '../packages/sqlite-store/sqlite.mjs';
import {createAccessGateway} from '../packages/local-api/gateway.mjs';

const port = Number(process.env.CCW_LAB_PORT || 8788);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
  throw new Error('CCW_LAB_PORT must be between 1024 and 65535');
}
const file = resolve(process.argv[2] || '.local-data/browser-lab.sqlite');
const origin = `http://127.0.0.1:${port}`;
let services = null;
let gateway = null;
let stopping = false;

// Reserve the listening port BEFORE creating the SQLite file or provisioning accounts.
// During initialization return an explicit 503; no credentials or state are exposed.
const app = createServer((req, res) => {
  if (!gateway) {
    res.writeHead(503, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
    res.end(JSON.stringify({code: 'LAB_INITIALIZING'}));
    return;
  }
  gateway.emit('request', req, res);
});

function stop() {
  if (stopping) return;
  stopping = true;
  app.close(() => {services?.close();});
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
app.once('error', error => {
  console.error('Error al iniciar el laboratorio:', error.message);
  // No SQLite database is created if the port could not be bound.
  if (!stopping) stop();
  process.exitCode = 1;
});

app.listen(port, '127.0.0.1', async () => {
  try {
    mkdirSync(dirname(file), {recursive: true});
    const isNew = !existsSync(file);
    services = openSqliteComposition({file});
    const temporaryCredentials = [];
    if (isNew) {
      for (const handle of ['alice', 'bob']) {
        const password = randomBytes(24).toString('base64url');
        const result = await services.identity.provisionAccount({handle, password});
        if (!result.ok) throw new Error('No se ha podido aprovisionar la cuenta ficticia');
        temporaryCredentials.push({handle, password});
      }
    }
    if (stopping) return;
    gateway = createAccessGateway({...services, browser: {origin, insecureLoopback: true}});
    // Credentials are shown only after the server has successfully bound its port.
    for (const {handle, password} of temporaryCredentials) {
      console.log(`Cuenta de prueba ${handle}: ${password}`);
    }
    if (temporaryCredentials.length) {
      console.log('Guarda estas contraseñas de prueba: solamente se muestran en esta primera ejecución.');
    }
    console.log(`Laboratorio del navegador: ${origin}`);
    console.log('Solo acceso local. NO PUBLICAR ni abrir a red local. Ctrl+C para terminar.');
    console.log('Abre dos perfiles de navegador distintos: los tabs del mismo perfil comparten sesión.');
  } catch (error) {
    console.error('No se ha podido preparar el laboratorio:', error.message);
    process.exitCode = 1;
    stop();
  }
});
