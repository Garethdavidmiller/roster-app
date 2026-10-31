// THE SHORTLIST SHEET (3 Oct 2026, owner: "a two page analysis sheet comparing the three — snappy but evidence led,
// choose one if you like one, compare to the existing roster too"). Two A4 pages: the shortlisted designs against each
// other and against today's link. EVERY FIGURE IS COMPUTED HERE from the grids and today's roster by the same functions
// the proposal sheets use (report-data.mjs assess, plain.mjs personal, leave.mjs, links-adjacency.js scoreOrder), and the
// league's spread from league.mjs itself; nothing is typed in. The prose is the owner's and this session's judgement and
// says so.
// FOUR SINCE 30 OCT 2026 (owner: "Can we add closing time to the shortlist?"). Closing Time broke two sentences that had
// been true of three — all three flexible rules, every closer 30 to 45 minutes shorter — and both had been read off
// Second Edition alone, so they would have gone on printing for all four. Every sentence that says what the designs
// SHARE, or what one of them alone has, is now ASSERTED (`shared`, `claim`): a design that stops fitting its sentence
// stops the sheet, rather than printing a claim that is no longer true. The recommendation stays Short Run (the owner
// shortlisted Closing Time; they did not move the recommendation) and says why, against Closing Time too. That "every" was
// not yet true: an outside review the same day found two dozen comparing sentences still unasserted, a typed "two" and
// "seventh", and a page-1 sentence calling leave the one shared cost against page 2's four. All are fixed below
// ("THE REST OF THE SENTENCES"); a number in the prose is read, never typed.
// TWO SINCE 30 OCT 2026 (owner: "Only do the shortlist for instep and short run"), and In Step recommended (owner: "I need
// you to have a deep think from all angles about which to recommend"; README.md → "The shortlist cut to two"). The four
// cards, the guide and the recommendation were rewritten for two: what both share, the rows where they differ (and three
// the sheets had lacked — long earlies, long shifts, early finishes — which is where Short Run's case lies), each one's
// edge, the guide naming the leading design outside the shortlist for each other priority, and the recommendation with
// the league's verdict both ways. The prose names In Step and Short Run, so any other shortlist stops the sheet.
// THREE SINCE 31 OCT 2026 (owner: "Do your suggestions", after Even Step was found; asked whether Short Run should stay, "Yes,
// keep all three"). Even Step — In Step's weeks with no duty over 8h 30m from Monday to Saturday — is recommended, In Step
// and Short Run beside it. Three lines that had been true of both stopped being shared — the week-to-week step, the shift
// times and new times, and the long days as a shared cost — and moved to "where they differ"; the long-day rows now count
// Monday to Saturday, because the one long duty all three share is the same Sunday early; the recommendation places Even
// Step on every row it is compared on (best, between or last); the league's long-day weight is computed for Even Step
// against In Step. The prose names the three, so any other shortlist stops the sheet.
//   node shortlist-sheet.mjs        → ../links-26-shortlist.pdf (the .html stays in tooling/, gitignored)
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { LINES, DAYS_CEILING } from './link.mjs';
import { assess, today, folderStats, sheetRules, flexibleRules, h55Worst } from './report-data.mjs';
import { personal } from './plain.mjs';
import { leave } from './leave.mjs';
import { scoreOrder } from '../../../links-adjacency.js';
import { SHORTLIST, RECOMMENDED } from './fresh.mjs';
import { kindBlocks, blockText } from './blocks.mjs';

const ROOT = new URL('../../../', import.meta.url).href.replace(/\/$/, '');
const OUT = new URL('../links-26-shortlist.pdf', import.meta.url).pathname;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], MS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const timed = s => /^\d\d:\d\d-\d\d:\d\d$/.test(s), m = s => +s.slice(0, 2) * 60 + +s.slice(3, 5), mins = s => (m(s.slice(6)) - m(s) + 1440) % 1440;
const hm = x => `${Math.floor(x / 60)}h\u00a0${String(Math.round(x % 60)).padStart(2, '0')}m`;   // no-break space: a figure never splits across a line
// a difference, said the way a person says it — and only ever a positive one: a sign that flipped would print "-30 minutes"
// under a sentence that says "shorter" (30 Oct 2026 review), so a difference of nothing or less stops the sheet
const dur = x => { if (!(x > 0)) throw new Error(`a difference printed as a length must be more than nothing, not ${x}`);
  const r = Math.round(x); return x < 60 ? `${r}\u00a0${r === 1 ? 'minute' : 'minutes'}` : x === 60 ? 'an hour' : hm(x); };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const WORD = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen'.split(' ');
const word = n => WORD[n] ?? `${n}`, Word = n => word(n)[0].toUpperCase() + word(n).slice(1);
const ORD = 'zeroth first second third fourth fifth sixth seventh eighth ninth tenth'.split(' '), ord = n => ORD[n] ?? `${n}th`;
const many = (n, one, more = `${one}s`) => (n === 1 ? one : more);
// plain.mjs's "7h55" — or a range ("7h55–8h55") when a day type's closers differ. The sheet prints and compares ONE closer a
// day type, so a range is refused rather than read as its first figure: a longer second closer would have passed "every
// closing shift shorter" unseen (30 Oct 2026 review). No design has one; the day one does, this needs a decision.
const span = s => { const all = [...String(s).matchAll(/(\d+)h(\d\d)/g)];
  if (all.length !== 1) throw new Error(`a closer span of "${s}": the sheet compares one closer a day type`); return +all[0][1] * 60 + +all[0][2]; };
// the start times of the duties that work to the close, Monday to Saturday
const closerStarts = p => [...new Set(Object.values(p).flatMap(r => MS.filter(d => timed(r[d]) && r[d].slice(6) === '23:55').map(d => r[d].slice(0, 5))))].sort();

function figures(p, L, TA) {
  const A = assess(p, L), pp = personal(p), lv = leave(p), keys = Object.keys(p);
  const work = keys.filter(k => p[k].mon !== 'SPARE');
  const wk = work.map(k => MS.reduce((s, d) => s + (timed(p[k][d]) ? mins(p[k][d]) : 0), 0));
  const gaps = []; { const at = []; for (let k = 1; k <= L; k++) if (!timed(p[k].sat) && p[k].sat !== 'SPARE' && !timed(p[k % L + 1].sun) && p[k % L + 1].sun !== 'SPARE') at.push(k);
    for (let i = 0; i < at.length; i++) gaps.push(((at[(i + 1) % at.length] - at[i]) + L) % L || L); }
  const todays = new Set((TA ?? A).tableRows.map(r => r.time)), shared = A.tableRows.filter(r => todays.has(r.time)).length;
  const R = sheetRules({ patterns: p, ...A }, TA ?? A, TA ? 'plan' : 'today');
  const flex = flexibleRules({ patterns: p, ...A }, TA ?? A, TA ? 'plan' : 'today');
  const f22 = Object.values(p).reduce((n, r) => n + DAYS.filter(d => timed(r[d]) && m(r[d].slice(6)) >= 22 * 60).length, 0);   // deck-check.mjs's count
  return { p, A, pp, lv, met: R.met, flex: flex.met, flexMissed: flex.rows.filter(r => !r.ok).map(r => r.key),
    heavy: Math.max(...wk), light: Math.min(...wk), heavyWeeks: wk.filter(x => x === Math.max(...wk)).length, maxGap: Math.max(...gaps), gaps,
    satDuties: Object.values(p).filter(r => timed(r.sat)).length,
    step: scoreOrder(p, keys, { maxRunTarget: 6 }).gentleMean, times: A.feel.distinctTimes, shared,
    newT: A.feel.distinctTimes - shared, fixedRun: A.fixed.run, worstRun: A.checks.longestStretch, of: R.of,
    fit: [A.office.wkFit, A.office.fits.sat, A.office.fits.sun], block: kindBlocks(p),
    closers: ['wk', 'sat', 'sun'].map(k => span(pp.closerSpan[k])), late22: Math.round(f22 * 52 / L), late23: Math.round(pp.late23) };
}
const T0 = today(), TA = assess(T0.patterns, 20), TF = figures(T0.patterns, 20, null);
const stats = folderStats();
const design = name => { const f = stats.find(s => s.name === name); if (!f) throw new Error(`no proposal called ${name}`);
  const j = JSON.parse(readFileSync(new URL(`../proposals/${f.file}`, import.meta.url), 'utf8')); const pdf = readdirSync(new URL('../proposals/', import.meta.url)).find(x => x.includes(`-${f.code}-`) && x.endsWith('.pdf')); const fp = pdf ? pdf.slice(-12, -4) : '';
  return { name, code: f.code, fp, F: figures(j.patterns ?? j, LINES, TA) }; };
