// WHAT IT MEANS IF YOU… — THE FIGURES (2 Nov 2026). The one-page sheet's data, and the New link page's: the sheet
// (what-it-means-sheet.mjs) prints it, and newlink-data.mjs writes it into the app's newlink-data.js, so the page staff read
// and the page they are handed cannot say different things. Split out of the sheet unchanged — the sheet's HTML was
// byte-identical before and after — when the app page was built (owner, 2 Nov 2026: "Do 0 and 1").
//
// THE SHEET (1 Nov 2026, owner: "make all three changes" — the third being a one-page sheet that answers the
// question colleagues actually ask: not "which link is best" but "what does it mean for ME?"). Six ways people work the
// roster today — preferring earlies, preferring lates, swapping earlies for lates for the overtime, working their share of
// Sundays and no other overtime, working no overtime at all, saving leave for long breaks — each answered with the
// figures, today against the three shortlisted links, and then what every one of them gains whichever they are.
//
// NOTHING IS TYPED. The figures are the decks' own (`deck-check.mjs --print`, the sheets' counts), the long earlies and
// the rest-day breaks are counted from the grids here, the leave is leave.mjs (Long Break's too, named as the leave
// alternative outside the shortlist), and the pay is the Pay Calculator's rate and multipliers (paycalc-calc.js). Every
// "in short" line is ASSERTED against the figures before the page is printed, so a design that stops fitting a sentence
// stops the sheet; and the Sunday £ (slide 5) and the swap £ (slide 5's notes) are read back off the shipped colleague decks,
// so on those the sheet and the decks cannot quote different figures. The other figures are deck-check.mjs's, as the decks'
// are. Run it AFTER deck-polish.py, which writes what it reads, and BEFORE pack.py.
//
// The pay figures, and what they assume (said again in the page's own notes):
//   · Sundays: two more Saturdays at time and a quarter (the quarter is the premium) against fewer, shorter Sundays at
//     time and a half — deck-polish.py's slide 5 sum, rounded to £50 as the decks round it;
//   · no overtime at all: the Saturday premium alone, to £10;
//   · swaps: each 13:35 or 13:45 early (the short earlies; the only earlies that finish before 14:00) swapped for that
//     day's longest late, the extra time assumed paid as "Overtime 1.25" (time and a quarter; the payslip line) — to
//     £10. It needs a partner for every swap, which nobody can promise, so it is the most THOSE swaps could make, not a
//     forecast — and not every swap: an 8-hour early for an 8½-hour late still adds time on every link (the external
//     review, 1 Nov 2026, which found "Short Run none" read as no swap paying at all);
//   · gross, before tax, at the CEA rate.
//
// THE NEW THREE (5 Nov 2026, owner: Common Ground "as the best 30 day example", Short Run "because colleagues have seen it",
// Even Step, still recommended; In Step off the shortlist). The columns are A TO Z — Common Ground, Even Step, Short Run — as
// the New link page shows them ("three evenly"), so the page and this sheet read in one order. Common Ground broke five of
// the in-short lines, each now saying whom it is true of: its earlies are the shortest on average, it keeps the most from
// the 13:45 swaps, its Sunday pay is its own (£350 where the other two are £250), it keeps today's four weeks for 14 days'
// leave, and it has two three-day breaks. Long Break left the leave line, which a shortlisted link now answers.
//
// THE THREE OF 8 NOV 2026 (owner: "Put Level Crossing, Middle Ground and Balanced V6 as the shortlist for now", for the design
// target set that day: no two closing weeks side by side). The columns are A to Z — Balanced V6, Level Crossing, Middle Ground.
// All three keep today's leave, so the leave line says so and says what Balanced V6 pays for its breaks; Middle Ground has the
// shortest lates and the shortest Sundays, Balanced V6 the shortest runs and the most from the 13:35 and 13:45 swaps. Balanced
// V6's Saturday has two closers, so a closer is read by its longest (Hmax). NONE OF THE THREE HAS PRESENTATIONS YET (fresh.mjs
// → DECKS_KEPT): the Sunday and swap £ are read back off a shortlisted design's colleague deck only where one exists, so today
// nothing is read back, and the sheet's notes no longer call the Sunday figure the presentations' own.
//
// Imported, never run: it prints nothing and writes nothing. Its claims run at import, so a design that stops fitting a
// sentence stops the sheet AND the generator.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { today, folderStats } from './report-data.mjs';
import { SHORTLIST } from './fresh.mjs';
import { GRADES, RATE_125, RATE_150 } from '../../../paycalc-calc.js';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], MS = DAYS.slice(1);
const timed = s => /^\d\d:\d\d-\d\d:\d\d$/.test(s), m = s => +s.slice(0, 2) * 60 + +s.slice(3, 5), mins = s => (m(s.slice(6)) - m(s) + 1440) % 1440;
const isEarly = s => m(s) < 11 * 60;
const hm = x => `${Math.floor(x / 60)}h\u00a0${String(Math.round(x % 60)).padStart(2, '0')}m`;   // no-break space: a figure never splits
const H = v => +v.split('h')[0] * 60 + +v.split('h')[1].trim().replace('m', '');                  // "8h 13m" → 493
const Hmax = v => Math.max(...String(v).split('–').map(H));                                         // "8h 40m–8h 55m" → 535: a day type's longest closer
const first = v => +String(v).split(' ')[0];
const word = n => 'no one two three four five six seven eight nine ten eleven twelve'.split(' ')[n] ?? String(n);   // a small count in a sentence                                                      // "5 (up to 7)" → 5
const upTo = v => (s => s ? `${first(v)}, up to\u00a0${s[1]}` : `${first(v)}`)(/up to (\d+)/.exec(v));   // "5 (up to 7)" → "5, up to 7"
const claim = (what, ok) => { if (!ok) throw new Error(`the sheet says "${what}", and the figures no longer do`); };

