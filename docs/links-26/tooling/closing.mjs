// THE CLOSING WEEKS AND THE SWITCHES, AS THE LEAGUE READS THEM (8 Nov 2026). The owner set the design target that day: "no
// consecutive closing weeks, with changes between early and late duties placed around useful rest breaks", weeks on one shift
// time "still Important". An outside review the owner passed on the same day asked for the closing weeks to be measured
// directly, and the switches by the rest around them; the audit that followed (README.md → "The league reweighted for the
// design target") measured every design this way, and the main league counts what is here. One module, so the league and any
// sheet that prints these figures read one definition.
//
// What each figure is, cover weeks aside throughout (a cover week's duties are the clerk's to place, so it is neither a closing
// week nor a switch, and it breaks a run):
//   closeRun   the most closing weeks in a row, lapping the rotation. A CLOSING WEEK has three or more of its five weekdays
//              finishing at 23:00 or later. Not "its most common duty is the close", the shortlist sheet's first reading:
//              that can be a tie, broken by the earlier weekday, and three or more of five has none (the sheet's second
//              reading, which it asserts agrees with the first on every design).
//   close14,   the most closing duties, any day of the week, in any 14 or 21 days in a row: what a run of closes feels like,
//   close21    which a count of whole weeks misses (Middle Ground never puts two closing weeks together, and still has 10 in
//              some 21 days, where Level Crossing has 7).
//   switches,  changes between earlies and lates the link fixes, a year each; `swNoBreak` the ones with fewer than two rest
//   swNoBreak  days between the last duty of one kind and the first of the other, and `minSwitchRestH` the fewest hours off at
//              any switch.
//   open0620   starts at 06:20, the open, a year each: most colleagues prefer the opening shifts (owner, 8 Nov 2026: "Most
//              colleagues prefer the opening shifts, but not all"), so more is better, modestly weighted.
//   lerl9      earlies over 8h 30m Monday to Friday, or over 9h 00m on a Saturday, a year each: the owner's brief for Common
//              Ground allowed up to 9 hours at the weekend, so a Saturday 06:20–15:00 is not a long early here. The sheets'
//              "shifts over 8h 30m, Mon–Sat" stay as they are: a fact the sheets report, where this is a weight the league puts
//              on it.
// An early starts before 11:00. A year is the rotation's count scaled to 52 weeks.
//   node closing.mjs <rota.json>...      node closing.mjs --check
import { readFileSync } from 'node:fs';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], WD = ['mon', 'tue', 'wed', 'thu', 'fri'];
const timed = s => /^\d\d:\d\d-\d\d:\d\d$/.test(String(s));
const mm = s => +s.slice(0, 2) * 60 + +s.slice(3, 5);
const start = s => mm(s), end = s => mm(s.slice(6)), len = s => (end(s) - start(s) + 1440) % 1440;
const early = s => start(s) < 11 * 60;
const closes = s => { const e = end(s); return e >= 23 * 60 || e < start(s); };   // finishes at 23:00 or later: the closers

/** @param {Record<string, Record<string, string>>} p a rota, line → day → duty @returns the figures above */
export function closingMeasures(p) {
  const ks = Object.keys(p).sort((a, b) => a - b), L = ks.length, perYear = x => x * 52 / L;
  const cover = k => DAYS.every(d => p[k][d] === 'SPARE');
  const seq = ks.flatMap(k => DAYS.map(d => ({ s: p[k][d], cover: cover(k) }))), n = seq.length;
  // the closing weeks, in a row, lapping
  const heavy = ks.map(k => !cover(k) && WD.filter(d => timed(p[k][d]) && closes(p[k][d])).length >= 3);
  let closeRun = 0;
  for (let i = 0; i < L; i++) { if (!heavy[i] || heavy[(i + L - 1) % L]) continue; let r = 0; while (r < L && heavy[(i + r) % L]) r++; closeRun = Math.max(closeRun, r); }
  if (heavy.every(Boolean)) closeRun = L;
  // the closes in any 14 and 21 days
  const shut = seq.map(x => !x.cover && timed(x.s) && closes(x.s) ? 1 : 0);
  const most = w => { let best = 0; for (let i = 0; i < n; i++) { let c = 0; for (let j = 0; j < w; j++) c += shut[(i + j) % n]; best = Math.max(best, c); } return best; };
  // the switches: two passes, so the first switch of the rotation sees the last duty before it
  let last = null, restDays = 0, lastEnd = 0, sw = 0, swNoBreak = 0, minRest = Infinity;
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) { const x = seq[i];
    if (x.cover) { last = null; restDays = 0; continue; }
    if (!timed(x.s)) { restDays++; continue; }
    const kind = early(x.s) ? 'E' : 'L';
    if (pass === 1 && last && kind !== last) { sw++; if (restDays < 2) swNoBreak++; minRest = Math.min(minRest, ((restDays + 1) * 1440 + start(x.s) - lastEnd) / 60); }
    last = kind; restDays = 0; lastEnd = end(x.s) < start(x.s) ? end(x.s) + 1440 : end(x.s); }
  let open0620 = 0, lerl9 = 0;
  for (const k of ks) for (const d of DAYS) { const s = p[k][d]; if (!timed(s)) continue;
    if (s.startsWith('06:20')) open0620++;
    if (early(s) && ((WD.includes(d) && len(s) > 510) || (d === 'sat' && len(s) > 540))) lerl9++; }
  return { closeRun, close14: most(14), close21: most(21), switches: perYear(sw), swNoBreak: perYear(swNoBreak),
    minSwitchRestH: Number.isFinite(minRest) ? minRest : null, open0620: perYear(open0620), lerl9: perYear(lerl9) };
}

