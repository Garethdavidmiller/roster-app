// Everything the PDF states, computed by the app's own modules for BOTH the live roster and the proposal.
import { readFileSync, readdirSync } from 'node:fs';
import { asRosteredRuns } from './cover-placement.mjs';
import { runDesignChecks, weeklyHours, lineTotals, calcHourlyCoverage, classifyShift, startMinutes, endMinutes, endMinutesAbs, dutyMinutes, DAYS, hmFromHours } from '../../../links-design.js';
import { assessFatigue } from '../../../links-fatigue.js';
import { assessHardLimits, MAX_CONSECUTIVE_WORKED_DAYS } from '../../../links-limits.js';
import { scoreOrder, reorderLines, applyOrder, OBJECTIVES } from '../../../links-adjacency.js';
import { DEC_2026_DEMAND, demandBucket, peakCars, movementsOutside, DEC_2026_MOVEMENTS } from '../../../links-demand.js';
import { weeklyRoster } from '../../../roster-cycle-data.js';

export const family = t => { const s = startMinutes(t); if (s === null) return null; return s < 9*60 ? 'E' : 'L'; };

export function feel(p, lines) {
  const keys = Array.from({ length: lines }, (_, i) => String(i+1));
  const work = keys.filter(k => p[k].mon !== 'SPARE');
  let oneTurn = 0, hybrid = 0, isolated = 0, pairedRest = 0, restIslands = 0; const daysHist = {}; const times = new Set();
  const seq = []; for (const k of keys) for (const d of DAYS) seq.push(p[k][d]);
  const n = seq.length;
  for (let i = 0; i < n; i++) { if (seq[i] !== 'RD') continue; const prev = seq[(i+n-1)%n] === 'RD', next = seq[(i+1)%n] === 'RD'; if (!prev) { restIslands++; if (!next) isolated++; else pairedRest++; } }
  for (const k of work) { const row = p[k]; const wk = ['mon','tue','wed','thu','fri'].map(d => row[d]).filter(s => s !== 'RD');
    const fams = new Set(DAYS.map(d => row[d]).filter(s => s !== 'RD').map(family));
    if (new Set(wk).size <= 1 && fams.size <= 1) oneTurn++; if (fams.size > 1) hybrid++;
    const days = DAYS.filter(d => row[d] !== 'RD').length; daysHist[days] = (daysHist[days] ?? 0) + 1;
    for (const d of DAYS) if (row[d] !== 'RD') times.add(row[d]); }
  return { workingLines: work.length, oneTurn, hybrid, isolatedRest: isolated, pairedRest, restIslands, daysHist, distinctTimes: times.size, spareLines: keys.filter(k => p[k].mon === 'SPARE').map(Number) };
}

/** The tightest rest between two ADJACENT timed duties anywhere round the wheel, and where it falls.
 *  The app's own short-turnaround loop, kept to its semantics — adjacent cells only, a cover week has
 *  no times and is skipped, line 24 wraps to line 1, `endMinutesAbs` so a duty past midnight eats the
 *  rest after it — but reporting the MINIMUM rather than only the breaches. Until 24 Sep 2026 the 12h
 *  row on page 5 said "0 rests under 12h" and nothing else, so a design half an hour from the floor
 *  and one three hours from it read identically; Light Retime's 12h30 was in the README and on
 *  no page. */
export function tightestRest(p, lines) {
  const seq = []; for (let k = 1; k <= lines; k++) for (const d of DAYS) seq.push({ line: k, day: d, shift: p[String(k)][d] });
  let best = null;
  for (let t = 0; t < seq.length; t++) {
    const a = seq[t], b = seq[(t + 1) % seq.length];
    const end = endMinutesAbs(a.shift), start = startMinutes(b.shift); if (end === null || start === null) continue;
    const rest = (24 * 60 - end) + start; if (!best || rest < best.minutes) best = { minutes: rest, from: a, to: b };
  }
  return best;
}

