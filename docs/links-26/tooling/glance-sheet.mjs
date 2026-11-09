// THE SHORTLIST AT A GLANCE (9 Nov 2026, owner: "Can you create a one page highly polished comparison at a glance sheet
// between the 3 proposals and today's roster"). One page: what the three share against today (better, the same, worse),
// where they differ from each other with today for scale, and each one's edge and cost. It is the shortlist sheet's story
// for someone with a minute, not a second copy of its tables.
//
// AUDITED THE SAME DAY (owner: "audit it for clarity, comparability and improvements"): a colleague's reading of the page
// alone, and a comparability audit against this code and the rest of the pack. The README has what changed. The rules the
// audit left are here, each beside the lines it governs; the one that mattered most is THE WORST SEVEN DAYS, below.
//
// THE FIGURES ARE what-it-means-data.mjs's, which are deck-check.mjs's (the decks' own) and the grids' counts, so this page,
// the What it means sheet, the New link page and the decks cannot quote different figures. Counted here from the grids, each
// with the pack's own function or the shortlist sheet's own count: the rostered Sundays inside the best stretch of days off
// that 14 days' leave buys (leave.mjs's walk), the worst seven days (report-data.mjs's h55Worst), the shifts over 8h 30m, the
// weeks on one shift time a year and the weeks mixing earlies and lates. NOTHING ON THE PAGE IS TYPED: every panel line is
// asserted on all three, every edge and cost against the figures by the shortlist sheet's own rule, and a row's colour comes
// from its direction, so a design that stops fitting a sentence stops the sheet.
//
// Run it after deck-polish.py and what-it-means-sheet.mjs, as the data module reads the decks back:
//   node docs/links-26/tooling/glance-sheet.mjs   → docs/links-26/links-26-shortlist-at-a-glance.pdf
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { DAYS as GRID_DAYS } from '../../../links-design.js';
import { TC, C, BV, LC, MG, RATE, H, Hmax, first, hm, perYear, mins, claim, tidyText } from './what-it-means-data.mjs';
import { leaveRuns } from './leave.mjs';
import { folderStats, h55Worst, assess } from './report-data.mjs';
import { longDates } from './link.mjs';

const ROOT = new URL('../../../', import.meta.url).href.replace(/\/$/, '');
const OUT = fileURLToPath(new URL('../links-26-shortlist-at-a-glance.pdf', import.meta.url));
const PREPARED = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const COLS = [TC, ...C];                       // today, then the three A to Z, as the data module orders them
const upTo = v => { const u = /up to (\d+)/.exec(v); return u ? +u[1] : first(v); };   // "5 (up to 10)" → 10, "0" → 0
const lines = c => Object.keys(c.p).length;
const others = c => C.filter(x => x !== c);
// AN EDGE OR A COST BY THE SHORTLIST SHEET'S RULE (shortlist-sheet.mjs → clearBest; both deck audits, 8 Nov 2026): better or
// worse than BOTH of the others by more than 5%, the band report-data.mjs's fitCmp calls "about the same". The first print
// claimed Middle Ground's leave worst case (20 against 19, exactly 5%) and its shortest Sundays (2%) on a strict test
const clear = (v, rest, high = false) => rest.every(o => high ? o < 0.95 * v : v < 0.95 * o);

// ── WHAT IS COUNTED HERE ────────────────────────────────────────────────────────────────────────────────────────────
const stats = folderStats();
const fingerprint = p => createHash('sha256').update(JSON.stringify(Object.keys(p).sort((a, b) => a - b).map(k => GRID_DAYS.map(d => p[k][d])))).digest('hex').slice(0, 8);
for (const c of C) { const s = stats.find(x => x.name === c.name); claim(`${c.name} is a design in the pack`, !!s);
  c.code = s.code; c.fp = fingerprint(c.p);   // the fingerprint its proposal sheet is named by, so the two cannot disagree
  claim(`${c.name}'s fingerprint ${c.fp} names its proposal sheet`, existsSync(fileURLToPath(new URL(`../${s.dir}/${s.file.replace(/\.json$/, '')}-${c.fp}.pdf`, import.meta.url)))); }