// run as a script, not when imported (leave.mjs's guard: argv[1] is undefined under `node -e`)
if (process.argv[1]?.endsWith('closing.mjs')) {
  const load = f => { const j = JSON.parse(readFileSync(f, 'utf8')); return j.patterns ?? j; };
  if (process.argv[2] === '--check') {
    // PINNED to the audit of 8 Nov 2026, which measured every design with a script of its own before this module existed
    // (README.md → "The league reweighted for the design target"); today's link is report-data.mjs's
    const { today, PACK_DIRS } = await import('./report-data.mjs');
    const { existsSync } = await import('node:fs');
    const R = new URL('../', import.meta.url).pathname;
    const grid = f => { const at = PACK_DIRS.map(d => `${R}${d.replace(/^links-26\/?/, '')}/${f}`).filter(existsSync); return load(at[0]); };
    const kept = f => load(new URL(f, import.meta.url));   // a grid kept in the tooling, out of the pack
    const pins = [
      ["today's link", today().patterns, { closeRun: 1, close14: 5, close21: 6, swNoBreak: 13, open0620: 62.4, lerl9: 0 }],
      ['Level Crossing', grid('Level-Crossing-LC-26-T10.json'), { closeRun: 1, close14: 7, close21: 7, swNoBreak: 0, open0620: 58, lerl9: 0 }],
      ['Middle Ground', grid('Middle-Ground-MG-26-T8.json'), { closeRun: 1, close14: 7, close21: 10, swNoBreak: 2, open0620: 48, lerl9: 0 }],
      // CROSSOVER AND COMMON GROUND, DISCARDED ON 9 NOV 2026, are still the only rotas with four closing weeks in a row. Their grids
      // stay in the tooling, because Level Crossing and Middle Ground were laid from them, so these two pins read them there
      ['Crossover', kept('crossover.json'), { closeRun: 4, close14: 11, close21: 16, swNoBreak: 0, open0620: 58, lerl9: 0 }],
      ['Common Ground', kept('common-ground.json'), { closeRun: 4, close14: 10, close21: 15, swNoBreak: 2, open0620: 48, lerl9: 0 }],
      // the long earlies: In Step's 40 a year were pinned here until it was deleted (8 Nov 2026); Short Run's 20 are now
      ['Short Run', grid('Short-Run-SR-26-F1.json'), { closeRun: 3, close14: 9, close21: 11, swNoBreak: 0, open0620: 60, lerl9: 20 }],
      // "THREE OR MORE" ITSELF. Second Look pinned it, the one design where two weekday closes would have joined a closing week
      // to its neighbour; since it was deleted (8 Nov 2026) no design in the pack tells three from two, so four made-up weeks do:
      // a closing week, then one with two closes and two 22:30 lates. Three or more reads 1; two or more would read 2, four 0
      ['the threshold', (() => { const E = '06:20-14:20', C = '15:45-23:55', M = '14:00-22:30', R = 'RD';
        return { 1: { sun: R, mon: C, tue: C, wed: C, thu: R, fri: R, sat: R }, 2: { sun: R, mon: C, tue: C, wed: M, thu: M, fri: R, sat: R },
          3: { sun: R, mon: E, tue: E, wed: E, thu: E, fri: E, sat: R }, 4: { sun: R, mon: E, tue: E, wed: E, thu: E, fri: E, sat: R } }; })(), { closeRun: 1 }],
    ];
    let bad = 0;
    for (const [name, p, want] of pins) { const got = closingMeasures(p), off = Object.keys(want).filter(k => Math.abs(got[k] - want[k]) > 0.05);
      console.log(`${off.length ? 'FAIL' : 'ok  '} ${name}: ${Object.keys(want).map(k => `${k} ${+got[k].toFixed(1)}`).join(' · ')}${off.length ? ` — expected ${off.map(k => `${k} ${want[k]}`).join(', ')}` : ''}`);
      bad += off.length ? 1 : 0; }
    process.exit(bad ? 1 : 0);
  }
  for (const f of process.argv.slice(2)) console.log(f, JSON.stringify(closingMeasures(load(f))));
}
