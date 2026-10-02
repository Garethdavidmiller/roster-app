// SELF-CHECK FOR THE 26-LINE TOOLING (1 Oct 2026, owner: "double check that the 26 line link tooling is optimal").
// Nothing in the repository's test lanes runs this folder, so this is the check: run it after any change to link.mjs,
// report-data.mjs or the rules, and before a 26-line design is put forward. It changes nothing.
//
//   node docs/links-26/tooling/check.mjs        → exit 1 if anything disagrees
//
// Three kinds of check:
// 1. The settings agree with each other: the contract, the ceiling and the headcounts the tables are built to.
// 2. The tooling's figures for the test rota agree with a recount done here, from the cells alone, with none of the
//    app's code. A figure can be right in a helper and wrong where it is used; this compares the used figure.
// 3. Each 26-line rule CATCHES a design that breaks it. The rota is mutated once per rule (one more duty past the
//    ceiling, a cover week moved off the even spread, a duty shortened off the contract) and the rule must fail. A
//    rule that stays green when its condition is broken is documented, not checked (CLAUDE.md → "the rule tested,
//    the wiring not").
import { readFileSync } from 'node:fs';
import { DAYS } from '../../../links-design.js';
import { LINES, COVER_WEEKS, WORKING_LINES, CONTRACT_MINUTES, DAYS_CEILING, COVER_LINES, HEADS, daysAYear, coverSpread, monSatMinutes } from './link.mjs';
import { assess, today, sheetRules, flexibleRules } from './report-data.mjs';

let bad = 0;
const ok = (cond, what) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) bad++; };
const clone = p => JSON.parse(JSON.stringify(p));
const T0 = today(), TA = { patterns: T0.patterns, ...assess(T0.patterns, T0.lines) };

// ── 1 · the settings ──────────────────────────────────────────────────────────────────────────
ok(WORKING_LINES === LINES - COVER_WEEKS && CONTRACT_MINUTES === WORKING_LINES * 2100, `contract: ${WORKING_LINES} working lines × 35h = ${CONTRACT_MINUTES} minutes`);
const maxDuties = Math.floor(DAYS_CEILING * LINES * 7 / 365 - 4 * COVER_WEEKS);
const builtTo = 5 * HEADS.weekday + HEADS.sat;
ok(builtTo <= maxDuties, `headcounts ${HEADS.weekday} a weekday + ${HEADS.sat} on a Saturday = ${builtTo} Mon–Sat duties, the ceiling allows ${maxDuties}`);
const evenDefault = coverSpread(Object.fromEntries(Array.from({ length: LINES }, (_, i) => [String(i + 1),
  Object.fromEntries(DAYS.map(d => [d, COVER_LINES.includes(i + 1) ? 'SPARE' : 'RD']))])));
ok(COVER_LINES.length === COVER_WEEKS && evenDefault.even, `default cover lines ${COVER_LINES.join(', ')}: gaps ${evenDefault.gaps.join(', ')}`);

// ── 2 · the test rota, recounted here ─────────────────────────────────────────────────────────
const p = JSON.parse(readFileSync(new URL('./results/test-rota.json', import.meta.url), 'utf8')).patterns;
const keys = Array.from({ length: LINES }, (_, i) => String(i + 1));
const mm = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const span = t => { const [a, b] = t.split('-').map(mm); return [a, b > a ? b : b + 1440]; };
const timed = c => c !== 'RD' && c !== 'SPARE' && c !== 'OFF' && c.includes('-');
const own = {
  duties: keys.reduce((a, k) => a + DAYS.filter(d => d !== 'sun' && timed(p[k][d])).length, 0),
  minutes: keys.reduce((a, k) => a + DAYS.filter(d => d !== 'sun' && timed(p[k][d])).reduce((b, d) => { const [s, e] = span(p[k][d]); return b + e - s; }, 0), 0),
  cover: keys.filter(k => DAYS.every(d => p[k][d] === 'SPARE')).map(Number),
  daily: Object.fromEntries(DAYS.map(d => [d, keys.filter(k => timed(p[k][d])).length])),
};
own.days = (own.duties + 4 * own.cover.length) / LINES * 365 / 7;
const A = assess(p, LINES);
ok(own.minutes === monSatMinutes(p) && own.minutes === CONTRACT_MINUTES, `Mon–Sat minutes: recount ${own.minutes}, tooling ${monSatMinutes(p)}, contract ${CONTRACT_MINUTES}`);
ok(Math.abs(own.days - daysAYear(p)) < 1e-9, `days a year: recount ${own.days.toFixed(2)}, tooling ${daysAYear(p).toFixed(2)}`);
ok(JSON.stringify(own.cover) === JSON.stringify(A.feel.spareLines), `cover lines: recount ${own.cover.join(', ')}, tooling ${A.feel.spareLines.join(', ')}`);
ok(DAYS.every(d => own.daily[d] === A.daily[d]), `on duty each day: recount ${DAYS.map(d => own.daily[d]).join(' ')}, tooling ${DAYS.map(d => A.daily[d]).join(' ')}`);
ok(A.feel.workingLines === WORKING_LINES && A.hours.lines === LINES && A.hours.coverLines === COVER_WEEKS, `the app was given 26 lines: ${A.hours.lines} lines, ${A.hours.coverLines} cover, ${A.feel.workingLines} working`);
const R = sheetRules({ patterns: p, ...A }, TA), F = flexibleRules({ patterns: p, ...A }, TA);
ok(R.met === R.of, `December rules: ${R.met} of ${R.of}`);
ok(F.met === F.of, `flexible rules: ${F.met} of ${F.of} (${F.rows.map(r => r.key).join(', ')})`);
const ceilOf = X => X.hard.checks.find(c => c.id === 'days-ceiling');
ok(ceilOf(A)?.status === 'ok', `days ceiling: ${ceilOf(A)?.value} of at most ${DAYS_CEILING}`);
ok(!ceilOf(TA), "today's 20-line link is measured, not held to the ceiling");

