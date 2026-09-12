// HTML → PDF, using the workspace's OWN stylesheets so the grid, chips, check rows and heat cells are
// the app's rendering rather than an imitation of it. Own CSS covers only what a sheet of paper needs.
import { writeFileSync } from 'node:fs';
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { classifyShift, DAYS, hmFromHours, dutyMinutes, startMinutes, endMinutes, MAX_CONSECUTIVE_WORKED_DAYS } from './report-data.mjs';

const ROOT = new URL('../../../', import.meta.url).href.replace(/\/$/, '');
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const DAY_LABEL = { sun:'Sun', mon:'Mon', tue:'Tue', wed:'Wed', thu:'Thu', fri:'Fri', sat:'Sat' };
const hm = min => `${Math.floor(min/60)}h ${String(min%60).padStart(2,'0')}m`;
const label = s => s === 'SPARE' ? 'SP' : (!s || s === 'RD') ? 'RD' : s.replace('-', '<br>');

function gridHtml(p, lines, totals, daily, opts = {}) {
  const rows = [];
  for (let pos = 1; pos <= lines; pos++) {
    const row = p[String(pos)]; const t = totals.rows[pos-1];
    const cells = DAYS.map(d => `<td class="shift-cell"><span class="shift-cell-btn type-${classifyShift(row[d])}">${label(row[d])}</span></td>`).join('');
    const ex = t.assumed ? `<td class="tot-cell tot-assumed">${hm(t.exSundayMinutes)}</td><td class="tot-cell tot-assumed">${hm(t.allMinutes)}</td><td class="tot-cell tot-assumed">—</td>`
      : `<td class="tot-cell">${hm(t.exSundayMinutes)}</td><td class="tot-cell${t.allMinutes===t.exSundayMinutes?' tot-same':''}">${hm(t.allMinutes)}</td><td class="tot-cell">${t.days}</td>`;
    rows.push(`<tr><td class="pos-num">${pos}</td>${cells}${ex}</tr>`);
  }
  const cover = DAYS.map(d => `<td class="tot-cell cov-foot">${daily[d]}<span class="cov-sub">SP ${opts.spare}</span></td>`).join('');
  return `<table class="links-grid print-grid"><thead><tr><th class="col-pos">Line</th>${DAYS.map(d=>`<th>${DAY_LABEL[d]}</th>`).join('')}
    <th class="col-total">Mon–Sat<span class="col-total-sub">hours</span></th><th class="col-total">All week<span class="col-total-sub">hours</span></th><th class="col-total">Days worked<span class="col-total-sub">Mon–Sat</span></th></tr></thead>
    <tbody>${rows.join('')}</tbody>
    <tfoot><tr><td class="pos-num cov-foot-label">Cover</td>${cover}<td class="tot-cell tot-avg">${opts.avgEx}</td><td class="tot-cell tot-avg">${opts.avgAll}</td><td class="tot-cell tot-avg">${opts.avgDays}</td></tr></tfoot></table>`;
}

function heatRow(name, hours, max, cls = '') {
  const cells = hours.map((n, h) => { if (h < 5) return null; const b = n === 0 ? 0 : Math.max(1, Math.ceil((n / max) * 5)); return `<td class="cov-heat-cell heat-b${b}">${n ? n.toFixed(0) : ''}</td>`; }).filter(Boolean).join('');
  return `<tr><th class="cov-heat-day ${cls}">${name}</th>${cells}</tr>`;
}
function demandRow(name, cars, peak, bucket, shutFrom) {
  const cells = cars.map((c, h) => { if (h < 5) return null; const b = bucket(c, peak); const shut = h >= shutFrom; return `<td class="cov-heat-cell dem-cell dem-b${b}${shut?' dem-shut':''}">${c ? c : ''}</td>`; }).filter(Boolean).join('');
  return `<tr><th class="cov-heat-day dem-day">${name}</th>${cells}</tr>`;
}
const hourHead = () => `<tr><th class="cov-heat-hour"></th>${Array.from({length:19},(_,i)=>`<th class="cov-heat-hour">${String(i+5).padStart(2,'0')}</th>`).join('')}</tr>`;

