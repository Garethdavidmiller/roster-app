// HTML → PDF, using the workspace's OWN stylesheets so the grid, chips, check rows and heat cells are
// the app's rendering rather than an imitation of it. Own CSS covers only what a sheet of paper needs.
import { writeFileSync } from 'node:fs';
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { classifyShift, DAYS, hmFromHours, dutyMinutes, startMinutes, endMinutes, MAX_CONSECUTIVE_WORKED_DAYS, family } from './report-data.mjs';
import { APP_VERSION } from '../../../roster-data.js';

const ROOT = new URL('../../../', import.meta.url).href.replace(/\/$/, '');
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const DAY_LABEL = { sun:'Sun', mon:'Mon', tue:'Tue', wed:'Wed', thu:'Thu', fri:'Fri', sat:'Sat' };
const hm = min => `${Math.floor(min/60)}h ${String(min%60).padStart(2,'0')}m`;
const label = s => s === 'SPARE' ? 'SP' : (!s || s === 'RD') ? 'RD' : s.replace('-', '<br>');

function gridHtml(p, lines, totals, daily, opts = {}) {
  const rows = []; const changed = opts.changed ?? new Set(); let oneTurn = 0;
  for (let pos = 1; pos <= lines; pos++) {
    const row = p[String(pos)]; const t = totals.rows[pos-1];
    const cells = DAYS.map(d => `<td class="shift-cell${changed.has(`${pos}|${d}`) ? ' cell-changed' : ''}"><span class="shift-cell-btn type-${classifyShift(row[d])}">${label(row[d])}</span></td>`).join('');
    // Turns: distinct clock times MONDAY TO FRIDAY. The bold mark and the footer count use the page 1
    // tile's own definition from feel() — one clock time Mon–Fri AND one shift family across every
    // worked day, the weekend included — so the three agree. The first version counted the whole
    // week's clock times and its footer contradicted page 1 on every sheet (Same Turns: 4 against 18).
    const wkTimes = t.assumed ? null : new Set(['mon','tue','wed','thu','fri'].map(d => row[d]).filter(x => x !== 'RD')).size;
    const fams = new Set(DAYS.map(d => row[d]).filter(x => x !== 'RD' && x !== 'SPARE').map(family));
    const isOne = !t.assumed && wkTimes <= 1 && fams.size <= 1; if (isOne) oneTurn++;
    const ex = t.assumed ? `<td class="tot-cell tot-assumed">${hm(t.exSundayMinutes)}</td><td class="tot-cell tot-assumed">${hm(t.allMinutes)}</td><td class="tot-cell tot-assumed">—</td><td class="tot-cell tot-assumed">—</td>`
      : `<td class="tot-cell">${hm(t.exSundayMinutes)}</td><td class="tot-cell${t.allMinutes===t.exSundayMinutes?' tot-same':''}">${hm(t.allMinutes)}</td><td class="tot-cell">${t.days}</td><td class="tot-cell${isOne ? ' tot-one' : ''}">${wkTimes}</td>`;
    rows.push(`<tr><td class="pos-num">${pos}</td>${cells}${ex}</tr>`);
  }
  const cover = DAYS.map(d => `<td class="tot-cell cov-foot">${daily[d]}<span class="cov-sub">SP ${opts.spare}</span></td>`).join('');
  // Duty minutes per day: the figure the contract is actually paid in. Clean Final's own note had to
  // state these in prose ("Mon 6,225 · … · Sat 5,895") because the grid did not show them.
  const minutes = DAYS.map(d => { let m = 0; for (let k = 1; k <= lines; k++) { const x = p[String(k)][d]; if (x !== 'RD' && x !== 'SPARE') m += dutyMinutes(x); } return m; });
  const monSat = minutes.slice(1).reduce((a, b) => a + b, 0), n = v => v.toLocaleString('en-GB');
  return `<table class="links-grid print-grid"><thead><tr><th class="col-pos">Line</th>${DAYS.map(d=>`<th>${DAY_LABEL[d]}</th>`).join('')}
    <th class="col-total">Mon–Sat<span class="col-total-sub">hours</span></th><th class="col-total">All week<span class="col-total-sub">hours</span></th><th class="col-total">Days worked<span class="col-total-sub">Mon–Sat</span></th><th class="col-total col-turns">Turns<span class="col-total-sub">Mon–Fri</span></th></tr></thead>
    <tbody>${rows.join('')}</tbody>
    <tfoot><tr><td class="pos-num cov-foot-label">Cover</td>${cover}<td class="tot-cell tot-avg">${opts.avgEx}</td><td class="tot-cell tot-avg">${opts.avgAll}</td><td class="tot-cell tot-avg">${opts.avgDays}</td><td class="tot-cell tot-avg">${oneTurn}<span class="cov-sub">one turn</span></td></tr>
    <tr class="min-row"><td class="pos-num cov-foot-label">Minutes</td>${minutes.map(m => `<td class="tot-cell min-cell">${n(m)}</td>`).join('')}<td class="tot-cell tot-avg">${n(monSat)}</td><td class="tot-cell tot-avg">${n(monSat + minutes[0])}</td><td class="tot-cell tot-avg"></td><td class="tot-cell tot-avg"></td></tr></tfoot></table>`;
}

function heatRow(name, hours, max, cls = '', fit = null) {
  const cells = hours.map((n, h) => { if (h < 5) return null; const b = n === 0 ? 0 : Math.max(1, Math.ceil((n / max) * 5)); return `<td class="cov-heat-cell heat-b${b}">${n ? n.toFixed(0) : ''}</td>`; }).filter(Boolean).join('');
  return `<tr><th class="cov-heat-day ${cls}">${name}</th>${cells}<td class="cov-fit">${fit ?? ''}</td></tr>`;
}
function demandRow(name, cars, peak, bucket, shutFrom) {
  const cells = cars.map((c, h) => { if (h < 5) return null; const b = bucket(c, peak); const shut = h >= shutFrom; return `<td class="cov-heat-cell dem-cell dem-b${b}${shut?' dem-shut':''}">${c ? c : ''}</td>`; }).filter(Boolean).join('');
  return `<tr><th class="cov-heat-day dem-day">${name}</th>${cells}<td class="cov-fit"></td></tr>`;
}
// WEEKDAYS ARE NOT ONE DAY (owner, 24 Sep 2026). Every site that said "Monday to Friday" read TUESDAY. For
// the searched families that is exact -- every weekday works the same table -- but eleven of the sixteen
// proposals here were supplied or hand-edited and their weekdays differ, Cover at Seventeen's midday cover
// running 6, 8, 11, 11, 10 across the week under one row. Today's own link differs too (Mon/Wed against
// Tue/Thu/Fri). So: one row per DISTINCT weekday pattern, labelled by the days it covers. A design whose
// weekdays are identical still prints one row, now honestly labelled; nothing is averaged away.
const WD = ['mon','tue','wed','thu','fri'], WDL = { mon:'Mon', tue:'Tue', wed:'Wed', thu:'Thu', fri:'Fri' };
const weekdayGroups = hourly => { const g = []; for (const d of WD) { const k = hourly[d].hours.join(','); const f = g.find(x => x.key === k); if (f) f.days.push(d); else g.push({ key: k, days: [d], hours: hourly[d].hours }); } return g; };
const groupLabel = days => days.length === 5 ? 'Mon–Fri' : days.map(d => WDL[d]).join(' · ');
const wdRange = daily => { const v = WD.map(d => daily[d]); const lo = Math.min(...v), hi = Math.max(...v); return lo === hi ? String(lo) : `${lo}–${hi}`; };
const hourHead = () => `<tr><th class="cov-heat-hour"></th>${Array.from({length:19},(_,i)=>`<th class="cov-heat-hour">${String(i+5).padStart(2,'0')}</th>`).join('')}<th class="cov-heat-hour cov-fit-h">fit</th></tr>`;

