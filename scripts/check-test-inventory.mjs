/** Read-only verification that the canonical manifest includes every native test suite.
 * Works with Node.js 22.16+, on Windows/Unix, without Actions, WSL or dependencies.
 */
import {readdirSync, lstatSync, existsSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LOCAL_TEST_FILES} from './check-browser-lab.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOTS = Object.freeze(['packages', 'scripts', 'spikes']);
const TEST_PATH = /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.test\.mjs$/;

export function verifyTestInventory({rootDir = ROOT, manifest = LOCAL_TEST_FILES,
  scanRoots = SCAN_ROOTS} = {}) {
  if (!Array.isArray(manifest) || !Array.isArray(scanRoots))
    throw new TypeError('INVALID_INVENTORY_INPUT');
  const expected = new Set(), duplicates = new Set(), invalid = new Set();
  for (const path of manifest) {
    if (typeof path !== 'string' || !TEST_PATH.test(path) ||
        path.split('/').some(s => s === '..' || s === '.')) {
      invalid.add(String(path));
    } else if (expected.has(path)) {
      duplicates.add(path);
    } else {
      expected.add(path);
    }
  }
  const actual = new Set(), missingRoots = [], links = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, {withFileTypes:true})) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childAbs = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        if (entry.name.endsWith('.test.mjs')) links.push(childRel);
        continue; // Never follow external or cyclic links.
      }
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (entry.isFile() && entry.name.endsWith('.test.mjs')) actual.add(childRel);
    }
  };
  const validRoots = new Set();
  for (const scanRoot of scanRoots) {
    if (typeof scanRoot !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(scanRoot) ||
        validRoots.has(scanRoot)) throw new TypeError('INVALID_SCAN_ROOT');
    validRoots.add(scanRoot);
    const abs = join(rootDir, scanRoot);
    if (!existsSync(abs)) {missingRoots.push(scanRoot); continue;}
    if (!lstatSync(abs).isDirectory()) throw new TypeError('INVALID_SCAN_ROOT');
    walk(abs, scanRoot);
  }
  const missing = [...expected].filter(path => !actual.has(path)).sort();
  const unlisted = [...actual].filter(path => !expected.has(path)).sort();
  return Object.freeze({
    ok: !missing.length && !unlisted.length && !duplicates.size && !invalid.size &&
      !links.length && !missingRoots.length,
    expected:expected.size, actual:actual.size,
    missing:Object.freeze(missing), unlisted:Object.freeze(unlisted),
    duplicates:Object.freeze([...duplicates].sort()),
    invalid:Object.freeze([...invalid].sort()),
    links:Object.freeze(links.sort()), missingRoots:Object.freeze(missingRoots.sort())
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report=verifyTestInventory();
  console.log(`CCW suites: manifest=${report.expected}, archivos=${report.actual}`);
  for(const field of ['missing','unlisted','duplicates','invalid','links','missingRoots']) {
    if(report[field].length) console.error(`${field}: ${report[field].join(', ')}`);
  }
  if(report.ok) console.log('Inventario de pruebas completo.');
  process.exitCode=report.ok?0:2;
}
