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
 *  and one three hours from it read identically; Clean Final Tuned's 12h30 was in the README and on
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
 *  Clean Final Tuned's three retimes made Sunday WORSE (88.2 → 93.2) while on minutes they made it
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

export function assess(p, lines) {
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
  return { checks, hours, totals, fatigue, hard, adj, hourly, tableRows, daily, asRostered, feel: feel(p, lines), rest: tightestRest(p, lines), fits: fitsOf(p, lines), heads: headcounts(p, lines) };
}

/** Every SHIPPED rotation in docs/proposals, assessed — so a sheet can say where it stands in the folder
 *  ("the best of 21 on weekday fit", "one of six with no factor present") as a computed fact rather than a
 *  claim. Read at render time from `<Name>-<CODE>.json`; the sheet being rendered is in the set, which is
 *  what "best in the folder is this one" means. Cached per process. */
let _folder = null;
export function folderStats(dir = new URL('..', import.meta.url)) {
  if (_folder) return _folder;
  const T0 = today(); const todays = new Set(assess(T0.patterns, T0.lines).tableRows.map(r => r.time));
  const out = [];
  for (const f of readdirSync(dir)) {
    const m = /^(.*)-([A-Z][A-Z0-9]*-24-[A-Z0-9]+)\.json$/.exec(f); if (!m) continue;
    try {
      const j = JSON.parse(readFileSync(new URL(f, dir), 'utf8')); const p = j.patterns ?? j; const lines = Object.keys(p).length;
      const A = assess(p, lines);
      out.push({ file: f, name: m[1].replace(/-/g, ' '), code: m[2], wk: weekdayFit(p, lines), sat: A.fits.sat, sun: A.fits.sun,
        present: A.fatigue.present, weekends: A.checks.weekendsOff, run: A.checks.longestStretch, rest: A.rest?.minutes ?? null,
        oneTurn: A.feel.oneTurn, workingLines: A.feel.workingLines, distinct: A.feel.distinctTimes,
        newTimes: A.tableRows.filter(r => !todays.has(r.time)).length, turnarounds: A.checks.turnarounds.length });
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