// THE PROSE IS WRITTEN FOR THESE THREE: any other shortlist stops the sheet rather than print sentences about designs it was
// never checked against. A TO Z, whatever order fresh.mjs lists them in (A to Z there too since 5 Nov 2026, with no recommendation)
const ORDER = [...SHORTLIST].sort();
if (ORDER.join() !== 'Balanced V6,Level Crossing,Middle Ground') throw new Error(`the sheet's prose is written for Balanced V6, Level Crossing and Middle Ground; the shortlist is ${SHORTLIST}`);

// process.execPath, not 'node': the Node that is running this, not whichever the PATH finds (the review, 2 Nov 2026); and
// fileURLToPath, never `.pathname`, which turns a space in the checkout's path into %20
const FIG = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('deck-check.mjs', import.meta.url)), '--print'], { encoding: 'utf8' }));
const stats = folderStats();
const grid = name => { const f = stats.find(s => s.name === name); if (!f) throw new Error(`no proposal called ${name}`);
  const j = JSON.parse(readFileSync(f.url, 'utf8')); return j.patterns ?? j; };
const T0 = today().patterns;
const perYear = (p, test) => Object.values(p).reduce((n, r) => n + DAYS.filter(d => timed(r[d]) && test(r[d], d)).length, 0) * 52 / Object.keys(p).length;
const dayHours = (p, day) => Object.values(p).reduce((n, r) => n + (timed(r[day]) ? mins(r[day]) : 0), 0) * 52 / Object.keys(p).length / 60;
const restLens = p => { const seq = Object.keys(p).sort((a, b) => a - b).flatMap(k => DAYS.map(d => p[k][d])), n = seq.length, out = [];
  for (let i = 0; i < n; i++) if (seq[i] === 'RD' && seq[(i + n - 1) % n] !== 'RD') { let L = 0; while (L < n && seq[(i + L) % n] === 'RD') L++; out.push(L); } return out; };
