// Fingerprint of the live 20-line main roster — what "feel" means in numbers.
import { weeklyRoster } from '../../../roster-cycle-data.js';
import { runDesignChecks, weeklyHours, lineTotals, classifyShift, dutyMinutes, startMinutes, endMinutes } from '../../../links-design.js';
import { assessFatigue } from '../../../links-fatigue.js';
import { assessHardLimits } from '../../../links-limits.js';
import { scoreOrder } from '../../../links-adjacency.js';
import { buildRosterTargets } from '../../../links-seed.js';

const DAYS = ['sun','mon','tue','wed','thu','fri','sat'];
const L = 20;
const pat = {}; for (let i=1;i<=L;i++) pat[String(i)] = weeklyRoster[String(i)];

const hm = m => `${Math.floor(m/60)}h${String(m%60).padStart(2,'0')}`;
console.log('== hours', JSON.stringify(weeklyHours(pat, L)));
const lt = lineTotals(pat, L); console.log('== lineTotals footer', JSON.stringify(lt.average ?? lt.footer ?? Object.keys(lt)));
console.log('== checks', JSON.stringify(runDesignChecks(pat, L), null, 0).slice(0, 2500));
console.log('== hard', JSON.stringify(assessHardLimits(pat, L)).slice(0, 800));
const ffo = assessFatigue(pat, L); const ff = ffo.results; console.log("== fatigue", JSON.stringify({present:ffo.present, standing:ffo.standing, clear:ffo.clear}));
for (const f of ff) console.log(`  ${f.code.padEnd(5)} ${f.status.padEnd(8)} ${String(f.value ?? '').padStart(6)}  ${f.title}`);
console.log("== adjacency", JSON.stringify(scoreOrder(pat, Object.keys(pat).sort((a,b)=>a-b), {})));

// Slot census by day class
const census = {};
for (let i=1;i<=L;i++) for (const d of DAYS) { const s = pat[i][d]; if (!s || s==='RD' || s==='SPARE') continue; const cls = d==='sun'?'sun':d==='sat'?'sat':'wk'; census[s] ??= {wk:{},sat:0,sun:0}; if (cls==='wk') census[s].wk[d]=(census[s].wk[d]||0)+1; else census[s][cls]++; }
console.log('== slots (time: busiest weekday / sat / sun)');
for (const [t, c] of Object.entries(census).sort((a,b)=>startMinutes(a[0])-startMinutes(b[0]))) console.log(`  ${t}  wk=${Math.max(0,...Object.values(c.wk))} (${JSON.stringify(c.wk)}) sat=${c.sat} sun=${c.sun}  len=${hm(dutyMinutes(t))}`);
// Days worked per line, class mix per line, rest pattern
console.log('== per line');
for (let i=1;i<=L;i++) { const r = pat[i]; const worked = DAYS.filter(d=>r[d]&&r[d]!=='RD'&&r[d]!=='SPARE'); const cls = worked.map(d=>classifyShift(r[d])[0]).join(''); const rests = DAYS.filter(d=>r[d]==='RD').map(d=>d.slice(0,2)).join(','); console.log(`  ${String(i).padStart(2)} ${r.mon==='SPARE'?'SPARE':''} days=${worked.length} mix=${cls.padEnd(7)} rest=${rests}`); }
// daily headcount
console.log('== daily headcount (timed only)');
for (const d of DAYS) console.log(`  ${d}: ${Object.values(pat).filter(r=>r[d]&&r[d]!=='RD'&&r[d]!=='SPARE').length}`);
console.log('== roster seed'); const seed = buildRosterTargets(); console.log(JSON.stringify(seed).slice(0,1200));