for (const c of COLS) {
  const L = lines(c);
  // the rostered Sundays inside the best stretch: leave.mjs's runs, the fewest over the first days that reach the best
  const seq = Object.keys(c.p).sort((a, b) => a - b).flatMap(k => GRID_DAYS.map(d => ({ sun: d === 'sun', v: c.p[k][d] })));
  const runs = leaveRuns(c.p, 14), best = Math.max(...runs), n = seq.length;
  c.bestRun = best;
  c.sunsIn = Math.min(...runs.map((r, s) => r < best ? Infinity : Array.from({ length: best }, (_, j) => seq[(s + j) % n]).filter(x => x.sun && x.v !== 'RD' && x.v !== 'SPARE').length));
  // THE WORST SEVEN DAYS, WHATEVER MAKES THEM (the audit, 9 Nov 2026). The first print read the decks' h55, which is filled
  // only where a COVER WEEK adds a 55-hour week, and printed "never" where it was blank. Today's set duties already have one,
  // 60h 45m, so today read "never" and the two designs better than it read worse. hiMin is the worst seven days with the
  // cover weeks placed worst, each duty 8 hours (the proposal sheets' reading); tableMin the set duties alone
  const w = h55Worst(c.p, L); c.most7 = w.hiMin; c.most7Long = w.hi35Min; c.set7 = w.tableMin;
  c.newT = c === TC ? 0 : (t => +t[1] - +t[2])(/^(\d+) \((\d+) you know\)$/.exec(c.f.times));   // the decks' "17 (9 you know)"
  c.longMS = Math.round(perYear(c.p, (s, d) => d !== 'sun' && mins(s) > 510));   // shifts over 8h 30m, Mon–Sat, a year: the shortlist's count
  c.longAny = Math.round(perYear(c.p, s => mins(s) > 510));                       // the same on any day, Sunday included
  c.oneYear = Math.round(first(c.f.oneTurn) * 52 / L);                            // weeks on one shift time a year, as the shortlist's page 2
  const A = assess(c.p, L);
  c.mixed = A.feel.hybrid;                                                        // weeks mixing earlies and lates, in the rotation
  c.standing = A.fatigue.results.filter(r => r.status === 'standing').map(r => r.code).sort().join();
}
claim('the best stretch is the leave figure the decks print, today and on all three', COLS.every(c => c.bestRun === +c.f.leaveBest));
claim('the worst seven days are never fewer than the set duties’ own', COLS.every(c => c.most7 >= c.set7));
claim('today’s set duties already work more than 55 hours in seven days, as its proposal sheets print', TC.set7 > 55 * 60);
claim('the decks’ 55-hour figure is the worst seven days wherever a cover week adds the week, and blank only where it does not',
  C.every(c => c.f.h55 ? H(c.f.h55) === c.most7 : !(c.most7 > 55 * 60 && c.set7 <= 55 * 60)));   // in minutes: the decks' text has a plain space, hm a no-break one
claim('a cover duty of 8h 45m instead of 8 hours moves no column to the other side of today, or of 55 hours',
  C.every(c => Math.sign(c.most7 - TC.most7) === Math.sign(c.most7Long - TC.most7Long) && (c.most7 > 55 * 60) === (c.most7Long > 55 * 60)));
claim('no rest-day break over four days on any of the four, so "three or four days" counts every break of three days or more', COLS.every(c => c.longOver4 === 0));
claim('the two standing fatigue factors the notes name, early starts (FF2) and a weekly rotation (FF18), on all four and no others', COLS.every(c => c.standing === 'FF18,FF2'));

// ── WHICHEVER IS CHOSEN: three panels, every line the same on all three ─────────────────────────────────────────────
const same = (k, f = v => v) => { const v = C.map(c => f(c.f[k])); claim(`${k}: the same on all three`, v.every(x => x === v[0])); return v[0]; };
const rest3 = Math.min(...C.map(c => H(c.f.rest)));
const BETTER = [
  // EVERY LINE HERE IS THE SET DUTIES' (the rules, the floor, the closers, the fixed duties' warnings, run and rest), so the
  // panel's heading says "cover weeks aside" once, where two lines carrying it each wrapped to four
  { big: `${same('met')} of 9`, what: 'December timetable staffing rules met', was: `today ${TC.f.met} of 9`, ok: +same('met') > +TC.f.met },
  { big: same('floorMin'), what: 'on the floor at all times', was: `today ${TC.f.floorMin}`, ok: +same('floorMin') > +TC.f.floorMin },
  { big: hm(H(same('closerWk'))), what: 'longest weekday closing shift', was: `today ${hm(H(TC.f.closerWk))}`, ok: H(same('closerWk')) < H(TC.f.closerWk) },
  { big: String(same('ff', first)), what: 'avoidable fatigue warnings', was: `today ${first(TC.f.ff)}`, ok: same('ff', first) < first(TC.f.ff) },
  { big: String(same('run', first)), what: 'days in a row at most', was: `today ${first(TC.f.run)}`, ok: same('run', first) < first(TC.f.run) },
  // THE SHORTEST REST IS THE LEAST OF THE THREE: 14h 20m, 14h 20m and 14h 35m, within the 5% the shortlist sheet calls "about
  // the same" (it rules it no edge of Middle Ground's), so it is shared here rather than a row that bolds a 15-minute lead
  { big: hm(rest3), what: 'rest between shifts, at least', was: `today ${hm(H(TC.f.rest))}`,
    ok: rest3 > H(TC.f.rest) && !C.some(c => clear(H(c.f.rest), others(c).map(x => H(x.f.rest)), true)) },
];
const ASNOW = [
  { big: same('leaveBest'), what: 'days off in a row for 14 days’ leave', was: 'at best, as today', ok: same('leaveBest') === TC.f.leaveBest },
  { big: same('leaveFour'), what: 'days’ leave for four full weeks off', was: 'Sunday to Saturday, as today', ok: same('leaveFour') === TC.f.leaveFour },
  { big: same('hours'), what: `week, ${same('daysYear')} contracted days a year`, was: `today ${TC.f.daysYear}`, ok: same('hours') === TC.f.hours && Math.abs(+same('daysYear') - +TC.f.daysYear) < 1 },
];
const COSTS = [
  { big: same('sat'), what: 'Saturdays at work, a year', was: `today ${TC.f.sat}`, ok: +same('sat') > +TC.f.sat },
  { big: same('late22'), what: 'finishes at 22:00 or later, a year', was: `today ${TC.f.late22}`, ok: +same('late22') > +TC.f.late22 },
  { big: same('late23'), what: 'finishes at 23:00 or later, a year', was: `today ${TC.f.late23}`, ok: +same('late23') > +TC.f.late23 },
];
for (const [panel, rows] of [['better than today', BETTER], ['as today', ASNOW], ['a cost against today', COSTS]])
  for (const r of rows) claim(`${r.big} ${r.what}: ${panel}, on all three`, r.ok);

