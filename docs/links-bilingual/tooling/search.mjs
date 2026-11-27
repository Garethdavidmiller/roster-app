// Searches for 6-line bilingual options inside RULES.md and prints the best it finds.
//   node docs/links-bilingual/tooling/search.mjs <A|B|B-daytime> [seconds=120]
//
// How: a local search with restarts. A state is one candidate week for each role in the rotation; a
// move swaps one role's week for another candidate; a move is kept when the cost does not rise. Every
// rule broken costs 1000, so the search can walk through rosters that break a rule on its way to ones
// that keep them all; only rosters that break nothing are reported. It is random: two runs can return
// different rosters of the same cost. Run it more than once (four at a time on four cores) and keep the
// best; the options in options.json were found that way on 27 November 2026.
//
// The cost, lower is better: 10 per duty time not on today's roster, 2 per distinct time, 3 per lone
// rest day, 4 per line that mixes earlies and lates more than 4 hours apart, 3 per shift past 9 in the
// longest run without a two-day break, less 4 per Friday-to-Sunday break, and per variant: A, less 3 per
// cell equal to today's same line; B, 1.5 per 07:00 start past one a day.

import {
    DAYS, MON_SAT, TODAY, TODAY_TIMES, isDuty, isCover, startOf, hours, breaches, wildcardOf, fatigue, longBreaks, loneRestDays,
} from './rules.mjs';

const VARIANT = process.argv[2] || 'B';
const SECONDS = +(process.argv[3] || 120);
if (!['A', 'B', 'B-daytime'].includes(VARIANT)) { console.error('variant: A, B or B-daytime'); process.exit(2); }
const R = 'RD';
const COVER = Object.fromEntries(DAYS.map(d => [d, 'SPARE']));

// The duty times a week may use (RULES.md R3, R4): every one on the quarter hour, none closing on a weekday.
const WEEKDAY = ['07:00-16:00', '07:00-15:00', '07:00-15:30', '08:00-17:00', '08:00-16:00', '08:00-16:30', '08:30-17:00',
    '12:00-21:00', '12:00-20:00', '14:00-23:30', '14:00-23:00', '14:30-23:30', '15:00-23:30', '15:00-23:00'];
const SATURDAY = [...WEEKDAY, '08:00-14:30', '14:25-23:55'];
const SUNDAY = { early: ['08:00-16:00'], late: ['15:25-23:25', '15:00-23:00'] };

/** Every week of 4 days and exactly 35 hours whose starts never move earlier by more than 40 minutes, or
 *  by more than 2 hours either way, from one day to the next, with at most two start times. */
function weeks(withSaturday) {
    const out = [], base = ['mon', 'tue', 'wed', 'thu', 'fri'], pick = withSaturday ? 3 : 4, sets = [];
    (function choose(i, acc) {
        if (acc.length === pick) { sets.push(acc); return; }
        if (i < base.length) { choose(i + 1, [...acc, base[i]]); choose(i + 1, acc); }
    })(0, []);
    for (const set of sets) {
        const ds = withSaturday ? [...set, 'sat'] : set;
        (function fill(i, acc, total) {
            if (total > 35) return;
            if (i === ds.length) {
                if (total !== 35) return;
                for (let k = 1; k < ds.length; k++) {
                    if (MON_SAT.indexOf(ds[k]) - MON_SAT.indexOf(ds[k - 1]) !== 1) continue;
                    const step = startOf(acc[k]) - startOf(acc[k - 1]);
                    if (step < -40 || Math.abs(step) > 120) return;
                }
                if (new Set(acc.map(startOf)).size > 2) return;
                const w = Object.fromEntries(DAYS.map(d => [d, R])); ds.forEach((d, k) => { w[d] = acc[k]; });
                out.push(w); return;
            }
            for (const t of ds[i] === 'sat' ? SATURDAY : WEEKDAY) fill(i + 1, [...acc, t], total + hours(t));
        })(0, [], 0);
    }
    return out;
}
const SAT_WEEKS = weeks(true), WEEKDAY_WEEKS = weeks(false);
const withSunday = (kind) => WEEKDAY_WEEKS.flatMap(w => SUNDAY[kind].map(s => ({ ...w, sun: s })));