const todaysTimes = new Set(Object.values(T0).flatMap(r => DAYS.map(d => r[d]).filter(timed)));
const RATE = GRADES.cea.rate, Q = RATE_125 - 1, SUN = RATE_150, OT = RATE_125;   // the Saturday premium is the quarter; a Sunday and swap overtime are paid whole

/** Everything one column of the sheet prints, for today or a design. */
function col(name, p, f) {
  const sat = dayHours(p, 'sat'), sun = dayHours(p, 'sun');
  const swap = (f.swap.endsWith('longer') ? 1 : -1) * first(f.swap);
  const breaks = restLens(p), L = Object.keys(p).length;
  return { name, p, f, sat, sun, swap,
    longEarly: Math.round(perYear(p, (s, d) => d !== 'sun' && isEarly(s) && mins(s) > 510)),
    swapHours: +f.swapShortMins / 60,
    swapPounds: Math.round(+f.swapShortMins / 60 * OT * RATE / 10) * 10,
    long34: Math.round(breaks.filter(n => n === 3 || n === 4).length * 52 / L), longOver4: breaks.filter(n => n > 4).length,
    singles: Math.round(breaks.filter(n => n === 1).length * 52 / L),   // single rest days a year each, as the shortlist sheet counts them
    earliesToday: Object.values(p).every(r => MS.every(d => !timed(r[d]) || !isEarly(r[d]) || todaysTimes.has(r[d]))) };
}
const TC = col('Today', T0, FIG.today), C = ORDER.map(n => col(n, grid(n), FIG[n])), [BV, LC, MG] = C;
// the pay, against today: a full share of Sundays and no other overtime (the decks' slide 5 sum, to £50), and no overtime at all
for (const c of C) {
  const premSat = Q * (c.sat - TC.sat), premSun = SUN * (c.sun - TC.sun);
  c.sundayLoss = Math.round(-(premSat + premSun) * RATE / 50) * 50;
  c.noOtGain = Math.round(premSat * RATE / 10) * 10;
}
// THE DECKS' OWN £, READ BACK: the Sunday £ off each colleague deck's slide 5, and the swap £ off its notes (the deep review,
// 1 Nov 2026, found the swap £ computed twice — here in JS, in deck-polish.py in Python, which rounds an exact half the other
// way — so the two could have quoted different figures for the same swaps). ONLY WHERE A DECK EXISTS since 8 Nov 2026: the three
// shortlisted that day have none yet, and a deck drawn for one is held to this sheet's figures from the day it lands
for (const c of C) {
  const deck = fileURLToPath(new URL(`../presentations/${c.name.replace(/ /g, '-')}-for-colleagues.pptx`, import.meta.url));
  if (!existsSync(deck)) continue;
  const said = /about £(\d+) a year less, gross, if you work your share of Sundays/.exec(execFileSync('unzip', ['-p', deck, 'ppt/slides/slide5.xml'], { encoding: 'utf8' }));
  claim(`${c.name}: about £${c.sundayLoss} less for a full share of Sundays, as its colleague deck says`, said && +said[1] === c.sundayLoss);
  const notes = execFileSync('unzip', ['-p', deck, 'ppt/notesSlides/notesSlide5.xml'], { encoding: 'utf8' });
  const today = /a year, roughly £(\d+) gross\./.exec(notes), own = /so the same swaps add about [^,]+, roughly £(\d+)\./.exec(notes);
  claim(`today’s swaps, about £${TC.swapPounds}, as ${c.name}’s colleague deck says`, today && +today[1] === TC.swapPounds);
  claim(`${c.name}’s swaps, ${c.swapPounds ? `about £${c.swapPounds}` : 'nothing'}, as its colleague deck says`, c.swapPounds ? own && +own[1] === c.swapPounds : !own && /those particular swaps add nothing/.test(notes));
}
const perYearOf = (c, test) => perYear(c.p, test);

