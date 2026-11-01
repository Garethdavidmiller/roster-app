// WHAT IT MEANS IF YOU… (1 Nov 2026, owner: "make all three changes" — the third being a one-page sheet that answers the
// question colleagues actually ask: not "which link is best" but "what does it mean for ME?"). Six ways people work the
// roster today — preferring earlies, preferring lates, swapping earlies for lates for the overtime, working their share of
// Sundays and no other overtime, working no overtime at all, saving leave for long breaks — each answered with the
// figures, today against the three shortlisted links, and then what every one of them gains whichever they are.
//
// NOTHING IS TYPED. The figures are the decks' own (`deck-check.mjs --print`, the sheets' counts), the long earlies and
// the rest-day breaks are counted from the grids here, the leave is leave.mjs (Long Break's too, named as the leave
// alternative outside the shortlist), and the pay is the Pay Calculator's rate and multipliers (paycalc-calc.js). Every
// "in short" line is ASSERTED against the figures before the page is printed, so a design that stops fitting a sentence
// stops the sheet; and the Sunday £ is read back off the shipped colleague decks' slide 5, so the sheet and the decks
// can never quote two different figures for the same person.
//
// The pay figures, and what they assume (said again in the page's own notes):
//   · Sundays: two more Saturdays at time and a quarter (the quarter is the premium) against fewer, shorter Sundays at
//     time and a half — deck-polish.py's slide 5 sum, rounded to £50 as the decks round it;
//   · no overtime at all: the Saturday premium alone, to £10;
//   · swaps: each 13:35 or 13:45 early (the short earlies; the only earlies that finish before 14:00) swapped for that
//     day's longest late, the extra time paid as "Overtime 1.25" — the Pay Calculator's rate for hours over a shift — to
//     £10. It needs a partner for every swap, which nobody can promise, so it is the most THOSE swaps could make, not a
//     forecast — and not every swap: an 8-hour early for an 8½-hour late still adds time on every link (the external
//     review, 1 Nov 2026, which found "Short Run none" read as no swap paying at all);
//   · gross, before tax, at the CEA rate.
//
//   node docs/links-26/tooling/what-it-means-sheet.mjs   → docs/links-26/links-26-what-it-means.pdf
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { today, folderStats } from './report-data.mjs';
import { leave } from './leave.mjs';
import { SHORTLIST, RECOMMENDED } from './fresh.mjs';
import { GRADES, RATE_125, RATE_150 } from '../../../paycalc-calc.js';

const ROOT = new URL('../../../', import.meta.url).href.replace(/\/$/, '');
const OUT = new URL('../links-26-what-it-means.pdf', import.meta.url).pathname;
const PREPARED = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], MS = DAYS.slice(1);
const timed = s => /^\d\d:\d\d-\d\d:\d\d$/.test(s), m = s => +s.slice(0, 2) * 60 + +s.slice(3, 5), mins = s => (m(s.slice(6)) - m(s) + 1440) % 1440;
const isEarly = s => m(s) < 11 * 60;
const hm = x => `${Math.floor(x / 60)}h\u00a0${String(Math.round(x % 60)).padStart(2, '0')}m`;   // no-break space: a figure never splits
const H = v => +v.split('h')[0] * 60 + +v.split('h')[1].trim().replace('m', '');                  // "8h 13m" → 493
const first = v => +String(v).split(' ')[0];                                                      // "5 (up to 7)" → 5
const upTo = v => (s => s ? `${first(v)}, up to\u00a0${s[1]}` : `${first(v)}`)(/up to (\d+)/.exec(v));   // "5 (up to 7)" → "5, up to 7"
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const claim = (what, ok) => { if (!ok) throw new Error(`the sheet says "${what}", and the figures no longer do`); };

// THE PROSE IS WRITTEN FOR THESE THREE: any other shortlist stops the sheet rather than print sentences about designs it was
// never checked against
if (SHORTLIST.join() !== 'Even Step,In Step,Short Run' || RECOMMENDED !== 'Even Step') throw new Error(`the sheet's prose is written for Even Step (recommended), In Step and Short Run; the shortlist is ${SHORTLIST}, recommending ${RECOMMENDED}`);

