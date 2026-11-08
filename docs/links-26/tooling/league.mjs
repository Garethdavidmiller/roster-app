// THE WEIGHTED LEAGUE ON EVERY FACTOR the sheets compare (owner, 3 Oct 2026; committed the same day so the figures the
// README and the shortlist sheet quote can be rebuilt). Each factor is scored 0–100 across the range of the designs in
// play (min–max), weighted, summed. The weights are the owner's standing ones and are a judgement, not a measurement.
//   node league.mjs                      proposals alone set the range; today and Familiar Nine shown unranked
//   REF_IN_RANGE=1 node league.mjs       today's link and Familiar Nine inside the range, still unranked (the usual table)
//   LEAGUE=31oct node league.mjs         the main league of 31 Oct to 8 Nov 2026, kept as an alternative (below)
//   DROP=fam node league.mjs             leave factors out (comma-separated keys below) and rescale to 100
//   RUN_FIXED=1 node league.mjs          score the run on the fixed rota instead of the worst case with a cover week
//   JSON=<file> node league.mjs          also write the whole table as JSON (weights, points, raw values, totals)
//   WEIGHTS=met:35,fat:20,… node league.mjs   other weights, only the factors named (the 24-line standing league, below)
//   OLD_READINGS=1 node league.mjs       the league as it was weighted before 31 Oct 2026, kept as the alternative (below):
//                                        no long earlies or closing shift, the fit averaged over the three day types, the
//                                        55-hour cover week left out. It combines with every switch above
//   FAM_SUNDAY=1 node league.mjs         the main league with the Sunday duties counted in familiar shift times, as it was
//                                        read from 31 Oct to 3 Nov 2026 (below)
//
// THE MAIN LEAGUE SINCE 8 NOV 2026 COUNTS THE CLOSING WEEKS (owner, 8 Nov 2026: "Make the changes you mentioned", of the
// league read for the design target set that day — "no consecutive closing weeks, with changes between early and late duties
// placed around useful rest breaks … Weeks on one shift time is still Important"). The method was written before any figure
// was published (README.md → "The league reweighted for the design target"), and two things back it that the weights were not
// tuned to: the target came first, and an outside reviewer's own weights put the same two designs first. What changed:
//   · GATES, NOT POINTS: the nine December rules and the 219-day ceiling. Every design passes both, so as factors they handed
//     every design the same 25 points of 100 and made the gaps look smaller. A design that fails a gate is listed after every design
//     that passes, whatever it scores;
//   · FATIGUE SHOWN APART: the worst-case warnings are in the table beside the score, not inside it, as the decks show them;
//   · THE CLOSING WEEKS AND THE SWITCHES (closing.mjs): the most closing weeks in a row, the most closes in any 14 and any 21
//     days, the switches between earlies and lates without two rest days, and the late finishes beside them;
//   · ONE MEASURE OF WEEKLY CONSISTENCY: the weeks on one shift time. The weeks mixing earlies and lates moved with it almost
//     exactly, so the two counted one property twice, and the change of start, which overlaps both, is halved, not dropped:
//     it is the only measure of how far a start moves between weeks;
//   · OPENING SHIFTS A MODEST GAIN (owner: "Most colleagues prefer the opening shifts, but not all");
//   · LONG EARLIES OVER 9 HOURS ON A SATURDAY, not 8h 30m: the owner's brief for Common Ground allowed 9 at the weekend;
//   · LEAVE A TENTH OF THE SCORE, with the starting days that give 30 days off for 14 beside the three figures it had;
//   · CATEGORIES AND CLOSE ALTERNATIVES: each design's points by category, and the places it takes when every category's
//     weight moves by about 40% and every measure's by about 30%, 4,000 times — a band of places, not one, because a small
//     change of weights reorders designs a point apart.
// Six categories, weighted as below and rescaled to 100 (CATS). The weights are a judgement, the owner's to change.
//
// THE MAIN LEAGUE FROM 31 OCT TO 8 NOV 2026 WAS THE REWEIGHTED ONE (LEAGUE=31oct since; owner: "Use your weights and fix the league", after asking "Are
// we weighting correctly in the tables?"; then "Keep the old leagues as alternatives, but this should now be the main
// one"). Weighted as before, 74 of the 100 points were the same for all three shortlisted designs, and the two things the
// owner had said decide between them scored nothing, so the order turned on margins under a point. Four changes:
//   · LONG EARLIES (lerl, weight 5, the same as late finishes): earlies over 8h 30m Monday to Saturday, a year each — the
//     owner's worry about In Step ("the length of the main early shift"). Earlies, not every long shift: today's long
//     shifts are its 8h 45m closers, which every design shortens and the closing-shift factor already scores;
//   · THE CLOSING SHIFT (close, weight 3): the average length of the Monday-to-Saturday closing duties, weighted by how
//     many are worked — the shortlist sheet's own priority, and the shifts the colleague decks call the ones people dislike
//     most;
//   · THE FIT BY DAYS: the weekday's fit counts five times, as five days of the week — it was the mean of the three day
//     types, so one Saturday counted as much as five weekdays;
//   · THE 55-HOUR COVER WEEK in the fatigue worst case: the sheets and decks say "up to 1" for it (h55Worst, report-data.mjs)
//     and the league scored 0, under a label that says worst case.
// The other weights are unchanged; with the two new ones every weight is rescaled to 100, as DROP= does. The JSON says
// which weighting it holds (`oldReadings`), so a page or a check reading it can refuse the wrong one.
//
// FAMILIAR SHIFT TIMES ARE MONDAY TO SATURDAY SINCE 3 NOV 2026 (owner: "Familiar shift times shouldn't apply to Sunday in
// the league"). Sunday is overtime, not a contracted day, and its duties barely differ between the designs here (README →
// "Familiar shift times count the Monday-to-Saturday duties only"), so a design's Sunday duties are left out of the
// factor, new or familiar: it is the share of the design's Monday-to-Saturday
// shift times that are one of today's times. "Today's times" is unchanged — any time today's link works, Sunday
// included — so a weekday 07:15–15:45, worked today only on a Sunday, is still familiar, as the pack has always called it
// (README → "one of today's times"). The weight is unchanged. FAM_SUNDAY=1 counts the Sunday duties as before, to
// rebuild the main league's figures of 31 Oct to 3 Nov 2026; OLD_READINGS=1 counts them too, because that league is kept
// as it was read. The JSON says which (`famSunday`).
import fs from 'fs';
const R = new URL('../../', import.meta.url).pathname;   // docs/
const M24 = await import(R + 'links-26/tooling/reference-24/report-data.mjs'), M26 = await import(R + 'links-26/tooling/report-data.mjs');
const { scoreOrder } = await import(new URL('../../../links-adjacency.js', import.meta.url).href);
const { leave, leaveRuns } = await import(R + 'links-26/tooling/leave.mjs');
const { daysAYear, DAYS_CEILING } = await import(R + 'links-26/tooling/link.mjs');
const { closingMeasures } = await import(R + 'links-26/tooling/closing.mjs');
const load = f => { const j = JSON.parse(fs.readFileSync(R + f)); return j.patterns ?? j; };
const OLD = process.env.OLD_READINGS === '1', FAM_SUNDAY = OLD || process.env.FAM_SUNDAY === '1';
const READING = OLD ? 'old' : process.env.LEAGUE === '31oct' ? '31oct' : 'closing';
if (process.env.LEAGUE && !['31oct', 'closing'].includes(process.env.LEAGUE)) { console.error(`LEAGUE: "${process.env.LEAGUE}" is not 31oct or closing`); process.exit(2); }
const t = s => /^\d/.test(s), restish = s => !t(s) && s !== 'SPARE', DAYS = ['sun','mon','tue','wed','thu','fri','sat'];
const gapOf = p => { const L = Object.keys(p).length, at = []; for (let k = 1; k <= L; k++) if (restish(p[k].sat) && restish(p[k % L + 1].sun)) at.push(k); return Math.max(...at.map((k, i) => i < at.length - 1 ? at[i + 1] - k : at[0] + L - k)); };
const m = s => +s.slice(0, 2) * 60 + +s.slice(3, 5), mins = s => (m(s.slice(6)) - m(s) + 1440) % 1440;
function stat(M, name, p, L, isToday) {
  const T0 = M.today(), TA = { patterns: T0.patterns, ...M.assess(T0.patterns, 20) };
  // familiar shift times (the header): the design's times worked on a weekday or a Saturday, unless FAM_SUNDAY; today's
  // times are every time today's link works, Sunday included, either way
  const famTimes = rows => rows.filter(r => FAM_SUNDAY || r.weekday > 0 || r.sat > 0).map(r => r.time);
  const A = M.assess(p, L), R2 = M.sheetRules({ patterns: p, ...A }, TA, isToday ? 'today' : 'plan'), fe = A.feel, W = fe.workingLines;
  const work = Object.keys(p).filter(k => p[k].mon !== 'SPARE');
  const wkHours = work.map(k => ['mon','tue','wed','thu','fri','sat'].reduce((s, d) => s + (t(p[k][d]) ? mins(p[k][d]) : 0), 0) / 60);
  let late = 0; for (const k of work) for (const d of DAYS) { const s = p[k][d]; if (t(s) && (m(s.slice(6)) >= 1380 || m(s.slice(6)) < m(s))) late++; }
  const lv = leave(p), a = scoreOrder(p, Object.keys(p), { maxRunTarget: 6 }), todays = new Set(TA.tableRows.map(r => r.time)), mine = famTimes(A.tableRows);
  const MS = ['mon','tue','wed','thu','fri','sat'], h55 = M26.h55Worst(p, L);   // one 55-hour reading for every link, today's included
  const lerl = Object.values(p).reduce((s, r) => s + MS.filter(d => t(r[d]) && m(r[d]) < 11 * 60 && mins(r[d]) > 510).length, 0) * 52 / L;
  const closing = Object.values(p).flatMap(r => MS.map(d => r[d]).filter(s => t(s) && s.endsWith('-23:55')).map(mins));
  const cm = closingMeasures(p), runs = leaveRuns(p);
  return { name, lerl, close: closing.reduce((a, b) => a + b, 0) / closing.length,
    closeRun: cm.closeRun, close14: cm.close14, close21: cm.close21, swNoBreak: cm.swNoBreak, open0620: cm.open0620, lerl9: cm.lerl9,
    pos30: runs.filter(x => x >= 30).length / runs.length, rulesOf: R2.of,
    met: R2.met, fit: OLD ? (A.office.wkFit + A.office.fits.sat + A.office.fits.sun) / 3 : (5 * A.office.wkFit + A.office.fits.sat + A.office.fits.sun) / 7,
    fat: A.fatigue.present + (!OLD && h55?.adds ? 1 : 0), rest: A.rest.minutes, run: process.env.RUN_FIXED === '1' ? A.fixed.run : A.checks.longestStretch,
    wkends: A.checks.weekendsOff / L, gap: gapOf(p), iso: fe.isolatedRest / W, mixed: fe.hybrid / W, one: fe.oneTurn / W, step: a.gentleMean, heavy: Math.max(...wkHours),
    late: late * 52 / L, fam: isToday ? 1 : mine.filter(s => todays.has(s)).length / mine.length,
    lvBest: lv.best, lvWorst: lv.worst, lvFour: lv.fourWeeks, days: daysAYear(p) };
}
const W31 = { met: 25, fit: 11, fat: 11, rest: 3, run: 3, wkends: 7, gap: 5, iso: 4, mixed: 4, one: 5, step: 3, heavy: 3, late: 5, fam: 6, lvBest: 1, lvWorst: 1, lvFour: 1, days: 2, lerl: 5, close: 3 };
// THE CLOSING-WEEKS LEAGUE'S SIX CATEGORIES (8 Nov 2026; the header). Each weight is out of 83 here and rescaled to 100 below,
// so a category's share is its sum over 83: the closing weeks and switches 18%, rest and weekends 24%, leave 12%, earlies and
// consistency 18%, the fit 13%, the duties 14%
const CATS = {
  closing: { label: 'Closing weeks and switches', w: { closeRun: 5, close21: 3, close14: 2, swNoBreak: 3, late: 2 } },
  rest: { label: 'Rest and weekends', w: { wkends: 6, gap: 4, iso: 4, run: 3, rest: 3 } },
  leave: { label: 'Leave', w: { lvBest: 3, lvWorst: 2, lvFour: 2, pos30: 3 } },
  earlies: { label: 'Earlies and weekly consistency', w: { one: 6, step: 1.5, open0620: 3.5, lerl9: 4 } },
  fit: { label: 'Fit to the trains', w: { fit: 11 } },
  duties: { label: 'Duty lengths and familiar times', w: { fam: 6, close: 3, heavy: 3 } },
};
const W = READING === 'closing' ? Object.assign({}, ...Object.values(CATS).map(c => ({ ...c.w }))) : { ...W31 };
if (OLD) { delete W.lerl; delete W.close; }
const HI = { lerl: 0, close: 0, met: 1, fit: 0, fat: 0, rest: 1, run: 0, wkends: 1, gap: 0, iso: 0, mixed: 0, one: 1, step: 0, heavy: 0, late: 0, fam: 1, lvBest: 1, lvWorst: 1, lvFour: 0, days: 0,
  closeRun: 0, close14: 0, close21: 0, swNoBreak: 0, open0620: 1, lerl9: 0, pos30: 1 };
