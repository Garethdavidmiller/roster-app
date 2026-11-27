// The bilingual link's rules and measures, written once and read by check.mjs, search.mjs and sheet.mjs.
// RULES.md (one folder up) states each rule in prose with the owner's word and its date; this file is
// the arithmetic. A line is one week, Sunday to Saturday: { sun, mon, …, sat }, each a duty
// 'HH:MM-HH:MM', a rest day ('RD' or 'OFF', which today's roster uses for some Sundays) or 'SPARE'
// for every day of a cover week.

import { assessFatigue } from '../../../link-designer-fatigue.js';
import { bilingualRoster } from '../../../roster-cycle-data.js';

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const MON_SAT = DAYS.slice(1);
export const DAY_NAME = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };

/** Today's bilingual link, read from the app's own data so the comparison can never be a stale copy. */
export const TODAY = Object.values(bilingualRoster);
export const TODAY_TIMES = new Set(TODAY.flatMap(l => Object.values(l)).filter(v => isDuty(v)));

// The station's hours (docs/links-26/RULES.md, rule 1; this folder's R3): a duty that starts at the opening or finishes at
// the close keeps those times; every other duty starts and finishes on a quarter hour (RULES.md, R3).
export const OPENS = { sun: '07:15', other: '06:20' };
export const CLOSES = { sun: '23:25', other: '23:55' };

/** What each hour of weekend work pays ON TOP, in hours of basic pay: a rostered Saturday's hours sit
 *  inside the 35 and add a quarter; a Sunday is rest-day working at time and a half on top. */
export const EXTRA = { sat: 0.25, sun: 1.5 };

export function isDuty(v) { return typeof v === 'string' && /^\d\d:\d\d-\d\d:\d\d$/.test(v); }
export function isCover(line) { return line.mon === 'SPARE'; }
export function mins(t) { const [h, m] = t.split(':'); return +h * 60 + +m; }
export function startOf(v) { return mins(v.split('-')[0]); }
/** Minutes from midnight to the finish, past midnight counted as the next day. */
export function endOf(v) { const s = startOf(v), e = mins(v.split('-')[1]); return e <= s ? e + 1440 : e; }
export function hours(v) { return isDuty(v) ? (endOf(v) - startOf(v)) / 60 : 0; }
export const fmtHours = (h) => (Number.isInteger(h) ? String(h) : String(+h.toFixed(2)));

/** True when the duty opens the station on that day (06:20, or 07:15 on a Sunday). */
export function opens(day, v) { return v.split('-')[0] === (day === 'sun' ? OPENS.sun : OPENS.other); }
/** True when the duty closes the station on that day (23:55, or 23:25 on a Sunday). */
export function closes(day, v) { return v.split('-')[1] === (day === 'sun' ? CLOSES.sun : CLOSES.other); }
/** RULES.md R3: every duty starts and finishes on :00, :15, :30 or :45 unless it opens or closes the station. */
export function onTheQuarter(day, v) {
    if (opens(day, v) || closes(day, v)) return true;
    return v.split('-').every(t => mins(t) % 15 === 0);
}

/** Mon–Sat days and hours of one line. */
export function week(line) {
    const worked = MON_SAT.filter(d => isDuty(line[d]));
    return { days: worked.length, hours: worked.reduce((s, d) => s + hours(line[d]), 0) };
}

/** Every weekend is a line's Saturday and the NEXT line's Sunday, because the roster week starts on a
 *  Sunday. A cover week's Sunday is not rostered, so it counts as off; a cover week's own Saturday
 *  depends on what that week is given. */
export function weekends(lines) {
    const n = lines.length, out = { off: 0, one: 0, both: 0, depends: 0, each: [] };
    lines.forEach((l, i) => {
        const next = lines[(i + 1) % n];
        let kind;
        if (isCover(l)) kind = 'depends';
        else {
            const sat = isDuty(l.sat), sun = !isCover(next) && isDuty(next.sun);
            kind = sat && sun ? 'both' : sat || sun ? 'one' : 'off';
        }
        out[kind]++; out.each.push(kind);
    });
    return out;
}

/** Lines with Friday and Saturday off and the next line's Sunday off too. */
export function longBreaks(lines) {
    return lines.filter((l, i) => {
        const next = lines[(i + 1) % lines.length];
        return !isCover(l) && !isDuty(l.fri) && !isDuty(l.sat) && (isCover(next) || !isDuty(next.sun));
    }).length;
}

/** A rest day with a duty either side of it, Monday to Saturday, on a fixed line. */
export function loneRestDays(lines) {
    let n = 0;
    for (const l of lines) {
        if (isCover(l)) continue;
        for (let k = 1; k < MON_SAT.length - 1; k++) {
            if (!isDuty(l[MON_SAT[k]]) && isDuty(l[MON_SAT[k - 1]]) && isDuty(l[MON_SAT[k + 1]])) n++;
        }
    }
    return n;
}

