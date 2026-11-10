// @ts-check
/**
 * christmas-leave.test.mjs — CHRISTMAS DAY AND BOXING DAY (v25.37, the owner's rules of 5 Nov 2026).
 * Run: node scripts/run-tests.mjs christmas-leave.test.mjs   (part of `npm run test:hygiene`)
 *
 * Organised by what a wrong answer COSTS, because none of these failures is loud:
 *
 *   · A DAY COUNTED THAT SHOULD NOT BE — leave taken off somebody's allowance for a day the station
 *     was closed. The balance still renders, and somebody plans the rest of their year against it.
 *   · A DAY IN LIEU MISSED OR DOUBLED — the earned day left out of the allowance by a surface that
 *     reads the contract figure directly, or a Dispatcher given it twice because their bank-holiday
 *     rule had already counted the day.
 *   · A DAY SHOWN WRONGLY — leave drawn over work somebody recorded, or the leave records and the
 *     calendar disagreeing about which days were leave.
 *
 * Against the REAL roster, so "due at work" is the pattern the station actually runs and not a
 * fixture somebody wrote to agree with the code.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { teamMembers, getBaseShift, getPatternShift, getALEntitlement, isWorkedShift, formatISO } from './roster-data.js';
import { resolveEffectiveShift } from './override-utils.js';
import {
    CHRISTMAS_LEAVE_FROM_YEAR, isChristmasLeaveDay, isChristmasClosureDate, boxingDayLieuDays,
    resolveDayShift, christmasLeaveDates, christmasLeaveByYear, christmasLeaveLine, isUncountedChristmasLeave,
} from './christmas-leave.js';
import {
    entitlementFor, alPosition, dispatcherBreakdown, entitlementNote, consumesEntitlement, countedAlDates,
} from './al-entitlement.js';

const ACTIVE = teamMembers.filter(m => !m.hidden && !m.managerOnly);
const XMAS_2026   = new Date(2026, 11, 25);   // a Friday, and a bank holiday
const BOXING_2026 = new Date(2026, 11, 26);   // a Saturday — NOT a bank holiday (Monday 28th is)
const BOXING_2028 = new Date(2028, 11, 26);   // a Tuesday, and a bank holiday

/** The roster PATTERN had the member at work: a shift or a spare day. */
const patternDue = (/** @type {any} */ m, /** @type {Date} */ d) => {
    const p = getPatternShift(m, d);
    return p !== 'RD' && p !== 'OFF';
};

const CEA = ACTIVE.find(m => m.role === 'CEA' && !m.startDate && !m.proRatedAL
    && patternDue(m, XMAS_2026) && patternDue(m, BOXING_2026));
const RESTER = ACTIVE.find(m => m.role === 'CEA' && !m.startDate && !patternDue(m, BOXING_2026));
const DISP_2026 = ACTIVE.find(m => m.role === 'Dispatcher' && !m.proRatedAL && patternDue(m, BOXING_2026));
const DISP_2028 = ACTIVE.find(m => m.role === 'Dispatcher' && !m.proRatedAL && patternDue(m, BOXING_2028));

/** Ascending timestamps, so "the newer document wins" is something a test can arrange. */
let clock = 1_800_000_000;
const ov = (/** @type {any} */ m, /** @type {string} */ date, /** @type {string} */ type,
            /** @type {string} */ value, extra = {}) =>
    ({ memberName: m.name, date, type, value, createdAt: { seconds: ++clock }, ...extra });

test('the fixtures exist on the real roster — otherwise every test below is checking nothing', () => {
    assert.ok(CEA, 'needs a CEA due at work on both days in 2026');
    assert.ok(RESTER, 'needs a CEA whose pattern rests on Boxing Day 2026');
    assert.ok(DISP_2026, 'needs a Dispatcher due on Boxing Day 2026');
    assert.ok(DISP_2028, 'needs a Dispatcher due on Boxing Day 2028');
    assert.equal(XMAS_2026.getDay(), 5);
    assert.equal(BOXING_2026.getDay(), 6);
});

