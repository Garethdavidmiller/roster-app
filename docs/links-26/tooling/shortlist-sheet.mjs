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
import { SHORTLIST } from './fresh.mjs';
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
const SE = by('Second Edition'), SR = by('Short Run'), EK = by('Even Keel'), CT = by('Closing Time');
const N = word(D.length), others = stats.filter(s => !SHORTLIST.includes(s.name)).map(s => design(s.name));

/** A figure the prose says every shortlisted design shares — refused unless it is. */
const shared = (what, get) => { const v = D.map(d => get(d.F)); if (!v.every(x => x === v[0])) throw new Error(`"${what}" is printed as shared but is not: ${D.map((d, i) => `${d.name} ${v[i]}`).join(', ')}`); return v[0]; };
/** A sentence the prose rests on — refused unless it holds. */
const claim = (what, ok) => { if (!ok) throw new Error(`the sheet says "${what}", and the figures no longer do`); };
const lowest = get => Math.min(...D.map(d => get(d.F))), highest = get => Math.max(...D.map(d => get(d.F)));

// what the four share, each one asserted before it is printed
const met = shared('December rules met', F => F.met), wkOff = shared('full weekends off', F => F.A.checks.weekendsOff), gap = shared('longest wait between weekends', F => F.maxGap);
const days = shared('days a year', F => F.pp.daysYear.toFixed(1)), longest = shared('longest shift', F => F.pp.longest);
const iso = shared('single rest days', F => F.A.feel.isolatedRest), paired = shared('rest-day breaks', F => `${F.A.feel.pairedRest} of ${F.A.feel.restIslands}`);
shared('fatigue warnings, fixed', F => F.A.fixed.present); shared('fatigue warnings, worst case', F => F.A.fatigue.present);
claim('no avoidable fatigue warning', CT.F.A.fixed.present === 0 && CT.F.A.fatigue.present === 0);
claim('the three flexible rules, bar Closing Time’s closer', D.every(d => d === CT ? d.F.flex === 2 && d.F.flexMissed.join() === 'closer' : d.F.flex === 3));
const cuts = D.flatMap(d => d.F.closers.map((c, i) => TF.closers[i] - c)); claim('every closing shift shorter', Math.min(...cuts) > 0);

// each one's edge, and the reasons the recommendation gives
claim('Second Edition: the gentlest step, and the only sixth day', SE.F.step === lowest(F => F.step) && D.every(d => d === SE || d.F.fixedRun < SE.F.fixedRun));
claim('Short Run: Second Edition’s duty table', SR.F.A.tableRows.map(r => r.time).join() === SE.F.A.tableRows.map(r => r.time).join() && SR.F.fit.join() === SE.F.fit.join());
claim('Even Keel: a fourth to the Saturday close', EK.F.A.heads.close.sat === 4 && D.every(d => d === EK || d.F.A.heads.close.sat === 3));
claim('Closing Time: one closer time Monday to Saturday, the shortest', CT.F.closers[0] === CT.F.closers[1] && CT.F.closers[0] < lowest(F => F === CT.F ? Infinity : Math.min(...F.closers.slice(0, 2))));
claim('the other three share their closers, late finishes and weeks on one turn', [SE, SR, EK].every(d => d.F.closers.join() === SE.F.closers.join() && d.F.late22 === SE.F.late22 && d.F.A.feel.oneTurn === SE.F.A.feel.oneTurn));
claim('a cover week placed badly makes six for all four', shared('worst-case run', F => F.worstRun) === 6);
claim('Closing Time: today’s 13:45 every weekday', MS.slice(0, 5).every(d => Object.values(CT.F.p).some(r => r[d] === '06:20-13:45')));

