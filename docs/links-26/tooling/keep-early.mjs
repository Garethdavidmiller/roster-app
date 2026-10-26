// KEEPING A SHORT EARLY (26 Oct 2026, owner: "will it be easy to sell … when we are losing the 13.35 and 13.45 finishes.
// It is just this was needed to shorten the lates"). What it costs to put N short earlies a weekday back into a design.
//
// The week's total is fixed by the contract and the number of shifts by the 219-day ceiling, so a shorter early has to
// be paid for the same day: each early made shorter by m minutes makes one late m minutes longer, and nothing else
// moves. This tries EVERY placement of those swaps on the rota (one shift per weekday, or N), keeps the placements that
// add at most MAX_MIXED weeks with two shift times in them, scores each with the sheet's own functions, and writes the
// best — fewest hard-limit breaches, then fatigue warnings, then the most one-turn weeks.
//
//   node keep-early.mjs <design.json> <early> <early as kept> <late> <late as paid> <per weekday> [max extra mixed weeks] [out.json]
//   node keep-early.mjs short-run.json 06:20-14:50 06:20-13:45 15:00-22:30 13:55-22:30 2 9 results/keep-1345-short-run-x2.json
//
// It refuses a swap that is not minute-for-minute: the early must lose exactly what the late gains.
import fs from 'node:fs';
import { assess, h55Worst, startMinutes, endMinutes } from './report-data.mjs';
import { LINES } from './link.mjs';

const [file, early, kept, late, paid, perDay, maxMixed = '9', out] = process.argv.slice(2);
if (!paid) throw new Error('usage: node keep-early.mjs <design.json> <early> <early as kept> <late> <late as paid> <per weekday> [max extra mixed] [out.json]');
const len = s => (endMinutes(s) - startMinutes(s) + 1440) % 1440;
if (len(early) - len(kept) !== len(paid) - len(late)) throw new Error(`not minute-for-minute: ${early}→${kept} frees ${len(early) - len(kept)}, ${late}→${paid} takes ${len(paid) - len(late)}`);

const base = JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8')).patterns;
const WK = ['mon', 'tue', 'wed', 'thu', 'fri'], timed = s => /^\d\d:\d\d-\d\d:\d\d$/.test(s);
const choose = (xs, k) => k === 0 ? [[]] : xs.flatMap((x, i) => choose(xs.slice(i + 1), k - 1).map(c => [x, ...c]));
const every = a => a.reduce((acc, xs) => acc.flatMap(p => xs.map(x => [...p, ...x])), [[]]);
const cells = t => every(WK.map(d => choose(Object.keys(base).filter(l => base[l][d] === t).map(l => [l, d]), +perDay)));
const mixed = p => Object.values(p).filter(r => r.mon !== 'SPARE' && new Set(WK.map(d => r[d]).filter(timed)).size > 1).length;
const put = (p, cs, t) => { for (const [l, d] of cs) p[l][d] = t; return p; };

const m0 = mixed(base), E = cells(early), L = cells(late), found = [];
for (const e of E) for (const l of L) {
  const p = put(put(structuredClone(base), e, kept), l, paid);
  if (mixed(p) - m0 > +maxMixed) continue;
  const A = assess(p, LINES), w = h55Worst(p, LINES);
  found.push({ p, hard: A.hard.breaches ?? 0, fat: A.fixed.present, fatW: A.fatigue.present + (w?.adds ? 1 : 0), one: A.feel.oneTurn,
    present: A.fixed.fatigue.results.filter(r => r.status === 'present').map(r => r.code).join(' ') || '–',
    where: `${kept} on ${e.map(([l, d]) => `${l} ${d}`).join(', ')} · ${paid} on ${l.map(([x, d]) => `${x} ${d}`).join(', ')}` });
}
if (!found.length) throw new Error(`no placement within ${maxMixed} extra mixed weeks`);
found.sort((a, b) => a.hard - b.hard || a.fat - b.fat || a.fatW - b.fatW || b.one - a.one);
const B = assess(base, LINES), tally = {};
for (const f of found) { const k = `${f.fat} fatigue · ${f.one} one-turn`; tally[k] = (tally[k] ?? 0) + 1; }
console.log(`${file}: ${perDay} × ${kept} a weekday, each paid by ${late} → ${paid}. ${E.length * L.length} placements, ${found.length} within +${maxMixed} mixed weeks.`);
console.log(`  the design itself: ${B.fixed.present} fatigue warnings, ${B.feel.oneTurn} one-turn weeks`);
console.log(`  placements found: ${Object.entries(tally).map(([k, n]) => `${n} with ${k}`).join('; ')}`);
const best = found[0];
console.log(`  best: ${best.hard} hard-limit breaches · ${best.fat} fatigue (${best.present}) · ${best.one} one-turn weeks · ${best.where}`);
if (out) { fs.writeFileSync(new URL(out, import.meta.url), JSON.stringify({ patterns: best.p }, null, 1) + '\n'); console.log(`  wrote ${out}`); }