const FIG = JSON.parse(execFileSync('node', [new URL('deck-check.mjs', import.meta.url).pathname, '--print'], { encoding: 'utf8' }));
const stats = folderStats();
const grid = name => { const f = stats.find(s => s.name === name); if (!f) throw new Error(`no proposal called ${name}`);
  const j = JSON.parse(readFileSync(new URL(`../proposals/${f.file}`, import.meta.url), 'utf8')); return j.patterns ?? j; };
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
    earliesToday: Object.values(p).every(r => MS.every(d => !timed(r[d]) || !isEarly(r[d]) || todaysTimes.has(r[d]))) };
}
const TC = col('Today', T0, FIG.today), C = SHORTLIST.map(n => col(n, grid(n), FIG[n])), [ES, IS, SR] = C;
// the pay, against today: a full share of Sundays and no other overtime (the decks' slide 5 sum, to £50), and no overtime at all
for (const c of C) {
  const premSat = Q * (c.sat - TC.sat), premSun = SUN * (c.sun - TC.sun);
  c.sundayLoss = Math.round(-(premSat + premSun) * RATE / 50) * 50;
  c.noOtGain = Math.round(premSat * RATE / 10) * 10;
}
// THE DECKS' OWN £, READ BACK (the sheet and slide 5 may never disagree about the same person)
for (const c of C) {
  const deck = new URL(`../presentations/${c.name.replace(/ /g, '-')}-for-colleagues.pptx`, import.meta.url).pathname;
  const said = /about £(\d+) a year less, gross, if you work your share of Sundays/.exec(execFileSync('unzip', ['-p', deck, 'ppt/slides/slide5.xml'], { encoding: 'utf8' }));
  claim(`${c.name}: about £${c.sundayLoss} less for a full share of Sundays, as its colleague deck says`, said && +said[1] === c.sundayLoss);
}
const LB = leave(grid('Long Break')), LBp = grid('Long Break');

// ── THE IN-SHORT LINES, EACH ASSERTED ─────────────────────────────────────────────────────────────────────────────────
const all = ok => C.every(ok);
claim('fewer earlies and longer ones on every link', all(c => +c.f.earlyYear < +TC.f.earlyYear && H(c.f.avgEarly) > H(TC.f.avgEarly)));
claim('Even Step: none over 8h 30m, and every early Monday to Saturday one of today’s times', ES.earliesToday && ES.longEarly === 0);
claim('more lates on every link', all(c => +c.f.lateYear > +TC.f.lateYear));
const cuts = C.flatMap(c => ['closerWk', 'closerSat', 'closerSun'].map(k => H(TC.f[k]) - H(c.f[k])));
claim('every closing shift shorter, by 30 minutes to an hour', Math.min(...cuts) === 30 && Math.max(...cuts) === 60);
claim('Short Run: the shortest lates on average, and the longest Saturday closer of the three', C.every(c => c === SR || H(SR.f.avgLate) < H(c.f.avgLate)) && C.every(c => c === SR || H(SR.f.closerSat) > H(c.f.closerSat)));
claim('a late is barely longer than an early on every link, or shorter', all(c => c.swap <= 5) && TC.swap >= 30);
claim('the short earlies worth swapping are rarer on every link', all(c => +c.f.shortYear < +TC.f.shortYear));
claim('In Step keeps the most from its 13:35 or 13:45 finishes; Short Run has none of those finishes', C.every(c => c === IS || IS.swapHours > c.swapHours) && +SR.f.shortYear === 0 && SR.swapHours === 0);
// "OTHER SWAPS MAY STILL ADD PAID TIME" (the external review, 1 Nov 2026): true only while every link has, on some day Monday
// to Saturday, an early other than a 13:35 or 13:45 and a late on the same day that is longer than it
const otherSwaps = p => MS.some(d => { const on = [...new Set(Object.values(p).map(r => r[d]).filter(timed))];
  return on.some(e => isEarly(e) && !/-13:(35|45)$/.test(e) && on.some(l => !isEarly(l) && mins(l) > mins(e))); });