// ── 3 · each rule catches a design that breaks it ─────────────────────────────────────────────
// 3a · one more Monday-to-Saturday duty: 90 duties is 220.6 days a year
{ const q = clone(p); const k = keys.find(k => !own.cover.includes(+k) && q[k].wed === 'RD'); q[k].wed = '07:00-15:30';
  const B = assess(q, LINES);
  ok(ceilOf(B)?.status === 'over' && B.hard.checks.some(c => c.status === 'over'), `one extra duty (line ${k} Wednesday): ${daysAYear(q).toFixed(1)} days, ceiling ${ceilOf(B)?.status} — counted as a hard-limit breach`);
  // the result stays one shape: its breach count is the number of failed checks, as the app's own Links page reads it
  ok(B.hard.breaches === B.hard.checks.filter(c => c.status === 'breach' || c.status === 'over').length, `breach count ${B.hard.breaches} matches the failed checks`); }
// 3d · one more duty with the contract still exact (34 other duties 15 minutes shorter): over the ceiling all the same
{ const q = clone(p); const k = keys.find(k => !own.cover.includes(+k) && q[k].wed === 'RD'); q[k].wed = '07:00-15:30';
  const hh = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  let left = 510; for (const kk of keys) for (const d of ['mon', 'tue', 'thu', 'fri', 'sat']) { if (!left || !timed(q[kk][d])) continue;
    const [s, e] = span(q[kk][d]); if (e - s - 15 < 420) continue; q[kk][d] = `${hh(s)}-${hh(e - 15)}`; left -= 15; }
  const B = assess(q, LINES);
  ok(monSatMinutes(q) === CONTRACT_MINUTES && ceilOf(B)?.status === 'over', `90 duties at exactly ${monSatMinutes(q)} minutes: ${daysAYear(q).toFixed(1)} days, ceiling ${ceilOf(B)?.status}`); }
// 3b · a cover week moved one line: gaps 5, 5, 5, 4, 7
{ const q = clone(p); [q['20'], q['21']] = [q['21'], q['20']];
  const B = assess(q, LINES), FB = flexibleRules({ patterns: q, ...B }, TA), row = FB.rows.find(r => r.key === 'cover');
  ok(!row.ok && !coverSpread(q).even, `cover week moved to line 20: gaps ${coverSpread(q).gaps.join(', ')}, the cover rule ${row.ok ? 'still passes' : 'fails'}`); }
// 3c · a duty shortened by 15 minutes: the contract is no longer exact
{ const q = clone(p); const k = keys.find(k => q[k].mon === '07:00-15:30' || (timed(q[k].mon) && q[k].mon.startsWith('07:')));
  const [s, e] = span(q[k].mon); const hh = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; q[k].mon = `${hh(s)}-${hh(e - 15)}`;
  const B = assess(q, LINES), h = B.hours, over = Math.round(h.exSundayHours * 60 + h.coverLines * (h.target ?? 35) * 60 - h.lines * (h.target ?? 35) * 60);
  ok(over === -15 && monSatMinutes(q) === CONTRACT_MINUTES - 15, `a Monday duty 15 minutes shorter (line ${k}): ${over} minutes against the contract`); }

console.log(`\ncheck: ${bad ? `${bad} FAILED` : 'everything agrees'}`);
process.exit(bad ? 1 : 0);
