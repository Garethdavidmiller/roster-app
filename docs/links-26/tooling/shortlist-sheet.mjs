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
//   node shortlist-sheet.mjs        → ../links-26-shortlist.pdf (the .html stays in tooling/, gitignored)
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { LINES } from './link.mjs';
import { assess, today, folderStats, sheetRules, flexibleRules } from './report-data.mjs';
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
    newT: A.feel.distinctTimes - shared, fixedRun: A.fixed.run, worstRun: A.checks.longestStretch,
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
const IS = by('In Step'), SR = by('Short Run');
const N = word(D.length), others = stats.filter(s => !SHORTLIST.includes(s.name)).map(s => design(s.name));
// TWO SINCE 30 OCT 2026: the prose below is written for In Step and Short Run, In Step recommended, and says so
if (D.length !== 2 || RECOMMENDED !== 'In Step' || SHORTLIST[0] !== 'In Step') throw new Error(`the sheet's prose is written for In Step (recommended) and Short Run; the shortlist is ${SHORTLIST}, recommending ${RECOMMENDED}`);
const both = 'both', Both = 'Both';

/** A figure the prose says every shortlisted design shares — refused unless it is. */
const shared = (what, get) => { const v = D.map(d => get(d.F)); if (!v.every(x => x === v[0])) throw new Error(`"${what}" is printed as shared but is not: ${D.map((d, i) => `${d.name} ${v[i]}`).join(', ')}`); return v[0]; };
/** A sentence the prose rests on — refused unless it holds. */
const claim = (what, ok) => { if (!ok) throw new Error(`the sheet says "${what}", and the figures no longer do`); };
const lowest = get => Math.min(...D.map(d => get(d.F))), highest = get => Math.max(...D.map(d => get(d.F)));

// WHAT THE SHEETS' MEASURES DO NOT SHOW, per person per year from the grid (30 Oct 2026, the review of In Step's decks):
// In Step's longer earlies are its one cost against Short Run, and the measures above them are blind to it
const perYear = (p, test) => Object.values(p).reduce((n, r) => n + DAYS.filter(d => timed(r[d]) && test(r[d], d)).length, 0) * 52 / Object.keys(p).length;
const isEarly = s => m(s) < 11 * 60;
const longEarly = F => Math.round(perYear(F.p, s => isEarly(s) && mins(s) > 510));
const longShift = F => Math.round(perYear(F.p, s => mins(s) > 510));
const earlyOff = F => Math.round(perYear(F.p, s => isEarly(s) && m(s.slice(6)) < 14 * 60));   // an early finishing before 14:00
const todaysTimes = new Set(Object.values(T0.patterns).flatMap(r => DAYS.map(d => r[d]).filter(timed)));
const satNew = F => new Set(Object.values(F.p).map(r => r.sat).filter(s => timed(s) && !todaysTimes.has(s))).size;
const fit7 = F => (5 * F.fit[0] + F.fit[1] + F.fit[2]) / 7;   // each day of a week counted once
const longLengths = F => [...new Set(Object.values(F.p).flatMap(r => DAYS.map(d => r[d])).filter(s => timed(s) && isEarly(s) && mins(s) > 510).map(mins))].sort((a, b) => a - b);
const todayLongestEarly = Math.max(...Object.values(T0.patterns).flatMap(r => DAYS.map(d => r[d])).filter(s => timed(s) && isEarly(s)).map(mins));
const newTimes = F => new Set(Object.values(F.p).flatMap(r => DAYS.map(d => r[d])).filter(s => timed(s) && !todaysTimes.has(s)));
// a new late that shortens one of today's: same start or same end as a time worked today, and shorter than it
const shorterLates = F => [...newTimes(F)].filter(t => !isEarly(t) && [...todaysTimes].some(u => (u.slice(0, 5) === t.slice(0, 5) || u.slice(6) === t.slice(6)) && mins(u) > mins(t))).length;
const longerEarlies = F => [...newTimes(F)].filter(t => isEarly(t) && mins(t) > todayLongestEarly && Object.values(F.p).some(r => MS.slice(0, 5).some(d => r[d] === t))).length;   // new weekday earlies longer than any today
const k1345 = F => MS.slice(0, 5).every(d => Object.values(F.p).some(r => r[d] === '06:20-13:45'));

