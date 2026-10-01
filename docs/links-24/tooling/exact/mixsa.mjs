// Search each day's DUTY MIX (how many of each shift time) for the fewest edits from Weekday Lates that bring the
// floor fit under a target on every day class, with every day's December rows passing (waivers: 16:25 closers,
// Saturday 12), Monday–Saturday exactly 42,000 minutes, and no more than TMAX distinct times in the week.
// An "edit" is one cell that must change for the mix to change — a lower bound on the rota's changes.
//   node mixsa.mjs <wkTarget> <satTarget> <sunTarget> <iterations> <seed> [out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { evalDay, meanFit } from './dayfast.mjs';
const [TW, TS, TU, ITER, SEED] = process.argv.slice(2, 7).map(Number); const OUT = process.argv[7];
const TMAX = +(process.env.TMAX ?? 18);
const spec = JSON.parse(readFileSync(process.env.SPEC ?? 'wl-spec.json', 'utf8'));
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], WD = ['mon', 'tue', 'wed', 'thu', 'fri'];
const cls = d => d === 'sun' ? 'sun' : d === 'sat' ? 'sat' : 'weekday';
const V = Object.fromEntries(DAYS.map(d => [d, [...spec.domain[d], 'RD']]));
const dur = t => { const [a, b] = t.split('-'); const f = x => +x.slice(0, 2) * 60 + +x.slice(3); let e = f(b); if (e <= f(a)) e += 1440; return e - f(a); };
let rng = SEED * 2654435761 % 4294967296 || 1; const rnd = () => (rng = (rng * 1664525 + 1013904223) % 4294967296) / 4294967296;
const base = Object.fromEntries(DAYS.map(d => { const c = {}; for (const v of spec.base[d]) c[v] = (c[v] ?? 0) + 1; return [d, c]; }));
let st = Object.fromEntries(DAYS.map(d => [d, { ...base[d] }]));
if (process.env.START) { const g = JSON.parse(readFileSync(process.env.START, 'utf8')); const p = g.patterns ?? g; const work = Object.keys(p).filter(k => p[k].mon !== 'SPARE');
  st = Object.fromEntries(DAYS.map(d => { const c = {}; for (const k of work) c[p[k][d]] = (c[p[k][d]] ?? 0) + 1; return [d, c]; })); }
const list = c => Object.entries(c).flatMap(([v, n]) => v === 'RD' ? [] : Array(n).fill(v));
const cache = {};
function day(d) { return cache[d] ??= evalDay(list(st[d]), cls(d), 12); }
function edits() { let e = 0; for (const d of DAYS) for (const [v, n] of Object.entries(st[d])) e += Math.max(0, n - (base[d][v] ?? 0)); return e; }
function score() {
  let pen = 0; const E = Object.fromEntries(DAYS.map(d => [d, day(d)]));
  for (const d of DAYS) if (!E[d].ok) pen += 30 + (E[d].floor < 2 ? 10 : 0);
  let mins = 0; for (const d of [...WD, 'sat']) for (const [v, n] of Object.entries(st[d])) if (v !== 'RD') mins += dur(v) * n;
  pen += Math.abs(mins - 42000) / 5;
  const times = new Set(); for (const d of DAYS) for (const [v, n] of Object.entries(st[d])) if (v !== 'RD' && n) times.add(v);
  pen += Math.max(0, times.size - TMAX) * 10;
  const wk = meanFit(WD.map(d => E[d].fc)), sat = E.sat.fit, sun = E.sun.fit;
  const over = Math.max(0, wk - TW) + Math.max(0, sat - TS) + Math.max(0, sun - TU);
  const ed = edits();
  const WE = +(process.env.W_ED ?? 1);
  return { s: WE * ed + 3 * over + 5 * pen + 0.001 * (wk + sat + sun), feasible: pen === 0 && over === 0, legal: pen === 0, ed, wk, sat, sun, mins, times: times.size, bad: DAYS.filter(d => !E[d].ok) };
}
let cur = score(), best = null, bestLegal = null, T = 3;
console.error('start', JSON.stringify({ ed: cur.ed, wk: cur.wk, sat: cur.sat, sun: cur.sun, feasible: cur.feasible, mins: cur.mins, times: cur.times }));
for (let it = 0; it < ITER; it++) {
  T = 3 * Math.pow(0.02 / 3, it / ITER);
  const d = DAYS[Math.floor(rnd() * 7)], c = st[d];
  const have = Object.entries(c).filter(([, n]) => n > 0); const [from] = have[Math.floor(rnd() * have.length)];
  const to = V[d][Math.floor(rnd() * V[d].length)]; if (to === from) continue;
  c[from]--; c[to] = (c[to] ?? 0) + 1; delete cache[d];
  // a PAIRED move keeps Monday–Saturday at exactly 42,000: when this change moves the total, pick at random one second
  // change (any Monday–Saturday cell) that moves it back by exactly the same amount
  let comp = null;
  const dd = d === 'sun' ? 0 : (to === 'RD' ? 0 : dur(to)) - (from === 'RD' ? 0 : dur(from));
  if (dd !== 0 && rnd() < 0.9) {
    const opts = [];
    for (const d2 of [...WD, 'sat']) for (const [f2, n2] of Object.entries(st[d2])) { if (n2 <= 0) continue; const fd = f2 === 'RD' ? 0 : dur(f2);
      for (const t2 of V[d2]) { if (t2 === f2) continue; if ((t2 === 'RD' ? 0 : dur(t2)) - fd === -dd) opts.push([d2, f2, t2]); } }
    if (opts.length) { comp = opts[Math.floor(rnd() * opts.length)]; const [d2, f2, t2] = comp; st[d2][f2]--; st[d2][t2] = (st[d2][t2] ?? 0) + 1; delete cache[d2]; }
  }
  const nx = score();
  if (nx.s <= cur.s || rnd() < Math.exp((cur.s - nx.s) / T)) { cur = nx;
    if (nx.legal && (!bestLegal || nx.wk + nx.sat + nx.sun < bestLegal.wk + bestLegal.sat + bestLegal.sun)) bestLegal = { ed: nx.ed, wk: nx.wk, sat: nx.sat, sun: nx.sun, times: nx.times };
    if (nx.feasible && (!best || nx.ed < best.ed || (nx.ed === best.ed && nx.wk + nx.sat + nx.sun < best.wk + best.sat + best.sun))) best = { ...nx, mix: JSON.parse(JSON.stringify(st)) }; }
  else { if (comp) { const [d2, f2, t2] = comp; st[d2][t2]--; st[d2][f2]++; delete cache[d2]; } c[to]--; c[from]++; delete cache[d]; }
}
console.log(JSON.stringify({ target: [TW, TS, TU], seed: SEED, bestLegal, last: { ed: cur.ed, wk: cur.wk, sat: cur.sat, sun: cur.sun, bad: cur.bad, mins: cur.mins, times: cur.times }, best: best && { ed: best.ed, wk: best.wk, sat: best.sat, sun: best.sun, times: best.times } }));
if (OUT && best) writeFileSync(OUT, JSON.stringify(best));
