/** Diagnóstico no destructivo del laboratorio CCW I2. No abre ni modifica ninguna base SQLite. */
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, dirname, join} from 'node:path';
import {createServer} from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LOCAL_TEST_FILES = Object.freeze([
  'packages/hex-grid/hex.test.mjs', 'spikes/004/server.test.mjs',
  'packages/access-control/access.test.mjs', 'packages/match-store/store.test.mjs',
  'packages/local-api/gateway.test.mjs', 'packages/local-api/compose.test.mjs',
  'packages/sqlite-store/sqlite.test.mjs', 'packages/local-api/sqlite-compose.test.mjs',
  'packages/sqlite-store/lifecycle.test.mjs', 'packages/sqlite-store/schema-integrity.test.mjs',
  'packages/local-api/browser-session.test.mjs',
  'packages/local-api/browser-gateway.test.mjs',
  'packages/local-api/browser-sqlite-smoke.test.mjs',
  'scripts/check-browser-lab.test.mjs',
  'scripts/browser-lab.launcher.test.mjs',
  'packages/local-api/revision-stream.test.mjs',
  'packages/local-api/browser-ui.test.mjs',
  'packages/turn-phase/phase.test.mjs',
  'packages/command-deck/deck.test.mjs',
  'packages/command-deck/sqlite-game.test.mjs',
  'packages/local-api/command-deck-http.test.mjs',
  'packages/local-api/command-deck-cookie.test.mjs',
  'packages/local-api/deck-controls.test.mjs',
  'packages/local-api/browser-deck-ui.test.mjs',
  'packages/local-api/command-deck-sse.test.mjs',
  'packages/local-api/section-history-http-isolation.test.mjs',
  'packages/local-api/revision-stream-lab-isolation.test.mjs',
  'packages/dice-roller/dice.test.mjs',
  'packages/order-validator/validator.test.mjs',
  'packages/order-validator/server-context.test.mjs',
  'packages/movement/movement.test.mjs',
  'packages/movement/server-policy.test.mjs',
  'packages/command-deck/movement-sqlite.test.mjs',
  'packages/local-api/movement-revision-sse.test.mjs',
  'packages/local-api/movement-controls.test.mjs',
  'packages/local-api/hex-selection.test.mjs',
  'packages/local-api/movement-board-ui.test.mjs',
  'packages/local-api/private-view-scope.test.mjs',
  'packages/local-api/private-projection.test.mjs',
  'packages/local-api/revision-refresh.test.mjs',
  'packages/ancients-rules/movement-profile.test.mjs',
  'packages/ancients-rules/movement-path-precheck.test.mjs',
  'packages/ancients-rules/terrain-movement.test.mjs',
  'packages/ancients-rules/terrain-integration.test.mjs',
  'packages/ancients-rules/terrain-dice-cap.test.mjs',
  'packages/ancients-rules/line-of-sight.test.mjs',
  'packages/ancients-rules/ranged-profile.test.mjs',
  'packages/ancients-rules/ranged-precheck.test.mjs',
  'packages/ancients-rules/combat-turn-guard.test.mjs',
  'packages/ancients-rules/ranged-turn-precheck.test.mjs',
  'packages/ancients-rules/sqlite-reservation-lab.test.mjs',
  'packages/ancients-rules/sqlite-guarded-reservation.test.mjs',
  'packages/ancients-rules/sqlite-dice-staging.test.mjs',
  'packages/ancients-rules/battle-dice.test.mjs',
  'packages/ancients-rules/dice-plan.test.mjs',
  'packages/ancients-rules/sqlite-official-dice-preview.test.mjs',
  'packages/ancients-rules/block-loss-preview.test.mjs',
  'packages/ancients-rules/sqlite-block-loss-preview.test.mjs',
  'packages/ancients-rules/ranged-resolution-sequence.test.mjs',
  'packages/ancients-rules/ranged-hit-commit-preflight.test.mjs',
  'packages/ancients-rules/section-card-order-screen.test.mjs',
  'packages/ancients-rules/section-history-journal.test.mjs',
  'packages/ancients-rules/sqlite-section-history-lab.test.mjs',
  'packages/ancients-rules/staged-movement-preflight.test.mjs',
  'packages/ancients-rules/leader-movement-preflight.test.mjs',
  'packages/ancients-rules/leader-unit-sequence-preflight.test.mjs',
  'packages/ancients-rules/movement-draft-contract.test.mjs',
  'packages/ancients-rules/lab-command-signature.test.mjs',
  'packages/ancients-rules/lab-idempotency-binding.test.mjs',
  'packages/ancients-rules/sqlite-section-ccwb-bridge.test.mjs',
  'packages/sqlite-store/wal-transaction-contract.test.mjs',
  'packages/sqlite-store/wal-cross-process-revocation.test.mjs',
  'packages/sqlite-store/section-mutation-session-guard.test.mjs',
  'packages/sqlite-store/ancients-section-history.test.mjs'
]);
const tests = LOCAL_TEST_FILES;

function nodeSupported() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 16);
}

async function portFree(port) {
  const probe = createServer();
  return await new Promise(resolve => {
    let done = false;
    const finish = result => {
      if (done) return;
      done = true;
      if (probe.listening) probe.close(() => resolve(result));
      else resolve(result);
    };
    probe.once('error', () => finish(false));
    probe.listen(port, '127.0.0.1', () => finish(true));
  });
}

export async function checkLocalLab({rootDir = root, portValue = process.env.CCW_LAB_PORT ?? '8788',
  checkPort = portFree, sqliteCheck = true} = {}) {
  const failures = [], warnings = [];
  if (!nodeSupported()) failures.push(`Node.js ${process.version}: se requiere 22.16.0 o superior`);
  if (sqliteCheck) {
    try {
      const mod = await import('node:sqlite');
      if (typeof mod.DatabaseSync !== 'function' || typeof mod.backup !== 'function') {
        failures.push('node:sqlite no dispone de DatabaseSync y backup');
      }
    } catch {
      failures.push('Este Node.js no dispone del módulo node:sqlite requerido');
    }
  }
  const missing = tests.filter(path => !existsSync(join(rootDir, path)));
  if (missing.length) failures.push(`Faltan ${missing.length} archivos de pruebas en esta rama: ${missing.join(', ')}`);
  const port = Number(portValue);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    failures.push('CCW_LAB_PORT debe ser un puerto válido entre 1024 y 65535');
  } else if (!(await checkPort(port))) {
    failures.push(`Puerto local 127.0.0.1:${port} ocupado; detener el proceso anterior o cambiar CCW_LAB_PORT`);
  }
  const dataPath = join(rootDir, '.local-data', 'browser-lab.sqlite');
  if (existsSync(dataPath)) warnings.push('Ya existe la base sintética: no se regenerarán las contraseñas y no se modificarán datos');
  else warnings.push('No existe base local: el lanzador creará cuentas ficticias y mostrará credenciales aleatorias una sola vez');
  return {ok: failures.length === 0, failures, warnings, tests: tests.length, port: Number.isFinite(port) ? port : null};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkLocalLab();
  console.log(`Command & Colors — diagnóstico local (${process.version})`);
  for (const issue of result.failures) console.error(`ERROR: ${issue}`);
  for (const warning of result.warnings) console.log(`AVISO: ${warning}`);
  if (result.ok) console.log(`Correcto. ${result.tests} suites presentes. Ejecuta .\\scripts\\test-local.ps1 antes de abrir el laboratorio.`);
  process.exitCode = result.ok ? 0 : 1;
}
