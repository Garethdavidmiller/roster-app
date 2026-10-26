// TODAY'S LINK, KEPT, WITH SIX WEEKS ADDED (26 Oct 2026, owner: "take the existing roster and add the extra weeks whilst
// minimising the fatigue factors in those weeks"; then, asked, 26 weeks — five working and one cover — no more than 219
// days a year, and the December staffing rules met where that costs no fatigue).
//
// Today's twenty weeks are not touched: every one keeps its shifts, and they stay in their order round the rotation.
// The search chooses where the six new weeks go and what the five working ones hold:
//   · the cover weeks land on lines 1, 6, 11, 16 and 21 (gaps 5, 5, 5, 5, 6 — rule F2), so today's four and the new one
//     decide where today's working weeks can sit;
//   · the new weeks use ONLY today's shift times (rule S9: no more than today's 18), a Sunday duty 8–9 hours (S8) inside
//     the Sunday window;
//   · their Monday-to-Saturday minutes are exactly 5 × 35h (H3) in at most 21 duties (the 219-day ceiling).
// What it minimises, in this order: hard-limit breaches; fatigue instances that touch a new week (every FF8b block, FF19
// jump, backward step, 55-hour window, run of earlies over 4, run of 8-hour shifts over 7, run over 13 without a 48-hour
// break); fatigue factors present on the fixed rota; every fatigue instance anywhere (inserting a week can break one of
// today's); December staffing rules failed, and by how many people; then the week's feel — no new week heavier than
// today's heaviest, one shift time a week, full weekends off.
//
//   node today-plus.mjs <steps> <restarts> <seed> <out.json>
import fs from 'node:fs';
import { today } from './report-data.mjs';
import { DAYS, runDesignChecks } from '../../../links-design.js';
import { assessFatigue, toSequence, earlyBlocksWithShortRecovery, startTimeJumps, rotationDirection, dutyMinutes, isEarlyStart } from '../../../links-fatigue.js';
import { assessHardLimits } from '../../../links-limits.js';

const STEPS = Number(process.argv[2] ?? 100000), RESTARTS = Number(process.argv[3] ?? 2), SEED0 = Number(process.argv[4] ?? 1);
const OUT = process.argv[5];
const L = 26, NEW_MINUTES = 5 * 35 * 60, NEW_DUTIES_MAX = 21, COVER_SLOTS = [1, 6, 11, 16, 21];
const T = today().patterns;
const EXIST = Array.from({ length: 20 }, (_, i) => String(i + 1));
const isCoverRow = r => DAYS.every(d => r[d] === 'SPARE');
const mins = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const st = s => mins(s), en = s => mins(s.slice(6));
const timed = s => /^\d\d:\d\d-\d\d:\d\d$/.test(s);
const len = s => en(s) - st(s);

// ── the shift times a new week may use: today's own ─────────────────────────────────────────────────────────────────
const TODAY_TIMES = [...new Set(EXIST.flatMap(k => DAYS.map(d => T[k][d])).filter(timed))].sort();
const MONSAT = TODAY_TIMES.filter(s => st(s) >= 6 * 60 + 20 && en(s) <= 23 * 60 + 55);
const SUNDAY = TODAY_TIMES.filter(s => st(s) >= 7 * 60 + 15 && en(s) <= 23 * 60 + 25 && len(s) >= 8 * 60 && len(s) <= 9 * 60);
const TODAY_HEAVIEST = Math.max(...EXIST.filter(k => !isCoverRow(T[k])).map(k => DAYS.slice(1).reduce((a, d) => a + (timed(T[k][d]) ? len(T[k][d]) : 0), 0)));
// which times today's link works on which kind of day — a time is familiar where it is already worked
const clsOfDay = d => d === 'sun' ? 'sun' : d === 'sat' ? 'sat' : 'wk';
const WORKED_ON = { wk: new Set(), sat: new Set(), sun: new Set() };
for (const k of EXIST) for (const d of DAYS) if (timed(T[k][d])) WORKED_ON[clsOfDay(d)].add(T[k][d]);
// MODE=staff (the December staffing rules outrank the shape of the week) or MODE=tidy (the shape of the week can
// outweigh a staffing rule) — the owner asked for staffing "where it costs no fatigue"; the week's shape is the next
// question, and the two weightings show what one costs in the other.
const MODE = process.env.MODE ?? 'staff';
const W = MODE === 'tidy' ? { rule: 4000, short: 400 } : { rule: 30000, short: 3000 };
const FEEL = { isolated: 2000, weekend: 3000, hybrid: 1500, extraTime: 600, unfamiliar: 400, sixDay: 800, heavyPerMin: 10 };

