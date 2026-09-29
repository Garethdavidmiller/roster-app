// THE RULES REFERENCE (owner, 28 Sep 2026: "one rules sheet based on our current rules for reference").
// Every proposal sheet restates the rules on page 6, beside that design's own figures. This is the same set on
// its own, once, so the rules can be read, argued about and changed without opening a design.
//
// Nothing here is typed that the proposal sheets compute. The eleven December rows are `currentRules` —
// the function every sheet calls — run on today's link; the fatigue list is `assessFatigue`'s own. Change a
// rule in report-data.mjs and this sheet follows on its next render; it cannot say one thing while a sheet says
// another. TODAY'S LINK IS THE ONLY COMPARISON (owner, 29 Sep 2026): the "met by N proposals" and "present in N"
// columns went, because a manager reading this is not shown the drafts. The folder is still read, but only to
// decide which fatigue factors apply to any rotation here; the drafts side by side are the one-page summary.
//
//   node docs/proposals/tooling/rules-sheet.mjs      → docs/proposals/December-2026-Rules.pdf
// A full `regenerate.mjs` run renders it too, after every sheet.
import { writeFileSync, readFileSync } from 'node:fs';
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { today, assess, currentRules, folderStats, OFFICE, OFFICE_HELP_TEXT, demand, MAX_CONSECUTIVE_WORKED_DAYS } from './report-data.mjs';
import { assessFatigue } from '../../../links-fatigue.js';

const ROOT = new URL('../../../', import.meta.url).href.replace(/\/$/, '');
const OUT = new URL('../December-2026-Rules.pdf', import.meta.url).pathname;
const RENDERED = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hm = m => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
const clock = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ── the figures ─────────────────────────────────────────────────────────────────────────────────────────
const T0 = today();
const TA = { patterns: T0.patterns, ...assess(T0.patterns, T0.lines) };
const RT = currentRules(TA, TA, 'today');
const F = folderStats(), N = F.length;

// Hard limits across the folder, measured the way page 7 measures them.
const restOk = F.filter(f => f.turnarounds === 0).length;
const runOk = F.filter(f => f.run <= MAX_CONSECUTIVE_WORKED_DAYS).length;
const contractOk = F.filter(f => { const j = JSON.parse(readFileSync(new URL(`../${f.file}`, import.meta.url), 'utf8')); const h = assess(j.patterns ?? j, 24).hours;
  return Math.round(h.exSundayHours * 60 + h.coverLines * (h.target ?? 35) * 60 - h.lines * (h.target ?? 35) * 60) === 0; }).length;
const todayRest = TA.rest?.minutes ?? null;

// Fatigue: the factor list, and in how many proposals each is present. MRSF carries four rows under one code,
// so a factor is keyed by code AND title.
const key = r => `${r.code}|${r.title}`;
const FZ = assessFatigue(T0.patterns, 20).results;
const presentIn = {}, applies = new Set(FZ.filter(r => r.status !== 'n/a').map(key));
for (const f of F) { const j = JSON.parse(readFileSync(new URL(`../${f.file}`, import.meta.url), 'utf8'));
  for (const r of assessFatigue(j.patterns ?? j, 24).results) { if (r.status !== 'n/a') applies.add(key(r)); if (r.status === 'present') presentIn[key(r)] = (presentIn[key(r)] ?? 0) + 1; } }
// A factor that applies to no rotation here — today's or any proposal — is listed apart, with the reason.
const live = FZ.filter(r => applies.has(key(r))), na = FZ.filter(r => !applies.has(key(r)));
const naNight = na.filter(r => r.family === 'Night shifts' || /^Night shift/.test(r.title)), naOther = na.filter(r => !naNight.includes(r));
const naWhy = r => r.code === 'FF4' ? 'FF4, because no shift starts before 05:00' : /permanent/.test(r.title) ? 'the MRSF permanent-pattern check, because the link rotates (FF15 is its rotating equivalent)' : `${r.code} (${r.title})`;
const andList = a => a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
const todayContract = (() => { const h = TA.hours; return Math.round(h.exSundayHours * 60 + h.coverLines * (h.target ?? 35) * 60 - h.lines * (h.target ?? 35) * 60) === 0; })();
const mark = ok => ok ? '✓' : '✕', cls = ok => ok ? 'ok' : 'miss';

