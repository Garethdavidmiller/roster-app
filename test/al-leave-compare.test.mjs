// @ts-check
// @lane hygiene
/**
 * al-leave-compare.test.mjs — the clerks' leave sheet beside the app, person by person and day by day
 * (al-leave-compare.js, the annual leave uploader's Phase 1; docs/AL_UPLOADER_PLAN.md §4).
 * Run: node scripts/run-tests.mjs test/al-leave-compare.test.mjs   (part of `npm run test:hygiene`)
 *
 * Every person here is INVENTED ("A. Example" and friends). They borrow the real roster PATTERNS —
 * a member needs a line to have rest days at all — but no real name, date of leave or figure appears:
 * a leave file is personal data, and nothing in this repository may look like a real one.
 *
 * THE DATES ARE FOUND, NOT WRITTEN DOWN. Each test asks the member's pattern for the first working day
 * or rest day it needs (`find`), so a future edit to a pattern moves the date rather than quietly
 * turning a "rest day" test into a working-day one. A test always tests the case it names, and says
 * so: where a case depends on the pattern, the pattern is asserted first. Nothing reads a clock.
 *
 * What it proves, in the module's own terms:
 *   · every DAY_STATE is reached, and for the reason the header gives it;
 *   · the no-record branch IS the Admin leave card's answer — `projectAlBooking`, the real function,
 *     compared date for date across months of two patterns and a joiner, never a copy of its rules;
 *   · the winning record is resolved first (manual beats a roster import; the newer copy wins);
 *   · app-only leave is found by its own pass, inside the sheet's dates only, with the year it costs;
 *   · the figures are the app's own (`alPosition`, `entitlementFor`), and an allowance difference
 *     reads the sheet as the clerks write it: carried forward on, a joiner's reduction off;
 *   · "agree" means the FIGURES agree: the gap between the two is the sum of the reasons the card
 *     names, and a gap no reason names still puts the person under "Needs a look";
 *   · the swap question is asked exactly where the Admin leave card asks it;
 *   · who can be checked at all is `leaveRecordability`, and a manager is never a leaver;
 *   · the whole file is ordered and totalled the way the card shows it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_STATES, NEEDS_A_LOOK, COUNT_KEYS, leaveRecordability, winnersByDate, comparePerson, compareLeaveFile } from '../al-leave-compare.js';
import { projectAlBooking } from '../admin-al-projection.js';
import { alPosition, entitlementFor, entitlementNote } from '../al-entitlement.js';
import { getBaseShift, parseISODate, isSunday, isBankHoliday } from '../roster-data.js';
import { isBeforeMemberStart } from '../override-utils.js';
import { LEAVE_FILE_FORMAT, LEAVE_FILE_VERSION } from '../al-leave-file.js';

const YEAR = 2026;
const FIRST = '2026-01-01';
const LAST = '2027-01-02';
const TODAY = '2026-11-14';

// ── Invented members, on real patterns ──────────────────────────────────────────────────────────
/** @type {any} */ const CEA = { name: 'A. Example', role: 'CEA', rosterType: 'main', currentWeek: 1 };
/** @type {any} */ const CES = { name: 'B. Example', role: 'CES', rosterType: 'ces', currentWeek: 1 };
/** @type {any} */ const DISP = { name: 'C. Example', role: 'Dispatcher', rosterType: 'dispatcher', currentWeek: 1 };
/** A joiner: midnight local start (roster-data.md), and the joining year's allowance as the clerks give it. */
/** @type {any} */ const JOINER = { name: 'D. Example', role: 'CEA', rosterType: 'main', currentWeek: 2,
    startDate: new Date(2026, 8, 20), proRatedAL: { 2026: 9 } };
/** @type {any} */ const LEAVER = { name: 'E. Example', role: 'CEA', rosterType: 'main', currentWeek: 3, hidden: true };
/** @type {any} */ const MANAGER = { name: 'F. Example', role: 'Management', rosterType: 'main', currentWeek: 1,
    hidden: true, managerOnly: true };

// ── Dates found from the pattern ────────────────────────────────────────────────────────────────
const DAY = 86_400_000;
/** @param {string} d @param {number} n */
const plus = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** @param {any} m @param {string} d @returns {string} */
const pat = (m, d) => getBaseShift(m, parseISODate(d));
const timed = (/** @type {string} */ s) => /^\d\d:\d\d-\d\d:\d\d$/.test(s);
const resting = (/** @type {string} */ s) => s === 'RD' || s === 'OFF';
const any = () => true;
/** Not a Sunday, not Christmas, not a bank holiday — so neither a Dispatcher's lieu days nor the
 *  Christmas rules wander into a test about something else. */
const ordinary = (/** @type {string} */ d) => !isSunday(d) && !/-12-2[56]$/.test(d) && !isBankHoliday(parseISODate(d));
/**
 * The first ordinary date from `from` whose pattern passes `want`, skipping the dates in `not`.
 * @param {any} m @param {string} from @param {(shift: string) => boolean} want @param {string[]} [not]
 * @returns {string}
 */
function find(m, from, want, not = []) {
    for (let d = from, i = 0; i < 400; d = plus(d, 1), i++) {
        if (ordinary(d) && !not.includes(d) && want(pat(m, d))) return d;
    }
    throw new Error(`no such day for ${m.name} from ${from}`);
}
/** The first Sunday from `from` whose pattern passes `want`. @param {any} m @param {string} from @param {(s: string) => boolean} want */
function findSunday(m, from, want) {
    for (let d = from, i = 0; i < 400; d = plus(d, 1), i++) if (isSunday(d) && want(pat(m, d))) return d;
    throw new Error(`no such Sunday for ${m.name} from ${from}`);
}

// ── Records and sheet days, shaped as the app and the file shape them ───────────────────────────
let clock = 1_770_000_000;
/**
 * A Firestore-shaped override. Each is NEWER than the one made before it, unless `extra` says otherwise.
 * @param {any} m @param {string} date @param {string} type @param {string} value @param {Record<string, any>} [extra]
 */
function rec(m, date, type, value, extra = {}) {
    return { memberName: m.name, date, type, value, note: '', source: 'manual', createdAt: { seconds: clock++ }, ...extra };
}
/** @param {any} m @param {string} d @param {Record<string, any>} [extra] */
const AL = (m, d, extra = {}) => rec(m, d, 'annual_leave', 'AL', extra);
/** @param {any} m @param {string} date @param {Record<string, any>} [extra] */
const leave = (m, date, extra = {}) => ({ name: m.name, date, kind: 'leave', foundIn: 'grid', countedBySheet: true, ...extra });
/** @param {any} m @param {string} date */
const tag = (m, date) => ({ name: m.name, date, kind: 'sunday-tag', foundIn: 'grid-tag', countedBySheet: false });
/** @param {any} m @param {string} date */
const sundayCounted = (m, date) => ({ name: m.name, date, kind: 'sunday-counted', foundIn: 'grid', countedBySheet: true });

/**
 * A person's file entry. Its sums are not checked here — al-leave-file.test.mjs owns those.
 * @param {any} m @param {Record<string, number>} [o]
 */
