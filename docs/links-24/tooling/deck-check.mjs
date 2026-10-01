// DECK CHECK (1 Oct 2026). The proposal sheets are built from the rotas every time; the four presentations are not —
// their figures are typed into the slides, and the pptxgenjs scripts that first built them live outside this
// repository. So the two halves of the pack can drift apart, and the 1 Oct 2026 accuracy audit found the decks saying
// things the sheets no longer did. This script reads every table-shaped row in the decks — a label, then today's
// figure, then the proposal's — and checks both figures against the same counts the sheets print (report-data.mjs,
// plain.mjs). It changes nothing.
//
//   node docs/links-24/tooling/deck-check.mjs        → exit 1 if any checked figure disagrees
//
// A label it does not know is listed as UNCHECKED, never passed silently: a new row on a slide needs a line in ROWS
// below before this script can vouch for it. Run it after any change to a rota or to a deck, before the decks go out.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { assess, folderStats, today, sheetRules, h55Worst, endMinutes } from './report-data.mjs';
import { personal } from './plain.mjs';

const DIR = process.env.DECK_DIR ?? new URL('../presentations/', import.meta.url).pathname;   // DECK_DIR: check a copy
const DECKS = [['Familiar-Nine-for-colleagues.pptx', 'Familiar Nine'], ['Familiar-Nine-for-managers.pptx', 'Familiar Nine'],
  ['Right-Away-for-colleagues.pptx', 'Right Away'], ['Right-Away-for-managers.pptx', 'Right Away']];