const sunLate = demand.movementsOutside(demand.movements.sun, 7 * 60 + 15, 23 * 60 + 25).after;

// ── the words ───────────────────────────────────────────────────────────────────────────────────────────
// What each December rule asks, in full — the sheets' short notes plus what a first-time reader needs.
const ASKS = {
  open: 'Four people on duty from the moment the station opens: 06:20, or 07:15 on a Sunday.',
  close: 'Three people still on duty until the station closes: 23:55, or 23:25 on a Sunday.',
  at22: 'Five people still on duty at 22:00. Only people working <i>after</i> 22:00 count; someone finishing at 22:00 does not.',
  heads: 'Fourteen people working on a Saturday and ten on a Sunday, counted as duties rostered that day.',
  cover: 'Four cover weeks in the 24 lines, spaced evenly — every six lines, e.g. lines 1, 7, 13 and 19.',
  office: `Two identical early and two identical late shifts for the ticket office: Mon–Fri ${OFFICE.plan.weekday.map(([t]) => t.replace('-', '–')).join(' and ')}; Sat ${OFFICE.plan.sat.map(([t]) => t.replace('-', '–')).join(' and ')}; Sun two starting 07:15 and two finishing 22:30.`,
  closer: 'Every Monday-to-Friday shift that works to the 23:55 close starts at 15:45.',
  floor: 'At least two people on the station floor at every moment the station is open, checked every five minutes. Ticket-office staff count only while the second of a pair helps on the floor at the quiet ends, and only as a whole person.',
  handover: 'Each closer overlaps someone already on duty by 15 minutes; the two ticket-office shifts overlap by 20. On a Sunday each opener also stays until 15 minutes after the last closer arrives.',
  sunlen: 'Every Sunday duty is between 8 and 9 hours long.',
  times: `No more different shift times in the week than today’s link has (${TA.feel.distinctTimes}).`,
};

const decRows = RT.rows.map((r, i) => `<tr><td><b>${esc(r.rule)}</b></td><td>${ASKS[r.key] ?? esc(r.note)}</td><td class="tt ${r.ok ? 'ok' : 'miss'}">${r.ok ? '✓' : '✕'} ${esc(r.value)}</td></tr>`).join('');

// Today's link is the only comparison on this sheet (owner, 29 Sep 2026: a manager is not shown the drafts), so the
// last column is TODAY's status, not a count of the proposals each factor is present in.
const ffStatus = r => r.status === 'standing' ? 'Every link' : r.status === 'present' ? `Present (${r.value})` : 'Clear';
const ffRows = live.map(r => `<tr><td class="ff-code">${esc(r.code)}</td><td>${esc(r.title)}${r.confirm ? ' <span class="conf">definition to confirm</span>' : ''}</td><td class="fam">${esc(r.family)}</td><td class="num">${ffStatus(r)}</td></tr>`).join('');

