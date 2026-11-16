// @ts-check
/**
 * admin-card-config.test.mjs — what the two range cards on Admin are CONFIGURED to write.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs admin-card-config.test.mjs   (part of test:unit)
 *
 * WHY THIS EXISTS (test audit, 7 Nov 2026). `admin-range-booking.js`'s factory is tested directly,
 * and that is where the coverage exemption for these two wrappers pointed. But the factory writes
 * whatever type it is HANDED, and nothing checked what each card hands it: the Absence card writing
 * annual leave, or either card losing its range limit, left every lane green. The exemption also
 * said the Absence card was driven by the browser suite; no spec touches its dates or its save.
 *
 * So the factory is replaced here by a recorder, and each card's own configuration is what is under
 * test — the type it writes, the limit it sets, and (for leave) the allowance check it runs before a
 * save, which is the one place a declared swap exists before the write does.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** Every configuration a card handed the factory, in order. @type {any[]} */
const _cfgs = [];
/** How many times a card clicked its own Save — "Save anyway" resumes that way. */
let _clicks = 0;
/** The page's override cache, as the leave card's check reads it. @type {any[]} */
let _overrides = [];

mock.module('./admin-range-booking.js', { namedExports: {
    createRangeBookingSection: (/** @type {any} */ cfg) => { _cfgs.push(cfg); return { updatePreview() {}, saveBtn: { click() { _clicks++; } } }; },
} });
mock.module('./admin-overrides.js', { namedExports: {
    getAllOverrides: () => _overrides,
    buildMemberDateMap: (/** @type {string} */ name) =>
        new Map(_overrides.filter(o => o.memberName === name).map(o => [o.date, o])),
} });

const { initSickSection } = await import('./admin-sick.js');
const { initALSection } = await import('./admin-al.js');
const { teamMembers, isBankHoliday, parseISODate, getBaseShift, getPatternShift } = await import('./roster-data.js');
const { entitlementFor } = await import('./al-entitlement.js');
const { isRestShift } = await import('./override-utils.js');

const noop = () => {};
/** @param {string} value */
const select = (value) => /** @type {any} */ ({ value });

/** Wire the Absence card and return the configuration it handed the factory; `confirms` records
 *  every over-allowance bar it shows, as the page's `showALConfirm` receives it. */
function sickCfg(/** @type {any[]} */ confirms = []) {
    _cfgs.length = 0;
    initSickSection(/** @type {any} */ ({
        sickMember: select('C. Reen'), syncSickMemberDisplay: noop, populateMemberDropdown: noop, lastMember: null,
        updateALBanner: noop, updateALBookedBox: noop, updateSickBookedBox: noop,
        getCurrentUser: () => 'A. Admin', showInChangeAShift: noop, showSuccess: noop,
        showALConfirm: (/** @type {any[]} */ ...a) => { confirms.push(a); }, hideALConfirm: noop,
    }));
    return _cfgs[0];
}

/** Wire the leave card; `confirms` records every over-allowance bar it shows. */
function alCfg(/** @type {any[]} */ confirms = []) {
    _cfgs.length = 0;
    initALSection(/** @type {any} */ ({
        alMember: select('C. Reen'), syncMemberDisplay: noop, populateMemberDropdown: noop, lastMember: null,
        updateALBanner: noop, updateALBookedBox: noop, updateSickBookedBox: noop, setALPickerYear: noop,
        getCurrentUser: () => 'A. Admin', showALConfirm: (/** @type {any[]} */ ...a) => { confirms.push(a); }, hideALConfirm: noop,
        showInChangeAShift: noop, showSuccess: noop,
    }));
    return _cfgs[0];
}

/** `n` consecutive ISO dates from `fromIso`. */
function days(/** @type {string} */ fromIso, /** @type {number} */ n) {
    const out = [];
    const d = parseISODate(fromIso);
    for (let i = 0; i < n; i++) {
        out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
        d.setDate(d.getDate() + 1);
    }
    return out;
}