export async function renderPdf(D, out) {
  const { today: T, prop: P, meta } = D;
  const BB = meta.kind === 'BB';
  // QT — Quarter To: structurally a Same Turns document (it inherits every ST section), with a third
  // branch wherever ST's copy claims that every time is one people work today, because two are not.
  // Every figure in those branches is READ off the tables, never typed.
  const QT = meta.kind === 'QT';
  const S = meta.stretch;   // { closer:{from,to}, closerShift, turns:[{from,to,people,each,onToday}], weekly, allOnToday } or null
  const stretchWords = S ? S.turns.map(t => `${t.from} to ${t.to.split('-')[1]} (${t.people} people, ${t.each} minutes each)`).join(' and ') : '';
  const newTimes = P.tableRows.filter(r => !T.tableRows.some(t => t.time === r.time)).map(r => r.time);
  const sharedTimes = P.feel.distinctTimes - newTimes.length;
  const ff = (a, code, t) => a.fatigue.results.find(r => r.code === code && (!t || r.title.includes(t)));
  const icon = st => st === 'present' ? '⚠' : st === 'clear' ? '✓' : st === 'standing' ? '●' : '–';
  const cls = st => st === 'present' ? 'check-warn-row' : st === 'clear' ? 'check-good' : 'check-neutral';
  const rowsFF = P.fatigue.results.map(r => { const t = T.fatigue.results.find(x => x.code === r.code && x.title === r.title);
    const val = x => x ? (x.status === 'n/a' ? '–' : (x.value ?? '')) : '';
    return `<tr class="ff-${r.status}"><td class="ff-code">${r.code}</td><td class="ff-title">${esc(r.title)}${r.confirm?' <span class="muted">(definition to confirm)</span>':''}<span class="ff-fam">${esc(r.family)}</span></td>
      <td class="ff-st ff-${t?.status}">${icon(t?.status)} ${esc(val(t))}</td><td class="ff-st ff-${r.status}">${icon(r.status)} ${esc(val(r))}</td></tr>`; }).join('');

  const tableRows = (() => {
    const times = new Set([...T.tableRows.map(r=>r.time), ...P.tableRows.map(r=>r.time)]);
    const get = (A, t) => A.tableRows.find(r => r.time === t);
    return [...times].sort((a,b)=>startMinutes(a)-startMinutes(b)||endMinutes(a)-endMinutes(b)).map(t => { const a = get(T,t), b = get(P,t);
      const cell = (x, k, y) => { const v = x?.[k] ?? 0, w = y?.[k] ?? 0; return `<td class="${v!==w ? (w>v?'up':'down') : ''}">${v||''}</td>`; };
      const pc = (x, k, y) => { const v = x?.[k] ?? 0, w = y?.[k] ?? 0; return `<td class="${v!==w ? (w>v?'up':'down') : ''}"><b>${w||''}</b>${w!==v?`<span class="delta">${w>v?'+':''}${w-v}</span>`:''}</td>`; };
      const fam = classifyShift(t) === 'early' ? 'Early' : 'Late';
      return `<tr class="${!b?'gone':''}"><td class="tt">${t}<span class="muted"> ${hm(dutyMinutes(t))} · ${fam}</span></td>${cell(a,'weekday',b)}${cell(a,'sat',b)}${cell(a,'sun',b)}${pc(a,'weekday',b)}${pc(a,'sat',b)}${pc(a,'sun',b)}</tr>`; }).join('');
  })();

  const importPadded = Array.from({length: 24}, (_, i) => `${String(i+1).padStart(2)}  ${DAYS.map(d => (P.patterns[String(i+1)][d] === 'SPARE' ? 'SP' : P.patterns[String(i+1)][d]).padEnd(11)).join(' ')}`).join('\n');
  const importText = Array.from({length: 24}, (_, i) => `${i+1}\t${DAYS.map(d => P.patterns[String(i+1)][d] === 'SPARE' ? 'SP' : P.patterns[String(i+1)][d]).join('\t')}`).join('\n');

  const hard = P.hard.checks[0], hardT = T.hard.checks[0];
  const feelRow = (k, a, b, note='') => `<tr><td>${k}</td><td>${a}</td><td><b>${b}</b></td><td class="muted">${note}</td></tr>`;
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Proposed CEA Link — December 2026</title>
<link rel="stylesheet" href="${ROOT}/shared.css"><link rel="stylesheet" href="${ROOT}/links.css">
<style>
@page { size: A4; margin: 11mm 11mm 13mm; }
html, body { background: white !important; color: var(--text-dark); padding: 0 !important; margin: 0; font-family: var(--font-sans); font-size: 10.5px; line-height: 1.4; }
.page { page-break-after: always; position: relative; min-height: 270mm; }
.page:last-child { page-break-after: auto; }
.mast { background: var(--primary-blue); color: white; padding: 18px 22px 16px; border-bottom: 4px solid var(--accent-gold); border-radius: var(--radius); display: flex; gap: 16px; align-items: center; }
.mast img { width: 44px; height: 44px; border-radius: 10px; }
.mast .eyebrow { color: var(--accent-gold); font-size: 10px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; }
.mast h1 { margin: 2px 0 2px; font-size: 22px; font-weight: 800; color: white; letter-spacing: -.2px; }
.mast .sub { color: rgba(255,255,255,.78); font-size: 11.5px; }
.mast .meta { color: rgba(255,255,255,.55); font-size: 9.5px; margin-top: 4px; }
.cover .mast { padding: 26px 28px 22px; border-radius: 14px; }
.cover .mast h1 { font-size: 30px; }
.ident { display: grid; grid-template-columns: 1fr 1.35fr; gap: 0; margin: 14px 0 0; border: 2px solid var(--accent-gold); border-radius: var(--radius); overflow: hidden; }
.ident-main { background: var(--accent-gold); color: var(--primary-blue); padding: 14px 18px; }
.ident-eyebrow { font-size: 9.5px; font-weight: 800; letter-spacing: .6px; text-transform: uppercase; opacity: .75; }
.ident-name { font-size: 30px; font-weight: 900; letter-spacing: -.5px; line-height: 1.05; margin-top: 2px; }
.ident-strap { font-size: 11.5px; font-weight: 600; margin-top: 4px; }
.ident-side { padding: 10px 14px; background: white; display: flex; flex-direction: column; justify-content: center; gap: 3px; }
.ident-row { display: grid; grid-template-columns: 62px 1fr; gap: 8px; font-size: 9.5px; align-items: baseline; }
.ident-k { font-size: 8.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .4px; color: var(--text-light); }
.ident-v { color: var(--text-dark); } .ident-v.tt { font-weight: 800; color: var(--primary-blue); font-size: 11px; }
.strip { margin: 12px 0 0; display: flex; flex-wrap: wrap; gap: 6px 8px; padding: 10px 12px; background: var(--surface-sunken); border-radius: var(--radius); }
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 14px 0; }
.tile { border-left: 4px solid var(--accent-gold); background: var(--surface-sunken); padding: 10px 12px; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.tile b { display: block; font-size: 22px; font-weight: 800; color: var(--primary-blue); letter-spacing: -.3px; }
.tile .l { display: block; font-size: 11px; font-weight: 600; color: var(--text-dark); margin-top: 2px; }
.tile .s { display: block; font-size: 9.5px; color: var(--text-mid); margin-top: 2px; }
h2 { font-size: 14px; color: var(--primary-blue); margin: 16px 0 6px; font-weight: 800; }
h3 { font-size: 11.5px; color: var(--primary-blue); margin: 12px 0 4px; font-weight: 700; }
p { margin: 4px 0 8px; } .muted { color: var(--text-mid); font-weight: 400; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; } .cols.duty { grid-template-columns: 62% 1fr; gap: 14px; } .dutyt td, .dutyt th { padding: 2px 6px; } .bb-dense .dutyt td { padding: 1px 6px; font-size: 9px; line-height: 1.3; } .bb-dense p.muted { font-size: 9.5px; line-height: 1.35; } .changed td:nth-child(4) { width: 34%; } .stack { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
table.t { border-collapse: collapse; width: 100%; font-size: 10px; }
table.t th, table.t td { padding: 3px 6px; border-bottom: 1px solid var(--border-light); text-align: left; vertical-align: top; }
table.t th { background: var(--surface-sunken); color: var(--text-mid); font-size: 9px; text-transform: uppercase; letter-spacing: .3px; }
table.t td.num, table.t th.num { text-align: right; font-variant-numeric: tabular-nums; }
.tt { font-variant-numeric: tabular-nums; white-space: nowrap; }
td.up { background: color-mix(in srgb, var(--success-green) 10%, white); } td.down { background: color-mix(in srgb, var(--warning-amber) 14%, white); }
.delta { color: var(--text-mid); font-size: 9px; margin-left: 4px; } tr.gone td { color: var(--text-light); text-decoration: line-through; }
.print-grid { min-width: 0; width: 100%; } .print-grid .shift-cell { height: 20px; }
.print-grid .shift-cell-btn { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 8.5px; font-weight: 700; line-height: 1.15; border: 0; padding: 0 2px; }
.print-grid .pos-num { font-size: 9px; font-weight: 700; color: var(--text-mid); width: 26px; }
.print-grid thead th { position: static; padding: 4px 3px; font-size: 9px; } .print-grid th.col-total { width: 56px; min-width: 56px; }
.print-grid td.tot-cell { font-size: 9px; padding: 0 3px; } .cov-foot { font-weight: 800; color: var(--text-dark); } .cov-sub { display: block; font-weight: 500; font-size: 8px; color: var(--shift-spare-text); }
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; } .legend > span { white-space: nowrap; } .legend .muted { white-space: normal; flex-basis: 100%; }
.legend-x { font-size: 9.5px; color: var(--text-mid); margin-top: 6px; } .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; vertical-align: -1px; margin-right: 4px; }
.cov-heat { border-collapse: collapse; width: 100%; } .cov-heat th, .cov-heat td { border: 1px solid var(--border-light); text-align: center; } .cov-heat-cell { height: 20px; min-width: 0; font-size: 9px; } .cov-heat-day { text-align: left !important; padding: 0 6px; white-space: nowrap; font-size: 9px; }
.check-row { font-size: 10.5px; padding: 6px 9px; } .check-rows { gap: 5px; }
table.ff { border-collapse: collapse; width: 100%; font-size: 9.5px; } table.ff td { padding: 2px 6px; border-bottom: 1px solid var(--border-light); vertical-align: top; } table.ff th { text-align: left; font-size: 9px; text-transform: uppercase; color: var(--text-mid); background: var(--surface-sunken); padding: 4px 6px; }
.ff-code { font-weight: 800; color: var(--primary-blue); white-space: nowrap; width: 38px; } .ff-fam { display: inline; font-size: 8.5px; color: var(--text-light); margin-left: 6px; }
.ff-st { white-space: nowrap; font-weight: 700; width: 92px; } .ff-present { color: color-mix(in srgb, var(--warning-amber) 55%, black); } .ff-clear { color: color-mix(in srgb, var(--success-green) 80%, black); } .ff-standing { color: var(--text-mid); } .ff-n\\/a { color: var(--text-light); font-weight: 400; }
tr.ff-present td { background: color-mix(in srgb, var(--warning-amber) 8%, white); }
pre.imp { font-size: 7.4px; line-height: 1.35; background: var(--surface-sunken); padding: 8px 10px; border-radius: var(--radius-sm); font-family: ui-monospace, Menlo, Consolas, monospace; white-space: pre; margin: 0; }
.foot-id b { color: var(--primary-blue); }
.foot { position: absolute; bottom: 0; left: 0; right: 0; display: flex; justify-content: space-between; font-size: 8.5px; color: var(--text-light); border-top: 1px solid var(--border-light); padding-top: 4px; }
.callout { border-left: 3px solid var(--accent-gold); background: var(--surface-sunken); padding: 8px 12px; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; margin: 8px 0; }
.rule-list td:first-child { width: 46%; }
.kept td:nth-child(1) { width: 38%; } .kept td:nth-child(2), .kept td:nth-child(3) { width: 24%; white-space: nowrap; } .kept td:nth-child(4) { display: none; } .kept th:nth-child(4) { display: none; }
.changed td:nth-child(1) { width: 46%; } .changed td.num { width: 13%; } .changed td.num { white-space: nowrap; }
.alts td, .alts th { white-space: nowrap; padding: 3px 8px; } .alts td:first-child { white-space: normal; width: 42%; }
</style></head><body>

