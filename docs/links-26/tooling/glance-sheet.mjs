// THE SHORTLIST AT A GLANCE (9 Nov 2026, owner: "Can you create a one page highly polished comparison at a glance sheet
// between the 3 proposals and today's roster"). One page: what the three share against today (better, the same, worse),
// where they differ from each other with today for scale, and each one's edge and cost. It is the shortlist sheet's story
// for someone with a minute, not a second copy of its tables.
//
// THE FIGURES ARE what-it-means-data.mjs's, which are deck-check.mjs's (the decks' own) and the grids' counts, so this page,
// the What it means sheet, the New link page and the decks cannot quote different figures. Two are counted here, from the
// grids: the breaks of three days or more, and the rostered Sundays inside the best stretch of days off that 14 days' leave
// buys (leave.mjs's walk; a cover week's Sunday is not rostered, so it does not count). NOTHING ON THE PAGE IS TYPED: every
// panel line is asserted equal on all three, every edge and cost is asserted against the figures, and a row's colour comes
// from its direction, so a design that stops fitting a sentence stops the sheet.
//
// Run it after deck-polish.py and what-it-means-sheet.mjs, as the data module reads the decks back:
//   node docs/links-26/tooling/glance-sheet.mjs   → docs/links-26/links-26-shortlist-at-a-glance.pdf
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { DAYS as GRID_DAYS } from '../../../links-design.js';
import { TC, C, BV, LC, MG, RATE, H, Hmax, first, hm, restLens, claim, tidyText } from './what-it-means-data.mjs';
import { leaveRuns } from './leave.mjs';
import { folderStats } from './report-data.mjs';
import { longDates } from './link.mjs';

const ROOT = new URL('../../../', import.meta.url).href.replace(/\/$/, '');
const OUT = fileURLToPath(new URL('../links-26-shortlist-at-a-glance.pdf', import.meta.url));
const PREPARED = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const COLS = [TC, ...C];                       // today, then the three A to Z, as the data module orders them
const upTo = v => { const u = /up to (\d+)/.exec(v); return u ? +u[1] : first(v); };   // "5 (up to 10)" → 10, "0" → 0

// ── WHAT IS COUNTED HERE ────────────────────────────────────────────────────────────────────────────────────────────
const stats = folderStats();
const fingerprint = p => createHash('sha256').update(JSON.stringify(Object.keys(p).sort((a, b) => a - b).map(k => GRID_DAYS.map(d => p[k][d])))).digest('hex').slice(0, 8);
for (const c of C) { const s = stats.find(x => x.name === c.name); claim(`${c.name} is a design in the pack`, !!s);
  c.code = s.code; c.fp = fingerprint(c.p);   // the fingerprint its proposal sheet is named by, so the two cannot disagree
  claim(`${c.name}'s fingerprint ${c.fp} names its proposal sheet`, existsSync(fileURLToPath(new URL(`../${s.dir}/${s.file.replace(/\.json$/, '')}-${c.fp}.pdf`, import.meta.url)))); }
for (const c of COLS) {
  const L = Object.keys(c.p).length, rests = restLens(c.p);
  c.long3 = Math.round(rests.filter(n => n >= 3).length * 52 / L);   // breaks of three days or more, a year each
  // the rostered Sundays inside the best stretch: leave.mjs's runs, the fewest over the first days that reach the best
  const seq = Object.keys(c.p).sort((a, b) => a - b).flatMap(k => GRID_DAYS.map(d => ({ sun: d === 'sun', v: c.p[k][d] })));
  const runs = leaveRuns(c.p, 14), best = Math.max(...runs), n = seq.length;
  c.bestRun = best;
  c.sunsIn = Math.min(...runs.map((r, s) => r < best ? Infinity : Array.from({ length: best }, (_, j) => seq[(s + j) % n]).filter(x => x.sun && x.v !== 'RD' && x.v !== 'SPARE').length));
}
claim('the best stretch is the leave figure the decks print, today and on all three', COLS.every(c => c.bestRun === +c.f.leaveBest));