claim('other swaps may still add paid time, on every link', all(c => otherSwaps(c.p)));
const swapLess = C.map(c => TC.swapPounds - c.swapPounds);
claim('swapping the shortest earlies brings less overtime than today on every link', swapLess.every(x => x > 0));
const sundayLoss = (v => { claim('the same £ for a full share of Sundays on all three', v.every(x => x === v[0])); return v[0]; })(C.map(c => c.sundayLoss));
claim('a full share of Sundays pays less on every link', sundayLoss > 0 && all(c => +c.f.sun < +TC.f.sun && +c.f.sat > +TC.f.sat));
const noOt = C.map(c => c.noOtGain); claim('no overtime at all: a little better off on every link', noOt.every(x => x > 0));
// SUNDAY TO SATURDAY, AS THE OTHER SHEETS SAY IT (the accuracy check, 1 Nov 2026): leave.mjs's fourWeeks is 28 days from a Sunday; from a
// Wednesday the same 14 days buy 28 on every link, so without the words the band contradicted its next row
claim('four full weeks off, Sunday to Saturday, take a day more leave on every link', all(c => +c.f.leaveFour === +TC.f.leaveFour + 1));
claim('14 days’ leave goes as far as today on average, on every link', all(c => c.f.leaveAvg === TC.f.leaveAvg));
claim('no rest-day break over two days on any link; today has three- and four-day breaks', all(c => c.long34 === 0 && c.longOver4 === 0 && restLens(c.p).every(n => n <= 2)) && TC.long34 > 0);
claim('Long Break keeps four weeks off for today’s 14 days’ leave, and is not shortlisted', LB.fourWeeks === +TC.f.leaveFour && !SHORTLIST.includes('Long Break'));
claim('every link: more full weekends, fewer days in a row, a longer shortest rest, no avoidable fatigue warning on the set duties',
  all(c => +c.f.weekendsYear > +TC.f.weekendsYear && first(c.f.run) < first(TC.f.run) && H(c.f.rest) > H(TC.f.rest) && first(c.f.ff) === 0) && first(TC.f.ff) > 0);
const closerMax = c => Math.max(...['closerWk', 'closerSat', 'closerSun'].map(k => H(c.f[k])));
claim('the longest closing shift shorter on every link', all(c => closerMax(c) < closerMax(TC)));
const sameAll = k => (v => v.every(x => x === v[0]) ? v[0] : null)(C.map(c => c.f[k]));
const lo = (xs) => Math.min(...xs), hi = (xs) => Math.max(...xs);