function sheetPerson(m, o = {}) {
    const { allowance = 32, carriedForward = 0, used = 0, columnE = 0, joinerReduction = 0, lump = 0, unexplained = 0, rows = 1 } = o;
    const printed = { carriedForward, allowance, used, columnE, remaining: carriedForward + allowance - used - columnE };
    const grade = m.role === 'CES' ? 'CES' : m.role === 'Dispatcher' ? 'DISP' : 'CEA';
    return {
        name: m.name, grade,
        sheetRows: Array.from({ length: rows }, (_, i) => ({ row: 10 + i, spelt: 'Example . X', grade, used: i === 0,
            ...(i ? { why: 'duplicate-identical' } : {}), printed })),
        columnE: { datedDays: 0, joinerReduction, lump, unexplained },
        corrected: { remaining: o.corrected ?? printed.remaining, because: [] },
    };
}
/** A person the sheet has no totals row for. @param {any} m */
const noRowPerson = m => ({ name: m.name, grade: 'DISP', sheetRows: [], columnE: null, corrected: null });

/**
 * Compare one invented member.
 * @param {any} m @param {any[]} days @param {any[]} [records]
 * @param {{ person?: any, sheet?: Record<string, number>, lastDate?: string }} [o]
 */
function compare(m, days, records = [], o = {}) {
    return comparePerson({ person: o.person ?? sheetPerson(m, o.sheet), days, member: m, records,
        year: YEAR, todayStr: TODAY, firstDate: FIRST, lastDate: o.lastDate ?? LAST });
}
/** @param {any} res @param {string} date */
const stateOf = (res, date) => res.days.find((/** @type {any} */ d) => d.date === date)?.state;

// ════════════════════════════════════════════════════════════════════════════════════════════════

test('the state lists agree with each other: NEEDS_A_LOOK is part of DAY_STATES, and agreement is not in it', () => {
    for (const s of NEEDS_A_LOOK) assert.ok(DAY_STATES.includes(s), s);
    for (const s of ['match', 'carried', 'sunday']) assert.ok(!NEEDS_A_LOOK.includes(s), s);
    // A day before the start date the sheet counts and the app never can: the figures differ by it.
    assert.ok(NEEDS_A_LOOK.includes('before-start'));
    assert.equal(new Set(DAY_STATES).size, DAY_STATES.length);
    for (const s of DAY_STATES) assert.ok(COUNT_KEYS.includes(s), s);
    assert.deepEqual(COUNT_KEYS.filter(k => !DAY_STATES.includes(k)), ['app-only', 'beyond', 'undated', 'figures']);
});