// ── WHICHEVER IS CHOSEN: three panels, every line the same on all three ─────────────────────────────────────────────
const same = (k, f = v => v) => { const v = C.map(c => f(c.f[k])); claim(`${k}: the same on all three`, v.every(x => x === v[0])); return v[0]; };
const BETTER = [
  { big: `${same('met')} of 9`, what: 'December staffing rules met', was: `today ${TC.f.met} of 9`, ok: +same('met') > +TC.f.met },
  { big: same('floorMin'), what: 'on the floor at all times', was: `today ${TC.f.floorMin}`, ok: +same('floorMin') > +TC.f.floorMin },
  { big: hm(H(same('closerWk'))), what: 'longest weekday closing shift', was: `today ${hm(H(TC.f.closerWk))}`, ok: H(same('closerWk')) < H(TC.f.closerWk) },
  { big: String(same('ff', first)), what: 'fatigue warnings, set duties', was: `today ${first(TC.f.ff)}`, ok: same('ff', first) < first(TC.f.ff) },
  { big: String(same('run', first)), what: 'days in a row at most, set duties', was: `today ${first(TC.f.run)}`, ok: same('run', first) < first(TC.f.run) },
];
const ASNOW = [
  { big: same('leaveBest'), what: 'days off for 14 days’ leave', was: 'as today', ok: same('leaveBest') === TC.f.leaveBest },
  { big: same('leaveFour'), what: 'days’ leave for four weeks off', was: 'as today', ok: same('leaveFour') === TC.f.leaveFour },
  { big: same('hours'), what: `week, ${same('daysYear')} days a year`, was: `today ${TC.f.daysYear}`, ok: same('hours') === TC.f.hours && Math.abs(+same('daysYear') - +TC.f.daysYear) < 1 },
];
const COSTS = [
  { big: same('sat'), what: 'Saturdays at work', was: `today ${TC.f.sat}`, ok: +same('sat') > +TC.f.sat },
  { big: same('late22'), what: 'finishes at 22:00 or later', was: `today ${TC.f.late22}`, ok: +same('late22') > +TC.f.late22 },
  { big: same('late23'), what: 'finishes at 23:00 or later', was: `today ${TC.f.late23}`, ok: +same('late23') > +TC.f.late23 },
];
for (const [panel, rows] of [['better than today', BETTER], ['as today', ASNOW], ['a cost against today', COSTS]])
  for (const r of rows) claim(`${r.big} ${r.what}: ${panel}, on all three`, r.ok);