const LABEL = { met: 'December rules met', fit: OLD ? 'Fit to the trains' : 'Fit to the trains, by days', fat: 'Fatigue warnings (worst case)', rest: 'Shortest rest', run: 'Longest run (worst case)', wkends: 'Full weekends, share of weeks', gap: 'Longest wait between weekends', iso: 'Single rest days, per working week', mixed: 'Mixed weeks, share', one: 'One-turn weeks, share', step: 'Start-time change, week to week', heavy: 'Heaviest week', late: 'Late finishes a year', fam: FAM_SUNDAY ? 'Familiar shift times, share' : 'Familiar shift times, Mon–Sat duties, share', lvBest: 'Leave: best stretch', lvWorst: 'Leave: worst stretch', lvFour: 'Leave for four weeks off', days: 'Contracted days a year', lerl: 'Earlies over 8h30, Mon–Sat, a year', close: 'Closing shift, Mon–Sat average',
  closeRun: 'Closing weeks in a row, at most', close14: 'Closes in any 14 days, at most', close21: 'Closes in any 21 days, at most',
  swNoBreak: 'Switches without two rest days, a year', open0620: 'Opening shifts (06:20 starts), a year', lerl9: 'Earlies over 8h30 Mon–Fri or 9h Sat, a year',
  pos30: 'Leave: first days giving 30 days off' };