// what the two share, each one asserted before it is printed
const met = shared('December rules met', F => F.met), wkOff = shared('full weekends off', F => F.A.checks.weekendsOff), gap = shared('longest wait between weekends', F => F.maxGap);
const days = shared('days a year', F => F.pp.daysYear.toFixed(1)), longest = shared('longest shift', F => F.pp.longest);
const iso = shared('single rest days', F => F.A.feel.isolatedRest), paired = shared('rest-day breaks', F => `${F.A.feel.pairedRest} of ${F.A.feel.restIslands}`);
shared('fatigue warnings, fixed', F => F.A.fixed.present); shared('fatigue warnings, worst case', F => F.A.fatigue.present);
const run = shared('most days in a row, fixed rota', F => F.fixedRun), worstRun = shared('worst-case run', F => F.worstRun);
const one = shared('weeks on one turn', F => F.A.feel.oneTurn), wl = shared('working weeks', F => F.A.feel.workingLines);
const mixed = shared('weeks mixing earlies and lates', F => F.A.feel.hybrid), step = shared('week-to-week change of start', F => Math.round(F.step));
const late23 = shared('finishes at 23:00 or later', F => F.late23), late22 = shared('finishes at 22:00 or later', F => F.late22);
const newT = shared('new shift times', F => F.newT), times = shared('shift times', F => F.times), known = shared('shift times worked today', F => F.shared);
const sunCloser = shared('Sunday closer', F => F.closers[2]), wkCloser = shared('weekday closer', F => F.closers[0]), sunFit = shared('Sunday fit', F => F.fit[2].toFixed(1));
claim('the weekday’s and Sunday’s closers one length', wkCloser === sunCloser);
claim('no avoidable fatigue warning', IS.F.A.fixed.present === 0 && IS.F.A.fatigue.present === 0);
claim('all three flexible rules', D.every(d => d.F.flex === 3));
const cuts = D.flatMap(d => d.F.closers.map((c, i) => TF.closers[i] - c)); claim('every closing shift shorter', Math.min(...cuts) > 0);
claim('no week mixing earlies and lates, where today has some', mixed === 0 && TF.A.feel.hybrid > 0);
claim('five days in a row at most on the fixed rota, six with a cover week placed badly; today more of both', run === 5 && worstRun === 6 && TF.fixedRun > run && TF.worstRun > worstRun);

// the others: what each keeps that neither of the two has, and what it pays — asserted, measure by measure
const DIR = { fixedRun: -1, worstRun: -1, heavy: -1, light: 1, rest: 1, one: 1, mixed: -1, block: -1, step: -1, late23: -1, late22: -1, newT: -1, times: -1, fit: -1, closers: -1, lvBest: 1, lvWorst: 1, lvFour: -1, iso: -1 };
const measure = F => ({ fixedRun: F.fixedRun, worstRun: F.worstRun, heavy: F.heavy, light: F.light, rest: F.A.rest.minutes, one: F.A.feel.oneTurn, mixed: F.A.feel.hybrid, block: F.block.worst,
  step: Math.round(F.step), late23: F.late23, late22: F.late22, newT: F.newT, times: F.times, fit: F.fit[0] + F.fit[1] + F.fit[2], closers: F.closers[0] + F.closers[1] + F.closers[2],
  lvBest: F.lv.best, lvWorst: F.lv.worst, lvFour: F.lv.fourWeeks, iso: F.A.feel.isolatedRest });
const keeps = d => { const x = measure(d.F); return Object.keys(DIR).filter(k => D.every(s => DIR[k] * (x[k] - measure(s.F)[k]) > 0)).sort(); };
const loses = d => { const x = measure(d.F); return Object.keys(DIR).filter(k => D.every(s => DIR[k] * (x[k] - measure(s.F)[k]) < 0)); };
const O = Object.fromEntries(others.map(d => [d.name, d])), K = Object.fromEntries(others.map(d => [d.name, keeps(d).join()]));
const NAMED = { 'Both Ways': 'closers,heavy,newT,times', 'Closing Time': 'closers,light,newT,step,times', 'Even Keel': '', 'Fine Tune': 'step', 'Home Grown': 'newT,times',
  'Long Break': 'lvBest,lvFour', 'Second Edition': 'step', 'Second Gear': '', 'Second Look': 'block,times', 'Second Nature': 'block', 'Second Sight': 'block', 'Second Wind': 'block' };
