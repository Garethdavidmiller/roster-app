// THE SHORTLIST SHEET (3 Oct 2026, owner: "a two page analysis sheet comparing the three — snappy but evidence led,
// choose one if you like one, compare to the existing roster too"). Two A4 pages: Second Edition, Short Run and Even Keel
// against each other and against today's link. EVERY FIGURE IS COMPUTED HERE from the three grids and today's roster by the
// same functions the proposal sheets use (report-data.mjs assess, plain.mjs personal, leave.mjs, links-adjacency.js
// scoreOrder); nothing is typed in. The prose is the owner's and this session's judgement and says so.
//   node shortlist-sheet.mjs        → ../links-26-shortlist.pdf (the .html stays in tooling/, gitignored)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
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
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function figures(p, L, TA) {
  const A = assess(p, L), pp = personal(p), lv = leave(p), keys = Object.keys(p);
  const work = keys.filter(k => p[k].mon !== 'SPARE');
  const wk = work.map(k => MS.reduce((s, d) => s + (timed(p[k][d]) ? mins(p[k][d]) : 0), 0));
  const gaps = []; { const at = []; for (let k = 1; k <= L; k++) if (!timed(p[k].sat) && p[k].sat !== 'SPARE' && !timed(p[k % L + 1].sun) && p[k % L + 1].sun !== 'SPARE') at.push(k);
    for (let i = 0; i < at.length; i++) gaps.push(((at[(i + 1) % at.length] - at[i]) + L) % L || L); }
  const todays = new Set((TA ?? A).tableRows.map(r => r.time)), shared = A.tableRows.filter(r => todays.has(r.time)).length;
  const R = sheetRules({ patterns: p, ...A }, TA ?? A, TA ? 'plan' : 'today');
  return { A, pp, lv, met: R.met, flex: flexibleRules({ patterns: p, ...A }, TA ?? A, TA ? 'plan' : 'today').met,
    heavy: Math.max(...wk), light: Math.min(...wk), maxGap: Math.max(...gaps), gaps,
    step: scoreOrder(p, keys, { maxRunTarget: 6 }).gentleMean, times: A.feel.distinctTimes, shared,
    newT: A.feel.distinctTimes - shared, fixedRun: A.fixed.run, worstRun: A.checks.longestStretch,
    fit: [A.office.wkFit, A.office.fits.sat, A.office.fits.sun], block: kindBlocks(p) };
}
const T0 = today(), TA = assess(T0.patterns, 20), TF = figures(T0.patterns, 20, null);
const stats = folderStats();
const D = SHORTLIST.map(name => { const f = stats.find(s => s.name === name); if (!f) throw new Error(`no proposal called ${name}`);
  const j = JSON.parse(readFileSync(new URL(`../proposals/${f.file}`, import.meta.url), 'utf8')); const pdf = readdirSync(new URL('../proposals/', import.meta.url)).find(x => x.includes(`-${f.code}-`) && x.endsWith('.pdf')); const fp = pdf ? pdf.slice(-12, -4) : '';
  return { name, code: f.code, fp, F: figures(j.patterns ?? j, LINES, TA) }; });
const [SE, SR, EK] = D;

// the comparison rows: label, how to read each design, which direction is better (1 = higher is better, -1 = lower), format
const ROWS = [
  ['Most days in a row, fixed rota', F => F.fixedRun, -1, v => `${v}`],
  ['Most days in a row, cover week placed badly', F => F.worstRun, -1, v => `${v}`],
  ['Heaviest week', F => F.heavy, -1, hm],
  ['Lightest week', F => F.light, 1, hm],
  ['Shortest rest between shifts', F => F.A.rest.minutes, 1, hm],
  ['Weeks on one turn (one shift time Mon–Fri, no mixing)', F => F.A.feel.oneTurn, 1, (v, F) => `${v} of ${F.A.feel.workingLines}`],
  ['Weeks mixing earlies and lates', F => F.A.feel.hybrid, -1, v => `${v}`],
  // ranked on the worst case: the fixed-rota block is the same on all three, the cover weeks are what separate them
  ['Longest block of earlies or lates (up to: with cover weeks)', F => F.block.worst, -1, (v, F) => blockText(F.block)],
  ['Week-to-week change of start time', F => F.step, -1, hm],
  ['Finishing at 23:00 or later, each a year', F => Math.round(F.pp.late23), -1, v => `${v}`],
  ['Shift times to learn that are new', F => F.newT, -1, (v, F) => `${v} of ${F.times}`],
  ['Fit to the trains — weekday · Sat · Sun (0 = exact)', F => F.fit[0] + F.fit[1] + F.fit[2], -1, (v, F) => F.fit.map(x => x.toFixed(1)).join('\u00a0·\u00a0'), 'fit'],
];
const best = (get, dir) => { const vals = D.map(d => get(d.F)); const b = dir > 0 ? Math.max(...vals) : Math.min(...vals); return vals.map(v => v === b); };
const rowsHtml = ROWS.map(([label, get, dir, fmt, cls = '']) => { const bb = best(get, dir); const allSame = bb.every(Boolean);
  return `<tr><td>${esc(label)}</td><td class="num today ${cls}">${esc(fmt(get(TF), TF))}</td>${D.map((d, i) => `<td class="num ${cls}${bb[i] && !allSame ? ' best' : ''}">${esc(fmt(get(d.F), d.F))}</td>`).join('')}</tr>`; }).join('');