/** Cover in PEOPLE-MINUTES per hour for one day — a duty counts in each hour for the minutes it is
 *  actually there, in five-minute steps. This is NOT `calcHourlyCoverage`, which counts a HEAD in every
 *  hour a duty touches: a 06:20 start is a whole person in the 06:00 hour there, and a 23:55 finish a
 *  whole person at 23:00. That is right for the heat map (is anyone on?) and wrong for a FIT, because
 *  the edge hours are exactly where these designs differ. It mattered: on the head-count measure
 *  Light Retime's three retimes made Sunday WORSE (88.2 → 93.2) while on minutes they made it
 *  better (62.4 → 44.9) — and minutes is what `fit.mjs` scored every searched table on. */
export function minuteCover(p, lines, day) {
  const c = new Array(24).fill(0);
  for (let k = 1; k <= lines; k++) { const s = p[String(k)]?.[day]; if (!s || s === 'RD' || s === 'SPARE') continue;
    const st = startMinutes(s), en = endMinutesAbs(s); if (st === null || en === null) continue;
    for (let m = st; m < Math.min(en, 24 * 60); m += 5) c[Math.floor(m / 60)] += 1 / 12; }
  return c;
}
/** Demand fit of one day's cover against the December curve: the squared distance between each
 *  hour's share of the day's traffic and its share of the cover, inside the day's window, ×10⁴ —
 *  lower is better. The formula of `fit.mjs`, which chose the searched tables, applied to a finished
 *  grid. Until 24 Sep 2026 supplied.mjs and final.mjs each carried a copy of it fed with
 *  `calcHourlyCoverage` heads; both now call this. */
const FIT_WIN = { weekday: [6*60+20, 23*60+55], sat: [6*60+20, 23*60+55], sun: [7*60+15, 23*60+25] };
export function dayFit(cov, cls) {
  const [ws, we] = FIT_WIN[cls]; const cars = DEC_2026_DEMAND[cls].cars;
  const hrs = []; for (let h = Math.floor(ws / 60); h <= Math.floor((we - 1) / 60); h++) hrs.push(h);
  const frac = h => Math.max(0, Math.min(we, (h + 1) * 60) - Math.max(ws, h * 60)) / 60;
  const D = hrs.reduce((a, h) => a + cars[h] * frac(h), 0), C = hrs.reduce((a, h) => a + cov[h], 0);
  if (!C) return null;
  return +hrs.reduce((a, h) => a + ((cars[h] * frac(h) / D) - (cov[h] / C)) ** 2 * 1e4, 0).toFixed(1);
}
export const clsOf = d => d === 'sun' ? 'sun' : d === 'sat' ? 'sat' : 'weekday';
/** Per-day fits, for page 4's fit column. */
export const fitsOf = (p, lines) => Object.fromEntries(DAYS.map(d => [d, dayFit(minuteCover(p, lines, d), clsOf(d))]));
/** The fit of the AVERAGE weekday — the `Wk fit` column of every alternatives table. Not the mean of
 *  the five daily fits (the measure is not additive); the fit of the mean cover. */
export function weekdayFit(p, lines = 24) {
  const WDAYS = ['mon', 'tue', 'wed', 'thu', 'fri']; const covs = WDAYS.map(d => minuteCover(p, lines, d));
  return dayFit(Array.from({ length: 24 }, (_, h) => covs.reduce((a, c) => a + c[h], 0) / 5), 'weekday');
}

/** Who is on at the open, through to the close, and still on at 22:00 — PER DAY, computed. Page 3's
 *  "Changed" table typed these four rows as literals (4→4, 2→3, 2→4, 4→5) for every design, on a sheet
 *  whose masthead says its figures are computed, not typed; Cover at Seventeen's page 3 said Saturday
 *  closes with four while its page 5 said three. Same definitions as the December rule rows. */
