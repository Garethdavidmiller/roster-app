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
//   node docs/proposals/tooling/summary-sheet.mjs   → docs/proposals/Proposals-Summary.pdf
import { folderStats, today, assess, sheetRules as currentRules, dutyMinutes, startMinutes, endMinutes } from './report-data.mjs';
import { chromium } from '../../../node_modules/playwright/index.mjs';
import fs from 'node:fs';
import { waivedRows } from './fresh.mjs';
const DIR = new URL('../', import.meta.url);
const DAYS=['sun','mon','tue','wed','thu','fri','sat'];
const timed = s => /^\d\d:\d\d-\d\d:\d\d$/.test(s);
function extra(p){ const L=Object.keys(p).length; let cover=0,dx=0,mins=0,minsAll=0,nAll=0,late=0,sat=0;
  for (const r of Object.values(p)){ if (DAYS.every(d=>r[d]==='SPARE')){cover++;continue;}
    for (const d of DAYS){ const s=r[d]; if(!timed(s)) continue; const m=dutyMinutes(s); minsAll+=m;nAll++;
      if(d!=='sun'){dx++;mins+=m;} if(endMinutes(s)>=1380||endMinutes(s)<startMinutes(s)) late++; if(d==='sat') sat++; } }
  const dpw=(dx+4*cover)/L; return { L, cover, dpw, dpy: dpw*365/7, avg: mins/dx, avgAll: minsAll/nAll, late: late*52/L, sat: sat*52/L }; }
const T=today();

const hm = m => `${Math.floor(m/60)}h ${String(Math.round(m%60)).padStart(2,'0')}m`;  // the sheets' own format, "13h 35m"
const TA = assess(T.patterns, 20);
const rows = folderStats().map(f => { const j=JSON.parse(fs.readFileSync(new URL(f.file, DIR),'utf8')); const p=j.patterns??j; const x=extra(p);
  return { name:f.name, code:f.code, met:f.rules.met, of:f.rules.of, waived:waivedRows(f.code, f.rules.rows).length, present:f.fixedPresent, presentW:f.worstPresent, hard:f.turnarounds>0 || f.run>13, turns:f.turnarounds, run:f.fixedRun, runW:f.run, wkd:`${f.weekends} in ${x.L}`, rest:f.rest, times:`${f.distinct} (${f.newTimes} new)`, ...x }; });