/** The shortest rest, in minutes, between consecutive duties on the fixed lines, all the way round the
 *  rotation (a cover week's duties are not set, so the gap either side of one is not measured). */
export function shortestRest(lines) {
    const seq = lines.flatMap((l, i) => DAYS.map((d, j) => ({ day: i * 7 + j, v: l[d], d })));
    const total = seq.length;
    let worst = Infinity;
    for (let k = 0; k < total; k++) {
        const { day, v } = seq[k];
        if (!isDuty(v)) continue;
        for (let m = 1; m <= 2; m++) {
            const nx = seq[(k + m) % total];
            if (nx.v === 'SPARE') break;
            if (!isDuty(nx.v)) continue;
            const day2 = k + m < total ? nx.day : nx.day + total;
            worst = Math.min(worst, (day2 * 1440 + startOf(nx.v)) - (day * 1440 + endOf(v)));
            break;
        }
    }
    return worst;
}

/** The longest run of days worked, worst case: each cover week works its Sunday as overtime and four of
 *  Monday to Saturday, placed as badly as they can be (RULES.md R6). */
export function worstRun(lines) {
    const covers = lines.map((l, i) => (isCover(l) ? i : -1)).filter(i => i >= 0);
    const fours = [];
    for (let a = 1; a <= 6; a++) for (let b = a + 1; b <= 6; b++) for (let c = b + 1; c <= 6; c++) for (let d = c + 1; d <= 6; d++) fours.push([a, b, c, d]);
    let best = 0;
    const pick = (k, chosen) => {
        if (k < covers.length) { for (const f of fours) pick(k + 1, [...chosen, f]); return; }
        const worked = lines.flatMap((l, i) => DAYS.map((d, j) => (isCover(l) ? j === 0 || chosen[covers.indexOf(i)].includes(j) : isDuty(l[d]))));
        let run = 0, r = 0;
        for (const x of [...worked, ...worked]) { r = x ? r + 1 : 0; run = Math.max(run, r); }
        best = Math.max(best, Math.min(run, worked.length));
    };
    pick(0, []);
    return best;
}

/** The app's own fatigue assessment (link-designer-fatigue.js), and the FF11 run it reports. */
export function fatigue(lines) {
    const f = assessFatigue(Object.fromEntries(lines.map((w, i) => [String(i + 1), w])), lines.length);
    const ff11 = +(f.results.find(x => x.code === 'FF11').detail.match(/is (\d+) shifts/) || [])[1];
    return { present: f.present, codes: f.results.filter(x => x.status === 'present').map(x => x.code), ff11 };
}

/** Everything the sheet shows and the checks need, for one rotation. Per-year figures are for one person. */
export function measure(lines) {
    const n = lines.length, perYear = 52 / n;
    const fixed = lines.filter(l => !isCover(l));
    const wk = weekends(lines);
    const sats = fixed.filter(l => isDuty(l.sat)), suns = fixed.filter(l => isDuty(l.sun));
    const satHours = sats.reduce((s, l) => s + hours(l.sat), 0), sunHours = suns.reduce((s, l) => s + hours(l.sun), 0);
    const monSat = fixed.flatMap(l => MON_SAT.map(d => l[d])).filter(isDuty);
    const earliest = Math.min(...monSat.map(startOf));
    const weeks = fixed.map(week);
    const times = [...new Set(lines.flatMap(l => Object.values(l)).filter(isDuty))];
    const cover = MON_SAT.map(d => fixed.filter(l => isDuty(l[d])).length);
    return {
        lines: n, perYear,
        weekends: wk,
        saturdays: sats.length, sundays: suns.length, sundayHours: [...new Set(suns.map(l => hours(l.sun)))],
        extraPay: EXTRA.sat * satHours + EXTRA.sun * sunHours,
        earliest, earliestCount: monSat.filter(v => startOf(v) === earliest).length,
        days: [Math.min(...weeks.map(w => w.days)), Math.max(...weeks.map(w => w.days))],
        hours: [Math.min(...weeks.map(w => w.hours)), Math.max(...weeks.map(w => w.hours))],
        fatigue: fatigue(lines),
        shortestRest: shortestRest(lines), worstRun: worstRun(lines),
        longBreaks: longBreaks(lines), loneRestDays: loneRestDays(lines),
        cover: [Math.min(...cover), Math.max(...cover)],
        newTimes: times.filter(t => !TODAY_TIMES.has(t)).sort(),
    };
}