export function headcounts(p, lines) {
  const keys = Array.from({ length: lines }, (_, i) => String(i + 1));
  const n = (d, f) => keys.filter(k => { const s = p[k][d]; return s !== 'RD' && s !== 'SPARE' && f(s); }).length;
  const out = { open: {}, close: {}, at22: {} };
  for (const d of DAYS) { const sun = d === 'sun';
    out.open[d] = n(d, s => s.startsWith(sun ? '07:15' : '06:20')); out.close[d] = n(d, s => s.endsWith(sun ? '23:25' : '23:55')); out.at22[d] = n(d, s => endMinutes(s) > 22 * 60); }
  return out;
}

// THE TICKET OFFICE IS NOT FLOOR COVER (owner, 27–28 Sep 2026), and it is staffed the same way today as in the
// December plan: Monday to Friday two 06:20–14:20 and two 14:00–22:30, Saturday two 06:20–14:50 and two
// 14:30–22:00. SUNDAY IS THE ONE DIFFERENCE — today it has one late, and that late is one of the three
// 14:30–23:25 closers, in the office until it shuts at 22:30 and on the floor for the last hour; the plan has
// two earlies 07:15–15:30 and two lates 13:30–22:30. [time, people, office-until] — a third element cuts the
// office part short of the duty's own finish. Every sheet compares FLOOR with FLOOR by taking the right
// arrangement out of each side: today's out of today, the plan's out of every proposal. Only Right Away named
// its office turns; for every other design the plan's posts are ASSUMED to be staffed from its duties, and
// its floor is everyone on duty less those posts — the sheet says so where the figures are.
export const OFFICE = {
  today: { weekday: [['06:20-14:20', 2], ['14:00-22:30', 2]], sat: [['06:20-14:50', 2], ['14:30-22:00', 2]], sun: [['07:15-15:45', 2], ['14:30-23:25', 1, '22:30']] },
  plan:  { weekday: [['06:20-14:20', 2], ['14:00-22:30', 2]], sat: [['06:20-14:50', 2], ['14:30-22:00', 2]], sun: [['07:15-15:30', 2], ['13:30-22:30', 2]] },
};
export const officeSpans = (model, cls) => OFFICE[model][cls].map(([t, n, until]) => ({ time: t, st: startMinutes(t), en: until ? +until.slice(0, 2) * 60 + +until.slice(3) : endMinutes(t), n }));
export const officePosts = (model, cls) => OFFICE[model][cls].reduce((a, [, n]) => a + n, 0);
/** Everyone on duty, the office, and the floor, per day — heads per hour on calcHourlyCoverage's own rule so
 *  the three rows add up cell by cell, and the floor's fit on duty minutes with the office's minutes out. */
export function officeSplit(p, lines, hourly, model) {
  const days = {};
  for (const d of DAYS) { const cls = clsOf(d), sp = officeSpans(model, cls);
    const office = Array.from({ length: 24 }, (_, h) => sp.reduce((a, t) => a + (t.st < (h+1)*60 && t.en > h*60 ? t.n : 0), 0));
    const floor = hourly[d].hours.map((v, h) => Math.max(0, v - office[h]));
    const offMin = Array.from({ length: 24 }, (_, h) => sp.reduce((a, t) => a + t.n * Math.max(0, Math.min(t.en, (h+1)*60) - Math.max(t.st, h*60)) / 60, 0));
    const cov = minuteCover(p, lines, d).map((v, h) => Math.max(0, v - offMin[h]));
    days[d] = { office, floor, cov, fit: dayFit(cov, cls) }; }
  const WD = ['mon', 'tue', 'wed', 'thu', 'fri'];
  const wkFit = dayFit(Array.from({ length: 24 }, (_, h) => WD.reduce((a, d) => a + days[d].cov[h], 0) / 5), 'weekday');
  return { model, days, wkFit, fits: { sat: days.sat.fit, sun: days.sun.fit }, posts: { weekday: officePosts(model, 'weekday'), sat: officePosts(model, 'sat'), sun: officePosts(model, 'sun') } };
}
/** The weekday FLOOR fit of a proposal, for the alternatives tables — the plan's office taken out. */
export const weekdayFloorFit = (p, lines = 24) => officeSplit(p, lines, calcHourlyCoverage(p, lines), lines === 20 ? 'today' : 'plan').wkFit;

