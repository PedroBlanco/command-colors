/** Loopback-only browser demonstrator; test accounts and data only. Not for deployment. */
import {existsSync, mkdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {openSqliteComposition} from '../packages/sqlite-store/sqlite.mjs';
import {createAccessGateway} from '../packages/local-api/gateway.mjs';

const port=Number(process.env.CCW_LAB_PORT || 8788);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
  throw new Error('CCW_LAB_PORT must be between 1024 and 65535');
}
const file=resolve(process.argv[2] || '.local-data/browser-lab.sqlite');
mkdirSync(dirname(file), {recursive:true});
const isNew=!existsSync(file);
const services=openSqliteComposition({file});
try {
  if (isNew) {
    for(const handle of ['alice','bob']) {
      const password=randomBytes(24).toString('base64url');
      const result=await services.identity.provisionAccount({handle,password});
      if(!result.ok)throw new Error('No se ha podido aprovisionar la cuenta ficticia');
      console.log(`Cuenta de prueba ${handle}: ${password}`);
    }
    console.log('Guarda estas contraseñas de prueba: solamente se muestran en esta primera ejecución.');
  }
  const origin=`http://127.0.0.1:${port}`;
  const app=createAccessGateway({...services,browser:{origin,insecureLoopback:true}});
  const stop=()=>{app.close(()=>{services.close();});};
  process.on('SIGINT',stop);
  process.on('SIGTERM',stop);
  app.once('error',error=>{console.error('Error al iniciar el laboratorio:',error.message);services.close();process.exitCode=1;});
  app.listen(port,'127.0.0.1',()=>{
    console.log(`Laboratorio del navegador: ${origin}`);
    console.log('Solo acceso local. NO PUBLICAR ni abrir a red local. Ctrl+C para terminar.');
    console.log('Abre dos perfiles de navegador distintos: los tabs del mismo perfil comparten sesión.');
  });
} catch (error) {services.close();throw error;}