// The roles, and the orders the rotation may take. B's two working weekends are a Saturday line followed
// by a Sunday line; its third Saturday stands alone; the cover week comes first.
let ROLES, ORDERS, FIXED = {};
if (VARIANT === 'A') {
    FIXED = { 1: TODAY[1], 3: TODAY[3] };            // today's lines 2 and 4, unchanged
    ROLES = { 2: SAT_WEEKS.flatMap(w => SUNDAY.late.map(s => ({ ...w, sun: s }))), 4: WEEKDAY_WEEKS, 5: withSunday('early') };
    ORDERS = [['C', 1, 2, 3, 4, 5]];
} else {
    const daytime = VARIANT === 'B-daytime';
    ROLES = { sa1: SAT_WEEKS, su1: withSunday('early'), sa2: SAT_WEEKS, su2: withSunday(daytime ? 'early' : 'late'), sa3: SAT_WEEKS };
    ORDERS = [['C', 'sa1', 'su1', 'sa2', 'su2', 'sa3'], ['C', 'sa1', 'su1', 'sa3', 'sa2', 'su2'], ['C', 'sa3', 'sa1', 'su1', 'sa2', 'su2']];
}
const roleKeys = Object.keys(ROLES);
const build = (order, pick) => order.map(k => (k === 'C' ? COVER : FIXED[k] ?? pick[k]));

/** How many rules this variant breaks, the wildcard's counted too. Each fatigue risk factor present
 *  counts as one, every time, so the search is rewarded for fixing one even while another rule is broken. */
function broken(lines) {
    const kind = VARIANT === 'A' ? 'A' : 'B';
    const keep = (list) => (VARIANT === 'B-daytime' ? list.filter(b => b !== 'Sunday has no early and late pair') : list);
    let n = keep(breaches(lines, kind, false)).length + fatigue(lines).present;
    if (kind === 'B') { const w = wildcardOf(lines); n += keep(breaches(w, 'W', false)).length + fatigue(w).present; }
    return n;
}

function score(lines) {
    const kind = VARIANT === 'A' ? 'A' : 'B';
    const brokenCount = broken(lines);
    const times = new Set(lines.flatMap(l => Object.values(l)).filter(isDuty));
    const newTimes = [...times].filter(t => !TODAY_TIMES.has(t)).length;
    const mixed = lines.filter(l => { const st = DAYS.map(d => l[d]).filter(isDuty).map(startOf); return st.length && Math.max(...st) - Math.min(...st) > 240; }).length;
    const sevens = lines.flatMap(l => MON_SAT.map(d => l[d])).filter(v => isDuty(v) && v.startsWith('07:00')).length;
    let same = 0;
    if (VARIANT === 'A') for (const i of [2, 4, 5]) for (const d of DAYS) if (isDuty(lines[i][d]) && lines[i][d] === TODAY[i][d]) same++;
    const ff11 = fatigue(lines).ff11;
    const cost = brokenCount * 1000 + newTimes * 10 + times.size * 2 + loneRestDays(lines) * 3 + mixed * 4
        + Math.max(0, ff11 - 9) * 3 - longBreaks(lines) * 4 - same * 3 + (kind === 'B' ? Math.max(0, sevens - 6) * 1.5 : 0);
    return { cost, broken: brokenCount };
}

const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const found = new Map();
const t0 = Date.now(); let tried = 0;
while (Date.now() - t0 < SECONDS * 1000) {
    const order = rnd(ORDERS);
    let pick = Object.fromEntries(roleKeys.map(k => [k, rnd(ROLES[k])]));
    let cur = score(build(order, pick)); tried++;
    for (let stale = 0; stale < 3000 && Date.now() - t0 < SECONDS * 1000;) {
        const k = rnd(roleKeys), next = { ...pick, [k]: rnd(ROLES[k]) };
        const s = score(build(order, next)); tried++;
        if (s.cost <= cur.cost) { stale = s.cost < cur.cost ? 0 : stale + 1; pick = next; cur = s; } else stale++;
    }
    const lines = build(order, pick);
    if (cur.broken === 0 && breaches(lines, VARIANT === 'A' ? 'A' : 'B').filter(b => VARIANT !== 'B-daytime' || b !== 'Sunday has no early and late pair').length === 0) found.set(JSON.stringify(lines), { cost: cur.cost, lines });
}
const best = [...found.values()].sort((a, b) => a.cost - b.cost).slice(0, 3);
console.log(`${VARIANT}: ${tried} rosters tried in ${SECONDS}s, ${found.size} that keep every rule`);
for (const b of best) {
    console.log(`\ncost ${b.cost}`);
    b.lines.forEach((l, i) => console.log(`  ${i + 1}: ${DAYS.map(d => (isCover(l) ? 'cover' : l[d]).padEnd(11)).join(' ')}`));
    console.log(`  JSON: ${JSON.stringify(b.lines)}`);
}