// the others: what each keeps that none of the four has, asserted; and the two that keep nothing
const DIR = { fixedRun: -1, worstRun: -1, heavy: -1, light: 1, rest: 1, one: 1, mixed: -1, block: -1, step: -1, late23: -1, late22: -1, newT: -1, times: -1, fit: -1, closers: -1, lvBest: 1, lvWorst: 1, lvFour: -1, iso: -1 };
const measure = F => ({ fixedRun: F.fixedRun, worstRun: F.worstRun, heavy: F.heavy, light: F.light, rest: F.A.rest.minutes, one: F.A.feel.oneTurn, mixed: F.A.feel.hybrid, block: F.block.worst,
  step: Math.round(F.step), late23: F.late23, late22: F.late22, newT: F.newT, times: F.times, fit: F.fit[0] + F.fit[1] + F.fit[2], closers: F.closers[0] + F.closers[1] + F.closers[2],
  lvBest: F.lv.best, lvWorst: F.lv.worst, lvFour: F.lv.fourWeeks, iso: F.A.feel.isolatedRest });
const keeps = d => { const x = measure(d.F); return Object.keys(DIR).filter(k => D.every(s => DIR[k] * (x[k] - measure(s.F)[k]) > 0)).sort(); };
const O = Object.fromEntries(others.map(d => [d.name, d])), K = Object.fromEntries(others.map(d => [d.name, keeps(d).join()]));
const NAMED = { 'Long Break': 'lvBest,lvFour', 'Home Grown': 'newT,times', 'Both Ways': 'heavy,newT', 'Second Look': 'block', 'Second Nature': 'block', 'Second Sight': 'block', 'Second Wind': 'block', 'Fine Tune': '', 'Second Gear': '' };
claim('the paragraph names every other design, and what it keeps', Object.keys(NAMED).sort().join() === Object.keys(O).sort().join() && Object.entries(NAMED).every(([n, k]) => K[n] === k));
const LB = O['Long Break'].F, HG = O['Home Grown'].F, BW = O['Both Ways'].F, sec = ['Second Look', 'Second Nature', 'Second Sight', 'Second Wind'];
claim('Both Ways: today’s 13:35 and 13:45 every weekday', MS.slice(0, 5).every(d => ['13:35', '13:45'].every(t => Object.values(BW.p).some(r => r[d] === `06:20-${t}`))));
claim('the four Second designs: blocks a week shorter, six days in a row', sec.every(n => O[n].F.block.worst === lowest(F => F.block.worst) - 1 && O[n].F.fixedRun === 6));

// THE REST OF THE SENTENCES (30 Oct 2026 review). The header said every comparing sentence was asserted; an outside review
// found two dozen that were not — all true on the day, each typed by hand or read off one design, and so each one waiting
// for the next re-cut of a design to make it false without a word. In the order the sheet prints them:
const range = F => F.heavy - F.light, ratio = F => F.A.feel.pairedRest / F.A.feel.restIslands, total = F => F.fit[0] + F.fit[1] + F.fit[2];
// page 1, what all four share: each line better than or level with today
claim('all 9 of 9 December rules, today fewer', met === 9 && TF.met < 9);
claim('no avoidable fatigue warning and a shorter worst-case run, where today has both', shared('worst-case run', F => F.worstRun) < TF.worstRun && TF.A.fatigue.present > 0);
claim('more full weekends a year, never as far apart', wkOff / LINES > TF.A.checks.weekendsOff / 20 && gap < TF.maxGap);
claim('days a year under the ceiling of 219, and no more than today', +days < 219 && +days <= +TF.pp.daysYear.toFixed(1));
claim('single rest days as today, the rest in pairs or longer at least as often', iso === TF.A.feel.isolatedRest && D.every(d => ratio(d.F) >= ratio(TF)));
claim('what all four share that is worse than today: late finishes, leave, Saturdays, new times', lowest(F => F.late23) > TF.late23 && lowest(F => F.late22) > TF.late22
  && lowest(F => F.lv.fourWeeks) > TF.lv.fourWeeks && highest(F => F.lv.best) < TF.lv.best && lowest(F => Math.round(F.pp.sat)) > Math.round(TF.pp.sat) && lowest(F => F.newT) > TF.newT);