// ── THE IN-SHORT LINES, EACH ASSERTED ─────────────────────────────────────────────────────────────────────────────────
// Every comparing word printed below has a claim here, and no claim stands for a sentence the page does not print (the deep
// review, 1 Nov 2026, found five words unchecked and five claims guarding nothing)
const all = ok => C.every(ok);
// …prefer earlies
claim('fewer earlies and longer ones on every link', all(c => +c.f.earlyYear < +TC.f.earlyYear && H(c.f.avgEarly) > H(TC.f.avgEarly)));
claim('earlies and lates in longer runs on every link', all(c => +c.f.block > +TC.f.block && +c.f.blockUpTo > +TC.f.blockUpTo));
// (8 Nov 2026) Balanced V6's runs of earlies or of lates are the shortest of the three, set duties and with a cover week. Its two
// earlies a year over 8h 30m (its Saturday 06:20–15:00) are the row's to show, not a sentence's: the band was a line too long
claim('Balanced V6’s runs of earlies or lates the shortest of the three', C.every(c => c === BV || (+BV.f.block < +c.f.block && +BV.f.blockUpTo < +c.f.blockUpTo)));
// "the only earlies that finish before 14:00" (the notes): the 13:35 and 13:45 count is the pack's before-14:00 count
claim('the 13:35 and 13:45 earlies are the only earlies that finish before 14:00, today and on every link',
  [TC, ...C].every(c => Math.round(perYearOf(c, s => isEarly(s) && m(s.slice(6)) < 14 * 60)) === +c.f.shortYear));
// …prefer lates
claim('more lates on every link', all(c => +c.f.lateYear > +TC.f.lateYear));
// EVERY CLOSER SHORTER, BY ITS LONGEST (8 Nov 2026): Balanced V6's Saturday 8h 55m closer is 15 minutes shorter than today's 9h 10m
const cuts = C.flatMap(c => ['closerWk', 'closerSat', 'closerSun'].map(k => Hmax(TC.f[k]) - Hmax(c.f[k]))), cutLo = Math.min(...cuts), cutHi = Math.max(...cuts);
claim('every closing shift shorter, by 15 minutes to an hour', cutLo === 15 && cutHi === 60);
claim('Middle Ground: the shortest lates on average', C.every(c => c === MG || H(MG.f.avgLate) < H(c.f.avgLate)));
// …swap (the external review's wording, 1 Nov 2026)
const swapLess = C.map(c => TC.swapPounds - c.swapPounds);
claim('swapping the shortest earlies brings less overtime than today on every link', swapLess.every(x => x > 0) && all(c => +c.f.shortYear < +TC.f.shortYear));
claim('Balanced V6 keeps the most from its 13:35 and 13:45 finishes, Middle Ground the least', BV.swapHours > LC.swapHours && LC.swapHours > MG.swapHours && MG.swapHours > 0
  && ['-13:35', '-13:45'].every(e => Object.values(BV.p).some(r => MS.some(d => timed(r[d]) && r[d].endsWith(e)))));
// "OTHER SWAPS MAY STILL ADD PAID TIME" (the external review, 1 Nov 2026): true only while every link has, on some day Monday
// to Saturday, an early other than a 13:35 or 13:45 and a late on the same day that is longer than it
const otherSwaps = p => MS.some(d => { const on = [...new Set(Object.values(p).map(r => r[d]).filter(timed))];
  return on.some(e => isEarly(e) && !/-13:(35|45)$/.test(e) && on.some(l => !isEarly(l) && mins(l) > mins(e))); });