// WEIGHTS=k:v,… (27 Oct 2026): these factors at these weights instead, every other left out. The 24-line work's standing
// league is WEIGHTS=met:35,fat:20,fit:20,wkends:10,fam:10,run:5 with the proposals alone setting the range (links-24
// README → Silva Lining; that folder was removed on 7 Nov 2026, `git checkout 924b9dbc -- docs/links-24`); its published scores come back to within 0.1 that way with OLD_READINGS=1 (the fit and fatigue as
// they were read then), fatigue and the run read at the worst case
if (process.env.WEIGHTS) { const pairs = process.env.WEIGHTS.split(',').filter(Boolean).map(x => x.split(':'));
  for (const [k] of pairs) if (!(k in W)) { console.error(`WEIGHTS: no factor "${k}" (factors: ${Object.keys(W).join(', ')})`); process.exit(2); }
  for (const k of Object.keys(W)) delete W[k]; for (const [k, v] of pairs) W[k] = Number(v); }
// DROP=k,k: leave factors out and rescale the rest to 100, so a score is still out of 100
for (const k of (process.env.DROP ?? '').split(',').filter(Boolean)) delete W[k];
const SUM = Object.values(W).reduce((a, b) => a + b); for (const k in W) W[k] = W[k] * 100 / SUM;
// The proposals are regenerate.mjs's SUPPLIED list, READ rather than typed (26 Oct 2026): the typed list stopped at the ten
// of 3 Oct, so every later design would have been left out of the league without a word. pack.py reads it the same way.
const SUPPLIED = [...fs.readFileSync(new URL('./regenerate.mjs', import.meta.url), 'utf8').matchAll(/name: '([^']+)',\s*code: '([^']+)'/g)].map(m => [m[1], m[2]]);
// in whichever of the pack's folders the design ships (report-data.mjs PACK_DIRS; the 30-day links in their own since 4 Nov 2026)
const packFile = f => { const at = M26.PACK_DIRS.map(d => `links-26/${d}/${f}`).filter(x => fs.existsSync(R + x));
  if (at.length !== 1) throw new Error(`league: ${f} is in ${at.length} of the pack's folders, not one`); return at[0]; };
