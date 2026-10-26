// EVERY WAY TO KEEP A 13:35 OR 13:45 EVERY WEEKDAY (owner, 26 Oct 2026). The brief was today's 20-line link on 26
// lines with a 16:00 closer, keeping "either the 13.35 or 13.45 finish or both"; told that the arithmetic left room for
// three a week, the owner asked: "Check every possibility. We need to maintain at least one weekday 13.35 or 13.45
// finish per day." This is that check, committed so the README's table of possibilities can be rebuilt.
//
// WHY THE MINUTES RUN OUT. With today's times, three 16:00–23:55 closers and nothing else finishing after 22:30, a
// weekday pays at most 7,485 minutes and a Saturday 6,855: 44,280 a week against the 44,100 the contract needs. A 13:45
// in place of a weekday 8h 30m early costs 65 of the 180 spare (the 8-hour 06:20–14:20s are the ticket office, fixed),
// so five of them leave the week 145 minutes short. Each WAY below is a way of finding those minutes:
//   W0  weekday, today's times and the 16:00 closer, nothing else past 22:30          (the baseline)
//   W1  … with one 14:30–23:25 late finish (today's Sunday closer time) allowed       W2  … with two
//   W3  … with a nine-hour duty allowed at each of today's start times (06:20–15:20, 07:15–16:15, 08:00–17:00,
//       08:30–17:30, 11:00–20:00, 12:00–21:00, 13:00–22:00, 13:30–22:30), each new time costing 4 points of fit
//   Sa  Saturday, today's times, closers 16:00      Sb  closers at 15:15 (today's weekday closer)
//   Sc  closers at 14:45 (today's Saturday closer)  Sd  any of the three, mixed
//   Se  closers 16:00, with up to two 14:30–23:25s   Sf  closers 16:00, with the nine-hour times
// Every weekday table must carry a 13:35 or a 13:45 (final-table.mjs REQUIRE); every table is the best-fitting at its
// total, found exhaustively; totals run 5 minutes apart. A WEEK is five weekday tables (up to three different ones)
// and a Saturday paying exactly 44,100, with no more than 18 shift times across the week (Sunday included, as built:
// 07:15–15:45 ×4, 08:00–16:30, 14:00–22:30 ×2, 15:15–23:25 ×3).
//
//   node short-earlies.mjs              combine the committed scan (results/short-earlies-scan.txt) into whole weeks
//   SCAN=1 node short-earlies.mjs       re-run the 2,250 day-table searches first (about ten minutes on four cores)
//   MAXDISTINCT=2 node short-earlies.mjs   at most two different weekday tables (default 3)
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';

const HERE = new URL('.', import.meta.url).pathname, SCAN_FILE = `${HERE}results/short-earlies-scan.txt`;
const TODAYS = '06:20-13:35,06:20-13:45,06:20-14:00,06:20-14:20,06:20-14:50,07:15-15:45,08:00-16:30,08:30-16:30,11:00-19:30,12:00-20:00,13:00-21:00,13:30-21:00,13:30-22:00,14:00-22:30,14:30-22:00,14:30-23:25';
const NINE = '06:20-15:20,07:15-16:15,08:00-17:00,08:30-17:30,11:00-20:00,12:00-21:00,13:00-22:00,13:30-22:30';
const SHORT = '06:20-13:35|06:20-13:45';
const WK = { CLS: 'weekday', WK_CLOSER: '16:00-23:55', CLOSERS_MAX: '3', REQUIRE: SHORT };
const WAYS = {
  W0: { ...WK, MID_END_MAX: '1350', POOL_ONLY: `${TODAYS},16:00-23:55` },
  W1: { ...WK, MID_END_MAX: '1405', LATE_MAX: '1', POOL_ONLY: `${TODAYS},16:00-23:55` },
  W2: { ...WK, MID_END_MAX: '1405', LATE_MAX: '2', POOL_ONLY: `${TODAYS},16:00-23:55` },
  W3: { ...WK, MID_END_MAX: '1350', NEWPEN: '4', POOL_ONLY: `${TODAYS},16:00-23:55,${NINE}` },
  Sa: { CLS: 'sat', MID_END_MAX: '1350', POOL_ONLY: `${TODAYS},16:00-23:55` },
  Sb: { CLS: 'sat', MID_END_MAX: '1350', POOL_ONLY: `${TODAYS},15:15-23:55` },
  Sc: { CLS: 'sat', MID_END_MAX: '1350', POOL_ONLY: `${TODAYS},14:45-23:55` },
  Sd: { CLS: 'sat', MID_END_MAX: '1350', POOL_ONLY: `${TODAYS},14:45-23:55,15:15-23:55,16:00-23:55` },
  Se: { CLS: 'sat', MID_END_MAX: '1405', LATE_MAX: '2', POOL_ONLY: `${TODAYS},16:00-23:55` },
  Sf: { CLS: 'sat', MID_END_MAX: '1350', NEWPEN: '4', POOL_ONLY: `${TODAYS},16:00-23:55,${NINE}` },
};
const range = (a, b) => { const o = []; for (let t = a; t <= b; t += 5) o.push(t); return o; };
const TOTALS = { W0: range(7100, 7600), W1: range(7100, 7600), W2: range(7100, 7600), W3: range(7100, 7800) };