// ── WHERE THEY DIFFER ───────────────────────────────────────────────────────────────────────────────────────────────
// dir: 1 higher is better, -1 lower is better, 0 a matter of preference (no mark). n: the number compared, or a list compared
// part by part, with parts: what each part prints and sep between them; otherwise show: what the cell prints. rank: false is
// a row coloured against today but never bold, as the pack never ranks its pay rows. EVERY LABEL CARRIES ITS OWN BASIS (the
// audit): "a year" where a count is scaled to one, and nothing where it is the whole rotation or the worst of it
const BANDS = [
  { band: 'Leave and time off', icon: 'cal', rows: [
    { label: 'Days off in a row for 14 days’ leave, at worst', dir: 1, n: c => +c.f.leaveWorst, show: c => c.f.leaveWorst },
    { label: `Sunday overtime duties lost in the ${TC.f.leaveBest} days off`, dir: -1, n: c => c.sunsIn, show: c => String(c.sunsIn) },
    { label: 'Full weekends off, a year', dir: 1, n: c => +c.f.weekendsYear, show: c => c.f.weekendsYear },
    { label: 'Breaks of three or four rest days, a year', dir: 1, n: c => c.long34, show: c => String(c.long34) },
    { label: 'Single rest days, a year', dir: -1, n: c => c.singles, show: c => String(c.singles) },
  ] },
  { band: 'Your shifts', icon: 'clock', rows: [
    // A YEAR, NOT "7 of 16" AGAINST "7 of 21" (the audit): the same 7 marked worse read as a mistake, and 18 of 21 against
    // 7 of 16 as two and a half times as many, where a year is 36 against 18. The shortlist sheet's page 2 counts a year too
    { label: 'Weeks a year on one shift time, Mon–Fri', dir: 1, n: c => c.oneYear, show: c => String(c.oneYear) },
    { label: 'Average change of start time, week to week', dir: -1, n: c => H(c.f.step), show: c => hm(H(c.f.step)) },
    { label: 'Longest run of weeks of earlies, or of lates', dir: -1, n: c => [+c.f.block, +c.f.blockUpTo], parts: c => [c.f.block, `up to ${c.f.blockUpTo}`], sep: ', ' },
    { label: 'New shift times to learn', dir: -1, n: c => c.newT, show: c => c.newT ? String(c.newT) : 'none' },
    { label: 'Starts at 06:20, a year (a matter of taste)', dir: 0, n: c => +c.f.open0620, show: c => c.f.open0620 },
    { label: 'Earlies finishing before 14:00, a year', dir: 1, n: c => +c.f.shortYear, show: c => c.f.shortYear },
    { label: 'Shifts over 8h 30m, Mon–Sat, a year', dir: -1, n: c => c.longMS, show: c => c.longMS ? String(c.longMS) : 'none' },
    { label: 'Longest Saturday closing shift', dir: -1, n: c => Hmax(c.f.closerSat), show: c => hm(Hmax(c.f.closerSat)) },
  ] },
  { band: 'If a cover week falls badly', icon: 'warn', rows: [
    { label: 'Most days at work in a row', dir: -1, n: c => upTo(c.f.run), show: c => String(upTo(c.f.run)) },
    { label: 'Avoidable fatigue warnings', dir: -1, n: c => upTo(c.f.ff), show: c => upTo(c.f.ff) ? String(upTo(c.f.ff)) : 'none' },
    { label: 'Most hours in any seven days', dir: -1, n: c => c.most7, show: c => hm(c.most7) },
  ] },
  { band: 'Trains and pay', icon: 'train', rows: [
    { label: 'Fit to the trains, weekday · Sat · Sun (0 = exact)', dir: -1, n: c => [+c.f.fitWk, +c.f.fitSat, +c.f.fitSun], parts: c => [c.f.fitWk, c.f.fitSat, c.f.fitSun], sep: ' · ' },
    // TWO PEOPLE, NOT TWO PARTS OF ONE PAY (the audit): the Sundays figure is the Saturday premium AND the Sunday overtime
    // (what-it-means-data.mjs, "Premium and overtime pay"), so a reader adding the rows counted the Saturdays twice
    { label: 'Your pay, working your share of Sundays', dir: 1, today: '—', rank: false, n: c => -c.sundayLoss, show: c => `about £${c.sundayLoss} less` },
    { label: 'Your pay, working no overtime at all', dir: 1, today: '—', rank: false, n: c => c.noOtGain, show: c => `about £${c.noOtGain} more` },
  ] },
];
const ROWS = BANDS.flatMap(b => b.rows), rowOf = start => ROWS.find(r => r.label.startsWith(start));
const nums = (r, c) => [r.n(c)].flat(), texts = (r, c) => r.parts ? r.parts(c) : [r.show(c)];
// a cell against today: better, worse or level; a list is better or worse only when every part is
const vsToday = (row, c) => { if (!row.dir || row.today) return row.today && row.dir ? (row.n(c) > 0 ? 'better' : row.n(c) < 0 ? 'worse' : '') : '';
  const a = nums(row, c), t = nums(row, TC), cmp = a.map((v, i) => Math.sign((v - t[i]) * row.dir));
  return cmp.every(x => x > 0) ? 'better' : cmp.every(x => x < 0) ? 'worse' : cmp.every(x => x === 0) ? '' : 'mixed'; };