describe('every state is reached, for the reason the header gives', () => {
    test('match: leave recorded on a working day, costing a day from the same year', () => {
        const d = find(CEA, '2026-02-01', timed);
        const res = compare(CEA, [leave(CEA, d)], [AL(CEA, d)]);
        assert.equal(stateOf(res, d), 'match');
        assert.deepEqual(res.days[0].app, { type: 'annual_leave', value: 'AL', source: 'manual' });
        assert.equal(res.days[0].pattern, pat(CEA, d));
    });

    test('not-in-app: nothing recorded, and the pattern has them working — a Spare day is working too', () => {
        const shift = find(CEA, '2026-02-01', timed);
        const spare = find(CEA, '2026-02-01', s => s === 'SPARE');
        const res = compare(CEA, [leave(CEA, shift), leave(CEA, spare)]);
        assert.equal(stateOf(res, shift), 'not-in-app');
        assert.equal(stateOf(res, spare), 'not-in-app');
        assert.equal(res.days[0].app, null);
    });

    test('rest-day: nothing recorded on a rest day — the day Admin would ask "was it a swapped day?" about', () => {
        const d = find(CEA, '2026-02-01', resting);
        assert.equal(stateOf(compare(CEA, [leave(CEA, d)]), d), 'rest-day');
    });

    test('free-in-app: leave recorded on a rest day with no swap costs nothing — nor does leave over RDW', () => {
        const d = find(CEA, '2026-02-01', resting);
        const e = find(CEA, '2026-02-01', resting, [d]);
        const res = compare(CEA, [leave(CEA, d), leave(CEA, e)], [AL(CEA, d), AL(CEA, e, { replacedType: 'rdw' })]);
        assert.equal(stateOf(res, d), 'free-in-app');
        assert.equal(stateOf(res, e), 'free-in-app');
    });

    test('the swap question is asked of a free day EXACTLY where the Admin leave card asks it (projectAlBooking)', () => {
        // Plain leave on a rest day: Admin asks. Leave its record has already settled — over RDW, a
        // correction, an Other day or a Spare turn on a rest day — Admin never asks, and the first cut
        // did (review, 14 Nov 2026). A correction can sit on a WORKING pattern day, too.
        const [r1, r2, r3, r4, r5] = [0, 1, 2, 3, 4].reduce((/** @type {string[]} */ acc) => [...acc, find(CEA, '2026-02-01', resting, acc)], []);
        const w = find(CEA, '2026-02-01', timed);
        const records = [AL(CEA, r1), AL(CEA, r2, { replacedType: 'rdw' }), AL(CEA, r3, { replacedType: 'correction' }),
            AL(CEA, r4, { replacedType: 'other' }), AL(CEA, r5, { replacedType: 'spare_shift' }), AL(CEA, w, { replacedType: 'correction' })];
        const dates = [r1, r2, r3, r4, r5, w];
        const res = compare(CEA, dates.map(d => leave(CEA, d)), records);
        const winners = winnersByDate(records, CEA.name);
        for (const d of dates) {
            const day = res.days.find((/** @type {any} */ x) => x.date === d);
            assert.equal(day.state, 'free-in-app', d);
            assert.equal(day.swapQuestion, projectAlBooking({ member: CEA, dates: [d], ovByDate: winners }).asked.includes(d), d);
        }
        assert.deepEqual(dates.map(d => res.days.find((/** @type {any} */ x) => x.date === d).swapQuestion), [true, false, false, false, false, false]);
        // Nothing recorded on a rest day is Admin's question too; a working day and a match are not.
        const empty = compare(CEA, [leave(CEA, r1), leave(CEA, w)]);
        assert.deepEqual(empty.days.map((/** @type {any} */ x) => [x.state, x.swapQuestion]), [r1, w].sort().map(d => d === r1 ? ['rest-day', true] : ['not-in-app', false]));
    });

    test('a SWAPPED working day — leave on a rest day carrying replacedType "shift" — is a match, not free', () => {
        const d = find(CEA, '2026-02-01', resting);
        const res = compare(CEA, [leave(CEA, d)], [AL(CEA, d, { replacedType: 'shift' })]);
        assert.equal(stateOf(res, d), 'match');
    });

    test('other-year: a next-January day the sheet charges to THIS year, which the app charges to next', () => {
        const d = find(CEA, `${YEAR + 1}-01-01`, timed);
        assert.ok(d.startsWith(`${YEAR + 1}-01-`), `the case needs a January day, found ${d}`);
        const day = leave(CEA, d, { leaveYear: YEAR });
        assert.equal(stateOf(compare(CEA, [day], [AL(CEA, d)], { lastDate: `${YEAR + 1}-01-31` }), d), 'other-year');
        // …and agreement when the app has moved it back as well.
        assert.equal(stateOf(compare(CEA, [day], [AL(CEA, d, { leaveYear: YEAR })], { lastDate: `${YEAR + 1}-01-31` }), d), 'match');
    });

    test('other-year: a January day the app has moved back to last year, which the sheet charges to its own', () => {
        const d = find(CEA, `${YEAR}-01-02`, timed);
        assert.ok(d.startsWith(`${YEAR}-01-`), `the case needs a January day, found ${d}`);
        const res = compare(CEA, [leave(CEA, d)], [AL(CEA, d, { leaveYear: YEAR - 1 })]);
        assert.equal(stateOf(res, d), 'other-year');
        assert.equal(res.days[0].appYear, YEAR - 1, 'the year the app takes it from travels with the day');
    });

    test('carried: the sheet carries a day forward for each January day the app moves back — explained, and agreeing', () => {
        // AL_WORKBOOK.md §9: the sheet adds the carried days to this year and counts the January days
        // here; the app takes them from last year. Same figure left, so it is NOT a difference to look at.
        const d = find(CEA, `${YEAR}-01-02`, timed);
        const e = find(CEA, `${YEAR}-01-02`, timed, [d]);
        const f = find(CEA, `${YEAR}-01-02`, timed, [d, e]);
        assert.ok([d, e, f].every(x => x.startsWith(`${YEAR}-01-`)), 'the case needs three January days');
        const days = [leave(CEA, d), leave(CEA, e), leave(CEA, f)];
        const moved = [AL(CEA, d, { leaveYear: YEAR - 1 }), AL(CEA, e, { leaveYear: YEAR - 1 }), AL(CEA, f, { leaveYear: YEAR - 1 })];
        const all = compare(CEA, days, moved, { sheet: { carriedForward: 3, used: 3 } });
        assert.deepEqual(all.days.map((/** @type {any} */ x) => x.state), ['carried', 'carried', 'carried']);
        assert.equal(all.carried, 3);
        assert.equal(all.allowanceDiffers, false, 'the carried days come off the sheet’s allowance before it is compared');
        assert.equal(all.figuresGap, 0);
        assert.equal(all.needsALook, false);
        // Only as many as the sheet carries: one forward, three moved — the earliest is carried, two differ.
        const one = compare(CEA, days, moved, { sheet: { carriedForward: 1, used: 3 } });
        assert.deepEqual(one.days.map((/** @type {any} */ x) => x.state), ['carried', 'other-year', 'other-year']);
        assert.equal(one.needsALook, true);
        // And the carry with nothing moved: the sheet allows more, and says so.
        const none = compare(CEA, days, [AL(CEA, d), AL(CEA, e), AL(CEA, f)], { sheet: { carriedForward: 3, used: 3 } });
        assert.deepEqual([none.carried, none.allowanceDiffers], [0, true]);
    });

    test('only a day moved BACK is carried — a next-January day the app leaves on its own year is not', () => {
        // The sheet's carry pays for days the app takes from LAST year. A day the app charges to NEXT
        // year is no part of it, whatever the sheet carries.
        const d = find(CEA, `${YEAR + 1}-01-01`, timed);
        assert.ok(d.startsWith(`${YEAR + 1}-01-`), `the case needs a next-January day, found ${d}`);
        const res = compare(CEA, [leave(CEA, d, { leaveYear: YEAR })], [AL(CEA, d)],
            { sheet: { carriedForward: 1, used: 1 }, lastDate: `${YEAR + 1}-01-31` });
        assert.deepEqual([res.days[0].state, res.days[0].appYear, res.carried], ['other-year', YEAR + 1, 0]);
        assert.equal(res.allowanceDiffers, true, 'the carried day is an allowance difference of its own');
    });

    test('differs: a shift, an absence or a rest day recorded instead of the leave', () => {
        const a = find(CEA, '2026-03-01', timed);
        const b = find(CEA, '2026-03-01', timed, [a]);
        const c = find(CEA, '2026-03-01', timed, [a, b]);
        const res = compare(CEA, [leave(CEA, a), leave(CEA, b), leave(CEA, c)],
            [rec(CEA, a, 'shift', '10:00-18:00'), rec(CEA, b, 'sick', 'SICK'), rec(CEA, c, 'correction', 'RD')]);
        assert.deepEqual([a, b, c].map(d => stateOf(res, d)), ['differs', 'differs', 'differs']);
        assert.deepEqual(res.days.map((/** @type {any} */ d) => d.app.type), ['shift', 'sick', 'correction']);
    });

    test('worked: RDW, an Other day or a Spare turn — work, pay evidence, never read as a mere difference', () => {
        const a = find(CEA, '2026-03-01', resting);
        const b = find(CEA, '2026-03-01', timed);
        const c = find(CEA, '2026-03-01', timed, [b]);
        const res = compare(CEA, [leave(CEA, a), leave(CEA, b), leave(CEA, c)],
            [rec(CEA, a, 'rdw', '08:00-16:00'), rec(CEA, b, 'other', 'TRG'), rec(CEA, c, 'spare_shift', 'SPARE')]);
        assert.deepEqual([a, b, c].map(d => stateOf(res, d)), ['worked', 'worked', 'worked']);
    });

    test('before-start: before the start date the app shows and counts NOTHING, whatever is stored there', () => {
        // Every surface suppresses a record dated before the start (calendar-renderer.js, Team Week,
        // the pay suggestions; Admin refuses to save one) — so a stray shift there is not a difference
        // the app shows, and must not be reported as one.
        const a = find(JOINER, '2026-08-01', any);
        const b = find(JOINER, '2026-08-01', any, [a]);
        const c = find(JOINER, '2026-08-01', any, [a, b]);
        for (const d of [a, b, c]) assert.ok(isBeforeMemberStart(JOINER, parseISODate(d)), `${d} is before the start`);
        const after = find(JOINER, '2026-09-21', timed);
        const res = compare(JOINER, [leave(JOINER, a), leave(JOINER, b), leave(JOINER, c), leave(JOINER, after)],
            [AL(JOINER, b), rec(JOINER, c, 'shift', '10:00-18:00')]);
        assert.equal(stateOf(res, a), 'before-start', 'nothing recorded');
        assert.equal(stateOf(res, b), 'before-start', 'leave recorded');
        assert.equal(stateOf(res, c), 'before-start', 'a shift recorded');
        assert.equal(stateOf(res, after), 'not-in-app', 'the control: after the start the day is an ordinary one');
    });

    test('sunday: a tag, or a plain name the sheet counts, with what the app holds and the pattern', () => {
        const s1 = findSunday(CEA, '2026-02-01', any);
        const s2 = findSunday(CEA, plus(s1, 1), any);
        const res = compare(CEA, [tag(CEA, s1), sundayCounted(CEA, s2)], [rec(CEA, s2, 'correction', 'RD')]);
        assert.equal(stateOf(res, s1), 'sunday');
        assert.equal(stateOf(res, s2), 'sunday');
        assert.equal(res.days[0].app, null);
        assert.equal(res.days[0].pattern, pat(CEA, s1));
        assert.deepEqual(res.days[1].app, { type: 'correction', value: 'RD', source: 'manual' });
        assert.deepEqual([res.days[0].kind, res.days[1].kind], ['sunday-tag', 'sunday-counted']);
    });

    test('and between them they reach EVERY state', () => {
        const seen = new Set();
        const w = find(CEA, '2026-04-01', timed);
        const r = find(CEA, '2026-04-01', resting);
        const [x, y, z, v, u] = [timed, timed, timed, resting, timed].reduce((/** @type {string[]} */ acc, want) =>
            [...acc, find(CEA, '2026-05-01', want, acc)], []);
        const j = find(CEA, `${YEAR}-01-02`, timed);
        const s = findSunday(CEA, '2026-04-01', any);
        const res = compare(CEA, [w, r, x, y, z, v, u, j].map(d => leave(CEA, d)).concat([tag(CEA, s)]),
            [AL(CEA, x), rec(CEA, y, 'shift', '10:00-18:00'), rec(CEA, z, 'rdw', '08:00-16:00'), AL(CEA, v), AL(CEA, j, { leaveYear: YEAR - 1 })]);
        for (const d of res.days) seen.add(d.state);
        seen.add(stateOf(compare(JOINER, [leave(JOINER, find(JOINER, '2026-08-01', any))]), find(JOINER, '2026-08-01', any)));
        seen.add(stateOf(compare(CEA, [leave(CEA, j)], [AL(CEA, j, { leaveYear: YEAR - 1 })], { sheet: { carriedForward: 1 } }), j));
        // A whole Spare week of leave: its fifth and sixth days are past the week's four (21 Nov 2026).
        const SPARE_CEA = { name: 'Spare Tester', rosterType: 'main', currentWeek: 1, role: 'CEA' };
        const week = ['2026-02-09', '2026-02-10', '2026-02-11', '2026-02-12', '2026-02-13', '2026-02-14'];
        // The sheet charging all six (its Used), the app four: a gap of exactly the two the rule explains.
        const spared = compare(SPARE_CEA, week.map(d => leave(SPARE_CEA, d)), week.map(d => AL(SPARE_CEA, d)), { sheet: { used: 6 } });
        assert.deepEqual(week.map(d => stateOf(spared, d)), ['match', 'match', 'match', 'match', 'spare-week', 'spare-week'],
            'premise: 9–14 Feb 2026 is the invented member\'s Spare week, and its last two days cost nothing');
        assert.equal(spared.needsALook, false, 'an explained difference, so not one that needs a look');
        assert.equal(spared.figuresGap, -2, 'premise: the sheet\'s balance is two lower');
        const unexplained = compare(SPARE_CEA, week.map(d => leave(SPARE_CEA, d)), week.map(d => AL(SPARE_CEA, d)), { sheet: { used: 7 } });
        assert.equal(unexplained.needsALook, true, 'a gap the rule does not explain still needs a look');
        seen.add('spare-week');
        assert.deepEqual([...seen].sort(), [...DAY_STATES].sort());
    });
});