// ── THE TABLE ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// a row: label, and for today and each design the printed text and a number to rank by; `better` picks the best of the
// three for THAT person (bold green), or null where nothing is better — today is for scale, never ranked
const row = (label, get, better = null, note = '') => ({ label, note, better, cells: [TC, ...C].map(get) });
const v = (text, n = null) => ({ text, n });
const money = (x, word) => x ? `about £${x}${word ? ` ${word}` : ''}` : 'none';
const GROUPS = [
  { who: '…prefer earlies',
    gist: `Fewer, longer earlies on every link. Even Step’s stay nearest today: none over 8h\u00a030m, and every one is one of today’s times.`,
    rows: [row('Earlies a year', c => v(c.f.earlyYear, +c.f.earlyYear), 'high'),
      row('Average early', c => v(hm(H(c.f.avgEarly)), H(c.f.avgEarly)), 'low'),
      row('Earlies over 8h\u00a030m, a year', c => v(`${c.longEarly}`, c.longEarly), 'low'),
      row('Earlies finishing at 13:35 or 13:45, a year', c => v(c.f.shortYear, +c.f.shortYear), 'high')] },
  { who: '…prefer lates',
    gist: `More lates on every link, and every closing shift 30 minutes to an hour shorter. Short Run’s lates are the shortest on average.`,
    rows: [row('Lates a year', c => v(c.f.lateYear, +c.f.lateYear), 'high'),
      row('Average late', c => v(hm(H(c.f.avgLate)), H(c.f.avgLate)), 'low'),
      row('Longest closing shift, any day', c => v(hm(closerMax(c)), closerMax(c)), 'low'),
      row('Finishing at 23:00 or later, any day, a year', c => v(c.f.late23, +c.f.late23), 'low')] },
  { who: '…swap earlies for lates, for the overtime',
    gist: `Swapping the shortest earlies brings less overtime than today on every link. In Step keeps the most from its 13:35 or 13:45 finishes; Short Run has none of those finishes. Other swaps may still add paid time.`,
    rows: [row('A late against an early on the same day, on average', c => v(`${Math.abs(c.swap)}\u00a0min ${c.swap >= 0 ? 'longer' : 'shorter'}`, c.swap), 'high'),
      row('Each 13:35 or 13:45 early swapped for the day’s longest late', c => v(c.swapHours ? `+${hm(Math.round(c.swapHours * 60))}` : 'nothing', c.swapHours), 'high'),
      row('That overtime, gross, at time and a quarter', c => v(money(c.swapPounds), c.swapPounds), 'high')] },
  { who: '…work your share of Sundays, and no other overtime',
    gist: `About £${sundayLoss} a year less on every link, gross: two more Saturdays at time and a quarter, but fewer, shorter Sundays.`,
    rows: [row('Sundays a year, at time and a half', c => v(c.f.sun, +c.f.sun)),
      row('Sunday hours a year', c => v(`${Math.round(c.sun)}`, Math.round(c.sun))),
      row('Premium and overtime pay, against today', c => v(c === TC ? '—' : money(c.sundayLoss, 'less')))] },
  { who: '…work no overtime at all',
    gist: `A little better off on every link — about £${lo(noOt)} to £${hi(noOt)} a year, gross, from two more Saturdays at time and a quarter.`,
    rows: [row('Saturday hours a year, at time and a quarter', c => v(`${Math.round(c.sat)}`, Math.round(c.sat)), 'high'),
      row('Premium pay, against today', c => v(c === TC ? '—' : money(c.noOtGain, 'more'), c === TC ? null : c.noOtGain), 'high')] },
  { who: '…save your leave for long breaks',
    gist: `Four full weeks off, Sunday to Saturday, take a day more leave on every link. Long Break, outside the shortlist, keeps them at ${LB.fourWeeks} days.`,
    rows: [row('Leave for four full weeks off, Sunday to Saturday', c => v(`${c.f.leaveFour} days`, +c.f.leaveFour), 'low'),
      row('Days off in a row from 14 days’ leave, at best', c => v(c.f.leaveBest, +c.f.leaveBest), 'high'),
      row('Rest-day breaks of three or four days, a year', c => v(c.long34 ? `about ${c.long34}` : 'none', c.long34), 'high')] },
  { who: 'Whoever you are',
    gist: `What every shortlisted link gives everyone, against today.`,
    rows: [row('Full weekends off a year', c => v(c.f.weekendsYear, +c.f.weekendsYear), 'high'),
      row('Most days in a row', c => v(upTo(c.f.run), first(c.f.run)), 'low'),
      row('Shortest rest between shifts', c => v(hm(H(c.f.rest)), H(c.f.rest)), 'high'),
      row('Avoidable fatigue warnings', c => v(upTo(c.f.ff), first(c.f.ff)), 'low')] },
];
const cell = (r, i) => { const c = r.cells[i]; if (i === 0 || !r.better) return c.text;
  const ns = r.cells.slice(1).map(x => x.n); if (ns.some(x => x == null) || ns.every(x => x === ns[0])) return c.text;
  const best = r.better === 'high' ? Math.max(...ns) : Math.min(...ns); return c.n === best ? `<b class="best">${c.text}</b>` : c.text; };
const body = GROUPS.map(g => `<tbody><tr class="band"><td colspan="5"><span class="who">${g.who}</span><span class="gist">${esc(g.gist)}</span></td></tr>
${g.rows.map(r => `<tr class="r"><td>${esc(r.label)}${r.note ? `<span class="nt">${esc(r.note)}</span>` : ''}</td>${r.cells.map((_, i) => `<td class="num${i === 0 ? ' today' : ''}">${cell(r, i)}</td>`).join('')}</tr>`).join('\n')}</tbody>`).join('\n');

