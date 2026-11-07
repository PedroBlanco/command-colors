import test from 'node:test';
import assert from 'node:assert/strict';
import {browserConfig,cookieSession,sessionCookie,allowedBrowserRequest,validBrowserMutation} from './browser-session.mjs';

test('requires HTTPS unless explicit loopback development', () => {
  assert.throws(()=>browserConfig({origin:'http://example.org'}));
  assert.throws(()=>browserConfig({origin:'http://0.0.0.0:8788',insecureLoopback:true}));
  assert.throws(()=>browserConfig({origin:'http://localhost:8788',insecureLoopback:true}));
  assert.throws(()=>browserConfig({origin:'http://127.0.0.1:8788/evil',insecureLoopback:true}));
  assert.throws(()=>browserConfig({origin:'https://example.org/path'}));
  assert.equal(browserConfig({origin:'https://example.org'}).cookieName,'__Host-ccw_session');
  assert.equal(browserConfig({origin:'http://127.0.0.1:8788',insecureLoopback:true}).cookieName,'ccw_lab_session');
});

test('cookie is HttpOnly, SameSite strict and Secure in HTTPS mode', () => {
  const conf=browserConfig({origin:'https://example.org'});
  const raw=sessionCookie('a'.repeat(43),conf);
  assert.match(raw,/HttpOnly/);assert.match(raw,/SameSite=Strict/);assert.match(raw,/; Secure;/);
  assert.match(raw,/Path=\//);assert.match(raw,/Max-Age=43200/);
  assert.equal(cookieSession(raw,conf),'a'.repeat(43));
});

test('insecure development cookie has distinct name and clear directive', () => {
  const conf=browserConfig({origin:'http://127.0.0.1:8788',insecureLoopback:true});
  const raw=sessionCookie('b'.repeat(43),conf);
  assert.equal(raw.includes('; Secure'),false);
  assert.equal(cookieSession(raw,conf),'b'.repeat(43));
  assert.match(sessionCookie(null,conf,{clear:true}),/Max-Age=0/);
});

test('rejects duplicate, malformed and oversized cookies',()=>{
  const conf=browserConfig({origin:'https://example.org'});
  assert.equal(cookieSession(`${conf.cookieName}=x`,conf),null);
  assert.equal(cookieSession(`${conf.cookieName}=${'a'.repeat(43)}; ${conf.cookieName}=${'b'.repeat(43)}`,conf),null);
  assert.equal(cookieSession('x='.padEnd(9000,'a'),conf),null);
  assert.equal(cookieSession(`${conf.cookieName}=${'a'.repeat(43)}; other=ok`,conf),'a'.repeat(43));
});

test('CSRF rejects missing, foreign, or cross-site origin',()=>{
  const conf=browserConfig({origin:'http://127.0.0.1:8788',insecureLoopback:true});
  const req=(headers)=>({headers});
  assert.equal(validBrowserMutation(req({origin:conf.origin,'x-ccw-request':'1'}),conf),true);
  assert.equal(validBrowserMutation(req({'x-ccw-request':'1'}),conf),false);
  assert.equal(validBrowserMutation(req({origin:'https://evil.test','x-ccw-request':'1'}),conf),false);
  assert.equal(validBrowserMutation(req({origin:conf.origin}),conf),false);
  assert.equal(validBrowserMutation(req({origin:conf.origin,'x-ccw-request':'1','sec-fetch-site':'cross-site'}),conf),false);
});

test('loopback-only peer on insecure development mode',()=>{
  const conf=browserConfig({origin:'http://127.0.0.1:8788',insecureLoopback:true});
  const req=(addr,host=conf.host)=>({headers:{host},socket:{remoteAddress:addr}});
  assert.equal(allowedBrowserRequest(req('127.0.0.1'),conf),true);
  assert.equal(allowedBrowserRequest(req('::ffff:127.0.0.1'),conf),true);
  assert.equal(allowedBrowserRequest(req('192.168.1.20'),conf),false);
  assert.equal(allowedBrowserRequest(req('127.0.0.1','evil.example'),conf),false);
  assert.equal(allowedBrowserRequest(req('127.0.0.1','localhost:8788'),conf),false);
  assert.equal(allowedBrowserRequest(req('127.0.0.1','127.0.0.1:8999'),conf),false);
  assert.equal(allowedBrowserRequest({socket:{remoteAddress:'127.0.0.1'}},conf),false);
});

test('secure mode also rejects mismatched Host headers before routing',()=>{
  const conf=browserConfig({origin:'https://games.example.org'});
  assert.equal(allowedBrowserRequest({headers:{host:'games.example.org'}},conf),true);
  assert.equal(allowedBrowserRequest({headers:{host:'attacker.example.org'}},conf),false);
  assert.equal(allowedBrowserRequest({headers:{host:'games.example.org:8443'}},conf),false);
});