<section class="page cover">
  <div class="mast"><img src="${ROOT}/icon-192.png" alt=""><div><div class="eyebrow">Marylebone Roster · Links designer</div><h1>Proposed CEA Link — December 2026</h1>
  <div class="sub">${BB ? 'A 24-line link built from the December staffing rules and judged on the ORR fatigue factors — nothing carried over from today’s roster except the rules' : QT ? 'The existing 20-line link, widened to 24 people, with the closing turn starting at 15:45 — the same shape of week, one more cover cycle, and one turn a little longer to keep the contract' : 'The existing 20-line link, widened to 24 people — the same turns, the same shape of week, one more cover cycle'}</div>
  <div class="meta">Prepared ${meta.date} · built for the December 2026 timetable and assessed by the workspace's own rule modules · figures on this page are computed, not typed</div></div></div>
  <div class="ident"><div class="ident-main"><div class="ident-eyebrow">Proposal</div><div class="ident-name">${esc(meta.identity.name)}</div><div class="ident-strap">${esc(meta.identity.strap)}</div></div>
   <div class="ident-side"><div class="ident-row"><span class="ident-k">Code</span><span class="ident-v tt">${esc(meta.identity.code)}</span></div><div class="ident-row"><span class="ident-k">Fingerprint</span><span class="ident-v tt">${esc(meta.identity.fingerprint)}</span></div><div class="ident-row"><span class="ident-k">Built from</span><span class="ident-v">duty table ${esc(meta.identity.table)} · seed ${esc(String(meta.identity.seed))} · 24 lines · 4 cover weeks</span></div><div class="ident-row"><span class="ident-k">Lineage</span><span class="ident-v">${esc(meta.identity.lineage)}</span></div></div></div>
  <div class="strip"><span class="sum-chip sum-chip--ok">✓ <strong>24</strong> lines designed</span><span class="sum-chip sum-chip--ok">✓ <strong>${hmFromHours(P.hours.exSunday)}</strong> a week, exactly the contract</span>
   <span class="sum-chip sum-chip--ok">✓ <strong>0</strong> hard-limit breaches</span><span class="sum-chip sum-chip--ok">✓ <strong>0</strong> rests under 12h</span>
   <span class="sum-chip sum-chip--${P.fatigue.present?'warn':'ok'}">${P.fatigue.present?'⚠':'✓'} <strong>${P.fatigue.present}</strong> fatigue factor${P.fatigue.present===1?'':'s'} present <span class="muted">(today: ${T.fatigue.present})</span></span></div>
  <div class="tiles">
    ${BB ? `<div class="tile"><b>${P.feel.distinctTimes} turns</b><span class="l">in the December duty table</span><span class="s">searched against the timetable; lates shorter than earlies; on the quarter hour except the open and close</span></div>`
         : QT ? `<div class="tile"><b>${sharedTimes} of ${P.feel.distinctTimes}</b><span class="l">shift times are today's</span><span class="s">${newTimes.length === 1 ? `the one that is not: ${newTimes[0]}, the later closer — the openers' new finishes are Saturday's own` : `the ${newTimes.length} that are not: ${newTimes.join(' and ')} — the later closer, and the opener stretched to pay for it`}</span></div>`
         : `<div class="tile"><b>${P.feel.distinctTimes} of ${T.feel.distinctTimes}</b><span class="l">shift times are today's</span><span class="s">every time on the sheet is one people already work — nothing new to learn</span></div>`}
    <div class="tile"><b>${P.checks.longestStretch} days</b><span class="l">longest run of worked days</span><span class="s">today's link reaches ${T.checks.longestStretch}; Chiltern's limit is ${MAX_CONSECUTIVE_WORKED_DAYS}</span></div>
    ${BB ? `<div class="tile"><b>${P.fatigue.present} of 25</b><span class="l">fatigue factors present</span><span class="s">today's link has ${T.fatigue.present}; every other factor is clear or does not apply</span></div>`
         : `<div class="tile"><b>${P.feel.oneTurn} of ${P.feel.workingLines}</b><span class="l">working weeks are one turn</span><span class="s">same clock time all week, as ${T.feel.oneTurn} of today's ${T.feel.workingLines} are</span></div>`}
    <div class="tile"><b>${P.checks.weekendsOff} in 24</b><span class="l">full weekends off</span><span class="s">${P.checks.weekendsOffPct}% of the rotation, against ${T.checks.weekendsOffPct}% today (${T.checks.weekendsOff} in 20)</span></div>
    <div class="tile"><b>4 cover weeks</b><span class="l">lines ${P.feel.spareLines.join(', ')}</span><span class="s">evenly spaced six lines apart — today's sit at ${T.feel.spareLines.join(', ')}</span></div>
    <div class="tile"><b>${ff(P,'FF18')?.value?.toString().replace(/.*typically /,'') ?? ''}</b><span class="l">typical week-to-week move</span><span class="s">how far the working day shifts each week — today's link moves ${ff(T,'FF18')?.value?.toString().replace(/.*typically /,'') ?? ''}</span></div>
  </div>
  <h2>What this is</h2>
  ${BB ? `<p>A proposal for the CEA link once the December 2026 timetable arrives, for a team of 24 — built the other way round from <i>Same Turns</i>. Nothing was carried over from today's roster. The duty table is the workspace's own December table: four to open every day, three through to the close and four on a Saturday, five still on at 22:00, fourteen on a Saturday and ten on a Sunday, every duty between 7h and 9h30 on the quarter hour except where it meets the station's open or close, late turns deliberately shorter than early ones, and the times searched against the measured December service. That table pays the 35-hour week to the minute across 20 working lines and four cover weeks.</p>
  <p>The rotation was then searched for one thing: the rules it will be assessed against. Chiltern's 13-day limit, twelve hours between duties and the exact contract were treated as walls; the 25 ORR good-practice fatigue factors were the objective, each one scored by the workspace's own <span class="tt">assessFatigue</span> on every one of about a million candidate arrangements, together with the size of the week-to-week step, weekends off and an even spread of cover weeks. Only after every factor was settled was a week's coherence allowed to count — one turn a week where it costs nothing against the factors — so that a rotation is not chopped up for no fatigue gain. The rules-only version, with no such term, is on page 7 for comparison. Page 7 says how, and how to reproduce it.</p>` : QT ? `  <p>A proposal for the CEA link once the December 2026 timetable arrives, for a team of 24 rather than 20 — <i>Same Turns</i> with one change asked for: the weekday closing turn starts at <b>15:45</b> rather than 15:15. Everything else that brief kept is kept — a week is one turn, rest days come in pairs, four whole cover weeks spread round the rotation, the same 06:20 / 08:00 / 14:00 clock times — together with the December staffing shape (four to open every day, three through to the close, four on a Saturday, five still on at 22:00, fourteen on a Saturday, ten on a Sunday) and every rule the link is assessed against: Chiltern's 13-day limit, twelve hours between duties, the exact 35-hour contracted week, and the ORR's good-practice fatigue factors.</p>
  <p>A later start is a shorter turn. Thirty minutes off three duties a day is ${S?.closerShift ? S.closerShift * 3 * 5 : 450} minutes a week, and the contract is an equality, so those minutes have to go back somewhere — and with today's turns alone no table pays it. The second rule, no duty over 8h40, rules out lengthening a middle or late turn; so the two 06:20 openers run on at their finish: ${stretchWords || 'see page 3'}. ${S?.allOnToday ? "Those finishes are Saturday's own opening turns, so the 15:45 closer is the only time on the sheet nobody works today, and every weekday duty is 8h30 or under." : 'Every weekday duty is 8h30 or under.'} The search then arranged the duties across 24 lines exactly as <i>Same Turns</i> was built, with the workspace's own modules scoring every candidate. Page 7 says how, and how to reproduce it.</p>` : `  <p>A proposal for the CEA link once the December 2026 timetable arrives, for a team of 24 rather than 20. The brief was to keep the <b>feel</b> of the link people work today — a week is one turn, rest days come in pairs, four whole cover weeks spread round the rotation, and the same 06:20 / 08:00 / 14:00 / 15:15 clock times — while meeting the staffing shape agreed for December (four to open every day, three through to the close, four on a Saturday, five still on at 22:00, fourteen on a Saturday, ten on a Sunday) and every rule the link is assessed against: Chiltern's 13-day limit, twelve hours between duties, the exact 35-hour contracted week, and the ORR's good-practice fatigue factors.</p>
  <p>It was not drawn by hand and it was not produced by the workspace's generator, which slides a person's start time through the week. Instead the December duty table was written in today's shift times, and a search then arranged those duties across 24 lines — over a million candidate arrangements — with the workspace's own hard-limit, rest, contract, fatigue and line-order modules scoring every one, plus a measure of how closely each resembled today's roster. Page 7 says how, and how to reproduce it.</p>`}
  <div class="callout"><b>What it is not.</b> Not a recommendation and not a finished roster: nothing here has been through the roster office or a rep. The 24-line length, the four cover weeks and the December headcounts are owner-relayed figures with no document behind them (evidence class C), and the 13-day limit's policy citation is still outstanding — pages 5 and 6 say so where it applies. It clears every rule the tool can check, which is the floor for being worth discussing.</div>
  <div class="foot"><span>Page 1 of 8 — What this is</span><span class="foot-id"><b>${esc(meta.identity.name)}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>