describe('a Spare week a roster upload partly assigned (owner, 22 Nov 2026)', () => {
    test('its days past the four are the comparison’s own state, assigned or not — the cap follows the week as rostered', () => {
        const SPARE_CEA = { name: 'Spare Tester', rosterType: 'main', currentWeek: 1, role: 'CEA' };
        const week = ['2026-02-09', '2026-02-10', '2026-02-11', '2026-02-12', '2026-02-13', '2026-02-14'];
        // The Friday and Saturday were given named shifts by the upload, then booked off: their leave
        // records `replacedType: 'shift'`. The old rule charged them as shifts, a week of six.
        const recs = week.map((d, i) => AL(SPARE_CEA, d, i >= 4 ? { replacedType: 'shift' } : {}));
        const res = compare(SPARE_CEA, week.map(d => leave(SPARE_CEA, d)), recs, { sheet: { used: 6 } });
        assert.deepEqual(week.map(d => stateOf(res, d)), ['match', 'match', 'match', 'match', 'spare-week', 'spare-week']);
        assert.equal(res.figuresGap, -2, 'the app charges four, as for a week still Spare');
    });
});

describe('the no-record branch IS the Admin leave card’s own answer (projectAlBooking)', () => {
    test('date for date across eight months of two patterns and a joiner, with nothing recorded', () => {
        for (const m of [CEA, CES, JOINER]) {
            const dates = [];
            for (let d = '2026-02-01'; d <= '2026-10-31'; d = plus(d, 1)) if (!isSunday(d)) dates.push(d);
            const res = compare(m, dates.map(d => leave(m, d)));
            const tally = /** @type {Record<string, number>} */ ({});
            for (const d of dates) {
                const p = projectAlBooking({ member: m, dates: [d], ovByDate: new Map() });
                const want = p.asked.includes(d) ? 'rest-day'
                    : p.consuming.includes(d) ? 'not-in-app'
                    : isBeforeMemberStart(m, parseISODate(d)) ? 'before-start' : `unexpected (${JSON.stringify(p.counts)})`;
                assert.equal(stateOf(res, d), want, `${m.name} ${d} (${pat(m, d)})`);
                tally[want] = (tally[want] ?? 0) + 1;
            }
            // Not a vacuous agreement: each pattern really has both kinds of day in the window.
            assert.ok(tally['rest-day'] > 10 && tally['not-in-app'] > 10, `${m.name} ${JSON.stringify(tally)}`);
            if (m === JOINER) assert.ok(tally['before-start'] > 50, JSON.stringify(tally));
        }
    });
});

describe('the record that wins the day is resolved first', () => {
    test('a manual record beats a roster import, even when the import is newer and listed last', () => {
        const a = find(CEA, '2026-06-01', timed);
        const b = find(CEA, '2026-06-01', timed, [a]);
        const res = compare(CEA, [leave(CEA, a), leave(CEA, b)], [
            AL(CEA, a), rec(CEA, a, 'shift', '10:00-18:00', { source: 'roster_import' }),
            rec(CEA, b, 'shift', '10:00-18:00'), AL(CEA, b, { source: 'roster_import' }),
        ]);
        assert.equal(stateOf(res, a), 'match', 'manual leave over a newer imported shift');
        assert.equal(stateOf(res, b), 'differs', 'a manual shift over newer imported leave');
    });

    test('an orphaned leave copy beside a NEWER shift loses, whichever order the records arrive in', () => {
        const d = find(CEA, '2026-06-01', timed);
        const older = AL(CEA, d);
        const newer = rec(CEA, d, 'shift', '10:00-18:00');
        for (const records of [[older, newer], [newer, older]]) {
            assert.equal(stateOf(compare(CEA, [leave(CEA, d)], records), d), 'differs');
        }
    });

    test('another member’s records are no part of this member’s day, nor of their figures', () => {
        const d = find(CEA, '2026-06-01', timed);
        const res = compare(CEA, [leave(CEA, d)], [AL(CES, d), AL(CES, plus(d, 1))]);
        assert.equal(stateOf(res, d), 'not-in-app');
        assert.deepEqual(res.app, { ...alPosition({ overrides: [], member: CEA, year: YEAR, todayStr: TODAY }), note: null });
        assert.deepEqual(res.appOnly, []);
    });

    test('winnersByDate keeps one record per date, for the named member, and skips what is not a record', () => {
        const d = find(CEA, '2026-06-01', timed);
        const mine = AL(CEA, d);
        const w = winnersByDate(/** @type {any} */ ([null, { memberName: CEA.name }, AL(CES, d), mine]), CEA.name);
        assert.deepEqual([...w.keys()], [d]);
        assert.equal(w.get(d), mine);
        assert.equal(winnersByDate(/** @type {any} */ (undefined), CEA.name).size, 0);
    });
});