// THE BEST OF THE THREE, AS THE SHORTLIST SHEET MARKS ITS TABLE (the audit): figure by figure, every design at the best value,
// ties included, and none where all three share it. The first print bolded only an untied best, so three ties Balanced V6
// trails went unmarked while its own leads were bold
const bestAt = (r, c, j) => { if (!r.dir || r.rank === false) return false; const col = C.map(x => nums(r, x)[j]), b = r.dir > 0 ? Math.max(...col) : Math.min(...col);
  return nums(r, c)[j] === b && !col.every(v => v === b); };
for (const r of ROWS) claim(`${r.label}: the three differ, so the row belongs under "where they differ"`, new Set(C.map(c => nums(r, c).join())).size > 1);
claim('no cell is better on one figure and worse on another, so the legend needs no third mark', ROWS.every(r => C.every(c => vsToday(r, c) !== 'mixed')));
claim('a tie at the top is bold for every design tied: full weekends off, Level Crossing and Middle Ground', (r => bestAt(r, LC, 0) && bestAt(r, MG, 0) && !bestAt(r, BV, 0))(rowOf('Full weekends off')));
claim('the worst seven days: all three better than today, and Level Crossing the only one at 55 hours or under', C.every(c => vsToday(rowOf('Most hours'), c) === 'better') && C.filter(c => c.most7 <= 55 * 60).map(c => c.name).join() === LC.name);