claim('the paragraph names every other design, and what it keeps', Object.keys(NAMED).sort().join() === Object.keys(O).sort().join() && Object.entries(NAMED).every(([n, k]) => K[n] === k));
const pays = (n, ...ks) => claim(`${n} pays with ${ks.join(', ')}`, ks.every(k => loses(O[n]).includes(k)));
pays('Closing Time', 'fit', 'one', 'late22'); pays('Both Ways', 'fit', 'one'); pays('Second Edition', 'fixedRun'); pays('Fine Tune', 'late23', 'mixed');
pays('Home Grown', 'fit'); pays('Long Break', 'iso', 'one', 'step');
const LB = O['Long Break'].F, sec = ['Second Look', 'Second Nature', 'Second Sight', 'Second Wind'];
sec.forEach(n => pays(n, 'fixedRun', 'one'));
claim('the four Second designs: blocks a week shorter', sec.every(n => O[n].F.block.worst === lowest(F => F.block.worst) - 1));
claim('Closing Time: more even weeks', (O['Closing Time'].F.heavy - O['Closing Time'].F.light) < lowest(F => F.heavy - F.light));
claim('Home Grown: the fewest new times of all', others.every(d => d.name === 'Home Grown' || d.F.newT > O['Home Grown'].F.newT) && O['Home Grown'].F.newT < lowest(F => F.newT));
claim('Long Break: a fifth single rest day', LB.A.feel.isolatedRest === iso + 1);

// page 1, the two cards and the guide
const IF = IS.F, SF = SR.F, range = F => F.heavy - F.light;
claim('In Step: one closer length Monday to Saturday, shorter than Short Run’s Saturday one', IF.closers[0] === IF.closers[1] && SF.closers[1] > IF.closers[1] && SF.closers[0] === IF.closers[0]);
claim('In Step: Closing Time’s weeks — the same rest days, and the same earlies and lates', Object.keys(IF.p).every(k => MS.every(d => timed(IF.p[k][d]) === timed(O['Closing Time'].F.p[k][d])
  && (!timed(IF.p[k][d]) || isEarly(IF.p[k][d]) === isEarly(O['Closing Time'].F.p[k][d])))));
claim('In Step: five on at every opening Monday to Saturday', MS.every(d => IF.A.heads.open[d] === 5));
claim('In Step: lighter heaviest week, more rest, the better Saturday fit, more even weeks', IF.heavy < SF.heavy && IF.A.rest.minutes > SF.A.rest.minutes && IF.fit[1] < SF.fit[1] && range(IF) < range(SF));
claim('In Step: today’s 13:45 every weekday; Short Run has none', k1345(IF) && !MS.some(d => Object.values(SF.p).some(r => r[d] === '06:20-13:45')));
claim('In Step: more long earlies, and a weekday fit a shade behind', longEarly(IF) > longEarly(SF) && IF.fit[0] > SF.fit[0] && IF.fit[0] - SF.fit[0] < 1);
claim('Short Run: fewer long shifts than today and In Step', longShift(SF) < longShift(TF) && longShift(TF) < longShift(IF));
claim('Short Run: nothing new on a Saturday; In Step one new time there', satNew(SF) === 0 && satNew(IF) === 1);
claim('Short Run: no early finishing before 14:00, where today has some', earlyOff(SF) === 0 && earlyOff(TF) > 0 && earlyOff(IF) > 0);
claim('on what weighs most here In Step equals Short Run (run, weekends, one turn, late finishes — each shared() above), and is ahead on the closers',
  IF.closers[0] + IF.closers[1] + IF.closers[2] < SF.closers[0] + SF.closers[1] + SF.closers[2]);
claim('In Step’s one new Saturday time is its closer', satNew(IF) === 1 && Object.values(IF.p).some(r => r.sat === `15:45-23:55`) && !todaysTimes.has('15:45-23:55'));
claim('In Step’s long earlies mostly 8h 45m and 8h 55m, Short Run’s all 9h 00m', longLengths(IF).join() === '525,535,540' && longLengths(SF).join() === '540'
  && perYear(IF.p, s => isEarly(s) && mins(s) === 540) < perYear(IF.p, s => isEarly(s) && mins(s) > 510) / 4);
claim('weighted by the days of a week the two fit alike, Short Run a shade closer', Math.abs(fit7(IF) - fit7(SF)) < 0.1 && fit7(SF) < fit7(IF));