const hm = m => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`;
const span = s => String(s).replace(/(\d+)h(\d\d)(?!m)/g, '$1h $2m');                 // plain.mjs's "8h40" → the decks' "8h 40m"
const WORD = { 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 10: 'ten', 12: 'twelve' };
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const wk = o => { const v = DAYS.slice(0, 5).map(d => o[d]); const lo = Math.min(...v), hi = Math.max(...v); return lo === hi ? `${lo}` : `${lo}–${hi}`; };
const trio = o => `${wk(o)} · ${o.sat} · ${o.sun}`;
const timed = s => /^\d\d:\d\d-\d\d:\d\d$/.test(s);

/** Everything a deck row can quote, for one rota — from the functions the sheets themselves use. */
function figures(patterns, lines, T) {
  const A = assess(patterns, lines), pp = personal(patterns), tA = T ?? A;
  const R = sheetRules({ patterns, ...A }, tA, lines === 20 ? 'today' : 'plan');
  const fl = /fewest (\d+) · (\d+) · (\d+)/.exec(R.rows.find(r => r.key === 'floor').value).slice(1).map(Number);
  const worstFF = A.fatigue.present + (h55Worst(patterns, lines)?.adds ? 1 : 0);
  let fin22 = 0, dx = 0;
  for (const r of Object.values(patterns)) for (const d of DAYS) { const s = r[d]; if (!timed(s)) continue; if (endMinutes(s) >= 22 * 60) fin22++; if (d !== 'sun') dx++; }
  const cover = pp.cover, L = pp.L, dpw = (dx + 4 * cover) / L;
  const up = (fixed, worst) => `${fixed}${worst !== fixed ? ` (up to ${worst})` : ''}`;
  const todaysTimes = new Set((T ? T.tableRows : A.tableRows).map(r => r.time));
  const shared = A.tableRows.filter(r => todaysTimes.has(r.time)).length;
  return {
    people: `${L}`, hours: '35h', daysWeek: `${+dpw.toFixed(2)}`, daysYear: `${Math.round(pp.daysYear)}`,
    sat: `${Math.round(pp.sat)}`, sun: `${Math.round(pp.sun)}`, late23: `${Math.round(pp.late23)}`,
    late22: `${Math.round(fin22 * 52 / L)}`, open0620: `${Math.round(pp.open0620)}`,
    rest: hm(A.rest.minutes), longest: hm(pp.longest), avgLongest: `${hm(pp.avgShift)} · ${hm(pp.longest)}`,
    closers: ['wk', 'sat', 'sun'].map(k => span(pp.closerSpan[k])).join(' · '),
    closerWk: span(pp.closerSpan.wk), closerSat: span(pp.closerSpan.sat), closerSun: span(pp.closerSpan.sun), avg: hm(pp.avgShift),
    weekends: `${A.checks.weekendsOff} in ${L} (one in ${WORD[Math.round(L / A.checks.weekendsOff)] ?? Math.round(L / A.checks.weekendsOff)})`,
    weekendsShort: `${A.checks.weekendsOff} in ${L}`,
    run: up(A.fixed.run, A.checks.longestStretch), ff: up(A.fixed.present, worstFF),
    times: T ? `${A.feel.distinctTimes} (${shared} you know)` : `${A.feel.distinctTimes}`,
    daily: trio(A.daily), dailyWk: wk(A.daily), dailyWeekend: `${A.daily.sat} / ${A.daily.sun}`,
    open: trio(A.heads.open), at22: trio(A.heads.at22), close: trio(A.heads.close),
    floor: fl.join(' · '), floorMin: `${Math.min(...fl)}`,
    cover: `${cover} — 1 week in ${Math.round(L / cover)}`, sundayPeople: `${A.daily.sun}`,
    breaks: `${A.feel.pairedRest} of ${A.feel.restIslands}`, oneTurn: `${A.feel.oneTurn} of ${A.feel.workingLines}`,
  };
}

/** Slide label → the figure it quotes. Keys are the labels exactly as the slides print them. */
const ROWS = {
  'People on the link': 'people', 'Contracted hours a week': 'hours', 'Contracted days at work a week': 'daysWeek',
  'Contracted days at work a year': 'daysYear', 'Saturdays a year, at time and a quarter': 'sat',
  'Sunday overtime to share — each, a year': 'sun', 'Finishing at 23:00 or later — each, a year': 'late23',
  'Finishing at 22:00 or later — each, a year': 'late22', 'Starting at 06:20 — each, a year': 'open0620',
  'Shortest gap between two shifts': 'rest', 'Shortest rest between shifts (limit 12h)': 'rest', 'Longest shift': 'longest',
  'Average shift · longest shift': 'avgLongest', 'Closing shift: weekday · Saturday · Sunday': 'closers',
  'Full weekends off': ['weekends', 'weekendsShort'], 'Most days worked in a row': 'run', 'Most days in a row (limit 13)': 'run',
  'Avoidable fatigue warnings in the fixed rota': 'ff', 'Avoidable fatigue warnings, fixed rota': 'ff',
  'Different shift times': 'times', 'On duty weekday · Saturday · Sunday': 'daily', 'On duty during the day': 'daily',
  'On duty on a weekday': 'dailyWk', 'On duty on a Saturday / Sunday': 'dailyWeekend',
  'At the open (06:20, Sunday 07:15)': 'open', 'Still on after 22:00': 'at22', 'Through to the close': 'close',
  'Fewest rostered on the floor': ['floor', 'floorMin'], 'Cover weeks (for leave and sickness)': 'cover',
  'People needed each Sunday (overtime)': 'sundayPeople', 'Rest-day breaks of two days or more': 'breaks',
  'Weeks on one turn, Monday to Friday': 'oneTurn', 'Longest shift anywhere': 'longest', 'Average shift': 'avg',
};
/** Labels that carry their own times ("Weekday closer — starts 15:45, not 15:15"): matched by their start. */
const ROW_PATTERNS = [[/^Weekday closer\b/, 'closerWk'], [/^Saturday closer\b/, 'closerSat'], [/^Sunday closer\b/, 'closerSun']];
/** Rows deliberately left to a person: the leave figures come from a booking model the sheets do not compute. */
const NOT_FROM_SHEETS = [/^Days off in a row/, /^Leave for four full weeks off/];

/** A slide's text in reading order: table cells for a table, otherwise one item per shape. */
function slideItems(xml) {
  const text = s => [...s.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]).join('').replace(/&amp;/g, '&');
  if (xml.includes('<a:tbl>')) return [...xml.matchAll(/<a:tc>[\s\S]*?<\/a:tc>/g)].map(m => text(m[0]));
  return [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map(m => text(m[0])).filter(Boolean);
}

const T0 = today(), TA = assess(T0.patterns, 20), TF = figures(T0.patterns, 20, null);
const stats = folderStats();
let bad = 0, ok = 0; const unchecked = new Set();
for (const [file, name] of DECKS) {
  const f = stats.find(s => s.name === name); if (!f) throw new Error(`deck-check: no proposal called ${name}`);
  const j = JSON.parse(readFileSync(new URL(`../${f.file}`, import.meta.url), 'utf8')), p = j.patterns ?? j;
  const PF = figures(p, 24, TA);
  const slides = execFileSync('unzip', ['-Z1', DIR + file], { encoding: 'utf8' }).split('\n').filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  for (const s of slides) {
    const it = slideItems(execFileSync('unzip', ['-p', DIR + file, s], { encoding: 'utf8' })), n = s.match(/\d+/)[0];
    // a header row "Today | <name>" marks a comparison table; each row after it is label, today, proposal
    const h = it.findIndex((x, i) => x === 'Today' && it[i + 1] === name); if (h < 0) continue;
    for (let i = h + 2; i + 2 < it.length + 1; i += 3) {
      const [label, tv, pv] = [it[i], it[i + 1], it[i + 2]];
      if (tv == null || pv == null) break;
      if (/[.!?]$/.test(label)) break;                                   // the slide's takeaway line: the table has ended
      const key = ROWS[label] ?? ROW_PATTERNS.find(([re]) => re.test(label))?.[1];
      if (!key) { if (!/\d/.test(tv) && !/\d/.test(pv)) break;
        unchecked.add(`${file} slide ${n}: "${label}"${NOT_FROM_SHEETS.some(re => re.test(label)) ? ' (not a sheet figure — check by hand)' : ''}`); continue; }
      const keys = [key].flat(), want = (F) => keys.map(k => F[k]);
      const tOk = want(TF).includes(tv), pOk = want(PF).includes(pv);
      if (tOk && pOk) { ok++; continue; }
      bad++; console.log(`MISMATCH ${file} slide ${n} "${label}": deck ${tv} / ${pv} — the sheets say ${want(TF).join(' or ')} / ${want(PF).join(' or ')}`);
    }
  }
}
for (const u of unchecked) console.log(`UNCHECKED ${u}`);
console.log(`deck-check: ${ok} rows agree, ${bad} disagree, ${unchecked.size} not checked`);
process.exit(bad ? 1 : 0);