const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>What it means if you… — December 2026 link shortlist</title>
<link rel="stylesheet" href="${ROOT}/shared.css">
<style>
@page { size: A4; margin: 11mm 11mm 13mm; }
html, body { background: white !important; color: var(--text-dark); padding: 0 !important; margin: 0; font-family: var(--font-sans); font-size: 11.1px; line-height: 1.38; }
.page { position: relative; height: 273mm; box-sizing: border-box; padding-bottom: 14px; }
.mast { background: var(--primary-blue); color: white; padding: 12px 20px 11px; border-bottom: 4px solid var(--accent-gold); border-radius: var(--radius); display: flex; gap: 16px; align-items: center; }
.mast img { width: 44px; height: 44px; border-radius: 10px; }
.mast .eyebrow { color: var(--accent-gold); font-size: 10px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; }
.mast h1 { margin: 2px 0; font-size: 22px; font-weight: 800; color: white; letter-spacing: -.2px; }
.mast .sub { color: rgba(255,255,255,.78); font-size: 11.5px; text-wrap: balance; }
.mast .meta { color: rgba(255,255,255,.55); font-size: 9.5px; margin-top: 4px; }
p { margin: 3px 0 6px; } .lead { font-size: 11.2px; margin: 8px 0 6px; }
table.t { border-collapse: collapse; width: 100%; font-size: 10.2px; line-height: 1.32; }
table.t th, table.t td { padding: 1.5px 7px 2px; border-bottom: 1px solid var(--border-light); text-align: left; vertical-align: top; }
table.t th { background: var(--surface-sunken); color: var(--text-mid); font-size: 9.2px; text-transform: uppercase; letter-spacing: .3px; }
table.t th.num, table.t td.num { text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; width: 14%; } table.t th:first-child { width: 44%; }
table.t td.today { color: var(--text-light); }
table.t .best { font-weight: 800; color: color-mix(in srgb, var(--success-green) 80%, black); }
table.t tr.r:nth-child(odd) td { background: color-mix(in srgb, var(--surface-sunken) 55%, white); }
table.t .nt { display: block; color: var(--text-mid); font-size: 8.6px; line-height: 1.25; }
/* each kind of colleague: the sentence the page title starts, finished, and what it comes to — in short */
table.t tr.band td { border-bottom: 1.5px solid var(--primary-blue); padding: 8px 7px 2.5px; background: white; }
table.t tbody:first-of-type tr.band td { padding-top: 5px; }
table.t tr.band .who { display: block; font-size: 13px; font-weight: 800; color: var(--primary-blue); letter-spacing: -.1px; }
table.t tr.band .gist { display: block; font-size: 10.4px; color: var(--text-dark); line-height: 1.36; }
.notes { margin-top: 8px; color: var(--text-mid); font-size: 8.8px; line-height: 1.4; column-count: 2; column-gap: 22px; }
.notes b { color: var(--text-dark); }
.foot { position: absolute; bottom: 0; left: 0; right: 0; display: flex; justify-content: space-between; font-size: 8.5px; color: var(--text-light); border-top: 1px solid var(--border-light); padding-top: 4px; }
.foot b { color: var(--primary-blue); } .nw { white-space: nowrap; }
* { text-wrap: pretty; } h1 { text-wrap: balance; }
</style></head><body>
<section class="page">
  <div class="mast"><img src="${ROOT}/icon-192.png" alt=""><div><div class="eyebrow">Marylebone Roster · Links designer · What it means for you</div><h1>What it means if you…</h1>
  <div class="sub">Six ways people work the roster today, and what Even Step (recommended), In Step and Short Run would mean for each — against today’s link</div>
  <div class="meta">Prepared ${PREPARED} · every figure is computed from the rotas</div></div></div>
  <p class="lead">One person, a year, with the cover weeks aside. Earlies and lates are counted Monday to Saturday, as Sunday is overtime. Pounds are gross, before tax, at the CEA rate of £${RATE.toFixed(2)} — the Pay Calculator in the app works out a real payslip. The best of the three for that person is in <b class="best" style="color:color-mix(in srgb, var(--success-green) 80%, black)">bold green</b>; today is for scale.</p>
  <table class="t"><thead><tr><th>If you…</th><th class="num">Today</th>${C.map(c => `<th class="num">${c.name}</th>`).join('')}</tr></thead>