describe('who is on Christmas leave — the pattern decides, and nothing else changes', () => {
    test('due at work by the pattern, on either day from 2026: a shift OR a spare day', () => {
        for (const m of ACTIVE) {
            for (const d of [XMAS_2026, BOXING_2026]) {
                assert.equal(isChristmasLeaveDay(m, d), patternDue(m, d), `${m.name} ${formatISO(d)}`);
            }
        }
    });

    test('a spare day counts as due at work (owner, 5 Nov 2026)', () => {
        // Found on the real roster rather than invented: some December within reach has somebody
        // spare on one of the two days.
        let found = null;
        for (let y = 2026; y <= 2030 && !found; y++) {
            for (const day of [25, 26]) {
                const d = new Date(y, 11, day);
                if (d.getDay() === 0) continue;
                const m = ACTIVE.find(x => getPatternShift(x, d) === 'SPARE');
                if (m) { found = { m, d }; break; }
            }
        }
        assert.ok(found, 'no spare day on 25/26 December in 2026–2030 — the fixture needs another year');
        assert.equal(isChristmasLeaveDay(found.m, found.d), true);
    });

    test('never on a Sunday — 26 December 2027 is one, so nobody has it', () => {
        const d = new Date(2027, 11, 26);
        assert.equal(d.getDay(), 0);
        assert.equal(ACTIVE.filter(m => isChristmasLeaveDay(m, d)).length, 0);
        // …while the Saturday before it is a real Christmas leave day for somebody.
        assert.ok(ACTIVE.some(m => isChristmasLeaveDay(m, new Date(2027, 11, 25))));
    });

    test('never before Christmas 2026 — earlier years keep showing Rest, as they always did', () => {
        assert.equal(CHRISTMAS_LEAVE_FROM_YEAR, 2026);
        for (const m of ACTIVE) {
            assert.equal(isChristmasLeaveDay(m, new Date(2025, 11, 25)), false, m.name);
            assert.equal(isChristmasLeaveDay(m, new Date(2025, 11, 26)), false, m.name);
        }
    });

    test('only 25 and 26 December — the days either side are ordinary', () => {
        for (const day of [24, 27, 31]) assert.equal(isChristmasLeaveDay(CEA, new Date(2026, 11, day)), false);
    });

    test('never before a start date — the pattern is a rest day there', () => {
        const joiner = { ...CEA, startDate: new Date(2027, 0, 4) };
        assert.equal(isChristmasLeaveDay(joiner, XMAS_2026), false);
        assert.equal(isChristmasLeaveDay(joiner, BOXING_2026), false);
    });

    test('getBaseShift is UNCHANGED: both days are still a rest day for everybody', () => {
        // The CLAUDE.md rule "isChristmasRD() applied before Firestore overrides" — the leave is
        // built on top of it, never by weakening it.
        for (const m of ACTIVE) {
            assert.equal(getBaseShift(m, XMAS_2026), 'RD', m.name);
            assert.equal(getBaseShift(m, BOXING_2026), 'RD', m.name);
        }
    });

    test('getPatternShift IS getBaseShift on every other day of the year, for everybody', () => {
        // The split must be a split, not a second copy of the lookup.
        for (const m of ACTIVE) {
            for (let d = new Date(2026, 0, 1); d.getFullYear() === 2026; d.setDate(d.getDate() + 1)) {
                if (d.getMonth() === 11 && (d.getDate() === 25 || d.getDate() === 26)) continue;
                assert.equal(getPatternShift(m, d), getBaseShift(m, d), `${m.name} ${formatISO(d)}`);
            }
        }
    });

    test('a missing member or date is simply not a leave day', () => {
        assert.equal(isChristmasLeaveDay(null, XMAS_2026), false);
        assert.equal(isChristmasLeaveDay(CEA, /** @type {any} */ (null)), false);
    });
});