describe('app-only leave: its own pass, inside the sheet’s dates only', () => {
    test('leave the sheet lacks is listed, with the year whose allowance it costs — or none', () => {
        const onSheet = find(CEA, '2026-07-01', timed);
        const working = find(CEA, '2026-07-01', timed, [onSheet]);
        const rest = find(CEA, '2026-07-01', resting);
        const movedBack = find(CEA, `${YEAR}-01-02`, timed);
        const beaten = find(CEA, '2026-07-01', timed, [onSheet, working]);
        const res = compare(CEA, [leave(CEA, onSheet)], [
            AL(CEA, onSheet), AL(CEA, working), AL(CEA, rest), AL(CEA, movedBack, { leaveYear: YEAR - 1 }),
            AL(CEA, beaten), rec(CEA, beaten, 'shift', '10:00-18:00'),
            AL(CEA, `${YEAR - 1}-12-31`), AL(CEA, `${YEAR + 1}-01-04`),
        ]);
        assert.deepEqual(res.appOnly, [
            { date: movedBack, chargedTo: YEAR - 1, source: 'manual' },   // it comes out of LAST year's allowance
            ...[{ date: working, chargedTo: YEAR, source: 'manual' }, { date: rest, chargedTo: null, source: 'manual' }]
                .sort((p, q) => p.date.localeCompare(q.date)),
        ]);
        assert.equal(stateOf(res, onSheet), 'match');
        assert.equal(res.counts['app-only'], 3);
    });

    test('next January inside the sheet: a day charged to this year is listed; one left on its own year is next year’s', () => {
        const d1 = find(CEA, `${YEAR + 1}-01-02`, timed);
        const d2 = find(CEA, `${YEAR + 1}-01-02`, timed, [d1]);
        assert.ok(d2.startsWith(`${YEAR + 1}-01-`), `the case needs January days, found ${d1}, ${d2}`);
        const res = compare(CEA, [], [AL(CEA, d1, { leaveYear: YEAR }), AL(CEA, d2)], { lastDate: `${YEAR + 1}-01-31` });
        assert.deepEqual(res.appOnly.map((/** @type {any} */ a) => [a.date, a.chargedTo]), [[d1, YEAR]]);
        // Left on its own year it is next year's leave, for next year's sheet: no difference here, and
        // no reason to look — it put everybody who booked January in December under "Needs a look"
        // (review, 15 Nov 2026).
        const own = compare(CEA, [], [AL(CEA, d2)], { lastDate: `${YEAR + 1}-01-31` });
        assert.deepEqual(own.appOnly, []);
        assert.equal(own.needsALook, false);
        // And with the sheet's own last date, neither is inside it.
        assert.deepEqual(compare(CEA, [], [AL(CEA, d1, { leaveYear: YEAR })]).appOnly, []);
    });

    test('a record no surface shows is not app-only leave: on a Sunday, or before the start date', () => {
        const sun = findSunday(CEA, '2026-07-01', any);
        const sunday = compare(CEA, [], [AL(CEA, sun)]);
        assert.deepEqual(sunday.appOnly, []);
        assert.equal(sunday.needsALook, false);
        const early = find(JOINER, '2026-08-01', any);
        assert.ok(isBeforeMemberStart(JOINER, parseISODate(early)), `premise: ${early} is before the start`);
        assert.deepEqual(compare(JOINER, [], [AL(JOINER, early)]).appOnly, []);
        // A weekday rest day IS drawn (leave that costs nothing), so it stays a difference to look at.
        const rest = find(CEA, '2026-07-01', resting);
        assert.deepEqual(compare(CEA, [], [AL(CEA, rest)]).appOnly.map((/** @type {any} */ a) => [a.date, a.chargedTo]), [[rest, null]]);
    });

    test('nor is leave on Christmas Day or Boxing Day: the sheet marks both Closed, and neither side counts it', () => {
        // A stored record there was listed, while the same leave shown from the pattern was not.
        const xmas = [`${YEAR}-12-25`, `${YEAR}-12-26`];
        const res = compare(CEA, [], xmas.map(d => AL(CEA, d)));
        assert.deepEqual(res.appOnly, []);
        assert.equal(res.needsALook, false);
        assert.equal(res.app.taken + res.app.booked, 0, 'premise: the app counts neither day');
    });

    test('app-only leave alone is enough for somebody to look', () => {
        const d = find(CEA, '2026-07-01', timed);
        const e = find(CEA, '2026-07-01', timed, [d]);
        const res = compare(CEA, [leave(CEA, d)], [AL(CEA, d), AL(CEA, e)]);
        assert.equal(stateOf(res, d), 'match');
        assert.equal(res.needsALook, true);
        // (The sheet's Used counts its one grid day, as a real sheet's must, so its figure agrees.)
        assert.equal(compare(CEA, [leave(CEA, d)], [AL(CEA, d)], { sheet: { used: 1 } }).needsALook, false);
    });
});