/** The wildcard is Option B with every 07:00 start opening the station at 06:20 instead, lengths kept, and
 *  each Sunday an hour longer (RULES.md W1–W3). */
const TO_OPENING = { '07:00-16:00': '06:20-15:20', '07:00-15:00': '06:20-14:20', '07:00-15:30': '06:20-14:50' };
const LONGER_SUNDAY = { '08:00-16:00': '08:00-17:00', '15:25-23:25': '14:25-23:25', '15:00-23:00': '14:00-23:00' };
export function wildcardOf(lines) {
    return lines.map(l => Object.fromEntries(DAYS.map(d => {
        const v = l[d];
        if (d === 'sun') return [d, LONGER_SUNDAY[v] ?? v];
        return [d, v.startsWith('07:00') && TO_OPENING[v] ? TO_OPENING[v] : v];
    })));
}

/**
 * Every rule a 6-line option is held to (RULES.md), as a list of what it breaks; an empty list passes.
 * `kind` is 'A', 'B' or 'W' for the rules that belong to one option only. The fatigue rules are checked
 * last, and only when `fatigueToo` is not false, because they cost far more than the rest (the search
 * asks for them only once a roster keeps every other rule).
 */
export function breaches(lines, kind, fatigueToo = true) {
    const out = [];
    const fixed = lines.filter(l => !isCover(l));
    if (lines.length !== 6) out.push(`${lines.length} lines, not 6`);
    if (lines.length - fixed.length !== 1) out.push(`${lines.length - fixed.length} cover weeks, not 1`);
    lines.forEach((l, i) => {
        if (isCover(l)) return;
        const at = `line ${i + 1}`;
        const w = week(l);
        if (w.days !== 4 || w.hours !== 35) out.push(`${at}: ${w.days} days and ${fmtHours(w.hours)} hours Monday to Saturday, not 4 and 35`);
        for (const d of DAYS) {
            const v = l[d];
            if (!isDuty(v)) continue;
            if (!onTheQuarter(d, v)) out.push(`${at} ${DAY_NAME[d]} ${v}: off the quarter hour`);
            const earliest = kind === 'W' ? mins(OPENS.other) : 7 * 60;
            if (d !== 'sun' && startOf(v) < earliest) out.push(`${at} ${DAY_NAME[d]} ${v}: starts before ${kind === 'W' ? '06:20' : '07:00'}`);
            if (d !== 'sun' && d !== 'sat' && endOf(v) > 23 * 60 + 30) out.push(`${at} ${DAY_NAME[d]} ${v}: a weekday duty past 23:30`);
            if (d === 'sun' && (hours(v) < 8 || hours(v) > 9 || endOf(v) > mins(CLOSES.sun))) out.push(`${at} Sun ${v}: a Sunday is 8 to 9 hours and finishes by 23:25`);
        }
    });
    const sats = fixed.filter(l => isDuty(l.sat)).length, suns = fixed.filter(l => isDuty(l.sun)).length;
    if (sats !== 3) out.push(`${sats} Saturday lines, not 3 (1 Saturday in 2, counting the cover week)`);
    if (suns !== 2) out.push(`${suns} Sunday lines, not 2 (two bilingual colleagues every Sunday)`);
    const sunStarts = fixed.filter(l => isDuty(l.sun)).map(l => startOf(l.sun));
    if (!(sunStarts.some(s => s < 11 * 60) && sunStarts.some(s => s >= 11 * 60))) out.push('Sunday has no early and late pair');
    for (const d of MON_SAT) {
        const on = fixed.filter(l => isDuty(l[d]));
        if (!on.some(l => startOf(l[d]) < 11 * 60)) out.push(`${DAY_NAME[d]}: no early`);
        if (!on.some(l => endOf(l[d]) >= 23 * 60 + 30)) out.push(`${DAY_NAME[d]}: nobody until 23:30`);
        if (d !== 'sat' && (on.length < 3 || on.length > 4)) out.push(`${DAY_NAME[d]}: ${on.length} on, not 3 or 4`);
        if (kind === 'B' && !on.some(l => l[d].startsWith('07:00'))) out.push(`${DAY_NAME[d]}: no 07:00 start`);
        if (kind === 'W' && !on.some(l => opens(d, l[d]))) out.push(`${DAY_NAME[d]}: nobody opens the station`);
    }
    if (!fatigueToo) return out;
    const f = fatigue(lines);
    if (f.present > 0) out.push(`fatigue risk factors present: ${f.codes.join(', ')}`);
    const rest = shortestRest(lines), run = worstRun(lines);
    if (rest < 12 * 60) out.push(`shortest rest ${fmtHours(rest / 60)} hours, under 12`);
    if (run > 13) out.push(`${run} days in a row in the worst case, over 13`);
    return out;
}