describe('a day counted that should not be — Christmas leave never costs anything', () => {
    test('the shown leave is never written, so no allowance figure can see it', () => {
        // Nothing is stored for it, so the counted set — which reads overrides — has nothing to
        // count. The allowance is the contract figure, unreduced.
        const pos = alPosition({ overrides: [], member: CEA, year: 2026, todayStr: '2026-12-31' });
        assert.equal(pos.taken + pos.booked, 0);
        assert.equal(pos.remaining, getALEntitlement(CEA, 2026, []));
    });

    test('leave somebody DID record on either day is not counted either — a swapped day included', () => {
        const overrides = [
            ov(CEA, '2026-12-25', 'annual_leave', 'AL'),
            ov(CEA, '2026-12-26', 'annual_leave', 'AL', { replacedType: 'shift' }),
        ];
        assert.equal(countedAlDates({ overrides, member: CEA, year: 2026 }).size, 0);
        assert.equal(consumesEntitlement(CEA, '2026-12-26', new Map([['2026-12-26', overrides[1]]])), false);
    });

    test('before 2026 nothing changes: a swapped Boxing Day still costs what it always did', () => {
        const swapped = ov(CEA, '2025-12-26', 'annual_leave', 'AL', { replacedType: 'shift' });
        assert.equal(consumesEntitlement(CEA, '2025-12-26', new Map([['2025-12-26', swapped]])), true);
    });

    test('isChristmasClosureDate: either day from 2026, for anybody, and nothing else', () => {
        assert.equal(isChristmasClosureDate('2026-12-25'), true);
        assert.equal(isChristmasClosureDate('2026-12-26'), true);
        assert.equal(isChristmasClosureDate('2031-12-26'), true);
        assert.equal(isChristmasClosureDate('2025-12-25'), false);
        assert.equal(isChristmasClosureDate('2026-12-24'), false);
        assert.equal(isChristmasClosureDate('2026-12-27'), false);
        assert.equal(isChristmasClosureDate(''), false);
    });
});

describe('the day in lieu — earned by working a Boxing Day you were due to work', () => {
    const worked = () => [ov(CEA, '2026-12-26', 'rdw', '06:00-14:00')];

    test('due at work and worked: one day, added to that year\'s allowance', () => {
        assert.equal(boxingDayLieuDays(CEA, 2026, worked()), 1);
        assert.equal(entitlementFor(CEA, 2026, worked()), getALEntitlement(CEA, 2026, []) + 1);
    });

    test('a plain shift or an Other day is worked too — the type does not matter, the work does', () => {
        assert.equal(boxingDayLieuDays(CEA, 2026, [ov(CEA, '2026-12-26', 'shift', '06:20-14:20')]), 1);
        assert.equal(boxingDayLieuDays(CEA, 2026, [ov(CEA, '2026-12-26', 'other', 'TRG')]), 1);
    });

    test('not worked, or leave, absence or rest recorded instead: no day', () => {
        assert.equal(boxingDayLieuDays(CEA, 2026, []), 0);
        for (const [type, value] of [['annual_leave', 'AL'], ['sick', 'SICK'], ['correction', 'RD'], ['spare_shift', 'SPARE']]) {
            assert.equal(boxingDayLieuDays(CEA, 2026, [ov(CEA, '2026-12-26', type, value)]), 0, type);
        }
    });

    test('working Boxing Day from a REST day is overtime, and earns none', () => {
        assert.equal(boxingDayLieuDays(RESTER, 2026, [ov(RESTER, '2026-12-26', 'rdw', '06:00-14:00')]), 0);
    });

    test('Christmas Day earns nothing, worked or not (owner, 5 Nov 2026)', () => {
        assert.equal(boxingDayLieuDays(CEA, 2026, [ov(CEA, '2026-12-25', 'rdw', '06:00-14:00')]), 0);
    });

    test('the WINNING document decides: a newer correction undoes the work, a stale one cannot', () => {
        const work = ov(CEA, '2026-12-26', 'rdw', '06:00-14:00');
        const rest = ov(CEA, '2026-12-26', 'correction', 'RD');          // newer
        assert.equal(boxingDayLieuDays(CEA, 2026, [work, rest]), 0);
        assert.equal(boxingDayLieuDays(CEA, 2026, [rest, work]), 0, 'array order must not matter');
        const later = ov(CEA, '2026-12-26', 'rdw', '07:00-15:00');       // newer still
        assert.equal(boxingDayLieuDays(CEA, 2026, [later, rest, work]), 1);
    });

    test('another member\'s document is ignored', () => {
        assert.equal(boxingDayLieuDays(CEA, 2026, [ov(RESTER, '2026-12-26', 'rdw', '06:00-14:00')]), 0);
    });

    test('never before 2026, and never on a Sunday Boxing Day', () => {
        assert.equal(boxingDayLieuDays(CEA, 2025, [ov(CEA, '2025-12-26', 'rdw', '06:00-14:00')]), 0);
        assert.equal(boxingDayLieuDays(CEA, 2027, [ov(CEA, '2027-12-26', 'rdw', '06:00-14:00')]), 0);
    });

    test('it counts towards the Boxing Day\'s OWN year, not the next one (owner, 5 Nov 2026)', () => {
        assert.equal(entitlementFor(CEA, 2027, worked()), getALEntitlement(CEA, 2027, []));
    });

    test('no entitlement on record stays null — a day is never added to nothing', () => {
        const mgmt = { name: 'Z. Nobody', role: 'Management', rosterType: 'main', currentWeek: 1 };
        assert.equal(entitlementFor(mgmt, 2026, []), null);
        assert.equal(entitlementFor(null, 2026, []), null);
    });
});