// page 1, each one's edge
claim('Short Run: the closest weekday fit, and one heaviest week, heavier than Second Edition’s', SR.F.fit[0] === lowest(F => F.fit[0]) && SR.F.heavyWeeks === 1 && SR.F.heavy > SE.F.heavy);
claim('Even Keel: the heaviest week and shortest rest of Closing Time', EK.F.heavy === CT.F.heavy && EK.F.A.rest.minutes === CT.F.A.rest.minutes);
claim('Even Keel: its own late finishes, the others one figure', [SE, SR, CT].every(d => d.F.late23 === SE.F.late23) && EK.F.late23 > SE.F.late23);
claim('Closing Time: every closer Monday to Saturday starts at 16:00', closerStarts(CT.F.p).join() === '16:00');
claim('Closing Time pays with more finishes at 22:00 and fewer weeks on one turn', CT.F.late22 > SE.F.late22 && CT.F.A.feel.oneTurn < SE.F.A.feel.oneTurn);
// page 1, the guide
claim('the guide: Short Run, five-day runs, the most weeks on one turn, the fewest late finishes', SR.F.fixedRun === 5 && SR.F.fixedRun === lowest(F => F.fixedRun)
  && SR.F.A.feel.oneTurn === highest(F => F.A.feel.oneTurn) && SR.F.late23 === lowest(F => F.late23) && SR.F.late22 === lowest(F => F.late22));
claim('the guide: Closing Time, the fewest new shift times and the most even weeks', D.every(d => d === CT || (d.F.newT > CT.F.newT && range(d.F) > range(CT.F))));
claim('the guide: Long Break, outside the shortlist, four weeks off for today’s 14 days', !SHORTLIST.includes('Long Break') && LB.lv.fourWeeks === 14 && TF.lv.fourWeeks === 14);
// page 2, why these four
claim('Long Break: a fifth single rest day, for fewer weeks on one turn and a rougher step', LB.A.feel.isolatedRest === iso + 1
  && LB.A.feel.oneTurn < lowest(F => F.A.feel.oneTurn) && Math.round(LB.step) > highest(F => Math.round(F.step)));
claim('Home Grown and Both Ways: each a weaker fit, Sunday most, the same weeks on one turn and fewer, and a rougher step', [HG, BW].every(X => total(X) > highest(total)
  && [0, 1].every(i => X.fit[2] - lowest(F => F.fit[2]) > X.fit[i] - lowest(F => F.fit[i])) && X.A.feel.oneTurn === HG.A.feel.oneTurn
  && X.A.feel.oneTurn < lowest(F => F.A.feel.oneTurn) && Math.round(X.step) > highest(F => Math.round(F.step))));
claim('the four Second designs: fewer weeks on one turn', sec.every(n => O[n].F.A.feel.oneTurn < lowest(F => F.A.feel.oneTurn)));
// page 2, the honest costs
claim('three or more to the close every day, where today’s weekdays have two', D.every(d => Object.values(d.F.A.heads.close).every(x => x >= 3)) && TF.A.heads.close.mon === 2);
claim('no design here meeting all 9 rules has fewer finishes at 23:00 or later', [...D, ...others].filter(d => d.F.met === 9).every(d => d.F.late23 >= SE.F.late23));
claim('the worst leave stretch a day better than today’s', shared('worst leave stretch', F => F.lv.worst) === TF.lv.worst + 1);
claim('Long Break alone keeps four weeks off for 14 days', others.filter(d => d.F.lv.fourWeeks <= TF.lv.fourWeeks).map(d => d.name).join() === 'Long Break');
// page 2, the recommendation
claim('Short Run against Closing Time: the same five-day runs, more weeks on one turn, the closer weekday fit, fewer finishes at 22:00',
  SR.F.fixedRun === CT.F.fixedRun && SR.F.A.feel.oneTurn > CT.F.A.feel.oneTurn && SR.F.fit[0] < CT.F.fit[0] && SR.F.late22 < CT.F.late22);
claim('Closing Time’s weeks more even than Short Run’s', range(CT.F) < range(SR.F));
claim('Even Keel: more late finishes and more new times than Short Run, on its own duty table', EK.F.late23 > SR.F.late23 && EK.F.newT > SR.F.newT
  && new Set([SE, EK, CT].map(d => d.F.A.tableRows.map(r => r.time).join())).size === 3);
claim('Second Edition: a lighter heaviest week than Short Run, for six days in a row', SE.F.heavy < SR.F.heavy && SE.F.fixedRun === 6);