// ---- the scan: one exhaustive final-table.mjs search per (way, total); a table found is one line of the scan file
async function scan() {
  const jobs = Object.keys(WAYS).flatMap(w => (TOTALS[w] ?? range(6000, 7500)).map(t => [w, t]));
  const out = new Map(); let next = 0, done = 0;
  const one = ([w, t]) => new Promise(res => execFile('node', [`${HERE}final-table.mjs`], { env: { ...process.env, TODAY: '1', AT22_STRICT: '1', TOTAL: String(t), ...WAYS[w] }, maxBuffer: 1 << 24 },
    (err, stdout) => { const m = stdout.match(/best: [^\n]* fit ([0-9.]+) [^\n]*\n\s+([^\n]+)/);   // "best: … fit 37.1 · pays 7410 · …" then the duties
      if (m) out.set(`${w} ${t}`, `${w} ${t} ${m[1]} | ${m[2].replace(/\s+/g, ' ').trim()}`); res(); }));
  await Promise.all(Array.from({ length: Math.max(1, cpus().length - 1) }, async () => { while (next < jobs.length) { await one(jobs[next++]); if (++done % 250 === 0) console.error(`  scan ${done}/${jobs.length}`); } }));
  const lines = jobs.map(([w, t]) => out.get(`${w} ${t}`)).filter(Boolean);
  writeFileSync(SCAN_FILE, lines.join('\n') + '\n');
  console.log(`scan: ${jobs.length} searches, ${lines.length} tables found → ${SCAN_FILE.replace(HERE, '')}`);
}
if (process.env.SCAN === '1') await scan();

// ---- the weeks
const TODAY = new Set([...TODAYS.split(','), '14:45-23:55', '15:15-23:55']);
const GIVEN = new Set(['16:00-23:55', '15:15-23:25']);   // the brief's closer and the Sunday closer (README): in every week
const SUN = [['07:15-15:45', 4], ['08:00-16:30', 1], ['14:00-22:30', 2], ['15:15-23:25', 3]];
const m = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const rows = readFileSync(SCAN_FILE, 'utf8').split('\n').filter(l => l.includes(' | ')).map(l => { const [head, tail] = l.split(' | ');
  const [way, total, fit] = head.split(' '), tok = tail.trim().split(/\s+/), duties = [];
  for (let i = 0; i < tok.length; i += 2) duties.push([tok[i], +tok[i + 1].slice(1)]);
  return { way, total: +total, fit: +fit, duties }; });
const count = (d, f) => d.reduce((a, [t, n]) => a + (f(t) ? n : 0), 0);
const late = d => count(d, t => m(t.slice(6)) >= 1380), extra = d => count(d, t => m(t.slice(6)) >= 1380 && !t.endsWith('23:55'));
const n35 = r => count(r.duties, t => t.endsWith('-13:35')), n45 = r => count(r.duties, t => t.endsWith('-13:45'));
const W = rows.filter(r => r.way.startsWith('W')), S = rows.filter(r => r.way.startsWith('S'));
if (W.some(r => n35(r) + n45(r) < 1)) throw new Error('a weekday table without a 13:35 or 13:45 — the scan was run without REQUIRE');
const sBy = {}; for (const s of S) (sBy[s.total] ??= []).push(s);
const MAXD = Number(process.env.MAXDISTINCT ?? 3);
const comps = { 2: [[1, 4], [2, 3], [3, 2], [4, 1]], 3: [[1, 1, 3], [1, 3, 1], [3, 1, 1], [1, 2, 2], [2, 1, 2], [2, 2, 1]] };
const weeks = []; let paying = 0;
const offer = wk => { const sum = wk.reduce((a, [w, k]) => a + k * w.total, 0);
  for (const s of sBy[44100 - sum] ?? []) { paying++;
    const times = new Set([...wk.flatMap(([w]) => w.duties.map(([t]) => t)), ...s.duties.map(([t]) => t), ...SUN.map(([t]) => t)]); if (times.size > 18) continue;
    const satC = [...new Set(s.duties.filter(([t]) => t.endsWith('23:55')).map(([t]) => t.slice(0, 5)))].sort();
    weeks.push({ wk, s, times: times.size, newT: [...times].filter(t => !TODAY.has(t) && !GIVEN.has(t)).sort(), satC,
      lateYear: 2 * (wk.reduce((a, [w, k]) => a + k * late(w.duties), 0) + late(s.duties) + late(SUN)),   // per person: every line works each week twice a year
      extra: wk.reduce((a, [w, k]) => a + k * extra(w.duties), 0) + extra(s.duties),
      short: wk.reduce((a, [w, k]) => a + k * (n35(w) + n45(w)), 0) + n35(s) + n45(s), both: wk.every(([w]) => n35(w) >= 1 && n45(w) >= 1),
      wkFit: wk.reduce((a, [w, k]) => a + k * w.fit, 0) / 5, satFit: s.fit }); } };