const D = SHORTLIST.map(design);
const by = name => D.find(d => d.name === name) ?? (() => { throw new Error(`the shortlist has no ${name}: the cards and the recommendation name it`); })();
const ES = by('Even Step'), IS = by('In Step'), SR = by('Short Run');
const N = word(D.length), others = stats.filter(s => !SHORTLIST.includes(s.name)).map(s => design(s.name));
// THREE SINCE 31 OCT 2026: the prose below is written for Even Step (recommended), In Step and Short Run, and says so
if (D.length !== 3 || RECOMMENDED !== 'Even Step' || SHORTLIST.join() !== 'Even Step,In Step,Short Run') throw new Error(`the sheet's prose is written for Even Step (recommended), In Step and Short Run; the shortlist is ${SHORTLIST}, recommending ${RECOMMENDED}`);
const both = 'all three', Both = 'All three';

/** A figure the prose says every shortlisted design shares — refused unless it is. */
const shared = (what, get) => { const v = D.map(d => get(d.F)); if (!v.every(x => x === v[0])) throw new Error(`"${what}" is printed as shared but is not: ${D.map((d, i) => `${d.name} ${v[i]}`).join(', ')}`); return v[0]; };
/** A sentence the prose rests on — refused unless it holds. */
const claim = (what, ok) => { if (!ok) throw new Error(`the sheet says "${what}", and the figures no longer do`); };
const lowest = get => Math.min(...D.map(d => get(d.F))), highest = get => Math.max(...D.map(d => get(d.F)));

// WHAT THE SHEETS' MEASURES DO NOT SHOW, per person per year from the grid (30 Oct 2026, the review of In Step's decks):
// the long days. In Step's longer earlies were its one cost against Short Run, and Even Step exists to remove them
const perYear = (p, test) => Object.values(p).reduce((n, r) => n + DAYS.filter(d => timed(r[d]) && test(r[d], d)).length, 0) * 52 / Object.keys(p).length;
const isEarly = s => m(s) < 11 * 60;
const longEarly = F => Math.round(perYear(F.p, s => isEarly(s) && mins(s) > 510));
const longShift = F => Math.round(perYear(F.p, s => mins(s) > 510));
// MONDAY TO SATURDAY (31 Oct 2026): all three share one long Sunday duty, the 9-hour 09:00–18:00, so the rows that tell
// them apart count the contracted days; the Sunday early is said once, as shared
const longEarlyMS = F => Math.round(perYear(F.p, (s, d) => d !== 'sun' && isEarly(s) && mins(s) > 510));
const longMS = F => Math.round(perYear(F.p, (s, d) => d !== 'sun' && mins(s) > 510));
const longestMS = F => Math.max(...Object.values(F.p).flatMap(r => MS.map(d => r[d])).filter(timed).map(mins));
const earlyOff = F => Math.round(perYear(F.p, s => isEarly(s) && m(s.slice(6)) < 14 * 60));   // an early finishing before 14:00
const todaysTimes = new Set(Object.values(T0.patterns).flatMap(r => DAYS.map(d => r[d]).filter(timed)));
const satNew = F => new Set(Object.values(F.p).map(r => r.sat).filter(s => timed(s) && !todaysTimes.has(s))).size;
const fit7 = F => (5 * F.fit[0] + F.fit[1] + F.fit[2]) / 7;   // each day of a week counted once
const longLengths = F => [...new Set(Object.values(F.p).flatMap(r => MS.map(d => r[d])).filter(s => timed(s) && isEarly(s) && mins(s) > 510).map(mins))].sort((a, b) => a - b);
const todayLongestEarly = Math.max(...Object.values(T0.patterns).flatMap(r => DAYS.map(d => r[d])).filter(s => timed(s) && isEarly(s)).map(mins));
const newTimes = F => new Set(Object.values(F.p).flatMap(r => DAYS.map(d => r[d])).filter(s => timed(s) && !todaysTimes.has(s)));
// a new late that shortens one of today's: same start or same end as a time worked today, and shorter than it
const shorterLates = F => [...newTimes(F)].filter(t => !isEarly(t) && [...todaysTimes].some(u => (u.slice(0, 5) === t.slice(0, 5) || u.slice(6) === t.slice(6)) && mins(u) > mins(t))).length;
const longerEarlies = F => [...newTimes(F)].filter(t => isEarly(t) && mins(t) > todayLongestEarly && Object.values(F.p).some(r => MS.slice(0, 5).some(d => r[d] === t))).length;   // new weekday earlies longer than any today
const k1345 = F => MS.slice(0, 5).every(d => Object.values(F.p).some(r => r[d] === '06:20-13:45'));
// every early Monday to Saturday a time worked today; the weekday lates before the closer, by length
const earliesToday = F => Object.values(F.p).every(r => MS.every(d => !timed(r[d]) || !isEarly(r[d]) || todaysTimes.has(r[d])));
// THE WEEKDAY LATES ON AVERAGE (31 Oct 2026 review): the shortest late alone made In Step look the short-lates design
// ("lates from 8h 00m") while Short Run's 7h 30m and 8h 00m average are shorter; every Mon–Fri late but the closers,
// weighted by how many work it, is the figure the cards and the guide now quote
// THE LENGTH OF EVERY REST-DAY BREAK (31 Oct 2026 review): "pairs or longer" read as though the designs kept today's
// three- and four-day breaks; they have none, so the shared line says "every other break is two days" and this proves it
const restLens = p => { const seq = Object.keys(p).sort((a, b) => a - b).flatMap(k => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map(d => p[k][d])), n = seq.length, out = [];
  for (let i = 0; i < n; i++) if (seq[i] === 'RD' && seq[(i + n - 1) % n] !== 'RD') { let L = 0; while (L < n && seq[(i + L) % n] === 'RD') L++; out.push(L); } return out; };
const longRest = F => restLens(F.p).filter(n => n > 2).length;
const lateAvg = F => { const l = Object.values(F.p).flatMap(r => MS.slice(0, 5).map(d => r[d])).filter(s => timed(s) && !isEarly(s) && s.slice(6) !== '23:55').map(mins); return Math.round(l.reduce((a, b) => a + b, 0) / l.length); };
const wkLates = F => [...new Set(Object.values(F.p).flatMap(r => MS.slice(0, 5).map(d => r[d])).filter(s => timed(s) && !isEarly(s) && s.slice(6) !== '23:55').map(mins))].sort((a, b) => a - b);

