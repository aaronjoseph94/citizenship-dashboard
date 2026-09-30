// Cloudflare Worker in front of the static app:
// - a password gate: nothing (app, data files, API) is served until the site password is entered;
// - a small API (/api/state) that keeps the tracker's data in a Durable Object, so it follows you across devices.
import { DurableObject } from 'cloudflare:workers';

const MAX_BYTES = 512 * 1024;
const COOKIE = 'ct_session';
const SESSION_DAYS = 30;
const enc = new TextEncoder();

// One instance holds the tracker document ({ data, savedAt }) and the key that signs login sessions.
export class TrackerState extends DurableObject {
  async read() { return (await this.ctx.storage.get('state')) || null; }
  // Last write wins by the client's savedAt; an older write is refused and the newer copy returned.
  async write(next) {
    const cur = await this.ctx.storage.get('state');
    if (cur && cur.savedAt > next.savedAt) return { ok: false, state: cur };
    await this.ctx.storage.put('state', next);
    return { ok: true, state: next };
  }
  // Random, created once, never leaves the server.
  async sessionKey() {
    let k = await this.ctx.storage.get('sessionKey');
    if (!k) { k = [...crypto.getRandomValues(new Uint8Array(32))]; await this.ctx.storage.put('sessionKey', k); }
    return k;
  }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function sameBytes(a, b) {
  const [x, y] = await Promise.all([a, b].map(v => crypto.subtle.digest('SHA-256', typeof v === 'string' ? enc.encode(v) : v)));
  return crypto.subtle.timingSafeEqual(x, y);
}

// SITE_PASSWORD (secret) wins if set; otherwise SITE_PASSWORD_HASH = "pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>".
async function passwordOk(pw, env) {
  if (env.SITE_PASSWORD) return sameBytes(pw, env.SITE_PASSWORD);
  const [alg, iter, salt, hash] = String(env.SITE_PASSWORD_HASH || '').split('$');
  if (alg !== 'pbkdf2-sha256') return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(salt), iterations: +iter }, key, 256);
  return sameBytes(bits, fromB64(hash));
}
const gateOn = env => !!(env.SITE_PASSWORD || env.SITE_PASSWORD_HASH);

let hmacKey;
async function signingKey(env) {
  if (!hmacKey) {
    const raw = await env.TRACKER.get(env.TRACKER.idFromName('main')).sessionKey();
    hmacKey = await crypto.subtle.importKey('raw', new Uint8Array(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  }
  return hmacKey;
}
async function makeSession(env) {
  const exp = String(Date.now() + SESSION_DAYS * 864e5);
  return `${exp}.${b64(await crypto.subtle.sign('HMAC', await signingKey(env), enc.encode(exp)))}`;
}
async function sessionOk(req, env) {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || !(+exp > Date.now())) return false;
  try { return await crypto.subtle.verify('HMAC', await signingKey(env), fromB64(sig.replace(/-/g, '+').replace(/_/g, '/')), enc.encode(exp)); } catch { return false; }
}
const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

function loginPage(error, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Citizenship Tracker</title><meta name="robots" content="noindex">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 18 18%27%3E%3Crect width=%2718%27 height=%2718%27 rx=%275%27 fill=%27%231877F2%27/%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400..600&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:#EEF3FA;color:#0A2540;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;
background-image:radial-gradient(42% 48% at 12% 8%,rgba(24,119,242,.22) 0%,rgba(24,119,242,0) 70%),radial-gradient(38% 46% at 88% 18%,rgba(72,205,255,.22) 0%,rgba(72,205,255,0) 70%),radial-gradient(46% 50% at 55% 105%,rgba(151,120,255,.18) 0%,rgba(151,120,255,0) 70%)}
form{width:100%;max-width:380px;background:rgba(255,255,255,.72);backdrop-filter:blur(22px) saturate(1.5);-webkit-backdrop-filter:blur(22px) saturate(1.5);border:1px solid rgba(255,255,255,.8);border-radius:24px;padding:36px 32px;box-shadow:0 1px 2px rgba(10,37,64,.05),0 12px 32px -14px rgba(10,37,64,.22),inset 0 1px 0 rgba(255,255,255,.85)}
.brand{display:flex;align-items:center;gap:9px;font-weight:600;font-size:15px}.brand i{width:18px;height:18px;border-radius:5px;background:#1877F2;display:inline-block}
h1{margin:22px 0 8px;font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:38px;letter-spacing:-.02em;line-height:1}h1 em{color:#1877F2}
p{margin:0 0 22px;font-size:14px;color:#425466;line-height:1.5}label{display:block;font-size:12.5px;color:#425466;margin-bottom:6px}
input{width:100%;height:40px;border:1px solid #CBD5E0;border-radius:8px;padding:0 12px;font-size:15px;color:#0A2540;background:#fff;outline:none;font-family:inherit}input:focus{border-color:#0A2540;box-shadow:0 0 0 3px rgba(10,37,64,.08)}
button{margin-top:14px;width:100%;height:40px;border:0;border-radius:8px;background:#0A2540;color:#fff;font-size:14px;font-weight:500;cursor:pointer;font-family:inherit}button:hover{background:#1A3A5C}
.err{margin-top:12px;font-size:13px;color:#B42318}</style></head>
<body><form method="post" action="/login"><div class="brand"><i></i>Citizenship</div><h1>Welcome <em>back</em></h1><p>Enter the password to open your tracker.</p>
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
<button type="submit">Open tracker</button>${error ? `<div class="err" role="alert">${error}</div>` : ''}</form></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}

async function handleState(req, env, loggedIn) {
  // Logged-in browsers are trusted; otherwise a SYNC_TOKEN bearer passphrase (only if configured) is required.
  if (!loggedIn) {
    if (!env.SYNC_TOKEN) return json({ error: gateOn(env) ? 'login required' : 'sync not configured' }, gateOn(env) ? 401 : 503);
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token || !(await sameBytes(token, env.SYNC_TOKEN))) return json({ error: 'wrong passphrase' }, 401);
  }
  const store = env.TRACKER.get(env.TRACKER.idFromName('main'));
  if (req.method === 'GET') return json({ state: await store.read() });
  if (req.method === 'PUT') {
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ error: 'too large' }, 413);
    let body; try { body = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
    if (!body || typeof body.data !== 'object' || body.data === null || !Number.isFinite(body.savedAt)) return json({ error: 'bad state' }, 400);
    const r = await store.write({ data: body.data, savedAt: body.savedAt });
    return json(r, r.ok ? 200 : 409);
  }
  return json({ error: 'method not allowed' }, 405);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/logout') return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': cookie('', 0), 'cache-control': 'no-store' } });
    if (gateOn(env) && url.pathname === '/login' && req.method === 'POST') {
      const pw = String((await req.formData()).get('password') || '');
      if (!(await passwordOk(pw, env))) { await new Promise(r => setTimeout(r, 1000)); return loginPage('That password isn’t right.', 401); }
      return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': cookie(await makeSession(env), SESSION_DAYS * 86400), 'cache-control': 'no-store' } });
    }
    const loggedIn = gateOn(env) && await sessionOk(req, env);
    if (url.pathname === '/api/state') return handleState(req, env, loggedIn);
    if (gateOn(env) && !loggedIn) return loginPage('');
    if (url.pathname === '/login') return new Response(null, { status: 303, headers: { location: '/' } });
    const res = await env.ASSETS.fetch(req);
    // Pages behind the gate must not be cached by browsers or proxies for other people.
    const out = new Response(res.body, res); out.headers.set('cache-control', 'private, no-cache'); return out;
  }
};
