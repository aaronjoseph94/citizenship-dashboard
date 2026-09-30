import { Component } from 'react';

const KEY = 'citizenship-tracker-v1';
const STAGES = [
  { id: 'aor', title: 'Application received', desc: 'IRCC acknowledges receipt (AOR), assigns a file number and starts the published 12-month clock.' },
  { id: 'lang', title: 'Language skills', desc: 'Proof of English or French at CLB 4 or higher is reviewed.' },
  { id: 'presence', title: 'Physical presence', desc: 'Your 1,095 days in Canada within the last five years are verified.' },
  { id: 'prohib', title: 'Prohibitions', desc: 'Criminal and immigration prohibitions are checked.' },
  { id: 'background', title: 'Background verification', desc: 'Security and background checks with partner agencies.' },
  { id: 'test', title: 'Citizenship test', desc: '20 questions in 30 minutes; 15 correct to pass. Usually written online within a 21-day window of the invitation.' },
  { id: 'oath', title: 'Oath ceremony', desc: 'Take the Oath of Citizenship and receive your certificate.' }
];
const SOURCES = [{ id: 'ircc', label: 'IRCC' }, { id: 'r26', label: 'Reddit 2026' }, { id: 'r25', label: 'Reddit 2025' }, { id: 'immi', label: 'ImmiTracker' }];
const MILESTONES = [{ id: 'aor', label: 'Submit → AOR' }, { id: 'test', label: 'AOR → Test' }, { id: 'decision', label: 'Test → Decision' }, { id: 'oath', label: 'Decision → Oath' }, { id: 'total', label: 'Total' }];
const PITEMS = [
  { id: 'form', label: 'Form PPTC 153 (adult general application), completed and signed', ph: 'Form status' },
  { id: 'cert', label: 'Proof of citizenship: your citizenship certificate (paper or e-certificate)', ph: 'Certificate number' },
  { id: 'photos', label: 'Two identical photos, 50 × 70 mm, taken within 6 months, stamped by the photographer', ph: 'Studio, date taken' },
  { id: 'guarantor', label: 'Guarantor: Canadian passport holder who has known you for 2+ years, signs the form and one photo', ph: 'Guarantor name' },
  { id: 'refs', label: 'Two references who have known you for 2+ years (not family, not your guarantor)', ph: 'Reference names' },
  { id: 'id', label: 'Valid government-issued ID showing name, date of birth, photo and signature', ph: 'Which ID' },
  { id: 'fee', label: 'Fee payment (see fees)', ph: 'Payment method' },
  { id: 'travel', label: 'Proof of travel, only if you need express or urgent service', ph: 'Travel date' }
];
const PSTATUS = [['not_started', 'Not started'], ['preparing', 'Preparing'], ['submitted', 'Submitted'], ['received', 'Received']];
const PMETHOD = [['office', 'Passport office'], ['mail', 'Mail or Service Canada centre'], ['online', 'Online']];
const PERSIST = ['tab', 'applied', 'appNumber', 'stages', 'events', 'bench', 'docs', 'todos', 'notes', 'passport'];