// the league's spread, from league.mjs itself rather than copied out of its console
const tmp = mkdtempSync(`${tmpdir()}/league-`);
execFileSync('node', [new URL('./league.mjs', import.meta.url).pathname], { env: { ...process.env, REF_IN_RANGE: '1', JSON: `${tmp}/league.json` }, stdio: 'ignore' });
const LG = JSON.parse(readFileSync(`${tmp}/league.json`, 'utf8')).proposals.filter(r => SHORTLIST.includes(r.name)); rmSync(tmp, { recursive: true });
claim('the league scores every shortlisted design', LG.length === D.length);
const top = Math.max(...LG.map(r => r.total)), spread = top - Math.min(...LG.map(r => r.total)), within = Math.ceil(spread * 2) / 2;
const leaders = LG.filter(r => top - r.total < 0.1).map(r => r.name);
const pointsText = within === 0.5 ? 'half a point' : within === 1 ? 'a point' : within === 1.5 ? 'a point and a half' : `${within} points`;
const list = a => a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;

const sunFit = shared('Sunday fit', F => F.fit[2].toFixed(1));
// the comparison rows: label, how to read each design, which direction is better (1 = higher is better, -1 = lower), format
const ROWS = [
  ['Most days in a row, fixed rota', F => F.fixedRun, -1, v => `${v}`],
  ['Heaviest week', F => F.heavy, -1, hm],
  ['Lightest week', F => F.light, 1, hm],
  ['Shortest rest between shifts', F => F.A.rest.minutes, 1, hm],
  ['Closing shift, weekday', F => F.closers[0], -1, hm],
  ['Closing shift, Saturday', F => F.closers[1], -1, hm],
  ['Weeks on one turn (one shift time Mon–Fri, no mixing)', F => F.A.feel.oneTurn, 1, (v, F) => `${v} of ${F.A.feel.workingLines}`],
  ['Weeks mixing earlies and lates', F => F.A.feel.hybrid, -1, v => `${v}`],
  // ranked on the worst case: the fixed-rota block is the same on all four, the cover weeks are what separate them
  ['Longest block of earlies or lates (up to: with cover weeks)', F => F.block.worst, -1, (v, F) => blockText(F.block)],
  ['Week-to-week change of start time', F => F.step, -1, hm],
  ['Finishing at 23:00 or later, each a year', F => F.late23, -1, v => `${v}`],
  ['Finishing at 22:00 or later, each a year', F => F.late22, -1, v => `${v}`],
  ['Shift times to learn that are new', F => F.newT, -1, (v, F) => `${v} of ${F.times}`],
  // two of the three days: Sunday is the same on all four, and says so in the label (a third figure per cell squeezed the
  // label column to a word a line once there were four designs)
  [`Fit to the trains, weekday · Sat (0 = exact; Sunday ${sunFit} on all ${N}, today ${TF.fit[2].toFixed(1)})`, F => F.fit[0] + F.fit[1], -1, (v, F) => F.fit.slice(0, 2).map(x => x.toFixed(1)).join('\u00a0·\u00a0'), 'fit', F => F.fit.slice(0, 2)],
];
const sunCloser = shared('Sunday closer', F => F.closers[2]);
const best = (get, dir) => { const vals = D.map(d => get(d.F)); const b = dir > 0 ? Math.max(...vals) : Math.min(...vals); return vals.map(v => v === b); };
// A CELL OF TWO FIGURES IS MARKED FIGURE BY FIGURE (30 Oct 2026). The fit row was ranked on weekday plus Saturday, so the
// whole cell went bold for Second Edition and Short Run — Saturday 12.7 included, when Closing Time's 8.7 is the best
// Saturday of the four. A row that names its parts (the sixth entry) bolds each part where it is the best of its kind.
// Compared as printed, to one decimal, so two figures that read alike are marked alike.
const partsHtml = (parts, dir, i) => parts(D[i].F).map((x, j) => { const r = v => Math.round(v * 10) / 10, col = D.map(d => r(parts(d.F)[j]));
  const b = dir > 0 ? Math.max(...col) : Math.min(...col);
  return r(x) === b && !col.every(v => v === b) ? `<span class="bestv">${esc(x.toFixed(1))}</span>` : esc(x.toFixed(1)); }).join('\u00a0·\u00a0');
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