const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>December 2026 Rules</title>
<link rel="stylesheet" href="${ROOT}/shared.css"><link rel="stylesheet" href="${ROOT}/links.css">
<style>
@page { size: A4; margin: 11mm 11mm 13mm; }
html, body { background: white !important; color: var(--text-dark); padding: 0 !important; margin: 0; font-family: var(--font-sans); font-size: 10.5px; line-height: 1.4; }
.page { page-break-after: always; position: relative; min-height: 270mm; }
.page:last-child { page-break-after: auto; }
.mast { background: var(--primary-blue); color: white; padding: 12px 20px 11px; border-bottom: 4px solid var(--accent-gold); border-radius: var(--radius); display: flex; gap: 16px; align-items: center; }
.mast img { width: 44px; height: 44px; border-radius: 10px; }
.mast .eyebrow { color: var(--accent-gold); font-size: 10px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; }
.mast h1 { margin: 2px 0; font-size: 22px; font-weight: 800; color: white; letter-spacing: -.2px; }
.mast .sub { color: rgba(255,255,255,.78); font-size: 11.5px; }
.mast .meta { color: rgba(255,255,255,.55); font-size: 9.5px; margin-top: 4px; }
h2 { font-size: 13.5px; color: var(--primary-blue); margin: 9px 0 3px; font-weight: 800; }
h2 .tag { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .4px; padding: 1px 7px; border-radius: 8px; margin-left: 8px; vertical-align: 2px; }
.tag.hard { background: var(--primary-blue); color: white; } .tag.soft { background: var(--accent-gold); color: var(--primary-blue); } .tag.adv { background: var(--surface-sunken); color: var(--text-mid); }
p { margin: 3px 0 6px; } .muted { color: var(--text-mid); }
.lead { font-size: 10.5px; }
.tiers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 8px 0 2px; }
.tier { background: var(--surface-sunken); border-radius: var(--radius-sm); padding: 6px 10px; font-size: 9.4px; line-height: 1.35; border-top: 3px solid var(--primary-blue); }
.tier:nth-child(2) { border-top-color: var(--accent-gold); } .tier:nth-child(3) { border-top-color: var(--border-mid); }
.tier b.k { display: block; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .3px; color: var(--primary-blue); margin-bottom: 3px; }
.basics { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 18px; font-size: 9.4px; line-height: 1.36; }
.basics b { color: var(--text-dark); }
table.t { border-collapse: collapse; width: 100%; font-size: 9.3px; line-height: 1.34; }
table.t th, table.t td { padding: 2px 6px; border-bottom: 1px solid var(--border-light); text-align: left; vertical-align: top; }
table.t th { background: var(--surface-sunken); color: var(--text-mid); font-size: 8.6px; text-transform: uppercase; letter-spacing: .3px; }
table.t td.num, table.t th.num { text-align: right; font-variant-numeric: tabular-nums; }
table.t tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--surface-sunken) 55%, white); }
.tt { font-variant-numeric: tabular-nums; white-space: nowrap; }
td.ok { color: color-mix(in srgb, var(--success-green) 80%, black); } td.miss { color: color-mix(in srgb, var(--warning-amber) 55%, black); }
.dec td:nth-child(1) { width: 22%; } .dec td:nth-child(2) { width: 50%; } .dec td:nth-child(3) { width: 19%; } table.t td.num { white-space: nowrap; }
.hard td:nth-child(1) { width: 22%; } .hard td:nth-child(2) { width: 50%; } .hard td:nth-child(3) { width: 19%; }
.ff td.ff-code { font-weight: 800; color: var(--primary-blue); white-space: nowrap; width: 40px; } .ff td.fam { color: var(--text-light); white-space: nowrap; width: 110px; }
.conf { display: inline-block; font-size: 8px; padding: 0 6px; border-radius: 8px; background: color-mix(in srgb, var(--warning-amber) 18%, white); color: color-mix(in srgb, var(--warning-amber) 55%, black); margin-left: 4px; vertical-align: 1px; }
.callout { border-left: 3px solid var(--accent-gold); background: var(--surface-sunken); padding: 6px 12px; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; margin: 6px 0; font-size: 9.8px; }
ul.list { margin: 3px 0 4px; padding-left: 17px; font-size: 9.8px; line-height: 1.42; } ul.list li { margin: 2px 0; }
ol.open { margin: 3px 0 4px; padding-left: 19px; font-size: 9.8px; line-height: 1.42; } ol.open li { margin: 3px 0; }
.foot { position: absolute; bottom: 0; left: 0; right: 0; display: flex; justify-content: space-between; font-size: 8.5px; color: var(--text-light); border-top: 1px solid var(--border-light); padding-top: 4px; }
.foot b { color: var(--primary-blue); }
</style></head><body>

