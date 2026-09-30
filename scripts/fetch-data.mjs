#!/usr/bin/env node
// Pulls citizenship wait-time benchmarks from four sources and writes public/data/wait-times.json.
// Run by .github/workflows/update-and-deploy.yml every 2 days; `npm run fetch-data` locally.
// Every source is best-effort: on failure the previous numbers are kept and the source is marked ok:false.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const OUT = new URL('../public/data/wait-times.json', import.meta.url);
const RAW_IMMI = new URL('../public/data/immitracker-raw.json', import.meta.url);
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const BOT_UA = 'citizenship-dashboard/0.1 (personal wait-time tracker; github.com/aaronjoseph94/citizenship-dashboard)';
const DAY = 864e5, MONTH_DAYS = 30.4;

const THREADS = {
  r26: { id: '1q6vm0e', year: 2026, url: 'https://www.reddit.com/r/ImmigrationCanada/comments/1q6vm0e/megathread_processing_times_citizenship_2026/' },
  r25: { id: '1hq3gg4', year: 2025, url: 'https://www.reddit.com/r/ImmigrationCanada/comments/1hq3gg4/megathread_processing_times_citizenship_2025/' }
};
const IRCC_JSON = ['https://www.canada.ca/content/dam/ircc/documents/json/data-ptime-non-country-en.json', 'https://www.canada.ca/content/dam/ircc/documents/json/data-ptime-en.json'];
const IRCC_PAGE = 'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/check-processing-times.html';
const PBI = { key: 'd54cab2b-261a-41a6-a6aa-5b2dabee1cc0', tenant: '57df1cd8-6e02-422f-948b-3b953584bd43', url: 'https://app.powerbi.com/view?r=eyJrIjoiZDU0Y2FiMmItMjYxYS00MWE2LWFhOWEtNWIyZGFiZWUxY2MwIiwidCI6IjU3ZGYxY2Q4LTZlMDItNDIyZi05NDhiLTNiOTUzNTg0YmQ0MyJ9' };