claim('other swaps may still add paid time, on every link', all(c => otherSwaps(c.p)));
// …your share of Sundays
// each design's own £ since 5 Nov 2026 (Middle Ground's, the most since 8 Nov 2026, is its row's to show: its Sundays are Common
// Ground's, evened out to 8h–8h 30m, the shortest of the three)
const sundayLoss = C.map(c => c.sundayLoss);
const sunAvg = c => c.sun * 60 / perYearOf(c, (s, d) => d === 'sun');   // the average Sunday duty, in minutes
claim('a full share of Sundays costs between £200 and £350 a year, gross', sundayLoss.every(x => x >= 200 && x <= 350));
claim('two more Saturdays at time and a quarter, but fewer, shorter Sundays, on every link',
  sundayLoss.every(x => x > 0) && all(c => +c.f.sat - +TC.f.sat === 2 && +c.f.sun < +TC.f.sun && sunAvg(c) < sunAvg(TC)));
// …no overtime at all
const noOt = C.map(c => c.noOtGain);
claim('no overtime at all: a little better off on every link, from two more Saturdays', noOt.every(x => x > 0 && x < 150) && all(c => +c.f.sat - +TC.f.sat === 2));
// …save your leave (SUNDAY TO SATURDAY, AS THE OTHER SHEETS SAY IT — the accuracy check, 1 Nov 2026: leave.mjs's fourWeeks is
// 28 days from a Sunday; from a Wednesday the same 14 days buy 28 on every link, so without the words the band contradicted
// its next row)
claim('all three keep today’s leave: four full weeks off, Sunday to Saturday, for the same leave, and the same best stretch', all(c => +c.f.leaveFour === +TC.f.leaveFour && +c.f.leaveBest === +TC.f.leaveBest));
claim('on average 14 days’ leave goes at least as far as today, on every link', all(c => +c.f.leaveAvg >= +TC.f.leaveAvg));
// (8 Nov 2026) fewer three- and four-day breaks than today on every link, none longer; Balanced V6 has the most of the three, and
// pays for its breaks with single rest days: 22 a year each, where today and Level Crossing have 10 and Middle Ground 12
claim('fewer three- and four-day breaks than today on every link, Balanced V6 the most of the three, for more single rest days than today', all(c => c.long34 < TC.long34 && c.long34 > 0 && c.longOver4 === 0)
  && C.every(c => c === BV || c.long34 < BV.long34) && BV.singles > TC.singles && TC.longOver4 === 0);
// Whoever you are
claim('every link: more full weekends, fewer days in a row, a longer shortest rest, no avoidable fatigue warning on the set duties',
  all(c => +c.f.weekendsYear > +TC.f.weekendsYear && first(c.f.run) < first(TC.f.run) && H(c.f.rest) > H(TC.f.rest) && first(c.f.ff) === 0) && first(TC.f.ff) > 0);
// …BUT A BADLY PLACED COVER WEEK ON BALANCED V6 MAKES ONE DAY MORE IN A ROW THAN TODAY'S WORST (8 Nov 2026), which the band says
const worstRun = c => +(/up to (\d+)/.exec(c.f.run)?.[1] ?? first(c.f.run));
claim('Balanced V6: one day more in a row than today if a cover week falls badly; the other two fewer than today', worstRun(BV) === worstRun(TC) + 1 && [LC, MG].every(c => worstRun(c) < worstRun(TC)));
const closerMax = c => Math.max(...['closerWk', 'closerSat', 'closerSun'].map(k => Hmax(c.f[k])));
const lo = (xs) => Math.min(...xs), hi = (xs) => Math.max(...xs);