</section>

<section class="page">
  <div class="mast"><div><div class="eyebrow">The rotation</div><h1>The 24-line link</h1><div class="sub">Sunday to Saturday per line; everyone moves down one line each week and line 24 goes back to line 1. Hours and days at the right, cover beneath.</div></div></div>
  <div style="margin-top:10px">${gridHtml(P.patterns, 24, P.totals, P.daily, { spare: 4, avgEx: hmFromHours(P.hours.exSunday), avgAll: hmFromHours(P.hours.all), avgDays: P.totals.daysAverage.toFixed(2) })}</div>
  <div class="legend"><span><i style="background:color-mix(in srgb, var(--shift-early-fill) 16%, white)"></i>Early turns</span><span><i style="background:color-mix(in srgb, var(--shift-late-fill) 16%, white)"></i>Late turns</span><span><i style="background:color-mix(in srgb, var(--accent-gold) 22%, white)"></i>Cover (spare) week — four duties of seven, any turn</span><span><i style="background:var(--surface-sunken);border:1px solid var(--border-mid)"></i>Rest day</span><span class="muted">Mon–Sat hours average ${hmFromHours(P.hours.exSunday)} over 24 lines, a cover week counted as a contracted week · days worked average over the 20 working lines</span></div>
  <div class="foot"><span>Page 2 of 8 — The 24-line grid</span><span class="foot-id"><b>${esc(meta.identity.name)}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>