describe('the figures are the app’s own', () => {
    test('`app` is alPosition over the member’s own records', () => {
        const a = find(CEA, '2026-03-01', timed);
        const b = find(CEA, '2026-11-20', timed);
        const own = [AL(CEA, a), AL(CEA, b), rec(CEA, plus(a, 1), 'sick', 'SICK')];
        const res = compare(CEA, [leave(CEA, a)], [...own, AL(CES, a)]);
        assert.deepEqual(res.app, { ...alPosition({ overrides: own, member: CEA, year: YEAR, todayStr: TODAY }),
                                    note: entitlementNote({ member: CEA, year: YEAR, overrides: own }) });
        assert.deepEqual([res.app.taken, res.app.booked], [1, 1]);
        // A Dispatcher's figure carries the app's own breakdown — the words Admin's banner uses.
        assert.equal(compare(DISP, []).app.note, entitlementNote({ member: DISP, year: YEAR, overrides: [] }));
        assert.match(String(compare(DISP, []).app.note), /for bank holidays worked/);
    });

    test('an allowance difference reads the sheet as the clerks write it: carried forward on, a joiner’s reduction off', () => {
        assert.equal(entitlementFor(CEA, YEAR), 32);
        assert.equal(compare(CEA, []).allowanceDiffers, false);
        assert.equal(compare(CEA, [], [], { sheet: { carriedForward: 2 } }).allowanceDiffers, true);
        // A joiner the clerks pro-rate in column E: 32 printed, 23 off, 9 — the app's own joining figure.
        assert.equal(entitlementFor(JOINER, YEAR), 9);
        assert.equal(compare(JOINER, [], [], { sheet: { allowance: 32, columnE: 23, joinerReduction: 23 } }).allowanceDiffers, false);
        assert.equal(compare(JOINER, [], [], { sheet: { allowance: 32 } }).allowanceDiffers, true);
        // A Dispatcher's days in lieu for bank holidays worked put the app above the sheet's 22.
        assert.ok(/** @type {number} */ (entitlementFor(DISP, YEAR)) > 22, 'the case needs a Dispatcher line that works a bank holiday');
        assert.equal(compare(DISP, [], [], { sheet: { allowance: 22 } }).allowanceDiffers, true);
        // No totals row: no sheet figures, so nothing to differ.
        const noRow = compare(DISP, [], [], { person: noRowPerson(DISP) });
        assert.equal(noRow.sheet, null);
        assert.equal(noRow.allowanceDiffers, false);
    });

    test('the sheet’s own figures travel, with the corrected remaining and the undated days', () => {
        const res = compare(CEA, [], [], { sheet: { used: 20, columnE: 3, lump: 1, unexplained: 2, corrected: 8, rows: 2 } });
        assert.deepEqual(res.sheet, { allowance: 32, carriedForward: 0, used: 20, columnE: 3, remaining: 9, corrected: 8,
                                      undated: 3, joinerReduction: 0 });
        assert.equal(res.otherRows, 1);
        assert.deepEqual(res.otherCarry, [], 'a second row with the same figures says nothing more');
    });

    test('another row carrying a different number of days forward is passed on, never resolved (review, 15 Nov 2026)', () => {
        const person = sheetPerson(CEA, { rows: 2 });
        person.sheetRows[1] = { ...person.sheetRows[1], why: 'duplicate-stale', printed: { ...person.sheetRows[1].printed, carriedForward: 2 } };
        const res = compare(CEA, [], [], { person });
        assert.deepEqual(res.otherCarry, [2]);
        assert.equal(res.sheet?.carriedForward, 0, 'the row with their days is still the one used');
    });

    test('needsALook: every state that wants a look sets it on its own; agreement and a Sunday do not', () => {
        const w = find(CEA, '2026-09-01', timed);
        const r = find(CEA, '2026-09-01', resting);
        const j = find(CEA, `${YEAR}-01-02`, timed);
        const s = findSunday(CEA, '2026-09-01', any);
        const cases = /** @type {Array<[string, any]>} */ ([
            ['not-in-app', compare(CEA, [leave(CEA, w)])],
            ['rest-day', compare(CEA, [leave(CEA, r)])],
            ['free-in-app', compare(CEA, [leave(CEA, r)], [AL(CEA, r)])],
            ['other-year', compare(CEA, [leave(CEA, j)], [AL(CEA, j, { leaveYear: YEAR - 1 })])],
            ['differs', compare(CEA, [leave(CEA, w)], [rec(CEA, w, 'sick', 'SICK')])],
            ['worked', compare(CEA, [leave(CEA, w)], [rec(CEA, w, 'other', 'TRG')])],
            // The joiner's sheet allowance is their joining figure, so the allowances agree and only the day speaks.
            ['before-start', compare(JOINER, [leave(JOINER, find(JOINER, '2026-08-01', any))], [], { sheet: { allowance: 9 } })],
        ]);
        for (const [state, res] of cases) {
            assert.equal(res.days[0].state, state);
            assert.equal(res.counts[state], 1, state);
            assert.equal(res.needsALook, true, state);
        }
        assert.deepEqual(cases.map(([s]) => s).sort(), [...NEEDS_A_LOOK].sort());
        assert.equal(compare(CEA, [leave(CEA, w)], [AL(CEA, w)], { sheet: { used: 1 } }).needsALook, false, 'match');
        assert.equal(compare(CEA, [tag(CEA, s)]).needsALook, false, 'sunday');
    });
});