// ── WHERE THEY DIFFER ───────────────────────────────────────────────────────────────────────────────────────────────
// dir: 1 higher is better, -1 lower is better, 0 a matter of preference (no colour). n: the number compared, or a list
// compared part by part (a cell is better or worse only when every part is). show: what the cell prints.
const BANDS = [
  { band: 'Leave and time off', icon: 'cal', rows: [
    { label: 'Days off that 14 days’ leave buys, at worst', dir: 1, n: c => +c.f.leaveWorst, show: c => c.f.leaveWorst },
    { label: `Rostered Sundays inside the ${TC.f.leaveBest} days off`, dir: -1, n: c => c.sunsIn, show: c => String(c.sunsIn) },
    { label: 'Full weekends off, a year', dir: 1, n: c => +c.f.weekendsYear, show: c => c.f.weekendsYear },
    { label: 'Breaks of three days or more, a year', dir: 1, n: c => c.long3, show: c => String(c.long3) },
    { label: 'Single rest days, a year', dir: -1, n: c => c.singles, show: c => String(c.singles) },
    { label: 'Shortest rest between shifts', dir: 1, n: c => H(c.f.rest), show: c => hm(H(c.f.rest)) },
  ] },
  { band: 'Your shifts', icon: 'clock', rows: [
    { label: 'Weeks on one shift time, Monday to Friday', dir: 1, n: c => +c.f.oneTurn.split(' of ')[0] / +c.f.oneTurn.split(' of ')[1], show: c => c.f.oneTurn },
    { label: 'Change of start time, week to week', dir: -1, n: c => H(c.f.step), show: c => hm(H(c.f.step)) },
    { label: 'Weeks in a row of earlies, or of lates', dir: -1, n: c => [+c.f.block, +c.f.blockUpTo], show: c => `${c.f.block}, up to ${c.f.blockUpTo}` },
    { label: 'Starts at 06:20, a year (a matter of taste)', dir: 0, n: c => +c.f.open0620, show: c => c.f.open0620 },
    { label: 'Earlies finishing before 14:00, a year', dir: 1, n: c => +c.f.shortYear, show: c => c.f.shortYear },
    { label: 'Longest shift', dir: -1, n: c => H(c.f.longest), show: c => hm(H(c.f.longest)) },
    { label: 'Longest Saturday closing shift', dir: -1, n: c => Hmax(c.f.closerSat), show: c => hm(Hmax(c.f.closerSat)) },
    { label: 'Heaviest week, Monday to Saturday', dir: -1, n: c => H(c.f.heavy), show: c => hm(H(c.f.heavy)) },
  ] },
  { band: 'If a cover week falls badly', icon: 'warn', rows: [
    { label: 'Most days at work in a row', dir: -1, n: c => upTo(c.f.run), show: c => String(upTo(c.f.run)) },
    { label: 'Fatigue warnings', dir: -1, n: c => upTo(c.f.ff), show: c => upTo(c.f.ff) ? String(upTo(c.f.ff)) : 'none' },
    { label: '55 hours or more in seven days', dir: -1, n: c => c.f.h55 ? H(c.f.h55) : 0, show: c => c.f.h55 ? hm(H(c.f.h55)) : 'never' },
  ] },
  { band: 'Trains and pay', icon: 'train', rows: [
    { label: 'Fit to the trains, weekday · Sat · Sun (0 exact)', dir: -1, n: c => [+c.f.fitWk, +c.f.fitSat, +c.f.fitSun], show: c => `${c.f.fitWk} · ${c.f.fitSat} · ${c.f.fitSun}` },
    { label: 'Pay for your share of Sundays, against today', dir: 1, today: '—', rank: false, n: c => -c.sundayLoss, show: c => `about £${c.sundayLoss} less` },
    { label: 'Pay with no overtime at all, against today', dir: 1, today: '—', rank: false, n: c => c.noOtGain, show: c => `about £${c.noOtGain} more` },
  ] },
];
// a cell against today: better, worse or level; a list is better or worse only when every part is
const vsToday = (row, c) => { if (!row.dir || row.today) return row.today && row.dir ? (row.n(c) > 0 ? 'better' : row.n(c) < 0 ? 'worse' : '') : '';
  const a = [row.n(c)].flat(), t = [row.n(TC)].flat(), cmp = a.map((v, i) => Math.sign((v - t[i]) * row.dir));
  return cmp.every(x => x > 0) ? 'better' : cmp.every(x => x < 0) ? 'worse' : cmp.every(x => x === 0) ? '' : 'mixed'; };
// the clear best of the three: alone at the best value (a list: best in every part), and only where the three differ
const bestOf = (row, c) => { if (!row.dir || row.rank === false) return false; const v = C.map(x => [row.n(x)].flat()), me = [row.n(c)].flat();
  if (v.every(x => x.join() === v[0].join())) return false;
  return C.every(x => x === c || [row.n(x)].flat().every((y, i) => Math.sign((me[i] - y) * row.dir) > 0)); };
for (const b of BANDS) for (const r of b.rows) claim(`${r.label}: the three differ, so the row belongs under "where they differ"`, new Set(C.map(c => [r.n(c)].flat().join())).size > 1);

