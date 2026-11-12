/** Local, read-only test orchestrator. Never runs GitHub Actions, WSL or a deployment. */
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, realpathSync, readdirSync, lstatSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Reject lexical escapes and existing parent symlinks outside the project. */
export function validateLogFileTarget(rootDir, logFile) {
  if (typeof logFile !== 'string' || !logFile.trim()) throw new TypeError('INVALID_LOG_FILE');
  const root = resolve(rootDir);
  const target = resolve(root, logFile);
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new TypeError('LOG_MUST_BE_INSIDE_PROJECT');
  }
  let parent = dirname(target);
  while (!existsSync(parent)) {
    const next = dirname(parent);
    if (next === parent) throw new TypeError('LOG_MUST_BE_INSIDE_PROJECT');
    parent = next;
  }
  const actualParent = realpathSync(parent);
  const actualRoot = realpathSync(root);
  const relParent = relative(actualRoot, actualParent);
  if (relParent === '..' || relParent.startsWith('..' + sep) || isAbsolute(relParent)) {
    throw new TypeError('LOG_MUST_BE_INSIDE_PROJECT');
  }
  return target;
}

/**
 * Compare the fixed manifest with every native test in the three repository
 * roots. An unregistered suite must never be silently omitted from a passing
 * full regression. This is read-only; do not follow symlinks outside the tree.
 */
export function auditLocalTestManifest(rootDir, manifest) {
  if (!Array.isArray(manifest) || new Set(manifest).size !== manifest.length ||
      manifest.some(file => typeof file !== 'string' ||
        !/^[A-Za-z0-9_./-]+[.]test[.]mjs$/.test(file) ||
        file.startsWith('/') || file.split('/').includes('..')))
    throw new TypeError('INVALID_TEST_MANIFEST');
  const observed=[];
  function visit(absolute, relativePath) {
    for (const entry of readdirSync(absolute, {withFileTypes:true})) {
      // Do not follow symbolic links, including directory junctions.
      if (entry.isSymbolicLink()) continue;
      const path = relativePath + '/' + entry.name;
      const file = resolve(absolute,entry.name);
      if (entry.isDirectory()) visit(file,path);
      else if (entry.isFile() && entry.name.endsWith('.test.mjs'))
        observed.push(path);
    }
  }
  for (const root of ['packages','scripts','spikes']) {
    const folder=resolve(rootDir,root);
    if (existsSync(folder) && lstatSync(folder).isDirectory()) visit(folder,root);
  }
  observed.sort();
  const declared=new Set(manifest), actual=new Set(observed);
  const missing=manifest.filter(file=>!actual.has(file)).sort();
  const unregistered=observed.filter(file=>!declared.has(file));
  return {ok:missing.length===0&&unregistered.length===0,
    discovered:observed.length, declared:manifest.length, missing, unregistered};
}

export function requireCompleteTestManifest(rootDir, manifest) {
  const result=auditLocalTestManifest(rootDir,manifest);
  if (!result.ok)
    throw new Error('TEST_MANIFEST_DRIFT: missing='+result.missing.join(',')+
      '; unregistered='+result.unregistered.join(','));
  return result;
}

/** Run exactly the files in a trusted manifest, without invoking a shell. */
export async function runTestBatch({rootDir = ROOT, files, logFile = null,
  nodePath = process.execPath, forwardOutput = true} = {}) {
  if (!Array.isArray(files) || files.length === 0 ||
      files.some(file => typeof file !== 'string' || !/^[A-Za-z0-9_./-]+\.test\.mjs$/.test(file)
        || file.startsWith('/') || file.split('/').includes('..')) ||
      new Set(files).size !== files.length) throw new TypeError('INVALID_TEST_MANIFEST');
  let saved = null;
  if (logFile !== null) {
    saved = validateLogFileTarget(rootDir, logFile);
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
  requireCompleteTestManifest(ROOT, LOCAL_TEST_FILES);
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