// THE CURRENT RULES (owner, 27–28 Sep 2026) — the one set every sheet is judged against, so a reader seeing the
// proposals for the first time can put any two side by side. Every row is READ from the cells: the design is
// never asked what it was built for, only what it does. Headcounts are MINIMUMS ("too few is the problem, never
// too many"). The office checks use the plan's posts (OFFICE.plan); a design that does not roster the pairs fails
// that row and has its floor measured with the posts assumed, exactly as page 6 does.
const CLOSE = { weekday: 23*60+55, sat: 23*60+55, sun: 23*60+25 }, OPEN = { weekday: 6*60+20, sat: 6*60+20, sun: 7*60+15 };
const hmm = m => `${Math.floor(m/60)}h${String(m%60).padStart(2,'0')}`;
export function currentRules(P, T) {
  const lines = Object.keys(P.patterns).length, keys = Object.keys(P.patterns);
  const dutiesOn = d => keys.map(k => P.patterns[k][d]).filter(s => s && s !== 'RD' && s !== 'SPARE' && s !== 'OFF' && startMinutes(s) !== null);
  const count = (d, t) => dutiesOn(d).filter(s => s === t).length;
  const WDD = ['mon', 'tue', 'wed', 'thu', 'fri'], ALL = [...WDD, 'sat', 'sun'];
  const H = P.heads, rng = (o, f) => { const v = WDD.map(d => o[d]); const lo = Math.min(...v), hi = Math.max(...v); return `${lo === hi ? lo : `${lo}–${hi}`} · ${o.sat} · ${o.sun}`; };
  // the office pairs this design rosters on day d, or null — Sunday's are ANY two identical 07:15 earlies and
  // two identical lates to 22:30, which is how the owner put it
  const pairsOn = d => { const cls = clsOf(d);
    if (cls !== 'sun') { const [[e], [l]] = OFFICE.plan[cls]; return count(d, e) >= 2 && count(d, l) >= 2 ? { early: e, late: l } : null; }
    const byT = {}; for (const s of dutiesOn(d)) byT[s] = (byT[s] ?? 0) + 1;
    const e = Object.keys(byT).filter(t => startMinutes(t) === OPEN.sun && byT[t] >= 2).sort((a, b) => endMinutes(b) - endMinutes(a))[0];
    const l = Object.keys(byT).filter(t => endMinutes(t) === 22*60+30 && byT[t] >= 2).sort((a, b) => startMinutes(a) - startMinutes(b))[0];
    return e && l ? { early: e, late: l } : null; };
  // the floor: the day's duties with the office taken out — the rostered pairs where there are any, else the plan's posts
  const floorOn = d => { const pr = pairsOn(d); const ds = dutiesOn(d).map(s => ({ s, st: startMinutes(s), en: endMinutes(s) }));
    if (!pr) return { duties: ds, office: officeSpans('plan', clsOf(d)), named: false };
    const out = [...ds]; for (const t of [pr.early, pr.early, pr.late, pr.late]) out.splice(out.findIndex(x => x.s === t), 1);
    return { duties: out, office: [], named: true, pr }; };
  const floorMin = d => { const cls = clsOf(d), f = floorOn(d); let lo = Infinity;
    for (let m = OPEN[cls]; m < CLOSE[cls]; m += 5) lo = Math.min(lo, f.duties.filter(x => x.st <= m && x.en > m).length - f.office.filter(t => t.st <= m && t.en > m).reduce((a, t) => a + t.n, 0));
    return lo; };
  const handover = d => { const cls = clsOf(d), f = floorOn(d), cl = f.duties.filter(x => x.en === CLOSE[cls]);
    let ok = cl.length > 0 && cl.every(c => f.duties.some(x => x.st < c.st && x.en >= c.st + 15));
    if (cls === 'sun' && cl.length) { const last = Math.max(...cl.map(c => c.st)); ok = ok && f.duties.filter(x => x.st === OPEN.sun).every(x => x.en >= last + 15); }
    const overlap = f.named ? endMinutes(f.pr.early) - startMinutes(f.pr.late) : null;
    return { ok, overlap }; };
  const pairs = ALL.map(d => [d, pairsOn(d)]), pairsOk = d => !!pairs.find(([x]) => x === d)[1];
  const wkPairs = WDD.every(pairsOk), satPairs = pairsOk('sat'), sunPairs = pairsOk('sun');
  const fm = Object.fromEntries(ALL.map(d => [d, floorMin(d)])), wkFloor = Math.min(...WDD.map(d => fm[d]));
  const hv = Object.fromEntries(ALL.map(d => [d, handover(d)]));
  const floorHand = ALL.every(d => hv[d].ok), overlaps = ALL.map(d => hv[d].overlap).filter(v => v !== null);
  const sunLens = dutiesOn('sun').map(dutyMinutes);
  const wkClosers = [...new Set(WDD.flatMap(d => dutiesOn(d).filter(s => endMinutes(s) === CLOSE.weekday)))];
  const all = (o, n) => ALL.every(d => o[d] >= n);
  const rows = [
    { key: 'open', rule: 'At least four on at the open, every day', value: rng(H.open), ok: all(H.open, 4), note: '06:20; 07:15 on a Sunday' },
    { key: 'close', rule: 'At least three through to the close, every day', value: rng(H.close), ok: all(H.close, 3), note: '23:55; 23:25 on a Sunday' },
    { key: 'at22', rule: 'At least five still on duty at 22:00, every day', value: rng(H.at22), ok: all(H.at22, 5), note: 'a 22:00 finish is not "on at 22:00"' },
    { key: 'heads', rule: 'Fourteen on a Saturday, ten on a Sunday', value: `${P.daily.sat} · ${P.daily.sun}`, ok: P.daily.sat === 14 && P.daily.sun === 10, note: '' },
    { key: 'cover', rule: 'Four cover weeks, evenly spread', value: `lines ${P.feel.spareLines.join(', ')}`, ok: P.feel.spareLines.length === 4 && P.adj.spareExcess === 0, note: 'whole weeks, placed by the roster clerk' },
    { key: 'office', rule: 'The ticket office: two early and two late, identical turns, every day', value: `Mon–Fri ${wkPairs ? 'yes' : 'no'} · Sat ${satPairs ? 'yes' : 'no'} · Sun ${sunPairs ? 'yes' : 'no'}`, ok: wkPairs && satPairs && sunPairs, note: 'Mon–Fri 06:20–14:20 and 14:00–22:30; Sat 06:20–14:50 and 14:30–22:00; Sun from 07:15 and to 22:30' },
    { key: 'closer', rule: 'Every weekday closer starts at 15:45', value: wkClosers.join(', ') || 'none', ok: wkClosers.length > 0 && wkClosers.every(s => s === '15:45-23:55'), note: '' },
    { key: 'floor', rule: 'At least two on the floor at every moment', value: `fewest ${wkFloor} · ${fm.sat} · ${fm.sun}`, ok: ALL.every(d => fm[d] >= 2), note: 'the ticket office left out; checked every five minutes' },
    { key: 'handover', rule: 'Handovers: 15 minutes to each closer, 20 in the ticket office', value: `floor ${floorHand ? 'yes' : 'no'} · office ${overlaps.length ? `${Math.min(...overlaps)} min` : 'no pairs'}`, ok: floorHand && (overlaps.length === 0 ? false : overlaps.every(v => v >= 20)), note: 'on a Sunday every opener also stays 15 minutes past the last closer arrives' },
    { key: 'sunlen', rule: 'Sunday duties between 8h and 9h', value: sunLens.length ? `${hmm(Math.min(...sunLens))}–${hmm(Math.max(...sunLens))}` : '—', ok: sunLens.length > 0 && sunLens.every(m => m >= 480 && m <= 540), note: '' },
    { key: 'times', rule: 'No more shift times than today', value: `${P.feel.distinctTimes} against today’s ${T.feel.distinctTimes}`, ok: P.feel.distinctTimes <= T.feel.distinctTimes, note: '' },
  ];
  return { rows, met: rows.filter(r => r.ok).length, of: rows.length };
}