// NOT RANKED: no overtime (5 Nov 2026). The three's Saturday hours are close a year, so a green on the highest would rank a few
// pounds; the notes say they are not ranked. WITHIN ONE SATURDAY DUTY'S HOURS since 8 Nov 2026: Balanced V6 and Middle Ground are
// 7.5 hours a year apart, about £50 at the premium, and the notes say so; a wider gap stops the sheet
claim('no overtime: the three within one Saturday duty’s hours a year of each other, so the rows are not ranked', hi(C.map(c => c.sat)) - lo(C.map(c => c.sat)) < 8.5);
// ── THE TABLE ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// a row: label, and for today and each design the printed text and a number to rank by; `better` picks the best of the
// three for THAT person (bold green), or null where nothing is better — today is for scale, never ranked. Left unranked on
// purpose (the deep review, 1 Nov 2026), and the page's notes say so: the whole swap band — its totals rank only the 13:35 and
// 13:45 swaps (counting every swap, Even Step adds more than In Step), and a green on its first row alone pointed at Even Step
// beside a line naming In Step (the aesthetic review, 1 Nov 2026); the late finishes, which a late-lover reads the other way;
// and the weeks in a run, which suit one reader and not another. The average late IS ranked, shorter better, as on the
// shortlist sheet and slide 6 (the consistency review, 1 Nov 2026), so the green agrees with "Short Run's are the shortest"
const row = (label, get, better = null, note = '') => ({ label, note, better, cells: [TC, ...C].map(get) });
const v = (text, n = null) => ({ text, n });
const money = (x, word) => x ? `about £${x}${word ? ` ${word}` : ''}` : 'none';
const GROUPS = [
  { who: '…prefer earlies',
    gist: `Fewer, longer earlies on every link, in longer runs; Balanced V6’s runs are the shortest of the three.`,
    rows: [row('Earlies a year', c => v(c.f.earlyYear, +c.f.earlyYear), 'high'),
      row('Average early', c => v(hm(H(c.f.avgEarly)), H(c.f.avgEarly)), 'low'),
      row('Earlies over 8h 30m, a year', c => v(`${c.longEarly}`, c.longEarly), 'low'),
      row('Earlies finishing at 13:35 or 13:45, a year', c => v(c.f.shortYear, +c.f.shortYear), 'high'),
      row('Weeks of earlies, or of lates, in a row', c => v(upTo(`${c.f.block} (up to ${c.f.blockUpTo})`)))] },
  { who: '…prefer lates',
    gist: `More lates on every link, in longer runs, and every closer ${cutLo} minutes to an hour shorter. Middle Ground’s are the shortest on average.`,
    rows: [row('Lates a year', c => v(c.f.lateYear, +c.f.lateYear), 'high'),
      row('Average late, closers included', c => v(hm(H(c.f.avgLate)), H(c.f.avgLate)), 'low'),
      row('Longest closing shift, any day', c => v(hm(closerMax(c)), closerMax(c)), 'low'),
      row('Finishing at 23:00 or later, any day, a year', c => v(c.f.late23, +c.f.late23))] },
  { who: '…swap earlies for lates, for the overtime',
    gist: `Swapping the shortest earlies brings less overtime than today on every link. Balanced V6 keeps the most from its 13:35 and 13:45 finishes, Middle Ground the least. Other swaps may still add paid time.`,
    rows: [row('A late against an early, same day, on average', c => v(`${Math.abs(c.swap)} min ${c.swap >= 0 ? 'longer' : 'shorter'}`, c.swap)),
      row('Each 13:35 or 13:45 early swapped for the day’s longest late', c => v(c.swapHours ? `+${hm(Math.round(c.swapHours * 60))}` : 'none', c.swapHours)),
      row('That overtime, gross, at time and a quarter', c => v(money(c.swapPounds), c.swapPounds))] },
  { who: '…work your share of Sundays and no other overtime',
    gist: `About £${lo(sundayLoss)} to £${hi(sundayLoss)} a year less on every link, gross: two more Saturdays at time and a quarter, but fewer, shorter Sundays.`,
    rows: [row('Sundays a year, at time and a half', c => v(c.f.sun, +c.f.sun)),
      row('Sunday hours a year', c => v(`${Math.round(c.sun)}`, Math.round(c.sun))),
      row('Premium and overtime pay, against today', c => v(c === TC ? '—' : money(c.sundayLoss, 'less')))] },
  { who: '…work no overtime at all',
    gist: `A little better off on every link — about £${lo(noOt)} to £${hi(noOt)} a year, gross, from two more Saturdays at time and a quarter.`,
    rows: [row('Saturday hours a year, at time and a quarter', c => v(`${Math.round(c.sat)}`, Math.round(c.sat))),
      row('Premium pay, against today', c => v(c === TC ? '—' : money(c.noOtGain, 'more'), c === TC ? null : c.noOtGain))] },
  { who: '…save your leave for long breaks',
    gist: `All three keep today’s leave: four full weeks off, Sunday to Saturday, take ${TC.f.leaveFour} days, and 14 days buy ${TC.f.leaveBest} days off at best. Each has fewer three- and four-day breaks than today; Balanced V6 has the most of the three, for ${BV.singles} single rest days a year where today has ${TC.singles}.`,
    rows: [row('Leave for four full weeks off, Sunday to Saturday', c => v(`${c.f.leaveFour} days`, +c.f.leaveFour), 'low'),
      row('Days off in a row from 14 days’ leave, at best', c => v(c.f.leaveBest, +c.f.leaveBest), 'high'),
      row('Rest-day breaks of three or four days, a year', c => v(c.long34 ? `about ${c.long34}` : 'none', c.long34), 'high')] },
  { who: 'Whoever you are',
    gist: `What every shortlisted link gives everyone, against today, on the set duties. If a cover week falls badly, Balanced V6 can make ${word(worstRun(BV))} days in a row, one more than today.`,
    rows: [row('Full weekends off a year', c => v(c.f.weekendsYear, +c.f.weekendsYear), 'high'),
      row('Most days in a row', c => v(upTo(c.f.run), first(c.f.run)), 'low'),
      row('Shortest rest between shifts', c => v(hm(H(c.f.rest)), H(c.f.rest)), 'high'),
      row('Avoidable fatigue warnings', c => v(upTo(c.f.ff), first(c.f.ff)), 'low')] },
];

