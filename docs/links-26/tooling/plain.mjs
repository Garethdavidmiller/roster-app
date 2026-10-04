// THE PLAIN EDITION (owner, 29 Sep 2026: a busy manager must not be overloaded — "it needs to be easy to understand").
//
// Every proposal sheet is read by a manager deciding, not by someone checking the analysis. The managers' edition
// (fresh.mjs) put the answer first but still met the reader with the method before the rota: eight metric tiles,
// a whole page on how to read each number, a table of how far to trust each figure, a ranking against the other 27
// drafts (which a manager is not shown — owner, same day) and a paste block for the app.
//
// This module replaces those five pages with two written for that reader, and keeps the five that carry the
// analysis — the grid, the week and duty table, the hour-by-hour cover, the rules, the ORR table — unchanged as an
// appendix, renumbered. A final page says in plain words how every figure is worked out. Three rules hold it:
//
//   1. NOTHING IS TYPED. Every sentence is built from the same assessed figures the appendix prints, so the front
//      can never say one thing while page 6 says another, on any of the 28 designs — including the ones that fail.
//   2. TODAY'S LINK IS THE ONLY COMPARISON. No other proposal is named, counted or ranked anywhere in the sheet;
//      the one-page summary (summary-sheet.mjs) is where the drafts are set side by side, for the owner.
//   3. ANSWER, THEN PROOF. Each question is answered in a word or two, with one line of evidence beside it. The
//      codes, the fit arithmetic and the ORR wording stay in the appendix for whoever asks to see the workings.
//
// `TECH=1` renders the ten-page technical sheet instead (render.mjs), unchanged.
import { LINES, COVER_WEEKS, WORKING_LINES, CONTRACT_MINUTES, DAYS_CEILING, daysAYear } from './link.mjs';
import { dutyMinutes, startMinutes, endMinutes } from './report-data.mjs';
import { WAIVERS } from './fresh.mjs';
import { leave } from './leave.mjs';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hm = m => m == null ? '—' : `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, '0')}`;
const n1 = v => v == null ? '—' : Number(v).toFixed(1);
const timed = s => !!s && s !== 'RD' && s !== 'SPARE' && startMinutes(s) !== null;
const endAbs = s => { const a = startMinutes(s), b = endMinutes(s); return b > a ? b : b + 1440; };
// "every 2 or 3 weeks" rather than a spurious "every 3" when the true interval is 2.7
const weeksWords = x => { const f = Math.floor(x), frac = x - f; return frac >= 0.25 && frac <= 0.75 ? `${f} or ${f + 1}` : `${Math.max(1, Math.round(x))}`; };
const everyN = share => share <= 0 ? 'never' : `one in ${Math.round(1 / share)}`;
// THE LONGEST WAIT FOR A FULL WEEKEND OFF (external review, 1 Oct 2026). "One in 4 weeks" read as a regular rhythm; it is
// an average, and the weekends fall unevenly — Familiar Nine's six are 3, 1, 7, 5, 1 and 7 weeks apart. So a sheet now
// gives the COUNT ("6 in 24") and the longest gap between two of them. Counted the way checkLinkConstraints counts the
// weekends (Saturday of one line and Sunday of the next both off, a cover week's days never off), so the two cannot
// disagree; null when there is no weekend off at all.
const weekendGap = p => { const L = Object.keys(p).length, off = s => !timed(s) && s !== 'SPARE';
  const at = []; for (let k = 1; k <= L; k++) if (off(p[String(k)].sat) && off(p[String(k % L + 1)].sun)) at.push(k);
  return at.length ? Math.max(...at.map((k, i) => i < at.length - 1 ? at[i + 1] - k : at[0] + L - k)) : null; };

/** The per-person figures a colleague asks about, from the rota itself — the same arithmetic as the one-page summary
 *  and the Familiar Nine presentations. Averages over EVERY line, cover weeks included (they add no fixed duty);
 *  "days at work" counts Monday to Saturday with a cover week as four days, because Sunday is overtime. */
export function personal(patterns) {
  const rows = Object.keys(patterns).sort((a, b) => a - b).map(k => patterns[k]);
  const L = rows.length, cover = rows.filter(r => DAYS.every(d => r[d] === 'SPARE')).length;
  let monSat = 0, monSatMins = 0, late23 = 0, sat = 0, sun = 0, open = 0, longest = 0;
  const closers = { wk: [], sat: [], sun: [] }, early = [], late = [];
  for (const r of rows) for (const d of DAYS) {
    const s = r[d]; if (!timed(s)) continue;
    const len = dutyMinutes(s), end = endAbs(s); longest = Math.max(longest, len);
    if (d !== 'sun') { monSat++; monSatMins += len; }
    if (end >= 23 * 60) late23++;
    if (d === 'sat') sat++; if (d === 'sun') sun++;
    if (startMinutes(s) === 380) open++;
    if (d === 'sun' ? end === 1405 : end === 1435) closers[d === 'sun' ? 'sun' : d === 'sat' ? 'sat' : 'wk'].push(len);
    (startMinutes(s) < 660 ? early : late).push(len);
  }
  const perYear = x => x * 52 / L, avg = a => a.length ? a.reduce((p, q) => p + q, 0) / a.length : null;
  const span = a => !a.length ? '—' : Math.min(...a) === Math.max(...a) ? hm(a[0]) : `${hm(Math.min(...a))}–${hm(Math.max(...a))}`;
  const daysWeek = (monSat + 4 * cover) / L;
  return { L, cover, daysWeek, daysYear: daysWeek * 365 / 7, avgShift: monSatMins / monSat, longest,
    late23: perYear(late23), sat: perYear(sat), sun: perYear(sun), open0620: perYear(open),
    closer: { wk: avg(closers.wk), sat: avg(closers.sat), sun: avg(closers.sun) },
    // the range, for printing: an average of two different closing shifts is a shift nobody works
    closerSpan: { wk: span(closers.wk), sat: span(closers.sat), sun: span(closers.sun) }, closerAll: closers,
    earlySpan: span(early), lateSpan: span(late) };
}

/** The ORR and industry factors in the words a manager uses. The appendix keeps the ORR's own wording. */
const PLAIN_FATIGUE = [
  [/rest after a block of early/i, 'too little rest after a run of early starts'],
  [/13 consecutive shifts without a 48h/i, 'too many shifts without a two-day break'],
  [/consecutive early shifts/i, 'long runs of early shifts'],
  [/successive start times varying/i, 'start times that jump by more than two hours'],
  [/less than 12h rest/i, 'less than 12 hours between two shifts'],
  [/55 hours/i, 'more than 55 hours in a week'],
  [/consecutive 8h shifts/i, 'long runs of 8-hour shifts'],
  [/consecutive day shifts/i, 'long runs of day shifts'],
  [/backward rotating/i, 'start times moving earlier through the week'],
  [/over 12h|over 10h|over 8h/i, 'very long shifts'],
];
const plainFatigue = t => (PLAIN_FATIGUE.find(([re]) => re.test(t))?.[1]) ?? t.charAt(0).toLowerCase() + t.slice(1);
const andList = a => a.length <= 1 ? (a[0] ?? '') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
/** The match to the trains IN WORDS (owner, 30 Sep 2026): "27.7 against 52.0, lower is closer" means nothing to a
 *  reader without a scale, so every match figure carries a plain comparison with today's. It is worded as a SCORE —
 *  "a score about half of today’s" — never as a distance (accuracy audit, 1 Oct 2026: "half as far off as today" read
 *  as half as many people out of place). The figure is a sum of squared differences, so the ratio of two scores is
 *  honest about the scores and says nothing about headcounts. */
const FRACS = [[0.1, 'a tenth'], [0.2, 'a fifth'], [0.25, 'a quarter'], [1 / 3, 'a third'], [0.4, 'two-fifths'], [0.5, 'half'], [0.6, 'three-fifths'], [2 / 3, 'two-thirds'], [0.75, 'three-quarters'], [0.8, 'four-fifths'], [0.9, 'nine-tenths']];
const nearest = x => FRACS.reduce((a, b) => Math.abs(b[0] - x) < Math.abs(a[0] - x) ? b : a)[1];
export const offWords = (p, t) => {
  if (p == null || t == null || !(t > 0)) return null;
  const r = p / t;
  if (r >= 0.95 && r <= 1.05) return 'a score about the same as today’s';
  if (r < 0.07) return 'a score near zero';
  if (r < 1) return `a score about ${nearest(r)} of today’s`;
  if (r < 1.9) return `a score about ${nearest(r - 1)} higher than today’s`;
  return r < 2.25 ? 'a score about twice today’s' : r < 2.75 ? 'a score about two and a half times today’s' : `a score about ${Math.round(r)} times today’s`;
};