const P = SUPPLIED.map(([n, c]) => stat(M26, n, load(packFile(`${n.replace(/ /g, '-')}-${c}.json`)), 26, false));
// EXTRA=<Name>=<grid.json>;… (7 Nov 2026): candidate rotas scored beside the pack's proposals as each would be if it
// shipped — inside the range and ranked — so a search can be judged in the league before anything is rendered or
// committed. A path is read as given (absolute, or from where the command runs); a name the pack already uses is refused
for (const spec of (process.env.EXTRA ?? '').split(';').filter(Boolean)) {
  const i = spec.indexOf('='); if (i < 1) { console.error(`EXTRA: "${spec}" is not Name=grid.json`); process.exit(2); }
  const name = spec.slice(0, i); if (P.some(r => r.name === name)) { console.error(`EXTRA: "${name}" is already a proposal`); process.exit(2); }
  const j = JSON.parse(fs.readFileSync(spec.slice(i + 1), 'utf8')); P.push(stat(M26, name, j.patterns ?? j, 26, false)); }
P.push(stat(M24, 'Familiar Nine (24)', load('links-26/tooling/reference-24/Familiar-Nine-F9-24-K31s.json'), 24, false));
const today = stat(M26, "Today's link", M26.today().patterns, 20, true);
const fmt = (k, v) => k === 'pos30' ? `${(v * 100).toFixed(1)}%` : ['fit', 'late', 'days', 'lerl', 'lerl9', 'swNoBreak', 'open0620'].includes(k) ? v.toFixed(1) : k === 'rest' || k === 'step' || k === 'close' ? `${Math.floor(v / 60)}h${String(Math.round(v % 60)).padStart(2, '0')}` : k === 'heavy' ? `${Math.floor(v)}h${String(Math.round(v % 1 * 60)).padStart(2, '0')}` : ['wkends','iso','mixed','one','fam'].includes(k) ? `${Math.round(v * 100)}%` : String(v);
// REFERENCE ONLY (owner, 3 Oct 2026): today's link and Familiar Nine are scored against the PROPOSALS' range, clamped
// to 0-100, and listed apart, unranked; they never widen or move the range the proposals are judged on.
const REF = P.filter(r => r.name.startsWith('Familiar Nine')).concat([today]), PROPS = P.filter(r => !REF.includes(r));
{ const range = process.env.REF_IN_RANGE ? [...PROPS, ...REF] : PROPS;
  const N = Object.fromEntries(Object.keys(W).map(k => { const v = range.map(r => r[k]), lo = Math.min(...v), hi = Math.max(...v);
    return [k, r => hi === lo ? ((HI[k] ? r[k] >= lo : r[k] <= lo) ? 100 : 0) : Math.max(0, Math.min(100, 100 * (HI[k] ? (r[k] - lo) / (hi - lo) : (hi - r[k]) / (hi - lo))))]; }));
  const score = r => ({ r, total: Object.keys(W).reduce((a, k) => a + W[k] * N[k](r) / 100, 0), pts: Object.fromEntries(Object.keys(W).map(k => [k, W[k] * N[k](r) / 100])) });
  // THE GATES (the closing-weeks league): every December rule met and no more than the contracted days a year. A design that
  // fails one is listed after every design that passes; the other readings score both as factors, as they always have
  const gate = r => READING !== 'closing' || (r.met === r.rulesOf && r.days <= DAYS_CEILING + 1e-9);
  const ranked = PROPS.map(score).sort((a, b) => (gate(b.r) - gate(a.r)) || b.total - a.total);
  // each category's points, out of its share of 100
  const catOf = Object.fromEntries(Object.entries(CATS).map(([c, x]) => [c, Object.keys(x.w).filter(k => k in W)]));
  const cats = READING !== 'closing' ? null : Object.fromEntries(Object.entries(CATS).filter(([c]) => catOf[c].length)
    .map(([c, x]) => [c, { label: x.label, weight: catOf[c].reduce((a, k) => a + W[k], 0), factors: catOf[c] }]));
  const catPts = x => cats && Object.fromEntries(Object.keys(cats).map(c => [c, catOf[c].reduce((a, k) => a + x.pts[k], 0)]));
  // CLOSE ALTERNATIVES (the header): every category's weight moved by a log-normal factor of sigma 0.4 and every measure's within
  // it by 0.3, 4,000 times, from a fixed seed so the band is the same on every run; the places each design takes, as the share
  // first and in the top three, and the place it reaches or beats in 10%, 50% and 90% of the weightings. Over the designs that
  // pass the gates, on the ranges above
  const places = (() => { if (READING !== 'closing') return null;
    let seed = 0x9e3779b9; const rnd = () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };   // mulberry32
    const gauss = () => { const u = Math.max(rnd(), 1e-12), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const ok = ranked.filter(x => gate(x.r)), norm = ok.map(x => Object.fromEntries(Object.keys(W).map(k => [k, N[k](x.r)]))), seen = ok.map(() => []);
    for (let t = 0; t < 4000; t++) { const w = {};
      for (const c of Object.keys(cats)) { const ks = catOf[c], cw = cats[c].weight * Math.exp(0.4 * gauss()), ws = ks.map(k => W[k] * Math.exp(0.3 * gauss())), sum = ws.reduce((a, b) => a + b, 0);
        ks.forEach((k, i) => { w[k] = cw * ws[i] / sum; }); }
      norm.map((n, i) => [Object.keys(w).reduce((a, k) => a + w[k] * n[k], 0), i]).sort((a, b) => b[0] - a[0]).forEach(([, i], place) => seen[i].push(place + 1)); }
    return Object.fromEntries(ok.map((x, i) => { const a = seen[i].sort((p, q) => p - q), at = f => a[Math.floor(f * (a.length - 1))];
      return [x.r.name, { first: a.filter(v => v === 1).length / a.length, top3: a.filter(v => v <= 3).length / a.length, p10: at(0.1), median: at(0.5), p90: at(0.9) }]; })); })();
  const row = x => ({ name: x.r.name, total: x.total, gate: gate(x.r), fatigue: x.r.fat, cats: catPts(x), places: places?.[x.r.name] ?? null, pts: x.pts, raw: Object.fromEntries(Object.keys(W).map(k => [k, x.r[k]])) });
  // JSON=<file> (26 Oct 2026): the whole table — weights, each factor's points and raw value, totals — for a page or a
  // check to read, so the figures are never copied out of this console output by hand
  if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify({ reading: READING, oldReadings: OLD, famSunday: FAM_SUNDAY, refInRange: !!process.env.REF_IN_RANGE, runFixed: process.env.RUN_FIXED === '1',
    dropped: (process.env.DROP ?? '').split(',').filter(Boolean), weightsGiven: process.env.WEIGHTS ?? null, weights: W, labels: LABEL, higherIsBetter: HI, categories: cats,
    gates: READING === 'closing' ? { rules: 'every December rule met', days: `${DAYS_CEILING} contracted days a year or fewer` } : null,
    proposals: ranked.map(row), reference: REF.map(score).map(row) }, null, 1));
  console.log(OLD ? '# the league as weighted before 31 Oct 2026 (OLD_READINGS=1), an alternative' : READING === '31oct' ? (FAM_SUNDAY ? '# the main league as read from 31 Oct to 3 Nov 2026, Sunday duties counted in familiar times (LEAGUE=31oct FAM_SUNDAY=1)'
    : '# the main league of 31 Oct to 8 Nov 2026, familiar times on Monday-to-Saturday duties since 3 Nov (LEAGUE=31oct), an alternative')
    : '# the main league since 8 Nov 2026: the closing weeks and switches, gates for the rules and the days, fatigue apart (LEAGUE=31oct and OLD_READINGS=1 for the ones before)');
  if (cats) { console.log('\n## proposals, by category (each out of its share of 100), fatigue warnings apart, and the places each takes as the weights move');
    console.log(''.padEnd(20), 'total', Object.entries(cats).map(([c, x]) => `${c}/${x.weight.toFixed(0)}`.padStart(11)).join(''), '  fatigue   first  top 3  places (10%–50%–90%)');
    for (const x of ranked) { const r = row(x), pl = r.places;
      console.log(x.r.name.padEnd(20), x.total.toFixed(1).padStart(5), Object.keys(cats).map(c => r.cats[c].toFixed(1).padStart(11)).join(''), String(x.r.fat).padStart(9),
        pl ? `${String(Math.round(100 * pl.first)).padStart(6)}%${String(Math.round(100 * pl.top3)).padStart(6)}%  ${pl.p10}–${pl.median}–${pl.p90}` : '  fails a gate'); } }
  else { console.log('\n## proposals'); for (const x of ranked) console.log(x.r.name.padEnd(20), x.total.toFixed(1).padStart(5), ' ', Object.keys(W).map(k => `${k} ${x.pts[k].toFixed(1)}`).join(' · ')); }
  console.log('\n## reference only'); for (const x of REF.map(score)) console.log(x.r.name.padEnd(20), x.total.toFixed(1).padStart(5), ' ', cats ? Object.keys(cats).map(c => `${c} ${row(x).cats[c].toFixed(1)}`).join(' · ') : Object.keys(W).map(k => `${k} ${x.pts[k].toFixed(1)}`).join(' · '));
}
console.log('\n## raw'); console.log('factor (weight)'.padEnd(36), [...P, today].map(r => r.name.slice(0, 12).padStart(13)).join(''));
for (const k of Object.keys(W)) console.log(`${LABEL[k]} (${W[k].toFixed(1)})`.padEnd(36), [...P, today].map(r => fmt(k, r[k]).padStart(13)).join(''));