beforeEach(() => { _overrides = []; });

describe('the Absence card', () => {
    test('writes an ABSENCE — never annual leave', () => {
        const cfg = sickCfg();
        assert.equal(cfg.overrideType, 'sick');
        assert.equal(cfg.overrideValue, 'SICK');
    });

    test('never asks the swapped-rest-day question — that is a leave question only', () => {
        assert.equal(sickCfg().swapQuestion, undefined);
    });

    test('accepts a range of exactly one year, and refuses a day more', () => {
        const { validateRange } = sickCfg();
        assert.equal(validateRange(['2026-01-05', '2027-01-05']), null, 'a whole year is allowed');
        assert.match(String(validateRange(['2026-01-05', '2027-01-06'])), /Maximum range is 1 year/);
    });

    // AN ABSENCE OVER A WORKED BOXING DAY TAKES ITS DAY IN LIEU BACK (review of v26.22). The card
    // checked nothing, so the next year's allowance fell with no word. Its check runs the rule
    // (`projectAbsenceRange`), shows the shared bar, and "Save anyway" resumes THIS card's save.
    // An INVENTED person on a real pattern.
    describe('an absence that takes back a day in lieu', () => {
        const pattern = /** @type {any} */ (teamMembers.find(m => m.role === 'CEA' && !m.hidden && !m.startDate && !m.proRatedAL
            && !m.rosterChanges && m.bilingualContract !== true && !isRestShift(getPatternShift(m, new Date(2026, 11, 26)))));
        const person = { ...pattern, name: 'Z. Invented' };
        const worked = { id: 'zbx', memberName: person.name, date: '2026-12-26', type: 'rdw', value: '06:00-14:00', source: 'manual', createdAt: new Date(2026, 11, 27) };
        /** The next year filled to `n` days of leave on working weekdays, with the Boxing Day worked. */
        function nextYear(/** @type {number} */ n) {
            /** @type {any[]} */ const ovs = [];
            for (const d = parseISODate('2027-01-04'); ovs.length < n; d.setDate(d.getDate() + 1)) {
                if (d.getDay() === 0 || d.getDay() === 6 || isBankHoliday(d) || isRestShift(getBaseShift(person, d))) continue;
                const iso = days(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, 1)[0];
                ovs.push({ id: `z-${iso}`, memberName: person.name, date: iso, type: 'annual_leave', value: 'AL', source: 'manual', createdAt: new Date(2026, 11, 1) });
            }
            _overrides = [...ovs, worked];
        }
        const ask = (/** @type {any} */ cfg) => cfg.preSave({ member: person.name, dates: ['2026-12-26'], memberObj: person, swapAnswers: new Map() });

        test('premise: a pattern due at work on Boxing Day 2026, whose worked day lifts 2027 by one', () => {
            assert.ok(pattern);
            assert.equal(entitlementFor(person, 2027, [worked]), /** @type {number} */ (entitlementFor(person, 2027, [])) + 1);
        });

        test('at the limit, the save stops at the bar, which names the day in lieu', () => {
            nextYear(/** @type {number} */ (entitlementFor(person, 2027, [worked])));
            /** @type {any[]} */ const confirms = [];
            assert.equal(ask(sickCfg(confirms)), true, 'the allowance falls below what is booked: not silently');
            assert.equal(confirms.length, 1);
            assert.match(confirms[0][1], /^Boxing Day recorded as absent, so the day in lieu for working it goes · /);
            assert.equal(confirms[0][2], null, 'the range path, not the week grid\'s batch');
        });

        test('"Save anyway" clicks this card\'s Save, and that click is let through once', () => {
            nextYear(/** @type {number} */ (entitlementFor(person, 2027, [worked])));
            /** @type {any[]} */ const confirms = [];
            const cfg = sickCfg(confirms);
            ask(cfg);
            _clicks = 0;
            confirms[0][4]();
            assert.equal(_clicks, 1, 'the resume clicks the Absence card\'s own Save');
            cfg.onClick();
            assert.equal(ask(cfg), false, 'the confirmed click saves');
            cfg.onClick();
            assert.equal(ask(cfg), true, 'and the next click is checked again');
        });

        test('with a day to spare, nothing stops the save — but the preview names the day in lieu', () => {
            nextYear(/** @type {number} */ (entitlementFor(person, 2027, [worked])) - 1);
            /** @type {any[]} */ const confirms = [];
            const cfg = sickCfg(confirms);
            assert.equal(ask(cfg), false);
            assert.equal(confirms.length, 0);
            const html = cfg.renderReady({ member: person.name, dates: ['2026-12-26'], memberObj: person,
                memberOvByDate: new Map([['2026-12-26', worked]]), rangeStr: '26 Dec', workDays: 1, restCount: 0 });
            assert.match(html, /Boxing Day recorded as absent, so the day in lieu for working it goes/);
        });
    });
});