// ── EACH ONE'S EDGE, AND ITS COST: the shortlist sheet's, by its rule ──────────────────────────────────────────────────
// THE SHORTLIST SHEET'S CARDS, NOT A NEW SELECTION (the audit): the first print chose its own, listing three of the seven
// costs the shortlist gives Balanced V6, and keeping two of Middle Ground's edges the 5% rule does not support. Each claim is
// that rule (clear), so a sentence that stops holding stops the sheet. "Of the three" wherever a design outside the shortlist
// does better (Second Edition's start times are steadier than Level Crossing's)
const one = c => c.oneYear, wkOff = c => +c.f.weekendsYear, step = c => H(c.f.step), ffW = c => upTo(c.f.ff), runW = c => upTo(c.f.run);
const opens = c => c.f.open.split(' · ').map(Number);   // at the open: weekday · Saturday · Sunday, the decks' heads
const CARDS = [
  { c: BV, edge: 'Of the three, the shortest runs of earlies or of lates, and the most breaks of three or four rest days; five at the Saturday open.',
    cost: 'The fewest weeks on one shift time, and the only ones mixing earlies and lates; the biggest change of start; the most single rest days; the fewest weekends off; the most fatigue warnings and days in a row if a cover week falls badly.',
    ok: clear(+BV.f.block, others(BV).map(c => +c.f.block)) && clear(+BV.f.blockUpTo, others(BV).map(c => +c.f.blockUpTo)) && clear(BV.long34, others(BV).map(c => c.long34), true)
      && opens(BV)[1] === 5 && others(BV).every(c => opens(c)[1] === 4)
      && clear(one(BV), others(BV).map(one)) && BV.mixed > 0 && others(BV).every(c => c.mixed === 0) && clear(step(BV), others(BV).map(step), true)
      && clear(BV.singles, others(BV).map(c => c.singles), true) && clear(wkOff(BV), others(BV).map(wkOff)) && clear(ffW(BV), others(BV).map(ffW), true) && clear(runW(BV), others(BV).map(runW), true) },
  // "however a cover week falls" is the claim: on the set duties all three work five days in a row at most
  { c: LC, edge: 'No avoidable fatigue warning or week over 55 hours in any cover-week placement tested. Of the three, the fewest days in a row however a cover week falls, the gentlest change of start, the fewest single rest days (as today) and the most 06:20 starts, for those who like them.',
    cost: `The fewest breaks of three or four rest days, ${LC.long34} a year.`,
    ok: ffW(LC) === 0 && others(LC).every(c => ffW(c) > 0) && LC.most7 <= 55 * 60 && LC.most7Long <= 55 * 60
      && clear(runW(LC), others(LC).map(runW)) && clear(step(LC), others(LC).map(step)) && clear(LC.singles, others(LC).map(c => c.singles)) && LC.singles === TC.singles
      && clear(+LC.f.open0620, others(LC).map(c => +c.f.open0620), true) && clear(LC.long34, others(LC).map(c => c.long34)) },
  { c: MG, edge: 'Alone of the three, no shift over 8h 30m on any day, and every closing shift 8h 10m. Of the three, the closest Saturday fit.',
    cost: `The fewest earlies finishing before 14:00, ${MG.f.shortYear} a year; four at the open every day; the least pay for those who work their Sundays.`,
    ok: MG.longAny === 0 && others(MG).every(c => c.longAny > 0) && ['closerWk', 'closerSat', 'closerSun'].every(k => !MG.f[k].includes('–') && H(MG.f[k]) === 490)
      && clear(+MG.f.fitSat, others(MG).map(c => +c.f.fitSat))
      && clear(+MG.f.shortYear, others(MG).map(c => +c.f.shortYear)) && opens(MG).every(x => x === 4) && others(MG).every(c => opens(c).some(x => x > 4))
      && clear(MG.sundayLoss, others(MG).map(c => c.sundayLoss), true) },
];
for (const k of CARDS) claim(`${k.c.name}'s edge and cost`, k.ok);
claim('Middle Ground’s leave worst case and shortest Sundays are not edges or costs by the 5% rule, so neither card claims them',
  !clear(+MG.f.leaveWorst, others(MG).map(c => +c.f.leaveWorst), true) && !clear(H(MG.f.sunHours), others(MG).map(c => H(c.f.sunHours))));