// what the three share, each one asserted before it is printed
const met = shared('December rules met', F => F.met), wkOff = shared('full weekends off', F => F.A.checks.weekendsOff), gap = shared('longest wait between weekends', F => F.maxGap);
const days = shared('days a year', F => F.pp.daysYear.toFixed(1)), longest = shared('longest shift', F => F.pp.longest);
const iso = shared('single rest days', F => F.A.feel.isolatedRest), paired = shared('rest-day breaks', F => `${F.A.feel.pairedRest} of ${F.A.feel.restIslands}`);
// the worst case counts the 55-hour week a cover week can make, as every other sheet's "up to" does (h55Worst): the app's own
// 55-hour row counts a cover week as no hours, so A.fatigue.present alone said "no warning" beside the summary's "up to 1"
// once a cover week's Sunday became overtime on top of its four (31 Oct 2026)
const h55Of = F => h55Worst(F.p, LINES), ffWorst = F => F.A.fatigue.present + (h55Of(F)?.adds ? 1 : 0);
shared('fatigue warnings, fixed', F => F.A.fixed.present); const ffW = shared('fatigue warnings, worst case', ffWorst);
const run = shared('most days in a row, fixed rota', F => F.fixedRun), worstRun = shared('worst-case run', F => F.worstRun);
const one = shared('weeks on one turn', F => F.A.feel.oneTurn), wl = shared('working weeks', F => F.A.feel.workingLines);
const mixed = shared('weeks mixing earlies and lates', F => F.A.feel.hybrid);
const late23 = shared('finishes at 23:00 or later', F => F.late23), late22 = shared('finishes at 22:00 or later', F => F.late22);
const sunCloser = shared('Sunday closer', F => F.closers[2]), wkCloser = shared('weekday closer', F => F.closers[0]), sunFit = shared('Sunday fit', F => F.fit[2].toFixed(1));
// THE SAME SUNDAY (31 Oct 2026): it was the step that page 1 printed as shared beside it, and Even Step's step is its own
const sunDuties = shared('the Sunday’s duties', F => Object.values(F.p).map(r => r.sun).filter(timed).sort().join());
claim('the weekday’s and Sunday’s closers one length', wkCloser === sunCloser);
claim('no avoidable fatigue warning on the fixed rota; at worst one, and it is the 55-hour week',
  D.every(d => d.F.A.fixed.present === 0 && d.F.A.fatigue.present === 0 && h55Of(d.F)?.adds) && ffW === 1);
claim('all three flexible rules', D.every(d => d.F.flex === 3));
const cuts = D.flatMap(d => d.F.closers.map((c, i) => TF.closers[i] - c)); claim('every closing shift shorter', Math.min(...cuts) > 0);
claim('no week mixing earlies and lates, where today has some', mixed === 0 && TF.A.feel.hybrid > 0);
// seven since 31 Oct 2026, when a cover week's Sunday became overtime on top of its four (spareDrawsOnFour, links-design.js)
claim('five days in a row at most on the fixed rota, seven with a cover week placed badly; today more of both', run === 5 && worstRun === 7 && TF.fixedRun > run && TF.worstRun > worstRun);
claim('ten duties on the Sunday, one of them the 9-hour 09:00–18:00', sunDuties.split(',').length === 10 && sunDuties.split(',').filter(t => t === '09:00-18:00').length === 1 && mins('09:00-18:00') === 540 && longest === 540);

// the others: what each keeps that none of the three has, and what it pays — asserted, measure by measure
// THE MEASURES EVERY "KEEPS" AND "PAYS" IS READ ON: every row of page 1's table, weekends included, and the fit and the
// closers day by day as the table reads them (30 Oct 2026, the accuracy check). The long-day, early-finish and Saturday rows
// had been added to the table and not here, so the paragraph said Even Keel and Second Gear kept "nothing the two lack" while
// the table showed them with fewer long days than either. Since Even Step joined (31 Oct 2026) that sentence is TRUE of
// them, computed: none of their edges survives a shortlisted design with no long day from Monday to Saturday.
const DIR = { fixedRun: -1, worstRun: -1, wkOff: 1, gap: -1, heavy: -1, light: 1, rest: 1, one: 1, mixed: -1, block: -1, step: -1, late23: -1, late22: -1, newT: -1, times: -1,
  fitWk: -1, fitSat: -1, fitSun: -1, closerWk: -1, closerSat: -1, closerSun: -1, lvBest: 1, lvWorst: 1, lvFour: -1, iso: -1, longEarly: -1, longShift: -1, earlyOff: 1, satNew: -1 };
const fitP = x => Math.round(x * 10) / 10;   // the fit as the sheet prints it
const measure = F => ({ fixedRun: F.fixedRun, worstRun: F.worstRun, wkOff: F.A.checks.weekendsOff, gap: F.maxGap, heavy: F.heavy, light: F.light, rest: F.A.rest.minutes,
  one: F.A.feel.oneTurn, mixed: F.A.feel.hybrid, block: F.block.worst, step: Math.round(F.step), late23: F.late23, late22: F.late22, newT: F.newT, times: F.times,
  fitWk: fitP(F.fit[0]), fitSat: fitP(F.fit[1]), fitSun: fitP(F.fit[2]), closerWk: F.closers[0], closerSat: F.closers[1], closerSun: F.closers[2],
  lvBest: F.lv.best, lvWorst: F.lv.worst, lvFour: F.lv.fourWeeks, iso: F.A.feel.isolatedRest, longEarly: longEarly(F), longShift: longShift(F), earlyOff: earlyOff(F), satNew: satNew(F) });
const keeps = d => { const x = measure(d.F); return Object.keys(DIR).filter(k => D.every(s => DIR[k] * (x[k] - measure(s.F)[k]) > 0)).sort(); };
const loses = d => { const x = measure(d.F); return Object.keys(DIR).filter(k => D.every(s => DIR[k] * (x[k] - measure(s.F)[k]) < 0)); };
const O = Object.fromEntries(others.map(d => [d.name, d])), K = Object.fromEntries(others.map(d => [d.name, keeps(d).join()]));
const NAMED = { 'Both Ways': 'closerSat,closerWk,earlyOff,heavy,newT', 'Closing Time': 'closerSat,closerWk,fitSat,light,step',
  'Even Keel': '', 'Fine Tune': 'step', 'Home Grown': 'closerWk,longEarly,newT,times', 'Long Break': 'lvBest,lvFour',
  'Second Edition': 'step', 'Second Gear': '', 'Second Look': 'block,worstRun', 'Second Nature': 'block', 'Second Sight': 'block', 'Second Wind': 'block' };
claim('the paragraph names every other design, and what it keeps', Object.keys(NAMED).sort().join() === Object.keys(O).sort().join() && Object.entries(NAMED).every(([n, k]) => K[n] === k));
const pays = (n, ...ks) => claim(`${n} pays with ${ks.join(', ')}`, ks.every(k => loses(O[n]).includes(k)));
// what each pays, on the five priorities the paragraph names wherever it pays on them (days in a row, weekends, one turn,
// late finishes, the closing shift), and its main other cost
pays('Closing Time', 'fitWk', 'one', 'late22'); pays('Both Ways', 'one', 'longShift', 'fitSat', 'fitSun'); pays('Home Grown', 'closerSat', 'one', 'fitWk', 'fitSat', 'fitSun');
const ekfg = ['Even Keel', 'Fine Tune', 'Second Gear']; ekfg.forEach(n => pays(n, 'late23', 'mixed', 'block', 'fitSat')); pays('Fine Tune', 'one'); pays('Second Gear', 'one');
pays('Second Edition', 'fixedRun'); pays('Long Break', 'fixedRun', 'iso', 'one', 'step');
const LB = O['Long Break'].F, sec = ['Second Look', 'Second Nature', 'Second Sight', 'Second Wind'];
sec.forEach(n => pays(n, 'fixedRun', 'one')); pays('Second Sight', 'step'); pays('Second Wind', 'step'); pays('Second Nature', 'gap');
const PACK = [...D, ...others], CT = O['Closing Time'].F, HG = O['Home Grown'].F;
claim('Closing Time: the best Saturday fit of all', PACK.every(d => d.name === 'Closing Time' || d.F.fit[1] > CT.fit[1]));
claim('Home Grown: the only design with no early over 8h 30m on any day', PACK.every(d => d.name === 'Home Grown' || longEarly(d.F) > 0) && longEarly(HG) === 0);
claim('Home Grown: today’s Saturday closer', HG.closers[1] === TF.closers[1]);
claim('Even Keel, Fine Tune and Second Gear: four to the Saturday close, where the three have three', ekfg.every(n => O[n].F.A.heads.close.sat === 4) && D.every(d => d.F.A.heads.close.sat === 3));
claim('the four Second designs: blocks a week shorter', sec.every(n => O[n].F.block.worst === lowest(F => F.block.worst) - 1));
claim('Closing Time: more even weeks', (O['Closing Time'].F.heavy - O['Closing Time'].F.light) < lowest(F => F.heavy - F.light));
claim('Home Grown: the fewest new times of all', others.every(d => d.name === 'Home Grown' || d.F.newT > O['Home Grown'].F.newT) && O['Home Grown'].F.newT < lowest(F => F.newT));
claim('Long Break: a fifth single rest day', LB.A.feel.isolatedRest === iso + 1);
claim('Second Edition the gentlest step of all, Fine Tune and Closing Time gentler than the three', PACK.every(d => d.name === 'Second Edition' || d.F.step > O['Second Edition'].F.step)
  && ['Fine Tune', 'Closing Time'].every(n => Math.round(O[n].F.step) < lowest(F => Math.round(F.step))));