// ── EACH ONE'S EDGE, AND ITS COST: every comparing word asserted ────────────────────────────────────────────────────
const others = c => C.filter(x => x !== c), lt = (k, c) => others(c).every(x => k(c) < k(x)), gt = (k, c) => others(c).every(x => k(c) > k(x));
const one = c => +c.f.oneTurn.split(' of ')[0], wl = +BV.f.oneTurn.split(' of ')[1];
const CARDS = [
  { c: BV, edge: `The shortest runs of earlies or lates, the most long breaks, and the fewest Sundays inside its ${BV.f.leaveBest} days off.`,
    cost: `One shift time in ${one(BV)} weeks of ${wl}; ${BV.singles} single rest days a year; up to ${upTo(BV.f.run)} days in a row if a cover week falls badly.`,
    ok: lt(c => +c.f.block, BV) && lt(c => +c.f.blockUpTo, BV) && gt(c => c.long3, BV) && lt(c => c.sunsIn, BV) && C.every(c => c.bestRun === BV.bestRun)
      && lt(one, BV) && gt(c => c.singles, BV) && gt(c => upTo(c.f.run), BV) },
  { c: LC, edge: 'No fatigue warning and no 55-hour week in any cover-week placement tested, and the steadiest start times.',
    cost: `The fewest breaks of three days or more, ${LC.long3} a year, against ${BV.long3} and ${MG.long3}.`,
    ok: upTo(LC.f.ff) === 0 && !LC.f.h55 && others(LC).every(c => upTo(c.f.ff) > 0 && c.f.h55) && lt(c => H(c.f.step), LC)
      && lt(c => c.long3, LC) },
  { c: MG, edge: 'No shift over 8h 30m, the closest Saturday fit, and the best worst case for leave.',
    cost: `The fewest earlies finishing before 14:00, ${MG.f.shortYear} a year; the shortest Sundays, so the least Sunday pay.`,
    ok: H(MG.f.longest) <= 510 && others(MG).every(c => H(c.f.longest) > 510) && lt(c => +c.f.fitSat, MG) && gt(c => +c.f.leaveWorst, MG)
      && lt(c => +c.f.shortYear, MG) && lt(c => H(c.f.sunHours), MG) && gt(c => c.sundayLoss, MG) },
];
for (const k of CARDS) claim(`${k.c.name}'s edge and cost`, k.ok);

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
const tbody = BANDS.map(b => `<tbody><tr class="band"><td colspan="5">${svg(b.icon)}<span>${b.band}</span></td></tr>
${b.rows.map(r => `<tr><td class="lab">${esc(r.label)}${r.note ? `<span class="nt">${esc(r.note)}</span>` : ''}</td><td class="v today">${esc(r.today ?? r.show(TC))}</td>${C.map(c => {
  const s = vsToday(r, c); return `<td class="v ${s}${bestOf(r, c) ? ' best' : ''}">${mark(s)}<span>${esc(r.show(c))}</span></td>`; }).join('')}</tr>`).join('\n')}</tbody>`).join('\n');
const card = k => `<div class="card"><div class="ch"><b>${esc(k.c.name)}</b><span class="code">${k.c.code} · ${k.c.fp}</span></div>
  <p class="edge">${svg('up', 'up')}<span>${esc(k.edge)}</span></p><p class="cost">${svg('down', 'down')}<span>${esc(k.cost)}</span></p></div>`;

