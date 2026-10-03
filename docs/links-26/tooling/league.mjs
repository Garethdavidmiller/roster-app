// THE WEIGHTED LEAGUE ON EVERY FACTOR the sheets compare (owner, 3 Oct 2026; committed the same day so the figures the
// README and the shortlist sheet quote can be rebuilt). Each factor is scored 0–100 across the range of the designs in
// play (min–max), weighted, summed. The weights are the owner's standing ones and are a judgement, not a measurement.
//   node league.mjs                      proposals alone set the range; today and Familiar Nine shown unranked
//   REF_IN_RANGE=1 node league.mjs       today's link and Familiar Nine inside the range, still unranked (the usual table)
//   DROP=fam node league.mjs             leave factors out (comma-separated keys below) and rescale to 100
//   RUN_FIXED=1 node league.mjs          score the run on the fixed rota instead of the worst case with a cover week
import fs from 'fs';
const R = new URL('../../', import.meta.url).pathname;   // docs/
const M24 = await import(R + 'links-24/tooling/report-data.mjs'), M26 = await import(R + 'links-26/tooling/report-data.mjs');
const { scoreOrder } = await import(new URL('../../../links-adjacency.js', import.meta.url).href);
const { leave } = await import(R + 'links-26/tooling/leave.mjs');
const { daysAYear } = await import(R + 'links-26/tooling/link.mjs');
const load = f => { const j = JSON.parse(fs.readFileSync(R + f)); return j.patterns ?? j; };
const t = s => /^\d/.test(s), restish = s => !t(s) && s !== 'SPARE', DAYS = ['sun','mon','tue','wed','thu','fri','sat'];
const gapOf = p => { const L = Object.keys(p).length, at = []; for (let k = 1; k <= L; k++) if (restish(p[k].sat) && restish(p[k % L + 1].sun)) at.push(k); return Math.max(...at.map((k, i) => i < at.length - 1 ? at[i + 1] - k : at[0] + L - k)); };
const m = s => +s.slice(0, 2) * 60 + +s.slice(3, 5), mins = s => (m(s.slice(6)) - m(s) + 1440) % 1440;
function stat(M, name, p, L, isToday) {
  const T0 = M.today(), TA = { patterns: T0.patterns, ...M.assess(T0.patterns, 20) }, todays = new Set(TA.tableRows.map(r => r.time));
  const A = M.assess(p, L), R2 = M.sheetRules({ patterns: p, ...A }, TA, isToday ? 'today' : 'plan'), fe = A.feel, W = fe.workingLines;
  const work = Object.keys(p).filter(k => p[k].mon !== 'SPARE');
  const wkHours = work.map(k => ['mon','tue','wed','thu','fri','sat'].reduce((s, d) => s + (t(p[k][d]) ? mins(p[k][d]) : 0), 0) / 60);
  let late = 0; for (const k of work) for (const d of DAYS) { const s = p[k][d]; if (t(s) && (m(s.slice(6)) >= 1380 || m(s.slice(6)) < m(s))) late++; }
  const lv = leave(p), a = scoreOrder(p, Object.keys(p), { maxRunTarget: 6 });
  return { name, met: R2.met, fit: (A.office.wkFit + A.office.fits.sat + A.office.fits.sun) / 3, fat: A.fatigue.present, rest: A.rest.minutes, run: process.env.RUN_FIXED === '1' ? A.fixed.run : A.checks.longestStretch,
    wkends: A.checks.weekendsOff / L, gap: gapOf(p), iso: fe.isolatedRest / W, mixed: fe.hybrid / W, one: fe.oneTurn / W, step: a.gentleMean, heavy: Math.max(...wkHours),
    late: late * 52 / L, fam: isToday ? 1 : (fe.distinctTimes - A.tableRows.filter(r => !todays.has(r.time)).length) / fe.distinctTimes,
    lvBest: lv.best, lvWorst: lv.worst, lvFour: lv.fourWeeks, days: daysAYear(p) };
}
const W = { met: 25, fit: 11, fat: 11, rest: 3, run: 3, wkends: 7, gap: 5, iso: 4, mixed: 4, one: 5, step: 3, heavy: 3, late: 5, fam: 6, lvBest: 1, lvWorst: 1, lvFour: 1, days: 2 };
const HI = { met: 1, fit: 0, fat: 0, rest: 1, run: 0, wkends: 1, gap: 0, iso: 0, mixed: 0, one: 1, step: 0, heavy: 0, late: 0, fam: 1, lvBest: 1, lvWorst: 1, lvFour: 0, days: 0 };
const LABEL = { met: 'December rules met', fit: 'Fit to the trains', fat: 'Fatigue warnings (worst case)', rest: 'Shortest rest', run: 'Longest run (worst case)', wkends: 'Full weekends, share of weeks', gap: 'Longest wait between weekends', iso: 'Single rest days, per working week', mixed: 'Mixed weeks, share', one: 'One-turn weeks, share', step: 'Start-time change, week to week', heavy: 'Heaviest week', late: 'Late finishes a year', fam: 'Familiar shift times, share', lvBest: 'Leave: best stretch', lvWorst: 'Leave: worst stretch', lvFour: 'Leave for four weeks off', days: 'Contracted days a year' };
// DROP=k,k: leave factors out and rescale the rest to 100, so a score is still out of 100
for (const k of (process.env.DROP ?? '').split(',').filter(Boolean)) delete W[k];
const SUM = Object.values(W).reduce((a, b) => a + b); for (const k in W) W[k] = W[k] * 100 / SUM;
const P = [['Second Nature','SN-26-F2'],['Second Wind','SW-26-F1'],['Second Sight','SS-26-F1'],['Second Look','SL-26-G3'],['Second Gear','SG-26-H1'],['Second Edition','SE-26-F1'],['Fine Tune','FT-26-H1'],['Even Keel','EK-26-H1'],['Short Run','SR-26-F1'],['Long Break','LB-26-F1']]
  .map(([n, c]) => stat(M26, n, load(`links-26/proposals/${n.replace(' ', '-')}-${c}.json`), 26, false));