${body}
  </table>
  <div class="notes"><b>How these are worked out.</b> Over 52 weeks, two turns of a 26-week link, so a design’s figures are everyone’s; today’s, on 20 weeks, are averages. An early starts before 11:00, a late at 11:00 or after. A swap is counted on the same day: a late against that day’s earlies, on average, and each 13:35 or 13:45 early — the only earlies that finish before 14:00 — swapped for that day’s longest late. That is the most these particular short-early swaps could make, not a forecast, and other swaps may still add paid time. It needs a partner for every swap, and assumes the extra time is paid as “Overtime 1.25”, as the Pay Calculator pays it. The Sunday figure is the presentations’ own, to £50; the others are to £10. Leave: a working day Monday to Saturday costs a day’s leave, a rest day or a Sunday none. “Up to” is the worst place a cover week’s duties could fall. Fatigue warnings are reported against the ORR’s good-practice list, never as pass or fail.</div>
  <div class="foot"><span>Page 1 of 1 — What it means if you…</span><span><b>What it means</b> · <span class="nw">Even Step</span>, <span class="nw">In Step</span> and <span class="nw">Short Run</span> · Marylebone Roster — Links designer</span></div>
</section>
</body></html>`;
// a figure keeps what it belongs to, as on the other sheets: "18 of / 21", "40 / a year", "(today / 26)"
const tidy = h => h.replace(/(<style[\s\S]*?<\/style>|<title>[\s\S]*?<\/title>)|(?<=>)([^<]+)(?=<)/g, (mm, keep, txt) => keep ?? txt
  .replace(/\b(\d+) (to|in|of) (\d+)\b/g, '$1\u00a0$2\u00a0$3').replace(/\b(\d+) a year\b/g, '$1\u00a0a\u00a0year').replace(/£(\d+) (a year|less|more)\b/g, '£$1\u00a0$2')
  .replace(/\b(today|Sun|Sat) (?=\d)/g, '$1\u00a0'));
const htmlOut = new URL('links-26-what-it-means.html', import.meta.url).pathname; writeFileSync(htmlOut, tidy(html));   // beside the tooling, gitignored
const b = await chromium.launch(); const pg = await b.newPage();
await pg.goto('file://' + htmlOut); await pg.evaluate(() => document.fonts.ready);
// THE PAGE IS A FIXED HEIGHT, so content that does not fit would be HIDDEN under the footer: refuse to print it. Measured at
// the PRINT width under print media, as the shortlist sheet measures (its first guard measured the screen and passed a
// broken page)
{ await pg.emulateMedia({ media: 'print' }); await pg.setViewportSize({ width: 711, height: 1100 });
  const over = await pg.evaluate(() => { const p = document.querySelector('.page'), foot = p.querySelector('.foot'), lim = foot.getBoundingClientRect().top;
    const low = Math.max(...[...p.children].filter(c => c !== foot).map(c => c.getBoundingClientRect().bottom));
    return Math.round(Math.max(low - lim, p.scrollHeight - p.clientHeight, p.scrollWidth - p.clientWidth)); });
  if (over > 1) throw new Error(`content runs into the footer or off the page by ${over}px`);
  const room = await pg.evaluate(() => { const p = document.querySelector('.page'), foot = p.querySelector('.foot');
    return Math.round(foot.getBoundingClientRect().top - Math.max(...[...p.children].filter(c => c !== foot).map(c => c.getBoundingClientRect().bottom))); });
  console.log(`room above the footer: ${room}px`); }
await pg.pdf({ path: OUT, format: 'A4', printBackground: true, preferCSSPageSize: true });
await b.close();
console.log(`wrote links-26-what-it-means.pdf — ${GROUPS.length} groups, ${GROUPS.reduce((n, g) => n + g.rows.length, 0)} rows; Sundays £${sundayLoss} less, no overtime £${lo(noOt)}–£${hi(noOt)} more, swaps £${TC.swapPounds} today against ${C.map(c => `£${c.swapPounds}`).join(' / ')}`);