// page 1, the three cards and the guide
const EF = ES.F, IF = IS.F, SF = SR.F, range = F => F.heavy - F.light;
claim('Even Step: no shift over 8h 30m Monday to Saturday — the only one of the three, and the only design here', longestMS(EF) === 510 && longMS(EF) === 0
  && PACK.every(d => d.name === 'Even Step' || longMS(d.F) > 0));
claim('Even Step: the fewest long days of all, its one long duty the Sunday 9-hour early', PACK.every(d => d.name === 'Even Step' || longShift(d.F) > longShift(EF)) && longShift(EF) === longEarly(EF) && longEarly(EF) === Math.round(52 / LINES));
claim('Even Step: every early Monday to Saturday one of today’s times; neither of the others', earliesToday(EF) && !earliesToday(IF) && !earliesToday(SF));
claim('Even Step: In Step’s closers, today’s 13:45 every weekday', EF.closers.join() === IF.closers.join() && k1345(EF) && k1345(IF));
claim('Even Step: the fewest shift times of the three, and the fewest new', EF.times < IF.times && EF.times < SF.times && EF.newT < IF.newT && EF.newT < SF.newT);
claim('Even Step: weekday lates of 8h 15m and 8h 30m, close to today’s 8h 30m, and the longest of the three on average', wkLates(EF).join() === '495,510' && wkLates(TF).join() === '510'
  && lateAvg(TF) === 510 && D.every(d => d === ES || lateAvg(d.F) < lateAvg(EF)));
claim('Even Step: the weakest weekday fit of the three and the biggest step', D.every(d => d === ES || d.F.fit[0] < EF.fit[0]) && D.every(d => d === ES || d.F.step < EF.step));
claim('Even Step: In Step’s lightest week and rest; its heaviest week and Saturday fit between the other two', EF.light === IF.light && EF.A.rest.minutes === IF.A.rest.minutes
  && IF.heavy < EF.heavy && EF.heavy < SF.heavy && IF.fit[1] < EF.fit[1] && EF.fit[1] < SF.fit[1]);
claim('In Step: the steadiest weekly hours (the narrowest range, from the lightest heaviest week) of the three', D.every(d => d === IS || (range(d.F) > range(IF) && d.F.heavy > IF.heavy)));
claim('In Step: the best Saturday fit of the three — not of all fifteen, so the card says which', D.every(d => d === IS || d.F.fit[1] > IF.fit[1]) && PACK.some(d => d.F.fit[1] < IF.fit[1]));
claim('Even Step: the fewest shift times of the three — not of all fifteen, so the card and the recommendation say which', D.every(d => d === ES || d.F.times > EF.times) && PACK.some(d => d.F.times < EF.times));
claim('every other rest-day break two days on all three; today has longer ones', D.every(d => restLens(d.F.p).every(n => n <= 2)) && longRest(TF) > 0);
claim('In Step: the lightest heaviest week, the best Saturday fit, the most early finishes before 14:00 of the three', D.every(d => d === IS || d.F.heavy > IF.heavy) && D.every(d => d === IS || d.F.fit[1] > IF.fit[1])
  && D.every(d => d === IS || earlyOff(d.F) < earlyOff(IF)));
claim('In Step: on Even Step’s weeks, shorter lates for longer earlies', lateAvg(IF) < lateAvg(EF) && longEarlyMS(IF) > longEarlyMS(EF));
claim('In Step: the most long earlies of any design here, Monday to Saturday, at 8h 45m and 8h 55m', PACK.every(d => d.name === 'In Step' || longEarlyMS(d.F) < longEarlyMS(IF)) && longLengths(IF).join() === '525,535');
claim('Short Run: the closest weekday fit of the three, the shortest lates on average, and nothing new on a Saturday', D.every(d => d === SR || d.F.fit[0] > SF.fit[0])
  && D.every(d => d === SR || lateAvg(d.F) > lateAvg(SF)) && satNew(SF) === 0 && satNew(EF) === 1 && satNew(IF) === 1);
claim('Short Run: an 8h 40m Saturday closer, the heaviest week and the shortest rest of the three, no early finish before 14:00, its long earlies all 9h 00m',
  SF.closers[1] > EF.closers[1] && SF.closers[1] > IF.closers[1] && D.every(d => d === SR || (d.F.heavy < SF.heavy && d.F.A.rest.minutes > SF.A.rest.minutes)) && earlyOff(SF) === 0 && longLengths(SF).join() === '540');
claim('Even Step’s and In Step’s one new Saturday time is the 15:45 closer', [EF, IF].every(F => satNew(F) === 1 && Object.values(F.p).some(r => r.sat === '15:45-23:55')) && !todaysTimes.has('15:45-23:55'));
claim('the step: In Step and Short Run alike, Even Step’s bigger', Math.round(IF.step) === Math.round(SF.step) && EF.step > IF.step);

// the league: its spread, and what it would say if it counted long earlies — computed over the range league.mjs itself
// uses (REF_IN_RANGE: the proposals, today's link and Familiar Nine), never typed
const tmp = mkdtempSync(`${tmpdir()}/league-`);
execFileSync('node', [new URL('./league.mjs', import.meta.url).pathname], { env: { ...process.env, REF_IN_RANGE: '1', JSON: `${tmp}/league.json` }, stdio: 'ignore' });
const LJ = JSON.parse(readFileSync(`${tmp}/league.json`, 'utf8')); rmSync(tmp, { recursive: true });
const LGall = LJ.proposals, LG = LGall.filter(r => SHORTLIST.includes(r.name)), total = name => LGall.find(r => r.name === name).total;
claim('the league scores all three shortlisted designs', LG.length === D.length);
const lead = total('In Step') - total('Even Step');
const rankOf = name => [...LGall].sort((a, b) => b.total - a.total).findIndex(r => r.name === name) + 1;
claim('the league: In Step first, Even Step second, Short Run fifth, and neither the closing shift nor long days among its factors', rankOf('In Step') === 1 && rankOf('Even Step') === 2 && rankOf('Short Run') === 5
  && LGall.length === stats.length && !Object.keys(LJ.weights).some(k => /clos|early|long/i.test(k)));
claim('Even Step second in the league, under a point behind In Step', lead > 0 && lead < 1);
const F9 = JSON.parse(readFileSync(new URL('../../links-24/proposals/Familiar-Nine-F9-24-K31s.json', import.meta.url), 'utf8')), F9p = F9.patterns ?? F9;
const le = p => perYear(p, s => isEarly(s) && mins(s) > 510), leAll = [...stats.map(s => le(design(s.name).F.p)), le(T0.patterns), le(F9p)];
const leLo = Math.min(...leAll), leHi = Math.max(...leAll), leScore = p => 1 - (le(p) - leLo) / (leHi - leLo);
// THE WEIGHT AT WHICH EVEN STEP DRAWS LEVEL (31 Oct 2026). A factor of weight w joins the league by rescaling every weight
// by 100 / (100 + w), the same for every design, so the order turns where w × (the long-earlies score between them) makes
// up the lead: w* = lead ÷ (score difference). The league's lightest factor is each leave figure, at 1.
const wStar = lead / (leScore(ES.F.p) - leScore(IS.F.p)), lightest = Math.min(...Object.values(LJ.weights));
const withLong = (name, w) => (100 * total(name) + 100 * w * leScore(design(name).F.p)) / (100 + w);
claim('counted even as lightly as the league’s lightest factor, long earlies put Even Step first of all', wStar < lightest && lightest === 1
  && stats.every(s => s.name === 'Even Step' || withLong(s.name, lightest) < withLong('Even Step', lightest)));