// ── every place the six new weeks can go ───────────────────────────────────────────────────────────────────────────
// Today's twenty in their order (any starting point round the cycle), the new cover week on a cover line, the five new
// working weeks on working lines; valid when every one of today's cover weeks lands on a cover line.
function choose(xs, k) { return k === 0 ? [[]] : xs.flatMap((x, i) => choose(xs.slice(i + 1), k - 1).map(c => [x, ...c])); }
function structures() {
  const work = []; for (let pos = 1; pos <= L; pos++) if (!COVER_SLOTS.includes(pos)) work.push(pos);
  const fives = choose(work, 5), out = [];
  for (let o = 0; o < 20; o++) {
    const S = [...EXIST.slice(o), ...EXIST.slice(0, o)];
    for (const c of COVER_SLOTS) for (const ns of fives) {
      const order = []; let k = 0, ok = true;
      for (let pos = 1; pos <= L && ok; pos++) {
        if (pos === c) { order.push('C'); continue; }
        const n = ns.indexOf(pos); if (n >= 0) { order.push('N' + n); continue; }
        const e = S[k++]; if (isCoverRow(T[e]) !== COVER_SLOTS.includes(pos)) ok = false; else order.push(e);
      }
      if (ok) out.push(order);
    }
  }
  return out;
}
const STRUCTS = structures();
const AT = new Map(STRUCTS.map((o, i) => [o.join(','), i]));
// a new week moved one place, past one of today's working weeks — the placement that changes least
function nudge(si) {
  const o = [...STRUCTS[si]], i = o.findIndex((t, k) => t[0] === 'N' && rnd() < 0.3) ; if (i < 0) return si;
  const j = rnd() < 0.5 ? i - 1 : i + 1; if (j < 0 || j >= L || o[j][0] === 'N' || o[j] === 'C' || COVER_SLOTS.includes(j + 1)) return si;
  [o[i], o[j]] = [o[j], o[i]]; return AT.get(o.join(',')) ?? si;
}

// ── PRNG ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
let seed = SEED0; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)];

function build(order, N) {
  const p = {};
  order.forEach((tok, i) => { p[String(i + 1)] = tok === 'C' ? Object.fromEntries(DAYS.map(d => [d, 'SPARE'])) : tok[0] === 'N' ? { ...N[+tok.slice(1)] } : { ...T[tok] }; });
  return p;
}
const fixedOf = p => { const q = {}; for (const k in p) { q[k] = {}; for (const d of DAYS) q[k][d] = p[k][d] === 'SPARE' ? 'RD' : p[k][d]; } return q; };

// ── fatigue instances, each tagged with whether it touches a new week ──────────────────────────────────────────────────
function instances(p, newLines) {
  const seq = toSequence(fixedOf(p), L), n = seq.length, isNew = i => newLines.has(seq[((i % n) + n) % n].line);
  const touch = (a, b) => { for (let i = a; i <= b; i++) if (isNew(i)) return true; return false; };
  const idx = (line, day) => (line - 1) * 7 + DAYS.indexOf(day);
  const out = { all: 0, fresh: 0 };
  const add = t => { out.all++; if (t) out.fresh++; };
  for (const b of earlyBlocksWithShortRecovery(seq)) { const i = idx(b.fromLine, b.fromDay); add(touch(i, i + b.blockLength + 1)); }
  for (const j of startTimeJumps(seq)) { const i = idx(j.line, j.day); add(touch(i, i + 1)); }
  for (const s of rotationDirection(seq).steps) { const i = idx(s.line, s.day); add(touch(i, i + 1)); }
  for (let i = 0; i < n; i++) { let m = 0; for (let k = 0; k < 7; k++) m += dutyMinutes(seq[(i + k) % n].shift) ?? 0; if (m > 55 * 60) add(touch(i, i + 6)); }
  const runs = (pred, over) => {   // maximal runs round the cycle, each counted once
    const start = seq.findIndex(x => !pred(x.shift)); if (start < 0) { add(true); return; }
    let r = 0, from = 0;
    for (let k = 1; k <= n; k++) { const i = start + k; if (pred(seq[i % n].shift)) { if (!r) from = i; r++; } else { if (r > over) add(touch(from, from + r - 1)); r = 0; } }
  };
  runs(isEarlyStart, 4);
  runs(s => (dutyMinutes(s) ?? 0) >= 8 * 60, 7);
  return out;
}

