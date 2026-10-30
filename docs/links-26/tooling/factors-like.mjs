// EVERY FATIGUE FACTOR, SIDE BY SIDE (26 Oct 2026, owner: "match or improve on the fatigue factors in short run").
// A sheet counts the factors PRESENT, and every shortlisted design has none, so "match or improve" read only as that
// count is met by any clear rota. This prints each factor's own value instead — the longest run without a 48-hour
// break, the most hours in any seven days, backward against forward steps, and the rest — for the reference grid and
// each grid after it, in the two views the sheets print: the duties the rota fixes (a cover day read as a day off)
// and the worst place a cover week could fall; and the 55-hour worst case with each cover week's four duties placed
// every way (h55Worst). It exits 1 if any grid is worse than the reference on any of them. space-polish.mjs's
// FACTORS_LIKE holds a search to the same comparison.
//   node factors-like.mjs <reference.json> <grid.json> [<grid.json> …]
import { readFileSync } from 'node:fs';
import { assess, h55Worst } from './report-data.mjs';

const files = process.argv.slice(2);
if (files.length < 2) { console.error('usage: node factors-like.mjs <reference.json> <grid.json> [<grid.json> …]'); process.exit(2); }
const num = r => r.code === 'FF17' ? (([b, f]) => b - f)(String(r.value).match(/\d+/g)?.map(Number) ?? [0, 0]) : Number(r.value);
const grids = files.map(f => { const j = JSON.parse(readFileSync(f, 'utf8')), p = j.patterns ?? j, L = Object.keys(p).length, A = assess(p, L);
  return { name: f.split('/').pop().replace(/\.json$/, ''), fixed: A.fixed.fatigue.results, worst: A.fatigue.results, h55: h55Worst(p, L) }; });
const ref = grids[0];
// FF17's value is "11 backward / 12 forward", shown as "11b 12f"
const shown = r => r.code === 'FF17' ? String(r.value).replace(/ backward \/ /, 'b ').replace(/ forward.*/, 'f') : r.value ?? '—';
const cell = r => !r ? '' : `${r.status === 'present' ? '✕ ' : ''}${shown(r)}`;
const W = 30, pad = (s, n) => String(s).slice(0, n - 1).padEnd(n);
console.log(pad('factor (fixed duties / worst case)', 52) + grids.map(g => pad(g.name, W)).join(''));
let worse = 0;
for (const [i, r0] of ref.worst.entries()) {
  // a factor that does not apply, or whose value is a description (FF18's "26-line rotation"), has nothing to compare
  if (!grids.some(g => ['fixed', 'worst'].some(v => g[v][i].status !== 'n/a' && Number.isFinite(num(g[v][i]))))) continue;
  const cols = grids.map(g => { const fx = g.fixed[i], wc = g.worst[i];
    const bad = g !== ref && ['fixed', 'worst'].some(v => { const a = num(g[v][i]), b = num(ref[v][i]); return Number.isFinite(a) && Number.isFinite(b) && a > b; });
    if (bad) worse++; return pad(`${bad ? '▲ ' : ''}${cell(fx)} / ${cell(wc)}`, W); });
  console.log(pad(`${r0.code} ${r0.title}`, 52) + cols.join(''));
}
const hCols = grids.map(g => { const bad = g !== ref && g.h55 && ref.h55 && g.h55.hi > ref.h55.hi; if (bad) worse++; return pad(`${bad ? '▲ ' : ''}${g.h55 ? `${g.h55.table} · up to ${g.h55.hi}` : '—'}`, W); });
console.log(pad('MRSF 55 hours, cover weeks placed every way', 52) + hCols.join(''));
console.log(worse ? `\n▲ ${worse} value${worse === 1 ? '' : 's'} worse than ${ref.name}` : `\nno value worse than ${ref.name}`);
process.exitCode = worse ? 1 : 0;