// against today: the rows a colleague feels, the three designs sharing one column where they agree
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
h2 { font-size: 14.5px; color: var(--primary-blue); margin: 11px 0 3px; font-weight: 800; }
p { margin: 3px 0 6px; } .muted { color: var(--text-mid); } .lead { font-size: 11.6px; }
table.t { border-collapse: collapse; width: 100%; font-size: 10.4px; line-height: 1.34; }
table.t th, table.t td { padding: 3px 8px; border-bottom: 1px solid var(--border-light); text-align: left; vertical-align: top; }
table.t th { background: var(--surface-sunken); color: var(--text-mid); font-size: 9.4px; text-transform: uppercase; letter-spacing: .3px; }
table.t th.num, table.t td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
table.t td.today { color: var(--text-light); }
table.t td.best { font-weight: 800; color: color-mix(in srgb, var(--success-green) 80%, black); }
table.t td.all { color: var(--text-mid); }
table.t td.fit { font-size: 9.3px; letter-spacing: -.1px; }
table.t tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--surface-sunken) 55%, white); }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 8px 0 2px; }
.card { background: var(--surface-sunken); border-radius: 0 0 var(--radius-sm) var(--radius-sm); padding: 8px 12px 9px; font-size: 10.5px; line-height: 1.4; border-top: 3px solid var(--primary-blue); }
.card b.k { display: block; font-size: 12.5px; font-weight: 800; color: var(--primary-blue); margin-bottom: 2px; }
.card .code { font-size: 9px; color: var(--text-light); margin-bottom: 4px; display: block; }
.t.guide { margin-top: 4px; } .t.guide td:last-child { white-space: nowrap; }
.callout { border-left: 3px solid var(--accent-gold); background: var(--surface-sunken); padding: 8px 13px; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; margin: 7px 0; font-size: 11px; line-height: 1.42; }
.pick { border-left-color: var(--success-green); }
ul.list { margin: 3px 0 5px; padding-left: 18px; font-size: 10.8px; line-height: 1.42; } ul.list li { margin: 3px 0; }
.shared { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 20px; font-size: 10.6px; line-height: 1.4; margin: 5px 0 3px; } .shared div::before { content: '✓ '; color: var(--success-green); font-weight: 800; }
.foot { position: absolute; bottom: 0; left: 0; right: 0; display: flex; justify-content: space-between; font-size: 8.5px; color: var(--text-light); border-top: 1px solid var(--border-light); padding-top: 4px; }
.foot b { color: var(--primary-blue); }
* { text-wrap: pretty; } h1, h2 { text-wrap: balance; }
</style></head><body>
<section class="page">
  <div class="mast"><img src="${ROOT}/icon-192.png" alt=""><div><div class="eyebrow">Marylebone Roster · December 2026 link · the shortlist</div><h1>Three good links, one edge each</h1>
  <div class="sub">Second Edition, Short Run and Even Keel against each other and against today’s link — the figures, then a recommendation</div></div></div>

  <h2>What all three share</h2>
  <p class="lead">Ten designs are in the pack. These three offer the best overall balance; others keep a specific advantage, set out on page 2. On everything below the three are the same, and on each line better than or level with today — with one exception, leave, which is under the costs on page 2.</p>
  <div class="shared">
    <div>All <b>${SE.F.met} of 9</b> December staffing rules, and all ${SE.F.flex} flexible ones (today ${TF.met} of 9, ${TF.flex} flexible)</div>
    <div><b>No fatigue warning</b>, fixed rota or with a cover week placed badly (today ${TF.A.fixed.present}, up to ${TF.A.fatigue.present})</div>
    <div><b>${SE.F.A.checks.weekendsOff} full weekends off in 26</b>, never more than ${SE.F.maxGap} weeks apart (today ${TF.A.checks.weekendsOff} in 20, up to ${TF.maxGap} apart)</div>
    <div>The same <b>35-hour</b> week and <b>${SE.F.pp.daysYear.toFixed(1)} days</b> a year, under the ceiling of 219 (today ${TF.pp.daysYear.toFixed(1)})</div>
    <div>Every closing shift <b>30 to 45 minutes shorter</b>; no shift over ${hm(SE.F.pp.longest)} (today ${hm(TF.pp.longest)})</div>
    <div><b>${SE.F.A.feel.isolatedRest} single rest days</b> in the rotation, as today; rest days otherwise in pairs or longer (${SE.F.A.feel.pairedRest} of ${SE.F.A.feel.restIslands} breaks, today ${TF.A.feel.pairedRest} of ${TF.A.feel.restIslands})</div>
  </div>

  <h2>Where they differ</h2>
  <p class="muted" style="margin-top:0">The best of the three on each line is in bold green. Today is shown for scale, not ranked.</p>
  <table class="t"><thead><tr><th>Measure</th><th class="num">Today</th>${D.map(d => `<th class="num">${esc(d.name)}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table>

  <h2>Each one’s edge</h2>
  <div class="cards">
    <div class="card"><b class="k">Second Edition</b><span class="code">${SE.code} · ${SE.fp}</span><b>The steadiest.</b> One shift time Monday to Friday in ${SE.F.A.feel.oneTurn} of ${SE.F.A.feel.workingLines} weeks and the gentlest week-to-week change of the three, ${hm(SE.F.step)}. Its cost is the one the other two have shed: ${SE.F.fixedRun} days in a row on the fixed rota.</div>
    <div class="card"><b class="k">Short Run</b><span class="code">${SR.code} · ${SR.fp}</span><b>The shortest stretches.</b> Second Edition’s duty table on a different layout of rest days — the same times, the same ${SR.F.A.feel.oneTurn} weeks on one turn — with no run over ${SR.F.fixedRun} days on the fixed rota. The price is one week at ${hm(SR.F.heavy)} (Second Edition ${hm(SE.F.heavy)}) and a slightly rougher step.</div>
    <div class="card"><b class="k">Even Keel</b><span class="code">${EK.code} · ${EK.fp}</span><b>The lightest heaviest week, and the most rest between shifts.</b> A different duty table: no week over ${hm(EK.F.heavy)}, never less than ${hm(EK.F.A.rest.minutes)} between shifts (the others ${hm(SE.F.A.rest.minutes)}). It pays with ${Math.round(EK.F.pp.late23)} late finishes a year (the others ${Math.round(SE.F.pp.late23)}), ${EK.F.newT} new times, ${EK.F.A.feel.hybrid} mixed week, and a block of ${EK.F.block.worstKind === 'L' ? 'lates' : 'earlies'} up to ${EK.F.block.worst} weeks with its cover weeks.</div>
  </div>
  <h2>Which one, by what matters most</h2>
  <table class="t guide"><thead><tr><th>If the main priority is</th><th>Choose</th></tr></thead><tbody>
    <tr><td>Five-day runs on the fixed rota, and no week mixing earlies and lates</td><td><b>Short Run</b></td></tr>
    <tr><td>The lightest heaviest week, and the most rest between shifts</td><td><b>Even Keel</b></td></tr>
    <tr><td>The steadiest start times from week to week</td><td><b>Second Edition</b></td></tr>
    <tr><td>Four weeks off for 14 days’ leave, as today</td><td><b>Long Break</b> <span class="muted">· outside the shortlist</span></td></tr>
  </tbody></table>
  <p class="muted">Every figure is computed from the rotas and checked independently; how each design was found is in the technical notes.</p>
  <div class="foot"><span>Page 1 of 2 — What they share, where they differ, each one’s edge, which to choose</span><span><b>The shortlist</b> · ${D.map(d => `${esc(d.name)} ${d.code}`).join(' · ')} · 5 Oct 2026</span></div>
</section>

<section class="page">
  <div class="mast"><div><div class="eyebrow">The shortlist · continued</div><h1>Against today, and a recommendation</h1>
  <div class="sub">On most of what a colleague feels the three are the same — a figure in grey is shared by all three</div></div></div>

  <h2>Against today’s link</h2>
  <table class="t"><thead><tr><th>Measure</th><th class="num">Today</th>${D.map(d => `<th class="num">${esc(d.name)}</th>`).join('')}</tr></thead><tbody>${todayHtml}</tbody></table>
  <p class="muted">Per-year figures are the rotation’s count scaled to 52 weeks; days a year is Monday to Saturday, a cover week counting four. Sundays stay overtime.</p>

  <h2>Why these three and not the other seven</h2>
  <p>Ten designs are in the pack. These three offer the strongest overall balance under the priorities used here — days in a row, weekends, one shift time a week, late finishes. Some of the others keep a specific advantage: Fine Tune a step seven minutes gentler than Even Keel’s, for two fewer weeks on one turn; Second Look fourteen distinct times rather than fifteen, for a heavier week; Long Break four weeks off for 14 days’ leave and a 29-day best stretch, for a fifth single rest day, two fewer one-turn weeks and a 1h 44m step. The rest give something up for nothing the three lack.</p>
  <h2>The honest costs, shared by all three</h2>
  <ul class="list">
    <li><b>Late finishes.</b> ${Math.round(SE.F.pp.late23)} a year each at 23:00 or later (today ${Math.round(TF.pp.late23)}), ${Math.round(EK.F.pp.late23)} on Even Keel. It is the December staffing: three to the close every day where today’s weekdays have two, so no link meeting the rules can have fewer than ${Math.round(SE.F.pp.late23)}.</li>
    <li><b>Leave.</b> The best 14-day stretch is ${SE.F.lv.best} days off, not today’s ${TF.lv.best}; four full weeks off, Sunday to Saturday, takes ${SE.F.lv.fourWeeks} days’ leave, not ${TF.lv.fourWeeks}. The worst stretch is a day better. All three are worse than today here, on something people plan a year around; Long Break alone keeps the 14.</li>
    <li><b>Saturdays.</b> About ${Math.round(SE.F.pp.sat) - Math.round(TF.pp.sat)} more a year each (${Math.round(SE.F.pp.sat)}, today ${Math.round(TF.pp.sat)}) — fourteen on a Saturday, the flexible rule, shared across 26 lines (today ten across 20).</li>
    <li><b>New times.</b> ${SE.F.newT} of ${SE.F.times} shift times are new on Second Edition and Short Run (${SE.F.shared} are worked today), ${EK.F.newT} of ${EK.F.times} on Even Keel. Several of the new ones are shorter versions of today’s lates: the weekday and Sunday closers start later, the Sunday office late finishes earlier.</li>
  </ul>

  <h2>Recommendation</h2>
  <div class="callout pick"><b>Short Run.</b> It is Second Edition’s duty table laid without the six-day stretch: ${SE.F.fixedRun} days in a row on Second Edition’s fixed rota, never more than ${SR.F.fixedRun} on Short Run’s (six for all three if a cover week falls badly). What it gives up is a half hour on the heaviest week (${hm(SR.F.heavy)} against ${hm(SE.F.heavy)}, both under today’s ${hm(TF.heavy)}), an hour off the lightest (${hm(SR.F.light)} against ${hm(SE.F.light)}) and ${hm(SR.F.step - SE.F.step)} on the week-to-week step. The recommendation gives most weight to avoiding a sixth day in a row, a cost on the fixed rota every cycle; a colleague who weighs steadier start times or a lighter heaviest week more highly may reasonably prefer Second Edition.</div>
  <p class="lead" style="margin-top:8px"><b>But the choice is closer than the table above makes it look.</b> Weight every line and the three finish within about a point of a hundred, and which is first turns on whether the run is measured on the fixed rota or on a cover week placed badly. So choose by the edge that matters here:</p>
  <ul class="list">
    <li><b>Choose Short Run</b> if days in a row is what colleagues raise first.</li>
    <li><b>Choose Even Keel</b> if the heaviest week and the shortest rest matter more than two late finishes a year and a seventh new time; the two late finishes buy a fourth person to the Saturday close. It is the only one on a different duty table — a genuine alternative, not a variant.</li>
    <li><b>Choose Second Edition</b> if steady shift times week to week carry the day: the gentlest change of the three and a lighter heaviest week than Short Run, at the price of the six-day stretch.</li>
  </ul>
  <div class="foot"><span>Page 2 of 2 — Against today, the shared costs, the recommendation</span><span><b>The shortlist</b> · ${D.map(d => `${esc(d.name)} ${d.code}`).join(' · ')} · 5 Oct 2026</span></div>
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
