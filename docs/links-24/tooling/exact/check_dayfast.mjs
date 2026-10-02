// Checks dayfast.mjs against the sheets' own code (report-data.mjs) on random Weekday Lates grids: the weekday fit,
// the weekday floor, the headcounts and the office pairs. SPEC=wl-spec.json (from mixspec.py).
import { readFileSync } from 'node:fs';
import { evalDay, meanFit } from './dayfast.mjs';
const M = await import('../report-data.mjs');
const T0 = M.today(); const TA = { patterns: T0.patterns, ...M.assess(T0.patterns, 20) };
const spec = JSON.parse(readFileSync(process.env.SPEC ?? 'wl-spec.json', 'utf8'));
const j = JSON.parse(readFileSync(new URL('../../proposals/Weekday-Lates-WL-24-EXT.json', import.meta.url),'utf8')); const base = j.patterns ?? j;
const work = Object.keys(base).filter(k => base[k].mon !== 'SPARE');
const WD = ['mon','tue','wed','thu','fri'];
let bad = 0, ok = 0;
for (let it = 0; it < 300; it++) {
  const p = JSON.parse(JSON.stringify(base)); const cols = {};
  for (const d of WD) { cols[d] = [];
    for (const k of work) { let v = p[k][d]; if (Math.random() < 0.3) { const dm = spec.domain[d]; v = Math.random() < 0.2 ? 'RD' : dm[Math.floor(Math.random() * dm.length)]; }
      if (it % 2) { /* force pairs */ } p[k][d] = v; if (v !== 'RD') cols[d].push(v); } }
  if (it % 2) for (const d of WD) { const ks = work.slice(0, 4); ['06:20-14:20','06:20-14:20','14:00-22:30','14:00-22:30'].forEach((t, i) => { p[ks[i]][d] = t; }); cols[d] = work.map(k => p[k][d]).filter(v => v !== 'RD'); }
  const A = M.assess(p, 24), R = M.currentRules({ patterns: p, ...A }, TA);
  const ev = WD.map(d => evalDay(cols[d], 'weekday'));
  const wk = meanFit(ev.map(e => e.fc));
  const fl = R.rows.find(r => r.key === 'floor').value; const wkFloor = +fl.replace('fewest ', '').split('·')[0];
  const mism = [wk !== A.office.wkFit && 'wk', Math.min(...ev.map(e => e.floor)) !== wkFloor && 'floor',
    WD.some((d, i) => A.heads.open[d] !== ev[i].open || A.heads.close[d] !== ev[i].close || A.heads.at22[d] !== ev[i].at22) && 'heads',
    WD.every((d, i) => ev[i].named) !== R.pairDays.filter(d => WD.includes(d)).length === 5 && 'named'].filter(Boolean);
  if (mism.length) { bad++; if (bad < 4) console.log(mism, wk, A.office.wkFit, wkFloor, ev.map(e=>e.floor)); } else ok++;
}
console.log('agree', ok, 'disagree', bad);
