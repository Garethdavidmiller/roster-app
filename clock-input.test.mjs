import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isClockTime, formatClockInput, finaliseClockInput } from './clock-input.js';

// clock-input.test.mjs — the two rules of a TEXT clock box, moved here with the module at v24.61.
// Organised by cost: accepting nonsense is the expensive direction for `isClockTime` (a `29:00`
// reaches every duration helper downstream), and for `formatClockInput` it is shaping a value the
// guard will then refuse — which from a phone reads as a box that cannot be filled.

describe('formatClockInput — a numeric keypad has no colon, so the box supplies it (v24.61)', () => {
    it('four digits become HH:MM, and are what isClockTime then accepts', () => {
        assert.equal(formatClockInput('0730'), '07:30');
        assert.equal(formatClockInput('2355'), '23:55');
        assert.equal(isClockTime(formatClockInput('0730')), true);
    });
    it('the colon goes in after the hour as soon as there is one, and a typed colon is not doubled', () => {
        assert.equal(formatClockInput('0'), '0');
        assert.equal(formatClockInput('07'), '07');
        assert.equal(formatClockInput('073'), '07:3');
        assert.equal(formatClockInput('07:30'), '07:30');
        assert.equal(formatClockInput('7:30'), '07:30', 'a dropped leading zero is restored');
    });
    it('"630" is 06:30, never 63:0 — the week editor\'s own three-digit rule, applied as it is typed', () => {
        assert.equal(formatClockInput('630'), '06:30');
        assert.equal(formatClockInput('123'), '12:3', 'a three-digit entry that could still be a valid hour is left to finish');
    });
    it('a four-digit run that is not a time is left for isClockTime to refuse — never reshaped into one (24-hour review)', () => {
        // The first cut padded any run whose first pair exceeded 23, so a typed "2400" (a midnight
        // finish, which the roster writes 00:00) became the VALID time 02:40 and saved.
        assert.equal(formatClockInput('2400'), '24:00');
        assert.equal(isClockTime(formatClockInput('2400')), false);
        assert.equal(formatClockInput('6300'), '63:00');
        assert.equal(isClockTime(formatClockInput('6300')), false);
        assert.equal(formatClockInput('06300'), '06:30', 'the trailing zero somebody types after a shaped 630 changes nothing');
    });
    it('anything beyond four digits, and anything that is not a digit, is dropped', () => {
        assert.equal(formatClockInput('07:30:00'), '07:30');
        assert.equal(formatClockInput('ab'), '');
        assert.equal(formatClockInput(''), '');
        assert.equal(formatClockInput(/** @type {any} */ (null)), '');
    });
});

// ── A BOX IS FILLED ONE KEY AT A TIME (whole-app review, Oct 2026) ───────────────────────────────
//
// Every assertion above feeds a WHOLE string, and "2400" passed as a whole string while the box
// saved 02:40: after "240" the shaper read a dropped zero, the box held "02:40" — five characters,
// full — and the last 0 of a midnight finish was never typed. `type` fills a maxlength-5 box the
// way the input handler sees it, so the test meets the box as a person does.
describe('a box filled key by key, and settled only when it is left', () => {
    /** @param {string} keys */
    const type = (keys) => {
        let v = '';
        for (const k of keys) { if ((v + k).length <= 5) v = formatClockInput(v + k); }
        return v;
    };
    it('"2400" typed key by key is 24:00 and refused — never the valid 02:40 it used to fill itself with', () => {
        assert.equal(type('2400'), '24:00');
        assert.equal(isClockTime(type('2400')), false);
        assert.equal(isClockTime(finaliseClockInput(type('2400'))), false, 'leaving the box must not rescue it into a time nobody typed');
    });
    it('every first pair from 24 to 29 waits for its fourth key', () => {
        for (const keys of ['2400', '2530', '2615', '2959']) {
            assert.equal(type(keys), `${keys.slice(0, 2)}:${keys.slice(2)}`, keys);
            assert.equal(isClockTime(type(keys)), false, keys);
        }
    });
    it('three such digits LEFT in the box are a dropped zero — 240 is 02:40 once nothing more is coming', () => {
        assert.equal(type('240'), '24:0', 'still typing: it may yet be 2400');
        assert.equal(finaliseClockInput(type('240')), '02:40');
        assert.equal(finaliseClockInput(type('253')), '02:53');
    });
    it('a first digit of 3 to 9 begins no hour, so it is settled as it is typed', () => {
        assert.equal(type('630'), '06:30');
        assert.equal(type('0730'), '07:30');
        assert.equal(type('2355'), '23:55');
    });
    it('leaving a box changes nothing that is already a time, or already impossible, or unfinished', () => {
        for (const v of ['06:30', '23:55', '00:00', '24:00', '19:75', '12:3', '07', ''])
            assert.equal(finaliseClockInput(v), formatClockInput(v), v);
    });
});

describe('isClockTime — the guard TEXT boxes need and `<input type="time">` gave for free', () => {
    // Two places in the app type times into text: the roster review's entry control and Overtime's
    // custom-hours row. Both refused `type="time"` on a measurement (12-hour rendering from the OS
    // against 24-hour badges), and the price is that nothing in the browser validates any more.
    // The expensive direction is ACCEPTING nonsense: `29:00` reaches every duration helper
    // downstream and is read as a real shift, silently.
    it('a real time is accepted at both ends of the day', () => {
        for (const v of ['00:00', '06:00', '13:30', '23:59']) assert.equal(isClockTime(v), true, v);
    });
    it('the shape of a time is not a time', () => {
        // Each of these matches /^\d{2}:\d{2}$/ and none of them is a clock time.
        for (const v of ['29:00', '99:99', '24:00', '25:61']) assert.equal(isClockTime(v), false, v);
    });
    it('24:00 is refused specifically, because midnight is written 00:00', () => {
        // `15:00-00:00` appears on the real Supervisor sheet; an overnight range is end < start.
        assert.equal(isClockTime('24:00'), false);
        assert.equal(isClockTime('00:00'), true);
    });
    it('anything that is not two-and-two is refused, including the half-typed', () => {
        for (const v of ['6:00', '06:0', '0600', '9am', '', ':30', '06:00 ', null, undefined])
            assert.equal(isClockTime(/** @type {any} */ (v)), false, String(v));
    });
});
