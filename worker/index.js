// Cloudflare Worker: serves the static app and a small passphrase-protected API that keeps the tracker's
// data in a Durable Object, so it follows you across browsers and devices.
import { DurableObject } from 'cloudflare:workers';

const MAX_BYTES = 512 * 1024;

// One instance holds the single tracker document: { data, savedAt }.
export class TrackerState extends DurableObject {
  async read() { return (await this.ctx.storage.get('state')) || null; }
  // Last write wins by the client's savedAt; an older write is refused and the newer copy returned.
  async write(next) {
    const cur = await this.ctx.storage.get('state');
    if (cur && cur.savedAt > next.savedAt) return { ok: false, state: cur };
    await this.ctx.storage.put('state', next);
    return { ok: true, state: next };
  }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map(v => crypto.subtle.digest('SHA-256', enc.encode(v))));
  return crypto.subtle.timingSafeEqual(x, y);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname !== '/api/state') return env.ASSETS.fetch(req);
    if (!env.SYNC_TOKEN) return json({ error: 'sync not configured' }, 503);
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token || !(await sameSecret(token, env.SYNC_TOKEN))) return json({ error: 'wrong passphrase' }, 401);
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
};