claim('In Step has the most long earlies of any design here', stats.every(s => s.name === 'In Step' || longEarly(design(s.name).F) < longEarly(IF)));
// the guide's rows for designs outside the shortlist: each the strongest in the league of those that have its edge
const allD = stats.map(s => design(s.name)), strongest = (test) => { const has = allD.filter(d => test(d.F)); return has.sort((a, b) => total(b.name) - total(a.name)).map(d => d.name); };
const minClose = Math.min(...allD.map(d => d.F.closers[0] + d.F.closers[1]));
const shortClosers = strongest(F => F.closers[0] + F.closers[1] === minClose), fourth = strongest(F => F.A.heads.close.sat === 4);
claim('the shortest closers: Closing Time, then Both Ways', shortClosers.join() === 'Closing Time,Both Ways');
claim('a fourth to the Saturday close: Even Keel, then Fine Tune and Second Gear', fourth.join() === 'Even Keel,Fine Tune,Second Gear');
claim('the steadiest start times: Second Edition', allD.every(d => d.name === 'Second Edition' || d.F.step > O['Second Edition'].F.step));
claim('four weeks off for today’s 14 days: Long Break alone', allD.filter(d => d.F.lv.fourWeeks <= TF.lv.fourWeeks).map(d => d.name).join() === 'Long Break' && TF.lv.fourWeeks === 14);
claim('the fewest new shift times: Home Grown, two', allD.every(d => d.name === 'Home Grown' || d.F.newT > HG.newT) && HG.newT === 2);

// page 2, the honest costs all three share
claim('three or more to the close every day, where today has two Monday to Saturday', D.every(d => Object.values(d.F.A.heads.close).every(x => x >= 3)) && MS.every(dd => TF.A.heads.close[dd] === 2));
claim('no design here meeting all 9 rules has fewer finishes at 23:00 or later', allD.filter(d => d.F.met === 9).every(d => d.F.late23 >= late23));
claim('the worst leave stretch a day better than today’s', shared('worst leave stretch', F => F.lv.worst) === TF.lv.worst + 1);
claim('worse than today: late finishes, leave, Saturdays, new times', late23 > TF.late23 && late22 > TF.late22 && shared('leave for four weeks', F => F.lv.fourWeeks) > TF.lv.fourWeeks
  && shared('best leave stretch', F => F.lv.best) < TF.lv.best && shared('Saturdays a year', F => Math.round(F.pp.sat)) > Math.round(TF.pp.sat) && D.every(d => d.F.newT > TF.newT));
claim('the new times: shorter versions of today’s lates, a new late on Even Step, longer weekday earlies on the other two', shorterLates(EF) === 3 && shorterLates(IF) === 3 && shorterLates(SF) === 4
  && longerEarlies(EF) === 0 && longerEarlies(IF) === 2 && longerEarlies(SF) === 1 && newTimes(EF).has('12:15-20:30') && newTimes(EF).size === EF.newT && newTimes(IF).size === IF.newT && newTimes(SF).size === SF.newT);
claim('the same shift times on In Step and Short Run in all, and new', IF.times === SF.times && IF.newT === SF.newT);
claim('all three: fewer early finishes before 14:00 than today', D.every(d => earlyOff(d.F) < earlyOff(TF)));

// the comparison rows: only where the three differ (what they share is listed above them), and the measures the sheets
// otherwise lack. label, how to read each design, which direction is better (1 higher, -1 lower), format
const ROWS = [
  ['Heaviest week, Mon–Sat', F => F.heavy, -1, hm],
  ['Lightest week, Mon–Sat', F => F.light, 1, hm],
  ['Shortest rest, fixed duties', F => F.A.rest.minutes, 1, hm],
  ['Closing shift, Saturday', F => F.closers[1], -1, hm],
  ['Earlies over 8h 30m, Mon–Sat, each a year', longEarlyMS, -1, v => `${v}`],
  ['Any shift over 8h 30m, Mon–Sat, each a year', longMS, -1, v => `${v}`],
  ['Earlies finishing before 14:00, each a year', earlyOff, 1, v => `${v}`],
  ['Weekday lates, closers aside, on average', lateAvg, -1, hm],
  ['Week-to-week change of start', F => Math.round(F.step), -1, hm],
  ['Shift times, and how many are new', F => F.times, -1, (v, F) => `${F.times} (${F.newT} new)`],
  ['New shift times on a Saturday', satNew, -1, v => `${v}`],
  [`Fit to the trains, weekday · Sat (0 = exact; Sunday ${sunFit} on ${both}, today ${TF.fit[2].toFixed(1)})`, F => F.fit[0] + F.fit[1], -1, (v, F) => F.fit.slice(0, 2).map(x => x.toFixed(1)).join(' · '), 'fit', F => F.fit.slice(0, 2)],
];
claim('every “where they differ” row differs', ROWS.every(([, get]) => new Set(D.map(d => get(d.F))).size > 1));
const isoYear = F => Math.round(F.A.feel.isolatedRest * 52 / Object.keys(F.p).length);   // single rest days a year each
claim('the same single rest days as today in the rotation, fewer a year', iso === TF.A.feel.isolatedRest && D.every(d => isoYear(d.F) < isoYear(TF)));
const satTimes = F => [...new Set(Object.values(F.p).map(r => r.sat).filter(timed))], todaysSat = new Set(Object.values(T0.patterns).map(r => r.sat).filter(timed));
claim('Short Run: every Saturday time worked today, some on a Saturday and some only on other days', satTimes(SF).every(t => todaysTimes.has(t))
  && satTimes(SF).filter(t => todaysSat.has(t)).length > 0 && satTimes(SF).some(t => !todaysSat.has(t)));
claim('all three add a 9-hour Sunday early, 09:00–18:00, new to the link', D.every(d => newTimes(d.F).has('09:00-18:00') && Object.values(d.F.p).some(r => r.sun === '09:00-18:00')
  && !Object.values(d.F.p).some(r => MS.some(dd => r[dd] === '09:00-18:00'))) && mins('09:00-18:00') === 540);
claim('long days, against today: no early over 8h 30m today; In Step and Short Run have them Monday to Saturday, Even Step none', longEarlyMS(TF) === 0 && longEarlyMS(EF) === 0 && longEarlyMS(IF) > 0 && longEarlyMS(SF) > 0
  && longMS(TF) > longMS(SF) && longMS(IF) > longMS(TF));
// THE RECOMMENDATION GIVES EVERY FIGURE WHERE THEY DIFFER, IN ITS PLACE (30 Oct 2026, the accuracy check; three since 31 Oct).
// Each row (each figure of the fit row) is read as the paragraph reads it: where Even Step stands among the three — the best
// (or level best), between the other two, or the last (or level last). The paragraph below names each one so.
const PLACE = { 'Heaviest week, Mon–Sat': 'between', 'Lightest week, Mon–Sat': 'best', 'Shortest rest, fixed duties': 'best', 'Closing shift, Saturday': 'best',
  'Earlies over 8h 30m, Mon–Sat, each a year': 'best', 'Any shift over 8h 30m, Mon–Sat, each a year': 'best', 'Earlies finishing before 14:00, each a year': 'between',
  'Weekday lates, closers aside, on average': 'last',
  'Week-to-week change of start': 'last', 'Shift times, and how many are new': 'best', 'New shift times on a Saturday': 'last',
  'Fit to the trains, weekday': 'last', 'Fit to the trains, Saturday': 'between' };
const placeOf = (vals, dir) => { const me = vals[0], rest = vals.slice(1); const better = rest.filter(v => dir * (v - me) > 0).length, worse = rest.filter(v => dir * (v - me) < 0).length;
  return better === 0 ? 'best' : worse === 0 ? 'last' : 'between'; };
const places = Object.fromEntries(ROWS.flatMap(([label, get, dir, , , parts]) => parts
  ? ['weekday', 'Saturday'].map((day, j) => [`Fit to the trains, ${day}`, placeOf(D.map(d => parts(d.F)[j]), dir)])
  : [[label, placeOf(D.map(d => get(d.F)), dir)]]));
