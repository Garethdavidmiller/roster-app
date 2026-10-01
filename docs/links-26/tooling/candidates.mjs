// The sheet's own figures for each candidate rota. node candidates.mjs <rota.json>...   (26-line rotas only; sorted hard limits, fatigue, weekends, single rest days, one-turn weeks)
import fs from 'node:fs';
const TL = './';
const M = await import(TL + 'report-data.mjs'); const { LINES, daysAYear } = await import(TL + 'link.mjs');
const T0 = M.today(), TA = { patterns: T0.patterns, ...M.assess(T0.patterns, 20) }; const todays = new Set(TA.tableRows.map(r => r.time));
const rows = [];
for (const f of process.argv.slice(2)) { const j = JSON.parse(fs.readFileSync(f)); const p = j.patterns ?? j; if (Object.keys(p).length !== LINES) continue;
  const A = M.assess(p, LINES); const P = { patterns: p, ...A }; const R = M.sheetRules(P, TA), F = M.flexibleRules(P, TA);
  const w = M.h55Worst(p, LINES);
  rows.push({ f: f.split('/').pop().replace('.json',''), rules: `${R.met}/${R.of}`, flex: `${F.met}/${F.of}`, fat: A.fixed.present, fatW: A.fatigue.present + (w?.adds ? 1 : 0),
    run: A.fixed.run, runW: A.checks.longestStretch, wkends: A.checks.weekendsOff, rest: A.rest?.minutes, one: A.feel.oneTurn, iso: A.feel.isolatedRest,
    fit: [A.office.wkFit, A.office.fits.sat, A.office.fits.sun].map(x => +x.toFixed(1)).join('·'), times: A.feel.distinctTimes, newT: A.tableRows.filter(r => !todays.has(r.time)).length,
    days: +daysAYear(p).toFixed(1), hard: A.hard.breaches ?? 0 }); }
rows.sort((a, b) => a.hard - b.hard || a.fat - b.fat || a.fatW - b.fatW || b.wkends - a.wkends || a.iso - b.iso || b.one - a.one);
for (const r of rows) console.log(Object.entries(r).map(([k, v]) => `${k}=${v}`).join(' '));