</section>

<section class="page">
  <div class="mast"><div><div class="eyebrow">${BB ? "The December table" : QT ? "Today's link, widened — the closer at 15:45" : "Today's link, widened"}</div><h1>${BB ? "How a week compares with today" : QT ? "Same feel, later closer" : "Same feel, more people"}</h1><div class="sub">${BB ? "Nothing here was asked to resemble today's roster; this is how close the fatigue factors took it on their own, and where the December table differs" : QT ? "What the search was told to keep, what the December headcounts made it change, and the one turn that moved to pay for the later start" : "What the search was told to keep, and what the December headcounts made it change"}</div></div></div>
  <div class="stack">
  <div><h2>${BB ? 'The shape of a week, against today' : 'Kept — the shape of a week'}</h2>
  <table class="t kept"><thead><tr><th>Measure</th><th>Today (20)</th><th>Proposed (24)</th><th></th></tr></thead><tbody>
  ${feelRow('Working weeks that are one turn <span class="muted">(one clock time Mon–Fri)</span>', `${T.feel.oneTurn} of ${T.feel.workingLines}`, `${P.feel.oneTurn} of ${P.feel.workingLines}`)}
  ${feelRow('Weeks mixing early and late turns', `${T.feel.hybrid}`, `${P.feel.hybrid}`)}
  ${feelRow('Rest-day breaks that are two days or more', `${T.feel.pairedRest} of ${T.feel.restIslands}`, `${P.feel.pairedRest} of ${P.feel.restIslands}`)}
  ${feelRow('Single rest days between duties <span class="muted">(not a 48h break)</span>', `${T.feel.isolatedRest}`, `${P.feel.isolatedRest}`)}
  ${feelRow('Days worked in a week <span class="muted">(lines × days)</span>', Object.entries(T.feel.daysHist).map(([d,n])=>`${n}×${d}`).join(', '), Object.entries(P.feel.daysHist).map(([d,n])=>`${n}×${d}`).join(', '))}
  ${feelRow('Cover (spare) weeks <span class="muted">(whole weeks)</span>', `lines ${T.feel.spareLines.join(', ')}`, `lines ${P.feel.spareLines.join(', ')}`)}
  ${feelRow(`Distinct shift times <span class="muted">(${BB ? 'none on today’s roster' : QT ? `all but ${newTimes.length} on today’s roster` : 'all already on today’s roster'})</span>`, `${T.feel.distinctTimes}`, `${P.feel.distinctTimes}`)}
  ${feelRow('Mon–Sat hours, average week <span class="muted">(the contract)</span>', hmFromHours(T.hours.exSunday), hmFromHours(P.hours.exSunday))}
  ${feelRow('Sunday duties <span class="muted">(not contracted; half the working lines)</span>', `${T.hours.sundayDuties} of ${T.feel.workingLines} lines`, `${P.hours.sundayDuties} of ${P.feel.workingLines} lines`)}
  </tbody></table></div>
  <div><h2>Changed — the December headcount</h2>
  <table class="t changed"><thead><tr><th>People on duty</th><th class="num">Today</th><th class="num">Proposed</th><th>Why</th></tr></thead><tbody>
  <tr><td>Monday to Friday</td><td class="num">${T.daily.tue}</td><td class="num"><b>${P.daily.tue}</b></td><td class="muted">the contract: 20 working lines × 35h has to be worked somewhere</td></tr>
  <tr><td>Saturday</td><td class="num">${T.daily.sat}</td><td class="num"><b>${P.daily.sat}</b></td><td class="muted">owner’s figure for December, leaning late for events</td></tr>
  <tr><td>Sunday</td><td class="num">${T.daily.sun}</td><td class="num"><b>${P.daily.sun}</b></td><td class="muted">owner’s figure for December</td></tr>
  <tr><td>Opening at 06:20 (07:15 Sunday)</td><td class="num">4</td><td class="num"><b>4</b></td><td class="muted">unchanged</td></tr>
  <tr><td>Through to the 23:55 close, weekday</td><td class="num">2</td><td class="num"><b>3</b></td><td class="muted">three to close</td></tr>
  <tr><td>Through to the close, Saturday</td><td class="num">2</td><td class="num"><b>4</b></td><td class="muted">four on a Saturday</td></tr>
  <tr><td>Still on duty at 22:00</td><td class="num">4</td><td class="num"><b>5</b></td><td class="muted">five are enough from 22:00</td></tr>
  </tbody></table></div>
  </div>
  ${BB ? `<h2>The duty table — the December default, beside today's</h2>
  <div class="cols bb-dense"><div><table class="t dutyt"><thead><tr><th>December turn</th><th class="num">Wk</th><th class="num">Sat</th><th class="num">Sun</th></tr></thead><tbody>${P.tableRows.map(x => `<tr><td class="tt">${x.time}<span class="muted"> ${hm(x.minutes)} · ${classifyShift(x.time)==='early'?'Early':'Late'}</span></td><td class="num">${x.weekday||''}</td><td class="num">${x.sat||''}</td><td class="num">${x.sun||''}</td></tr>`).join('')}</tbody></table></div>
  <div><table class="t dutyt"><thead><tr><th>Today's turn <span class="muted">(none is reused)</span></th><th class="num">Wk</th><th class="num">Sat</th><th class="num">Sun</th></tr></thead><tbody>${T.tableRows.map(x => `<tr><td class="tt muted">${x.time}<span class="muted"> ${hm(x.minutes)}</span></td><td class="num muted">${x.weekday||''}</td><td class="num muted">${x.sat||''}</td><td class="num muted">${x.sun||''}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="cols bb-dense" style="margin-top:6px"><p class="muted" style="margin:0">Read the December table in three blocks: eleven turns Monday to Saturday alike, Saturday's own two (a later 08:30 morning body for its 10:00 peak, and one late spent on a fourth closer), and Sunday's six for its 07:15–23:25 window. Openers stagger by their finish and closers by their start so nobody hands over a cliff; there are only two morning arrival times; and 50 of the 54 start and finish instances sit on :00, :15, :30 or :45 — Saturday's four openers and four closers make a fully quarter-hour day arithmetically impossible.</p>
  <p class="muted" style="margin:0">06:20–13:30 is the one short early; every other early (8h25–9h30) is longer than every late (7h15–8h10), which is the lever against unpopular lates. None of the 19 turns is a time people work today — that is the whole difference between this family and <i>Same Turns</i>, and it is the question to put to the room rather than to the tool.</p></div>`
  : `<h2>${QT ? "The duty table — today's times, the closer at 15:45" : "The duty table, in today's times"}</h2>
  <div class="cols duty"><div>
  <table class="t dutyt"><thead><tr><th>Turn</th><th class="num">Wk</th><th class="num">Sat</th><th class="num">Sun</th><th class="num">Wk</th><th class="num">Sat</th><th class="num">Sun</th></tr></thead><tbody>${tableRows}</tbody></table></div>
  <div><p class="muted">Busiest weekday · Saturday · Sunday. The first three columns are what the 20-line link does now; the last three are the proposal. Green cells grew, amber shrank, a struck-through row is a time the proposal does not use.</p>
  ${QT && S ? `<p class="muted">The 15:45 closer is ${S.closerShift} minutes shorter than the 15:15 turn it replaces — three a day, ${S.closerShift * 15} minutes a week — and with today's turns alone no table reaches 42,000 exactly. The two 06:20 openers run on to put them back: ${stretchWords}, ${S.weekly} minutes a week${S.allOnToday ? " — and those are Saturday's own opening times" : ''}. Nothing runs over 8h30; the other ways of doing it under the 8h40 rule are on page 7.</p>` : ''}
  <p class="muted">Why the extra duties land where they do: a weekday needs 6,980 minutes and a Saturday 7,100 for 5 weekdays + 1 Saturday to total exactly 20 × 35h = 42,000 — an equality, so the table is one of the few combinations of today's turn lengths that reaches it to the minute. The 06:20–13:35 turn is folded into 06:20–13:45 (ten minutes, one fewer time to remember); Sunday gains an 11:00–19:30 middle turn from the weekday vocabulary.</p></div>
  </div>`}
  <div class="foot"><span>Page 3 of 8 — ${BB ? "How a week compares with today" : QT ? "Same feel, later closer" : "Same feel, more people"}</span><span class="foot-id"><b>${esc(meta.identity.name)}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>
</section>

<section class="page">
  <div class="mast"><div><div class="eyebrow">Cover against the service</div><h1>People on duty, hour by hour</h1><div class="sub">Cover today and proposed against the measured December 2026 timetable (arrivals and departures, weighted by train length). A darker orange hour carries more of the day's traffic.</div></div></div>
  ${['weekday','sat','sun'].map(cls => { const dayT = cls==='weekday'?'tue':cls, dayP = dayT; const win = cls==='sun' ? [7,23] : [6,23]; const shut = cls==='sun' ? 23 : 24;
    const name = cls==='weekday'?'Monday to Friday':cls==='sat'?'Saturday':'Sunday';
    const max = Math.max(...T.hourly[dayT].hours, ...P.hourly[dayP].hours);
    return `<h2>${name} <span class="muted" style="font-weight:400;font-size:10px">window ${cls==='sun'?'07:15–23:25':'06:20–23:55'}</span></h2><table class="cov-heat">${hourHead()}${heatRow('Today', T.hourly[dayT].hours, max)}${heatRow('Proposed', P.hourly[dayP].hours, max)}${demandRow('Dec 2026 traffic', D.demand.profile[cls].cars, D.demand.peak, D.demand.bucket, shut)}</table>`; }).join('')}
  <p class="muted" style="margin-top:10px">Spare cover is not in these figures — a cover week carries no times, so the rows are a floor. ${meta.sundayNote}</p>
  <div class="callout"><b>Reading it.</b> ${BB ? 'The table’s times were searched against this curve on a five-minute grid, so the cover follows the traffic as closely as the day’s fixed minutes allow — the weekday’s two peaks are one duty length apart, which is why cover stays fairly flat between them. Saturday’s 17:00–22:00 was weighted for events. ' : ''}The proposal raises the whole day rather than reshaping it, which is what the December brief asked for — the station rosters posts (ticket office, gateline, passenger assist) plus break cover, and a post needs someone on it whether the hour carries 23 trains or 5. The one hour the search was allowed to favour is Saturday's 17:00–22:00, for events. The weekday's two peaks are a duty length apart, so cover stays fairly flat between them by arithmetic, not neglect.</div>
  <div class="foot"><span>Page 4 of 8 — Cover against the timetable</span><span class="foot-id"><b>${esc(meta.identity.name)}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>
</section>

<section class="page">
  <div class="mast"><div><div class="eyebrow">The rules it is assessed against</div><h1>The checks sheet</h1><div class="sub">Hard limits first — met or not. Then the ORR good-practice fatigue factors, which report what is present and never pass or fail a design.</div></div></div>
  <h2>Hard limits <span class="muted" style="font-weight:400;font-size:10px">— a design either meets these or cannot be run</span></h2>
  <div class="check-rows">
    <div class="check-row ${hard.status==='ok'?'check-good':'check-bad'}"><span class="check-icon ${hard.status==='ok'?'check-tick':'check-cross'}">${hard.status==='ok'?'✓':'✕'}</span><div class="check-body"><b>${esc(hard.title)}</b> — longest possible run <b>${hard.value}</b> days (today: ${hardT.value})<div class="check-sub">${esc(hard.detail)}<br><span class="muted">Basis: ${esc(hard.basis)}. Configured from Chiltern practice; the policy citation is outstanding, so this is stated as the app states it.</span></div></div></div>
    <div class="check-row check-good"><span class="check-icon check-tick">✓</span><div class="check-body"><b>At least 12 hours between duties</b> — <b>${P.checks.turnarounds.length}</b> rests under 12h anywhere in the rotation, Saturday-into-Sunday and line-into-line included (today: ${T.checks.turnarounds.length})<div class="check-sub">The generator refuses a design it cannot repair to this; the search here never produced one.</div></div></div>
    <div class="check-row check-good"><span class="check-icon check-tick">✓</span><div class="check-body"><b>The contracted week, exactly</b> — <b>${hmFromHours(P.hours.exSunday)}</b> average Mon–Sat over the 24 lines, cover weeks counted as contracted weeks<div class="check-sub">700h of duty a week across 20 working lines. Sundays (${P.hours.sundayHours.toFixed(2)}h) sit on top as RDW, as they do today. Individual weeks range ${hm(Math.min(...P.totals.rows.filter(r=>!r.assumed).map(r=>r.exSundayMinutes)))}–${hm(Math.max(...P.totals.rows.map(r=>r.exSundayMinutes)))}; only the average is the contract.</div></div></div>
  </div>
  <h2>December design figures <span class="muted" style="font-weight:400;font-size:10px">— the staffing shape agreed for the new timetable</span></h2>
  <table class="t"><thead><tr><th>Rule</th><th>Proposal</th><th></th></tr></thead><tbody>
  ${meta.designRules.map(r => `<tr><td>${esc(r.rule)}</td><td>${r.ok?'✓':'✕'} ${esc(r.value)}</td><td class="muted">${esc(r.note)}</td></tr>`).join('')}
  </tbody></table>
  <h2>Two things to settle before it is frozen</h2>
  <p>${meta.openQuestions}</p>
  <div class="foot"><span>Page 5 of 8 — The checks sheet: hard limits and design figures</span><span class="foot-id"><b>${esc(meta.identity.name)}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>
</section>

<section class="page">
  <div class="mast"><div><div class="eyebrow">The rules it is assessed against · continued</div><h1>ORR fatigue factors</h1><div class="sub">Good practice guidelines — Fatigue Factors, p3 (December 2021). ⚠ present · ✓ clear · ● standing, a property of the operation · – not applicable. Nathan assesses against this list.</div></div></div>
  <table class="ff"><thead><tr><th>Code</th><th>Factor</th><th>Today's link</th><th>Proposed</th></tr></thead><tbody>${rowsFF}</tbody></table>
  <p class="muted">Present: ${P.fatigue.present} (today ${T.fatigue.present}) · standing: ${P.fatigue.standing} · FF2 fires on every 06:20 duty, so it is a property of the station's opening time rather than of any design. A cover week's four duties are counted in the worst case for every run figure. This sheet is an aid to a conversation, not a fatigue risk assessment.</p>
  <div class="foot"><span>Page 6 of 8 — The checks sheet: fatigue factors</span><span class="foot-id"><b>${esc(meta.identity.name)}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>
</section>

<section class="page">
  <div class="mast"><div><div class="eyebrow">Method</div><h1>How it was chosen, and how to load it</h1><div class="sub">Reproducible: the same table, seed and objective give the same grid on any machine</div></div></div>
  <div class="cols"><div>
  <h2>How it was chosen</h2>
  ${BB ? `<p><b>1 · The table.</b> The workspace's own December default (<span class="tt">links-default-targets.js</span>): the owner's rules — four open, three close (four on Saturday), five on at 22:00, fourteen on a Saturday, ten on a Sunday, four cover weeks — with the times searched against the December demand curve under a strict late-shorter-than-early ordering, fewer distinct times, and the quarter-hour rule. It pays 20 × 35h exactly; the generator refuses any table that does not.</p>` : QT ? `<p><b>1 · The table.</b> <i>Same Turns</i>' table B with the closing turn at 15:45, under a second rule: no duty over 8h40. Every December duty table was re-enumerated from today's shift times with that substitution — every count of each turn on each day class, opening with four, closing with three (four on Saturday), five on at 22:00 — and none totals exactly 42,000 Mon–Sat minutes: the later start takes 450 minutes a week out of a contract that is an equality. Letting one or two other weekday turns keep their start and finish 15, 30 or 45 minutes later, with nothing over 8h40, ${meta.tables} tables reach it and three do so with every count exactly as table B has it; all three run the 06:20 openers on, because stretching a middle or a late turn breaks the cap. Two were searched — <b>Q</b>, the openers to 14:00 and 14:50 (Saturday's own opening times, so no new time but the closer), and <b>R</b>, the 06:20–13:45 opener to 14:30; the third, to 14:15 and 14:35, adds two new times for no gain. All three follow the December curve identically. Table <b>${meta.winnerVariant}</b> won: rules first, fit second, then fewest times nobody works today, then the search's own score. Saturday and Sunday are <i>Same Turns</i>' own (<span class="tt">table-late.mjs</span>).</p>` : `<p><b>1 · The table.</b> Every possible December duty table was enumerated from today's shift times — every count of each turn, on each day class — and kept only if it opened with four, closed with three (four on Saturday), kept five on at 22:00, and totalled exactly 42,000 Mon–Sat minutes. ${meta.tables} tables survive. Two weekday shapes were carried forward — table A with three 11:00 middles, table B with a third 08:00 and today's 13:30 turn — and every finished design was scored against the December demand curve; B, used here, follows a weekday's curve about as evenly as today's roster does (57.7 today, 58.5 here, lower is more even), where A follows it less well (69.5) — the three 11:00 middles put nine people on the quietest part of the afternoon.</p>`}
  <p><b>2 · The grid.</b> Simulated annealing over the 24-line grid: ${meta.steps} candidate arrangements per restart, ${meta.restarts ?? 'four'} restarts from different random starting points per run, ${meta.runs ?? (BB ? 'four seeded runs' : 'three seeded runs per table')} — over a million candidates in all — then a steepest-descent polish of every same-day swap and every pair of lines. Every move keeps each day's duties exactly as the table says — a swap between two lines on one day, or two whole lines changing places — so the coverage, the contract and the headcounts are true by construction and only the SHAPE is searched. Cover weeks stay at lines 1, 7, 13 and 19 throughout.</p>
  <p><b>3 · The judge.</b> Every candidate was scored by the workspace's own modules — <span class="tt">runDesignChecks</span>, <span class="tt">assessFatigue</span>, <span class="tt">assessHardLimits</span>, <span class="tt">scoreOrder</span> — with a rest under 12h or a run past six days costing more than everything else combined, ${BB ? 'then every fatigue factor present (each one, and its size: the length of an early block, the hours in seven days, each start-time jump, each backward step), then the week-to-week step and the length of a block on the same sort of week. Then, at a weight no factor can be traded for, the coherence of a week (one turn, its weekend variant) and fairness: four to five days a week, no single rest day between duties.' : 'fatigue factors next, and then the feel terms: a week on more than one turn, a single rest day between duties, fewer than four or more than five days, and the week-to-week step.'} Weekends off and long weekends were rewarded. Last, the app's line-order optimiser was offered the result and kept only where it improved that score.</p>
  </div><div>
  <h2>Paste it into the workspace</h2>
  <p class="muted">Links → Import, then paste the block on page 8. Line number, then Sunday to Saturday; SP is a cover week. The workspace re-runs every check on these pages from the pasted cells, so nothing here has to be taken on trust — and the two designers can edit it there like any other design.</p>
  <p class="muted">The same rotation is also supplied as <span class="tt">proposal-import.txt</span> (tab-separated, pastes directly) and <span class="tt">proposal.json</span> (the app's own format).</p>
  <h2>Alternatives measured</h2>
  <table class="t alts"><thead><tr><th>Design</th><th class="num">Run</th><th class="num">FF present</th><th class="num">Wkends</th><th class="num">One-turn</th><th class="num">Step</th><th class="num">Wk fit</th><th class="num">Score</th></tr></thead><tbody>
  ${meta.alternatives.map(a => `<tr${a.chosen?' style="font-weight:700"':''}><td>${a.name}</td><td class="num">${a.run}</td><td class="num">${a.present}</td><td class="num">${a.weekends}</td><td class="num">${a.oneTurn}</td><td class="num">${a.step}</td><td class="num">${a.fit}</td><td class="num">${a.score}</td></tr>`).join('')}
  </tbody></table>
  <p class="muted"><b>How the winner was picked:</b> rules first (rest, run, fatigue factors present, weekends off), then <i>Wk fit</i> — how evenly the weekday cover follows the December traffic curve (lower is better; today's link scores what it scores). ${BB ? 'All four candidates clear every factor and share one table, so the fit is identical; full weekends off decided it (6 against 5), and the runner-up is named so it can be asked for. The rules-only row shows what the coherence term cost against the factors: nothing.' : QT ? meta.pickNote : 'Two candidates tied on every rule; the fit decided it, and the runner-up is named so it can be asked for.'} Score is the search's own feel objective (lower is better) and is not a verdict. The workspace default is the app's own December table, generated and reordered with every switch on — a good design by every panel, and not one that resembles today's.</p>
  <div class="foot"><span>Page 7 of 8 — Method</span><span class="foot-id"><b>${esc(meta.identity.name)}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>
</section>

<section class="page">
  <div class="mast"><div><div class="eyebrow">Load it</div><h1>The rotation, ready to paste</h1><div class="sub">Line number, then Sunday to Saturday. SP is a cover week. Paste the whole block into Links → Import.</div></div></div>
  <pre class="imp" style="margin-top:12px; font-size: 9px; line-height: 1.6; padding: 12px 14px">${esc(importPadded)}</pre>
  <p class="muted" style="margin-top:10px">Prepared ${meta.date}. Every figure in this document was computed by the Marylebone Roster app's Links modules from exactly these cells; import them and the workspace's Design checks, hard limits, fatigue factors and coverage cards will restate them.</p>
  <div class="foot"><span>Page 8 of 8 — Import</span><span class="foot-id"><b>${esc(meta.identity.name)}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>
</section>
</body></html>`;
  writeFileSync(out.replace(/\.pdf$/, '.html'), html);
  const b = await chromium.launch(); const pg = await b.newPage();
  await pg.goto('file://' + out.replace(/\.pdf$/, '.html')); await pg.evaluate(() => document.fonts.ready);
  await pg.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await b.close();
}