describe('a Dispatcher is counted ONCE (owner, 5 Nov 2026)', () => {
    test('2026: Boxing Day is no bank holiday, so this is the only rule that sees it', () => {
        const worked = [ov(DISP_2026, '2026-12-26', 'rdw', '06:00-14:00')];
        assert.equal(getALEntitlement(DISP_2026, 2026, worked), getALEntitlement(DISP_2026, 2026, []),
            'the bank-holiday rule must not see a Saturday Boxing Day — else this test is not about 2026');
        assert.equal(entitlementFor(DISP_2026, 2026, worked), getALEntitlement(DISP_2026, 2026, []) + 1);
    });

    test('2028: Boxing Day IS a bank holiday, the bank-holiday rule counts it, and this adds nothing', () => {
        const worked = [ov(DISP_2028, '2028-12-26', 'rdw', '06:00-14:00')];
        const before = getALEntitlement(DISP_2028, 2028, []);
        assert.equal(getALEntitlement(DISP_2028, 2028, worked), before + 1, 'the bank-holiday rule counts it once');
        assert.equal(boxingDayLieuDays(DISP_2028, 2028, worked), 0);
        assert.equal(entitlementFor(DISP_2028, 2028, worked), before + 1, 'and never twice');
    });

    test('the breakdown names a Boxing Day in lieu on its own, never as a bank-holiday day', () => {
        const worked = [ov(DISP_2026, '2026-12-26', 'rdw', '06:00-14:00')];
        const split = dispatcherBreakdown({ member: DISP_2026, year: 2026, overrides: worked });
        assert.ok(split);
        assert.equal(split.boxingDay, 1);
        assert.equal(split.base + split.lieu + split.boxingDay, entitlementFor(DISP_2026, 2026, worked));
        assert.equal(entitlementNote({ member: DISP_2026, year: 2026, overrides: worked }),
            `22 base + ${split.lieu} BH lieu + 1 Boxing Day in lieu`);
    });
});