/** The two front pages. */
function front({ T, P, meta, pages, coverHead }) {
  const name = esc(meta.identity.name), strap = esc(meta.identity.strap);
  const tp = personal(T.patterns), pp = personal(P.patterns);
  const rules = meta.designRules ?? [], missed = rules.filter(r => !r.ok);
  // A rule the owner waived for one design (WAIVERS in fresh.mjs — Clean Sweep keeps its 16:25 weekday closers) is
  // reported as waived, never as a failure — the sheet would otherwise say "No" about the one thing that was agreed.
  const waived = missed.filter(r => r.waived);
  const failed = missed.filter(r => !r.waived);
  const monSat = meta.monSat ?? CONTRACT_MINUTES;
  const rests = P.checks.turnarounds.length, run = P.checks.longestStretch, restMin = P.rest?.minutes;
  // what 14 days' leave buys (leave.mjs) — the one thing every 26-line design is worse at than today, so it is a
  // page-1 concern, not only a page-2 row (outside review, 4 Oct 2026: "someone reading only that page misses a
  // significant trade-off")
  const lvP = leave(P.patterns), lvT = leave(T.patterns);
  const breaks = [rests ? `${rests} ${rests === 1 ? 'gap' : 'gaps'} of under 12 hours between shifts` : '',
    run > 13 ? `a run of ${run} days in a row (the limit is 13)` : '',
    monSat !== CONTRACT_MINUTES ? `${Math.abs(monSat - CONTRACT_MINUTES).toLocaleString('en-GB')} minutes a week ${monSat > CONTRACT_MINUTES ? 'over' : 'under'} the contract across the link` : '',
    // the contracted-days ceiling (owner, 1 Oct 2026, RULES.md): a hard limit, so a design over it cannot be put forward
    daysAYear(P.patterns) > DAYS_CEILING + 1e-9 ? `${daysAYear(P.patterns).toFixed(1)} contracted days a year (the ceiling is ${DAYS_CEILING})` : ''].filter(Boolean);
  // ONE BASIS (owner, 1 Oct 2026): runs and fatigue warnings are compared on the FIXED duties — the cover weeks left out,
  // for the proposal and today's link alike (fixedView in report-data.mjs) — and the worst place a cover week's four
  // duties could fall is stated beside them as "up to". Hard limits are still tested at that worst case.
  const runF = P.fixed.run, runFT = T.fixed.run, runW = run, runWT = T.checks.longestStretch;
  // the worst case INCLUDES the 55-hour week a worked cover week can make (h55Worst, report-data.mjs): the app's row
  // counts a cover week as no hours, so its own count missed it (accuracy audit, 1 Oct 2026)
  const ffW = P.fatigue.present + (meta.h55Cover ? 1 : 0), ffWT = T.fatigue.present;
  const worstDiffers = ffW !== P.fixed.present || ffWT !== T.fixed.present;
  // "up to 0" reads as a slip; where only today's figure moves, say so (accuracy pass, 1 Oct 2026)
  const upTo = ffW === P.fixed.present ? `today up to ${ffWT} if a cover week falls badly` : `up to ${ffW} (today ${ffWT}) if a cover week falls badly`;
  const present = P.fixed.fatigue.results.filter(r => r.status === 'present');
  const presentPlain = [...new Set(present.map(r => plainFatigue(r.title)))];
  const [tw, ts, tsu] = [T.office.wkFit, T.office.fits.sat, T.office.fits.sun], [pw, ps, psu] = [P.office.wkFit, P.office.fits.sat, P.office.fits.sun];
  const closerDays = [['weekday', pw, tw], ['Saturday', ps, ts], ['Sunday', psu, tsu]].filter(([, p, t]) => p != null && t != null && p < t).map(([d]) => d);
  const fitDay = ([d, p, t]) => p == null || t == null ? null : p < t ? [d, 'closer'] : p > t ? [d, 'further'] : [d, 'the same'];
  const fitBits = [['weekdays', pw, tw], ['Saturday', ps, ts], ['Sunday', psu, tsu]].map(fitDay).filter(Boolean);
  const fitWords = fitBits.every(([, w]) => w === 'closer') ? 'On weekdays, Saturdays and Sundays, the number of staff on the floor rises and falls with the December trains more closely than today’s link'
    : fitBits.every(([, w]) => w === 'further') ? 'On every day the number of staff on the floor follows the December trains less closely than today’s link'
    : 'Against today’s link, the floor follows the December trains ' + andList(fitBits.map(([d, w]) => `${w === 'the same' ? 'about the same' : `${w}`} on ${d}`)).replace(/closer on/g, 'more closely on').replace(/further on/g, 'less closely on');
  const fitVerdict = closerDays.length === 3 ? ['Closer than today', 'good'] : closerDays.length === 0 ? ['Not as close as today', 'warn'] : [`Closer on ${closerDays.length} of 3 days`, 'mid'];
  const tWeekShare = T.checks.weekendsOff / tp.L, pWeekShare = P.checks.weekendsOff / pp.L;
  // FULL WEEKENDS A YEAR (owner, 2 Oct 2026): "7 in 26" against "4 in 20" made the reader divide, and a longer link's
  // larger count is not more weekends in a year. Said per year, as late finishes and 06:20 starts already are.
  const tWkYear = Math.round(tWeekShare * 52), pWkYear = Math.round(pWeekShare * 52), pct = x => `${Math.round(x * 100)}%`;
  const shared = P.tableRows.filter(r => T.tableRows.some(t => t.time === r.time)).length, distinct = P.feel.distinctTimes, newTimes = distinct - shared;

  // What staff will notice — only what moved, better or worse, in the order staff weigh it (independent check,
  // 29 Sep 2026: a six-item cap silently dropped late finishes and days at work from one sheet's worry list; now the
  // list is ordered by importance and a longer one says how many more are on page 2, rather than losing them).
  const good = [], bad = [];
  const add = (cond, list, pri, text) => { if (cond) list.push([pri, text]); };
  const weekMoved = everyN(pWeekShare) !== everyN(tWeekShare);   // 5 in 24 against 4 in 20 is one in 5 both ways: no change to offer
  const pGap = weekendGap(P.patterns), tGap = weekendGap(T.patterns);
  // a gap no longer than today's is said as a limit ("never more than 7 weeks apart, as today"); a longer one is said
  // as the cost it is ("though up to 10 weeks apart"), never dressed as reassurance inside a positive
  const gapLonger = pGap != null && tGap != null && pGap > tGap;
  const gapWords = lead => pGap == null ? '' : gapLonger ? `, ${lead}up to ${pGap} weeks apart (today ${tGap})`
    : `, never more than ${pGap} weeks apart${pGap === tGap ? ', as today' : tGap == null ? '' : ` (today ${tGap})`}`;
  add(weekMoved && pWeekShare > tWeekShare, good, 10, `About ${pWkYear} full weekends off a year (today ${tWkYear}), ${P.checks.weekendsOff} in ${pp.L} weeks${gapWords('though ')}`);
  add(weekMoved && pWeekShare < tWeekShare, bad, 10, `Fewer full weekends off — about ${pWkYear} a year (today ${tWkYear}), ${P.checks.weekendsOff} in ${pp.L} weeks${gapWords('')}`);
  for (const t of meta.thinMoments ?? []) { const m = /(\w+day) (\d\d:\d\d–\d\d:\d\d): only (one person|\d+ people)/.exec(t.replace(/<[^>]+>/g, '')); if (m) add(true, bad, 5, `Only ${m[3]} on duty in the whole station, ${m[1]} ${m[2]}`); }
  add(runF < runFT, good, 20, `Never more than ${runF} days in a row in the fixed duties (today ${runFT})`);
  add(runF > runFT, bad, 20, `Up to ${runF} days in a row in the fixed duties (today ${runFT})`);
  const dayDiff = Math.round(pp.daysYear) - Math.round(tp.daysYear);
  add(dayDiff <= -1, good, 25, `About ${-dayDiff} fewer contracted ${dayDiff === -1 ? 'day' : 'days'} at work a year`);
  add(dayDiff >= 1, bad, 25, `About ${dayDiff} more contracted ${dayDiff === 1 ? 'day' : 'days'} at work a year`);
  // the cadence from the UNROUNDED yearly figures (accuracy audit, 1 Oct 2026): rounding each side first turned a
  // difference of 2.6 into 3 and "about one every 20 weeks" into "every 17". The printed figures stay rounded, and
  // the phrase says "about".
  const lateDiff = pp.late23 - tp.late23, openDiff = pp.open0620 - tp.open0620;
  // THE YEARLY FIGURES (external review, 1 Oct 2026): "about one extra every 2 or 3 weeks" undersold what both
  // leading proposals do to evenings — 39 finishes at 23:00 or later a year becoming 59.
  // (the rate, "one extra every 2 or 3 weeks", is page 2's note: on page 1 it took a second line on every sheet and
  // pushed Polished Clean's longest concern list into the footer)
  add(lateDiff >= 2, bad, 30, `More late finishes — about ${Math.round(pp.late23)} a year each (today ${Math.round(tp.late23)})`);
  add(lateDiff <= -2, good, 30, `Fewer late finishes — about ${Math.round(pp.late23)} a year each (today ${Math.round(tp.late23)})`);
  // the 06:20 open was a page-1 tile until the staff tiles left page 1 (owner, 30 Sep 2026); it is a bullet now
  add(openDiff >= 2, bad, 42, `More 06:20 starts — about one extra every ${weeksWords(52 / openDiff)} weeks each`);
  add(openDiff <= -2, good, 42, `Fewer 06:20 starts — about one fewer every ${weeksWords(52 / -openDiff)} weeks each`);
  // Closing shifts are judged SHIFT BY SHIFT (independent check, 29 Sep 2026): an average across a day's closers said
  // "every closing shift shorter" of a Saturday still carrying today's 9h10 closer beside two shorter ones.
  const cl = ['wk', 'sat', 'sun'].map(k => [k, pp.closerAll[k], tp.closerAll[k]]).filter(([, p, t]) => p.length && t.length);
  const mn = a => Math.min(...a), mx = a => Math.max(...a), r5 = x => Math.max(5, Math.round(x / 5) * 5);
  const shorter = cl.filter(([, p, t]) => mx(p) < mn(t) - 2), someShorter = cl.filter(([, p, t]) => !(mx(p) < mn(t) - 2) && mn(p) < mn(t) - 2);
  const longer = cl.filter(([, p, t]) => mn(p) > mx(t) + 2), someLonger = cl.filter(([, p, t]) => !(mn(p) > mx(t) + 2) && mx(p) > mx(t) + 2);
  const cname = { wk: 'weekday', sat: 'Saturday', sun: 'Sunday' };
  if (shorter.length === cl.length && cl.length) {
    const lo = r5(mn(cl.map(([, p, t]) => mn(t) - mx(p)))), hi = r5(mx(cl.map(([, p, t]) => mx(t) - mn(p))));
    add(true, good, 35, `Every closing shift shorter — by about ${lo === hi ? lo : `${lo} to ${hi}`} minutes`);
  } else {
    add(shorter.length > 0, good, 35, `Shorter ${andList(shorter.map(([k]) => cname[k]))} closing shifts`);
    add(someShorter.length > 0, good, 36, `Some shorter ${andList(someShorter.map(([k]) => cname[k]))} closing shifts`);
  }
  add(longer.length > 0, bad, 35, `Longer ${andList(longer.map(([k]) => cname[k]))} closing shifts`);
  add(someLonger.length > 0, bad, 36, `Some longer ${andList(someLonger.map(([k]) => cname[k]))} closing shifts`);
  const avgDiff = pp.avgShift - tp.avgShift;
  add(avgDiff >= 3, bad, 40, `The average shift ${Math.round(avgDiff)} minutes longer`);
  add(avgDiff <= -3, good, 40, `The average shift ${Math.round(-avgDiff)} minutes shorter`);
  add(pp.longest < tp.longest, good, 41, `No shift longer than ${hm(pp.longest)} (today ${hm(tp.longest)})`);
  add(pp.longest > tp.longest, bad, 41, `Its longest shift is ${hm(pp.longest)} (today ${hm(tp.longest)})`);
  add(restMin != null && T.rest?.minutes != null && restMin > T.rest.minutes, good, 45, `Shortest rest between shifts ${hm(restMin)} (today ${hm(T.rest.minutes)})`);
  // the shape of the week (page 4): single rest days, six-day weeks, weeks on one shift time
  const iso = X => X.feel?.isolatedRest, six = X => X.feel?.daysHist?.['6'] ?? 0, one = X => X.feel?.oneTurn / X.feel?.workingLines;
  add(iso(P) != null && iso(P) > iso(T) + 2, bad, 22, `More single rest days, which are not a two-day break — ${iso(P)} (today ${iso(T)})`);
  add(lvP.fourWeeks > lvT.fourWeeks, bad, 23, `Four full weeks off needs ${lvP.fourWeeks} days’ leave (today ${lvT.fourWeeks})`);
  add(lvP.fourWeeks < lvT.fourWeeks, good, 23, `Four full weeks off for ${lvP.fourWeeks} days’ leave (today ${lvT.fourWeeks})`);
  add(iso(P) != null && iso(P) < iso(T) - 2, good, 22, `Fewer single rest days — ${iso(P)} (today ${iso(T)})`);
  add(six(P) > six(T), bad, 21, `More six-day weeks — ${six(P)} (today ${six(T)})`);
  add(one(P) < one(T) - 0.1, bad, 62, `Fewer weeks on one shift time — ${P.feel.oneTurn} of ${P.feel.workingLines} (today ${T.feel.oneTurn} of ${T.feel.workingLines})`);
  add(one(P) > one(T) + 0.1, good, 62, `More weeks on one shift time — ${P.feel.oneTurn} of ${P.feel.workingLines} (today ${T.feel.oneTurn} of ${T.feel.workingLines})`);
  // on duty at the open, 22:00 and the close: a day with fewer than today is named, even when other days gain
  const DN = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  for (const [key, what] of [['open', 'at the open'], ['at22', 'at 22:00'], ['close', 'through to the close']]) {
    const fewer = Object.keys(DN).filter(d => P.heads[key]?.[d] < T.heads[key]?.[d]);
    add(fewer.length > 0, bad, 15, `Fewer on duty ${what} on ${andList(fewer.map(d => `${DN[d]} (${P.heads[key][d]}, today ${T.heads[key][d]})`))}`);
  }
  const ffP = P.fixed.present, ffT = T.fixed.present;
  // the 55-hour row counts a cover week as no hours; where working its four duties would cross 55, page 1 says so
  // rather than calling the count clear (audit, 30 Sep 2026 — page 7 said it, page 1 did not)
  const h55c = meta.h55Cover;
  add(ffP < ffT, good, 50, ffP ? `Fewer fatigue warnings in the fixed duties — ${ffP} (today ${ffT})` : `No avoidable fatigue warnings in the fixed duties (today ${ffT})`);
  add(ffP > ffT, bad, 50, `More fatigue warnings in the fixed duties — ${ffP} (today ${ffT})`);
  // a concern, not a caveat on a positive (accuracy audit, 1 Oct 2026)
  add(!!h55c, bad, 53, `A worked cover week could make a 55-hour week (page 7)`);
  const tFF = r => T.fixed.fatigue.results.find(x => x.code === r.code && x.title === r.title);
  // FF13 (under 12 hours' rest) is ALSO the hard limit: where that is broken the red box says so, and listing it again
  // as a fatigue warning would count one fault twice
  const newFFPlain = [...new Set(present.filter(r => tFF(r)?.status !== 'present' && !(r.code === 'FF13' && rests)).map(r => plainFatigue(r.title)))];
  add(newFFPlain.length > 0, bad, 51, `${newFFPlain.length === 1 ? 'A fatigue warning' : `${newFFPlain.length === 2 ? 'Two fatigue warnings' : `${newFFPlain.length} fatigue warnings`}`} today’s link does not have: ${andList(newFFPlain)}`);
  // a pattern in both links that is BIGGER here — "fewer tiring patterns" must not hide it
  const numOf = v => { const n = parseFloat(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : null; };
  const grown = present.filter(r => tFF(r)?.status === 'present' && numOf(r.value) != null && numOf(tFF(r).value) != null && numOf(r.value) > numOf(tFF(r).value));
  add(grown.length > 0, bad, 52, `Worse than today on ${andList(grown.map(r => `${plainFatigue(r.title)} (${r.value}, today ${tFF(r).value})`))}`);
  // the week-to-week move in start times (FF18), which a reader otherwise meets only on page 7
  const stepMin = X => { const v = X.fatigue.results.find(r => r.code === 'FF18')?.value; const t = /typically\s*(\d+)h\s*(\d+)m/.exec(String(v ?? '')); return t ? +t[1] * 60 + +t[2] : null; };
  const smT = stepMin(T), smP = stepMin(P);
  add(smT != null && smP != null && smP >= smT + 5, bad, 55, `Start times move further from week to week — ${hm(smP)} (today ${hm(smT)})`);
  add(smT != null && smP != null && smP <= smT - 5, good, 55, `Start times move less from week to week — ${hm(smP)} (today ${hm(smT)})`);
  // following the trains, day by day — a weekday can be worse even when the weekday average is better
  const WD = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };
  const worseWeekdays = Object.keys(WD).filter(d => P.office.days?.[d]?.fit != null && T.office.days?.[d]?.fit != null && P.office.days[d].fit > T.office.days[d].fit + 0.5).map(d => WD[d]);
  const worseDays = [...(pw > tw ? ['weekdays'] : worseWeekdays), ...(ps > ts ? ['Saturday'] : []), ...(psu > tsu ? ['Sunday'] : [])];
  add(worseDays.length > 0, bad, 60, `The floor follows the trains less closely than today on ${andList(worseDays)}`);
  add(shared * 2 >= distinct, good, 65, shared === distinct ? `All ${distinct} of its shift times are already worked today` : `${shared} of its ${distinct} shift times are already worked today`);
  add(newTimes > 0, bad, 65, `${newTimes} new shift ${newTimes === 1 ? 'time' : 'times'} to learn`);
  // THE SECOND PLAIN EDITION (owner, 30 Sep 2026, after an outside review: "page 1 tells me what I need to know,
  // pages 2–8 prove it"). Three rules on top of the three in this file's header:
  //   · ONE HOME PER FIGURE. Page 1 used to say everything twice — a strip of ticks, then five tiles saying the same.
  //     The strip is gone; each figure is printed where it is answered and pointed to from anywhere else.
  //   · ONE MEANING PER COLOUR. Green had meant "better than today" on page 2, "more people" on page 4 and "met" on
  //     page 6. Now, on every page: green ✓ = meets a rule, or better than today on something the rules, the hard
  //     limits or the fatigue guidance aim for; amber ▲ = worse on one of those; red ✕ = a rule or limit broken;
  //     no colour = a difference for colleagues to weigh (more Saturdays is more pay to one person, a lost weekend to
  //     another). The symbol is always printed beside the colour, because the sheets are printed in black and white.
  //   · A FAILED RULE IS PART OF THE ANSWER. It was filed under "Still to settle"; it is now in the verdict, in red.
  const lc = t => t.charAt(0).toLowerCase() + t.slice(1);
  const sorted = l => l.slice().sort((a, b) => a[0] - b[0]).map(([, t]) => t);
  const goodAll = sorted(good), badAll = sorted(bad);
  const nWord = k => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'][k] ?? String(k);
  // A point a tile on this page already states is left out of the boxes — since 30 Sep 2026 only the trains tile's
  // (owner: "make those fixes"): the staff tiles left page 1, so weekends, late finishes, 06:20 starts and shift times
  // to learn are bullets again, and the shortest rest and the fatigue count are bullets as well as tile figures,
  // because a manager reads the lists as the case for and against. EVERYTHING ELSE IS SHOWN: v2 once capped each box
  // at three or four behind "the full comparison is on page 2", on a page that calls itself the whole proposal; the
  // cap left is a guard, and says what it hid.
  const onTiles = t => /follows the trains less closely/i.test(t);
  const CAP = 14, boxOf = all => { const l = all.filter(t => !onTiles(t)); return { items: l.length > CAP ? [...l.slice(0, CAP - 1), `…and ${l.length - CAP + 1} more — on page 2`] : l, more: false }; };
  // POSITIVES ARE CAPPED AT FIVE; CONCERNS NEVER ARE (external review, 30 Sep 2026: ten positives against four concerns
  // read as though the sheet were selling the design). A positive left off is a page-2 row, so nothing is lost —
  // the pointer says "More detail on page 2", not a count, which read as keeping score (same review); a
  // concern is never left off. The shortest rest and the fatigue count keep their places when they apply — the owner
  // asked for them as bullets, not tile small print — and the rest are the highest-ranked, in the page's order.
  const GOOD_CAP = 5, pinned = t => /^Shortest rest between shifts|^No avoidable fatigue warnings|^Fewer fatigue warnings/.test(t);
  const goodOf = all => { const l = all.filter(t => !onTiles(t)); if (l.length <= GOOD_CAP) return { items: l, more: false };
    const pins = l.filter(pinned).slice(0, GOOD_CAP), keep = new Set([...pins, ...l.filter(t => !pinned(t)).slice(0, GOOD_CAP - pins.length)]);
    return { items: [...l.filter(t => keep.has(t)), 'More detail on page 2'], more: false }; };
  const goodBox = goodOf(goodAll), badBox = boxOf(badAll);

  // THE BOTTOM LINE — one sentence built from the same lists, never typed: the verdict on the rules and limits, the
  // two gains staff weigh most and the two costs they weigh most, each against today.
  const lead = breaks.length ? `${name} cannot be run as it stands: ${esc(andList(breaks))}.`
    : failed.length ? `${name} stays inside every hard limit but meets only ${meta.decMet} of the ${meta.decOf} December staffing rules${waived.length ? `; ${nWord(waived.length)} more ${waived.length === 1 ? 'is' : 'are'} waived for it` : ''}.`
    : waived.length ? `${name} stays inside every hard limit and meets ${meta.decMet} of the ${meta.decOf} December staffing rules; the other ${nWord(waived.length)} ${waived.length === 1 ? 'is' : 'are'} waived for it.`
    : `${name} meets all ${meta.decOf} December staffing rules and stays inside every hard limit.`;
  // a list item's own dash reads as a break in the sentence ("more late finishes — about one extra … and the average
  // shift …"), so inside the bottom line its detail goes in brackets: "3 (today 1)" becomes "(3, today 1)"
  const inline = t => { const i = t.indexOf(' — '); if (i < 0) return t; const h = t.slice(0, i), d = t.slice(i + 3), m = d.match(/^(.*?) \((today [^()]*)\)$/);
    return m ? `${h} (${m[1]}, ${m[2]})` : /\(/.test(d) ? `${h}, ${d}` : `${h} (${d})`; };
  // the bottom line keeps each item's headline figure and drops the weekend gap: in a
  // sentence of four items the gloss ran into the next one ("…as today and never more than 6 days…"); both stay in the lists
  // …and the cycle count after a per-year figure ("about 14 full weekends off a year (today 10), 7 in 26 weeks")
  const brief = t => t.replace(/, (?:though |never more than |up to )[^,]*? weeks apart(?:, as today| \(today \d+\))?/, '').replace(/(\(today \d+\)), \d+ in \d+ weeks/, '$1');
  const plus = goodAll.slice(0, 2).map(x => esc(lc(inline(brief(x))))), minus = badAll.slice(0, 2).map(x => esc(lc(inline(brief(x)))));
  const bottom = [lead,
    plus.length ? `For staff, the biggest ${plus.length === 1 ? 'gain is' : 'gains are'} ${andList(plus)}.` : 'Nothing is notably better for staff than today.',
    minus.length ? `The main ${minus.length === 1 ? 'trade-off is' : 'trade-offs are'} ${andList(minus)}.` : 'Nothing is notably worse than today.'].join(' ');

  const foot = (k, title) => `<div class="foot"><span>Page ${k} of ${pages} — ${title}</span><span class="foot-id"><b>${name}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>`;
  const n1f = x => x == null ? '—' : Number(x).toFixed(1);
  const tile = (cls, qn, big, label, small) => `<div class="tile ptile ptile-${cls}"><span class="q">${qn}</span><b>${big}</b><span class="l">${label}</span><span class="s">${small}</span></div>`;

  // CAN IT WORK? — the manager's four questions
  const trainsV = closerDays.length === 3
    ? (worseWeekdays.length ? ['Mostly', `closer than today — less close on ${andList(worseWeekdays)}`, 'warn'] : ['Yes', 'closer than today, weekdays and weekend', 'good'])
    : closerDays.length === 0 ? ['No', 'less close than today on every day', 'warn']
    : ['Partly', `closer than today on ${andList(closerDays.map(d => d === 'weekday' ? 'weekdays' : d))} only`, 'warn'];
  const work = [
    tile(failed.length ? 'bad' : 'good', 'Does it meet the December staffing rules?', `${meta.decMet} of ${meta.decOf}`,
      failed.length ? `met — ${nWord(failed.length)} not met${waived.length ? `, ${nWord(waived.length)} waived` : ''}` : waived.length ? `met — ${nWord(waived.length)} waived` : 'rules met',
      `today’s link meets ${meta.decToday} · each rule on page 6`),
    tile(breaks.length ? 'bad' : 'good', 'Can it be run within the hard limits?', breaks.length ? 'No' : 'Yes',
      breaks.length ? 'not as it stands' : 'inside every hard limit',
      `shortest gap ${hm(restMin)} (limit 12h) · most days in a row ${runF}${runW !== runF ? `, up to ${runW} if a cover week falls badly` : ''} (limit 13) · ${monSat === CONTRACT_MINUTES ? '35-hour contract exact' : `${Math.abs(monSat - CONTRACT_MINUTES).toLocaleString('en-GB')} min a week ${monSat > CONTRACT_MINUTES ? 'over' : 'under'} the contract, across the link`} · ${daysAYear(P.patterns).toFixed(1)} days a year (limit ${DAYS_CEILING})`),
    tile(present.length ? 'warn' : 'good', 'Any avoidable fatigue warnings?', `${present.length}`,
      present.length ? `avoidable ${present.length === 1 ? 'warning' : 'warnings'} in the fixed duties` : 'none in the fixed duties',
      `${present.length && presentPlain.length <= 2 ? `${esc(andList(presentPlain))} · ` : ''}today’s link has ${T.fixed.present}${worstDiffers ? ` · ${upTo}` : ''} · guidance, not a pass or fail · page 7`),
    tile(trainsV[2], 'Does staffing follow the trains better?', trainsV[0], trainsV[1],
      `weekdays ${n1f(pw)} (today ${n1f(tw)}) · Sat ${n1f(ps)} (${n1f(ts)}) · Sun ${n1f(psu)} (${n1f(tsu)}) · on weekdays ${offWords(pw, tw) ?? 'lower is closer'} · page&nbsp;5`),
  ].join('');
  const failItems = [...(breaks.length ? [`<b>It cannot be run as it stands</b> — ${esc(andList(breaks))}.`] : []), ...failed.map(r => `<b>${esc(r.rule)}</b> — here ${esc(String(r.value))}`)];
  const failBox = failItems.length ? `<div class="pbox pbox-bad"><h3>${breaks.length ? (failed.length ? `What stops it being run, and the ${nWord(failed.length)} December ${failed.length === 1 ? 'rule' : 'rules'} it does not meet` : 'What stops it being run') : `The ${nWord(failed.length)} December ${failed.length === 1 ? 'rule' : 'rules'} it does not meet`}</h3><ul>${failItems.map(x => `<li>${x}</li>`).join('')}</ul></div>` : '';
  const wv = WAIVERS[meta.identity.code];
  // A per-design waiver (WAIVERS in fresh.mjs — none today: the three soft rules were relaxed for every design on
  // 30 Sep 2026 and left the rule set) is recorded in one line, never argued.
  // the ticket office's own value ("Mon–Fri no · Sat no · Sun no") reads as though no pair is rostered anywhere; where the
  // design does roster some, say which days — page 5 says the same
  const wValue = w => w.key === 'office' && meta.namedOfficeWaived ? meta.namedOfficeWaived : w.key === 'office' && meta.pairDays?.length ? `the pairs are rostered on ${meta.pairDaysTxt} only` : String(w.value);
  const wItems = waived.map(w => `${esc(w.rule)} — here ${esc(wValue(w))}`);
  const waivedBox = wItems.length ? `<div class="pbox pbox-info pwaived"><b>Waived for this design</b>${wv?.date ? ` (agreed by the owner, ${esc(wv.date)})` : ''}: ${wItems.join(' · ')}.</div>` : '';

  // WHAT IT WOULD MEAN FOR STAFF — the colleague's four questions, put to the manager who reads the sheet; figures averaged over the link say "about"
  const feelTile = (big, label, small) => `<div class="tile"><b>${big}</b><span class="l">${label}</span><span class="s">${small}</span></div>`;
  const ab = x => `<span class="ab">about</span> ${x}`;
  const often = d => Math.abs(d) < 1 ? 'about the same' : `about one ${d > 0 ? 'extra' : 'fewer'} every ${weeksWords(52 / Math.abs(d))} weeks`;
  const feel = [
    feelTile(`${P.checks.weekendsOff} in ${pp.L}`, 'full weekends off', `today ${T.checks.weekendsOff} in ${tp.L} · never more than ${pGap ?? '—'} weeks apart (today ${tGap ?? '—'})`),
    feelTile(ab(Math.round(pp.late23)), 'finishes at 23:00 or later, each a year', `today about ${Math.round(tp.late23)} · ${often(lateDiff)}`),
    feelTile(ab(Math.round(pp.open0620)), 'starts at 06:20, the open, each a year', `today about ${Math.round(tp.open0620)} · ${often(openDiff)}`),
    feelTile(newTimes ? `${newTimes} new` : 'None new', `shift ${newTimes === 1 ? 'time' : 'times'} to learn`, `${distinct} shift times in all, ${shared} worked today · ${newTimes ? 'the new ones are listed on page 4' : 'page 4'}`),
  ].join('');
  const boxHtml = (cls, title, b, none) => `<div class="pbox ${cls}"><h3>${title}</h3>${b.items.length ? `<ul>${b.items.map(x => /^More detail on page 2$|^…and \d+ more/.test(x) ? `<li class="pmore">${esc(x)}</li>` : `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="muted">${none}</p>`}</div>`;
  // WHAT IT TAKES — the manager's resource line, restored from the first plain edition's "What does it take?" tile
  // (v2 dropped it): the people, the cover weeks, and the Sunday overtime every week, which is paid on top of the
  // contract and is where two designs meeting the same rules can differ in cost (Full Overhaul rosters 12 a Sunday
  // where the rules ask for 10).
  const SUN_RULE = 10;
  const sunMins = X => Object.values(X.patterns).reduce((a, r) => a + (r.sun === 'RD' || r.sun === 'OFF' || r.sun === 'SPARE' ? 0 : dutyMinutes(r.sun)), 0);
  const hmS = m => `${Math.floor(m / 60)}h&nbsp;${String(Math.round(m % 60)).padStart(2, '0')}m`;
  const takes = `<p class="ptakes"><b>What it takes:</b> ${pp.L} people, ${pp.L - tp.L} more than today’s ${tp.L} · ${pp.cover} cover weeks for leave and sickness · ${P.daily.sun} on duty every Sunday (today ${T.daily.sun}; the rules ask for ${SUN_RULE}) — ${hmS(sunMins(P))} of Sunday overtime across the whole link each week (today ${hmS(sunMins(T))}).</p>`;
  // the masthead's date line also carries the caveat (it was a paragraph of its own; page 8 keeps "not typed in by hand")
  const head1 = must(coverHead.replace(/\s*<div class="strip">[\s\S]*?<\/div>/, ''), /(<div class="meta">Prepared [^·<]*)·[^<]*<\/div>/,
    `$1· every figure is calculated from the rota, not entered by hand</div>`, 'the masthead date line');
  const page1 = `<section class="page cover plain">
  ${head1}
  <p class="pbottom"><span class="pb-k">In short</span>${bottom}</p>
  <p class="pcaveat"><b>For discussion, not a decision.</b> This proposal has not yet been through the roster office or a union rep. Still to settle: which link is used — colleagues’ views come first — and then who starts on which line; the rota does not say who works which week.</p>
  ${takes}
  <h2 class="psec">Can it work?</h2>
  <div class="tiles head4">${work}</div>
  ${failBox && waivedBox ? failBox.replace(/<\/div>$/, `<p class="pbw">${waivedBox.replace(/^<div class="pbox pbox-info pwaived">|<\/div>$/g, '')}</p></div>`) : failBox + waivedBox}
  <h2 class="psec">What it would mean for staff</h2>
  <div class="pcols${badBox.items.length >= 10 || (waivedBox && badBox.items.length >= 9) ? ' pcols--dense' : ''}">
    ${boxHtml('pbox-good', 'Likely positives for staff', goodBox, 'Nothing else notably better than today.')}
    ${boxHtml('pbox-warn', 'What colleagues may be concerned about', badBox, 'Nothing else notably worse than today.')}
  </div>
  ${foot(1, 'On one page')}
</section>`;

  // PAGE 2 — against today's link, in five groups, one row per question, with a plain translation. Shading follows
  // the one colour rule above: only a row the rules, the limits or the fatigue guidance take a view on is coloured.
  const cmp = (better, same) => same ? '' : better ? 'up' : 'down';
  const wkRange = o => { const v = ['mon', 'tue', 'wed', 'thu', 'fri'].map(d => o[d]); const lo = Math.min(...v), hi = Math.max(...v); return lo === hi ? `${lo}` : `${lo}–${hi}`; };
  const headTrio = o => `${wkRange(o)} · ${o.sat} · ${o.sun}`;
  const mark = cls => cls === 'up' ? '<span class="pm pm-up">✓</span>' : cls === 'down' ? '<span class="pm pm-down">▲</span>' : cls === 'no' ? '<span class="pm pm-no">✕</span>' : '';
  // a row the rules take a view on is judged by the RULE first: broken → red ✕, however it compares with today
  // (a 5 at the open beats today's 4 but still breaks "at least four"; a green tick beside "not met" contradicted itself)
  const broken = key => rules.some(r => r.key === key && !r.ok && !r.waived);
  const byRule = (key, cls) => broken(key) ? 'no' : cls;
  const isWaived = key => rules.some(r => r.key === key && r.waived);
  const lab = l => { const i = l.indexOf(' — weekday'); return i < 0 ? l : `${l.slice(0, i)}<span class="psub">${l.slice(i + 3)}</span>`; };
  const row = (label, t, p, cls, words) => `<tr><td>${lab(label)}</td><td class="num">${t}</td><td class="num ${cls}">${mark(cls)}<b>${p}</b></td><td class="muted">${words}</td></tr>`;
  const grp = title => `<tr class="pgrp"><td colspan="4">${title}</td></tr>`;
  const sumD = o => Object.values(o).reduce((a, b) => a + b, 0);
  const ruleOf = key => rules.find(r => ({ open: /at the open/i, at22: /22:00/, close: /to the close/i })[key].test(r.rule));
  const ruleMet = key => { const r = ruleOf(key); return !r ? '' : r.ok ? 'met' : 'not met'; };
  const ruleMetKey = key => { const r = rules.find(x => x.key === key); return !r ? '' : r.ok ? 'met' : 'not met'; };
  const headCls = key => { const ds = Object.keys(T.heads[key]); const up = ds.some(d => P.heads[key][d] > T.heads[key][d]), dn = ds.some(d => P.heads[key][d] < T.heads[key][d]); return up && dn ? '' : cmp(up, !up && !dn); };
  const gaps = P.feel.spareLines.map((l, i, a) => ((a[(i + 1) % a.length] - l + pp.L - 1) % pp.L) + 1);
  const coverWords = gaps.length && gaps.every(g => g === gaps[0]) ? `gaps of ${gaps[0]} weeks` : `gaps of ${andList(gaps.map(String))} weeks`;
  const stepOf = X => { const v = X.fatigue.results.find(r => r.code === 'FF18')?.value; const m = /typically ([^·]+?) a week/.exec(String(v ?? '')); const t = m && /(\d+)h\s*(\d+)m/.exec(m[1]); return t ? `${t[1]}h${t[2].padStart(2, '0')}` : null; };
  const stepT = stepOf(T), stepP = stepOf(P);
  const newSet = new Set(P.tableRows.filter(r => !T.tableRows.some(t => t.time === r.time)).map(r => r.time));
  const newLines = Object.values(P.patterns).filter(r => DAYS.some(d => newSet.has(r[d])));
  const ofW = X => `${X.feel.oneTurn} of ${X.feel.workingLines}`;
  const rows2 = [
    grp('Staffing'),
    row('People on the link', tp.L, pp.L, '', `${pp.L - tp.L} more people, one per line`),
    row('On duty each day — weekday · Sat · Sun', headTrio(T.daily), headTrio(P.daily), byRule('sunday', cmp(sumD(P.daily) > sumD(T.daily), sumD(P.daily) === sumD(T.daily))), `the December levels ask for 10 on a Sunday — ${ruleMetKey('sunday')}`),
    row('On at the open — weekday · Sat · Sun', headTrio(T.heads.open), headTrio(P.heads.open), byRule('open', headCls('open')), `at least 4 every day — ${ruleMet('open')}`),
    row('Still on duty at 22:00 — weekday · Sat · Sun', headTrio(T.heads.at22), headTrio(P.heads.at22), byRule('at22', headCls('at22')), `at least 5 every day — ${ruleMet('at22')}`),
    row('Through to the close — weekday · Sat · Sun', headTrio(T.heads.close), headTrio(P.heads.close), byRule('close', headCls('close')), `at least 3 every day — ${ruleMet('close')}`),
    row('How closely the floor follows the trains — weekday · Sat · Sun', `${n1(tw)} · ${n1(ts)} · ${n1(tsu)}`, `${n1(pw)} · ${n1(ps)} · ${n1(psu)}`, closerDays.length === 3 ? 'up' : closerDays.length === 0 ? 'down' : '', `lower is closer; weekdays ${offWords(pw, tw)?.replace(/^a score /, '') ?? 'as today'} — page 5`),
    row('Cover weeks — for leave and sickness', `lines ${T.feel.spareLines.join(', ')}`, `lines ${P.feel.spareLines.join(', ')}`, '', coverWords),
    // a design whose author named its office (NAMED_OFFICE in report-data.mjs) says its own Sunday late in its meta
    row('Ticket office late shift on a Sunday — people', 1, meta.namedOfficeSunLates ?? 2, '', meta.namedOfficeSunWords ?? `the December plan: both in the office 15:00–18:00, then one on the floor; today one 14:30–23:25 closer keeps it until 22:30${(meta.pairDays ?? []).includes('sun') ? '' : ' — this rota does not mark them, so two are assumed from its duties'}`),
    grp('Working pattern'),
    row('Most days in a row, fixed duties', runFT, runF, run > 13 ? 'no' : cmp(runF < runFT, runF === runFT), `${runW !== runF || runWT !== runFT ? `up to ${runW} (today ${runWT}) if a cover week falls badly; ` : ''}Chiltern’s limit is 13${runW !== runF || runWT !== runFT ? '' : ' (written source to confirm)'}`),
    row('Shortest gap between two shifts', hm(T.rest?.minutes), hm(restMin), rests ? 'no' : cmp(restMin > T.rest?.minutes, restMin === T.rest?.minutes), 'in the fixed duties; the limit is 12 hours'),
    row('Full weekends off, in the rotation', `${T.checks.weekendsOff} in ${tp.L}`, `${P.checks.weekendsOff} in ${pp.L}`, cmp(pWeekShare > tWeekShare, everyN(pWeekShare) === everyN(tWeekShare)), pGap == null ? 'none in the rotation' : `uneven: never more than ${pGap} weeks apart (today ${tGap ?? '—'})`),
    row('Days at work a year, not counting Sundays', tp.daysYear.toFixed(1), pp.daysYear.toFixed(1), '', 'Sundays are overtime; a cover week counts as 4 days'),
    row('Weeks on one shift time', ofW(T), ofW(P), '', 'all earlies or all lates, one clock time Monday to Friday'),
    row('Weeks mixing earlies and lates', `${T.feel.hybrid} of ${T.feel.workingLines}`, `${P.feel.hybrid} of ${P.feel.workingLines}`, '', 'a week with both early and late shifts in it'),
    row('Single rest days', iso(T), iso(P), '', 'a rest day on its own — not a two-day break'),
    row('Six-day weeks', six(T), six(P), '', 'weeks with six days at work, Sundays counted'),
    row('Leave for four full weeks off', `${lvT.fourWeeks} days`, `${lvP.fourWeeks} days`, cmp(lvP.fourWeeks < lvT.fourWeeks, lvP.fourWeeks === lvT.fourWeeks), 'the least leave that makes 28 days off in a row; rest days and Sundays cost none'),
    grp('Shifts'),
    row('Average shift · longest shift', `${hm(tp.avgShift)} · ${hm(tp.longest)}`, `${hm(pp.avgShift)} · ${hm(pp.longest)}`, '', 'the average is Monday to Saturday; the longest is on any day'),
    row('Early shifts, shortest to longest', tp.earlySpan, pp.earlySpan, '', 'an early starts before 11:00 · any day of the week'),
    row('Late shifts, shortest to longest', tp.lateSpan, pp.lateSpan, '', 'a late starts at 11:00 or after · any day of the week'),
    // the three closing figures are one unit, so they never break unevenly between the two cells ("8h 40m · 9h 10m ·" / "8h 55m")
    row('Closing shift — weekday · Sat · Sun', `<span class="trio">${['wk', 'sat', 'sun'].map(k => tp.closerSpan[k]).join(' · ')}</span>`, `<span class="trio">${['wk', 'sat', 'sun'].map(k => pp.closerSpan[k]).join(' · ')}</span>`, (shorter.length + someShorter.length) && (longer.length + someLonger.length) ? '' : cmp(shorter.length + someShorter.length > 0, longer.length + someLonger.length === 0 && shorter.length + someShorter.length === 0), 'the shift that locks up'),
    ...(stepT && stepP ? [row('How far the start time moves from one week to the next — on average', stepT, stepP, smT != null && smP != null ? cmp(smP < smT, Math.abs(smP - smT) < 5) : '', 'smaller is easier on the body clock')] : []),
    row('Different shift times', T.feel.distinctTimes, `${distinct} (${shared} worked today)`, byRule('times', cmp(distinct < T.feel.distinctTimes, distinct === T.feel.distinctTimes)), newTimes ? `${newTimes} new to learn, on ${newLines.length} of the ${P.feel.workingLines} working weeks — listed on page 4` : 'nothing new to learn'),
    grp('Each person’s year, on average'),
    row('Full weekends off', tWkYear, pWkYear, cmp(pWkYear > tWkYear, pWkYear === tWkYear), `${pct(pWeekShare)} of weeks (today ${pct(tWeekShare)})`),
    row('Finishing at 23:00 or later', Math.round(tp.late23), Math.round(pp.late23), '', Math.abs(lateDiff) < 1 ? 'about the same as today' : `about one ${lateDiff > 0 ? 'extra' : 'fewer'} every ${weeksWords(52 / Math.abs(lateDiff))} weeks`),
    row('Starting at 06:20, the open', Math.round(tp.open0620), Math.round(pp.open0620), '', Math.abs(openDiff) < 1 ? 'about the same as today' : `about one ${openDiff > 0 ? 'extra' : 'fewer'} every ${weeksWords(52 / Math.abs(openDiff))} weeks`),
    row('Saturdays worked', Math.round(tp.sat), Math.round(pp.sat), '', 'a rostered Saturday is paid at time and a quarter; cover weeks not counted'),
    row('Sunday overtime to share', Math.round(tp.sun), Math.round(pp.sun), '', 'Sundays are overtime, as today'),
    grp('Fatigue and the rules'),
    row('Avoidable fatigue warnings, fixed duties', T.fixed.present, P.fixed.present, cmp(P.fixed.present < T.fixed.present, P.fixed.present === T.fixed.present), `${worstDiffers ? `${upTo}${h55c ? (ffW > 1 ? ', one a 55-hour week' : ' — a 55-hour week') : ''}; guidance only, page 7` : 'guidance, not a pass or fail; early starts and a weekly rotation come with every link — page 7'}`),
    row('December staffing rules met', `${meta.decToday} of ${meta.decOf}`, `${meta.decMet} of ${meta.decOf}`, failed.length ? 'no' : cmp(meta.decMet > meta.decToday, meta.decMet === meta.decToday), `confirmed verbally, 29 Sep 2026${waived.length ? `; ${nWord(waived.length)} more waived for this design` : ''} — page 6`),
  ].join('');
  const page2 = `<section class="page plain">
  <div class="mast"><div><div class="eyebrow">Against today’s link</div><h1>What changes, in numbers</h1><div class="sub">Today’s 20-week link beside ${name}. <b>✓ green</b>: better than today on something the rules, hard limits or fatigue guidance aim for · <b>▲ amber</b>: worse on one of those · <b>✕ red</b>: a rule or limit broken · <b>unshaded</b>: for colleagues to weigh.</div></div></div>
  <table class="t pcmp"><thead><tr><th>Question</th><th class="num">Today</th><th class="num">${name}</th><th>In plain words</th></tr></thead><tbody>${rows2}</tbody></table>
  <p class="pnext"><b>The workings:</b> the rota (page 3) · shift times (4) · staffing through the day (5) · the rules (6) · fatigue checks (7) · can I trust these numbers? (8)</p>
  ${foot(2, 'Against today’s link')}
</section>`;
  return page1 + page2;
}

function methodPage({ meta, pages }) {
  const name = esc(meta.identity.name);
  // "CAN I TRUST THESE NUMBERS?" (owner, 30 Sep 2026, after an outside review). The page a sceptical reader turns to,
  // so it opens with the answer — how firm each kind of figure is — in three boxes, and keeps the plain explanations
  // beneath as short cards. Nothing the old page said is lost; "How firm each figure is" and "What no page can tell
  // you" became the boxes, and every card is shorter.
  const box = (cls, h, lead, items) => `<div class="tbox tbox-${cls}"><h3>${h}</h3><p>${lead}</p><ul>${items.map(x => `<li>${x}</li>`).join('')}</ul></div>`;
  const boxes = [
    box('firm', 'Firm', 'Worked out exactly from the rota, and checked again by the app:', ['the rest gaps and the most days in a row', 'the 35-hour contract', 'full weekends off', 'how many people are on duty, hour by hour', 'the shift times and their lengths']),
    box('guide', 'A guide, not a verdict', 'Useful for comparing, never a pass or a fail:', ['how closely the floor follows the trains', 'the fatigue warnings — guidance from the rail regulator', 'how familiar the shift times are', 'figures “each, a year” — averages over the whole link']),
    box('unknown', 'Not known yet', 'No rota can say these; they are for the people who work it and the managers who roster it:', ['where each cover week’s four duties fall', 'how leave and sickness land', 'whether staff accept the new shift times', 'Wembley event days — the rota follows the trains, not the crowds', 'who starts on which line', 'the written source of the 13-day limit']),
  ].join('');
  const items = [
    ['Where the figures come from', 'Every figure is worked out from the rota on page 3 by the Marylebone Roster app, and the same calculation is run on today’s link. None is typed in by hand.'],
    ['Cover weeks', 'Marked on all seven days but worked on four, placed by the roster clerk. A cover week counts as a full contracted week and as four days at work. Their shift times are not known yet, so the runs, rest gaps, yearly counts and fatigue warnings are worked out on the fixed duties — the cover weeks left out, and today’s link the same way. Where a cover week’s four duties could make a figure worse, the worst place they could fall is given beside it as “up to”, and the hard limits are tested at that worst case. Whatever is later given in a cover week must still be rostered within the normal limits.'],
    ['Sundays', 'Sunday is not in the contract: Sunday duties are overtime, as today. So “days at work” and the 35-hour week are Monday to Saturday. A Sunday off costs no annual leave.'],
    ['Each person, a year', 'Every week’s duties, times 52, shared across everyone on the link — Sunday overtime included. “Days at work a year” is Monday to Saturday only: the days a week × 365 ÷ 7. Somebody’s own year depends on which week they start on.'],
    ['Following the trains', 'For each hour, the share of the day’s floor staff is set against the share of the day’s train service in the December 2026 timetable, each train weighted by its length; the differences are squared — so one big mismatch counts far more than several small ones — added up and multiplied by 10,000. 0 would be a perfect match; lower is closer. The staff share uses the minutes each person spends on the floor, finer than the whole-person counts on page 5, where anyone on for part of an hour counts. It measures the shape of the day, not a staffing level: an extra person in a quiet hour makes it worse although nobody is worse off. The ticket office is taken out first: it is staffed to its opening hours, not to the trains, which is why its rows on page 5 carry no match figure.'],
    ['The ticket office', meta.namedOfficeP8 ?? `In the proposal, two people on every ticket-office shift, not floor cover except at the quiet ends: Monday to Saturday one of each pair is on the floor until 08:00 and from 19:30. On a Sunday one early is on the floor until 09:00; the two lates until 15:00, then both in the office, one back on the floor from 18:00. Today one person keeps the office on a Sunday afternoon and evening.${(meta.pairDays ?? []).length < 7 ? ' This rota does not mark which duties are in the office on every day, so where it does not, the office posts are assumed from its duties — page 5 shows them.' : ''}`],
    ['Rest, runs and weekends', 'The shortest gap is the single tightest one in the fixed duties, Saturday into Sunday and line into line included. The most days in a row counts Sunday overtime too; it is given for the fixed duties, with “up to” where a cover week placed as badly as it can be would make it longer, and the 13-day limit is tested at that worst case. A full weekend off is a Saturday off then a Sunday off. The shortest gap is one gap: a rota with many rests of just over 12 hours reads the same as one with none.'],
    ['Handover', 'The overlap when one shift takes over from another. The December rules ask for 15 minutes to each closer, and 20 in the ticket office (30 on a Sunday) — page 6.'],
    ['Familiar shift times', 'How many of the shift times somebody already works today — a rough guide to how much there is to learn, not to what staff will accept.'],
    ['Fatigue warnings', 'The Office of Rail and Road’s good-practice list of roster patterns that tend to tire people, with four rail-industry checks. A warning is a question to discuss, not a breach, and this is not a fatigue risk assessment. Early starts at a 06:20 station and a weekly rotation come with every link, today’s included, so they are recorded on page 7 and not counted. In the ORR’s checks an early start is one from 05:00 up to 06:59 and a “block” of earlies is two or more in a row; the start-time rows count how many times a start moves by more than two hours (a count, not hours); the week-to-week move is the average change in a week’s mean start time, Sundays included and cover weeks left out.'],
    ['What is confirmed', `The December 2026 staffing levels and the Sunday cover were confirmed verbally on 29 September 2026; the ${LINES}-line link, ${COVER_WEEKS} cover weeks and the ceiling of ${DAYS_CEILING} contracted days a year were set on 1 October 2026.`],
  ];
  return `<section class="page plain">
  <div class="mast"><div><div class="eyebrow">The method</div><h1>Can I trust these numbers?</h1><div class="sub">How firm each figure is, what it is based on, and what no rota can tell you.</div></div></div>
  <div class="tboxes">${boxes}</div>
  <h2 class="pmh">What each figure is based on</h2>
  <div class="pcards">${items.map(([h, t]) => `<div class="pcard"><h4>${h}</h4><p>${t}</p></div>`).join('')}</div>
  <p class="muted pimport">The rota is supplied beside this PDF as <span class="tt">${esc(meta.identity.name.replace(/ /g, '-'))}-${esc(meta.identity.code)}-import.txt</span>, ready to paste into the Links page (Import), which re-runs every check here. The code <b>${esc(meta.identity.fingerprint)}</b> in every footer is worked out from the ${LINES * 7} days of the rota and nothing else, so a printout always matches the design it came from.</p>
  <div class="foot"><span>Page ${pages} of ${pages} — Can I trust these numbers?</span><span class="foot-id"><b>${name}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>
</section>`;
}

const CSS = `
.plain .plead { font-size: 11.5px; margin: 10px 0 8px; }
.pq { display: grid; grid-template-columns: 31% 30% 1fr; gap: 10px; align-items: center; border-bottom: 1px solid var(--border-light); padding: 7px 2px; }
.pq-q { font-weight: 700; font-size: 12px; color: var(--primary-blue); }
.pq-p { font-size: 10.5px; color: var(--text-mid); }
.pv { display: inline-block; font-weight: 800; font-size: 12px; padding: 3px 10px; border-radius: 12px; }
.pv-good { background: color-mix(in srgb, var(--success-green) 14%, white); color: var(--success-green); }
.pv-warn, .pv-mid { background: color-mix(in srgb, var(--warning-amber) 16%, white); color: var(--warning-amber); }
.pv-bad { background: color-mix(in srgb, var(--danger-red, #b3261e) 14%, white); color: var(--danger-red, #b3261e); }
.pv-info { background: var(--surface-sunken); color: var(--primary-blue); }
.cover.plain .plead { font-size: 10.5px; margin: 10px 0 4px; line-height: 1.45; }
.ptile { border-top: 4px solid var(--border-mid); } .ptile-good { border-top-color: var(--success-green); } .ptile-warn { border-top-color: var(--warning-amber); } .ptile-bad { border-top-color: var(--danger-red, #b3261e); } .ptile-info { border-top-color: var(--primary-blue); }
.ptile-good b { color: var(--success-green); } .ptile-warn b { color: color-mix(in srgb, var(--warning-amber) 70%, black); } .ptile-bad b { color: var(--danger-red, #b3261e); }
.cover.plain .head5 .tile .q { min-height: 30px; } .cover.plain .head5 .tile b { font-size: 21px; }
.tiles.pfeel { margin: 0 0 4px; } .pfeel .tile b { font-size: 18px; } .pfeel .tile .l { font-size: 9.5px; } .pfeel .tile .s { font-size: 8.8px; }
.cover.plain .pbox ul { font-size: 10.2px; line-height: 1.45; } .cover.plain .pbox h3 { font-size: 11.5px; }
.pcols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
.pbox { border-radius: var(--radius); padding: 9px 14px; background: var(--surface-sunken); border-left: 4px solid var(--primary-blue); }
.pbox h3 { margin: 0 0 4px; font-size: 12.5px; }
.pbox ul { margin: 0 0 0 16px; padding: 0; font-size: 11px; line-height: 1.5; }
.pbox-good { border-left-color: var(--success-green); } .pbox-good h3 { color: var(--success-green); }
.pbox-warn { border-left-color: var(--warning-amber); } .pbox-warn h3 { color: var(--warning-amber); }
.pbox-decide { margin-top: 12px; border-left-color: var(--accent-gold); } .pdecide1 { font-size: 10px; padding: 7px 14px; } .pdecide1 b { color: var(--primary-blue); } .pbox-decide h3 { color: var(--primary-blue); }
/* polish (owner, 29 Sep 2026: "aesthetic polish with screenshots throughout") */
table.pcmp tbody tr:nth-child(even) td { background-color: color-mix(in srgb, var(--surface-sunken) 60%, white); }
table.pcmp tbody tr:nth-child(even) td.up { background-color: color-mix(in srgb, var(--success-green) 14%, white); }
table.pcmp tbody tr:nth-child(even) td.down { background-color: color-mix(in srgb, var(--warning-amber) 18%, white); }
.gloss { display: block; column-count: 2; column-gap: 20px; } .gloss > div { break-inside: avoid; margin: 0 0 5px; }
tr.gone td { text-decoration: none; color: var(--text-light); font-style: italic; }
dl.pmethod { column-count: 2; column-gap: 22px; } dl.pmethod .pmi { break-inside: avoid; margin-bottom: 6px; } dl.pmethod dt { margin-top: 0; }
ul.p5key { margin: 6px 0 4px 16px; padding: 0; font-size: 9.6px; line-height: 1.4; } ul.p5key li { margin: 1px 0; } h2.p5gtk { font-size: 12px; margin: 10px 0 2px; } ul.p5notes { margin: 2px 0 6px 16px; padding: 0; font-size: 9.2px; line-height: 1.4; color: var(--text-mid); } ul.p5notes li { margin: 2px 0; } ul.p5notes b { color: var(--text-dark, #1a1a2e); }
/* PAGE 5, THE HOUR-BY-HOUR TABLES (owner, 29 Sep 2026: "needs a lot of aesthetic polish"). One grid for all three
   tables — a fixed label column and equal hour columns, so an hour sits in the same place down the whole page — with
   heatmap cells rather than ruled boxes, labels in sentence case, today's block on a grey bar and the proposal's on
   gold, and a gap before the trains. Every number is unchanged; only the drawing is. */
.p5 h2 { margin: 11px 0 3px; }
.p5legend { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 18px; margin: 8px 0 4px; font-size: 9px; line-height: 1.35; color: var(--text-mid); }
.p5legend b { color: var(--text-dark, #1a1a2e); }
.p5legend .sw { display: inline-block; width: 34px; height: 9px; border-radius: 2px; vertical-align: -1px; margin-right: 5px; }
.p5legend .sw-blue { background: linear-gradient(90deg, color-mix(in srgb, var(--cov-early) 14%, white), color-mix(in srgb, var(--cov-early) 92%, black)); }
.p5legend .sw-orange { background: linear-gradient(90deg, color-mix(in srgb, var(--cov-late) 12%, white), color-mix(in srgb, var(--cov-late) 78%, black)); }
table.p5t { table-layout: fixed; width: calc(100% + 4px); border-collapse: separate; border-spacing: 2px; margin: 0 -2px; }
table.p5t th, table.p5t td { border: 0 !important; }
table.p5t th.cov-heat-hour { background: none; font-size: 8px; font-weight: 700; color: var(--text-mid); padding: 0 0 1px; }
table.p5t th.cov-heat-hour:first-child { width: 28%; }
table.p5t th.cov-fit-h { width: 40px; text-transform: none; letter-spacing: 0; font-size: 8px; color: var(--primary-blue); }
table.p5t .cov-heat-day { background: none; text-transform: none; letter-spacing: 0; font-size: 9px !important; font-weight: 700; color: var(--text-dark, #1a1a2e); padding: 0 6px 0 7px; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-left: 3px solid var(--border-mid) !important; }
table.p5t .office-day, table.p5t .floor-day { font-weight: 500; color: var(--text-mid); padding-left: 15px; font-size: 8.4px !important; }
table.p5t th.prop-row, table.p5t tr:has(> th.prop-row) ~ tr > th.cov-heat-day:not(.dem-day) { border-left-color: var(--accent-gold) !important; }
table.p5t th.prop-row { color: var(--primary-blue); }
table.p5t th.dem-day { border-left-color: var(--cov-late) !important; }
table.p5t .cov-heat-cell { height: 15px !important; min-width: 0; font-size: 8.5px !important; border-radius: 2px; font-variant-numeric: tabular-nums; }
table.p5t tr:has(> .office-day) .cov-heat-cell, table.p5t tr:has(> .floor-day) .cov-heat-cell { height: 12px !important; font-size: 7.8px !important; font-weight: 600; }
table.p5t .cov-heat-cell.heat-b0 { background: color-mix(in srgb, var(--surface-sunken) 55%, white); }
table.p5t tr.p5gap td { height: 3px; padding: 0; background: none; }
table.p5t td.cov-fit { background: color-mix(in srgb, var(--primary-blue) 8%, white); border-radius: 2px; font-size: 9px; color: var(--primary-blue); }
table.p5t td.cov-fit:empty { background: none; }
/* a weekday table with a row per day (Cover at Seventeen has five) keeps the grid but tightens it to fit the page */
table.p5t.cov-heat--dense { border-spacing: 2px 1.5px; }
table.p5t.cov-heat--dense .cov-heat-cell { height: 13px !important; font-size: 8px !important; }
table.p5t.cov-heat--dense tr:has(> .office-day) .cov-heat-cell, table.p5t.cov-heat--dense tr:has(> .floor-day) .cov-heat-cell { height: 10.5px !important; font-size: 7.4px !important; }
table.p5t.cov-heat--dense .cov-heat-day { font-size: 8.4px !important; } table.p5t.cov-heat--dense .office-day, table.p5t.cov-heat--dense .floor-day { font-size: 7.8px !important; }
.p5 ul.p5notes { column-count: 2; column-gap: 20px; margin-left: 14px; font-size: 8.7px; line-height: 1.34; } .p5 ul.p5notes li { break-inside: avoid; margin: 0 0 3px; } .p5 ul.p5notes.p5notes--dense { line-height: 1.24; } .p5 ul.p5notes.p5notes--dense li { margin: 0 0 2px; }
.p5 h2.p5gtk { margin: 6px 0 2px; font-size: 11px; } .p5 .p5legend { font-size: 8.6px; margin: 5px 0 1px; gap: 2px 18px; } .p5 h2 { margin: 7px 0 2px; }
.p5 .callout { margin-top: 6px; padding-top: 6px; padding-bottom: 6px; font-size: 9.2px; }
/* THE WHOLE SHEET IN PAGE 5'S LANGUAGE (owner, 29 Sep 2026: "the other pages … still lots of rough edges"). One card:
   a quiet sunken panel with ONE accent — a straight bar, square on its own side and rounded elsewhere, never the
   curved bracket a radius puts on a side border — and the accent's colour always means the same thing: green good,
   amber a concern, red a hard limit broken, navy plain information. Tables stripe like page 2's, ticks and crosses
   carry their meaning in colour, and loose notes sit in a card of their own. No figure or word changes. */
.cover.plain .head5 .tile, .cover.plain .pfeel .tile { border: 0 !important; border-radius: 8px; background: var(--surface-sunken); box-shadow: inset 0 3px 0 var(--bar, var(--border-mid)); padding: 8px 10px 6px; }
.cover.plain .ptile-good { --bar: var(--success-green); } .cover.plain .ptile-warn { --bar: var(--warning-amber); }
.cover.plain .ptile-bad { --bar: var(--danger-red, #b3261e); } .cover.plain .ptile-info { --bar: var(--primary-blue); }
.cover.plain .pfeel .tile { --bar: color-mix(in srgb, var(--primary-blue) 35%, white); }
.cover.plain .tiles.head5 { gap: 8px; } .cover.plain .tiles.pfeel { gap: 8px; margin-top: 6px; }
.pbox, .check-row, .callout { border-radius: 0 8px 8px 0 !important; }
.cover.plain .pcols { gap: 12px; align-items: stretch; }
.cover.plain .pbox { padding: 8px 14px; }
/* tables: page 2's stripe, one header style */
table.t.kept tbody tr:nth-child(even) td, table.t.changed tbody tr:nth-child(even) td, table.t.dutyt tbody tr:nth-child(even) td:not(.up):not(.down), table.t.rules tbody tr:nth-child(even):not(.rule-miss) td, table.ff tbody tr:nth-child(even):not(.ff-na-note) td { background-color: color-mix(in srgb, var(--surface-sunken) 60%, white); }
table.t th { border-bottom: 0 !important; } table.t thead tr:last-child th { box-shadow: inset 0 -1px 0 var(--border-mid); }
.stack table.t td { padding: 2.5px 6px; }
.stack table.t.kept { table-layout: fixed; } .stack table.t.kept th:nth-child(1) { width: 40%; } .stack table.t.kept th:nth-child(2) { width: 27%; } .stack table.t.kept th:nth-child(3) { width: 33%; }
.stack table.t td { white-space: normal !important; overflow-wrap: anywhere; } .stack table.t td.num { white-space: nowrap !important; overflow-wrap: normal; }
.stack table.t.changed { table-layout: fixed; } .stack table.t.changed th:nth-child(1) { width: 27%; } .stack table.t.changed th:nth-child(2) { width: 15%; } .stack table.t.changed th:nth-child(3) { width: 19%; } .stack table.t.changed th:nth-child(4) { width: 39%; }
/* the duty table's notes: a card beside the table, not text floating in the margin */
.cols.duty > div:last-child { background: var(--surface-sunken); border-radius: 8px; padding: 9px 11px; align-self: start; }
.cols.duty > div:last-child p { margin: 0 0 6px; } .cols.duty > div:last-child p:last-child { margin: 0; }
/* ticks and crosses */
.mk { display: inline-block; width: 1.05em; font-weight: 800; } .mk-ok { color: var(--success-green); } .mk-no { color: var(--danger-red, #b3261e); } .mk-wv { color: var(--text-mid); }
.check-row .check-icon { align-self: flex-start; margin-top: 1px; }
/* the fatigue table: a factor's name is read in one colour; the verdict columns carry the colour */
td.ff-title { color: var(--text-dark, #1a1a2e) !important; }
ul.p8list { margin: 8px 0 0 16px; padding: 0; font-size: 9.2px; line-height: 1.45; color: var(--text-dark, #1a1a2e); } ul.p8list li { margin: 3px 0; } tr.ff-na-note td { font-size: 9px; color: var(--text-mid); padding-top: 5px; border-bottom: 0; }
table.pcmp { font-size: 9.8px; margin-top: 5px; } table.pcmp td { padding: 2.2px 6px; line-height: 1.28; } table.pcmp td.num, table.pcmp th.num { text-align: center; } table.pcmp { table-layout: fixed; width: 100%; } table.pcmp th:nth-child(1) { width: 29%; } table.pcmp th:nth-child(2) { width: 16%; } table.pcmp th:nth-child(3) { width: 19%; } table.pcmp th:nth-child(4) { width: 36%; }
table.pcontents td { font-size: 10px; padding: 1.8px 6px; } table.pcontents td.num { width: 24px; font-weight: 800; color: var(--primary-blue); }
dl.pmethod { margin: 10px 0; } dl.pmethod dt { font-weight: 800; color: var(--primary-blue); font-size: 11.5px; margin-top: 7px; } dl.pmethod dd { margin: 2px 0 0; font-size: 10.2px; line-height: 1.42; max-width: 175mm; }

/* SECOND PLAIN EDITION (30 Sep 2026) — answer first, one home per figure, one meaning per colour */
.cover.plain .pbottom { font-size: 12.2px; line-height: 1.5; margin: 12px 0 4px; padding: 9px 14px; background: color-mix(in srgb, var(--accent-gold) 13%, white); border-radius: 0 8px 8px 0; box-shadow: inset 4px 0 0 var(--accent-gold); color: var(--text-dark, #1a1a2e); }
.cover.plain .pbottom .pb-k { display: block; font-size: 8.6px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: var(--primary-blue); margin-bottom: 2px; }
.cover.plain .pshort { font-size: 9.6px; color: var(--text-mid); margin: 5px 0 2px; line-height: 1.4; } .cover.plain .pshort b { color: var(--text-dark, #1a1a2e); }
/* page 1 head, compacted (30 Sep 2026): the space goes to the positives and concerns, which are now shown in full */
.cover.plain .mast { padding: 12px 24px 11px; } .cover.plain .mast h1 { font-size: 24px; } .cover.plain .mast img { width: 40px; height: 40px; }
.cover.plain .ident { margin-top: 9px; } .cover.plain .ident-name { font-size: 26px; }
.cover.plain .pbottom { font-size: 12.2px; line-height: 1.5; margin-top: 10px; padding: 8px 14px; }
.cover.plain h2.psec { margin: 10px 0 5px !important; }
.cover.plain .pcols { margin-top: 8px; } .cover.plain .pdecide1 { margin-top: 8px; } .cover.plain .pbox-bad { margin-top: 6px; }
table.p4shape { margin-top: 4px; font-size: 9.4px; table-layout: fixed; width: 100%; } table.p4shape td, table.p4shape th { padding: 2px 6px; line-height: 1.3; } table.p4shape th:nth-child(1) { width: 26%; } table.p4shape th:nth-child(2) { width: 30%; } table.p4shape th:nth-child(3) { width: 21%; } table.p4shape td:nth-child(2), table.p4shape td:nth-child(3) { white-space: nowrap; } table.p4shape td.p4wrap { white-space: normal; } table.p4shape .p4nw { white-space: nowrap; }
h2.p4shape-h { margin-top: 7px; }
.cover.plain .pwaived { margin-top: 6px; font-size: 9.6px; line-height: 1.4; padding: 6px 14px; } .cover.plain .pwaived b { color: var(--primary-blue); }
.cover.plain .head4 .tile .s { font-size: 9.5px; line-height: 1.35; }
.cover.plain .pbw { margin: 5px 0 0; padding-top: 4px; border-top: 1px dashed color-mix(in srgb, var(--danger-red, #b3261e) 30%, white); font-size: 9.4px; line-height: 1.35; color: var(--text-mid); } .cover.plain .pbw b { color: var(--primary-blue); }
.cover.plain .pcaveat { font-size: 10.4px; line-height: 1.45; margin: 7px 0 0; color: var(--text-dark, #1a1a2e); } .cover.plain .pcaveat b { color: var(--danger-red, #b3261e); }
.cover.plain .pbox li.pmore { list-style: none; margin-left: -16px; font-style: italic; color: var(--text-mid); }
table.ff .ff-plain { display: block; font-weight: 700; } table.ff .ff-orr { display: block; font-size: 8.4px; color: var(--text-mid); margin-top: 1px; }
.cover.plain .ptakes { font-size: 10.4px; margin: 6px 0 0; line-height: 1.4; color: var(--text-dark, #1a1a2e); } .cover.plain .ptakes b { color: var(--primary-blue); }
.cover.plain .pcols .pbox ul { font-size: 10.2px; line-height: 1.42; }
/* a long concerns list (Fifteen Turns: every concern shown, never capped) ran its panel onto the footer — tighten it,
   never cut it (screenshot check, 30 Sep 2026) */
.cover.plain .pcols--dense .pbox ul { font-size: 9.8px; line-height: 1.3; }
.cover.plain h2.psec { font-size: 12.5px; margin: 11px 0 5px; color: var(--primary-blue); letter-spacing: .01em; }
/* PAGE 1 BREATHES (3 Oct 2026, aesthetic pass from screenshots): the cover ended a third of the way up the page on every
   26-line sheet, so the blocks a reader meets first were the smallest type on the sheet. Scaled up ~12% and spaced; the
   dense variant (.pcols--dense) keeps its own size so a long concerns list still fits. */
.cover.plain .pbottom { font-size: 13.4px; line-height: 1.52; margin-top: 14px; padding: 11px 16px; }
.cover.plain .pcaveat { font-size: 11.4px; line-height: 1.5; margin-top: 10px; }
.cover.plain .ptakes { font-size: 11.4px; line-height: 1.5; margin-top: 8px; }
.cover.plain h2.psec { font-size: 14px; margin: 16px 0 7px !important; }
.cover.plain .tiles.head4 .ptile { padding: 12px 14px 13px; }
.cover.plain .tiles.head4 .ptile b { font-size: 26px; }
.cover.plain .tiles.head4 .ptile p, .cover.plain .tiles.head4 .ptile .q, .cover.plain .tiles.head4 .ptile small, .cover.plain .tiles.head4 .ptile span { font-size: 10.6px; line-height: 1.42; }
.cover.plain .pcols { margin-top: 12px; gap: 14px; }
.cover.plain .pcols .pbox { padding: 12px 16px 13px; }
.cover.plain .pcols .pbox h3, .cover.plain .pcols .pbox .pbox-h { font-size: 12px; }
.cover.plain .pcols .pbox ul { font-size: 11.3px; line-height: 1.5; }
.cover.plain .pcols--dense .pbox ul { font-size: 10.2px; line-height: 1.36; }
.cover.plain .tiles.head4, .cover.plain .tiles.pfeel.four { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.cover.plain .head4 .tile .q { min-height: 26px; } .cover.plain .head4 .tile b { font-size: 22px; }
.cover.plain .pfeel .tile .ab { font-size: 11px; font-weight: 600; color: var(--text-mid); }
.pbox-bad { margin-top: 8px; border-left-color: var(--danger-red, #b3261e); background: color-mix(in srgb, var(--danger-red, #b3261e) 6%, white); } .pbox-bad h3 { color: var(--danger-red, #b3261e); }
.pbox-bad ul li::marker { content: '✕  '; color: var(--danger-red, #b3261e); font-weight: 800; }
.pbox-info { margin-top: 8px; border-left-color: var(--primary-blue); } .pbox-info h3 { color: var(--primary-blue); }
.cover.plain .pbox-bad ul, .cover.plain .pbox-info ul { font-size: 9.6px; } .cover.plain .pbox-bad ul { column-count: 2; column-gap: 22px; } .cover.plain .pbox-bad li { break-inside: avoid; }
p.pmore { margin: 5px 0 0; font-size: 9.2px; color: var(--text-mid); font-style: italic; }
/* page 2 — groups and marks */
table.pcmp tr.pgrp td { background: none !important; font-weight: 800; font-size: 9.2px; letter-spacing: .07em; text-transform: uppercase; color: var(--primary-blue); padding: 4px 6px 2px; border-bottom: 1.5px solid color-mix(in srgb, var(--primary-blue) 35%, white); }
table.pcmp tr.pgrp:first-child td { padding-top: 3px; }
.pm { display: inline-block; font-weight: 800; margin-right: 4px; font-size: 9px; } .pm-no { color: var(--danger-red, #b3261e); } table.pcmp td.no { background-color: color-mix(in srgb, var(--danger-red, #b3261e) 10%, white) !important; } .pm-up { color: var(--success-green); } .pm-down { color: color-mix(in srgb, var(--warning-amber) 75%, black); }
p.pnext { font-size: 9.4px; color: var(--text-mid); margin: 10px 0 0; } p.pnext b { color: var(--primary-blue); }
/* page 3 — the summary line */
.p3sum { margin: 6px 0 -4px; padding: 4px 12px; font-size: 9.6px; white-space: nowrap; background: var(--surface-sunken); border-radius: 8px; color: var(--text-dark, #1a1a2e); }
.p3sum .dot { color: var(--text-light); margin: 0 7px; } .p3sum b { color: var(--primary-blue); }
/* page 4 — the times to learn */
.p4learn { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px 0 4px; }
.p4n { background: var(--surface-sunken); border-radius: 8px; padding: 9px 12px; box-shadow: inset 0 3px 0 color-mix(in srgb, var(--primary-blue) 35%, white); }
.p4n b { display: block; font-size: 24px; line-height: 1.05; color: var(--primary-blue); } .p4n span { font-size: 10px; color: var(--text-mid); }
.p4n-new { box-shadow: inset 0 3px 0 var(--primary-blue); } .p4n-new b { color: var(--primary-blue); }
.p4new { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px 10px; margin: 4px 0 6px; }
.p4t { background: color-mix(in srgb, var(--primary-blue) 6%, white); border-radius: 6px; padding: 5px 9px; font-size: 9.4px; line-height: 1.35; color: var(--text-mid); }
.p4t .tt { display: block; font-size: 11.5px; font-weight: 800; color: var(--primary-blue); }
p.p4gone, p.p4none { font-size: 9.6px; color: var(--text-mid); margin: 4px 0 8px; } p.p4gone .tt { color: var(--text-dark, #1a1a2e); }
.tag { display: inline-block; margin-left: 5px; padding: 0 5px; border-radius: 3px; font-size: 7.4px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; vertical-align: 1px; font-style: normal; }
.tag-new { background: var(--primary-blue); color: white; } .tag-gone { background: color-mix(in srgb, var(--text-light) 30%, white); color: var(--text-mid); }
table.dutyt td.chg { background: none !important; } table.dutyt td.chg .delta { color: var(--text-mid); }
table.dutyt tr.isnew td.tt { font-weight: 700; }
/* page 5 — the answer box, and the two compared rows drawn strongest */
.p5res { display: grid; grid-template-columns: 56% 1fr; gap: 12px; align-items: center; margin: 7px 0 0; padding: 5px 12px; background: var(--surface-sunken); border-radius: 8px; }
table.p5r { width: 100%; border-collapse: collapse; font-size: 9.6px; } table.p5r th { font-size: 8.4px; color: var(--text-mid); text-align: center; font-weight: 700; padding: 2px 4px; }
table.p5r th:first-child { text-align: left; color: var(--primary-blue); } table.p5r td { text-align: center; padding: 2px 4px; font-variant-numeric: tabular-nums; } table.p5r td:first-child { text-align: left; }
table.p5r tr.p5r-p td { font-weight: 800; } table.p5r td.up { color: var(--success-green); } table.p5r td.down { color: color-mix(in srgb, var(--warning-amber) 75%, black); }
.p5res p { margin: 0; font-size: 9.2px; line-height: 1.4; color: var(--text-mid); } .p5res p b { color: var(--text-dark, #1a1a2e); }
table.p5t tr:has(> th.floor-day) th { font-weight: 800 !important; color: var(--primary-blue) !important; }
table.p5t tr:has(> th.floor-day) .cov-heat-cell { font-weight: 800; }
table.p5t tr:has(> th.office-day) .cov-heat-cell { opacity: .5; }
table.p5t tr:has(> th.cov-heat-day:not(.office-day):not(.floor-day):not(.dem-day)) .cov-heat-cell { opacity: .62; }
table.p5t tr:has(> th.dem-day) th { font-weight: 800 !important; }
/* page 6 — hard limits as cards, the rules as a count */
.hl-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 4px 0 6px; }
.hl { background: var(--surface-sunken); border-radius: 8px; padding: 8px 11px 9px; box-shadow: inset 0 3px 0 var(--success-green); }
.hl-no { box-shadow: inset 0 3px 0 var(--danger-red, #b3261e); }
.hl-k { font-size: 9px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--text-mid); }
.hl-v { font-size: 22px; font-weight: 800; color: var(--primary-blue); line-height: 1.15; margin: 2px 0 1px; }
.hl-l { font-size: 9.2px; font-weight: 700; color: var(--text-dark, #1a1a2e); } .hl-s { font-size: 8.4px; line-height: 1.38; color: var(--text-mid); margin-top: 5px; }
.rpill { display: inline-block; margin-left: 8px; padding: 1px 9px; border-radius: 10px; font-size: 9.6px; font-weight: 800; vertical-align: 1px; }
.rpill-ok { background: color-mix(in srgb, var(--success-green) 14%, white); color: var(--success-green); } .rpill-no { background: color-mix(in srgb, var(--danger-red, #b3261e) 12%, white); color: var(--danger-red, #b3261e); }
/* page 7 — the count first */
.fcards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 9px 0 4px; }
.fc { background: var(--surface-sunken); border-radius: 8px; padding: 7px 12px; box-shadow: inset 0 3px 0 var(--primary-blue); display: grid; grid-template-columns: auto 1fr; column-gap: 12px; align-items: center; }
.fc-ok { box-shadow: inset 0 3px 0 var(--success-green); } .fc-warn { box-shadow: inset 0 3px 0 var(--warning-amber); }
.fc-k { grid-column: 1 / -1; font-size: 9px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--text-mid); }
.fc-v { font-size: 26px; font-weight: 800; color: var(--primary-blue); line-height: 1.1; } .fc-l { font-size: 9.2px; line-height: 1.35; color: var(--text-mid); }
/* page 8 — how firm each figure is, then short cards */
.tboxes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; margin: 12px 0 6px; }
.tbox { background: var(--surface-sunken); border-radius: 8px; padding: 9px 12px; box-shadow: inset 0 4px 0 var(--bar); }
.tbox-firm { --bar: var(--success-green); } .tbox-guide { --bar: var(--primary-blue); } .tbox-unknown { --bar: var(--text-light); }
.tbox h3 { margin: 0 0 3px; font-size: 13px; color: var(--primary-blue); } .tbox-firm h3 { color: var(--success-green); }
.tbox p { margin: 0 0 4px; font-size: 9.4px; color: var(--text-mid); line-height: 1.35; } .tbox ul { margin: 0 0 0 14px; padding: 0; font-size: 10px; line-height: 1.45; }
h2.pmh { font-size: 12.5px; margin: 12px 0 5px; }
.pcards { column-count: 2; column-gap: 12px; } .pcard { break-inside: avoid; background: var(--surface-sunken); border-radius: 0 8px 8px 0; box-shadow: inset 3px 0 0 color-mix(in srgb, var(--primary-blue) 35%, white); padding: 6px 11px; margin: 0 0 7px; }
.pcard h4 { margin: 0 0 2px; font-size: 10.6px; color: var(--primary-blue); } .pcard p { margin: 0; font-size: 9.6px; line-height: 1.42; }
p.pimport { font-size: 9px; margin-top: 8px; }
@media print { .pm, .mk, .tag, .rpill { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
/* POLISH PASS (1 Oct 2026, owner: "aesthetic polish, using screenshots"). Nothing here moves a figure or a word.
   ONE ACCENT PER CARD, as the rule above says: page 1's "Can it work?" tiles were the one set it missed — a gold side
   bar from the technical edition's .tile under a status bar on top, two accents meeting at a rounded corner. And a
   top bar is SQUARE on its own side: an inset bar on a card rounded at the top bends down into both corners, which at
   print size reads as a bracket, not a bar. */
.cover.plain .head4 .tile { border: 0 !important; background: var(--surface-sunken); box-shadow: inset 0 3px 0 var(--bar, var(--border-mid)); padding: 8px 10px 7px; }
.cover.plain .head4 .tile, .cover.plain .head5 .tile, .cover.plain .pfeel .tile, .hl, .fc, .p4n, .tbox { border-radius: 0 0 8px 8px !important; }
/* line breaks: no paragraph ends on a lone word, and no heading leaves one behind */
p, li, td, dd, .s, .l, .q, .sub, .hl-s, .fc-l, .pcard p, .plead, .pbottom { text-wrap: pretty; }
h1, h2, h3, h4 { text-wrap: balance; } .mast .sub { text-wrap: pretty; }
/* page 6 used two-thirds of its page: the rules table and the limit cards take the room, at a size read without effort */
table.t.rules { font-size: 10.8px; } table.t.rules td { padding: 5.5px 8px; line-height: 1.4; } table.t.rules th { padding: 5px 8px; }
.hl { padding: 10px 13px 11px; } .hl-l { font-size: 9.8px; } .hl-s { font-size: 9.2px; line-height: 1.42; }
/* page 2: the day key under a question is a second line of its own, never a word or two wrapped off the first */
table.pcmp td { padding-top: 1.9px; padding-bottom: 1.9px; }
table.pcmp td .psub { display: block; font-size: 8.6px; color: var(--text-mid); line-height: 1.2; margin-top: 1px; }
/* SECOND POLISH PASS (1 Oct 2026, owner: "use screenshots to aesthetic polish the proposal sheets"). Spacing, colour
   and alignment only — no figure and no word moves except the one tile line noted where it is built.
   Page 4: every row of the duty table gives its time, its tag slot and its length in three fixed columns. A row with no
   NEW or DROPPED tag had its length jammed against the time, so the lengths zig-zagged down the table. */
table.dutyt td.tt .tm { display: inline-block; font-variant-numeric: tabular-nums; margin-right: 5px; white-space: nowrap; }
table.dutyt td.tt .tag { width: 46px; margin-left: 0; margin-right: 4px; padding: 0; text-align: center; box-sizing: border-box; }
table.dutyt td.tt .tag-none { visibility: hidden; }
/* page 4's shape-of-a-week table: TODAY was the widest column for the shortest words, and IN PLAIN WORDS wrapped */
table.p4shape th:nth-child(1) { width: 25% !important; } table.p4shape th:nth-child(2) { width: 25% !important; } table.p4shape th:nth-child(3) { width: 21% !important; }
/* page 6: two rules missed in a row read as one shaded block — a hairline keeps them two rows */
table.t.rules tr.rule-miss + tr.rule-miss td { box-shadow: inset 0 1px 0 color-mix(in srgb, var(--warning-amber) 32%, white); }
/* page 3's word list ended 2mm above the footer rule on every sheet: a touch less leading gives it the margin the
   other pages have */
section.page .gloss { line-height: 1.33; } section.page .gloss > div { margin-bottom: 4px; }
/* page 3 at 26 lines (render.mjs measures and adds these only when the word list would cross the footer) */
section.page.rota-tight .gloss { font-size: 8.9px; line-height: 1.27; } section.page.rota-tight .gloss > div { margin-bottom: 2px; } section.page.rota-tight h2 { margin-top: 8px !important; }
section.page.rota-tighter .print-grid .shift-cell { height: 18px; } section.page.rota-tighter .print-grid .shift-cell-btn { line-height: 1.05; font-size: 8.2px; }
/* page 3: a cover week's days were a pale gold within a shade of an early turn's peach, in the grid and in its key.
   A light diagonal hatch on the same gold says "not yet given a turn" at a glance, in colour or not. The app's own
   Links page is untouched: this is the sheet's stylesheet. */
.print-grid .shift-cell-btn.type-spare, .legend i.lg-cover { background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--accent-gold) 26%, white) 0 3px, color-mix(in srgb, var(--accent-gold) 9%, white) 3px 6px) !important; }
/* THIRD POLISH PASS (4 Oct 2026, two visual reviews of all 80 pages). Spacing, widths and sizes only; the words that move are
   noted where they are built. The first rule is the one that matters: NOTHING IS WIDER THAN THE PAGE (render.mjs says why),
   and page 5's table was 2px wider than it by design — the negative margin that hung its cell edges on the text edge. */
table.p5t { width: 100%; margin: 0; }
/* page 1: one style for the four labels in the proposal box (two were bold caps, two regular with wider tracking) */
.cover.plain .ident-row.ident-minor .ident-k { font-size: 8.5px; font-weight: 800; letter-spacing: .4px; color: var(--text-light); } .cover.plain .ident-row { grid-template-columns: 70px 1fr; }
/* page 1: a card is as tall as its own content — a two-line tile beside a four-line one, a three-item list beside a six */
.cover.plain .tiles.head4 { align-items: start; } .cover.plain .pcols { align-items: start; }
/* page 2: the longest page — the mast's sub-line is two lines (worded for it), the closing-shift triples are one unit each,
   and the two figure columns are a touch wider for them. The floor between the last row and the footer is 24px. */
table.pcmp th:nth-child(1) { width: 28%; } table.pcmp th:nth-child(2) { width: 17%; } table.pcmp th:nth-child(3) { width: 20%; } table.pcmp th:nth-child(4) { width: 35%; }
table.pcmp .trio { white-space: nowrap; font-size: 9px; }
table.pcmp td { padding-top: 1.5px; padding-bottom: 1.5px; }
p.pnext { margin-top: 7px; }
/* page 3: the stat strip wraps between its figures if it must, never off the page (that overflow shrank four sheets) */
.p3sum { white-space: normal; line-height: 1.5; font-size: 9.2px; padding: 4px 10px; } .p3sum .bit { white-space: nowrap; } .p3sum .dot { margin: 0 2px; }
/* page 4: seven or eight new times fill two rows of four rather than leave one alone on a third; the right-hand column is
   two cards — the notes, then the shape of the week — so it runs the height of the duty table */
.p4new--4 { grid-template-columns: repeat(4, 1fr); }
.cols.duty > div.p4side { background: none; padding: 0; }
.p4side .p4note { background: var(--surface-sunken); border-radius: 8px; padding: 9px 11px; } .p4side .p4note p { margin: 0 0 6px; } .p4side .p4note p:last-child { margin: 0; }
.p4shape2 { margin-top: 10px; background: var(--surface-sunken); border-radius: 8px; padding: 8px 11px 9px; } .p4shape2 h3 { margin: 0 0 4px; font-size: 11.5px; }
.p4shape2 table.p4shape { margin: 0; table-layout: fixed; } .p4shape2 table.p4shape th:nth-child(1) { width: 44% !important; } .p4shape2 table.p4shape th:nth-child(2), .p4shape2 table.p4shape th:nth-child(3) { width: 28% !important; }
.p4shape2 table.p4shape td, .p4shape2 table.p4shape th { padding: 3px 4px; } .p4shape2 table.p4shape td:first-child { padding-left: 0; } .p4shape2 table.p4shape th:first-child { padding-left: 0; }
.p4shape2 table.p4shape td.num { white-space: normal; text-align: left; } .p4shape2 table.p4shape th.num { text-align: left; } .p4shape2 table.p4shape .p4nw { display: block; white-space: normal; }   /* outranks the full-width table's nowrap: a nowrap aside here ran off the page (Second Nature) */
.p4shape2 .psub { display: block; font-size: 8.4px; color: var(--text-mid); line-height: 1.25; margin-top: 1px; font-weight: 400; }
.p4shape2 table.t td { background: none !important; border-bottom-color: color-mix(in srgb, var(--border-mid) 60%, white); } .p4shape2 table.t th { background: none; box-shadow: inset 0 -1px 0 var(--border-mid) !important; }
.cols.duty.bb-dense .dutyt td { padding: 3.5px 6px; font-size: 9.6px; white-space: nowrap; }   /* the room the shape table left at the foot of the page goes to the table's rows */
/* page 8: the file name is one plain token — Inter's tabular figures (.tt) widen the hyphen too, which read as a gap after each */
p.pimport .tt { font-variant-numeric: normal; letter-spacing: 0; white-space: nowrap; }
/* page 5: the smallest type in the set, on the page a reader holds closest; the foot of the page had the room */
table.p5t .cov-heat-cell { font-size: 9.2px !important; height: 16px !important; }
table.p5t tr:has(> .office-day) .cov-heat-cell, table.p5t tr:has(> .floor-day) .cov-heat-cell { font-size: 8.4px !important; height: 13px !important; }
.p5 ul.p5notes { font-size: 9.3px; line-height: 1.38; } .p5 .p5legend { font-size: 9px; }
/* page 6: the three limit cards size to their own text; the rules table gives the RULE the room (it was 190px against a 450px
   asks column, so every rule wrapped two to four lines) and its rows are nearer page 2's density */
.hl-cards { align-items: start; }
table.t.rules { table-layout: fixed; } table.t.rules th:nth-child(1) { width: 36%; } table.t.rules th:nth-child(2), table.t.rules th:nth-child(3) { width: 18%; } table.t.rules th:nth-child(4) { width: 28%; }
table.t.rules td { padding: 4px 8px; line-height: 1.38; }
/* page 8: the cards run a little tighter so the closing note clears the footer by the same floor as every other page */
.tboxes { margin: 10px 0 5px; } .tbox { padding: 8px 11px; } .tbox ul { line-height: 1.4; } .tbox p { margin-bottom: 3px; }
.pcard { padding: 6px 11px; margin-bottom: 6px; } .pcard p { font-size: 9.6px; line-height: 1.4; } h2.pmh { margin: 10px 0 4px; }
p.pimport { margin-top: 6px; }
`;

/** Page 5, people on duty hour by hour (owner, 29 Sep 2026: "the table wording is a little confusing"). The tables and
 *  every number stay exactly as rendered; what changes is what the rows and the right-hand column SAY. Each group now
 *  reads "all on duty", then "of whom in the ticket office" and "of whom on the floor", so the split is stated rather
 *  than left to an indent. Only the floor rows carry a match figure — the one the page itself calls the fair comparison
 *  — instead of two figures a group with nothing saying which one counts. The notes become a short key above and a
 *  "good to know" list below. Throws if an anchor moves, so a change to render.mjs cannot leave half the old wording. */
function hourPage(s, ctx) {
  const must = (re, to, what) => { if (!re.test(s)) throw new Error(`hourPage: ${what} not found`); re.lastIndex = 0; s = s.replace(re, to); };
  must(/<div class="sub">Cover today and proposed against the measured December 2026 timetable \(arrivals and departures, weighted by train length\)\. /,
    '<div class="sub">Today’s link and the proposal, hour by hour, against the December 2026 timetable. ', 'the subtitle');
  must(/<p class="muted" style="margin:6px 0 2px">How to read it:[\s\S]*?<\/p>/, `<div class="p5legend">
    <span><i class="sw sw-blue"></i><b>People on duty</b> in that hour — darker blue is more. Anyone on for any part of the hour counts, so a handover counts both people.</span>
    <span><i class="sw sw-orange"></i><b>Trains</b> — carriages arriving and leaving in that hour; darker is busier. A guide from the timetable, not passenger numbers.</span>
    <span><b>Read down each column:</b> the most people should be under the darkest orange.</span>
    <span><b>Match</b>, on the right — how closely the floor follows the trains over the whole day. 0 is a perfect match; lower is better.</span></div>`, 'the how-to-read paragraph');
  must(/<section class="page">/, '<section class="page p5">', 'the page section');
  must(/<table class="cov-heat/g, '<table class="p5t cov-heat', 'the hour tables');
  // row labels: the group, then what it splits into
  must(/<th class="cov-heat-day ">(Today|Proposed)(?: ([^<]+))?<\/th>/g, (m, who, days) => `<th class="cov-heat-day ${who === 'Proposed' ? 'prop-row' : ''}">${who}${days ? `, ${days}` : ''} — all on duty</th>`, 'the Today/Proposed rows');
  must(/(<th class="cov-heat-day office-day">(?:&nbsp;)+)in the ticket office/g, '$1of whom in the ticket office', 'the ticket-office rows');
  must(/(<th class="cov-heat-day floor-day">(?:&nbsp;)+)on the floor/g, '$1of whom on the floor', 'the floor rows');
  must(/(<th class="cov-heat-day dem-day">)Train carriages, Dec 2026/g, '$1Trains — carriages in and out', 'the trains row');
  // one match figure per group: the floor row's; the all-on-duty rows' figures go
  must(/(<th class="cov-heat-day (?:prop-row)?">[^<]*<\/th>(?:<td[^>]*>[^<]*<\/td>)*?)<td class="cov-fit">[^<]*<\/td><\/tr>/g, '$1<td class="cov-fit"></td></tr>', 'the all-on-duty fit cells');
  must(/<th class="cov-heat-hour cov-fit-h">fit<\/th>/g, '<th class="cov-heat-hour cov-fit-h">Match</th>', 'the fit header');
  // a small gap before the proposal's block and before the trains, instead of a rule
  // (once per table: a weekday table with a row per day has several "Proposed" rows, and only the first opens a group)
  if (!/<th class="cov-heat-day prop-row">/.test(s)) throw new Error('hourPage: the group gaps not found');
  s = s.split('<table class="p5t').map((t, i) => i === 0 ? t : t.replace(/<tr>(?=<th class="cov-heat-day prop-row">)/, '<tr class="p5gap"><td colspan="21"></td></tr><tr>').replace(/<tr>(?=<th class="cov-heat-day dem-day">)/, '<tr class="p5gap"><td colspan="21"></td></tr><tr>')).join('<table class="p5t');
  // the notes beneath: one short list
  const office = /<p class="muted" style="margin-top:8px"><b>Ticket office\.<\/b> ([\s\S]*?)<\/p>/.exec(s);
  const rest = /<p class="muted" style="margin-top:6px">([\s\S]*?)<\/p>/.exec(s);
  if (!office || !rest) throw new Error('hourPage: the notes beneath the tables not found');
  const officeText = office[1].replace(/ The indented rows take the office out of each side, less its quiet-end help, so the floor rows compare like with like\./, ' The “of whom” rows split it out of each side, so the floor rows compare like with like.');
  const m = /^(Cover weeks[^.]*\.)\s*<b>Fit<\/b> is one number for how closely the people on duty follow the trains through the day: 0 would be a perfect match, lower is better\.\s*([^.]*not an average of the scores shown\.)\s*([\s\S]*)$/.exec(rest[1].trim());
  if (!m) throw new Error('hourPage: the cover-weeks / fit note has changed');
  const varies = /cov-heat--dense/.test(s);
  // THE TICKET OFFICE, IN PLAIN WORDS (owner, 29 Sep 2026: the helper rule and the Sunday late were "not explained").
  // The table moves a whole helper from the office row to the floor row (report-data officeHelpers), which reads as an
  // understaffed office unless it is said; the Sunday evening half-person stays in the office row. The design's own
  // sentence — whether it rosters the pairs or they are assumed — is kept from the technical note.
  // a design can say in its own meta how its office is run (`officeHow`), where the generic sentence would mislead
  const tail = ctx?.meta?.officeHow ?? (/where the plan has two and two\.([\s\S]*)$/.exec(officeText)?.[1] ?? '').replace(/ The “of whom” rows split it out of each side, so the floor rows compare like with like\./, '').trim();
  if (!/where the plan has two and two\./.test(officeText)) throw new Error('hourPage: the ticket-office note has changed');
  const items = [
    // a design whose author named its office replaces both the office and the Sunday note with its own (`namedOfficeNote`, `namedOfficeSunday`)
    ctx?.meta?.namedOfficeNote ? `<b>The ticket office.</b> ${ctx.meta.namedOfficeNote}` : `<b>The ticket office.</b> In the proposal, two people on every ticket-office shift, and not floor cover except at the quiet ends: Monday to Saturday one of each pair is on the floor until 08:00 and from 19:30, so the office row drops to 1 in those hours and the floor row gains one; where it shows 4, both pairs are there at the changeover.${tail ? ' ' + tail : ''} The “of whom” rows take the office out of each side, so the floor rows compare like with like.`,
    ctx?.meta?.namedOfficeSunday ? `<b>Sunday.</b> ${ctx.meta.namedOfficeSunday}` : `<b>Sunday.</b> One early is on the floor until 09:00; the two lates are on the floor until 15:00, then both in the office — at least 30 minutes’ handover — and one goes back to the floor from 18:00. Today one of the three 14:30–23:25 closers keeps the office until 22:30, so in the 16:00 and 17:00 hours today’s office row reads 1 where the proposal’s reads 2 (the 15:00 hour also counts the earlies finishing).`,
    `<b>Only the floor is matched to the trains.</b> The ticket office is staffed to its opening hours, not to the trains, so its rows carry no match figure. ${m[2]}`,
    `<b>Cover weeks.</b> ${m[1].replace(/^Cover weeks /, 'They ')}`,
    ...(m[3].trim() ? [`<b>Sunday’s last trains.</b> ${m[3].trim()}`] : []),
  ];
  // a design that rosters only some office pairs AND has the Sunday last-trains note carries both long notes: set the list a
  // touch tighter so it clears the footer (Polished Clean, 30 Sep 2026), leaving every other sheet as it was
  const denseNotes = (tail || ctx?.meta?.namedOfficeNote) && m[3].trim() ? ' p5notes--dense' : '';
  s = s.replace(office[0], `<h2 class="p5gtk">Good to know</h2><ul class="p5notes${denseNotes}">${items.map(x => `<li>${x}</li>`).join('')}</ul>`).replace(rest[0], '');
  // the callout's first point is now the "only the floor is matched" note; it keeps the one thing that note does not say
  s = s.replace(/<b>Reading it\.<\/b> The <b>floor<\/b> rows are the fair comparison\. The ticket office is staffed to its opening hours, not to the trains, so counting it in can make a day look better or worse than the floor really is\. The fit measures <b>shape, not numbers<\/b>/,
    '<b>Reading the match.</b> It measures <b>shape, not numbers</b>');
  // …and it joins the list, beside the note it belongs with, rather than sitting in a box of its own: on the sheets with a
  // weekday row per day (Tenth Sunday has seven) the box ran into the page footer (29 Sep 2026)
  const call = /<div class="callout"><b>Reading the match\.<\/b>([\s\S]*?)<\/div>/.exec(s);
  if (!call) throw new Error('hourPage: the reading-the-match callout not found');
  s = s.replace(call[0], '').replace(/(<li><b>Only the floor is matched to the trains\.<\/b>[\s\S]*?<\/li>)/, `$1<li><b>Reading the match.</b>${call[1]}</li>`);
  return s;
}

/** The appendix pages, second plain edition (owner, 30 Sep 2026). Each page opens with its answer, then the workings —
 *  the same figures, drawn once. Every rewrite throws if its anchor has moved, so a change to render.mjs cannot leave
 *  half a page in the old wording. */
const must = (s, re, to, what) => { if (!re.test(s)) throw new Error(`plain appendix: ${what} not found`); re.lastIndex = 0; return s.replace(re, to); };
const retitle = (s, eyebrow, h1, sub) => must(s, /<div class="mast"><div><div class="eyebrow">[^<]*<\/div><h1>[^<]*<\/h1><div class="sub">[\s\S]*?<\/div><\/div><\/div>/,
  `<div class="mast"><div><div class="eyebrow">${eyebrow}</div><h1>${h1}</h1><div class="sub">${sub}</div></div></div>`, 'the page head');
const MAST_END = /(<div class="mast">[\s\S]*?<\/div><\/div><\/div>)/;

/** Page 3 — the rota: a one-line summary above the grid, so the reader knows what the grid holds before reading it. */
function rotaPage(s, { P }) {
  s = retitle(s, 'The rota', `The ${LINES}-line link`, `Sunday to Saturday per line; everyone moves down one line each week and line ${LINES} goes back to line 1. Hours and days at the right; the number on duty each day beneath.`);
  // the average is read from the grid's own totals row, never typed: Fifteen Turns averages 35h 03m, not 35h 00m (audit, 30 Sep 2026)
  const avgWeek = /cov-foot-label">(?:On duty|Cover)<\/td>[\s\S]*?<td class="tot-cell tot-avg">([^<]+)<\/td>/.exec(s)?.[1];
  if (!avgWeek) throw new Error('rotaPage: the average-week total not found');
  const bits = [`<b>${P.feel.workingLines}</b> working weeks`, `<b>${P.feel.spareLines.length}</b> cover weeks`,
    `<b>${avgWeek}</b> a week on average`, `at most <b>${P.fixed.run}</b> days in a row${P.checks.longestStretch !== P.fixed.run ? ` (up to ${P.checks.longestStretch} with a cover week)` : ''}`, `<b>${P.feel.oneTurn}</b> weeks on one shift time`];
  // two words the page itself does not use leave its word list — each is explained where it is used (pages 5 and 6)
  s = must(s, /<div><b>Handover<\/b> — [^<]*<\/div>/, '', 'the Handover gloss');
  // the glossary spoke to a colleague ("You move down a line"); the sheet is read by managers first
  s = must(s, /You move down a line each week/, 'Everyone moves down a line each week', 'the Line gloss');
  s = must(s, /You work four duties of the seven days/, 'Whoever is on it works four duties of the seven days', 'the Cover week gloss');
  s = must(s, /<div><b>Match<\/b> — [\s\S]*?<\/div>/, '', 'the Match gloss');
  // each figure is one unbreakable piece; the strip may wrap BETWEEN them, never run off the page (that overflow shrank four sheets)
  return must(s, MAST_END, `$1\n  <div class="p3sum">${bits.map(b => `<span class="bit">${b}</span>`).join(' <span class="dot">·</span> ')}</div>`, 'the rota page head');
}

/** Page 4 — shift times. The question a colleague brings is "which times would I have to learn?", so the page answers it
 *  first, then keeps the full duty table as the workings — marked NEW / DROPPED, with no colour: one more or fewer on a
 *  shift time is neither better nor worse. The two tables that sat above it repeated page 2 and have moved there. */
function shiftPage(s, { T, P }) {
  s = retitle(s, 'Shift times and the shape of a week', 'Shift times', 'The shift times staff would need to learn, every shift time beside the ones worked today, and the shape of a working week.');
  const tSet = new Set(T.tableRows.map(r => r.time)), pSet = new Set(P.tableRows.map(r => r.time));
  const fresh = P.tableRows.filter(r => !tSet.has(r.time)), kept = P.tableRows.filter(r => tSet.has(r.time)), gone = T.tableRows.filter(r => !pSet.has(r.time));
  const when = r => andList([r.weekday ? 'weekdays' : '', r.sat ? 'Saturdays' : '', r.sun ? 'Sundays' : ''].filter(Boolean));
  const len = m => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
  const kind = r => r.family === 'E' ? 'early' : 'late';
  const learn = `<div class="p4learn">
    <div class="p4n"><b>${P.tableRows.length}</b><span>shift times in all</span></div>
    <div class="p4n"><b>${kept.length}</b><span>already worked today</span></div>
    <div class="p4n p4n-new"><b>${fresh.length}</b><span>${fresh.length === 1 ? 'is' : 'are'} new — nobody works ${fresh.length === 1 ? 'it' : 'them'} today</span></div>
  </div>
  ${fresh.length ? `<h2>The new ${fresh.length === 1 ? 'time' : 'times'} to learn</h2>
  <div class="p4new${fresh.length === 7 || fresh.length === 8 ? ' p4new--4' : ''}">${fresh.map(r => `<div class="p4t"><span class="tt">${r.time}</span><span>${len(r.minutes)} · ${kind(r)} · ${when(r)}</span></div>`).join('')}</div>` : '<p class="p4none">Every shift time in this link is one somebody already works today.</p>'}
  ${gone.length ? `<p class="p4gone"><b>No longer used:</b> ${gone.length} of today’s ${T.tableRows.length} shift times — ${gone.map(r => `<span class="tt">${r.time}</span>`).join(', ')}.</p>` : ''}`;
  s = must(s, /<div class="stack">[\s\S]*?<\/div>\s*<\/div>\s*(?=<h2>The duty table)/, `${learn}\n  `, 'the two tables above the duty table');
  // THE SHAPE OF A WEEK — restored (30 Sep 2026, "no important insight must be lost"). v2 moved four of the old table's
  // rows to page 2 and dropped the rest; these are the ones page 2 does not carry, plus the single rest days with the
  // cover-week detail page 2 has no room for. (The ticket-office posts row is not restored: pages 2, 5 and 6 carry it.)
  const dist = X => Object.entries(X.feel.daysHist).sort((a, b) => a[0] - b[0]).map(([d, n]) => `<span class="p4nw">${n} × ${d}-day</span>`).join('');   // one per line in the side card
  const iso = X => `${X.feel.isolatedRest}${X.feel.isolatedBesideCover ? `<span class="p4nw">(${X.feel.isolatedBesideCover} beside a cover week)</span>` : ''}`;
  // BESIDE THE TABLE, NOT UNDER IT (4 Oct 2026, from screenshots): the notes card ended halfway down the duty table and the
  // right third of the page was blank beside its lower half, while this table sat alone across the foot of the page. Same
  // four rows, same words; the plain words sit under each measure because the column is a third of the page wide.
  const m4 = (k, w, t, p) => `<tr><td>${k}<span class="psub">${w}</span></td><td class="num">${t}</td><td class="num"><b>${p}</b></td></tr>`;
  const shape = `<div class="p4shape2"><h3>The shape of a week</h3>
  <table class="t p4shape"><thead><tr><th>Measure</th><th class="num">Today</th><th class="num">Proposed</th></tr></thead><tbody>
    ${m4('Rest breaks of two days or more', 'of all the breaks between duties', `${T.feel.pairedRest} of ${T.feel.restIslands}`, `${P.feel.pairedRest} of ${P.feel.restIslands}`)}
    ${m4('Single rest days', P.feel.isolatedBesideCover ? 'one beside a cover week depends on where its four duties fall' : 'a rest day with a worked day either side', iso(T), iso(P))}
    ${m4('Working weeks by days worked, Sunday in', 'cover weeks left out', dist(T), dist(P))}
    ${m4('Working weeks with a Sunday', 'the number on duty each Sunday — all overtime', `${T.hours.sundayDuties} of ${T.feel.workingLines}`, `${P.hours.sundayDuties} of ${P.feel.workingLines}`)}
  </tbody></table></div>`;
  s = must(s, /<h2>The duty table, beside today’s<\/h2>/, '<h2>Every shift time, beside today’s</h2>', 'the duty table heading');
  // no colour on the duty table: a count going up or down is a difference, not a verdict
  s = s.replace(/(<table class="t dutyt">[\s\S]*?<\/table>)/, t => t
    .replace(/<td class="(?:up|down)">/g, '<td class="chg">')
    .replace(/<tr class="gone"><td class="tt">([^<]*)/g, '<tr class="gone"><td class="tt">$1<span class="tag tag-gone">dropped</span>')
    .replace(/<tr class=""><td class="tt">(\d\d:\d\d-\d\d:\d\d)/g, (m, time) => tSet.has(time) ? m : `<tr class="isnew"><td class="tt">${time}<span class="tag tag-new">new</span>`)
    // the time, then a tag slot every row has (an empty one where there is no tag), so the lengths line up
    .replace(/<td class="tt">([^<]*)(<span class="tag [^"]*">[^<]*<\/span>)?/g, (m, time, tag) => `<td class="tt"><span class="tm">${time}</span>${tag ?? '<span class="tag tag-none"></span>'}`));
  s = must(s, /Green: more than today; amber: fewer; grey italics: a time the proposal drops\./,
    '<b>(+2)</b> and <b>(−1)</b>: more or fewer people on that time than today — a difference, not a verdict. <b>New</b>: nobody works it today. <b>Dropped</b>: worked today, not in this link.', 'the duty table key');
  // the right-hand cell becomes two cards: the notes, then the shape of the week
  return must(s, /<div>(<p class="muted">People on each shift time[\s\S]*?<\/p>)<\/div>(\s*<\/div>\s*)(?=<div class="foot">)/, `<div class="p4side"><div class="p4note">$1</div>${shape}</div>$2`, 'the duty table notes card');
}

/** Page 5 — staffing through the day. The answer first: three numbers against today's and a sentence; then the tables,
 *  where the two rows actually compared — the floor and the trains — are drawn strongest. */
function hourAnswer(s, { T, P, meta }) {
  s = retitle(s, 'Staffing through the day', 'People on duty, hour by hour', 'Today’s link and the proposal, hour by hour, against the December 2026 timetable. A darker orange hour carries more of the day’s trains.');
  const t = [T.office.wkFit, T.office.fits.sat, T.office.fits.sun], p = [P.office.wkFit, P.office.fits.sat, P.office.fits.sun];
  const f = v => v == null ? '—' : Number(v).toFixed(1);
  const cell = (pv, tv) => pv == null || tv == null ? `<td>${f(pv)}</td>` : pv < tv ? `<td class="up"><span class="pm pm-up">✓</span>${f(pv)}</td>` : pv > tv ? `<td class="down"><span class="pm pm-down">▲</span>${f(pv)}</td>` : `<td>${f(pv)}</td>`;
  const names = ['weekdays', 'Saturday', 'Sunday'];
  const better = names.filter((_, i) => p[i] != null && t[i] != null && p[i] < t[i]), worse = names.filter((_, i) => p[i] != null && t[i] != null && p[i] > t[i]);
  const verdict = !worse.length ? 'The floor follows the trains more closely than today on weekdays, Saturday and Sunday.'
    : !better.length ? 'The floor follows the trains less closely than today on weekdays, Saturday and Sunday.'
    : `The floor follows the trains more closely than today on ${andList(better)}, less closely on ${andList(worse)}.`;
  // the verdict with each day in words; when every day is closer, the days are named once and "as far off" once
  const p5words = (v, pv, tv, allCloser) => {
    const ws = ['weekdays', 'Saturday', 'Sunday'].map((d, i) => [d, offWords(pv[i], tv[i])]).filter(([, x]) => x);
    // every day a fraction of today's: "today’s" once — "scores about two-thirds of today’s on weekdays, three-fifths on Saturday…"
    const frac = ws.every(([, x]) => /^a score about .+ of today’s$/.test(x));
    const w = frac ? `scores about ${andList(ws.map(([d, x], i) => `${x.replace(/^a score about /, '').replace(i ? / of today’s$/ : /$^/, '')} on ${d}`))}`
      : `scores ${ws.map(([d, x]) => `${d} ${x.replace(/^a score /, '')}`).join(', ')}`;
    return allCloser ? `<b>The floor follows the trains more closely than today</b> — ${w}.` : `<b>${v.replace(/\.$/, '')}</b> — ${w}.`;
  };
  const answer = `<div class="p5res"><table class="p5r"><thead><tr><th>How closely the floor follows the trains</th><th>Weekdays</th><th>Saturday</th><th>Sunday</th></tr></thead><tbody>
    <tr><td>Today’s link</td>${t.map(v => `<td>${f(v)}</td>`).join('')}</tr>
    <tr class="p5r-p"><td>${esc(meta.identity.name)}</td>${p.map((v, i) => cell(v, t[i])).join('')}</tr></tbody></table>
    <p>${p5words(verdict, p, t, !worse.length)} Lower is closer; 0 is a perfect match.</p></div>`;
  s = must(s, MAST_END, `$1\n  ${answer}`, 'the hour page head');
  // the legend's match line is now the answer box above; one shorter key remains
  s = must(s, /\s*<span><b>Match<\/b>, on the right[\s\S]*?<\/span><\/div>/, '<span><b>Strongest rows:</b> the floor and the trains — the two the match compares.</span></div>', 'the legend match line');
  // the "only the floor is matched" note said what the answer box and the key now say; its one extra fact joins the next note
  s = must(s, /<li><b>Only the floor is matched to the trains\.<\/b>[\s\S]*?<\/li>/, '', 'the only-the-floor note');
  s = must(s, /<li><b>Reading the match\.<\/b>/, '<li><b>Reading the match.</b> The weekday figure at the top is worked out from the five weekdays together, not averaged from the day scores.', 'the reading-the-match note');
  return s;
}

/** Page 6 — the rules. Three hard limits as cards (each a number against its limit), a count for the December rules,
 *  and the full table. The "Still to settle" list goes: a failed rule is shaded in the table and named on page 1. */
function rulesPage(s, { T, P, meta }) {
  s = retitle(s, 'The rules', 'Hard limits and the December 2026 rules', `Three hard limits a rota must meet to be run at all, then the ${['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'][meta.decOf] ?? meta.decOf} December 2026 staffing rules, each with today’s link beside it.`);
  const rows = [...s.matchAll(/<div class="check-row check-(good|bad|warn)"><span class="check-icon[^"]*">[^<]*<\/span><div class="check-body"><b>([^<]*)<\/b>[\s\S]*?<div class="check-sub">([\s\S]*?)<\/div><\/div><\/div>/g)];
  if (rows.length !== 3) throw new Error(`plain appendix: expected 3 hard-limit rows, found ${rows.length}`);
  const hm2 = m => m == null ? '—' : `${Math.floor(m / 60)}h&nbsp;${String(m % 60).padStart(2, '0')}m`;
  const run = P.checks.longestStretch, rest = P.rest?.minutes, monSat = meta.monSat ?? CONTRACT_MINUTES;
  const card = ([, state, title, sub]) => {
    // the contract card also carries the days ceiling (RULES.md): exact hours with too many, shorter duties is still a breach
    const ok = state === 'good' && (/13 days|12 hours/.test(title) || daysAYear(P.patterns) <= DAYS_CEILING + 1e-9);
    const [k, v, lim] = /13 days/.test(title) ? ['Most days in a row', `${run}`, `longest possible · limit 13 · today ${T.checks.longestStretch}${run !== P.fixed.run || T.checks.longestStretch !== T.fixed.run ? ` · fixed duties ${P.fixed.run} (today ${T.fixed.run})` : ''}`]
      : /12 hours/.test(title) ? ['Shortest rest between shifts', hm2(rest), `in the fixed duties · limit 12h · today ${hm2(T.rest?.minutes)}`]
      : ['The contract', hm2(Math.round(monSat / WORKING_LINES)), `a week, Monday to Saturday, on average · must be exact · ${daysAYear(P.patterns).toFixed(1)} contracted days a year, ${DAYS_CEILING} at most`];
    return `<div class="hl hl-${ok ? 'ok' : 'no'}"><div class="hl-k">${k}</div><div class="hl-v">${v}</div><div class="hl-l"><span class="mk mk-${ok ? 'ok' : 'no'}">${ok ? '✓' : '✕'}</span>${ok ? 'met' : 'not met'} · ${lim}</div><div class="hl-s">${sub}</div></div>`;
  };
  s = must(s, /<h2>Hard limits <span[\s\S]*?<\/span><\/h2>\s*<div class="check-rows">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*(?=<h2>The December 2026 rules)/,
    `<h2>Hard limits <span class="muted" style="font-weight:400;font-size:10px">— met, or the rota cannot be run</span></h2>\n  <div class="hl-cards">${rows.map(card).join('')}</div>\n  `, 'the hard-limit rows');
  const rules = meta.designRules ?? [], failed = rules.filter(r => !r.ok && !r.waived), waived = rules.filter(r => !r.ok && r.waived);
  const pill = failed.length ? `<span class="rpill rpill-no">✕ ${meta.decMet} of ${meta.decOf} met — ${failed.length} not met, shaded below${waived.length ? `; ${waived.length} waived for this design` : ''}</span>`
    : `<span class="rpill rpill-ok">✓ ${meta.decMet} of ${meta.decOf} met${waived.length ? ` — the other ${waived.length === 1 ? 'one' : waived.length} waived for this design` : ''}</span>`;
  s = must(s, /<h2>The December 2026 rules <span[^>]*>[^<]*<\/span><\/h2>/, `<h2>The December 2026 rules ${pill}</h2>`, 'the rules heading');
  s = must(s, /\s*<!-- The heading used to be[\s\S]*?-->\s*<h2>Still to settle<\/h2>\s*<ul class="oq-list">[\s\S]*?<\/ul>/, '', 'the rules page still-to-settle list');
  return s;
}

/** Page 7 — fatigue. The count first, and the standing factors counted separately, so page 1's number and this page's
 *  marks can never look as though they disagree. */
function fatiguePage(s, { T, P, meta }) {
  // FF2 in the ORR's words says "05:00 and 07:00"; Managing Rail Staff Fatigue, Appendix E, makes 07:00 a day shift, and
  // the app counts it so — the label says what is counted
  s = s.replaceAll('Early shift starting 05:00–07:00', 'Early shift starting 05:00 to 06:59');
  s = retitle(s, 'Fatigue checks', 'Fatigue checks', 'From the Office of Rail and Road’s good-practice guidance, <i>Fatigue Factors</i>, page 3 (December 2021): 21 roster patterns that tend to tire people, with 4 checks from the rail industry’s fatigue guidance (MRSF). <b>⚠</b> present — worth a look, not a breach · <b>✓</b> clear · <b>●</b> standing — comes with the station’s hours or any weekly link.');
  // the fixed duties lead, as on pages 1 and 2; the worst cover-week placement is stated beside them (fixedView, report-data.mjs)
  const pn = P.fixed.present, tn = T.fixed.present, st = P.fatigue.standing, pw = P.fatigue.present + (meta?.h55Cover ? 1 : 0), tw = T.fatigue.present;
  const cards = `<div class="fcards">
    <div class="fc fc-${pn ? 'warn' : 'ok'}"><div class="fc-k">Avoidable fatigue warnings</div><div class="fc-v">${pn}</div><div class="fc-l">in the fixed duties · today’s link has ${tn}${pw !== pn || tw !== tn ? ` · ${pw === pn ? `today up to ${tw}` : `up to ${pw} (today ${tw})`} if a cover week falls badly` : ''} · each is a question to discuss, not a breach</div></div>
    <div class="fc fc-info"><div class="fc-k">Standing — come with every weekly link</div><div class="fc-v">${st}</div><div class="fc-l">early starts at a 06:20 station, and a rotation that moves everyone one line a week · recorded, not counted</div></div>
  </div>`;
  s = must(s, MAST_END, `$1\n  ${cards}`, 'the fatigue page head');
  s = must(s, /<p class="muted" style="margin:6px 0 4px">These are 25 roster patterns[\s\S]*?<\/p>/, '<p class="muted" style="margin:6px 0 4px">For each of the 25 patterns this table asks whether it is in the rotation, today and proposed, and how big it is. A design showing nothing is not thereby approved: this is guidance, not a fatigue risk assessment.</p>', 'the fatigue intro');
  s = must(s, /<li>Avoidable tiring patterns found: [^<]*<\/li>/, '', 'the found-count bullet');
  // THE PLAIN NAME LEADS (owner, 30 Sep 2026): a manager reads "too little rest after a run of early starts", not
  // "FF8b"; the ORR's code, wording and category follow in small print, so nothing is lost for anyone checking.
  const PLAIN_FF = [[/^Early shift starting 05:00/, 'Early starts, 05:00 to 06:59'], [/^Very early shift/, 'Very early starts, before 05:00'],
    [/^Day shift over 12h/, 'Shifts over 12 hours'], [/^Early shift over 10h/, 'Early shifts over 10 hours'],
    [/rest after a block of early/, 'Too little rest after a run of early starts'], [/13 consecutive shifts without a 48h/, 'Too many shifts without a two-day break'],
    [/4 consecutive 12h day/, 'Runs of 12-hour day shifts'], [/consecutive early shifts/, 'Long runs of early shifts'],
    [/12 consecutive day shifts/, 'Long runs of day shifts'], [/55 hours/, 'More than 55 hours in a week'],
    [/consecutive 8h shifts/, 'Long runs of 8-hour shifts'], [/^Backward rotating/, 'Start times moving earlier through the week'],
    [/^Rotating pattern of about a week/, 'Changing shift type about once a week'], [/^Successive start times varying/, 'Start times that jump by more than two hours'],
    [/^Less than 12h rest/, 'Less than 12 hours between two shifts']];
  s = must(s, /<th>Code<\/th><th>Factor<\/th>/, '<th>Pattern</th>', 'the fatigue table head');
  s = s.replace(/<td class="ff-code">([^<]*)<\/td><td class="ff-title">([^<]*)((?:<span[^>]*>[^<]*<\/span>)*)<\/td>/g, (m, code, title, spans) => {
    const plain = PLAIN_FF.find(([re]) => re.test(title.trim()))?.[1] ?? title.trim();
    const extra = [...spans.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map(x => x[1].trim()).filter(Boolean);
    return `<td class="ff-title"><b class="ff-plain">${plain}</b><span class="ff-orr">${code} · ${title.trim()}${extra.length ? ` · ${extra.join(' · ')}` : ''}</span></td>`;
  });
  if (/class="ff-code"/.test(s)) throw new Error('fatiguePage: a fatigue row kept its code column');
  return s;
}

/** Turns the ten-page technical sheet into the plain edition: two new front pages, the five analysis pages kept
 *  as the appendix (renumbered, their cross-references and one comparison sentence rewritten), a method page. */
export function plainEdition(html, ctx) {
  const parts = html.split(/(?=<section class="page)/);
  const head = parts[0], sections = parts.slice(1);
  const lastClose = sections[sections.length - 1].lastIndexOf('</section>');
  const tail = sections[sections.length - 1].slice(lastClose + '</section>'.length);
  sections[sections.length - 1] = sections[sections.length - 1].slice(0, lastClose + '</section>'.length);
  const pageOf = s => +(s.match(/Page (\d+) of 10/)?.[1] ?? 0);
  const keep = [4, 5, 6, 7, 8], NEW = { 1: 1, 2: 8, 3: 8, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7 };
  const titles = { 4: 'The rota', 5: 'Shift times', 6: 'Staffing through the day', 7: 'The rules', 8: 'Fatigue checks' };
  const pages = 8;
  const appendix = keep.map(k => {
    let s = sections.find(x => pageOf(x) === k); if (!s) throw new Error(`plainEdition: no page ${k} in the technical sheet`);
    s = s.replace(/Page (\d+) of 10 — [^<]*/, `Page ${NEW[k]} of ${pages} — Workings · ${titles[k]}`);
    s = s.replace(/Fatigue Factors, page 3/g, 'Fatigue Factors, p@@3');                       // the ORR's own page, not ours
    s = s.replace(/\b([Pp])age (\d+)\b(?! of)/g, (m, P1, d) => NEW[+d] ? `${P1}age ${NEW[+d]}` : m);
    s = s.replace(/p@@3/g, 'page 3');
    s = s.replace(/<p class="muted p8note">([\s\S]*?)<\/p>/, (m, body) => `<ul class="p8list">${body.replace(/^Design-specific findings:/, 'Avoidable tiring patterns found:').split(/(?=<b>)/).map(x => x.trim()).filter(Boolean).map(x => `<li>${x}</li>`).join('')}</ul>`);
    s = s.replace(/>Weeks on one shift time</g, '>Weeks on one shift time — all earlies or all lates<');
    s = s.replace(/every design’s staffed day/g, 'any link’s staffed day').replace(/so every design has FF2/g, 'so any link has FF2');
    if (k === 6) s = hourAnswer(hourPage(s, ctx), ctx);
    if (k === 5) s = shiftPage(s.replace(/struck through: not used/g, 'grey italics: a time the proposal drops'), ctx);
    if (k === 7) s = rulesPage(s, ctx);
    if (k === 8) s = fatiguePage(s, ctx);
    if (k === 4) s = s   // the rota page: the glossary term matches page 5, and the contract note counts weeks, not people
      .replace('<div><b>Fit</b> — how closely the number of people on duty follows the number of trains through the day; 0 is a perfect match, lower is better.</div>',
        '<div><b>Match</b> — how closely the number of people on the floor follows the number of trains through the day (page 5); 0 is a perfect match, lower is better.</div>')
      .replace(`(${WORKING_LINES} people × 35 hours = ${CONTRACT_MINUTES.toLocaleString('en-GB')} minutes)`, `(35 hours for each of the ${WORKING_LINES} working weeks = ${CONTRACT_MINUTES.toLocaleString('en-GB')} minutes)`);
    if (k === 4) s = rotaPage(s, ctx);
    return s;
  });
  const p1 = sections.find(x => pageOf(x) === 1) ?? '';
  const coverHead = (p1.match(/<div class="mast">[\s\S]*?(?=<p class="readhint">)/)?.[0] ?? '')
    .replace(/<div class="ident-row ident-minor"><span class="ident-k">Family<\/span><span class="ident-v">[^<]*<\/span><\/div>/, '')   // names another proposal
    .replace(/(<div class="ident-row ident-minor"><span class="ident-k">Created)/, `<div class="ident-row ident-minor"><span class="ident-k">Set against</span><span class="ident-v">today’s 20-week link</span></div>$1`)
    .replace(/design-specific fatigue findings?/g, m => m.endsWith('s') ? 'avoidable tiring patterns' : 'avoidable tiring pattern')
    .replace(/ with FF11 as rostered/g, ' as rostered')
    .replace(/current working rules/g, 'December staffing rules')
    .replace(/<span class="muted">\(page 7\)<\/span>/g, '<span class="muted">(page 6)</span>');   // the rules page is page 6 here
  if (!coverHead) throw new Error('plainEdition: no cover head on page 1 of the technical sheet');
  let out = head.replace('</style>', CSS + '</style>') + front({ ...ctx, pages, coverHead }) + appendix.join('') + methodPage({ ...ctx, pages }) + tail;
  // the rules table's ticks and crosses, in the colour they mean
  out = out.replace(/<table class="t rules">[\s\S]*?<\/table>/, t => t.replace(/<td( class="today-v")?>(✓|✕|○)/g, (m, c, k) => `<td${c ?? ''}><span class="mk mk-${k === '✓' ? 'ok' : k === '✕' ? 'no' : 'wv'}">${k}</span>`));
  // ONE WAY OF WRITING A LENGTH OF TIME (owner, 30 Sep 2026). Page 2 wrote "13h35" and page 6 "13h 35m" for the same
  // figure, and "13h35" also reads as a clock time. Every duration on every page is "13h 35m"; clock times keep their
  // colon (13:35), so the two can no longer be confused. Text only — never inside a tag or the stylesheet.
  out = out.replace(/(<style[\s\S]*?<\/style>)|>([^<]+)</g, (m, st, txt) => st ?? `>${txt.replace(/\b(\d{1,3})h(\d{2})\b(?!m)/g, '$1h&nbsp;$2m')
    // POLISH (1 Oct 2026): a separator dot stays at the END of a line, never the start of the next; and a clock range is
    // written one way on every page — page 4 wrote 06:20-14:25 where pages 2 and 5 wrote 06:20–14:25
    .replace(/ · /g, '&nbsp;· ').replace(/\b(\d\d:\d\d)-(\d\d:\d\d)\b/g, '$1–$2')
    // THIRD POLISH PASS (4 Oct 2026): a dash, like a dot, ends a line and never starts one; a fraction in words ("two-fifths")
    // keeps its hyphen on one line (a word joiner — invisible, and no glyph for the font to lack)
    .replace(/ — /g, '&nbsp;— ').replace(/\b(two|three|four|nine)-(fifths|thirds|quarters|tenths)\b/g, '$1-\u2060$2')}<`);
  // ORPHANS (4 Oct 2026): a plain-text table cell or list item — no tags inside it, and long enough to wrap — never ends on a
  // lone short word ("to Friday", "— people", "(today 7)"): its last space is a no-break space. A cell with markup is left alone.
  out = out.replace(/<(td|li)(\s[^>]*)?>([^<]{25,})<\/\1>/g, (m, tag, attrs, txt) => { const i = txt.lastIndexOf(' ');
    if (i < 0 || txt.length - i > 16) return m; return `<${tag}${attrs ?? ''}>${txt.slice(0, i)}&nbsp;${txt.slice(i + 1)}</${tag}>`; });
  return out;
}
