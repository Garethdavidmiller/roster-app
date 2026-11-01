// THE JUDGE THE SOLVER IS HELD TO: every verdict model.py encodes, read off a grid by the sheets' own code
// (report-data.mjs assess / sheetRules / flexibleRules / h55Worst, links-fatigue.js). check_model.py pins the model to a
// grid and compares each of its answers with these, both ways round.
//   node judge.mjs <grids.json>      a JSON array of grids (or one grid); prints a JSON array of verdicts
import fs from 'node:fs';
import { assess, today, sheetRules, flexibleRules, h55Worst } from '../report-data.mjs';
import { monSatMinutes, daysAYear } from '../link.mjs';
import { DAYS } from '../../../../links-design.js';

const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const grids = (Array.isArray(raw) ? raw : [raw]).map(j => j.patterns ?? j);
const T0 = today(), TA = { patterns: T0.patterns, ...assess(T0.patterns, 20) };
const timed = s => /^\d\d:\d\d-\d\d:\d\d$/.test(s);
const out = grids.map(p => {
  const A = assess(p, 26), P = { patterns: p, ...A }, R = sheetRules(P, TA), F = flexibleRules(P, TA), w = h55Worst(p, 26);
  const ok = Object.fromEntries(R.rows.map(r => [r.key, r.ok]));
  const fx = Object.fromEntries(F.rows.map(r => [r.key, r.ok]));
  const pres = A.fatigue.results.filter(r => r.status === 'present');
  const has = (code, re) => pres.some(r => r.code === code && (!re || re.test(r.title)));
  let duties = 0; for (const r of Object.values(p)) for (const d of DAYS) if (d !== 'sun' && timed(r[d])) duties++;
  return {
    rules: ok, flex: fx,
    hard: { rest: !A.hard.checks.some(c => /rest|turnaround/i.test(c.id) && c.status !== 'ok'), turnarounds: A.checks.turnarounds.length,
      run: A.checks.longestStretch, monsat: monSatMinutes(p), duties, days: +daysAYear(p).toFixed(2), breaches: A.hard.breaches ?? 0,
      checks: A.hard.checks.map(c => `${c.id}:${c.status}`) },
    factors: { FF8b: has('FF8b'), FF11: has('FF11'), FF15: has('FF15'), MRSF12: has('MRSF', /12 consecutive/), MRSF55: has('MRSF', /55 hours/),
      MRSF8h: has('MRSF', /8h shifts/), FF17: has('FF17'), FF19: has('FF19'), H55W: !!(w && w.hi > 55) },
    present: A.fatigue.present, fixed: A.fixed.present, adds55: !!w?.adds, times: A.feel.distinctTimes, rest: A.rest?.minutes ?? null,
  };
});
console.log(JSON.stringify(out));