// the league: its spread, and what it would say if it counted long earlies — computed over the range league.mjs itself
// uses (REF_IN_RANGE: the proposals, today's link and Familiar Nine), never typed
const tmp = mkdtempSync(`${tmpdir()}/league-`);
execFileSync('node', [new URL('./league.mjs', import.meta.url).pathname], { env: { ...process.env, REF_IN_RANGE: '1', JSON: `${tmp}/league.json` }, stdio: 'ignore' });
const LJ = JSON.parse(readFileSync(`${tmp}/league.json`, 'utf8')); rmSync(tmp, { recursive: true });
const LGall = LJ.proposals, LG = LGall.filter(r => SHORTLIST.includes(r.name)), total = name => LGall.find(r => r.name === name).total;
claim('the league scores both shortlisted designs', LG.length === D.length);
const lead = total('In Step') - total('Short Run');
claim('In Step first in the league, Short Run behind it by about two points', LGall.every(r => r.total <= total('In Step')) && Math.abs(lead - 2) < 0.25);
const F9 = JSON.parse(readFileSync(new URL('../../links-24/proposals/Familiar-Nine-F9-24-K31s.json', import.meta.url), 'utf8')), F9p = F9.patterns ?? F9;
const le = p => perYear(p, s => isEarly(s) && mins(s) > 510), leAll = [...stats.map(s => le(design(s.name).F.p)), le(T0.patterns), le(F9p)];
const leLo = Math.min(...leAll), leHi = Math.max(...leAll), leScore = p => 1 - (le(p) - leLo) / (leHi - leLo);
const wStar = lead / (leScore(SF.p) - leScore(IF.p));   // the weight on long earlies at which Short Run would draw level
claim('counted like late finishes Short Run leads; like single rest days In Step does', LJ.weights.late === 5 && LJ.weights.iso === 4 && wStar > 4 && wStar < 5);
claim('In Step has the most long earlies of any design here', stats.every(s => s.name === 'In Step' || longEarly(design(s.name).F) < longEarly(IF)));
// the guide's rows for designs outside the shortlist: each the strongest in the league of those that have its edge
const allD = stats.map(s => design(s.name)), strongest = (test) => { const has = allD.filter(d => test(d.F)); return has.sort((a, b) => total(b.name) - total(a.name)).map(d => d.name); };
const minClose = Math.min(...allD.map(d => d.F.closers[0] + d.F.closers[1]));
const shortClosers = strongest(F => F.closers[0] + F.closers[1] === minClose), fourth = strongest(F => F.A.heads.close.sat === 4);
claim('the shortest closers: Closing Time, then Both Ways', shortClosers.join() === 'Closing Time,Both Ways');
claim('a fourth to the Saturday close: Even Keel, then Fine Tune and Second Gear', fourth.join() === 'Even Keel,Fine Tune,Second Gear');
claim('the steadiest start times: Second Edition', allD.every(d => d.name === 'Second Edition' || d.F.step > O['Second Edition'].F.step));
claim('four weeks off for today’s 14 days: Long Break alone', allD.filter(d => d.F.lv.fourWeeks <= TF.lv.fourWeeks).map(d => d.name).join() === 'Long Break' && TF.lv.fourWeeks === 14);

// page 2, the honest costs both share
claim('three or more to the close every day, where today’s weekdays have two', D.every(d => Object.values(d.F.A.heads.close).every(x => x >= 3)) && TF.A.heads.close.mon === 2);
claim('no design here meeting all 9 rules has fewer finishes at 23:00 or later', allD.filter(d => d.F.met === 9).every(d => d.F.late23 >= late23));
claim('the worst leave stretch a day better than today’s', shared('worst leave stretch', F => F.lv.worst) === TF.lv.worst + 1);
claim('worse than today: late finishes, leave, Saturdays, new times', late23 > TF.late23 && late22 > TF.late22 && shared('leave for four weeks', F => F.lv.fourWeeks) > TF.lv.fourWeeks
  && shared('best leave stretch', F => F.lv.best) < TF.lv.best && shared('Saturdays a year', F => Math.round(F.pp.sat)) > Math.round(TF.pp.sat) && newT > TF.newT);
claim('the new times: shorter versions of today’s lates, and longer weekday earlies', shorterLates(SF) === 4 && shorterLates(IF) === 3 && longerEarlies(SF) === 1 && longerEarlies(IF) === 2);

