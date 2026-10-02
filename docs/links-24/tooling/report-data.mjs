// Everything the PDF states, computed by the app's own modules for BOTH the live roster and the proposal.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { asRosteredRuns, materialise, coverLines, BLOCK_PLACEMENTS } from './cover-placement.mjs';
import { runDesignChecks, weeklyHours, lineTotals, calcHourlyCoverage, classifyShift, startMinutes, endMinutes, endMinutesAbs, dutyMinutes, DAYS, hmFromHours } from '../../../links-design.js';
import { assessFatigue, maxHoursInAny7Days, toSequence } from '../../../links-fatigue.js';
import { assessHardLimits, MAX_CONSECUTIVE_WORKED_DAYS } from '../../../links-limits.js';
import { scoreOrder, reorderLines, applyOrder, OBJECTIVES } from '../../../links-adjacency.js';
import { DEC_2026_DEMAND, demandBucket, peakCars, movementsOutside, DEC_2026_MOVEMENTS } from '../../../links-demand.js';
import { weeklyRoster } from '../../../roster-cycle-data.js';

// Early / late for the one-turn and mixing counts. The managers' edition splits at 11:00, as every sheet defines an
// early (accuracy check, 28 Sep 2026 — at 09:00 a week could count as one shift time AND as mixing early and late);
// LEGACY=1 keeps the 09:00 split the searches were scored on.
export const family = t => { const s = startMinutes(t); if (s === null) return null; return s < (process.env.LEGACY ? 9*60 : 11*60) ? 'E' : 'L'; };