// ── WHICH CELL IS THE CLEAR BEST ──────────────────────────────────────────────────────────────────────────────────────
/** Is cell `i` of row `r` the clear best of the three for that person (bold green)? Today (i = 0) never is, nor any cell of a
 *  row ranked by nothing, a row with a figure missing, or a row where all three agree. A tie at the top marks both. */
export const isBest = (r, i) => { const c = r.cells[i]; if (i === 0 || !r.better) return false;
  const ns = r.cells.slice(1).map(x => x.n); if (ns.some(x => x == null) || ns.every(x => x === ns[0])) return false;
  return c.n === (r.better === 'high' ? Math.max(...ns) : Math.min(...ns)); };

// ── A FIGURE KEEPS WHAT IT BELONGS TO ─────────────────────────────────────────────────────────────────────────────────
/** No-break spaces, as on the other sheets: "18 of / 21", "40 / a year", "(today / 26)", and a design's name never splits
 *  ("Long / Break", the aesthetic review). For one run of text — the sheet applies it to every text node. @param {string} t */
export const tidyText = t => t
  .replace(/\b(\d+) (to|in|of) (\d+)\b/g, '$1\u00a0$2\u00a0$3').replace(/\b(\d+) a year\b/g, '$1\u00a0a\u00a0year').replace(/£(\d+) (a year|less|more)\b/g, '£$1\u00a0$2')
  .replace(/\b(today|Sun|Sat) (?=\d)/g, '$1\u00a0')
  .replace(/\b(Even|In|Short|Long|Common|Middle|Level|Balanced) (Step|Run|Break|Ground|Crossing|V\d)\b/g, '$1\u00a0$2');

export { GROUPS, TC, C, BV, LC, MG, FIG, RATE, OT, sundayLoss, noOt, lo, hi, hm, H, Hmax, first, upTo, timed, m, mins, isEarly, DAYS, MS, perYear, restLens, grid, claim, SHORTLIST };
