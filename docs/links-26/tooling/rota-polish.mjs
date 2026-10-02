// POLISH A ROTATION TOWARDS A REFERENCE (28 Sep 2026) — "at least as good as the reference rotation on every measure a
// sheet reports, and better where it can be". Unlike order-polish.mjs, the start need not already meet the reference:
// every shortfall is a penalty, and a result counts only when every penalty is zero ("feasible"); nothing is written as
// feasible that is not. Familiar Nine was polished twice with it (README → "Familiar Nine"). Moves are same-day swaps between working lines and whole-line swaps, so each day's duties never change.
// Right Away's own figures are the reference: anything worse is a penalty, and a result counts only when every
// penalty is zero ("feasible"). Among feasible results the score rewards weekends off, one-turn weeks, an even week.
//   REST_CAP=1 node rota-polish.mjs <start.json> <out.json> <seed> <iters> <reference.json>
// REST_CAP=1 also holds the shortest rest to the reference's. ISO_W=<points> rewards fewer single rest days (below).
import { readFileSync, writeFileSync } from 'node:fs';
import { runDesignChecks, DAYS } from '../../../links-design.js';
import { assessFatigue } from '../../../links-fatigue.js';
import { scoreOrder } from '../../../links-adjacency.js';
import { feel, dutyMinutes, tightestRest } from './report-data.mjs';

const [SRC, OUT, SEED_, ITERS_, REF_] = process.argv.slice(2);
if (!REF_) { console.error('usage: node rota-polish.mjs <start.json> <out.json> <seed> <iters> <reference.json>'); process.exit(2); }
const REF = REF_;
const load = f => { const j = JSON.parse(readFileSync(f, 'utf8')); return j.patterns ?? j; };
const p = load(SRC), rp = load(REF);
const KEYS = Object.keys(p), WORK = KEYS.filter(k => !Object.values(p[k]).includes('SPARE'));
let seed = Number(SEED_ ?? 1); const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const SKIP = new Set(['FF2', 'FF18']);   // standing factors: set by the station's hours and by rotating at all

function measure(q) {
  const c = runDesignChecks(q, Object.keys(q).length), f = assessFatigue(q, Object.keys(q).length), fe = feel(q, Object.keys(q).length), a = scoreOrder(q, KEYS, { maxRunTarget: 6 });
  const wk = WORK.map(k => ['mon','tue','wed','thu','fri','sat'].reduce((s, d) => s + (q[k][d] === 'RD' ? 0 : dutyMinutes(q[k][d])), 0) / 60);
  const days = WORK.map(k => DAYS.filter(d => q[k][d] !== 'RD').length);
  return { turn: c.turnarounds.length, run: c.longestStretch, wkends: c.weekendsOff, present: f.present,
    ff: f.results.map(r => [r.code + r.title, Number(r.value)]), one: fe.oneTurn, iso: fe.isolatedRest, block: a.longestBlock, step: a.gentleMean,
    heavy: Math.max(...wk), light: Math.min(...wk), badDays: days.filter(n => n < 4 || n > 5).length, rest: tightestRest(q, Object.keys(q).length)?.minutes ?? 9999 };
}
const R = measure(rp); const refFF = new Map(R.ff); const ISO_W = Number(process.env.ISO_W ?? 0);
function score(q) {
  const m = measure(q);
  if (m.turn || m.run > 6) return null;
  let pen = m.present * 1e5 + Math.max(0, m.iso - R.iso) * 5000 + Math.max(0, m.block - R.block) * 3000 + m.badDays * 5000
    + Math.max(0, m.heavy - R.heavy) * 1000 + Math.max(0, R.light - m.light) * 1000 + Math.max(0, m.step - R.step) * 50
    + (process.env.REST_CAP ? Math.max(0, R.rest - m.rest) * 100 : 0)
    + Math.max(0, R.wkends - m.wkends) * 4000 + Math.max(0, R.one - m.one) * 2000;
  for (const [k, v] of m.ff) { if (SKIP.has(k.slice(0, 4)) || !Number.isFinite(v)) continue; const r = refFF.get(k); if (Number.isFinite(r) && v > r + 1e-9) pen += (v - r) * 2e4; }
  // ISO_W=<points> also rewards FEWER single rest days than the reference, not only none more (26 lines, 1 Oct 2026: the
  // 26-line searches reach every rule and no fatigue factor, and single rest days are what then separates them).
  const gain = 1000 * m.wkends + 300 * m.one - ISO_W * m.iso - 100 * Math.max(0, m.heavy - 42) - 60 * Math.max(0, 28 - m.light) - m.step / 10;
  return { ...m, pen, s: gain - pen };
}
let cur = score(p); if (!cur) throw new Error('start fails the hard floor (a rest under 12h or a run over 6)');
let best = cur.pen === 0 ? { ...cur, p: structuredClone(p) } : null, bestAny = { ...cur, p: structuredClone(p) };
const ITERS = Number(ITERS_ ?? 60000);
for (let i = 0; i < ITERS; i++) {
  const T = 400 * Math.pow(0.5 / 400, i / ITERS);
  let undo;
  if (rnd() < 0.75) { const d = DAYS[Math.floor(rnd() * 7)], a = WORK[Math.floor(rnd() * WORK.length)], b = WORK[Math.floor(rnd() * WORK.length)];
    if (a === b || p[a][d] === p[b][d]) continue; [p[a][d], p[b][d]] = [p[b][d], p[a][d]]; undo = () => { [p[a][d], p[b][d]] = [p[b][d], p[a][d]]; }; }
  else { const a = WORK[Math.floor(rnd() * WORK.length)], b = WORK[Math.floor(rnd() * WORK.length)]; if (a === b) continue;
    [p[a], p[b]] = [p[b], p[a]]; undo = () => { [p[a], p[b]] = [p[b], p[a]]; }; }
  const nx = score(p);
  if (nx && (nx.s >= cur.s || rnd() < Math.exp((nx.s - cur.s) / T))) { cur = nx;
    if (cur.s > bestAny.s) bestAny = { ...cur, p: structuredClone(p) };
    if (cur.pen === 0 && (!best || cur.s > best.s)) best = { ...cur, p: structuredClone(p) }; }
  else undo();
}
const r = x => `rest ${x.rest} · pen ${x.pen.toFixed(0)} · wkends ${x.wkends} · one-turn ${x.one} · iso ${x.iso} · block ${x.block} · heavy ${x.heavy.toFixed(2)} · light ${x.light.toFixed(2)} · step ${x.step} · present ${x.present}`;
console.log(best ? `FEASIBLE ${r(best)}` : `NONE-FEASIBLE closest ${r(bestAny)}`);
writeFileSync(OUT, JSON.stringify({ feasible: !!best, patterns: (best ?? bestAny).p }, null, 1));