describe('"agree" means the figures agree', () => {
    /**
     * The gap between the sheet's corrected figure and the app's, from the reasons the card names —
     * the module header's claim, in arithmetic. Every leave day on the sheet the app does not count
     * against this year is one of NEEDS_A_LOOK (or carried, which comes off the allowance instead).
     * @param {any} res
     */
    const fromReasons = res => {
        const s = res.sheet;
        const look = NEEDS_A_LOOK.reduce((n, k) => n + res.counts[k], 0);
        return (s.carriedForward - res.carried + s.allowance - s.joinerReduction - res.app.entitlement)
            - s.undated - look + res.appOnly.filter((/** @type {any} */ a) => a.chargedTo === YEAR).length + res.beyond.length;
    };
    /** A sheet whose figures follow from its days, as a real one's must (al-leave-file.js `personSums`). */
    const consistent = (/** @type {any} */ m, /** @type {any[]} */ days, /** @type {Record<string, number>} */ o = {}) => {
        const grid = days.filter(d => d.foundIn === 'grid').length;
        const sundays = days.filter(d => d.kind === 'sunday-counted').length;
        const { allowance = 32, carriedForward = 0, lump = 0, unexplained = 0, joinerReduction = 0 } = o;
        const columnE = lump + unexplained + joinerReduction;
        // The corrected figure gives back a Sunday the sheet counts (`personSums`).
        const corrected = carriedForward + allowance - grid - columnE + sundays;
        return sheetPerson(m, { allowance, carriedForward, used: grid, columnE, lump, unexplained, joinerReduction, corrected });
    };

    test('undated over-quota days alone put somebody under "Needs a look" — the sheet leaves fewer days than the app', () => {
        // The first cut filed this person under "Agree with the app" with "Sheet: 27 left · App: 29 left"
        // on the same closed row (review, 14 Nov 2026). AL_WORKBOOK.md §0: over-quota days are real leave.
        const res = compare(CEA, [], [], { sheet: { columnE: 2, unexplained: 2 } });
        assert.equal(res.counts.undated, 2);
        assert.equal(res.figuresGap, -2);
        assert.equal(res.needsALook, true);
        assert.equal(res.counts.figures, 0, 'a named reason, so no fallback');
    });

    test('a January day after the sheet ends, taken from this year in the app, is listed and needs a look', () => {
        // The leave-year panel offers next January now; the sheet stops on its last date (here 2 Jan),
        // and alPosition counts the day against this year — so the two figures part by it.
        const d = find(CEA, `${YEAR + 1}-01-04`, timed);
        assert.ok(d.startsWith(`${YEAR + 1}-01-`) && d > LAST, `the case needs a January day after the sheet ends, found ${d}`);
        const res = compare(CEA, [], [AL(CEA, d, { leaveYear: YEAR })]);
        assert.deepEqual(res.beyond, [d]);
        assert.deepEqual(res.appOnly, [], 'it is outside the sheet’s dates, so not app-only');
        assert.equal(res.counts.beyond, 1);
        assert.equal(res.figuresGap, 1);
        assert.equal(res.needsALook, true);
        assert.equal(res.counts.figures, 0, 'a named reason — not "figures differ, nothing shows why"');
        // Left on its own year, it costs this year nothing, and is not listed.
        assert.deepEqual(compare(CEA, [], [AL(CEA, d)]).beyond, []);
    });

    test('ONE of any reason is a reason: a single app-only day, a single undated day, an allowance alone — never the fallback', () => {
        // Each of these used to be caught only by the safety net below when there was exactly one of it, so a
        // threshold of "more than one" read as "figures differ, nothing shows why" over a reason the card names.
        const d = find(CEA, '2026-07-01', timed);
        const e = find(CEA, '2026-07-01', timed, [d]);
        const appOnly = compare(CEA, [leave(CEA, d)], [AL(CEA, d), AL(CEA, e)], { sheet: { used: 1 } });
        const undated = compare(CEA, [], [], { sheet: { columnE: 1, unexplained: 1 } });
        const allowance = compare(CEA, [], [], { sheet: { allowance: 33 } });
        for (const [what, res, key] of /** @type {Array<[string, any, string|null]>} */ ([
            ['one app-only day', appOnly, 'app-only'], ['one undated day', undated, 'undated'], ['the allowance alone', allowance, null]])) {
            if (key) assert.equal(res.counts[key], 1, `${what}: premise`);
            else assert.equal(res.allowanceDiffers, true, `${what}: premise`);
            assert.notEqual(res.figuresGap, 0, `${what}: premise — the figures part by it`);
            assert.equal(res.needsALook, true, what);
            assert.equal(res.counts.figures, 0, `${what} is a named reason, not "nothing shows why"`);
        }
    });

    test('the safety net: figures that differ for no reason the card names still need a look, and say so', () => {
        // Unreachable through a sealed file whose sums hold — so it is built by hand.
        const res = compare(CEA, [], [], { sheet: { corrected: 31 } });
        assert.equal(res.figuresGap, -1);
        assert.equal(res.counts.figures, 1);
        assert.equal(res.needsALook, true);
        // And never with a named reason beside it: the fallback is for the gap nothing else explains.
        const named = compare(CEA, [leave(CEA, find(CEA, '2026-03-01', timed))], [], { sheet: { used: 1 } });
        assert.equal(named.counts.figures, 0);
    });

    test('the gap IS the sum of the named reasons, across a sheet with every kind at once', () => {
        const w = [0, 1, 2, 3].reduce((/** @type {string[]} */ acc) => [...acc, find(CEA, '2026-03-01', timed, acc)], []);
        const r = find(CEA, '2026-03-01', resting);
        const j = find(CEA, `${YEAR}-01-02`, timed);
        const after = find(CEA, `${YEAR + 1}-01-04`, timed);
        const extra = find(CEA, '2026-06-01', timed, w);
        const sun = findSunday(CEA, '2026-04-01', any);
        const days = [leave(CEA, w[0]), leave(CEA, w[1]), leave(CEA, w[2]), leave(CEA, w[3]), leave(CEA, r), leave(CEA, j), sundayCounted(CEA, sun)];
        const records = [AL(CEA, w[0]), rec(CEA, w[1], 'sick', 'SICK'), rec(CEA, w[2], 'rdw', '08:00-16:00'), AL(CEA, r),
            AL(CEA, j, { leaveYear: YEAR - 1 }), AL(CEA, after, { leaveYear: YEAR }), AL(CEA, extra)];
        for (const o of [{}, { carriedForward: 1 }, { carriedForward: 3, unexplained: 2 }, { lump: 1 }]) {
            const person = consistent(CEA, days, o);
            const res = compare(CEA, days, records, { person });
            assert.equal(res.figuresGap, fromReasons(res), JSON.stringify(o));
            assert.equal(res.figuresGap, res.sheet.corrected - res.app.remaining);
            assert.equal(res.counts.figures, 0, `every part of the gap is named (${JSON.stringify(o)})`);
            assert.equal(res.needsALook, true);
        }
        // And a person who truly agrees: nothing named, no gap.
        const agree = compare(CEA, [leave(CEA, w[0])], [AL(CEA, w[0])], { person: consistent(CEA, [leave(CEA, w[0])]) });
        assert.deepEqual([agree.figuresGap, agree.needsALook], [0, false]);
    });
});

describe('what the app SHOWS on a day is what the Calendar draws (resolveDayShift)', () => {
    test('a record no surface draws leaves the pattern: leave on a Sunday, an absence on a rest day', () => {
        const sun = findSunday(CEA, '2026-02-01', timed);
        const rest = find(CEA, '2026-02-01', resting);
        const res = compare(CEA, [tag(CEA, sun), leave(CEA, rest)], [AL(CEA, sun), rec(CEA, rest, 'sick', 'SICK')]);
        const s = res.days.find((/** @type {any} */ d) => d.date === sun);
        const r = res.days.find((/** @type {any} */ d) => d.date === rest);
        assert.deepEqual(s.drawn, { shift: pat(CEA, sun), rdwTime: '', fromPattern: true, type: null });
        assert.equal(r.state, 'differs');
        assert.equal(r.drawn.fromPattern, true, 'an absence on a rest day is never drawn');
    });

    test('an old timed shift on a Sunday is drawn as rest day working, and an absence on a working day as itself', () => {
        const sun = findSunday(CEA, '2026-02-01', any);
        const w = find(CEA, '2026-02-01', timed);
        const res = compare(CEA, [tag(CEA, sun), leave(CEA, w)], [rec(CEA, sun, 'shift', '08:00-16:00'), rec(CEA, w, 'sick', 'SICK')]);
        const s = res.days.find((/** @type {any} */ d) => d.date === sun);
        assert.deepEqual([s.drawn.shift, s.drawn.rdwTime, s.drawn.fromPattern], ['RDW', '08:00-16:00', false]);
        const a = res.days.find((/** @type {any} */ d) => d.date === w);
        assert.deepEqual([a.drawn.shift, a.drawn.fromPattern, a.drawn.type], ['SICK', false, 'sick']);
    });

    test('before the start date nothing recorded is drawn', () => {
        const early = find(JOINER, '2026-08-01', any);
        const res = compare(JOINER, [leave(JOINER, early)], [rec(JOINER, early, 'shift', '10:00-18:00')], { sheet: { allowance: 9 } });
        assert.deepEqual([res.days[0].state, res.days[0].drawn.fromPattern], ['before-start', true]);
    });
});