const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>The shortlist at a glance — the new CEA link</title>
<link rel="stylesheet" href="${ROOT}/shared.css">
<style>
@page { size: A4; margin: 10mm 11mm 11mm; }
html, body { background: white !important; color: var(--text-dark); padding: 0 !important; margin: 0; font-family: var(--font-sans); font-size: 10.6px; line-height: 1.35; }
.page { position: relative; height: 276mm; box-sizing: border-box; padding-bottom: 16px; }
.mast { background: var(--primary-blue); color: white; padding: 10px 20px 9px; border-bottom: 4px solid var(--accent-gold); border-radius: var(--radius); display: flex; gap: 16px; align-items: center; }
.mast img { width: 44px; height: 44px; border-radius: 10px; }
.mast .eyebrow { color: var(--accent-gold); font-size: 10px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; }
.mast h1 { margin: 2px 0; font-size: 23px; font-weight: 800; color: white; letter-spacing: -.3px; }
.mast .sub { color: rgba(255,255,255,.8); font-size: 11.5px; }
.mast .meta { color: rgba(255,255,255,.55); font-size: 9.5px; margin-top: 3px; }
h2 { font-size: 13px; font-weight: 800; color: var(--primary-blue); margin: 7px 0 3px; letter-spacing: -.1px; display: flex; align-items: baseline; gap: 8px; }
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
.kpi .big { flex: none; min-width: 34px; font-size: 15.5px; font-weight: 800; color: var(--primary-blue); line-height: 1.05; font-variant-numeric: tabular-nums; letter-spacing: -.3px; }
.panel.good .kpi .big { min-width: 64px; }   /* wide enough for "8h 10m", so each column's words line up */
.kpi .what { font-size: 9px; color: var(--text-dark); line-height: 1.17; }
.kpi .was { font-size: 8.4px; color: var(--text-mid); line-height: 1.2; }
/* WHERE THEY DIFFER */
.legend { display: flex; gap: 14px; align-items: center; font-size: 9px; color: var(--text-mid); margin: -1px 0 4px; }
.legend span { display: inline-flex; align-items: center; gap: 4px; } .legend b { color: var(--primary-blue); }
table.t { border-collapse: separate; border-spacing: 0; width: 100%; table-layout: fixed; }
table.t col.lab { width: 33%; } table.t col.today { width: 13%; } table.t col.d { width: 18%; }
table.t thead th { font-size: 9.4px; font-weight: 800; color: white; background: var(--primary-blue); padding: 4px 6px 3.5px; text-align: center; letter-spacing: .1px; }
table.t thead th:first-child { text-align: left; background: none; color: var(--text-mid); font-weight: 600; font-size: 8.8px; padding-left: 2px; vertical-align: bottom; }
table.t thead th.today { background: color-mix(in srgb, var(--primary-blue) 9%, white); color: var(--text-mid); }
table.t thead th:nth-child(3) { border-top-left-radius: 7px; } table.t thead th:last-child { border-top-right-radius: 7px; }
table.t thead th.today { border-top-left-radius: 7px; border-top-right-radius: 7px; }
table.t thead th .code { display: block; font-size: 7.8px; font-weight: 500; opacity: .75; letter-spacing: 0; margin-top: 1px; }
table.t tr.band td { padding: 5px 2px 2px; border-bottom: 1.5px solid var(--primary-blue); color: var(--primary-blue); font-size: 10.4px; font-weight: 800; }
table.t tr.band td span { vertical-align: middle; } table.t tr.band .ic { vertical-align: middle; margin-right: 5px; width: 12px; height: 12px; }
table.t td { padding: 2.1px 6px 2.1px; border-bottom: 1px solid var(--border-light); vertical-align: middle; }
table.t td.lab { font-size: 10px; line-height: 1.22; padding-left: 2px; }
table.t td.lab .nt { display: block; font-size: 8.2px; color: var(--text-mid); line-height: 1.18; }
table.t td.v { text-align: center; font-size: 10.4px; font-variant-numeric: tabular-nums; white-space: nowrap; }
table.t td.v .ic { width: 10px; height: 10px; vertical-align: -1px; margin-right: 3px; stroke-width: 2.6; }
table.t td.today { color: var(--text-mid); background: color-mix(in srgb, var(--primary-blue) 3%, white); }
table.t td.better { background: color-mix(in srgb, var(--success-green) 11%, white); }
table.t td.worse { background: color-mix(in srgb, var(--warning-amber) 13%, white); }
table.t td.best span { font-weight: 800; color: var(--primary-blue); }
/* EACH ONE'S EDGE */
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.card { border: 1px solid var(--border-light); border-top: 3px solid var(--primary-blue); border-radius: 8px; padding: 6px 9px 7px; background: white; }
.card .ch { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; margin-bottom: 3px; }
.card .ch b { font-size: 11.6px; color: var(--primary-blue); } .card .code { font-size: 8px; color: var(--text-light); white-space: nowrap; }
.card p { display: flex; gap: 5px; margin: 0 0 3px; font-size: 9px; line-height: 1.28; } .card p .ic { width: 11px; height: 11px; margin-top: 1px; stroke-width: 2.6; }
.card p.edge { font-weight: 600; color: var(--text-dark); } .card p.cost { color: var(--text-mid); margin-bottom: 0; }
.notes { margin-top: 6px; color: var(--text-mid); font-size: 8.3px; line-height: 1.34; display: flex; gap: 20px; } .notes > p { flex: 1; margin: 0; } .notes b { color: var(--text-dark); }
.foot { position: absolute; bottom: 0; left: 0; right: 0; display: flex; justify-content: space-between; gap: 16px; font-size: 8.5px; color: var(--text-light); border-top: 1px solid var(--border-light); padding-top: 4px; }
.foot b { color: var(--primary-blue); } .nw { white-space: nowrap; }
* { text-wrap: pretty; }
</style></head><body>
<section class="page">
  <div class="mast"><img src="${ROOT}/icon-192.png" alt=""><div><div class="eyebrow">Marylebone Roster · Links designer · The shortlist at a glance</div><h1>The shortlist at a glance</h1>
  <div class="sub">Balanced V6, Level Crossing and Middle Ground beside today’s link, for the new CEA link from January 2027</div>
  <div class="meta">Prepared ${PREPARED} · every figure is computed from the rotas · per person, a year, cover weeks aside</div></div></div>

  <h2>Whichever is chosen <small>the same on all three, against today</small></h2>
  <div class="panels">
    <div class="panel good"><div class="ph">${svg('up')}Better than today</div><div class="kpis">${BETTER.map(r => kpi(r)).join('')}</div></div>
    <div class="panel level"><div class="ph">${svg('same')}As today</div><div class="kpis">${ASNOW.map(r => kpi(r)).join('')}</div></div>
    <div class="panel cost"><div class="ph">${svg('down')}Worse than today</div><div class="kpis">${COSTS.map(r => kpi(r)).join('')}</div></div>
  </div>

  <h2>Where they differ <small>today for scale; each design against today</small></h2>
  <div class="legend"><span>${svg('up', 'up')}better than today</span><span>${svg('down', 'down')}worse than today</span><span><b>Bold</b> the clear best of the three</span></div>
  <table class="t"><colgroup><col class="lab"><col class="today"><col class="d"><col class="d"><col class="d"></colgroup>
  <thead><tr><th>Each person, a year</th><th class="today">Today<span class="code">20 lines</span></th>${C.map(c => `<th>${esc(c.name)}<span class="code">${c.code}</span></th>`).join('')}</tr></thead>