// ── the December staffing rules this search can move (S1–S5; S6–S9 are checked on the result) ────────────────────────
const OPEN = { wk: 380, sat: 380, sun: 435 }, CLOSE = { wk: 1435, sat: 1435, sun: 1405 };
const clsOf = d => d === 'sun' ? 'sun' : d === 'sat' ? 'sat' : 'wk';
function staffing(p) {
  let failed = 0, short = 0; const keys = Object.keys(p);
  const on = d => keys.map(k => p[k][d]).filter(timed);
  const ok = { open: true, close: true, at22: true, office: true };
  for (const d of DAYS) {
    const ds = on(d), c = clsOf(d), op = OPEN[c], cl = CLOSE[c];
    const open = ds.filter(s => st(s) <= op && en(s) > op).length, close = ds.filter(s => st(s) < cl && en(s) >= cl).length;
    const at22 = ds.filter(s => st(s) <= 1320 && en(s) > 1320).length;
    short += Math.max(0, 4 - open) + Math.max(0, 3 - close) + Math.max(0, 5 - at22);
    if (open < 4) ok.open = false; if (close < 3) ok.close = false; if (at22 < 5) ok.at22 = false;
    const by = {}; for (const s of ds) by[s] = (by[s] ?? 0) + 1;
    const pair = c === 'wk' ? (by['06:20-14:20'] ?? 0) >= 2 && (by['14:00-22:30'] ?? 0) >= 2
      : c === 'sat' ? (by['06:20-14:50'] ?? 0) >= 2 && (by['14:30-22:00'] ?? 0) >= 2
      : Object.keys(by).some(s => st(s) === 435 && by[s] >= 2) && Object.keys(by).some(s => en(s) === 1350 && by[s] >= 2);
    if (!pair) ok.office = false;
  }
  const sun = on('sun').length; short += Math.max(0, 10 - sun);
  failed = Object.values(ok).filter(v => !v).length + (sun < 10 ? 1 : 0);
  return { failed, short, sun, ok };
}

// ── the cost ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function cost(si, N) {
  const order = STRUCTS[si], p = build(order, N);
  const newLines = new Set(order.map((t, i) => t[0] === 'N' ? i + 1 : 0).filter(Boolean));
  let monSat = 0, duties = 0; const weeks = [];
  for (const w of N) { let m = 0; for (const d of DAYS.slice(1)) if (timed(w[d])) { m += len(w[d]); duties++; } monSat += m; weeks.push(m); }
  const contract = Math.abs(monSat - NEW_MINUTES), over = Math.max(0, duties - NEW_DUTIES_MAX);
  const checks = runDesignChecks(p, L), hard = assessHardLimits(p, L).breaches + (checks.turnarounds?.short ?? checks.turnarounds?.length ?? 0);
  const inst = instances(p, newLines), fixed = assessFatigue(fixedOf(p), L).present, worst = assessFatigue(p, L).present;
  const sf = staffing(p);
  // the week's shape, as the sheets count it (report-data.mjs feel()): single rest days anywhere, full weekends off
  // anywhere, and in each new week one turn, one kind, familiar times, no six-day week, no week over today's heaviest
  const seq = []; for (let i = 1; i <= L; i++) for (const d of DAYS) seq.push(p[String(i)][d]);
  let isolated = 0; for (let i = 0; i < seq.length; i++) if (seq[i] === 'RD' && seq[(i + seq.length - 1) % seq.length] !== 'RD' && seq[(i + 1) % seq.length] !== 'RD') isolated++;
  let feel = FEEL.isolated * isolated - FEEL.weekend * (checks.weekendsOff ?? 0);
  for (const m of weeks) if (m > TODAY_HEAVIEST) feel += FEEL.heavyPerMin * (m - TODAY_HEAVIEST);
  for (const w of N) {
    const ts = new Set(DAYS.slice(1, 6).map(d => w[d]).filter(timed)); feel += FEEL.extraTime * Math.max(0, ts.size - 1);
    const fam = new Set(DAYS.map(d => w[d]).filter(timed).map(s => st(s) < 660 ? 'E' : 'L')); if (fam.size > 1) feel += FEEL.hybrid;
    for (const d of DAYS) if (timed(w[d]) && !WORKED_ON[clsOfDay(d)].has(w[d])) feel += FEEL.unfamiliar;
    feel += FEEL.sixDay * Math.max(0, DAYS.filter(d => timed(w[d])).length - 5);
  }
  const total = 1e9 * hard + 2e6 * contract + 1e8 * over + 1e6 * inst.fresh + 3e5 * fixed + 1e5 * Math.max(0, worst - 5) + 3e4 * inst.all + 1e4 * worst
    + W.rule * sf.failed + W.short * sf.short + feel;
  return { total, hard, contract, over, fresh: inst.fresh, all: inst.all, fixed, worst, failed: sf.failed, short: sf.short, isolated, weekends: checks.weekendsOff, feel, duties, monSat };
}