const log = (...a) => console.log('[fetch-data]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r1 = v => Math.round(v * 10) / 10;

async function http(url, opts = {}, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...opts, headers: { 'user-agent': UA, accept: 'application/json, text/html;q=0.9, */*;q=0.8', ...(opts.headers || {}) }, signal: AbortSignal.timeout(30000) });
      if (res.ok) return res;
      err = new Error(`HTTP ${res.status} for ${url}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) { err = e; }
    await sleep(1500 * 2 ** i);
  }
  throw err;
}
const getJSON = async (url, opts) => (await http(url, opts)).json();

// ---------------------------------------------------------------- IRCC
async function fetchIrcc() {
  const toMonths = s => { const m = String(s).match(/([\d.]+)\s*(month|week|day)/i); if (!m) return null; const n = parseFloat(m[1]); return /week/i.test(m[2]) ? r1(n / 4.345) : /day/i.test(m[2]) ? r1(n / MONTH_DAYS) : n; };
  for (const url of IRCC_JSON) {
    try {
      const j = await getJSON(url);
      const hits = [];
      const walk = (o, path) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, path.concat(k)); else if (path.join('.').match(/grant/i)) hits.push([path.join('.'), o]); };
      walk(j, []);
      const hit = hits.find(([, v]) => toMonths(v) != null);
      if (hit) return { ok: true, total: toMonths(hit[1]), raw: `${hit[0]} = ${hit[1]}`, url: IRCC_PAGE, lastUpdated: j['default-update']?.lastupdated || j.citizenship?.lastupdated || null };
    } catch (e) { log('IRCC json', url, e.message); }
  }
  // Fallback: the rendered page text, e.g. "Citizenship grant ... 12 months".
  const html = await (await http(IRCC_PAGE)).text();
  const m = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').match(/citizenship grant[^.]{0,200}?(\d+(?:\.\d+)?)\s*months?/i);
  if (m) return { ok: true, total: parseFloat(m[1]), raw: m[0].slice(0, 200), url: IRCC_PAGE };
  throw new Error('grant time not found in IRCC data');
}

// ---------------------------------------------------------------- Reddit
async function redditToken() {
  const id = process.env.REDDIT_CLIENT_ID, secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  const j = await getJSON('https://www.reddit.com/api/v1/access_token', { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'), 'content-type': 'application/x-www-form-urlencoded', 'user-agent': BOT_UA }, body: 'grant_type=client_credentials' });
  return j.access_token;
}

function flattenListing(node, out, more) {
  if (!node) return;
  if (Array.isArray(node)) return node.forEach(n => flattenListing(n, out, more));
  if (node.kind === 'Listing') return flattenListing(node.data.children, out, more);
  if (node.kind === 'more') { more.push(...(node.data.children || [])); return; }
  if (node.kind === 't1') { const d = node.data; out.push({ id: d.id, body: d.body, created_utc: d.created_utc }); if (d.replies) flattenListing(d.replies, out, more); }
}

// Official API (OAuth, needs REDDIT_CLIENT_ID/SECRET secrets) or the public .json endpoint.
async function redditLive(id, token) {
  const base = token ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
  const headers = token ? { authorization: 'bearer ' + token, 'user-agent': BOT_UA } : { 'user-agent': UA };
  const hosts = token ? [base] : [base, 'https://old.reddit.com', 'https://api.reddit.com'];
  let lastErr;
  for (const host of hosts) {
    try {
      const j = await getJSON(`${host}/comments/${id}${token ? '' : '.json'}?limit=500&depth=12&raw_json=1&sort=new`, { headers });
      const out = [], more = [];
      flattenListing(j[1], out, more);
      // Expand "load more comments" stubs, 100 at a time.
      for (let i = 0; i < more.length && i < 2000; i += 100) {
        try {
          const m = await getJSON(`${host}/api/morechildren${token ? '' : '.json'}?api_type=json&raw_json=1&link_id=t3_${id}&children=${more.slice(i, i + 100).join(',')}`, { headers });
          for (const t of m.json?.data?.things || []) if (t.kind === 't1') out.push({ id: t.data.id, body: t.data.body, created_utc: t.data.created_utc });
        } catch (e) { log('morechildren', e.message); break; }
        await sleep(800);
      }
      return out;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// Archives that mirror Reddit and are reachable when reddit.com blocks datacenter IPs (e.g. GitHub runners).
async function arcticShift(id) {
  const out = []; let after = 0;
  for (let page = 0; page < 30; page++) {
    const j = await getJSON(`https://arctic-shift.photon-reddit.com/api/comments/search?link_id=t3_${id}&limit=auto&sort=asc${after ? '&after=' + after : ''}`);
    const rows = j.data || [];
    rows.forEach(d => out.push({ id: d.id, body: d.body, created_utc: d.created_utc }));
    if (rows.length < 100) break;
    after = rows[rows.length - 1].created_utc + 1;
    await sleep(500);
  }
  return out;
}
async function pullPush(id) {
  const out = []; let after = 0;
  for (let page = 0; page < 30; page++) {
    const j = await getJSON(`https://api.pullpush.io/reddit/search/comment/?link_id=${id}&size=100&sort=asc&sort_type=created_utc${after ? '&after=' + after : ''}`);
    const rows = j.data || [];
    rows.forEach(d => out.push({ id: d.id, body: d.body, created_utc: d.created_utc }));
    if (rows.length < 100) break;
    after = rows[rows.length - 1].created_utc;
    await sleep(500);
  }
  return out;
}

async function fetchThreadComments(id, token) {
  const byId = new Map(), via = [], errors = [];
  // First copy wins: live Reddit runs first and carries later edits ("EDIT: oath Jun 20") that the archives may have missed.
  const add = (name, rows) => { for (const r of rows) if (r.body && !/^\[(deleted|removed)\]$/.test(r.body) && !byId.has(r.id)) byId.set(r.id, r); via.push(`${name}:${rows.length}`); };
  for (const [name, fn] of [['reddit', () => redditLive(id, token)], ['arctic-shift', () => arcticShift(id)], ['pullpush', () => pullPush(id)]]) {
    try { add(name, await fn()); } catch (e) { errors.push(`${name}: ${e.message}`); }
    // Live Reddit is complete; the archives only fill gaps, so stop once one of them has worked too.
    if (via.length >= 2) break;
  }
  if (!byId.size) throw new Error(errors.join('; ') || 'no comments');
  return { comments: [...byId.values()], via: via.join(', '), errors };
}

