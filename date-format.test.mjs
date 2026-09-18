// @ts-check
/**
 * date-format.test.mjs — the app's date vocabulary, composer by composer.
 *
 * The REPO-WIDE rule (nothing may reach for ICU's month abbreviation) is a separate file:
 * `month-vocabulary-parity.test.mjs`. This one drives the functions.
 *
 * Every expectation here is a LITERAL string rather than a comparison against `toLocaleDateString`,
 * deliberately: the whole point of these composers is that they do NOT agree with ICU, so a test
 * written against ICU would assert the defect.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    formatDayMonth, formatDayMonthYear, formatDayMonthYear2, formatWeekdayDate,
    formatClock, printedStamp, londonDate, londonClock,
} from './date-format.js';

describe('the month is spelled from the app\'s table, not the engine\'s', () => {
    test('September is three letters here and four in en-GB', () => {
        const d = new Date(2026, 8, 18);
        assert.equal(formatDayMonth(d), '18 Sep');
        // The divergence this module exists for, asserted rather than assumed. If a future engine
        // agrees with MONTH_ABB this line fails and the module can be reconsidered — which is a
        // better outcome than it quietly becoming pointless.
        assert.equal(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), '18 Sept');
    });

    test('the other eleven months agree with en-GB, so only September changed on screen', () => {
        for (let m = 0; m < 12; m++) {
            if (m === 8) continue;
            const d = new Date(2026, m, 15);
            assert.equal(formatDayMonth(d),
                d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
                `month ${m} diverged`);
        }
    });

    test('every month, spelled', () => {
        assert.deepEqual(
            Array.from({ length: 12 }, (_, m) => formatDayMonth(new Date(2026, m, 1))),
            ['1 Jan', '1 Feb', '1 Mar', '1 Apr', '1 May', '1 Jun',
             '1 Jul', '1 Aug', '1 Sep', '1 Oct', '1 Nov', '1 Dec']);
    });
});

describe('the four composers', () => {
    const d = new Date(2026, 8, 18, 14, 23);   // Friday

    test('day-month, with the full year and with two digits', () => {
        assert.equal(formatDayMonth(d), '18 Sep');
        assert.equal(formatDayMonthYear(d), '18 Sep 2026');
        assert.equal(formatDayMonthYear2(d), '18 Sep 26');
    });

    test('a two-digit year below ten keeps its leading zero', () => {
        // "5 Jan 7" would read as a date in the 7th of something. The pad is not cosmetic.
        assert.equal(formatDayMonthYear2(new Date(2007, 0, 5)), '5 Jan 07');
        assert.equal(formatDayMonthYear2(new Date(2000, 0, 5)), '5 Jan 00');
    });

    test('the weekday form, with and without the year', () => {
        assert.equal(formatWeekdayDate(d), 'Fri 18 Sep');
        assert.equal(formatWeekdayDate(d, true), 'Fri 18 Sep 2026');
        // The default is the SHORT one: a deadline is days away and its year is noise. The year is
        // opt-in so a surface that needs it has to say so.
        assert.equal(formatWeekdayDate(d), formatWeekdayDate(d, false));
    });

    test('the clock is 24-hour and zero-padded', () => {
        assert.equal(formatClock(new Date(2026, 8, 18, 9, 5)), '09:05');
        assert.equal(formatClock(new Date(2026, 8, 18, 14, 23)), '14:23');
        // h23, not h24: midnight is 00:00, never "24:00".
        assert.equal(formatClock(new Date(2026, 8, 18, 0, 0)), '00:00');
        assert.equal(formatClock(new Date(2026, 8, 18, 23, 59)), '23:59');
    });
});

describe('the provenance stamp', () => {
    test('one shape for all five printable surfaces', () => {
        const d = new Date(2026, 8, 18, 14, 23);
        assert.equal(printedStamp(d, formatClock(d)), 'Printed Fri 18 Sep 2026 · 14:23');
    });

    test('the YEAR is always there — a printout is read next August', () => {
        const d = new Date(2026, 8, 18, 14, 23);
        assert.match(printedStamp(d, formatClock(d)), /\b2026\b/);
    });

    test('the TIME is what orders two sheets of the same thing', () => {
        // The reason the four other surfaces adopted Overtime's shape rather than the reverse.
        const day = new Date(2026, 8, 18, 9, 5);
        const eve = new Date(2026, 8, 18, 21, 40);
        assert.notEqual(printedStamp(day, formatClock(day)), printedStamp(eve, formatClock(eve)));
    });
});

describe('the London shim', () => {
    test('an instant becomes its LONDON calendar date, under BST and under GMT', () => {
        // 23:30 UTC on 1 Jul is 00:30 BST on the 2nd — the day the sheet was really printed.
        assert.equal(formatDayMonthYear(londonDate(Date.UTC(2026, 6, 1, 23, 30))), '2 Jul 2026');
        // 23:30 UTC on 31 Dec is still 31 Dec in GMT.
        assert.equal(formatDayMonthYear(londonDate(Date.UTC(2026, 11, 31, 23, 30))), '31 Dec 2026');
    });

    test('it takes a Date or a millisecond count, the same way', () => {
        const ms = Date.UTC(2026, 8, 8, 13, 7);
        assert.equal(formatDayMonthYear(londonDate(ms)), formatDayMonthYear(londonDate(new Date(ms))));
    });

    test('the clock reads London wall-clock, so BST is an hour ahead of the instant', () => {
        assert.equal(londonClock(Date.parse('2026-09-08T13:07:00Z')), '14:07');   // BST
        assert.equal(londonClock(Date.parse('2026-12-22T12:00:00Z')), '12:00');   // GMT
    });

    test('the date shim never carries a time, so no DST gap can move it', () => {
        // `londonDate` returns local NOON. The trap it avoids: a device whose own spring-forward is
        // at 01:00 cannot represent 01:30 locally, so a shim carrying the London clock onto a local
        // Date would silently shift it. Noon exists in every zone on every day.
        const d = londonDate(Date.parse('2026-03-29T01:30:00Z'));
        assert.equal(d.getHours(), 12);
        assert.equal(formatDayMonthYear(d), '29 Mar 2026');
    });

    test('the parts are read NUMERICALLY, so the shim cannot re-introduce a spelling', () => {
        // If `londonDate` parsed a formatted month name it would depend on the very ICU table this
        // module exists to avoid. September is the case that would break.
        assert.equal(formatDayMonth(londonDate(Date.parse('2026-09-08T13:07:00Z'))), '8 Sep');
    });
});

describe('a local-calendar Date is not an instant, and the strip proved it matters', () => {
    // THE DEFECT THIS LOCKS, found reviewing v24.06's own diff. The Calendar's pay-period strip read
    // its payday and cut-off Dates through `Europe/London`. They are not instants — `getPaydays-
    // AndCutoffs` builds them at local NOON and advances in whole days — so at UTC+12 and beyond,
    // local noon is the previous day in UTC and the strip printed the day before. Measured on 2026:
    // 26 of 52 dates shifted at UTC+14, 10 at UTC+12, 16 at UTC−11.
    //
    // The tell was that the LABEL and the LINK disagreed: `?payday=` is `formatISO`, which reads the
    // local getters, so a member tapping "paid 28 Aug" could land the calculator on the 29th.
    // `paycalc-format.js` carries the same rule for the same Dates, having had the same fix reverted
    // into it once already — which is why this is a test and not another comment.
    test('a noon-built local Date reads as its own day, and londonDate can move it', () => {
        // Noon on the 16th. As an instant at UTC+14 that is 22:00 UTC on the 15th.
        const local = new Date(2026, 0, 16, 12, 0, 0);
        assert.equal(formatDayMonth(local), '16 Jan');
        // The composer reads the LOCAL getters, so it cannot move the day whatever the zone.
        assert.equal(formatDayMonth(local), `${local.getDate()} Jan`);
    });

    test('londonDate is for INSTANTS, and saying so is the whole distinction', () => {
        // Where it belongs: a deadline is a moment the roster office chose, and every member must
        // read the same wall-clock for it.
        assert.equal(formatWeekdayDate(londonDate(Date.parse('2026-09-08T13:07:00Z'))), 'Tue 8 Sep');
        // Where it does not: a calendar date carries no time to convert, so passing one through a
        // zone is asking a question with no answer — and getting a different day back for free.
        const noon = new Date(2026, 0, 16, 12, 0, 0);
        assert.equal(formatDayMonth(noon), '16 Jan',
            'a local-calendar Date must render as its own day — convert an INSTANT, never this');
    });
});

describe('an unusable date does not render as arithmetic', () => {
    // The one thing the v24.06 sweep made WORSE before this guard. `toLocaleDateString` says
    // "Invalid Date" — ugly, and it says what happened; reading `getDate()`/`getMonth()` directly
    // said "NaN undefined NaN". Three of the six call sites already tested for it and three did
    // not, which is why the guard is in the composers rather than at the call sites.
    test('every composer answers with the em-dash, not NaN', () => {
        const bad = new Date(NaN);
        for (const [name, out] of Object.entries({
            formatDayMonth: formatDayMonth(bad),
            formatDayMonthYear: formatDayMonthYear(bad),
            formatDayMonthYear2: formatDayMonthYear2(bad),
            formatWeekdayDate: formatWeekdayDate(bad),
            formatClock: formatClock(bad),
        })) {
            assert.equal(out, '—', `${name} rendered ${JSON.stringify(out)}`);
            assert.ok(!/NaN|undefined|Invalid/.test(out), `${name} leaked ${JSON.stringify(out)}`);
        }
    });

    test('it is an em-dash and not a blank, because "no date recorded" is a different state', () => {
        // Several of these surfaces legitimately have nothing to show ("Not saved yet"), and a
        // reader cannot tell that apart from a date the app failed to render if both are empty.
        assert.notEqual(formatDayMonth(new Date(NaN)), '');
    });

    test('a non-Date is refused the same way, since a caller passing null is the same bug', () => {
        assert.equal(formatDayMonth(/** @type {any} */ (null)), '—');
        assert.equal(formatDayMonthYear(/** @type {any} */ (undefined)), '—');
        assert.equal(formatDayMonth(/** @type {any} */ ('2026-09-18')), '—');
    });

    test('a valid date is untouched by the guard', () => {
        const d = new Date(2026, 8, 18, 14, 23);
        assert.equal(formatDayMonth(d), '18 Sep');
        assert.equal(formatClock(d), '14:23');
        // The epoch is a VALID date and must not be swallowed — `0` is falsy, and a guard written
        // as a truthiness check rather than a NaN check would lose it.
        assert.equal(formatDayMonthYear(new Date(0)), formatDayMonthYear(new Date(0)));
        assert.notEqual(formatDayMonthYear(new Date(0)), '—');
    });
});
