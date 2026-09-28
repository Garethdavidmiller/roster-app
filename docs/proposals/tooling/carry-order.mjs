// CARRY A ROTATION'S WEEK STRUCTURE ONTO ANOTHER DUTY TABLE (28 Sep 2026) — how Familiar Nine started from Right Away.
// A fresh anneal on a new table did not get back to Right Away's quality in the time given (6–7 single rest days where
// Right Away has 2, a factor present), so a new table's result said more about the search than the table. This keeps
// the structure instead. On each day, Right Away's duties (on its working
// lines) and the new table's duties are both sorted by start then finish and paired in order — an early stays the
// nearest early, a closer stays a closer — so weekends, rest days and the shape of every week are kept, and only the
// clock times move. Both days hold the same number of duties (14 / 14 / 10), so the pairing is a bijection.
//   node carry-order.mjs <table.json> <out.json> <source rotation.json>
import { readFileSync, writeFileSync } from 'node:fs';
const [TABLE, OUT, SRC_] = process.argv.slice(2);
if (!SRC_) { console.error('usage: node carry-order.mjs <table.json> <out.json> <source rotation.json>'); process.exit(2); }
const SRC = SRC_;
const src = JSON.parse(readFileSync(SRC, 'utf8')); const p = structuredClone(src.patterns ?? src);
const slots = JSON.parse(readFileSync(TABLE, 'utf8')).slots;
const DAYS = ['sun','mon','tue','wed','thu','fri','sat'];
const cls = d => d === 'sun' ? 'sun' : d === 'sat' ? 'sat' : 'weekday';
const key = t => t.replace('-', '');
for (const d of DAYS) {
  const lines = Object.keys(p).filter(k => p[k][d] !== 'RD' && p[k][d] !== 'SPARE').sort((a, b) => key(p[a][d]).localeCompare(key(p[b][d])));
  const want = slots.flatMap(r => Array(r[cls(d)]).fill(r.time)).sort((a, b) => key(a).localeCompare(key(b)));
  if (want.length !== lines.length) throw new Error(`${d}: ${lines.length} duties in the rotation, ${want.length} in the table`);
  lines.forEach((k, i) => { p[k][d] = want[i]; });
}
writeFileSync(OUT, JSON.stringify({ patterns: p }, null, 1));