export async function renderPdf(D, out) {
  const { today: T, prop: P, meta } = D;
  // meta.date is when the DESIGN was prepared; a re-render changes what the sheet says, so it says so.
  const RENDERED = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const prepared = meta.date === RENDERED ? `Prepared ${meta.date}` : `Prepared ${meta.date} · re-rendered ${RENDERED}`;
  // Page 4's headcount rows, COMPUTED per day class (weekday range · Sat · Sun). They were four typed
  // literals (4→4, 2→3, 2→4, 4→5) on every sheet until 24 Sep 2026 — see headcounts() in report-data.
  const rng = o => { const v = WD.map(d => o[d]); const lo = Math.min(...v), hi = Math.max(...v); return lo === hi ? String(lo) : `${lo}–${hi}`; };
  const trio = o => `${rng(o)} · ${o.sat} · ${o.sun}`;
  const headRow = (labelText, key, wk, sat, sun, rule) => { const o = P.heads[key]; const miss = [];
    const wkBad = WD.filter(d => o[d] !== wk); if (wk !== null && wkBad.length) miss.push(wkBad.length === 5 ? `weekdays ${rng(o)}` : wkBad.map(d => `${WDL[d]} ${o[d]}`).join(', '));
    if (sat !== null && o.sat !== sat) miss.push(`Saturday ${o.sat}`); if (sun !== null && o.sun !== sun) miss.push(`Sunday ${o.sun}`);
    return `<tr><td>${labelText} <span class="muted">wk · Sat · Sun</span></td><td class="num">${trio(T.heads[key])}</td><td class="num"><b>${trio(o)}</b></td><td class="muted">${rule}${miss.length ? ` — not met: ${miss.join(', ')}` : ' — met'}</td></tr>`; };
  // The tightest rest anywhere round the wheel, for the 12h row: "0 under 12h" said nothing about how close.
  const restLine = r => r ? `${hm(r.minutes)} — line ${r.from.line} ${DAY_LABEL[r.from.day]} ${r.from.shift} into ${r.to.line === r.from.line ? '' : `line ${r.to.line} `}${DAY_LABEL[r.to.day]} ${r.to.shift}` : '—';
  const BB = meta.kind === 'BB';
  // QT — Quarter To: structurally a Same Turns document (it inherits every ST section), with a third
  // branch wherever ST's copy claims that every time is one people work today, because two are not.
  // Every figure in those branches is READ off the tables, never typed.
  const QT = meta.kind === 'QT';
  // EF — Eight Forty: structurally a By the Book document (the RULES branches), with its own copy wherever
  // By the Book's prose states a fact of ITS table — 9h30 earlies, nineteen turns, three off-quarter times,
  // Saturday moved in two ways. Every EF figure below is read off the finished table, never typed.
  // B2 -- By the Book 2: EF's cap and EF's layout, with the ticket office pinned and its table PLACED from the
  // enumeration (place-structures.mjs) rather than annealed, so three strings differ and everything else is EF's.
  const B2 = meta.kind === 'B2'; const EF = meta.kind === 'EF' || B2; const RULES = BB || EF;
  const ef = EF ? (() => {
    const rows = P.tableRows; const wk = rows.filter(r => r.weekday > 0);
    const E = wk.filter(r => startMinutes(r.time) < 11*60).sort((a, b) => a.minutes - b.minutes), L = wk.filter(r => startMinutes(r.time) >= 11*60).map(r => r.minutes);
    const lmax = Math.max(...L), longs = E.slice(1).map(r => r.minutes);
    const instances = rows.flatMap(r => r.time.split('-')).filter(t => !['06:20','23:55','07:15','23:25'].includes(t));
    const onQ = instances.filter(t => [0,15,30,45].includes(Number(t.split(':')[1]))).length;
    return { rows: rows.length, monSat: rows.filter(r => r.weekday > 0 && r.sat > 0).length, satOwn: rows.filter(r => r.sat > 0 && !r.weekday).length, wkOnly: rows.filter(r => r.weekday > 0 && !r.sat).length,
      sunOwn: rows.filter(r => r.sun > 0 && !r.weekday && !r.sat).length, shortEarly: E[0], longRange: `${hm(Math.min(...longs))}–${hm(Math.max(...longs))}`, lateRange: `${hm(Math.min(...L))}–${hm(lmax)}`,
      gap: Math.min(...longs) - lmax, longest: Math.max(...rows.map(r => r.minutes)), sharedToday: rows.filter(r => T.tableRows.some(t => t.time === r.time)).map(r => r.time),
      instances: instances.length, onQ, off: meta.efTable?.offQuarter ?? [], counts: meta.efTable?.counts, sunTotal: meta.efTable?.sunTotal };
  })() : null;
  const S = meta.stretch;   // { closer:{from,to}, closerShift, turns:[{from,to,people,each,onToday}], weekly, allOnToday } or null
  const stretchWords = S ? S.turns.map(t => `${t.from} to ${t.to.split('-')[1]} (${t.people} people, ${t.each} minutes each)`).join(' and ') : '';
  const newTimes = P.tableRows.filter(r => !T.tableRows.some(t => t.time === r.time)).map(r => r.time);
  const sharedTimes = P.feel.distinctTimes - newTimes.length;
  const ff = (a, code, t) => a.fatigue.results.find(r => r.code === code && (!t || r.title.includes(t)));
  const icon = st => st === 'present' ? '⚠' : st === 'clear' ? '✓' : st === 'standing' ? '●' : '–';
  const cls = st => st === 'present' ? 'check-warn-row' : st === 'clear' ? 'check-good' : 'check-neutral';
  // ── THE TWO READINGS OF A COVER WEEK, ON THE ONE ROW THEY MOVE ────────────────────────────────
  // A cover week is worked four days of seven and the link does not say which four, so every run
  // row has a range. The app reports the ceiling: the four SPLIT day-on-day-off, which supplies no
  // 48-hour break and bridges the blocks either side. That ceiling is real and reachable — of the
  // 35 placements, the 10 with no two rest days together reproduce it exactly — but it needs the
  // clerk to split the week, and a cover week worked as a BLOCK always supplies a break.
  //
  // Measured across every design in this folder, FF11 is the ONLY row where the two readings
  // differ, and on one design they differ either side of the threshold. So both are printed, on
  // that row, each with its own mark; `cover-placement.mjs` carries the argument. Printing only the
  // ceiling flags designs that are clear as rostered; printing only the block reading is the
  // false-assurance failure links-fatigue.js names as its dominant risk. The status COLOUR of the
  // row still follows the ceiling — a reader who takes nothing else from the cell takes the
  // cautious number.
  const asRos = (a, code) => code === 'FF11' ? a.asRostered?.ff11?.worst ?? null : null;
  const rosStatus = v => v === null ? null : (v > 13 ? 'present' : 'clear');
  const rowsFF = P.fatigue.results.map(r => { const t = T.fatigue.results.find(x => x.code === r.code && x.title === r.title);
    const val = x => x ? (x.status === 'n/a' ? '–' : (x.value ?? '')) : '';
    const second = (a, code, have) => { const v = have ? asRos(a, code) : null; return v === null ? ''
      : `<span class="ff-alt ff-${rosStatus(v)}">${icon(rosStatus(v))} ${v} as rostered</span>`; };
    return `<tr class="ff-${r.status}"><td class="ff-code">${r.code}</td><td class="ff-title">${esc(r.title)}${r.confirm?' <span class="muted">(definition to confirm)</span>':''}<span class="ff-fam chip">${esc(r.family)}</span></td>
      <td class="ff-st ff-${t?.status}">${icon(t?.status)} ${esc(val(t))}${second(T, r.code, !!t)}</td><td class="ff-st ff-${r.status}">${icon(r.status)} ${esc(val(r))}${second(P, r.code, true)}</td></tr>`; }).join('');
  // Factors present under the block reading — the same count, less FF11 when only the ceiling fires.
  const presentRos = a => a.fatigue.present - ((asRos(a, 'FF11') !== null
    && (ff(a, 'FF11')?.status === 'present') && rosStatus(asRos(a, 'FF11')) === 'clear') ? 1 : 0);

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
  // ── THE DECISION FRAME (page 2, 24 Sep 2026) ──────────────────────────────────────────────────
  // External comment, accepted by the owner: the calculation was already exhaustive; what the sheets
  // lacked was decision structure, an evidence hierarchy, staff validation and a plain statement of
  // uncertainty. The ORR's own guidance treats the factor list as one input to be triangulated,
  // never as the answer. So before any figure: the question this design answers and against whom,
  // the criteria in three tiers (hard / soft / preference), how much each figure on the later pages
  // can bear, what no page can tell the reader, and what has to happen before the sheet is more than
  // an aid to a conversation. Every number here is computed; the framing is per FAMILY, and a design's
  // meta.json may override any part of it under `frame`.
  const code = meta.identity.code;
  const weekdayFitOf = meta.alternatives?.find(a => a.chosen)?.fit ?? '—';
  const fam = meta.frame?.family ?? (QT || meta.kind === 'ST' ? 'keep' : RULES ? 'rules' : /^FT-/.test(code) ? 'fifteen' : 'line');
  const decMet = [P.heads.open.tue === 4 && P.heads.open.sat === 4 && P.heads.open.sun === 4, P.heads.close.tue === 3 && P.heads.close.sat === 4 && P.heads.close.sun === 3, P.heads.at22.tue === 5 && P.heads.at22.sat === 5, P.daily.sat === 14 && P.daily.sun === 10].filter(Boolean).length;
  const longestDuty = Math.max(...P.tableRows.map(r => r.minutes));
  const famRange = f => { const m = P.tableRows.filter(r => r.family === f).map(r => r.minutes); return m.length ? `${hm(Math.min(...m))}–${hm(Math.max(...m))}` : '—'; };
  const confirmCount = P.fatigue.results.filter(r => r.confirm && r.status !== 'n/a').length;
  const contractExact = Math.abs(P.hours.exSunday - 35) < 0.01;
  const runOk = hard.status === 'ok', restOk = P.checks.turnarounds.length === 0;
  const presentRosN = presentRos(P);
  // The lines that hold the times nobody works today, first occurrence per time — who reads the week first.
  const newLines = (() => { const out = []; for (const t of newTimes) { for (let k = 1; k <= 24; k++) { if (DAYS.some(d => P.patterns[String(k)][d] === t) && !out.includes(k)) { out.push(k); break; } } } return out.sort((a, b) => a - b).slice(0, 5); })();
  const longestLines = (() => { const out = []; for (let k = 1; k <= 24; k++) if (DAYS.some(d => dutyMinutes(P.patterns[String(k)][d]) === longestDuty)) out.push(k); return out.slice(0, 3); })();
  const sibling = code.startsWith('QT') ? 'Same Turns (ST-24-B7)' : 'Quarter To (QT-24-Q34)';
  const F = {
    keep: { question: `Should the link for the December 2026 timetable keep today's shift times, accepting ${QT ? 'a 15:45 closer and two 06:20 openers that run on' : 'one more cover cycle and nothing new to learn'}, or move to a table built from the December 2026 timetable rules and the timetable?`,
      stands: `<b>${esc(meta.identity.name)}</b> is one of the two cases for keeping today's times; the other is <i>${sibling}</i>. It is read against <b>By the Book (BB-24-D7)</b>, the strongest case for the other answer — not against every design in the folder.` },
    rules: { question: `Should the link for the December 2026 timetable be built from the December 2026 timetable rules and the measured timetable, accepting shift times nobody works today, or keep today's times?`,
      stands: `<b>${esc(meta.identity.name)}</b> is a rules-first table${B2 ? ' with the ticket office rostered' : EF ? ' under the 8h40 cap' : ''}. It is read against <b>Quarter To (QT-24-Q34)</b>, the strongest case for keeping today's times — not against every design in the folder.` },
    fifteen: { question: `Should the link be built on the supplied fifteen-turn table, accepting ${P.daily.sat} on a Saturday and ${P.daily.sun} on a Sunday against the December 2026 staffing shape, for a table with the fewest distinct times here?`,
      stands: `<b>${esc(meta.identity.name)}</b> is read against ${code.includes('R21') ? '<b>Same Turns (ST-24-B7)</b>, which keeps today’s times at the same fatigue count' : 'its repaired version, <b>Fifteen Turns Repaired (FT-24-R21)</b>, which clears the rest it breaks'} — not against every design in the folder.` },
    line: { question: `Should the link for the December 2026 timetable be the hand-built Weekday Lates line, in this revision, accepting ${P.daily.sat} on a Saturday against the agreed 14 and ${decMet} of the four December 2026 headcount rules met, for a week shape its authors chose?`,
      stands: `<b>${esc(meta.identity.name)}</b> is read two ways: against <b>Quarter To (QT-24-Q34)</b> and <b>By the Book (BB-24-D7)</b>, the two searched answers; and within its own line, against ${meta.changed ? `<i>${esc(meta.changed.parent.name)}</i>, the parent whose changed cells are outlined on the next page` : 'the revision before it'}.` },
  }[fam];
  const question = meta.frame?.question ?? F.question, stands = meta.frame?.stands ?? F.stands;
  const sunWorse = P.fits.sun !== null && T.fits.sun !== null && P.fits.sun > T.fits.sun;
  const cannot = [
    `Whether the people who would work them accept ${newTimes.length > 8 ? `a table in which ${newTimes.length} of ${P.feel.distinctTimes} times are new (page 4 lists them)` : newTimes.length ? `the ${newTimes.length === 1 ? 'time' : 'times'} nobody works today (${newTimes.join(', ')})` : 'the week shapes as written'} — familiarity is measured as "times worked today", which is a proxy for acceptability, not acceptability.`,
    `Whether the roster clerk splits a cover week day-on-day-off. It is the one thing that moves the 48-hour-break figure (${P.asRostered.ff11.worst} as a block, ${P.fatigue.results.find(r => r.code === 'FF11')?.value} split), and the link does not decide it.`,
    `How leave and sickness cover land on a 24-line link with four cover weeks (lines ${P.feel.spareLines.join(', ')}); nothing here models absence.`,
    `Whether the December 2026 timetable demand curve holds on Wembley event days — the Saturday weighting approximates them, and the curve is a measured timetable, not a footfall count.`,
    ...(sunWorse ? [`Why Sunday's fit (${P.fits.sun}) is worse than today's (${T.fits.sun}) and whether anyone minds: the December 2026 headcount of ten is met by adding people, not by reshaping the day.`] : []),
    ...(meta.frame?.cannot ?? []),
  ];
  const readLines = newLines.length ? `Lines ${newLines.join(', ')} hold the times nobody works today; the people who would work those weeks read them first and say in one line each what they would change.` : `Lines ${longestLines.join(', ')} hold the longest duty (${hm(longestDuty)}); the people who would work those weeks read them first and say in one line each what they would change.`;
  const frameHtml = `
<section class="page frame">
  <div class="mast"><div><div class="eyebrow">Before the figures</div><h1>The decision this sheet supports</h1><div class="sub">What is being decided, which criteria are hard and which are the room's, how much each figure can bear, and what no page here can tell you. Read this before the tiles.</div></div></div>
  <div class="toc"><span><b>1</b> What this is</span><span><b>2</b> The decision it supports (this page)</span><span><b>3</b> The 24-line grid, with the words explained</span><span><b>4</b> A week compared with today</span><span><b>5</b> People on duty, hour by hour</span><span><b>6</b> Hard limits and the December 2026 figures</span><span><b>7</b> The ORR fatigue factors</span><span><b>8</b> Where it came from</span><span><b>9</b> The grid, ready to paste into the app</span></div>
  <h2>The question</h2>
  <p>${question}</p>
  <p>${stands}</p>
  <h2>The criteria, in three tiers</h2>
  <div class="tiers">
    <div class="tier"><div class="tier-k">Hard — a design meets these or cannot be run</div>
      <ul><li>${restOk ? '✓' : '✕'} Twelve hours between duties — ${restOk ? 'met, tightest ' + hm(P.rest.minutes) : `<b>broken</b>, ${P.checks.turnarounds.length} under 12h`}</li>
      <li>${runOk ? '✓' : '✕'} Chiltern's 13-day limit — longest run ${hard.value} days</li>
      <li>${contractExact ? '✓' : '✕'} The 35-hour contract, exactly — ${hmFromHours(P.hours.exSunday)}</li></ul></div>
    <div class="tier"><div class="tier-k">Soft — the room weighs these against each other</div>
      <ul><li>December 2026 headcounts met: <b>${decMet} of 4</b> (today 0 of 4)</li>
      <li>Fatigue factors present: <b>${P.fatigue.present}</b>${presentRosN !== P.fatigue.present ? ` worst case, ${presentRosN} as rostered` : ''} (today ${T.fatigue.present})</li>
      <li>Demand fit weekday · Sat · Sun: <b>${weekdayFitOf}</b> · ${P.fits.sat} · ${P.fits.sun} (today ${meta.alternatives?.find(a => /Today/.test(String(a.name)))?.fit ?? T.fits.tue} · ${T.fits.sat} · ${T.fits.sun}; lower is closer)</li>
      <li>Times worked today: <b>${sharedTimes} of ${P.feel.distinctTimes}</b> · full weekends off: <b>${P.checks.weekendsOff}</b> in 24 (today ${T.checks.weekendsOff} in 20)</li></ul></div>
    <div class="tier"><div class="tier-k">Preference — staff's to state, not the tool's</div>
      <ul><li>Early against late: earlies ${famRange('E')}, lates ${famRange('L')}</li>
      <li>${newTimes.length > 8 ? `${newTimes.length} of ${P.feel.distinctTimes} clock times are new — the duty table on page 4 lists them` : newTimes.length ? `The ${newTimes.length === 1 ? 'new time' : newTimes.length + ' new times'}: ${newTimes.join(', ')}` : 'No new clock time to learn'}</li>
      <li>The longest duty, ${hm(longestDuty)}, and who holds it</li>
      <li>Cover weeks at lines ${P.feel.spareLines.join(', ')}</li></ul></div>
  </div>
  <h2>How much to trust each figure</h2>
  <table class="t evid"><thead><tr><th>Figure on these pages</th><th>Where it comes from</th><th>Weight</th></tr></thead><tbody>
    <tr><td>${restOk ? '0 rests under 12h' : P.checks.turnarounds.length + ' rests under 12h'} · ${hmFromHours(P.hours.exSunday)} contract · ${P.daily.sat}/${P.daily.sun} at the weekend</td><td>Computed from the cells; re-computed by the workspace on import</td><td><b>Firm</b></td></tr>
    <tr><td>Longest run ${hard.value} days, inside 13</td><td>Computed; the 13-day limit's policy citation is still outstanding</td><td><b>Firm figure</b>, unconfirmed threshold</td></tr>
    <tr><td>Four at the open, three to close, 14 and 10 at the weekend</td><td>Owner-relayed December 2026 headcounts with no document behind them (class C)</td><td><b>Provisional</b></td></tr>
    <tr><td>${P.fatigue.present} fatigue factor${P.fatigue.present === 1 ? '' : 's'} present</td><td>The ORR's 2021 list, which it states are not limits; ${confirmCount} factor${confirmCount === 1 ? '' : 's'} still "definition to confirm"</td><td><b>Advisory only</b> — never pass or fail</td></tr>
    <tr><td>Demand fit ${weekdayFitOf} · ${P.fits.sat} · ${P.fits.sun}</td><td>Measured timetable, one share-based measure on one December 2026 timetable curve</td><td><b>Indicative</b></td></tr>
    <tr><td>${sharedTimes} of ${P.feel.distinctTimes} times are today's</td><td>Computed against the live 20-line link</td><td><b>Firm</b>, but a proxy for acceptability</td></tr>
    ${meta.alternatives?.[0]?.score && meta.alternatives[0].score !== '—' ? `<tr><td>Search score ${meta.alternatives[0].score}</td><td>The annealer's own objective; page 8 explains it</td><td><b>Do not weigh</b></td></tr>` : ''}
    ${meta.changed ? `<tr><td>${meta.changed.cells.length} cells changed against ${esc(meta.changed.parent.name)}</td><td>Computed cell by cell; outlined on the next page</td><td><b>Firm</b></td></tr>` : ''}
  </tbody></table>
  <h2>What no page here can tell you</h2>
  <ul class="cannot">${cannot.map(c => `<li>${c}</li>`).join('')}</ul>
  <h2>Before it is frozen</h2>
  <p>${readLines} The roster office answers the cover-week question. Someone confirms the source of the 13-day limit. ${meta.frame?.read ?? ''}Only then does the factor count on page 7 mean anything, and only then is this sheet more than an aid to a conversation.</p>
  <div class="foot"><span>Page 2 of 9 — The decision frame</span><span class="foot-id"><b>${esc(meta.identity.name)}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>
</section>
`;
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
.cover .mast { padding: 20px 28px 16px; border-radius: 14px; }
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
.strip { margin: 10px 0 0; display: flex; flex-wrap: wrap; gap: 6px 8px; padding: 8px 12px; background: var(--surface-sunken); border-radius: var(--radius); }
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 10px 0; }
.tile { border-left: 4px solid var(--accent-gold); background: var(--surface-sunken); padding: 8px 12px; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.tile b { display: block; font-size: 22px; font-weight: 800; color: var(--primary-blue); letter-spacing: -.3px; }
.tile .l { display: block; font-size: 11px; font-weight: 600; color: var(--text-dark); margin-top: 2px; }
.tile .s { display: block; font-size: 9.5px; color: var(--text-mid); margin-top: 2px; }
h2 { font-size: 14px; color: var(--primary-blue); margin: 13px 0 5px; font-weight: 800; }
.rules td, .rules th { padding: 2px 6px; }
h3 { font-size: 11.5px; color: var(--primary-blue); margin: 12px 0 4px; font-weight: 700; }
p { margin: 4px 0 8px; } .muted { color: var(--text-mid); font-weight: 400; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; } .cols.duty { grid-template-columns: 62% 1fr; gap: 14px; } .dutyt td, .dutyt th { padding: 2px 6px; } .bb-dense .dutyt td { padding: 1px 6px; font-size: 9px; line-height: 1.3; } .bb-dense p.muted { font-size: 9.5px; line-height: 1.35; } .ef-tight .dutyt td { padding: 0 6px; line-height: 1.2; } .ef-tight p.muted { font-size: 9px; line-height: 1.3; } .changed td:nth-child(4) { width: 34%; } .stack { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
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
.cov-heat { border-collapse: collapse; width: 100%; } .cov-heat th, .cov-heat td { border: 1px solid var(--border-light); text-align: center; } .cov-heat-cell { height: 20px; min-width: 0; font-size: 9px; } .cov-heat--dense .cov-heat-cell { height: 15px; font-size: 8.5px; } .cov-heat-day { text-align: left !important; padding: 0 6px; white-space: nowrap; font-size: 9px; }
.check-row { font-size: 10.5px; padding: 4px 9px; } .check-rows { gap: 3px; } p.oq { font-size: 10px; line-height: 1.36; }
table.ff { border-collapse: collapse; width: 100%; font-size: 9.5px; } table.ff td { padding: 2px 6px; border-bottom: 1px solid var(--border-light); vertical-align: top; } table.ff th { text-align: left; font-size: 9px; text-transform: uppercase; color: var(--text-mid); background: var(--surface-sunken); padding: 4px 6px; }
.ff-code { font-weight: 800; color: var(--primary-blue); white-space: nowrap; width: 38px; } .ff-fam { display: inline; font-size: 8.5px; color: var(--text-light); margin-left: 6px; }
.ff-st { white-space: nowrap; font-weight: 700; width: 108px; }
.ff-alt { display: block; font-size: 8.5px; font-weight: 600; margin-top: 1px; } .ff-present { color: color-mix(in srgb, var(--warning-amber) 55%, black); } .ff-clear { color: color-mix(in srgb, var(--success-green) 80%, black); } .ff-standing { color: var(--text-mid); } .ff-n\\/a { color: var(--text-light); font-weight: 400; }
tr.ff-present td { background: color-mix(in srgb, var(--warning-amber) 8%, white); }
pre.imp { font-size: 7.4px; line-height: 1.35; background: var(--surface-sunken); padding: 8px 10px; border-radius: var(--radius-sm); font-family: ui-monospace, Menlo, Consolas, monospace; white-space: pre; margin: 0; }
.foot-id b { color: var(--primary-blue); }
.foot { position: absolute; bottom: 0; left: 0; right: 0; display: flex; justify-content: space-between; font-size: 8.5px; color: var(--text-light); border-top: 1px solid var(--border-light); padding-top: 4px; }
.callout { border-left: 3px solid var(--accent-gold); background: var(--surface-sunken); padding: 7px 12px; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; margin: 6px 0; }
.rule-list td:first-child { width: 46%; }
.kept td:nth-child(1) { width: 38%; } .kept td:nth-child(2), .kept td:nth-child(3) { width: 24%; white-space: nowrap; } .kept td:nth-child(4) { display: none; } .kept th:nth-child(4) { display: none; }
.changed td:nth-child(1) { width: 36%; } .changed td.num { width: 12%; } .changed td.num { white-space: nowrap; }
.alts td, .alts th { white-space: nowrap; padding: 3px 8px; } .alts td:first-child { white-space: normal; width: 42%; }
.alts-dense td, .alts-dense th { padding: 0 5px; font-size: 8px; line-height: 1.18; }
.alts { margin-top: 2px; } .alts td:first-child { width: 38%; }
.tiers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; } .tier { border-top: 3px solid var(--primary-blue); } .tier:nth-child(2) { border-top-color: var(--accent-gold); } .tier:nth-child(3) { border-top-color: var(--border-mid); }
.toc { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px 12px; font-size: 9px; color: var(--text-mid); margin: 8px 0 0; } .toc b { color: var(--primary-blue); margin-right: 4px; }
.gloss { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 18px; font-size: 9.5px; line-height: 1.38; color: var(--text-mid); } .gloss b { color: var(--text-dark); }
.evid tbody tr:nth-child(even) td, .alts tbody tr:nth-child(even) td, .rules tbody tr:nth-child(even) td, .kept tbody tr:nth-child(even) td, .changed tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--surface-sunken) 55%, white); }
.ff-fam.chip { display: inline-block; font-size: 8px; padding: 0 6px; border-radius: 8px; background: var(--surface-sunken); color: var(--text-mid); margin-left: 6px; vertical-align: 1px; }
.callout.plain { margin-top: 4px; } .tier { background: var(--surface-sunken); border-radius: var(--radius-sm); padding: 8px 10px; font-size: 9.5px; } .tier-k { font-weight: 800; color: var(--primary-blue); font-size: 9px; text-transform: uppercase; letter-spacing: .3px; margin-bottom: 4px; } .tier ul { margin: 0; padding-left: 14px; } .tier li { margin: 2px 0; }
.evid td:first-child { width: 34%; } .evid td:last-child { width: 22%; white-space: nowrap; } .evid td { font-size: 9.5px; } ul.cannot { margin: 2px 0 4px; padding-left: 16px; font-size: 9.6px; line-height: 1.38; } ul.cannot li { margin: 1px 0; } .frame h2 { margin-top: 11px; } .frame p { margin: 3px 0 6px; }
.method-cols { column-count: 2; column-gap: 18px; } .method-cols p { margin-top: 0; } .paste { margin-top: 10px; } .paste p { margin: 0; }
.print-grid th.col-turns { width: 40px; min-width: 40px; } .print-grid td.tot-one { font-weight: 800; color: var(--primary-blue); }
.print-grid tr.min-row td { font-size: 8px; color: var(--text-mid); border-top: 1px solid var(--border-light); padding-top: 1px; } .print-grid tr.min-row .tot-avg { font-weight: 700; color: var(--text-dark); }
.print-grid td.cell-changed .shift-cell-btn { box-shadow: inset 0 0 0 2px var(--primary-blue); } .legend i.i-changed { background: white; box-shadow: inset 0 0 0 2px var(--primary-blue); }
.cov-fit, .cov-fit-h { width: 34px; min-width: 34px; font-size: 8.5px; font-weight: 700; color: var(--primary-blue); border-left: 2px solid var(--border-mid) !important; font-variant-numeric: tabular-nums; } .cov-fit-h { font-weight: 800; text-transform: uppercase; letter-spacing: .3px; color: var(--text-mid); }
</style></head><body>

<section class="page cover">
  <div class="mast"><img src="${ROOT}/icon-192.png" alt=""><div><div class="eyebrow">Marylebone Roster · Links designer</div><h1>Proposed CEA Link — December 2026</h1>
  <div class="sub">${meta.sub1 ?? (BB ? 'A 24-line link built from the December 2026 staffing rules and judged on the ORR fatigue factors — nothing carried over from today’s roster except the rules' : B2 ? 'The December 2026 timetable rules with no duty over 8h40 and the ticket office written in — two 14:00–22:30 turns a day Monday to Saturday, two 13:30–22:00 on a Sunday — judged on the ORR fatigue factors' : EF ? 'A 24-line link built from the December 2026 staffing rules with no duty over 8h40, judged on the ORR fatigue factors — nothing carried over from today’s roster except the rules' : QT ? 'The existing 20-line link, widened to 24 people, with the closing turn starting at 15:45 — the same shape of week, one more cover cycle, and one turn a little longer to keep the contract' : 'The existing 20-line link, widened to 24 people — the same turns, the same shape of week, one more cover cycle')}</div>
  <div class="meta">${prepared} · built for the December 2026 timetable and assessed by the workspace's own rule modules (Marylebone Roster v${APP_VERSION}) · figures on this page are computed, not typed</div></div></div>
  <div class="ident"><div class="ident-main"><div class="ident-eyebrow">Proposal</div><div class="ident-name">${esc(meta.identity.name)}</div><div class="ident-strap">${esc(meta.identity.strap)}</div></div>
   <div class="ident-side"><div class="ident-row"><span class="ident-k">Code</span><span class="ident-v tt">${esc(meta.identity.code)}</span></div><div class="ident-row"><span class="ident-k">Fingerprint</span><span class="ident-v tt">${esc(meta.identity.fingerprint)}</span></div><div class="ident-row"><span class="ident-k">Built from</span><span class="ident-v">duty table ${esc(meta.identity.table)} · seed ${esc(String(meta.identity.seed))} · 24 lines · 4 cover weeks</span></div><div class="ident-row"><span class="ident-k">Lineage</span><span class="ident-v">${esc(meta.identity.lineage)}</span></div></div></div>
  <div class="strip">${(() => {
    // EVERY CHIP IS DERIVED. These four were hardcoded to "24 / exactly the contract / 0 / 0" until
    // 17 Sep 2026, and the first four proposals all happened to satisfy them, so a green tick was
    // indistinguishable from a checked one. The fifth did not — 60 minutes over contract and one
    // 11h15 turnaround, both of which the page asserted as met, in bold, with a tick. That is the
    // "never hardcode a status" rule from links-fatigue.js, broken in the one document that leaves
    // the building.
    const chip = (ok, txt) => `<span class="sum-chip sum-chip--${ok ? 'ok' : 'warn'}">${ok ? '✓' : '⚠'} ${txt}</span>`;
    const lines   = Object.keys(P.patterns).length;
    // Derived from MINUTES, never from `exSunday` — that is rounded to 2dp, and on a 24-line
    // rotation 0.01h is 14 minutes, so a real 60-minute surplus reads as 48. A cover week counts as
    // a full contracted week (v20.98), so it is credited here exactly as weeklyHours credits it.
    const target  = P.hours.target ?? 35;
    const overMin = Math.round(P.hours.exSundayHours * 60 + P.hours.coverLines * target * 60
                               - P.hours.lines * target * 60);
    const rests   = P.checks.turnarounds.length;
    const breach  = P.hard.checks.filter(c => c.status === 'breach' || c.status === 'over').length;
    const unknown = P.hard.checks.some(c => c.status === 'unknown');
    return [
      chip(P.checks.unfilledLines.length === 0, `<strong>${lines}</strong> lines designed`),
      chip(overMin === 0, `<strong>${hmFromHours(P.hours.exSunday)}</strong> a week — ${overMin === 0 ? 'exactly the contract'
            : `${overMin > 0 ? 'over' : 'under'} the contract by ${Math.abs(overMin)} min`}`),
      chip(breach === 0 && !unknown, `<strong>${unknown ? '—' : breach}</strong> hard-limit breach${breach === 1 ? '' : 'es'}${unknown ? ' (not assessable)' : ''}`),
      chip(rests === 0, `<strong>${rests}</strong> rest${rests === 1 ? '' : 's'} under 12h`),
    ].join('');
  })()}
   <span class="sum-chip sum-chip--${P.fatigue.present?'warn':'ok'}">${P.fatigue.present?'⚠':'✓'} <strong>${P.fatigue.present}</strong> fatigue factor${P.fatigue.present===1?'':'s'} present${presentRos(P) !== P.fatigue.present ? ` <span class="muted">— ${presentRos(P)} as rostered</span>` : ''} <span class="muted">(today: ${T.fatigue.present})</span></span></div>
  <div class="tiles">
    ${BB ? `<div class="tile"><b>${P.feel.distinctTimes} turns</b><span class="l">in the December 2026 duty table</span><span class="s">searched against the timetable; lates shorter than earlies; on the quarter hour except the open and close</span></div>`
         : EF ? `<div class="tile"><b>${P.feel.distinctTimes} turns</b><span class="l">in the December 2026 duty table, capped</span><span class="s">searched against the timetable under the 8h40 rule; lates shorter than earlies; the longest duty is ${hm(ef.longest)}</span></div>`
         : QT ? `<div class="tile"><b>${sharedTimes} of ${P.feel.distinctTimes}</b><span class="l">shift times are today's</span><span class="s">${newTimes.length === 1 ? `the one that is not: ${newTimes[0]}, the later closer — the openers' new finishes are Saturday's own` : `the ${newTimes.length} that are not: ${newTimes.join(' and ')} — the later closer, and the opener stretched to pay for it`}</span></div>`
         : (() => {
             // COUNT THE INTERSECTION. This read `${P.feel.distinctTimes} of ${T.feel.distinctTimes}`
             // — this design's turn count over TODAY'S — which is only the same sentence while every
             // turn here is also one of today's. Weekday Lates 2 introduces 12:30–21:00 and the tile
             // printed "19 of 18". Same shape as the hardcoded badge row: true by coincidence for
             // the designs that happened to be subsets, and nonsense for the first that was not.
             const todays = new Set(T.tableRows.map(r => r.time));
             const mine = P.tableRows.map(r => r.time);
             const shared = mine.filter(t => todays.has(t)).length;
             return `<div class="tile"><b>${shared} of ${mine.length}</b><span class="l">shift times are today's</span><span class="s">${shared === mine.length ? 'every time on the sheet is one people already work — nothing new to learn' : `${mine.length - shared} ${mine.length - shared === 1 ? 'time is new' : 'times are new'}; the rest are turns people already work`}</span></div>`;
           })()}
    <div class="tile"><b>${P.checks.longestStretch} days</b><span class="l">longest run of worked days</span><span class="s">today's link reaches ${T.checks.longestStretch}; Chiltern's limit is ${MAX_CONSECUTIVE_WORKED_DAYS}</span></div>
    ${RULES ? `<div class="tile"><b>${P.fatigue.present} of 25</b><span class="l">fatigue factors present</span><span class="s">${presentRos(P) !== P.fatigue.present ? `${presentRos(P)} with cover weeks worked as a block; ` : ''}today's link has ${T.fatigue.present}; every other factor is clear or does not apply</span></div>`
         : `<div class="tile"><b>${P.feel.oneTurn} of ${P.feel.workingLines}</b><span class="l">working weeks are one turn</span><span class="s">same clock time all week, as ${T.feel.oneTurn} of today's ${T.feel.workingLines} are</span></div>`}
    <div class="tile"><b>${P.checks.weekendsOff} in 24</b><span class="l">full weekends off</span><span class="s">${P.checks.weekendsOffPct}% of the rotation, against ${T.checks.weekendsOffPct}% today (${T.checks.weekendsOff} in 20)</span></div>
    <div class="tile"><b>${P.feel.spareLines.length} cover weeks</b><span class="l">lines ${P.feel.spareLines.join(', ')}</span><span class="s">${meta.coverNote ?? `evenly spaced six lines apart — today's sit at ${T.feel.spareLines.join(', ')}`}</span></div>
    <div class="tile"><b>${ff(P,'FF18')?.value?.toString().replace(/.*typically /,'') ?? ''}</b><span class="l">typical week-to-week move</span><span class="s">how far the working day shifts each week — today's link moves ${ff(T,'FF18')?.value?.toString().replace(/.*typically /,'') ?? ''}</span></div>
  </div>
  <h2>What this is</h2>
  ${BB ? `<p>A proposal for the CEA link once the December 2026 timetable arrives, for a team of 24 — built the other way round from <i>Same Turns</i>. Nothing was carried over from today's roster. The duty table is the workspace's own December 2026 duty table: four to open every day, three through to the close and four on a Saturday, five still on at 22:00, fourteen on a Saturday and ten on a Sunday, every duty between 7h and 9h30 on the quarter hour except where it meets the station's open or close, late turns deliberately shorter than early ones, and the times searched against the measured December 2026 service. That table pays the 35-hour week to the minute across 20 working lines and four cover weeks.</p>
  <p>The rotation was then searched for one thing: the rules it will be assessed against. Chiltern's 13-day limit, twelve hours between duties and the exact contract were treated as walls; the 25 ORR good-practice fatigue factors were the objective, each one scored by the workspace's own <span class="tt">assessFatigue</span> on every one of about a million candidate arrangements, together with the size of the week-to-week step, weekends off and an even spread of cover weeks. Only after every factor was settled was a week's coherence allowed to count — one turn a week where it costs nothing against the factors — so that a rotation is not chopped up for no fatigue gain. The rules-only version, with no such term, is on page 8 for comparison. Page 8 says how, and how to reproduce it.` : EF ? `<p>A proposal for the CEA link once the December 2026 timetable arrives, for a team of 24 — <i>By the Book</i> under one more rule: <b>no duty runs over 8h40</b>. That rule is not a trim. Five of <i>By the Book</i>'s eleven Monday-to-Saturday turns ran past it (its earlies reached 9h30), and a day's minutes are fixed by the contract — 14 duties paying 7,000 minutes is a mean of 8h20 — so with the ceiling twenty minutes above the mean, every duty has to sit between 7h and 8h40 and most of them near the top. The December 2026 duty table was therefore searched again from nothing under the same rules: four to open every day, three through to the close and four on a Saturday, five still on at 22:00, fourteen on a Saturday and ten on a Sunday, late turns shorter than early ones, no :05 or :10 times, at most two people on a turn, and the times set against the measured December 2026 service. It pays the 35-hour week to the minute across 20 working lines and four cover weeks.</p>
  <p>The rotation was then searched for one thing: the rules it will be assessed against. Chiltern's 13-day limit, twelve hours between duties and the exact contract were treated as walls; the 25 ORR good-practice fatigue factors were the objective, each one scored by the workspace's own <span class="tt">assessFatigue</span> on every one of about a million candidate arrangements, together with the size of the week-to-week step, weekends off and an even spread of cover weeks. Only after every factor was settled was a week's coherence allowed to count — one turn a week where it costs nothing against the factors — so that a rotation is not chopped up for no fatigue gain. The rules-only version, with no such term, is on page 8 for comparison. Page 8 says how, and how to reproduce it.</p>` : QT ? `  <p>A proposal for the CEA link once the December 2026 timetable arrives, for a team of 24 rather than 20 — <i>Same Turns</i> with two things asked for: the weekday closing turn starts at <b>15:45</b> rather than 15:15, and no duty runs over 8h40. Everything else that brief kept is kept — a week is one turn, rest days come in pairs, four whole cover weeks spread round the rotation, the same 06:20 / 08:00 / 14:00 clock times — together with the December 2026 staffing shape (four to open every day, three through to the close, four on a Saturday, five still on at 22:00, fourteen on a Saturday, ten on a Sunday) and every rule the link is assessed against: Chiltern's 13-day limit, twelve hours between duties, the exact 35-hour contracted week, and the ORR's good-practice fatigue factors.</p>
  <p>A later start is a shorter turn. Thirty minutes off three duties a day is ${S?.closerShift ? S.closerShift * 3 * 5 : 450} minutes a week, and the contract is an equality, so those minutes have to go back somewhere — and with today's turns alone no table pays it. The second rule, no duty over 8h40, rules out lengthening a middle or late turn; so the two 06:20 openers run on at their finish: ${stretchWords || 'see page 4'}. ${S?.allOnToday ? "Those finishes are Saturday's own opening turns, so the 15:45 closer is the only time on the sheet nobody works today, and every weekday duty is 8h30 or under." : 'Every weekday duty is 8h30 or under.'} The search then arranged the duties across 24 lines exactly as <i>Same Turns</i> was built, with the workspace's own modules scoring every candidate. Page 8 says how, and how to reproduce it.</p>` : `  <p>A proposal for the CEA link once the December 2026 timetable arrives, for a team of 24 rather than 20. The brief was to keep the <b>feel</b> of the link people work today — a week is one turn, rest days come in pairs, four whole cover weeks spread round the rotation, and the same 06:20 / 08:00 / 14:00 / 15:15 clock times — while meeting the staffing shape agreed for December 2026 (four to open every day, three through to the close, four on a Saturday, five still on at 22:00, fourteen on a Saturday, ten on a Sunday) and every rule the link is assessed against: Chiltern's 13-day limit, twelve hours between duties, the exact 35-hour contracted week, and the ORR's good-practice fatigue factors.</p>
  ${meta.intro2 ?? `<p>It was not drawn by hand and it was not produced by the workspace's generator, which slides a person's start time through the week. Instead the December 2026 duty table was written in today's shift times, and a search then arranged those duties across 24 lines — over a million candidate arrangements — with the workspace's own hard-limit, rest, contract, fatigue and line-order modules scoring every one, plus a measure of how closely each resembled today's roster. Page 8 says how, and how to reproduce it.</p>`}`}
  <div class="callout"><b>What it is not.</b> Not a recommendation and not a finished roster: nothing here has been through the roster office or a rep. The 24-line length, the four cover weeks and the December 2026 headcounts are owner-relayed figures with no document behind them (evidence class C), and the 13-day limit's policy citation is still outstanding — pages 6 and 7 say so where it applies. It clears every rule the tool can check, which is the floor for being worth discussing.</div>
  <div class="foot"><span>Page 1 of 9 — What this is</span><span class="foot-id"><b>${esc(meta.identity.name)}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>
</section>
${frameHtml}
<section class="page">
  <div class="mast"><div><div class="eyebrow">The rotation</div><h1>The 24-line link</h1><div class="sub">Sunday to Saturday per line; everyone moves down one line each week and line 24 goes back to line 1. Hours and days at the right, cover beneath.</div></div></div>
  <div style="margin-top:10px">${gridHtml(P.patterns, 24, P.totals, P.daily, { spare: 4, avgEx: hmFromHours(P.hours.exSunday), avgAll: hmFromHours(P.hours.all), avgDays: P.totals.daysAverage.toFixed(2), changed: meta.changed ? new Set(meta.changed.cells) : null })}</div>
  <div class="legend"><span><i style="background:color-mix(in srgb, var(--shift-early-fill) 16%, white)"></i>Early turns</span><span><i style="background:color-mix(in srgb, var(--shift-late-fill) 16%, white)"></i>Late turns</span><span><i style="background:color-mix(in srgb, var(--accent-gold) 22%, white)"></i>Cover (spare) week — four duties of seven, any turn</span><span><i style="background:var(--surface-sunken);border:1px solid var(--border-mid)"></i>Rest day</span>${meta.changed ? `<span><i class="i-changed"></i>Changed against <em>${esc(meta.changed.parent.name)}</em> (${esc(meta.changed.parent.code)}) — ${meta.changed.cells.length} cell${meta.changed.cells.length === 1 ? '' : 's'} on ${meta.changed.lines} line${meta.changed.lines === 1 ? '' : 's'}</span>` : ''}<span class="muted">Mon–Sat hours average ${hmFromHours(P.hours.exSunday)} over 24 lines, a cover week counted as a contracted week · days worked average over the 20 working lines · Turns: distinct clock times Monday to Friday, <b>bold</b> where the week is one turn (one clock time Mon–Fri and one early-or-late family across every worked day — the page 1 figure) · Minutes: duty minutes per day, and Mon–Sat is the contract (20 × 35h = 42,000)</span></div>
  <h2 style="margin-top:14px">The words on this page</h2>
  <div class="gloss">
    <div><b>Link</b> — the whole rota: 24 weeks laid out as 24 lines. Everyone works line 1, then line 2, and so on round the wheel; the link needs 24 people.</div>
    <div><b>Line</b> — one week of the pattern, Sunday to Saturday. You move down a line each week, and line 24 goes back to line 1.</div>
    <div><b>Turn</b> — a shift time, such as 06:20-13:45. An <b>early</b> starts before 09:00; a <b>late</b> starts after.</div>
    <div><b>Rest day (RD)</b> — a day off inside the contracted week. Two together make a proper break; one on its own does not count as a 48-hour break.</div>
    <div><b>Cover (spare) week</b> — a week with no fixed times. You work four duties of the seven days, placed by the roster clerk to cover leave and sickness.</div>
    <div><b>Sunday</b> — not part of the contract. A Sunday duty is rest-day working, paid on top of the week, which is why the hours are shown Mon–Sat and all week.</div>
    <div><b>The contract</b> — 35 hours a week, averaged over the 24 lines; a cover week counts as a full contracted week.</div>
    <div><b>One-turn week</b> — the same clock time all week (shown bold in the Turns column); the easiest kind of week to live around.</div>
  </div>
  <div class="foot"><span>Page 3 of 9 — The 24-line grid</span><span class="foot-id"><b>${esc(meta.identity.name)}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>
</section>

<section class="page">
  <div class="mast"><div><div class="eyebrow">${meta.eyebrow3 ?? (BB ? "The December 2026 duty table" : B2 ? "The December 2026 duty table, capped at 8h40, the ticket office rostered" : EF ? "The December 2026 duty table, capped at 8h40" : QT ? "Today's link, widened — the closer at 15:45" : "Today's link, widened")}</div><h1>${meta.h3 ?? (RULES ? "How a week compares with today" : QT ? "Same feel, later closer" : "Same feel, more people")}</h1><div class="sub">${meta.sub3 ?? (RULES ? "Nothing here was asked to resemble today's roster; this is how close the fatigue factors took it on their own, and where the December 2026 duty table differs" : QT ? "What the search was told to keep, what the December 2026 headcounts made it change, and the two openers that run on to pay for the later start" : "What the search was told to keep, and what the December 2026 headcounts made it change")}</div></div></div>
  <div class="stack">
  <div><h2>${RULES ? 'The shape of a week, against today' : 'Kept — the shape of a week'}</h2>
  <table class="t kept"><thead><tr><th>Measure</th><th>Today (20)</th><th>Proposed (24)</th><th></th></tr></thead><tbody>
  ${feelRow('Working weeks that are one turn <span class="muted">(one clock time Mon–Fri)</span>', `${T.feel.oneTurn} of ${T.feel.workingLines}`, `${P.feel.oneTurn} of ${P.feel.workingLines}`)}
  ${feelRow('Weeks mixing early and late turns', `${T.feel.hybrid}`, `${P.feel.hybrid}`)}
  ${feelRow('Rest-day breaks that are two days or more', `${T.feel.pairedRest} of ${T.feel.restIslands}`, `${P.feel.pairedRest} of ${P.feel.restIslands}`)}
  ${feelRow('Single rest days between duties <span class="muted">(not a 48h break)</span>', `${T.feel.isolatedRest}`, `${P.feel.isolatedRest}`)}
  ${feelRow('Days worked in a week <span class="muted">(lines × days)</span>', Object.entries(T.feel.daysHist).map(([d,n])=>`${n}×${d}`).join(', '), Object.entries(P.feel.daysHist).map(([d,n])=>`${n}×${d}`).join(', '))}
  ${feelRow('Cover (spare) weeks <span class="muted">(whole weeks)</span>', `lines ${T.feel.spareLines.join(', ')}`, `lines ${P.feel.spareLines.join(', ')}`)}
  ${feelRow(`Distinct shift times <span class="muted">(${BB ? 'none on today’s roster' : EF ? (ef.sharedToday.length ? `${ef.sharedToday.length} on today’s roster` : 'none on today’s roster') : newTimes.length ? `all but ${newTimes.length} on today’s roster` : 'all already on today’s roster'})</span>`, `${T.feel.distinctTimes}`, `${P.feel.distinctTimes}`)}
  ${feelRow('Mon–Sat hours, average week <span class="muted">(the contract)</span>', hmFromHours(T.hours.exSunday), hmFromHours(P.hours.exSunday))}
  ${feelRow('Sunday duties <span class="muted">(not contracted; half the working lines)</span>', `${T.hours.sundayDuties} of ${T.feel.workingLines} lines`, `${P.hours.sundayDuties} of ${P.feel.workingLines} lines`)}
  </tbody></table></div>
  <div><h2>Changed — the December 2026 headcount</h2>
  <table class="t changed"><thead><tr><th>People on duty</th><th class="num">Today</th><th class="num">Proposed</th><th>Why</th></tr></thead><tbody>
  <tr><td>Monday to Friday</td><td class="num">${wdRange(T.daily)}</td><td class="num"><b>${wdRange(P.daily)}</b></td><td class="muted">the contract: 20 working lines × 35h has to be worked somewhere</td></tr>
  <tr><td>Saturday</td><td class="num">${T.daily.sat}</td><td class="num"><b>${P.daily.sat}</b></td><td class="muted">owner’s figure for December 2026, leaning late for events</td></tr>
  <tr><td>Sunday</td><td class="num">${T.daily.sun}</td><td class="num"><b>${P.daily.sun}</b></td><td class="muted">owner’s figure for December 2026</td></tr>
  ${headRow('Opening at 06:20 (07:15 Sunday)', 'open', 4, 4, 4, 'four to open, every day')}
  ${headRow('Through to the close (23:55; 23:25 Sunday)', 'close', 3, 4, 3, 'three to close, four on a Saturday')}
  ${headRow('Still on duty at 22:00', 'at22', 5, 5, null, 'five from 22:00, Monday to Saturday')}
  </tbody></table></div>
  </div>
  ${RULES ? `<h2>${BB ? "The duty table — the December 2026 duty-table default, beside today's" : "The duty table — the December 2026 timetable rules under 8h40, beside today's"}</h2>
  <div class="cols bb-dense${EF ? ' ef-tight' : ''}"><div><table class="t dutyt"><thead><tr><th>December 2026 turn</th><th class="num">Wk</th><th class="num">Sat</th><th class="num">Sun</th></tr></thead><tbody>${P.tableRows.map(x => `<tr><td class="tt">${x.time}<span class="muted"> ${hm(x.minutes)} · ${classifyShift(x.time)==='early'?'Early':'Late'}</span></td><td class="num">${x.weekday||''}</td><td class="num">${x.sat||''}</td><td class="num">${x.sun||''}</td></tr>`).join('')}</tbody></table></div>
  <div><table class="t dutyt"><thead><tr><th>Today's turn <span class="muted">(none is reused)</span></th><th class="num">Wk</th><th class="num">Sat</th><th class="num">Sun</th></tr></thead><tbody>${T.tableRows.map(x => `<tr><td class="tt muted">${x.time}<span class="muted"> ${hm(x.minutes)}</span></td><td class="num muted">${x.weekday||''}</td><td class="num muted">${x.sat||''}</td><td class="num muted">${x.sun||''}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="cols bb-dense${EF ? ' ef-tight' : ''}" style="margin-top:6px">${BB ? `<p class="muted" style="margin:0">Read the December 2026 duty table in three blocks: eleven turns Monday to Saturday alike, Saturday's own two (a later 08:30 morning body for its 10:00 peak, and one late spent on a fourth closer), and Sunday's six for its 07:15–23:25 window. Openers stagger by their finish and closers by their start so nobody hands over a cliff; there are only two morning arrival times; and 50 of the 54 start and finish instances sit on :00, :15, :30 or :45 — Saturday's four openers and four closers make a fully quarter-hour day arithmetically impossible.</p>
  <p class="muted" style="margin:0">06:20–13:30 is the one short early; every other early (8h25–9h30) is longer than every late (7h15–8h10), which is the lever against unpopular lates. None of the 19 turns is a time people work today — that is the whole difference between this family and <i>Same Turns</i>, and it is the question to put to the room rather than to the tool.</p>` : `<p class="muted" style="margin:0">Read the table in three blocks: ${ef.monSat} turns Monday to Saturday alike${ef.wkOnly ? ` (and ${ef.wkOnly} the weekday keeps to itself)` : ''}, Saturday's own ${ef.satOwn}, and Sunday's ${ef.sunOwn} for its 07:15–23:25 window. Openers stagger by their finish and closers by their start so nobody hands over a cliff. ${ef.onQ} of the ${ef.instances} start and finish instances sit on :00, :15, :30 or :45; the ${ef.off.length} that do not (${ef.off.join(', ')}) are what four distinct opener finishes cost under a cap that leaves the long earlies about twenty minutes of room — <i>By the Book</i> has three such times.</p>
  <p class="muted" style="margin:0">${ef.shortEarly.time} is the one short early; every other early (${ef.longRange}) is longer than every late (${ef.lateRange}) — the lever against unpopular lates, at the only size the cap allows: the shortest long early is ${ef.gap} minutes longer than the longest late, where <i>By the Book</i> had fifteen and an hour on average. ${ef.sharedToday.length ? `${ef.sharedToday.length} of the ${ef.rows} turns ${ef.sharedToday.length === 1 ? 'is a time' : 'are times'} people work today (${ef.sharedToday.join(', ')})` : `None of the ${ef.rows} turns is a time people work today`} — the same trade as <i>By the Book</i>, and the question to put to the room rather than to the tool.</p>`}</div>`
  : `<h2>${QT ? "The duty table — today's times, the closer at 15:45" : "The duty table, in today's times"}</h2>
  <div class="cols duty${meta.denseDuty ? ' bb-dense' : ''}${meta.tightDuty ? ' ef-tight' : ''}"><div>
  <table class="t dutyt"><thead><tr><th>Turn</th><th class="num">Wk</th><th class="num">Sat</th><th class="num">Sun</th><th class="num">Wk</th><th class="num">Sat</th><th class="num">Sun</th></tr></thead><tbody>${tableRows}</tbody></table></div>
  <div><p class="muted">Busiest weekday · Saturday · Sunday. The first three columns are what the 20-line link does now; the last three are the proposal. Green cells grew, amber shrank, a struck-through row is a time the proposal does not use.</p>
  ${QT && S ? `<p class="muted">The 15:45 closer is ${S.closerShift} minutes shorter than the 15:15 turn it replaces — three a day, ${S.closerShift * 15} minutes a week — and with today's turns alone no table reaches 42,000 exactly. The two 06:20 openers run on to put them back: ${stretchWords}, ${S.weekly} minutes a week${S.allOnToday ? " — and those are Saturday's own opening times" : ''}. Nothing runs over 8h30; the other ways of doing it under the 8h40 rule are on page 8.</p>` : ''}
  <p class="muted">${meta.dutyNote ?? `Why the extra duties land where they do: a weekday needs 6,980 minutes and a Saturday 7,100 for 5 weekdays + 1 Saturday to total exactly 20 × 35h = 42,000 — an equality, so the table is one of the few combinations of today's turn lengths that reaches it to the minute. ${QT ? "Today's three weekday openers — 06:20–13:35, 06:20–13:45 and 06:20–14:20 — fold into Saturday's two, 06:20–14:00 and 06:20–14:50" : "The 06:20–13:35 turn is folded into 06:20–13:45 (ten minutes, one fewer time to remember)"}; Sunday gains an 11:00–19:30 middle turn from the weekday vocabulary.`}</p></div>
  </div>`}
  <div class="foot"><span>Page 4 of 9 — ${RULES ? "How a week compares with today" : QT ? "Same feel, later closer" : "Same feel, more people"}</span><span class="foot-id"><b>${esc(meta.identity.name)}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>
</section>

<section class="page">
  <div class="mast"><div><div class="eyebrow">Cover against the service</div><h1>People on duty, hour by hour</h1><div class="sub">Cover today and proposed against the measured December 2026 timetable (arrivals and departures, weighted by train length). A darker orange hour carries more of the day's traffic.</div></div></div>
  <p class="muted" style="margin:6px 0 2px">How to read it: each blue cell is the number of people on duty in that hour (darker blue = more people). The orange row is the timetable — how much of the day's trains that hour carries (darker orange = busier). Read the columns top to bottom: cover should be thickest where the orange is darkest. The <b>fit</b> figure at the right end of each row scores that match for the whole day.</p>
  ${['weekday','sat','sun'].map(cls => { const win = cls==='sun' ? [7,23] : [6,23]; const shut = cls==='sun' ? 23 : 24;
    const name = cls==='weekday'?'Monday to Friday':cls==='sat'?'Saturday':'Sunday';
    const gT = cls==='weekday' ? weekdayGroups(T.hourly) : [{ days:[cls], hours: T.hourly[cls].hours }];
    const gP = cls==='weekday' ? weekdayGroups(P.hourly) : [{ days:[cls], hours: P.hourly[cls].hours }];
    const max = Math.max(...gT.flatMap(g => g.hours), ...gP.flatMap(g => g.hours));
    const lab = (who, g, n) => n === 1 ? who : `${who} ${groupLabel(g.days)}`;
    const varies = cls==='weekday' && (gT.length > 1 || gP.length > 1);
    return `<h2>${name} <span class="muted" style="font-weight:400;font-size:10px">window ${cls==='sun'?'07:15–23:25':'06:20–23:55'}${varies ? ' · one row per distinct weekday' : ''}</span></h2><table class="cov-heat${varies ? ' cov-heat--dense' : ''}">${hourHead()}${gT.map(g => heatRow(lab('Today', g, gT.length), g.hours, max, '', T.fits[g.days[0]])).join('')}${gP.map(g => heatRow(lab('Proposed', g, gP.length), g.hours, max, '', P.fits[g.days[0]])).join('')}${demandRow('Dec 2026 traffic', D.demand.profile[cls].cars, D.demand.peak, D.demand.bucket, shut)}</table>`; }).join('')}
  <p class="muted" style="margin-top:10px">Spare cover is not in these figures — a cover week carries no times, so the rows are a floor. <b>Fit</b> is one number for how closely the people on duty follow the trains through the day: 0 would be a perfect match, lower is better, and today's link scores what it scores. (For the record: the squared gap between each hour's share of the day's traffic and its share of the cover, inside the day's window, measured on duty minutes — so an hour a duty only touches counts in proportion; the cells above count heads.) It is the measure the searched tables were chosen on, and the fit of the average weekday is the <i>Wk fit</i> on page 8. ${meta.sundayNote}</p>
  <div class="callout"><b>Reading it.</b> ${RULES ? 'The table’s times were searched against this curve on a five-minute grid, so the cover follows the traffic as closely as the day’s fixed minutes allow. ' : ''}The proposal raises the whole day rather than reshaping it, which is what the December 2026 timetable brief asked for — the station rosters posts (ticket office, gateline, passenger assist) plus break cover, and a post needs someone on it whether the hour carries 23 trains or 5. ${meta.kind === 'EXT' ? '' : "The one hour the search was allowed to favour is Saturday's 17:00–22:00, for events. "}The weekday's two peaks are a duty length apart, so cover stays fairly flat between them by arithmetic, not neglect.</div>
  <div class="foot"><span>Page 5 of 9 — Cover against the timetable</span><span class="foot-id"><b>${esc(meta.identity.name)}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>
</section>

<section class="page">
  <div class="mast"><div><div class="eyebrow">The rules it is assessed against</div><h1>The checks sheet</h1><div class="sub">Hard limits first — met or not. Then the ORR good-practice fatigue factors, which report what is present and never pass or fail a design.</div></div></div>
  <h2>Hard limits <span class="muted" style="font-weight:400;font-size:10px">— a design either meets these or cannot be run</span></h2>
  <div class="check-rows">
    <div class="check-row ${hard.status==='ok'?'check-good':'check-bad'}"><span class="check-icon ${hard.status==='ok'?'check-tick':'check-cross'}">${hard.status==='ok'?'✓':'✕'}</span><div class="check-body"><b>${esc(hard.title)}</b> — longest possible run <b>${hard.value}</b> days (today: ${hardT.value})<div class="check-sub">${esc(hard.detail)} ${P.asRostered.consecDays.worst === hard.value ? `Worked as a BLOCK of four rather than split day-on-day-off, the answer is the same — <b>${P.asRostered.consecDays.worst}</b> days — so this row does not depend on how a cover week is placed.` : `Worked as a BLOCK of four rather than split day-on-day-off it is <b>${P.asRostered.consecDays.worst}</b> days.`}<br><span class="muted">Basis: ${esc(hard.basis)}. Configured from Chiltern practice; the policy citation is outstanding, so this is stated as the app states it.</span></div></div></div>
    <div class="check-row ${P.checks.turnarounds.length ? 'check-warn-row' : 'check-good'}"><span class="check-icon ${P.checks.turnarounds.length ? '' : 'check-tick'}">${P.checks.turnarounds.length ? '⚠' : '✓'}</span><div class="check-body"><b>At least 12 hours between duties</b> — <b>${P.checks.turnarounds.length}</b> rests under 12h anywhere in the rotation, Saturday-into-Sunday and line-into-line included (today: ${T.checks.turnarounds.length})<div class="check-sub">Tightest anywhere: <b>${restLine(P.rest)}</b> (today's tightest: ${T.rest ? hm(T.rest.minutes) : '—'}). ${meta.kind === 'EXT' ? 'The generator refuses a design it cannot repair to this; this design was checked against it, not generated.' : 'The generator refuses a design it cannot repair to this; the search here never produced one.'}</div></div></div>
    <div class="check-row check-good"><span class="check-icon check-tick">✓</span><div class="check-body"><b>The contracted week, exactly</b> — <b>${hmFromHours(P.hours.exSunday)}</b> average Mon–Sat over the 24 lines, cover weeks counted as contracted weeks<div class="check-sub">700h of duty a week across 20 working lines. Sundays (${P.hours.sundayHours.toFixed(2)}h) sit on top as RDW, as they do today. Individual weeks range ${hm(Math.min(...P.totals.rows.filter(r=>!r.assumed).map(r=>r.exSundayMinutes)))}–${hm(Math.max(...P.totals.rows.map(r=>r.exSundayMinutes)))}; only the average is the contract.</div></div></div>
  </div>
  <h2>December 2026 timetable design figures <span class="muted" style="font-weight:400;font-size:10px">— the staffing shape agreed for the new timetable</span></h2>
  <table class="t rules"><thead><tr><th>Rule</th><th>Proposal</th><th></th></tr></thead><tbody>
  ${meta.designRules.map(r => `<tr><td>${esc(r.rule)}</td><td>${r.ok?'✓':'✕'} ${esc(r.value)}</td><td class="muted">${esc(r.note)}</td></tr>`).join('')}
  </tbody></table>
  <!-- The heading used to be the literal "Two things to settle" while every proposal it rendered
       listed four or five. A heading that miscounts the list under it is the kind of small untruth
       a reader checks and then stops trusting the rest for, so it is overridable. The default is
       unchanged in substance and carries no count. -->
  <h2>${esc(meta.openQuestionsHeading ?? 'To settle before it is frozen')}</h2>
  <p class="oq">${meta.openQuestions}</p>
  <div class="foot"><span>Page 6 of 9 — The checks sheet: hard limits and design figures</span><span class="foot-id"><b>${esc(meta.identity.name)}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>
</section>

<section class="page">
  <div class="mast"><div><div class="eyebrow">The rules it is assessed against · continued</div><h1>ORR fatigue factors</h1><div class="sub">Good practice guidelines — Fatigue Factors, p3 (December 2021). ⚠ present — the pattern is in this design and worth a look, not a breach · ✓ clear — it is not · ● standing — true of the station itself, not of any design · – does not apply here. Nathan assesses against this list.</div></div></div>
  <p class="muted" style="margin:6px 0 4px">The Office of Rail and Road lists 25 roster patterns that tend to tire people — long runs of earlies, short gaps between duties, start times that jump about. For each one this table asks whether the pattern is in the rotation, today and proposed, and how big it is. The list is guidance: a factor present is a question for the room, never a pass or a fail, and a design showing nothing is not thereby approved.</p>
  <table class="ff"><thead><tr><th>Code</th><th>Factor</th><th>Today's link</th><th>Proposed</th></tr></thead><tbody>${rowsFF}</tbody></table>
  <p class="muted">Present: ${P.fatigue.present}${presentRos(P) !== P.fatigue.present ? ` in the worst case, <b>${presentRos(P)}</b> as rostered` : ''} (today ${T.fatigue.present}${presentRos(T) !== T.fatigue.present ? `/${presentRos(T)}` : ''}) · standing: ${P.fatigue.standing} · FF2 fires on every 06:20 duty, so it is a property of the station's opening time rather than of any design. <b>Two readings of a cover week, on the one row they move.</b> A cover week is worked four days of seven and the link does not say which four, so a run figure is a range. The headline number is the ceiling &mdash; the four split day-on-day-off, which supplies no 48-hour break and joins the blocks either side. It is reachable: of the 35 ways to place four duties in seven days, the 10 that leave no two rest days together produce exactly it. Worked as a BLOCK, which is what a cover week looks like on the roster, the three rest days fall together and the week always supplies a break &mdash; that is the <i>as rostered</i> figure beneath it. Checked on every row: FF11 is the only one where the two differ. Which reading applies is a question for the roster office, not for this sheet. This sheet is an aid to a conversation, not a fatigue risk assessment.</p>
  <div class="foot"><span>Page 7 of 9 — The checks sheet: fatigue factors</span><span class="foot-id"><b>${esc(meta.identity.name)}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>
</section>

<section class="page">
  <div class="mast"><div><div class="eyebrow">Method</div><h1>${meta.h7 ?? 'How it was chosen'}</h1><div class="sub">${meta.sub7 ?? 'Reproducible: the same table, seed and objective give the same grid on any machine'}</div></div></div>
  <div class="callout plain"><b>In plain terms.</b> ${meta.kind === 'EXT' ? 'Nobody searched for this design. It was typed in from the table exactly as supplied and the app\'s own rule modules measured it; nothing below was chosen by a computer. Everything on these pages can be re-checked by pasting page 9 into the Links workspace.' : 'A computer took each day\'s duties as fixed and tried over a million different ways of arranging them across the 24 weeks, scoring every arrangement on the rules on pages 6 and 7, and kept the best. The "seed" is the number that makes that run repeat exactly on any machine, so anyone can rebuild this grid and get the same cells.'}</div>
  <h2>${meta.methodHeading ?? 'How it was chosen'}</h2>
  <div class="method-cols">${meta.method ?? `
  ${B2 ? `<p><b>1 · The table.</b> The December 2026 timetable rules under the 8h40 cap, with two ticket-office turns fixed first — <span class="tt">14:00-22:30</span> twice a day Monday to Saturday, <span class="tt">13:30-22:00</span> twice on a Sunday — and the rest of each day searched around them. The table was not annealed: <span class="tt">table-book.mjs</span>'s own search walks lengths and starts together and, with two duties pinned, reports no feasible table where one exists. So every legal set of duty LENGTHS was enumerated with the pinned pair taken out (<span class="tt">PIN_N</span>/<span class="tt">PIN_MIN</span>), and each one was placed (<span class="tt">place-structures.mjs</span>) — ${(ef.counts?.weekday?.structures ?? 0).toLocaleString('en-GB')} weekday structures, ${ef.counts?.weekday?.placed ?? '?'} feasible; ${(ef.counts?.sat?.structures ?? 0).toLocaleString('en-GB')} Saturday, ${ef.counts?.sat?.placed ?? '?'}; ${(ef.counts?.sun?.structures ?? 0).toLocaleString('en-GB')} Sunday at its total, ${ef.counts?.sun?.placed ?? '?'}. The pick was demand fit first, then the count of distinct times (owner). The pinned pair sits outside the early-versus-late ordering rule and counts as on at 22:00 when it finishes there; page 6 says why, and every other rule counts it.</p>` : EF ? `<p><b>1 · The table.</b> The December 2026 timetable rules re-solved under the cap (<span class="tt">table-book.mjs</span>). Every duty LENGTH structure that pays a day exactly — four openers with distinct finishes, three closers with distinct starts (four on a Saturday), the middles, one short early below every late and every other early above it, nothing over 8h40 — was enumerated on the five-minute grid: ${(ef.counts?.weekday.structures ?? 0).toLocaleString('en-GB')} for a weekday, ${(ef.counts?.sat.structures ?? 0).toLocaleString('en-GB')} for a Saturday, ${(ef.counts?.sun.structures ?? 0).toLocaleString('en-GB')} for a Sunday (whose minutes the contract does not fix: the search walked down from the week's 8h20 mean to the largest total at which every pin holds, ${(ef.sunTotal ?? 0).toLocaleString('en-GB')}). For each, the free start times were searched on the quarter hour for the closest fit to the December 2026 timetable demand curve under every other pin of the default table's test — no :05 or :10, at most two on a turn, starts and finishes a quarter apart, five on at 22:00, the busiest hour never on a trough, Saturday's evening lean, and no more clock times than <i>By the Book</i> asks a reader to hold. The placement is a role-preserving anneal over the whole day — every move keeps the day's minutes — and the winner's lengths are checked against the enumeration; the best fit won, with the quarter hour preferred and Saturday asked to reuse the weekday's turns where that cost nothing. Two pins gave way to arithmetic and are on page 6: Saturday's half-hour mean gap, and the quarter-hour spacing of opener finishes.</p>` : BB ? `<p><b>1 · The table.</b> The workspace's own December 2026 duty-table default (<span class="tt">links-default-targets.js</span>): the owner's rules — four open, three close (four on Saturday), five on at 22:00, fourteen on a Saturday, ten on a Sunday, four cover weeks — with the times searched against the December 2026 timetable demand curve under a strict late-shorter-than-early ordering, fewer distinct times, and the quarter-hour rule. It pays 20 × 35h exactly; the generator refuses any table that does not.</p>` : QT ? `<p><b>1 · The table.</b> <i>Same Turns</i>' table B with the closing turn at 15:45, under a second rule: no duty over 8h40. Every December 2026 duty table was re-enumerated from today's shift times with that substitution — every count of each turn on each day class, opening with four, closing with three (four on Saturday), five on at 22:00 — and none totals exactly 42,000 Mon–Sat minutes: the later start takes 450 minutes a week out of a contract that is an equality. Letting one or two other weekday turns keep their start and finish 15, 30 or 45 minutes later, with nothing over 8h40, ${meta.tables} tables reach it and three do so with every count exactly as table B has it; all three run the 06:20 openers on, because stretching a middle or a late turn breaks the cap. Two were searched — <b>Q</b>, the openers to 14:00 and 14:50 (Saturday's own opening times, so no new time but the closer), and <b>R</b>, the 06:20–13:45 opener to 14:30; the third, to 14:15 and 14:35, adds two new times for no gain. All three follow the December 2026 timetable curve identically. Table <b>${meta.winnerVariant}</b> won: rules first, fit second, then fewest times nobody works today, then the search's own score. Saturday and Sunday are <i>Same Turns</i>' own (<span class="tt">table-late.mjs</span>).</p>` : `<p><b>1 · The table.</b> Every possible December 2026 duty table was enumerated from today's shift times — every count of each turn, on each day class — and kept only if it opened with four, closed with three (four on Saturday), kept five on at 22:00, and totalled exactly 42,000 Mon–Sat minutes. ${meta.tables} tables survive. Two weekday shapes were carried forward — table A with three 11:00 middles, table B with a third 08:00 and today's 13:30 turn — and every finished design was scored against the December 2026 timetable demand curve; B, used here, follows a weekday's curve about as evenly as today's roster does (57.7 today, 58.5 here, lower is more even), where A follows it less well (69.5) — the three 11:00 middles put nine people on the quietest part of the afternoon.</p>`}
  <p><b>2 · The grid.</b> Simulated annealing over the 24-line grid: ${meta.steps} candidate arrangements per restart, ${meta.restarts ?? 'four'} restarts from different random starting points per run, ${meta.runs ?? (BB ? 'four seeded runs' : 'three seeded runs per table')} — over a million candidates in all — then a steepest-descent polish of every same-day swap and every pair of lines. Every move keeps each day's duties exactly as the table says — a swap between two lines on one day, or two whole lines changing places — so the coverage, the contract and the headcounts are true by construction and only the SHAPE is searched. Cover weeks stay at lines 1, 7, 13 and 19 throughout.</p>
  <p><b>3 · The judge.</b> Every candidate was scored by the workspace's own modules — <span class="tt">runDesignChecks</span>, <span class="tt">assessFatigue</span>, <span class="tt">assessHardLimits</span>, <span class="tt">scoreOrder</span> — with a rest under 12h or a run past six days costing more than everything else combined, ${RULES ? 'then every fatigue factor present (each one, and its size: the length of an early block, the hours in seven days, each start-time jump, each backward step), then the week-to-week step and the length of a block on the same sort of week. Then, at a weight no factor can be traded for, the coherence of a week (one turn, its weekend variant) and fairness: four to five days a week, no single rest day between duties.' : 'fatigue factors next, and then the feel terms: a week on more than one turn, a single rest day between duties, fewer than four or more than five days, and the week-to-week step.'} Weekends off and long weekends were rewarded. Last, the app's line-order optimiser was offered the result and kept only where it improved that score.</p>`}
  </div>
  <h2>Alternatives measured</h2>
  <table class="t alts${meta.denseAlts ? ' alts-dense' : ''}"><thead><tr><th>Design</th><th class="num">Run</th><th class="num">FF present</th><th class="num">Wkends</th><th class="num">One-turn</th><th class="num">Step</th><th class="num">Wk fit</th><th class="num">Score</th></tr></thead><tbody>
  ${meta.alternatives.map(a => `<tr${a.chosen?' style="font-weight:700"':''}><td>${a.name}</td><td class="num">${a.run}</td><td class="num">${a.present}</td><td class="num">${a.weekends}</td><td class="num">${a.oneTurn}</td><td class="num">${a.step}</td><td class="num">${a.fit}</td><td class="num">${a.score}</td></tr>`).join('')}
  </tbody></table>
  ${meta.pickNote ?? `  <p class="muted"><b>How the winner was picked:</b> rules first (rest, run, fatigue factors present, weekends off), then <i>Wk fit</i> — how evenly the weekday cover follows the December 2026 timetable traffic curve (lower is better; today's link scores what it scores). ${BB ? 'All four candidates clear every factor and share one table, so the fit is identical; full weekends off decided it (6 against 5), and the runner-up is named so it can be asked for. The rules-only row shows what the coherence term cost against the factors: nothing.' : QT || EF ? meta.pickSentence : 'Two candidates tied on every rule; the fit decided it, and the runner-up is named so it can be asked for.'} Score is the search's own feel objective (lower is better) and is not a verdict. The workspace default is the app's own December 2026 duty table, generated and reordered with every switch on — a good design by every panel, and not one that resembles today's.</p>`}

  <div class="foot"><span>Page 8 of 9 — Method</span><span class="foot-id"><b>${esc(meta.identity.name)}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>
</section>

<section class="page">
  <div class="mast"><div><div class="eyebrow">Load it</div><h1>The rotation, ready to paste</h1><div class="sub">Line number, then Sunday to Saturday. SP is a cover week. Paste the whole block into Links → Import.</div></div></div>
  <div class="cols paste"><p class="muted">Links → Import, then paste the whole block below. Line number, then Sunday to Saturday; SP is a cover week. The workspace re-runs every check on these pages from the pasted cells, so nothing here has to be taken on trust — and the two designers can edit it there like any other design.</p>
  <p class="muted">The same rotation is also supplied beside this PDF as <span class="tt">${esc(meta.identity.name.replace(/ /g,'-'))}-${esc(meta.identity.code)}-import.txt</span> (tab-separated, pastes directly) and <span class="tt">${esc(meta.identity.name.replace(/ /g,'-'))}-${esc(meta.identity.code)}.json</span> (the app's own format).</p></div>
  <pre class="imp" style="margin-top:8px; font-size: 9px; line-height: 1.6; padding: 12px 14px">${esc(importPadded)}</pre>
  <p class="muted" style="margin-top:10px">${prepared}. The code <b>${esc(meta.identity.fingerprint)}</b> in every footer is the design's fingerprint — eight characters computed from these 168 cells and nothing else. If the workspace shows the same code after you paste, you have exactly this design; if one cell differs, the code changes. Every figure in this document was computed by the Marylebone Roster app's Links modules (v${APP_VERSION}) from exactly these cells; import them and the workspace's Design checks, hard limits, fatigue factors and coverage cards will restate them.</p>
  <div class="foot"><span>Page 9 of 9 — Import</span><span class="foot-id"><b>${esc(meta.identity.name)}</b> · ${esc(meta.identity.code)} · ${esc(meta.identity.fingerprint)} · Marylebone Roster — Links designer</span></div>
</section>
</body></html>`;
  writeFileSync(out.replace(/\.pdf$/, '.html'), html);
  const b = await chromium.launch(); const pg = await b.newPage();
  await pg.goto('file://' + out.replace(/\.pdf$/, '.html')); await pg.evaluate(() => document.fonts.ready);
  await pg.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await b.close();
}