claim('the recommendation gives every figure where they differ, in its place', D[0] === ES && JSON.stringify(places) === JSON.stringify(PLACE));
const best = (get, dir) => { const vals = D.map(d => get(d.F)); const b = dir > 0 ? Math.max(...vals) : Math.min(...vals); return vals.map(v => v === b); };
// A CELL OF TWO FIGURES IS MARKED FIGURE BY FIGURE (30 Oct 2026): each part bold where it is the better of its kind
const partsHtml = (parts, dir, i) => parts(D[i].F).map((x, j) => { const r = v => Math.round(v * 10) / 10, col = D.map(d => r(parts(d.F)[j]));
  const b = dir > 0 ? Math.max(...col) : Math.min(...col);
  return r(x) === b && !col.every(v => v === b) ? `<span class="bestv">${esc(x.toFixed(1))}</span>` : esc(x.toFixed(1)); }).join(' · ');
const rowsHtml = ROWS.map(([label, get, dir, fmt, cls = '', parts]) => { const bb = best(get, dir); const allSame = bb.every(Boolean);
  return `<tr><td>${esc(label)}</td><td class="num today ${cls}">${esc(fmt(get(TF), TF))}</td>${D.map((d, i) => parts
    ? `<td class="num ${cls}">${partsHtml(parts, dir, i)}</td>`
    : `<td class="num ${cls}${bb[i] && !allSame ? ' best' : ''}">${esc(fmt(get(d.F), d.F))}</td>`).join('')}</tr>`; }).join('');

// against today: the rows a colleague feels, the designs sharing one column where they agree
const same = get => { const v = D.map(d => get(d.F)); return v.every(x => x === v[0]) ? v[0] : null; };
// the weekends in the rotation, the longest wait between them and the days a year are page 1's shared lines, with today's
// beside them, so they are not said again here (30 Oct 2026: the room went to the long days and the others' costs)
const TODAY_ROWS = [
  ['Full weekends off, about a year', F => `${Math.round(F.A.checks.weekendsOff * 52 / F.pp.L)}`],
  ['Saturdays a year, each', F => `${Math.round(F.pp.sat)}`],
  ['Sunday overtime duties a year, each', F => `${Math.round(F.pp.sun)}`],
  ['Starting at 06:20, each a year', F => `${Math.round(F.pp.open0620)}`],
  ['Average shift, Monday to Saturday', F => hm(F.pp.avgShift)],
  ['Longest shift', F => hm(F.pp.longest)],
  ['14 days’ leave buys, at best', F => `${F.lv.best} days off`],
  ['14 days’ leave buys, at worst', F => `${F.lv.worst} days off`],
  ['Leave for four full weeks off', F => `${F.lv.fourWeeks} days`],
];
const todayHtml = TODAY_ROWS.map(([label, get]) => { const s = same(get);
  return `<tr><td>${esc(label)}</td><td class="num today">${esc(get(TF))}</td>${s !== null ? D.map(() => `<td class="num all">${esc(s)}</td>`).join('') : D.map(d => `<td class="num">${esc(get(d.F))}</td>`).join('')}</tr>`; }).join('');
const list = a => a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
const f1 = x => x.toFixed(1);
const an = s => (/^(8|11|18)/.test(s) ? 'an ' : 'a ') + s;   // "an 8h 40m", "a 42h 30m"
const DATE = '31 Oct 2026';
const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>The shortlist — December 2026 link</title>
<link rel="stylesheet" href="${ROOT}/shared.css"><link rel="stylesheet" href="${ROOT}/links.css">
<style>
@page { size: A4; margin: 11mm 11mm 13mm; }
html, body { background: white !important; color: var(--text-dark); padding: 0 !important; margin: 0; font-family: var(--font-sans); font-size: 11.1px; line-height: 1.38; }
.page { page-break-after: always; position: relative; height: 273mm; box-sizing: border-box; padding-bottom: 14px; }   /* the printable height: the footer sits at the same place on every page */ .page:last-child { page-break-after: auto; }
.mast { background: var(--primary-blue); color: white; padding: 12px 20px 11px; border-bottom: 4px solid var(--accent-gold); border-radius: var(--radius); display: flex; gap: 16px; align-items: center; }
.mast img { width: 44px; height: 44px; border-radius: 10px; }
.mast .eyebrow { color: var(--accent-gold); font-size: 10px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; }
.mast h1 { margin: 2px 0; font-size: 22px; font-weight: 800; color: white; letter-spacing: -.2px; }
.mast .sub { color: rgba(255,255,255,.78); font-size: 11.5px; }
h2 { font-size: 14.5px; color: var(--primary-blue); margin: 8px 0 3px; font-weight: 800; } h2 .note { font-size: 10.4px; font-weight: 400; color: var(--text-mid); margin-left: 6px; }
p { margin: 3px 0 6px; } .muted { color: var(--text-mid); } .lead { font-size: 11.6px; }
table.t { border-collapse: collapse; width: 100%; font-size: 10.2px; line-height: 1.32; }
table.t th, table.t td { padding: 1.5px 7px 2px; border-bottom: 1px solid var(--border-light); text-align: left; vertical-align: top; }
table.t th { background: var(--surface-sunken); color: var(--text-mid); font-size: 9.2px; text-transform: uppercase; letter-spacing: .3px; }
table.t th.num, table.t td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; } table.t th.num { white-space: normal; }   /* a design's name may wrap; its figures never do */
table.t td.today { color: var(--text-light); }
table.t td.best, table.t .bestv { font-weight: 800; color: color-mix(in srgb, var(--success-green) 80%, black); }
table.t td.all { color: var(--text-mid); }
table.t td.fit { font-size: 9px; letter-spacing: -.15px; }
table.t tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--surface-sunken) 55%, white); }
/* three cards side by side since 31 Oct 2026: two to a row left the third alone on a row of its own */
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 10px; margin: 6px 0 2px; }
.card { background: var(--surface-sunken); border-radius: 0 0 var(--radius-sm) var(--radius-sm); padding: 7px 10px 8px; font-size: 10.1px; line-height: 1.36; border-top: 3px solid var(--primary-blue); }
.card.rec { border-top-color: var(--success-green); }
.card b.k { font-size: 12.5px; font-weight: 800; color: var(--primary-blue); margin-right: 6px; }
.card .code { font-size: 9px; color: var(--text-light); }
.card .edge { margin-right: 3px; } .card .head { display: block; margin-bottom: 1px; }
.t.guide { margin-top: 4px; } .t.guide td:last-child { white-space: nowrap; }
.callout { border-left: 3px solid var(--accent-gold); background: var(--surface-sunken); padding: 8px 13px; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; margin: 7px 0; font-size: 10.9px; line-height: 1.42; }
.pick { border-left-color: var(--success-green); }
ul.list { margin: 3px 0 5px; padding-left: 18px; font-size: 10.7px; line-height: 1.4; } ul.list li { margin: 3px 0; }
.shared { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 20px; font-size: 10.5px; line-height: 1.38; margin: 5px 0 3px; } .shared div::before { content: '✓ '; color: var(--success-green); font-weight: 800; }
.foot { position: absolute; bottom: 0; left: 0; right: 0; display: flex; justify-content: space-between; font-size: 8.5px; color: var(--text-light); border-top: 1px solid var(--border-light); padding-top: 4px; }
.foot b { color: var(--primary-blue); }
/* four designs and a date no longer fit beside the page line, so the footer wraps — between its items, never inside a
   name, a code or the date (30 Oct 2026: "Closing | Time" on page 1, "30 | Oct 2026" on page 2) */