const wl = shared('working weeks', F => F.A.feel.workingLines), wk = i => ['a weekday', 'a Saturday', 'a Sunday'][i];
const ctCut = [0, 1].map(i => SR.F.closers[i] - CT.F.closers[i]);   // Closing Time against Short Run's closers, weekday and Saturday
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

  <h2>What all ${N} share</h2>
  <p class="lead">${Word(stats.length)} designs are in the pack; these ${N} balance best what weighs most here. Everything below holds for all ${N}, each line better than or level with today; what they share that is worse than today is on page 2.</p>
  <div class="shared">
    <div>All <b>${met} of 9</b> December staffing rules (today ${TF.met}), and the flexible ones bar one: Closing Time’s brief moved its closer from 15:45 to 16:00</div>
    <div><b>No avoidable fatigue warning</b>, and never more than ${shared('worst-case run', F => F.worstRun)} days in a row even with a cover week placed badly (today ${TF.A.fatigue.present} warnings, up to ${TF.worstRun} days)</div>
    <div><b>${wkOff} full weekends off in 26</b>, never more than ${gap} weeks apart (today ${TF.A.checks.weekendsOff} in 20, up to ${TF.maxGap} apart)</div>
    <div>The same <b>35-hour</b> week and <b>${days} days</b> a year, under the ceiling of 219 (today ${TF.pp.daysYear.toFixed(1)})</div>
    <div>Every closing shift <b>shorter, by ${dur(Math.min(...cuts))} to ${dur(Math.max(...cuts))}</b> — Sunday’s ${hm(sunCloser)} on all ${N} (today ${hm(TF.closers[2])}); no shift over ${hm(longest)}</div>
    <div><b>${iso} single rest days</b>, as today; rest days otherwise in pairs or longer (${paired} breaks, today ${TF.A.feel.pairedRest} of ${TF.A.feel.restIslands})</div>
  </div>

  <h2>Where they differ<span class="note">the best of the ${N} on each line in bold green; today for scale, not ranked</span></h2>
  <table class="t"><thead><tr><th>Measure</th><th class="num">Today</th>${D.map(d => `<th class="num">${esc(d.name)}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table>

  <h2>Each one’s edge</h2>
  <div class="cards">
    <div class="card"><span class="head"><b class="k">Second Edition</b><span class="code">${SE.code} · ${SE.fp}</span></span><b class="edge">The steadiest.</b>One shift time Monday to Friday in ${SE.F.A.feel.oneTurn} of ${wl} weeks and the gentlest week-to-week change of the ${N}, ${hm(SE.F.step)}. Its cost is the one the other ${word(D.length - 1)} have shed: ${word(SE.F.fixedRun)} days in a row on the fixed rota.</div>
    <div class="card"><span class="head"><b class="k">Short Run</b><span class="code">${SR.code} · ${SR.fp}</span></span><b class="edge">Second Edition without the sixth day.</b>The same duty table — the closest fit to the weekday trains, ${SR.F.A.feel.oneTurn} weeks on one turn — with no run over ${SR.F.fixedRun} days on the fixed rota, for one ${hm(SR.F.heavy)} week (Second Edition ${hm(SE.F.heavy)}) and a ${hm(SR.F.step)} step.</div>
    <div class="card"><span class="head"><b class="k">Even Keel</b><span class="code">${EK.code} · ${EK.fp}</span></span><b class="edge">A fourth person to the Saturday close.</b>Its own duty table: no week over ${hm(EK.F.heavy)} and at least ${hm(EK.F.A.rest.minutes)} between shifts, as on Closing Time — for ${EK.F.late23} late finishes a year (the others ${SE.F.late23}), ${EK.F.newT} new times, ${EK.F.A.feel.hybrid} mixed ${many(EK.F.A.feel.hybrid, 'week')} and a block of ${EK.F.block.worstKind === 'L' ? 'lates' : 'earlies'} up to ${EK.F.block.worst} weeks.</div>
    <div class="card"><span class="head"><b class="k">Closing Time</b><span class="code">${CT.code} · ${CT.fp}</span></span><b class="edge">The shortest closers.</b>Today’s link on 26 lines: every closer Monday to Saturday starts at 16:00, ${hm(CT.F.closers[0])} (the others ${hm(SE.F.closers[0])}, and ${hm(SE.F.closers[1])} on a Saturday); today’s 13:45 stays; weeks run ${hm(CT.F.light)} to ${hm(CT.F.heavy)}. It pays with ${CT.F.late22} finishes a year at 22:00 or later (the others ${SE.F.late22}) and ${CT.F.A.feel.oneTurn} weeks on one turn (the others ${SE.F.A.feel.oneTurn}).</div>
  </div>
  <h2>Which one, by what matters most</h2>
  <table class="t guide"><thead><tr><th>If the main priority is</th><th>Choose</th></tr></thead><tbody>
    <tr><td>Five-day runs, the most weeks on one turn, and the fewest late finishes</td><td><b>Short Run</b></td></tr>
    <tr><td>The shortest closing shifts, and the fewest new shift times to learn</td><td><b>Closing Time</b></td></tr>
    <tr><td>A fourth person to the Saturday close</td><td><b>Even Keel</b></td></tr>
    <tr><td>The steadiest start times from week to week</td><td><b>Second Edition</b></td></tr>
    <tr><td>Four weeks off for 14 days’ leave, as today</td><td><b>Long Break</b> <span class="muted">· outside the shortlist</span></td></tr>
  </tbody></table>
  <div class="foot"><span>Page 1 of 2 — what they share, where they differ, which to choose · every figure computed from the rotas</span><span><b>The shortlist</b> · ${D.map(d => `<span class="nw">${esc(d.name)} ${d.code}</span>`).join(' · ')} · <span class="nw">30 Oct 2026</span></span></div>
</section>

<section class="page">
  <div class="mast"><div><div class="eyebrow">The shortlist · continued</div><h1>Against today, and a recommendation</h1>
  <div class="sub">On most of what a colleague feels the ${N} are the same — a figure in grey is shared by all ${N}</div></div></div>

  <h2>Against today’s link</h2>
  <table class="t"><thead><tr><th>Measure</th><th class="num">Today</th>${D.map(d => `<th class="num">${esc(d.name)}</th>`).join('')}</tr></thead><tbody>${todayHtml}</tbody></table>
  <p class="muted">Per year: the rotation’s count scaled to 52 weeks. Days a year are Monday to Saturday, a cover week counting four.</p>

  <h2>Why these ${N} and not the other ${word(others.length)}</h2>
  <p>These ${N} balance best what weighs most here — days in a row, weekends, one shift time a week, late finishes. Most others keep something none of the ${N} has, at a price: Long Break four weeks off for ${LB.lv.fourWeeks} days’ leave and a ${LB.lv.best}-day best stretch, for a ${ord(LB.A.feel.isolatedRest)} single rest day, ${LB.A.feel.oneTurn} weeks on one turn and a ${hm(LB.step)} step; Home Grown ${HG.times} shift times, only ${HG.newT} of them new, and Both Ways today’s 13:35 and 13:45 every weekday, a ${hm(BW.heavy)} heaviest week and only ${BW.newT} new times, each for a weaker fit to the trains (Sunday most), ${HG.A.feel.oneTurn} weeks on one turn and a rougher step; and ${list(sec)} blocks of earlies or lates a week shorter, for ${word(O['Second Look'].F.fixedRun)} days in a row on the fixed rota and fewer weeks on one turn. Fine Tune and Second Gear keep nothing the ${N} lack.</p>
  <h2>The honest costs, shared by all ${N}</h2>
  <ul class="list">
    <li><b>Late finishes.</b> ${SE.F.late23} a year each at 23:00 or later (today ${TF.late23}), ${EK.F.late23} on Even Keel; ${SE.F.late22} at 22:00 or later (today ${TF.late22}), ${CT.F.late22} on Closing Time. Three to the close every day, where today’s weekdays have two, means no link meeting the rules has fewer than ${SE.F.late23} at 23:00 or later.</li>
    <li><b>Leave.</b> The best 14-day stretch is ${shared('best leave stretch', F => F.lv.best)} days off, not today’s ${TF.lv.best}; four full weeks off, Sunday to Saturday, takes ${shared('leave for four weeks', F => F.lv.fourWeeks)} days’ leave, not ${TF.lv.fourWeeks}. The worst stretch is a day better. All ${N} are worse than today here, on something people plan a year around; Long Break alone keeps the 14.</li>
    <li><b>Saturdays.</b> About ${shared('Saturdays a year', F => Math.round(F.pp.sat)) - Math.round(TF.pp.sat)} more a year each (${Math.round(SE.F.pp.sat)}, today ${Math.round(TF.pp.sat)}) — ${word(shared('Saturday duties', F => F.satDuties))} on a Saturday, the flexible rule, shared across ${LINES} lines (today ${word(TF.satDuties)} across 20).</li>
    <li><b>New times.</b> ${SE.F.newT} of ${SE.F.times} shift times are new on Second Edition and Short Run (${SE.F.shared} are worked today), ${EK.F.newT} of ${EK.F.times} on Even Keel and ${CT.F.newT} of ${CT.F.times} on Closing Time. Several of the new ones are shorter versions of today’s lates: every closer starts later, and the Sunday office late finishes earlier.</li>
  </ul>

  <h2>Recommendation</h2>
  <div class="callout pick"><b>Short Run.</b> It is Second Edition’s duty table laid without the six-day stretch: ${SE.F.fixedRun} days in a row on Second Edition’s fixed rota, never more than ${SR.F.fixedRun} on Short Run’s (six for all ${N} if a cover week falls badly), for ${dur(SR.F.heavy - SE.F.heavy)} on the heaviest week and ${dur(SR.F.step - SE.F.step)} on the week-to-week step. Against Closing Time, with the same five-day runs and weekends, it keeps ${word(SR.F.A.feel.oneTurn - CT.F.A.feel.oneTurn)} more ${many(SR.F.A.feel.oneTurn - CT.F.A.feel.oneTurn, 'week')} on one shift time, the closer fit to the weekday trains (${SR.F.fit[0].toFixed(1)} against ${CT.F.fit[0].toFixed(1)}) and ${CT.F.late22 - SR.F.late22} fewer finishes a year at 22:00 or later; Closing Time’s closers are shorter, by ${dur(ctCut[0])} on ${wk(0)} and ${dur(ctCut[1])} on ${wk(1)}, and its weeks more even. It weighs a sixth day in a row most, then late finishes and one shift time a week; a colleague who weighs the closing shift most may reasonably prefer Closing Time, and steady start times, Second Edition.</div>
  <p class="lead" style="margin-top:8px"><b>But the choice is closer than the tables make it look.</b> On the app’s weighted league the ${N} finish within ${pointsText} of each other out of a hundred, ${esc(list(leaders))} ${leaders.length > 1 ? 'level at the top' : 'at the top'}. So choose by the edge that matters here:</p>
  <ul class="list">
    <li><b>Choose Short Run</b> if days in a row and late finishes are what colleagues raise first.</li>
    <li><b>Choose Closing Time</b> if the closing shift matters most: a 16:00 closer Monday to Saturday, today’s 13:45 kept, the fewest new times and the most even weeks — for ${CT.F.late22 - SR.F.late22} more finishes a year at 22:00 or later.</li>
    <li><b>Choose Even Keel</b> if a fourth person to the Saturday close matters more than ${word(EK.F.late23 - SR.F.late23)} late ${many(EK.F.late23 - SR.F.late23, 'finish', 'finishes')} a year and ${EK.F.newT - SR.F.newT === 1 ? `a ${ord(EK.F.newT)} new time` : `${word(EK.F.newT - SR.F.newT)} more new times`}. Like Closing Time it is on its own duty table — a genuine alternative, not a variant.</li>
    <li><b>Choose Second Edition</b> if steady shift times week to week carry the day: the gentlest change of the ${N} and a lighter heaviest week than Short Run, at the price of the six-day stretch.</li>
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