<section class="page">
  <div class="mast"><img src="${ROOT}/icon-192.png" alt=""><div><div class="eyebrow">Marylebone Roster · Links designer · reference</div><h1>The December 2026 rules</h1>
  <div class="sub">The rules any proposed CEA link for the December 2026 timetable is measured against, with today’s link beside each one</div>
  <div class="meta">Prepared ${RENDERED} · the rules and every figure below are read from the same code that writes the proposal sheets, not typed</div></div></div>

  <div class="tiers">
    <div class="tier"><b class="k">Hard limits</b>A design must meet these or it cannot be run. Three of them.</div>
    <div class="tier"><b class="k">December 2026 rules</b>The staffing the station has asked for. Eleven of them, each met or not. Weigh them against each other.</div>
    <div class="tier"><b class="k">Fatigue factors</b>Patterns that tend to tire people. Advisory only: “present” means worth a look, never a breach.</div>
  </div>

  <h2>The basics every rule assumes</h2>
  <div class="basics">
    <div><b>Opening hours.</b> The station opens at 06:20 (07:15 on a Sunday) and closes at 23:55 (23:25 on a Sunday). <b>No duty runs past 23:25 on a Sunday</b> — agreed practice, settled 28 Sep 2026 — although ${sunLate.length} Sunday trains move later, the last at ${clock(sunLate[sunLate.length - 1].t)}.</div>
    <div><b>The link.</b> 24 lines worked in turn, one week each, Sunday to Saturday; a person on the last line moves to line 1.</div>
    <div><b>Cover week.</b> A line with no fixed shifts: four duties in the week, placed by the roster clerk to cover leave and sickness.</div>
    <div><b>Early and late.</b> A shift starting before 11:00 is an early; from 11:00 it is a late.</div>
    <div><b>The floor.</b> Everyone on duty except the four ticket-office staff, who are there for the office’s opening hours, not the trains. ${OFFICE_HELP_TEXT}.</div>
    <div><b>Today’s link.</b> The 20-line link worked now. It is the yardstick, not the target: it meets ${RT.met} of the ${RT.of} December rules.</div>
  </div>

  <h2>Hard limits <span class="tag hard">must be met</span></h2>
  <table class="t hard"><thead><tr><th>Limit</th><th>What it means</th><th>Today’s link</th></tr></thead><tbody>
    <tr><td><b>At least 12 hours between duties</b></td><td>From the end of one duty to the start of the next, anywhere in the rotation — Saturday into Sunday, and the last line into line 1, included.</td><td class="tt ${cls(TA.checks.turnarounds.length === 0)}">${mark(TA.checks.turnarounds.length === 0)} shortest ${todayRest !== null ? hm(todayRest) : '—'}</td></tr>
    <tr><td><b>No more than ${MAX_CONSECUTIVE_WORKED_DAYS} days worked in a row</b></td><td>Chiltern’s limit, taken at its worst case: a cover week’s four duties placed as badly as they can be. The written source of the ${MAX_CONSECUTIVE_WORKED_DAYS}-day limit is still to be confirmed.</td><td class="tt ${cls(TA.checks.longestStretch <= MAX_CONSECUTIVE_WORKED_DAYS)}">${mark(TA.checks.longestStretch <= MAX_CONSECUTIVE_WORKED_DAYS)} longest ${TA.checks.longestStretch} days</td></tr>
    <tr><td><b>The contracted week, exactly</b></td><td>35 hours a week on average, Monday to Saturday, across all 24 lines; a cover week counts as a contracted week. Sunday duties are paid on top as rest-day working, as they are today. Individual weeks may be longer or shorter; only the average is the contract.</td><td class="tt ${cls(todayContract)}">${mark(todayContract)} ${todayContract ? 'exactly 35h' : 'not 35h'}</td></tr>
  </tbody></table>

  <h2>The December 2026 rules <span class="tag soft">met or not</span></h2>
  <p class="lead">Every number is a <b>minimum</b>: too few is the problem, never too many. The staffing levels, the 24-person link and the Sunday cover have all been confirmed verbally.</p>
  <table class="t dec"><thead><tr><th>Rule</th><th>What it asks, exactly</th><th>Today’s link</th></tr></thead><tbody>${decRows}</tbody></table>
  <p class="muted" style="font-size:9px">Today’s figures read Mon–Fri · Saturday · Sunday; a range means the weekdays differ.</p>

  <div class="foot"><span>Page 1 of 2 — Hard limits and the December 2026 rules</span><span><b>December 2026 rules</b> · Marylebone Roster — Links designer</span></div>
</section>