describe('the one door — every allowance is read through entitlementFor', () => {
    test('alPosition, the banner\'s figures, include the earned day', () => {
        const worked = [ov(CEA, '2026-12-26', 'rdw', '06:00-14:00')];
        const pos = alPosition({ overrides: worked, member: CEA, year: 2026, todayStr: '2026-12-31' });
        assert.equal(pos.entitlement, getALEntitlement(CEA, 2026, []) + 1);
        assert.equal(pos.remaining, pos.entitlement);
    });

    test('the note says why the figure is one higher than a colleague\'s', () => {
        const worked = [ov(CEA, '2026-12-26', 'rdw', '06:00-14:00')];
        assert.equal(entitlementNote({ member: CEA, year: 2026, overrides: worked }),
            'Includes 1 day in lieu for working Boxing Day');
        assert.equal(entitlementNote({ member: CEA, year: 2026, overrides: [] }), null);
    });

    test('NO module but al-entitlement.js calls getALEntitlement — a second door leaves the day out', () => {
        // Static, because the failure is a surface that compiles, renders a plausible figure, and is
        // one day short for exactly the people who worked Boxing Day. roster-data.js is where it is
        // defined (and where the Dispatcher rule lives); every other caller goes through
        // `entitlementFor`. Comments are stripped first: several modules NAME it in prose.
        const strip = (/** @type {string} */ src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        const offenders = readdirSync(new URL('.', import.meta.url))
            .filter(f => f.endsWith('.js') && !['roster-data.js', 'al-entitlement.js', 'eslint.config.js'].includes(f))
            .filter(f => /\bgetALEntitlement\b/.test(strip(readFileSync(new URL('./' + f, import.meta.url), 'utf8'))));
        assert.deepEqual(offenders, [], 'read the allowance through entitlementFor (al-entitlement.js)');
    });
});

describe('a day shown wrongly — what each surface draws', () => {
    test('due at work and nothing recorded: annual leave, marked as Christmas leave', () => {
        assert.deepEqual(resolveDayShift(null, 'RD', false, true),
            { shift: 'AL', rdwTime: '', derivedRdw: false, christmasLeave: true });
    });

    test('anything recorded on the day WINS — work, a correction to rest, or leave itself', () => {
        const rdw = resolveDayShift(ov(CEA, '2026-12-26', 'rdw', '06:00-14:00'), 'RD', false, true);
        assert.equal(rdw.shift, 'RDW');
        assert.equal(rdw.christmasLeave, false);
        assert.equal(resolveDayShift(ov(CEA, '2026-12-26', 'correction', 'RD'), 'RD', false, true).shift, 'RD');
        const al = resolveDayShift(ov(CEA, '2026-12-26', 'annual_leave', 'AL'), 'RD', false, true);
        assert.equal(al.shift, 'AL');
        assert.equal(al.christmasLeave, false, 'recorded leave is somebody\'s record, not the roster\'s');
    });

    test('a document the ladder would hide anyway does not hide the leave', () => {
        // An absence on a rest day is suppressed on every other date (isOverrideDisplaySuppressed);
        // it must not turn a closed day back into Rest for somebody due at work.
        const sick = ov(CEA, '2026-12-25', 'sick', 'SICK');
        assert.equal(resolveEffectiveShift(sick, 'RD', false).shift, 'RD', 'premise: suppressed on a rest day');
        assert.equal(resolveDayShift(sick, 'RD', false, true).christmasLeave, true);
    });

    test('NOT due: exactly the shared ladder, field for field', () => {
        const cases = [null, ov(CEA, '2026-12-26', 'rdw', '06:00-14:00'), ov(CEA, '2026-12-26', 'annual_leave', 'AL'),
            ov(CEA, '2026-12-26', 'sick', 'SICK'), ov(CEA, '2026-12-26', 'other', 'TRG')];
        for (const o of cases) {
            for (const base of ['RD', '06:20-14:20']) {
                assert.deepEqual(resolveDayShift(o, base, false, false),
                    { ...resolveEffectiveShift(o, base, false), christmasLeave: false });
            }
        }
    });

    test('the records list exactly the days the calendar shows as leave', () => {
        // The calendar asks `resolveDayShift` with each day's winning document; so does the list.
        const overrides = [ov(CEA, '2026-12-26', 'rdw', '06:00-14:00')];
        assert.deepEqual(christmasLeaveDates({ member: CEA, year: 2026, overrides: [] }), ['2026-12-25', '2026-12-26']);
        assert.deepEqual(christmasLeaveDates({ member: CEA, year: 2026, overrides }), ['2026-12-25'],
            'a worked Boxing Day is work, not leave');
        assert.deepEqual(christmasLeaveDates({ member: CEA, year: 2026, overrides: [ov(CEA, '2026-12-25', 'correction', 'RD')] }),
            ['2026-12-26'], 'a correction is rest');
        assert.deepEqual(christmasLeaveDates({ member: RESTER, year: 2026, overrides: [] }),
            isChristmasLeaveDay(RESTER, XMAS_2026) ? ['2026-12-25'] : []);
        for (const m of ACTIVE) {
            const shown = [XMAS_2026, BOXING_2026]
                .filter(d => resolveDayShift(null, getBaseShift(m, d), false, isChristmasLeaveDay(m, d)).shift === 'AL')
                .map(formatISO);
            assert.deepEqual(christmasLeaveDates({ member: m, year: 2026, overrides: [] }), shown, m.name);
        }
    });

    test('leave RECORDED on a Christmas day the member rests by pattern is listed too (7 Nov 2026 review)', () => {
        // The Calendar draws it as Christmas leave, not counted, and the ordinary rows drop it
        // (consumesEntitlement), so unless it is listed here it can be deleted from nowhere.
        assert.ok(RESTER && !isChristmasLeaveDay(RESTER, BOXING_2026), 'needs a CEA resting on Boxing Day 2026');
        const recorded = [ov(RESTER, '2026-12-26', 'annual_leave', 'AL')];
        assert.ok(christmasLeaveDates({ member: RESTER, year: 2026, overrides: recorded }).includes('2026-12-26'));
        assert.ok(!christmasLeaveDates({ member: RESTER, year: 2026, overrides: [] }).includes('2026-12-26'), 'and only with the record');
        // Before these rules, Christmas leave was ordinary leave and is listed with the rest.
        assert.ok(!christmasLeaveDates({ member: RESTER, year: 2025, overrides: [ov(RESTER, '2025-12-26', 'annual_leave', 'AL')] }).includes('2025-12-26'));
        // A Sunday shows no leave (Boxing Day 2027), so it lists none.
        assert.ok(!christmasLeaveDates({ member: RESTER, year: 2027, overrides: [ov(RESTER, '2027-12-26', 'annual_leave', 'AL')] }).includes('2027-12-26'));
    });

    test('by year: from 2026 up to this year only — no chip for a Christmas nobody has reached', () => {
        assert.deepEqual(Object.keys(christmasLeaveByYear({ member: CEA, overrides: [], thisYear: 2026 })), ['2026']);
        assert.deepEqual(christmasLeaveByYear({ member: CEA, overrides: [], thisYear: 2025 }), {});
        const two = christmasLeaveByYear({ member: CEA, overrides: [], thisYear: 2028 });
        for (const [y, dates] of Object.entries(two)) {
            assert.ok(dates.length > 0, `${y} is listed only when it has a date`);
            assert.ok(dates.every(d => d.startsWith(`${y}-12-`)));
        }
        assert.deepEqual(christmasLeaveByYear({ member: null, overrides: [], thisYear: 2026 }), {});
    });

    test('one phrasing for every surface that lists them', () => {
        assert.equal(christmasLeaveLine([]), null);
        assert.equal(christmasLeaveLine(['2026-12-25']), 'Christmas Day: annual leave, not counted');
        assert.equal(christmasLeaveLine(['2026-12-26']), 'Boxing Day: annual leave, not counted');
        assert.equal(christmasLeaveLine(['2026-12-25', '2026-12-26']),
            'Christmas Day and Boxing Day: annual leave, not counted');
    });

    test('the worked-day test the day panel and Admin\'s note use is the allowance\'s own', () => {
        // The renderer marks a day in lieu from the EFFECTIVE shift; the allowance counts from the
        // winning document's value. They must agree on every type that can be recorded there.
        for (const [type, value] of [['rdw', '06:00-14:00'], ['shift', '06:20-14:20'], ['other', 'TRG'],
            ['annual_leave', 'AL'], ['sick', 'SICK'], ['correction', 'RD'], ['spare_shift', 'SPARE']]) {
            const o = ov(CEA, '2026-12-26', type, value);
            assert.equal(isWorkedShift(resolveDayShift(o, 'RD', false, true).shift) ? 1 : 0,
                boxingDayLieuDays(CEA, 2026, [o]), type);
        }
    });
});

describe('isUncountedChristmasLeave — one rule for every surface that words the day (6 Nov 2026 review)', () => {
    test('the pattern\'s Christmas leave, and leave RECORDED on 25 or 26 December from 2026', () => {
        assert.equal(isUncountedChristmasLeave('AL', '2026-12-25', true), true);
        assert.equal(isUncountedChristmasLeave('AL', '2026-12-25', false), true, 'a stored record is not counted either');
        assert.equal(isUncountedChristmasLeave('AL', '2027-12-26', false), true);
    });
    test('not before the rules, not on another day, and not for anything that is not leave', () => {
        assert.equal(isUncountedChristmasLeave('AL', '2025-12-25', false), false, 'before 2026 Christmas leave was counted');
        assert.equal(isUncountedChristmasLeave('AL', '2026-12-24', false), false);
        assert.equal(isUncountedChristmasLeave('06:20-13:45', '2026-12-25', false), false);
        assert.equal(isUncountedChristmasLeave('SICK', '2026-12-26', false), false);
    });
});