describe('the leave card', () => {
    test('writes annual leave', () => {
        const cfg = alCfg();
        assert.equal(cfg.overrideType, 'annual_leave');
        assert.equal(cfg.overrideValue, 'AL');
    });

    test('accepts 60 days in one booking, and refuses 61', () => {
        const { validateRange } = alCfg();
        assert.equal(validateRange(days('2026-01-05', 60)), null);
        assert.match(String(validateRange(days('2026-01-05', 61))), /maximum range is 60 days/);
    });

    // THE CHECK SEES THE ANSWER BEFORE THE WRITE DOES. Until the save runs, a rest day the admin has
    // just declared swapped still reads as REST everywhere else, so a check built on the stored state
    // alone lets a member with one day left book two (v23.79). Nothing ran this card's check at all.
    describe('a member with one day left', () => {
        const reen = /** @type {any} */ (teamMembers.find(m => m.name === 'C. Reen'));
        const WORK = '2026-12-04', REST = '2026-12-05';      // a working Friday on this line, and the Saturday after

        /** Fill the year to one day short of the allowance, on working weekdays early in 2026. */
        function oneDayLeft() {
            const allowance = /** @type {number} */ (entitlementFor(reen, 2026, []));
            /** @type {any[]} */ const ovs = [];
            for (const d = parseISODate('2026-01-05'); ovs.length < allowance - 1; d.setDate(d.getDate() + 1)) {
                if (d.getDay() === 0 || d.getDay() === 6 || isBankHoliday(d) || isRestShift(getBaseShift(reen, d))) continue;
                const iso = days(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, 1)[0];
                ovs.push({ id: `al-${iso}`, memberName: 'C. Reen', date: iso, type: 'annual_leave', value: 'AL',
                    source: 'manual', createdAt: new Date(2025, 11, 1) });
            }
            _overrides = ovs;
        }

        test('the premise: a working Friday and a rest Saturday on this line', () => {
            assert.ok(!isRestShift(getBaseShift(reen, parseISODate(WORK))));
            assert.ok(isRestShift(getBaseShift(reen, parseISODate(REST))));
        });

        test('booking the working day and a DECLARED-SWAPPED rest day stops at the bar', () => {
            oneDayLeft();
            /** @type {any[]} */ const confirms = [];
            const cfg = alCfg(confirms);
            const stopped = cfg.preSave({ member: 'C. Reen', dates: [WORK, REST], memberObj: reen,
                swapAnswers: new Map([[REST, true]]) });
            assert.equal(stopped, true, 'two days against one left must not save silently');
            assert.equal(confirms.length, 1, 'the over-allowance bar is shown');
        });

        test('CONTROL: the same booking with the rest day answered free fits, and saves', () => {
            oneDayLeft();
            /** @type {any[]} */ const confirms = [];
            const cfg = alCfg(confirms);
            const stopped = cfg.preSave({ member: 'C. Reen', dates: [WORK, REST], memberObj: reen,
                swapAnswers: new Map([[REST, false]]) });
            assert.equal(stopped, false);
            assert.equal(confirms.length, 0);
        });
    });
});