// The office model is TODAY'S for the live 20-line link and the PLAN'S for every 24-line proposal; nothing in this
// folder is 20 lines except today's link, and a caller can say otherwise.
export function assess(p, lines, officeModel = lines === 20 ? 'today' : 'plan') {
  const keys = Array.from({ length: lines }, (_, i) => String(i+1));
  const checks = runDesignChecks(p, lines), hours = weeklyHours(p, lines), totals = lineTotals(p, lines);
  const fatigue = assessFatigue(p, lines), hard = assessHardLimits(p, lines), adj = scoreOrder(p, keys, { maxRunTarget: 6 });
  const hourly = calcHourlyCoverage(p, lines);
  // duty table by day class (busiest weekday, sat, sun)
  const table = {};
  for (const k of keys) for (const d of DAYS) { const s = p[k][d]; if (s === 'RD' || s === 'SPARE') continue; const cls = d === 'sun' ? 'sun' : d === 'sat' ? 'sat' : 'weekday';
    table[s] ??= { weekday: {}, sat: 0, sun: 0 }; if (cls === 'weekday') table[s].weekday[d] = (table[s].weekday[d] ?? 0) + 1; else table[s][cls]++; }
  const tableRows = Object.entries(table).map(([time, c]) => ({ time, weekday: Math.max(0, ...Object.values(c.weekday)), sat: c.sat, sun: c.sun, minutes: dutyMinutes(time), family: family(time) }))
    .sort((a, b) => startMinutes(a.time) - startMinutes(b.time) || endMinutes(a.time) - endMinutes(b.time));
  const daily = {}; for (const d of DAYS) daily[d] = keys.filter(k => p[k][d] !== 'RD' && p[k][d] !== 'SPARE').length;
  // The SECOND reading of every run row: a cover week worked as one block of four rather than
  // split day-on-day-off. `cover-placement.mjs` has the argument; measured across all thirteen
  // designs in this folder, FF11 is the ONLY row it moves — and on one of them it moves the
  // verdict. A sheet that printed one number was answering a question nobody asked.
  const asRostered = asRosteredRuns(p, lines);
  // `wkFit` is THE weekday demand fit — the fit of the average Mon–Fri cover on THIS rotation's own
  // lines — for today's 20-line link and every proposal alike, so a sheet can only ever compare like with
  // like. Until 25 Sep 2026 today's figure was taken by padding the 20-line link to 24 by repeating lines
  // 1–4 (five cover weeks, and four working weeks counted twice): 44.7, where the link itself scores
  // 51.1. That flattered today by six points and read three proposals as worse than it when they are better.
  return { checks, hours, totals, fatigue, hard, adj, hourly, tableRows, daily, asRostered, feel: feel(p, lines), rest: tightestRest(p, lines), fits: fitsOf(p, lines), wkFit: weekdayFit(p, lines), heads: headcounts(p, lines), office: officeSplit(p, lines, hourly, officeModel) };
}