// ── THE PAGE ────────────────────────────────────────────────────────────────────────────────────────────────────────
const ICON = {   // 24-unit stroke icons, drawn here so nothing is fetched and a print in black still reads
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  warn: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.5M12 17v.2"/>',
  train: '<rect x="6" y="3.5" width="12" height="13" rx="3"/><path d="M6 11h12M9 20l-2 1.5M15 20l2 1.5M9.5 14h.1M14.5 14h.1"/>',
  up: '<path d="M5 12.5 10 17.5 19 7"/>', down: '<path class="fill" d="M12 5 20 19H4z"/>', same: '<path d="M6 10h12M6 14h12"/>',
};
const svg = (k, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
const mark = s => s === 'better' ? svg('up', 'up') : s === 'worse' ? svg('down', 'down') : '';
const kpi = r => `<div class="kpi"><div class="big">${esc(r.big)}</div><div class="txt"><div class="what">${esc(r.what)}</div><div class="was">${esc(r.was)}</div></div></div>`;
const cellText = (r, c) => texts(r, c).map((t, j) => bestAt(r, c, j) ? `<b class="bv">${esc(t)}</b>` : esc(t)).join(esc(r.sep ?? ''));
const tbody = BANDS.map(b => `<tbody><tr class="band"><td colspan="5">${svg(b.icon)}<span>${b.band}</span></td></tr>
${b.rows.map(r => `<tr><td class="lab"><span>${esc(r.label)}</span></td><td class="v today">${esc(r.today ?? texts(r, TC).join(r.sep ?? ''))}</td>${C.map(c => {
  const s = vsToday(r, c); return `<td class="v ${s}">${mark(s)}<span>${cellText(r, c)}</span></td>`; }).join('')}</tr>`).join('\n')}</tbody>`).join('\n');
const card = k => `<div class="card"><div class="ch"><b>${esc(k.c.name)}</b><span class="code">${k.c.code} · ${k.c.fp}</span></div>
  <p class="edge">${svg('up', 'up')}<span>${esc(k.edge)}</span></p><p class="cost">${svg('down', 'down')}<span>${esc(k.cost)}</span></p></div>`;
const names = C.map(c => c.name).join(', ').replace(/, ([^,]*)$/, ' and $1');

const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>The shortlist at a glance — the new CEA link</title>
<link rel="stylesheet" href="${ROOT}/shared.css">
<style>
@page { size: A4; margin: 10mm 11mm 11mm; }
html, body { background: white !important; color: var(--text-dark); padding: 0 !important; margin: 0; font-family: var(--font-sans); font-size: 10.6px; line-height: 1.35; }
.page { position: relative; height: 276mm; box-sizing: border-box; padding-bottom: 16px; }
.mast { background: var(--primary-blue); color: white; padding: 8px 20px 7px; border-bottom: 4px solid var(--accent-gold); border-radius: var(--radius); display: flex; gap: 16px; align-items: center; }
.mast img { width: 44px; height: 44px; border-radius: 10px; }
.mast .eyebrow { color: var(--accent-gold); font-size: 10px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; }
.mast h1 { margin: 2px 0; font-size: 23px; font-weight: 800; color: white; letter-spacing: -.3px; }
.mast .sub { color: rgba(255,255,255,.8); font-size: 11.5px; }
.mast .meta { color: rgba(255,255,255,.55); font-size: 9.5px; margin-top: 3px; }
h2 { font-size: 13px; font-weight: 800; color: var(--primary-blue); margin: 5px 0 3px; letter-spacing: -.1px; display: flex; align-items: baseline; gap: 8px; }
h2 small { font-size: 9.6px; font-weight: 500; color: var(--text-mid); letter-spacing: 0; }
.ic { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2.1; stroke-linecap: round; stroke-linejoin: round; flex: none; }
.ic .fill { fill: currentColor; } .ic.up { color: var(--success-text); } .ic.down { color: color-mix(in srgb, var(--warning-amber) 82%, black); }
/* WHICHEVER IS CHOSEN: three panels, the colour of each its verdict against today */
.panels { display: grid; grid-template-columns: 2fr 1.12fr 1.12fr; gap: 8px; }
.panel { border-radius: 9px; padding: 6px 10px 7px; border: 1px solid var(--border-light); display: flex; flex-direction: column; }
.panel .ph { display: flex; align-items: center; gap: 6px; font-size: 9.6px; font-weight: 800; text-transform: uppercase; letter-spacing: .45px; margin-bottom: 4px; }
.panel.good { background: color-mix(in srgb, var(--success-green) 8%, white); border-color: color-mix(in srgb, var(--success-green) 30%, white); }
.panel.good .ph { color: var(--success-text); }
.panel.level { background: color-mix(in srgb, var(--primary-blue) 4%, white); border-color: color-mix(in srgb, var(--primary-blue) 16%, white); }
.panel.level .ph { color: var(--primary-blue); }
.panel.cost { background: color-mix(in srgb, var(--warning-amber) 8%, white); border-color: color-mix(in srgb, var(--warning-amber) 30%, white); }
.panel.cost .ph { color: color-mix(in srgb, var(--warning-amber) 82%, black); }
.panel .kpis { display: grid; gap: 5px 12px; flex: 1; align-content: space-evenly; } .panel.good .kpis { grid-template-columns: 1fr 1fr; }
.kpi { display: flex; align-items: center; gap: 7px; }
/* each figure right-aligned against its words, so a short one sits beside them, not a column's width away (the audit) */
.kpi .big { flex: none; min-width: 34px; text-align: right; font-size: 15.5px; font-weight: 800; color: var(--primary-blue); line-height: 1.05; font-variant-numeric: tabular-nums; letter-spacing: -.3px; }
.panel.good .kpi .big { min-width: 66px; }   /* "14h 20m", so each column's words start in one line */
.kpi .what { font-size: 9px; color: var(--text-dark); line-height: 1.17; }
.kpi .was { font-size: 8.4px; color: var(--text-mid); line-height: 1.2; }
/* WHERE THEY DIFFER */
/* the key on the heading's own line: it says "against today", which the line under the heading used to (the audit) */
.legend { display: flex; gap: 12px; align-items: center; font-size: 9px; font-weight: 500; color: var(--text-mid); letter-spacing: 0; margin-left: 4px; }
.legend span { display: inline-flex; align-items: center; gap: 4px; } .legend b { color: var(--primary-blue); }
table.t { border-collapse: separate; border-spacing: 0; width: 100%; table-layout: fixed; }
table.t col.lab { width: 33%; } table.t col.today { width: 13%; } table.t col.d { width: 18%; }
table.t thead th { font-size: 9.4px; font-weight: 800; color: white; background: var(--primary-blue); padding: 4px 6px 3.5px; text-align: center; letter-spacing: .1px; }
table.t thead th:first-child { text-align: left; background: none; color: var(--text-mid); font-weight: 600; font-size: 8.8px; padding-left: 2px; vertical-align: bottom; }
table.t thead th.today { background: color-mix(in srgb, var(--primary-blue) 9%, white); color: var(--text-mid); }
table.t thead th:nth-child(3) { border-top-left-radius: 7px; } table.t thead th:last-child { border-top-right-radius: 7px; }
table.t thead th.today { border-top-left-radius: 7px; border-top-right-radius: 7px; }
table.t thead th .code { display: block; font-size: 7.8px; font-weight: 500; opacity: .75; letter-spacing: 0; margin-top: 1px; }
table.t tr.band td { padding: 4px 2px 2px; border-bottom: 1.5px solid var(--primary-blue); color: var(--primary-blue); font-size: 10.4px; font-weight: 800; }
table.t tr.band td span { vertical-align: middle; } table.t tr.band .ic { vertical-align: middle; margin-right: 5px; width: 12px; height: 12px; }
table.t td { padding: 1.8px 6px 1.8px; border-bottom: 1px solid var(--border-light); vertical-align: middle; }
table.t td.lab { font-size: 10px; line-height: 1.22; padding-left: 2px; }
table.t td.v { text-align: center; font-size: 10.4px; font-variant-numeric: tabular-nums; white-space: nowrap; }
table.t td.v .ic { width: 10px; height: 10px; vertical-align: -1px; margin-right: 3px; stroke-width: 2.6; }
table.t td.today { color: var(--text-mid); background: color-mix(in srgb, var(--primary-blue) 3%, white); }
table.t td.better { background: color-mix(in srgb, var(--success-green) 11%, white); }
table.t td.worse { background: color-mix(in srgb, var(--warning-amber) 13%, white); }
table.t td .bv { font-weight: 800; color: var(--primary-blue); }
/* EACH ONE'S EDGE */
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.card { border: 1px solid var(--border-light); border-top: 3px solid var(--primary-blue); border-radius: 8px; padding: 5px 8px 6px; background: white; }
.card .ch { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; margin-bottom: 2px; }
.card .ch b { font-size: 11.6px; color: var(--primary-blue); } .card .code { font-size: 8px; color: var(--text-light); white-space: nowrap; }
.card p { display: flex; gap: 5px; margin: 0 0 3px; font-size: 8.8px; line-height: 1.25; } .card p .ic { width: 11px; height: 11px; margin-top: 1px; stroke-width: 2.6; }
.card p.edge { font-weight: 600; color: var(--text-dark); } .card p.cost { color: var(--text-mid); margin-bottom: 0; }
.notes { margin-top: 6px; color: var(--text-mid); font-size: 8.3px; line-height: 1.34; display: flex; gap: 20px; } .notes > p { flex: 1; margin: 0; } .notes b { color: var(--text-dark); }
.foot { position: absolute; bottom: 0; left: 0; right: 0; display: flex; justify-content: space-between; gap: 16px; font-size: 8.5px; color: var(--text-light); border-top: 1px solid var(--border-light); padding-top: 4px; }
.foot b { color: var(--primary-blue); } .nw { white-space: nowrap; }
* { text-wrap: pretty; }
</style></head><body>
<section class="page">
  <div class="mast"><img src="${ROOT}/icon-192.png" alt=""><div><div class="eyebrow">Marylebone Roster · Links designer · The shortlist at a glance</div><h1>The shortlist at a glance</h1>
  <div class="sub">${names}, shortlisted from ${stats.length} designs, beside today’s link</div>
  <div class="meta">The new CEA link from January 2027 · prepared ${PREPARED} · every figure is computed from the rotas</div></div></div>

  <h2>Whichever is chosen <small>the same on all three, against today</small></h2>
  <div class="panels">
    <div class="panel good"><div class="ph">${svg('up')}Better than today, cover weeks aside</div><div class="kpis">${BETTER.map(r => kpi(r)).join('')}</div></div>
    <div class="panel level"><div class="ph">${svg('same')}As today</div><div class="kpis">${ASNOW.map(r => kpi(r)).join('')}</div></div>
    <div class="panel cost"><div class="ph">${svg('down')}Worse than today</div><div class="kpis">${COSTS.map(r => kpi(r)).join('')}</div></div>
  </div>

  <h2>Where they differ <span class="legend"><span>${svg('up', 'up')}better than today</span><span>${svg('down', 'down')}worse than today</span><span>no mark: as today, or a matter of taste</span><span><b>Bold</b> the best of the three, ties included</span></span></h2>
  <table class="t"><colgroup><col class="lab"><col class="today"><col class="d"><col class="d"><col class="d"></colgroup>
  <thead><tr><th>Measure</th><th class="today">Today<span class="code">${lines(TC)} lines</span></th>${C.map(c => `<th>${esc(c.name)}<span class="code">${lines(c)} lines</span></th>`).join('')}</tr></thead>
${tbody}
  </table>

  <h2>Each one’s edge, and its cost</h2>
  <div class="cards">${CARDS.map(card).join('')}</div>

  <div class="notes"><p><b>How it is counted.</b> Over 52 weeks: the 26-week links worked through twice, today’s 20-week link scaled to match. <b>Cover weeks</b> have no set duties: four days, Monday to Saturday, placed later by the roster office. “Cover weeks aside” leaves them out; “up to” and “if a cover week falls badly” take their worst placing, at 8 hours a duty. <b>Leave</b> costs a day for each working day Monday to Saturday; Sunday is overtime, so a rostered Sunday inside your leave is overtime lost. More: the shortlist sheet, “What it means if you…” and each proposal sheet.</p><p><b>Avoidable fatigue warnings:</b> what the Office of Rail and Road’s good-practice guidance asks to be looked at, such as over 55 hours in seven days; not a pass or fail. Two that every link has are left out: starts before 07:00 and a weekly rotation. <b>Fit to the trains:</b> how closely the staff on duty follow the trains, hour by hour; 0 is exact. <b>Pay</b> is gross, at £${RATE.toFixed(2)} an hour, against today. Its two rows are two different people, never added together: with no overtime, two more Saturdays at a premium; working your Sundays, fewer and shorter Sundays as well.</p></div>
  <div class="foot"><span>Page 1 of 1 — The shortlist at a glance</span><span><b>At a glance</b> · ${C.map(c => `<span class="nw">${esc(c.name)}</span>`).join(', ').replace(/, ([^,]*)$/, ' and $1')} · Marylebone Roster — Links designer</span></div>
</section>
</body></html>`;
const tidy = h => h.replace(/(<style[\s\S]*?<\/style>|<title>[\s\S]*?<\/title>|<svg[\s\S]*?<\/svg>)|(?<=>)([^<]+)(?=<)/g, (mm, keep, txt) => keep ?? tidyText(txt));
const htmlOut = fileURLToPath(new URL('links-26-shortlist-at-a-glance.html', import.meta.url)); writeFileSync(htmlOut, longDates(tidy(html)));   // beside the tooling, gitignored
const b = await chromium.launch(); const pg = await b.newPage();
await pg.goto('file://' + htmlOut); await pg.evaluate(() => document.fonts.ready);
// THE PAGE IS A FIXED HEIGHT, so content that does not fit would be HIDDEN under the footer: refuse to print it, measured at
// the print width under print media, as the What it means sheet measures
{ await pg.emulateMedia({ media: 'print' }); await pg.setViewportSize({ width: 711, height: 1100 });
  const over = await pg.evaluate(() => { const p = document.querySelector('.page'), foot = p.querySelector('.foot'), lim = foot.getBoundingClientRect().top;
    const low = Math.max(...[...p.children].filter(c => c !== foot).map(c => c.getBoundingClientRect().bottom));
    return Math.round(Math.max(low - lim, p.scrollHeight - p.clientHeight, p.scrollWidth - p.clientWidth)); });
  if (over > 1) throw new Error(`content runs into the footer or off the page by ${over}px`);
  const room = await pg.evaluate(() => { const p = document.querySelector('.page'), foot = p.querySelector('.foot');
    return Math.round(foot.getBoundingClientRect().top - Math.max(...[...p.children].filter(c => c !== foot).map(c => c.getBoundingClientRect().bottom))); });
  // a value never wraps inside its cell, and no cell is wider than its column
  const tight = await pg.evaluate(() => [...document.querySelectorAll('table.t td.v')].filter(td => td.scrollWidth > td.clientWidth + 1).map(td => td.textContent));
  if (tight.length) throw new Error(`cells too narrow for their figures: ${tight.join(' | ')}`);
  // a measure's name on one line, so every row is the same height and the eye can run along it (the audit's longer labels)
  const wrapped = await pg.evaluate(() => [...document.querySelectorAll('table.t td.lab > span')].filter(s => s.getClientRects().length > 1).map(s => s.textContent));   // an inline box has one rect a line
  if (wrapped.length) throw new Error(`measure names wrapping onto a second line: ${wrapped.join(' | ')}`);
  console.log(`room above the footer: ${room}px`); }
await pg.pdf({ path: OUT, format: 'A4', printBackground: true, preferCSSPageSize: true });
await b.close();
console.log(`wrote links-26-shortlist-at-a-glance.pdf — ${ROWS.length} rows where they differ; worst seven days: ${COLS.map(c => `${c.name} ${hm(c.most7)}`).join(', ')}; Sundays inside the best days off: ${COLS.map(c => `${c.name} ${c.sunsIn}`).join(', ')}`);
