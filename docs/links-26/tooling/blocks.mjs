// THE LONGEST BLOCK OF EARLIES OR LATES (5 Oct 2026, owner, of Even Keel's run of lates: "that's a best case/worst case
// thing though isn't it?" — then "you need to do this for all the other proposals too").
// Each week of a rota is all earlies, all lates, mixed, or a cover week (an early starts before 11:00, as everywhere in
// the pack, Sundays included). A BLOCK is weeks in a row of one kind, round the rotation (week 27 is week 1 again).
// A cover week's four duties are placed later by the roster clerk, so it can go either way, and the figure is a range
// in the pack's usual form:
//   fixed — every cover week breaks a block (the figure on the fixed rota);
//   worst — every cover week beside a block takes the same kind and joins it (the "up to").
// A mixed week always breaks a block. Every surface that quotes the figure — page 1 and page 2 of each sheet, the
// shortlist, the summary and the decks' week strip — reads it from here.
//   node blocks.mjs <rota.json>...
import { readFileSync } from 'node:fs';
import { family } from './report-data.mjs';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** One letter per week: E (all earlies), L (all lates), M (both), C (cover week). */
export function weekKinds(p) {
  return Object.keys(p).sort((a, b) => a - b).map(k => {
    const ts = DAYS.map(d => p[k][d]);
    if (ts.every(s => s === 'SPARE')) return 'C';
    const f = new Set(ts.map(family).filter(Boolean));
    return f.size === 1 ? [...f][0] : 'M';
  });
}

/** The longest block of one kind on the fixed rota, and up to how long if the cover weeks beside it go the same way. */
export function kindBlocks(p) {
  const s = weekKinds(p), L = s.length;
  const run = (k, coverJoins) => {
    const ok = x => x === k || (coverJoins && x === 'C');
    if (s.every(ok)) return L;
    let best = 0;
    for (let i = 0; i < L; i++) {
      if (!ok(s[i]) || ok(s[(i - 1 + L) % L])) continue;   // start only where a block starts
      let n = 0; while (n < L && ok(s[(i + n) % L])) n++;
      best = Math.max(best, n);
    }
    return best;
  };
  const fx = { E: run('E', false), L: run('L', false) }, wc = { E: run('E', true), L: run('L', true) };
  return { fixed: Math.max(fx.E, fx.L), worst: Math.max(wc.E, wc.L),
           fixedKind: fx.L >= fx.E ? 'L' : 'E', worstKind: wc.L >= wc.E ? 'L' : 'E', kinds: s.join('') };
}

/** "5 (up to 7)", or just "5" when the cover weeks cannot lengthen it. */
export const blockText = b => b.worst > b.fixed ? `${b.fixed} (up to ${b.worst})` : `${b.fixed}`;

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  for (const f of process.argv.slice(2)) {
    const j = JSON.parse(readFileSync(f, 'utf8')), b = kindBlocks(j.patterns ?? j);
    console.log(`${f}  ${b.kinds}  longest block ${blockText(b)}`);
  }
}