export function feel(p, lines) {
  const keys = Array.from({ length: lines }, (_, i) => String(i+1));
  const work = keys.filter(k => p[k].mon !== 'SPARE');
  let oneTurn = 0, hybrid = 0, isolated = 0, isolatedBesideCover = 0, pairedRest = 0, restIslands = 0; const daysHist = {}; const times = new Set();
  const seq = []; for (const k of keys) for (const d of DAYS) seq.push(p[k][d]);
  const n = seq.length;
  for (let i = 0; i < n; i++) { if (seq[i] !== 'RD') continue; const prev = seq[(i+n-1)%n] === 'RD', next = seq[(i+1)%n] === 'RD'; if (!prev) { restIslands++; if (!next) { isolated++; if (seq[(i+n-1)%n] === 'SPARE' || seq[(i+1)%n] === 'SPARE') isolatedBesideCover++; } else pairedRest++; } }
  for (const k of work) { const row = p[k]; const wk = ['mon','tue','wed','thu','fri'].map(d => row[d]).filter(s => s !== 'RD');
    const fams = new Set(DAYS.map(d => row[d]).filter(s => s !== 'RD').map(family));
    if (new Set(wk).size <= 1 && fams.size <= 1) oneTurn++; if (fams.size > 1) hybrid++;
    const days = DAYS.filter(d => row[d] !== 'RD').length; daysHist[days] = (daysHist[days] ?? 0) + 1;
    for (const d of DAYS) if (row[d] !== 'RD') times.add(row[d]); }
  return { workingLines: work.length, oneTurn, hybrid, isolatedRest: isolated, isolatedBesideCover, pairedRest, restIslands, daysHist, distinctTimes: times.size, spareLines: keys.filter(k => p[k].mon === 'SPARE').map(Number) };
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
// THE EDGE HOURS COUNT THE TRAINS INSIDE THE WINDOW, NOT A SHARE OF THE HOUR (external review, 28 Sep 2026).
// Until then the first and last hours took the hourly carriage total pro rata — Sunday's 23:00 hour counted 25/60
// of all its traffic because the window closes at 23:25. But every movement is known to the minute
// (DEC_2026_MOVEMENTS, which sums exactly to the hourly totals), and the edges are precisely where designs differ,
// so each hour now counts the carriages of the movements that fall inside the staffed window [ws, we]. Middle hours
// are unchanged; Sunday moved most (2–4 points on most sheets). Cover is still minute-weighted, as before.
export function dayFit(cov, cls) {
  const [ws, we] = FIT_WIN[cls];
  const hrs = []; for (let h = Math.floor(ws / 60); h <= Math.floor((we - 1) / 60); h++) hrs.push(h);
  const inWin = Array(24).fill(0);
  for (const [t, n] of DEC_2026_MOVEMENTS[cls]) if (t >= ws && t <= we) inWin[Math.floor(t / 60) % 24] += n;
  const D = hrs.reduce((a, h) => a + inWin[h], 0), C = hrs.reduce((a, h) => a + cov[h], 0);
  if (!C || !D) return null;
  return +hrs.reduce((a, h) => a + ((inWin[h] / D) - (cov[h] / C)) ** 2 * 1e4, 0).toFixed(1);
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
  // ON DUTY AT THE MOMENT, not "starts at 06:20" / "ends at 23:55" (external review, 28 Sep 2026): a 06:15 start is
  // present at the open and a 16:00–00:05 is still on at the close. Every shipped design stays inside the window, so
  // no figure moved — this is so that a future import cannot be under-counted by its spelling.
  for (const d of DAYS) { const cls = clsOf(d), op = OPEN[cls], cl = CLOSE[cls];
    out.open[d] = n(d, s => startMinutes(s) <= op && endMinutes(s) > op);
    out.close[d] = n(d, s => startMinutes(s) < cl && endMinutes(s) >= cl);
    out.at22[d] = n(d, s => startMinutes(s) <= 22 * 60 && endMinutes(s) > 22 * 60); }
  return out;
}

// THE TICKET OFFICE IS NOT FLOOR COVER (owner, 27–28 Sep 2026), and it is staffed the same way today as in the
// December plan: Monday to Friday two 06:20–14:20 and two 14:00–22:30, Saturday two 06:20–14:50 and two
// 14:30–22:00. SUNDAY IS THE ONE DIFFERENCE — today it has one late, and that late is one of the three
// 14:30–23:25 closers, in the office until it shuts at 22:30 and on the floor for the last hour; the plan has
// two earlies 07:15–15:30 and two lates 13:30–22:30. [time, people, office-until] — a third element cuts the
// office part short of the duty's own finish. Every sheet compares FLOOR with FLOOR by taking the right
// arrangement out of each side: today's out of today, the plan's out of every proposal. Only Right Away rosters
// the office pairs on every day; sixteen others roster them on some days (Thu/Fri, Mon–Fri, Sat…). On a day without
// them the plan's posts are ASSUMED to be staffed from the duties, and the floor is everyone on duty less those posts —
// the sheet says which days, on pages 5, 6 and 7.
export const OFFICE = {
  today: { weekday: [['06:20-14:20', 2], ['14:00-22:30', 2]], sat: [['06:20-14:50', 2], ['14:30-22:00', 2]], sun: [['07:15-15:45', 2], ['14:30-23:25', 1, '22:30']] },
  plan:  { weekday: [['06:20-14:20', 2], ['14:00-22:30', 2]], sat: [['06:20-14:50', 2], ['14:30-22:00', 2]], sun: [['07:15-15:30', 2], ['13:30-22:30', 2]] },
};
export const officeSpans = (model, cls) => OFFICE[model][cls].map(([t, n, until]) => ({ time: t, st: startMinutes(t), en: until ? +until.slice(0, 2) * 60 + +until.slice(3) : endMinutes(t), n }));
export const officePosts = (model, cls) => OFFICE[model][cls].reduce((a, [, n]) => a + n, 0);
const CLOSE = { weekday: 23*60+55, sat: 23*60+55, sun: 23*60+25 }, OPEN = { weekday: 6*60+20, sat: 6*60+20, sun: 7*60+15 };

// THE SECOND OFFICE PERSON HELPS ON THE FLOOR (owner, 28 Sep 2026; in every sheet from the same day). Of each office
// PAIR, the second morning person is on the floor from the open until 08:00 (09:00 on a Sunday) and the second evening
// person from 19:30 to the end of their office shift; on a Sunday the evening person splits the whole shift between the
// office and the floor, counted as HALF a person in the fit and not at all in the two-on-the-floor minimum, which counts
// whole people. A lone office duty is not a pair and does not help — today's single Sunday late. final-table.mjs builds
// tables on the same reading; until this the sheets counted the office as never on the floor, which over-counted
// how thin the quiet ends are and was nowhere explained. OFFICE_HELP_TEXT is the one sentence every page prints.
// THE DECEMBER SUNDAY (owner, 29 Sep 2026, with Familiar Nine as the example) replaces the Sunday reading above for the
// PROPOSALS: one Sunday early is on the floor until 09:00, as today, and then in the office; the two lates are on the floor from their start
// until 15:00, then both in the office — a handover of at least 30 minutes before the earlies leave — and the second
// goes back to the floor from 18:00 to the end of the shift, as a whole person. TODAY'S link keeps today's Sunday
// practice (the morning helper until 09:00; its one Sunday office late is a lone duty and never helps): model 'today'.
export const SUN_OFFICE_FROM = 15*60, SUN_FLOOR_AGAIN = 18*60, SUN_OFFICE_HANDOVER = 30;
export const OFFICE_HELP_TEXT = 'Monday to Saturday, one of each ticket-office pair helps on the floor at the quiet ends: the morning one until 08:00, the evening one from 19:30. On a Sunday one early is on the floor until 09:00; the two lates are on the floor until 15:00, then both in the office, and one goes back to the floor from 18:00';
export function officeHelpers(spans, cls, model = 'plan') {
  const out = [];
  for (const t of spans) { if (t.help) { for (const [st, en] of t.help) out.push({ st, en, share: 1 }); continue; }  // a named office says its own help
    if (t.n < 2) continue;
    if (cls === 'sun' && model !== 'today') {
      if (t.st === OPEN.sun) { const en = Math.min(t.en, 9*60); if (en > t.st) out.push({ st: t.st, en, share: 1 }); continue; } // one early: floor until 09:00
      if (t.st < SUN_OFFICE_FROM) out.push({ st: t.st, en: SUN_OFFICE_FROM, share: 1 }, { st: t.st, en: SUN_OFFICE_FROM, share: 1 });
      out.push({ st: Math.max(t.st, SUN_FLOOR_AGAIN), en: t.en, share: 1 });              // the second, back on the floor
      continue; }
    if (t.st === OPEN[cls]) { const en = Math.min(t.en, cls === 'sun' ? 9*60 : 8*60); if (en > t.st) out.push({ st: t.st, en, share: 1 }); }
    else if (cls === 'sun') out.push({ st: t.st, en: t.en, share: 0.5 });
    else if (t.en > 19*60+30) out.push({ st: Math.max(t.st, 19*60+30), en: t.en, share: 1 }); }
  return out;
}
// The office pairs a design ROSTERS on day d, or null. Monday to Saturday they are the plan's exact turns; on a Sunday
// ANY two identical 07:15 earlies and two identical lates to 22:30, which is how the owner put it.
export function rosteredPairs(p, d) {
  const cls = clsOf(d), duties = Object.values(p).map(r => r[d]).filter(s => s && s !== 'RD' && s !== 'SPARE' && s !== 'OFF' && startMinutes(s) !== null);
  const byT = {}; for (const s of duties) byT[s] = (byT[s] ?? 0) + 1;
  if (cls !== 'sun') { const [[e], [l]] = OFFICE.plan[cls]; return (byT[e] ?? 0) >= 2 && (byT[l] ?? 0) >= 2 ? { early: e, late: l } : null; }
  const e = Object.keys(byT).filter(t => startMinutes(t) === OPEN.sun && byT[t] >= 2).sort((a, b) => endMinutes(b) - endMinutes(a))[0];
  const l = Object.keys(byT).filter(t => endMinutes(t) === 22*60+30 && byT[t] >= 2).sort((a, b) => startMinutes(a) - startMinutes(b))[0];
  return e && l ? { early: e, late: l } : null;
}
// A DESIGN'S OWN TICKET OFFICE (owner, 1 Oct 2026). A hand-drawn design whose author has said which duties run the
// office is measured on THOSE duties, not on pairs found in the cells or the plan's posts assumed. Keyed by the
// design's fingerprint, so it can only ever apply to the exact grid its author drew: a single changed cell gives a new
// fingerprint and the design falls back to the general reading. Each entry is one person: the duty they work, `early`
// or `late`, and the stretches of it they spend on the FLOOR rather than in the office (the plan's quiet-end help, the
// time after the office closes). Polished Clean (PC-24-EXT · 12424ed2), as its author confirmed it: Mon–Fri earlies
// starting 06:20 and 07:00 (her "7:30" is the 07:00–15:30, the only second weekday early in her table), handover at
// 13:30 and 14:00; Saturday two 06:20–14:30s, handover 13:30 and 14:00; Sunday 07:15 and 08:30, handover 14:20 —
// one Sunday late, as today. The office pairs rule is waived for it (WAIVERS in fresh.mjs): these are not identical pairs.
const hm2m = t => +t.slice(0, 2) * 60 + +t.slice(3);
const officer = (time, role, ...help) => ({ time, role, help: help.map(([a, b]) => [hm2m(a), hm2m(b)]) });
export const NAMED_OFFICE = {
  '12424ed2': {
    weekday: [officer('06:20-14:20', 'early'), officer('07:00-15:30', 'early', ['07:00', '08:00']),
              officer('13:30-22:00', 'late', ['19:30', '22:00']), officer('14:00-22:30', 'late')],
    sat: [officer('06:20-14:30', 'early'), officer('06:20-14:30', 'early', ['06:20', '08:00']),
          officer('13:30-21:30', 'late', ['19:30', '21:30']), officer('14:00-22:30', 'late', ['22:00', '22:30'])],
    sun: [officer('07:15-15:45', 'early'), officer('08:30-16:30', 'early'), officer('14:20-23:25', 'late', ['22:30', '23:25'])],
  },
  // Silva Lining (SL-24-Hs · 15475b65), the same office carried across (owner, 1 Oct 2026). Every weekday duty is the same
  // shift; two differ by the rota's own times, doing the same job: Saturday's 13:30 is a 13:30–22:00 (on the floor from
  // 19:30 to its finish, as the 13:30–21:30 was), and Sunday's late is a 14:30–23:25 (taking the office at 14:30, not
  // 14:20). The pairs rule is waived for it as for Polished Clean (WAIVERS in fresh.mjs). Its Sunday re-search (1 Oct 2026)
  // moved three FLOOR closers to 15:25 and left the office's three Sunday duties as they were; the key followed the cells
  // (was 7fc9745f, SL-24-H).
  '15475b65': {
    weekday: [officer('06:20-14:20', 'early'), officer('07:00-15:30', 'early', ['07:00', '08:00']),
              officer('13:30-22:00', 'late', ['19:30', '22:00']), officer('14:00-22:30', 'late')],
    sat: [officer('06:20-14:30', 'early'), officer('06:20-14:30', 'early', ['06:20', '08:00']),
          officer('13:30-22:00', 'late', ['19:30', '22:00']), officer('14:00-22:30', 'late', ['22:00', '22:30'])],
    sun: [officer('07:15-15:45', 'early'), officer('08:30-16:30', 'early'), officer('14:30-23:25', 'late', ['22:30', '23:25'])],
  },
};
const fpOf = p => createHash('sha256').update(JSON.stringify(Object.keys(p).sort((a, b) => a - b).map(k => DAYS.map(d => p[k][d])))).digest('hex').slice(0, 8);
const fpCache = new WeakMap();
/** The office this design's author named for day d, or null. Throws if a named duty is not in that day's cells. */
export function namedOffice(p, d) {
  if (!fpCache.has(p)) fpCache.set(p, fpOf(p));
  const spec = NAMED_OFFICE[fpCache.get(p)]; if (!spec) return null;
  const list = spec[clsOf(d)], pool = Object.values(p).map(r => r[d]);
  for (const x of list) { const i = pool.indexOf(x.time); if (i < 0) throw new Error(`namedOffice: ${x.time} is not rostered on ${d}`); pool.splice(i, 1); }
  return list;
}
// The office taken out of day d: today's own for today's link; for a proposal the pairs it rosters, else the plan's posts
// (assumed staffed from the duties). Before 28 Sep's helper change a proposal always had the plan's posts taken out, which was wrong only
// for a design whose Sunday office lates start at another time than 13:30 — none shipped, the first was about to.
export function officeFor(p, d, model) {
  const cls = clsOf(d);
  if (model !== 'plan') return officeSpans(model, cls);
  const nm = namedOffice(p, d);
  if (nm) return nm.map(x => ({ time: x.time, st: startMinutes(x.time), en: endMinutes(x.time), n: 1, help: x.help, role: x.role }));
  const pr = rosteredPairs(p, d);
  return pr ? [pr.early, pr.late].map(t => ({ time: t, st: startMinutes(t), en: endMinutes(t), n: 2 })) : officeSpans('plan', cls);
}
/** Everyone on duty, the office, and the floor, per day — heads per hour on calcHourlyCoverage's own rule so
 *  the three rows add up cell by cell, and the floor's fit on duty minutes with the office's minutes out. The
 *  helping office person is floor in the hours their help overlaps (heads) and for exactly their minutes (fit). */
export function officeSplit(p, lines, hourly, model) {
  const days = {};
  const inHour = (t, h) => t.st < (h+1)*60 && t.en > h*60, minsIn = (t, h) => Math.max(0, Math.min(t.en, (h+1)*60) - Math.max(t.st, h*60)) / 60;
  for (const d of DAYS) { const cls = clsOf(d), sp = officeFor(p, d, model), hp = officeHelpers(sp, cls, model);
    const office = Array.from({ length: 24 }, (_, h) => sp.reduce((a, t) => a + (inHour(t, h) ? t.n : 0), 0) - hp.filter(x => x.share >= 1 && inHour(x, h)).length);
    const floor = hourly[d].hours.map((v, h) => Math.max(0, v - office[h]));
    const offMin = Array.from({ length: 24 }, (_, h) => sp.reduce((a, t) => a + t.n * minsIn(t, h), 0) - hp.reduce((a, x) => a + x.share * minsIn(x, h), 0));
    const cov = minuteCover(p, lines, d).map((v, h) => Math.max(0, v - offMin[h]));
    days[d] = { office, floor, cov, fit: dayFit(cov, cls), help: hp }; }
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
const hmm = m => `${Math.floor(m/60)}h ${String(m%60).padStart(2,'0')}m`;
// `model` is whose office is taken out where a day has no rostered pairs: the plan's posts for a proposal, today's own
// office for today's link (accuracy check, 28 Sep 2026 — today's Sunday was measured on the plan's posts while page 6
// used today's own office; no figure moved, the method now agrees).
/** THREE TIERS OF RULE (owner, 30 Sep 2026):
 *  · HARD limits — 12 hours' rest, 13 days in a row, the exact contract. Met, or the rota cannot be run.
 *  · SOFT rules — the nine December 2026 staffing rules (sheetRules). Each met or not, and stated and scored on every
 *    proposal sheet, the summary and the rules sheet.
 *  · FLEXIBLE rules — fourteen on a Saturday, four evenly spread cover weeks, a 15:45 start for every weekday closer
 *    (flexibleRules). "They should stay in the background": every search, solver and judge designs to them (they stay
 *    in currentRules, which all eleven are), a PRESENTATION may mention them, and a PROPOSAL SHEET never does. The
 *    rules sheet names them as their own tier.
 *  Saturday's fourteen shares currentRules' row with Sunday's ten, which is a SOFT rule: sheetRules gives it a row of
 *  its own, flexibleRules gives Saturday its own. */
export function flexibleRules(P, T, model = 'plan') {
  const R = currentRules(P, T, model), by = k => R.rows.find(r => r.key === k);
  const rows = [{ key: 'saturday', rule: 'Fourteen on a Saturday', value: `${P.daily.sat}`, ok: P.daily.sat >= 14, note: '' }, by('cover'), by('closer')];
  return { rows, met: rows.filter(r => r.ok).length, of: rows.length };
}
export function sheetRules(P, T, model = 'plan') {
  const R = currentRules(P, T, model);
  const rows = R.rows.flatMap(r => r.key === 'heads' ? [{ key: 'sunday', rule: 'Ten on a Sunday', value: `${P.daily.sun}`, ok: P.daily.sun >= 10, note: 'every duty rostered that day counts' }]
    : r.key === 'cover' || r.key === 'closer' ? [] : [r]);
  return { ...R, rows, met: rows.filter(r => r.ok).length, of: rows.length };
}

export function currentRules(P, T, model = 'plan') {
  const lines = Object.keys(P.patterns).length, keys = Object.keys(P.patterns);
  const dutiesOn = d => keys.map(k => P.patterns[k][d]).filter(s => s && s !== 'RD' && s !== 'SPARE' && s !== 'OFF' && startMinutes(s) !== null);
  const count = (d, t) => dutiesOn(d).filter(s => s === t).length;
  const WDD = ['mon', 'tue', 'wed', 'thu', 'fri'], ALL = [...WDD, 'sat', 'sun'];
  const H = P.heads, rng = (o, f) => { const v = WDD.map(d => o[d]); const lo = Math.min(...v), hi = Math.max(...v); return `${lo === hi ? lo : `${lo}–${hi}`} · ${o.sat} · ${o.sun}`; };
  // the office pairs this design rosters on day d, or null (rosteredPairs)
  const pairsOn = d => rosteredPairs(P.patterns, d);
  // the floor: the day's duties with the office taken out — the rostered pairs where there are any, else the plan's
  // posts — and the helping office person added back while they help (whole people only: the minimum counts heads)
  const floorOn = d => { const cls = clsOf(d), pr = pairsOn(d); const ds = dutiesOn(d).map(s => ({ s, st: startMinutes(s), en: endMinutes(s) }));
    const nm = model === 'plan' ? namedOffice(P.patterns, d) : null;
    if (nm) { const out = [...ds]; for (const x of nm) out.splice(out.findIndex(y => y.s === x.time), 1);
      return { duties: out, office: [], help: officeHelpers(officeFor(P.patterns, d, model), cls, model), named: true, nm }; }
    if (!pr) { const office = officeSpans(model, cls); return { duties: ds, office, help: officeHelpers(office, cls, model), named: false }; }
    const out = [...ds]; for (const t of [pr.early, pr.early, pr.late, pr.late]) out.splice(out.findIndex(x => x.s === t), 1);
    return { duties: out, office: [], help: officeHelpers([pr.early, pr.late].map(t => ({ st: startMinutes(t), en: endMinutes(t), n: 2 })), cls, model), named: true, pr }; };
  // WHEN, as well as how few (accuracy check, 1 Oct 2026): page 5 counts anyone on for part of an hour, so a dip of a
  // quarter of an hour between one shift leaving and the next arriving never shows there. The rule's value names the
  // first moment each figure is reached, so a reader can find it.
  const floorAt = {};
  const floorMin = d => { const cls = clsOf(d), f = floorOn(d); let lo = Infinity, at = null;
    for (let m = OPEN[cls]; m < CLOSE[cls]; m += 5) { const v = f.duties.filter(x => x.st <= m && x.en > m).length - f.office.filter(t => t.st <= m && t.en > m).reduce((a, t) => a + t.n, 0)
      + f.help.filter(x => x.share >= 1 && x.st <= m && x.en > m).length; if (v < lo) { lo = v; at = m; } }
    floorAt[d] = at; return Math.max(0, lo); };
  const handover = d => { const cls = clsOf(d), f = floorOn(d), cl = f.duties.filter(x => x.en === CLOSE[cls]);
    let ok = cl.length > 0 && cl.every(c => f.duties.some(x => x.st < c.st && x.en >= c.st + 15));
    if (cls === 'sun' && cl.length) { const last = Math.max(...cl.map(c => c.st)); ok = ok && f.duties.filter(x => x.st === OPEN.sun).every(x => x.en >= last + 15); }
    // the office overlap is measured the way the floor is: the rostered pairs where the design has them, the plan's
    // posts where it does not (accuracy check, 28 Sep 2026 — a design with pairs on two days passed on those two
    // alone, while one with none failed outright, though the posts it is assumed to staff overlap by 20 minutes too)
    const [[pe], [pl]] = OFFICE[model][cls];
    // a December Sunday's lates join the office at 15:00 whenever their shift starts, so that is where the handover begins
    const lateIn = t => cls === 'sun' && model !== 'today' ? Math.max(startMinutes(t), SUN_OFFICE_FROM) : startMinutes(t);
    // a named office hands over when its first late arrives before its last early leaves, from the time the design says
    const overlap = f.nm ? Math.max(...f.nm.filter(x => x.role === 'early').map(x => endMinutes(x.time))) - Math.min(...f.nm.filter(x => x.role === 'late').map(x => startMinutes(x.time)))
      : f.named ? endMinutes(f.pr.early) - lateIn(f.pr.late) : endMinutes(pe) - lateIn(pl);
    return { ok, overlap, assumed: !f.named, need: cls === 'sun' && model !== 'today' ? SUN_OFFICE_HANDOVER : 20 }; };
  const pairs = ALL.map(d => [d, pairsOn(d)]), pairsOk = d => !!pairs.find(([x]) => x === d)[1];
  const namedAll = model === 'plan' && ALL.every(d => namedOffice(P.patterns, d));
  const wkPairs = WDD.every(pairsOk), satPairs = pairsOk('sat'), sunPairs = pairsOk('sun');
  const fm = Object.fromEntries(ALL.map(d => [d, floorMin(d)])), wkFloor = Math.min(...WDD.map(d => fm[d]));
  const DN3 = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const wkLowDay = WDD.find(d => fm[d] === wkFloor);
  const floorWhen = [[wkLowDay, wkFloor], ['sat', fm.sat], ['sun', fm.sun]].filter(([d]) => d && floorAt[d] != null).map(([d]) => `${DN3[d]} ${hhmm(floorAt[d])}`).join(', ');
  const hv = Object.fromEntries(ALL.map(d => [d, handover(d)]));
  const floorHand = ALL.every(d => hv[d].ok), overlaps = ALL.map(d => hv[d].overlap), assumedDays = ALL.filter(d => hv[d].assumed).length;
  const sunLens = dutiesOn('sun').map(dutyMinutes);
  const wkClosers = [...new Set(WDD.flatMap(d => dutiesOn(d).filter(s => endMinutes(s) === CLOSE.weekday)))];
  const closerStarts = [...new Set(wkClosers.map(s => s.split('-')[0]))].sort();
  const andList = a => a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
  const all = (o, n) => ALL.every(d => o[d] >= n);
  const rows = [
    { key: 'open', rule: 'At least four on at the open, every day', value: rng(H.open), ok: all(H.open, 4), note: 'from 06:20 (07:15 on a Sunday)' },
    { key: 'close', rule: 'At least three through to the close, every day', value: rng(H.close), ok: all(H.close, 3), note: 'until 23:55 (23:25 on a Sunday)' },
    { key: 'at22', rule: 'At least five still on duty at 22:00, every day', value: rng(H.at22), ok: all(H.at22, 5), note: 'someone finishing at 22:00 does not count' },
    { key: 'heads', rule: 'Fourteen on a Saturday, ten on a Sunday', value: `${P.daily.sat} · ${P.daily.sun}`, ok: P.daily.sat >= 14 && P.daily.sun >= 10, note: '' },
    { key: 'cover', rule: 'Four cover weeks, evenly spread', value: `lines ${P.feel.spareLines.join(', ')}`, ok: P.feel.spareLines.length === 4 && P.adj.spareExcess === 0, note: 'evenly means every 6 lines, e.g. 1, 7, 13, 19' },
    { key: 'office', rule: 'The ticket office: two early and two late, identical shifts, every day', value: `Mon–Fri ${wkPairs ? 'yes' : 'no'} · Sat ${satPairs ? 'yes' : 'no'} · Sun ${sunPairs ? 'yes' : 'no'}`, ok: wkPairs && satPairs && sunPairs, note: 'Mon–Fri 06:20–14:20 and 14:00–22:30; Sat 06:20–14:50 and 14:30–22:00; Sun two from 07:15 and two to 22:30' },
    { key: 'closer', rule: 'Every weekday closer starts at 15:45', value: closerStarts.length ? `closers start at ${andList(closerStarts)}` : 'no weekday closer', ok: wkClosers.length > 0 && wkClosers.every(s => s === '15:45-23:55'), note: '' },
    { key: 'floor', rule: 'At least two on the floor at every moment', value: `fewest ${wkFloor} · ${fm.sat} · ${fm.sun}${floorWhen ? ` — first at ${floorWhen}` : ''}`, ok: ALL.every(d => fm[d] >= 2), note: namedAll ? 'the ticket office counts only while its staff are on the floor — at the quiet ends and once the office has closed, as this design runs it; checked every five minutes' : 'the ticket office counts only while its staff help on the floor — Mon–Sat one of each pair until 08:00 and from 19:30; on a Sunday one early until 09:00, both lates until 15:00 and one from 18:00; checked every five minutes' },
    { key: 'handover', rule: 'Handovers: 15 minutes to each closer, 20 in the ticket office (30 on a Sunday)', value: `floor ${floorHand ? 'met' : 'not met'} · ticket office ${Math.min(...overlaps)} min${assumedDays && model === 'plan' ? ` (${assumedDays === 7 ? 'posts' : `posts on ${assumedDays} day${assumedDays === 1 ? '' : 's'}`} assumed)` : ''}`, ok: floorHand && ALL.every(d => hv[d].overlap >= hv[d].need), note: namedAll ? 'the ticket office overlap is from its first late arriving to its last early leaving, as this design runs it; on a Sunday each opener also stays until 15 minutes after the last closer arrives' : 'the Sunday office handover runs from 15:00, when the lates join it; on a Sunday each opener also stays until 15 minutes after the last closer arrives; where the design does not roster the office pairs, the plan’s posts are assumed' },
    { key: 'sunlen', rule: 'Sunday duties between 8h and 9h', value: sunLens.length ? `${hmm(Math.min(...sunLens))}–${hmm(Math.max(...sunLens))}` : '—', ok: sunLens.length > 0 && sunLens.every(m => m >= 480 && m <= 540), note: 'every Sunday duty, start to finish' },
    { key: 'times', rule: 'No more shift times than today', value: `${P.feel.distinctTimes}`, ok: P.feel.distinctTimes <= T.feel.distinctTimes, note: `today ${T.feel.distinctTimes}` },
  ];
  return { rows, met: rows.filter(r => r.ok).length, of: rows.length, pairDays: ALL.filter(pairsOk) };
}

// The office model is TODAY'S for the live 20-line link and the PLAN'S for every 24-line proposal; nothing in this
// folder is 20 lines except today's link, and a caller can say otherwise.
// THE 55-HOUR ROW AT ITS WORST (accuracy check, 1 Oct 2026): the app counts a cover week's days as no hours, so its
// figure is a floor. Filled in as four 8-hour duties in every block placement it can cross 55; fresh.mjs states the range
// on the sheet, and the summary's "up to" adds the row when it would. One function, so the two cannot disagree.
export function h55Worst(p, lines) {
  const table = assessFatigue(p, lines).results.find(r => r.code === 'MRSF' && /55 hours/.test(r.title))?.value; const n = coverLines(p, lines).length;
  let acc = [[]]; for (let i = 0; i < n; i++) acc = acc.flatMap(c => BLOCK_PLACEMENTS.map((_, j) => [...c, j]));
  const v = acc.map(c => maxHoursInAny7Days(toSequence(materialise(p, lines, c, '09:00-17:00'), lines)));
  return table == null ? null : { table, lo: Math.min(...v), hi: Math.max(...v), adds: Math.max(...v) > 55 && table <= 55 };
}
// THE FIXED DUTIES (owner, 1 Oct 2026: "you were highlighting worst case on cover-week placement for days in a row — now
// you are just doing worst possible with cover week. Isn't that misleading?"). A cover week is four duties the roster
// clerk places later, so every run and fatigue figure has two honest answers: on the duties the rota FIXES (the cover
// weeks left out — the basis every sheet now leads with, for the proposal and today's link alike), and at the WORST place
// a cover week's four duties could fall (stated beside it as "up to"). The fatigue checks' own figures are the worst case;
// this is the same checks run with each cover day read as a day off. Hard limits are still tested at the worst case —
// a limit must hold wherever the clerk puts the four.
function fixedView(p, lines) {
  const q = {}; for (const k of Object.keys(p)) { q[k] = {}; for (const d of DAYS) q[k][d] = p[k][d] === 'SPARE' ? 'RD' : p[k][d]; }
  const fatigue = assessFatigue(q, lines);
  return { fatigue, present: fatigue.present, run: runDesignChecks(q, lines).longestStretch };
}
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
  // split day-on-day-off. `cover-placement.mjs` has the argument; measured across the designs in
  // this folder, FF11 is the only row whose WORST case differs between the two readings — and on three
  // (TF, TM, WL) it moves the verdict. The BEST placement moves more (the run, the 8-hour run, FF15, the
  // 55-hour row); fresh.mjs says so on pages 3 and 8. A sheet that printed one number was answering a question nobody asked.
  const asRostered = asRosteredRuns(p, lines);
  // `wkFit` is THE weekday demand fit — the fit of the average Mon–Fri cover on THIS rotation's own
  // lines — for today's 20-line link and every proposal alike, so a sheet can only ever compare like with
  // like. Until 25 Sep 2026 today's figure was taken by padding the 20-line link to 24 by repeating lines
  // 1–4 (five cover weeks, and four working weeks counted twice): 44.7, where the link itself scores
  // 51.1. That flattered today by six points and read three proposals as worse than it when they are better.
  return { checks, hours, totals, fatigue, hard, adj, hourly, tableRows, daily, asRostered, fixed: fixedView(p, lines), feel: feel(p, lines), rest: tightestRest(p, lines), fits: fitsOf(p, lines), wkFit: weekdayFit(p, lines), heads: headcounts(p, lines), office: officeSplit(p, lines, hourly, officeModel) };
}

/** Every SHIPPED rotation in docs/links-24, assessed — so a sheet can say where it stands in the folder
 *  ("the best of 21 on weekday fit", "one of six with no factor present") as a computed fact rather than a
 *  claim. Read at render time from `<Name>-<CODE>.json`; the sheet being rendered is in the set, which is
 *  what "best in the folder is this one" means. Cached per process. */
let _folder = null;
export function folderStats(dir = new URL('../proposals/', import.meta.url)) {
  if (_folder) return _folder;
  const T0 = today(); const TA = { patterns: T0.patterns, ...assess(T0.patterns, T0.lines) }; const todays = new Set(TA.tableRows.map(r => r.time));
  const out = [];
  for (const f of readdirSync(dir)) {
    // a trailing lower-case letter marks a rotation derived from a seed's (FR-24-F34o: seed 34, its week order improved)
    const m = /^(.*)-([A-Z][A-Z0-9]*-24-[A-Z0-9]+[a-z]?)\.json$/.exec(f); if (!m) continue;
    try {
      const j = JSON.parse(readFileSync(new URL(f, dir), 'utf8')); const p = j.patterns ?? j; const lines = Object.keys(p).length;
      const A = assess(p, lines);
      out.push({ file: f, name: m[1].replace(/-/g, ' ').replace(/(\d+) (\d+)/g, '$1-$2'), code: m[2], wk: weekdayFit(p, lines), sat: A.fits.sat, sun: A.fits.sun, floor: { wk: A.office.wkFit, sat: A.office.fits.sat, sun: A.office.fits.sun },
        present: A.fatigue.present, weekends: A.checks.weekendsOff, run: A.checks.longestStretch, fixedPresent: A.fixed.present, fixedRun: A.fixed.run, worstPresent: A.fatigue.present + (h55Worst(p, 24)?.adds ? 1 : 0), rest: A.rest?.minutes ?? null,
        oneTurn: A.feel.oneTurn, workingLines: A.feel.workingLines, distinct: A.feel.distinctTimes,
        newTimes: A.tableRows.filter(r => !todays.has(r.time)).length, turnarounds: A.checks.turnarounds.length, rules: sheetRules({ patterns: p, ...A }, TA) });
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