// the comparison rows: only where the two differ (what they share is listed above them), and the measures the sheets
// otherwise lack. label, how to read each design, which direction is better (1 higher, -1 lower), format
const ROWS = [
  ['Heaviest week', F => F.heavy, -1, hm],
  ['Lightest week', F => F.light, 1, hm],
  ['Shortest rest between shifts', F => F.A.rest.minutes, 1, hm],
  ['Closing shift, Saturday', F => F.closers[1], -1, hm],
  ['Earlies over 8h 30m, each a year', longEarly, -1, v => `${v}`],
  ['Any shift over 8h 30m, each a year', longShift, -1, v => `${v}`],
  ['Earlies finishing before 14:00, each a year', earlyOff, 1, v => `${v}`],
  ['New shift times on a Saturday', satNew, -1, v => `${v}`],
  [`Fit to the trains, weekday · Sat (0 = exact; Sunday ${sunFit} on ${both}, today ${TF.fit[2].toFixed(1)})`, F => F.fit[0] + F.fit[1], -1, (v, F) => F.fit.slice(0, 2).map(x => x.toFixed(1)).join(' · '), 'fit', F => F.fit.slice(0, 2)],
];
claim('every “where they differ” row differs', ROWS.every(([, get]) => get(IF) !== get(SF)));
// THE RECOMMENDATION GIVES EVERY FIGURE WHERE THEY DIFFER, ON ITS SIDE (30 Oct 2026, the accuracy check). It said In Step was
// "better or level on everything else this sheet compares" and that its costs lay "outside those measures" — true of the
// four-design sheet, whose table had no long-day rows, and false of this one, whose table compares them four lines above.
// Each row (each figure of the fit row) is read here as the paragraph and the cards read it: 1 In Step's, -1 Short Run's.
const SIDE = { 'Heaviest week': 1, 'Lightest week': 1, 'Shortest rest between shifts': 1, 'Closing shift, Saturday': 1,
  'Earlies over 8h 30m, each a year': -1, 'Any shift over 8h 30m, each a year': -1, 'Earlies finishing before 14:00, each a year': 1,
  'New shift times on a Saturday': -1, 'Fit to the trains, weekday': -1, 'Fit to the trains, Saturday': 1 };
const sides = Object.fromEntries(ROWS.flatMap(([label, get, dir, , , parts]) => parts
  ? ['weekday', 'Saturday'].map((day, j) => [`Fit to the trains, ${day}`, Math.sign(dir * (parts(IF)[j] - parts(SF)[j]))])
  : [[label, Math.sign(dir * (get(IF) - get(SF)))]]));
claim('the recommendation and the cards give every figure where they differ, on its side', JSON.stringify(sides) === JSON.stringify(SIDE));
const best = (get, dir) => { const vals = D.map(d => get(d.F)); const b = dir > 0 ? Math.max(...vals) : Math.min(...vals); return vals.map(v => v === b); };
// A CELL OF TWO FIGURES IS MARKED FIGURE BY FIGURE (30 Oct 2026): each part bold where it is the better of its kind
const partsHtml = (parts, dir, i) => parts(D[i].F).map((x, j) => { const r = v => Math.round(v * 10) / 10, col = D.map(d => r(parts(d.F)[j]));
  const b = dir > 0 ? Math.max(...col) : Math.min(...col);
  return r(x) === b && !col.every(v => v === b) ? `<span class="bestv">${esc(x.toFixed(1))}</span>` : esc(x.toFixed(1)); }).join(' · ');
const rowsHtml = ROWS.map(([label, get, dir, fmt, cls = '', parts]) => { const bb = best(get, dir); const allSame = bb.every(Boolean);
  return `<tr><td>${esc(label)}</td><td class="num today ${cls}">${esc(fmt(get(TF), TF))}</td>${D.map((d, i) => parts
    ? `<td class="num ${cls}">${partsHtml(parts, dir, i)}</td>`
    : `<td class="num ${cls}${bb[i] && !allSame ? ' best' : ''}">${esc(fmt(get(d.F), d.F))}</td>`).join('')}</tr>`; }).join('');