// --- timeline parsing: free-form comments like "Applied Feb 2026, AOR May, Test invite: Jun, Oath: Oct 3"
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const NUM_RE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d\d|\d\d)\b/g;
// order: 'MD' | 'DM' for dd/mm vs mm/dd numeric dates, 'auto' to decide per date.
const DATE_RES = [
  [new RegExp(`\\b(20\\d\\d)[-/.](\\d{1,2})[-/.](\\d{1,2})\\b`, 'g'), m => ({ y: +m[1], mo: +m[2] - 1, d: +m[3] })],
  [NUM_RE, (m, order) => { const a = +m[1], b = +m[2]; const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; const dm = order === 'DM' || (order === 'auto' && a > 12); return dm ? { y, mo: b - 1, d: a } : { y, mo: a - 1, d: b }; }],
  [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON},?\\s*(20\\d\\d)?\\b`, 'gi'), m => ({ y: m[3] ? +m[3] : null, mo: MONTHS[m[2].slice(0, 3).toLowerCase()], d: +m[1] })],
  [new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\d)(?:,?\\s*(20\\d\\d))?`, 'gi'), m => ({ y: m[3] ? +m[3] : null, mo: MONTHS[m[1].slice(0, 3).toLowerCase()], d: +m[2] })],
  [new RegExp(`\\b${MON}(?:,?\\s*(?:'|20)?(\\d\\d))?\\b`, 'gi'), m => ({ y: m[2] ? 2000 + +m[2] : null, mo: MONTHS[m[1].slice(0, 3).toLowerCase()], d: 15, approx: true })],
  [new RegExp(`\\b(20\\d\\d)[-/](\\d{1,2})\\b`, 'g'), m => ({ y: +m[1], mo: +m[2] - 1, d: 15, approx: true })]
];
// Milestone keywords. On a tie, the entry listed first wins, so the invite variants sit before their milestone.
const KEYS = [
  ['oathInvite', /(oath|ceremony)\s*(ceremony\s*)?(invit\w*|inv\b|email|letter|notice)|invit\w*\s*(to|for)\s*(the\s*)?(oath|ceremony)(\s*ceremony)?/gi],
  ['oath', /\boath|ceremony/gi],
  ['decision', /decision|approv|\bdm\b|\bdm[12]\b/gi],
  ['testInvite', /(test|exam)\s*(invit\w*|inv\b|email|link)|invit\w*\s*(to|for)\s*(the\s*)?(test|exam)/gi],
  ['test', /\btest|\bexam|interview/gi],
  ['aor', /\baor\b|acknowledg/gi],
  ['submit', /\bappl(y|ied|ication)|\bsubmi|\bmailed\b|\bapp\b|\bad\b|\bpaper\b/gi]
];
const ORDER = ['submit', 'aor', 'testInvite', 'test', 'decision', 'oathInvite', 'oath'];
const KEYWORD_RE = /(aor|oath|ceremony|test|exam|invite|dm|decision|approv\w*|appl\w*|submi\w*)/i;

// 'MD' / 'DM' when the numeric dates in a comment settle the order, 'ambiguous' when none can, 'auto' when they conflict.
function numericOrder(text) {
  let dm = false, md = false, any = false; let m;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(text))) { any = true; if (+m[1] > 12) dm = true; if (+m[2] > 12) md = true; }
  NUM_RE.lastIndex = 0;
  if (!any) return 'MD';
  return dm && md ? 'auto' : dm ? 'DM' : md ? 'MD' : 'ambiguous';
}

function extractDates(body, order) {
  const found = [];
  const taken = [];
  for (const [re, conv] of DATE_RES) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(body))) {
      const s = m.index, e = s + m[0].length;
      if (taken.some(([a, b]) => s < b && e > a)) continue;
      const v = conv(m, order);
      if (v.mo == null || v.mo < 0 || v.mo > 11 || v.d < 1 || v.d > 31) continue;
      // Bare "may" is usually the verb; only accept it next to a digit or a milestone keyword ("AOR in May", "May - AOR").
      if (/^may$/i.test(m[0].trim()) && !/\d/.test(body.slice(e, e + 6))) {
        const pre = body.slice(Math.max(0, s - 20), s), post = body.slice(e, e + 20);
        const kwBefore = new RegExp(`(?:${KEYWORD_RE.source}\\s*(in|on|by|around|of)?|[:\\-–])\\s*$`, 'i').test(pre);
        const kwAfter = new RegExp(`^\\s*[:\\-–]\\s*${KEYWORD_RE.source}`, 'i').test(post);
        if (!kwBefore && !kwAfter) continue;
      }
      taken.push([s, e]); found.push({ s, e, ...v });
    }
  }
  return found.sort((a, b) => a.s - b.s);
}