// ── moves ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const options = d => d === 'sun' ? ['RD', ...SUNDAY] : ['RD', ...MONSAT];
function randomWeek() {   // a 4-day week of one time, early or late, as a starting point
  const w = Object.fromEntries(DAYS.map(d => [d, 'RD'])); const t = pick(MONSAT);
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].sort(() => rnd() - 0.5).slice(0, 4); for (const d of days) w[d] = t; return w;
}
// The contract to the minute: swap one duty for a time of today's whose length closes the gap exactly. Without it a
// search can settle five minutes short (a 13:35 where a 13:40 would balance), where no single move is downhill.
function repair(M) {
  let gap = NEW_MINUTES; for (const w of M) for (const d of DAYS.slice(1)) if (timed(w[d])) gap -= len(w[d]);
  if (!gap) return;
  const cells = []; for (const w of M) for (const d of DAYS.slice(1)) if (timed(w[d])) { const want = len(w[d]) + gap, fits = MONSAT.filter(s => len(s) === want); if (fits.length) cells.push([w, d, fits]); }
  if (cells.length) { const [w, d, fits] = pick(cells); w[d] = pick(fits); }
}
function neighbour(si, N) {
  const M = N.map(w => ({ ...w })); let s2 = si; const r = rnd();
  if (r < 0.05) repair(M);
  else if (r < 0.40) { const w = pick(M), d = pick(DAYS); w[d] = pick(options(d)); }
  else if (r < 0.60) { const a = pick(M), b = pick(M), d = pick(DAYS); [a[d], b[d]] = [b[d], a[d]]; }
  else if (r < 0.75) { const w = pick(M), i = 1 + Math.floor(rnd() * 5), j = i + 1; const d = DAYS[i], e = DAYS[j]; if (rnd() < 0.5) w[e] = w[d]; else w[d] = w[e]; if (e === 'sun' || d === 'sun') { /* never */ } }
  else if (r < 0.85) { const w = pick(M), d = pick(DAYS.slice(1)), e = pick(DAYS.slice(1)); [w[d], w[e]] = [w[e], w[d]]; }
  else if (r < 0.90) { const i = Math.floor(rnd() * 5), j = Math.floor(rnd() * 5); [M[i], M[j]] = [M[j], M[i]]; }
  else if (r < 0.97) s2 = nudge(si);
  else s2 = Math.floor(rnd() * STRUCTS.length);
  return [s2, M];
}

// ── anneal ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// START=<a result of this script> polishes that result instead of starting at random (TEMP= sets the opening temperature)
const START = process.env.START ? JSON.parse(fs.readFileSync(process.env.START, 'utf8')) : null;
let best = null;
for (let r = 0; r < RESTARTS; r++) {
  let si = Math.floor(rnd() * STRUCTS.length), N = Array.from({ length: 5 }, randomWeek);
  if (START) { si = AT.get(START.order.join(',')); N = START.order.map((t, i) => [t, START.patterns[String(i + 1)]]).filter(([t]) => t[0] === 'N').sort(([a], [b]) => a.localeCompare(b)).map(([, w]) => ({ ...w })); }
  let c = cost(si, N);
  let bestRun = { si, N, c };
  const T0 = Number(process.env.TEMP ?? 2e5), T1 = 20;
  for (let step = 0; step < STEPS; step++) {
    const temp = T0 * Math.pow(T1 / T0, step / STEPS);
    const [s2, M] = neighbour(si, N), c2 = cost(s2, M);
    if (c2.total <= c.total || rnd() < Math.exp((c.total - c2.total) / temp)) { si = s2; N = M; c = c2; if (c.total < bestRun.c.total) bestRun = { si, N, c }; }
  }
  console.log(`restart ${r}: ${JSON.stringify(bestRun.c)}`);
  if (!best || bestRun.c.total < best.c.total) best = bestRun;
}
console.log(`structures ${STRUCTS.length}; best ${JSON.stringify(best.c)}`);
console.log('order', STRUCTS[best.si].join(' '));
for (const [i, w] of best.N.entries()) console.log(`N${i}`, DAYS.map(d => w[d]).join(' '));
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ patterns: build(STRUCTS[best.si], best.N), order: STRUCTS[best.si], cost: best.c }, null, 1) + '\n');
