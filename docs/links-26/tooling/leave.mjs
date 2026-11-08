// WHAT 14 DAYS OF LEAVE BUYS (2 Oct 2026). The colleague decks quote four leave figures that no sheet computes; the
// 24-line decks' were worked outside this repository, by the method the links-24 README recorded ("The leave
// figures"; that folder was removed on 7 Nov 2026, `git checkout 924b9dbc -- docs/links-24`). This is that method as code, so the 26-line decks' figures can be rebuilt and checked:
// - walk the rotation day by day from every possible first day of leave, and count the days off in a row before a
//   15th day of leave would be needed;
// - a Monday-to-Saturday working day costs one day of leave; a rest day and a Sunday (overtime) cost none; a cover
//   week costs at most four, its first four Monday-to-Saturday days in the stretch;
// - best, average and worst are over every first day; "four full weeks" is the least leave for 28 days in a row
//   starting on a Sunday.
// It reproduces the 24-line decks' published figures (today 30 · 23.4 · 19 · 14, Familiar Nine 28 · 23.6 · 20 · 15),
// which is what `--check` asserts.
//   node leave.mjs <rota.json>...      node leave.mjs --check
import { readFileSync } from 'node:fs';
import { today } from './report-data.mjs';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** Every first day's stretch: the days off in a row that `budget` days of leave buys from each day of the rotation, in order. */
export function leaveRuns(p, budget = 14) { return walk(p, budget).runs; }
export function leave(p, budget = 14) {
  const { runs, four } = walk(p, budget);
  return { best: Math.max(...runs), avg: +(runs.reduce((a, b) => a + b, 0) / runs.length).toFixed(1), worst: Math.min(...runs), fourWeeks: four };
}
// ONE WALK FOR BOTH (8 Nov 2026): the league's "starting days giving 30 days off" reads these runs, so it cannot count leave
// another way
function walk(p, budget) {
  const keys = Object.keys(p).sort((a, b) => a - b), seq = [];
  for (const k of keys) { const cover = DAYS.every(d => p[k][d] === 'SPARE'); for (const d of DAYS) seq.push({ week: k, cover, sun: d === 'sun', rd: p[k][d] === 'RD' }); }
  const n = seq.length;
  const cost = (start, len) => { let c = 0; const used = {}; const out = [];
    for (let i = 0; i < len; i++) { const x = seq[(start + i) % n], wk = `${x.week}|${Math.floor((start + i) / n)}`;
      if (!x.sun && !x.rd) { if (x.cover) { used[wk] = (used[wk] ?? 0) + 1; if (used[wk] <= 4) c++; } else c++; }
      out.push(c); } return out; };
  const runs = []; for (let s = 0; s < n; s++) { const c = cost(s, n); let len = 0; while (len < n && c[len] <= budget) len++; runs.push(len); }
  let four = Infinity; for (let s = 0; s < n; s += 7) four = Math.min(four, cost(s, 28)[27]);
  return { runs, four };
}
// run as a script, not when imported — argv[1] is undefined under `node -e`, which threw on import (30 Oct 2026)
if (process.argv[1]?.endsWith('leave.mjs')) {
  const load = f => { const j = JSON.parse(readFileSync(f, 'utf8')); return j.patterns ?? j; };
  if (process.argv.includes('--check')) {
    const want = [['today', today().patterns, { best: 30, avg: 23.4, worst: 19, fourWeeks: 14 }],
      ['Familiar Nine', load(new URL('./reference-24/Familiar-Nine-F9-24-K31s.json', import.meta.url)), { best: 28, avg: 23.6, worst: 20, fourWeeks: 15 }]];
    let bad = 0; for (const [name, p, w] of want) { const g = leave(p); const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) bad++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(g)}${ok ? '' : ` — the decks say ${JSON.stringify(w)}`}`); }
    process.exit(bad ? 1 : 0);
  }
  for (const f of process.argv.slice(2)) console.log(f, JSON.stringify(leave(load(f))));
}