<section class="page">
  <div class="mast"><div><div class="eyebrow">The rules · continued</div><h1>Fatigue factors, preferences, and what is still open</h1>
  <div class="sub">The advisory list, what is for staff to say rather than the rules, and the questions not yet settled</div></div></div>

  <h2>Fatigue factors <span class="tag adv">advisory</span></h2>
  <p>${FZ.length} roster patterns that tend to tire people: ${FZ.filter(r => r.code !== 'MRSF').length} from the Office of Rail and Road’s good-practice guidance, <i>Fatigue Factors</i> (page 3, December 2021), and ${FZ.filter(r => r.code === 'MRSF').length} extra checks from the rail industry’s fatigue guidance (MRSF). The ORR says they are guidance, not limits. So a factor present is a question to discuss, never a pass or a fail, and a design showing none is not thereby approved.</p>
  <table class="t ff"><thead><tr><th>Code</th><th>Factor</th><th>Kind</th><th class="num">Today’s link</th></tr></thead><tbody>${ffRows}</tbody></table>
  <p class="muted" style="font-size:9px"><b>Not applicable.</b> ${na.length} more factors apply to no rotation here: ${naNight.length} about night shifts (${andList(naNight.map(r => r.code))}), because CEAs do not work nights; ${naOther.map(naWhy).join('; and ')}. <b>“Every link”</b> marks a standing factor — one that comes with the station’s hours or with any weekly link, not with a design’s choices: FF2 because the station opens at 06:20, and FF18 because a weekly link changes shift type about once a week (the ORR prefers two-day or three-week rotation, <i>Managing rail staff fatigue</i> 7.68). <b>Standing factors are recorded on every sheet for information and are not counted</b> in any design’s fatigue findings, since no weekly design can remove them. The <b>early</b> in FF2 and FF15 is the ORR’s — a start from 05:00 to 07:00 — not the 11:00 used everywhere else. The last column is today’s link.</p>

  <h2>Preferences <span class="tag adv">for staff to say, not the app</span></h2>
  <ul class="list">
    <li><b>Days in a row.</b> The Links designer aims for six or fewer, well inside the ${MAX_CONSECUTIVE_WORKED_DAYS}-day limit.</li>
    <li><b>Full weekends off</b> — a Saturday off followed by a Sunday off at the start of the next line. Today’s link gives ${TA.checks.weekendsOff} in 20.</li>
    <li><b>Weeks on one shift time</b> — the same clock time Monday to Friday, all earlies or all lates. A week that mixes the two is what people mean by “all over the place”.</li>
    <li><b>Familiar shift times</b> — how many of a design’s times somebody already works today. A rough guide to what there is to learn, not to what staff will accept.</li>
    <li><b>Following the trains</b> — how closely the floor’s staffing follows the December 2026 timetable, hour by hour. A guide, and one way of measuring it among several.</li>
  </ul>

  <h2>Still to settle</h2>
  <ol class="open">
    <li><b>Does someone finishing at 22:00 count as “still on duty at 22:00”?</b> Today they do not. Counting them would change the 22:00 rule on many designs, because a lot of late turns end at 22:00.</li>
    <li><b>Does the 22:00 rule apply on a Sunday?</b> Today it is checked every day.</li>
    <li><b>The source of the ${MAX_CONSECUTIVE_WORKED_DAYS}-day limit.</b> Somebody confirms where it is written down.</li>
    <li>${(() => { const c = live.filter(r => r.confirm), n = c.length, codes = andList(c.map(r => r.code === 'MRSF' ? 'MRSF 7×8h' : r.code));
      // Settled 28 Sep 2026 against ORR's Managing rail staff fatigue (Aug 2024): only FF19 keeps the flag, because
      // its reading (a rest day resets it) is the owner's and more lenient than ORR's wording — say which way it leans.
      return `<b>${['No','One','Two','Three','Four','Five','Six'][n] ?? n} fatigue definition${n === 1 ? '' : 's'} to confirm.</b> ${n ? `${codes} ${n === 1 ? 'is' : 'are'} counted on a reading an assessing manager should confirm${c.some(r => r.code === 'FF19') ? ': FF19 treats a rest day as time to adjust, where the ORR’s wording (“consecutive duties”) would count across rest days — and on that reading every link has it' : ''}.` : 'Every factor is counted on the ORR’s own reading.'}`; })()}</li>
  </ol>

  <div class="callout"><b>Changing a rule.</b> Every proposal sheet is checked against this set by the same code. Change a rule and every sheet and this page are re-rendered together, so no sheet is ever judged against an older version of it.</div>

  <div class="foot"><span>Page 2 of 2 — Fatigue factors, preferences and open questions</span><span><b>December 2026 rules</b> · Marylebone Roster — Links designer</span></div>
</section>
</body></html>`;

const htmlOut = new URL('December-2026-Rules.html', import.meta.url).pathname;
writeFileSync(htmlOut, html);
const b = await chromium.launch(); const pg = await b.newPage();
await pg.goto('file://' + htmlOut); await pg.evaluate(() => document.fonts.ready);
await pg.pdf({ path: OUT, format: 'A4', printBackground: true, preferCSSPageSize: true });
await b.close();
console.log('wrote', OUT);
