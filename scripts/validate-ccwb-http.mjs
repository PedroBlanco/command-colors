/**
 * CCWB security regression launcher for native Node.js >=22.16 on Windows
 * and Linux. Runs a fixed manifest only; no Docker, WSL, Actions or server.
 */
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {LOCAL_TEST_FILES} from './check-browser-lab.mjs';
import {runTestBatch, auditLocalTestManifest} from './run-test-suite.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CCWB_SECURITY_SUITES = Object.freeze([
  'packages/local-api/section-history-http-isolation.test.mjs',
  'packages/local-api/browser-sqlite-smoke.test.mjs',
  'packages/local-api/command-deck-sse.test.mjs',
  'packages/local-api/revision-stream-lab-isolation.test.mjs',
  'packages/sqlite-store/sqlite.test.mjs',
  'packages/sqlite-store/ancients-section-history.test.mjs',
  'packages/sqlite-store/wal-transaction-contract.test.mjs',
  'packages/sqlite-store/wal-cross-process-revocation.test.mjs',
  'packages/sqlite-store/section-mutation-session-guard.test.mjs',
  'packages/command-deck/sqlite-game.test.mjs',
  'packages/ancients-rules/sqlite-section-ccwb-bridge.test.mjs',
  'packages/ancients-rules/staged-movement-preflight.test.mjs'
]);

export function validNodeVersion(version) {
  if (typeof version !== 'string') return false;
  const match = /^([0-9]+)[.]([0-9]+)[.][0-9]+$/.exec(version);
  if (!match) return false;
  const major = Number(match[1]), minor = Number(match[2]);
  return major > 22 || (major === 22 && minor >= 16);
}

export function parseValidationOptions(args = []) {
  if (!Array.isArray(args)) throw new TypeError('INVALID_OPTIONS');
  let fullRegression = false, list = false;
  for (const arg of args) {
    if (arg === '--full' && !fullRegression) fullRegression = true;
    else if (arg === '--list' && !list) list = true;
    else throw new TypeError('INVALID_OPTION');
  }
  if (fullRegression && list) throw new TypeError('INVALID_OPTION_COMBINATION');
  return {fullRegression,list};
}

export function assertSecurityManifest(manifest = LOCAL_TEST_FILES) {
  if (!Array.isArray(manifest) || new Set(manifest).size !== manifest.length)
    throw new TypeError('INVALID_TEST_MANIFEST');
  const missing = CCWB_SECURITY_SUITES.filter(file => !manifest.includes(file));
  if (missing.length) throw new TypeError('SECURITY_SUITE_NOT_IN_MANIFEST: '+missing.join(','));
  if (new Set(CCWB_SECURITY_SUITES).size !== CCWB_SECURITY_SUITES.length)
    throw new TypeError('DUPLICATE_SECURITY_SUITE');
  return [...CCWB_SECURITY_SUITES];
}

function reportName(type, date, pid) {
  if (!(date instanceof Date) || !Number.isFinite(date.valueOf())
      || !Number.isSafeInteger(pid) || pid < 1) throw new TypeError('INVALID_REPORT_ID');
  const stamp = date.toISOString().replace(/[-:]/g,'').replace('T','-').replace('Z','');
  return `.local-test-reports/ccwb-${type}-${stamp}-${pid}.tap`;
}

/**
 * The batch runner owns the TAP files and SHA-256; never invent a successful
 * report. Full regression starts only after every security suite passes.
 * runBatch/now injection is for deterministic, no-subprocess unit tests.
 */
export async function validateCcwHttp({fullRegression=false, rootDir=ROOT,
  manifest=LOCAL_TEST_FILES, runBatch=runTestBatch,
  auditManifest=auditLocalTestManifest, version=process.versions.node,
  now=()=>new Date(), pid=process.pid} = {}) {
  if (!validNodeVersion(version)) return {exitCode:2, reason:'NODE_22_16_REQUIRED', results:[]};
  const securityFiles = assertSecurityManifest(manifest);
  const inventory = auditManifest(rootDir,manifest);
  if (!inventory.ok) return {exitCode:2,reason:'TEST_MANIFEST_DRIFT',inventory,results:[]};
  const date=now(), results=[];
  const priority=await runBatch({
    rootDir,files:securityFiles,logFile:reportName('security',date,pid)
  });
  results.push({type:'security',...priority});
  if (priority.exitCode !== 0 || (priority.missing?.length ?? 0) !== 0)
    return {exitCode:priority.exitCode || 2,results};
  if (fullRegression) {
    const full=await runBatch({
      rootDir,files:[...manifest],logFile:reportName('full',date,pid)
    });
    results.push({type:'full',...full});
    if (full.exitCode !== 0 || (full.missing?.length ?? 0) !== 0)
      return {exitCode:full.exitCode || 2,results};
  }
  return {exitCode:0,results};
}

async function main(args) {
  const {fullRegression,list}=parseValidationOptions(args);
  const selection=assertSecurityManifest();
  if (list) {
    for(const file of selection) console.log(file);
    return 0;
  }
  const result=await validateCcwHttp({fullRegression});
  if (result.reason) console.error(result.reason);
  if (result.inventory && !result.inventory.ok) {
    if (result.inventory.missing.length) console.error('Faltan suites: '+result.inventory.missing.join(', '));
    if (result.inventory.unregistered.length) console.error('Suites sin registrar: '+result.inventory.unregistered.join(', '));
  }
  for(const run of result.results) {
    console.log(`CCWB ${run.type}: ${run.suites} suites; salida=${run.exitCode}`);
    if (run.missing?.length) console.error('Faltan archivos: '+run.missing.join(', '));
    if (run.logFile) console.log(`Informe ${run.logFile}; SHA-256 ${run.sha256}`);
  }
  return result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then(code => {process.exitCode=code;})
    .catch(error => {console.error(error.message);process.exitCode=2;});
}
