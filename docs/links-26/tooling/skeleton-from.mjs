// A REST-DAY SKELETON FROM A FINISHED ROTA (26 Oct 2026). skeleton.mjs and exact-skeletons.py search for a layout; this
// reads one off a rota that already works — which days each working line works, and whether its week is early, late or
// mixed — so a second duty table with the same early and late counts each day can be laid on the same weeks
// (skeleton-start.mjs) and searched with the rest days held (space-polish.mjs LOCK_REST=1). Closing Time and Both Ways
// were laid on Home Grown's weeks this way: the weekends, single rest days, runs and leave are Home Grown's by
// construction, and only the times are searched.
//   node skeleton-from.mjs <rota.json> <skeleton.json>
import { readFileSync, writeFileSync } from 'node:fs';
const [SRC, OUT] = process.argv.slice(2);
if (!OUT) { console.error('usage: node skeleton-from.mjs <rota.json> <skeleton.json>'); process.exit(2); }
const p = (j => j.patterns ?? j)(JSON.parse(readFileSync(SRC, 'utf8')));
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], timed = s => /^\d\d:\d\d-\d\d:\d\d$/.test(s), early = s => +s.slice(0, 2) < 11;
const on = {}, fam = {};
for (const k of Object.keys(p)) { if (DAYS.every(d => p[k][d] === 'SPARE')) continue;   // a cover week is not a working line
  on[k] = Object.fromEntries(DAYS.map(d => [d, timed(p[k][d]) ? 1 : 0]));
  const kinds = new Set(DAYS.filter(d => timed(p[k][d])).map(d => early(p[k][d]) ? 'E' : 'L')); fam[k] = kinds.size === 1 ? [...kinds][0] : 'M'; }
writeFileSync(OUT, JSON.stringify({ on, fam }, null, 1));
console.log(`${OUT}: ${Object.keys(on).length} working lines, families ${Object.values(fam).join('')}`);