const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const parse = s => { if (!s) return null; const p = String(s).split('-').map(Number); if (p.length < 3 || p.some(isNaN)) return null; return new Date(p[0], p[1] - 1, p[2]); };
const fmt = (d, o) => d ? d.toLocaleDateString('en-CA', o || { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtM = d => fmt(d, { month: 'short', year: 'numeric' });
// Whole months clamp to the target month's last day (Jan 31 + 1 → Feb 28), then the fraction adds days.
const addM = (d, m) => { const w = Math.floor(m), y = d.getFullYear(), mo = d.getMonth() + w; const r = new Date(y, mo, Math.min(d.getDate(), new Date(y, mo + 1, 0).getDate())); r.setDate(r.getDate() + Math.round((m - w) * 30.4)); return r; };
const addBiz = (d, n) => { const r = new Date(d); let c = 0; while (c < n) { r.setDate(r.getDate() + 1); const w = r.getDay(); if (w && w !== 6) c++; } return r; };
// Calendar-day index, immune to DST hour shifts.
const dayNum = x => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / 864e5;
const num = v => { if (v === '' || v == null) return null; const n = parseFloat(v); return isNaN(n) ? null : n; };
const money = v => '$' + v.toFixed(2);
const r1 = v => Math.round(v * 10) / 10;

function defaults() {
  return {
    tab: 'overview', applied: iso(new Date()), appNumber: '',
    stages: { aor: { status: 'now', date: '', note: '' } }, events: [],
    // User overrides only; blank cells fall back to the auto-fetched numbers in public/data/wait-times.json.
    bench: { ircc: {}, r26: {}, r25: {}, immi: {} },
    docs: ['Application form CIT 0002', 'Physical presence calculation', 'Copy of PR card', 'Language proof (CLB 4+)', 'Two citizenship photos', 'Copies of two pieces of ID', 'Fee receipt, $630'].map((l, i) => ({ id: i + 1, label: l, done: true })),
    todos: ['Check the IRCC application tracker for your AOR', 'Save the submission confirmation and fee receipt', 'Read Discover Canada, chapter 1', 'Log any trips outside Canada since applying'].map((t, i) => ({ id: i + 1, text: t, done: false })),
    notes: [],
    passport: { status: 'not_started', type: '10', method: 'office', submitted: '', received: '', items: {} }
  };
}
function load() {
  let s = null; try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* ignore */ }
  const d = defaults();
  if (s && typeof s === 'object') for (const k of Object.keys(d)) if (s[k] !== undefined) d[k] = s[k];
  d.drafts = { note: '', todo: '', doc: '', evLabel: '', evDate: '' };
  return d;
}

function Seg({ items, active, pick, style }) {
  return <div className="seg" style={style}>{items.map(([id, label]) => <button key={id} className={id === active ? 'on' : ''} onClick={() => pick(id)}>{label}</button>)}</div>;
}

export default class App extends Component {
  state = Object.assign(load(), { live: null });

  componentDidMount() {
    fetch('./data/wait-times.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(live => live && this.setState({ live })).catch(() => {});
  }
  save() { const o = {}; for (const k of PERSIST) o[k] = this.state[k]; try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* ignore */ } }
  up(fn) { this.setState(fn, () => this.save()); }
  go(tab) { this.up({ tab }); window.scrollTo(0, 0); }

  liveVal(src, ms) {
    const l = this.state.live && this.state.live.sources && this.state.live.sources[src];
    if (l && l[ms] != null) return l[ms];
    return src === 'ircc' && ms === 'total' ? 12 : null;
  }
  // User entry wins; otherwise the auto-fetched value.
  bv(src, ms) { const u = num((this.state.bench[src] || {})[ms]); return u != null ? u : this.liveVal(src, ms); }
  srcTotal(id) { const t = this.bv(id, 'total'); if (t != null) return t; const p = ['aor', 'test', 'decision', 'oath'].map(k => this.bv(id, k)); return p.some(x => x == null) ? null : r1(p.reduce((a, c) => a + c, 0)); }
  avg(ms) { const v = SOURCES.map(s => ms === 'total' ? this.srcTotal(s.id) : this.bv(s.id, ms)).filter(x => x != null); return v.length ? v.reduce((a, c) => a + c, 0) / v.length : null; }
  st(id) { return Object.assign({ status: 'todo', date: '', note: '' }, this.state.stages[id] || {}); }

  cycle(id) {
    this.up(s => {
      const cur = this.st(id); const nxt = cur.status === 'todo' ? 'now' : cur.status === 'now' ? 'done' : 'todo';
      const stages = Object.assign({}, s.stages, { [id]: Object.assign({}, cur, { status: nxt, date: nxt === 'done' && !cur.date ? iso(new Date()) : cur.date }) });
      if (nxt === 'done') { const i = STAGES.findIndex(x => x.id === id); const n = STAGES[i + 1]; if (n && (!stages[n.id] || stages[n.id].status === 'todo')) stages[n.id] = Object.assign({ date: '', note: '' }, stages[n.id] || {}, { status: 'now' }); }
      return { stages };
    });
  }
  setStage(id, k, v) { this.up(s => ({ stages: Object.assign({}, s.stages, { [id]: Object.assign({}, this.st(id), { [k]: v }) }) })); }
  setBench(src, ms, v) { this.up(s => ({ bench: Object.assign({}, s.bench, { [src]: Object.assign({}, s.bench[src] || {}, { [ms]: v }) }) })); }
  draft(k, v) { this.setState(s => ({ drafts: Object.assign({}, s.drafts, { [k]: v }) })); }
  addTodo() { const t = this.state.drafts.todo.trim(); if (!t) return; this.up(s => ({ todos: [...s.todos, { id: Date.now(), text: t, done: false }], drafts: Object.assign({}, s.drafts, { todo: '' }) })); }
  addDoc() { const t = this.state.drafts.doc.trim(); if (!t) return; this.up(s => ({ docs: [...s.docs, { id: Date.now(), label: t, done: false }], drafts: Object.assign({}, s.drafts, { doc: '' }) })); }
  addNote() { const t = this.state.drafts.note.trim(); if (!t) return; this.up(s => ({ notes: [{ id: Date.now(), date: iso(new Date()), text: t }, ...s.notes], drafts: Object.assign({}, s.drafts, { note: '' }) })); }
  addEvent() { const l = this.state.drafts.evLabel.trim(), d = this.state.drafts.evDate; if (!l || !d) return; this.up(s => ({ events: [...s.events, { id: Date.now(), label: l, date: d }], drafts: Object.assign({}, s.drafts, { evLabel: '', evDate: '' }) })); }
  setP(k, v) { this.up(s => ({ passport: Object.assign({}, s.passport, { [k]: v }) })); }
  setPItem(id, k, v) { this.up(s => { const it = Object.assign({ done: false, note: '' }, s.passport.items[id] || {}); return { passport: Object.assign({}, s.passport, { items: Object.assign({}, s.passport.items, { [id]: Object.assign(it, { [k]: v }) }) }) }; }); }
  toggleIn(list, id, k) { this.up(st => ({ [list]: st[list].map(x => x.id === id ? Object.assign({}, x, { [k]: !x[k] }) : x) })); }
  removeIn(list, id) { this.up(st => ({ [list]: st[list].filter(x => x.id !== id) })); }
  resetAll() { if (window.confirm('Clear all saved tracker data on this device?')) { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } this.setState(Object.assign(defaults(), { drafts: this.state.drafts })); } }

  derive() {
    const s = this.state, today = new Date();
    const applied = parse(s.applied) || today;
    const day = Math.max(1, dayNum(today) - dayNum(applied) + 1);
    const sts = STAGES.map(x => Object.assign({}, x, this.st(x.id)));
    const aorDate = sts[0].status === 'done' ? parse(sts[0].date) : null;
    const aAor = this.avg('aor'), aTest = this.avg('test'), aDec = this.avg('decision'), aOath = this.avg('oath'), aTotal = this.avg('total');
    const aorEta = aorDate || (aAor != null ? addM(applied, aAor) : null);
    const testActual = sts[5].status === 'done' ? parse(sts[5].date) : null;
    const testEta = testActual || (aorEta && aTest != null ? addM(aorEta, aTest) : null);
    const decEta = testEta && aDec != null ? addM(testEta, aDec) : null;
    const oathBase = aorDate || applied;
    const oathDone = sts[6].status === 'done';
    const oathEta = oathDone ? parse(sts[6].date) : (aTotal != null ? addM(oathBase, aTotal) : (decEta && aOath != null ? addM(decEta, aOath) : null));
    const totals = SOURCES.map(src => ({ src, t: this.srcTotal(src.id) })).filter(x => x.t != null);
    const earliest = totals.length ? totals.reduce((a, b) => b.t < a.t ? b : a) : null;
    const estOath = oathDone ? fmtM(parse(sts[6].date)) : earliest ? fmtM(addM(oathBase, earliest.t)) : '—';
    const estOathSub = oathDone ? 'Oath taken' : earliest ? earliest.src.label + ' ' + earliest.t + ' mo' + (aorDate ? ' from AOR' : ' + AOR wait') : 'Add wait-time data';
    const firstOpen = sts.findIndex(x => x.status !== 'done');
    const cur = firstOpen === -1 ? null : sts[firstOpen];
    const stageLabel = cur ? 'Stage ' + (firstOpen + 1) + ' of 7 · ' + cur.title : 'All 7 stages complete';
    const subline = cur ? (cur.id === 'aor' ? 'Submitted ' + fmt(applied) + '. The acknowledgement of receipt opens your file and starts the official clock.' : cur.id === 'test' ? 'The invitation usually gives a 21-day window to write the test online.' : cur.id === 'oath' ? 'Bring your PR card and ID to the ceremony; your certificate follows.' : 'Submitted ' + fmt(applied) + (aorDate ? ', acknowledged ' + fmt(aorDate) : '') + '. Checks run in parallel; the test invitation is the next visible step.') : 'Apply for your passport with the citizenship certificate.';
    const inProc = ['Your application is ', 'in process', '.'];
    const hls = { aor: ['Waiting for IRCC to ', 'acknowledge', ' your application.'], lang: inProc, presence: inProc, prohib: inProc, background: inProc, test: ['Next up: the ', 'citizenship test', '.'], oath: ['Almost there: the ', 'oath ceremony', '.'] };
    const hl = cur ? hls[cur.id] : ['You are a ', 'Canadian citizen', '. Time for a passport.'];
    const stageSub = x => {
      if (x.status === 'done') return [fmt(parse(x.date)), '#0B7A54'];
      if (x.status === 'now') return ['In progress' + (x.date ? ' since ' + fmt(parse(x.date), { month: 'short', day: 'numeric' }) : ''), '#1877F2'];
      if (x.id === 'aor') return [aorEta ? 'Est. ' + fmtM(aorEta) : 'Est. — add wait data', '#425466'];
      if (x.id === 'test') return [testEta ? 'Est. ' + fmtM(testEta) : 'Est. after AOR', '#425466'];
      if (x.id === 'oath') return [oathEta ? 'Est. ' + fmtM(oathEta) : 'Est. — add wait data', '#425466'];
      return ['After AOR', '#425466'];
    };

    // journey
    const p = s.passport;
    const pDoneStage = p.status === 'received';
    const journey = sts.concat([{ id: 'passport', title: 'Passport', status: pDoneStage ? 'done' : (p.status === 'not_started' ? 'todo' : 'now') }]);
    const pts = journey.map((x, i) => ({ x: 70 + i * (860 / 7), y: 120 + 55 * Math.sin(i * 0.9) }));
    let pathD = 'M' + pts[0].x + ' ' + pts[0].y.toFixed(1);
    for (let i = 0; i < pts.length - 1; i++) { const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2; pathD += ' C' + (p1.x + (p2.x - p0.x) / 6).toFixed(1) + ' ' + (p1.y + (p2.y - p0.y) / 6).toFixed(1) + ' ' + (p2.x - (p3.x - p1.x) / 6).toFixed(1) + ' ' + (p2.y - (p3.y - p1.y) / 6).toFixed(1) + ' ' + p2.x.toFixed(1) + ' ' + p2.y.toFixed(1); }
    const jOpen = journey.findIndex(x => x.status !== 'done');
    const pathDash = ((jOpen === -1 ? 7 : Math.max(0, jOpen - (journey[jOpen].status === 'now' ? 0.5 : 1) + 0.5)) / 7 * 100).toFixed(1) + ' 100';
    const pSub = pDoneStage ? [fmt(parse(p.received)), '#0B7A54'] : p.status === 'submitted' ? ['Submitted' + (p.submitted ? ' ' + fmt(parse(p.submitted), { month: 'short', day: 'numeric' }) : ''), '#1877F2'] : p.status === 'preparing' ? ['Preparing documents', '#1877F2'] : [oathEta ? 'After ' + fmtM(oathEta) : 'After oath', '#425466'];
    const markers = journey.map((x, i) => { const [sub, subColor] = x.id === 'passport' ? pSub : stageSub(x); return { id: x.id, left: (pts[i].x / 10) + '%', top: (pts[i].y / 300 * 100 + 9) + '%', title: x.title, sub, subColor, bg: x.status === 'done' ? '#0B7A54' : x.status === 'now' ? '#166FE5' : '#fff', border: x.status === 'done' ? '#0B7A54' : x.status === 'now' ? '#1877F2' : '#CBD5E0', glyph: x.status === 'done' ? '✓' : String(i + 1), glyphColor: x.status === 'todo' ? '#425466' : '#fff', anim: x.status === 'now' ? 'pulse 2s infinite' : 'none' }; });

    // bands
    const bandSrc = SOURCES.map(src => ({ src, t: this.srcTotal(src.id) }));
    const maxT = Math.max(13, ...bandSrc.map(b => b.t || 0)) * 1.08;
    const monthsIn = (today - oathBase) / 864e5 / 30.4;
    const todayPctN = Math.min(98, Math.max(0, monthsIn / maxT * 100));
    const bands = bandSrc.map(b => { const pct = b.t == null ? 0 : Math.min(100, b.t / maxT * 100); return { id: b.src.id, label: b.src.label, pct: pct + '%', fill: b.t == null ? 'transparent' : (earliest && b.src.id === earliest.src.id ? 'linear-gradient(90deg,#7DB3F8,#1877F2)' : 'linear-gradient(90deg,#E3E8EE,#A3ACB9)'), labelLeft: b.t == null ? '0' : 'min(' + pct + '%, calc(100% - 120px))', textColor: b.t == null ? '#8898AA' : '#0A2540', text: b.t == null ? 'Add data in Process' : fmtM(addM(oathBase, b.t)) + ' · ' + b.t + ' mo' }; });
    const axisStart = todayPctN < 12 ? '' : fmtM(oathBase), axisEnd = todayPctN > 86 ? '' : fmtM(addM(oathBase, maxT));

    // timeline
    const tl = [{ d: applied, label: 'Application submitted', est: false }];
    sts.forEach(x => { if (x.status === 'done' && x.date) tl.push({ d: parse(x.date), label: x.title }); });
    if (p.submitted) tl.push({ d: parse(p.submitted), label: 'Passport application submitted' });
    if (p.received) tl.push({ d: parse(p.received), label: 'Passport received' });
    s.events.forEach(e => tl.push({ d: parse(e.date), label: e.label, id: e.id }));
    if (aorEta && !aorDate) tl.push({ d: aorEta, label: 'AOR (estimate)', est: true });
    if (testEta && !testActual) tl.push({ d: testEta, label: 'Citizenship test (estimate)', est: true });
    if (oathEta && !oathDone) tl.push({ d: oathEta, label: 'Oath ceremony (estimate)', est: true });
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const timeline = tl.filter(e => e.d).sort((a, b) => a.d - b.d);
    const upcoming = timeline.filter(e => e.d >= todayStart).slice(0, 3);
    const estDate = oathDone ? null : earliest ? addM(oathBase, earliest.t) : null;
    const daysLeft = oathDone ? 'Done' : estDate ? Math.max(0, dayNum(estDate) - dayNum(todayStart)) + ' days' : '—';

    // passport
    const pItems = PITEMS.map(i => Object.assign({ done: false, note: '' }, p.items[i.id] || {}, { def: i }));
    const pDone = pItems.filter(i => i.done).length;
    const fee = p.type === '10' ? 163.5 : 122.5; const bizDays = p.method === 'office' ? 10 : 20;
    const subD = parse(p.submitted); const recD = parse(p.received);
    const pStatusLabel = { not_started: oathDone ? 'Ready to apply' : 'After oath', preparing: 'Preparing', submitted: 'Submitted', received: 'Received' }[p.status];
    return { today, applied, day, sts, oathBase, oathDone, earliest, estOath, estOathSub, daysLeft, stageLabel, subline, hl, stageSub, pathD, pathDash, markers, bands, todayPct: todayPctN.toFixed(1) + '%', axisStart, axisEnd, timeline, upcoming, pItems, pDone, fee, bizDays, subD, recD, pStatusLabel };
  }

  renderHeader(d) {
    const s = this.state;
    return (
      <header className="header"><div className="header-inner">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 600, fontSize: 15, letterSpacing: '-.01em', whiteSpace: 'nowrap', height: 56, order: 1 }}><span style={{ width: 18, height: 18, borderRadius: 5, background: '#1877F2', display: 'inline-block' }} />Citizenship</div>
        <nav style={{ display: 'flex', gap: 2, flex: '999 1 340px', minWidth: 0, height: 56, alignItems: 'stretch', order: 2 }}>
          {[['overview', 'Overview'], ['process', 'Process'], ['passport', 'Passport']].map(([id, label]) => <button key={id} className={'tab' + (s.tab === id ? ' on' : '')} onClick={() => this.go(id)}>{label}</button>)}
        </nav>
        <div style={{ fontSize: 13, color: '#425466', whiteSpace: 'nowrap', marginLeft: 'auto', height: 56, display: 'flex', alignItems: 'center', order: 1 }}>Day <strong style={{ color: '#0A2540', fontWeight: 600, marginLeft: 4 }}>{d.day}</strong></div>
      </div></header>
    );
  }

  renderOverview(d) {
    const s = this.state, p = s.passport;
    const nextTodos = s.todos.filter(t => !t.done).slice(0, 4);
    const live = s.live;
    return <>
      <section className="hero">
        <div className="mesh" />
        <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: '28px 40px', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div className="rise" style={{ flex: '1 1 380px', minWidth: 0 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 500, padding: '6px 12px 6px 8px', borderRadius: 999, background: 'rgba(255,255,255,.7)', border: '1px solid rgba(10,37,64,.08)', backdropFilter: 'blur(6px)' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#1877F2', animation: 'pulse 2s infinite' }} />{d.stageLabel}</div>
            <h1 className="serif" style={{ margin: '18px 0 12px', fontWeight: 400, fontSize: 'clamp(38px,5.6vw,64px)', letterSpacing: '-.02em', lineHeight: 1, textWrap: 'pretty' }}>{d.hl[0]}<em>{d.hl[1]}</em>{d.hl[2]}</h1>
            <p style={{ margin: 0, fontSize: 15, color: '#425466', lineHeight: 1.55, maxWidth: 520, textWrap: 'pretty' }}>{d.subline}</p>
          </div>
          <div className="rise" style={{ display: 'flex', gap: '28px 40px', flexWrap: 'wrap', alignItems: 'flex-end', animationDelay: '.12s' }}>
            <div><div style={{ fontSize: 13, color: '#425466' }}>Day</div><div style={{ fontSize: 'clamp(64px,9vw,112px)', fontWeight: 600, letterSpacing: '-.05em', lineHeight: .9, fontVariantNumeric: 'tabular-nums' }}>{d.day}</div></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 6 }}>
              <div><div style={{ fontSize: 13, color: '#425466' }}>Earliest oath</div><div className="serif" style={{ fontSize: 30, lineHeight: 1.1, marginTop: 2 }}>{d.estOath}</div><div style={{ fontSize: 12, color: '#425466', marginTop: 2 }}>{d.estOathSub}</div></div>
              <div><div style={{ fontSize: 13, color: '#425466' }}>To earliest oath</div><div className="serif" style={{ fontSize: 30, lineHeight: 1.1, marginTop: 2 }}>{d.daysLeft}</div></div>
            </div>
          </div>
        </div>
        <div className="rise" style={{ position: 'relative', marginTop: 36, overflowX: 'auto', animationDelay: '.22s' }}>
          <div style={{ position: 'relative', minWidth: 760, aspectRatio: '1000/300' }}>
            <svg viewBox="0 0 1000 300" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
              <path d={d.pathD} fill="none" stroke="#E3E8EE" strokeWidth="3" strokeLinecap="round" />
              <path d={d.pathD} pathLength="100" fill="none" stroke="#1877F2" strokeWidth="3" strokeLinecap="round" strokeDasharray={d.pathDash} style={{ transition: 'stroke-dasharray 1s cubic-bezier(.2,.7,.2,1)' }} />
            </svg>
            {d.markers.map(m => (
              <div key={m.id} onClick={() => this.go(m.id === 'passport' ? 'passport' : 'process')} title="Open" style={{ position: 'absolute', left: m.left, top: m.top, transform: 'translate(-50%,-50%)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', width: 96 }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: m.bg, border: '2px solid ' + m.border, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: m.glyphColor, animation: m.anim, boxShadow: '0 0 0 4px #fff' }}>{m.glyph}</span>
                <div style={{ marginTop: 10, textAlign: 'center', lineHeight: 1.3 }}><div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '-.01em', textWrap: 'balance' }}>{m.title}</div><div style={{ fontSize: 11, color: m.subColor, marginTop: 2 }}>{m.sub}</div></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid" style={{ marginTop: 32, gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="row-between"><h2 className="h2">Next actions</h2><button className="link" onClick={() => this.go('process')}>All reminders →</button></div>
          <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {nextTodos.map(t => <li key={t.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.4 }}><input type="checkbox" className="chk" style={{ marginTop: 1 }} checked={t.done} onChange={() => this.toggleIn('todos', t.id, 'done')} /><span>{t.text}</span></li>)}
          </ul>
          {!nextTodos.length && <p style={{ margin: '14px 0 0', fontSize: 14, color: '#425466' }}>Nothing pending. Add reminders in Process.</p>}
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="row-between"><h2 className="h2">Coming up</h2><button className="link" onClick={() => this.go('process')}>All dates →</button></div>
          <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {d.upcoming.map((u, i) => <li key={i} style={{ display: 'grid', gridTemplateColumns: '96px minmax(0,1fr)', gap: 10, alignItems: 'baseline', fontSize: 14, lineHeight: 1.4 }}>
              <span className="serif" style={{ fontSize: 18, color: u.est ? '#8898AA' : '#1877F2' }}>{u.est ? fmtM(u.d) : fmt(u.d, u.d.getFullYear() === d.today.getFullYear() ? { month: 'short', day: 'numeric' } : undefined)}</span>
              <span style={{ color: u.est ? '#425466' : '#0A2540' }}>{u.label}</span></li>)}
          </ul>
          {!d.upcoming.length && <p style={{ margin: '14px 0 0', fontSize: 14, color: '#425466', lineHeight: 1.5 }}>No dates ahead yet. Add wait-time data or an event in Process.</p>}
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', background: 'rgba(24,119,242,.10)', border: '1px solid rgba(255,255,255,.7)' }}>
          <div className="row-between"><h2 className="h2">Passport</h2><span style={{ fontSize: 13, color: p.status === 'received' ? '#0B7A54' : '#425466' }}>{d.pStatusLabel}</span></div>
          <div className="serif" style={{ marginTop: 14, fontSize: 44, lineHeight: 1, letterSpacing: '-.02em' }}>{d.pDone}<span style={{ fontFamily: "'Geist',sans-serif", fontSize: 14, color: '#425466', letterSpacing: 0 }}> of {d.pItems.length} requirements ready</span></div>
          <div style={{ height: 5, borderRadius: 3, background: '#E3E8EE', marginTop: 12, overflow: 'hidden' }}><div style={{ height: '100%', width: Math.round(d.pDone / d.pItems.length * 100) + '%', background: '#0A2540', borderRadius: 3 }} /></div>
          <p style={{ margin: '12px 0 0', fontSize: 13, color: '#425466', lineHeight: 1.5 }}>{(p.type === '10' ? '10-year' : '5-year') + ' passport ' + money(d.fee) + ' · ' + d.bizDays + ' business days ' + (p.method === 'office' ? 'at a passport office' : p.method === 'mail' ? 'by mail' : 'online')}</p>
          <div style={{ marginTop: 'auto', paddingTop: 16 }}><button className="btn-ghost" style={{ height: 34, fontSize: 13 }} onClick={() => this.go('passport')}>Open checklist</button></div>
        </div>
      </section>

      <section className="card" style={{ marginTop: 14 }}>
        <div className="row-between"><h2 className="h2">Where the estimates land</h2><button className="link" onClick={() => this.go('process')}>Edit wait times in Process →</button></div>
        <div style={{ position: 'relative', marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {d.bands.map(b => (
            <div key={b.id} style={{ display: 'grid', gridTemplateColumns: '104px minmax(0,1fr)', gap: 12, alignItems: 'center', fontSize: 13 }}>
              <span style={{ color: '#425466' }}>{b.label}</span>
              <div style={{ position: 'relative', height: 28, borderRadius: 8, background: '#F6F9FC', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: b.pct, borderRadius: 8, background: b.fill, transition: 'width 1s cubic-bezier(.2,.7,.2,1)' }} />
                <span style={{ position: 'absolute', left: d.todayPct, top: 0, bottom: 0, borderLeft: '2px dashed rgba(24,119,242,.55)' }} />
                <span style={{ position: 'absolute', left: b.labelLeft, top: 0, bottom: 0, display: 'flex', alignItems: 'center', padding: '0 10px', fontWeight: 500, color: b.textColor, whiteSpace: 'nowrap' }}>{b.text}</span>
              </div>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '104px minmax(0,1fr)', gap: 12, fontSize: 11.5, color: '#8898AA' }}><span />
            <div style={{ position: 'relative', height: 18 }}><span style={{ position: 'absolute', left: 0 }}>{d.axisStart}</span><span style={{ position: 'absolute', left: `clamp(0px, ${d.todayPct} - 18px, calc(100% - 36px))`, color: '#1877F2', fontWeight: 600 }}>Today</span><span style={{ position: 'absolute', right: 0 }}>{d.axisEnd}</span></div>
          </div>
        </div>
        {live && <p className="src-note">Wait times auto-updated {fmt(new Date(live.updated))} (every 2 days) from IRCC, the r/ImmigrationCanada megathreads and ImmiTracker.</p>}
      </section>
    </>;
  }

  renderProcess(d) {
    const s = this.state, live = s.live || { sources: {} };
    const statusLabel = { todo: 'Upcoming', now: 'In progress', done: 'Done' };
    const liveSrc = id => live.sources && live.sources[id];
    return <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 24px', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="rise"><h1 className="page-title">Your file, <em>step by step</em></h1><p style={{ margin: '10px 0 0', fontSize: 14, color: '#425466' }}>Tap a status to cycle it: upcoming, in progress, done. Everything saves on this device.</p></div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="lbl">Application submitted<input type="date" className="inp" value={s.applied} onChange={e => this.up({ applied: e.target.value })} /></label>
          <label className="lbl">Application number<input type="text" className="inp" style={{ width: 150 }} placeholder="C000…" value={s.appNumber} onChange={e => this.up({ appNumber: e.target.value })} /></label>
        </div>
      </div>

      <section className="panel" style={{ marginTop: 28 }}>
        {d.sts.map((x, i) => {
          const [sub, subColor] = d.stageSub(x);
          const dot = x.status === 'done' ? '#0B7A54' : x.status === 'now' ? '#1877F2' : '#E3E8EE';
          const chip = x.status === 'done' ? ['#E3F5EE', '#0B7A54', '#E3F5EE'] : x.status === 'now' ? ['#E7F0FE', '#0B5ED7', '#E7F0FE'] : ['#fff', '#425466', '#CBD5E0'];
          return (
            <div key={x.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 16px', alignItems: 'flex-start', padding: '18px 20px', borderBottom: '1px solid #E3E8EE', background: x.status === 'now' ? '#F5F9FF' : '#fff' }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flex: '1 1 320px', minWidth: 0 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: dot, flex: 'none', marginTop: 6, animation: x.status === 'now' ? 'pulse 2s infinite' : 'none' }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span className="serif" style={{ fontSize: 24, lineHeight: 1, color: '#A3ACB9', minWidth: 30 }}>{String(i + 1).padStart(2, '0')}</span><span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.01em' }}>{x.title}</span></div>
                  <p style={{ margin: '4px 0 0', fontSize: 13.5, color: '#425466', lineHeight: 1.5, textWrap: 'pretty' }}>{x.desc}</p>
                  <div style={{ marginTop: 6, fontSize: 12.5, color: subColor }}>{sub}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button onClick={() => this.cycle(x.id)} style={{ height: 32, padding: '0 12px', borderRadius: 999, border: '1px solid ' + chip[2], background: chip[0], color: chip[1], fontSize: 12.5, fontWeight: 500, cursor: 'pointer', minWidth: 104 }}>{statusLabel[x.status]}</button>
                <input type="date" className="inp sm" value={x.date || ''} onChange={e => this.setStage(x.id, 'date', e.target.value)} />
                <input type="text" className="inp sm" style={{ width: 160 }} placeholder="Note" value={x.note || ''} onChange={e => this.setStage(x.id, 'note', e.target.value)} />
              </div>
            </div>
          );
        })}
      </section>

      <section className="grid" style={{ marginTop: 16, gridTemplateColumns: 'repeat(auto-fit,minmax(min(440px,100%),1fr))' }}>
        <div className="card">
          <div className="row-between"><h2 className="h2">Average wait times</h2><span style={{ fontSize: 12.5, color: '#425466' }}>Months · <span style={{ color: '#0B5ED7' }}>blue</span> = auto-fetched</span></div>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead><tr><th>Milestone</th>{SOURCES.map(src => <th key={src.id} style={{ textAlign: 'right', padding: '10px 4px' }}>{src.label}</th>)}</tr></thead>
              <tbody>
                {MILESTONES.map(m => (
                  <tr key={m.id}><td style={{ padding: '8px 0', borderBottom: '1px solid #EEF2F6', fontWeight: m.id === 'total' ? 600 : 400 }}>{m.label}</td>
                    {SOURCES.map(src => { const lv = this.liveVal(src.id, m.id); return (
                      <td key={src.id} style={{ padding: '6px 4px', borderBottom: '1px solid #EEF2F6', textAlign: 'right' }}>
                        <input type="number" min="0" step="0.5" className={'num' + (lv != null ? ' live' : '')} placeholder={lv != null ? String(r1(lv)) : '–'} value={(s.bench[src.id] || {})[m.id] ?? ''} onChange={e => this.setBench(src.id, m.id, e.target.value)} />
                      </td>); })}
                  </tr>
                ))}
                <tr><td style={{ padding: '10px 0', fontWeight: 600 }}>Est. oath</td>
                  {SOURCES.map(src => { const t = this.srcTotal(src.id); return <td key={src.id} style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 600, color: t == null ? '#A3ACB9' : '#0A2540', whiteSpace: 'nowrap' }}>{t == null ? '–' : fmtM(addM(d.oathBase, t))}</td>; })}
                </tr>
                <tr><td style={{ padding: '4px 0', fontSize: 12, color: '#8898AA' }}>Sample</td>
                  {SOURCES.map(src => { const l = liveSrc(src.id); return <td key={src.id} style={{ padding: '4px', textAlign: 'right', fontSize: 12, color: '#8898AA' }}>{l && l.n ? l.n + ' timelines' : l && l.ok ? (src.id === 'ircc' ? 'official' : 'report') : '–'}</td>; })}
                </tr>
              </tbody>
            </table>
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 12.5, color: '#425466', lineHeight: 1.5 }}>IRCC publishes {r1(this.liveVal('ircc', 'total'))} months for a citizenship grant, counted from AOR. Blue numbers are pulled automatically every 2 days; type in a cell to override it, clear it to go back. The total is used if set, otherwise the milestones are summed.</p>
          {s.live && <p className="src-note">Last fetch {fmt(new Date(s.live.updated))}. {SOURCES.map(src => { const l = liveSrc(src.id); return l ? <span key={src.id}><a href={l.url} target="_blank" rel="noreferrer">{src.label}</a>{l.ok ? '' : ' (unavailable: ' + (l.error || 'no data') + ')'}{'. '}</span> : null; })}</p>}
        </div>
        <div className="card">
          <h2 className="h2">Key dates</h2>
          <ol style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'flex', flexDirection: 'column' }}>
            {d.timeline.map((e, i) => (
              <li key={i} style={{ display: 'grid', gridTemplateColumns: '112px minmax(0,1fr) auto', gap: 12, alignItems: 'baseline', padding: '9px 0', borderBottom: '1px solid #EEF2F6', fontSize: 14 }}>
                <span style={{ color: '#425466', fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{fmt(e.d)}</span>
                <span style={{ color: e.est ? '#8898AA' : '#0A2540' }}>{e.label}</span>
                <button className="x" title="Remove" style={{ visibility: e.id ? 'visible' : 'hidden' }} onClick={() => e.id && this.removeIn('events', e.id)}>×</button>
              </li>
            ))}
          </ol>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            <input type="text" className="inp" style={{ flex: '1 1 180px' }} placeholder="Event, e.g. Test invitation received" value={s.drafts.evLabel} onChange={e => this.draft('evLabel', e.target.value)} />
            <input type="date" className="inp" value={s.drafts.evDate} onChange={e => this.draft('evDate', e.target.value)} />
            <button className="btn" onClick={() => this.addEvent()}>Add</button>
          </div>
        </div>
      </section>

      <section className="grid" style={{ marginTop: 14, gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        <div className="card">
          <div className="row-between"><h2 className="h2">Documents submitted</h2><span style={{ fontSize: 13, color: '#425466' }}>{s.docs.filter(x => x.done).length} of {s.docs.length}</span></div>
          <ul className="list">{s.docs.map(x => <li key={x.id} className="li"><input type="checkbox" className="chk" checked={x.done} onChange={() => this.toggleIn('docs', x.id, 'done')} /><span style={{ flex: 1, color: x.done ? '#0A2540' : '#425466' }}>{x.label}</span><button className="x" title="Remove" onClick={() => this.removeIn('docs', x.id)}>×</button></li>)}</ul>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}><input type="text" className="inp" style={{ flex: 1 }} placeholder="Add a document" value={s.drafts.doc} onChange={e => this.draft('doc', e.target.value)} onKeyDown={e => e.key === 'Enter' && this.addDoc()} /><button className="btn-ghost" onClick={() => this.addDoc()}>Add</button></div>
        </div>
        <div className="card">
          <div className="row-between"><h2 className="h2">Reminders</h2><span style={{ fontSize: 13, color: '#425466' }}>{s.todos.filter(t => !t.done).length} open</span></div>
          <ul className="list">{s.todos.map(t => <li key={t.id} className="li"><input type="checkbox" className="chk" checked={t.done} onChange={() => this.toggleIn('todos', t.id, 'done')} /><span style={{ flex: 1, color: t.done ? '#8898AA' : '#0A2540', textDecoration: t.done ? 'line-through' : 'none' }}>{t.text}</span><button className="x" title="Remove" onClick={() => this.removeIn('todos', t.id)}>×</button></li>)}</ul>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}><input type="text" className="inp" style={{ flex: 1 }} placeholder="Add a reminder" value={s.drafts.todo} onChange={e => this.draft('todo', e.target.value)} onKeyDown={e => e.key === 'Enter' && this.addTodo()} /><button className="btn-ghost" onClick={() => this.addTodo()}>Add</button></div>
        </div>
      </section>

      <section className="card" style={{ marginTop: 14 }}>
        <h2 className="h2">Notes</h2>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <textarea className="inp" rows="2" style={{ flex: '1 1 260px', minHeight: 64, height: 'auto', padding: 10, resize: 'vertical', lineHeight: 1.5 }} placeholder="What happened, what you were told, what to follow up on…" value={s.drafts.note} onChange={e => this.draft('note', e.target.value)} />
          <button className="btn" onClick={() => this.addNote()}>Add note</button>
        </div>
        <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column' }}>
          {s.notes.map(n => <li key={n.id} style={{ display: 'grid', gridTemplateColumns: '112px minmax(0,1fr) auto', gap: 12, padding: '12px 0', borderTop: '1px solid #EEF2F6', fontSize: 14, lineHeight: 1.5 }}><span style={{ color: '#425466', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{fmt(parse(n.date))}</span><span style={{ whiteSpace: 'pre-wrap' }}>{n.text}</span><button className="x" style={{ alignSelf: 'start' }} title="Remove" onClick={() => this.removeIn('notes', n.id)}>×</button></li>)}
        </ul>
        {!s.notes.length && <p style={{ margin: '12px 0 0', fontSize: 13.5, color: '#425466' }}>No notes yet.</p>}
      </section>
      <p style={{ margin: '28px 0 0', fontSize: 12.5, color: '#8898AA', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}><span>Saved on this device only.</span><button className="link" style={{ fontSize: 12.5, color: '#8898AA', textDecoration: 'underline' }} onClick={() => this.resetAll()}>Clear all data</button></p>
    </>;
  }

  renderPassport(d) {
    const p = this.state.passport;
    const rowStyle = on => ({ color: on ? '#0A2540' : '#425466', fontWeight: on ? 600 : 400 });
    const feeRows = [
      ['10-year adult passport', money(163.5), p.type === '10'], ['5-year adult passport', money(122.5), p.type === '5'],
      ['In person at a passport office', '10 business days', p.method === 'office'], ['By mail or Service Canada centre', '20 business days', p.method === 'mail'],
      ['Online (IRCC portal)', '20 business days', p.method === 'online'], ['Express, in person only', '2–9 days · +$50', false], ['Urgent, in person only', 'Next business day · +$110', false]
    ];
    return <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 24px', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="rise"><h1 className="page-title">Then, the <em>passport</em></h1><p style={{ margin: '10px 0 0', fontSize: 14, color: '#425466', maxWidth: 560, textWrap: 'pretty' }}>{d.oathDone ? 'Your oath is recorded. Apply with your citizenship certificate, two photos and a guarantor.' : 'Your oath is not recorded yet, so proof of citizenship will be the last item. Everything else can be lined up now.'}</p></div>
        <Seg items={PSTATUS} active={p.status} pick={id => this.setP('status', id)} />
      </div>
      <section className="grid" style={{ marginTop: 28, gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 className="h2">Application</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 12.5, color: '#425466' }}>Passport type</span><Seg style={{ alignSelf: 'flex-start' }} items={[['10', '10-year · ' + money(163.5)], ['5', '5-year · ' + money(122.5)]]} active={p.type} pick={id => this.setP('type', id)} /></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 12.5, color: '#425466' }}>How you'll submit</span><Seg style={{ alignSelf: 'flex-start' }} items={PMETHOD} active={p.method} pick={id => this.setP('method', id)} /></div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label className="lbl">Submitted on<input type="date" className="inp" value={p.submitted} onChange={e => this.setP('submitted', e.target.value)} /></label>
            <label className="lbl">Received on<input type="date" className="inp" value={p.received} onChange={e => this.setP('received', e.target.value)} /></label>
          </div>
          <div style={{ padding: '22px 22px 20px', borderRadius: 16, background: 'radial-gradient(70% 90% at 100% 0%,#1877F2 0%,rgba(42,59,92,0) 70%),linear-gradient(160deg,#0F4FA8,#0A2540)', color: '#fff', minHeight: 170, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 18, boxShadow: 'inset 0 0 0 1px rgba(191,218,255,.3),0 12px 30px -18px rgba(10,37,64,.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, letterSpacing: '.22em', textTransform: 'uppercase', color: '#BFDAFF' }}><span>Canada</span><span>{p.type === '10' ? '10-year' : '5-year'}</span></div>
            <div className="serif" style={{ fontSize: 30, lineHeight: 1, letterSpacing: '-.01em' }}>Passport</div>
            <div><div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#BFDAFF' }}>Expected ready</div>
              <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-.02em', marginTop: 4 }}>{d.recD ? 'Received ' + fmt(d.recD) : d.subD ? fmt(addBiz(d.subD, d.bizDays)) : '—'}</div>
              <div style={{ fontSize: 12.5, color: '#BFDAFF', marginTop: 3 }}>{d.recD ? 'Done' : d.subD ? d.bizDays + ' business days after ' + fmt(d.subD, { month: 'short', day: 'numeric' }) + '; refund if over 30' : 'Enter the submission date'}</div></div>
          </div>
        </div>
        <div className="card">
          <h2 className="h2">Fees and processing times</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, fontSize: 14 }}><tbody>
            {feeRows.map(([l, v, on]) => <tr key={l}><td style={{ padding: '9px 0', borderBottom: '1px solid #EEF2F6', ...rowStyle(on) }}>{l}</td><td style={{ padding: '9px 0', borderBottom: '1px solid #EEF2F6', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', ...rowStyle(on) }}>{v}</td></tr>)}
          </tbody></table>
          <p style={{ margin: '12px 0 0', fontSize: 12.5, color: '#425466', lineHeight: 1.5 }}>Fees changed on March 31, 2026 and now adjust yearly. Since April 1, 2026 the fee is refunded automatically if a complete application takes more than 30 business days. Confirm on canada.ca before paying.</p>
        </div>
      </section>
      <section className="panel" style={{ marginTop: 14 }}>
        <div className="row-between" style={{ padding: '18px 20px 12px' }}><h2 className="h2">Requirements</h2><span style={{ fontSize: 13, color: '#425466' }}>{d.pDone} of {d.pItems.length} ready</span></div>
        {d.pItems.map(i => (
          <div key={i.def.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px', alignItems: 'center', padding: '12px 20px', borderTop: '1px solid #EEF2F6' }}>
            <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flex: '1 1 320px', minWidth: 0, cursor: 'pointer' }}><input type="checkbox" className="chk" style={{ marginTop: 2 }} checked={i.done} onChange={() => this.setPItem(i.def.id, 'done', !i.done)} /><span style={{ fontSize: 14, lineHeight: 1.45, color: i.done ? '#425466' : '#0A2540', textWrap: 'pretty' }}>{i.def.label}</span></label>
            <input type="text" className="inp sm soft" style={{ flex: '1 1 200px', maxWidth: 320, padding: '0 10px' }} placeholder={i.def.ph} value={i.note} onChange={e => this.setPItem(i.def.id, 'note', e.target.value)} />
          </div>
        ))}
      </section>
    </>;
  }

  render() {
    const d = this.derive(), tab = this.state.tab;
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <div className="ambient" />
        {this.renderHeader(d)}
        <main>
          {tab === 'process' ? this.renderProcess(d) : tab === 'passport' ? this.renderPassport(d) : this.renderOverview(d)}
        </main>
      </div>
    );
  }
}