for (let i = 0; i < W.length; i++) { offer([[W[i], 5]]);
  if (MAXD >= 2) for (let j = i + 1; j < W.length; j++) { for (const [a, b] of comps[2]) offer([[W[i], a], [W[j], b]]);
    if (MAXD >= 3) for (let k = j + 1; k < W.length; k++) for (const [a, b, c] of comps[3]) offer([[W[i], a], [W[j], b], [W[k], c]]); } }
const fitKey = x => x.wkFit + x.satFit / 5, show = x => `Sat closers ${x.satC.join('/')} · new ${x.newT.length ? x.newT.join(', ') : 'none'} · ${x.short} short earlies a week${x.both ? ' (a 13:35 and a 13:45 every weekday)' : ''} · ${x.lateYear} finishes after 23:00 a year (${x.extra} non-closers a week) · ${x.times} times · fit ${x.wkFit.toFixed(1)} · ${x.satFit} · ${x.wk.map(([w, k]) => `${k}×${w.way}@${w.total}`).join('+')} + ${x.s.way}@${x.s.total}`;
console.log(`${W.length} weekday tables (every one with a 13:35 or 13:45), ${S.length} Saturday tables; ${paying.toLocaleString('en-GB')} whole weeks pay 44,100 exactly, ${weeks.length.toLocaleString('en-GB')} inside 18 shift times`);

// THE README'S ROWS: the best week (fewest late finishes, then the closest fit) for each way of finding the minutes
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const ROWS = [
  ["Saturday's closers stay at today's 14:45", x => same(x.satC, ['14:45']) && !x.newT.length && !x.extra],
  ["Saturday's closers at 15:15, today's weekday closer", x => same(x.satC, ['15:15']) && !x.newT.length && !x.extra],
  ['16:00 every day, with more 23:25 finishes', x => same(x.satC, ['16:00']) && !x.newT.length],
  ['16:00 every day, 13:30–22:30', x => same(x.satC, ['16:00']) && same(x.newT, ['13:30-22:30']) && !x.extra],
  ['16:00 every day, 07:15–16:15 and 13:30–22:30, a 13:35 and a 13:45 every weekday', x => same(x.satC, ['16:00']) && same(x.newT, ['07:15-16:15', '13:30-22:30']) && !x.extra && x.both],
];
// Two answers per way: the best with ONE table on all five weekdays — what the designs built from it use, because a
// Monday-to-Friday that works the same duties every day is what lets a week sit on one shift time — and the best with
// up to MAXDISTINCT different weekday tables, which buys a little fit and nothing else
console.log('\nThe best week for each way (fewest finishes after 23:00, then the closest fit) — one weekday table, then any:');
const bestOf = xs => xs.sort((a, b) => a.lateYear - b.lateYear || fitKey(a) - fitKey(b))[0];
for (const [label, f] of ROWS) { const all = weeks.filter(f), one = bestOf(all.filter(x => x.wk.length === 1)), any = bestOf(all);
  console.log(`  ${label}\n    one table  ${one ? show(one) : 'none'}\n    any        ${any ? show(any) : 'none'}`); }

// THE TRADE-OFFS: every week no other week beats on all five of late finishes, new times, Saturday not at 16:00,
// short earlies (more is better) and fit — taken per cell first so the dominance pass stays small
const key = x => [x.lateYear, x.newT.length, same(x.satC, ['16:00']) ? 0 : 1, -x.short, fitKey(x)];
const cell = {}; for (const x of weeks) { const k = key(x).slice(0, 4).join(); if (!cell[k] || fitKey(x) < fitKey(cell[k])) cell[k] = x; }
const cands = Object.values(cell), worse = (x, y) => { const a = key(x), b = key(y); return b.every((v, i) => v <= a[i]) && b.some((v, i) => v < a[i]); };
const front = cands.filter(x => !cands.some(y => worse(x, y))).sort((a, b) => { const p = key(a), q = key(b); for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return p[i] - q[i]; return 0; });
console.log(`\n${front.length} weeks on the trade-off front (none beaten on every one of: finishes after 23:00, new times, a 16:00 Saturday closer, short earlies, fit):`);
for (const x of front) console.log('  ' + show(x));
