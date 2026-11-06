/** Experimental cookie transport policy. Never enable insecureLoopback beyond local tests. */
const TOKEN = /^[A-Za-z0-9_-]{20,256}$/;
const SECURE_COOKIE = '__Host-ccw_session';
const DEV_COOKIE = 'ccw_lab_session';

export function browserConfig(config) {
  if (!config || typeof config !== 'object' || typeof config.origin !== 'string') {
    throw new TypeError('Browser origin required');
  }
  const url = new URL(config.origin);
  const insecureLoopback = config.insecureLoopback === true;
  if (url.origin !== config.origin || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new TypeError('Origin must be canonical without credentials, path, query or fragment');
  }
  if (insecureLoopback) {
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
      throw new TypeError('Insecure browser cookies only allowed on 127.0.0.1');
    }
  } else if (url.protocol !== 'https:') {
    throw new TypeError('Secure browser cookies require HTTPS');
  }
  return Object.freeze({origin: url.origin, insecureLoopback, cookieName: insecureLoopback ? DEV_COOKIE : SECURE_COOKIE});
}

export function cookieSession(cookieHeader, config) {
  if (typeof cookieHeader !== 'string' || cookieHeader.length > 8192) return null;
  const values = cookieHeader.split(';').map(s => s.trim());
  const matches = values.filter(x => x.startsWith(`${config.cookieName}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(config.cookieName.length + 1);
  return TOKEN.test(token) ? token : null;
}

export function sessionCookie(token, config, {clear = false} = {}) {
  if (!clear && (typeof token !== 'string' || !TOKEN.test(token))) throw new TypeError('Invalid session token');
  return [
    `${config.cookieName}=${clear ? '' : token}`,
    'Path=/', 'HttpOnly', 'SameSite=Strict',
    ...(!config.insecureLoopback ? ['Secure'] : []),
    `Max-Age=${clear ? 0 : 43200}`
  ].join('; ');
}

/** Browser CSRF: all state changes need exact same-origin Origin and a non-simple header. */
export function allowedBrowserRequest(req, config) {
  if (!config.insecureLoopback) return true;
  const peer = req.socket?.remoteAddress;
  return peer === '127.0.0.1' || peer === '::ffff:127.0.0.1';
}

export function validBrowserMutation(req, config) {
  if (req.headers.origin !== config.origin || req.headers['x-ccw-request'] !== '1') return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  return true;
}