// Label from the keyword nearest the date: 'before' = last keyword ending before it, 'after' = first keyword following it.
function keyIn(win, side) {
  let best = null;
  KEYS.forEach(([k, re], rank) => {
    re.lastIndex = 0; let m, pos = -1;
    while ((m = re.exec(win))) { pos = side === 'before' ? m.index + m[0].length : m.index; if (side === 'after') break; }
    if (pos < 0) return;
    if (!best || (side === 'before' ? pos > best.pos : pos < best.pos)) best = { k, pos, rank };
  });
  return best && best.k;
}

function timelineFor(text, createdUtc, threadYear, order) {
  const dates = extractDates(text, order);
  if (dates.length < 2) return null;
  const created = new Date(createdUtc * 1000);
  const before = dates.map((dt, i) => keyIn(text.slice(Math.max(i ? dates[i - 1].e : 0, dt.s - 60), dt.s), 'before'));
  const after = dates.map((dt, i) => {
    const nl = text.indexOf('\n', dt.e);
    const stop = Math.min(nl < 0 ? text.length : nl, i + 1 < dates.length ? dates[i + 1].s : text.length, dt.e + 60);
    return keyIn(text.slice(dt.e, stop), 'after');
  });
  // "Mar 3 - AOR" layouts put the keyword after the date; reading them keyword-first would shift every label by one.
  const count = a => a.filter(Boolean).length;
  const labels = !before[0] && after[0] && count(after) > count(before) ? after : before;
  const ev = {};
  let prevDate = null;
  dates.forEach((dt, i) => {
    const k = labels[i];
    if (!k) return;
    let y = dt.y;
    if (y == null) {
      y = prevDate ? prevDate.getFullYear() : Math.min(threadYear, created.getFullYear());
      const cand = new Date(y, dt.mo, dt.d);
      if (prevDate && cand < prevDate - 20 * DAY) y++;
      else if (!prevDate && cand > created.getTime() + 31 * DAY) y--;
    }
    const date = new Date(y, dt.mo, dt.d);
    if (date > created.getTime() + 400 * DAY || y < 2019) return; // future-dated scheduled events are OK (ceremony dates), junk isn't
    if (!ev[k]) ev[k] = date;
    prevDate = date;
  });
  const present = ORDER.filter(k => ev[k]);
  const ordered = present.every((k, i) => !i || ev[k] >= ev[present[i - 1]]);
  const months = (a, b) => (a && b && b > a) ? (b - a) / DAY / MONTH_DAYS : null;
  const test = ev.test || ev.testInvite;
  // The ceremony date when given; the invite date only when that is all the comment has.
  const oath = ev.oath || ev.oathInvite;
  const out = {
    aor: months(ev.submit, ev.aor),
    test: months(ev.aor, test),
    decision: months(test, ev.decision),
    oath: months(ev.decision, oath),
    total: months(ev.aor, oath),
    // Same semantic as IRCC's published figure (AOR → oath). Keep submit → oath too, for display.
    fullTotal: months(ev.submit, oath)
  };
  for (const k of Object.keys(out)) if (out[k] != null && (out[k] <= 0 || out[k] > 60)) out[k] = null;
  return { out, ordered };
}

function parseTimeline(body, createdUtc, threadYear) {
  const text = body.replace(/\*|_|~|`|#/g, ' ');
  const order = numericOrder(text);
  let res;
  if (order !== 'ambiguous') res = timelineFor(text, createdUtc, threadYear, order);
  else {
    // Numbers like 05/01/2026 could be either order: use the reading whose milestones come out in sequence,
    // and drop the comment when both (differently) or neither do.
    const md = timelineFor(text, createdUtc, threadYear, 'MD'), dm = timelineFor(text, createdUtc, threadYear, 'DM');
    const ok = [md, dm].filter(r => r && r.ordered);
    res = ok.length === 1 ? ok[0] : ok.length === 2 && JSON.stringify(md.out) === JSON.stringify(dm.out) ? md : null;
  }
  if (!res) return null;
  return Object.values(res.out).some(v => v != null) ? res.out : null;
}

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function fetchRedditSource(key, token) {
  const t = THREADS[key];
  const { comments, via, errors } = await fetchThreadComments(t.id, token);
  const timelines = comments.map(c => parseTimeline(c.body || '', c.created_utc, t.year)).filter(Boolean);
  const res = { ok: true, url: t.url, via, comments: comments.length, n: 0, counts: {} };
  for (const k of ['aor', 'test', 'decision', 'oath', 'total', 'fullTotal']) {
    const vals = timelines.map(x => x[k]).filter(v => v != null);
    res.counts[k] = vals.length;
    const med = median(vals);
    // A single anecdote is too noisy to use as a benchmark.
    if (med != null && vals.length >= 2) res[k] = r1(med);
  }
  res.n = timelines.length;
  if (errors.length) res.warnings = errors;
  if (res.n === 0) throw new Error(`fetched ${comments.length} comments via ${via} but found no parsable timelines`);
  return res;
}

// ---------------------------------------------------------------- ImmiTracker (public Power BI report)
async function pbiApiHosts() {
  const hosts = [];
  try {
    const r = await getJSON(`https://api.powerbi.com/public/routing/cluster/${PBI.tenant}`);
    const u = new URL(r.FixedClusterUri);
    hosts.push('https://' + u.hostname.replace('-redirect', '').replace('global-', '').replace('.analysis', '-api.analysis'));
  } catch (e) { log('pbi routing', e.message); }
  hosts.push('https://wabi-canada-central-a-primary-api.analysis.windows.net', 'https://wabi-us-east2-api.analysis.windows.net', 'https://wabi-us-north-central-api.analysis.windows.net');
  return [...new Set(hosts)];
}

