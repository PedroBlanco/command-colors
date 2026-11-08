/** Local, read-only test orchestrator. Never runs GitHub Actions, WSL or a deployment. */
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Run exactly the files in a trusted manifest, without invoking a shell. */
export async function runTestBatch({rootDir = ROOT, files, logFile = null,
  nodePath = process.execPath, forwardOutput = true} = {}) {
  if (!Array.isArray(files) || files.length === 0 ||
      files.some(file => typeof file !== 'string' || !/^[A-Za-z0-9_./-]+\.test\.mjs$/.test(file)
        || file.startsWith('/') || file.split('/').includes('..')) ||
      new Set(files).size !== files.length) throw new TypeError('INVALID_TEST_MANIFEST');
  let saved = null;
  if (logFile !== null) {
    if (typeof logFile !== 'string' || !logFile.trim()) throw new TypeError('INVALID_LOG_FILE');
    saved = resolve(rootDir, logFile);
    const rel = relative(resolve(rootDir), saved);
    if (rel === '' || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
      throw new TypeError('LOG_MUST_BE_INSIDE_PROJECT');
    }
    if (existsSync(saved)) throw Object.assign(new Error('LOG_ALREADY_EXISTS'), {code:'EEXIST'});
  }
  const missing = files.filter(file => !existsSync(resolve(rootDir, file)));
  if (missing.length) return {exitCode: 2, missing, suites: files.length, logFile: null};

  const command = [
    '--test', '--test-concurrency=2', '--test-reporter=tap', ...files
  ];
  const now = new Date().toISOString();
  const header = `# CCW local regression\n# started: ${now}\n# node: ${process.version}\n# root: ${resolve(rootDir)}\n# files: ${files.length}\n# command: node ${command.join(' ')}\n`;
  const output = [];
  const child = spawn(nodePath, command, {cwd: rootDir, shell: false,
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: {...process.env, NODE_TEST_CONTEXT: undefined}});
  for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.on('data', chunk => {
      if (forwardOutput) target.write(chunk);
      if (logFile !== null) output.push(Buffer.from(chunk));
    });
  }
  const exitCode = await new Promise((done, fail) => {
    child.once('error', fail);
    child.once('close', (code, signal) => done(code === null ? (signal ? 1 : 2) : code));
  });
  let sha256 = null;
  if (logFile !== null) {
    const footer = `\n# exitCode: ${exitCode}\n# finished: ${new Date().toISOString()}\n`;
    const bytes = Buffer.concat([Buffer.from(header), ...output, Buffer.from(footer)]);
    sha256 = createHash('sha256').update(bytes).digest('hex');
    await mkdir(dirname(saved), {recursive: true});
    await writeFile(saved, bytes, {flag: 'wx', mode: 0o600}); // never overwrite evidence
  }
  return {exitCode, suites: files.length, missing: [], logFile: saved, sha256};
}

/** Arguments are limited to a fixed allowlisted suite manifest; no user command execution. */
export function selectTests(manifest, only = null) {
  if (!Array.isArray(manifest) || new Set(manifest).size !== manifest.length) throw new TypeError('INVALID_TEST_MANIFEST');
  if (only === null) return [...manifest];
  if (typeof only !== 'string' || !only.trim()) throw new TypeError('INVALID_SELECTION');
  const names = only.split(',');
  if (names.some(name => !manifest.includes(name)) || new Set(names).size !== names.length) {
    throw new TypeError('UNKNOWN_OR_DUPLICATE_TEST');
  }
  return names;
}

export function parseArgs(args) {
  const options = {only: null, logFile: null, list: false};
  for (const arg of args) {
    if (arg === '--list' && !options.list) options.list = true;
    else if (arg.startsWith('--only=') && options.only === null) options.only = arg.slice(7);
    else if (arg.startsWith('--log=') && options.logFile === null) options.logFile = arg.slice(6);
    else throw new TypeError(`INVALID_OPTION: ${arg}`);
  }
  return options;
}

async function main(args) {
  const {LOCAL_TEST_FILES} = await import('./check-browser-lab.mjs');
  const {only, logFile, list} = parseArgs(args);
  const files = selectTests(LOCAL_TEST_FILES, only);
  if (list) {for (const file of files) console.log(file); return 0;}
  const result = await runTestBatch({rootDir: ROOT, files, logFile});
  if (result.missing.length) console.error(`Faltan ${result.missing.length} archivos de pruebas: ${result.missing.join(', ')}`);
  console.log(`CCW: ${result.suites} suites; salida=${result.exitCode}`);
  if (result.logFile) console.log(`Evidencia: ${result.logFile} SHA-256: ${result.sha256}`);
  return result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then(code => {process.exitCode = code;})
    .catch(error => {console.error(error.message); process.exitCode = 2;});
}