describe('who can be checked at all (leaveRecordability)', () => {
    test('a member the app can record leave for: null', () => {
        assert.equal(leaveRecordability(CEA, YEAR), null);
        assert.equal(leaveRecordability(DISP, YEAR), null);
        assert.equal(leaveRecordability(JOINER, YEAR), null);
    });
    test('a manager is a manager, never a leaver — though Management is hidden too', () => {
        assert.equal(leaveRecordability(MANAGER, YEAR), 'manager');
        assert.equal(leaveRecordability({ ...MANAGER, managerOnly: false }, YEAR), 'manager');
        // A login-only account with no figure on record that year: hidden like a leaver, and still a manager.
        assert.equal(leaveRecordability({ ...CEA, hidden: true, managerOnly: true, startDate: new Date(YEAR + 1, 0, 4) }, YEAR), 'manager');
    });
    test('the YEAR decides, not today’s grade: a member who moved into Management is checked for the year they moved in', () => {
        // Invented: a CES up to and including Saturday 21 November 2026, a manager from the Sunday — and
        // so hidden and managerOnly now, as every manager is. 2026 is judged by the graded post held in it.
        /** @type {any} */ const PROMOTED = { name: 'G. Example', role: 'Management', rosterType: 'ces', currentWeek: 2,
            hidden: true, managerOnly: true, roleHistory: [{ role: 'CES', until: new Date(2026, 10, 21) }] };
        assert.equal(entitlementFor(PROMOTED, 2026), 34, 'the case: the app holds a 2026 allowance for them');
        assert.equal(leaveRecordability(PROMOTED, 2026), null, 'their 2026 leave is checked — not "a manager", not "a leaver"');
        assert.equal(entitlementFor(PROMOTED, 2027), null, 'the case: no graded post in 2027');
        assert.equal(leaveRecordability(PROMOTED, 2027), 'manager');
        // The flag is today's too: a login-only account the app holds an allowance for is checked, never a leaver.
        assert.equal(leaveRecordability({ ...CEA, hidden: true, managerOnly: true }, YEAR), null);
    });
    test('a leaver, somebody not on the roster, and somebody with no allowance that year', () => {
        assert.equal(leaveRecordability(LEAVER, YEAR), 'leaver');
        assert.equal(leaveRecordability(undefined, YEAR), 'not-in-app');
        assert.equal(leaveRecordability({ ...CEA, role: 'Trainee' }, YEAR), 'no-allowance');
        // An Other Staff login is hidden like a leaver, but is not one (owner, 23 Nov 2026).
        assert.equal(leaveRecordability({ ...CEA, role: 'Other Staff', hidden: true, otherStaff: true }, YEAR), 'no-allowance');
        assert.equal(leaveRecordability({ ...CEA, startDate: new Date(YEAR + 1, 0, 4) }, YEAR), 'no-allowance');
    });
});

describe('the whole file, ordered and totalled as the card shows it', () => {
    /** @param {any[]} people @param {any[]} days */
    const fileOf = (people, days) => ({
        format: LEAVE_FILE_FORMAT, version: LEAVE_FILE_VERSION, year: YEAR,
        source: { sha256: 'a'.repeat(64), firstDate: FIRST, lastDate: LAST, clerksLastSaved: null, lastSavedByClerk: null },
        made: { on: TODAY, script: 'test', appVersion: 'test' }, nameMap: { rows: {}, cells: {}, tags: {} },
        people, days, absentFromWorkbook: ['Z. Example', 'H. Example'],
        notImported: [{ name: 'E. Example', reason: 'leaver' }, { name: 'J. Example', reason: 'no-allowance' }, { name: 'Y. Example', reason: 'leaver' }],
        unplacedSundayTags: 0,
    });

    test('people needing a look first, then by name; the rest as the roster has them now', () => {
        const matchDay = find(CEA, '2026-05-01', timed);
        const cesDay = find(CES, '2026-05-01', timed);
        /** @type {any} */ const NEWCOMER = { name: 'G. Example', role: 'CEA', rosterType: 'main', currentWeek: 4 };
        /** @type {any} */ const GONE = { name: 'H. Example', role: 'CEA', rosterType: 'main', currentWeek: 5, hidden: true };
        /** @type {any} */ const STILL_HERE = { name: 'Z. Example', role: 'CEA', rosterType: 'main', currentWeek: 6 };
        /** Left out of the file for having no allowance then — and given one since. */
        /** @type {any} */ const NOW_ALLOWED = { name: 'J. Example', role: 'CEA', rosterType: 'main', currentWeek: 7 };
        // A's sheet counts its one grid day (a real sheet's Used must), so A's figures agree.
        const people = [sheetPerson(CEA, { used: 1 }), sheetPerson(DISP, { allowance: 22 }), sheetPerson(CES), sheetPerson(LEAVER),
            { ...sheetPerson(CEA), name: 'X. Example' }];
        const file = fileOf(people, [leave(CEA, matchDay), leave(CES, cesDay)]);
        const result = compareLeaveFile({
            file, members: [CEA, CES, DISP, LEAVER, MANAGER, NEWCOMER, GONE, STILL_HERE, NOW_ALLOWED],
            recordsByName: new Map([[CEA.name, [AL(CEA, matchDay)]]]), todayStr: TODAY,
        });
        // B (a day not in the app) and C (an allowance that differs) need a look; A agrees.
        assert.deepEqual(result.people.map(p => [p.name, p.needsALook]),
            [['B. Example', true], ['C. Example', true], ['A. Example', false]]);
        assert.deepEqual(result.notChecked, [{ name: 'E. Example', reason: 'leaver' }, { name: 'X. Example', reason: 'not-in-app' }]);
        // The file's own lists are asked again of TODAY's roster (review, 14 Nov 2026): a leaver stays a
        // leaver, one given an allowance since is `since`, and one gone from the roster is not in the app.
        assert.deepEqual(result.notInFile, [{ name: 'E. Example', reason: 'leaver' }, { name: 'J. Example', reason: 'since' },
            { name: 'Y. Example', reason: 'not-in-app' }]);
        // What the file said, kept only for somebody the app can still record leave for (H. Example has
        // left since), plus a recordable member added since — never a manager, a leaver, or somebody
        // the file already lists.
        assert.deepEqual(result.absent, ['G. Example', 'Z. Example']);
        assert.equal(result.totals.people, 3);
        assert.equal(result.totals.needsALook, 2);
        for (const s of COUNT_KEYS) {
            assert.equal(result.totals[s], result.people.reduce((n, p) => n + p.counts[s], 0), s);
        }
        assert.deepEqual([result.totals.match, result.totals['not-in-app']], [1, 1]);
    });

    test('each person is compared with their OWN records only', () => {
        const d = find(CEA, '2026-05-01', timed);
        const file = fileOf([sheetPerson(CEA), sheetPerson(CES)], [leave(CEA, d), leave(CES, d)]);
        const result = compareLeaveFile({ file, members: [CEA, CES], recordsByName: new Map([[CES.name, [AL(CEA, d)]]]), todayStr: TODAY });
        const a = /** @type {any} */ (result.people.find(p => p.name === CEA.name));
        assert.equal(a.days[0].state, 'not-in-app', 'CEA’s records were not handed to CEA');
    });

    test('a person’s days come out in date order, whatever order the file lists them in', () => {
        // The file's checks (validateLeaveFile) do not require its days in order, so the card's must.
        const early = find(CEA, '2026-03-01', timed);
        const sunday = findSunday(CEA, '2026-06-01', any);
        const late = find(CEA, '2026-10-01', timed);
        const file = fileOf([sheetPerson(CEA)], [leave(CEA, late), tag(CEA, sunday), leave(CEA, early)]);
        const result = compareLeaveFile({ file, members: [CEA], recordsByName: new Map(), todayStr: TODAY });
        assert.deepEqual(/** @type {any} */ (result.people[0]).days.map((/** @type {any} */ d) => d.date), [early, sunday, late]);
    });
});
