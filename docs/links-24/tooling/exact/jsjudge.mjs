// Judge grids with the SHEETS' OWN code: node jsjudge.mjs in.json out.json   (in: array of pattern objects)
import { readFileSync, writeFileSync } from 'node:fs';
import { assess, currentRules, today } from '../report-data.mjs';
import { assessFatigue } from '../../../../links-fatigue.js';
import { runDesignChecks, dutyMinutes } from '../../../../links-design.js';
import { assessHardLimits } from '../../../../links-limits.js';
const T0 = today(); const TA = { patterns: T0.patterns, ...assess(T0.patterns, 20) };
const grids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = grids.map(p => {
  const A = assess(p, 24), R = currentRules({ patterns: p, ...A }, TA), F = assessFatigue(p, 24), C = runDesignChecks(p, 24), H = assessHardLimits(p, 24);
  const factors = {}; for (const r of F.results) if (r.status === 'present') factors[r.code === 'MRSF' ? 'MRSF:' + r.title : r.code] = true;
  let monSat = 0; for (const k in p) for (const d of ['mon','tue','wed','thu','fri','sat']) { const s = p[k][d]; if (s !== 'RD' && s !== 'SPARE') monSat += dutyMinutes(s); }
  return { rules: Object.fromEntries(R.rows.map(r => [r.key, r.ok])), met: R.met, present: F.present, factors, turn: C.turnarounds.length, run: C.longestStretch, breaches: H.breaches, monSat, weekends: C.weekendsOff };
});
writeFileSync(process.argv[3], JSON.stringify(out));
