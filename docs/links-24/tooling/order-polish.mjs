// THE WEEK ORDER, IMPROVED FROM A FINISHED ROTATION (28 Sep 2026). Right Away's own week order came from four seeded
// anneal runs; this searches onward FROM that result, and keeps a move only if the rotation stays at least as good as
// its starting point on everything a sheet reports — so a result it writes is an improvement or nothing.
//
// Every move is a same-day swap between two working lines or a swap of two whole working lines, so each day's
// duties — and with them every December rule, the fit, the shift times and the 35-hour average — are untouched.
// A move is REFUSED if it would give: a rest under 12h or a run over six days; any fatigue factor present, or any
// fatigue figure worse than the start's (clear is not enough when a figure can sit at its threshold — the first
// attempt found 16 one-turn weeks by pushing FF11 to 13); a heavier or lighter Mon–Sat week than the start's; a
// larger typical week-to-week move of start time (FF18's figure); more single rest days, a longer run of weeks on
// one turn, or any week of 3 or 6 days (the second attempt split the rest days into nine singles and added a
// six-day week). Among what is left it prefers, in weight order, weekends off, weeks on one shift time (the 11:00
// split the sheets count), an even week, and a smaller week-to-week move.
//
//   node order-polish.mjs <start.json> <results/best-RF-<label>.json> <seed> <iterations> <label>
//   MODE=rules node order-polish.mjs results/best-RF-34.json results/best-RF-34o.json 1 60000 34o    # Right Away's order, improved (be01f0db)
// The output is a candidate in the search's own shape (variant, mode, seed, cost, facts, patterns) — cost and facts
// from anneal.mjs's evaluate — so final.mjs picks it by the same rule as every seeded run. MODE must match the start's
// (anneal.mjs reads it when imported, and the two modes score on different scales: 12,700 against 38,060 for the same
// rotation), so a mismatch is refused rather than written.
import { readFileSync, writeFileSync } from 'node:fs';
import { runDesignChecks, DAYS } from '../../../links-design.js';
import { assessFatigue } from '../../../links-fatigue.js';
import { scoreOrder } from '../../../links-adjacency.js';
import { feel, dutyMinutes } from './report-data.mjs';
import { evaluate } from './anneal.mjs';

const SRC = process.argv[2], OUT = process.argv[3], SEED = Number(process.argv[4] ?? 1), ITERS = Number(process.argv[5] ?? 40000), LABEL = process.argv[6] ?? `o${SEED}`;
const src = JSON.parse(readFileSync(SRC, 'utf8')); const p = src.patterns ?? src;
if (src.mode && src.mode !== (process.env.MODE ?? 'feel')) throw new Error(`the start was scored in MODE=${src.mode}; run with MODE=${src.mode} so the written cost is comparable`);
const KEYS = Object.keys(p);
const WORK = KEYS.filter(k => !Object.values(p[k]).includes('SPARE'));
let MAXH = Infinity, MINH = -Infinity, MAXSTEP = Infinity, BASE = { iso: Infinity, block: Infinity }; let CAP = null;
let seed = SEED; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

function score(q) {
  const c = runDesignChecks(q, 24);
  if (c.turnarounds.length || c.longestStretch > 6) return null;
  const f = assessFatigue(q, 24); if (f.present) return null;
  // No fatigue measure may be WORSE than Right Away's own — clear is not enough when a figure can sit at the threshold.
  const vals = f.results.map(r => Number(r.value)); if (CAP && vals.some((v, i) => Number.isFinite(v) && Number.isFinite(CAP[i]) && v > CAP[i] + 1e-9)) return null;
  const fe = feel(q, 24);
  const wk = WORK.map(k => ['mon','tue','wed','thu','fri','sat'].reduce((a, d) => a + (q[k][d] === 'RD' ? 0 : dutyMinutes(q[k][d])), 0) / 60);
  const a = scoreOrder(q, KEYS, { maxRunTarget: 6 });
  const heavy = Math.max(...wk), light = Math.min(...wk);
  if (heavy > MAXH + 1e-9 || light < MINH - 1e-9) return null;   // never a heavier or lighter week than the start's
  if (a.gentleMean > MAXSTEP) return null;   // nor a bigger typical week-to-week change of start time (FF18's figure)
  // nor more single rest days, a week of 6 days or 3, or a longer run of weeks on one turn
  if (fe.isolatedRest > BASE.iso || a.longestBlock > BASE.block) return null;
  if (WORK.some(k => { const n = DAYS.filter(d => q[k][d] !== 'RD').length; return n > 5 || n < 4; })) return null;
  const s = 1000 * c.weekendsOff + 300 * fe.oneTurn - 100 * Math.max(0, heavy - 42) - 60 * Math.max(0, 28 - light) - a.gentleMean / 10;
  return { s, wk: c.weekendsOff, one: fe.oneTurn, heavy, light, step: a.gentleMean, iso: fe.isolatedRest, block: a.longestBlock };
}
let cur = score(p); if (!cur) throw new Error('start point fails the floor');
MAXH = cur.heavy; MINH = cur.light; MAXSTEP = cur.step; BASE = { iso: cur.iso, block: cur.block }; CAP = assessFatigue(p, 24).results.map(r => Number(r.value));
const start = cur; let best = { ...cur, p: JSON.parse(JSON.stringify(p)) };
for (let i = 0; i < ITERS; i++) {
  const T = 200 * Math.pow(0.5 / 200, i / ITERS);   // gentle annealing so it can step off a plateau
  let undo;
  if (rnd() < 0.75) { const d = DAYS[Math.floor(rnd() * 7)], a = WORK[Math.floor(rnd() * WORK.length)], b = WORK[Math.floor(rnd() * WORK.length)];
    if (a === b || p[a][d] === p[b][d]) continue; [p[a][d], p[b][d]] = [p[b][d], p[a][d]]; undo = () => { [p[a][d], p[b][d]] = [p[b][d], p[a][d]]; }; }
  else { const a = WORK[Math.floor(rnd() * WORK.length)], b = WORK[Math.floor(rnd() * WORK.length)]; if (a === b) continue;
    [p[a], p[b]] = [p[b], p[a]]; undo = () => { [p[a], p[b]] = [p[b], p[a]]; }; }
  const nx = score(p);
  if (nx && (nx.s >= cur.s || rnd() < Math.exp((nx.s - cur.s) / T))) { cur = nx; if (cur.s > best.s) best = { ...cur, p: JSON.parse(JSON.stringify(p)) }; }
  else undo();
}
const r = x => `iso ${x.iso} · block ${x.block} · wkends ${x.wk} · one-turn ${x.one} · heaviest ${x.heavy.toFixed(2)}h · lightest ${x.light.toFixed(2)}h · step ${x.step} · score ${x.s.toFixed(0)}`;
console.log('start', r(start)); console.log('best ', r(best));
const ev = evaluate(best.p);
writeFileSync(OUT, JSON.stringify({ variant: src.variant ?? 'F', mode: 'rules', seed: LABEL, from: SRC.split('/').pop(), polishSeed: SEED, iterations: ITERS, cost: ev.cost, terms: ev.terms, facts: ev.facts, patterns: best.p }, null, 1));