// Decode Power BI's compressed DSR rows (R = repeat-previous bitmask, Ø = null bitmask, ValueDicts).
function decodeDsr(result) {
  const ds = result?.data?.dsr?.DS?.[0]; if (!ds) return [];
  const dicts = ds.ValueDicts || {};
  const ph = ds.PH?.[0]; const rows = ph ? (ph.DM0 || Object.values(ph)[0] || []) : [];
  const schema = rows[0]?.S || [];
  let prev = [];
  return rows.map(row => {
    if (!row.C) return Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'S').map(([k, v]) => [k, v]));
    const vals = []; let ci = 0; const R = row.R || 0, N = row['Ø'] || 0;
    for (let i = 0; i < Math.max(schema.length, row.C.length); i++) {
      if (R & (1 << i)) vals.push(prev[i]);
      else if (N & (1 << i)) vals.push(null);
      else { let v = row.C[ci++]; const dn = schema[i]?.DN; if (dn && typeof v === 'number' && dicts[dn]) v = dicts[dn][v]; vals.push(v); }
    }
    prev = vals;
    return Object.fromEntries(vals.map((v, i) => [schema[i]?.N || 'C' + i, v]));
  });
}

function selName(sel) { return sel.NativeReferenceName || sel.Name || JSON.stringify(sel).slice(0, 80); }