/** Every SHIPPED rotation in docs/proposals, assessed — so a sheet can say where it stands in the folder
 *  ("the best of 21 on weekday fit", "one of six with no factor present") as a computed fact rather than a
 *  claim. Read at render time from `<Name>-<CODE>.json`; the sheet being rendered is in the set, which is
 *  what "best in the folder is this one" means. Cached per process. */
let _folder = null;
export function folderStats(dir = new URL('..', import.meta.url)) {
  if (_folder) return _folder;
  const T0 = today(); const TA = { patterns: T0.patterns, ...assess(T0.patterns, T0.lines) }; const todays = new Set(TA.tableRows.map(r => r.time));
  const out = [];
  for (const f of readdirSync(dir)) {
    const m = /^(.*)-([A-Z][A-Z0-9]*-24-[A-Z0-9]+)\.json$/.exec(f); if (!m) continue;
    try {
      const j = JSON.parse(readFileSync(new URL(f, dir), 'utf8')); const p = j.patterns ?? j; const lines = Object.keys(p).length;
      const A = assess(p, lines);
      out.push({ file: f, name: m[1].replace(/-/g, ' ').replace(/(\d+) (\d+)/g, '$1-$2'), code: m[2], wk: weekdayFit(p, lines), sat: A.fits.sat, sun: A.fits.sun, floor: { wk: A.office.wkFit, sat: A.office.fits.sat, sun: A.office.fits.sun },
        present: A.fatigue.present, weekends: A.checks.weekendsOff, run: A.checks.longestStretch, rest: A.rest?.minutes ?? null,
        oneTurn: A.feel.oneTurn, workingLines: A.feel.workingLines, distinct: A.feel.distinctTimes,
        newTimes: A.tableRows.filter(r => !todays.has(r.time)).length, turnarounds: A.checks.turnarounds.length, rules: currentRules({ patterns: p, ...A }, TA) });
    } catch { /* a JSON that is not a rotation is not the folder's business */ }
  }
  _folder = out; return out;
}
/** Where a value sits in the folder on one metric: lowest, highest, how many share the best, and the rank. */
export function folderRank(metric, value, lowerIsBetter = true) {
  const vals = folderStats().map(d => d[metric]).filter(v => v !== null && v !== undefined && !Number.isNaN(v));
  if (!vals.length) return null;
  const best = lowerIsBetter ? Math.min(...vals) : Math.max(...vals), worst = lowerIsBetter ? Math.max(...vals) : Math.min(...vals);
  const better = vals.filter(v => lowerIsBetter ? v < value : v > value).length;
  return { n: vals.length, best, worst, rank: better + 1, ties: vals.filter(v => v === value).length, isBest: value === best };
}