// a proposal that breaks a HARD limit cannot be run as it stands, so it sorts last whatever it scores (accuracy audit,
// 1 Oct 2026 — it sat mid-table on its rules count)
rows.sort((a,b)=> a.hard-b.hard || b.met-a.met || a.present-b.present || a.name.localeCompare(b.name));
const todayRow = { name:'Today’s link', code:'20 weeks', met:null, of:null, present:TA.fixed.present, presentW:TA.fatigue.present, run:TA.fixed.run, runW:TA.checks.longestStretch, wkd:`${TA.checks.weekendsOff} in 20`, rest:TA.rest?.minutes, times:`${TA.feel.distinctTimes}`, ...extra(T.patterns) };
// today's rules met, the rules sheet's own figure
{ const R0 = currentRules({ patterns:T.patterns, ...TA }, TA, 'today'); todayRow.met = R0.met; todayRow.of = R0.of; }
const tr = (r, cls='') => `<tr class="${cls}"><td class="n"><b>${r.name}</b><span>${r.code}</span>${r.hard ? '<em class="hl">✕ cannot be run as it stands</em>' : ''}</td><td class="${r.met===r.of?'good':''}">${r.met} of ${r.of}${r.waived ? `<span class="wv">${r.waived} waived‡</span>` : ''}</td><td class="${r.present===0?'good':''}">${r.present}${r.presentW !== r.present ? `<span class="wv">up to ${r.presentW}§</span>` : ''}</td><td>${r.run}${r.runW !== r.run ? `<span class="wv">up to ${r.runW}§</span>` : ''}</td><td>${r.wkd}</td><td class="${r.turns ? 'bad' : ''}">${r.rest==null?'—':`${r.turns ? '✕ ' : ''}${hm(r.rest)}`}${r.turns ? '<span class="wv">under the 12-hour limit</span>' : ''}</td><td>${r.times}</td><td>${r.dpw.toFixed(2)}</td><td>${Math.round(r.dpy)}</td><td>${hm(r.avg)}</td><td>${Math.round(r.late)}</td><td>${Math.round(r.sat)}</td></tr>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>December 2026 link proposals — summary</title><style>
@page{size:A4 landscape;margin:8mm 10mm}
body{font-family:Inter,Arial,sans-serif;color:#1B2533;margin:0;font-size:9pt}
h1{color:#001E3C;font-size:20pt;margin:0 0 4px} .lead{color:#5B6778;margin:0 0 12px;font-size:10.5pt;line-height:1.4;max-width:none}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th{background:#001E3C;color:#fff;font-weight:600;font-size:9pt;padding:6px 5px;text-align:center;vertical-align:bottom}
th:first-child{text-align:left}
td{white-space:nowrap;border-bottom:1px solid #DDE3EA;padding:6px 5px;text-align:center;font-size:10pt}
td.n{text-align:left} td.n span{color:#5B6778;font-size:8.5pt;margin-left:6px} td .wv{display:block;color:#5B6778;font-size:8pt}
tr.today td{background:#FFF4C2;border-bottom:2px solid #F5C800}
td.good{color:#1E7B4B;font-weight:700} td.bad{color:#B3261E;font-weight:700} td.n em.hl{display:block;font-style:normal;color:#B3261E;font-size:8pt;font-weight:600}
.foot{margin-top:10px;color:#5B6778;font-size:9pt;line-height:1.45}
</style></head><body>
<h1>December 2026 link proposals — at a glance</h1>
<p class="lead">All ${rows.length} proposals against today’s link, sorted by December rules met, then avoidable fatigue warnings; a proposal that breaks a hard limit cannot be run as it stands and comes last. Every figure is worked out from the rota by the Marylebone Roster app. Staffing levels, a 24-person link and Sunday cover confirmed verbally (29 Sep 2026).</p>
<table><thead><tr><th>Proposal · code</th><th>December rules met</th><th>Avoidable fatigue warnings§</th><th>Most days in a row§</th><th>Full weekends off</th><th>Shortest fixed-duty rest</th><th>Shift times</th><th>Days a week*</th><th>Days a year*</th><th>Average fixed shift, Mon–Sat</th><th>Finishes 23:00+ a year†</th><th>Saturdays a year†</th></tr></thead><tbody>
${tr(todayRow,'today')}
${rows.map(r=>tr(r)).join('\n')}
</tbody></table>
<p class="foot">* Monday to Saturday, with a cover week counted as 4 days (Sundays are overtime and left out). † Each person, on average across the whole link, Sundays included; cover-week duties are not known yet and are left out. “Shift times” counts different start–finish times; “new” means nobody works that time today. § On the duties the rota fixes, the cover weeks left out for the proposal and today alike; “up to” is the worst place a cover week’s four duties could fall. Avoidable fatigue warnings come from the ORR’s good-practice list plus rail-industry checks, leaving out the two that come with every weekly link — reported, never pass or fail.${rows.some(r => r.waived) ? ` ‡ A rule the owner set aside for that proposal alone (${rows.filter(r => r.waived).map(r => r.name).join(', ')}: the ticket office pairs, 30 Sep 2026).` : ''} Full detail for each proposal is in its own eight-page sheet; the rules themselves are in December-2026-Rules.pdf.</p>
</body></html>`;
const b = await chromium.launch(); const pg = await b.newPage(); await pg.setContent(html, { waitUntil: 'load' });
await pg.pdf({ path: new URL('Proposals-Summary.pdf', DIR).pathname, format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
await b.close(); console.log(`wrote Proposals-Summary.pdf — ${rows.length} proposals, today meets ${todayRow.met} of ${todayRow.of}`);
