/** Experimental SQLite-backed composition; no listener, no UI, no deployment. */
import {openSqliteComposition} from '../sqlite-store/sqlite.mjs';
import {createAccessGateway} from './gateway.mjs';

export function createSqliteTestComposition(options) {
  const services = openSqliteComposition(options);
  return Object.freeze({
    ...services,
    createServer: () => createAccessGateway(services)
  });
}