export function today() { const p = {}; for (let i = 1; i <= 20; i++) p[String(i)] = { ...weeklyRoster[String(i)] }; return { patterns: p, lines: 20 }; }

export function pickBest(files) {
  const cands = files.map(f => JSON.parse(readFileSync(f, 'utf8'))).sort((a, b) => a.cost - b.cost);
  return cands;
}

/** Try the app's own line-order optimiser on top; keep it only if the proposal's own cost improves. */
export function tryAppReorder(p, evaluate) {
  const ALL = Object.fromEntries(OBJECTIVES.map(o => [o.key, true]));
  let best = { p, cost: evaluate(p).cost, attempt: null };
  for (let attempt = 0; attempt < 8; attempt++) { const r = reorderLines(p, { on: ALL, attempt, maxRunTarget: 6 }); const q = applyOrder(p, r.order); const c = evaluate(q).cost; if (c < best.cost) best = { p: q, cost: c, attempt }; }
  return best;
}

export const demand = { profile: DEC_2026_DEMAND, peak: peakCars(DEC_2026_DEMAND), bucket: demandBucket, movements: DEC_2026_MOVEMENTS, movementsOutside };
export { hmFromHours, classifyShift, MAX_CONSECUTIVE_WORKED_DAYS, DAYS, dutyMinutes, startMinutes, endMinutes };