// against today: the rows a colleague feels, the designs sharing one column where they agree
const same = get => { const v = D.map(d => get(d.F)); return v.every(x => x === v[0]) ? v[0] : null; };
const TODAY_ROWS = [
  ['Full weekends off, in the rotation', F => `${F.A.checks.weekendsOff} in ${F.pp.L}`],
  ['Full weekends off, about a year', F => `${Math.round(F.A.checks.weekendsOff * 52 / F.pp.L)}`],
  ['Longest wait between full weekends', F => `${F.maxGap} weeks`],
  ['Contracted days at work a year', F => F.pp.daysYear.toFixed(1)],
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
.cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 12px; margin: 6px 0 2px; }
.card { background: var(--surface-sunken); border-radius: 0 0 var(--radius-sm) var(--radius-sm); padding: 7px 12px 8px; font-size: 10.4px; line-height: 1.38; border-top: 3px solid var(--primary-blue); }
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
.foot .nw { white-space: nowrap; }
* { text-wrap: pretty; } h1, h2 { text-wrap: balance; }
</style></head><body>
<section class="page">
  <div class="mast"><img src="${ROOT}/icon-192.png" alt=""><div><div class="eyebrow">Marylebone Roster · December 2026 link · the shortlist</div><h1>${Word(D.length)} good links, one edge each</h1>
  <div class="sub">${esc(list(D.map(d => d.name)))}, against each other and against today’s link</div></div></div>

  <h2>What ${both} share</h2>
  <p class="lead">${Word(stats.length)} designs are in the pack; these ${N} balance best what weighs most here. Everything below holds for ${both}, each line better than or level with today; what they share that is worse than today is on page 2.</p>
  <div class="shared">
    <div>All <b>${met} of 9</b> December staffing rules (today ${TF.met}), and all three flexible ones: 14 on a Saturday, evenly spaced cover weeks, 15:45 weekday closers</div>
    <div><b>No avoidable fatigue warning</b>; never more than <b>${word(run)} days in a row</b> on the fixed rota, ${word(worstRun)} if a cover week falls badly (today ${TF.A.fixed.present} warnings, up to ${TF.A.fatigue.present}; ${word(TF.fixedRun)} days, up to ${word(TF.worstRun)})</div>
    <div><b>${wkOff} full weekends off in 26</b>, never more than ${gap} weeks apart (today ${TF.A.checks.weekendsOff} in 20, up to ${TF.maxGap} apart)</div>
    <div>The same <b>35-hour</b> week and <b>${days} days</b> a year, under the ceiling of 219 (today ${TF.pp.daysYear.toFixed(1)})</div>
    <div>Every closing shift <b>shorter, by ${dur(Math.min(...cuts))} to ${dur(Math.max(...cuts))}</b> — the weekday’s and Sunday’s ${hm(wkCloser)} on ${both} (today ${hm(TF.closers[0])} and ${hm(TF.closers[2])}); no shift over ${hm(longest)}</div>
    <div><b>One shift time Monday to Friday in ${one} of ${wl} weeks</b>, and no week mixing earlies and lates (today ${TF.A.feel.oneTurn} of ${TF.A.feel.workingLines}, with ${TF.A.feel.hybrid} mixing)</div>
    <div><b>${iso} single rest days</b>, as today; rest days otherwise in pairs or longer (${paired} breaks, today ${TF.A.feel.pairedRest} of ${TF.A.feel.restIslands})</div>
    <div>The same <b>${hm(step)} week-to-week change</b> of start time (today ${hm(TF.step)}), and the same Sunday</div>
  </div>

  <h2>Where they differ<span class="note">the better of the ${N} on each line in bold green; today for scale, not ranked</span></h2>
  <table class="t"><thead><tr><th>Measure</th><th class="num">Today</th>${D.map(d => `<th class="num">${esc(d.name)}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table>

  <h2>Each one’s edge</h2>
  <div class="cards">
    <div class="card"><span class="head"><b class="k">In Step</b><span class="code">${IS.code} · ${IS.fp}</span></span><b class="edge">The shorter closers and the lighter weeks.</b>Closing Time’s weeks, with five on at every opening Monday to Saturday: every closer Monday to Saturday ${hm(IF.closers[0])} (Short Run’s Saturday one ${hm(SF.closers[1])}), no week over ${hm(IF.heavy)} (Short Run ${hm(SF.heavy)}), ${hm(IF.A.rest.minutes)} the shortest rest, a Saturday fit of ${f1(IF.fit[1])} against ${f1(SF.fit[1])}, and today’s 13:45 kept every weekday. Its cost is the earlies — ${longEarly(IF)} a year each over 8h&nbsp;30m (Short Run ${longEarly(SF)}) — with a weekday fit a shade behind (${f1(IF.fit[0])} against ${f1(SF.fit[0])}) and a new time on a Saturday, its closer.</div>
    <div class="card"><span class="head"><b class="k">Short Run</b><span class="code">${SR.code} · ${SR.fp}</span></span><b class="edge">Fewer long days.</b>${longShift(SF)} shifts a year each over 8h&nbsp;30m, fewer than today’s ${longShift(TF)} and In Step’s ${longShift(IF)}; the closer fit to the weekday trains (${f1(SF.fit[0])} against ${f1(IF.fit[0])}); and nothing new on a Saturday, where every time is worked today. Its cost: ${an(hm(SF.closers[1]))} Saturday closer, ${an(hm(SF.heavy))} heaviest week, ${hm(SF.A.rest.minutes)} the shortest rest, a Saturday fit of ${f1(SF.fit[1])}, and no early finish before 14:00 (today ${earlyOff(TF)} a year each).</div>
  </div>
  <h2>Which one, by what matters most</h2>
  <table class="t guide"><thead><tr><th>If the main priority is</th><th>Choose</th></tr></thead><tbody>
    <tr><td>Shorter closers and lighter, more even weeks, with today’s 13:45 kept</td><td><b>In Step</b></td></tr>
    <tr><td>Fewer long days, the closer weekday fit, and nothing new on a Saturday</td><td><b>Short Run</b></td></tr>
    <tr><td>The shortest closers of all: 16:00 Monday to Saturday</td><td><b>Closing Time</b> <span class="muted">· outside the shortlist, as is Both Ways</span></td></tr>
    <tr><td>A fourth person to the Saturday close</td><td><b>Even Keel</b> <span class="muted">· outside the shortlist, as are Fine Tune and Second Gear</span></td></tr>
    <tr><td>The steadiest start times from week to week</td><td><b>Second Edition</b> <span class="muted">· outside the shortlist</span></td></tr>
    <tr><td>Four weeks off for 14 days’ leave, as today</td><td><b>Long Break</b> <span class="muted">· outside the shortlist</span></td></tr>
  </tbody></table>
  <div class="foot"><span>Page 1 of 2 — what they share, where they differ, which to choose · every figure computed from the rotas</span><span><b>The shortlist</b> · ${D.map(d => `<span class="nw">${esc(d.name)} ${d.code}</span>`).join(' · ')} · <span class="nw">30 Oct 2026</span></span></div>
</section>

<section class="page">
  <div class="mast"><div><div class="eyebrow">The shortlist · continued</div><h1>Against today, and a recommendation</h1>
  <div class="sub">On most of what a colleague feels the ${N} are the same — a figure in grey is shared by ${both}</div></div></div>

  <h2>Against today’s link</h2>
  <table class="t"><thead><tr><th>Measure</th><th class="num">Today</th>${D.map(d => `<th class="num">${esc(d.name)}</th>`).join('')}</tr></thead><tbody>${todayHtml}</tbody></table>
  <p class="muted">Per year: the rotation’s count scaled to 52 weeks. Days a year are Monday to Saturday, a cover week counting four.</p>

  <h2>Why these ${N} and not the other ${word(others.length)}</h2>
  <p>These ${N} balance best what weighs most here — days in a row, weekends, one shift time a week, late finishes and the closing shift. Each of the others keeps something neither has, or nothing, at a price. Closing Time and Both Ways have shorter closers and fewer shift times to learn — Closing Time with more even weeks and a gentler week-to-week step, Both Ways with a lighter heaviest week — for a weaker fit to the trains and fewer weeks on one turn, and on Closing Time more finishes at 22:00 or later. Second Edition and Fine Tune have a gentler step: Second Edition for ${word(O['Second Edition'].F.fixedRun)} days in a row, Fine Tune for more late finishes and a week mixing earlies and lates. Home Grown has the fewest new times, ${word(O['Home Grown'].F.newT)}, for a weaker fit. Long Break gives four weeks off for ${LB.lv.fourWeeks} days’ leave and a ${LB.lv.best}-day best stretch, for a ${ord(LB.A.feel.isolatedRest)} single rest day, fewer weeks on one turn and a ${hm(LB.step)} step. Second Look, Second Nature, Second Sight and Second Wind have blocks of earlies or lates a week shorter (Second Look fewer shift times too), for six days in a row and fewer weeks on one turn. Even Keel’s fourth person to the Saturday close is not among these measures; on them it and Second Gear keep nothing the ${N} lack.</p>

  <h2>The honest costs, shared by ${both}</h2>
  <ul class="list">
    <li><b>Late finishes.</b> ${late23} a year each at 23:00 or later (today ${TF.late23}) and ${late22} at 22:00 or later (today ${TF.late22}) on ${both}. Three to the close every day, where today’s weekdays have two, means no link meeting the rules has fewer than ${late23} at 23:00 or later.</li>
    <li><b>Leave.</b> The best 14-day stretch is ${shared('best leave stretch', F => F.lv.best)} days off, not today’s ${TF.lv.best}; four full weeks off, Sunday to Saturday, takes ${shared('leave for four weeks', F => F.lv.fourWeeks)} days’ leave, not ${TF.lv.fourWeeks}. The worst stretch is a day better. ${Both} are worse than today here, on something people plan a year around; Long Break alone keeps the ${TF.lv.fourWeeks}.</li>
    <li><b>Saturdays.</b> About ${shared('Saturdays a year', F => Math.round(F.pp.sat)) - Math.round(TF.pp.sat)} more a year each (${Math.round(SF.pp.sat)}, today ${Math.round(TF.pp.sat)}) — ${word(shared('Saturday duties', F => F.satDuties))} on a Saturday, the flexible rule, shared across ${LINES} lines (today ${word(TF.satDuties)} across 20).</li>
    <li><b>New times.</b> ${newT} of ${times} shift times are new on ${both} (${known} are worked today). On Short Run ${word(shorterLates(SF))} of the new ones are shorter versions of today’s lates and ${word(longerEarlies(SF))} a longer weekday early; on In Step ${word(shorterLates(IF))}, and ${word(longerEarlies(IF))} longer weekday earlies.</li>
  </ul>

  <h2>Recommendation</h2>
  <div class="callout pick"><b>In Step.</b> On what weighs most here it equals Short Run — days in a row, weekends, weeks on one shift time and late finishes, and the leave too — and is ahead on the closing shift: every closer Monday to Saturday ${hm(IF.closers[0])}, where Short Run’s Saturday one is ${hm(SF.closers[1])}. It also has the lighter, more even weeks (${hm(IF.light)} to ${hm(IF.heavy)} against ${hm(SF.light)} to ${hm(SF.heavy)}), the longer shortest rest (${hm(IF.A.rest.minutes)} against ${hm(SF.A.rest.minutes)}), the better Saturday fit (${f1(IF.fit[1])} against ${f1(SF.fit[1])}) and today’s 13:45 kept every weekday. Its cost is long days: ${longEarly(IF)}&nbsp;earlies a year each over 8h&nbsp;30m against Short Run’s ${longEarly(SF)} — In Step’s mostly 8h&nbsp;45m and 8h&nbsp;55m, Short Run’s all 9h&nbsp;00m — so ${longShift(IF)}&nbsp;shifts over 8h&nbsp;30m against ${longShift(SF)}, with a new time on a Saturday and a weekday fit a shade behind (${f1(IF.fit[0])} against ${f1(SF.fit[0])}). Counting each day of a week once, the two fit the trains alike (${f1(fit7(IF))} and ${f1(fit7(SF))}).</div>
  <p class="lead" style="margin-top:8px"><b>But it is close.</b> On the app’s weighted league In Step leads by ${word(Math.round(lead))} points (${f1(total('In Step'))} against ${f1(total('Short Run'))}), and the league does not count long earlies, where In Step has the most of any design here: counted as heavily as it counts late finishes, they would put Short Run ahead; any lighter than it counts single rest days, and In Step stays ahead. So choose by what matters here:</p>
  <ul class="list">
    <li><b>Choose In Step</b> if the closing shift and steady weeks matter most, and colleagues value today’s 13:45.</li>
    <li><b>Choose Short Run</b> if long days matter more: ${longEarly(SF)} long earlies a year each instead of ${longEarly(IF)}, the closer weekday fit and nothing new on a Saturday — for ${an(hm(SF.closers[1]))} Saturday closer and ${an(hm(SF.heavy))} week.</li>
  </ul>
  <div class="foot"><span>Page 2 of 2 — Against today, the shared costs, the recommendation</span><span><b>The shortlist</b> · ${D.map(d => `<span class="nw">${esc(d.name)} ${d.code}</span>`).join(' · ')} · <span class="nw">30 Oct 2026</span></span></div>
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