function classify(name) {
  const n = name.toLowerCase().replace(/[_.]/g, ' ');
  const to = '\\W*(to|-|→|>|until)\\W*';
  if (new RegExp(`(submi|appl|\\bad\\b|\\bapp\\b)\\w*${to}aor`).test(n)) return 'aor';
  if (new RegExp(`aor${to}(test|invite|exam)`).test(n)) return 'test';
  if (new RegExp(`(test|exam)\\w*${to}(decision|dm|approv)`).test(n)) return 'decision';
  if (new RegExp(`(decision|dm|approv)\\w*${to}(oath|ceremony)`).test(n)) return 'oath';
  if (new RegExp(`aor${to}(oath|ceremony|citizen)`).test(n)) return 'total';
  if (new RegExp(`(submi|appl|\\bapp\\b)\\w*${to}(oath|ceremony|citizen)`).test(n)) return 'fullTotal';
  // "Total" alone is often a count card ("Total Applications"); only accept it with a duration word and no count word.
  if (/\b(overall|total|end to end)\b/.test(n) && /(day|week|month|time|wait|processing|duration)/.test(n) && !/(count|number|#|applications?\b|applicants?|cases?|records?|rows)/.test(n)) return 'fullTotal';
  return null;
}

async function fetchImmi() {
  const headers = { 'X-PowerBI-ResourceKey': PBI.key, 'content-type': 'application/json;charset=UTF-8', origin: 'https://app.powerbi.com', referer: 'https://app.powerbi.com/' };
  let host, mae, lastErr;
  for (const h of await pbiApiHosts()) {
    try { mae = await getJSON(`${h}/public/reports/${PBI.key}/modelsAndExploration?preferReadOnlySession=true`, { headers }); host = h; break; } catch (e) { lastErr = e; }
  }
  if (!mae) throw lastErr || new Error('Power BI report unreachable');
  const model = mae.models?.[0]; const reportId = mae.exploration?.report?.objectId;
  const visuals = [];
  for (const sec of mae.exploration?.sections || []) for (const vc of sec.visualContainers || []) {
    try { const cfg = JSON.parse(vc.config); const q = cfg.singleVisual?.prototypeQuery; if (q?.Select?.length) visuals.push({ page: sec.displayName, name: cfg.name, type: cfg.singleVisual.visualType, title: cfg.singleVisual?.vcObjects?.title?.[0]?.properties?.text?.expr?.Literal?.Value || '', q }); } catch { /* skip */ }
  }
  const raw = { fetched: new Date().toISOString(), host, pages: (mae.exploration?.sections || []).map(s => s.displayName), visuals: [] };
  const found = {};
  for (const v of visuals.slice(0, 80)) {
    const body = { version: '1.0.0', queries: [{ Query: { Commands: [{ SemanticQueryDataShapeCommand: { Query: v.q, Binding: { Primary: { Groupings: [{ Projections: v.q.Select.map((_, i) => i) }] }, DataReduction: { DataVolume: 3, Primary: { Window: { Count: 200 } } }, Version: 1 }, ExecutionMetricsKind: 1 } }] }, QueryId: '', ApplicationContext: { DatasetId: model?.dbName, Sources: [{ ReportId: reportId, VisualId: v.name }] } }], cancelQueries: [], modelId: model?.id };
    try {
      const r = await getJSON(`${host}/public/reports/querydata?synchronous=true`, { method: 'POST', headers, body: JSON.stringify(body) });
      const rows = decodeDsr(r.results?.[0]?.result);
      const names = v.q.Select.map(selName);
      raw.visuals.push({ page: v.page, type: v.type, title: v.title, fields: names, rows: rows.slice(0, 25) });
      // Single-value visuals (cards/KPIs) whose field or title names a milestone span.
      if (rows.length === 1) {
        const vals = Object.values(rows[0]);
        names.forEach((nm, i) => {
          const val = vals[i]; if (typeof val !== 'number') return;
          const label = `${v.title} ${nm}`; const k = classify(label) || classify(nm) || classify(v.title); if (!k || found[k] != null) return;
          const l = label.toLowerCase();
          // ImmiTracker measures are in days unless the label says otherwise.
          const months = /week/.test(l) ? val / 4.345 : /month/.test(l) ? val : val / MONTH_DAYS;
          if (months > 0 && months < 60) { found[k] = r1(months); found[k + 'Field'] = label.trim(); }
        });
      }
    } catch (e) { raw.visuals.push({ page: v.page, type: v.type, title: v.title, error: e.message }); }
    await sleep(250);
  }
  await writeFile(RAW_IMMI, JSON.stringify(raw, null, 1));
  if (found.total == null && found.fullTotal != null && found.aor != null) found.total = r1(found.fullTotal - found.aor);
  const res = { ok: true, url: PBI.url, visuals: visuals.length };
  for (const k of ['aor', 'test', 'decision', 'oath', 'total', 'fullTotal']) if (found[k] != null) { res[k] = found[k]; res[k + 'Field'] = found[k + 'Field']; }
  if (!['aor', 'test', 'decision', 'oath', 'total'].some(k => res[k] != null)) throw new Error(`report read (${visuals.length} visuals) but no wait-time measures recognised; see data/immitracker-raw.json`);
  return res;
}

// ---------------------------------------------------------------- main
async function main() {
  let prev = { sources: {} };
  try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* first run */ }
  let token = null;
  try { token = await redditToken(); if (token) log('using Reddit OAuth'); } catch (e) { log('reddit oauth failed:', e.message); }

  const jobs = { ircc: fetchIrcc, r26: () => fetchRedditSource('r26', token), r25: () => fetchRedditSource('r25', token), immi: fetchImmi };
  const sources = {};
  for (const [k, fn] of Object.entries(jobs)) {
    try { sources[k] = { ...(await fn()), fetched: new Date().toISOString() }; log(k, 'ok', JSON.stringify(sources[k]).slice(0, 300)); }
    catch (e) {
      log(k, 'FAILED:', e.message);
      const old = prev.sources?.[k] || {};
      sources[k] = { ...old, ok: false, error: e.message.slice(0, 300), url: old.url || (k === 'ircc' ? IRCC_PAGE : k === 'immi' ? PBI.url : THREADS[k].url) };
      if (k === 'ircc' && sources[k].total == null) sources[k].total = 12; // last published figure, Sept 2026
    }
  }
  await mkdir(new URL('.', OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), sources }, null, 2) + '\n');
  log('wrote', OUT.pathname);
}

main().catch(e => { console.error(e); process.exit(1); });