${tbody}
  </table>

  <h2>Each one’s edge, and its cost</h2>
  <div class="cards">${CARDS.map(card).join('')}</div>

  <div class="notes"><p><b>How it is counted.</b> Over 52 weeks: two turns of a 26-week link, today’s 20-week link scaled to match. A working day Monday to Saturday costs a day’s leave; a rest day or a Sunday none, as Sunday is overtime, so a rostered Sunday inside your leave is overtime not worked.</p><p>“Up to” and “if a cover week falls badly”: the worst place a cover week’s four duties could fall. Pay is gross, at the CEA rate of £${RATE.toFixed(2)}, with no other overtime; the app’s Pay Calculator estimates a payslip. Fatigue warnings follow the ORR’s good-practice list, never pass or fail. More: the shortlist sheet, What it means if you… and each proposal sheet.</p></div>
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
  console.log(`room above the footer: ${room}px`); }
await pg.pdf({ path: OUT, format: 'A4', printBackground: true, preferCSSPageSize: true });
await b.close();
console.log(`wrote links-26-shortlist-at-a-glance.pdf — ${BANDS.reduce((n, x) => n + x.rows.length, 0)} rows where they differ; Sundays inside the best days off: today ${TC.sunsIn}, ${C.map(c => `${c.name} ${c.sunsIn}`).join(', ')}`);
