// THE ONE-PAGE SUMMARY (owner, 29 Sep 2026: a plain summary of every proposal, packed with the sheets).
// Every proposal in this folder on one A4 page against today's link. Nothing is typed: the rules, fatigue,
// run, weekend and rest columns are `folderStats` — the figures the sheets themselves print — and the rest
// are counted here from the same JSON rotations:
//   days a week    Monday to Saturday duties + 4 per cover week, over the lines (Sundays are overtime);
//                  the figure the colleague presentation quotes (today 4.20, Familiar Nine 4.17)
//   days a year    days a week × 365/7
//   average shift  Monday to Saturday timed duties (today 8h14, Familiar Nine 8h20)
//   finishes 23:00+ and Saturdays a year — per person, averaged over the whole link; cover weeks add none
//
//   node docs/links-26/tooling/summary-sheet.mjs   → docs/links-26/links-26-summary.pdf
import { LINES, COVER_WEEKS, DAYS_CEILING, CONTRACT_MINUTES, daysAYear, monSatMinutes } from './link.mjs';
import { kindBlocks, blockText } from './blocks.mjs';
import { folderStats, today, assess, sheetRules as currentRules, dutyMinutes, startMinutes, endMinutes } from './report-data.mjs';
import { chromium } from '../../../node_modules/playwright/index.mjs';
import fs from 'node:fs';
import { waivedRows, WAIVERS, waiveShort, SHORTLIST, RECOMMENDED } from './fresh.mjs';
import { scoreOrder } from '../../../links-adjacency.js';
const DIR = new URL('../proposals/', import.meta.url);
const DAYS=['sun','mon','tue','wed','thu','fri','sat'];
const timed = s => /^\d\d:\d\d-\d\d:\d\d$/.test(s);
function extra(p){ const L=Object.keys(p).length; let cover=0,dx=0,mins=0,minsAll=0,nAll=0,late=0,sat=0;
  for (const r of Object.values(p)){ if (DAYS.every(d=>r[d]==='SPARE')){cover++;continue;}
    for (const d of DAYS){ const s=r[d]; if(!timed(s)) continue; const m=dutyMinutes(s); minsAll+=m;nAll++;
      if(d!=='sun'){dx++;mins+=m;} if(endMinutes(s)>=1380||endMinutes(s)<startMinutes(s)) late++; if(d==='sat') sat++; } }
  const dpw=(dx+4*cover)/L;
  // the columns that separate the proposals (3 Oct 2026, reader's critique: four columns were identical on every row)
  const A = assess(p, L), wk = Object.values(p).filter(r => r.mon !== 'SPARE').map(r => ['mon','tue','wed','thu','fri','sat'].reduce((s, d) => s + (timed(r[d]) ? dutyMinutes(r[d]) : 0), 0));
  const step = scoreOrder(p, Object.keys(p), { maxRunTarget: 6 }).gentleMean;
  return { L, cover, dpw, dpy: dpw*365/7, avg: mins/dx, avgAll: minsAll/nAll, late: late*52/L, sat: sat*52/L, heavy: Math.max(...wk), oneTurn: A.feel.oneTurn, working: A.feel.workingLines, mixed: A.feel.hybrid, step, block: kindBlocks(p) }; }
const T=today();
// the longest wait between two full weekends, in weeks (plain.mjs's measure): the one thing that told Second Nature and
// Second Wind apart, and a seven-in-26 that can be ten weeks apart is not the same offer as one never five apart
const gapOf = p => { const L=Object.keys(p).length, off = s => !timed(s) && s !== 'SPARE', at = [];
  for (let k = 1; k <= L; k++) if (off(p[String(k)].sat) && off(p[String(k % L + 1)].sun)) at.push(k);
  return at.length ? Math.max(...at.map((k, i) => i < at.length - 1 ? at[i + 1] - k : at[0] + L - k)) : null; };

