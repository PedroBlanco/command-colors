/**
 * CCW-007: local, in-memory identity proof of concept. No HTTP endpoints, no public registration.
 * NEVER deploy as an authentication server: lacks durable sessions, throttling, CSRF and TLS.
 */
import {randomBytes, randomUUID, createHash, scrypt as callbackScrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const scrypt = promisify(callbackScrypt);
const HASH_LENGTH = 64;
const KEY_OPTIONS = Object.freeze({N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024});
export const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function normalizeHandle(handle) {
  if (typeof handle !== 'string') return null;
  const normalized = handle.trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{2,31}$/.test(normalized) ? normalized : null;
}

function hashToken(token) { return createHash('sha256').update(token, 'utf8').digest('hex'); }
function passwordValid(password) {
  return typeof password === 'string' && password.length >= 12 && password.length <= 256 && !password.includes('\0');
}

export function createIdentityService({clock = Date.now, sessionTtlMs = DEFAULT_SESSION_TTL_MS} = {}) {
  if (typeof clock !== 'function' || !Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1000) {
    throw new TypeError('Configuración de sesiones inválida');
  }
  const accounts = new Map();
  const sessions = new Map();
  const dummySalt = randomBytes(16);

  /** Administrative provisioning ONLY. Never expose directly as an unauthenticated HTTP route. */
  async function provisionAccount({handle, password}) {
    const normalized = normalizeHandle(handle);
    if (!normalized || !passwordValid(password)) return {ok: false, code: 'INVALID_ACCOUNT'};
    if (accounts.has(normalized)) return {ok: false, code: 'ACCOUNT_ALREADY_EXISTS'};
    const salt = randomBytes(16);
    const passwordHash = await scrypt(password, salt, HASH_LENGTH, KEY_OPTIONS);
    // No awaits between uniqueness check and insertion, atomic in a single JS process.
    if (accounts.has(normalized)) return {ok: false, code: 'ACCOUNT_ALREADY_EXISTS'};
    const account = {userId: randomUUID(), handle: normalized, salt, passwordHash};
    accounts.set(normalized, account);
    return {ok: true, userId: account.userId, handle: normalized};
  }

  async function logIn({handle, password}) {
    const normalized = normalizeHandle(handle);
    const account = normalized && accounts.get(normalized);
    if (!passwordValid(password)) return {ok: false, code: 'INVALID_CREDENTIALS'};
    // Spend equivalent KDF work even when account does not exist to reduce user enumeration.
    const trialHash = await scrypt(password, account?.salt ?? dummySalt, HASH_LENGTH, KEY_OPTIONS);
    const valid = account ? timingSafeEqual(trialHash, account.passwordHash) : false;
    if (!valid) return {ok: false, code: 'INVALID_CREDENTIALS'};
    const token = randomBytes(32).toString('base64url');
    const expiresAt = clock() + sessionTtlMs;
    sessions.set(hashToken(token), {userId: account.userId, handle: account.handle, expiresAt});
    return {ok: true, token, expiresAt};
  }

  function resolveSession(token) {
    if (typeof token !== 'string' || token.length > 256) return null;
    const key = hashToken(token);
    const session = sessions.get(key);
    if (!session) return null;
    if (clock() >= session.expiresAt) { sessions.delete(key); return null; }
    return {userId: session.userId, handle: session.handle};
  }

  function logOut(token) {
    if (typeof token !== 'string') return {ok: true};
    sessions.delete(hashToken(token));
    return {ok: true};
  }

  return Object.freeze({provisionAccount, logIn, resolveSession, logOut});
}