.foot .nw, .nw { white-space: nowrap; }
* { text-wrap: pretty; } h1, h2 { text-wrap: balance; }
</style></head><body>
<section class="page">
  <div class="mast"><img src="${ROOT}/icon-192.png" alt=""><div><div class="eyebrow">Marylebone Roster · December 2026 link · the shortlist</div><h1>${Word(D.length)} good links, one edge each</h1>
  <div class="sub">${esc(list(D.map(d => d.name)))}, against each other and against today’s link</div></div></div>

  <h2>What ${both} share</h2>
  <p class="lead">${Word(stats.length)} designs are in the pack; these ${N} balance best what weighs most here. Everything below holds for ${both}, each line better than or level with today; what they share that is worse than today is on page 2.</p>
  <div class="shared">
    <div>All <b>${met} of ${shared('rules scored', F => F.of)}</b> December staffing rules (today ${TF.met}), and all three flexible ones: 14 on a Saturday, evenly spaced cover weeks, weekday closers from 15:45</div>
    <div><b>No avoidable fatigue warning</b> on the fixed rota, one if a cover week falls badly — a 55-hour week; never more than <b>${word(run)} days in a row</b> on the fixed rota, ${word(worstRun)} if a cover week falls badly (today ${TF.A.fixed.present} warnings, up to ${TF.A.fatigue.present}; ${word(TF.fixedRun)} days, up to ${word(TF.worstRun)})</div>
    <div><b>${wkOff} full weekends off in ${LINES}</b>, never more than ${gap} weeks apart (today ${TF.A.checks.weekendsOff} in ${TF.pp.L}, up to ${TF.maxGap} apart)</div>
    <div>The same <b>35-hour</b> week and <b>${days} days</b> a year, under the ceiling of ${DAYS_CEILING} (today ${TF.pp.daysYear.toFixed(1)})</div>
    <div>Every closing shift <b>shorter, by ${dur(Math.min(...cuts))} to ${dur(Math.max(...cuts))}</b> — the weekday’s and Sunday’s ${hm(wkCloser)} on ${both} (today ${hm(TF.closers[0])} and ${hm(TF.closers[2])}); no shift over ${hm(longest)}</div>
    <div><b>One shift time Monday to Friday and no early–late switch in ${one} of ${wl} weeks</b>, no week mixing the two (today ${TF.A.feel.oneTurn} of ${TF.A.feel.workingLines}, with ${TF.A.feel.hybrid} mixing)</div>
    <div><b>${iso} single rest days</b> in the rotation, as today — about ${isoYear(EF)} a year each, today ${isoYear(TF)}; every other break is two days (${paired}; today ${TF.A.feel.pairedRest} of ${TF.A.feel.restIslands} are two or more, ${word(longRest(TF))} of them three or four)</div>
    <div><b>The same Sunday</b>: the same ten duties, one of them a 9-hour early, 09:00–18:00</div>
  </div>

  <h2>Where they differ<span class="note">the better of the ${N} on each line in bold green; today for scale, not ranked</span></h2>
  <table class="t"><thead><tr><th>Measure</th><th class="num">Today</th>${D.map(d => `<th class="num">${esc(d.name)}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table>

  <h2>Each one’s edge</h2>
  <div class="cards">
    <div class="card rec"><span class="head"><b class="k">Even Step</b><span class="code">${ES.code} · ${ES.fp}</span></span><b class="edge">No long days.</b>No shift over 8h&nbsp;30m and every early one of today’s times, Monday to Saturday; In Step’s ${hm(EF.closers[0])} closers, today’s 13:45, and the fewest shift times of the three, ${EF.times}. Its cost is the weekday lates, ${hm(lateAvg(EF))} on average, near today’s ${hm(lateAvg(TF))} (In Step’s ${hm(lateAvg(IF))}), the weakest weekday fit (${f1(EF.fit[0])}) and a ${hm(Math.round(EF.step))} change of start.</div>
    <div class="card"><span class="head"><b class="k">In Step</b><span class="code">${IS.code} · ${IS.fp}</span></span><b class="edge">Steady hours, early finishes.</b>Weeks of ${hm(IF.light)} to ${hm(IF.heavy)}, Mon–Sat, ${earlyOff(IF)} finishes a year each before 14:00, the best Saturday fit of the three (${f1(IF.fit[1])}), and Even Step’s closers and 13:45. Its cost is the earlies: ${longEarlyMS(IF)} a year each over 8h&nbsp;30m, Monday to Saturday, at 8h&nbsp;45m and 8h&nbsp;55m — the most of any design here.</div>
    <div class="card"><span class="head"><b class="k">Short Run</b><span class="code">${SR.code} · ${SR.fp}</span></span><b class="edge">The closest weekday fit, the shortest weekday lates.</b>${f1(SF.fit[0])} against ${f1(IF.fit[0])} and ${f1(EF.fit[0])}, weekday lates of ${hm(lateAvg(SF))} on average, and nothing new on a Saturday. Its cost: ${an(hm(SF.closers[1]))} Saturday closer, ${an(hm(SF.heavy))} heaviest week, ${hm(SF.A.rest.minutes)} the shortest rest, no early finish before 14:00, and ${longEarlyMS(SF)} earlies a year over 8h&nbsp;30m, all 9h&nbsp;00m.</div>
  </div>
  <h2>Which one, by what matters most</h2>
  <table class="t guide"><thead><tr><th>If the main priority is</th><th>Choose</th></tr></thead><tbody>
    <tr><td>Of these three, no shift over 8h&nbsp;30m from Monday to Saturday</td><td><b>Even Step</b></td></tr>
    <tr><td>Of these three, the steadiest weekly hours and the most early finishes</td><td><b>In Step</b></td></tr>
    <tr><td>Of these three, the closest weekday fit and the shortest weekday lates</td><td><b>Short Run</b></td></tr>
    <tr><td>The shortest closers of all: 16:00 Monday to Saturday</td><td><b>Closing Time</b> <span class="muted">· outside the shortlist, as is Both Ways</span></td></tr>
    <tr><td>The fewest new shift times: two</td><td><b>Home Grown</b> <span class="muted">· outside the shortlist</span></td></tr>
    <tr><td>A fourth person to the Saturday close</td><td><b>Even Keel</b> <span class="muted">· outside the shortlist, as are Fine Tune and Second Gear</span></td></tr>
    <tr><td>The steadiest start times from week to week</td><td><b>Second Edition</b> <span class="muted">· outside the shortlist</span></td></tr>
    <tr><td>Four weeks off for 14 days’ leave, as today</td><td><b>Long Break</b> <span class="muted">· outside the shortlist</span></td></tr>
  </tbody></table>
  <div class="foot"><span>Page 1 of 2 — what they share, where they differ, which to choose · every figure computed from the rotas</span><span><b>The shortlist</b> · ${D.map(d => `<span class="nw">${esc(d.name)} ${d.code}</span>`).join(' · ')} · <span class="nw">${DATE}</span></span></div>
</section>

<section class="page">
  <div class="mast"><div><div class="eyebrow">The shortlist · continued</div><h1>Against today, and a recommendation</h1>
  <div class="sub">On most of what a colleague feels the ${N} are the same — a figure in grey is shared by ${both}</div></div></div>

  <h2>Against today’s link</h2>
  <table class="t"><thead><tr><th>Measure</th><th class="num">Today</th>${D.map(d => `<th class="num">${esc(d.name)}</th>`).join('')}</tr></thead><tbody>${todayHtml}</tbody></table>
  <p class="muted">Per year: the rotation’s count scaled to 52 weeks; days a year, Monday to Saturday with a cover week as four, over 365 days.</p>

  <h2>Why these ${N} and not the other ${word(others.length)}</h2>
  <p>These ${N} balance best what weighs most here — days in a row, weekends, one shift time a week, late finishes and the closing shift. Each of the others keeps something none of the ${N} has, and pays for it. Closing Time and Both Ways have shorter closers — Closing Time also more even weeks, a gentler step and the best Saturday fit; Both Ways a lighter heaviest week, more early finishes and fewer new times — for fewer weeks on one turn, and a weaker weekday fit and more finishes at 22:00 or later on Closing Time, more long shifts and a weaker weekend fit on Both Ways. Home Grown has the fewest new times, ${word(HG.newT)}, no early over 8h&nbsp;30m on any day and a shorter weekday closer, for today’s ${hm(HG.closers[1])} Saturday closer, fewer weeks on one turn and a weaker fit. Even Keel, Fine Tune and Second Gear have a fourth person to the Saturday close (Fine Tune a gentler step), for weeks mixing earlies and lates, longer blocks, more late finishes and a weaker Saturday fit, and on Fine Tune and Second Gear fewer weeks on one turn. Second Edition has the gentlest step, for ${word(O['Second Edition'].F.fixedRun)} days in a row. Long Break gives four weeks off for ${LB.lv.fourWeeks} days’ leave and a ${LB.lv.best}-day best stretch, for ${word(LB.fixedRun)} days in a row, a ${ord(LB.A.feel.isolatedRest)} single rest day, fewer weeks on one turn and a ${hm(LB.step)} step. Second Look, Second Nature, Second Sight and Second Wind have blocks a week shorter (Second Look also ${word(O['Second Look'].F.worstRun)} days in a row at worst, not ${word(worstRun)}), for six days in a row on the fixed rota and fewer weeks on one turn — Second Sight and Second Wind a bigger step, Second Nature weekends up to ${word(O['Second Nature'].F.maxGap)} weeks apart.</p>

  <h2>The honest costs, shared by ${both}</h2>
  <ul class="list">
    <li><b>Late finishes.</b> ${late23} a year each at 23:00 or later (today ${TF.late23}) and ${late22} at 22:00 or later (today ${TF.late22}) on ${both}. Three to the close every day, where today has two Monday to Saturday, means no link meeting the rules has fewer than ${late23} at 23:00 or later.</li>
    <li><b>Early finishes.</b> Fewer before 14:00 than today’s ${earlyOff(TF)} a year each: ${earlyOff(EF)} on Even Step, ${earlyOff(IF)} on In Step, none on Short Run.</li>
    <li><b>Leave.</b> The best 14-day stretch is ${shared('best leave stretch', F => F.lv.best)} days off, not today’s ${TF.lv.best}; four full weeks off, Sunday to Saturday, takes ${shared('leave for four weeks', F => F.lv.fourWeeks)} days’ leave, not ${TF.lv.fourWeeks}. The worst stretch is a day better. ${Both} are worse than today here, on something people plan a year around; Long Break alone keeps the ${TF.lv.fourWeeks}.</li>
    <li><b>Saturdays.</b> About ${shared('Saturdays a year', F => Math.round(F.pp.sat)) - Math.round(TF.pp.sat)} more a year (${Math.round(EF.pp.sat)}, today ${Math.round(TF.pp.sat)}): ${word(shared('Saturday duties', F => F.satDuties))} on a Saturday, the flexible rule, across ${LINES} lines (today ${word(TF.satDuties)} across ${TF.pp.L}).</li>
    <li><b>New times.</b> ${EF.newT} of Even Step’s ${EF.times} shift times are new, ${IF.newT} of ${IF.times} on the other two: on Even Step ${word(shorterLates(EF))} shorter versions of today’s lates, a <span class="nw">12:15–20:30</span> and the Sunday early; on In Step ${word(shorterLates(IF))} shorter lates and ${word(longerEarlies(IF))} longer weekday earlies; on Short Run ${word(shorterLates(SF))} and ${word(longerEarlies(SF))}. ${Both} add the 9-hour Sunday early, 09:00–18:00.</li>
  </ul>

  <h2>Recommendation</h2>
  <div class="callout pick"><b>Even Step.</b> In Step’s weeks without the long earlies. On what weighs most here it equals both — days in a row, weekends, weeks on one shift time, late finishes and the leave — with In Step’s closers, every one Monday to Saturday ${hm(EF.closers[0])} (Short Run’s Saturday one ${hm(SF.closers[1])}). Monday to Saturday it alone has no shift over 8h&nbsp;30m (In Step ${longMS(IF)} a year each, Short Run ${longMS(SF)}, today ${longMS(TF)}) and every early is one of today’s times; the 13:45 stays every weekday, and it has the fewest shift times of the three, ${EF.times} with ${EF.newT} new. It equals In Step’s lightest week and ${hm(EF.A.rest.minutes)} rest; its heaviest week (${hm(EF.heavy)}), early finishes (${earlyOff(EF)} a year) and Saturday fit (${f1(EF.fit[1])}) sit between the other two. Its costs: the longest weekday lates, ${hm(lateAvg(EF))} on average (In Step’s ${hm(lateAvg(IF))}, Short Run’s ${hm(lateAvg(SF))}), the weakest weekday fit (${f1(EF.fit[0])}, against ${f1(IF.fit[0])} and ${f1(SF.fit[0])}), a ${hm(Math.round(EF.step))} change of start (the others ${hm(Math.round(IF.step))}) and, as on In Step, a new Saturday time, its closer.</div>
  <p class="lead" style="margin-top:8px"><b>But it is a judgement.</b> In the pack’s weighted league (the owner’s weights) Even Step is ${ord(rankOf('Even Step'))} of the ${word(LGall.length)}, under a point behind In Step (${f1(total('Even Step'))} against ${f1(total('In Step'))}), and Short Run ${ord(rankOf('Short Run'))}. The league scores neither the closing shift nor long days; counted even as lightly as its lightest factor, In Step’s long earlies would put Even Step first of all ${word(LGall.length)}. So choose by what matters here:</p>
  <ul class="list">
    <li><b>Choose Even Step</b> if long days matter most — for lates near today’s ${hm(lateAvg(TF))}, the weakest weekday fit and a ${hm(Math.round(EF.step))} change of start.</li>
    <li><b>Choose In Step</b> if, on the same weeks, short lates matter more than short earlies — for ${longEarlyMS(IF)} earlies a year each over 8h&nbsp;30m.</li>
    <li><b>Choose Short Run</b> if the weekday fit and short weekday lates matter most — for ${an(hm(SF.closers[1]))} Saturday closer, ${an(hm(SF.heavy))} Mon–Sat week, no 13:45 and ${longEarlyMS(SF)} long earlies a year.</li>
  </ul>
  <div class="foot"><span>Page 2 of 2 — Against today, the shared costs, the recommendation</span><span><b>The shortlist</b> · ${D.map(d => `<span class="nw">${esc(d.name)} ${d.code}</span>`).join(' · ')} · <span class="nw">${DATE}</span></span></div>
</section>
</body></html>`;
// a label never ends on a lone word: the last space of a plain-text cell becomes a no-break space
const tidy = h => h.replace(/<td>([^<]{24,})<\/td>/g, (m, t) => `<td>${t.replace(/ (\S+)$/, '\u00a0$1')}</td>`);
const htmlOut = new URL('links-26-shortlist.html', import.meta.url).pathname; const htmlTidy = tidy(html); writeFileSync(htmlOut, htmlTidy);   // beside the tooling, gitignored
const b = await chromium.launch(); const pg = await b.newPage();
await pg.goto('file://' + htmlOut); await pg.evaluate(() => document.fonts.ready);
// THE PAGE IS A FIXED HEIGHT, so content that does not fit is HIDDEN, not pushed onto another page — a row added on
// 5 Oct 2026 silently hid the choice guide's last row and the closing paragraph. Refuse to print a page that overflows.
// Measured at the PRINT width (A4 less the 11 mm side margins, 711 px) under print media: at screen width the text
// wraps less and an over-full page looks fine, which is how the first version of this guard passed a broken page.
{ await pg.emulateMedia({ media: 'print' }); await pg.setViewportSize({ width: 711, height: 1100 });
  const over = await pg.evaluate(() => [...document.querySelectorAll('.page')].map((p, i) => { const foot = p.querySelector('.foot');
    const lim = foot ? foot.getBoundingClientRect().top : p.getBoundingClientRect().bottom;
    const low = Math.max(...[...p.children].filter(c => c !== foot).map(c => c.getBoundingClientRect().bottom));
    return [i + 1, Math.round(Math.max(low - lim, p.scrollHeight - p.clientHeight))]; }).filter(([, d]) => d > 1));
  if (over.length) throw new Error(`content runs into the footer or off the page (page, px): ${JSON.stringify(over)}`); }
await pg.pdf({ path: OUT, format: 'A4', printBackground: true, preferCSSPageSize: true });
await b.close(); console.log('wrote', OUT);