const hm = m => `${Math.floor(m/60)}h ${String(Math.round(m%60)).padStart(2,'0')}m`;  // the sheets' own format, "13h 35m"
const TA = assess(T.patterns, 20);
const rows = folderStats().map(f => { const j=JSON.parse(fs.readFileSync(f.url,'utf8')); const p=j.patterns??j; const x=extra(p);
  return { name:f.name, code:f.code, met:f.rules.met, of:f.rules.of, waived:waivedRows(f.code, f.rules.rows).length, present:f.fixedPresent, presentW:f.worstPresent, hard:f.turnarounds>0 || f.run>13 || monSatMinutes(p)!==CONTRACT_MINUTES || daysAYear(p)>DAYS_CEILING+1e-9,   // every hard limit, the contract and the days ceiling (RULES.md) included
    turns:f.turnarounds, run:f.fixedRun, runW:f.run, wkd:`${f.weekends} in ${x.L}`, gap:gapOf(p), wkYear:f.weekends*52/x.L, rest:f.rest, times:`${f.distinct} (${f.newTimes} new)`, ...x }; });
// a proposal that breaks a HARD limit cannot be run as it stands, so it sorts last whatever it scores (accuracy audit,
// 1 Oct 2026 — it sat mid-table on its rules count)
rows.sort((a,b)=> a.hard-b.hard || b.met-a.met || a.present-b.present || a.name.localeCompare(b.name));
const todayRow = { name:'Today’s link', code:'20 weeks', met:null, of:null, present:TA.fixed.present, presentW:TA.fatigue.present, run:TA.fixed.run, runW:TA.checks.longestStretch, wkd:`${TA.checks.weekendsOff} in 20`, gap:gapOf(T.patterns), wkYear:TA.checks.weekendsOff*52/20, rest:TA.rest?.minutes, times:`${TA.feel.distinctTimes}`, ...extra(T.patterns) };
// today's rules met, the rules sheet's own figure
{ const R0 = currentRules({ patterns:T.patterns, ...TA }, TA, 'today'); todayRow.met = R0.met; todayRow.of = R0.of; }
const tr = (r, cls='') => `<tr class="${cls}"><td class="n"><b>${r.name}</b><span>${r.code}</span>${SHORTLIST.includes(r.name) ? `<em class="sl">★ shortlisted${r.name === RECOMMENDED ? ' · recommended' : ''}</em>` : ''}${r.hard ? '<em class="hl">✕ cannot be run as it stands</em>' : ''}</td><td class="${r.met===r.of?'good':''}">${r.met} of ${r.of}${r.waived ? `<span class="wv">${r.waived} waived‡</span>` : ''}</td><td class="${r.present===0?'good':''}">${r.present}${r.presentW !== r.present ? `<span class="wv">up to ${r.presentW}§</span>` : ''}</td><td>${r.run}${r.runW !== r.run ? `<span class="wv">up to ${r.runW}§</span>` : ''}</td><td>${r.wkd}<span class="wv">about ${Math.round(r.wkYear)} a year${r.gap ? ` · ${r.gap} weeks apart at most` : ''}</span></td><td class="${r.turns ? 'bad' : ''}">${r.rest==null?'—':`${r.turns ? '✕ ' : ''}${hm(r.rest)}`}${r.turns ? '<span class="wv">under the 12-hour limit</span>' : ''}</td><td>${r.times}</td><td${r.L === LINES && r.dpy > DAYS_CEILING + 1e-9 ? ' class="bad"' : ''}>${r.dpy.toFixed(1)}</td><td>${hm(r.heavy)}</td><td>${r.oneTurn} of ${r.working}<span class="wv">blocks ${blockText(r.block)}</span></td><td>${r.mixed}</td><td>${hm(r.step)}</td><td>${Math.round(r.late)}</td></tr>`;
// THE FAMILY'S LOOK (pack polish, 1 Nov 2026, from screenshots of the whole pack). This page was the one document without
// the navy band, with a navy table header in white sentence case where every other table in the pack is light grey in small
// capitals, and in the decks' blue-greys rather than the documents' greys and green. It now loads the app's stylesheet for the
// same colours, carries the band (eyebrow, title, the line that was its lead, a Prepared line), stripes its rows, sets every
// cell's first line on one baseline, keeps tabular figures for the figures (they widened the hyphens in the codes and the
// headings) and footnotes in two columns. The figures and the order are unchanged.
const ROOT = new URL('../../../', import.meta.url).href.replace(/\/$/, '');
const PREPARED = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>New CEA link proposals — at a glance</title>
<link rel="stylesheet" href="${ROOT}/shared.css"><style>
@page{size:A4 landscape;margin:8mm 10mm}
html, body{background:white !important;padding:0 !important;margin:0}
body{font-family:var(--font-sans);color:var(--text-dark);font-size:9pt;line-height:1.3}
.mast{background:var(--primary-blue);color:white;padding:7px 16px 6px;border-bottom:4px solid var(--accent-gold);border-radius:var(--radius);display:flex;gap:14px;align-items:center;margin-bottom:6px}
.mast img{width:38px;height:38px;border-radius:9px}
.mast .eyebrow{color:var(--accent-gold);font-size:7.5pt;font-weight:700;letter-spacing:.6px;text-transform:uppercase}
.mast h1{margin:0;font-size:15pt;font-weight:800;color:white;letter-spacing:-.2px}
.mast .sub{color:rgba(255,255,255,.8);font-size:9pt;line-height:1.35;text-wrap:pretty}
.mast .meta{color:rgba(255,255,255,.55);font-size:7.5pt;margin-top:3px}
table{border-collapse:collapse;width:100%}
th{background:var(--surface-sunken);color:var(--text-mid);font-weight:700;font-size:7.2pt;text-transform:uppercase;letter-spacing:.2px;line-height:1.18;padding:3px 5px;text-align:center;vertical-align:bottom;border-bottom:1px solid var(--border-mid)}
th:first-child{text-align:left}
td{white-space:nowrap;border-bottom:1px solid var(--border-light);padding:1.5px 5px;text-align:center;vertical-align:top;font-size:9.5pt;font-variant-numeric:tabular-nums}
tbody tr:nth-child(even) td{background:color-mix(in srgb, var(--surface-sunken) 55%, white)}
td.n{text-align:left;font-variant-numeric:normal} td.n span{color:var(--text-mid);font-size:8pt;margin-left:6px} td .wv{display:block;color:var(--text-mid);font-size:7.5pt}
tr.today td{background:#FFF4C2;border-bottom:2px solid var(--accent-gold)}
td.n em.sl{display:block;font-style:normal;color:var(--success-green);font-size:8pt;font-weight:700;letter-spacing:.2px}
td.good{color:var(--success-green);font-weight:700} td.bad{color:#B3261E;font-weight:700} td.n em.hl{display:block;font-style:normal;color:#B3261E;font-size:8pt;font-weight:600}
.foot{margin-top:6px;color:var(--text-mid);font-size:8.2pt;line-height:1.38;column-count:2;column-gap:26px}
/* POLISH (1 Oct 2026): an "up to" note is a caveat, so it is never coloured as the good figure above it */
td.good .wv { color: var(--text-mid); font-weight: 400; }
.foot { text-wrap: pretty; }
.pfoot{margin-top:6px;padding-top:4px;border-top:1px solid var(--border-light);color:var(--text-light);font-size:8pt;display:flex;justify-content:space-between} .pfoot b{color:var(--primary-blue)}
</style></head><body>
<div class="mast"><img src="${ROOT}/icon-192.png" alt=""><div><div class="eyebrow">Marylebone Roster · Links designer · At a glance</div><h1>New CEA link proposals — at a glance</h1>
<div class="sub">${rows.length === 1 ? 'The one proposal' : `All ${rows.length} proposals`} against today’s link — the ${['no', 'one', 'two', 'three', 'four', 'five', 'six'][SHORTLIST.length] ?? SHORTLIST.length} shortlisted ones marked ★, ${RECOMMENDED} recommended — sorted by December rules met, then avoidable fatigue warnings, then by name; a proposal that breaks a hard limit cannot be run as it stands and comes last. Every figure is worked out from the rota, by the Marylebone Roster app’s own checks and the tooling beside them. Staffing levels and Sunday cover confirmed verbally (29 Sep 2026); the ${LINES}-line link, ${COVER_WEEKS} cover weeks and a ceiling of ${DAYS_CEILING} contracted days a year set on 1 Oct 2026.</div>
<div class="meta">Prepared ${PREPARED} · every figure is computed from the rotas</div></div></div>
<table><thead><tr><th>Proposal · code</th><th>December rules met</th><th>Avoidable fatigue warnings§</th><th>Most days in a row§</th><th>Full weekends off</th><th>Shortest fixed-duty rest</th><th>Shift times</th><th>Days a year*</th><th>Heaviest week, <span style="white-space:nowrap">Mon–Sat</span></th><th>Weeks on one turn</th><th>Weeks mixing earlies and lates</th><th>Week-to-week change of start</th><th>Finishes 23:00+ a year†</th></tr></thead><tbody>
${tr(todayRow,'today')}
${rows.map(r=>tr(r)).join('\n')}
</tbody></table>
<p class="foot">* Monday to Saturday, with a cover week counted as 4 days (Sundays are overtime and left out). † Each person, on average across the whole link, Sundays included; cover-week duties are not known yet and are left out. “Shift times” counts different start–finish times; “new” means nobody works that time today. “Weeks on one turn” means one shift time Monday to Friday, all earlies or all lates; beneath it, the longest block of weeks in a row on one kind, “up to” if the cover weeks beside it go the same way. The week-to-week change is the average move of the start time from one week to the next. § On the duties the rota fixes, the cover weeks left out for the proposal and today alike; “up to” is the worst place a cover week’s four duties could fall, its Sunday worked as overtime. Avoidable fatigue warnings come from the ORR’s good-practice list plus rail-industry checks, leaving out the two that come with every weekly link — reported, never pass or fail.${rows.some(r => r.waived) ? ` ‡ A rule the owner set aside for that proposal (${rows.filter(r => r.waived).map(r => `${r.name}: the ${WAIVERS[r.code].keys.map(waiveShort).join(' and ')}, ${WAIVERS[r.code].date.replace(/ (\w{3})\w+ /, ' $1 ')}`).join('; ')}).` : ''} Full detail for each proposal is in its own eight-page sheet; the rules themselves are in <span style="white-space:nowrap">links-26-rules.pdf</span>.</p>
<p class="pfoot"><span>Page 1 of 1 — Every proposal against today’s link</span><span><b>At a glance</b> · Marylebone Roster — Links designer</span></p>
</body></html>`;
// ONE PAGE, WHATEVER THE COUNT (30 Oct 2026). The fourteenth proposal, In Step, pushed the footer onto a second sheet:
// the type was sized for thirteen rows and nothing said so. So the page is printed, its pages counted, and the scale
// stepped down a point at a time until it prints on one. The PRINTED page decides, not a measurement of the screen:
// measured in the browser the table came out some 30px taller than Chromium paginates it, and fitting to that shrank
// the page to 93% with a strip left empty at the foot. Below 80% it stops, rather than print what nobody can read.
const OUT = new URL('../links-26-summary.pdf', DIR).pathname;
const pagesIn = buf => (buf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
const htmlOut = new URL('links-26-summary.html', import.meta.url).pathname; fs.writeFileSync(htmlOut, html);   // beside the tooling, gitignored
const b = await chromium.launch(); const pg = await b.newPage(); await pg.goto('file://' + htmlOut); await pg.evaluate(() => document.fonts.ready);
let scale = 1, pdf;
for (;;) { pdf = await pg.pdf({ format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
  if (pagesIn(pdf) === 1 || scale <= 0.8) break;
  scale = Math.round((scale - 0.01) * 100) / 100; await pg.evaluate(z => { document.body.style.zoom = String(z); }, scale); }
await b.close();
if (pagesIn(pdf) !== 1) { console.error(`summary-sheet: ${pagesIn(pdf)} pages at ${Math.round(scale * 100)}% — the summary must fit one`); process.exit(1); }
fs.writeFileSync(OUT, pdf);
console.log(`wrote links-26-summary.pdf — ${rows.length} proposals, today meets ${todayRow.met} of ${todayRow.of}${scale < 1 ? `, scaled to ${Math.round(scale * 100)}% to fit one page` : ''}`);
