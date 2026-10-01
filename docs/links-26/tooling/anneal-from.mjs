// Anneal FROM a given grid (anneal.mjs's moves, cost and polish, but a chosen start and temperature), so a carried
// structure is improved rather than thrown away. MODE=rules node anneal-from.mjs <start.json> <out.json> <seed> <steps> <T0>   (Second Nature: README.md)
import fs from 'node:fs';
const TL = './';
const { evaluate } = await import(TL + 'anneal.mjs');
const [SRC, OUT, SEED_, STEPS_, T0_] = process.argv.slice(2);
const j = JSON.parse(fs.readFileSync(SRC)); const p = structuredClone(j.patterns ?? j);
const DAYS = ['sun','mon','tue','wed','thu','fri','sat'];
const WORK = Object.keys(p).filter(k => p[k].mon !== 'SPARE');
let seed = Number(SEED_); const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const STEPS = Number(STEPS_), T0 = Number(T0_), T1 = 15;
const clone = q => structuredClone(q);
let cur = evaluate(p).cost, best = cur, bestP = clone(p);
for (let s = 0; s < STEPS; s++) {
  const T = T0 * Math.pow(T1 / T0, s / STEPS); let undo;
  if (rnd() < 0.7) { const d = DAYS[Math.floor(rnd()*7)], a = WORK[Math.floor(rnd()*WORK.length)], b = WORK[Math.floor(rnd()*WORK.length)];
    if (a === b || p[a][d] === p[b][d]) continue; [p[a][d], p[b][d]] = [p[b][d], p[a][d]]; undo = () => { [p[a][d], p[b][d]] = [p[b][d], p[a][d]]; }; }
  else { const a = WORK[Math.floor(rnd()*WORK.length)], b = WORK[Math.floor(rnd()*WORK.length)]; if (a === b) continue; [p[a], p[b]] = [p[b], p[a]]; undo = () => { [p[a], p[b]] = [p[b], p[a]]; }; }
  const c2 = evaluate(p).cost;
  if (c2 <= cur || rnd() < Math.exp((cur - c2) / T)) { cur = c2; if (cur < best) { best = cur; bestP = clone(p); } } else undo();
}
const q = bestP; let c = evaluate(q).cost, imp = true, rounds = 0;
while (imp && rounds++ < 8) { imp = false;
  for (const d of DAYS) for (let i = 0; i < WORK.length; i++) for (let k = i+1; k < WORK.length; k++) { const a = WORK[i], b = WORK[k]; if (q[a][d] === q[b][d]) continue;
    [q[a][d], q[b][d]] = [q[b][d], q[a][d]]; const c2 = evaluate(q).cost; if (c2 < c) { c = c2; imp = true; } else [q[a][d], q[b][d]] = [q[b][d], q[a][d]]; }
  for (let i = 0; i < WORK.length; i++) for (let k = i+1; k < WORK.length; k++) { const a = WORK[i], b = WORK[k]; [q[a], q[b]] = [q[b], q[a]]; const c2 = evaluate(q).cost; if (c2 < c) { c = c2; imp = true; } else [q[a], q[b]] = [q[b], q[a]]; } }
const ev = evaluate(q);
fs.writeFileSync(OUT, JSON.stringify({ variant: 'sa', mode: process.env.MODE ?? 'feel', seed: Number(SEED_), cost: ev.cost, terms: ev.terms, facts: ev.facts, patterns: q }, null, 1));
console.log(OUT.split('/').pop(), Math.round(ev.cost), JSON.stringify(ev.facts));