P.push(stat(M24, 'Familiar Nine (24)', load('links-24/proposals/Familiar-Nine-F9-24-K31s.json'), 24, false));
const today = stat(M26, "Today's link", M26.today().patterns, 20, true);
const fmt = (k, v) => k === 'fit' || k === 'late' || k === 'days' ? v.toFixed(1) : k === 'rest' || k === 'step' ? `${Math.floor(v / 60)}h${String(Math.round(v % 60)).padStart(2, '0')}` : k === 'heavy' ? `${Math.floor(v)}h${String(Math.round(v % 1 * 60)).padStart(2, '0')}` : ['wkends','iso','mixed','one','fam'].includes(k) ? `${Math.round(v * 100)}%` : String(v);
// REFERENCE ONLY (owner, 3 Oct 2026): today's link and Familiar Nine are scored against the PROPOSALS' range, clamped
// to 0-100, and listed apart, unranked; they never widen or move the range the proposals are judged on.
const REF = P.filter(r => r.name.startsWith('Familiar Nine')).concat([today]), PROPS = P.filter(r => !REF.includes(r));
{ const range = process.env.REF_IN_RANGE ? [...PROPS, ...REF] : PROPS;
  const N = Object.fromEntries(Object.keys(W).map(k => { const v = range.map(r => r[k]), lo = Math.min(...v), hi = Math.max(...v);
    return [k, r => hi === lo ? ((HI[k] ? r[k] >= lo : r[k] <= lo) ? 100 : 0) : Math.max(0, Math.min(100, 100 * (HI[k] ? (r[k] - lo) / (hi - lo) : (hi - r[k]) / (hi - lo))))]; }));
  const score = r => ({ r, total: Object.keys(W).reduce((a, k) => a + W[k] * N[k](r) / 100, 0), pts: Object.fromEntries(Object.keys(W).map(k => [k, W[k] * N[k](r) / 100])) });
  console.log('\n## proposals'); for (const x of PROPS.map(score).sort((a, b) => b.total - a.total)) console.log(x.r.name.padEnd(20), x.total.toFixed(1).padStart(5), ' ', Object.keys(W).map(k => `${k} ${x.pts[k].toFixed(1)}`).join(' · '));
  console.log('\n## reference only'); for (const x of REF.map(score)) console.log(x.r.name.padEnd(20), x.total.toFixed(1).padStart(5), ' ', Object.keys(W).map(k => `${k} ${x.pts[k].toFixed(1)}`).join(' · '));
}
console.log('\n## raw'); console.log('factor (weight)'.padEnd(36), [...P, today].map(r => r.name.slice(0, 12).padStart(13)).join(''));
for (const k of Object.keys(W)) console.log(`${LABEL[k]} (${W[k]})`.padEnd(36), [...P, today].map(r => fmt(k, r[k]).padStart(13)).join(''));
